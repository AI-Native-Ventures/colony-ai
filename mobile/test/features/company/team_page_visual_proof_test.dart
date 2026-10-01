import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:buzz/features/company/team_page.dart';
import 'package:buzz/shared/community/community.dart';
import 'package:buzz/shared/community/community_membership_provider.dart';
import 'package:buzz/shared/community/community_provider.dart';
import 'package:buzz/shared/company/team/company_team_repository.dart';
import 'package:buzz/shared/company/team/member_position_records.dart';
import 'package:buzz/shared/company/team/member_position_repository.dart';
import 'package:buzz/shared/company/work/company_work_records.dart';
import 'package:buzz/shared/mentions/agent_identity_provider.dart';
import 'package:buzz/shared/profile/user_cache_provider.dart';
import 'package:buzz/shared/profile/user_profile.dart';
import 'package:buzz/shared/relay/nostr_models.dart';
import 'package:buzz/shared/relay/relay_provider.dart';
import 'package:buzz/shared/shell/mobile_shell.dart';
import 'package:buzz/shared/theme/theme.dart';
import 'package:flutter/foundation.dart'
    show debugDefaultTargetPlatformOverride;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show FontLoader, rootBundle;
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

const _captureScreenshots = bool.fromEnvironment('CAPTURE_B2_TEAM_SHOTS');
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
const _captureRootKey = ValueKey('b2-team-capture');

