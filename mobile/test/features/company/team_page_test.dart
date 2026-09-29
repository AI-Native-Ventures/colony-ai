import 'package:buzz/features/company/team_page.dart';
import 'package:buzz/shared/community/community.dart';
import 'package:buzz/shared/community/community_membership_provider.dart';
import 'package:buzz/shared/community/community_provider.dart';
import 'package:buzz/shared/company/team/company_team_repository.dart';
import 'package:buzz/shared/company/team/member_position_records.dart';
import 'package:buzz/shared/profile/user_cache_provider.dart';
import 'package:buzz/shared/profile/user_profile.dart';
import 'package:buzz/shared/relay/nostr_models.dart';
import 'package:buzz/shared/relay/relay_provider.dart';
import 'package:buzz/shared/theme/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

const _owner =
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const _employee =
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const _member =
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
const _relay =
    'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd';

final _community = Community(
  id: 'team-test',
  name: 'Test company',
  relayUrl: 'wss://relay.example',
  addedAt: DateTime.utc(2026, 9, 28),
);

void main() {
  testWidgets('shows real team counts and filters people from employees', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(_teamApp(brightness: Brightness.light));
    await tester.pumpAndSettle();

    expect(find.text('Your team'), findsOneWidget);
    expect(find.text('1 agent · 2 people in this view'), findsOneWidget);
    expect(find.text('Owner Test'), findsOneWidget);
    expect(find.text('Agent Test'), findsOneWidget);
    expect(find.text('Member Test'), findsOneWidget);

    await tester.tap(find.widgetWithText(ChoiceChip, 'Agents'));
    await tester.pumpAndSettle();

    expect(find.text('Agent Test'), findsOneWidget);
    expect(find.text('Owner Test'), findsNothing);
    expect(find.text('Member Test'), findsNothing);

    await tester.tap(find.widgetWithText(ChoiceChip, 'People'));
    await tester.pumpAndSettle();

    expect(find.text('Owner Test'), findsOneWidget);
    expect(find.text('Member Test'), findsOneWidget);
    expect(find.text('Agent Test'), findsNothing);
  });

  testWidgets('opens a real profile and starts a direct conversation', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    String? openedPubkey;
    await tester.pumpWidget(
      _teamApp(
        brightness: Brightness.dark,
        onStartConversation: (_, pubkey) async => openedPubkey = pubkey,
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Agent Test'));
    await tester.pumpAndSettle();

    expect(find.text('Team member'), findsOneWidget);
    expect(find.text('Agent Test'), findsOneWidget);
    expect(find.text('Operations lead'), findsOneWidget);
    expect(find.text('AI agent'), findsOneWidget);
    expect(find.text('Reports to'), findsOneWidget);
    expect(find.text('Owner Test'), findsOneWidget);
    await tester.tap(find.text('Start a conversation'));
    await tester.pumpAndSettle();
    expect(openedPubkey, _employee);
  });

  testWidgets('a member sees the designed denied state and can return', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      _teamApp(brightness: Brightness.light, currentPubkey: _member),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Agent Test'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Profile options'));
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('goal-page-back')), findsNothing);
    expect(find.byTooltip('Profile options'), findsNothing);
    expect(find.text('You can view, but not change this'), findsOneWidget);
    expect(
      find.text('An owner or authorized manager can update this record.'),
      findsOneWidget,
    );
    await tester.tap(find.text('Back to detail'));
    await tester.pumpAndSettle();
    expect(find.text('You can view, but not change this'), findsNothing);
    expect(find.text('Agent Test'), findsOneWidget);
  });

  testWidgets('paused profiles use the frozen read-only state', (tester) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      _teamApp(
        brightness: Brightness.light,
        teamData: _team(
          status: MemberPositionStatus.paused,
          reason: 'Waiting for a planned review.',
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Agent Test'));
    await tester.pumpAndSettle();

    expect(find.text('Paused'), findsOneWidget);
    expect(find.text('Waiting for a planned review.'), findsNothing);
    expect(find.text('No new runs start until you resume it.'), findsOneWidget);
    expect(find.text('Resume'), findsNothing);
    await tester.tap(find.text('Back to team'));
    await tester.pumpAndSettle();
  });

  testWidgets('terminated employees are not reachable from the team list', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      _teamApp(
        brightness: Brightness.light,
        teamData: _team(
          status: MemberPositionStatus.terminated,
          reason: 'The employee role ended.',
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('0 agents · 2 people in this view'), findsOneWidget);
    expect(find.text('Agent Test'), findsNothing);
    expect(find.text('The employee role ended.'), findsNothing);
  });
}

Widget _teamApp({
  required Brightness brightness,
  String? currentPubkey,
  CompanyTeamData? teamData,
  Future<void> Function(BuildContext context, String pubkey)?
  onStartConversation,
}) => ProviderScope(
  key: ValueKey(teamData ?? brightness),
  overrides: [
    companyTeamProvider.overrideWith((ref) async => teamData ?? _team()),
    activeCommunityProvider.overrideWith((ref) async => _community),
    userCacheProvider.overrideWith(_TeamUserCache.new),
    if (currentPubkey != null)
      myPubkeyProvider.overrideWith((ref) => currentPubkey),
  ],
  child: MaterialApp(
    theme: brightness == Brightness.light
        ? AppTheme.light(mobileTokens: MobileDesignTokens.light)
        : AppTheme.dark(mobileTokens: MobileDesignTokens.dark),
    home: Scaffold(
      body: TeamPage(onInvite: () {}, onStartConversation: onStartConversation),
    ),
  ),
);

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
      role: CommunityMemberRole.owner,
    ),
    CompanyTeamMemberRecord(
      pubkey: _employee,
      kind: MemberPositionKind.employee,
      position: _position(
        _employee,
        'Operations lead',
        managerPubkey: _owner,
        kind: MemberPositionKind.employee,
        status: status,
        reason: reason,
      ),
    ),
    const CompanyTeamMemberRecord(
      pubkey: _member,
      kind: MemberPositionKind.human,
      position: null,
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

class _TeamUserCache extends UserCacheNotifier {
  @override
  Map<String, UserProfile> build() => const {
    _owner: UserProfile(pubkey: _owner, displayName: 'Owner Test'),
    _employee: UserProfile(pubkey: _employee, displayName: 'Agent Test'),
    _member: UserProfile(pubkey: _member, displayName: 'Member Test'),
  };

  @override
  Future<bool> preload(List<String> pubkeys) async => true;
}
