import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:http/http.dart' as http;
import 'package:nostr/nostr.dart' as nostr;
import 'package:pointycastle/digests/sha256.dart';
import 'package:uuid/uuid.dart';

import 'package:flutter/foundation.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../features/age_gate/age_signal_provider.dart';
import '../auth/auth.dart';
import 'nostr_models.dart';
import 'relay_client.dart';
import 'relay_closed_policy.dart';
import 'relay_http_query_client.dart';
import 'relay_provider.dart';
import 'relay_operation_scheduler.dart';
import 'relay_rate_limit_gate.dart';
import 'relay_session_types.dart';
import 'relay_socket.dart';

export 'relay_session_types.dart';

part 'relay_session_auth.dart';
part 'relay_session_http.dart';
part 'relay_session_support.dart';

class _HistorySubscription {
  final NostrFilter filter;
  final List<NostrEvent> events = [];
  final Completer<List<NostrEvent>> completer;
  final Duration timeoutDuration;
  Timer? timeout;
  int closedRetryAttempt = 0;

  _HistorySubscription({
    required this.filter,
    required this.completer,
    required this.timeoutDuration,
  });
}

class RelaySessionNotifier extends Notifier<SessionState> {
  RelaySessionNotifier({
    http.Client? httpClient,
    http.Client Function()? httpClientFactory,
    RelaySocketFactory socketFactory = RelaySocket.new,
    DateTime Function()? now,
    double Function()? random,
    RelayRateLimitGate? rateLimitGate,
    RelayRateLimitGate? httpRateLimitGate,
    RelayOperationScheduler? operationScheduler,
    RelayTimerFactory retryTimerFactory = Timer.new,
    Future<void> Function(Duration) replayDelay = Future.delayed,
  }) : _httpQueryClient = RelayHttpQueryClient(
         client: httpClient,
         clientFactory: httpClientFactory,
       ),
       _socketFactory = socketFactory,
       _now = now ?? DateTime.now,
       _random = random ?? Random().nextDouble,
       _operationScheduler =
           operationScheduler ?? RelayOperationScheduler(now: now),
       _rateLimitGate = rateLimitGate ?? RelayRateLimitGate(),
       _httpRateLimitGate =
           httpRateLimitGate ??
           RelayRateLimitGate(now: now, timerFactory: retryTimerFactory),
       _retryTimerFactory = retryTimerFactory,
       _replayDelay = replayDelay;

  final RelayHttpQueryClient _httpQueryClient;
  final RelaySocketFactory _socketFactory;
  final DateTime Function() _now;
  final double Function() _random;
  final RelayOperationScheduler _operationScheduler;
  final RelayRateLimitGate _rateLimitGate;
  final RelayRateLimitGate _httpRateLimitGate;
  final RelayTimerFactory _retryTimerFactory;
  final Future<void> Function(Duration) _replayDelay;

  static const _baseReconnectDelayMs = 1000;
  static const _maxReconnectDelayMs = 30000;
  static const _eventBatchMs = 16;
  static const _reconnectReplaySkewSeconds = 5;
  static const _replayBatchSize = 8;
  static const _replayInterBatchDelay = Duration(milliseconds: 50);
  static const _maxRecentDeliveryKeys = 5000;
  static const _backgroundGraceDuration = Duration(seconds: 5);

  RelaySocket? _socket;
  final Map<String, _HistorySubscription> _historySubscriptions = {};
  final Map<String, Future<List<NostrEvent>>> _inFlightHistoryRequests = {};
  final Map<String, Future<List<NostrEvent>>> _inFlightHttpQueries = {};
  final Map<String, _LiveSubscription> _liveSubscriptions = {};
  final Map<String, String> _liveSubscriptionIdsByFilter = {};
  final Map<String, _ClosedRetry> _pendingClosedRetries = {};
  final Map<String, _PendingEvent> _pendingEvents = {};
  final List<_BufferedEvent> _eventBuffer = [];
  final Set<String> _recentDeliveryKeys = {};
  Timer? _reconnectTimer;
  Timer? _flushTimer;
  Timer? _backgroundGraceTimer;
  DateTime? _backgroundedAt;
  int _reconnectDelayMs = _baseReconnectDelayMs;
  int _subIdCounter = 0;
  bool _disposed = false;
  bool _ageRestricted = false;
  bool _paused = false;
  bool _hasConnectedOnce = false;
  int _connectionGeneration = 0;
  int _contextGeneration = 0;
  final Map<Object, String> _visibleChannelsByOwner = {};
  final Map<Object, Future<void> Function()> _beforePauseCallbacks = {};
  bool _socketConnected = false;
  bool _closedRetryReplayScheduled = false;

