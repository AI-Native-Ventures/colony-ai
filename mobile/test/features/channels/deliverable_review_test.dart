import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:pointycastle/digests/sha256.dart';

import 'package:buzz/features/channels/deliverable_approval_page.dart';
import 'package:buzz/features/channels/deliverable_business_records.dart';
import 'package:buzz/features/channels/deliverable_review_provider.dart';
import 'package:buzz/shared/profile/user_cache_provider.dart';
import 'package:buzz/shared/profile/user_profile.dart';
import 'package:buzz/shared/relay/relay.dart';
import 'package:buzz/shared/theme/app_theme.dart';

const _clientId = '11111111-1111-4111-8111-111111111111';
const _workItemId = '22222222-2222-4222-8222-222222222222';
const _deliverableId = '33333333-3333-4333-8333-333333333333';
const _approverPubkey =
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const _versionAuthor =
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

void main() {
  const captureApprovalScreens = bool.fromEnvironment('CAPTURE_M3A_APPROVAL');
  if (captureApprovalScreens) {
    setUpAll(() async {
      final manrope = FontLoader('Manrope')
        ..addFont(rootBundle.load('assets/fonts/Manrope-Variable.ttf'));
      await manrope.load();
      final materialIcons = FontLoader('MaterialIcons')
        ..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
      await materialIcons.load();
      final lucideIcons = FontLoader('packages/lucide_icons_flutter/Lucide')
        ..addFont(
          rootBundle.load('packages/lucide_icons_flutter/assets/lucide.ttf'),
        );
      await lucideIcons.load();
    });
  }

  group('W11 deliverable business record parsers', () {
    test('parses the relay head, exact version and approval records', () {
      final fixture = _BusinessRecords();
      final head = parseWorkItemHead(fixture.head);
      final version = parseDeliverableVersion(fixture.version1);
      final approval = parseDeliverableApproval(fixture.approval());

      expect(head.workItemId, _workItemId);
      expect(head.approverPubkeys, [_approverPubkey]);
      expect(head.deliverables.single.versionEventId, fixture.version2.id);
      expect(version.title, 'A slower kind of morning.');
      expect(version.content, contains('Three customer-led concepts'));
      expect(approval.versionEventId, fixture.version2.id);
      expect(approval.decision, DeliverableApprovalDecision.approved);
    });

    test('rejects a changed body and malformed message reference', () {
      final fixture = _BusinessRecords();
      final changed = NostrEvent(
        id: fixture.version1.id,
        pubkey: _versionAuthor,
        createdAt: 10,
        kind: EventKind.deliverableVersion,
        tags: fixture.version1.tags,
        content: fixture.versionContent(
          contentDigest: List.filled(64, '0').join(),
        ),
        sig: '',
      );

      expect(() => parseDeliverableVersion(changed), throwsFormatException);
      expect(
        parseWorkItemReferenceCoordinate('not-a-coordinate', _clientId),
        isNull,
      );
      expect(
        workItemReferenceFromTags([
          ['a', '30634:bad:client:$_clientId:work:$_workItemId'],
        ], clientId: _clientId),
        isNull,
      );
    });
  });

  group('DeliverableReviewRepository', () {
    test('loads current version through the production parser seam', () async {
      final fixture = _BusinessRecords();
      final gateway = _FakeDeliverableGateway(fixture.events);
      final bundle = await DeliverableReviewRepository(
        gateway,
      ).load(fixture.request, currentPubkey: _approverPubkey);

      expect(bundle.isAvailable, isTrue);
      expect(bundle.isAuthorized, isTrue);
      expect(bundle.isStale, isFalse);
      expect(bundle.version?.event.id, fixture.version2.id);
    });

    test('publishes an exact version decision through kind 47008', () async {
      final fixture = _BusinessRecords();
      final gateway = _FakeDeliverableGateway(fixture.events);
      final version = parseDeliverableVersion(fixture.version2);
      await DeliverableReviewRepository(gateway).submitDecision(
        request: fixture.request,
        version: version,
        decision: DeliverableApprovalDecision.changesRequested,
        note: 'Please revise the opening paragraph.',
      );

      expect(gateway.publishedKind, EventKind.deliverableApproval);
      final body =
          jsonDecode(gateway.publishedContent!) as Map<String, dynamic>;
      expect(body['versionEventId'], fixture.version2.id);
      expect(body['contentDigest'], version.contentDigest);
      expect(body['mediaDigest'], version.mediaDigest);
      expect(body['decision'], 'changes_requested');
      expect(body['note'], 'Please revise the opening paragraph.');
      expect(gateway.publishedTags, [
        ['h', _clientId],
        ['d', 'client:$_clientId:deliverable-approval:${fixture.version2.id}'],
      ]);
    });
  });

  group('DeliverableApprovalPage', () {
    testWidgets('opens the exact version review', (tester) async {
      final fixture = _BusinessRecords();
      await _pumpApprovalPage(
        tester,
        fixture,
        _FakeDeliverableGateway(fixture.events),
      );

      expect(find.text('Content review'), findsOneWidget);
      expect(find.text('A slower kind of morning.'), findsOneWidget);
      expect(find.text('Your review is needed'), findsOneWidget);
      expect(find.text('Approve v2'), findsOneWidget);
      expect(find.text('Give feedback'), findsOneWidget);
      expect(
        find.textContaining('It does not publish anything.'),
        findsOneWidget,
      );
      await tester.tap(
        find.byKey(const ValueKey('deliverable-review-details-action')),
      );
      await tester.pumpAndSettle();
      expect(find.text('Keep the context close.'), findsOneWidget);
      expect(find.text('Open the discussion'), findsOneWidget);
      expect(find.text('See the shared goal'), findsNothing);
    });

    testWidgets('submits approval for the exact current version', (
      tester,
    ) async {
      final fixture = _BusinessRecords();
      final gateway = _FakeDeliverableGateway(fixture.events);
      await _pumpApprovalPage(tester, fixture, gateway);
      await tester.tap(
        find.byKey(const ValueKey('deliverable-approve-version')),
      );
      await tester.pumpAndSettle();
      expect(find.text('Approve version 2'), findsOneWidget);
      await tester.tap(
        find.byKey(const ValueKey('deliverable-confirm-approval')),
      );
      await tester.pumpAndSettle();

      expect(gateway.publishedKind, EventKind.deliverableApproval);
      final body =
          jsonDecode(gateway.publishedContent!) as Map<String, dynamic>;
      expect(body['versionEventId'], fixture.version2.id);
      expect(body['decision'], 'approved');
      expect(find.text('Approved'), findsOneWidget);
    });

    testWidgets('shows an existing approval for version two', (tester) async {
      final fixture = _BusinessRecords();
      final gateway = _FakeDeliverableGateway([
        ...fixture.events,
        fixture.approval(),
      ]);
      await _pumpApprovalPage(tester, fixture, gateway);

      expect(find.text('Approved'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('deliverable-approve-version')),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('deliverable-give-feedback')),
        findsNothing,
      );
    });

    testWidgets('marks a pinned version stale when a newer version arrives', (
      tester,
    ) async {
      final fixture = _BusinessRecords();
      final gateway = _FakeDeliverableGateway(fixture.events);
      await _pumpApprovalPage(tester, fixture, gateway);
      await tester.pumpAndSettle();

      final version3 = fixture.version(
        3,
        _id(5),
        previous: fixture.version2.id,
      );
      gateway.replaceHead(fixture.headFor(version3));
      gateway.addAndEmit(version3);
      await tester.pumpAndSettle();

      expect(find.text('This version is out of date'), findsOneWidget);
      expect(find.text('A newer version is now current.'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('deliverable-approve-version')),
        findsNothing,
      );
    });

    testWidgets('records feedback on the exact version', (tester) async {
      final fixture = _BusinessRecords();
      final gateway = _FakeDeliverableGateway(fixture.events);
      await _pumpApprovalPage(tester, fixture, gateway);
      await tester.tap(find.byKey(const ValueKey('deliverable-give-feedback')));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const ValueKey('deliverable-feedback-input')),
        'Please revise the opening paragraph.',
      );
      await tester.pump();
      expect(
        tester
            .widget<TextField>(
              find.byKey(const ValueKey('deliverable-feedback-input')),
            )
            .controller!
            .text,
        'Please revise the opening paragraph.',
      );
      expect(
        tester
            .widget<FilledButton>(
              find.byKey(const ValueKey('deliverable-send-feedback')),
            )
            .onPressed,
        isNotNull,
      );
      await tester.ensureVisible(
        find.byKey(const ValueKey('deliverable-send-feedback')),
      );
      await tester.tap(find.byKey(const ValueKey('deliverable-send-feedback')));
      await tester.pumpAndSettle();

      expect(gateway.publishedKind, EventKind.deliverableApproval);
      final body =
          jsonDecode(gateway.publishedContent!) as Map<String, dynamic>;
      expect(body['versionEventId'], fixture.version2.id);
      expect(body['decision'], 'changes_requested');
      expect(body['note'], 'Please revise the opening paragraph.');
      expect(
        find.byKey(const ValueKey('deliverable-feedback-input')),
        findsNothing,
      );
    });

    testWidgets('shows denied state without decision actions', (tester) async {
      final fixture = _BusinessRecords();
      await _pumpApprovalPage(
        tester,
        fixture,
        _FakeDeliverableGateway(fixture.events),
        currentPubkey: _versionAuthor,
      );

      expect(
        find.text('You are not listed as an approver for this work item.'),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('deliverable-approve-version')),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('deliverable-give-feedback')),
        findsNothing,
      );
    });

    testWidgets('keeps feedback text available after a failed submit', (
      tester,
    ) async {
      final fixture = _BusinessRecords();
      final gateway = _FakeDeliverableGateway(fixture.events)
        ..failPublish = true;
      await _pumpApprovalPage(tester, fixture, gateway);
      await tester.tap(find.byKey(const ValueKey('deliverable-give-feedback')));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const ValueKey('deliverable-feedback-input')),
        'Keep this text for retry.',
      );
      await tester.pump();
      expect(
        tester
            .widget<FilledButton>(
              find.byKey(const ValueKey('deliverable-send-feedback')),
            )
            .onPressed,
        isNotNull,
      );
      await tester.ensureVisible(
        find.byKey(const ValueKey('deliverable-send-feedback')),
      );
      await tester.tap(find.byKey(const ValueKey('deliverable-send-feedback')));
      await tester.pumpAndSettle();

      expect(
        find.text('Feedback could not be sent. Your text is still here.'),
        findsOneWidget,
      );
      expect(find.text('Keep this text for retry.'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('deliverable-feedback-input')),
        findsOneWidget,
      );
    });
  });

  if (captureApprovalScreens) {
    const sizes = {'390x844': Size(390, 844), '412x915': Size(412, 915)};
    const captureStates = ['approval', 'details', 'feedback'];
    for (final size in sizes.entries) {
      for (final brightness in [Brightness.light, Brightness.dark]) {
        for (final state in captureStates) {
          testWidgets(
            'captures approval $state ${brightness.name} ${size.key}',
            (tester) async {
              final previousComparator = goldenFileComparator;
              final mode = brightness == Brightness.light ? 'light' : 'dark';
              final output = Directory(
                '/tmp/m3a-visual-sheets/approval/${size.key}/$mode',
              )..createSync(recursive: true);
              goldenFileComparator = _CaptureFileComparator(
                Uri.file('${output.path}/capture_test.dart'),
                output.path,
              );
              tester.view.devicePixelRatio = 1;
              tester.view.physicalSize = size.value;
              tester.view.padding = const FakeViewPadding(top: 46, bottom: 20);
              tester.view.viewPadding = const FakeViewPadding(
                top: 46,
                bottom: 20,
              );
              final captureKey = GlobalKey();
              final fixture = _BusinessRecords();
              await _pumpApprovalPage(
                tester,
                fixture,
                _FakeDeliverableGateway(fixture.events),
                brightness: brightness,
                captureStatusBar: true,
                captureKey: captureKey,
              );
              if (state == 'details') {
                await tester.tap(
                  find.byKey(
                    const ValueKey('deliverable-review-details-action'),
                  ),
                );
              } else if (state == 'feedback') {
                await tester.tap(
                  find.byKey(const ValueKey('deliverable-give-feedback')),
                );
              }
              await tester.pumpAndSettle();
              final fileName = '$state.png';
              await expectLater(
                find.byKey(captureKey),
                matchesGoldenFile(fileName),
              );
              debugPrint('VISUAL_PROOF ${output.path}/$fileName');
              goldenFileComparator = previousComparator;
              tester.view.resetPhysicalSize();
              tester.view.resetDevicePixelRatio();
              tester.view.padding = FakeViewPadding.zero;
              tester.view.viewPadding = FakeViewPadding.zero;
            },
          );
        }
      }
    }
  }
}

