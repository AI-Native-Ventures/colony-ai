import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:http/http.dart' as http;

import '../../relay/relay.dart';
import 'goal_records.dart';

typedef GoalRelaySelfFetcher = Future<String?> Function(String baseUrl);

final goalRecordHttpClientProvider = Provider<http.Client>((ref) {
  final client = http.Client();
  ref.onDispose(client.close);
  return client;
});

final goalRelaySelfFetcherProvider = Provider<GoalRelaySelfFetcher>(
  (ref) =>
      (baseUrl) => fetchGoalRelaySelf(
        baseUrl,
        client: ref.read(goalRecordHttpClientProvider),
      ),
);

final goalRelaySelfProvider = FutureProvider.autoDispose<String?>((ref) async {
  final relayUrl = ref.watch(relayConfigProvider).baseUrl;
  return ref.watch(goalRelaySelfFetcherProvider)(relayUrl);
});

Future<String?> fetchGoalRelaySelf(
  String baseUrl, {
  required http.Client client,
}) async {
  final origin = Uri.tryParse(baseUrl);
  if (origin == null ||
      !const {'http', 'https'}.contains(origin.scheme) ||
      origin.host.isEmpty) {
    throw const FormatException('The active relay URL is invalid.');
  }
  final response = await client
      .get(
        origin.replace(path: '/', query: null, fragment: null),
        headers: const {'Accept': 'application/nostr+json'},
      )
      .timeout(const Duration(seconds: 8));
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw StateError(
      'Relay identity request failed with HTTP ${response.statusCode}.',
    );
  }
  final document = jsonDecode(response.body);
  if (document is! Map<String, dynamic>) {
    throw const FormatException('Relay information must be a JSON object.');
  }
  final self = document['self'];
  if (self == null) return null;
  if (self is! String ||
      !RegExp(r'^[0-9a-f]{64}$', caseSensitive: false).hasMatch(self)) {
    throw const FormatException('Relay signing identity is invalid.');
  }
  return self.toLowerCase();
}

abstract interface class GoalRecordGateway {
  Future<List<NostrEvent>> fetch(NostrFilter filter);

  Future<NostrEvent> publish({
    required int kind,
    required String content,
    required List<List<String>> tags,
  });
}

class RelayGoalRecordGateway implements GoalRecordGateway {
  const RelayGoalRecordGateway({required this.session, required this.nsec});

  final RelaySessionNotifier session;
  final String? nsec;

  @override
  Future<List<NostrEvent>> fetch(NostrFilter filter) =>
      session.fetchHistory(filter, timeout: const Duration(seconds: 8));

  @override
  Future<NostrEvent> publish({
    required int kind,
    required String content,
    required List<List<String>> tags,
  }) => SignedEventRelay(
    session: session,
    nsec: nsec,
  ).submit(kind: kind, content: content, tags: tags);
}

final goalRecordGatewayProvider = Provider<GoalRecordGateway>((ref) {
  return RelayGoalRecordGateway(
    session: ref.read(relaySessionProvider.notifier),
    nsec: ref.watch(relayConfigProvider).nsec,
  );
});

final goalRepositoryProvider = Provider<GoalRepository>(
  (ref) => GoalRepository(ref.watch(goalRecordGatewayProvider)),
);

class GoalRepository {
  const GoalRepository(this.gateway);

  final GoalRecordGateway gateway;

  Future<List<GoalHeadRecord>> loadHeads({required String? relaySelf}) async {
    if (relaySelf == null ||
        !RegExp(r'^[0-9a-f]{64}$', caseSensitive: false).hasMatch(relaySelf)) {
      throw StateError('This relay does not advertise a signing identity.');
    }
    final events = await gateway.fetch(
      NostrFilter(
        kinds: const [EventKind.goalHead],
        authors: [relaySelf.toLowerCase()],
        limit: goalHeadQueryLimit,
      ),
    );
    if (events.length >= goalHeadQueryLimit) {
      throw StateError(
        'The company goal list exceeds the supported read limit.',
      );
    }
    final heads = <GoalHeadRecord>[];
    for (final event in events) {
      final parsed = parseGoalHeadEvent(event, relaySelf);
      if (parsed == null) {
        throw const FormatException(
          'The relay returned an invalid signed company goal.',
        );
      }
      heads.add(parsed);
    }
    return sortGoalHeads(heads);
  }

  Future<List<GoalActionRecord>> loadHistory(String goalId) async {
    final dTag = goalDTag(goalId);
    final events = await gateway.fetch(
      NostrFilter(
        kinds: const [EventKind.goalAction],
        tags: {
          '#d': [dTag],
        },
        limit: goalHistoryQueryLimit,
      ),
    );
    if (events.length >= goalHistoryQueryLimit) {
      throw StateError(
        'The company goal history exceeds the supported read limit.',
      );
    }
    final actions = <GoalActionRecord>[];
    for (final event in events) {
      final parsed = parseGoalActionEvent(event, dTag);
      if (parsed == null) {
        throw const FormatException(
          'The relay returned an invalid company goal action.',
        );
      }
      actions.add(parsed);
    }
    actions.sort((left, right) {
      final order = right.event.createdAt.compareTo(left.event.createdAt);
      return order != 0 ? order : right.event.id.compareTo(left.event.id);
    });
    return actions;
  }

  Future<NostrEvent> submit(GoalAction action) {
    final dTag = goalDTag(action.goalId);
    return gateway.publish(
      kind: EventKind.goalAction,
      content: jsonEncode(action.toJson()),
      tags: [
        ['d', dTag],
      ],
    );
  }
}

final goalHeadsProvider = FutureProvider.autoDispose<List<GoalHeadRecord>>((
  ref,
) async {
  ref.watch(relayConfigProvider);
  final relaySelf = await ref.watch(goalRelaySelfProvider.future);
  return ref.watch(goalRepositoryProvider).loadHeads(relaySelf: relaySelf);
});

final goalHeadProvider = Provider.autoDispose
    .family<AsyncValue<GoalHeadRecord?>, String>((ref, goalId) {
      return ref
          .watch(goalHeadsProvider)
          .whenData(
            (records) => records
                .where((record) => record.head.goalId == goalId.toLowerCase())
                .firstOrNull,
          );
    });

final goalHistoryProvider = FutureProvider.autoDispose
    .family<List<GoalActionRecord>, String>((ref, goalId) async {
      ref.watch(relayConfigProvider);
      return ref.watch(goalRepositoryProvider).loadHistory(goalId);
    });

@visibleForTesting
Future<List<GoalHeadRecord>> loadVerifiedGoalHeads(
  GoalRecordGateway gateway, {
  required String? relaySelf,
}) => GoalRepository(gateway).loadHeads(relaySelf: relaySelf);
