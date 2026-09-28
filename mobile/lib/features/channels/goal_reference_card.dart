import 'dart:async';

import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../shared/business/mobile_business_entry_points.dart';
import '../../shared/company/goals/goal_records.dart';
import '../../shared/company/goals/goal_repository.dart';
import '../../shared/navigation/mobile_navigation.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/buzz_loading_indicator.dart';

class GoalReferenceCard extends HookConsumerWidget {
  const GoalReferenceCard({required this.goalId, super.key});

  final String goalId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final recordAsync = ref.watch(goalHeadProvider(goalId));
    final record = recordAsync.asData?.value;
    final head = record?.head;
    final tokens = context.mobileTokens;
    final label = switch (recordAsync) {
      AsyncLoading() => 'Loading goal',
      AsyncError() => 'Goal unavailable',
      _ when head == null => 'Goal unavailable',
      _ when head.status == GoalStatus.deleted => 'Deleted goal: ${head.title}',
      _ => 'Open goal ${head.title}',
    };

    return Semantics(
      button: true,
      label: label,
      onTap: () => _openGoal(context),
      child: ExcludeSemantics(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: Grid.half),
          child: Material(
            color: tokens.paper,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(Radii.companyCard),
              side: BorderSide(color: tokens.line),
            ),
            clipBehavior: Clip.antiAlias,
            child: InkWell(
              key: ValueKey('goal-reference-card:$goalId'),
              onTap: () => _openGoal(context),
              child: Padding(
                padding: const EdgeInsets.all(Grid.fifteen),
                child: recordAsync.when(
                  loading: () => const _GoalReferenceState(
                    label: 'Loading goal',
                    loading: true,
                  ),
                  error: (_, _) =>
                      const _GoalReferenceState(label: 'Goal unavailable'),
                  data: (value) {
                    if (value == null) {
                      return const _GoalReferenceState(
                        label: 'Goal unavailable',
                      );
                    }
                    if (value.head.status == GoalStatus.deleted) {
                      return _GoalReferenceState(
                        label: 'Deleted goal',
                        title: value.head.title,
                      );
                    }
                    return _GoalReferenceContent(record: value);
                  },
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  void _openGoal(BuildContext context) {
    unawaited(
      MobileNavigation.push<String, void>(
        context,
        MobileBusinessRoutes.goalDetail,
        goalId,
      ),
    );
  }
}

class ChannelGoalBanner extends StatelessWidget {
  const ChannelGoalBanner({
    required this.record,
    required this.onTap,
    super.key,
  });

  final GoalHeadRecord record;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Padding(
      padding: const EdgeInsets.fromLTRB(Grid.gutter, 0, Grid.gutter, Grid.xxs),
      child: Semantics(
        button: true,
        label: 'Open shared goal ${record.head.title}',
        onTap: onTap,
        child: ExcludeSemantics(
          child: Material(
            color: tokens.soft,
            borderRadius: BorderRadius.circular(Radii.companyPinned),
            clipBehavior: Clip.antiAlias,
            child: InkWell(
              key: ValueKey('channel-shared-goal:${record.head.goalId}'),
              onTap: onTap,
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: Grid.fifteen,
                  vertical: Grid.twelve,
                ),
                child: Row(
                  children: [
                    Icon(LucideIcons.target, color: tokens.action),
                    const SizedBox(width: Grid.xxs),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            record.head.title,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: context.mobileTypography.identityName
                                .copyWith(color: tokens.ink),
                          ),
                          Text(
                            _channelGoalSubtitle(record.head),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: context.mobileTypography.metadata.copyWith(
                              color: tokens.muted,
                            ),
                          ),
                        ],
                      ),
                    ),
                    Icon(LucideIcons.chevronRight, color: tokens.muted),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class ChannelGoalBannerSlot extends ConsumerWidget {
  const ChannelGoalBannerSlot({
    required this.channelId,
    required this.onOpenGoal,
    this.topPadding = 0,
    super.key,
  });

  final String channelId;
  final ValueChanged<String> onOpenGoal;
  final double topPadding;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final records = ref.watch(goalHeadsProvider).asData?.value;
    final record = records
        ?.where(
          (candidate) =>
              candidate.head.goal?.linkedChannelIds.contains(channelId) ==
                  true &&
              candidate.head.status != GoalStatus.deleted,
        )
        .firstOrNull;
    if (record == null) return const SizedBox.shrink();
    return Padding(
      padding: EdgeInsets.only(top: topPadding),
      child: ChannelGoalBanner(
        record: record,
        onTap: () => onOpenGoal(record.head.goalId),
      ),
    );
  }
}

String _channelGoalSubtitle(GoalHead head) {
  final dueDate = head.goal?.dueDate;
  if (dueDate != null && dueDate.isNotEmpty) {
    final parsed = DateTime.tryParse(dueDate);
    if (parsed != null) {
      return 'Shared goal · Due ${DateFormat('d MMMM').format(parsed)}';
    }
  }
  return 'Shared goal · ${head.status.displayLabel}';
}

class _GoalReferenceContent extends StatelessWidget {
  const _GoalReferenceContent({required this.record});

  final GoalHeadRecord record;

  @override
  Widget build(BuildContext context) {
    final head = record.head;
    final tokens = context.mobileTokens;
    final progress = goalProgressLabel(head);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(LucideIcons.target, color: tokens.action),
        const SizedBox(width: Grid.xxs),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                head.title,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: context.mobileTypography.companyEntryTitle.copyWith(
                  color: tokens.ink,
                ),
              ),
              const SizedBox(height: Grid.half),
              Text(
                head.status.displayLabel,
                style: context.mobileTypography.metadata.copyWith(
                  color: tokens.muted,
                ),
              ),
              if (progress != null) ...[
                const SizedBox(height: Grid.half),
                Text(
                  progress,
                  style: context.mobileTypography.metadata.copyWith(
                    color: tokens.action,
                  ),
                ),
              ],
            ],
          ),
        ),
        Icon(LucideIcons.chevronRight, color: tokens.muted),
      ],
    );
  }
}

class _GoalReferenceState extends StatelessWidget {
  const _GoalReferenceState({
    required this.label,
    this.title,
    this.loading = false,
  });

  final String label;
  final String? title;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Row(
      children: [
        if (loading)
          const BuzzLoadingIndicator(
            size: Grid.sm,
            semanticLabel: 'Loading goal',
          )
        else
          Icon(
            label == 'Deleted goal'
                ? LucideIcons.target
                : LucideIcons.circleHelp,
            color: tokens.muted,
          ),
        const SizedBox(width: Grid.xxs),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: context.mobileTypography.companyEntryTitle.copyWith(
                  color: tokens.ink,
                ),
              ),
              if (title != null)
                Text(
                  title!,
                  style: context.mobileTypography.metadata.copyWith(
                    color: tokens.muted,
                  ),
                ),
            ],
          ),
        ),
        Icon(LucideIcons.chevronRight, color: tokens.muted),
      ],
    );
  }
}