Future<void> _pumpApprovalPage(
  WidgetTester tester,
  _BusinessRecords fixture,
  _FakeDeliverableGateway gateway, {
  String? currentPubkey = _approverPubkey,
  Brightness brightness = Brightness.light,
  bool captureStatusBar = false,
  GlobalKey? captureKey,
}) async {
  if (!captureStatusBar) {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(390, 844);
  }
  final app = MaterialApp(
    theme: AppTheme.light(),
    darkTheme: AppTheme.dark(),
    themeMode: brightness == Brightness.dark ? ThemeMode.dark : ThemeMode.light,
    home: DeliverableApprovalPage(request: fixture.request),
  );
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        deliverableRecordGatewayProvider.overrideWithValue(gateway),
        myPubkeyProvider.overrideWith((ref) => currentPubkey),
        userCacheProvider.overrideWith(_TestUserCacheNotifier.new),
      ],
      child: RepaintBoundary(
        key: captureKey,
        child: captureStatusBar
            ? ClipRRect(
                borderRadius: BorderRadius.circular(36),
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    app,
                    _ProofStatusBar(brightness: brightness),
                    _ProofHomeIndicator(brightness: brightness),
                  ],
                ),
              )
            : app,
      ),
    ),
  );
  await tester.pumpAndSettle();
}

