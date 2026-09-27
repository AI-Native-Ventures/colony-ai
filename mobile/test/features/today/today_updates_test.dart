import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show FontLoader, rootBundle;
import 'package:flutter_test/flutter_test.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:hooks_riverpod/misc.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:buzz/app.dart' show buildTeamUpdateNoteRoute;
import 'package:buzz/features/activity/activity_home_page.dart';
import 'package:buzz/features/activity/activity_provider.dart';
import 'package:buzz/features/activity/feed_item.dart';
import 'package:buzz/features/activity/inbox_item.dart';
import 'package:buzz/features/home/home_page.dart';
import 'package:buzz/features/profile/profile_provider.dart';
import 'package:buzz/features/pulse/pulse_models.dart';
import 'package:buzz/features/pulse/pulse_provider.dart';
import 'package:buzz/features/pulse/team_update_compose_page.dart';
import 'package:buzz/features/pulse/team_update_drafts_provider.dart';
import 'package:buzz/features/pulse/team_update_note_page.dart';
import 'package:buzz/features/pulse/team_updates_page.dart';
import 'package:buzz/features/today/today_models.dart';
import 'package:buzz/features/today/today_page.dart';
import 'package:buzz/shared/community/community.dart';
import 'package:buzz/shared/community/community_provider.dart';
import 'package:buzz/shared/navigation/mobile_navigation.dart';
import 'package:buzz/shared/navigation/mobile_route.dart';
import 'package:buzz/shared/navigation/mobile_routes.dart';
import 'package:buzz/shared/profile/user_cache_provider.dart';
import 'package:buzz/shared/profile/user_profile.dart';
import 'package:buzz/shared/identity/identity_components.dart';
import 'package:buzz/shared/identity/presence_cache_provider.dart';
import 'package:buzz/shared/relay/relay.dart';
import 'package:buzz/shared/theme/theme.dart';

const _mayaKey = 'maya-proof-pubkey';
const _leratoKey = 'lerato-proof-pubkey';
const _proofRelay = 'https://relay.example';
final _community = Community(
  id: 'today-proof-community',
  name: 'Lerato Social',
  relayUrl: _proofRelay,
  addedAt: DateTime.utc(2026, 9, 24),
);
final _lerato = UserProfile(pubkey: _leratoKey, displayName: 'Lerato Molefe');
final _maya = UserProfile(pubkey: _mayaKey, displayName: 'Maya Ndlovu');
final _scout = UserProfile(pubkey: 'scout-proof-pubkey', displayName: 'Scout');
final _users = {_leratoKey: _lerato, _mayaKey: _maya, _scout.pubkey: _scout};

