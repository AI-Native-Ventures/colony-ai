import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:buzz/features/company/team_page.dart';
import 'package:buzz/shared/community/community.dart';
import 'package:buzz/shared/community/community_provider.dart';
import 'package:buzz/shared/company/team/company_team_repository.dart';
import 'package:buzz/shared/company/team/member_position_records.dart';
import 'package:buzz/shared/mentions/agent_identity_provider.dart';
import 'package:buzz/shared/profile/user_cache_provider.dart';
import 'package:buzz/shared/profile/user_profile.dart';
import 'package:buzz/shared/relay/nostr_models.dart';
import 'package:buzz/shared/shell/mobile_shell.dart';
import 'package:buzz/shared/theme/theme.dart';
import 'package:flutter/foundation.dart'
    show debugDefaultTargetPlatformOverride;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show FontLoader, rootBundle;
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

const _captureScreenshots = bool.fromEnvironment('CAPTURE_MV6_TEAM_SHOTS');
const _owner =
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const _employee =
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const _member =
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
const _relay =
    'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd';
final _community = Community(
  id: 'team-proof',
  name: 'Team proof',
  relayUrl: 'wss://relay.example',
  addedAt: DateTime.utc(2026, 9, 28),
);
const _captureRootKey = ValueKey('mv6-team-capture');

void main() {
  if (!_captureScreenshots) return;

  setUpAll(_loadProofFonts);
  const output = '/tmp/colony-mv6-team-proof';
  final outputDirectory = Directory(output)..createSync(recursive: true);
  final previousPlatform = debugDefaultTargetPlatformOverride;

  for (final size in const [Size(390, 844), Size(412, 915)]) {
    for (final brightness in [Brightness.light, Brightness.dark]) {
      for (final screen in _TeamProofScreen.values) {
        testWidgets('captures ${screen.name} ${size.width.toInt()}x'
            '${size.height.toInt()} ${brightness.name}', (tester) async {
          final previousComparator = goldenFileComparator;
          debugDefaultTargetPlatformOverride = TargetPlatform.android;
          tester.view.devicePixelRatio = 1;
          tester.view.physicalSize = size;
          tester.view.padding = const FakeViewPadding(top: 25, bottom: 20);
          tester.view.viewPadding = const FakeViewPadding(top: 25, bottom: 20);
          goldenFileComparator = _TeamCaptureComparator(
            Uri.file('$output/capture_test.dart'),
            outputDirectory.path,
          );
          addTearDown(() {
            tester.view.resetPhysicalSize();
            tester.view.resetDevicePixelRatio();
            tester.view.padding = FakeViewPadding.zero;
            tester.view.viewPadding = FakeViewPadding.zero;
            goldenFileComparator = previousComparator;
            debugDefaultTargetPlatformOverride = previousPlatform;
          });

          final child = switch (screen) {
            _TeamProofScreen.team => TeamPage(onInvite: () {}),
            _TeamProofScreen.loading ||
            _TeamProofScreen.unavailable ||
            _TeamProofScreen.denied ||
            _TeamProofScreen.active ||
            _TeamProofScreen.paused => TeamMemberDetailPage(
              pubkey: _employee,
              onInvite: () {},
              onStartConversation: _proofConversation,
            ),
          };
          final app = MaterialApp(
            debugShowCheckedModeBanner: false,
            theme: AppTheme.light(mobileTokens: MobileDesignTokens.light),
            darkTheme: AppTheme.dark(mobileTokens: MobileDesignTokens.dark),
            themeMode: brightness == Brightness.dark
                ? ThemeMode.dark
                : ThemeMode.light,
            home: MobileShell(
              destination: MobileShellDestination.company,
              onDestinationSelected: (_) {},
              showBrandBar: false,
              child: child,
            ),
          );
          await tester.pumpWidget(
            ProviderScope(
              retry: (_, _) => null,
              overrides: [
                companyTeamProvider.overrideWith((ref) async {
                  switch (screen) {
                    case _TeamProofScreen.loading:
                      return Completer<CompanyTeamData>().future;
                    case _TeamProofScreen.unavailable:
                      throw StateError('The member record is unavailable.');
                    case _TeamProofScreen.denied:
                      return _team();
                    case _TeamProofScreen.paused:
                      return _team(
                        status: MemberPositionStatus.paused,
                        reason: 'Paused for a planned review.',
                      );
                    case _TeamProofScreen.team:
                    case _TeamProofScreen.active:
                      return _team();
                  }
                }),
                activeCommunityProvider.overrideWith((_) async => _community),
                userCacheProvider.overrideWith(_TeamProofUserCache.new),
                agentDirectoryDisplayNamesProvider.overrideWith(
                  (_) => const {},
                ),
              ],
              child: RepaintBoundary(
                key: _captureRootKey,
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(36),
                  child: Directionality(
                    textDirection: TextDirection.ltr,
                    child: Stack(
                      fit: StackFit.expand,
                      children: [app, _TeamProofSystemBars(brightness)],
                    ),
                  ),
                ),
              ),
            ),
          );
          await tester.pump(const Duration(milliseconds: 400));
          if (screen == _TeamProofScreen.loading) {
            expect(find.text('Loading Team Test Agent'), findsOneWidget);
            expect(
              find.text(
                'Fetching the latest shared record. Actions will be ready when it arrives.',
              ),
              findsOneWidget,
            );
          }
          if (screen == _TeamProofScreen.loading ||
              screen == _TeamProofScreen.unavailable) {
            expect(
              find.byKey(const ValueKey('goal-page-back')),
              findsOneWidget,
            );
            expect(find.byTooltip('Add a team member'), findsOneWidget);
          }
          if (screen == _TeamProofScreen.denied) {
            await tester.tap(find.byTooltip('Profile options'));
            await tester.pump(const Duration(milliseconds: 400));
            expect(find.byKey(const ValueKey('goal-page-back')), findsNothing);
          }

          final mode = brightness == Brightness.light ? 'light' : 'dark';
          final filename =
              '${screen.name}-${size.width.toInt()}x'
              '${size.height.toInt()}-$mode.png';
          await expectLater(
            find.byKey(_captureRootKey),
            matchesGoldenFile(filename),
          );
          debugPrint('VISUAL_PROOF $output/$filename');
          goldenFileComparator = previousComparator;
          debugDefaultTargetPlatformOverride = previousPlatform;
        });
      }
    }
  }
}

