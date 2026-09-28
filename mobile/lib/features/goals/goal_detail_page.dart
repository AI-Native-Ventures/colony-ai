import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../shared/business/mobile_business_entry_points.dart';
import '../../shared/community/community_membership_provider.dart';
import '../../shared/community/community_provider.dart';
import '../../shared/company/goals/goal_records.dart';
import '../../shared/company/goals/goal_repository.dart';
import '../../shared/navigation/mobile_navigation.dart';
import '../../shared/navigation/mobile_route.dart';
import '../../shared/profile/user_cache_provider.dart';
import '../../shared/relay/relay.dart';
import '../../shared/theme/theme.dart';
import '../../shared/utils/string_utils.dart';
import '../../shared/widgets/buzz_loading_indicator.dart';
import '../../shared/widgets/modal_presentation.dart';
import 'goal_sheets.dart';
import 'goal_widgets.dart';

class GoalDetailPage extends HookConsumerWidget {
  const GoalDetailPage({
    required this.goalId,
    this.onShareInChat,
    this.onOpenDiscussion,
    super.key,
  });

  final String goalId;
  final VoidCallback? onShareInChat;
  final VoidCallback? onOpenDiscussion;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final recordAsync = ref.watch(goalHeadProvider(goalId));
    final recordsAsync = ref.watch(goalHeadsProvider);
    final role = ref.watch(currentCommunityRoleProvider).asData?.value;
    final community = ref.watch(activeCommunityProvider).asData?.value;
    final actor = ref.watch(myPubkeyProvider);
    final isSubmittingLifecycleAction = useState(false);
    final lifecycleActionFailed = useState(false);
    final record = recordAsync.asData?.value;
    final goal = record?.head.goal;
    final parentId = goal?.parentGoalId;
    final parent = parentId == null
        ? null
        : recordsAsync.asData?.value
              .where((candidate) => candidate.head.goalId == parentId)
              .firstOrNull;
    final children =
        recordsAsync.asData?.value
            .where(
              (candidate) =>
                  candidate.head.goal?.parentGoalId == goalId.toLowerCase() &&
                  candidate.head.status != GoalStatus.deleted,
            )
            .toList() ??
        const <GoalHeadRecord>[];
    final sharedGoal = parent ?? children.firstOrNull;
    final canUpdate =
        record != null &&
        record.head.status != GoalStatus.deleted &&
        record.head.status != GoalStatus.archived &&
        canUpdateGoal(role: role?.name, actorPubkey: actor, head: record.head);
    final targetNeedsUnspecifiedInput =
        goal?.target != null && record?.head.progress?.current == null;
    final canRecordProgress = canUpdate && !targetNeedsUnspecifiedInput;
    final pubkeys = [
      ?goal?.ownerPubkey,
      ?parent?.head.goal?.ownerPubkey,
      for (final child in children) ?child.head.goal?.ownerPubkey,
    ];

    useEffect(() {
      if (pubkeys.isEmpty) return null;
      unawaited(ref.read(userCacheProvider.notifier).preload(pubkeys));
      return null;
    }, [pubkeys.join('\u0000')]);