final _review = FeedItem(
  id: 'review-september-journal',
  kind: 46010,
  pubkey: _mayaKey,
  content: 'September journal',
  createdAt: DateTime(2026, 9, 24, 10, 38).millisecondsSinceEpoch ~/ 1000,
  channelId: 'olive-studio',
  channelName: 'Olive Studio',
  tags: const [],
  category: 'needs_action',
);
final _replyActivity = FeedItem(
  id: 'reply-to-lerato',
  kind: 9,
  pubkey: _mayaKey,
  content: '“A moment for you” could work.',
  createdAt: DateTime(2026, 9, 24, 10, 42).millisecondsSinceEpoch ~/ 1000,
  channelId: 'olive-studio',
  channelName: 'Olive Studio',
  tags: const [
    ['e', 'root-note', '', 'root'],
    ['e', 'root-note', '', 'reply'],
  ],
  category: 'activity',
);
final _researchActivity = FeedItem(
  id: 'research-completed',
  kind: 43004,
  pubkey: _scout.pubkey,
  content: 'Olive Studio prospects',
  createdAt: DateTime(2026, 9, 24, 9, 48).millisecondsSinceEpoch ~/ 1000,
  channelId: 'olive-studio',
  channelName: 'Olive Studio',
  tags: const [],
  category: 'agent_activity',
);
final _feed = HomeFeedResponse(
  mentions: const [],
  needsAction: [_review],
  activity: [_replyActivity],
  agentActivity: [_researchActivity],
);
final _rootNote = UserNote(
  id: 'team-update-note',
  pubkey: _mayaKey,
  createdAt: DateTime(2026, 9, 24, 10, 20).millisecondsSinceEpoch ~/ 1000,
  content:
      'A little focus.\nA strong finish.\n\n'
      'Three things for the team this week.\n\n'
      '01 / Olive Studio\n'
      'The September carousel is ready. Lerato, we need your review before '
      'Maya schedules Friday’s post.\n\n'
      '02 / Cedar launch\n'
      'Scout is gathering the research. We’ll shape the brief together on '
      'Thursday.\n\n'
      '03 / Client reports\n'
      'Keep the story clear: what worked, what we learned, and what we’ll '
      'change.',
  tags: const [],
);
final _feedNote = UserNote(
  id: 'team-update-feed-note',
  pubkey: _mayaKey,
  createdAt: DateTime(2026, 9, 24, 10, 20).millisecondsSinceEpoch ~/ 1000,
  content:
      'A little focus.\nA strong finish.\n\n'
      'Olive Studio, Cedar’s launch and the client reports. Three things that '
      'matter this week.',
  tags: const [],
);
final _replyNotes = [
  UserNote(
    id: 'reply-one',
    pubkey: _leratoKey,
    createdAt: DateTime(2026, 9, 24, 10, 45).millisecondsSinceEpoch ~/ 1000,
    content: 'Thanks Maya. I’m reviewing Olive Studio now.',
    tags: const [
      ['e', 'team-update-note', '', 'reply'],
      ['p', _mayaKey],
    ],
  ),
  UserNote(
    id: 'reply-two',
    pubkey: _mayaKey,
    createdAt: DateTime(2026, 9, 24, 10, 48).millisecondsSinceEpoch ~/ 1000,
    content: 'Thank you, Lerato.',
    tags: const [
      ['e', 'team-update-note', '', 'reply'],
      ['p', _leratoKey],
    ],
  ),
  UserNote(
    id: 'reply-three',
    pubkey: _scout.pubkey,
    createdAt: DateTime(2026, 9, 24, 10, 50).millisecondsSinceEpoch ~/ 1000,
    content: 'Research notes are ready for review.',
    tags: const [
      ['e', 'team-update-note', '', 'reply'],
      ['p', _mayaKey],
    ],
  ),
];
final _notes = [_rootNote, ..._replyNotes];

