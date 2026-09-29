import 'package:flutter/foundation.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../community/community_membership_provider.dart';
import '../../mentions/agent_identity_provider.dart';
import '../../relay/relay.dart';
import '../goals/goal_repository.dart';
import 'member_position_records.dart';
import 'member_position_repository.dart';

@immutable
class CompanyTeamMemberRecord {
  const CompanyTeamMemberRecord({
    required this.pubkey,
    required this.kind,
    required this.position,
    this.role,
    this.directoryName,
  });

  final String pubkey;
  final MemberPositionKind kind;
  final MemberPositionHeadRecord? position;
  final CommunityMemberRole? role;
  final String? directoryName;

  MemberPositionStatus get status =>
      position?.head.status ?? MemberPositionStatus.active;
}

@immutable
class CompanyTeamData {
  const CompanyTeamData({
    required this.relaySelf,
    required this.membershipSnapshotFound,
    required this.members,
    required this.hasUnpositionedAgents,
  });

  final String relaySelf;
  final bool membershipSnapshotFound;
  final List<CompanyTeamMemberRecord> members;

  /// True when an agent identity has no employee-position head.
  /// The current mobile relay reads cannot distinguish those employees from workers.
  final bool hasUnpositionedAgents;
}

final companyTeamProvider = FutureProvider.autoDispose<CompanyTeamData>((
  ref,
) async {
  ref.watch(relayConfigProvider);
  final snapshotFuture = ref.watch(communityMembershipProvider.future);
  final relaySelfFuture = ref.watch(goalRelaySelfProvider.future);
  final positionsFuture = ref.watch(memberPositionHeadsProvider.future);
  final agentsFuture = ref.watch(agentDirectoryProvider.future);
  final ownersFuture = ref.watch(agentOwnersProvider.future);

  final snapshot = await snapshotFuture;
  if (!snapshot.snapshotFound) {
    throw StateError('The current community member list is unavailable.');
  }
  final relaySelf = await relaySelfFuture;
  if (relaySelf == null) {
    throw StateError('This relay does not advertise a signing identity.');
  }
  final positions = await positionsFuture;
  final agents = await agentsFuture;
  final owners = await ownersFuture;
  final agentPubkeys = <String>{
    for (final agent in agents) agent.pubkey.toLowerCase(),
    ...owners.keys.map((pubkey) => pubkey.toLowerCase()),
  };
  final agentNames = <String, String>{
    for (final agent in agents)
      if (agent.displayName?.trim().isNotEmpty == true)
        agent.pubkey.toLowerCase(): agent.displayName!.trim(),
  };
  return composeCompanyTeamData(
    relaySelf: relaySelf,
    snapshot: snapshot,
    positions: positions,
    agentPubkeys: agentPubkeys,
    agentNames: agentNames,
  );
});

/// Joins current membership and signed position heads by pubkey.
/// Unpositioned agent identities stay out of the Team list until the relay can
/// distinguish employees from runtime workers for mobile clients.
@visibleForTesting
CompanyTeamData composeCompanyTeamData({
  required String relaySelf,
  required CommunityMembershipSnapshot snapshot,
  required List<MemberPositionHeadRecord> positions,
  required Set<String> agentPubkeys,
  Map<String, String> agentNames = const {},
}) {
  final byPubkey = <String, MemberPositionHeadRecord>{};
  for (final position in positions) {
    final pubkey = position.head.pubkey.toLowerCase();
    if (byPubkey.containsKey(pubkey)) {
      throw const FormatException(
        'The relay returned more than one current member position.',
      );
    }
    byPubkey[pubkey] = position;
  }
  final normalizedAgents = agentPubkeys
      .map((pubkey) => pubkey.toLowerCase())
      .toSet();
  final normalizedAgentNames = {
    for (final entry in agentNames.entries)
      entry.key.toLowerCase(): entry.value,
  };
  final membershipByPubkey = {
    for (final member in snapshot.members) member.pubkey.toLowerCase(): member,
  };
  final members = <String, CompanyTeamMemberRecord>{};

  for (final member in snapshot.members) {
    final pubkey = member.pubkey.toLowerCase();
    final position = byPubkey[pubkey];
    if (position?.head.kind == MemberPositionKind.employee) continue;
    if (member.isBot) continue;
    if (normalizedAgents.contains(pubkey)) {
      if (position?.head.kind == MemberPositionKind.human) {
        throw const FormatException(
          'The relay returned a human position for an agent identity.',
        );
      }
      continue;
    }
    members[pubkey] = CompanyTeamMemberRecord(
      pubkey: pubkey,
      kind: MemberPositionKind.human,
      position: position,
      role: member.role,
    );
  }

  for (final position in positions) {
    if (position.head.kind != MemberPositionKind.employee) continue;
    final pubkey = position.head.pubkey.toLowerCase();
    if (!membershipByPubkey.containsKey(pubkey) &&
        !normalizedAgents.contains(pubkey)) {
      continue;
    }
    members[pubkey] = CompanyTeamMemberRecord(
      pubkey: pubkey,
      kind: MemberPositionKind.employee,
      position: position,
      role: membershipByPubkey[pubkey]?.role,
      directoryName: normalizedAgentNames[pubkey],
    );
  }

  final unpositionedAgents = normalizedAgents.any(
    (pubkey) => byPubkey[pubkey]?.head.kind != MemberPositionKind.employee,
  );
  final result = members.values.toList()
    ..sort((left, right) => left.pubkey.compareTo(right.pubkey));
  return CompanyTeamData(
    relaySelf: relaySelf.toLowerCase(),
    membershipSnapshotFound: snapshot.snapshotFound,
    members: List.unmodifiable(result),
    hasUnpositionedAgents: unpositionedAgents,
  );
}

bool canManageCompanyTeam(CommunityMemberRole? role) =>
    role == CommunityMemberRole.owner || role == CommunityMemberRole.admin;
