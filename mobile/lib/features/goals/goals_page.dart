import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../shared/business/mobile_business_entry_points.dart';
import '../../shared/community/community_membership_provider.dart';
import '../../shared/company/goals/goal_records.dart';
import '../../shared/company/goals/goal_repository.dart';
import '../../shared/identity/identity_components.dart';
import '../../shared/navigation/mobile_navigation.dart';
import '../../shared/relay/relay.dart';
import '../../shared/profile/user_cache_provider.dart';
import '../../shared/theme/theme.dart';
import '../../shared/utils/string_utils.dart';
import '../../shared/widgets/buzz_loading_indicator.dart';
import '../../shared/widgets/modal_presentation.dart';
import 'goal_widgets.dart';
import 'goal_sheets.dart';

class GoalsPage extends HookConsumerWidget {
  const GoalsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final goals = ref.watch(goalHeadsProvider);
    final role = ref.watch(currentCommunityRoleProvider).asData?.value;
    final actor = ref.watch(myPubkeyProvider);
    final canCreateRoot = canManageCompanyGoals(role?.name);
    final records = goals.asData?.value ?? const <GoalHeadRecord>[];
    final owners = records
        .map((record) => record.head.goal?.ownerPubkey)
        .whereType<String>()
        .toSet()
        .toList();

    useEffect(() {
      if (owners.isEmpty) return null;
      unawaited(ref.read(userCacheProvider.notifier).preload(owners));
      return null;
    }, [owners.join('\u0000')]);

    return ColoredBox(
      color: context.mobileTokens.canvas,
      child: Column(
        children: [
          GoalPageHeader(
            title: 'Goals',
            subtitle: 'A shared direction',
            onBack: () => unawaited(Navigator.of(context).maybePop()),
            backLabel: 'Back to company',
            action: canCreateRoot && actor != null
                ? () => _openCreateGoal(context, ref, actor)
                : null,
            actionLabel: 'Create goal',
          ),
          Expanded(
            child: goals.when(
              loading: () => const Center(child: BuzzLoadingIndicator()),
              error: (error, stackTrace) => GoalLoadError(
                onRetry: () {
                  ref.invalidate(goalRelaySelfProvider);
                  ref.invalidate(goalHeadsProvider);
                },
              ),
              data: (allRecords) => _GoalList(records: allRecords),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _openCreateGoal(
    BuildContext context,
    WidgetRef ref,
    String actorPubkey,
  ) async {
    final created = await showBuzzModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      title: 'Give the team a direction.',
      showDragHandle: true,
      centerTitle: false,
      builder: (_) => GoalCreateSheet(
        actorPubkey: actorPubkey,
        onSubmit: (goal) async {
          await ref
              .read(goalRepositoryProvider)
              .submit(
                GoalAction(
                  goalId: goal.goalId,
                  action: GoalActionType.create,
                  goal: goal,
                ),
              );
        },
      ),
    );
    if (created == true) ref.invalidate(goalHeadsProvider);
  }
}

class _GoalList extends HookConsumerWidget {
  const _GoalList({required this.records});

  final List<GoalHeadRecord> records;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final visible = records
        .where((record) => record.head.status != GoalStatus.deleted)
        .toList();
    final companyGoals = visible
        .where((record) => record.head.goal?.parentGoalId == null)
        .toList();
    final contributingGoals = visible
        .where((record) => record.head.goal?.parentGoalId != null)
        .toList();
    final now = DateTime.now();
    final hasGoalDueThisMonth = companyGoals.any((record) {
      final dueDate = record.head.goal?.dueDate;
      final parsed = dueDate == null ? null : DateTime.tryParse(dueDate);
      return record.head.status != GoalStatus.archived &&
          parsed?.year == now.year &&
          parsed?.month == now.month;
    });
    return ListView(
      padding: const EdgeInsets.fromLTRB(
        MobileLayoutTokens.contentGutter,
        0,
        MobileLayoutTokens.contentGutter,
        Grid.xl,
      ),
      children: [
        if (companyGoals.isNotEmpty) ...[
          _SectionHeading(
            title: 'Company goals',
            trailing: hasGoalDueThisMonth ? const _GoalMonthTag() : null,
          ),
          for (var index = 0; index < companyGoals.length; index++)
            _GoalCard(
              record: companyGoals[index],
              isLastInSection: index == companyGoals.length - 1,
              onTap: () => _openGoal(context, companyGoals[index].head.goalId),
            ),
        ],
        if (contributingGoals.isNotEmpty) ...[
          _SectionHeading(title: 'Contributing goals'),
          for (var index = 0; index < contributingGoals.length; index++)
            _GoalCard(
              record: contributingGoals[index],
              isSubgoal: true,
              isLastInSection: index == contributingGoals.length - 1,
              onTap: () =>
                  _openGoal(context, contributingGoals[index].head.goalId),
            ),
        ],
      ],
    );
  }

  void _openGoal(BuildContext context, String goalId) {
    unawaited(
      MobileNavigation.push<String, void>(
        context,
        MobileBusinessRoutes.goalDetail,
        goalId,
      ),
    );
  }
}

class _SectionHeading extends StatelessWidget {
  const _SectionHeading({required this.title, this.trailing});

  final String title;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Padding(
      padding: const EdgeInsets.only(
        top: MobileLayoutTokens.goalSectionSpacing,
        bottom: MobileLayoutTokens.goalSectionTitleGap,
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              title,
              style: context.mobileTypography.goalSectionTitle.copyWith(
                color: tokens.ink,
              ),
            ),
          ),
          ?trailing,
        ],
      ),
    );
  }
}