  @override
  SessionState build() {
    final config = ref.watch(relayConfigProvider);
    final authState = ref.watch(authProvider);
    _ageRestricted = ref.watch(ageSignalProvider) == AgeSignalState.restricted;

    // Reset disposed flag — build() may re-run on the same Notifier instance
    // after a provider dependency changes (e.g. auth completing).
    _disposed = false;

    ref.onDispose(_dispose);

    // Auto-connect when authenticated and we have a signing key (NIP-42 AUTH).
    final isAuthenticated = authState.value?.status == AuthStatus.authenticated;
    if (!_ageRestricted && isAuthenticated && config.nsec != null) {
      // Schedule connection after build completes.
      Future.microtask(() => _connect(config));
    }

    return const SessionState(status: SessionStatus.disconnected);
  }

  /// Executes a paced one-shot query via the relay HTTP bridge.
  Future<List<NostrEvent>> queryRelay(
    List<NostrFilter> filters, {
    Duration timeout = const Duration(seconds: 8),
  }) {
    if (_disposed || _ageRestricted) {
      return Future.error(StateError('Relay session is unavailable'));
    }
    final key = jsonEncode(filters.map((filter) => filter.toJson()).toList());
    final existing = _inFlightHttpQueries[key];
    if (existing != null) return existing;

    final generation = _contextGeneration;
    final config = ref.read(relayConfigProvider);
    late final Future<List<NostrEvent>> request;
    request =
        _performRelayHttpQuery(
          filters: filters,
          timeout: timeout,
          config: config,
          isCurrent: () =>
              !_disposed && !_ageRestricted && generation == _contextGeneration,
          client: _httpQueryClient,
          scheduler: _operationScheduler,
          rateLimitGate: _httpRateLimitGate,
        ).whenComplete(() {
          if (identical(_inFlightHttpQueries[key], request)) {
            _inFlightHttpQueries.remove(key);
          }
        });
    _inFlightHttpQueries[key] = request;
    return request;
  }

  /// Fetch historical events matching [filter]. Sends REQ, collects events
  /// until EOSE, then resolves. One-shot subscription.
  Future<List<NostrEvent>> fetchHistory(
    NostrFilter filter, {
    Duration timeout = const Duration(seconds: 8),
  }) {
    final key = jsonEncode(filter.toJson());
    final existing = _inFlightHistoryRequests[key];
    if (existing != null) return existing;

    late final Future<List<NostrEvent>> request;
    request = _fetchHistory(filter, timeout: timeout).whenComplete(() {
      if (identical(_inFlightHistoryRequests[key], request)) {
        _inFlightHistoryRequests.remove(key);
      }
    });
    _inFlightHistoryRequests[key] = request;
    return request;
  }

  Future<List<NostrEvent>> _fetchHistory(
    NostrFilter filter, {
    required Duration timeout,
  }) async {
    if (_disposed) throw StateError('Relay session is disposed');
    final subId = _nextSubId('h');
    final completer = Completer<List<NostrEvent>>();
    _historySubscriptions[subId] = _HistorySubscription(
      filter: filter,
      completer: completer,
      timeoutDuration: timeout,
    );

    try {
      await _sendReq(subId, filter);
      final subscription = _historySubscriptions[subId];
      if (subscription != null) {
        _armHistoryTimeout(subId, subscription);
      }
    } catch (error, stackTrace) {
      final subscription = _historySubscriptions.remove(subId);
      if (subscription != null && !completer.isCompleted) {
        completer.completeError(error, stackTrace);
      }
    }
    return completer.future;
  }

  Future<void Function()> subscribe(
    NostrFilter filter,
    void Function(NostrEvent) onEvent, {
    void Function(String message)? onClosed,
  }) => _subscribe(filter, onEvent, onClosed: onClosed);

  /// Subscribe to a live stream and observe its recovery lifecycle.
  ///
  /// The returned future completes after initial EOSE (or the existing
  /// fallback timeout) and yields a cleanup callback. [onStatusChanged] emits
  /// [RelaySubscriptionStatus.ready] at each EOSE after buffered replay events
  /// have been delivered, and [RelaySubscriptionStatus.retrying] immediately
  /// when a retryable or rate-limited CLOSED begins backoff. Terminal CLOSED
  /// invokes [onClosed] and removes the subscription instead of retrying it.
  /// Calling the cleanup callback cancels pending retries and sends CLOSE.
  Future<void Function()> subscribeWithStatus(
    NostrFilter filter,
    void Function(NostrEvent) onEvent, {
    void Function(String message)? onClosed,
    required void Function(RelaySubscriptionStatus status) onStatusChanged,
  }) => _subscribe(
    filter,
    onEvent,
    onClosed: onClosed,
    onStatusChanged: onStatusChanged,
  );

