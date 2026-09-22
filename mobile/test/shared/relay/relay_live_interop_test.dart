// Live interoperability harness (mobile side, first slice).
//
// Drives the REAL production path — RelaySessionNotifier +
// real RelaySocket + SignedEventRelay — against a disposable relay
// (default http://localhost:3000, debug builds only). A second live
// session acts as the oracle peer until the Electron peer lands
// (blocked on PR19/PR20 socket activation).
//
// Relay presence is MANDATORY when INTEROP_REQUIRE_RELAY=true (the
// hosted workflow sets it): a missing relay fails the run instead of
// skipping, so a green hosted proof always executed every test. Local
// invocation without the flag skips cleanly. Prints pubkeys, event
// IDs, and channel IDs only — never nsec material, auth headers, or
// secure-storage contents.
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:http/http.dart' as http;
import 'package:nostr/nostr.dart' as nostr;
import 'package:uuid/uuid.dart';
import 'package:buzz/features/age_gate/age_signal_provider.dart';
import 'package:buzz/shared/auth/auth_provider.dart';
import 'package:buzz/shared/relay/relay.dart';

const _relayHttp = String.fromEnvironment(
  'INTEROP_RELAY_HTTP',
  defaultValue: 'http://localhost:3000',
);

/// Hosted CI sets this to require the disposable relay: a missing relay
/// must fail the run, never produce a green skip.
const _requireRelay = bool.fromEnvironment('INTEROP_REQUIRE_RELAY');

/// Fail-closed gate decision, unit-tested below without any relay.
enum _RelayGate { proceed, skip, failClosed }

_RelayGate _relayGateDecision({
  required bool reachable,
  required bool required,
}) {
  if (reachable) return _RelayGate.proceed;
  return required ? _RelayGate.failClosed : _RelayGate.skip;
}

Future<bool> _isRelayReachable(Uri uri) async {
  final client = http.Client();
  try {
    // Any HTTP response (even 404) proves the relay process is up.
    await client.get(uri).timeout(const Duration(seconds: 5));
    return true;
  } catch (_) {
    return false;
  } finally {
    client.close();
  }
}

String get _relayWs => _relayHttp.startsWith('https')
    ? _relayHttp.replaceFirst('https', 'wss')
    : _relayHttp.replaceFirst('http', 'ws');

class _AllowedAge extends AgeSignalNotifier {
  @override
  AgeSignalState build() => AgeSignalState.allowed;
}

class _StaticConfig extends RelayConfigNotifier {
  _StaticConfig(this._config);

  final RelayConfig _config;

  @override
  RelayConfig build() => _config;
}

class _Authed extends AuthNotifier {
  @override
  Future<AuthState> build() async =>
      const AuthState(status: AuthStatus.authenticated);
}

/// One live participant: container + session + signer + inbox.
class _LivePeer {
  _LivePeer({required this.nsec, required this.name});

  final String nsec;
  final String name;
  late final String pubkeyHex;
  late ProviderContainer container;
  final List<NostrEvent> inbox = [];
  final List<void Function()> _cleanupCallbacks = [];
  ProviderSubscription<SessionState>? _sessionListener;

  RelaySessionNotifier get session =>
      container.read(relaySessionProvider.notifier);

  Future<void> start() async {
    final privHex = nostr.Nip19.decode(payload: nsec).data;
    pubkeyHex = nostr.Keys(privHex).public;
    container = ProviderContainer(
      overrides: [
        ageSignalProvider.overrideWith(_AllowedAge.new),
        relayConfigProvider.overrideWith(
          () => _StaticConfig(RelayConfig(baseUrl: _relayHttp, nsec: nsec)),
        ),
        authProvider.overrideWith(_Authed.new),
      ],
    );
    // Auto-connect fires from build() once auth + nsec are present;
    // do not call reconnect() here to avoid a duplicate socket.
    _sessionListener = container.listen(relaySessionProvider, (_, _) {});
    await container.read(authProvider.future);
  }

