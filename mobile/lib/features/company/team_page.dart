import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../shared/community/community_provider.dart';
import '../../shared/company/team/company_team_repository.dart';
import '../../shared/company/team/member_position_records.dart';
import '../../shared/company/team/member_position_repository.dart';
import '../../shared/identity/identity_components.dart';
import '../../shared/mentions/agent_identity_provider.dart';
import '../../shared/profile/user_cache_provider.dart';
import '../../shared/profile/user_profile.dart';
import '../../shared/relay/relay_provider.dart';
import '../../shared/theme/theme.dart';
import '../../shared/utils/string_utils.dart';
import '../../shared/widgets/buzz_loading_indicator.dart';
import '../goals/goal_widgets.dart';

enum _TeamFilter { everyone, agents, people }

/// Mobile team list backed by relay membership and signed member positions.
class TeamPage extends HookConsumerWidget {
  const TeamPage({required this.onInvite, this.onStartConversation, super.key});

  final VoidCallback onInvite;
  final Future<void> Function(BuildContext context, String pubkey)?
  onStartConversation;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final teamAsync = ref.watch(companyTeamProvider);
    final filter = useState(_TeamFilter.everyone);
    final searchController = useTextEditingController();
    final searchQuery = useState('');
    final team = teamAsync.asData?.value;

    useEffect(() {
      if (team == null) return null;
      final pubkeys = team.members.map((member) => member.pubkey).toList();
      unawaited(ref.read(userCacheProvider.notifier).preload(pubkeys));
      return null;
    }, [team?.members.map((member) => member.pubkey).join('\u0000')]);

