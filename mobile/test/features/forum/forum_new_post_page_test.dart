import 'dart:async';
import 'dart:typed_data';

import 'package:buzz/features/channels/compose_bar.dart';
import 'package:buzz/features/channels/message_content.dart';
import 'package:buzz/features/forum/forum_new_post_page.dart';
import 'package:buzz/features/forum/forum_presentation.dart';
import 'package:buzz/features/forum/forum_published_note_page.dart';
import 'package:buzz/features/profile/profile_provider.dart';
import 'package:buzz/shared/profile/user_cache_provider.dart';
import 'package:buzz/shared/profile/user_profile.dart';
import 'package:buzz/shared/relay/relay.dart';
import 'package:buzz/shared/theme/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:nostr/nostr.dart' as nostr;
import 'package:shared_preferences/shared_preferences.dart';

const _channelId = 'forum-channel';
const _channelName = 'Team updates';
const _secretHex =
    '0000000000000000000000000000000000000000000000000000000000000001';

final _testNsec = nostr.Nip19.encode(
  prefix: nostr.Nip19Prefix.nsec,
  data: _secretHex,
);

void main() {
  late SharedPreferences prefs;

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    prefs = await SharedPreferences.getInstance();
  });

  testWidgets('requires a non-whitespace title and allows an empty body', (
    tester,
  ) async {
    _setSize(tester, const Size(390, 844));
    await tester.pumpWidget(_buildHarness(prefs: prefs));
    await _openComposer(tester);

    expect(find.byIcon(LucideIcons.chevronLeft), findsOneWidget);
    expect(find.byIcon(LucideIcons.arrowLeft), findsNothing);

    FilledButton postButton() =>
        tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Post'));

    expect(postButton().onPressed, isNull);
    await tester.enterText(
      find.byKey(const ValueKey('forum-post-title')),
      '   ',
    );
    await tester.pump();
    expect(postButton().onPressed, isNull);

    await tester.enterText(
      find.byKey(const ValueKey('forum-post-title')),
      'Weekly plan',
    );
    await tester.pump();
    expect(postButton().onPressed, isNotNull);
    expect(find.byKey(const ValueKey('forum-post-body')), findsOneWidget);
  });

  testWidgets('keeps edits while confirming discard and discards on request', (
    tester,
  ) async {
    _setSize(tester, const Size(390, 844));
    await tester.pumpWidget(_buildHarness(prefs: prefs));
    await _openComposer(tester);
    await tester.enterText(
      find.byKey(const ValueKey('forum-post-title')),
      'Quarterly update',
    );
    await tester.enterText(
      find.byKey(const ValueKey('forum-post-body')),
      'The launch is on track.',
    );
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();

    expect(find.text('Discard this post?'), findsOneWidget);
    await tester.tap(find.text('Keep editing'));
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<TextField>(find.byKey(const ValueKey('forum-post-title')))
          .controller!
          .text,
      'Quarterly update',
    );
    expect(
      tester
          .widget<TextField>(find.byKey(const ValueKey('forum-post-body')))
          .controller!
          .text,
      'The launch is on track.',
    );

    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Discard post'));
    await tester.pumpAndSettle();
    expect(find.text('Open new post'), findsOneWidget);
    expect(find.text('Discard this post?'), findsNothing);
  });

  testWidgets('shows attachments and removes them before delivery', (
    tester,
  ) async {
    _setSize(tester, const Size(390, 844));
    final attachment = XFile.fromData(
      Uint8List.fromList([1, 2, 3, 4]),
      path: '/test/October campaign brief.pdf',
    );
    var didPickAttachment = false;
    var selectedAttachmentCount = 0;
    final uploads = MediaUploadService(
      baseUrl: 'https://media.example',
      nsec: _testNsec,
      pickGalleryImage: () async => null,
      pickGalleryVideo: () async => null,
      pickAttachmentFile: () async {
        didPickAttachment = true;
        return attachment;
      },
    );
    await tester.pumpWidget(
      _buildHarness(
        prefs: prefs,
        mediaUploadService: uploads,
        onAttachmentCountChanged: (count) => selectedAttachmentCount = count,
      ),
    );
    await _openComposer(tester);
    await tester.tap(find.text('Add attachments'));
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pump();
    await tester.tap(find.text('Files'));
    await tester.pump();

    expect(didPickAttachment, isTrue);
    expect(selectedAttachmentCount, 1);
    expect(find.text('October campaign brief.pdf'), findsOneWidget);
    final removeButtonFinder = find.ancestor(
      of: find.byTooltip('Remove attachment'),
      matching: find.byType(IconButton),
    );
    final removeButton = tester.widget<IconButton>(removeButtonFinder);
    expect(removeButton.onPressed, isNotNull);
    await tester.tap(removeButtonFinder);
    await tester.pump();
    expect(find.text('October campaign brief.pdf'), findsNothing);
  });

  testWidgets(
    'preserves a failed draft and retry publishes identical content',
    (tester) async {
      _setSize(tester, const Size(390, 844));
      final relay = _ForumTestRelay()..failNextPublish = true;
      await tester.pumpWidget(_buildHarness(prefs: prefs, relay: relay));
      await _openComposer(tester);
      await tester.enterText(
        find.byKey(const ValueKey('forum-post-title')),
        'Quarterly update',
      );
      await tester.enterText(
        find.byKey(const ValueKey('forum-post-body')),
        'The launch is on track.',
      );
      await tester.tap(find.widgetWithText(FilledButton, 'Post'));
      await tester.pumpAndSettle();

      expect(find.text('Your post wasn’t sent.'), findsOneWidget);
      expect(
        tester
            .widget<TextField>(find.byKey(const ValueKey('forum-post-title')))
            .controller!
            .text,
        'Quarterly update',
      );
      expect(
        tester
            .widget<TextField>(find.byKey(const ValueKey('forum-post-body')))
            .controller!
            .text,
        'The launch is on track.',
      );
      expect(find.text('Retry post'), findsOneWidget);

      await tester.tap(find.widgetWithText(FilledButton, 'Retry post'));
      await tester.pumpAndSettle();
      expect(find.byType(ForumPublishedNotePage), findsOneWidget);
      expect(find.byType(ForumNewPostPage), findsNothing);
      expect(find.text('Quarterly update'), findsOneWidget);
      expect(find.text('Back to Team updates'), findsOneWidget);
      expect(relay.published, hasLength(1));
      expect(
        relay.published.single.content,
        'Quarterly update\n\nThe launch is on track.',
      );
      final channelTag = relay.published.single.tags.singleWhere(
        (tag) => tag.firstOrNull == 'h',
      );
      expect(channelTag, ['h', _channelId]);
    },
  );

  testWidgets(
    'announces posting and disables the form until delivery resolves',
    (tester) async {
      _setSize(tester, const Size(390, 844));
      final relay = _ForumTestRelay();
      final started = Completer<NostrEvent>();
      final result = Completer<NostrEvent>();
      relay.publishStarted = started;
      relay.publishResult = result;
      await tester.pumpWidget(_buildHarness(prefs: prefs, relay: relay));
      await _openComposer(tester);
      await tester.enterText(
        find.byKey(const ValueKey('forum-post-title')),
        'Launch update',
      );
      await tester.enterText(
        find.byKey(const ValueKey('forum-post-body')),
        'The release checklist is ready.',
      );
      await tester.tap(find.widgetWithText(FilledButton, 'Post'));
      await tester.pump();
      await tester.pump();
      expect(started.isCompleted, isTrue);
      final event = await started.future;
      await tester.pump();

      expect(find.text('Posting to $_channelName…'), findsOneWidget);
      expect(find.text('Posting…'), findsOneWidget);
      expect(
        tester
            .widget<TextField>(find.byKey(const ValueKey('forum-post-title')))
            .enabled,
        isFalse,
      );
      expect(
        tester
            .widget<TextField>(find.byKey(const ValueKey('forum-post-body')))
            .controller!
            .text,
        'The release checklist is ready.',
      );
      result.complete(event);
      await tester.pumpAndSettle();
      expect(find.byType(ForumPublishedNotePage), findsOneWidget);
    },
  );
}

