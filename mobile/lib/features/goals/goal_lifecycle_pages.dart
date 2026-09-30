import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../shared/community/community_provider.dart';
import '../../shared/community/community_membership_provider.dart';
import '../../shared/company/goals/goal_records.dart';
import '../../shared/company/goals/goal_repository.dart';
import '../../shared/business/mobile_business_entry_points.dart';
import '../../shared/navigation/mobile_navigation.dart';
import '../../shared/navigation/mobile_route.dart';
import '../../shared/relay/relay.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/buzz_loading_indicator.dart';
import 'goal_widgets.dart';

part 'goal_lifecycle_components.dart';

class GoalActionsPage extends HookConsumerWidget {
  const GoalActionsPage({required this.goalId, super.key});

  final String goalId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final recordAsync = ref.watch(goalHeadProvider(goalId));
    final role = ref.watch(currentCommunityRoleProvider).asData?.value?.name;
    final actor = ref.watch(myPubkeyProvider);
    final community = ref.watch(activeCommunityProvider).asData?.value;
    return Material(
      color: context.mobileTokens.canvas,
      child: Column(
        children: [
          GoalPageHeader(
            title: recordAsync.asData?.value?.head.title ?? 'Goal actions',
            subtitle: community?.name,
            onBack: () => unawaited(Navigator.of(context).maybePop()),
            action: () => unawaited(Navigator.of(context).maybePop()),
            actionLabel: 'Close goal actions',
            actionIcon: LucideIcons.ellipsis,
          ),
          Expanded(
            child: recordAsync.when(
              loading: () => const Center(child: BuzzLoadingIndicator()),
              error: (_, _) => const _GoalPageError(),
              data: (record) {
                if (record == null || record.head.goal == null) {
                  return const _GoalPageError();
                }
                final head = record.head;
                final canEdit = canUpdateGoal(
                  role: role,
                  actorPubkey: actor,
                  head: head,
                );
                return ListView(
                  padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
                  children: [
                    _GoalActionBanner(title: 'Keep the direction clear.'),
                    const SizedBox(height: 16),
                    _GoalActionRow(
                      icon: LucideIcons.pencil,
                      title: 'Edit goal',
                      subtitle: 'Save title, done condition or status',
                      onTap: () => Navigator.of(context).push<void>(
                        MaterialPageRoute<void>(
                          builder: (_) => canEdit
                              ? GoalEditPage(goalId: goalId)
                              : GoalDeniedPage(goalId: goalId),
                        ),
                      ),
                    ),
                    if (canEdit && head.status != GoalStatus.archived) ...[
                      const SizedBox(height: 12),
                      _GoalActionRow(
                        icon: LucideIcons.archive,
                        title: 'Archive goal',
                        subtitle: 'Hide from active goals, keep its history',
                        onTap: () => Navigator.of(context).push<void>(
                          MaterialPageRoute<void>(
                            builder: (_) => GoalLifecycleConfirmationPage(
                              goalId: goalId,
                              action: GoalLifecycleAction.archive,
                            ),
                          ),
                        ),
                      ),
                    ],
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

class GoalEditPage extends HookConsumerWidget {
  const GoalEditPage({required this.goalId, super.key});

  final String goalId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final recordAsync = ref.watch(goalHeadProvider(goalId));
    final role = ref.watch(currentCommunityRoleProvider).asData?.value?.name;
    final actor = ref.watch(myPubkeyProvider);
    final community = ref.watch(activeCommunityProvider).asData?.value;
    final record = recordAsync.asData?.value;
    final goal = record?.head.goal;
    final titleController = useTextEditingController(text: goal?.title);
    final conditionController = useTextEditingController(
      text: goal?.doneCondition,
    );
    final titleDirty = useState(false);
    final conditionDirty = useState(false);
    final selectedStatus = useState<GoalStatus>(
      record?.head.status ?? GoalStatus.active,
    );
    final statusDirty = useState(false);
    final currentRecord = useState<GoalHeadRecord?>(record);
    final savingField = useState<String?>(null);
    final savedFields = useState(<String>{});
    final failureField = useState<String?>(null);

    useEffect(
      () {
        if (record != null &&
            currentRecord.value?.event.id != record.event.id) {
          currentRecord.value = record;
          if (!titleDirty.value) {
            titleController.text = record.head.goal?.title ?? record.head.title;
          }
          if (!conditionDirty.value) {
            conditionController.text = record.head.goal?.doneCondition ?? '';
          }
        }
        if (record != null && !statusDirty.value) {
          selectedStatus.value = record.head.status;
        }
        return null;
      },
      [
        record?.event.id,
        statusDirty.value,
        titleDirty.value,
        conditionDirty.value,
      ],
    );

    void markTextFieldClean(String field) {
      if (field == 'title') titleDirty.value = false;
      if (field == 'condition') conditionDirty.value = false;
    }

    Future<GoalHeadRecord?> reloadCurrent() async {
      ref.invalidate(goalHeadsProvider);
      final refreshed = await ref.read(goalHeadsProvider.future);
      return refreshed
          .where((item) => item.head.goalId == goalId.toLowerCase())
          .firstOrNull;
    }

    Future<void> saveField(String field) async {
      if (savingField.value != null) return;
      final current = currentRecord.value;
      final currentGoal = current?.head.goal;
      if (current == null || currentGoal == null) return;
      if (!canUpdateGoal(role: role, actorPubkey: actor, head: current.head)) {
        failureField.value = field;
        return;
      }
      final title = titleController.text.trim();
      final condition = conditionController.text.trim();
      if (field == 'title' && title.isEmpty) {
        failureField.value = field;
        return;
      }
      if (field == 'condition' && condition.isEmpty) {
        failureField.value = field;
        return;
      }
      savingField.value = field;
      failureField.value = null;
      final submittedStatus = selectedStatus.value;
      try {
        final repository = ref.read(goalRepositoryProvider);
        if (field == 'title' || field == 'condition') {
          final updatedGoal = GoalRecord(
            schemaVersion: currentGoal.schemaVersion,
            goalId: currentGoal.goalId,
            parentGoalId: currentGoal.parentGoalId,
            title: field == 'title' ? title : currentGoal.title,
            ownerPubkey: currentGoal.ownerPubkey,
            dueDate: currentGoal.dueDate,
            doneCondition: field == 'condition'
                ? condition
                : currentGoal.doneCondition,
            target: currentGoal.target,
            linkedChannelIds: currentGoal.linkedChannelIds,
          );
          await repository.submit(
            GoalAction(
              goalId: current.head.goalId,
              action: GoalActionType.update,
              expectedHeadEventId: current.event.id,
              goal: updatedGoal,
            ),
          );
        } else {
          final previous = current.head.status.displayLabel;
          final next = submittedStatus.displayLabel;
          if (submittedStatus == current.head.status) {
            savedFields.value = {...savedFields.value, field};
            statusDirty.value = false;
            failureField.value = null;
            return;
          }
          await repository.submit(
            GoalAction(
              goalId: current.head.goalId,
              action: GoalActionType.setStatus,
              expectedHeadEventId: current.event.id,
              status: submittedStatus,
              reason:
                  'Status changed from $previous to $next in goal settings.',
            ),
          );
        }
      } catch (error) {
        GoalHeadRecord? latest;
        try {
          latest = await reloadCurrent();
        } catch (_) {
          // The write was not acknowledged and its outcome cannot be resolved.
        }
        if (latest != null &&
            _fieldMatches(latest, field, title, condition, submittedStatus)) {
          currentRecord.value = latest;
          markTextFieldClean(field);
          if (field == 'status') {
            selectedStatus.value = latest.head.status;
            statusDirty.value = false;
          }
          savedFields.value = {...savedFields.value, field};
          failureField.value = null;
          return;
        }
        failureField.value = field;
        return;
      } finally {
        savingField.value = null;
      }

      try {
        final latest = await reloadCurrent();
        if (latest == null) {
          markTextFieldClean(field);
          savedFields.value = {...savedFields.value, field};
          failureField.value = null;
        } else {
          currentRecord.value = latest;
          markTextFieldClean(field);
          if (field == 'status') {
            selectedStatus.value = latest.head.status;
            statusDirty.value = false;
          }
          savedFields.value = {...savedFields.value, field};
          failureField.value = null;
        }
      } catch (_) {
        markTextFieldClean(field);
        savedFields.value = {...savedFields.value, field};
        failureField.value = null;
      }
    }

    return Material(
      color: context.mobileTokens.canvas,
      child: Column(
        children: [
          GoalPageHeader(
            title: currentRecord.value?.head.title ?? 'Edit goal',
            subtitle: community?.name,
            onBack: () => unawaited(Navigator.of(context).maybePop()),
            action: () => unawaited(Navigator.of(context).maybePop()),
            actionLabel: 'Close goal editor',
            actionIcon: LucideIcons.ellipsis,
          ),
          Expanded(
            child: recordAsync.when(
              loading: () => const Center(child: BuzzLoadingIndicator()),
              error: (_, _) => const _GoalPageError(),
              data: (loaded) {
                final editable = currentRecord.value ?? loaded;
                final editableGoal = editable?.head.goal;
                if (editable == null || editableGoal == null) {
                  return const _GoalPageError();
                }
                if (!canUpdateGoal(
                  role: role,
                  actorPubkey: actor,
                  head: editable.head,
                )) {
                  return GoalDeniedContent(
                    onReturn: () => unawaited(Navigator.of(context).maybePop()),
                  );
                }
                final isDesignedPartialState =
                    failureField.value == 'condition' &&
                    savedFields.value.contains('title') &&
                    !savedFields.value.contains('status');
                final hasSaveFailure = failureField.value != null;
                final allFieldsSaved =
                    failureField.value == null && savedFields.value.length == 3;
                return ListView(
                  padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
                  children: [
                    _GoalActionBanner(
                      kicker: 'EDIT GOAL',
                      title: 'One change at a time.',
                      message:
                          'Each field has its own Save button. Saving one does not save the others.',
                    ),
                    if (isDesignedPartialState) ...[
                      const SizedBox(height: 14),
                      const _GoalNotice(
                        title: 'Title saved. Done condition failed.',
                        message:
                            'Your done condition is still typed below. Status has not been changed.',
                        isError: true,
                      ),
                    ],
                    if (hasSaveFailure && !isDesignedPartialState) ...[
                      const SizedBox(height: 14),
                      const _GoalNotice(
                        title: 'Could not save',
                        message:
                            'Your entries are still here. Retry this action.',
                        isError: true,
                      ),
                    ],
                    if (allFieldsSaved) ...[
                      const SizedBox(height: 14),
                      const _GoalNotice(
                        title: 'Changes saved',
                        message: 'Each field was acknowledged by its own save.',
                      ),
                    ],
                    const SizedBox(height: 14),
                    _GoalEditFieldCard(
                      title: 'Title',
                      label: 'Goal title',
                      controller: titleController,
                      buttonLabel: 'Save title',
                      isSaving: savingField.value == 'title',
                      onSave: () => saveField('title'),
                      onChanged: (_) {
                        titleDirty.value = true;
                        if (savedFields.value.contains('title')) {
                          savedFields.value = {...savedFields.value}
                            ..remove('title');
                        }
                      },
                    ),
                    const SizedBox(height: 12),
                    _GoalEditFieldCard(
                      title: 'Done condition',
                      label: 'What does done look like?',
                      controller: conditionController,
                      buttonLabel: isDesignedPartialState
                          ? 'Retry done condition'
                          : 'Save done condition',
                      isSaving: savingField.value == 'condition',
                      maxLines: 3,
                      onSave: () => saveField('condition'),
                      onChanged: (_) {
                        conditionDirty.value = true;
                        if (savedFields.value.contains('condition')) {
                          savedFields.value = {...savedFields.value}
                            ..remove('condition');
                        }
                      },
                    ),
                    const SizedBox(height: 12),
                    _GoalStatusFieldCard(
                      status: selectedStatus.value,
                      isSaving: savingField.value == 'status',
                      onChanged: (status) {
                        selectedStatus.value = status;
                        statusDirty.value = true;
                        savedFields.value = {...savedFields.value}
                          ..remove('status');
                      },
                      onSave: () => saveField('status'),
                    ),
                    const SizedBox(height: 12),
                    _GoalWideButton(
                      label: 'Back to goal',
                      isPrimary: false,
                      onPressed: () =>
                          unawaited(Navigator.of(context).maybePop()),
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

enum GoalLifecycleAction { archive, delete }

class GoalLifecycleConfirmationPage extends HookConsumerWidget {
  const GoalLifecycleConfirmationPage({
    required this.goalId,
    required this.action,
    super.key,
  });

  final String goalId;
  final GoalLifecycleAction action;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final recordAsync = ref.watch(goalHeadProvider(goalId));
    final community = ref.watch(activeCommunityProvider).asData?.value;
    final saving = useState(false);
    final failure = useState<String?>(null);
    final isDelete = action == GoalLifecycleAction.delete;
    final title = isDelete ? 'Delete this draft goal?' : 'Archive this goal?';
    final body = isDelete
        ? 'A goal with work or sub-goals must be archived or unlinked first.'
        : 'Its sub-goals, linked work and discussion remain accessible. It leaves the active goals list.';
    Future<void> confirm(GoalHeadRecord record) async {
      if (saving.value) return;
      saving.value = true;
      failure.value = null;
      try {
        ref.invalidate(goalHeadsProvider);
        final latestRecords = await ref.read(goalHeadsProvider.future);
        final latest = latestRecords
            .where((item) => item.head.goalId == goalId.toLowerCase())
            .firstOrNull;
        if (latest == null || latest.event.id != record.event.id) {
          throw const GoalChangedException();
        }
        await ref
            .read(goalRepositoryProvider)
            .submit(
              GoalAction(
                goalId: latest.head.goalId,
                action: isDelete
                    ? GoalActionType.delete
                    : GoalActionType.archive,
                expectedHeadEventId: latest.event.id,
              ),
            );
        ref.invalidate(goalHeadsProvider);
        await ref.read(goalHeadsProvider.future);
        if (!context.mounted) return;
        Navigator.of(context).pushReplacement<void, void>(
          MaterialPageRoute<void>(
            builder: (_) =>
                GoalLifecycleFeedbackPage(goalId: goalId, action: action),
          ),
        );
      } catch (_) {
        failure.value = 'Your entries are still here. Retry this action.';
      } finally {
        saving.value = false;
      }
    }

    return ColoredBox(
      color: context.mobileTokens.canvas,
      child: Column(
        children: [
          GoalPageHeader(
            title: recordAsync.asData?.value?.head.title ?? 'Goal actions',
            subtitle: community?.name,
            onBack: () => unawaited(Navigator.of(context).maybePop()),
            action: () => unawaited(Navigator.of(context).maybePop()),
            actionLabel: 'Keep goal',
            actionIcon: LucideIcons.ellipsis,
          ),
          Expanded(
            child: recordAsync.when(
              loading: () => const Center(child: BuzzLoadingIndicator()),
              error: (_, _) => const _GoalPageError(),
              data: (record) {
                if (record == null) return const _GoalPageError();
                return ListView(
                  padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
                  children: [
                    _GoalConfirmationCard(
                      title: title,
                      message: body,
                      failure: failure.value,
                      primaryLabel: isDelete
                          ? 'Delete unlinked draft'
                          : 'Archive goal',
                      primarySaving: saving.value,
                      onConfirm: () => confirm(record),
                      onCancel: () =>
                          unawaited(Navigator.of(context).maybePop()),
                      cancelLabel: isDelete ? 'Keep draft' : 'Keep goal',
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

class GoalLifecycleFeedbackPage extends HookConsumerWidget {
  const GoalLifecycleFeedbackPage({
    required this.goalId,
    required this.action,
    super.key,
  });

  final String goalId;
  final GoalLifecycleAction action;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final record = ref.watch(goalHeadProvider(goalId)).asData?.value;
    final role = ref.watch(currentCommunityRoleProvider).asData?.value?.name;
    final community = ref.watch(activeCommunityProvider).asData?.value;
    final isDelete = action == GoalLifecycleAction.delete;
    return ColoredBox(
      color: context.mobileTokens.canvas,
      child: Column(
        children: [
          GoalPageHeader(
            title: record?.head.title ?? 'Goal actions',
            subtitle: community?.name,
            onBack: () => unawaited(Navigator.of(context).maybePop()),
            action: () => unawaited(Navigator.of(context).maybePop()),
            actionLabel: 'Goal actions',
            actionIcon: LucideIcons.ellipsis,
          ),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
              children: [
                _GoalActionBanner(
                  kicker: isDelete ? 'DELETED' : 'ARCHIVED',
                  title: record?.head.title ?? 'Goal',
                  message: isDelete
                      ? 'The discussion and other goals remain.'
                      : 'Its history is still here.',
                ),
                if (!isDelete && canRestoreOrDeleteGoal(role)) ...[
                  const SizedBox(height: 12),
                  _GoalWideButton(
                    label: 'Restore goal',
                    isPrimary: true,
                    onPressed: record == null
                        ? null
                        : () => _restoreGoal(context, ref, record),
                  ),
                ],
                const SizedBox(height: 10),
                _GoalWideButton(
                  label: 'Back to goals',
                  isPrimary: false,
                  onPressed: () => _backToGoal(context, ref),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class GoalDeniedPage extends HookConsumerWidget {
  const GoalDeniedPage({required this.goalId, super.key});

  final String goalId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final record = ref.watch(goalHeadProvider(goalId)).asData?.value;
    final community = ref.watch(activeCommunityProvider).asData?.value;
    return ColoredBox(
      color: context.mobileTokens.canvas,
      child: Column(
        children: [
          GoalPageHeader(
            title: record?.head.title ?? 'Goal actions',
            subtitle: community?.name,
            onBack: () => unawaited(Navigator.of(context).maybePop()),
            action: () => unawaited(Navigator.of(context).maybePop()),
            actionLabel: 'Goal actions',
            actionIcon: LucideIcons.ellipsis,
          ),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
              children: [
                const GoalDeniedContent(),
                const SizedBox(height: 12),
                _GoalWideButton(
                  label: 'Return to goal',
                  isPrimary: true,
                  onPressed: () => unawaited(Navigator.of(context).maybePop()),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class GoalDeniedContent extends StatelessWidget {
  const GoalDeniedContent({this.onReturn, super.key});

  final VoidCallback? onReturn;

  @override
  Widget build(BuildContext context) => _GoalNotice(
    title: 'You cannot edit this goal',
    message:
        'Your role allows you to read it. Ask the goal owner or an authorized manager to change it.',
    isError: true,
  );
}

Future<void> _restoreGoal(
  BuildContext context,
  WidgetRef ref,
  GoalHeadRecord record,
) async {
  try {
    await ref
        .read(goalRepositoryProvider)
        .submit(
          GoalAction(
            goalId: record.head.goalId,
            action: GoalActionType.restore,
            expectedHeadEventId: record.event.id,
          ),
        );
    ref.invalidate(goalHeadsProvider);
    await ref.read(goalHeadsProvider.future);
    if (context.mounted) {
      Navigator.of(context).pop();
    }
  } catch (error) {
    if (context.mounted) {
      Navigator.of(context).push<void>(
        MaterialPageRoute<void>(
          builder: (_) => GoalRestoreFailedPage(goalId: record.head.goalId),
        ),
      );
    }
  }
}

class GoalRestoreFailedPage extends HookConsumerWidget {
  const GoalRestoreFailedPage({required this.goalId, super.key});

  final String goalId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final record = ref.watch(goalHeadProvider(goalId)).asData?.value;
    final community = ref.watch(activeCommunityProvider).asData?.value;
    final role = ref.watch(currentCommunityRoleProvider).asData?.value?.name;
    final restoring = useState(false);
    final retryFailed = useState(false);
    Future<void> retry() async {
      if (restoring.value || record == null) return;
      restoring.value = true;
      retryFailed.value = false;
      try {
        await ref
            .read(goalRepositoryProvider)
            .submit(
              GoalAction(
                goalId: record.head.goalId,
                action: GoalActionType.restore,
                expectedHeadEventId: record.event.id,
              ),
            );
        ref.invalidate(goalHeadsProvider);
        await ref.read(goalHeadsProvider.future);
        if (context.mounted) Navigator.of(context).pop();
      } catch (_) {
        retryFailed.value = true;
      } finally {
        restoring.value = false;
      }
    }

    return ColoredBox(
      color: context.mobileTokens.canvas,
      child: Column(
        children: [
          GoalPageHeader(
            title: record?.head.title ?? 'Archived goal',
            subtitle: community?.name,
            onBack: () => unawaited(Navigator.of(context).maybePop()),
            action: () => unawaited(Navigator.of(context).maybePop()),
            actionLabel: 'Goal actions',
            actionIcon: LucideIcons.ellipsis,
          ),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
              children: [
                _GoalActionBanner(
                  kicker: 'ARCHIVED',
                  title: record?.head.title ?? 'Goal',
                  message: 'Its history is still here.',
                ),
                const SizedBox(height: 12),
                _GoalNotice(
                  title: 'Could not restore the goal',
                  message: retryFailed.value
                      ? 'It is still archived. Nothing has been removed.'
                      : 'It is still archived. Nothing has been removed.',
                  isError: true,
                ),
                if (canRestoreOrDeleteGoal(role)) ...[
                  const SizedBox(height: 12),
                  _GoalWideButton(
                    label: 'Restore goal',
                    isPrimary: true,
                    isSaving: restoring.value,
                    onPressed: retry,
                  ),
                ],
                const SizedBox(height: 10),
                _GoalWideButton(
                  label: 'Back to goals',
                  isPrimary: false,
                  onPressed: () => _backToGoal(context, ref),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

bool _fieldMatches(
  GoalHeadRecord record,
  String field,
  String title,
  String condition,
  GoalStatus status,
) {
  final goal = record.head.goal;
  if (goal == null) return false;
  return switch (field) {
    'title' => goal.title == title,
    'condition' => goal.doneCondition == condition,
    'status' => record.head.status == status,
    _ => false,
  };
}

Future<void> _backToGoal(BuildContext context, WidgetRef ref) async {
  ref.invalidate(goalHeadsProvider);
  await MobileNavigation.replace<NoMobileRouteArguments>(
    context,
    MobileBusinessRoutes.goals,
    const NoMobileRouteArguments(),
  );
}

class _GoalPageError extends StatelessWidget {
  const _GoalPageError();

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(24),
      child: Text(
        'This goal is not available right now.',
        style: context.mobileTypography.goalBody.copyWith(
          color: context.mobileTokens.muted,
        ),
      ),
    ),
  );
}

class GoalChangedException implements Exception {
  const GoalChangedException();
}
