import 'dart:async';

import 'relay_rate_limit_gate.dart';

enum RelayOperationPriority { background, normal, visible, interactive }

enum _RelayOperationBudget { websocket, httpQuery }

class _QueuedRelayOperation {
  final int sequence;
  final RelayOperationPriority priority;
  final _RelayOperationBudget budget;
  final bool persistedEvent;
  final bool Function() isCurrent;
  final int Function() minimumDelayMs;
  final void Function() send;
  final Completer<void> completer;

  _QueuedRelayOperation({
    required this.sequence,
    required this.priority,
    required this.budget,
    required this.persistedEvent,
    required this.isCurrent,
    required this.minimumDelayMs,
    required this.send,
    required this.completer,
  });
}

/// Paces relay operations below the WebSocket and HTTP fixed-window budgets.
/// State belongs to one authenticated relay session.
class RelayOperationScheduler {
  static const burstCapacity = 8;
  static const operationInterval = Duration(milliseconds: 125);
  static const httpQueryBurstCapacity = 4;
  static const httpQueryInterval = Duration(milliseconds: 600);
  static const persistedEventBurstCapacity = 4;
  static const persistedEventInterval = Duration(milliseconds: 1200);
  static const maxQueuedOperations = 256;

  final DateTime Function() _now;
  final RelayTimerFactory _timerFactory;
  final List<_QueuedRelayOperation> _queue = [];
  double _tokens = burstCapacity.toDouble();
  double _httpTokens = httpQueryBurstCapacity.toDouble();
  double _persistedEventTokens = persistedEventBurstCapacity.toDouble();
  DateTime _lastRefillAt;
  DateTime _lastHttpRefillAt;
  DateTime _lastPersistedEventRefillAt;
  int _nextSequence = 0;
  Timer? _refillTimer;

  RelayOperationScheduler({
    DateTime Function()? now,
    RelayTimerFactory timerFactory = Timer.new,
  }) : _now = now ?? DateTime.now,
       _timerFactory = timerFactory,
       _lastRefillAt = (now ?? DateTime.now)(),
       _lastHttpRefillAt = (now ?? DateTime.now)(),
       _lastPersistedEventRefillAt = (now ?? DateTime.now)();

  Future<void> send({
    required List<dynamic> frame,
    required bool Function() isCurrent,
    required int Function() minimumDelayMs,
    required void Function() send,
    RelayOperationPriority priority = RelayOperationPriority.normal,
  }) {
    if (!_isAdmissionFrame(frame)) {
      if (!isCurrent()) {
        return Future.error(StateError('Relay operation was superseded.'));
      }
      send();
      return Future.value();
    }
    return _enqueue(
      budget: _RelayOperationBudget.websocket,
      persistedEvent: _isPersistedEvent(frame),
      isCurrent: isCurrent,
      minimumDelayMs: minimumDelayMs,
      send: send,
      priority: priority,
    );
  }

  /// Acquires a paced slot for one HTTP `/query` request.
  Future<void> acquireHttpQuery({
    required bool Function() isCurrent,
    required int Function() minimumDelayMs,
    RelayOperationPriority priority = RelayOperationPriority.visible,
  }) => _enqueue(
    budget: _RelayOperationBudget.httpQuery,
    persistedEvent: false,
    isCurrent: isCurrent,
    minimumDelayMs: minimumDelayMs,
    send: () {},
    priority: priority,
  );

  Future<void> _enqueue({
    required _RelayOperationBudget budget,
    required bool persistedEvent,
    required bool Function() isCurrent,
    required int Function() minimumDelayMs,
    required void Function() send,
    required RelayOperationPriority priority,
  }) {
    if (_queue.length >= maxQueuedOperations) {
      return Future.error(
        StateError('Relay outbound operation queue is full.'),
      );
    }

    final completer = Completer<void>();
    _queue.add(
      _QueuedRelayOperation(
        sequence: _nextSequence++,
        priority: priority,
        budget: budget,
        persistedEvent: persistedEvent,
        isCurrent: isCurrent,
        minimumDelayMs: minimumDelayMs,
        send: send,
        completer: completer,
      ),
    );
    _drain();
    return completer.future;
  }

  void reset() {
    _refillTimer?.cancel();
    _refillTimer = null;
    for (final operation in _queue) {
      if (!operation.completer.isCompleted) {
        operation.completer.completeError(
          StateError('Relay operation was superseded.'),
        );
      }
    }
    _queue.clear();
    _tokens = burstCapacity.toDouble();
    _httpTokens = httpQueryBurstCapacity.toDouble();
    _persistedEventTokens = persistedEventBurstCapacity.toDouble();
    _lastRefillAt = _lastHttpRefillAt = _lastPersistedEventRefillAt = _now();
    _nextSequence = 0;
  }

