part of 'channel_detail_page_test.dart';

void huddleVisualProofTests() {
  const captureScreenshots = bool.fromEnvironment('CAPTURE_W23_HUDDLE_SHOTS');
  if (!captureScreenshots) return;

  testWidgets('captures the huddle lobby at both v6 sizes and themes', (
    tester,
  ) async {
    const captureKey = ValueKey('w23-huddle-lobby-capture');
    final output = Directory('/tmp/w23-mobile-huddle-proof')
      ..createSync(recursive: true);
    final previousComparator = goldenFileComparator;
    final previousPlatform = debugDefaultTargetPlatformOverride;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
      tester.view.viewPadding = FakeViewPadding.zero;
      tester.view.padding = FakeViewPadding.zero;
      goldenFileComparator = previousComparator;
      debugDefaultTargetPlatformOverride = previousPlatform;
    });

    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    await _loadHuddleProofFonts();
    for (final size in const [Size(390, 844), Size(412, 915)]) {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = size;
      tester.view.viewPadding = const FakeViewPadding(top: 72, bottom: 20);
      tester.view.padding = const FakeViewPadding(top: 72, bottom: 20);
      for (final brightness in [Brightness.light, Brightness.dark]) {
        final mode = brightness == Brightness.light ? 'light' : 'dark';
        goldenFileComparator = _CaptureFileComparator(
          Uri.file('${output.path}/capture_test.dart'),
          output.path,
        );
        final now = DateTime.now().millisecondsSinceEpoch ~/ 1000;
        final app = _buildTestable(
          messages: [
            _huddleMsg(
              id: 'visual-huddle',
              kind: EventKind.huddleStarted,
              createdAt: now,
            ),
          ],
          users: const {
            'alice': UserProfile(pubkey: 'alice', displayName: 'Alice'),
            'mina': UserProfile(pubkey: 'mina', displayName: 'Mina'),
            'agent': UserProfile(pubkey: 'agent', displayName: 'Atlas'),
          },
          huddleMembers: [
            ChannelMember(
              pubkey: 'alice',
              role: 'member',
              joinedAt: DateTime.utc(2026, 9, 28),
            ),
            ChannelMember(
              pubkey: 'mina',
              role: 'member',
              joinedAt: DateTime.utc(2026, 9, 28),
            ),
            ChannelMember(
              pubkey: 'agent',
              role: 'bot',
              joinedAt: DateTime.utc(2026, 9, 28),
            ),
          ],
          relayConfigNotifier: _HuddleRelayConfigNotifier(),
          brightness: brightness,
          debugShowCheckedModeBanner: false,
        );
        await tester.pumpWidget(
          RepaintBoundary(
            key: captureKey,
            child: ClipRRect(
              borderRadius: BorderRadius.circular(36),
              child: Directionality(
                textDirection: TextDirection.ltr,
                child: Stack(
                  fit: StackFit.expand,
                  children: [app, _HuddleProofSystemBars(brightness)],
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.widgetWithText(FilledButton, 'Join'));
        await tester.pumpAndSettle();

        expect(find.text('A quick conversation.'), findsOneWidget);
        expect(find.byKey(const ValueKey('huddle-join-muted')), findsOneWidget);
        final filename =
            'huddle-lobby-${size.width.toInt()}x${size.height.toInt()}-$mode.png';
        await expectLater(find.byKey(captureKey), matchesGoldenFile(filename));
        debugPrint('VISUAL_PROOF ${output.path}/$filename');
        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pumpAndSettle();
      }
    }
    debugDefaultTargetPlatformOverride = previousPlatform;
  });
}

Future<void> _loadHuddleProofFonts() async {
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

class _HuddleProofSystemBars extends StatelessWidget {
  const _HuddleProofSystemBars(this.brightness);

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
            top: 35,
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
            top: 35,
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
