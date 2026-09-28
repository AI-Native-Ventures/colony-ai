import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../relay/relay.dart';

/// In-memory presence updates for identities already tracked by visible UI.
///
/// Presence comes only from real kind:20001 relay events. There is no REST
/// backstop, so an identity without a recent live event remains unmarked.
class PresenceCacheNotifier extends Notifier<Map<String, String>> {
  final Set<String> _tracked = {};
  void Function()? _presenceUnsub;
  int _subscriptionVersion = 0;

  @override
  Map<String, String> build() {
    final sessionState = ref.watch(relaySessionProvider);

    ref.onDispose(() {
      _presenceUnsub?.call();
      _presenceUnsub = null;
    });

    if (sessionState.status == SessionStatus.connected) {
      _subscribePresenceUpdates();
    }

    return {};
  }

  /// Track identities so the bounded cache ignores unrelated presence events.
  void track(List<String> pubkeys) {
    _tracked.addAll(pubkeys.map((pubkey) => pubkey.toLowerCase()));
  }

  Future<void> _subscribePresenceUpdates() async {
    _presenceUnsub?.call();
    _presenceUnsub = null;
    _subscriptionVersion++;
    final version = _subscriptionVersion;

    final session = ref.read(relaySessionProvider.notifier);
    try {
      final unsub = await session.subscribe(
        const NostrFilter(kinds: [EventKind.presenceUpdate], limit: 0),
        _handlePresenceEvent,
      );
      if (version != _subscriptionVersion) {
        unsub();
        return;
      }
      _presenceUnsub = unsub;
    } catch (error) {
      debugPrint(
        '[PresenceCacheNotifier] presence subscription failed: $error',
      );
    }
  }

  void _handlePresenceEvent(NostrEvent event) {
    final pubkey = event.pubkey.toLowerCase();
    if (!_tracked.contains(pubkey)) return;
    final status = event.content;
    if (status != 'online' && status != 'away' && status != 'offline') return;
    if (state[pubkey] == status) return;
    final updated = Map<String, String>.from(state)..[pubkey] = status;
    state = updated;
  }
}

final presenceCacheProvider =
    NotifierProvider<PresenceCacheNotifier, Map<String, String>>(
      PresenceCacheNotifier.new,
    );
