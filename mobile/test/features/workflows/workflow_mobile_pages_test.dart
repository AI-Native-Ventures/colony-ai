import 'package:buzz/features/workflows/workflow_mobile_pages.dart';
import 'package:buzz/shared/company/workflows/workflow_records.dart';
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