    return ColoredBox(
      color: context.mobileTokens.canvas,
      child: Column(
        children: [
          GoalPageHeader(
            title: 'Your team',
            subtitle: 'People and agents, side by side',
            onBack: () => unawaited(Navigator.of(context).maybePop()),
            backLabel: 'Back to company',
            action: onInvite,
            actionLabel: 'Add a team member',
          ),
          Expanded(
            child: teamAsync.when(
              loading: () => const Center(
                child: BuzzLoadingIndicator(
                  size: 48,
                  semanticLabel: 'Loading the team',
                ),
              ),
              error: (_, _) => const SizedBox.shrink(),
              data: (data) => _TeamList(
                team: data,
                filter: filter.value,
                searchController: searchController,
                searchQuery: searchQuery.value,
                onFilterChanged: (value) => filter.value = value,
                onSearchChanged: (value) => searchQuery.value = value,
                onInvite: onInvite,
                onStartConversation: onStartConversation,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _TeamList extends ConsumerWidget {
  const _TeamList({
    required this.team,
    required this.filter,
    required this.searchController,
    required this.searchQuery,
    required this.onFilterChanged,
    required this.onSearchChanged,
    required this.onInvite,
    required this.onStartConversation,
  });

  final CompanyTeamData team;
  final _TeamFilter filter;
  final TextEditingController searchController;
  final String searchQuery;
  final ValueChanged<_TeamFilter> onFilterChanged;
  final ValueChanged<String> onSearchChanged;
  final VoidCallback onInvite;
  final Future<void> Function(BuildContext context, String pubkey)?
  onStartConversation;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profiles = ref.watch(userCacheProvider);
    final currentMembers = team.members
        .where((member) => member.status != MemberPositionStatus.terminated)
        .toList(growable: false);
    final humans = currentMembers
        .where((member) => member.kind == MemberPositionKind.human)
        .toList();
    final agents = currentMembers
        .where((member) => member.kind == MemberPositionKind.employee)
        .toList();
    final visible =
        currentMembers.where((member) {
          final kindMatches = switch (filter) {
            _TeamFilter.everyone => true,
            _TeamFilter.agents => member.kind == MemberPositionKind.employee,
            _TeamFilter.people => member.kind == MemberPositionKind.human,
          };
          if (!kindMatches) return false;
          final profile = profiles[member.pubkey];
          final name = _displayName(
            profile,
            member.directoryName,
            member.pubkey,
          );
          return name.toLowerCase().contains(searchQuery.trim().toLowerCase());
        }).toList()..sort((left, right) {
          final leftName = _displayName(
            profiles[left.pubkey],
            left.directoryName,
            left.pubkey,
          );
          final rightName = _displayName(
            profiles[right.pubkey],
            right.directoryName,
            right.pubkey,
          );
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
        _TeamBanner(humans: humans, agents: agents),
        const SizedBox(height: Grid.md),
        TextField(
          controller: searchController,
          onChanged: onSearchChanged,
          textInputAction: TextInputAction.search,
          decoration: InputDecoration(
            prefixIcon: const Icon(LucideIcons.search, size: Grid.md),
            hintText: 'Find a person or agent',
            filled: true,
            fillColor: context.mobileTokens.paper,
            contentPadding: const EdgeInsets.symmetric(
              horizontal: Grid.sm,
              vertical: Grid.xs,
            ),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(Radii.button),
              borderSide: BorderSide(color: context.mobileTokens.line),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(Radii.button),
              borderSide: BorderSide(color: context.mobileTokens.line),
            ),
          ),
        ),
        const SizedBox(height: Grid.sm),
        Wrap(
          spacing: Grid.xs,
          children: [
            _TeamFilterChip(
              label: 'Everyone',
              selected: filter == _TeamFilter.everyone,
              onSelected: () => onFilterChanged(_TeamFilter.everyone),
            ),
            _TeamFilterChip(
              label: 'Agents',
              selected: filter == _TeamFilter.agents,
              onSelected: () => onFilterChanged(_TeamFilter.agents),
            ),
            _TeamFilterChip(
              label: 'People',
              selected: filter == _TeamFilter.people,
              onSelected: () => onFilterChanged(_TeamFilter.people),
            ),
          ],
        ),
        const SizedBox(height: Grid.xs),
        for (final member in visible)
          _TeamRow(
            member: member,
            onTap: () => Navigator.of(context).push<void>(
              MaterialPageRoute<void>(
                builder: (_) => TeamMemberDetailPage(
                  pubkey: member.pubkey,
                  onInvite: onInvite,
                  onStartConversation: onStartConversation,
                ),
              ),
            ),
          ),
      ],
    );
  }
}

class _TeamBanner extends StatelessWidget {
  const _TeamBanner({required this.humans, required this.agents});

  final List<CompanyTeamMemberRecord> humans;
  final List<CompanyTeamMemberRecord> agents;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    final members = [...agents, ...humans].take(3).toList();
    return Container(
      constraints: const BoxConstraints(minHeight: 88),
      padding: const EdgeInsets.symmetric(
        horizontal: Grid.md,
        vertical: Grid.sm,
      ),
      decoration: BoxDecoration(
        gradient: context.appColors.companyWashGradient,
        borderRadius: BorderRadius.circular(Radii.card),
        border: Border.all(color: tokens.line),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  'Better, together.',
                  style: context.mobileTypography.goalCardTitle.copyWith(
                    color: tokens.ink,
                  ),
                ),
                const SizedBox(height: Grid.xxs),
                Text(
                  '${agents.length} ${agents.length == 1 ? 'agent' : 'agents'} · '
                  '${humans.length} people in this view',
                  style: context.mobileTypography.body.copyWith(
                    color: tokens.muted,
                  ),
                ),
              ],
            ),
          ),
          if (members.isNotEmpty)
            SizedBox(
              width: 78,
              height: 42,
              child: Stack(
                clipBehavior: Clip.none,
                children: [
                  for (var index = 0; index < members.length; index++)
                    Positioned(
                      left: index * 20,
                      top: 1,
                      child: _MemberAvatar(
                        member: members[index],
                        size: 38,
                        bordered: true,
                      ),
                    ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _TeamFilterChip extends StatelessWidget {
  const _TeamFilterChip({
    required this.label,
    required this.selected,
    required this.onSelected,
  });

  final String label;
  final bool selected;
  final VoidCallback onSelected;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    final selectedColor = context.appColors.plum;
    return ChoiceChip(
      label: Text(label),
      selected: selected,
      showCheckmark: false,
      onSelected: (_) => onSelected(),
      selectedColor: selectedColor,
      backgroundColor: tokens.paper,
      side: BorderSide(color: selected ? Colors.transparent : tokens.line),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(11),
        side: BorderSide(color: selected ? Colors.transparent : tokens.line),
      ),
      labelStyle: context.mobileTypography.goalCardChip.copyWith(
        color: selected ? tokens.canvas : tokens.ink,
        fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
      ),
    );
  }
}

class _TeamRow extends ConsumerWidget {
  const _TeamRow({required this.member, required this.onTap});

  final CompanyTeamMemberRecord member;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profile = ref.watch(
      userCacheProvider.select((profiles) => profiles[member.pubkey]),
    );
    final status = member.status == MemberPositionStatus.paused
        ? 'Paused'
        : null;
    return IdentityRow(
      name: _displayName(profile, member.directoryName, member.pubkey),
      details: member.position?.head.title ?? '',
      initials: _memberInitials(profile, member),
      kind: member.kind == MemberPositionKind.employee
          ? IdentityKind.agent
          : IdentityKind.person,
      status: status,
      imageUrl: profile?.avatarUrl,
      tone: member.kind == MemberPositionKind.employee
          ? IdentityAvatarTone.sage
          : IdentityAvatarTone.peach,
      onTap: onTap,
    );
  }
}

class _MemberAvatar extends ConsumerWidget {
  const _MemberAvatar({
    required this.member,
    required this.size,
    this.bordered = false,
  });

  final CompanyTeamMemberRecord member;
  final double size;
  final bool bordered;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profile = ref.watch(
      userCacheProvider.select((profiles) => profiles[member.pubkey]),
    );
    return DecoratedBox(
      decoration: bordered
          ? BoxDecoration(
              shape: BoxShape.circle,
              border: Border.all(color: context.mobileTokens.paper, width: 2),
            )
          : const BoxDecoration(),
      child: IdentityAvatar(
        initials: _memberInitials(profile, member),
        kind: member.kind == MemberPositionKind.employee
            ? IdentityKind.agent
            : IdentityKind.person,
        tone: member.kind == MemberPositionKind.employee
            ? IdentityAvatarTone.sage
            : IdentityAvatarTone.peach,
        imageUrl: profile?.avatarUrl,
        size: size,
        semanticLabel: _displayName(
          profile,
          member.directoryName,
          member.pubkey,
        ),
      ),
    );
  }
}

String _displayName(
  UserProfile? profile,
  String? directoryName,
  String pubkey,
) {
  final profileName = profile?.displayName;
  if (profileName != null && profileName.trim().isNotEmpty) return profileName;
  final agentName = directoryName?.trim();
  if (agentName != null && agentName.isNotEmpty) return agentName;
  return profile?.label ?? shortPubkey(pubkey);
}

String _memberInitials(UserProfile? profile, CompanyTeamMemberRecord member) {
  final profileName = profile?.displayName;
  if (profileName != null && profileName.trim().isNotEmpty) {
    return profile!.initial;
  }
  final directoryName = member.directoryName?.trim();
  if (directoryName != null && directoryName.isNotEmpty) {
    return directoryName[0].toUpperCase();
  }
  return profile?.initial ?? member.pubkey[0].toUpperCase();
}

/// Read-only team overview for an actual membership or employee position.
class TeamMemberDetailPage extends HookConsumerWidget {
  const TeamMemberDetailPage({
    required this.pubkey,
    this.onInvite,
    this.onStartConversation,
    super.key,
  });

  final String pubkey;
  final VoidCallback? onInvite;
  final Future<void> Function(BuildContext context, String pubkey)?
  onStartConversation;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final teamAsync = ref.watch(companyTeamProvider);
    final showDenied = useState(false);
    final profile = ref.watch(
      userCacheProvider.select((profiles) => profiles[pubkey.toLowerCase()]),
    );
    final directoryName = ref.watch(
      agentDirectoryDisplayNamesProvider,
    )[pubkey.toLowerCase()];
    final communityName = ref.watch(activeCommunityProvider).value?.name;
    final displayName = _displayName(profile, directoryName, pubkey);
    final viewerPubkey = ref.watch(myPubkeyProvider)?.toLowerCase();
    final data = teamAsync.asData?.value;
    final current = data?.members
        .where((candidate) => candidate.pubkey == pubkey.toLowerCase())
        .firstOrNull;
    final viewerRole = data?.members
        .where((candidate) => candidate.pubkey == viewerPubkey)
        .firstOrNull
        ?.role;
    final canEdit = canManageCompanyTeam(viewerRole);
    final lifecycle =
        current != null && current.status != MemberPositionStatus.active;
    final useStatusHeader =
        showDenied.value ||
        lifecycle ||
        teamAsync.isLoading ||
        teamAsync.hasError ||
        current == null;

    useEffect(() {
      final manager = current?.position?.head.managerPubkey;
      unawaited(
        ref.read(userCacheProvider.notifier).preload([pubkey, ?manager]),
      );
      return null;
    }, [pubkey, current?.position?.head.managerPubkey]);

    useEffect(() {
      if (current?.status == MemberPositionStatus.terminated) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (!context.mounted) return;
          final navigator = Navigator.of(context);
          if (navigator.canPop()) navigator.pop();
        });
      }
      return null;
    }, [current?.status]);

    if (showDenied.value) {
      return _TeamDetailDenied(onBack: () => showDenied.value = false);
    }
    if (current?.status == MemberPositionStatus.paused) {
      return ColoredBox(
        color: context.mobileTokens.canvas,
        child: Column(
          children: [
            SafeArea(
              bottom: false,
              child: SizedBox(height: MobileLayoutTokens.appBarHeight),
            ),
            Expanded(child: _TeamLifecycleState(name: displayName)),
          ],
        ),
      );
    }

    return ColoredBox(
      color: context.mobileTokens.canvas,
      child: Column(
        children: [
          GoalPageHeader(
            title: useStatusHeader ? displayName : 'Team member',
            subtitle: useStatusHeader ? communityName : null,
            onBack: () => unawaited(Navigator.of(context).maybePop()),
            backLabel: 'Back to team',
            action: teamAsync.isLoading || teamAsync.hasError || current == null
                ? onInvite
                : !useStatusHeader && !canEdit
                ? () => showDenied.value = true
                : null,
            actionLabel:
                teamAsync.isLoading || teamAsync.hasError || current == null
                ? 'Add a team member'
                : 'Profile options',
            actionIcon: !useStatusHeader && !canEdit
                ? LucideIcons.ellipsis
                : LucideIcons.plus,
          ),
          Expanded(
            child: teamAsync.when(
              loading: () => _TeamDetailLoading(name: displayName),
              error: (error, stackTrace) => _TeamDetailUnavailable(
                onRetry: () {
                  ref.invalidate(companyTeamProvider);
                  ref.invalidate(memberPositionHeadsProvider);
                },
              ),
              data: (data) {
                final current = data.members
                    .where(
                      (candidate) => candidate.pubkey == pubkey.toLowerCase(),
                    )
                    .firstOrNull;
                if (current == null) {
                  return _TeamDetailUnavailable(
                    onRetry: () => ref.invalidate(companyTeamProvider),
                  );
                }
                if (current.status == MemberPositionStatus.terminated) {
                  return const SizedBox.shrink();
                }
                return _MemberOverview(
                  member: current,
                  displayName: displayName,
                  imageUrl: profile?.avatarUrl,
                  onStartConversation: onStartConversation,
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _TeamDetailLoading extends StatelessWidget {
  const _TeamDetailLoading({required this.name});

  final String name;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return ListView(
      padding: const EdgeInsets.fromLTRB(
        Grid.gutter,
        Grid.xs,
        Grid.gutter,
        Grid.lg,
      ),
      children: [
        _TeamNotice(
          title: 'Loading $name',
          message:
              'Fetching the latest shared record. Actions will be ready when it arrives.',
        ),
        const SizedBox(height: Grid.md),
        Container(
          height: 8,
          decoration: BoxDecoration(
            color: tokens.soft,
            borderRadius: BorderRadius.circular(Radii.full),
          ),
        ),
        const SizedBox(height: Grid.sm),
        for (var index = 0; index < 4; index++) ...[
          Container(
            key: ValueKey('team-detail-skeleton-row-$index'),
            height: 44,
            decoration: BoxDecoration(
              color: tokens.soft,
              borderRadius: BorderRadius.vertical(
                bottom: index == 3 ? const Radius.circular(14) : Radius.zero,
              ),
            ),
          ),
          if (index < 3) const SizedBox(height: Grid.sm),
        ],
      ],
    );
  }
}

class _TeamDetailDenied extends StatelessWidget {
  const _TeamDetailDenied({required this.onBack});

  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Align(
      alignment: const Alignment(0, -0.38),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 30),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            DecoratedBox(
              decoration: BoxDecoration(
                color: tokens.soft,
                borderRadius: BorderRadius.circular(21),
              ),
              child: const SizedBox(
                width: 66,
                height: 66,
                child: Icon(LucideIcons.briefcaseBusiness),
              ),
            ),
            const SizedBox(height: Grid.xxs),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: Grid.xs),
              child: Text(
                'You can view, but not change this',
                textAlign: TextAlign.center,
                style: context.mobileTypography.goalDetailTitle.copyWith(
                  color: tokens.ink,
                ),
              ),
            ),
            const SizedBox(height: Grid.xxs),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: Grid.xs),
              child: Text(
                'An owner or authorized manager can update this record.',
                textAlign: TextAlign.center,
                style: context.mobileTypography.body.copyWith(
                  color: tokens.muted,
                ),
              ),
            ),
            const SizedBox(height: Grid.sm),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: onBack,
                child: const Text('Back to detail'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _TeamNotice extends StatelessWidget {
  const _TeamNotice({required this.title, required this.message});

  final String title;
  final String message;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Container(
      decoration: BoxDecoration(
        color: tokens.paper,
        borderRadius: BorderRadius.circular(13),
        border: Border.all(color: tokens.line),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(13),
        child: Row(
          children: [
            Container(width: 3, color: context.appColors.lilac),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.all(Grid.sm),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: context.mobileTypography.goalCardTitle.copyWith(
                        color: tokens.ink,
                      ),
                    ),
                    const SizedBox(height: Grid.xxs),
                    Text(
                      message,
                      style: context.mobileTypography.body.copyWith(
                        color: tokens.muted,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _TeamDetailUnavailable extends StatelessWidget {
  const _TeamDetailUnavailable({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Center(
      child: Transform.translate(
        offset: Offset(0, -MediaQuery.sizeOf(context).height * 0.194),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 30),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              DecoratedBox(
                decoration: BoxDecoration(
                  color: tokens.soft,
                  borderRadius: BorderRadius.circular(21),
                ),
                child: const SizedBox(
                  width: 64,
                  height: 64,
                  child: Icon(LucideIcons.briefcaseBusiness),
                ),
              ),
              const SizedBox(height: Grid.md),
              Text(
                'This profile could not load',
                textAlign: TextAlign.center,
                style: context.mobileTypography.goalDetailTitle.copyWith(
                  color: tokens.ink,
                ),
              ),
              const SizedBox(height: Grid.sm),
              Text(
                'The record has not been removed. Retry to get its current state.',
                textAlign: TextAlign.center,
                style: context.mobileTypography.body.copyWith(
                  color: tokens.muted,
                ),
              ),
              const SizedBox(height: Grid.md),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: onRetry,
                  child: const Text('Try again'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _TeamLifecycleState extends StatelessWidget {
  const _TeamLifecycleState({required this.name});

  final String name;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return ListView(
      padding: const EdgeInsets.fromLTRB(
        Grid.gutter,
        Grid.xs,
        Grid.gutter,
        Grid.lg,
      ),
      children: [
        Container(
          padding: const EdgeInsets.all(Grid.md),
          decoration: BoxDecoration(
            gradient: context.appColors.companyWashGradient,
            borderRadius: BorderRadius.circular(Radii.card),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'STATUS UPDATED',
                style: context.mobileTypography.companySection.copyWith(
                  color: tokens.action,
                ),
              ),
              const SizedBox(height: Grid.xs),
              Text(
                name,
                style: context.mobileTypography.goalDetailTitle.copyWith(
                  color: tokens.ink,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: Grid.md),
        Container(
          padding: const EdgeInsets.all(Grid.sm),
          decoration: BoxDecoration(
            color: tokens.paper,
            borderRadius: BorderRadius.circular(Radii.card),
            border: Border(
              left: BorderSide(color: context.appColors.lilac, width: 3),
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Paused', style: context.mobileTypography.goalCardTitle),
              const SizedBox(height: Grid.xs),
              Text(
                'No new runs start until you resume it.',
                style: context.mobileTypography.body.copyWith(
                  color: tokens.muted,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: Grid.md),
        FilledButton.tonal(
          onPressed: () => unawaited(Navigator.of(context).maybePop()),
          style: FilledButton.styleFrom(
            backgroundColor: tokens.soft,
            foregroundColor: tokens.action,
            side: BorderSide(color: tokens.line),
            minimumSize: const Size.fromHeight(
              MobileLayoutTokens.minimumTapTarget,
            ),
          ),
          child: const Text('Back to team'),
        ),
      ],
    );
  }
}

class _MemberOverview extends ConsumerWidget {
  const _MemberOverview({
    required this.member,
    required this.displayName,
    required this.imageUrl,
    required this.onStartConversation,
  });

  final CompanyTeamMemberRecord member;
  final String displayName;
  final String? imageUrl;
  final Future<void> Function(BuildContext context, String pubkey)?
  onStartConversation;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profile = ref.watch(userCacheProvider);
    final head = member.position?.head;
    final manager = head?.managerPubkey;
    final kindLabel = member.kind == MemberPositionKind.employee
        ? 'AI agent'
        : 'Human';
    final tokens = context.mobileTokens;

    return ListView(
      padding: const EdgeInsets.fromLTRB(
        Grid.gutter,
        Grid.xs,
        Grid.gutter,
        Grid.lg,
      ),
      children: [
        Container(
          padding: const EdgeInsets.all(Grid.lg),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                context.appColors.lilac.withValues(alpha: 0.52),
                context.appColors.apricot.withValues(alpha: 0.24),
              ],
            ),
            borderRadius: BorderRadius.circular(24),
          ),
          child: Column(
            children: [
              IdentityAvatar(
                initials: _memberInitials(profile[member.pubkey], member),
                kind: member.kind == MemberPositionKind.employee
                    ? IdentityKind.agent
                    : IdentityKind.person,
                tone: member.kind == MemberPositionKind.employee
                    ? IdentityAvatarTone.sage
                    : IdentityAvatarTone.peach,
                imageUrl: imageUrl,
                size: 62,
                semanticLabel: displayName,
              ),
              const SizedBox(height: Grid.sm),
              Text(
                displayName,
                style: context.mobileTypography.goalDetailTitle.copyWith(
                  color: tokens.ink,
                ),
              ),
              if (head?.title.isNotEmpty == true) ...[
                const SizedBox(height: Grid.xxs),
                Text(
                  head!.title,
                  style: context.mobileTypography.body.copyWith(
                    color: tokens.muted,
                  ),
                ),
              ],
              const SizedBox(height: Grid.xs),
              _MemberKindTag(label: kindLabel),
            ],
          ),
        ),
        const SizedBox(height: Grid.sm),
        SizedBox(
          width: double.infinity,
          child: FilledButton(
            onPressed: onStartConversation == null
                ? null
                : () => unawaited(onStartConversation!(context, member.pubkey)),
            child: const Text('Start a conversation'),
          ),
        ),
        if (manager != null) ...[
          const SizedBox(height: Grid.md),
          _TeamInfoRow(
            label: 'Reports to',
            value: _displayName(profile[manager.toLowerCase()], null, manager),
          ),
        ],
      ],
    );
  }
}

class _TeamInfoRow extends StatelessWidget {
  const _TeamInfoRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Container(
      padding: const EdgeInsets.symmetric(vertical: Grid.sm),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: tokens.line)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: context.mobileTypography.body.copyWith(
                color: tokens.muted,
              ),
            ),
          ),
          const SizedBox(width: Grid.xs),
          Flexible(
            child: Text(
              value,
              textAlign: TextAlign.end,
              style: context.mobileTypography.body.copyWith(color: tokens.ink),
            ),
          ),
        ],
      ),
    );
  }
}

class _MemberKindTag extends StatelessWidget {
  const _MemberKindTag({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: context.mobileTokens.soft,
        borderRadius: BorderRadius.circular(Radii.tag),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: Grid.sm,
          vertical: Grid.xxs,
        ),
        child: Text(label, style: context.mobileTypography.goalCardChip),
      ),
    );
  }
}
