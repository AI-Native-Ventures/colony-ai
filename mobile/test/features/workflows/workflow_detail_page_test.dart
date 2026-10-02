import 'dart:io';

import 'package:buzz/features/workflows/workflow_detail_page.dart';
import 'package:buzz/shared/company/workflows/workflow_records.dart';
import 'package:buzz/shared/profile/user_cache_provider.dart';
import 'package:buzz/shared/profile/user_profile.dart';
import 'package:buzz/shared/relay/nostr_models.dart';
import 'package:buzz/shared/shell/mobile_shell.dart';
import 'package:buzz/shared/theme/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

const _agentPubkey =
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const _reviewerPubkey =
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const _ownerPubkey =
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';

void main() {
  testWidgets('pauses and resumes the same real workflow record', (
    tester,
  ) async {
    final statuses = <WorkflowStatus>[];
    await tester.pumpWidget(
      _workflowTestApp(
        record: _record(),
        canChange: true,
        onSetStatus: (_, status) async {
          statuses.add(status);
          return _statusEvent(status);
        },
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('workflow-pause')));
    await tester.pumpAndSettle();
    expect(find.text('Pause Weekly content plan?'), findsOneWidget);
    expect(
      find.textContaining('A run already waiting for approval'),
      findsOneWidget,
    );

    await tester.tap(find.byKey(const ValueKey('workflow-confirm-pause')));
    await tester.pumpAndSettle();
    expect(find.text('Paused'), findsOneWidget);
    expect(find.text('No new runs start until you resume it.'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('workflow-resume')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('workflow-pause')), findsOneWidget);
    expect(statuses, [WorkflowStatus.paused, WorkflowStatus.active]);
  });

  testWidgets('shows the designed view-only boundary before status writes', (
    tester,
  ) async {
    var publishCount = 0;
    await tester.pumpWidget(
      _workflowTestApp(
        record: _record(),
        canChange: false,
        onSetStatus: (_, _) async {
          publishCount++;
          return _statusEvent(WorkflowStatus.paused);
        },
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('workflow-pause')));
    await tester.pumpAndSettle();

    expect(find.text('You can view, but not change this'), findsOneWidget);
    expect(publishCount, 0);
  });

  testWidgets('captures workflow detail states for v6 sizes', (tester) async {
    await _loadCaptureFonts();
    const captureKey = ValueKey('m-v6-workflow-detail-capture');
    const sizes = {'390x844': Size(390, 844), '412x915': Size(412, 915)};
    final routes = [
      (name: 'loading', mode: 'loading'),
      (name: 'unavailable', mode: 'unavailable'),
      (name: 'denied', mode: 'denied'),
      (name: 'detail', mode: 'detail'),
      (name: 'pause', mode: 'pause'),
      (name: 'paused', mode: 'paused'),
    ];

    for (final size in sizes.entries) {
      tester.view.physicalSize = size.value;
      tester.view.devicePixelRatio = 1;
      tester.view.padding = const FakeViewPadding(top: 24, bottom: 28);
      tester.view.viewPadding = const FakeViewPadding(top: 24, bottom: 28);
      for (final brightness in [Brightness.light, Brightness.dark]) {
        final theme = brightness == Brightness.light ? 'light' : 'dark';
        final output = Directory(
          '/tmp/colony-mv6-workflow-detail/${size.key}/$theme',
        )..createSync(recursive: true);
        final previousComparator = goldenFileComparator;
        goldenFileComparator = _WorkflowCaptureComparator(
          Uri.file('${output.path}/capture_test.dart'),
          output.path,
        );

        for (final route in routes) {
          await tester.pumpWidget(
            _workflowCaptureApp(
              record: _record(
                status: route.mode == 'paused'
                    ? WorkflowStatus.paused
                    : WorkflowStatus.active,
              ),
              brightness: brightness,
              captureKey: captureKey,
              mode: route.mode,
            ),
          );
          await tester.pumpAndSettle();
          if (route.mode == 'denied') {
            await tester.tap(find.byKey(const ValueKey('workflow-pause')));
            await tester.pumpAndSettle();
            expect(
              find.text('You can view, but not change this'),
              findsOneWidget,
            );
          } else if (route.mode == 'loading') {
            expect(find.text('Loading Weekly content plan'), findsOneWidget);
          } else if (route.mode == 'unavailable') {
            expect(find.text('This workflow could not load'), findsOneWidget);
          } else if (route.mode == 'pause') {
            await tester.tap(find.byKey(const ValueKey('workflow-pause')));
            await tester.pumpAndSettle();
            expect(
              find.byKey(const ValueKey('workflow-confirm-pause')),
              findsOneWidget,
            );
          } else if (route.mode == 'paused') {
            expect(
              find.byKey(const ValueKey('workflow-resume')),
              findsOneWidget,
            );
          } else {
            expect(
              find.byKey(const ValueKey('workflow-pause')),
              findsOneWidget,
            );
          }
          await tester.pump();
          await expectLater(
            find.byKey(captureKey),
            matchesGoldenFile('workflow-detail-${route.name}.png'),
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

Widget _workflowTestApp({
  required WorkflowRecord record,
  required bool canChange,
  required Future<NostrEvent> Function(
    WorkflowRecord record,
    WorkflowStatus status,
  )
  onSetStatus,
}) => ProviderScope(
  retry: (_, _) => null,
  overrides: [userCacheProvider.overrideWith(_WorkflowTestUserCache.new)],
  child: MaterialApp(
    theme: AppTheme.light(),
    home: Scaffold(
      body: WorkflowDetailPage(
        record: record,
        communityName: 'Test company',
        channelName: 'general',
        canChange: canChange,
        onSetStatus: onSetStatus,
        onBack: () {},
        onQuickActions: () {},
      ),
    ),
  ),
);

Widget _workflowCaptureApp({
  required WorkflowRecord record,
  required Brightness brightness,
  required Key captureKey,
  required String mode,
}) => ProviderScope(
  overrides: [userCacheProvider.overrideWith(_WorkflowCaptureUserCache.new)],
  child: MaterialApp(
    theme: brightness == Brightness.light
        ? AppTheme.light(mobileTokens: MobileDesignTokens.light)
        : AppTheme.dark(mobileTokens: MobileDesignTokens.dark),
    home: MobileShell(
      destination: MobileShellDestination.company,
      showBrandBar: false,
      onDestinationSelected: (_) {},
      child: Navigator(
        onGenerateRoute: (_) => MaterialPageRoute<void>(
          builder: (_) => switch (mode) {
            'loading' => WorkflowDetailLoadingPage(
              onBack: () {},
              workflowName: record.name,
              communityName: 'Lerato Studio',
              onQuickActions: () {},
            ),
            'unavailable' => WorkflowDetailUnavailablePage(
              onBack: () {},
              onRetry: () {},
            ),
            _ => WorkflowDetailPage(
              record: record,
              communityName: 'Lerato Studio',
              channelName: 'olive-studio',
              canChange: mode != 'denied',
              onSetStatus: (_, status) async => _statusEvent(status),
              onBack: () {},
              onQuickActions: () {},
            ),
          },
        ),
      ),
    ),
    builder: (context, child) => RepaintBoundary(
      key: captureKey,
      child: Stack(
        fit: StackFit.expand,
        children: [child!, _WorkflowCaptureSystemBars(brightness)],
      ),
    ),
  ),
);

WorkflowRecord _record({WorkflowStatus status = WorkflowStatus.active}) =>
    WorkflowRecord(
      event: const NostrEvent(
        id: 'definition-event',
        pubkey: _ownerPubkey,
        createdAt: 100,
        kind: EventKind.workflowDefinition,
        tags: [],
        content: '',
        sig: '',
      ),
      workflowId: '123e4567-e89b-12d3-a456-426614174000',
      channelId: '223e4567-e89b-12d3-a456-426614174000',
      name: 'Weekly content plan',
      description: 'Prepare and review the weekly plan.',
      trigger: const WorkflowTriggerRecord(
        frequency: 'weekly',
        dayOfWeek: 1,
        hour: 10,
        minute: 0,
      ),
      steps: const [
        WorkflowStepRecord(
          id: 'prepare',
          kind: WorkflowStepKind.agent,
          title: 'Prepare the plan',
          instruction: 'Prepare the next weekly plan.',
          assigneePubkey: _agentPubkey,
        ),
        WorkflowStepRecord(
          id: 'review',
          kind: WorkflowStepKind.approval,
          title: 'Review the plan',
          instruction: 'Review the plan before it is shared.',
          reviewerPubkey: _reviewerPubkey,
        ),
      ],
      status: status,
    );

NostrEvent _statusEvent(WorkflowStatus status) => NostrEvent(
  id: 'status-${status.wireValue}',
  pubkey: _ownerPubkey,
  createdAt: 200,
  kind: EventKind.workflowStatus,
  tags: const [],
  content: '{"status":"${status.wireValue}"}',
  sig: '',
);

Future<void> _loadCaptureFonts() async {
  final manrope = FontLoader('Manrope')
    ..addFont(rootBundle.load('assets/fonts/Manrope-Variable.ttf'));
  await manrope.load();
  final materialIcons = FontLoader('MaterialIcons')
    ..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
  await materialIcons.load();
  final lucide = FontLoader('packages/lucide_icons_flutter/Lucide')
    ..addFont(
      rootBundle.load('packages/lucide_icons_flutter/assets/lucide.ttf'),
    );
  await lucide.load();
}

class _WorkflowTestUserCache extends UserCacheNotifier {
  @override
  Map<String, UserProfile> build() => _testProfiles;
}

class _WorkflowCaptureUserCache extends UserCacheNotifier {
  @override
  Map<String, UserProfile> build() => _testProfiles;
}

final _testProfiles = {
  _agentPubkey: const UserProfile(
    pubkey: _agentPubkey,
    displayName: 'Mina',
    ownerPubkey: _ownerPubkey,
  ),
  _reviewerPubkey: const UserProfile(
    pubkey: _reviewerPubkey,
    displayName: 'Noluthando',
  ),
};

class _WorkflowCaptureComparator extends LocalFileComparator {
  _WorkflowCaptureComparator(super.testFile, this.outputPath);

  final String outputPath;

  @override
  Future<bool> compare(Uint8List imageBytes, Uri golden) async {
    final file = File('$outputPath/${golden.pathSegments.last}');
    await file.parent.create(recursive: true);
    await file.writeAsBytes(imageBytes);
    return true;
  }
}

class _WorkflowCaptureSystemBars extends StatelessWidget {
  const _WorkflowCaptureSystemBars(this.brightness);

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
                  borderRadius: BorderRadius.circular(20),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