class _BusinessRecords {
  _BusinessRecords()
    : version1 = _version(1, _id(3)),
      version2 = _version(2, _id(4), previous: _id(3)) {
    head = headFor(version2);
  }

  final NostrEvent version1;
  final NostrEvent version2;
  late NostrEvent head;

  DeliverableReviewRequest get request => DeliverableReviewRequest(
    reference: WorkItemReference(
      clientId: _clientId,
      workItemId: _workItemId,
      authorPubkey: _versionAuthor,
      dTag: 'client:$_clientId:work:$_workItemId',
    ),
    clientName: 'Olive Studio',
    deliverableId: _deliverableId,
    versionEventId: version2.id,
  );

  List<NostrEvent> get events => [head, version1, version2];

  NostrEvent version(int number, String id, {String? previous}) =>
      _version(number, id, previous: previous);

  NostrEvent headFor(NostrEvent version) {
    final parsed = parseDeliverableVersion(version);
    final body = {
      'schemaVersion': 1,
      'clientId': _clientId,
      'workItemId': _workItemId,
      'title': 'A slower kind of morning.',
      'status': 'open',
      'assignedPubkeys': [_versionAuthor],
      'approverPubkeys': [_approverPubkey],
      'deliverables': [
        {
          'deliverableId': _deliverableId,
          'versionEventId': version.id,
          'contentDigest': parsed.contentDigest,
          'mediaDigest': parsed.mediaDigest,
          'versionDigest': parsed.versionDigest,
        },
      ],
      'sourceEventId': version.id,
    };
    return _event(
      id: _id(10 + parsed.version),
      kind: EventKind.workItemHead,
      tags: [
        ['h', _clientId],
        ['d', 'client:$_clientId:work:$_workItemId'],
      ],
      content: jsonEncode(body),
    );
  }