class _GoalMonthTag extends StatelessWidget {
  const _GoalMonthTag();

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: tokens.success,
        borderRadius: BorderRadius.circular(Radii.tag),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: Grid.xxs,
          vertical: Grid.half,
        ),
        child: Text(
          'This month',
          style: context.mobileTypography.companyEntryDescription.copyWith(
            color: tokens.action,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
    );
  }
}

class _GoalCard extends ConsumerWidget {
  const _GoalCard({
    required this.record,
    required this.onTap,
    required this.isLastInSection,
    this.isSubgoal = false,
  });

  final GoalHeadRecord record;
  final VoidCallback onTap;
  final bool isLastInSection;
  final bool isSubgoal;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final head = record.head;
    final goal = head.goal;
    final tokens = context.mobileTokens;
    final owner = goal?.ownerPubkey;
    final profile = owner == null
        ? null
        : ref.watch(userCacheProvider.select((profiles) => profiles[owner]));
    if (owner != null && profile == null) {
      ref.read(userCacheProvider.notifier).get(owner);
    }
    final ownerName = owner == null
        ? ''
        : (profile?.label ?? shortPubkey(owner));
    final ownerInitials =
        profile?.initials ??
        (owner == null ? '?' : owner.substring(0, 1).toUpperCase());

    return Padding(
      padding: EdgeInsets.only(bottom: isLastInSection ? 0 : Grid.twelve),
      child: Material(
        color: tokens.paper,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.container),
          side: BorderSide(color: tokens.line),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          key: ValueKey('goal-card-${head.goalId}'),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(MobileLayoutTokens.goalCardPadding),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    if (isSubgoal)
                      DecoratedBox(
                        decoration: BoxDecoration(
                          color: tokens.soft,
                          borderRadius: BorderRadius.circular(Radii.tag),
                        ),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(
                            horizontal: Grid.xxs,
                            vertical: Grid.half,
                          ),
                          child: Text(
                            'Sub-goal',
                            style: context
                                .mobileTypography
                                .companyEntryDescription
                                .copyWith(
                                  color: tokens.action,
                                  fontWeight: FontWeight.w700,
                                ),
                          ),
                        ),
                      )
                    else
                      Icon(
                        LucideIcons.target,
                        color: tokens.action,
                        size: Grid.sm - Grid.half,
                      ),
                    const Spacer(),
                    GoalStatusPill(status: head.status),
                  ],
                ),
                const SizedBox(height: MobileLayoutTokens.goalCardHeaderGap),
                Text(
                  head.title,
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                  style: context.mobileTypography.goalCardTitle.copyWith(
                    color: tokens.ink,
                  ),
                ),
                if (goalProgressLabel(head) != null) ...[
                  const SizedBox(height: Grid.fifteen),
                  GoalProgressMeter(head: head),
                ],
                const SizedBox(height: MobileLayoutTokens.goalCardOwnerGap),
                Row(
                  children: [
                    IdentityAvatar(
                      initials: ownerInitials,
                      kind: profile?.isAgent == true
                          ? IdentityKind.agent
                          : IdentityKind.person,
                      imageUrl: profile?.avatarUrl,
                      size: Grid.twentyEight,
                      roundedSquare: true,
                      semanticLabel: ownerName,
                    ),
                    const SizedBox(width: Grid.half + Grid.quarter),
                    Expanded(
                      child: Text(
                        ownerName,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: context.mobileTypography.identityDetails
                            .copyWith(color: tokens.muted),
                      ),
                    ),
                    if (_goalCardMeta(head) case final meta?) ...[
                      const SizedBox(width: Grid.half),
                      Flexible(
                        child: Text(
                          meta,
                          textAlign: TextAlign.end,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: context.mobileTypography.identityDetails
                              .copyWith(color: tokens.muted),
                        ),
                      ),
                    ],
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

String? _goalCardMeta(GoalHead head) {
  final progress = goalProgressLabel(head);
  final dueDate = head.goal?.dueDate;
  final dueLabel = dueDate == null ? null : _cardDueDate(dueDate);
  if (progress != null && dueLabel != null) return '$progress · $dueLabel';
  return progress ?? dueLabel;
}

String _cardDueDate(String dueDate) {
  final parsed = DateTime.tryParse(dueDate);
  if (parsed == null) return dueDate;
  final today = DateTime.now();
  if (parsed.year == today.year &&
      parsed.month == today.month &&
      parsed.day == today.day) {
    return 'Due today';
  }
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return '${parsed.day} ${months[parsed.month - 1]}';
}
