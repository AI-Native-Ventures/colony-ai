import 'dart:convert';
import 'dart:io';

import 'package:buzz/features/business/discovery_workspace_page.dart';
import 'package:buzz/features/business/money_workspace_page.dart';
import 'package:buzz/shared/business/mobile_business_records.dart';
import 'package:buzz/shared/relay/nostr_models.dart';
import 'package:buzz/shared/theme/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

const _communityId = '123e4567-e89b-12d3-a456-426614174000';
const _salesId = '223e4567-e89b-12d3-a456-426614174001';
const _prospectId = '323e4567-e89b-12d3-a456-426614174002';
const _clientId = '423e4567-e89b-12d3-a456-426614174003';
const _invoiceId = '523e4567-e89b-12d3-a456-426614174004';
final _eventId = 'a' * 64;
const _proposalId = '623e4567-e89b-12d3-a456-426614174005';
final _proposalVersionId = 'b' * 64;

void main() {
  group('MobileBusinessRepository', () {
    test('loads only prospect records in the community Sales stream', () async {
      final prospect = _prospectEvent();
      final gateway = _FakeGateway([prospect]);
      final records = await MobileBusinessRepository(
        gateway,
      ).loadDiscovery([_salesChannel], communityId: _communityId);

      expect(records.channelId, _salesId);
      expect(records.prospects.single.stringValue('prospectId'), _prospectId);
      expect(gateway.filters, hasLength(2));
      expect(gateway.filters.last.tags['#h'], [_salesId]);
    });

    test('rejects a prospect coordinate from a different community', () async {
      final foreign = _prospectEvent(
        dTag:
            'business:723e4567-e89b-12d3-a456-426614174006:'
            'prospect:$_prospectId',
      );

      await expectLater(
        MobileBusinessRepository(
          _FakeGateway([foreign]),
        ).loadDiscovery([_salesChannel], communityId: _communityId),
        throwsFormatException,
      );
    });

    test('rejects duplicate scope tags in the production parser', () {
      expect(
        () => parseMobileBusinessRecord(
          _prospectEvent(
            tags: [
              ['h', _salesId],
              ['h', _salesId],
              ['d', 'business:$_communityId:prospect:$_prospectId'],
            ],
          ),
          expectedKinds: {EventKind.prospectHead},
          expectedChannels: {_salesId},
        ),
        throwsFormatException,
      );
    });

    test('issues the exact invoice version command', () async {
      final gateway = _FakeGateway(const []);
      final invoice = _parseInvoice(status: 'draft');

      await MobileBusinessRepository(gateway).issueInvoice(invoice);

      final published = gateway.published.single;
      final content = jsonDecode(published.content) as Map<String, dynamic>;
      expect(published.kind, EventKind.invoiceVersion);
      expect(published.tags, [
        ['h', _clientId],
        ['d', 'client:$_clientId:invoice:$_invoiceId:version:2'],
      ]);
      expect(content['previousVersionEventId'], _proposalVersionId);
      expect(content['expectedHeadEventId'], _eventId);
      expect(content['action'], 'issue');
      expect(content['status'], 'issued');
    });

    test(
      'publishes payment evidence and rejects amounts above balance',
      () async {
        final gateway = _FakeGateway(const []);
        final repository = MobileBusinessRepository(gateway);
        final invoice = _parseInvoice(status: 'issued');

        await repository.recordPayment(
          invoice: invoice,
          amountMinor: 125000,
          provider: 'manual',
          providerReference: ' BANK-77 ',
          occurredAt: 1_780_000_000,
          evidenceRef: 'BANK-77 receipt',
        );

        final published = gateway.published.single;
        final content = jsonDecode(published.content) as Map<String, dynamic>;
        expect(published.kind, EventKind.payment);
        expect(published.tags.first, ['h', _clientId]);
        expect(published.tags.last.first, 'd');
        expect(
          published.tags.last[1],
          startsWith('client:$_clientId:payment:'),
        );
        expect(content['amountMinor'], 125000);
        expect(content['providerReference'], 'BANK-77');
        expect(content['evidenceRef'], 'BANK-77 receipt');
        expect(content['expectedInvoiceHeadEventId'], _eventId);

        await expectLater(
          repository.recordPayment(
            invoice: invoice,
            amountMinor: 500001,
            provider: 'manual',
            providerReference: null,
            occurredAt: 1_780_000_000,
            evidenceRef: 'bank receipt',
          ),
          throwsFormatException,
        );
        expect(gateway.published, hasLength(1));
      },
    );
  });

  testWidgets('Discovery opens a relay-backed prospect record', (tester) async {
    final prospect = _prospectEvent();
    await tester.pumpWidget(
      _businessApp(
        MobileBusinessRepository(_FakeGateway([prospect])),
        DiscoveryWorkspacePage(
          channelDirectory: const AsyncData([_salesChannel]),
          communityId: _communityId,
          onRetryChannelDirectory: () {},
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Your leads'), findsOneWidget);
    expect(find.text('Olive Studio'), findsOneWidget);
    expect(find.text('1 prospect'), findsOneWidget);
    expect(find.byIcon(Icons.arrow_back), findsOneWidget);
    await tester.tap(find.byKey(ValueKey(_eventId)));
    await tester.pumpAndSettle();

    expect(find.text('Prospect'), findsOneWidget);
    expect(find.text('Olive Studio'), findsOneWidget);
    expect(find.text('Accept as lead'), findsNothing);
  });

  testWidgets('Money records payment evidence only after confirmation', (
    tester,
  ) async {
    final gateway = _FakeGateway([_clientEvent(), _invoiceEvent()]);
    await tester.pumpWidget(
      _businessApp(
        MobileBusinessRepository(gateway),
        MoneyWorkspacePage(
          channelDirectory: const AsyncData([_clientChannel]),
          onRetryChannelDirectory: () {},
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Money'), findsOneWidget);
    expect(find.text('Studio website refresh'), findsOneWidget);
    expect(find.text('ZAR 4 200.00'), findsOneWidget);
    await tester.tap(find.byKey(ValueKey(_eventId)));
    await tester.pumpAndSettle();
    expect(find.text('Record payment'), findsOneWidget);
    await tester.tap(find.text('Record payment'));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField).at(0), '1250.00');
    await tester.enterText(find.byType(TextField).at(1), 'BANK-77 receipt');
    await tester.tap(find.byType(Checkbox));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Record received payment'));
    await tester.pumpAndSettle();

    expect(gateway.published, hasLength(1));
    expect(gateway.published.single.kind, EventKind.payment);
    final payment =
        jsonDecode(gateway.published.single.content) as Map<String, dynamic>;
    expect(payment['amountMinor'], 125000);
    expect(find.text('Money'), findsOneWidget);
  });

  testWidgets('tax preview returns to Money without saving a draft', (
    tester,
  ) async {
    final gateway = _FakeGateway([
      _clientEvent(),
      _invoiceEvent(status: 'draft'),
    ]);
    await tester.pumpWidget(
      _businessApp(
        MobileBusinessRepository(gateway),
        MoneyWorkspacePage(
          channelDirectory: const AsyncData([_clientChannel]),
          onRetryChannelDirectory: () {},
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(ValueKey(_eventId)));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Edit record'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Optional tax details'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byWidgetPredicate(
        (widget) =>
            widget is TextField && widget.decoration?.labelText == 'Tax label',
      ),
      'VAT',
    );
    await tester.enterText(
      find.byWidgetPredicate(
        (widget) =>
            widget is TextField &&
            widget.decoration?.labelText == 'Tax rate, %',
      ),
      '15',
    );
    await tester.tap(find.text('Preview totals'));
    await tester.pumpAndSettle();
    expect(find.text('ZAR 630.00'), findsOneWidget);
    await tester.tap(find.text('Back to Money'));
    await tester.pumpAndSettle();

    expect(find.text('Money'), findsOneWidget);
    expect(gateway.published, isEmpty);
  });

  testWidgets('captures built business routes for v6 comparison', (
    tester,
  ) async {
    const capture = bool.fromEnvironment('CAPTURE_MV6_BUSINESS');
    if (!capture) return;
    const sizes = {'390x844': Size(390, 844), '412x915': Size(412, 915)};
    const captureKey = ValueKey('mobile-business-capture');
    final previousComparator = goldenFileComparator;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
      tester.view.resetPadding();
      tester.view.resetViewPadding();
      goldenFileComparator = previousComparator;
    });
    await _loadCaptureFonts();

    for (final size in sizes.entries) {
      tester.view.physicalSize = size.value;
      tester.view.devicePixelRatio = 1;
      tester.view.padding = const FakeViewPadding(top: 46, bottom: 20);
      tester.view.viewPadding = const FakeViewPadding(top: 46, bottom: 20);
      for (final brightness in [Brightness.light, Brightness.dark]) {
        final mode = brightness.name;
        final output = Directory(
          '/tmp/colony-mobile-business-proof/${size.key}/$mode',
        )..createSync(recursive: true);
        goldenFileComparator = _BusinessCaptureComparator(
          Uri.file('${output.path}/capture_test.dart'),
          output.path,
        );
        final routes = [
          (name: 'discovery-leads', page: 'discovery'),
          (name: 'prospect-detail', page: 'prospect-detail'),
          (name: 'money-revenue', page: 'money'),
          (name: 'invoice-detail', page: 'invoice-detail'),
          (name: 'invoice-edit', page: 'invoice-edit'),
          (name: 'invoice-issue', page: 'invoice-issue'),
          (name: 'invoice-payment', page: 'invoice-payment'),
          (name: 'invoice-tax', page: 'invoice-tax'),
          (name: 'invoice-tax-preview', page: 'invoice-tax-preview'),
        ];
        for (final route in routes) {
          final repository = MobileBusinessRepository(
            _FakeGateway([
              _clientEvent(),
              _invoiceEvent(
                status: route.page == 'invoice-payment' ? 'issued' : 'draft',
              ),
              _prospectEvent(),
            ]),
          );
          Widget page = switch (route.page) {
            'discovery' || 'prospect-detail' => DiscoveryWorkspacePage(
              channelDirectory: const AsyncData([_salesChannel]),
              communityId: _communityId,
              onRetryChannelDirectory: () {},
            ),
            _ => MoneyWorkspacePage(
              channelDirectory: const AsyncData([_clientChannel]),
              onRetryChannelDirectory: () {},
            ),
          };
          await tester.pumpWidget(
            _businessCaptureApp(
              repository: repository,
              page: page,
              brightness: brightness,
              captureKey: captureKey,
            ),
          );
          await tester.pumpAndSettle();
          if (route.page == 'prospect-detail') {
            await tester.tap(find.byKey(ValueKey(_eventId)));
            await tester.pumpAndSettle();
          } else if (route.page.startsWith('invoice-')) {
            await tester.tap(find.byKey(ValueKey(_eventId)));
            await tester.pumpAndSettle();
            switch (route.page) {
              case 'invoice-edit' || 'invoice-tax' || 'invoice-tax-preview':
                await tester.tap(find.text('Edit record'));
                await tester.pumpAndSettle();
                if (route.page != 'invoice-edit') {
                  await tester.tap(find.text('Optional tax details'));
                  await tester.pumpAndSettle();
                  if (route.page == 'invoice-tax-preview') {
                    final label = find.byWidgetPredicate(
                      (widget) =>
                          widget is TextField &&
                          widget.decoration?.labelText == 'Tax label',
                    );
                    final rate = find.byWidgetPredicate(
                      (widget) =>
                          widget is TextField &&
                          widget.decoration?.labelText == 'Tax rate, %',
                    );
                    await tester.enterText(label, 'VAT');
                    await tester.enterText(rate, '15');
                    await tester.tap(find.text('Preview totals'));
                    await tester.pumpAndSettle();
                  }
                }
              case 'invoice-issue':
                await tester.tap(find.text('Review & issue invoice'));
                await tester.pumpAndSettle();
              case 'invoice-payment':
                await tester.tap(find.text('Record payment'));
                await tester.pumpAndSettle();
              case 'invoice-detail':
                break;
            }
          }
          await expectLater(
            find.byKey(captureKey),
            matchesGoldenFile('${route.name}-${size.key}-$mode.png'),
          );
          await tester.pumpWidget(const SizedBox.shrink());
          await tester.pumpAndSettle();
        }
      }
    }
  });
}

Widget _businessApp(MobileBusinessRepository repository, Widget home) =>
    ProviderScope(
      overrides: [
        mobileBusinessRepositoryProvider.overrideWithValue(repository),
      ],
      child: MaterialApp(
        theme: AppTheme.light(),
        home: Scaffold(body: home),
      ),
    );

Widget _businessCaptureApp({
  required MobileBusinessRepository repository,
  required Widget page,
  required Brightness brightness,
  required Key captureKey,
}) => ProviderScope(
  overrides: [mobileBusinessRepositoryProvider.overrideWithValue(repository)],
  child: MaterialApp(
    debugShowCheckedModeBanner: false,
    theme: brightness == Brightness.light ? AppTheme.light() : AppTheme.dark(),
    home: Scaffold(body: page),
    builder: (context, child) => RepaintBoundary(
      key: captureKey,
      child: Stack(
        fit: StackFit.expand,
        children: [child!, _BusinessCaptureStatusBars(brightness)],
      ),
    ),
  ),
);

Future<void> _loadCaptureFonts() async {
  final manrope = FontLoader('Manrope')
    ..addFont(rootBundle.load('assets/fonts/Manrope-Variable.ttf'));
  await manrope.load();
  final materialIcons = FontLoader('MaterialIcons')
    ..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
  await materialIcons.load();
  final lucide = FontLoader('packages/lucide_icons_flutter/Lucide')
    ..addFont(
      rootBundle.load('packages/lucide_icons_flutter/assets/lucide.ttf'),
    );
  await lucide.load();
}

class _BusinessCaptureStatusBars extends StatelessWidget {
  const _BusinessCaptureStatusBars(this.brightness);

  final Brightness brightness;

  @override
  Widget build(BuildContext context) {
    final color = brightness == Brightness.dark
        ? const Color(0xFFF2E9F6)
        : const Color(0xFF34263C);
    return IgnorePointer(
      child: Stack(
        children: [
          Positioned(
            top: 48,
            left: 25,
            child: Text(
              '9:41',
              style: TextStyle(
                color: color,
                fontFamily: 'Manrope',
                fontSize: 13,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          Positioned(
            top: 48,
            right: 22,
            child: Icon(Icons.network_cell, size: 15, color: color),
          ),
          Positioned(
            bottom: 7,
            left: 0,
            right: 0,
            child: Center(
              child: Container(
                width: 108,
                height: 4,
                decoration: BoxDecoration(
                  color: color,
                  borderRadius: BorderRadius.circular(4),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _BusinessCaptureComparator extends LocalFileComparator {
  _BusinessCaptureComparator(super.testFile, this.outputPath);

  final String outputPath;

  @override
  Future<bool> compare(Uint8List imageBytes, Uri golden) async {
    final file = File('$outputPath/${golden.pathSegments.last}');
    await file.writeAsBytes(imageBytes);
    return true;
  }
}

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

NostrEvent _prospectEvent({String? dTag, List<List<String>>? tags}) => _event(
  id: _eventId,
  kind: EventKind.prospectHead,
  tags:
      tags ??
      [
        ['h', _salesId],
        ['d', dTag ?? 'business:$_communityId:prospect:$_prospectId'],
      ],
  content: {
    'schemaVersion': 1,
    'prospectId': _prospectId,
    'prospect': {
      'party': {'displayName': 'Olive Studio'},
      'industry': 'Design',
      'location': 'Cape Town',
      'fitScore': 82,
      'stage': 'qualified',
      'evidence': [],
    },
  },
);

NostrEvent _clientEvent() => _event(
  id: 'c' * 64,
  kind: EventKind.clientHead,
  tags: [
    ['h', _clientId],
    ['d', 'client:$_clientId:client:$_clientId'],
  ],
  content: {
    'schemaVersion': 1,
    'clientId': _clientId,
    'partyId': _prospectId,
    'displayName': 'Olive Studio',
    'approverPubkeys': [],
    'status': 'active',
    'sourceActionEventId': _eventId,
  },
);

NostrEvent _invoiceEvent({String status = 'issued'}) => _event(
  id: _eventId,
  kind: EventKind.invoiceHead,
  tags: [
    ['h', _clientId],
    ['d', 'client:$_clientId:invoice:$_invoiceId'],
  ],
  content: {
    'schemaVersion': 1,
    'clientId': _clientId,
    'invoiceId': _invoiceId,
    'proposalId': _proposalId,
    'proposalVersionEventId': _proposalVersionId,
    'currentVersionEventId': _proposalVersionId,
    'version': 1,
    'currency': 'ZAR',
    'lines': [
      {
        'description': 'Studio website refresh',
        'quantityHundredths': 100,
        'unitAmountMinor': 420000,
      },
    ],
    'taxLines': [],
    'totalMinor': 420000,
    'collectedMinor': 0,
    'outstandingMinor': 420000,
    'status': status,
    'dueAt': 1_780_000_000,
  },
);

MobileBusinessRecord _parseInvoice({required String status}) =>
    parseMobileBusinessRecord(
      _event(
        id: _eventId,
        kind: EventKind.invoiceHead,
        tags: [
          ['h', _clientId],
          ['d', 'client:$_clientId:invoice:$_invoiceId'],
        ],
        content: {
          'schemaVersion': 1,
          'clientId': _clientId,
          'invoiceId': _invoiceId,
          'proposalId': _proposalId,
          'proposalVersionEventId': _proposalVersionId,
          'currentVersionEventId': _proposalVersionId,
          'version': 1,
          'currency': 'ZAR',
          'lines': [
            {
              'description': 'Studio website refresh',
              'quantityHundredths': 100,
              'unitAmountMinor': 420000,
            },
          ],
          'taxLines': [],
          'totalMinor': 420000,
          'collectedMinor': 0,
          'outstandingMinor': 420000,
          'status': status,
          'dueAt': 1_780_000_000,
        },
      ),
      expectedKinds: {EventKind.invoiceHead},
      expectedChannels: {_clientId},
    );

NostrEvent _event({
  required String id,
  required int kind,
  required List<List<String>> tags,
  required Map<String, Object?> content,
}) => NostrEvent(
  id: id,
  pubkey: 'd' * 64,
  createdAt: 1_780_000_000,
  kind: kind,
  tags: tags,
  content: jsonEncode(content),
  sig: 'e' * 128,
);

class _FakeGateway implements MobileBusinessRecordGateway {
  _FakeGateway(this.events);

  final List<NostrEvent> events;
  final List<NostrFilter> filters = [];
  final List<NostrEvent> published = [];

  @override
  Future<List<NostrEvent>> fetch(NostrFilter filter) async {
    filters.add(filter);
    return events.where((event) => filter.kinds.contains(event.kind)).where((
      event,
    ) {
      final channels = filter.tags['#h'];
      return channels == null || channels.contains(event.channelId);
    }).toList();
  }

  @override
  Future<NostrEvent> publish({
    required int kind,
    required String content,
    required List<List<String>> tags,
  }) async {
    final event = _event(
      id: 'f' * 64,
      kind: kind,
      content: jsonDecode(content) as Map<String, Object?>,
      tags: tags,
    );
    published.add(event);
    return event;
  }
}