void _setSize(WidgetTester tester, Size size) {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = size;
}

Future<void> _openComposer(WidgetTester tester) async {
  await tester.tap(find.text('Open new post'));
  await tester.pumpAndSettle();
  expect(find.byType(ForumNewPostPage), findsOneWidget);
}

Widget _buildHarness({
  required SharedPreferences prefs,
  _ForumTestRelay? relay,
  MediaUploadService? mediaUploadService,
  ValueChanged<int>? onAttachmentCountChanged,
}) {
  final session = relay ?? _ForumTestRelay();
  return ProviderScope(
    overrides: [
      relayConfigProvider.overrideWith(_ForumTestConfig.new),
      relaySessionProvider.overrideWith(() => session),
      savedPrefsProvider.overrideWithValue(prefs),
      relayClientProvider.overrideWithValue(
        RelayClient(baseUrl: 'http://localhost:3000'),
      ),
      userCacheProvider.overrideWith(() => _ForumTestUserCache()),
      profileProvider.overrideWith(_ForumTestProfile.new),
      if (mediaUploadService != null)
        mediaUploadServiceProvider.overrideWithValue(mediaUploadService),
    ],
    child: MaterialApp(
      theme: AppTheme.light(),
      home: Builder(
        builder: (context) => Scaffold(
          body: Center(
            child: TextButton(
              onPressed: () => Navigator.of(context).push<void>(
                MaterialPageRoute<void>(
                  builder: (_) => ForumNewPostPage(
                    channelId: _channelId,
                    channelName: _channelName,
                    memberCount: 8,
                    presentation: _testPresentation(
                      onAttachmentCountListener: onAttachmentCountChanged,
                    ),
                  ),
                ),
              ),
              child: const Text('Open new post'),
            ),
          ),
        ),
      ),
    ),
  );
}

