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
import '../goals/goal_widgets.dart';
import 'team_member_detail_page.dart';
import 'team_reports_page.dart';
import 'team_hero_gradient.dart';

/// Mobile team flow backed by relay membership and signed member positions.
class TeamPage extends HookConsumerWidget {
  const TeamPage({
    required this.onInvite,
    this.onStartConversation,
    this.onBackToCompany,
    super.key,
  });

  final VoidCallback onInvite;
  final Future<void> Function(BuildContext context, String pubkey)?
  onStartConversation;

  /// Returns from the team flow to the Company hub.
  final VoidCallback? onBackToCompany;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final routes = useState<List<_TeamFlowRoute>>([_TeamFlowRoute.list()]);

    void push(_TeamFlowRoute route) {
      routes.value = [...routes.value, route];
    }

    void pop() {
      if (routes.value.length == 1) {
        if (onBackToCompany != null) {
          onBackToCompany!();
        } else {
          unawaited(Navigator.of(context).maybePop());
        }
        return;
      }
      routes.value = routes.value.sublist(0, routes.value.length - 1);
    }

    final current = routes.value.last;
    return switch (current.kind) {
      _TeamFlowKind.list => _TeamHomePage(
        onInvite: onInvite,
        onBackToCompany: pop,
        onOpenMember: (pubkey) => push(_TeamFlowRoute.member(pubkey)),
      ),
      _TeamFlowKind.member => TeamMemberDetailPage(
        pubkey: current.pubkey!,
        onInvite: onInvite,
        onStartConversation: onStartConversation,
        onBack: pop,
        onOpenReports: (pubkey) => push(_TeamFlowRoute.reports(pubkey)),
      ),
      _TeamFlowKind.reports => TeamMemberReportsPage(
        managerPubkey: current.pubkey!,
        onBack: pop,
        onOpenMember: (pubkey) => push(_TeamFlowRoute.member(pubkey)),
      ),
    };
  }
}

enum _TeamFlowKind { list, member, reports }

class _TeamFlowRoute {
  const _TeamFlowRoute.list() : kind = _TeamFlowKind.list, pubkey = null;
  const _TeamFlowRoute.member(this.pubkey) : kind = _TeamFlowKind.member;
  const _TeamFlowRoute.reports(this.pubkey) : kind = _TeamFlowKind.reports;

  final _TeamFlowKind kind;
  final String? pubkey;
}

class _TeamHomePage extends HookConsumerWidget {
  const _TeamHomePage({
    required this.onInvite,
    required this.onBackToCompany,
    required this.onOpenMember,
  });

  final VoidCallback onInvite;
  final VoidCallback onBackToCompany;
  final ValueChanged<String> onOpenMember;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final teamAsync = ref.watch(companyTeamProvider);
    final communityName = ref.watch(activeCommunityProvider).value?.name;
    final team = teamAsync.asData?.value;

    useEffect(() {
      if (team == null) return null;
      unawaited(
        ref
            .read(userCacheProvider.notifier)
            .preload(team.members.map((member) => member.pubkey).toList()),
      );
      return null;
    }, [team?.members.map((member) => member.pubkey).join('\u0000')]);

    return ColoredBox(
      color: context.mobileTokens.canvas,
      child: Column(
        children: [
          GoalPageHeader(
            title: 'Your team',
            subtitle: communityName,
            onBack: onBackToCompany,
            backLabel: 'Back to company',
          ),
          Expanded(
            child: teamAsync.when(
              loading: () =>
                  const Center(child: CircularProgressIndicator.adaptive()),
              error: (error, stackTrace) => _TeamLoadFailure(
                onRetry: () => ref.invalidate(companyTeamProvider),
              ),
              data: (data) => _TeamList(team: data, onOpenMember: onOpenMember),
            ),
          ),
        ],
      ),
    );
  }
}

class _TeamList extends ConsumerWidget {
  const _TeamList({required this.team, required this.onOpenMember});

  final CompanyTeamData team;
  final ValueChanged<String> onOpenMember;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profiles = ref.watch(userCacheProvider);
    final members = [...team.members]
      ..sort((left, right) {
        final leftName = _teamMemberName(profiles[left.pubkey], left);
        final rightName = _teamMemberName(profiles[right.pubkey], right);
        return leftName.toLowerCase().compareTo(rightName.toLowerCase());
      });

