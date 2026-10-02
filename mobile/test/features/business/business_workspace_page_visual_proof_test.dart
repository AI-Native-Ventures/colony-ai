import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:buzz/features/business/business_workspace_page.dart';
import 'package:buzz/shared/business/mobile_business_records.dart';
import 'package:buzz/shared/relay/nostr_models.dart';
import 'package:buzz/shared/shell/mobile_shell.dart';
import 'package:buzz/shared/theme/theme.dart';
import 'package:flutter/foundation.dart'
    show debugDefaultTargetPlatformOverride;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show FontLoader, rootBundle;
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

const _captureScreenshots = bool.fromEnvironment('CAPTURE_B2_BUSINESS_SHOTS');
const _communityId = '123e4567-e89b-12d3-a456-426614174000';
const _salesId = '223e4567-e89b-12d3-a456-426614174001';
const _clientId = '323e4567-e89b-12d3-a456-426614174002';
const _oliveProspectId = '423e4567-e89b-12d3-a456-426614174003';
const _cedarProspectId = '523e4567-e89b-12d3-a456-426614174004';
const _proposalId = '623e4567-e89b-12d3-a456-426614174005';
const _cedarProposalId = '723e4567-e89b-12d3-a456-426614174006';
const _proposalVersionId =
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const _cedarProposalVersionId =
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const _serviceId = '823e4567-e89b-12d3-a456-426614174007';
const _cedarServiceId = '923e4567-e89b-12d3-a456-426614174008';
const _invoiceId = 'a23e4567-e89b-12d3-a456-426614174009';
const _invoiceEventId =
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
const _captureRootKey = ValueKey('b2-business-capture');

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
  if (!_captureScreenshots) return;

  setUpAll(_loadProofFonts);
  const output = '/tmp/colony-b2-business-proof';
  final outputDirectory = Directory(output)..createSync(recursive: true);
  final previousPlatform = debugDefaultTargetPlatformOverride;

  for (final size in const [Size(390, 844), Size(412, 915)]) {
    for (final brightness in [Brightness.light, Brightness.dark]) {
      for (final screen in _BusinessProofScreen.values) {
        testWidgets(
          'captures ${screen.name} ${size.width.toInt()}x${size.height.toInt()} ${brightness.name}',
          (tester) async {
            final previousComparator = goldenFileComparator;
            final populated = screen.needsRecords;
            final gateway = _BusinessProofGateway(
              populated: populated,
              publishFailure: screen == _BusinessProofScreen.adjustmentFailed
                  ? StateError('Relay unavailable')
                  : screen == _BusinessProofScreen.denied
                  ? StateError('Permission denied for adjustment')
                  : null,
            );
            debugDefaultTargetPlatformOverride = TargetPlatform.android;
            tester.view.devicePixelRatio = 1;
            tester.view.physicalSize = size;
            tester.view.padding = const FakeViewPadding(top: 44, bottom: 29);
            tester.view.viewPadding = const FakeViewPadding(
              top: 44,
              bottom: 29,
            );
            goldenFileComparator = _BusinessCaptureComparator(
              Uri.file('$output/capture_test.dart'),
              outputDirectory.path,
            );
            addTearDown(() {
              tester.view.resetPhysicalSize();
              tester.view.resetDevicePixelRatio();
              tester.view.padding = FakeViewPadding.zero;
              tester.view.viewPadding = FakeViewPadding.zero;
              goldenFileComparator = previousComparator;
              debugDefaultTargetPlatformOverride = previousPlatform;
            });

            final channels =
                screen == _BusinessProofScreen.loading ||
                    screen == _BusinessProofScreen.unavailable
                ? const <MobileBusinessChannelCandidate>[]
                : populated
                ? const [_salesChannel, _clientChannel]
                : const [_salesChannel];
            final AsyncValue<List<MobileBusinessChannelCandidate>> directory =
                switch (screen) {
                  _BusinessProofScreen.loading =>
                    const AsyncLoading<List<MobileBusinessChannelCandidate>>(),
                  _BusinessProofScreen.unavailable => AsyncError(
                    StateError('Business channels are unavailable.'),
                    StackTrace.current,
                  ),
                  _ => AsyncData(channels),
                };
            final app = MaterialApp(
              debugShowCheckedModeBanner: false,
              theme: AppTheme.light(mobileTokens: MobileDesignTokens.light),
              darkTheme: AppTheme.dark(mobileTokens: MobileDesignTokens.dark),
              themeMode: brightness == Brightness.dark
                  ? ThemeMode.dark
                  : ThemeMode.light,
              home: MobileShell(
                destination: MobileShellDestination.company,
                onDestinationSelected: (_) {},
                showBrandBar: false,
                child: BusinessWorkspacePage(
                  channelDirectory: directory,
                  communityId: _communityId,
                  communityName: 'Lerato Studio',
                  onRetryChannelDirectory: () {},
                  onOpenChat: () {},
                ),
              ),
            );
            await tester.pumpWidget(
              ProviderScope(
                retry: (_, _) => null,
                overrides: [
                  mobileBusinessRepositoryProvider.overrideWithValue(
                    MobileBusinessRepository(gateway),
                  ),
                ],
                child: RepaintBoundary(
                  key: _captureRootKey,
                  child: Directionality(
                    textDirection: TextDirection.ltr,
                    child: Stack(
                      fit: StackFit.expand,
                      children: [app, _BusinessProofSystemBars(brightness)],
                    ),
                  ),
                ),
              ),
            );
            await tester.pumpAndSettle();
            await _openProofScreen(tester, screen);
            if (screen == _BusinessProofScreen.denied) {
              expect(find.text('Business'), findsOneWidget);
            }

            final mode = brightness == Brightness.light ? 'light' : 'dark';
            final filename =
                '${screen.fileStem}-${size.width.toInt()}x'
                '${size.height.toInt()}-$mode.png';
            await expectLater(
              find.byKey(_captureRootKey),
              matchesGoldenFile(filename),
            );
            debugPrint('VISUAL_PROOF $output/$filename');
            goldenFileComparator = previousComparator;
            debugDefaultTargetPlatformOverride = previousPlatform;
          },
        );
      }
    }
  }
}

