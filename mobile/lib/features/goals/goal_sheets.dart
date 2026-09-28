import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:uuid/uuid.dart';

import '../../shared/company/goals/goal_records.dart';
import '../../shared/theme/theme.dart';

typedef CreateGoalSubmit = Future<void> Function(GoalRecord goal);
typedef GoalProgressSubmit = Future<void> Function(GoalAction action);

class GoalContextActionsSheet extends StatelessWidget {
  const GoalContextActionsSheet({
    this.onOpenDiscussion,
    this.onSeeSharedGoal,
    super.key,
  });

  final VoidCallback? onOpenDiscussion;
  final VoidCallback? onSeeSharedGoal;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          MobileLayoutTokens.goalContextActionHorizontalInset,
          0,
          MobileLayoutTokens.goalContextActionHorizontalInset,
          MobileLayoutTokens.goalContextActionBottomPadding,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (onOpenDiscussion != null || onSeeSharedGoal != null)
              const SizedBox(
                height: MobileLayoutTokens.goalContextActionTopGap,
              ),
            if (onOpenDiscussion case final onOpenDiscussion?) ...[
              _GoalContextActionRow(
                icon: LucideIcons.messageSquare,
                label: 'Open the discussion',
                onTap: onOpenDiscussion,
              ),
            ],
            if (onOpenDiscussion != null && onSeeSharedGoal != null)
              const SizedBox(height: MobileLayoutTokens.goalContextActionGap),
            if (onSeeSharedGoal case final onSeeSharedGoal?)
              _GoalContextActionRow(
                icon: LucideIcons.target,
                label: 'See the shared goal',
                onTap: onSeeSharedGoal,
              ),
          ],
        ),
      ),
    );
  }
}