  String versionContent({String? contentDigest}) {
    final body = {
      'content':
          'Three customer-led concepts for October. A quieter visual direction, warm captions, and a weekly rhythm built around the studio.',
      'title': 'A slower kind of morning.',
    };
    final digest = contentDigest ?? _sha(utf8.encode(jsonEncode(body)));
    return jsonEncode({
      'schemaVersion': 1,
      'clientId': _clientId,
      'workItemId': _workItemId,
      'deliverableId': _deliverableId,
      'version': 1,
      'previousVersionEventId': null,
      'contentDigest': digest,
      'mediaDigests': <String>[],
      'body': body,
    });
  }

  NostrEvent approval({
    DeliverableVersionRecord? version,
    String decision = 'approved',
    String? note,
  }) {
    final selected = version ?? parseDeliverableVersion(version2);
    return _event(
      id: _id(decision == 'approved' ? 20 : 21),
      kind: EventKind.deliverableApproval,
      pubkey: _approverPubkey,
      createdAt: 20,
      tags: [
        ['h', _clientId],
        ['d', 'client:$_clientId:deliverable-approval:${selected.event.id}'],
      ],
      content: jsonEncode({
        'schemaVersion': 1,
        'clientId': _clientId,
        'workItemId': _workItemId,
        'deliverableId': _deliverableId,
        'versionEventId': selected.event.id,
        'contentDigest': selected.contentDigest,
        'mediaDigest': selected.mediaDigest,
        'decision': decision,
        'note': note,
      }),
    );
  }
}

