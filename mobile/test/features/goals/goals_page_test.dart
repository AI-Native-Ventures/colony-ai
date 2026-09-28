import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:buzz/features/goals/goal_detail_page.dart';
import 'package:buzz/features/goals/goals_page.dart';
import 'package:buzz/shared/business/mobile_business_entry_points.dart';
import 'package:buzz/shared/community/community_membership_provider.dart';
import 'package:buzz/shared/company/goals/goal_records.dart';
import 'package:buzz/shared/company/goals/goal_repository.dart';
import 'package:buzz/shared/navigation/mobile_navigation.dart';
import 'package:buzz/shared/navigation/mobile_route.dart';
import 'package:buzz/shared/navigation/mobile_route_scope.dart';
import 'package:buzz/shared/profile/user_cache_provider.dart';
import 'package:buzz/shared/profile/user_profile.dart';
import 'package:buzz/shared/relay/relay.dart';
import 'package:buzz/shared/shell/mobile_shell.dart';
import 'package:buzz/shared/theme/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:nostr/nostr.dart' as nostr;

const _goalId = '123e4567-e89b-12d3-a456-426614174000';
const _childGoalId = '223e4567-e89b-12d3-a456-426614174000';
const _secondChildGoalId = '423e4567-e89b-12d3-a456-426614174000';
const _archivedGoalId = '323e4567-e89b-12d3-a456-426614174000';
const _relaySecret =
    '1111111111111111111111111111111111111111111111111111111111111111';
const _ownerPubkey =
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const _childOwnerPubkey =
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const _secondChildOwnerPubkey =
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';

