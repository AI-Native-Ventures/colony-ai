import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:uuid/uuid.dart';

import '../../shared/company/goals/goal_records.dart';
import '../../shared/theme/theme.dart';

typedef CreateGoalSubmit = Future<void> Function(GoalRecord goal);
typedef GoalProgressSubmit = Future<void> Function(GoalAction action);

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
    final tokens = context.mobileTokens;

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
          Grid.gutter,
          0,
          Grid.gutter,
          MediaQuery.viewInsetsOf(context).bottom + Grid.gutter,
        ),
        child: Form(
          key: formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                'Owner: you. You can refine the plan with your team.',
                style: context.mobileTypography.body.copyWith(
                  color: tokens.muted,
                ),
              ),
              const SizedBox(height: Grid.sm),
              TextFormField(
                key: const ValueKey('goal-create-title'),
                controller: titleController,
                textCapitalization: TextCapitalization.sentences,
                maxLength: 180,
                decoration: _goalFieldDecoration(
                  context,
                  label: 'Goal',
                  hint: 'What do you want to achieve?',
                ),
                validator: (value) => _requiredText(value, 180),
              ),
              const SizedBox(height: Grid.xxs),
              TextFormField(
                key: const ValueKey('goal-create-done-condition'),
                controller: doneController,
                textCapitalization: TextCapitalization.sentences,
                minLines: 3,
                maxLines: 5,
                maxLength: 1000,
                decoration: _goalFieldDecoration(
                  context,
                  label: 'What does done look like?',
                  hint: 'A clear, observable outcome',
                ),
                validator: (value) => _requiredText(value, 1000),
              ),
              if (hasFailed.value) ...[
                const SizedBox(height: Grid.half),
                Text(
                  'Could not create this goal. Your text is still here.',
                  key: const ValueKey('goal-create-error'),
                  style: context.mobileTypography.body.copyWith(
                    color: tokens.error,
                  ),
                ),
              ],
              const SizedBox(height: Grid.xxs),
              FilledButton(
                key: const ValueKey('goal-create-submit'),
                onPressed: isSubmitting.value ? null : submit,
                style: _goalPrimaryButtonStyle(context),
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
          Grid.gutter,
          0,
          Grid.gutter,
          MediaQuery.viewInsetsOf(context).bottom + Grid.gutter,
        ),
        child: Form(
          key: formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              DropdownButtonFormField<GoalStatus>(
                key: const ValueKey('goal-progress-status'),
                initialValue: selectedStatus.value,
                decoration: _goalFieldDecoration(context, label: 'Status'),
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
              const SizedBox(height: Grid.xxs),
              TextFormField(
                key: const ValueKey('goal-progress-evidence'),
                controller: evidenceController,
                textCapitalization: TextCapitalization.sentences,
                minLines: 3,
                maxLines: 5,
                maxLength: 2000,
                decoration: _goalFieldDecoration(
                  context,
                  label: 'What changed?',
                  hint: 'Share progress or evidence',
                ),
                validator: (value) => _requiredText(value, 2000),
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
              const SizedBox(height: Grid.xxs),
              FilledButton(
                key: const ValueKey('goal-progress-submit'),
                onPressed: isSubmitting.value ? null : submit,
                style: _goalPrimaryButtonStyle(context),
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

InputDecoration _goalFieldDecoration(
  BuildContext context, {
  required String label,
  String? hint,
}) {
  final tokens = context.mobileTokens;
  return InputDecoration(
    labelText: label,
    hintText: hint,
    filled: true,
    fillColor: tokens.paper,
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

ButtonStyle _goalPrimaryButtonStyle(BuildContext context) {
  final tokens = context.mobileTokens;
  return FilledButton.styleFrom(
    backgroundColor: tokens.action,
    foregroundColor: tokens.onAction,
    textStyle: context.mobileTypography.companyEntryTitle.copyWith(
      color: tokens.onAction,
    ),
    minimumSize: const Size.fromHeight(MobileLayoutTokens.minimumTapTarget),
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