    return ListView(
      padding: const EdgeInsets.fromLTRB(
        Grid.gutter,
        Grid.xs,
        Grid.gutter,
        Grid.lg,
      ),
      children: [
        const _TeamHero(),
        const SizedBox(height: Grid.sm),
        for (final member in members)
          _TeamMemberRow(
            member: member,
            profile: profiles[member.pubkey],
            manager: member.position?.head.managerPubkey == null
                ? null
                : team.members
                      .where(
                        (candidate) =>
                            candidate.pubkey ==
                            member.position!.head.managerPubkey!.toLowerCase(),
                      )
                      .firstOrNull,
            managerProfile: member.position?.head.managerPubkey == null
                ? null
                : profiles[member.position!.head.managerPubkey!.toLowerCase()],
            onTap: () => onOpenMember(member.pubkey),
          ),
      ],
    );
  }
}

class _TeamHero extends StatelessWidget {
  const _TeamHero();

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Container(
      padding: const EdgeInsets.all(Grid.gutter),
      decoration: BoxDecoration(
        gradient: teamHeroGradientFor(Theme.of(context).brightness),
        borderRadius: BorderRadius.circular(Radii.card),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'PEOPLE & AI',
            style: context.mobileTypography.companySection.copyWith(
              color: tokens.action,
            ),
          ),
          const SizedBox(height: Grid.xs),
          Text(
            'A team that moves together.',
            style: context.mobileTypography.goalDetailTitle.copyWith(
              color: tokens.ink,
              fontSize: 28,
              height: 1.3,
            ),
          ),
        ],
      ),
    );
  }
}

class _TeamMemberRow extends StatelessWidget {
  const _TeamMemberRow({
    required this.member,
    required this.profile,
    required this.manager,
    required this.managerProfile,
    required this.onTap,
  });

  final CompanyTeamMemberRecord member;
  final UserProfile? profile;
  final CompanyTeamMemberRecord? manager;
  final UserProfile? managerProfile;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    final name = _teamMemberName(profile, member);
    final title =
        member.position?.head.title ??
        (member.kind == MemberPositionKind.employee ? 'AI employee' : 'Human');
    final subtitle = switch (member.status) {
      MemberPositionStatus.terminated => '$title · Terminated',
      MemberPositionStatus.paused => '$title · Paused',
      MemberPositionStatus.active when manager != null =>
        '$title · Reports to ${_teamMemberName(managerProfile, manager!)}',
      MemberPositionStatus.active =>
        '$title · ${member.kind == MemberPositionKind.employee ? 'AI employee' : 'Human'}',
    };

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
                    _teamInitial(name),
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

class _TeamLoadFailure extends StatelessWidget {
  const _TeamLoadFailure({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => ListView(
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
          gradient: teamHeroGradientFor(Theme.of(context).brightness),
          borderRadius: BorderRadius.circular(Radii.card),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'TEAM UNAVAILABLE',
              style: context.mobileTypography.companySection.copyWith(
                color: context.mobileTokens.action,
              ),
            ),
            const SizedBox(height: Grid.xs),
            Text(
              'Your team is still here.',
              style: context.mobileTypography.goalDetailTitle.copyWith(
                color: context.mobileTokens.ink,
                fontSize: 28,
                height: 1.3,
              ),
            ),
            const SizedBox(height: Grid.xs),
            Text(
              'We could not load the company directory.',
              style: context.mobileTypography.body.copyWith(
                color: context.mobileTokens.ink,
              ),
            ),
          ],
        ),
      ),
      const SizedBox(height: Grid.xs),
      Container(
        decoration: BoxDecoration(
          color: context.mobileTokens.paper,
          borderRadius: BorderRadius.circular(Radii.card),
          border: Border.all(color: context.mobileTokens.line),
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(Radii.card),
          child: Row(
            children: [
              Container(width: 3, color: context.mobileTokens.error),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.all(Grid.sm),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Connection failed',
                        style: context.mobileTypography.goalCardTitle.copyWith(
                          color: context.mobileTokens.ink,
                        ),
                      ),
                      const SizedBox(height: Grid.xxs),
                      Text(
                        'Missing data is not shown as an empty team.',
                        style: context.mobileTypography.body.copyWith(
                          color: context.mobileTokens.muted,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
      const SizedBox(height: Grid.md),
      FilledButton(onPressed: onRetry, child: const Text('Retry team')),
    ],
  );
}

String _teamMemberName(UserProfile? profile, CompanyTeamMemberRecord member) {
  if (profile?.displayName?.trim().isNotEmpty == true) {
    return profile!.displayName!.trim();
  }
  if (member.directoryName?.trim().isNotEmpty == true) {
    return member.directoryName!.trim();
  }
  return shortPubkey(member.pubkey);
}

String _teamInitial(String name) =>
    name.isEmpty ? '?' : name.characters.first.toUpperCase();