Future<void> _openProofScreen(
  WidgetTester tester,
  _BusinessProofScreen screen,
) async {
  switch (screen) {
    case _BusinessProofScreen.home:
    case _BusinessProofScreen.loading:
    case _BusinessProofScreen.unavailable:
      return;
    case _BusinessProofScreen.proposals:
    case _BusinessProofScreen.proposalsEmpty:
      await tester.tap(find.text('Proposals'));
    case _BusinessProofScreen.proposal:
    case _BusinessProofScreen.adjustment:
    case _BusinessProofScreen.adjustmentReview:
    case _BusinessProofScreen.adjustmentSaved:
    case _BusinessProofScreen.adjustmentFailed:
    case _BusinessProofScreen.denied:
      await tester.tap(find.text('Proposals'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Olive Studio'));
      await tester.pumpAndSettle();
      if (screen != _BusinessProofScreen.proposal) {
        await tester.tap(find.text('Review an adjustment'));
        await tester.pumpAndSettle();
        if (screen != _BusinessProofScreen.adjustment) {
          await _fillAdjustment(tester);
          await tester.tap(find.text('Review adjustment'));
          await tester.pumpAndSettle();
          if (screen != _BusinessProofScreen.adjustmentReview) {
            await tester.tap(find.text('Record adjustment'));
            await tester.pumpAndSettle();
          }
        }
      }
    case _BusinessProofScreen.services:
    case _BusinessProofScreen.servicesEmpty:
      await tester.tap(find.text('Services'));
    case _BusinessProofScreen.service:
      await tester.tap(find.text('Services'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Social content partnership'));
    case _BusinessProofScreen.socialLater:
      await tester.tap(find.text('Social'));
    case _BusinessProofScreen.websiteLater:
      await tester.tap(find.text('Website'));
    case _BusinessProofScreen.invoiceEmpty:
      await tester.tap(find.text('Invoices'));
    case _BusinessProofScreen.invoiceDetail:
      await tester.tap(find.text('Invoices'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Monthly social content'));
  }
  await tester.pumpAndSettle();
}

Future<void> _fillAdjustment(WidgetTester tester) async {
  await tester.tap(find.byType(DropdownButtonFormField<String>));
  await tester.pumpAndSettle();
  await tester.tap(find.text('Credit adjustment').last);
  await tester.pumpAndSettle();
  await tester.enterText(find.byType(TextField).at(0), '350');
  await tester.enterText(
    find.byType(TextField).at(1),
    'One design was removed from the approved scope. Example adjustment.',
  );
  await tester.pumpAndSettle();
}

Future<void> _loadProofFonts() async {
  final materialIcons = FontLoader('MaterialIcons')
    ..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
  await materialIcons.load();
  final manrope = FontLoader('Manrope')
    ..addFont(rootBundle.load('assets/fonts/Manrope-Variable.ttf'));
  await manrope.load();
  final lucide = FontLoader('packages/lucide_icons_flutter/Lucide')
    ..addFont(
      rootBundle.load('packages/lucide_icons_flutter/assets/lucide.ttf'),
    );
  await lucide.load();
}

class _BusinessCaptureComparator extends LocalFileComparator {
  _BusinessCaptureComparator(super.testFile, this.outputPath);

  final String outputPath;

  @override
  Future<bool> compare(Uint8List imageBytes, Uri golden) async {
    final image = File('$outputPath/${golden.pathSegments.last}');
    await image.writeAsBytes(imageBytes);
    return true;
  }
}

enum _BusinessProofScreen {
  home('mobile-b2_business_home'),
  proposals('mobile-b2_business_proposals'),
  proposalsEmpty('mobile-b2_business_proposals-empty'),
  proposal('mobile-b2_business_proposal'),
  services('mobile-b2_business_services'),
  servicesEmpty('mobile-b2_business_services-empty'),
  service('mobile-b2_business_service'),
  adjustment('mobile-b2_business_adjustment'),
  adjustmentReview('mobile-b2_business_adjustment-review'),
  adjustmentSaved('mobile-b2_business_adjustment-saved'),
  adjustmentFailed('mobile-b2_business_adjustment-failed'),
  denied('mobile-b2_business_denied'),
  socialLater('mobile-b2_business_social-later'),
  websiteLater('mobile-b2_business_website-later'),
  loading('mobile-b2_business_loading'),
  unavailable('mobile-b2_business_unavailable'),
  invoiceEmpty('mobile-b2_invoice_empty'),
  invoiceDetail('mobile-b2_invoice_detail');

  const _BusinessProofScreen(this.fileStem);

  final String fileStem;

  bool get needsRecords => switch (this) {
    proposals ||
    proposal ||
    services ||
    service ||
    adjustment ||
    adjustmentReview ||
    adjustmentSaved ||
    adjustmentFailed ||
    denied => true,
    invoiceDetail => true,
    _ => false,
  };
}

class _BusinessProofGateway implements MobileBusinessRecordGateway {
  _BusinessProofGateway({required this.populated, this.publishFailure});

  final bool populated;
  final Object? publishFailure;

  @override
  Future<List<NostrEvent>> fetch(NostrFilter filter) async {
    if (!populated) return const [];
    if (filter.kinds.contains(EventKind.proposalVersion)) {
      return _discoveryEvents;
    }
    if (filter.kinds.contains(EventKind.invoiceHead)) {
      return _moneyEvents;
    }
    return const [];
  }

  @override
  Future<NostrEvent> publish({
    required int kind,
    required String content,
    required List<List<String>> tags,
  }) async {
    if (publishFailure != null) throw publishFailure!;
    return _businessEvent(
      id: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      kind: kind,
      tags: tags,
      content: jsonDecode(content) as Map<String, Object?>,
    );
  }
}

final _discoveryEvents = [
  _prospectEvent(
    id: '1111111111111111111111111111111111111111111111111111111111111111',
    prospectId: _oliveProspectId,
    partyId: _oliveProspectId,
    displayName: 'Olive Studio',
  ),
  _prospectEvent(
    id: '2222222222222222222222222222222222222222222222222222222222222222',
    prospectId: _cedarProspectId,
    partyId: _cedarProspectId,
    displayName: 'Cedar',
  ),
  _proposalHeadEvent(
    id: '3333333333333333333333333333333333333333333333333333333333333333',
    proposalId: _proposalId,
    versionEventId: _proposalVersionId,
    revision: 1,
    createdAt: 2,
  ),
  _proposalHeadEvent(
    id: '4444444444444444444444444444444444444444444444444444444444444444',
    proposalId: _cedarProposalId,
    versionEventId: _cedarProposalVersionId,
    revision: 1,
    createdAt: 1,
    status: 'in_review',
  ),
  _proposalVersionEvent(
    id: _proposalVersionId,
    proposalId: _proposalId,
    prospectPartyId: _oliveProspectId,
    serviceId: _serviceId,
    description: 'Monthly social content',
    terms: 'Scheduling and publishing are not included in this preview.',
    unitAmountMinor: 420000,
  ),
  _proposalVersionEvent(
    id: _cedarProposalVersionId,
    proposalId: _cedarProposalId,
    prospectPartyId: _cedarProspectId,
    serviceId: _cedarServiceId,
    description: 'Campaign refresh',
    terms: 'A focused creative project.',
    unitAmountMinor: 180000,
  ),
  _serviceEvent(
    id: '5555555555555555555555555555555555555555555555555555555555555555',
    serviceId: _serviceId,
    name: 'Social content partnership',
    description:
        'Plan the month, develop eight posts and review the set with the client.',
    monthlyFeeMinor: 420000,
    postsPerMonth: 8,
    revisionRounds: 1,
    createdAt: 2,
  ),
  _serviceEvent(
    id: '6666666666666666666666666666666666666666666666666666666666666666',
    serviceId: _cedarServiceId,
    name: 'Campaign refresh',
    description: 'A focused creative project.',
    monthlyFeeMinor: 180000,
    postsPerMonth: 0,
    revisionRounds: 2,
    createdAt: 1,
  ),
];

final _moneyEvents = [_clientEvent(), _invoiceEvent()];

NostrEvent _prospectEvent({
  required String id,
  required String prospectId,
  required String partyId,
  required String displayName,
}) => _businessEvent(
  id: id,
  kind: EventKind.prospectHead,
  tags: [
    ['h', _salesId],
    ['d', 'business:$_communityId:prospect:$prospectId'],
  ],
  content: {
    'schemaVersion': 1,
    'prospectId': prospectId,
    'prospect': {
      'party': {'partyId': partyId, 'displayName': displayName},
    },
  },
);

NostrEvent _proposalHeadEvent({
  required String id,
  required String proposalId,
  required String versionEventId,
  required int revision,
  required int createdAt,
  String status = 'draft',
}) => _businessEvent(
  id: id,
  kind: EventKind.proposalHead,
  tags: [
    ['h', _salesId],
    ['d', 'business:$_communityId:proposal:$proposalId'],
  ],
  createdAt: createdAt,
  content: {
    'schemaVersion': 1,
    'proposalId': proposalId,
    'currentVersionEventId': versionEventId,
    'revision': revision,
    'status': status,
  },
);

NostrEvent _proposalVersionEvent({
  required String id,
  required String proposalId,
  required String prospectPartyId,
  required String serviceId,
  required String description,
  required String terms,
  required int unitAmountMinor,
}) => _businessEvent(
  id: id,
  kind: EventKind.proposalVersion,
  tags: [
    ['h', _salesId],
    ['d', 'business:$_communityId:proposal:$proposalId:version:1'],
  ],
  content: {
    'schemaVersion': 1,
    'proposalId': proposalId,
    'prospectPartyId': prospectPartyId,
    'revision': 1,
    'currency': 'ZAR',
    'lines': [
      {
        'serviceId': serviceId,
        'description': description,
        'quantityHundredths': 100,
        'unitAmountMinor': unitAmountMinor,
      },
    ],
    'terms': terms,
  },
);

NostrEvent _serviceEvent({
  required String id,
  required String serviceId,
  required String name,
  required String description,
  required int monthlyFeeMinor,
  required int postsPerMonth,
  required int revisionRounds,
  int createdAt = 1,
}) => _businessEvent(
  id: id,
  kind: EventKind.serviceHead,
  tags: [
    ['h', _salesId],
    ['d', 'business:$_communityId:service:$serviceId'],
  ],
  createdAt: createdAt,
  content: {
    'schemaVersion': 1,
    'serviceId': serviceId,
    'status': 'active',
    'service': {
      'serviceId': serviceId,
      'name': name,
      'description': description,
      'currency': 'ZAR',
      'monthlyFeeMinor': monthlyFeeMinor,
      'postsPerMonth': postsPerMonth,
      'revisionRounds': revisionRounds,
    },
  },
);

NostrEvent _clientEvent() => _businessEvent(
  id: '7777777777777777777777777777777777777777777777777777777777777777',
  kind: EventKind.clientHead,
  tags: [
    ['h', _clientId],
    ['d', 'client:$_clientId:client:$_clientId'],
  ],
  content: {
    'schemaVersion': 1,
    'clientId': _clientId,
    'partyId': _oliveProspectId,
    'displayName': 'Olive Studio',
    'status': 'active',
  },
);

NostrEvent _invoiceEvent() => _businessEvent(
  id: _invoiceEventId,
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
    'invoiceNumber': 'INV-1042',
    'lines': [
      {
        'description': 'Monthly social content',
        'quantityHundredths': 100,
        'unitAmountMinor': 420000,
      },
    ],
    'taxLines': [],
    'totalMinor': 420000,
    'collectedMinor': 0,
    'outstandingMinor': 420000,
    'status': 'issued',
  },
);

NostrEvent _businessEvent({
  required String id,
  required int kind,
  required List<List<String>> tags,
  required Map<String, Object?> content,
  int createdAt = 1,
}) => NostrEvent(
  id: id,
  pubkey: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  createdAt: createdAt,
  kind: kind,
  tags: tags,
  content: jsonEncode(content),
  sig: 'f' * 128,
);

class _BusinessProofSystemBars extends StatelessWidget {
  const _BusinessProofSystemBars(this.brightness);

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
            top: 10,
            left: 25,
            child: Text(
              '9:41',
              style: TextStyle(
                color: color,
                fontFamily: 'Manrope',
                fontSize: 12,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          Positioned(
            top: 10,
            right: 25,
            child: Row(
              children: [
                Icon(Icons.signal_cellular_alt, color: color, size: 14),
                const SizedBox(width: 3),
                Icon(Icons.battery_full, color: color, size: 16),
              ],
            ),
          ),
          Positioned(
            top: 5,
            left: 0,
            right: 0,
            child: Center(
              child: Container(
                width: 98,
                height: 22,
                decoration: BoxDecoration(
                  color: const Color(0xFF1F1824),
                  borderRadius: BorderRadius.circular(50),
                ),
              ),
            ),
          ),
          Positioned(
            left: 0,
            right: 0,
            bottom: 7,
            child: Center(
              child: Container(
                width: 108,
                height: 4,
                decoration: BoxDecoration(
                  color: color,
                  borderRadius: BorderRadius.circular(50),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
