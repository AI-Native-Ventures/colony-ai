import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../shared/relay/relay.dart';
import '../../shared/theme/theme_provider.dart';

const _teamUpdateDraftsKey = 'team_update_draft_v1';

enum TeamUpdateDraftStatus { draft, failed, published }

@immutable
class TeamUpdateDraft {
  const TeamUpdateDraft({
    required this.title,
    required this.body,
    required this.status,
    required this.updatedAt,
  });

  final String title;
  final String body;
  final TeamUpdateDraftStatus status;
  final int updatedAt;

  Map<String, Object?> toJson() => {
    'title': title,
    'body': body,
    'status': status.name,
    'updated_at': updatedAt,
  };

  static TeamUpdateDraft? fromJson(Object? raw) {
    if (raw is! Map<String, dynamic>) return null;
    final title = raw['title'];
    final body = raw['body'];
    final statusName = raw['status'];
    if (title is! String || body is! String || statusName is! String) {
      return null;
    }
    final status = TeamUpdateDraftStatus.values
        .where((candidate) => candidate.name == statusName)
        .firstOrNull;
    if (status == null || (title.trim().isEmpty && body.trim().isEmpty)) {
      return null;
    }
    return TeamUpdateDraft(
      title: title,
      body: body,
      status: status,
      updatedAt: raw['updated_at'] is int ? raw['updated_at'] as int : 0,
    );
  }
}

class TeamUpdateDraftNotifier extends Notifier<TeamUpdateDraft?> {
  late String _storageKey;
  Future<void> _mutationTail = Future<void>.value();

  @override
  TeamUpdateDraft? build() {
    final config = ref.watch(relayConfigProvider);
    final pubkey = ref.watch(myPubkeyProvider) ?? 'anon';
    _storageKey = '$_teamUpdateDraftsKey:${config.baseUrl}:$pubkey';
    final raw = ref.read(savedPrefsProvider).getString(_storageKey);
    if (raw == null) return null;
    try {
      return TeamUpdateDraft.fromJson(jsonDecode(raw));
    } on FormatException {
      return null;
    }
  }

  Future<void> save({required String title, required String body}) =>
      _serialize(
        () => _writeNow(
          title: title,
          body: body,
          status: TeamUpdateDraftStatus.draft,
        ),
      );

  Future<void> markFailed({required String title, required String body}) =>
      _serialize(
        () => _writeNow(
          title: title,
          body: body,
          status: TeamUpdateDraftStatus.failed,
        ),
      );

  Future<void> markPublished({required String title, required String body}) =>
      _serialize(() async {
        await _writeNow(
          title: title,
          body: body,
          status: TeamUpdateDraftStatus.published,
          updateStateBeforePersist: true,
        );
      });

  Future<void> clear() => _serialize(_clearNow);

  Future<void> _clearNow() async {
    final key = _storageKey;
    final prefs = ref.read(savedPrefsProvider);
    final removed = await prefs.remove(key);
    if (!removed) throw StateError('Could not remove the saved update.');
    if (ref.mounted && _storageKey == key) state = null;
  }

  Future<void> _writeNow({
    required String title,
    required String body,
    required TeamUpdateDraftStatus status,
    bool updateStateBeforePersist = false,
  }) async {
    if (title.trim().isEmpty && body.trim().isEmpty) {
      await _clearNow();
      return;
    }
    final key = _storageKey;
    final draft = TeamUpdateDraft(
      title: title,
      body: body,
      status: status,
      updatedAt: DateTime.now().millisecondsSinceEpoch ~/ 1000,
    );
    final prefs = ref.read(savedPrefsProvider);
    if (updateStateBeforePersist && ref.mounted && _storageKey == key) {
      state = draft;
    }
    final written = await prefs.setString(key, jsonEncode(draft.toJson()));
    if (!written) throw StateError('Could not save the update on this phone.');
    if (ref.mounted && _storageKey == key) state = draft;
  }

  Future<T> _serialize<T>(Future<T> Function() operation) {
    final result = _mutationTail.then((_) => operation());
    _mutationTail = result.then<void>(
      (_) {},
      onError: (Object _, StackTrace _) {},
    );
    return result;
  }
}

final teamUpdateDraftProvider =
    NotifierProvider<TeamUpdateDraftNotifier, TeamUpdateDraft?>(
      TeamUpdateDraftNotifier.new,
    );