NostrEvent _version(int number, String id, {String? previous}) {
  final body = {
    'content':
        'Three customer-led concepts for October. A quieter visual direction, warm captions, and a weekly rhythm built around the studio.',
    'title': 'A slower kind of morning.',
  };
  final digest = _sha(utf8.encode(jsonEncode(body)));
  final dTag = 'client:$_clientId:deliverable:$_deliverableId:version:$number';
  return _event(
    id: id,
    kind: EventKind.deliverableVersion,
    pubkey: _versionAuthor,
    createdAt: 10 + number,
    tags: [
      ['h', _clientId],
      ['d', dTag],
    ],
    content: jsonEncode({
      'schemaVersion': 1,
      'clientId': _clientId,
      'workItemId': _workItemId,
      'deliverableId': _deliverableId,
      'version': number,
      'previousVersionEventId': previous,
      'contentDigest': digest,
      'mediaDigests': <String>[],
      'body': body,
    }),
  );
}

NostrEvent _event({
  required String id,
  required int kind,
  required List<List<String>> tags,
  required String content,
  String pubkey = _versionAuthor,
  int createdAt = 1,
}) => NostrEvent(
  id: id,
  pubkey: pubkey,
  createdAt: createdAt,
  kind: kind,
  tags: tags,
  content: content,
  sig: '',
);

String _sha(List<int> bytes) => SHA256Digest()
    .process(Uint8List.fromList(bytes))
    .map((byte) => byte.toRadixString(16).padLeft(2, '0'))
    .join();

String _id(int value) => value.toRadixString(16).padLeft(64, '0');

class _FakeDeliverableGateway implements DeliverableRecordGateway {
  _FakeDeliverableGateway(Iterable<NostrEvent> events)
    : events = events.toList();

  final List<NostrEvent> events;
  final List<void Function(NostrEvent)> _listeners = [];
  int? publishedKind;
  String? publishedContent;
  List<List<String>>? publishedTags;
  bool failPublish = false;