  Future<void Function()> _subscribe(
    NostrFilter filter,
    void Function(NostrEvent) onEvent, {
    void Function(String message)? onClosed,
    void Function(RelaySubscriptionStatus status)? onStatusChanged,
  }) async {
    if (_disposed) throw StateError('Relay session is disposed');
    final filterKey = jsonEncode(filter.toJson());
    final listener = _LiveListener(
      onEvent: onEvent,
      onClosed: onClosed,
      onStatusChanged: onStatusChanged,
    );
    final existingSubId = _liveSubscriptionIdsByFilter[filterKey];
    final existing = existingSubId == null
        ? null
        : _liveSubscriptions[existingSubId];
    if (existing != null && existingSubId != null) {
      existing.listeners.add(listener);
      if (existing.ready) {
        listener.onStatusChanged?.call(RelaySubscriptionStatus.ready);
      } else {
        final readyCompleter = existing.readyCompleter;
        if (readyCompleter != null) {
          await readyCompleter.future.timeout(
            const Duration(milliseconds: 500),
            onTimeout: () {},
          );
        }
      }
      return () => _unsubscribeListener(existingSubId, existing, listener);
    }

    final subId = _nextSubId('l');
    final readyCompleter = Completer<void>();

    final subscription = _LiveSubscription(
      filter: filter,
      listener: listener,
      readyCompleter: readyCompleter,
    );
    _liveSubscriptions[subId] = subscription;
    _liveSubscriptionIdsByFilter[filterKey] = subId;

    try {
      await _sendReq(subId, filter);
      await readyCompleter.future.timeout(
        const Duration(milliseconds: 500),
        onTimeout: () {},
      );
    } catch (_) {
      final liveSub = _liveSubscriptions[subId];
      if (liveSub != null) _removeLiveSubscription(subId, liveSub);
      rethrow;
    }
    final liveSub = _liveSubscriptions[subId];
    if (liveSub != null && liveSub.readyCompleter == readyCompleter) {
      liveSub.readyCompleter = null;
    }

    return () => _unsubscribeListener(subId, subscription, listener);
  }

  Future<NostrEvent> publish(
    NostrEvent event, {
    Duration timeout = const Duration(seconds: 8),
  }) async {
    final generation = _connectionGeneration;
    if (!_isActiveConnection(generation) || !_socketConnected) {
      throw StateError('Relay session is not connected');
    }

    final completer = Completer<NostrEvent>();

    _pendingEvents[event.id] = _PendingEvent(completer: completer);
    final pending = _pendingEvents[event.id]!;
    try {
      await _sendPacedFrame(
        ['EVENT', event.toJson()],
        isCurrent: () =>
            _isActiveConnection(generation) &&
            _pendingEvents[event.id] == pending,
        priority: RelayOperationPriority.interactive,
      );
      if (_pendingEvents[event.id] == pending) {
        pending.timeout = Timer(timeout, () {
          final expired = _pendingEvents.remove(event.id);
          if (expired != null && !expired.completer.isCompleted) {
            expired.completer.completeError(
              TimeoutException(
                'Event ${event.id} not acknowledged within $timeout',
              ),
            );
          }
        });
      }
    } catch (error, stackTrace) {
      final failed = _pendingEvents.remove(event.id);
      if (failed != null && !failed.completer.isCompleted) {
        failed.completer.completeError(error, stackTrace);
      }
    }
    return completer.future;
  }

  void sendRaw(List<dynamic> payload) {
    final generation = _connectionGeneration;
    unawaited(
      _sendPacedFrame(
        payload,
        isCurrent: () => _isActiveConnection(generation) && _socketConnected,
        priority: payload.isNotEmpty && payload.first == 'EVENT'
            ? RelayOperationPriority.interactive
            : RelayOperationPriority.normal,
      ).catchError((_) {}),
    );
  }

  @visibleForTesting
  void debugHandleMessage(List<dynamic> data) => _handleMessage(data);

  @visibleForTesting
  void debugFlushEventBuffer() => _flushEventBuffer();

  @visibleForTesting
  Future<void> debugHandleConnected() =>
      _handleConnected(_connectionGeneration);

  @visibleForTesting
  Future<void> debugReplayLiveSubscriptions() =>
      _replayLiveSubscriptions(_connectionGeneration);

  @visibleForTesting
  void debugDispose() => _dispose();

  @visibleForTesting
  void debugSupersedeConnection() => _connectionGeneration++;

  @visibleForTesting
  void debugHandleDisconnected([Object? error]) {
    _socketConnected = false;
    _handleDisconnected(_connectionGeneration, error);
  }

  @visibleForTesting
  void debugResetClosedRetriesForDisconnect() {
    _socketConnected = false;
    _resetAllClosedRetries();
  }

  @visibleForTesting
  void debugSetSessionStatus(SessionStatus status) {
    _socketConnected = status == SessionStatus.connected;
  }

  @visibleForTesting
  void debugPauseNow() => _pauseNow();

  @visibleForTesting
  void debugHandleSocketMessageForTest(List<dynamic> data) =>
      _handleMessage(data);

  @visibleForTesting
  void debugAttachSocketForTest(RelaySocket socket) {
    _socket?.dispose();
    _socket = socket;
    _socketConnected = true;
  }

  /// Registers a visible channel and returns an owner-scoped release callback.
  /// The most recently registered owner is prioritized during reconnect replay.
  void Function() registerVisibleChannel(String channelId) {
    final owner = Object();
    _visibleChannelsByOwner[owner] = channelId;
    return () => _visibleChannelsByOwner.remove(owner);
  }