void main() {
  testWidgets('lists company goals and contributing sub-goals from records', (
    tester,
  ) async {
    final parent = _headRecord(
      goalId: _goalId,
      title: 'Every client plan, ready on time',
      ownerPubkey: _ownerPubkey,
      doneCondition: 'Each active client has an approved plan.',
    );
    final child = _headRecord(
      goalId: _childGoalId,
      title: 'Olive Studio October campaign',
      ownerPubkey: _ownerPubkey,
      doneCondition: 'The client approves the campaign plan.',
      parentGoalId: _goalId,
    );
    final archived = _headRecord(
      goalId: _archivedGoalId,
      title: 'Archived company goal',
      ownerPubkey: _ownerPubkey,
      doneCondition: 'The old plan is complete.',
      status: 'archived',
    );

    await tester.pumpWidget(
      _goalsApp(
        records: [parent, child, archived],
        role: CommunityMemberRole.owner,
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Company goals'), findsOneWidget);
    expect(find.text('Contributing goals'), findsOneWidget);
    expect(find.text('Every client plan, ready on time'), findsOneWidget);
    expect(find.text('Olive Studio October campaign'), findsOneWidget);
    expect(find.text('Archived company goal'), findsOneWidget);
    expect(find.byTooltip('Create goal'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('goal-card-$_goalId')));
    await tester.pumpAndSettle();
    expect(find.text('What done looks like'), findsOneWidget);
    expect(
      find.text('Each active client has an approved plan.'),
      findsOneWidget,
    );
    expect(find.text('Sub-goals'), findsOneWidget);
    expect(find.text('Olive Studio October campaign'), findsOneWidget);
  });

  testWidgets('does not show root creation to a regular member', (
    tester,
  ) async {
    await tester.pumpWidget(
      _goalsApp(records: const [], role: CommunityMemberRole.member),
    );

    expect(find.byTooltip('Create goal'), findsNothing);
  });

  testWidgets('opens a deleted goal as a read-only detail', (tester) async {
    final deleted = _headRecord(
      goalId: _goalId,
      title: 'Improve client handoff',
      ownerPubkey: _ownerPubkey,
      doneCondition: 'Each handoff has a clear owner and decision.',
      status: 'deleted',
    );
    await tester.pumpWidget(
      _goalsApp(
        records: [deleted],
        role: CommunityMemberRole.member,
        detailGoalId: _goalId,
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Improve client handoff'), findsOneWidget);
    expect(find.text('Deleted goal'), findsOneWidget);
    expect(find.byKey(const ValueKey('goal-update-progress')), findsNothing);
    expect(find.byKey(const ValueKey('goal-share-in-chat')), findsNothing);
  });

  testWidgets('shows unavailable detail when the exact goal is absent', (
    tester,
  ) async {
    await tester.pumpWidget(
      _goalsApp(
        records: const [],
        role: CommunityMemberRole.member,
        detailGoalId: _goalId,
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('goal-unavailable')), findsOneWidget);
  });

  testWidgets('shows retryable unavailable state after a record read fails', (
    tester,
  ) async {
    await tester.pumpWidget(
      _goalsApp(
        records: const [],
        role: CommunityMemberRole.member,
        detailGoalId: _goalId,
        loadError: StateError('relay unavailable'),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Goals are unavailable right now.'), findsOneWidget);
    expect(find.text('Try again'), findsOneWidget);
  });

  testWidgets(
    'target progress stays explicit and has no automatic achievement',
    (tester) async {
      final targeted = _headRecord(
        goalId: _goalId,
        title: 'Every client plan, ready on time',
        ownerPubkey: _ownerPubkey,
        doneCondition: 'Each active client has an approved plan.',
        target: '4',
        current: '4',
      );
      final gateway = _FakeGoalGateway();

      await tester.pumpWidget(
        _goalsApp(
          records: [targeted],
          role: CommunityMemberRole.owner,
          gateway: gateway,
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('goal-card-$_goalId')));
      await tester.pumpAndSettle();

      expect(find.text('4'), findsOneWidget);
      expect(find.text('of 4 plans'), findsOneWidget);
      expect(find.text('On track'), findsOneWidget);
      expect(
        tester.getSize(find.byKey(const ValueKey('goal-progress-fill'))).width,
        closeTo(
          tester
              .getSize(find.byKey(const ValueKey('goal-progress-track')))
              .width,
          0.5,
        ),
      );
      await tester.tap(find.byKey(const ValueKey('goal-update-progress')));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const ValueKey('goal-progress-evidence')),
        'The current plan count was checked against approved records.',
      );
      await tester.tap(find.byKey(const ValueKey('goal-progress-submit')));
      await tester.pumpAndSettle();

      final action =
          jsonDecode(gateway.publishedContent!) as Map<String, dynamic>;
      expect(action['status'], isNull);
      expect(action['progress']['current'], '4');
      expect(action['progress']['evidence'], contains('approved records'));
      expect(find.text('On track'), findsOneWidget);
    },
  );

  testWidgets('shows the recorded numeric progress proportionally', (
    tester,
  ) async {
    final targeted = _headRecord(
      goalId: _goalId,
      title: 'Every client plan, ready on time',
      ownerPubkey: _ownerPubkey,
      doneCondition: 'Each active client has an approved plan.',
      target: '5',
      current: '3',
    );
    await tester.pumpWidget(
      _goalsApp(records: [targeted], role: CommunityMemberRole.owner),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('goal-card-$_goalId')));
    await tester.pumpAndSettle();

    final trackWidth = tester
        .getSize(find.byKey(const ValueKey('goal-progress-track')))
        .width;
    final fillWidth = tester
        .getSize(find.byKey(const ValueKey('goal-progress-fill')))
        .width;
    expect(fillWidth, closeTo(trackWidth * 0.6, 0.5));
  });

  testWidgets('failed progress save keeps the evidence in the sheet', (
    tester,
  ) async {
    final record = _headRecord(
      goalId: _goalId,
      title: 'Improve client handoff',
      ownerPubkey: _ownerPubkey,
      doneCondition: 'Each handoff has a clear owner and decision.',
    );
    final gateway = _FakeGoalGateway(throwOnPublish: true);
    await tester.pumpWidget(
      _goalsApp(
        records: [record],
        role: CommunityMemberRole.owner,
        gateway: gateway,
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('goal-card-$_goalId')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('goal-update-progress')));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('goal-progress-evidence')),
      'The new checklist was used in two client reviews.',
    );
    await tester.tap(find.byKey(const ValueKey('goal-progress-submit')));
    await tester.pumpAndSettle();

    expect(
      find.text('Could not save this update. Your text is still here.'),
      findsOneWidget,
    );
    expect(
      tester
          .widget<TextFormField>(
            find.byKey(const ValueKey('goal-progress-evidence')),
          )
          .controller!
          .text,
      'The new checklist was used in two client reviews.',
    );
    expect(gateway.publishedKind, EventKind.goalAction);
    final action =
        jsonDecode(gateway.publishedContent!) as Map<String, dynamic>;
    expect(action['expectedHeadEventId'], record.event.id);
    expect(
      action['progress']['evidence'],
      'The new checklist was used in two client reviews.',
    );
  });

  testWidgets('failed create keeps both required fields', (tester) async {
    final gateway = _FakeGoalGateway(throwOnPublish: true);
    await tester.pumpWidget(
      _goalsApp(
        records: const [],
        role: CommunityMemberRole.admin,
        gateway: gateway,
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Create goal'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('goal-create-title')),
      'Improve client handoff',
    );
    await tester.enterText(
      find.byKey(const ValueKey('goal-create-done-condition')),
      'Each handoff has a clear owner and decision.',
    );
    await tester.tap(find.byKey(const ValueKey('goal-create-submit')));
    await tester.pumpAndSettle();

    expect(
      find.text('Could not create this goal. Your text is still here.'),
      findsOneWidget,
    );
    expect(
      tester
          .widget<TextFormField>(
            find.byKey(const ValueKey('goal-create-title')),
          )
          .controller!
          .text,
      'Improve client handoff',
    );
    expect(
      tester
          .widget<TextFormField>(
            find.byKey(const ValueKey('goal-create-done-condition')),
          )
          .controller!
          .text,
      'Each handoff has a clear owner and decision.',
    );
  });

  testWidgets('explicit progress status and evidence publish together', (
    tester,
  ) async {
    final record = _headRecord(
      goalId: _goalId,
      title: 'Improve client handoff',
      ownerPubkey: _ownerPubkey,
      doneCondition: 'Each handoff has a clear owner and decision.',
    );
    final gateway = _FakeGoalGateway();
    await tester.pumpWidget(
      _goalsApp(
        records: [record],
        role: CommunityMemberRole.owner,
        gateway: gateway,
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('goal-card-$_goalId')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('goal-update-progress')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('goal-progress-status')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Achieved').last);
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('goal-progress-evidence')),
      'The handoff checklist was used and reviewed.',
    );
    await tester.tap(find.byKey(const ValueKey('goal-progress-submit')));
    await tester.pumpAndSettle();

    final action =
        jsonDecode(gateway.publishedContent!) as Map<String, dynamic>;
    expect(gateway.publishedKind, EventKind.goalAction);
    expect(action['action'], 'progress');
    expect(action['status'], 'achieved');
    expect(
      action['progress']['evidence'],
      'The handoff checklist was used and reviewed.',
    );
    expect(action['expectedHeadEventId'], record.event.id);
  });

  testWidgets('captures v5 Goals routes at both sizes and themes', (
    tester,
  ) async {
    const captureScreenshots = bool.fromEnvironment('CAPTURE_M3B_GOALS');
    if (!captureScreenshots) return;
    final previousSizeDebugPainting = debugPaintSizeEnabled;
    final previousBaselineDebugPainting = debugPaintBaselinesEnabled;
    final previousTextLayoutDebugPainting = debugPaintTextLayoutBoxes;
    final previousLayerDebugPainting = debugPaintLayerBordersEnabled;
    final previousPointerDebugPainting = debugPaintPointersEnabled;
    final previousRepaintDebugPainting = debugRepaintRainbowEnabled;
    final previousTextRepaintDebugPainting = debugRepaintTextRainbowEnabled;
    addTearDown(() {
      debugPaintSizeEnabled = previousSizeDebugPainting;
      debugPaintBaselinesEnabled = previousBaselineDebugPainting;
      debugPaintTextLayoutBoxes = previousTextLayoutDebugPainting;
      debugPaintLayerBordersEnabled = previousLayerDebugPainting;
      debugPaintPointersEnabled = previousPointerDebugPainting;
      debugRepaintRainbowEnabled = previousRepaintDebugPainting;
      debugRepaintTextRainbowEnabled = previousTextRepaintDebugPainting;
    });
    debugPaintSizeEnabled = false;
    debugPaintBaselinesEnabled = false;
    debugPaintTextLayoutBoxes = false;
    debugPaintLayerBordersEnabled = false;
    debugPaintPointersEnabled = false;
    debugRepaintRainbowEnabled = false;
    debugRepaintTextRainbowEnabled = false;

    final fontLoader = FontLoader('Manrope')
      ..addFont(rootBundle.load('assets/fonts/Manrope-Variable.ttf'));
    await fontLoader.load();
    final iconFontLoader = FontLoader('packages/lucide_icons_flutter/Lucide')
      ..addFont(
        rootBundle.load('packages/lucide_icons_flutter/assets/lucide.ttf'),
      );
    await iconFontLoader.load();

    final records = [
      _headRecord(
        goalId: _goalId,
        title: 'Every client kickoff, ready to start',
        ownerPubkey: _ownerPubkey,
        doneCondition: 'Each new client knows their owner and next step.',
        target: '5',
        current: '3',
        dueDate: '2026-09-29',
      ),
      _headRecord(
        goalId: _childGoalId,
        title: 'Cedar launch checklist',
        ownerPubkey: _childOwnerPubkey,
        doneCondition: 'The client confirms the launch checklist.',
        parentGoalId: _goalId,
        status: 'off_pace',
        dueDate: '2026-10-12',
      ),
      _headRecord(
        goalId: _secondChildGoalId,
        title: 'Bramble launch checklist',
        ownerPubkey: _secondChildOwnerPubkey,
        doneCondition: 'The project lead confirms the launch is ready.',
        parentGoalId: _goalId,
        dueDate: '2026-10-13',
      ),
    ];
    const captureSizes = {'390x844': Size(390, 844), '412x915': Size(412, 915)};
    const captureKey = ValueKey('m3b-goal-fullscreen-capture');
    final routes = [
      (name: 'goals', goalId: null),
      (name: 'goal-detail', goalId: _goalId),
      (name: 'sub-goal-detail', goalId: _childGoalId),
    ];

    for (final size in captureSizes.entries) {
      tester.view.physicalSize = size.value;
      tester.view.devicePixelRatio = 1;
      tester.view.padding = const FakeViewPadding(top: 46, bottom: 20);
      tester.view.viewPadding = const FakeViewPadding(top: 46, bottom: 20);
      for (final brightness in [Brightness.light, Brightness.dark]) {
        final mode = brightness == Brightness.light ? 'light' : 'dark';
        final output = Directory(
          '/tmp/m3b-goals-visual-sheets/${size.key}/$mode',
        );
        output.createSync(recursive: true);
        final previousComparator = goldenFileComparator;
        goldenFileComparator = _GoalCaptureFileComparator(
          Uri.file('${output.path}/capture_test.dart'),
          output.path,
        );
        for (final route in routes) {
          await tester.pumpWidget(
            _goalsCaptureApp(
              records: records,
              brightness: brightness,
              captureKey: captureKey,
            ),
          );
          await tester.pumpAndSettle();
          if (route.goalId case final goalId?) {
            unawaited(
              MobileNavigation.push<String, void>(
                tester.element(find.byType(GoalsPage)),
                MobileBusinessRoutes.goalDetail,
                goalId,
              ),
            );
            await tester.pumpAndSettle();
          }

          if (route.goalId == null) {
            expect(find.text('Goals'), findsOneWidget);
            expect(find.text('Company goals'), findsOneWidget);
            expect(find.text('Contributing goals'), findsOneWidget);
          } else {
            expect(
              find.text(route.goalId == _goalId ? 'Company goal' : 'Sub-goal'),
              findsOneWidget,
            );
            expect(find.text('What done looks like'), findsOneWidget);
          }
          final title = route.goalId == null
              ? find.text('Goals')
              : find.text(
                  route.goalId == _goalId ? 'Company goal' : 'Sub-goal',
                );
          final nav = find.byKey(const ValueKey('mobile-bottom-navigation'));
          final navLayout = nav.evaluate().isEmpty
              ? 'hidden'
              : tester.getRect(nav).toString();
          debugPaintSizeEnabled = false;
          debugPaintBaselinesEnabled = false;
          debugPaintTextLayoutBoxes = false;
          debugPaintLayerBordersEnabled = false;
          debugPaintPointersEnabled = false;
          debugRepaintRainbowEnabled = false;
          debugRepaintTextRainbowEnabled = false;
          await tester.pump();
          debugPrint(
            'VISUAL_LAYOUT ${route.name} ${size.key} $mode '
            'header=${tester.getRect(title)} nav=$navLayout',
          );
          await expectLater(
            find.byKey(captureKey),
            matchesGoldenFile('${route.name}.png'),
          );
          await tester.pumpWidget(const SizedBox.shrink());
          await tester.pumpAndSettle();
        }
        goldenFileComparator = previousComparator;
      }
    }
    tester.view.resetPadding();
    tester.view.resetViewPadding();
    tester.view.resetPhysicalSize();
    tester.view.resetDevicePixelRatio();
  });
}

Widget _goalsApp({
  required List<GoalHeadRecord> records,
  required CommunityMemberRole role,
  GoalRecordGateway? gateway,
  String? detailGoalId,
  Object? loadError,
}) {
  final routes = MobileRouteRegistry.empty().register(
    MobileBusinessRoutes.goalDetail,
    (_, goalId) => GoalDetailPage(goalId: goalId),
  );
  return ProviderScope(
    retry: (_, _) => null,
    overrides: [
      goalHeadsProvider.overrideWith((ref) async {
        if (loadError != null) throw loadError;
        return records;
      }),
      currentCommunityRoleProvider.overrideWithValue(AsyncData(role)),
      myPubkeyProvider.overrideWithValue(_ownerPubkey),
      userCacheProvider.overrideWith(_EmptyUserCache.new),
      if (gateway != null)
        goalRepositoryProvider.overrideWithValue(GoalRepository(gateway)),
    ],
    child: MaterialApp(
      theme: AppTheme.light(),
      home: MobileRouteScope(
        registry: routes,
        child: Scaffold(
          body: detailGoalId == null
              ? const GoalsPage()
              : GoalDetailPage(goalId: detailGoalId),
        ),
      ),
    ),
  );
}

Widget _goalsCaptureApp({
  required List<GoalHeadRecord> records,
  required Brightness brightness,
  required Key captureKey,
}) {
  final routes = MobileRouteRegistry.empty().register(
    MobileBusinessRoutes.goalDetail,
    (_, goalId) => GoalDetailPage(goalId: goalId, onShareInChat: () {}),
  );
  return ProviderScope(
    overrides: [
      goalHeadsProvider.overrideWith((ref) async => records),
      currentCommunityRoleProvider.overrideWithValue(
        const AsyncData(CommunityMemberRole.owner),
      ),
      myPubkeyProvider.overrideWithValue(_ownerPubkey),
      userCacheProvider.overrideWith(_GoalCaptureUserCache.new),
    ],
    child: MaterialApp(
      theme: brightness == Brightness.light
          ? AppTheme.light(mobileTokens: MobileDesignTokens.light)
          : AppTheme.dark(mobileTokens: MobileDesignTokens.dark),
      home: MobileRouteScope(
        registry: routes,
        child: MobileShell(
          destination: MobileShellDestination.company,
          showBrandBar: false,
          onDestinationSelected: (_) {},
          child: const GoalsPage(),
        ),
      ),
      builder: (context, child) => RepaintBoundary(
        key: captureKey,
        child: Stack(
          fit: StackFit.expand,
          children: [child!, _GoalCaptureSystemBars(brightness)],
        ),
      ),
    ),
  );
}

GoalHeadRecord _headRecord({
  required String goalId,
  required String title,
  required String ownerPubkey,
  required String doneCondition,
  String? parentGoalId,
  String status = 'active',
  String? target,
  String? current,
  String? dueDate,
}) {
  final goal = <String, Object?>{
    'schemaVersion': 1,
    'goalId': goalId,
    'title': title,
    'ownerPubkey': ownerPubkey,
    'doneCondition': doneCondition,
    'linkedChannelIds': <String>[],
    'dueDate': ?dueDate,
  };
  if (parentGoalId != null) goal['parentGoalId'] = parentGoalId;
  if (target != null) goal['target'] = {'value': target, 'unit': 'plans'};
  final content = <String, Object?>{
    'schemaVersion': 1,
    'goalId': goalId,
    'status': status,
    'title': title,
    if (status != 'deleted') 'goal': goal,
    ...?current == null || status == 'deleted'
        ? null
        : {
            'progress': {
              'current': current,
              'evidence': 'Current signed evidence.',
              'evidenceRefs': <String>[],
              'recordedByPubkey': ownerPubkey,
              'recordedAt': '2026-10-11T08:30:00Z',
            },
          },
    'sourceActionEventId': List.filled(64, 'f').join(),
  };
  final signed = nostr.Event.from(
    kind: EventKind.goalHead,
    content: jsonEncode(content),
    tags: [
      ['d', goalDTag(goalId)],
    ],
    secretKey: _relaySecret,
    createdAt: 1758700000,
    verify: false,
  );
  final event = NostrEvent.fromJson(signed.toMap());
  return parseGoalHeadEvent(event, event.pubkey)!;
}

class _GoalCaptureFileComparator extends LocalFileComparator {
  _GoalCaptureFileComparator(super.testFile, this.outputPath);

  final String outputPath;

  @override
  Future<bool> compare(Uint8List imageBytes, Uri golden) async {
    final file = File('$outputPath/${golden.pathSegments.last}');
    await file.parent.create(recursive: true);
    await file.writeAsBytes(imageBytes);
    return true;
  }
}

class _GoalCaptureSystemBars extends StatelessWidget {
  const _GoalCaptureSystemBars(this.brightness);

  final Brightness brightness;

  @override
  Widget build(BuildContext context) {
    final color = brightness == Brightness.dark
        ? const Color(0xFFF2E9F6)
        : const Color(0xFF34263C);
    return IgnorePointer(
      child: Stack(
        children: [
          Positioned(
            top: 8,
            left: 25,
            child: Text(
              '9:41',
              style: TextStyle(
                color: color,
                fontFamily: 'Manrope',
                fontSize: 12,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          Positioned(
            top: 8,
            right: 25,
            child: Row(
              children: [
                Icon(Icons.signal_cellular_alt, color: color, size: 14),
                const SizedBox(width: 3),
                Icon(Icons.battery_full, color: color, size: 16),
              ],
            ),
          ),
          Positioned(
            left: 0,
            right: 0,
            bottom: 7,
            child: Center(
              child: Container(
                width: 108,
                height: 4,
                decoration: BoxDecoration(
                  color: color,
                  borderRadius: BorderRadius.circular(Radii.full),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _EmptyUserCache extends UserCacheNotifier {
  @override
  Map<String, UserProfile> build() => const {};
}

class _GoalCaptureUserCache extends UserCacheNotifier {
  @override
  Map<String, UserProfile> build() => const {
    _ownerPubkey: UserProfile(pubkey: _ownerPubkey, displayName: 'Rosa Kim'),
    _childOwnerPubkey: UserProfile(
      pubkey: _childOwnerPubkey,
      displayName: 'Milo Chen',
    ),
    _secondChildOwnerPubkey: UserProfile(
      pubkey: _secondChildOwnerPubkey,
      displayName: 'Tara Patel',
    ),
  };
}

class _FakeGoalGateway implements GoalRecordGateway {
  _FakeGoalGateway({this.throwOnPublish = false});

  final bool throwOnPublish;
  int? publishedKind;
  String? publishedContent;

  @override
  Future<List<NostrEvent>> fetch(NostrFilter filter) async => const [];

  @override
  Future<NostrEvent> publish({
    required int kind,
    required String content,
    required List<List<String>> tags,
  }) async {
    publishedKind = kind;
    publishedContent = content;
    if (throwOnPublish) throw StateError('relay unavailable');
    return const NostrEvent(
      id: 'a',
      pubkey: 'b',
      createdAt: 1,
      kind: EventKind.goalAction,
      tags: [],
      content: '',
      sig: 'c',
    );
  }
}
