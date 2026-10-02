import 'dart:convert';

import 'package:buzz/shared/company/workflows/workflow_records.dart';
import 'package:buzz/shared/company/workflows/workflow_repository.dart';
import 'package:buzz/shared/relay/nostr_models.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nostr/nostr.dart' as nostr;

const _workflowId = '123e4567-e89b-12d3-a456-426614174000';
const _channelId = '223e4567-e89b-12d3-a456-426614174000';
final _agentPubkey = List.filled(64, 'a').join();

void main() {
  group('workflow record parser', () {
    test('parses real definition content into the supported plain view', () {
      final event = _definitionEvent();

      final record = parseWorkflowDefinitionEvent(event);

      expect(record, isNotNull);
      expect(record!.workflowId, _workflowId);
      expect(record.channelId, _channelId);
      expect(record.ownerPubkey, event.pubkey);
      expect(record.name, 'Weekly content plan');
      expect(record.description, 'Prepare and review the weekly plan.');
      expect(record.trigger.frequency, 'weekly');
      expect(record.trigger.dayOfWeek, 1);
      expect(record.trigger.hour, 10);
      expect(record.steps.map((step) => step.kind), [
        WorkflowStepKind.agent,
        WorkflowStepKind.approval,
      ]);
      expect(record.steps.first.assigneePubkey, _agentPubkey);
      expect(record.steps.last.reviewerScope, 'owner_or_admin');
    });

    test('rejects unsupported or tampered workflow records', () {
      final valid = _definitionEvent();
      final tampered = NostrEvent(
        id: valid.id,
        pubkey: valid.pubkey,
        createdAt: valid.createdAt,
        kind: valid.kind,
        tags: valid.tags,
        content: valid.content.replaceFirst('Weekly', 'Changed'),
        sig: valid.sig,
      );
      final unsupported = _definitionEvent(
        content: '''
name: Advanced workflow
trigger:
  on: message_posted
steps:
  - id: notify
    action: send_message
    text: Hello
''',
      );

      expect(parseWorkflowDefinitionEvent(tampered), isNull);
      expect(parseWorkflowDefinitionEvent(unsupported), isNull);
      expect(
        parseWorkflowDefinitionEvent(
          _definitionEvent(
            tags: [
              ['d', _workflowId],
              ['h', 'not-a-channel'],
            ],
          ),
        ),
        isNull,
      );
    });

    test('accepts an empty signed draft without exposing it as active', () {
      final event = _draftEvent(empty: true);

      final draft = parseWorkflowDraftEvent(event);

      expect(draft, isNotNull);
      expect(draft!.isDraft, isTrue);
      expect(draft.steps, isEmpty);
      expect(parseWorkflowDefinitionEvent(event), isNull);
      expect(draft.triggerWire, {'on': 'manual'});
    });

    test('parses only signed active and paused status commands', () {
      final paused = _statusEvent('paused');
      final invalid = _statusEvent('archived');

      final record = parseWorkflowStatusEvent(paused);

      expect(record, isNotNull);
      expect(record!.workflowId, _workflowId);
      expect(record.channelId, _channelId);
      expect(record.status, WorkflowStatus.paused);
      expect(parseWorkflowStatusEvent(invalid), isNull);
    });
  });

  group('WorkflowRepository', () {
    test('loads a signed definition and its latest scoped status', () async {
      final definition = _definitionEvent();
      final paused = _statusEvent('paused', createdAt: 200);
      final active = _statusEvent('active', createdAt: 100);
      final gateway = _FakeWorkflowGateway([definition, active, paused]);

      final record = await WorkflowRepository(
        gateway,
      ).load(workflowId: _workflowId, channelIds: [_channelId]);

      expect(record?.status, WorkflowStatus.paused);
      expect(record?.statusEvent?.id, paused.id);
      expect(gateway.filters, hasLength(2));
      expect(gateway.filters[0].kinds, [EventKind.workflowDefinition]);
      expect(gateway.filters[0].tags, {
        '#d': [_workflowId],
        '#h': [_channelId],
      });
      expect(gateway.filters[1].kinds, [EventKind.workflowStatus]);
      expect(gateway.filters[1].tags, {
        '#workflow': [_workflowId],
        '#h': [_channelId],
      });
    });

    test(
      'publishes the supported pause command with exact channel scope',
      () async {
        final definition = _definitionEvent();
        final gateway = _FakeWorkflowGateway([definition]);
        final record = (await WorkflowRepository(
          gateway,
        ).load(workflowId: _workflowId, channelIds: [_channelId]))!;

        await WorkflowRepository(gateway).setStatus(
          expectedRecord: record,
          status: WorkflowStatus.paused,
          channelIds: [_channelId],
        );

        expect(gateway.publishedKind, EventKind.workflowStatus);
        expect(gateway.publishedTags, [
          ['workflow', _workflowId],
          ['h', _channelId],
        ]);
        expect(jsonDecode(gateway.publishedContent!)['status'], 'paused');
      },
    );

    test('rejects a lifecycle write based on stale status', () async {
      final definition = _definitionEvent();
      final gateway = _FakeWorkflowGateway([
        definition,
        _statusEvent('paused'),
      ]);
      final expectedRecord = parseWorkflowDefinitionEvent(definition)!;

      await expectLater(
        WorkflowRepository(gateway).setStatus(
          expectedRecord: expectedRecord,
          status: WorkflowStatus.paused,
          channelIds: [_channelId],
        ),
        throwsA(isA<WorkflowChangedException>()),
      );
      expect(gateway.publishedKind, isNull);
    });

    test(
      'saves an empty draft while preserving the real trigger wire value',
      () async {
        final active = _definitionEvent();
        final gateway = _FakeWorkflowGateway([active]);
        final record = parseWorkflowDefinitionEvent(active)!;

        final event = await WorkflowRepository(gateway).saveDraft(
          workflowId: record.workflowId,
          channelId: record.channelId,
          ownerPubkey: record.ownerPubkey,
          name: record.name,
          description: record.description,
          triggerWire: record.triggerWire,
          steps: const [],
          expectedDraft: null,
        );

        final draft = parseWorkflowDraftEvent(event);
        expect(draft, isNotNull);
        expect(draft!.steps, isEmpty);
        expect(draft.triggerWire, record.triggerWire);
        expect(gateway.publishedKind, EventKind.workflowDraft);
      },
    );

    test(
      'publishes a first workflow definition with no active revision',
      () async {
        final draftEvent = _draftEvent();
        final draft = parseWorkflowDraftEvent(draftEvent)!;
        final gateway = _FakeWorkflowGateway([draftEvent]);

        await WorkflowRepository(gateway).publishDraft(
          expectedDraft: draft,
          expectedActive: null,
          ownerPubkey: draft.ownerPubkey,
        );

        expect(gateway.publishedKind, EventKind.workflowDefinition);
        expect(gateway.publishedTags, [
          ['d', _workflowId],
          ['h', _channelId],
        ]);
      },
    );
  });
}