  /// Force a reconnect (e.g., returning from background).
  Future<void> reconnect() async {
    _socketConnected = false;
    await _socket?.disconnect();
    _reconnectDelayMs = _baseReconnectDelayMs;
    final config = ref.read(relayConfigProvider);
    await _connect(config);
  }

  /// Registers work that must settle before the background grace disconnect.
  void Function() registerBeforePause(Future<void> Function() callback) {
    final owner = Object();
    _beforePauseCallbacks[owner] = callback;
    return () => _beforePauseCallbacks.remove(owner);
  }

  /// Called by the app lifecycle provider when the app goes to background.
  void onAppPaused() {
    _backgroundedAt = _now();
    _backgroundGraceTimer?.cancel();
    _backgroundGraceTimer = Timer(_backgroundGraceDuration, () {
      unawaited(_pauseAfterCallbacks());
    });
  }

  Future<void> _pauseAfterCallbacks() async {
    final callbacks = _beforePauseCallbacks.values.toList();
    try {
      await Future.wait(callbacks.map((callback) => callback()));
    } catch (error) {
      debugPrint('Background cleanup failed: $error');
    }
    if (_backgroundedAt != null) _pauseNow();
  }

  void _pauseNow() {
    _paused = true;
    _socketConnected = false;
    _reconnectTimer?.cancel();
    _cancelAllHistory(Exception('App moved to background'));
    _rejectAllPending(Exception('App moved to background'));
    _socket?.disconnect();
    state = const SessionState(status: SessionStatus.disconnected);
  }

  /// Called by the app lifecycle provider when the app returns to foreground.
  void onAppResumed() {
    _paused = false;
    final backgroundedAt = _backgroundedAt;
    _backgroundedAt = null;
    _backgroundGraceTimer?.cancel();
    _backgroundGraceTimer = null;

    final backgroundedLongEnoughToRequireReconnect =
        backgroundedAt != null &&
        _now().difference(backgroundedAt) >= _backgroundGraceDuration;
    if (!backgroundedLongEnoughToRequireReconnect &&
        state.status == SessionStatus.connected) {
      return;
    }

    // Cancel any in-flight reconnect backoff timer so we reconnect immediately
    // instead of waiting for the (possibly large) exponential delay.
    _reconnectTimer?.cancel();
    _reconnectDelayMs = _baseReconnectDelayMs;
    final config = ref.read(relayConfigProvider);
    _connect(config);
  }

  Future<void> _connect(RelayConfig config) async {
    if (_disposed || _ageRestricted) return;

    final generation = ++_connectionGeneration;
    state = SessionState(
      status: _hasConnectedOnce
          ? SessionStatus.reconnecting
          : SessionStatus.connecting,
      reconnectAttempt: state.reconnectAttempt,
    );

    _socket?.dispose();
    final socket = _socketFactory(
      wsUrl: config.wsUrl,
      nsec: config.nsec,
      onMessage: (message) {
        if (generation == _connectionGeneration) _handleMessage(message);
      },
      onConnected: () => _handleConnected(generation),
      onDisconnected: (error) => _handleDisconnected(generation, error),
    );
    _socket = socket;

    await socket.connect();
  }

  Future<void> _handleConnected(int generation) async {
    if (_disposed || generation != _connectionGeneration) return;
    _socketConnected = true;
    _hasConnectedOnce = true;
    _reconnectDelayMs = _baseReconnectDelayMs;
    state = const SessionState(status: SessionStatus.connected);
    await _replayLiveSubscriptions(generation);
  }

  void _handleDisconnected(int generation, Object? error) {
    if (_disposed || generation != _connectionGeneration) return;
    _socketConnected = false;
    _cancelAllHistory(error);
    _rejectAllPending(error);
    _resetAllClosedRetries();
    _eventBuffer.clear();
    _flushTimer?.cancel();
    _flushTimer = null;
    if (error is RelayAuthRejectedException) {
      _reconnectTimer?.cancel();
      state = const SessionState(status: SessionStatus.disconnected);
      return;
    }
    _scheduleReconnect();
  }

  void _scheduleReconnect() {
    if (_disposed || _paused) return;
    final attempt = state.reconnectAttempt + 1;
    state = SessionState(
      status: SessionStatus.reconnecting,
      reconnectAttempt: attempt,
    );

    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(Duration(milliseconds: _reconnectDelayMs), () {
      _reconnectDelayMs = min(_reconnectDelayMs * 2, _maxReconnectDelayMs);
      final config = ref.read(relayConfigProvider);
      _connect(config);
    });
  }

