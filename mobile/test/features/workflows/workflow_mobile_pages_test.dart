import 'package:buzz/features/workflows/workflow_mobile_pages.dart';
import 'package:buzz/shared/company/workflows/workflow_records.dart';
import 'package:buzz/shared/company/workflows/workflow_run_repository.dart';
import 'package:buzz/shared/community/community_provider.dart';
import 'package:buzz/shared/relay/relay.dart';
import 'package:buzz/shared/theme/theme.dart';
import 'package:buzz/features/channels/channel_management_provider.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

const _workflowId = '123e4567-e89b-12d3-a456-426614174000';
const _channelId = '223e4567-e89b-12d3-a456-426614174000';
const _owner =
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

void main() {
  testWidgets('latest run opens its exact matching workflow version', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final workflow = _activeWorkflow();
    final run = WorkflowRunRecord(
      id: '323e4567-e89b-12d3-a456-426614174000',
      workflowId: _workflowId,
      status: 'running',
      createdAt: 10,
      definitionVersion: workflow.event.id,
      currentStep: 0,
    );

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          myPubkeyProvider.overrideWithValue(_owner),
          activeCommunityProvider.overrideWith((ref) async => null),
          channelMembersProvider.overrideWith(
            (ref, channelId) async => const <ChannelMember>[],
          ),
          workflowRunsProvider.overrideWith((ref, workflowId) async => [run]),
        ],
        child: MaterialApp(
          theme: AppTheme.light(),
          home: WorkflowDetailMobilePage(record: workflow, channels: const []),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.text('Latest run'));
    await tester.tap(find.text('Latest run'));
    await tester.pumpAndSettle();

    expect(find.text('Current step'), findsOneWidget);
    expect(find.text('1 · Prepare report'), findsOneWidget);
    expect(find.text('Workflow version'), findsNothing);
  });

  testWidgets('run details do not reuse tasks from a different version', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final workflow = _activeWorkflow();
    const olderRevision =
        'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
    final run = WorkflowRunRecord(
      id: '323e4567-e89b-12d3-a456-426614174001',
      workflowId: _workflowId,
      status: 'running',
      createdAt: 10,
      definitionVersion: olderRevision,
      currentStep: 0,
    );

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          activeCommunityProvider.overrideWith((ref) async => null),
          channelMembersProvider.overrideWith(
            (ref, channelId) async => const <ChannelMember>[],
          ),
          workflowRunsProvider.overrideWith((ref, workflowId) async => [run]),
        ],
        child: MaterialApp(
          theme: AppTheme.light(),
          home: WorkflowRunMobilePage(
            workflowId: _workflowId,
            runId: run.id,
            workflowName: workflow.name,
            activeVersion: workflow,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Current step'), findsOneWidget);
    expect(find.text('1'), findsOneWidget);
    expect(find.text('Prepare report'), findsNothing);
    expect(find.text('Workflow version'), findsNothing);
  });

  testWidgets('empty draft opens the real add-step editor path', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          myPubkeyProvider.overrideWithValue(_owner),
          activeCommunityProvider.overrideWith((ref) async => null),
          channelMembersProvider.overrideWith(
            (ref, channelId) async => const <ChannelMember>[],
          ),
        ],
        child: MaterialApp(
          theme: AppTheme.light(),
          home: WorkflowDraftEditorPage(
            draft: _emptyDraft(),
            channels: const [],
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('No steps yet'), findsOneWidget);
    await tester.tap(find.text('Add the first step'));
    await tester.pumpAndSettle();

    expect(find.text('Make it clear.'), findsOneWidget);
    expect(find.text('What should happen?'), findsOneWidget);
    expect(find.text('Who does this step?'), findsOneWidget);
    expect(find.text('Done when'), findsOneWidget);
    expect(find.text('Save step'), findsOneWidget);
  });
}

WorkflowRecord _emptyDraft() => WorkflowRecord(
  event: const NostrEvent(
    id: 'draft-event',
    pubkey: _owner,
    createdAt: 1,
    kind: EventKind.workflowDraft,
    tags: [],
    content: '',
    sig: '',
  ),
  workflowId: _workflowId,
  channelId: _channelId,
  name: 'Workflow draft',
  description: null,
  trigger: const WorkflowTriggerRecord(frequency: 'manual'),
  triggerWire: const {'on': 'manual'},
  steps: const [],
  status: WorkflowStatus.active,
  isDraft: true,
);

WorkflowRecord _activeWorkflow() {
  const revision =
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  return WorkflowRecord(
    event: const NostrEvent(
      id: revision,
      pubkey: _owner,
      createdAt: 2,
      kind: EventKind.workflowDefinition,
      tags: [],
      content: '',
      sig: '',
    ),
    workflowId: _workflowId,
    channelId: _channelId,
    name: 'Team workflow',
    description: 'A real workflow description.',
    trigger: const WorkflowTriggerRecord(frequency: 'manual'),
    triggerWire: const {'on': 'manual'},
    steps: const [
      WorkflowStepRecord(
        id: 'step_1',
        kind: WorkflowStepKind.agent,
        title: 'Prepare report',
        instruction: 'Write the report.',
        assigneePubkey: _owner,
        expectedResult: 'A draft is ready',
      ),
    ],
    status: WorkflowStatus.active,
  );
}