void main() {
  const captureScreenshots = bool.fromEnvironment('CAPTURE_W23_TODAY_SHOTS');
  final output = Directory('/tmp/w23-mobile-today-proof')
    ..createSync(recursive: true);
  if (captureScreenshots) {
    setUpAll(() async {
      final serifBytes = await File(
        '/System/Library/Fonts/Supplemental/Georgia.ttf',
      ).readAsBytes();
      final georgia = FontLoader('Georgia')
        ..addFont(Future.value(ByteData.sublistView(serifBytes)));
      await georgia.load();
      final manrope = FontLoader('Manrope')
        ..addFont(rootBundle.load('assets/fonts/Manrope-Variable.ttf'));
      await manrope.load();
      final materialIcons = FontLoader('MaterialIcons')
        ..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
      await materialIcons.load();
      final lucideIcons = FontLoader('packages/lucide_icons_flutter/Lucide')
        ..addFont(
          rootBundle.load('packages/lucide_icons_flutter/assets/lucide.ttf'),
        );
      await lucideIcons.load();
    });
  }

  testWidgets('Today opens Activity from its shortcut inside the shell', (
    tester,
  ) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: _providerOverrides(),
        child: _proofApp(_visualHome(_VisualRoute.today)),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('mobile-brand-bar')), findsNothing);
    expect(find.text('Today'), findsWidgets);
    expect(
      find.byKey(const ValueKey('mobile-bottom-navigation')),
      findsOneWidget,
    );

    await tester.tap(find.text('Activity'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('mobile-brand-bar')), findsNothing);
    expect(find.text('The company, moving together'), findsOneWidget);
    expect(find.text('Updates'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('activity-back-to-today')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('mobile-bottom-navigation')),
      findsOneWidget,
    );

    await tester.tap(find.byKey(const ValueKey('activity-back-to-today')));
    await tester.pumpAndSettle();
    expect(
      find.text('Morning, Lerato.\nLet’s make it happen.'),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('mobile-bottom-navigation')),
      findsOneWidget,
    );
  });

  testWidgets('Today header has no divider and uses live presence only', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    await tester.pumpWidget(
      ProviderScope(
        overrides: _providerOverrides(prefs),
        child: _proofApp(_visualHome(_VisualRoute.today)),
      ),
    );
    await tester.pumpAndSettle();

    final header = find.byKey(const ValueKey('today-header'));
    final headerDecoration = tester.widget<Container>(header).decoration!;
    expect((headerDecoration as BoxDecoration).border, isNull);
    final avatar = find.descendant(
      of: header,
      matching: find.byType(IdentityAvatar),
    );
    expect(tester.widget<IdentityAvatar>(avatar).isOnline, isFalse);

    await tester.pumpWidget(
      ProviderScope(
        overrides: _providerOverrides(prefs, null, {_leratoKey: 'online'}),
        child: _proofApp(_visualHome(_VisualRoute.today)),
      ),
    );
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<IdentityAvatar>(
            find.descendant(
              of: find.byKey(const ValueKey('today-header')),
              matching: find.byType(IdentityAvatar),
            ),
          )
          .isOnline,
      isTrue,
    );
  });

  testWidgets('Activity plus opens the existing team update composer', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    await tester.pumpWidget(
      ProviderScope(
        overrides: _providerOverrides(prefs),
        child: _proofApp(_visualHome(_VisualRoute.today)),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Activity'));
    await tester.pumpAndSettle();

    final compose = find.byKey(const ValueKey('activity-new-team-update'));
    expect(compose, findsOneWidget);
    await tester.tap(compose);
    await tester.pumpAndSettle();

    expect(find.text('Write an update'), findsOneWidget);
    expect(find.text('Publish update'), findsOneWidget);
  });

  testWidgets('Today opens Team updates from the header action', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    await tester.pumpWidget(
      ProviderScope(
        overrides: _providerOverrides(prefs),
        child: _proofApp(_visualHome(_VisualRoute.today)),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('today-action-Open updates')));
    await tester.pumpAndSettle();

    expect(find.text('From your team.'), findsOneWidget);
    expect(find.text('A little focus.\nA strong finish.'), findsOneWidget);
  });

  testWidgets('Today tabs open live updates and activity rows keep their id', (
    tester,
  ) async {
    FeedItem? opened;
    await tester.pumpWidget(
      ProviderScope(
        overrides: _providerOverrides(),
        child: MaterialApp(
          theme: AppTheme.light(),
          home: Scaffold(
            body: ActivityHomePage(
              updatesPageBuilder: (_, _) => const Text('Team updates stream'),
              onOpenItem: (item) => opened = item,
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Your review is needed'), findsOneWidget);
    await tester.tap(find.text('Your review is needed'));
    expect(opened?.id, _review.id);

    await tester.tap(find.text('Team updates'));
    await tester.pumpAndSettle();
    expect(find.text('Team updates stream'), findsOneWidget);
  });

  testWidgets('Activity orders approvals before newer messages', (
    tester,
  ) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: _providerOverrides(),
        child: _proofApp(_visualHome(_VisualRoute.today)),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Activity'));
    await tester.pumpAndSettle();

    final reviewTop = tester.getTopLeft(find.text('Your review is needed')).dy;
    final replyTop = tester.getTopLeft(find.text('Maya replied to you')).dy;
    final researchTop = tester.getTopLeft(find.text('Research completed')).dy;
    expect(reviewTop, lessThan(replyTop));
    expect(replyTop, lessThan(researchTop));
    expect(find.text('Maya · September journal'), findsOneWidget);
    expect(find.text('Scout · Olive Studio prospects'), findsOneWidget);
    expect(find.text('1'), findsNWidgets(2));
  });

  testWidgets('team note shows its review link and reply composer', (
    tester,
  ) async {
    var reviewOpened = false;
    await tester.pumpWidget(
      ProviderScope(
        overrides: _providerOverrides(),
        child: _proofApp(
          TeamUpdateNotePage(
            noteId: _rootNote.id,
            onReviewCampaign: () => reviewOpened = true,
            now: DateTime(2026, 9, 24),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byIcon(LucideIcons.chevronLeft), findsOneWidget);
    expect(find.byIcon(LucideIcons.arrowLeft), findsNothing);
    expect(
      tester.widget<Icon>(find.byIcon(LucideIcons.ellipsis)).color,
      MobileDesignTokens.light.muted,
    );
    expect(find.text('Review the campaign'), findsOneWidget);
    expect(find.text('Message campaign-studio…'), findsOneWidget);
    expect(
      tester.getTopLeft(find.text('Review the campaign')).dy,
      greaterThan(tester.getTopLeft(find.text('01 / Olive Studio')).dy),
    );
    await tester.tap(find.text('Review the campaign'));
    expect(reviewOpened, isTrue);
  });

  testWidgets('team note hides campaign review when no record is linked', (
    tester,
  ) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: _providerOverrides(),
        child: _proofApp(buildTeamUpdateNoteRoute(_rootNote.id)),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Review the campaign'), findsNothing);
    expect(find.text('Message campaign-studio…'), findsOneWidget);
  });

  testWidgets('updates feed uses its designed draft row label', (tester) async {
    SharedPreferences.setMockInitialValues(_draftPrefs());
    final prefs = await SharedPreferences.getInstance();
    await tester.pumpWidget(
      ProviderScope(
        overrides: _providerOverrides(prefs, [_feedNote]),
        child: _proofApp(Scaffold(body: const TeamUpdatesPage())),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Your unpublished update'), findsOneWidget);
    expect(find.text('A good week ahead'), findsNothing);
    expect(find.text('Write an update'), findsOneWidget);
    expect(
      tester.getTopLeft(find.text('Write an update')).dy,
      greaterThan(tester.getTopLeft(find.text('Your unpublished update')).dy),
    );
  });

  testWidgets('team updates do not show reply events as root updates', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    await tester.pumpWidget(
      ProviderScope(
        overrides: _providerOverrides(prefs, [_feedNote, ..._replyNotes]),
        child: _proofApp(Scaffold(body: const TeamUpdatesPage())),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('A little focus.\nA strong finish.'), findsOneWidget);
    expect(
      find.text('Thanks Maya. I’m reviewing Olive Studio now.'),
      findsNothing,
    );
  });

  testWidgets('Today shows no fabricated review or update rows when empty', (
    tester,
  ) async {
    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          theme: AppTheme.light(),
          home: Scaffold(
            body: TodayPage(
              communityName: _community.name,
              profileName: _lerato.displayName,
              profileInitials: _lerato.initials,
              profileAvatarUrl: _lerato.avatarUrl,
              reviewItems: const AsyncData([]),
              movingItems: const AsyncData([]),
              teamUpdate: const AsyncData(null),
              overviewMetrics: const [],
              onOpenUpdates: (_) {},
              onOpenReview: (_) {},
              onOpenProgress: (_) {},
              onOpenUpdate: (_) {},
              onOpenActivity: (_) {},
              onRetryActivity: _noRetry,
              now: DateTime(2026, 9, 24),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(
      find.text('Morning, Lerato.\nLet’s make it happen.'),
      findsOneWidget,
    );
    expect(find.text('Needs your eye'), findsOneWidget);
    expect(find.text('Moving forward'), findsNothing);
    expect(find.text('September journal'), findsNothing);
    expect(find.text('A little focus. A strong finish.'), findsNothing);
    expect(find.text('agents working'), findsNothing);
    expect(find.text('plans approved'), findsNothing);
  });

  testWidgets('Today opens a progress row by its real activity id', (
    tester,
  ) async {
    String? openedId;
    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          theme: AppTheme.light(),
          home: Scaffold(
            body: TodayPage(
              communityName: _community.name,
              profileName: _lerato.displayName,
              reviewItems: const AsyncData([]),
              movingItems: const AsyncData([
                TodayProgressItem(
                  id: 'job-progress-record',
                  title: 'Progress update',
                  subtitle: 'Scout · Olive Studio prospects',
                  initials: 'S',
                  isAgent: true,
                ),
              ]),
              teamUpdate: const AsyncData(null),
              overviewMetrics: const [],
              onOpenUpdates: (_) {},
              onOpenReview: (_) {},
              onOpenProgress: (id) => openedId = id,
              onOpenUpdate: (_) {},
              onOpenActivity: (_) {},
              onRetryActivity: _noRetry,
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Scout · Olive Studio prospects'));

    expect(openedId, 'job-progress-record');
  });

  testWidgets('Today shows only supplied overview figures and progress rows', (
    tester,
  ) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: _providerOverrides(),
        child: _proofApp(_visualHome(_VisualRoute.today)),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('needs your eye'), findsOneWidget);
    expect(find.text('Moving forward'), findsOneWidget);
    expect(find.text('Research completed'), findsOneWidget);
    expect(find.text('Scout · Olive Studio prospects'), findsOneWidget);
    expect(find.text('agents working'), findsNothing);
    expect(find.text('plans approved'), findsNothing);
    expect(find.text('asks'), findsNothing);
  });

  testWidgets('composer publishes through its relay action and clears draft', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final container = ProviderContainer(overrides: _baseOverrides(prefs));
    addTearDown(container.dispose);
    String? sentContent;
    bool? result;
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp(
          theme: AppTheme.light(),
          home: Builder(
            builder: (context) => Scaffold(
              body: TextButton(
                onPressed: () async {
                  result = await Navigator.of(context).push<bool>(
                    MaterialPageRoute(
                      builder: (_) => TeamUpdateComposePage(
                        onPublish: (content) async => sentContent = content,
                      ),
                    ),
                  );
                },
                child: const Text('Open composer'),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Open composer'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).at(0), 'A useful update');
    await tester.enterText(
      find.byType(TextField).at(1),
      'Next steps are ready.',
    );
    await tester.pump(const Duration(milliseconds: 500));
    await tester.tap(find.text('Publish update'));
    await tester.pumpAndSettle();
    expect(sentContent, 'A useful update\n\nNext steps are ready.');
    expect(result, isTrue);
    expect(container.read(teamUpdateDraftProvider), isNull);
  });

  testWidgets('composer stores a draft before leaving the screen', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final container = ProviderContainer(overrides: _baseOverrides(prefs));
    addTearDown(container.dispose);
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp(
          theme: AppTheme.light(),
          home: Builder(
            builder: (context) => Scaffold(
              body: TextButton(
                onPressed: () => Navigator.of(context).push<void>(
                  MaterialPageRoute(
                    builder: (_) =>
                        TeamUpdateComposePage(onPublish: (_) async {}),
                  ),
                ),
                child: const Text('Open composer'),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Open composer'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).at(0), 'Draft title');
    await tester.enterText(find.byType(TextField).at(1), 'Draft body');
    await tester.tap(find.text('Save draft'));
    await tester.pumpAndSettle();
    final saved = container.read(teamUpdateDraftProvider);
    expect(saved?.title, 'Draft title');
    expect(saved?.body, 'Draft body');
    expect(saved?.status, TeamUpdateDraftStatus.draft);
  });

  testWidgets('fresh composer keeps sample copy as hints, not update data', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    await tester.pumpWidget(
      ProviderScope(
        overrides: _providerOverrides(prefs),
        child: _proofApp(TeamUpdateComposePage(onPublish: (_) async {})),
      ),
    );
    await tester.pumpAndSettle();

    final title = tester.widget<TextField>(find.byType(TextField).at(0));
    final body = tester.widget<TextField>(find.byType(TextField).at(1));
    expect(title.controller?.text, isEmpty);
    expect(body.controller?.text, isEmpty);
    expect(title.decoration?.hintText, 'A good week ahead');
    expect(
      body.decoration?.hintText,
      'Olive Studio is ready for review. Next, we’ll shape the Cedar launch brief and finish our client reports.',
    );
    expect(
      tester
          .widget<FilledButton>(
            find.widgetWithText(FilledButton, 'Publish update'),
          )
          .onPressed,
      isNull,
    );
  });

  for (final size in const [Size(390, 844), Size(412, 915)]) {
    for (final brightness in [Brightness.light, Brightness.dark]) {
      for (final route in _visualRoutes) {
        testWidgets(
          'captures ${route.name} ${brightness.name} ${size.width.toInt()}x${size.height.toInt()}',
          (tester) async {
            final previousComparator = goldenFileComparator;
            SharedPreferences.setMockInitialValues(_draftPrefs());
            final prefs = await SharedPreferences.getInstance();
            if (captureScreenshots) {
              goldenFileComparator = _CaptureFileComparator(
                Uri.file('${output.path}/golden_test.dart'),
                output.path,
              );
              tester.view.viewPadding = const FakeViewPadding(
                top: 46,
                bottom: 20,
              );
              tester.view.padding = const FakeViewPadding(top: 46, bottom: 20);
            }
            addTearDown(() {
              tester.view.resetPhysicalSize();
              tester.view.resetDevicePixelRatio();
              tester.view.viewPadding = FakeViewPadding.zero;
              tester.view.padding = FakeViewPadding.zero;
              goldenFileComparator = previousComparator;
            });
            tester.view.devicePixelRatio = 1;
            tester.view.physicalSize = size;
            final rootKey = GlobalKey();
            final child = switch (route) {
              _VisualRoute.today ||
              _VisualRoute.activity ||
              _VisualRoute.updatesFeed ||
              _VisualRoute.published => _visualHome(route),
              _VisualRoute.note => TeamUpdateNotePage(
                noteId: _rootNote.id,
                onReviewCampaign: _noReview,
                now: DateTime(2026, 9, 24),
              ),
              _VisualRoute.compose => TeamUpdateComposePage(
                onPublish: (_) async {},
              ),
              _VisualRoute.draft => const TeamUpdateComposePage(
                mode: TeamUpdateComposeMode.draft,
                onPublish: _noPublish,
              ),
              _VisualRoute.failed => const TeamUpdateComposePage(
                mode: TeamUpdateComposeMode.failed,
                onPublish: _noPublish,
              ),
            };
            await tester.pumpWidget(
              ProviderScope(
                overrides: _providerOverrides(
                  prefs,
                  route == _VisualRoute.note ? _notes : [_feedNote],
                ),
                child: RepaintBoundary(
                  key: rootKey,
                  child: captureScreenshots
                      ? ClipRRect(
                          borderRadius: BorderRadius.circular(36),
                          child: Directionality(
                            textDirection: TextDirection.ltr,
                            child: Stack(
                              fit: StackFit.expand,
                              children: [
                                _proofApp(child, brightness: brightness),
                                _ProofStatusBar(brightness: brightness),
                                _ProofHomeIndicator(brightness: brightness),
                              ],
                            ),
                          ),
                        )
                      : _proofApp(child, brightness: brightness),
                ),
              ),
            );
            await _pumpVisualFrame(
              tester,
              captureScreenshots: captureScreenshots,
            );
            if (route == _VisualRoute.activity) {
              expect(find.text('Updates'), findsOneWidget);
              expect(find.text('The company, moving together'), findsOneWidget);
              expect(
                find.byKey(const ValueKey('activity-back-to-today')),
                findsOneWidget,
              );
              expect(
                find.byKey(const ValueKey('mobile-bottom-navigation')),
                findsOneWidget,
              );
              expect(find.text('Company'), findsOneWidget);
              debugPrint(
                'VISUAL_LAYOUT activity header=${tester.getRect(find.text('Updates'))} navigation=${tester.getRect(find.byKey(const ValueKey('mobile-bottom-navigation')))} company=${tester.getRect(find.text('Company'))}',
              );
            }
            if (route == _VisualRoute.updatesFeed ||
                route == _VisualRoute.published) {
              await tester.tap(
                find.byKey(const ValueKey('today-action-Open updates')),
              );
              await _pumpVisualFrame(
                tester,
                captureScreenshots: captureScreenshots,
              );
            }

            if (route == _VisualRoute.draft) {
              expect(find.text('Your draft is here'), findsOneWidget);
              expect(
                find.text('Only you can see it until you publish.'),
                findsOneWidget,
              );
            }
            if (route == _VisualRoute.failed) {
              expect(find.text('Update wasn’t published'), findsOneWidget);
              expect(
                find.text('Your draft is safe. Retry when you’re connected.'),
                findsOneWidget,
              );
            }

            if (captureScreenshots) {
              final fileName =
                  '${route.name}-${brightness.name}-'
                  '${size.width.toInt()}x${size.height.toInt()}.png';
              await expectLater(
                find.byKey(rootKey),
                matchesGoldenFile(fileName),
              );
              debugPrint('VISUAL_PROOF ${output.path}/$fileName');
            } else {
              expect(find.byKey(rootKey), findsOneWidget);
            }
          },
        );
      }
    }
  }
}

class _CaptureFileComparator extends LocalFileComparator {
  _CaptureFileComparator(super.testFile, this.outputPath);

  final String outputPath;

  @override
  Future<bool> compare(Uint8List imageBytes, Uri golden) async {
    final file = File('$outputPath/${golden.pathSegments.last}');
    await file.parent.create(recursive: true);
    await file.writeAsBytes(imageBytes);
    return true;
  }
}

Future<void> _pumpVisualFrame(
  WidgetTester tester, {
  required bool captureScreenshots,
}) async {
  if (captureScreenshots) {
    await tester.pump(const Duration(seconds: 1));
  } else {
    await tester.pumpAndSettle();
  }
}

List<Override> _providerOverrides([
  SharedPreferences? prefs,
  List<UserNote>? notes,
  Map<String, String> presenceStatuses = const {},
]) => [
  ..._baseOverrides(prefs),
  activityProvider.overrideWith(() => _ProofActivityNotifier(_feed)),
  inboxItemsProvider.overrideWithValue(buildInboxItems(_feed.all)),
  globalNotesProvider.overrideWith((_) async => notes ?? _notes),
  profileProvider.overrideWith(() => _ProofProfileNotifier(_lerato)),
  userCacheProvider.overrideWith(() => _ProofUserCacheNotifier(_users)),
  presenceCacheProvider.overrideWith(
    () => _ProofPresenceCacheNotifier(presenceStatuses),
  ),
];

List<Override> _baseOverrides(SharedPreferences? prefs) => [
  activeCommunityProvider.overrideWith((_) async => _community),
  myPubkeyProvider.overrideWithValue(_leratoKey),
  relayConfigProvider.overrideWith(_ProofRelayConfigNotifier.new),
  if (prefs != null) savedPrefsProvider.overrideWithValue(prefs),
];

Map<String, Object> _draftPrefs() => {
  'team_update_draft_v1:$_proofRelay:$_leratoKey':
      '{"title":"A good week ahead","body":"Olive Studio is ready for review. Next, we’ll shape the Cedar launch brief and finish our client reports.","status":"draft","updated_at":1790262000}',
};

Widget _visualHome(_VisualRoute route) {
  final routes = MobileRouteRegistry.empty()
      .register(
        MobileRoutes.today,
        (context, routeContext) => route == _VisualRoute.activity
            ? ActivityHomePage(
                onOpenItem: (_) {},
                onComposeUpdate: (composeContext) => unawaited(
                  MobileNavigation.openUpdateCompose(composeContext),
                ),
                updatesPageBuilder: (_, _) => const TeamUpdatesPage(),
                tabReselection: routeContext.tabReselection,
              )
            : TodayPage(
                communityName: _community.name,
                profileName: _lerato.displayName,
                profileInitials: _lerato.initials,
                profileAvatarUrl: _lerato.avatarUrl,
                profilePubkey: _lerato.pubkey,
                reviewItems: AsyncValue.data([
                  TodayReviewItem(
                    id: _review.id,
                    requesterName: 'Mina',
                    title: 'A fresh direction for Olive.',
                    subtitle:
                        'The October content plan is ready for your approval.',
                    initials: 'M',
                    requesterIsAgent: true,
                  ),
                ]),
                movingItems: AsyncValue.data([
                  TodayProgressItem(
                    id: _researchActivity.id,
                    title: 'Research completed',
                    subtitle: 'Scout · Olive Studio prospects',
                    initials: _scout.initials,
                    isAgent: true,
                  ),
                ]),
                teamUpdate: AsyncValue.data(
                  TodayTeamUpdate(
                    id: _rootNote.id,
                    title: 'A little focus. A strong finish.',
                    subtitle: 'Maya shared an update · 10:20',
                    initials: _maya.initials,
                  ),
                ),
                overviewMetrics: [
                  TodayOverviewMetric(
                    value: '1',
                    label: 'needs your eye',
                    onTap: () {},
                  ),
                ],
                onOpenUpdates: (updatesContext) =>
                    unawaited(MobileNavigation.openUpdates(updatesContext)),
                onOpenReview: (_) {},
                onOpenProgress: (_) {},
                onOpenUpdate: (_) {},
                onOpenActivity: (activityContext) => unawaited(
                  MobileNavigation.openActivity(activityContext, routeContext),
                ),
                onRetryActivity: _noRetry,
                now: DateTime(2026, 9, 28),
              ),
      )
      .register(MobileRoutes.chats, (_, _) => const SizedBox.shrink())
      .register(
        MobileRoutes.activity,
        (_, routeContext) => ActivityHomePage(
          onOpenItem: (_) {},
          onComposeUpdate: (composeContext) =>
              unawaited(MobileNavigation.openUpdateCompose(composeContext)),
          updatesPageBuilder: (_, _) => const TeamUpdatesPage(),
          tabReselection: routeContext.tabReselection,
        ),
      )
      .register(MobileRoutes.business, (_, _) => const SizedBox.shrink())
      .register(
        MobileRoutes.updateCompose,
        (_, _) => TeamUpdateComposePage(onPublish: _noPublish),
      )
      .register(
        MobileRoutes.updates,
        (_, _) => TeamUpdatesPage(
          initiallyPublished: route == _VisualRoute.published,
        ),
      );
  return HomePage(
    routeRegistry: routes,
    settingsPageBuilder: (_) => const SizedBox.shrink(),
    hasUnreadInbox: false,
  );
}

Widget _proofApp(Widget child, {Brightness brightness = Brightness.light}) =>
    MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light(mobileTokens: MobileDesignTokens.light),
      darkTheme: AppTheme.dark(mobileTokens: MobileDesignTokens.dark),
      themeMode: brightness == Brightness.dark
          ? ThemeMode.dark
          : ThemeMode.light,
      home: child,
    );

Future<void> _noPublish(String _) async {}
Future<void> _noRetry() async {}
void _noReview() {}

class _ProofActivityNotifier extends ActivityNotifier {
  _ProofActivityNotifier(this.feed);
  final HomeFeedResponse feed;
  @override
  Future<HomeFeedResponse> build() async => feed;
}

class _ProofProfileNotifier extends ProfileNotifier {
  _ProofProfileNotifier(this.profile);
  final UserProfile profile;
  @override
  Future<UserProfile?> build() async => profile;
}

class _ProofUserCacheNotifier extends UserCacheNotifier {
  _ProofUserCacheNotifier(this.users);
  final Map<String, UserProfile> users;
  @override
  Map<String, UserProfile> build() => users;
}

class _ProofPresenceCacheNotifier extends PresenceCacheNotifier {
  _ProofPresenceCacheNotifier(this.statuses);

  final Map<String, String> statuses;

  @override
  Map<String, String> build() => statuses;
}

class _ProofRelayConfigNotifier extends RelayConfigNotifier {
  @override
  RelayConfig build() => const RelayConfig(baseUrl: _proofRelay);
}

const _visualRoutes = [
  _VisualRoute.today,
  _VisualRoute.activity,
  _VisualRoute.updatesFeed,
  _VisualRoute.note,
  _VisualRoute.compose,
  _VisualRoute.draft,
  _VisualRoute.failed,
  _VisualRoute.published,
];

enum _VisualRoute {
  today('today'),
  activity('activity'),
  updatesFeed('updates-feed'),
  note('updates-note'),
  compose('updates-compose'),
  draft('updates-draft'),
  failed('updates-failed'),
  published('updates-published');

  const _VisualRoute(this.name);
  final String name;
}

class _ProofStatusBar extends StatelessWidget {
  const _ProofStatusBar({required this.brightness});
  final Brightness brightness;

  @override
  Widget build(BuildContext context) {
    final color = Color(
      brightness == Brightness.dark ? 0xffeee8f0 : 0xff292632,
    );
    return Positioned(
      top: 0,
      left: 0,
      right: 0,
      child: IgnorePointer(
        child: SizedBox(
          height: 46,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(25, 8, 25, 0),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  '9:41',
                  style: TextStyle(
                    color: color,
                    fontFamily: 'Manrope',
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                Row(
                  children: [
                    Icon(Icons.signal_cellular_alt, color: color, size: 14),
                    const SizedBox(width: 3),
                    Icon(Icons.battery_full, color: color, size: 16),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ProofHomeIndicator extends StatelessWidget {
  const _ProofHomeIndicator({required this.brightness});
  final Brightness brightness;

  @override
  Widget build(BuildContext context) => Positioned(
    bottom: 8,
    left: 0,
    right: 0,
    child: IgnorePointer(
      child: Align(
        alignment: Alignment.center,
        child: Container(
          width: 108,
          height: 4,
          decoration: BoxDecoration(
            color: Color(
              brightness == Brightness.dark ? 0xffeee8f0 : 0xff292632,
            ),
            borderRadius: BorderRadius.circular(2),
          ),
        ),
      ),
    ),
  );
}