  @override
  Future<List<NostrEvent>> fetch(NostrFilter filter) async {
    final matches = events
        .where((event) {
          if (!filter.kinds.contains(event.kind)) return false;
          if (filter.ids != null && !filter.ids!.contains(event.id))
            return false;
          if (filter.authors != null &&
              !filter.authors!.contains(event.pubkey)) {
            return false;
          }
          for (final entry in filter.tags.entries) {
            final name = entry.key.substring(1);
            if (!event.tags.any(
              (tag) =>
                  tag.length > 1 &&
                  tag.first == name &&
                  entry.value.contains(tag[1]),
            )) {
              return false;
            }
          }
          return true;
        })
        .take(filter.limit)
        .toList();
    return matches;
  }

  @override
  Future<void Function()> subscribe(
    NostrFilter filter,
    void Function(NostrEvent event) onEvent,
  ) async {
    _listeners.add(onEvent);
    return () => _listeners.remove(onEvent);
  }

  @override
  Future<NostrEvent> publish({
    required int kind,
    required String content,
    required List<List<String>> tags,
    void Function(NostrEvent event)? onSigned,
  }) async {
    publishedKind = kind;
    publishedContent = content;
    publishedTags = tags;
    if (failPublish) throw StateError('fixture publish failed');
    final event = _event(
      id: _id(99),
      kind: kind,
      tags: tags,
      content: content,
      pubkey: _approverPubkey,
      createdAt: 99,
    );
    events.add(event);
    onSigned?.call(event);
    _emit(event);
    return event;
  }

  void replaceHead(NostrEvent event) {
    events.removeWhere((existing) => existing.kind == EventKind.workItemHead);
    events.add(event);
  }

  void addAndEmit(NostrEvent event) {
    events.add(event);
    _emit(event);
  }

  void _emit(NostrEvent event) {
    for (final listener in List.of(_listeners)) {
      listener(event);
    }
  }
}

class _TestUserCacheNotifier extends UserCacheNotifier {
  @override
  Map<String, UserProfile> build() => {
    _versionAuthor: const UserProfile(
      pubkey: _versionAuthor,
      displayName: 'Mina',
      ownerPubkey: _approverPubkey,
    ),
  };

  @override
  UserProfile? get(String pubkey) => null;
}

class _CaptureFileComparator extends LocalFileComparator {
  _CaptureFileComparator(super.testFile, this.outputPath);

  final String outputPath;

  @override
  Future<bool> compare(Uint8List imageBytes, Uri golden) async {
    final file = File('$outputPath/${golden.pathSegments.last}');
    await file.parent.create(recursive: true);
    await file.writeAsBytes(imageBytes);
    return true;
  }
}

class _ProofStatusBar extends StatelessWidget {
  const _ProofStatusBar({required this.brightness});

  final Brightness brightness;

  @override
  Widget build(BuildContext context) {
    final color = brightness == Brightness.dark
        ? const Color(0xffeee8f0)
        : const Color(0xff292632);
    return Positioned(
      top: 0,
      left: 0,
      right: 0,
      child: IgnorePointer(
        child: SizedBox(
          height: 46,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(25, 8, 25, 0),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  '9:41',
                  style: TextStyle(
                    color: color,
                    fontFamily: 'Manrope',
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                Row(
                  children: [
                    Icon(Icons.signal_cellular_alt, color: color, size: 14),
                    const SizedBox(width: 3),
                    Icon(Icons.battery_full, color: color, size: 16),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ProofHomeIndicator extends StatelessWidget {
  const _ProofHomeIndicator({required this.brightness});

  final Brightness brightness;

  @override
  Widget build(BuildContext context) => Positioned(
    bottom: 8,
    left: 0,
    right: 0,
    child: IgnorePointer(
      child: Center(
        child: Container(
          width: 108,
          height: 4,
          decoration: BoxDecoration(
            color: brightness == Brightness.dark
                ? Colors.white
                : const Color(0xff292632),
            borderRadius: BorderRadius.circular(4),
          ),
        ),
      ),
    ),
  );
}
