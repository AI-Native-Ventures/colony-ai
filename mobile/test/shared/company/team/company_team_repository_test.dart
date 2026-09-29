import 'package:buzz/shared/community/community_membership_provider.dart';
import 'package:buzz/shared/company/team/company_team_repository.dart';
import 'package:buzz/shared/company/team/member_position_records.dart';
import 'package:buzz/shared/relay/nostr_models.dart';
import 'package:flutter_test/flutter_test.dart';

const _human =
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const _employee =
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const _worker =
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
const _bot = 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd';
const _relay =
    'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

void main() {
  test(
    'joins employee positions and excludes unpositioned worker identities',
    () {
      final team = composeCompanyTeamData(
        relaySelf: _relay,
        snapshot: const CommunityMembershipSnapshot(
          snapshotFound: true,
          members: [
            CommunityMember(pubkey: _human, role: CommunityMemberRole.owner),
            CommunityMember(
              pubkey: _employee,
              role: CommunityMemberRole.member,
            ),
            CommunityMember(pubkey: _worker, role: CommunityMemberRole.member),
            CommunityMember(
              pubkey: _bot,
              role: CommunityMemberRole.member,
              isBot: true,
            ),
          ],
        ),
        positions: [
          _employeePosition(),
          _position(
            pubkey: _bot,
            kind: MemberPositionKind.employee,
            title: 'Agent employee',
          ),
        ],
        agentPubkeys: {_employee, _worker, _bot},
        agentNames: {_employee: 'Agent Directory Name'},
      );

      expect(team.members.map((member) => member.pubkey).toSet(), {
        _human,
        _employee,
        _bot,
      });
      final employee = team.members.singleWhere(
        (member) => member.pubkey == _employee,
      );
      expect(employee.position?.head.title, 'Test employee');
      expect(employee.directoryName, 'Agent Directory Name');
      expect(team.hasUnpositionedAgents, isTrue);
    },
  );

  test('rejects a relay head that classifies an agent as a human', () {
    expect(
      () => composeCompanyTeamData(
        relaySelf: _relay,
        snapshot: const CommunityMembershipSnapshot(
          snapshotFound: true,
          members: [
            CommunityMember(
              pubkey: _employee,
              role: CommunityMemberRole.member,
            ),
          ],
        ),
        positions: [_humanPositionForEmployee()],
        agentPubkeys: {_employee},
      ),
      throwsA(isA<FormatException>()),
    );
  });

  test('does not list a position without membership or agent identity', () {
    final team = composeCompanyTeamData(
      relaySelf: _relay,
      snapshot: const CommunityMembershipSnapshot(
        snapshotFound: true,
        members: [
          CommunityMember(pubkey: _human, role: CommunityMemberRole.owner),
        ],
      ),
      positions: [_employeePosition()],
      agentPubkeys: const {},
    );

    expect(team.members.map((member) => member.pubkey), [_human]);
  });

  test('an employee position remains visible with bot membership role', () {
    final team = composeCompanyTeamData(
      relaySelf: _relay,
      snapshot: const CommunityMembershipSnapshot(
        snapshotFound: true,
        members: [
          CommunityMember(
            pubkey: _bot,
            role: CommunityMemberRole.member,
            isBot: true,
          ),
        ],
      ),
      positions: [
        _position(
          pubkey: _bot,
          kind: MemberPositionKind.employee,
          title: 'Must stay hidden',
        ),
      ],
      agentPubkeys: {_bot},
    );

    expect(team.members, hasLength(1));
    expect(team.members.single.pubkey, _bot);
    expect(team.members.single.kind, MemberPositionKind.employee);
  });
}

MemberPositionHeadRecord _employeePosition() => _position(
  pubkey: _employee,
  kind: MemberPositionKind.employee,
  title: 'Test employee',
);

MemberPositionHeadRecord _humanPositionForEmployee() => _position(
  pubkey: _employee,
  kind: MemberPositionKind.human,
  title: 'Test human',
);

MemberPositionHeadRecord _position({
  required String pubkey,
  required MemberPositionKind kind,
  required String title,
}) {
  final head = MemberPositionHead(
    schemaVersion: 1,
    pubkey: pubkey,
    title: title,
    kind: kind,
    status: MemberPositionStatus.active,
    sourceActionEventId: _relay,
    updatedAt: '2026-09-28T10:00:00Z',
  );
  return MemberPositionHeadRecord(
    dTag: memberPositionDTag(pubkey),
    head: head,
    event: NostrEvent(
      id: _relay,
      pubkey: _relay,
      createdAt: 1,
      kind: EventKind.memberPositionHead,
      tags: [
        ['d', memberPositionDTag(pubkey)],
      ],
      content: '',
      sig: '',
    ),
  );
}