  /// Replay all live subscriptions after a reconnect, with a time skew to
  /// catch events that occurred during the disconnect.
  Future<void> _replayLiveSubscriptions(int generation) async {
    if (_rateLimitGate.isActive) await _rateLimitGate.wait();
    if (!_isActiveConnection(generation)) return;

    final entries = _liveSubscriptions.entries.toList();
    final visibleChannelId = _visibleChannelsByOwner.isEmpty
        ? null
        : _visibleChannelsByOwner.values.last;
    if (visibleChannelId != null) {
      entries.sort((left, right) {
        final leftVisible =
            left.value.filter.tags['#h']?.contains(visibleChannelId) ?? false;
        final rightVisible =
            right.value.filter.tags['#h']?.contains(visibleChannelId) ?? false;
        if (leftVisible == rightVisible) return 0;
        return leftVisible ? -1 : 1;
      });
    }

    await _sendReplayBatches(entries, generation);
  }

  Future<void> _replayPendingClosedRetries(int generation) async {
    if (!_isActiveConnection(generation)) return;
    final entries = _pendingClosedRetries.entries
        .where((entry) => entry.value.generation == generation)
        .map(
          (entry) => MapEntry<String, _LiveSubscription>(
            entry.key,
            entry.value.subscription,
          ),
        )
        .toList();
    await _sendReplayBatches(entries, generation, pendingClosedRetries: true);
  }

  Future<void> _sendReplayBatches(
    List<MapEntry<String, _LiveSubscription>> entries,
    int generation, {
    bool pendingClosedRetries = false,
  }) async {
    for (var i = 0; i < entries.length; i += _replayBatchSize) {
      if (_rateLimitGate.isActive) await _rateLimitGate.wait();
      if (!_isActiveConnection(generation)) return;
      final batch = entries.sublist(
        i,
        min(i + _replayBatchSize, entries.length),
      );
      for (final entry in batch) {
        if (_liveSubscriptions[entry.key] != entry.value) continue;
        if (pendingClosedRetries) {
          final pendingRetry = _pendingClosedRetries[entry.key];
          if (pendingRetry?.subscription != entry.value ||
              pendingRetry?.generation != generation) {
            continue;
          }
          _pendingClosedRetries.remove(entry.key);
        }
        await _sendReq(
          entry.key,
          _replayFilter(entry.value),
          generation: generation,
        );
      }
      if (i + _replayBatchSize < entries.length) {
        await _replayDelay(_replayInterBatchDelay);
      }
    }
  }

  bool _isActiveConnection(int generation) =>
      !_disposed && generation == _connectionGeneration;

  NostrFilter _replayFilter(_LiveSubscription subscription) {
    final since = subscription.lastSeenCreatedAt;
    return since == null
        ? subscription.filter
        : subscription.filter.copyWithSince(
            max(0, since - _reconnectReplaySkewSeconds),
          );
  }

  void _handleMessage(List<dynamic> data) {
    if (data.isEmpty) return;
    final type = data[0] as String;

    switch (type) {
      case 'EVENT':
        _handleEvent(data);
      case 'EOSE':
        _handleEose(data);
      case 'CLOSED':
        _handleClosed(data);
      case 'OK':
        _handleOk(data);
    }
  }

  void _handleEvent(List<dynamic> data) {
    if (data.length < 3) return;
    final subId = data[1] as String;
    final eventJson = data[2] as Map<String, dynamic>;
    final event = NostrEvent.fromJson(eventJson);

    // History subscriptions accumulate immediately.
    final historySub = _historySubscriptions[subId];
    if (historySub != null) {
      historySub.events.add(event);
      return;
    }

    // Live subscriptions get batched. An EVENT proves the stream is active,
    // but not that a retry replay is complete; only EOSE is that boundary.
    final liveSub = _liveSubscriptions[subId];
    if (liveSub != null) {
      _resetClosedRetry(liveSub);
      // Track last seen timestamp for reconnect replay.
      if (liveSub.lastSeenCreatedAt == null ||
          event.createdAt > liveSub.lastSeenCreatedAt!) {
        liveSub.lastSeenCreatedAt = event.createdAt;
      }
      _eventBuffer.add(_BufferedEvent(subId, event));
      _scheduleFlush();
    }
  }

  void _handleEose(List<dynamic> data) {
    if (data.length < 2) return;
    final subId = data[1] as String;

    // History subscription: resolve with collected events.
    final historySub = _historySubscriptions.remove(subId);
    if (historySub != null) {
      historySub.timeout?.cancel();
      historySub.timeout = null;
      if (!historySub.completer.isCompleted) {
        historySub.completer.complete(historySub.events);
      }
      _sendClose(subId);
      return;
    }

    // Live subscription: flush replay callbacks before signaling ready. This
    // ordering matters for retry replays, whose original ready completer has
    // already been released.
    final liveSub = _liveSubscriptions[subId];
    if (liveSub != null) {
      _resetClosedRetry(liveSub);
      _flushBufferedEventsNow();
      liveSub.ready = true;
      for (final listener in List<_LiveListener>.from(liveSub.listeners)) {
        if (listener.active) {
          listener.onStatusChanged?.call(RelaySubscriptionStatus.ready);
        }
      }
    }
    if (liveSub != null &&
        liveSub.readyCompleter != null &&
        !liveSub.readyCompleter!.isCompleted) {
      liveSub.readyCompleter!.complete();
      liveSub.readyCompleter = null;
    }
  }

