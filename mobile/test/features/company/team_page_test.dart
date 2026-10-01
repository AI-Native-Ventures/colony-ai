import 'dart:convert';

import 'package:buzz/features/company/team_page.dart';
import 'package:buzz/shared/community/community.dart';
import 'package:buzz/shared/community/community_membership_provider.dart';
import 'package:buzz/shared/community/community_provider.dart';
import 'package:buzz/shared/company/team/company_team_repository.dart';
import 'package:buzz/shared/company/team/member_position_records.dart';
import 'package:buzz/shared/company/team/member_position_repository.dart';
import 'package:buzz/shared/company/work/company_work_records.dart';
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
  testWidgets('shows real positions and includes terminated employees', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      _teamApp(
        teamData: _team(
          status: MemberPositionStatus.terminated,
          reason: 'The employee role ended.',
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Your team'), findsOneWidget);
    expect(find.text('A team that moves together.'), findsOneWidget);
    expect(find.text('Owner Test'), findsOneWidget);
    expect(find.text('Agent Test'), findsOneWidget);
    expect(find.text('Member Test'), findsOneWidget);
    expect(find.text('Operations lead · Terminated'), findsOneWidget);
  });

  testWidgets('opens profile, shows direct reports, and opens a conversation', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    String? openedPubkey;
    await tester.pumpWidget(
      _teamApp(onStartConversation: (_, pubkey) async => openedPubkey = pubkey),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Agent Test'));
    await tester.pumpAndSettle();

    expect(find.text('AI EMPLOYEE'), findsOneWidget);
    expect(find.text('Operations lead'), findsOneWidget);
    expect(find.text('Reports to'), findsOneWidget);
    expect(find.text('Status'), findsOneWidget);
    expect(find.text('Active'), findsOneWidget);
    expect(find.text('1 position'), findsOneWidget);

    await tester.tap(find.text('Direct reports'));
    await tester.pumpAndSettle();
    expect(find.text('A clear line of support.'), findsOneWidget);
    expect(find.text('Member Test'), findsOneWidget);
    await tester.tap(find.text('Member Test'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('goal-page-back')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('goal-page-back')));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Message Agent Test'));
    await tester.pumpAndSettle();
    expect(openedPubkey, _employee);
  });

  testWidgets('keeps profile actions above the mobile navigation bar', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      _teamApp(
        workRecords: [_currentWorkRecord()],
        onStartConversation: (_, _) async {},
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Agent Test'));
    await tester.pumpAndSettle();

    expect(
      tester.getRect(find.text('Message Agent Test')).bottom,
      lessThan(760),
    );
    expect(tester.getRect(find.text('Edit position')).bottom, lessThan(760));
  });

  testWidgets('keeps failed DM opening distinct from sending a message', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    var attempts = 0;
    await tester.pumpWidget(
      _teamApp(
        onStartConversation: (_, _) async {
          attempts++;
          if (attempts == 1) throw StateError('offline');
        },
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Agent Test'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Message Agent Test'));
    await tester.pumpAndSettle();

    expect(find.text('Could not open the direct message'), findsOneWidget);
    expect(
      find.text('No message was sent. Retry opening the conversation.'),
      findsOneWidget,
    );
    await tester.tap(find.text('Retry opening conversation'));
    await tester.pumpAndSettle();
    expect(attempts, 2);
    expect(find.text('Message Agent Test'), findsOneWidget);
  });

  testWidgets('preserves the member current work summary', (tester) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(_teamApp(workRecords: [_currentWorkRecord()]));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Agent Test'));
    await tester.pumpAndSettle();

    expect(find.text('Doing now'), findsOneWidget);
    expect(find.text('Current quarter client plan'), findsOneWidget);
  });

  testWidgets('shows the read-only terminated detail and its reason', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      _teamApp(
        teamData: _team(
          status: MemberPositionStatus.terminated,
          reason: 'The employee role ended.',
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Agent Test'));
    await tester.pumpAndSettle();

    expect(find.text('TERMINATED'), findsOneWidget);
    expect(find.text('No longer active'), findsOneWidget);
    expect(find.text('Reason: The employee role ended.'), findsOneWidget);
    expect(find.text('No new assignments'), findsOneWidget);
    expect(find.text('Retained'), findsOneWidget);
    expect(find.text('Edit position'), findsNothing);
  });

  testWidgets('enforces role access on the edit route', (tester) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(_teamApp(currentPubkey: _member));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Agent Test'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Edit position'));
    await tester.pumpAndSettle();

    expect(find.text('You can view, but cannot change this'), findsOneWidget);
    expect(
      find.text(
        'An authorized person can make the update. Your draft has been kept.',
      ),
      findsOneWidget,
    );
    expect(find.text('Back to the record'), findsOneWidget);
    expect(
      tester.getTopLeft(find.text('You can view, but cannot change this')).dy,
      lessThan(160),
    );
  });

  testWidgets('publishes title and manager against the exact signed head', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final gateway = _TeamPositionGateway();
    await tester.pumpWidget(_teamApp(gateway: gateway));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Agent Test'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Edit position'));
    await tester.pumpAndSettle();

    final title = find.byType(TextField);
    await tester.enterText(title, 'Research director');
    await tester.tap(find.byType(DropdownButtonFormField<String?>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('No manager').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Save position'));
    await tester.pumpAndSettle();

    expect(gateway.publishedKind, EventKind.memberPositionAction);
    expect(gateway.publishedTags, [
      ['d', memberPositionDTag(_employee)],
    ]);
    final action =
        jsonDecode(gateway.publishedContent!) as Map<String, dynamic>;
    expect(action['expectedHeadEventId'], _relay);
    expect(action['action'], MemberPositionActionKind.setPosition.wireValue);
    expect(action['title'], 'Research director');
    expect(action['managerPubkey'], isNull);
    expect(find.text('Position updated'), findsOneWidget);
  });

  testWidgets('retains typed fields and exact head when save fails', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final gateway = _TeamPositionGateway(failure: StateError('conflict'));
    await tester.pumpWidget(_teamApp(gateway: gateway));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Agent Test'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Edit position'));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), 'Research director');
    await tester.tap(find.text('Save position'));
    await tester.pumpAndSettle();

    expect(gateway.publishedContent, isNotNull);
    expect(find.text('Your changes were not saved'), findsOneWidget);
    expect(
      find.text(
        'Everything you typed is kept. Try again when the connection returns.',
      ),
      findsOneWidget,
    );
    expect(
      tester.widget<TextField>(find.byType(TextField)).controller!.text,
      'Research director',
    );
    final action =
        jsonDecode(gateway.publishedContent!) as Map<String, dynamic>;
    expect(action['expectedHeadEventId'], _relay);
    expect(action['title'], 'Research director');
  });
}