class _GoalContextActionRow extends StatelessWidget {
  const _GoalContextActionRow({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Material(
      color: tokens.soft,
      borderRadius: BorderRadius.circular(Radii.button),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: SizedBox(
          height: MobileLayoutTokens.goalContextActionRowHeight,
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: MobileLayoutTokens.goalContextActionHorizontalInset,
            ),
            child: Row(
              children: [
                Icon(icon, size: Grid.xs, color: tokens.action),
                const SizedBox(width: Grid.xxs),
                Expanded(
                  child: Text(
                    label,
                    style: context.mobileTypography.companyEntryDescription
                        .copyWith(
                          color: tokens.ink,
                          fontWeight: FontWeight.w600,
                        ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class GoalCreateSheet extends HookConsumerWidget {
  const GoalCreateSheet({
    required this.actorPubkey,
    required this.onSubmit,
    super.key,
  });

  final String actorPubkey;
  final CreateGoalSubmit onSubmit;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final formKey = useMemoized(GlobalKey<FormState>.new);
    final titleController = useTextEditingController();
    final doneController = useTextEditingController();
    final isSubmitting = useState(false);
    final hasFailed = useState(false);

    Future<void> submit() async {
      if (isSubmitting.value || !formKey.currentState!.validate()) return;
      isSubmitting.value = true;
      hasFailed.value = false;
      final goalId = const Uuid().v4();
      final goal = GoalRecord(
        schemaVersion: goalRecordSchemaVersion,
        goalId: goalId,
        title: titleController.text.trim(),
        ownerPubkey: actorPubkey.toLowerCase(),
        doneCondition: doneController.text.trim(),
        linkedChannelIds: const [],
      );
      try {
        await onSubmit(goal);
        if (context.mounted) Navigator.of(context).pop(true);
      } catch (_) {
        hasFailed.value = true;
      } finally {
        if (context.mounted) isSubmitting.value = false;
      }
    }

    return SafeArea(
      top: false,
      child: SingleChildScrollView(
        padding: EdgeInsets.fromLTRB(
          MobileLayoutTokens.goalFormHorizontalInset,
          0,
          MobileLayoutTokens.goalFormHorizontalInset,
          MediaQuery.viewInsetsOf(context).bottom +
              MobileLayoutTokens.goalFormBottomPadding,
        ),
        child: Form(
          key: formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              const SizedBox(height: MobileLayoutTokens.goalFormHeaderFieldGap),
              _goalLabeledField(
                context,
                label: 'Goal',
                field: TextFormField(
                  key: const ValueKey('goal-create-title'),
                  controller: titleController,
                  textCapitalization: TextCapitalization.sentences,
                  style: context.mobileTypography.goalFormControl.copyWith(
                    color: context.mobileTokens.ink,
                  ),
                  maxLength: 180,
                  decoration: _goalFieldDecoration(
                    context,
                    hint: 'What do you want to achieve?',
                    height: MobileLayoutTokens.goalFormFieldHeight,
                  ),
                  validator: (value) => _requiredText(value, 180),
                ),
              ),
              const SizedBox(height: MobileLayoutTokens.goalFormFieldGap),
              _goalLabeledField(
                context,
                label: 'What does done look like?',
                field: TextFormField(
                  key: const ValueKey('goal-create-done-condition'),
                  controller: doneController,
                  textCapitalization: TextCapitalization.sentences,
                  style: context.mobileTypography.goalFormControl.copyWith(
                    color: context.mobileTokens.ink,
                  ),
                  minLines: 3,
                  maxLines: 5,
                  maxLength: 1000,
                  decoration: _goalFieldDecoration(
                    context,
                    hint: 'A clear, observable outcome',
                    multiline: true,
                    height: MobileLayoutTokens.goalFormMultilineHeight,
                  ),
                  validator: (value) => _requiredText(value, 1000),
                ),
              ),
              const SizedBox(height: Grid.twelve),
              Text(
                'Owner: you. You can refine the plan with your team.',
                style: context.mobileTypography.goalBody.copyWith(
                  color: context.mobileTokens.muted,
                ),
              ),
              if (hasFailed.value) ...[
                const SizedBox(height: Grid.half),
                Text(
                  'Could not create this goal. Your text is still here.',
                  key: const ValueKey('goal-create-error'),
                  style: context.mobileTypography.body.copyWith(
                    color: context.mobileTokens.error,
                  ),
                ),
              ],
              const SizedBox(height: Grid.twelve),
              FilledButton(
                key: const ValueKey('goal-create-submit'),
                onPressed: isSubmitting.value ? null : submit,
                style: _goalPrimaryButtonStyle(
                  context,
                  minHeight: MobileLayoutTokens.goalFormButtonHeight,
                ),
                child: isSubmitting.value
                    ? const SizedBox.square(
                        dimension: Grid.sm,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('Create goal'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class GoalProgressSheet extends HookConsumerWidget {
  const GoalProgressSheet({
    required this.record,
    required this.onSubmit,
    super.key,
  });

  final GoalHeadRecord record;
  final GoalProgressSubmit onSubmit;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final formKey = useMemoized(GlobalKey<FormState>.new);
    final evidenceController = useTextEditingController();
    final selectedStatus = useState(record.head.status);
    final isSubmitting = useState(false);
    final hasFailed = useState(false);
    final tokens = context.mobileTokens;

    Future<void> submit() async {
      if (isSubmitting.value || !formKey.currentState!.validate()) return;
      isSubmitting.value = true;
      hasFailed.value = false;
      final selected = selectedStatus.value;
      final action = GoalAction(
        goalId: record.head.goalId,
        action: GoalActionType.progress,
        expectedHeadEventId: record.event.id,
        progress: GoalProgress(
          current: record.head.progress?.current,
          evidence: evidenceController.text.trim(),
        ),
        status: selected == record.head.status ? null : selected,
      );
      try {
        await onSubmit(action);
        if (context.mounted) Navigator.of(context).pop(true);
      } catch (_) {
        hasFailed.value = true;
      } finally {
        if (context.mounted) isSubmitting.value = false;
      }
    }

    return SafeArea(
      top: false,
      child: SingleChildScrollView(
        padding: EdgeInsets.fromLTRB(
          MobileLayoutTokens.goalFormHorizontalInset,
          0,
          MobileLayoutTokens.goalFormHorizontalInset,
          MediaQuery.viewInsetsOf(context).bottom +
              MobileLayoutTokens.goalFormBottomPadding,
        ),
        child: Form(
          key: formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              const SizedBox(
                height: MobileLayoutTokens.goalProgressHeaderFieldGap,
              ),
              _goalLabeledField(
                context,
                label: 'Status',
                field: DropdownButtonFormField<GoalStatus>(
                  key: const ValueKey('goal-progress-status'),
                  initialValue: selectedStatus.value,
                  style: context.mobileTypography.goalFormControl.copyWith(
                    color: tokens.ink,
                  ),
                  decoration: _goalFieldDecoration(
                    context,
                    height: MobileLayoutTokens.goalProgressStatusHeight,
                  ),
                  items: const [
                    DropdownMenuItem(
                      value: GoalStatus.active,
                      child: Text('On track'),
                    ),
                    DropdownMenuItem(
                      value: GoalStatus.offPace,
                      child: Text('Needs attention'),
                    ),
                    DropdownMenuItem(
                      value: GoalStatus.achieved,
                      child: Text('Achieved'),
                    ),
                  ],
                  onChanged: isSubmitting.value
                      ? null
                      : (status) {
                          if (status != null) selectedStatus.value = status;
                        },
                ),
              ),
              const SizedBox(height: MobileLayoutTokens.goalProgressFieldGap),
              _goalLabeledField(
                context,
                label: 'What changed?',
                field: TextFormField(
                  key: const ValueKey('goal-progress-evidence'),
                  controller: evidenceController,
                  textCapitalization: TextCapitalization.sentences,
                  style: context.mobileTypography.goalFormControl.copyWith(
                    color: tokens.ink,
                  ),
                  minLines: 3,
                  maxLines: 5,
                  maxLength: 2000,
                  decoration: _goalFieldDecoration(
                    context,
                    hint: 'Share progress or evidence…',
                    multiline: true,
                    height: MobileLayoutTokens.goalFormMultilineHeight,
                  ),
                  validator: (value) => _requiredText(value, 2000),
                ),
              ),
              if (hasFailed.value) ...[
                const SizedBox(height: Grid.half),
                Text(
                  'Could not save this update. Your text is still here.',
                  key: const ValueKey('goal-progress-error'),
                  style: context.mobileTypography.body.copyWith(
                    color: tokens.error,
                  ),
                ),
              ],
              const SizedBox(height: MobileLayoutTokens.goalProgressSubmitGap),
              FilledButton(
                key: const ValueKey('goal-progress-submit'),
                onPressed: isSubmitting.value ? null : submit,
                style: _goalPrimaryButtonStyle(
                  context,
                  minHeight: MobileLayoutTokens.goalFormButtonHeight,
                ),
                child: isSubmitting.value
                    ? const SizedBox.square(
                        dimension: Grid.sm,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('Save update'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

Widget _goalLabeledField(
  BuildContext context, {
  required String label,
  required Widget field,
}) {
  final tokens = context.mobileTokens;
  return MergeSemantics(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          label,
          style: context.mobileTypography.goalFormLabel.copyWith(
            color: tokens.ink,
          ),
        ),
        const SizedBox(height: Grid.half),
        field,
      ],
    ),
  );
}

InputDecoration _goalFieldDecoration(
  BuildContext context, {
  String? hint,
  bool multiline = false,
  required double height,
}) {
  final tokens = context.mobileTokens;
  return InputDecoration(
    hintText: hint,
    filled: true,
    fillColor: tokens.canvas,
    isDense: true,
    constraints: BoxConstraints.tightFor(height: height),
    hintStyle: context.mobileTypography.goalFormControl.copyWith(
      color: tokens.muted,
    ),
    contentPadding: EdgeInsets.symmetric(
      horizontal: Grid.twelve,
      vertical: multiline
          ? MobileLayoutTokens.goalFormMultilineVerticalPadding
          : Grid.twelve,
    ),
    counterText: '',
    border: OutlineInputBorder(
      borderRadius: BorderRadius.circular(Radii.field),
      borderSide: BorderSide(color: tokens.line),
    ),
    enabledBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(Radii.field),
      borderSide: BorderSide(color: tokens.line),
    ),
    focusedBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(Radii.field),
      borderSide: BorderSide(color: tokens.action),
    ),
  );
}

ButtonStyle _goalPrimaryButtonStyle(
  BuildContext context, {
  double minHeight = MobileLayoutTokens.minimumTapTarget,
}) {
  final tokens = context.mobileTokens;
  return FilledButton.styleFrom(
    backgroundColor: tokens.action,
    foregroundColor: tokens.onAction,
    textStyle: context.mobileTypography.companyEntryTitle.copyWith(
      color: tokens.onAction,
    ),
    minimumSize: Size.fromHeight(minHeight),
    maximumSize: Size.fromHeight(minHeight),
    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
    padding: EdgeInsets.zero,
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(Radii.button),
    ),
  );
}

String? _requiredText(String? value, int maximum) {
  final text = value?.trim() ?? '';
  if (text.isEmpty) return 'Required';
  if (text.length > maximum) return 'Use $maximum characters or fewer';
  return null;
}