  void _handleClosed(List<dynamic> data) {
    if (data.length < 2) return;
    final subId = data[1] as String;
    final message = data.length >= 3 && data[2] is String
        ? data[2] as String
        : 'subscription closed by relay';
    final closedClass = classifyRelayClosed(message);

    final historySub = _historySubscriptions[subId];
    if (historySub != null) {
      if (closedClass == RelayClosedClass.rateLimited &&
          historySub.closedRetryAttempt < 3) {
        final retrySeconds = parseRateLimitRetrySeconds(message);
        _rateLimitGate.activate(retrySeconds);
        final attempt = historySub.closedRetryAttempt++;
        final backoffMs = 1000 * (1 << attempt);
        final hintedDelayMs =
            (retrySeconds != null
                ? min(retrySeconds, RelayRateLimitGate.maxRetrySeconds)
                : RelayRateLimitGate.defaultRetrySeconds) *
            1000;
        final gateDelayMs = _rateLimitGate.remainingMs() == 0
            ? hintedDelayMs
            : _rateLimitGate.remainingMs();
        final delayMs = _retryDelayMs(backoffMs, floorMs: gateDelayMs);
        historySub.timeout?.cancel();
        final nextSubId = _nextSubId('h');
        _historySubscriptions.remove(subId);
        _historySubscriptions[nextSubId] = historySub;
        final generation = _connectionGeneration;
        historySub.timeout = _retryTimerFactory(
          Duration(milliseconds: delayMs),
          () async {
            historySub.timeout = null;
            if (!_isActiveConnection(generation) ||
                _historySubscriptions[nextSubId] != historySub) {
              return;
            }
            try {
              await _sendReq(
                nextSubId,
                historySub.filter,
                generation: generation,
              );
              if (_historySubscriptions[nextSubId] == historySub) {
                _armHistoryTimeout(nextSubId, historySub);
              }
            } catch (error, stackTrace) {
              _historySubscriptions.remove(nextSubId);
              if (!historySub.completer.isCompleted) {
                historySub.completer.completeError(error, stackTrace);
              }
            }
          },
        );
        return;
      }
      _historySubscriptions.remove(subId);
      historySub.timeout?.cancel();
      historySub.timeout = null;
      if (!historySub.completer.isCompleted) {
        historySub.completer.completeError(Exception(message));
      }
      return;
    }

    final liveSub = _liveSubscriptions[subId];
    if (liveSub == null) return;
    final readyCompleter = liveSub.readyCompleter;
    if (closedClass == RelayClosedClass.terminal) {
      if (readyCompleter != null && !readyCompleter.isCompleted) {
        readyCompleter.completeError(Exception(message));
      }
      for (final listener in List<_LiveListener>.from(liveSub.listeners)) {
        if (listener.active) listener.onClosed?.call(message);
      }
      _removeLiveSubscription(subId, liveSub);
      return;
    }
    if (readyCompleter != null && !readyCompleter.isCompleted) {
      readyCompleter.complete();
      liveSub.readyCompleter = null;
    }
    for (final listener in List<_LiveListener>.from(liveSub.listeners)) {
      if (listener.active) {
        listener.onStatusChanged?.call(RelaySubscriptionStatus.retrying);
      }
    }
    if (liveSub.closedRetryTimer != null) return;

    final attempt = liveSub.closedRetryAttempt;
    if (attempt >= 3) {
      for (final listener in List<_LiveListener>.from(liveSub.listeners)) {
        if (listener.active) listener.onClosed?.call(message);
      }
      _removeLiveSubscription(subId, liveSub);
      return;
    }
    final backoffMs = min(
      _baseReconnectDelayMs * (1 << attempt),
      _maxReconnectDelayMs,
    );
    var delayMs = _retryDelayMs(backoffMs);
    if (closedClass == RelayClosedClass.rateLimited) {
      final retrySeconds = parseRateLimitRetrySeconds(message);
      _rateLimitGate.activate(retrySeconds);
      final fallbackMs =
          (retrySeconds != null
              ? min(retrySeconds, RelayRateLimitGate.maxRetrySeconds)
              : RelayRateLimitGate.defaultRetrySeconds) *
          1000;
      delayMs = _retryDelayMs(
        backoffMs,
        floorMs: _rateLimitGate.remainingMs() == 0
            ? fallbackMs
            : _rateLimitGate.remainingMs(),
      );
    }

    liveSub.closedRetryAttempt = attempt + 1;
    final retryGeneration = _connectionGeneration;
    liveSub.closedRetryTimer = _retryTimerFactory(
      Duration(milliseconds: delayMs),
      () async {
        liveSub.closedRetryTimer = null;
        if (!_isActiveConnection(retryGeneration) ||
            _liveSubscriptions[subId] != liveSub) {
          return;
        }
        if (_rateLimitGate.isActive) await _rateLimitGate.wait();
        if (!_isActiveConnection(retryGeneration) ||
            _liveSubscriptions[subId] != liveSub ||
            !_socketConnected) {
          return;
        }
        _pendingClosedRetries[subId] = _ClosedRetry(
          subscription: liveSub,
          generation: retryGeneration,
        );
        _scheduleClosedRetryReplay(retryGeneration);
      },
    );
  }

