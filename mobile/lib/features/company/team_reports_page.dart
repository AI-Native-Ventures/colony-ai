import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../shared/community/community_provider.dart';
import '../../shared/company/team/company_team_repository.dart';
import '../../shared/company/team/member_position_records.dart';
import '../../shared/profile/user_cache_provider.dart';
import '../../shared/profile/user_profile.dart';
import '../../shared/theme/theme.dart';
import '../../shared/utils/string_utils.dart';
import 'team_hero_gradient.dart';
import '../goals/goal_widgets.dart';

/// Lists the current real member-position records reporting to one member.
class TeamMemberReportsPage extends HookConsumerWidget {
  const TeamMemberReportsPage({
    required this.managerPubkey,
    required this.onOpenMember,
    this.onBack,
    super.key,
  });

  final String managerPubkey;
  final ValueChanged<String> onOpenMember;
  final VoidCallback? onBack;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final teamAsync = ref.watch(companyTeamProvider);
    final profiles = ref.watch(userCacheProvider);
    final communityName = ref.watch(activeCommunityProvider).value?.name;
    final team = teamAsync.asData?.value;
    final reports = team?.members
        .where(
          (member) =>
              member.position?.head.managerPubkey?.toLowerCase() ==
              managerPubkey.toLowerCase(),
        )
        .toList(growable: false);

    useEffect(() {
      final pubkeys = reports?.map((member) => member.pubkey).toList();
      if (pubkeys == null || pubkeys.isEmpty) return null;
      unawaited(ref.read(userCacheProvider.notifier).preload(pubkeys));
      return null;
    }, [reports?.map((member) => member.pubkey).join('\u0000')]);

    final managerProfile = profiles[managerPubkey.toLowerCase()];
    final managerName = managerProfile?.displayName?.trim().isNotEmpty == true
        ? managerProfile!.displayName!.trim()
        : shortPubkey(managerPubkey);

    return ColoredBox(
      color: context.mobileTokens.canvas,
      child: Column(
        children: [
          GoalPageHeader(
            title: 'Team reports',
            subtitle: communityName,
            onBack: onBack ?? () => unawaited(Navigator.of(context).maybePop()),
            backLabel: 'Back to detail',
          ),
          Expanded(
            child: teamAsync.when(
              loading: () =>
                  const Center(child: CircularProgressIndicator.adaptive()),
              error: (error, stackTrace) => Center(
                child: Padding(
                  padding: const EdgeInsets.all(Grid.gutter),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        'Direct reports could not load',
                        textAlign: TextAlign.center,
                        style: context.mobileTypography.goalDetailTitle,
                      ),
                      const SizedBox(height: Grid.md),
                      FilledButton(
                        onPressed: () => ref.invalidate(companyTeamProvider),
                        child: const Text('Try again'),
                      ),
                    ],
                  ),
                ),
              ),
              data: (data) {
                final currentReports = data.members
                    .where(
                      (member) =>
                          member.position?.head.managerPubkey?.toLowerCase() ==
                          managerPubkey.toLowerCase(),
                    )
                    .toList(growable: false);
                return ListView(
                  padding: const EdgeInsets.fromLTRB(
                    Grid.gutter,
                    Grid.xs,
                    Grid.gutter,
                    Grid.lg,
                  ),
                  children: [
                    Container(
                      padding: const EdgeInsets.all(Grid.gutter),
                      decoration: BoxDecoration(
                        gradient: teamHeroGradientFor(
                          Theme.of(context).brightness,
                        ),
                        borderRadius: BorderRadius.circular(Radii.card),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'REPORTS TO ${managerName.toUpperCase()}',
                            style: context.mobileTypography.companySection
                                .copyWith(color: context.mobileTokens.action),
                          ),
                          const SizedBox(height: Grid.xs),
                          Text(
                            'A clear line of support.',
                            style: context.mobileTypography.goalDetailTitle
                                .copyWith(
                                  color: context.mobileTokens.ink,
                                  fontSize: 28,
                                  height: 1.3,
                                ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: Grid.sm),
                    for (final member in currentReports)
                      _TeamReportRow(
                        member: member,
                        profile: profiles[member.pubkey],
                        onTap: () => onOpenMember(member.pubkey),
                      ),
                  ],
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _TeamReportRow extends StatelessWidget {
  const _TeamReportRow({
    required this.member,
    required this.profile,
    required this.onTap,
  });

  final CompanyTeamMemberRecord member;
  final UserProfile? profile;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    final name = profile?.displayName?.trim().isNotEmpty == true
        ? profile!.displayName!.trim()
        : member.directoryName?.trim().isNotEmpty == true
        ? member.directoryName!.trim()
        : shortPubkey(member.pubkey);
    final title =
        member.position?.head.title ??
        (member.kind == MemberPositionKind.employee ? 'AI employee' : 'Human');
    final subtitle = member.status == MemberPositionStatus.terminated
        ? '$title · Terminated'
        : '$title · ${member.kind == MemberPositionKind.employee ? 'AI employee' : 'Human'}';

    return Padding(
      padding: const EdgeInsets.only(bottom: Grid.sm),
      child: Material(
        color: tokens.paper,
        borderRadius: BorderRadius.circular(Radii.card),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(Radii.card),
          child: Container(
            constraints: const BoxConstraints(minHeight: 78),
            padding: const EdgeInsets.symmetric(
              horizontal: Grid.sm,
              vertical: Grid.xs,
            ),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(Radii.card),
              border: Border.all(color: tokens.line),
            ),
            child: Row(
              children: [
                Container(
                  width: 38,
                  height: 38,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: context.appColors.lilac.withValues(alpha: 0.35),
                    borderRadius: BorderRadius.circular(Radii.button),
                  ),
                  child: Text(
                    name.characters.first.toUpperCase(),
                    style: context.mobileTypography.goalCardTitle.copyWith(
                      color: tokens.action,
                    ),
                  ),
                ),
                const SizedBox(width: Grid.sm),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: context.mobileTypography.goalCardTitle.copyWith(
                          color: tokens.ink,
                        ),
                      ),
                      const SizedBox(height: Grid.xxs),
                      Text(
                        subtitle,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: context.mobileTypography.metadata.copyWith(
                          color: tokens.muted,
                        ),
                      ),
                    ],
                  ),
                ),
                Icon(LucideIcons.chevronRight, color: tokens.muted, size: 18),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