  void _drain() {
    _refill();
    _queue.sort((left, right) {
      final priorityOrder = right.priority.index.compareTo(left.priority.index);
      return priorityOrder != 0
          ? priorityOrder
          : left.sequence.compareTo(right.sequence);
    });

    for (var index = _queue.length - 1; index >= 0; index--) {
      final operation = _queue[index];
      if (!operation.isCurrent()) {
        _queue.removeAt(index);
        if (!operation.completer.isCompleted) {
          operation.completer.completeError(
            StateError('Relay operation was superseded.'),
          );
        }
      }
    }

    while (_queue.isNotEmpty) {
      var selectedIndex = -1;
      var nextReadyInMs = 1 << 30;
      for (var index = 0; index < _queue.length; index++) {
        final operation = _queue[index];
        final delayMs = _delayFor(operation);
        if (delayMs == 0) {
          selectedIndex = index;
          break;
        }
        if (delayMs < nextReadyInMs) nextReadyInMs = delayMs;
      }
      if (selectedIndex < 0) {
        _refillTimer?.cancel();
        _refillTimer = null;
        _scheduleDrain(nextReadyInMs);
        return;
      }

      final operation = _queue.removeAt(selectedIndex);
      switch (operation.budget) {
        case _RelayOperationBudget.websocket:
          _tokens -= 1;
        case _RelayOperationBudget.httpQuery:
          _httpTokens -= 1;
      }
      if (operation.persistedEvent) _persistedEventTokens -= 1;
      try {
        operation.send();
        if (!operation.completer.isCompleted) operation.completer.complete();
      } catch (error, stackTrace) {
        if (!operation.completer.isCompleted) {
          operation.completer.completeError(error, stackTrace);
        }
      }
      _refill();
    }
    _refillTimer?.cancel();
    _refillTimer = null;
  }

  int _delayFor(_QueuedRelayOperation operation) {
    var delayMs = operation.minimumDelayMs();
    if (delayMs < 0) delayMs = 0;
    if (operation.budget == _RelayOperationBudget.websocket) {
      delayMs = _maxDelay(delayMs, _tokenDelay(_tokens, operationInterval));
    } else {
      delayMs = _maxDelay(delayMs, _tokenDelay(_httpTokens, httpQueryInterval));
    }
    if (operation.persistedEvent) {
      delayMs = _maxDelay(
        delayMs,
        _tokenDelay(_persistedEventTokens, persistedEventInterval),
      );
    }
    return delayMs;
  }

  int _tokenDelay(double tokens, Duration interval) =>
      tokens >= 1 ? 0 : ((1 - tokens) * interval.inMilliseconds).ceil();

  int _maxDelay(int left, int right) => left > right ? left : right;

  void _scheduleDrain(int delayMs) {
    if (_refillTimer != null) return;
    _refillTimer = _timerFactory(Duration(milliseconds: delayMs), () {
      _refillTimer = null;
      _drain();
    });
  }

  void _refill() {
    final now = _now();
    _tokens = _refillBucket(
      _tokens,
      burstCapacity,
      _lastRefillAt,
      now,
      operationInterval,
    );
    _httpTokens = _refillBucket(
      _httpTokens,
      httpQueryBurstCapacity,
      _lastHttpRefillAt,
      now,
      httpQueryInterval,
    );
    _persistedEventTokens = _refillBucket(
      _persistedEventTokens,
      persistedEventBurstCapacity,
      _lastPersistedEventRefillAt,
      now,
      persistedEventInterval,
    );
    _lastRefillAt = _lastHttpRefillAt = _lastPersistedEventRefillAt = now;
  }

  double _refillBucket(
    double tokens,
    int capacity,
    DateTime lastRefillAt,
    DateTime now,
    Duration interval,
  ) {
    final elapsedMs = now.difference(lastRefillAt).inMicroseconds / 1000;
    return (tokens + elapsedMs / interval.inMilliseconds)
        .clamp(0, capacity)
        .toDouble();
  }

  bool _isAdmissionFrame(List<dynamic> frame) =>
      frame.isNotEmpty && const {'REQ', 'COUNT', 'EVENT'}.contains(frame.first);

  bool _isPersistedEvent(List<dynamic> frame) {
    if (frame.length < 2 || frame.first != 'EVENT') return false;
    final event = frame[1];
    final kind = event is Map ? event['kind'] : null;
    return kind is int && (kind < 20000 || kind > 29999);
  }
}