  void _scheduleClosedRetryReplay(int generation) {
    if (_closedRetryReplayScheduled) return;
    _closedRetryReplayScheduled = true;
    scheduleMicrotask(() async {
      try {
        await _replayPendingClosedRetries(generation);
      } finally {
        _closedRetryReplayScheduled = false;
        _pendingClosedRetries.removeWhere(
          (_, retry) => retry.generation != _connectionGeneration,
        );
        if (_pendingClosedRetries.values.any(
          (retry) => retry.generation == _connectionGeneration,
        )) {
          _scheduleClosedRetryReplay(_connectionGeneration);
        }
      }
    });
  }

  int _retryDelayMs(int backoffMs, {int floorMs = 0}) {
    final sample = _random().clamp(0.0, 1.0);
    final jitteredBackoff = (backoffMs * (0.8 + sample * 0.4)).round();
    return max(jitteredBackoff, floorMs) + _retryJitterMs();
  }

  int _retryJitterMs() => (_random().clamp(0.0, 0.999999) * 250).floor();

  void _handleOk(List<dynamic> data) {
    if (data.length < 3) return;
    final eventId = data[1] as String;
    final accepted = data[2] as bool;
    final message = data.length > 3 && data[3] is String
        ? data[3] as String
        : '';

    final pending = _pendingEvents.remove(eventId);
    if (pending == null) return;
    pending.timeout?.cancel();

    if (accepted) {
      // We don't have the full event here; create a minimal placeholder.
      // Command kinds (e.g. 41010, 30620, 46020) return "response:{...}" in
      // the OK message — preserve it in `content` so callers can parse it.
      if (!pending.completer.isCompleted) {
        pending.completer.complete(
          NostrEvent(
            id: eventId,
            pubkey: '',
            createdAt: 0,
            kind: 0,
            tags: [],
            content: message,
            sig: '',
          ),
        );
      }
    } else {
      // Back-pressure now arrives here rather than as a NOTICE: the relay
      // rejects an over-quota EVENT on the OK channel so this pending publish
      // can be settled at all. Without arming the gate the send would fail
      // without ever backing off.
      if (message.startsWith('rate-limited:')) {
        _rateLimitGate.activate(parseRateLimitRetrySeconds(message));
      }
      if (!pending.completer.isCompleted) {
        pending.completer.completeError(
          Exception(message.isNotEmpty ? message : 'Event rejected'),
        );
      }
    }
  }

  void _scheduleFlush() {
    _flushTimer ??= Timer(
      const Duration(milliseconds: _eventBatchMs),
      _flushEventBuffer,
    );
  }

  void _flushBufferedEventsNow() {
    _flushTimer?.cancel();
    _flushTimer = null;
    _flushEventBuffer();
  }

  void _flushEventBuffer() {
    _flushTimer = null;
    if (_eventBuffer.isEmpty) return;

    final batch = List<_BufferedEvent>.from(_eventBuffer);
    _eventBuffer.clear();

    for (final buffered in batch) {
      final sub = _liveSubscriptions[buffered.subId];
      if (sub == null) continue;

      // Deduplicate per subscription. The same relay event can legitimately
      // match multiple live subscriptions, e.g. the channel list unread listener
      // and the open channel message listener.
      final deliveryKey = '${buffered.subId}:${buffered.event.id}';
      if (_recentDeliveryKeys.contains(deliveryKey)) continue;

      // Cap the dedup set to prevent unbounded memory growth.
      if (_recentDeliveryKeys.length >= _maxRecentDeliveryKeys) {
        _recentDeliveryKeys.clear();
      }
      _recentDeliveryKeys.add(deliveryKey);

      for (final listener in List<_LiveListener>.from(sub.listeners)) {
        if (listener.active) listener.onEvent(buffered.event);
      }
    }
  }

  String _nextSubId(String prefix) {
    _subIdCounter++;
    return '$prefix-$_subIdCounter';
  }

  Future<void> _sendReq(String subId, NostrFilter filter, {int? generation}) {
    final requestGeneration = generation ?? _connectionGeneration;
    final visibleChannelId = _visibleChannelsByOwner.isEmpty
        ? null
        : _visibleChannelsByOwner.values.last;
    final visibleChannels = filter.tags['#h'] ?? const <String>[];
    return _sendPacedFrame(
      ['REQ', subId, filter.toJson()],
      isCurrent: () =>
          _isActiveConnection(requestGeneration) &&
          _socketConnected &&
          (_historySubscriptions.containsKey(subId) ||
              _liveSubscriptions.containsKey(subId)),
      priority:
          visibleChannelId != null && visibleChannels.contains(visibleChannelId)
          ? RelayOperationPriority.visible
          : RelayOperationPriority.normal,
    );
  }