Widget _teamApp({
  String? currentPubkey,
  CompanyTeamData? teamData,
  Future<void> Function(BuildContext context, String pubkey)?
  onStartConversation,
  _TeamPositionGateway? gateway,
  List<CompanyWorkHeadRecord> workRecords = const [],
}) => ProviderScope(
  key: ValueKey(teamData ?? currentPubkey ?? 'team-app'),
  overrides: [
    companyTeamProvider.overrideWith((ref) async => teamData ?? _team()),
    activeCommunityProvider.overrideWith((ref) async => _community),
    userCacheProvider.overrideWith(_TeamUserCache.new),
    myPubkeyProvider.overrideWith((ref) => currentPubkey ?? _owner),
    companyMemberWorkProvider.overrideWith((ref, _) async => workRecords),
    if (gateway != null)
      memberPositionRepositoryProvider.overrideWith(
        (ref) => MemberPositionRepository(gateway),
      ),
  ],
  child: MaterialApp(
    theme: AppTheme.light(mobileTokens: MobileDesignTokens.light),
    home: Scaffold(
      body: TeamPage(onInvite: () {}, onStartConversation: onStartConversation),
    ),
  ),
);

CompanyWorkHeadRecord _currentWorkRecord() => CompanyWorkHeadRecord(
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
    CompanyTeamMemberRecord(
      pubkey: _member,
      kind: MemberPositionKind.human,
      position: _position(_member, 'Creative lead', managerPubkey: _employee),
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

class _TeamPositionGateway implements MemberPositionGateway {
  _TeamPositionGateway({this.failure});

  final Object? failure;
  int? publishedKind;
  String? publishedContent;
  List<List<String>>? publishedTags;

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
    publishedTags = tags;
    if (failure != null) throw failure!;
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
