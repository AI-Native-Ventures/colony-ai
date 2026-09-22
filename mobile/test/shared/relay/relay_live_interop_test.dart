// Live interoperability harness (mobile side, first slice).
//
// Drives the REAL production path — RelaySessionNotifier +
// real RelaySocket + SignedEventRelay — against a disposable relay
// (default http://localhost:3000, debug builds only). A second live
// session acts as the oracle peer until the Electron peer lands
// (blocked on PR19/PR20 socket activation).
//
// Skips cleanly when the relay is unreachable. Prints pubkeys, event
// IDs, and channel IDs only — never nsec material, auth headers, or
// secure-storage contents.
import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:http/http.dart' as http;
import 'package:nostr/nostr.dart' as nostr;
import 'package:buzz/features/age_gate/age_signal_provider.dart';
import 'package:buzz/shared/auth/auth_provider.dart';
import 'package:buzz/shared/relay/nostr_models.dart';
import 'package:buzz/shared/relay/relay.dart';
import 'package:buzz/shared/relay/relay_session.dart';
import 'package:buzz/shared/relay/signed_event_relay.dart';

const _relayHttp = String.fromEnvironment(
  'INTEROP_RELAY_HTTP',
  defaultValue: 'http://localhost:3000',
);

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
  final List<Future<void> Function()> _cleanupCallbacks = [];
  ProviderSubscription<SessionState>? _sessionListener;

  RelaySessionNotifier get session => container.read(relaySessionProvider);

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
      await cleanup();
    }
    _cleanupCallbacks.clear();
    await _sessionListener?.close();
    container.dispose();
  }
}

Future<String> _createChannel(http.Client httpClient, String nsec) async {
  final privHex = nostr.Nip19.decode(payload: nsec).data;
  final channelId = 'interop-${DateTime.now().millisecondsSinceEpoch}';
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
  group(
    'live relay interop (disposable relay)',
    () {
      late http.Client httpClient;
      late _LivePeer mobile;
      late _LivePeer oracle;
      late String channelId;

      setUpAll(() async {
        httpClient = http.Client();
        try {
          await httpClient
              .get(Uri.parse(_relayHttp))
              .timeout(const Duration(seconds: 5));
        } catch (_) {
          markTestSkipped('disposable relay unreachable at $_relayHttp');
          return;
        }
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
      });

      tearDownAll(() async {
        await mobile.dispose();
        await oracle.dispose();
        httpClient.close();
      });

      test('bidirectional channel message and thread reply', () async {
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
      });

      test('fresh session catches up history exactly once', () async {
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
        expect(matches.single.content, sent.content);
      });

      test('reconnect replays missed message exactly once', () async {
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
      });

      test('restart retains identity and resubscribes', () async {
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
      });

      test('foreign channel events stay isolated', () async {
        final foreign = await oracle.publishMessage(
          channelId: 'foreign-${DateTime.now().millisecondsSinceEpoch}',
          content: 'not for the matrix',
        );
        await Future<void>.delayed(const Duration(seconds: 3));
        expect(
          mobile.inbox.any((event) => event.id == foreign.id),
          isFalse,
          reason: 'matrix subscription must not see other channels',
        );
      });
    },
    timeout: const Timeout(Duration(minutes: 8)),
  );
}