  Future<void> waitConnected({
    Duration timeout = const Duration(seconds: 25),
  }) async {
    final deadline = DateTime.now().add(timeout);
    while (DateTime.now().isBefore(deadline)) {
      if (container.read(relaySessionProvider).status ==
          SessionStatus.connected) {
        return;
      }
      await Future<void>.delayed(const Duration(milliseconds: 200));
    }
    fail('$name did not connect to $_relayWs within $timeout');
  }

  Future<void> subscribeChannel(String channelId) async {
    final cleanup = await session.subscribeWithStatus(
      NostrFilter(
        kinds: const [9],
        tags: {
          '#h': [channelId],
        },
      ),
      inbox.add,
      onStatusChanged: (_) {},
    );
    _cleanupCallbacks.add(cleanup);
  }

  Future<NostrEvent> publishMessage({
    required String channelId,
    required String content,
    String? replyToRootId,
  }) async {
    final tags = <List<String>>[
      ['h', channelId],
    ];
    if (replyToRootId != null) {
      tags.add(['e', replyToRootId, '', 'root']);
      tags.add(['e', replyToRootId, '', 'reply']);
    }
    final submitter = SignedEventRelay(session: session, nsec: nsec);
    return submitter.submit(kind: 9, content: content, tags: tags);
  }

  Future<NostrEvent> waitForEvent(
    String eventId, {
    Duration timeout = const Duration(seconds: 20),
  }) async {
    final deadline = DateTime.now().add(timeout);
    while (DateTime.now().isBefore(deadline)) {
      for (final event in inbox) {
        if (event.id == eventId) return event;
      }
      await Future<void>.delayed(const Duration(milliseconds: 200));
    }
    fail('$name did not receive event $eventId within $timeout');
  }

  Future<void> dispose() async {
    for (final cleanup in _cleanupCallbacks.reversed) {
      cleanup();
    }
    _cleanupCallbacks.clear();
    _sessionListener?.close();
    container.dispose();
  }
}

Future<String> _createChannel(http.Client httpClient, String nsec) async {
  final privHex = nostr.Nip19.decode(payload: nsec).data;
  // Fresh v4 UUID per run: the relay's kind-9007 path requires the h tag
  // to parse as a UUID (otherwise the REQ gate rejects with
  // 'restricted: not a channel member' without consulting membership),
  // and bootstraps the creator as owner in channel_members only when
  // the channel row is newly created.
  final channelId = const Uuid().v4();
  final event = nostr.Event.from(
    kind: 9007,
    content: '',
    tags: [
      ['h', channelId],
      ['name', 'interop-harness'],
      ['channel_type', 'stream'],
      ['visibility', 'open'],
    ],
    secretKey: privHex,
    verify: false,
  );
  final response = await httpClient
      .post(
        Uri.parse('$_relayHttp/events'),
        headers: {
          'Content-Type': 'application/json',
          'X-Pubkey': nostr.Keys(privHex).public,
        },
        body: jsonEncode(event.toMap()),
      )
      .timeout(const Duration(seconds: 10));
  if (response.statusCode < 200 || response.statusCode >= 300) {
    fail('channel creation failed: ${response.statusCode}');
  }
  return channelId;
}