void main() {
  if (!_captureScreenshots) return;

  setUpAll(_loadProofFonts);
  const output = '/tmp/colony-b2-team-proof';
  final outputDirectory = Directory(output)..createSync(recursive: true);
  final previousPlatform = debugDefaultTargetPlatformOverride;

  for (final size in const [Size(390, 844), Size(412, 915)]) {
    for (final brightness in [Brightness.light, Brightness.dark]) {
      for (final screen in _TeamProofScreen.values) {
        testWidgets('captures ${screen.name} ${size.width.toInt()}x'
            '${size.height.toInt()} ${brightness.name}', (tester) async {
          final previousComparator = goldenFileComparator;
          final positionGateway = _TeamPositionProofGateway(
            failure: screen == _TeamProofScreen.editFailed
                ? StateError('The member position changed.')
                : null,
          );
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
            _TeamProofScreen.team ||
            _TeamProofScreen.failed ||
            _TeamProofScreen.edit ||
            _TeamProofScreen.denied ||
            _TeamProofScreen.detail ||
            _TeamProofScreen.saved ||
            _TeamProofScreen.editFailed ||
            _TeamProofScreen.terminated ||
            _TeamProofScreen.dmFailed ||
            _TeamProofScreen.reports => TeamPage(
              onInvite: () {},
              onStartConversation: screen == _TeamProofScreen.dmFailed
                  ? _proofConversationFailure
                  : _proofConversation,
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
                  if (screen == _TeamProofScreen.failed) {
                    throw StateError('The team record is unavailable.');
                  }
                  switch (screen) {
                    case _TeamProofScreen.denied:
                      return _team();
                    case _TeamProofScreen.terminated:
                      return _team(
                        status: MemberPositionStatus.terminated,
                        reason: 'The employee position ended.',
                      );
                    case _TeamProofScreen.team:
                    case _TeamProofScreen.detail:
                    case _TeamProofScreen.saved:
                    case _TeamProofScreen.editFailed:
                    case _TeamProofScreen.dmFailed:
                    case _TeamProofScreen.edit:
                    case _TeamProofScreen.reports:
                    case _TeamProofScreen.failed:
                      return _team(
                        employeeTitle: positionGateway.employeeTitle,
                        employeeManagerPubkey:
                            positionGateway.employeeManagerPubkey,
                      );
                  }
                }),
                activeCommunityProvider.overrideWith((_) async => _community),
                userCacheProvider.overrideWith(_TeamProofUserCache.new),
                companyMemberWorkProvider.overrideWith((ref, _) async {
                  return screen == _TeamProofScreen.detail ||
                          screen == _TeamProofScreen.saved ||
                          screen == _TeamProofScreen.editFailed
                      ? [_proofWork()]
                      : const [];
                }),
                memberPositionRepositoryProvider.overrideWith(
                  (ref) => MemberPositionRepository(positionGateway),
                ),
                myPubkeyProvider.overrideWith(
                  (_) => screen == _TeamProofScreen.denied ? _member : _owner,
                ),
                agentDirectoryDisplayNamesProvider.overrideWith(
                  (_) => const {},
                ),
              ],
              child: RepaintBoundary(
                key: _captureRootKey,
                child: Directionality(
                  textDirection: TextDirection.ltr,
                  child: Stack(
                    fit: StackFit.expand,
                    children: [app, _TeamProofSystemBars(brightness)],
                  ),
                ),
              ),
            ),
          );
          await tester.pumpAndSettle();
          if (screen == _TeamProofScreen.failed) {
            expect(find.text('Your team is still here.'), findsOneWidget);
            expect(find.text('Retry team'), findsOneWidget);
          }
          if (screen == _TeamProofScreen.reports) {
            await tester.tap(find.text('Team Test Agent'));
            await tester.pumpAndSettle();
            await tester.tap(find.text('Direct reports'));
            await tester.pumpAndSettle();
          }
          if (screen == _TeamProofScreen.edit ||
              screen == _TeamProofScreen.denied ||
              screen == _TeamProofScreen.detail ||
              screen == _TeamProofScreen.saved ||
              screen == _TeamProofScreen.editFailed ||
              screen == _TeamProofScreen.terminated ||
              screen == _TeamProofScreen.dmFailed) {
            await tester.tap(find.text('Team Test Agent'));
            await tester.pumpAndSettle();
          }
          if (screen == _TeamProofScreen.edit) {
            await tester.tap(find.text('Edit position'));
            await tester.pumpAndSettle();
          }
          if (screen == _TeamProofScreen.saved ||
              screen == _TeamProofScreen.editFailed) {
            await tester.tap(find.text('Edit position'));
            await tester.pumpAndSettle();
            await tester.enterText(find.byType(TextField), 'Updated title');
            await tester.tap(find.text('Save position'));
            await tester.pumpAndSettle();
            expect(
              find.text(
                screen == _TeamProofScreen.saved
                    ? 'Position updated'
                    : 'Your changes were not saved',
              ),
              findsOneWidget,
            );
          }
          if (screen == _TeamProofScreen.denied) {
            await tester.tap(find.text('Edit position'));
            await tester.pumpAndSettle();
            expect(find.text('Today'), findsOneWidget);
            expect(
              find.text('You can view, but cannot change this'),
              findsOneWidget,
            );
          }
          if (screen == _TeamProofScreen.dmFailed) {
            await tester.tap(find.text('Message Team Test Agent'));
            await tester.pumpAndSettle();
            expect(
              find.text('Could not open the direct message'),
              findsOneWidget,
            );
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

enum _TeamProofScreen {
  team,
  failed,
  detail,
  terminated,
  reports,
  edit,
  saved,
  editFailed,
  dmFailed,
  denied,
}

class _TeamPositionProofGateway implements MemberPositionGateway {
  _TeamPositionProofGateway({this.failure});

  final Object? failure;
  String employeeTitle = 'Operations lead';
  String? employeeManagerPubkey = _owner;

  @override
  Future<List<NostrEvent>> fetch(NostrFilter filter) async => const [];

  @override
  Future<NostrEvent> publish({
    required int kind,
    required String content,
    required List<List<String>> tags,
  }) async {
    if (failure != null) throw failure!;
    final action = jsonDecode(content) as Map<String, dynamic>;
    employeeTitle = action['title'] as String;
    employeeManagerPubkey = action['managerPubkey'] as String?;
    return NostrEvent(
      id: _relay,
      pubkey: _relay,
      createdAt: 1,
      kind: kind,
      tags: tags,
      content: content,
      sig: '',
    );
  }
}

Future<void> _proofConversation(BuildContext context, String pubkey) async {}

Future<void> _proofConversationFailure(
  BuildContext context,
  String pubkey,
) async {
  throw StateError('The direct conversation is unavailable.');
}

CompanyTeamData _team({
  MemberPositionStatus status = MemberPositionStatus.active,
  String? reason,
  String employeeTitle = 'Operations lead',
  String? employeeManagerPubkey = _owner,
}) => CompanyTeamData(
  relaySelf: _relay,
  membershipSnapshotFound: true,
  hasUnpositionedAgents: false,
  members: [
    CompanyTeamMemberRecord(
      pubkey: _owner,
      kind: MemberPositionKind.human,
      position: _position(_owner, 'Company owner'),
      role: CommunityMemberRole.owner,
    ),
    CompanyTeamMemberRecord(
      pubkey: _employee,
      kind: MemberPositionKind.employee,
      position: _position(
        _employee,
        employeeTitle,
        managerPubkey: employeeManagerPubkey,
        status: status,
        reason: reason,
        kind: MemberPositionKind.employee,
      ),
      directoryName: 'Team Test Agent',
    ),
    CompanyTeamMemberRecord(
      pubkey: _member,
      kind: MemberPositionKind.human,
      position: _position(
        _member,
        'Team member',
        managerPubkey: status == MemberPositionStatus.terminated
            ? _owner
            : _employee,
      ),
      role: CommunityMemberRole.member,
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

CompanyWorkHeadRecord _proofWork() => CompanyWorkHeadRecord(
  workItemId: '123e4567-e89b-12d3-a456-426614174000',
  title: 'Current quarter client plan',
  status: 'active',
  assignedPubkeys: [_employee],
  channelId: '223e4567-e89b-12d3-a456-426614174000',
  channelName: 'sales',
  event: const NostrEvent(
    id: _relay,
    pubkey: _relay,
    createdAt: 1,
    kind: EventKind.workItemHead,
    tags: [],
    content: '',
    sig: '',
  ),
);

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
