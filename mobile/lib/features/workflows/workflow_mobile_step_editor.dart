part of 'workflow_mobile_pages.dart';

class WorkflowStepEditorPage extends HookConsumerWidget {
  const WorkflowStepEditorPage({
    required this.channelId,
    required this.workflowName,
    required this.onSave,
    this.communityName,
    this.step,
    this.onRemove,
    super.key,
  });

  final String channelId;
  final String workflowName;
  final String? communityName;
  final WorkflowStepRecord? step;
  final Future<void> Function(WorkflowStepRecord step) onSave;
  final Future<void> Function()? onRemove;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final membersAsync = ref.watch(channelMembersProvider(channelId));
    final title = useTextEditingController(text: step?.title);
    final instruction = useTextEditingController(text: step?.instruction);
    final selectedRunner = useState<String?>(
      step?.assigneePubkey ?? step?.reviewerPubkey,
    );
    final completion = useState<String?>(step?.expectedResult);
    final saveFailed = useState(false);
    final scrollController = useScrollController();
    final saving = useState(false);
    final removing = useState(false);
    final denied = useState(false);
    final actor = ref.watch(myPubkeyProvider);
    useListenable(title);
    useListenable(instruction);

    if (membersAsync.isLoading) {
      return WorkflowLoadingPage(
        workflowName: workflowName,
        communityName: communityName,
      );
    }
    if (membersAsync.hasError) {
      return WorkflowUnavailablePage(
        workflowName: workflowName,
        communityName: communityName,
        onRetry: () => ref.invalidate(channelMembersProvider(channelId)),
      );
    }
    final members = membersAsync.asData?.value ?? const <ChannelMember>[];
    final member = members
        .where(
          (candidate) =>
              candidate.pubkey.toLowerCase() ==
              selectedRunner.value?.toLowerCase(),
        )
        .firstOrNull;
    final completionChoices = <String>[
      if (member?.isBot != false) 'A draft is ready',
      'A human approves the result',
      if (member?.isBot != false &&
          completion.value != null &&
          completion.value != 'A draft is ready' &&
          completion.value != 'A human approves the result')
        completion.value!,
    ];