NostrEvent _definitionEvent({
  List<List<String>>? tags,
  String? content,
  int createdAt = 100,
}) => _signedEvent(
  kind: EventKind.workflowDefinition,
  tags:
      tags ??
      [
        ['d', _workflowId],
        ['h', _channelId],
      ],
  content:
      content ??
      '''
name: Weekly content plan
description: Prepare and review the weekly plan.
enabled: true
trigger:
  on: schedule
  cron: 0 8 * * 1
steps:
  - id: prepare
    name: Prepare the plan
    action: ask_agent
    agent_pubkey: $_agentPubkey
    instruction: Prepare the next weekly plan.
    expected_result: A plan ready for review.
    timeout_secs: 900
  - id: review
    name: Review the plan
    action: request_approval
    from: owner_or_admin
    message: Review the weekly plan before it is shared.
''',
  createdAt: createdAt,
);

NostrEvent _statusEvent(String status, {int createdAt = 100}) => _signedEvent(
  kind: EventKind.workflowStatus,
  tags: [
    ['workflow', _workflowId],
    ['h', _channelId],
  ],
  content: jsonEncode({'status': status}),
  createdAt: createdAt,
);

NostrEvent _draftEvent({bool empty = false}) => _signedEvent(
  kind: EventKind.workflowDraft,
  tags: [
    ['d', _workflowId],
    ['h', _channelId],
  ],
  content: empty
      ? '''
name: Untitled workflow
enabled: true
trigger:
  on: manual
steps: []
'''
      : '''
name: Draft workflow
enabled: true
trigger:
  on: manual
steps:
  - id: prepare
    name: Prepare a draft
    action: ask_agent
    agent_pubkey: $_agentPubkey
    instruction: Prepare a working draft.
    expected_result: A draft is ready
''',
  createdAt: 200,
);

NostrEvent _signedEvent({
  required int kind,
  required List<List<String>> tags,
  required String content,
  required int createdAt,
}) {
  final keys = nostr.Keys.generate();
  final signed = nostr.Event.from(
    kind: kind,
    content: content,
    tags: tags,
    secretKey: keys.secret,
    createdAt: createdAt,
    verify: false,
  );
  return NostrEvent.fromJson(signed.toMap());
}

class _FakeWorkflowGateway implements WorkflowRecordGateway {
  _FakeWorkflowGateway(this.events);

  final List<NostrEvent> events;
  final filters = <NostrFilter>[];
  int? publishedKind;
  String? publishedContent;
  List<List<String>>? publishedTags;

  @override
  Future<List<NostrEvent>> fetch(NostrFilter filter) async {
    filters.add(filter);
    return events.where((event) => filter.kinds.contains(event.kind)).toList();
  }

  @override
  Future<NostrEvent> publish({
    required int kind,
    required String content,
    required List<List<String>> tags,
  }) async {
    publishedKind = kind;
    publishedContent = content;
    publishedTags = tags;
    final event = _signedEvent(
      kind: kind,
      tags: tags,
      content: content,
      createdAt: 300,
    );
    events.add(event);
    return event;
  }
}