Future<void> _loadProofFonts() async {
  final materialIcons = FontLoader('MaterialIcons')
    ..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
  await materialIcons.load();
  final manrope = FontLoader('Manrope')
    ..addFont(rootBundle.load('assets/fonts/Manrope-Variable.ttf'));
  await manrope.load();
  final lucide = FontLoader('packages/lucide_icons_flutter/Lucide')
    ..addFont(
      rootBundle.load('packages/lucide_icons_flutter/assets/lucide.ttf'),
    );
  await lucide.load();
}

class _TeamCaptureComparator extends LocalFileComparator {
  _TeamCaptureComparator(super.testFile, this.outputPath);

  final String outputPath;

  @override
  Future<bool> compare(Uint8List imageBytes, Uri golden) async {
    final image = File('$outputPath/${golden.pathSegments.last}');
    await image.writeAsBytes(imageBytes);
    return true;
  }
}

enum _TeamProofScreen { team, loading, unavailable, denied, active, paused }

Future<void> _proofConversation(BuildContext context, String pubkey) async {}

CompanyTeamData _team({
  MemberPositionStatus status = MemberPositionStatus.active,
  String? reason,
}) => CompanyTeamData(
  relaySelf: _relay,
  membershipSnapshotFound: true,
  hasUnpositionedAgents: false,
  members: [
    CompanyTeamMemberRecord(
      pubkey: _owner,
      kind: MemberPositionKind.human,
      position: _position(_owner, 'Company owner'),
    ),
    CompanyTeamMemberRecord(
      pubkey: _employee,
      kind: MemberPositionKind.employee,
      position: _position(
        _employee,
        'Operations lead',
        managerPubkey: _owner,
        status: status,
        reason: reason,
        kind: MemberPositionKind.employee,
      ),
      directoryName: 'Team Test Agent',
    ),
    CompanyTeamMemberRecord(
      pubkey: _member,
      kind: MemberPositionKind.human,
      position: _position(_member, 'Team member'),
    ),
  ],
);

MemberPositionHeadRecord _position(
  String pubkey,
  String title, {
  String? managerPubkey,
  MemberPositionKind kind = MemberPositionKind.human,
  MemberPositionStatus status = MemberPositionStatus.active,
  String? reason,
}) {
  final dTag = memberPositionDTag(pubkey);
  return MemberPositionHeadRecord(
    dTag: dTag,
    event: NostrEvent(
      id: _relay,
      pubkey: _relay,
      createdAt: 1,
      kind: EventKind.memberPositionHead,
      tags: [
        ['d', dTag],
      ],
      content: '',
      sig: '',
    ),
    head: MemberPositionHead(
      schemaVersion: 1,
      pubkey: pubkey,
      title: title,
      managerPubkey: managerPubkey,
      kind: kind,
      status: status,
      reason: reason,
      sourceActionEventId: _relay,
      updatedAt: '2026-09-28T10:00:00Z',
    ),
  );
}

class _TeamProofUserCache extends UserCacheNotifier {
  @override
  Map<String, UserProfile> build() => const {
    _owner: UserProfile(pubkey: _owner, displayName: 'Owner Test'),
    _employee: UserProfile(pubkey: _employee, displayName: 'Team Test Agent'),
    _member: UserProfile(pubkey: _member, displayName: 'Member Test'),
  };

  @override
  Future<bool> preload(List<String> pubkeys) async => true;
}

class _TeamProofSystemBars extends StatelessWidget {
  const _TeamProofSystemBars(this.brightness);

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
            top: 10,
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
            top: 10,
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
                  borderRadius: BorderRadius.circular(50),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
