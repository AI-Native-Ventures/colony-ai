import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../shared/company/workflows/workflow_records.dart';
import '../../shared/company/workflows/workflow_repository.dart';
import '../../shared/company/workflows/workflow_run_repository.dart';
import '../../shared/community/community_provider.dart';
import '../../shared/relay/relay.dart';
import '../../shared/theme/theme.dart';
import '../../shared/utils/string_utils.dart';
import '../channels/channel.dart';
import '../channels/channel_management_provider.dart';
import '../channels/channels_provider.dart';

part 'workflow_mobile_components.dart';

class WorkflowPickerPage extends HookConsumerWidget {
  const WorkflowPickerPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final channelsAsync = ref.watch(channelsProvider);
    final community = ref.watch(activeCommunityProvider).asData?.value;
    final actor = ref.watch(myPubkeyProvider)?.toLowerCase();
    return Material(
      color: context.mobileTokens.canvas,
      child: Column(
        children: [
          _WorkflowHeader(
            title: 'Workflows',
            subtitle: community?.name,
            onBack: () => unawaited(Navigator.of(context).maybePop()),
          ),
          Expanded(
            child: channelsAsync.when(
              loading: () => const _WorkflowLoadingContent(),
              error: (_, _) => _WorkflowUnavailableContent(
                onRetry: () => ref.invalidate(channelsProvider),
              ),
              data: (allChannels) {
                final channels = allChannels
                    .where((channel) => channel.isMember && channel.isStream)
                    .toList();
                final ids = channels.map((channel) => channel.id).toList()
                  ..sort();
                final query = WorkflowPickerQuery(
                  channelIds: ids,
                  ownerPubkey: actor,
                );
                final workflows = ref.watch(workflowPickerProvider(query));
                return workflows.when(
                  loading: () => const _WorkflowLoadingContent(),
                  error: (_, _) => _WorkflowUnavailableContent(
                    onRetry: () =>
                        ref.invalidate(workflowPickerProvider(query)),
                  ),
                  data: (records) {
                    final draftsById = {
                      for (final record in records)
                        if (record.isDraft) record.workflowId: record,
                    };
                    final activeById = {
                      for (final record in records)
                        if (!record.isDraft) record.workflowId: record,
                    };
                    final visibleRecords =
                        <WorkflowRecord>[
                          ...activeById.values,
                          for (final draft in draftsById.values)
                            if (!activeById.containsKey(draft.workflowId))
                              draft,
                        ]..sort(
                          (left, right) => right.event.createdAt.compareTo(
                            left.event.createdAt,
                          ),
                        );
                    return ListView(
                      padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
                      children: [
                        const _WorkflowHero(
                          kicker: 'Team routines',
                          title: 'Good work, on repeat.',
                          message:
                              'Choose a workflow to see its steps and runs.',
                        ),
                        const SizedBox(height: 16),
                        for (final record in visibleRecords)
                          _WorkflowPickerRow(
                            record: record,
                            onTap: () {
                              final route = record.isDraft
                                  ? WorkflowDraftEditorPage(
                                      draft: record,
                                      channels: channels,
                                    )
                                  : WorkflowDetailMobilePage(
                                      record: record,
                                      existingDraft:
                                          draftsById[record.workflowId],
                                      activeVersion: record,
                                      channels: channels,
                                    );
                              Navigator.of(context).push<void>(
                                MaterialPageRoute<void>(builder: (_) => route),
                              );
                            },
                          ),
                      ],
                    );
                  },
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class WorkflowDetailMobilePage extends HookConsumerWidget {
  const WorkflowDetailMobilePage({
    required this.record,
    required this.channels,
    this.existingDraft,
    this.activeVersion,
    this.showPublishedNotice = false,
    super.key,
  });

  final WorkflowRecord record;
  final WorkflowRecord? existingDraft;
  final WorkflowRecord? activeVersion;
  final List<Channel> channels;
  final bool showPublishedNotice;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final actor = ref.watch(myPubkeyProvider)?.toLowerCase();
    final community = ref.watch(activeCommunityProvider).asData?.value;
    final membersAsync = ref.watch(channelMembersProvider(record.channelId));
    final runsAsync = record.isDraft
        ? null
        : ref.watch(workflowRunsProvider(record.workflowId));
    final canEditDraft = actor != null && actor == record.ownerPubkey;

    Future<void> editDraft([int? stepIndex]) async {
      WorkflowRecord? draft;
      try {
        draft =
            existingDraft ??
            await ref
                .read(workflowRepositoryProvider)
                .loadDraft(
                  workflowId: record.workflowId,
                  channelId: record.channelId,
                  ownerPubkey: record.ownerPubkey,
                );
      } catch (_) {
        if (!context.mounted) return;
        await Navigator.of(context).push<void>(
          MaterialPageRoute<void>(
            builder: (_) => WorkflowUnavailablePage(
              workflowName: record.name,
              communityName: community?.name,
              onRetry: () => editDraft(stepIndex),
            ),
          ),
        );
        return;
      }
      if (!context.mounted) return;
      await Navigator.of(context).push<void>(
        MaterialPageRoute<void>(
          builder: (_) => WorkflowDraftEditorPage(
            source: record,
            draft: draft,
            channels: channels,
            initialStepIndex: stepIndex,
          ),
        ),
      );
    }

    Future<void> startRun() async {
      try {
        final runId = await ref
            .read(workflowRepositoryProvider)
            .trigger(record.workflowId);
        ref.invalidate(workflowRunsProvider(record.workflowId));
        if (!context.mounted) return;
        await Navigator.of(context).push<void>(
          MaterialPageRoute<void>(
            builder: (_) => WorkflowRunMobilePage(
              workflowId: record.workflowId,
              runId: runId,
              workflowName: record.name,
              activeVersion: record,
            ),
          ),
        );
      } catch (error) {
        if (!context.mounted) return;
        await Navigator.of(context).push<void>(
          MaterialPageRoute<void>(
            builder: (_) => WorkflowUnavailablePage(
              workflowName: record.name,
              communityName: community?.name,
              onRetry: startRun,
            ),
          ),
        );
      }
    }

    if (record.isDraft) {
      return WorkflowDraftEditorPage(
        source: activeVersion,
        draft: record,
        channels: channels,
      );
    }

    if (runsAsync!.isLoading) {
      return WorkflowLoadingPage(
        workflowName: record.name,
        communityName: community?.name,
      );
    }
    if (runsAsync.hasError) {
      return WorkflowUnavailablePage(
        workflowName: record.name,
        communityName: community?.name,
        onRetry: () => ref.invalidate(workflowRunsProvider(record.workflowId)),
      );
    }
    final runs = runsAsync.asData?.value ?? const <WorkflowRunRecord>[];
    final latestRun = runs.isEmpty
        ? null
        : runs.reduce(
            (latest, candidate) =>
                candidate.createdAt > latest.createdAt ? candidate : latest,
          );

    return Material(
      color: context.mobileTokens.canvas,
      child: Column(
        children: [
          _WorkflowHeader(
            title: record.name,
            subtitle: community?.name,
            onBack: () => unawaited(Navigator.of(context).maybePop()),
          ),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
              children: [
                if (showPublishedNotice) ...[
                  const _WorkflowNotice(
                    title: 'Workflow published',
                    message: 'The reviewed version is now active.',
                    kind: _WorkflowNoticeKind.success,
                  ),
                  const SizedBox(height: 12),
                ],
                _WorkflowHero(
                  kicker: _statusLabel(record.status.name),
                  title: record.name,
                  message: record.description,
                ),
                const SizedBox(height: 12),
                if (record.status == WorkflowStatus.active)
                  _WorkflowActionButton(
                    label: 'Run workflow',
                    icon: LucideIcons.play,
                    onPressed: startRun,
                  ),
                if (canEditDraft) ...[
                  if (record.status == WorkflowStatus.active)
                    const SizedBox(height: 9),
                  _WorkflowActionButton(
                    label: 'Edit a draft version',
                    icon: LucideIcons.filePenLine,
                    onPressed: editDraft,
                  ),
                ],
                const SizedBox(height: 12),
                for (var index = 0; index < record.steps.length; index++) ...[
                  _WorkflowStepCard(
                    index: index + 1,
                    step: record.steps[index],
                    members: membersAsync.asData?.value,
                    onEdit: canEditDraft ? () => editDraft(index) : null,
                  ),
                  if (index < record.steps.length - 1)
                    Divider(color: context.mobileTokens.line),
                ],
                if (latestRun != null) ...[
                  const SizedBox(height: 8),
                  _WorkflowLatestRunButton(
                    status: _runStatusMessage(latestRun.status),
                    onTap: () {
                      Navigator.of(context).push<void>(
                        MaterialPageRoute<void>(
                          builder: (_) => WorkflowRunMobilePage(
                            workflowId: record.workflowId,
                            runId: latestRun.id,
                            workflowName: record.name,
                            activeVersion: record,
                          ),
                        ),
                      );
                    },
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

class _WorkflowEmptyDraftCard extends StatelessWidget {
  const _WorkflowEmptyDraftCard({this.onAddFirstStep});

  final VoidCallback? onAddFirstStep;

  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: BoxDecoration(
      color: context.mobileTokens.paper,
      border: Border.all(color: context.mobileTokens.line),
      borderRadius: BorderRadius.circular(Radii.companyCard),
    ),
    child: Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('No steps yet', style: _sectionStyle(context)),
          const SizedBox(height: 8),
          Text(
            'Your workflow cannot be published until it has a complete step.',
            style: _mutedStyle(context).copyWith(height: 1.45),
          ),
          const SizedBox(height: 14),
          _WorkflowActionButton(
            label: 'Add the first step',
            icon: LucideIcons.plus,
            onPressed: onAddFirstStep,
          ),
        ],
      ),
    ),
  );
}

class WorkflowUnavailablePage extends StatelessWidget {
  const WorkflowUnavailablePage({
    required this.workflowName,
    required this.onRetry,
    this.communityName,
    super.key,
  });

  final String workflowName;
  final String? communityName;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Material(
    color: context.mobileTokens.canvas,
    child: Column(
      children: [
        _WorkflowHeader(
          title: workflowName,
          subtitle: communityName,
          onBack: () => unawaited(Navigator.of(context).maybePop()),
        ),
        Expanded(child: _WorkflowUnavailableContent(onRetry: onRetry)),
      ],
    ),
  );
}

class WorkflowLoadingPage extends StatelessWidget {
  const WorkflowLoadingPage({
    required this.workflowName,
    this.communityName,
    super.key,
  });

  final String workflowName;
  final String? communityName;

  @override
  Widget build(BuildContext context) => Material(
    color: context.mobileTokens.canvas,
    child: Column(
      children: [
        _WorkflowHeader(
          title: workflowName,
          subtitle: communityName,
          onBack: () => unawaited(Navigator.of(context).maybePop()),
        ),
        Expanded(child: const _WorkflowLoadingContent()),
      ],
    ),
  );
}

class WorkflowDraftEditorPage extends HookConsumerWidget {
  const WorkflowDraftEditorPage({
    required this.channels,
    this.source,
    this.draft,
    this.initialStepIndex,
    super.key,
  }) : assert(source != null || draft != null);

  final WorkflowRecord? source;
  final WorkflowRecord? draft;
  final List<Channel> channels;
  final int? initialStepIndex;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final base = draft ?? source!;
    final steps = useState<List<WorkflowStepRecord>>(
      List<WorkflowStepRecord>.of(draft?.steps ?? source?.steps ?? const []),
    );
    final savedDraft = useState<WorkflowRecord?>(
      draft?.isDraft == true ? draft : null,
    );
    final lifecycleFailure = useState(false);
    final actor = ref.watch(myPubkeyProvider)?.toLowerCase();
    final community = ref.watch(activeCommunityProvider).asData?.value;

    Future<void> saveSteps(List<WorkflowStepRecord> next) async {
      final owner = actor;
      if (owner == null || owner != base.ownerPubkey) {
        throw const _WorkflowDraftAccessException();
      }
      final event = await ref
          .read(workflowRepositoryProvider)
          .saveDraft(
            workflowId: base.workflowId,
            channelId: base.channelId,
            ownerPubkey: owner,
            name: base.name,
            description: base.description,
            triggerWire: base.triggerWire,
            steps: next,
            expectedDraft: savedDraft.value,
          );
      final parsed = parseWorkflowDraftEvent(event);
      if (parsed == null) {
        throw const FormatException(
          'The relay acknowledged a draft that could not be verified.',
        );
      }
      steps.value = next;
      savedDraft.value = parsed;
      lifecycleFailure.value = false;
    }

    Future<void> editStep([int? index]) async {
      final original = index == null ? null : steps.value[index];
      await Navigator.of(context).push<void>(
        MaterialPageRoute<void>(
          builder: (_) => WorkflowStepEditorPage(
            channelId: base.channelId,
            workflowName: base.name,
            communityName: community?.name,
            step: original,
            onSave: (edited) async {
              final next = [...steps.value];
              if (index == null) {
                next.add(edited);
              } else {
                next[index] = edited;
              }
              await saveSteps(next);
            },
            onRemove: index == null
                ? null
                : () async {
                    final next = [...steps.value]..removeAt(index);
                    await saveSteps(next);
                  },
          ),
        ),
      );
    }

    Future<void> reviewAndPublish() async {
      final owner = actor;
      if (owner == null || owner != base.ownerPubkey) return;
      final latestDraft = savedDraft.value;
      if (latestDraft == null || latestDraft.steps.isEmpty) return;
      try {
        final result = await Navigator.of(context).push<Object?>(
          MaterialPageRoute<Object?>(
            builder: (_) => WorkflowPublishReviewPage(
              draft: latestDraft,
              onEditStep: (index) async {
                await editStep(index);
                return savedDraft.value;
              },
              onPublish: (currentDraft) async {
                final event = await ref
                    .read(workflowRepositoryProvider)
                    .publishDraft(
                      expectedDraft: currentDraft,
                      expectedActive: source,
                      ownerPubkey: owner,
                    );
                ref.invalidate(workflowPickerProvider);
                final published = parseWorkflowDefinitionEvent(event);
                if (published == null) {
                  throw const FormatException(
                    'The relay acknowledged a workflow that could not be verified.',
                  );
                }
                return published;
              },
            ),
          ),
        );
        if (!context.mounted) return;
        if (result is WorkflowRecord) {
          Navigator.of(context).pushReplacement<void, void>(
            MaterialPageRoute<void>(
              builder: (_) => WorkflowDetailMobilePage(
                record: result,
                activeVersion: result,
                channels: channels,
                showPublishedNotice: true,
              ),
            ),
          );
        } else if (result is String) {
          lifecycleFailure.value = true;
        }
      } catch (error) {
        lifecycleFailure.value = true;
      }
    }

    useEffect(() {
      final index = initialStepIndex;
      if (index != null && index >= 0 && index < steps.value.length) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (context.mounted) unawaited(editStep(index));
        });
      }
      return null;
    }, [initialStepIndex]);

    final membersAsync = ref.watch(channelMembersProvider(base.channelId));

    return Material(
      color: context.mobileTokens.canvas,
      child: Column(
        children: [
          _WorkflowHeader(
            title: base.name,
            subtitle: community?.name,
            onBack: () => unawaited(Navigator.of(context).maybePop()),
          ),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
              children: [
                _WorkflowHero(
                  kicker: 'Draft',
                  title: base.name,
                  message: 'Changes stay in draft until you publish.',
                ),
                if (lifecycleFailure.value) ...[
                  const SizedBox(height: 12),
                  const _WorkflowNotice(
                    title: 'Your changes were not saved',
                    message:
                        'Everything you typed is kept. Try again when the connection returns.',
                    kind: _WorkflowNoticeKind.error,
                  ),
                ],
                const SizedBox(height: 12),
                if (steps.value.isEmpty) ...[
                  _WorkflowEmptyDraftCard(onAddFirstStep: () => editStep()),
                  const SizedBox(height: 10),
                  _WorkflowActionButton(
                    label: 'Publish workflow',
                    icon: LucideIcons.arrowUpRight,
                    onPressed: null,
                  ),
                ] else ...[
                  for (var index = 0; index < steps.value.length; index++) ...[
                    _WorkflowStepCard(
                      index: index + 1,
                      step: steps.value[index],
                      members: membersAsync.asData?.value,
                      onEdit: () => editStep(index),
                    ),
                    if (index < steps.value.length - 1)
                      Divider(color: context.mobileTokens.line),
                  ],
                  const SizedBox(height: 8),
                  _WorkflowActionButton(
                    label: 'Add step',
                    icon: LucideIcons.plus,
                    onPressed: () => editStep(),
                  ),
                  const SizedBox(height: 10),
                  _WorkflowActionButton(
                    label: 'Review & publish',
                    icon: LucideIcons.arrowUpRight,
                    onPressed: savedDraft.value == null
                        ? null
                        : reviewAndPublish,
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

class _WorkflowDraftAccessException implements Exception {
  const _WorkflowDraftAccessException();
}

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
          saveFailed.value = true;
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
          saveFailed.value = true;
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
                padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
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
                    icon: LucideIcons.arrowLeft,
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
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
              children: [
                _WorkflowHero(
                  kicker: step == null ? 'New step' : 'Edit step',
                  title: 'Make it clear.',
                  message:
                      'Write the task as you would explain it to a teammate.',
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: title,
                  decoration: _workflowFieldDecoration(
                    context,
                    label: 'Step name',
                  ),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: instruction,
                  minLines: 3,
                  maxLines: 5,
                  decoration: _workflowFieldDecoration(
                    context,
                    label: 'What should happen?',
                  ),
                ),
                const SizedBox(height: 10),
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
                  decoration: _workflowFieldDecoration(
                    context,
                    label: 'Who does this step?',
                  ),
                  items: [
                    for (final candidate in members)
                      DropdownMenuItem(
                        value: candidate.pubkey.toLowerCase(),
                        child: Text(candidate.labelFor(actor)),
                      ),
                  ],
                  onChanged: (value) {
                    selectedRunner.value = value;
                    saveFailed.value = false;
                  },
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  isExpanded: true,
                  key: ValueKey('${member?.isBot}:${completion.value}'),
                  initialValue: member?.isBot == false
                      ? 'A human approves the result'
                      : completion.value,
                  decoration: _workflowFieldDecoration(
                    context,
                    label: 'Done when',
                  ),
                  items: [
                    if (member?.isBot != false)
                      const DropdownMenuItem(
                        value: 'A draft is ready',
                        child: Text('A draft is ready'),
                      ),
                    const DropdownMenuItem(
                      value: 'A human approves the result',
                      child: Text('A human approves the result'),
                    ),
                  ],
                  onChanged: (value) {
                    completion.value = value;
                    saveFailed.value = false;
                  },
                ),
                if (saveFailed.value) ...[
                  const SizedBox(height: 12),
                  const _WorkflowNotice(
                    title: 'Your changes were not saved',
                    message:
                        'Everything you typed is kept. Try again when the connection returns.',
                    kind: _WorkflowNoticeKind.error,
                  ),
                ],
                const SizedBox(height: 18),
                _WorkflowActionButton(
                  label: 'Save step',
                  icon: LucideIcons.check,
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
                    icon: LucideIcons.trash2,
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

class WorkflowPublishReviewPage extends HookConsumerWidget {
  const WorkflowPublishReviewPage({
    required this.draft,
    required this.onEditStep,
    required this.onPublish,
    super.key,
  });

  final WorkflowRecord draft;
  final Future<WorkflowRecord?> Function(int index) onEditStep;
  final Future<WorkflowRecord> Function(WorkflowRecord draft) onPublish;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final publishing = useState(false);
    final currentDraft = useState(draft);
    final membersAsync = ref.watch(channelMembersProvider(draft.channelId));
    final community = ref.watch(activeCommunityProvider).asData?.value;

    Future<void> editStep(int index) async {
      final updated = await onEditStep(index);
      if (updated != null) currentDraft.value = updated;
    }

    Future<void> publish() async {
      if (publishing.value) return;
      publishing.value = true;
      try {
        final published = await onPublish(currentDraft.value);
        if (context.mounted) Navigator.of(context).pop(published);
      } catch (error) {
        if (context.mounted) Navigator.of(context).pop(error.toString());
      } finally {
        publishing.value = false;
      }
    }

    return Material(
      color: context.mobileTokens.canvas,
      child: Column(
        children: [
          _WorkflowHeader(
            title: currentDraft.value.name,
            subtitle: community?.name,
            onBack: () => unawaited(Navigator.of(context).maybePop()),
          ),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
              children: [
                const _WorkflowHero(
                  kicker: 'Review & publish',
                  title: 'Ready to make it active?',
                  message:
                      'Publishing saves this version and makes it available to run.',
                ),
                const SizedBox(height: 14),
                _WorkflowFactRow(
                  label: 'Starts',
                  value: currentDraft.value.trigger.frequency == 'manual'
                      ? 'When a person chooses Run'
                      : _triggerLabel(currentDraft.value.trigger),
                ),
                _WorkflowFactRow(
                  label: 'Steps',
                  value: '${currentDraft.value.steps.length}',
                ),
                _WorkflowFactRow(
                  label: 'Human review',
                  value:
                      currentDraft.value.steps.any(
                        (step) => step.kind == WorkflowStepKind.approval,
                      )
                      ? 'Required before sharing'
                      : 'Not required',
                ),
                const SizedBox(height: 8),
                for (
                  var index = 0;
                  index < currentDraft.value.steps.length;
                  index++
                ) ...[
                  _WorkflowStepCard(
                    index: index + 1,
                    step: currentDraft.value.steps[index],
                    members: membersAsync.asData?.value,
                    onEdit: () => editStep(index),
                  ),
                  if (index < currentDraft.value.steps.length - 1)
                    Divider(color: context.mobileTokens.line),
                ],
                const SizedBox(height: 18),
                _WorkflowActionButton(
                  label: 'Publish workflow',
                  icon: LucideIcons.arrowUpRight,
                  isLoading: publishing.value,
                  onPressed: publishing.value ? null : publish,
                ),
                const SizedBox(height: 10),
                _WorkflowActionButton(
                  label: 'Back to draft',
                  icon: LucideIcons.arrowLeft,
                  onPressed: () => Navigator.of(context).maybePop(),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class WorkflowRunMobilePage extends HookConsumerWidget {
  const WorkflowRunMobilePage({
    required this.workflowId,
    required this.runId,
    required this.workflowName,
    this.activeVersion,
    super.key,
  });

  final String workflowId;
  final String runId;
  final String workflowName;
  final WorkflowRecord? activeVersion;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final runsAsync = ref.watch(workflowRunsProvider(workflowId));
    final community = ref.watch(activeCommunityProvider).asData?.value;
    final channelId = activeVersion?.channelId;
    final members = channelId == null
        ? null
        : ref.watch(channelMembersProvider(channelId)).asData?.value;
    return runsAsync.when(
      loading: () => WorkflowLoadingPage(
        workflowName: workflowName,
        communityName: community?.name,
      ),
      error: (_, _) => WorkflowUnavailablePage(
        workflowName: workflowName,
        communityName: community?.name,
        onRetry: () => ref.invalidate(workflowRunsProvider(workflowId)),
      ),
      data: (runs) {
        final run = runs
            .where((candidate) => candidate.id == runId)
            .firstOrNull;
        if (run == null) {
          return WorkflowUnavailablePage(
            workflowName: workflowName,
            communityName: community?.name,
            onRetry: () => ref.invalidate(workflowRunsProvider(workflowId)),
          );
        }
        return _WorkflowRunContent(
          run: run,
          workflowName: workflowName,
          communityName: community?.name,
          activeVersion: activeVersion,
          members: members,
        );
      },
    );
  }
}

class _WorkflowRunContent extends StatelessWidget {
  const _WorkflowRunContent({
    required this.run,
    required this.workflowName,
    required this.activeVersion,
    required this.members,
    this.communityName,
  });

  final WorkflowRunRecord run;
  final String workflowName;
  final WorkflowRecord? activeVersion;
  final List<ChannelMember>? members;
  final String? communityName;

  @override
  Widget build(BuildContext context) {
    final runVersion = run.definitionVersion;
    final definition =
        runVersion != null &&
            runVersion == activeVersion?.event.id.toLowerCase()
        ? activeVersion
        : null;
    final currentStep = run.currentStep;
    final currentStepLabel = currentStep == null
        ? null
        : definition != null &&
              currentStep >= 0 &&
              currentStep < definition.steps.length
        ? '${currentStep + 1} · ${definition.steps[currentStep].title}'
        : '${currentStep + 1}';

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
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
              children: [
                _WorkflowHero(
                  kicker: 'Run',
                  title: workflowName,
                  message: _runStatusMessage(run.status),
                ),
                if (run.status == 'failed' || run.errorMessage != null) ...[
                  const SizedBox(height: 12),
                  _WorkflowNotice(
                    title: 'Run failed',
                    message: run.errorMessage,
                    kind: _WorkflowNoticeKind.error,
                  ),
                ],
                if (currentStepLabel != null)
                  _WorkflowFactRow(
                    label: 'Current step',
                    value: currentStepLabel,
                  ),
                if (definition != null)
                  for (
                    var index = 0;
                    index < definition.steps.length;
                    index++
                  ) ...[
                    _WorkflowStepCard(
                      index: index + 1,
                      step: definition.steps[index],
                      members: members,
                    ),
                    if (index < definition.steps.length - 1)
                      Divider(color: context.mobileTokens.line),
                  ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

String _runStatusMessage(String status) => switch (status) {
  'waiting_approval' => 'Waiting for a human review',
  'running' => 'Running',
  'completed' => 'Complete',
  'failed' => 'Run failed',
  _ => _statusLabel(status),
};