    return Material(
      color: context.mobileTokens.canvas,
      child: Column(
        children: [
          GoalPageHeader(
            title: record?.head.title ?? 'Company goal',
            subtitle: community?.name,
            onBack: () => unawaited(Navigator.of(context).maybePop()),
            backLabel: 'Back',
            action: onOpenDiscussion == null && sharedGoal == null
                ? null
                : () => _openContextActions(
                    context,
                    onOpenDiscussion: onOpenDiscussion,
                    sharedGoalId: sharedGoal?.head.goalId,
                  ),
            actionLabel: 'Goal actions',
            actionIcon: LucideIcons.plus,
          ),
          Expanded(
            child: recordAsync.when(
              loading: () => const Center(child: BuzzLoadingIndicator()),
              error: (_, _) => GoalLoadError(
                onRetry: () {
                  ref.invalidate(goalRelaySelfProvider);
                  ref.invalidate(goalHeadsProvider);
                },
              ),
              data: (value) {
                if (value == null) {
                  return _GoalUnavailable(
                    onRetry: () {
                      ref.invalidate(goalRelaySelfProvider);
                      ref.invalidate(goalHeadsProvider);
                    },
                  );
                }
                if (value.head.status == GoalStatus.archived) {
                  return _ArchivedGoalState(
                    record: value,
                    canRestore: canRestoreOrDeleteGoal(role?.name),
                    isSubmitting: isSubmittingLifecycleAction.value,
                    saveFailed: lifecycleActionFailed.value,
                    onRestore: canRestoreOrDeleteGoal(role?.name)
                        ? () async {
                            if (isSubmittingLifecycleAction.value) return;
                            isSubmittingLifecycleAction.value = true;
                            lifecycleActionFailed.value = false;
                            try {
                              await ref
                                  .read(goalRepositoryProvider)
                                  .submit(
                                    GoalAction(
                                      goalId: value.head.goalId,
                                      action: GoalActionType.restore,
                                      expectedHeadEventId: value.event.id,
                                    ),
                                  );
                              if (!context.mounted) return;
                              ref.invalidate(goalHeadsProvider);
                              ref.invalidate(
                                goalHistoryProvider(value.head.goalId),
                              );
                            } catch (_) {
                              if (context.mounted) {
                                lifecycleActionFailed.value = true;
                              }
                            } finally {
                              if (context.mounted) {
                                isSubmittingLifecycleAction.value = false;
                              }
                            }
                          }
                        : null,
                    onBackToGoals: () => _backToGoals(context),
                  );
                }
                if (value.head.status == GoalStatus.deleted) {
                  return _DeletedGoalState(
                    title: value.head.title,
                    onBackToGoals: () => _backToGoals(context),
                  );
                }
                return _GoalDetailBody(
                  record: value,
                  parent: parent,
                  children: children,
                  canRecordProgress: canRecordProgress,
                  onUpdateProgress: () =>
                      _openProgressSheet(context, ref, value),
                  onShareInChat: onShareInChat,
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _openProgressSheet(
    BuildContext context,
    WidgetRef ref,
    GoalHeadRecord record,
  ) async {
    final saved = await showBuzzModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      title: 'Update the goal',
      showDragHandle: true,
      centerTitle: false,
      builder: (_) => GoalProgressSheet(
        record: record,
        onSubmit: (action) async {
          await ref.read(goalRepositoryProvider).submit(action);
        },
      ),
    );
    if (saved == true) {
      ref.invalidate(goalHeadsProvider);
      ref.invalidate(goalHistoryProvider(record.head.goalId));
    }
  }

  Future<void> _openContextActions(
    BuildContext context, {
    required VoidCallback? onOpenDiscussion,
    required String? sharedGoalId,
  }) async {
    await showBuzzModalBottomSheet<void>(
      context: context,
      title: 'Keep the context close.',
      showDragHandle: true,
      centerTitle: false,
      builder: (sheetContext) => GoalContextActionsSheet(
        onOpenDiscussion: onOpenDiscussion == null
            ? null
            : () {
                Navigator.of(sheetContext).pop();
                onOpenDiscussion();
              },
        onSeeSharedGoal: sharedGoalId == null
            ? null
            : () {
                Navigator.of(sheetContext).pop();
                _openGoal(context, sharedGoalId);
              },
      ),
    );
  }
}

class _GoalDetailBody extends HookConsumerWidget {
  const _GoalDetailBody({
    required this.record,
    required this.children,
    required this.canRecordProgress,
    required this.onUpdateProgress,
    this.parent,
    this.onShareInChat,
  });

  final GoalHeadRecord record;
  final GoalHeadRecord? parent;
  final List<GoalHeadRecord> children;
  final bool canRecordProgress;
  final VoidCallback onUpdateProgress;
  final VoidCallback? onShareInChat;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final head = record.head;
    final goal = head.goal;
    final tokens = context.mobileTokens;
    final isDeleted = head.status == GoalStatus.deleted;
    final showStatusActions = !isDeleted && head.status != GoalStatus.archived;

    return ListView(
      padding: const EdgeInsets.fromLTRB(
        MobileLayoutTokens.goalContentHorizontalInset,
        MobileLayoutTokens.goalDetailTopInset,
        MobileLayoutTokens.goalContentHorizontalInset,
        Grid.xl,
      ),
      children: [
        _GoalHero(record: record),
        if (parent != null) ...[
          const SizedBox(height: MobileLayoutTokens.goalHeroBottomGap),
          _ParentGoalStrip(
            record: parent!,
            onTap: () => _openGoal(context, parent!.head.goalId),
          ),
        ],
        if (goal != null) ...[
          _SectionHeading(title: 'What done looks like'),
          Text(
            goal.doneCondition,
            style: context.mobileTypography.goalBody.copyWith(
              color: tokens.muted,
            ),
          ),
          const SizedBox(height: Grid.sm),
          GoalOwnerLine(pubkey: goal.ownerPubkey, dueDate: goal.dueDate),
        ],
        if (children.isNotEmpty) ...[
          _SectionHeading(title: 'Sub-goals'),
          for (final child in children)
            _SubgoalRow(
              record: child,
              onTap: () => _openGoal(context, child.head.goalId),
            ),
        ],
        if (showStatusActions) ...[
          const SizedBox(height: MobileLayoutTokens.goalActionsMargin),
          if (canRecordProgress || onShareInChat != null)
            Row(
              children: [
                if (canRecordProgress)
                  Expanded(
                    child: FilledButton(
                      key: const ValueKey('goal-update-progress'),
                      onPressed: onUpdateProgress,
                      style: _goalSecondaryButtonStyle(context),
                      child: const Text('Update progress'),
                    ),
                  ),
                if (canRecordProgress && onShareInChat != null)
                  const SizedBox(width: MobileLayoutTokens.goalActionsGap),
                if (onShareInChat != null)
                  Expanded(
                    child: FilledButton(
                      key: const ValueKey('goal-share-in-chat'),
                      onPressed: onShareInChat,
                      style: _goalPrimaryButtonStyle(context),
                      child: const Text('Share in chat'),
                    ),
                  ),
              ],
            ),
        ],
      ],
    );
  }
}

class _GoalHero extends StatelessWidget {
  const _GoalHero({required this.record});

  final GoalHeadRecord record;

  @override
  Widget build(BuildContext context) {
    final head = record.head;
    final goal = head.goal;
    final current = head.progress?.current;
    final target = goal?.target;
    final colors = context.appColors;
    final tokens = context.mobileTokens;
    return DecoratedBox(
      key: const ValueKey('goal-detail-hero'),
      decoration: BoxDecoration(
        gradient: colors.companyWashGradient,
        borderRadius: BorderRadius.circular(Radii.companyCard),
      ),
      child: Padding(
        padding: const EdgeInsets.all(MobileLayoutTokens.goalHeroPadding),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            GoalStatusPill(status: head.status),
            const SizedBox(height: MobileLayoutTokens.goalHeroStatusTitleGap),
            Text(
              head.title,
              style: context.mobileTypography.goalDetailTitle.copyWith(
                color: tokens.ink,
              ),
            ),
            if (current != null && target != null) ...[
              const SizedBox(
                height: MobileLayoutTokens.goalHeroTitleContentGap,
              ),
              Row(
                crossAxisAlignment: CrossAxisAlignment.baseline,
                textBaseline: TextBaseline.alphabetic,
                children: [
                  Text(
                    current,
                    style: context.mobileTypography.goalMetric.copyWith(
                      color: tokens.ink,
                    ),
                  ),
                  const SizedBox(width: Grid.xxs),
                  Text(
                    'of ${target.value} ${target.unit}',
                    style: context.mobileTypography.goalBody.copyWith(
                      color: tokens.muted,
                    ),
                  ),
                ],
              ),
            ] else ...[
              const SizedBox(
                height: MobileLayoutTokens.goalHeroTitleContentGap,
              ),
            ],
            if (goalProgressRatio(head) != null) ...[
              const SizedBox(height: MobileLayoutTokens.goalProgressMargin),
              GoalProgressMeter(head: head),
              const SizedBox(
                height: MobileLayoutTokens.goalHeroProgressBottomGap,
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _ParentGoalStrip extends StatelessWidget {
  const _ParentGoalStrip({required this.record, required this.onTap});

  final GoalHeadRecord record;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Material(
      key: const ValueKey('goal-parent-strip'),
      color: tokens.soft,
      borderRadius: BorderRadius.circular(Radii.companyPinned),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: Grid.fifteen,
            vertical: Grid.twelve,
          ),
          child: Row(
            children: [
              Icon(
                LucideIcons.target,
                color: tokens.action,
                size: MobileLayoutTokens.goalReferenceIconSize,
              ),
              const SizedBox(width: Grid.ten),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Part of',
                      style: context.mobileTypography.goalReferenceLabel
                          .copyWith(color: tokens.action),
                    ),
                    Text(
                      record.head.title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: context.mobileTypography.goalReferenceTitle
                          .copyWith(color: tokens.action),
                    ),
                  ],
                ),
              ),
              Icon(
                LucideIcons.chevronRight,
                color: tokens.muted,
                size: Grid.xs + Grid.half,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SubgoalRow extends ConsumerWidget {
  const _SubgoalRow({required this.record, required this.onTap});

  final GoalHeadRecord record;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tokens = context.mobileTokens;
    final ownerPubkey = record.head.goal?.ownerPubkey;
    final profile = ownerPubkey == null
        ? null
        : ref.watch(
            userCacheProvider.select((profiles) => profiles[ownerPubkey]),
          );
    final ownerName =
        profile?.label ?? (ownerPubkey == null ? '' : shortPubkey(ownerPubkey));
    return Material(
      type: MaterialType.transparency,
      child: InkWell(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: Grid.twelve),
          decoration: BoxDecoration(
            border: Border(bottom: BorderSide(color: tokens.line)),
          ),
          child: Row(
            children: [
              Icon(LucideIcons.target, color: tokens.muted, size: Grid.xs),
              const SizedBox(width: Grid.xxs),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      record.head.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: context.mobileTypography.goalBody.copyWith(
                        color: tokens.ink,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: Grid.half),
                    Text(
                      [
                        ownerName,
                        _subgoalStatusLabel(record.head.status),
                      ].where((value) => value.isNotEmpty).join(' · '),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: context.mobileTypography.identityDetails.copyWith(
                        color: tokens.muted,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

String _subgoalStatusLabel(GoalStatus status) => switch (status) {
  GoalStatus.active => 'On track',
  GoalStatus.offPace => 'Needs attention',
  GoalStatus.achieved => 'Achieved',
  GoalStatus.archived => 'Archived',
  GoalStatus.deleted => 'Deleted goal',
};

class _GoalUnavailable extends StatelessWidget {
  const _GoalUnavailable({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(Grid.gutter),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'Goal unavailable',
              key: const ValueKey('goal-unavailable'),
              style: context.mobileTypography.body.copyWith(
                color: tokens.muted,
              ),
            ),
            const SizedBox(height: Grid.xxs),
            TextButton(onPressed: onRetry, child: const Text('Try again')),
          ],
        ),
      ),
    );
  }
}

class _ArchivedGoalState extends StatelessWidget {
  const _ArchivedGoalState({
    required this.record,
    required this.canRestore,
    required this.isSubmitting,
    required this.saveFailed,
    required this.onRestore,
    required this.onBackToGoals,
  });

  final GoalHeadRecord record;
  final bool canRestore;
  final bool isSubmitting;
  final bool saveFailed;
  final VoidCallback? onRestore;
  final VoidCallback onBackToGoals;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return ListView(
      key: const ValueKey('goal-archived-state'),
      padding: const EdgeInsets.fromLTRB(
        Grid.gutter,
        Grid.xs,
        Grid.gutter,
        Grid.xl,
      ),
      children: [
        DecoratedBox(
          decoration: BoxDecoration(
            gradient: context.appColors.companyWashGradient,
            borderRadius: BorderRadius.circular(Radii.companyCard),
          ),
          child: Padding(
            padding: const EdgeInsets.all(Grid.gutter),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'STATUS UPDATED',
                  style: context.mobileTypography.metadata.copyWith(
                    color: tokens.action,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: Grid.xxs),
                Text(
                  record.head.title,
                  style: context.mobileTypography.goalDetailTitle.copyWith(
                    color: tokens.ink,
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: Grid.gutter),
        _GoalLifecycleNotice(
          title: 'Archived',
          message: 'The active list now reflects this change.',
        ),
        if (saveFailed) ...[
          const SizedBox(height: Grid.sm),
          _GoalLifecycleNotice(
            title: 'Changes were not saved',
            message: 'The goal is still archived. Try again.',
            isError: true,
          ),
        ],
        if (canRestore) ...[
          const SizedBox(height: Grid.gutter),
          FilledButton(
            key: const ValueKey('goal-restore'),
            onPressed: isSubmitting ? null : onRestore,
            style: _goalPrimaryButtonStyle(context),
            child: isSubmitting
                ? const SizedBox.square(
                    dimension: Grid.sm,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text('Restore'),
          ),
        ],
        const SizedBox(height: Grid.sm),
        FilledButton(
          key: const ValueKey('goal-back-to-goals'),
          onPressed: onBackToGoals,
          style: _goalSecondaryButtonStyle(context),
          child: const Text('Back to goals'),
        ),
      ],
    );
  }
}

class _DeletedGoalState extends StatelessWidget {
  const _DeletedGoalState({required this.title, required this.onBackToGoals});

  final String title;
  final VoidCallback onBackToGoals;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return ListView(
      key: const ValueKey('goal-deleted-state'),
      padding: const EdgeInsets.fromLTRB(
        Grid.gutter,
        Grid.xs,
        Grid.gutter,
        Grid.xl,
      ),
      children: [
        Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            DecoratedBox(
              decoration: BoxDecoration(
                gradient: context.appColors.companyWashGradient,
                borderRadius: BorderRadius.circular(Radii.companyCard),
              ),
              child: Padding(
                padding: const EdgeInsets.all(Grid.gutter),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'STATUS UPDATED',
                      style: context.mobileTypography.metadata.copyWith(
                        color: tokens.action,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: Grid.xxs),
                    Text(
                      title,
                      style: context.mobileTypography.goalDetailTitle.copyWith(
                        color: tokens.ink,
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: Grid.gutter),
            const _GoalLifecycleNotice(
              title: 'Deleted',
              message: 'The active list now reflects this change.',
            ),
            const SizedBox(height: Grid.sm),
            FilledButton(
              key: const ValueKey('goal-back-to-goals'),
              onPressed: onBackToGoals,
              style: _goalSecondaryButtonStyle(context),
              child: const Text('Back to goals'),
            ),
          ],
        ),
      ],
    );
  }
}

class _GoalLifecycleNotice extends StatelessWidget {
  const _GoalLifecycleNotice({
    required this.title,
    required this.message,
    this.isError = false,
  });

  final String title;
  final String message;
  final bool isError;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    final accentColor = isError ? tokens.error : tokens.action;
    return Container(
      decoration: BoxDecoration(
        color: tokens.paper,
        border: Border.all(color: tokens.line),
        borderRadius: BorderRadius.circular(Radii.companyPinned),
      ),
      clipBehavior: Clip.antiAlias,
      child: Stack(
        children: [
          Padding(
            padding: const EdgeInsets.all(Grid.sm),
            child: Semantics(
              liveRegion: isError,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: context.mobileTypography.goalBody.copyWith(
                      color: tokens.ink,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: Grid.half),
                  Text(
                    message,
                    style: context.mobileTypography.goalBody.copyWith(
                      color: tokens.muted,
                    ),
                  ),
                ],
              ),
            ),
          ),
          Positioned(
            top: 0,
            bottom: 0,
            left: 0,
            child: ColoredBox(
              color: accentColor,
              child: const SizedBox(width: 3),
            ),
          ),
        ],
      ),
    );
  }
}

void _backToGoals(BuildContext context) {
  final navigator = Navigator.of(context);
  if (navigator.canPop()) {
    navigator.pop();
    return;
  }
  unawaited(
    MobileNavigation.replace<NoMobileRouteArguments>(
      context,
      MobileBusinessRoutes.goals,
      const NoMobileRouteArguments(),
    ),
  );
}

class _SectionHeading extends StatelessWidget {
  const _SectionHeading({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Padding(
      padding: const EdgeInsets.only(
        top: MobileLayoutTokens.goalSectionSpacing,
        bottom: MobileLayoutTokens.goalSectionTitleGap,
      ),
      child: Text(
        title,
        style: context.mobileTypography.goalSectionTitle.copyWith(
          color: tokens.ink,
        ),
      ),
    );
  }
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

ButtonStyle _goalPrimaryButtonStyle(BuildContext context) {
  final tokens = context.mobileTokens;
  return FilledButton.styleFrom(
    backgroundColor: tokens.action,
    foregroundColor: tokens.onAction,
    textStyle: context.mobileTypography.companyEntryTitle.copyWith(
      color: tokens.onAction,
    ),
    padding: const EdgeInsets.symmetric(horizontal: Grid.xxs),
    minimumSize: const Size.fromHeight(MobileLayoutTokens.minimumTapTarget),
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(Radii.button),
    ),
  );
}

ButtonStyle _goalSecondaryButtonStyle(BuildContext context) {
  final tokens = context.mobileTokens;
  return FilledButton.styleFrom(
    backgroundColor: tokens.actionSoft,
    foregroundColor: tokens.onActionSoft,
    textStyle: context.mobileTypography.companyEntryTitle.copyWith(
      color: tokens.onActionSoft,
    ),
    padding: const EdgeInsets.symmetric(horizontal: Grid.xxs),
    minimumSize: const Size.fromHeight(MobileLayoutTokens.minimumTapTarget),
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(Radii.button),
    ),
  );
}
