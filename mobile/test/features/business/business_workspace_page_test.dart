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
const _invoiceHeadId =
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const _salesChannel = MobileBusinessChannelCandidate(
  id: _salesId,
  name: 'Sales',
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

    expect(find.text('The business behind the work.'), findsOneWidget);
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
              onBack: () {},
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
              onBack: () {},
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
}

Widget _businessApp(_FakeBusinessGateway gateway) => ProviderScope(
  overrides: [
    mobileBusinessRepositoryProvider.overrideWithValue(
      MobileBusinessRepository(gateway),
    ),
  ],
  child: MaterialApp(
    theme: AppTheme.light(mobileTokens: MobileDesignTokens.light),
    home: Scaffold(
      body: BusinessWorkspacePage(
        channelDirectory: const AsyncData([_salesChannel]),
        communityId: _communityId,
        communityName: 'Colony workspace',
        onRetryChannelDirectory: () {},
        onOpenChat: () {},
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
    'currency': 'ZAR',
    'status': 'issued',
  },
  channelId: _clientId,
  dTag: 'client:$_clientId:invoice:$_invoiceId',
);

class _FakeBusinessGateway implements MobileBusinessRecordGateway {
  _FakeBusinessGateway({this.publishFailure});

  final Object? publishFailure;
  final List<NostrEvent> published = [];

  @override
  Future<List<NostrEvent>> fetch(NostrFilter filter) async => const [];

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