    void showSaveFailure() {
      saveFailed.value = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (scrollController.hasClients) scrollController.jumpTo(0);
      });
    }

    Future<void> save() async {
      if (saving.value || removing.value) return;
      final selected = member;
      if (title.text.trim().isEmpty ||
          instruction.text.trim().isEmpty ||
          selected == null) {
        return;
      }
      final kind = selected.isBot
          ? WorkflowStepKind.agent
          : WorkflowStepKind.approval;
      if (kind == WorkflowStepKind.agent && completion.value == null) return;
      saving.value = true;
      saveFailed.value = false;
      try {
        await onSave(
          WorkflowStepRecord(
            id: step?.id ?? 'step_${DateTime.now().microsecondsSinceEpoch}',
            kind: kind,
            title: title.text.trim(),
            instruction: instruction.text.trim(),
            assigneePubkey: kind == WorkflowStepKind.agent
                ? selected.pubkey.toLowerCase()
                : null,
            expectedResult: kind == WorkflowStepKind.agent
                ? completion.value
                : null,
            reviewerPubkey: kind == WorkflowStepKind.approval
                ? selected.pubkey.toLowerCase()
                : null,
          ),
        );
        if (context.mounted) Navigator.of(context).pop();
      } catch (failure) {
        if (failure is _WorkflowDraftAccessException) {
          denied.value = true;
        } else {
          showSaveFailure();
        }
      } finally {
        saving.value = false;
      }
    }

    Future<void> remove() async {
      if (onRemove == null || saving.value || removing.value) return;
      removing.value = true;
      saveFailed.value = false;
      try {
        await onRemove!();
        if (context.mounted) Navigator.of(context).pop();
      } catch (failure) {
        if (failure is _WorkflowDraftAccessException) {
          denied.value = true;
        } else {
          showSaveFailure();
        }
      } finally {
        removing.value = false;
      }
    }

    if (denied.value) {
      return Material(
        color: context.mobileTokens.canvas,
        child: Column(
          children: [
            _WorkflowHeader(
              title: workflowName,
              subtitle: communityName,
              onBack: () => unawaited(Navigator.of(context).maybePop()),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 28),
                children: [
                  const _WorkflowNotice(
                    title: 'You can view, but cannot change this',
                    message:
                        'An authorized person can make the update. Your draft has been kept.',
                    kind: _WorkflowNoticeKind.error,
                  ),
                  const SizedBox(height: 10),
                  _WorkflowActionButton(
                    label: 'Back to the record',
                    isPrimary: false,
                    onPressed: () => Navigator.of(context).maybePop(),
                  ),
                ],
              ),
            ),
          ],
        ),
      );
    }

    return Material(
      color: context.mobileTokens.canvas,
      child: Column(
        children: [
          _WorkflowHeader(
            title: workflowName,
            subtitle: communityName,
            onBack: () => unawaited(Navigator.of(context).maybePop()),
          ),
          Expanded(
            child: ListView(
              controller: scrollController,
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 28),
              children: [
                _WorkflowHero(
                  kicker: step == null ? 'New step' : 'Edit step',
                  title: 'Make it clear.',
                  message:
                      'Write the task as you would explain it to a teammate.',
                ),
                if (saveFailed.value) ...[
                  const SizedBox(height: 12),
                  const _WorkflowNotice(
                    title: 'Your changes were not saved',
                    message:
                        'Everything you typed is kept. Try again when the connection returns.',
                    kind: _WorkflowNoticeKind.error,
                  ),
                  const SizedBox(height: 16),
                ] else
                  const SizedBox(height: 16),
                _workflowFieldLabel(context, 'Step name'),
                TextField(
                  controller: title,
                  style: _workflowControlStyle(context),
                  decoration: _workflowFieldDecoration(
                    context,
                    hint: 'Step name',
                  ),
                ),
                _workflowFieldLabel(context, 'What should happen?'),
                TextField(
                  controller: instruction,
                  minLines: 5,
                  maxLines: 8,
                  style: _workflowControlStyle(context),
                  decoration: _workflowFieldDecoration(
                    context,
                    hint: 'What should happen?',
                  ),
                ),
                _workflowFieldLabel(context, 'Who does this step?'),
                DropdownButtonFormField<String>(
                  isExpanded: true,
                  key: ValueKey(selectedRunner.value),
                  initialValue:
                      members.any(
                        (candidate) =>
                            candidate.pubkey.toLowerCase() ==
                            selectedRunner.value?.toLowerCase(),
                      )
                      ? selectedRunner.value
                      : null,
                  hint: Text(
                    'Choose who does this step?',
                    style: _workflowControlStyle(context),
                  ),
                  decoration: _workflowFieldDecoration(
                    context,
                    hint: 'Who does this step?',
                  ),
                  items: [
                    for (final candidate in members)
                      DropdownMenuItem(
                        value: candidate.pubkey.toLowerCase(),
                        child: Text(
                          candidate.labelFor(actor),
                          style: _workflowControlStyle(context),
                        ),
                      ),
                  ],
                  onChanged: (value) {
                    selectedRunner.value = value;
                    saveFailed.value = false;
                  },
                ),
                _workflowFieldLabel(context, 'Done when'),
                DropdownButtonFormField<String>(
                  isExpanded: true,
                  key: ValueKey('${member?.isBot}:${completion.value}'),
                  initialValue: member?.isBot == false
                      ? 'A human approves the result'
                      : completion.value,
                  hint: Text(
                    'Choose done when',
                    style: _workflowControlStyle(context),
                  ),
                  decoration: _workflowFieldDecoration(
                    context,
                    hint: 'Done when',
                  ),
                  items: [
                    for (final choice in completionChoices)
                      DropdownMenuItem(
                        value: choice,
                        child: Text(
                          choice,
                          style: _workflowControlStyle(context),
                        ),
                      ),
                  ],
                  onChanged: (value) {
                    completion.value = value;
                    saveFailed.value = false;
                  },
                ),
                const SizedBox(height: 20),
                _WorkflowActionButton(
                  label: 'Save step',
                  isLoading: saving.value,
                  onPressed:
                      saving.value ||
                          removing.value ||
                          title.text.trim().isEmpty ||
                          instruction.text.trim().isEmpty ||
                          member == null ||
                          (member.isBot && completion.value == null)
                      ? null
                      : save,
                ),
                if (onRemove != null) ...[
                  const SizedBox(height: 9),
                  _WorkflowActionButton(
                    label: 'Remove step',
                    isPrimary: false,
                    isLoading: removing.value,
                    onPressed: saving.value || removing.value ? null : remove,
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