ForumPresentationFactories _testPresentation({
  ValueChanged<int>? onAttachmentCountListener,
}) => ForumPresentationFactories(
  composeBarBuilder:
      ({
        required channelId,
        required channelName,
        required hintText,
        required onSend,
        draftKeyOverride,
        postEditorMode = false,
        allowEmptySend = false,
        enabled = true,
        submitController,
        onBodyChanged,
        onAttachmentCountChanged,
        onSubmissionChanged,
        onFailure,
      }) => ComposeBar(
        channelId: channelId,
        channelName: channelName,
        hintText: hintText,
        onSend: onSend,
        draftKeyOverride: draftKeyOverride,
        postEditorMode: postEditorMode,
        allowEmptySend: allowEmptySend,
        enabled: enabled,
        submitController: submitController,
        onBodyChanged: onBodyChanged,
        onAttachmentCountChanged: (count) =>
            onAttachmentCountListener?.call(count),
        onSubmissionChanged: onSubmissionChanged,
        onFailure: onFailure,
      ),
  messageContentBuilder: (context, content) => MessageContent(
    content: content.content,
    mentionNames: content.mentionNames,
    agentMentionPubkeys: content.agentMentionPubkeys,
    tags: content.tags,
    baseStyle: content.baseStyle,
    maxLines: content.maxLines,
    onMentionTap: content.onMentionTap,
  ),
  openProfile: (context, pubkey) {},
  currentUserName: (_) => 'Lerato Molefe',
);

class _ForumTestConfig extends RelayConfigNotifier {
  @override
  RelayConfig build() =>
      RelayConfig(baseUrl: 'http://localhost:3000', nsec: _testNsec);
}

class _ForumTestRelay extends RelaySessionNotifier {
  final published = <NostrEvent>[];
  bool failNextPublish = false;
  Completer<NostrEvent>? publishStarted;
  Completer<NostrEvent>? publishResult;

  @override
  SessionState build() => const SessionState(status: SessionStatus.connected);

  @override
  Future<NostrEvent> publish(
    NostrEvent event, {
    Duration timeout = const Duration(seconds: 8),
  }) async {
    if (publishStarted case final started?) {
      publishStarted = null;
      started.complete(event);
      final result = publishResult!;
      final acknowledged = await result.future;
      published.add(event);
      return acknowledged;
    }
    if (failNextPublish) {
      failNextPublish = false;
      throw StateError('Relay connection unavailable');
    }
    published.add(event);
    return event;
  }

  @override
  Future<List<NostrEvent>> fetchHistory(
    NostrFilter filter, {
    Duration timeout = const Duration(seconds: 8),
  }) async {
    final ids = filter.ids;
    if (ids == null) return const [];
    return [
      for (final event in published)
        if (ids.contains(event.id)) event,
    ];
  }

  @override
  Future<List<NostrEvent>> queryRelay(
    List<NostrFilter> filters, {
    Duration timeout = const Duration(seconds: 8),
  }) async => published;
}

class _ForumTestUserCache extends UserCacheNotifier {
  @override
  Map<String, UserProfile> build() => const {};
}

class _ForumTestProfile extends ProfileNotifier {
  @override
  Future<UserProfile?> build() async =>
      const UserProfile(pubkey: 'self', displayName: 'Self');
}