void main() {
  group('relay gate decision (no relay needed)', () {
    test('reachable always proceeds', () {
      expect(
        _relayGateDecision(reachable: true, required: true),
        _RelayGate.proceed,
      );
      expect(
        _relayGateDecision(reachable: true, required: false),
        _RelayGate.proceed,
      );
    });

    test('unreachable skips only when not required', () {
      expect(
        _relayGateDecision(reachable: false, required: false),
        _RelayGate.skip,
      );
    });

    test('unreachable fails closed when required', () {
      expect(
        _relayGateDecision(reachable: false, required: true),
        _RelayGate.failClosed,
      );
    });

    test('closed port is unreachable', () async {
      // Port 1 is never bound: proves the detector reports absence.
      expect(await _isRelayReachable(Uri.parse('http://127.0.0.1:1')), isFalse);
    });
  });

  group('live relay interop (disposable relay)', () {
    late http.Client httpClient;
    late _LivePeer mobile;
    late _LivePeer oracle;
    late String channelId;
    var ready = false;

    // markTestSkipped in setUpAll does not stop test bodies from
    // running on every runner, and markTestSkipped itself does not
    // halt the test body either: each test must return on false.
    bool requireReady() {
      if (ready) return true;
      markTestSkipped('disposable relay unreachable at $_relayHttp');
      return false;
    }

    setUpAll(() async {
      switch (_relayGateDecision(
        reachable: await _isRelayReachable(Uri.parse(_relayHttp)),
        required: _requireRelay,
      )) {
        case _RelayGate.proceed:
          break;
        case _RelayGate.skip:
          markTestSkipped('disposable relay unreachable at $_relayHttp');
          return;
        case _RelayGate.failClosed:
          fail('required disposable relay unreachable at $_relayHttp');
      }
      httpClient = http.Client();
      final mobileKeys = nostr.Keys.generate();
      final oracleKeys = nostr.Keys.generate();
      mobile = _LivePeer(nsec: mobileKeys.nsec, name: 'mobile');
      oracle = _LivePeer(nsec: oracleKeys.nsec, name: 'oracle');
      await mobile.start();
      await oracle.start();
      await mobile.waitConnected();
      await oracle.waitConnected();
      channelId = await _createChannel(httpClient, mobileKeys.nsec);
      debugPrint(
        'interop channel=$channelId '
        'mobile=${mobile.pubkeyHex} oracle=${oracle.pubkeyHex}',
      );
      await mobile.subscribeChannel(channelId);
      await oracle.subscribeChannel(channelId);
      ready = true;
    });

    tearDownAll(() async {
      if (!ready) return;
      await mobile.dispose();
      await oracle.dispose();
      httpClient.close();
    });

    test(
      'bidirectional channel message and thread reply',
      () async {
        if (!requireReady()) return;
        final tag = DateTime.now().millisecondsSinceEpoch;
        final sent = await mobile.publishMessage(
          channelId: channelId,
          content: 'mobile hello $tag',
        );
        final atOracle = await oracle.waitForEvent(sent.id);
        expect(atOracle.content, 'mobile hello $tag');
        expect(atOracle.channelId, channelId);
        expect(atOracle.pubkey, mobile.pubkeyHex);

        final reply = await oracle.publishMessage(
          channelId: channelId,
          content: 'oracle reply $tag',
          replyToRootId: sent.id,
        );
        final atMobile = await mobile.waitForEvent(reply.id);
        expect(atMobile.content, 'oracle reply $tag');
        expect(atMobile.getTagValue('h'), channelId);
        expect(
          atMobile.tags.any(
            (t) => t.length > 2 && t[0] == 'e' && t[1] == sent.id,
          ),
          isTrue,
          reason: 'thread reply must reference the root event',
        );
        debugPrint('interop matrix ok root=${sent.id} reply=${reply.id}');
      },
      timeout: const Timeout(Duration(minutes: 8)),
    );

    test(
      'fresh session catches up history exactly once',
      () async {
        if (!requireReady()) return;
        final sent = await mobile.publishMessage(
          channelId: channelId,
          content: 'catchup probe ${DateTime.now().millisecondsSinceEpoch}',
        );
        await oracle.waitForEvent(sent.id);

        final lateKeys = nostr.Keys.generate();
        final late = _LivePeer(nsec: lateKeys.nsec, name: 'late');
        addTearDown(late.dispose);
        await late.start();
        await late.waitConnected();
        final history = await late.session.fetchHistory(
          NostrFilter(
            kinds: const [9],
            tags: {
              '#h': [channelId],
            },
          ),
        );
        final matches = history.where((event) => event.id == sent.id).toList();
        expect(matches, hasLength(1));
        expect(
          matches.single.content,
          sent.content,
        );
        debugPrint('interop catch-up ok id=${sent.id} '
            'history=${history.length} content=${matches.single.content}');
      },
      timeout: const Timeout(Duration(minutes: 8)),
    );

    test(
      'reconnect replays missed message exactly once',
      () async {
        if (!requireReady()) return;
        mobile.session.debugHandleDisconnected('harness drop');
        final tag = DateTime.now().millisecondsSinceEpoch;
        final sent = await oracle.publishMessage(
          channelId: channelId,
          content: 'while mobile away $tag',
        );
        await mobile.session.reconnect();
        final received = await mobile.waitForEvent(sent.id);
        expect(received.content, 'while mobile away $tag');
        final duplicates = mobile.inbox
            .where((event) => event.id == sent.id)
            .toList();
        expect(duplicates, hasLength(1));
      },
      timeout: const Timeout(Duration(minutes: 8)),
    );

    test(
      'restart retains identity and resubscribes',
      () async {
        if (!requireReady()) return;
        final beforePubkey = mobile.pubkeyHex;
        final nsec = mobile.nsec;
        await mobile.dispose();
        mobile = _LivePeer(nsec: nsec, name: 'mobile-restarted');
        await mobile.start();
        await mobile.waitConnected();
        expect(mobile.pubkeyHex, beforePubkey);
        await mobile.subscribeChannel(channelId);
        final history = await mobile.session.fetchHistory(
          NostrFilter(
            kinds: const [9],
            tags: {
              '#h': [channelId],
            },
            limit: 50,
          ),
        );
        expect(history, isNotEmpty);
      },
      timeout: const Timeout(Duration(minutes: 8)),
    );

    test(
      'foreign channel events stay isolated',
      () async {
        if (!requireReady()) return;
        // Real isolation needs a real foreign channel with a real owner:
        // create it as a second identity (bootstraps that key as owner),
        // publish into it as that owner, then assert the matrix peer —
        // subscribed only to the matrix channel — sees nothing. A bare
        // UUID nobody owns only proves the relay rejects unknown channels.
        final foreignKeys = nostr.Keys.generate();
        final foreignChannelId = await _createChannel(
          httpClient,
          foreignKeys.nsec,
        );
        final foreignSubmitter = SignedEventRelay(
          session: oracle.session,
          nsec: foreignKeys.nsec,
        );
        final foreign = await foreignSubmitter.submit(
          kind: 9,
          content: 'not for the matrix',
          tags: [
            ['h', foreignChannelId],
          ],
        );
        await Future<void>.delayed(const Duration(seconds: 3));
        expect(
          mobile.inbox.any((event) => event.id == foreign.id),
          isFalse,
          reason: 'matrix subscription must not see other channels',
        );
      },
      timeout: const Timeout(Duration(minutes: 8)),
    );
    test(
      'undecodable identity fails closed before connect',
      () async {
        const garbage = 'nsec1invalidkeymaterial000000000000000';
        var terminalAtDecode = false;
        try {
          nostr.Nip19.decode(payload: garbage);
        } catch (_) {
          terminalAtDecode = true;
        }
        if (terminalAtDecode) return;
        // Unexpected branch: the string decoded, so the session itself
        // must still never authenticate with it.
        final bad = _LivePeer(nsec: garbage, name: 'bad-identity');
        addTearDown(bad.dispose);
        await bad.start();
        await Future<void>.delayed(const Duration(seconds: 10));
        expect(
          bad.container.read(relaySessionProvider).status,
          isNot(SessionStatus.connected),
          reason: 'garbage identity must never authenticate',
        );
      },
      timeout: const Timeout(Duration(minutes: 3)),
    );
  });
}
