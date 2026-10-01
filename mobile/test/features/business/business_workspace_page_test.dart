import 'dart:convert';

import 'package:buzz/features/business/business_workspace_page.dart';
import 'package:buzz/shared/business/mobile_business_records.dart';
import 'package:buzz/shared/relay/nostr_models.dart';
import 'package:buzz/shared/theme/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

const _communityId = '123e4567-e89b-12d3-a456-426614174000';
const _salesId = '223e4567-e89b-12d3-a456-426614174001';
const _clientId = '323e4567-e89b-12d3-a456-426614174002';
const _invoiceId = '423e4567-e89b-12d3-a456-426614174003';
const _dueDate = 1900000000;
const _invoiceHeadId =
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const _invoiceVersionId =
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

const _salesChannel = MobileBusinessChannelCandidate(
  id: _salesId,
  name: 'Sales',
  visibility: 'private',
  channelType: 'stream',
  isMember: true,
  archived: false,
);
const _clientChannel = MobileBusinessChannelCandidate(
  id: _clientId,
  name: 'Olive Studio',
  visibility: 'private',
  channelType: 'stream',
  isMember: true,
  archived: false,
);

void main() {
  testWidgets('opens proposal browse and keeps unavailable actions disabled', (
    tester,
  ) async {
    await tester.pumpWidget(_businessApp(_FakeBusinessGateway()));
    await tester.pumpAndSettle();

    expect(find.text('The business\nbehind the work.'), findsOneWidget);
    expect(find.text('Business'), findsOneWidget);

    final followUps = find.ancestor(
      of: find.text('Follow-ups'),
      matching: find.byType(InkWell),
    );
    expect(tester.widget<InkWell>(followUps.first).onTap, isNull);
    final followUpSemantics = tester
        .widgetList<Semantics>(find.byType(Semantics))
        .firstWhere(
          (widget) =>
              widget.properties.label?.startsWith(
                'Follow-ups are unavailable',
              ) ??
              false,
        );
    expect(followUpSemantics.properties.enabled, isFalse);
    expect(followUpSemantics.properties.onTap, isNull);

    await tester.tap(find.text('Proposals'));
    await tester.pumpAndSettle();
    expect(find.text('Room for your next offer.'), findsOneWidget);
    expect(find.text('Start on desktop'), findsOneWidget);
  });

  testWidgets('shows proposal status from the signed proposal head', (
    tester,
  ) async {
    await tester.pumpWidget(
      _businessApp(_FakeBusinessGateway(events: _proposalWorkspaceEvents())),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Proposals'));
    await tester.pumpAndSettle();

    expect(find.text('Monthly social content · Draft'), findsOneWidget);
    expect(find.text('Campaign refresh · In review'), findsOneWidget);
  });

  testWidgets('shows the designed invoice empty state without a create path', (
    tester,
  ) async {
    await tester.pumpWidget(_businessApp(_FakeBusinessGateway()));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Invoices'));
    await tester.pumpAndSettle();

    expect(find.text('No invoices yet'), findsOneWidget);
    expect(find.text('New invoice'), findsOneWidget);
    expect(
      tester
          .widget<FilledButton>(
            find.widgetWithText(FilledButton, 'New invoice'),
          )
          .onPressed,
      isNull,
    );
  });

  testWidgets('records an adjustment against the exact issued invoice head', (
    tester,
  ) async {
    final gateway = _FakeBusinessGateway();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          mobileBusinessRepositoryProvider.overrideWithValue(
            MobileBusinessRepository(gateway),
          ),
        ],
        child: MaterialApp(
          theme: AppTheme.light(mobileTokens: MobileDesignTokens.light),
          home: Scaffold(
            body: BusinessAdjustmentFlow(
              invoice: _issuedInvoice(),
              clientName: 'Olive Studio',
              onSaved: () {},
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byType(DropdownButtonFormField<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Credit adjustment').last);
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).at(0), '12.50');
    await tester.enterText(find.byType(TextField).at(1), 'Scope changed');
    await tester.tap(find.text('Review adjustment'));
    await tester.pumpAndSettle();

    expect(find.text('REVIEW ADJUSTMENT'), findsOneWidget);
    await tester.tap(find.text('Record adjustment'));
    await tester.pumpAndSettle();

    expect(find.text('Adjustment recorded'), findsOneWidget);
    final published = gateway.published.single;
    final content = jsonDecode(published.content) as Map<String, Object?>;
    expect(published.kind, EventKind.moneyAdjustment);
    expect(content['invoiceId'], _invoiceId);
    expect(content['expectedInvoiceHeadEventId'], _invoiceHeadId);
    expect(content['evidenceRef'], _invoiceHeadId);
    expect(content['amountMinor'], 1250);
    expect(content['reason'], 'Scope changed');
    expect(content['adjustmentType'], 'credit_note');
  });

  testWidgets('keeps adjustment fields after a failed save', (tester) async {
    final gateway = _FakeBusinessGateway(
      publishFailure: StateError('Relay unavailable'),
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          mobileBusinessRepositoryProvider.overrideWithValue(
            MobileBusinessRepository(gateway),
          ),
        ],
        child: MaterialApp(
          theme: AppTheme.light(mobileTokens: MobileDesignTokens.light),
          home: Scaffold(
            body: BusinessAdjustmentFlow(
              invoice: _issuedInvoice(),
              clientName: 'Olive Studio',
              onSaved: () {},
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byType(DropdownButtonFormField<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Credit adjustment').last);
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).at(0), '12.50');
    await tester.enterText(find.byType(TextField).at(1), 'Scope changed');
    await tester.tap(find.text('Review adjustment'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Record adjustment'));
    await tester.pumpAndSettle();

    expect(find.text('Your changes were not saved'), findsOneWidget);
    expect(find.text('Scope changed'), findsOneWidget);
    expect(find.text('12.50'), findsOneWidget);
    expect(gateway.published, isEmpty);
  });

  testWidgets('keeps a denied adjustment draft available to continue', (
    tester,
  ) async {
    final gateway = _FakeBusinessGateway(
      publishFailure: StateError('Permission denied for adjustment'),
    );
    final denialChanges = <bool>[];
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          mobileBusinessRepositoryProvider.overrideWithValue(
            MobileBusinessRepository(gateway),
          ),
        ],
        child: MaterialApp(
          theme: AppTheme.light(mobileTokens: MobileDesignTokens.light),
          home: Scaffold(
            body: BusinessAdjustmentFlow(
              invoice: _issuedInvoice(),
              clientName: 'Olive Studio',
              onDenialChanged: denialChanges.add,
              onSaved: () {},
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byType(DropdownButtonFormField<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Credit adjustment').last);
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).at(0), '12.50');
    await tester.enterText(find.byType(TextField).at(1), 'Scope changed');
    await tester.tap(find.text('Review adjustment'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Record adjustment'));
    await tester.pumpAndSettle();

    expect(find.text('You can view, but cannot change this'), findsOneWidget);
    expect(denialChanges, [true]);
    await tester.tap(find.text('Back to the record'));
    await tester.pumpAndSettle();

    expect(find.text('Scope changed'), findsOneWidget);
    expect(find.text('12.50'), findsOneWidget);
    expect(denialChanges, [true, false]);
  });

  testWidgets('website coming-later page opens chat and has no publish path', (
    tester,
  ) async {
    var chatOpened = false;
    await tester.pumpWidget(
      _businessApp(_FakeBusinessGateway(), onOpenChat: () => chatOpened = true),
    );
    await tester.pumpAndSettle();

    await tester.scrollUntilVisible(find.text('Website'), 160);
    await tester.tap(find.text('Website'));
    await tester.pumpAndSettle();

    expect(find.text('Nothing will publish'), findsOneWidget);
    expect(find.text('Open conversations'), findsOneWidget);
    await tester.tap(find.text('Open conversations'));
    expect(chatOpened, isTrue);
    expect(find.text('Publish'), findsNothing);
  });

  testWidgets('Business invoice records do not use the device timezone', (
    tester,
  ) async {
    await tester.pumpWidget(
      _businessApp(
        _FakeBusinessGateway(events: _invoiceWorkspaceEvents()),
        channels: const [_salesChannel, _clientChannel],
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Invoices'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Monthly social content'));
    await tester.pumpAndSettle();

    expect(find.text('Due'), findsNothing);
    await tester.tap(find.text('Edit record'));
    await tester.pumpAndSettle();
    expect(find.text('Due / record date'), findsNothing);
  });

  testWidgets('opens read-only issued invoice detail without local due date', (
    tester,
  ) async {
    await tester.pumpWidget(
      _businessApp(
        _FakeBusinessGateway(events: _invoiceWorkspaceEvents(status: 'issued')),
        channels: const [_salesChannel, _clientChannel],
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Invoices'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Monthly social content'));
    await tester.pumpAndSettle();

    expect(find.text('ISSUED INVOICE'), findsOneWidget);
    expect(find.text('Invoice detail'), findsOneWidget);
    expect(find.text('Bill to'), findsOneWidget);
    expect(find.text('Olive Studio'), findsOneWidget);
    expect(find.text('Due'), findsNothing);
    await tester.scrollUntilVisible(find.text('Issue does not mean send'), 180);
    expect(find.text('Issue does not mean send'), findsOneWidget);
    expect(find.text('Back to invoices'), findsOneWidget);
    expect(find.text('Edit record'), findsNothing);
    expect(find.text('Record payment'), findsNothing);
  });
}

Widget _businessApp(
  _FakeBusinessGateway gateway, {
  VoidCallback? onOpenChat,
  List<MobileBusinessChannelCandidate> channels = const [_salesChannel],
}) => ProviderScope(
  overrides: [
    mobileBusinessRepositoryProvider.overrideWithValue(
      MobileBusinessRepository(gateway),
    ),
  ],
  child: MaterialApp(
    theme: AppTheme.light(mobileTokens: MobileDesignTokens.light),
    home: Scaffold(
      body: BusinessWorkspacePage(
        channelDirectory: AsyncData(channels),
        communityId: _communityId,
        communityName: 'Colony workspace',
        onRetryChannelDirectory: () {},
        onOpenChat: onOpenChat ?? () {},
      ),
    ),
  ),
);

MobileBusinessRecord _issuedInvoice() => MobileBusinessRecord(
  event: NostrEvent(
    id: _invoiceHeadId,
    pubkey: 'b' * 64,
    createdAt: 1,
    kind: EventKind.invoiceHead,
    tags: [
      ['h', _clientId],
      ['d', 'client:$_clientId:invoice:$_invoiceId'],
    ],
    content: '{}',
    sig: 'c' * 128,
  ),
  value: const {
    'schemaVersion': 1,
    'clientId': _clientId,
    'invoiceId': _invoiceId,
    'invoiceNumber': 'INV-1042',
    'currency': 'ZAR',
    'status': 'issued',
  },
  channelId: _clientId,
  dTag: 'client:$_clientId:invoice:$_invoiceId',
);

List<NostrEvent> _invoiceWorkspaceEvents({String status = 'draft'}) => [
  NostrEvent(
    id: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    pubkey: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    createdAt: 1,
    kind: EventKind.clientHead,
    tags: [
      ['h', _clientId],
      ['d', 'client:$_clientId:client:$_clientId'],
    ],
    content: jsonEncode({
      'schemaVersion': 1,
      'clientId': _clientId,
      'displayName': 'Olive Studio',
      'status': 'active',
    }),
    sig: 'c' * 128,
  ),
  NostrEvent(
    id: _invoiceHeadId,
    pubkey: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    createdAt: 2,
    kind: EventKind.invoiceHead,
    tags: [
      ['h', _clientId],
      ['d', 'client:$_clientId:invoice:$_invoiceId'],
    ],
    content: jsonEncode({
      'schemaVersion': 1,
      'clientId': _clientId,
      'invoiceId': _invoiceId,
      'currentVersionEventId': _invoiceVersionId,
      'version': 1,
      'currency': 'ZAR',
      'lines': [
        {
          'description': 'Monthly social content',
          'quantityHundredths': 100,
          'unitAmountMinor': 420000,
        },
      ],
      'totalMinor': 420000,
      'collectedMinor': 0,
      'outstandingMinor': 420000,
      'status': status,
      'dueAt': _dueDate,
    }),
    sig: 'c' * 128,
  ),
];

List<NostrEvent> _proposalWorkspaceEvents() {
  const oliveProspectId = '523e4567-e89b-12d3-a456-426614174004';
  const cedarProspectId = '623e4567-e89b-12d3-a456-426614174005';
  const oliveProposalId = '723e4567-e89b-12d3-a456-426614174006';
  const cedarProposalId = '823e4567-e89b-12d3-a456-426614174007';
  final oliveVersionId = 'a' * 64;
  final cedarVersionId = 'b' * 64;
  return [
    _discoveryEvent(
      id: '1' * 64,
      kind: EventKind.prospectHead,
      coordinate: 'business:$_communityId:prospect:$oliveProspectId',
      content: {
        'schemaVersion': 1,
        'prospectId': oliveProspectId,
        'prospect': {
          'party': {'partyId': oliveProspectId, 'displayName': 'Olive Studio'},
        },
      },
    ),
    _discoveryEvent(
      id: '2' * 64,
      kind: EventKind.prospectHead,
      coordinate: 'business:$_communityId:prospect:$cedarProspectId',
      content: {
        'schemaVersion': 1,
        'prospectId': cedarProspectId,
        'prospect': {
          'party': {'partyId': cedarProspectId, 'displayName': 'Cedar'},
        },
      },
    ),
    _discoveryEvent(
      id: '3' * 64,
      kind: EventKind.proposalHead,
      coordinate: 'business:$_communityId:proposal:$oliveProposalId',
      content: {
        'schemaVersion': 1,
        'proposalId': oliveProposalId,
        'currentVersionEventId': oliveVersionId,
        'revision': 1,
        'status': 'draft',
      },
    ),
    _discoveryEvent(
      id: '4' * 64,
      kind: EventKind.proposalHead,
      coordinate: 'business:$_communityId:proposal:$cedarProposalId',
      content: {
        'schemaVersion': 1,
        'proposalId': cedarProposalId,
        'currentVersionEventId': cedarVersionId,
        'revision': 1,
        'status': 'in_review',
      },
    ),
    _discoveryEvent(
      id: oliveVersionId,
      kind: EventKind.proposalVersion,
      coordinate: 'business:$_communityId:proposal:$oliveProposalId:version:1',
      content: {
        'schemaVersion': 1,
        'proposalId': oliveProposalId,
        'prospectPartyId': oliveProspectId,
        'revision': 1,
        'currency': 'ZAR',
        'lines': [
          {
            'description': 'Monthly social content',
            'quantityHundredths': 100,
            'unitAmountMinor': 420000,
          },
        ],
        'terms': '',
      },
    ),
    _discoveryEvent(
      id: cedarVersionId,
      kind: EventKind.proposalVersion,
      coordinate: 'business:$_communityId:proposal:$cedarProposalId:version:1',
      content: {
        'schemaVersion': 1,
        'proposalId': cedarProposalId,
        'prospectPartyId': cedarProspectId,
        'revision': 1,
        'currency': 'ZAR',
        'lines': [
          {
            'description': 'Campaign refresh',
            'quantityHundredths': 100,
            'unitAmountMinor': 180000,
          },
        ],
        'terms': '',
      },
    ),
  ];
}

NostrEvent _discoveryEvent({
  required String id,
  required int kind,
  required String coordinate,
  required Map<String, Object?> content,
}) => NostrEvent(
  id: id,
  pubkey: 'b' * 64,
  createdAt: 1,
  kind: kind,
  tags: [
    ['h', _salesId],
    ['d', coordinate],
  ],
  content: jsonEncode(content),
  sig: 'c' * 128,
);

class _FakeBusinessGateway implements MobileBusinessRecordGateway {
  _FakeBusinessGateway({this.publishFailure, this.events = const []});

  final Object? publishFailure;
  final List<NostrEvent> events;
  final List<NostrEvent> published = [];

  @override
  Future<List<NostrEvent>> fetch(NostrFilter filter) async => [
    for (final event in events)
      if (filter.kinds.contains(event.kind)) event,
  ];

  @override
  Future<NostrEvent> publish({
    required int kind,
    required String content,
    required List<List<String>> tags,
  }) async {
    if (publishFailure != null) throw publishFailure!;
    final event = NostrEvent(
      id: 'd' * 64,
      pubkey: 'e' * 64,
      createdAt: 1,
      kind: kind,
      tags: tags,
      content: content,
      sig: 'f' * 128,
    );
    published.add(event);
    return event;
  }
}
