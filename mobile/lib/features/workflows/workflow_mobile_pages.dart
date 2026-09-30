import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../shared/company/workflows/workflow_records.dart';
import '../../shared/company/workflows/workflow_repository.dart';
import '../../shared/company/workflows/workflow_run_repository.dart';
import '../../shared/business/mobile_business_entry_points.dart';
import '../../shared/community/community_provider.dart';
import '../../shared/relay/relay.dart';
import '../../shared/theme/theme.dart';
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
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (_, _) => _WorkflowMessage(
                title: 'Workflows are not available right now',
                message: 'Check your connection and try again.',
                actionLabel: 'Try again',
                onAction: () => ref.invalidate(channelsProvider),
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
                  loading: () =>
                      const Center(child: CircularProgressIndicator()),
                  error: (_, _) => _WorkflowMessage(
                    title: 'Workflows are not available right now',
                    message: 'The relay could not load your channel workflows.',
                    actionLabel: 'Try again',
                    onAction: () =>
                        ref.invalidate(workflowPickerProvider(query)),
                  ),
                  data: (records) {
                    if (records.isEmpty) {
                      return const _WorkflowMessage(
                        title: 'No workflows yet',
                        message:
                            'Workflows created in your channels will appear here.',
                      );
                    }
                    final draftsById = {
                      for (final record in records)
                        if (record.isDraft) record.workflowId: record,
                    };
                    final activeById = {
                      for (final record in records)
                        if (!record.isDraft) record.workflowId: record,
                    };
                    return ListView(
                      padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
                      children: [
                        for (final record in records)
                          _WorkflowPickerRow(
                            record: record,
                            channel: channels
                                .where(
                                  (channel) =>
                                      channel.id.toLowerCase() ==
                                      record.channelId,
                                )
                                .firstOrNull,
                            onTap: () => Navigator.of(context).push<void>(
                              MaterialPageRoute<void>(
                                builder: (_) => WorkflowDetailMobilePage(
                                  record: record,
                                  existingDraft: record.isDraft
                                      ? record
                                      : draftsById[record.workflowId],
                                  activeVersion: record.isDraft
                                      ? activeById[record.workflowId]
                                      : record,
                                  channels: channels,
                                ),
                              ),
                            ),
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
    super.key,
  });

  final WorkflowRecord record;
  final WorkflowRecord? existingDraft;
  final WorkflowRecord? activeVersion;
  final List<Channel> channels;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final actor = ref.watch(myPubkeyProvider)?.toLowerCase();
    final community = ref.watch(activeCommunityProvider).asData?.value;
    final runsAsync = record.isDraft
        ? const AsyncData<List<WorkflowRunRecord>>([])
        : ref.watch(workflowRunsProvider(record.workflowId));
    final canEditDraft = actor != null && actor == record.ownerPubkey;
    final channel = channels
        .where((candidate) => candidate.id.toLowerCase() == record.channelId)
        .firstOrNull;

    Future<void> editDraft() async {
      final draft = record.isDraft
          ? record
          : existingDraft ??
                await ref
                    .read(workflowRepositoryProvider)
                    .loadDraft(
                      workflowId: record.workflowId,
                      channelId: record.channelId,
                      ownerPubkey: record.ownerPubkey,
                    );
      if (!context.mounted) return;
      await Navigator.of(context).push<void>(
        MaterialPageRoute<void>(
          builder: (_) => WorkflowDraftEditorPage(
            source: record.isDraft ? activeVersion : record,
            draft: draft,
            channels: channels,
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
            ),
          ),
        );
      } catch (error) {
        if (!context.mounted) return;
        await Navigator.of(context).push<void>(
          MaterialPageRoute<void>(
            builder: (_) => WorkflowLifecycleFailurePage(
              workflowName: record.name,
              message: error.toString(),
            ),
          ),
        );
      }
    }

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
                _WorkflowStatusCard(
                  label: record.isDraft
                      ? 'Draft'
                      : _statusLabel(record.status.name),
                  detail: channel?.name ?? record.channelId,
                  icon: record.isDraft
                      ? LucideIcons.filePenLine
                      : LucideIcons.workflow,
                ),
                const SizedBox(height: 12),
                _WorkflowSectionCard(
                  title: 'Starts',
                  child: Text(
                    _triggerLabel(record.trigger),
                    style: _bodyStyle(context),
                  ),
                ),
                const SizedBox(height: 12),
                _WorkflowSectionCard(
                  title: 'Steps',
                  child: record.steps.isEmpty
                      ? const Text('No steps yet')
                      : Column(
                          children: [
                            for (
                              var index = 0;
                              index < record.steps.length;
                              index++
                            ) ...[
                              if (index > 0)
                                Divider(color: context.mobileTokens.line),
                              _WorkflowStepSummary(
                                index: index + 1,
                                step: record.steps[index],
                              ),
                            ],
                          ],
                        ),
                ),
                if (record.description?.isNotEmpty == true) ...[
                  const SizedBox(height: 12),
                  _WorkflowSectionCard(
                    title: 'Description',
                    child: Text(
                      record.description!,
                      style: _bodyStyle(context),
                    ),
                  ),
                ],
                if (record.isDraft) ...[
                  const SizedBox(height: 18),
                  _WorkflowActionButton(
                    label: record.steps.isEmpty
                        ? 'Add first step'
                        : 'Edit draft',
                    icon: LucideIcons.pencil,
                    onPressed: canEditDraft ? editDraft : null,
                  ),
                  const SizedBox(height: 10),
                  _WorkflowActionButton(
                    label: 'Review & publish',
                    icon: LucideIcons.arrowUpRight,
                    onPressed: canEditDraft && record.steps.isNotEmpty
                        ? () => _openPublishReview(
                            context,
                            ref,
                            draft: record,
                            active: activeVersion,
                            actor: actor,
                          )
                        : null,
                  ),
                ] else ...[
                  const SizedBox(height: 18),
                  if (record.status == WorkflowStatus.active)
                    _WorkflowActionButton(
                      label: 'Run workflow',
                      icon: LucideIcons.play,
                      onPressed: startRun,
                    ),
                  if (canEditDraft) ...[
                    const SizedBox(height: 10),
                    _WorkflowActionButton(
                      label: 'Edit a draft version',
                      icon: LucideIcons.filePenLine,
                      onPressed: editDraft,
                    ),
                  ],
                  const SizedBox(height: 22),
                  Text('Recent runs', style: _sectionStyle(context)),
                  const SizedBox(height: 8),
                  runsAsync.when(
                    loading: () =>
                        const Center(child: CircularProgressIndicator()),
                    error: (_, _) => _WorkflowMessage(
                      title: 'Run history is not available',
                      message: 'Try again when the relay is reachable.',
                      actionLabel: 'Try again',
                      onAction: () => ref.invalidate(
                        workflowRunsProvider(record.workflowId),
                      ),
                    ),
                    data: (runs) => runs.isEmpty
                        ? const Text('No runs yet')
                        : Column(
                            children: [
                              for (final run in runs)
                                ListTile(
                                  contentPadding: EdgeInsets.zero,
                                  title: Text(_statusLabel(run.status)),
                                  subtitle: Text(_dateLabel(run.createdAt)),
                                  trailing: const Icon(
                                    LucideIcons.chevronRight,
                                    size: 18,
                                  ),
                                  onTap: () => Navigator.of(context).push<void>(
                                    MaterialPageRoute<void>(
                                      builder: (_) => WorkflowRunMobilePage(
                                        workflowId: record.workflowId,
                                        runId: run.id,
                                        workflowName: record.name,
                                      ),
                                    ),
                                  ),
                                ),
                            ],
                          ),
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

class WorkflowDraftEditorPage extends HookConsumerWidget {
  const WorkflowDraftEditorPage({
    required this.channels,
    this.source,
    this.draft,
    super.key,
  });

  final WorkflowRecord? source;
  final WorkflowRecord? draft;
  final List<Channel> channels;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final base = draft ?? source;
    final nameController = useTextEditingController(text: base?.name);
    final descriptionController = useTextEditingController(
      text: base?.description,
    );
    final steps = useState<List<WorkflowStepRecord>>(
      List<WorkflowStepRecord>.of(base?.steps ?? const []),
    );
    final savedDraft = useState<WorkflowRecord?>(draft);
    final saving = useState(false);
    final failure = useState<String?>(null);
    final saved = useState(false);
    final actor = ref.watch(myPubkeyProvider)?.toLowerCase();
    final channel = channels
        .where((item) => item.id.toLowerCase() == base?.channelId)
        .firstOrNull;
    final community = ref.watch(activeCommunityProvider).asData?.value;

    Future<void> editStep([int? index]) async {
      final original = index == null ? null : steps.value[index];
      final edited = await Navigator.of(context).push<WorkflowStepRecord>(
        MaterialPageRoute<WorkflowStepRecord>(
          builder: (_) => WorkflowStepEditorPage(
            channelId: base!.channelId,
            step: original,
          ),
        ),
      );
      if (edited == null) return;
      if (index == null) {
        steps.value = [...steps.value, edited];
      } else {
        final next = [...steps.value];
        next[index] = edited;
        steps.value = next;
      }
      saved.value = false;
    }

    Future<WorkflowRecord> saveDraft() async {
      if (saving.value) throw StateError('A workflow save is already running.');
      final draftRecord = savedDraft.value;
      final owner = actor;
      if (base == null || owner == null || owner != base.ownerPubkey) {
        throw StateError('Only the workflow owner can save this draft.');
      }
      saving.value = true;
      failure.value = null;
      try {
        final event = await ref
            .read(workflowRepositoryProvider)
            .saveDraft(
              workflowId: base.workflowId,
              channelId: base.channelId,
              ownerPubkey: owner,
              name: nameController.text,
              description: descriptionController.text,
              triggerWire: base.triggerWire,
              steps: steps.value,
              expectedDraft: draftRecord,
            );
        final parsed = parseWorkflowDraftEvent(event);
        if (parsed == null) {
          throw const FormatException(
            'The relay acknowledged a draft that could not be verified.',
          );
        }
        savedDraft.value = parsed;
        saved.value = true;
        return parsed;
      } catch (error) {
        failure.value = error.toString();
        rethrow;
      } finally {
        saving.value = false;
      }
    }

    Future<void> saveDraftAndShowFailure() async {
      try {
        await saveDraft();
      } catch (error) {
        if (!context.mounted) return;
        await Navigator.of(context).push<void>(
          MaterialPageRoute<void>(
            builder: (_) => WorkflowLifecycleFailurePage(
              workflowName: base!.name,
              message: error.toString(),
            ),
          ),
        );
      }
    }

    Future<void> publish() async {
      try {
        final savedRecord = savedDraft.value ?? await saveDraft();
        if (!context.mounted) return;
        Navigator.of(context).push<void>(
          MaterialPageRoute<void>(
            builder: (_) => WorkflowPublishReviewPage(
              draft: savedRecord,
              onPublish: () async {
                if (actor == null) throw StateError('Sign in to publish.');
                await ref
                    .read(workflowRepositoryProvider)
                    .publishDraft(
                      expectedDraft: savedRecord,
                      expectedActive: source,
                      ownerPubkey: actor,
                    );
                ref.invalidate(workflowPickerProvider);
              },
            ),
          ),
        );
      } catch (error) {
        failure.value = error.toString();
      }
    }

    if (base == null) {
      return const _WorkflowMessage(title: 'This workflow is not available');
    }

    return Material(
      color: context.mobileTokens.canvas,
      child: Column(
        children: [
          _WorkflowHeader(
            title: 'Edit workflow',
            subtitle: community?.name,
            onBack: () => unawaited(Navigator.of(context).maybePop()),
          ),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
              children: [
                _WorkflowSectionCard(
                  title: 'Draft version',
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      TextField(
                        controller: nameController,
                        decoration: _workflowFieldDecoration(
                          context,
                          label: 'Workflow name',
                        ),
                      ),
                      const SizedBox(height: 10),
                      TextField(
                        controller: descriptionController,
                        minLines: 2,
                        maxLines: 4,
                        decoration: _workflowFieldDecoration(
                          context,
                          label: 'Description',
                        ),
                      ),
                      const SizedBox(height: 12),
                      Text('Starts', style: _sectionStyle(context)),
                      const SizedBox(height: 4),
                      Text(
                        _triggerLabel(base.trigger),
                        style: _bodyStyle(context),
                      ),
                      if (channel != null) ...[
                        const SizedBox(height: 4),
                        Text(channel.name, style: _mutedStyle(context)),
                      ],
                    ],
                  ),
                ),
                const SizedBox(height: 12),
                _WorkflowSectionCard(
                  title: 'Steps',
                  child: steps.value.isEmpty
                      ? const Text('No steps yet')
                      : Column(
                          children: [
                            for (
                              var index = 0;
                              index < steps.value.length;
                              index++
                            ) ...[
                              if (index > 0)
                                Divider(color: context.mobileTokens.line),
                              ListTile(
                                contentPadding: EdgeInsets.zero,
                                title: Text(
                                  steps.value[index].title.isEmpty
                                      ? 'Step ${index + 1}'
                                      : steps.value[index].title,
                                ),
                                subtitle: Text(
                                  _stepKindLabel(steps.value[index]),
                                ),
                                trailing: const Icon(
                                  LucideIcons.chevronRight,
                                  size: 18,
                                ),
                                onTap: () => editStep(index),
                              ),
                            ],
                          ],
                        ),
                ),
                const SizedBox(height: 10),
                _WorkflowActionButton(
                  label: steps.value.isEmpty ? 'Add first step' : 'Add step',
                  icon: LucideIcons.plus,
                  onPressed: () => editStep(),
                ),
                if (failure.value != null) ...[
                  const SizedBox(height: 12),
                  _WorkflowInlineError(message: failure.value!),
                ],
                if (saved.value) ...[
                  const SizedBox(height: 10),
                  Text('Draft saved', style: _mutedStyle(context)),
                ],
                const SizedBox(height: 18),
                _WorkflowActionButton(
                  label: 'Save draft',
                  icon: LucideIcons.save,
                  isLoading: saving.value,
                  onPressed: saving.value ? null : saveDraftAndShowFailure,
                ),
                const SizedBox(height: 10),
                _WorkflowActionButton(
                  label: 'Review & publish',
                  icon: LucideIcons.arrowUpRight,
                  onPressed: saving.value || steps.value.isEmpty
                      ? null
                      : publish,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class WorkflowStepEditorPage extends HookConsumerWidget {
  const WorkflowStepEditorPage({required this.channelId, this.step, super.key});

  final String channelId;
  final WorkflowStepRecord? step;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final membersAsync = ref.watch(channelMembersProvider(channelId));
    final title = useTextEditingController(text: step?.title);
    final instruction = useTextEditingController(text: step?.instruction);
    final kind = useState<WorkflowStepKind?>(step?.kind);
    final runner = useState<String?>(
      step?.assigneePubkey ?? step?.reviewerPubkey,
    );
    final completion = useState<String?>(step?.expectedResult);
    final error = useState<String?>(null);
    final actor = ref.watch(myPubkeyProvider);

    WorkflowStepRecord? buildStep(List<ChannelMember> members) {
      final currentKind = kind.value;
      final currentRunner = runner.value;
      if (currentKind == null || currentRunner == null) {
        error.value = 'Choose who does this step.';
        return null;
      }
      if (instruction.text.trim().isEmpty) {
        error.value = 'Describe what should happen.';
        return null;
      }
      final member = members
          .where(
            (candidate) =>
                candidate.pubkey.toLowerCase() == currentRunner.toLowerCase(),
          )
          .firstOrNull;
      if (member == null ||
          (currentKind == WorkflowStepKind.agent && !member.isBot) ||
          (currentKind == WorkflowStepKind.approval && member.isBot)) {
        error.value = 'Choose a current channel member for this step.';
        return null;
      }
      if (currentKind == WorkflowStepKind.agent && completion.value == null) {
        error.value = 'Choose when the agent step is complete.';
        return null;
      }
      error.value = null;
      return WorkflowStepRecord(
        id: step?.id ?? 'step_${DateTime.now().microsecondsSinceEpoch}',
        kind: currentKind,
        title: title.text.trim(),
        instruction: instruction.text.trim(),
        assigneePubkey: currentKind == WorkflowStepKind.agent
            ? currentRunner.toLowerCase()
            : null,
        expectedResult: currentKind == WorkflowStepKind.agent
            ? completion.value
            : null,
        reviewerPubkey: currentKind == WorkflowStepKind.approval
            ? currentRunner.toLowerCase()
            : null,
      );
    }

    return Material(
      color: context.mobileTokens.canvas,
      child: Column(
        children: [
          _WorkflowHeader(
            title: step == null ? 'Add step' : 'Edit step',
            onBack: () => unawaited(Navigator.of(context).maybePop()),
          ),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
              children: [
                _WorkflowSectionCard(
                  title: 'Step details',
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
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
                      const SizedBox(height: 14),
                      Text(
                        'Who does this step?',
                        style: _sectionStyle(context),
                      ),
                      const SizedBox(height: 8),
                      DropdownButtonFormField<WorkflowStepKind>(
                        isExpanded: true,
                        key: ValueKey(kind.value),
                        initialValue: kind.value,
                        decoration: _workflowFieldDecoration(
                          context,
                          label: 'Runner type',
                        ),
                        items: const [
                          DropdownMenuItem(
                            value: WorkflowStepKind.agent,
                            child: Text('Agent'),
                          ),
                          DropdownMenuItem(
                            value: WorkflowStepKind.approval,
                            child: Text('Human reviewer'),
                          ),
                        ],
                        onChanged: (value) {
                          kind.value = value;
                          runner.value = null;
                        },
                      ),
                      if (kind.value != null) ...[
                        const SizedBox(height: 8),
                        membersAsync.when(
                          loading: () =>
                              const Center(child: CircularProgressIndicator()),
                          error: (_, _) => Text(
                            'Channel members could not be loaded.',
                            style: _mutedStyle(context),
                          ),
                          data: (members) {
                            final candidates = members.where(
                              (member) => kind.value == WorkflowStepKind.agent
                                  ? member.isBot
                                  : !member.isBot,
                            );
                            return DropdownButtonFormField<String>(
                              isExpanded: true,
                              key: ValueKey('${kind.value}:${runner.value}'),
                              initialValue:
                                  candidates.any(
                                    (member) =>
                                        member.pubkey.toLowerCase() ==
                                        runner.value?.toLowerCase(),
                                  )
                                  ? runner.value
                                  : null,
                              decoration: _workflowFieldDecoration(
                                context,
                                label: kind.value == WorkflowStepKind.agent
                                    ? 'Choose an agent'
                                    : 'Choose a reviewer',
                              ),
                              items: [
                                for (final member in candidates)
                                  DropdownMenuItem(
                                    value: member.pubkey.toLowerCase(),
                                    child: Text(member.labelFor(actor)),
                                  ),
                              ],
                              onChanged: (value) => runner.value = value,
                            );
                          },
                        ),
                      ],
                      const SizedBox(height: 14),
                      Text('Done when', style: _sectionStyle(context)),
                      const SizedBox(height: 8),
                      if (kind.value == WorkflowStepKind.agent)
                        DropdownButtonFormField<String>(
                          isExpanded: true,
                          key: ValueKey('completion:${completion.value}'),
                          initialValue: completion.value,
                          decoration: _workflowFieldDecoration(
                            context,
                            label: 'Completion condition',
                          ),
                          items: const [
                            DropdownMenuItem(
                              value: 'A draft is ready',
                              child: Text('A draft is ready'),
                            ),
                            DropdownMenuItem(
                              value: 'A human approves the result',
                              child: Text('A human approves the result'),
                            ),
                          ],
                          onChanged: (value) => completion.value = value,
                        )
                      else
                        Text(
                          kind.value == WorkflowStepKind.approval
                              ? 'A human approves the result'
                              : 'Choose a runner to see its completion condition.',
                          style: _bodyStyle(context),
                        ),
                    ],
                  ),
                ),
                if (error.value != null) ...[
                  const SizedBox(height: 12),
                  _WorkflowInlineError(message: error.value!),
                ],
                const SizedBox(height: 18),
                _WorkflowActionButton(
                  label: 'Save step',
                  icon: LucideIcons.check,
                  onPressed: () => membersAsync.whenData((members) {
                    final result = buildStep(members);
                    if (result != null) Navigator.of(context).pop(result);
                  }),
                ),
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
    required this.onPublish,
    super.key,
  });

  final WorkflowRecord draft;
  final Future<void> Function() onPublish;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final publishing = useState(false);
    final failure = useState<String?>(null);
    Future<void> publish() async {
      if (publishing.value) return;
      publishing.value = true;
      failure.value = null;
      try {
        await onPublish();
        if (context.mounted) {
          ref.invalidate(workflowPickerProvider);
          Navigator.of(context).popUntil(
            (route) =>
                route.settings.name == MobileBusinessRoutes.workflows.path,
          );
        }
      } catch (error) {
        failure.value = error.toString();
        if (context.mounted) {
          await Navigator.of(context).push<void>(
            MaterialPageRoute<void>(
              builder: (_) => WorkflowLifecycleFailurePage(
                workflowName: draft.name,
                message: error.toString(),
              ),
            ),
          );
        }
      } finally {
        publishing.value = false;
      }
    }

    return Material(
      color: context.mobileTokens.canvas,
      child: Column(
        children: [
          _WorkflowHeader(
            title: 'Review & publish',
            onBack: () => unawaited(Navigator.of(context).maybePop()),
          ),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
              children: [
                _WorkflowSectionCard(
                  title: 'Ready to make it active?',
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(draft.name, style: _sectionStyle(context)),
                      const SizedBox(height: 8),
                      Text(
                        _triggerLabel(draft.trigger),
                        style: _bodyStyle(context),
                      ),
                      const SizedBox(height: 12),
                      for (var i = 0; i < draft.steps.length; i++) ...[
                        if (i > 0) Divider(color: context.mobileTokens.line),
                        _WorkflowStepSummary(
                          index: i + 1,
                          step: draft.steps[i],
                        ),
                      ],
                    ],
                  ),
                ),
                if (failure.value != null) ...[
                  const SizedBox(height: 12),
                  _WorkflowInlineError(message: failure.value!),
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

Future<void> _openPublishReview(
  BuildContext context,
  WidgetRef ref, {
  required WorkflowRecord draft,
  required WorkflowRecord? active,
  required String? actor,
}) async {
  await Navigator.of(context).push<void>(
    MaterialPageRoute<void>(
      builder: (_) => WorkflowPublishReviewPage(
        draft: draft,
        onPublish: () async {
          if (actor == null || actor != draft.ownerPubkey) {
            throw StateError('Only the workflow owner can publish this draft.');
          }
          await ref
              .read(workflowRepositoryProvider)
              .publishDraft(
                expectedDraft: draft,
                expectedActive: active,
                ownerPubkey: actor,
              );
          ref.invalidate(workflowPickerProvider);
        },
      ),
    ),
  );
}

class WorkflowRunMobilePage extends HookConsumerWidget {
  const WorkflowRunMobilePage({
    required this.workflowId,
    required this.runId,
    required this.workflowName,
    super.key,
  });

  final String workflowId;
  final String runId;
  final String workflowName;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final runsAsync = ref.watch(workflowRunsProvider(workflowId));
    final community = ref.watch(activeCommunityProvider).asData?.value;
    return Material(
      color: context.mobileTokens.canvas,
      child: Column(
        children: [
          _WorkflowHeader(
            title: workflowName,
            subtitle: community?.name,
            onBack: () => unawaited(Navigator.of(context).maybePop()),
          ),
          Expanded(
            child: runsAsync.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (_, _) => _WorkflowMessage(
                title: 'Run details are not available',
                message: 'The run is saved, but the relay could not load it.',
                actionLabel: 'Try again',
                onAction: () =>
                    ref.invalidate(workflowRunsProvider(workflowId)),
              ),
              data: (runs) {
                final run = runs
                    .where((candidate) => candidate.id == runId)
                    .firstOrNull;
                if (run == null) {
                  return _WorkflowMessage(
                    title: 'Your run is being prepared',
                    message: 'Its current status will appear here.',
                    actionLabel: 'Refresh',
                    onAction: () =>
                        ref.invalidate(workflowRunsProvider(workflowId)),
                  );
                }
                return ListView(
                  padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
                  children: [
                    _WorkflowStatusCard(
                      label: _statusLabel(run.status),
                      detail: 'Started ${_dateLabel(run.createdAt)}',
                      icon: LucideIcons.workflow,
                    ),
                    if (run.definitionVersion != null) ...[
                      const SizedBox(height: 12),
                      _WorkflowSectionCard(
                        title: 'Workflow version',
                        child: SelectableText(run.definitionVersion!),
                      ),
                    ],
                    if (run.currentStep != null) ...[
                      const SizedBox(height: 12),
                      _WorkflowSectionCard(
                        title: 'Current step',
                        child: Text('${run.currentStep! + 1}'),
                      ),
                    ],
                    if (run.executionTrace.isNotEmpty) ...[
                      const SizedBox(height: 12),
                      _WorkflowSectionCard(
                        title: 'Steps',
                        child: Column(
                          children: [
                            for (
                              var i = 0;
                              i < run.executionTrace.length;
                              i++
                            ) ...[
                              if (i > 0)
                                Divider(color: context.mobileTokens.line),
                              ListTile(
                                contentPadding: EdgeInsets.zero,
                                title: Text(run.executionTrace[i].stepId),
                                subtitle: Text(
                                  _statusLabel(run.executionTrace[i].status),
                                ),
                                trailing: run.executionTrace[i].error == null
                                    ? null
                                    : const Icon(
                                        LucideIcons.circleAlert,
                                        size: 18,
                                      ),
                              ),
                            ],
                          ],
                        ),
                      ),
                    ],
                    if (run.status == 'failed' || run.errorMessage != null) ...[
                      const SizedBox(height: 12),
                      _WorkflowInlineError(
                        title: run.errorCode ?? 'Run failed',
                        message:
                            run.errorMessage ??
                            'The workflow could not finish.',
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

class WorkflowLifecycleFailurePage extends StatelessWidget {
  const WorkflowLifecycleFailurePage({
    required this.workflowName,
    required this.message,
    super.key,
  });

  final String workflowName;
  final String message;

  @override
  Widget build(BuildContext context) => Material(
    color: context.mobileTokens.canvas,
    child: Column(
      children: [
        _WorkflowHeader(
          title: workflowName,
          onBack: () => unawaited(Navigator.of(context).maybePop()),
        ),
        Expanded(
          child: Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: _WorkflowInlineError(
                title: 'Could not save workflow',
                message: message,
              ),
            ),
          ),
        ),
      ],
    ),
  );
}