  void _armHistoryTimeout(String subId, _HistorySubscription subscription) {
    subscription.timeout = Timer(subscription.timeoutDuration, () {
      if (_historySubscriptions.remove(subId) != subscription) return;
      subscription.timeout = null;
      if (!subscription.completer.isCompleted) {
        subscription.completer.completeError(
          TimeoutException(
            'Relay history request timed out after ${subscription.timeoutDuration}',
          ),
        );
      }
      _sendClose(subId);
    });
  }

  Future<void> _sendPacedFrame(
    List<dynamic> frame, {
    required bool Function() isCurrent,
    RelayOperationPriority priority = RelayOperationPriority.normal,
  }) async {
    final generation = _connectionGeneration;
    bool isCurrentConnection() =>
        _isActiveConnection(generation) && _socketConnected && isCurrent();
    await _operationScheduler.send(
      frame: frame,
      isCurrent: isCurrentConnection,
      minimumDelayMs: _rateLimitGate.remainingMs,
      send: () {
        if (!isCurrentConnection()) {
          throw StateError('Relay operation belongs to a retired session');
        }
        _socket?.send(frame);
      },
      priority: priority,
    );
  }

  void _sendClose(String subId) {
    _socket?.send(['CLOSE', subId]);
  }

  void _unsubscribeListener(
    String subId,
    _LiveSubscription subscription,
    _LiveListener listener,
  ) {
    if (!listener.active) return;
    listener.active = false;
    subscription.listeners.remove(listener);
    if (subscription.listeners.isEmpty &&
        _liveSubscriptions[subId] == subscription) {
      _removeLiveSubscription(subId, subscription);
      _sendClose(subId);
    }
  }

  void _removeLiveSubscription(String subId, _LiveSubscription subscription) {
    if (_liveSubscriptions[subId] != subscription) return;
    _liveSubscriptions.remove(subId);
    _liveSubscriptionIdsByFilter.removeWhere((_, id) => id == subId);
    for (final listener in subscription.listeners) {
      listener.active = false;
    }
    subscription.listeners.clear();
    _pendingClosedRetries.remove(subId);
    subscription.closedRetryTimer?.cancel();
    subscription.closedRetryTimer = null;
    _recentDeliveryKeys.removeWhere((key) => key.startsWith('$subId:'));
  }

  void _resetClosedRetry(_LiveSubscription subscription) {
    subscription.closedRetryAttempt = 0;
    subscription.closedRetryTimer?.cancel();
    subscription.closedRetryTimer = null;
  }

  void _cancelAllClosedRetries() {
    _pendingClosedRetries.clear();
    for (final subscription in _liveSubscriptions.values) {
      subscription.closedRetryTimer?.cancel();
      subscription.closedRetryTimer = null;
    }
  }

  void _resetAllClosedRetries() {
    _pendingClosedRetries.clear();
    for (final subscription in _liveSubscriptions.values) {
      _resetClosedRetry(subscription);
    }
  }

  void _cancelAllHistory(Object? error) {
    for (final entry in _historySubscriptions.values) {
      entry.timeout?.cancel();
      entry.timeout = null;
      if (!entry.completer.isCompleted) {
        entry.completer.completeError(error ?? Exception('Connection lost'));
      }
    }
    _historySubscriptions.clear();
  }

  void _rejectAllPending(Object? error) {
    for (final entry in _pendingEvents.values) {
      entry.timeout?.cancel();
      entry.timeout = null;
      if (!entry.completer.isCompleted) {
        entry.completer.completeError(error ?? Exception('Connection lost'));
      }
    }
    _pendingEvents.clear();
  }

  void _dispose() {
    _disposed = true;
    _operationScheduler.reset();
    _inFlightHistoryRequests.clear();
    _inFlightHttpQueries.clear();
    _contextGeneration++;
    _beforePauseCallbacks.clear();
    _connectionGeneration++;
    _reconnectTimer?.cancel();
    _flushTimer?.cancel();
    _backgroundGraceTimer?.cancel();
    _backgroundedAt = null;
    _cancelAllClosedRetries();
    _rateLimitGate.reset();
    _httpRateLimitGate.reset();
    _visibleChannelsByOwner.clear();
    _socketConnected = false;
    _cancelAllHistory(null);
    _rejectAllPending(null);
    final subscriptions = _liveSubscriptions.values.toList();
    _liveSubscriptions.clear();
    _liveSubscriptionIdsByFilter.clear();
    for (final subscription in subscriptions) {
      subscription.closedRetryTimer?.cancel();
      subscription.closedRetryTimer = null;
    }
    _recentDeliveryKeys.clear();
    _socket?.dispose();
    _socket = null;
    _httpQueryClient.close();
  }
}

final relaySessionProvider =
    NotifierProvider<RelaySessionNotifier, SessionState>(
      RelaySessionNotifier.new,
    );
