part of '../pairing_mobile_page.dart';

class _PairingContent extends StatelessWidget {
  const _PairingContent({required this.children, this.topPadding = 24});

  final List<Widget> children;
  final double topPadding;

  @override
  Widget build(BuildContext context) => SingleChildScrollView(
    padding: EdgeInsets.fromLTRB(Grid.gutter, topPadding, Grid.gutter, 24),
    child: ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 440),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: children,
      ),
    ),
  );
}

class _PairingIntro extends StatelessWidget {
  const _PairingIntro({required this.title, required this.description});

  final String title;
  final String description;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Semantics(
          header: true,
          child: Text(
            title,
            style: context.mobileTypography.flowTitle.copyWith(
              color: tokens.ink,
              fontSize: 28,
              fontWeight: FontWeight.w700,
              letterSpacing: -1.1,
              height: 1.13,
            ),
          ),
        ),
        const SizedBox(height: 10),
        Text(
          description,
          style: context.mobileTypography.conversation.copyWith(
            color: tokens.muted,
            fontSize: 13,
            height: 1.7,
          ),
        ),
      ],
    );
  }
}

class _PairingStartView extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return _PairingContent(
      topPadding: 22,
      children: [
        const _PairingIntro(
          title: 'Your Colony.\nOn this phone.',
          description: 'Use the same identity you already have on desktop.',
        ),
        const SizedBox(height: 27),
        const _PairingDeviceIllustration(),
        const SizedBox(height: 32),
        const _PairingInstruction(
          number: '1',
          text: 'On desktop, open ',
          emphasis: 'Settings → App & devices → Mobile.',
        ),
        const SizedBox(height: 18),
        const _PairingInstruction(
          number: '2',
          text: 'Choose ',
          emphasis: 'Pair a phone.',
        ),
        const SizedBox(height: 18),
        const _PairingInstruction(
          number: '3',
          text: 'Scan its QR code, then compare and confirm on both devices.',
        ),
        const SizedBox(height: 23),
        Text(
          'Only pair with a desktop you trust. This phone will gain access to your Colony identity.',
          style: context.mobileTypography.metadata.copyWith(
            color: tokens.muted,
            fontSize: 12,
            height: 1.65,
          ),
        ),
      ],
    );
  }
}

class _PairingDeviceIllustration extends StatelessWidget {
  const _PairingDeviceIllustration();

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Container(
      height: 100,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(Radii.container),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0x66e7cbdc), Color(0x66c8d8ed)],
        ),
      ),
      child: ExcludeSemantics(
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            CustomPaint(
              size: const Size(38, 22),
              painter: _PairingLaptopGlyph(tokens.ink),
            ),
            const SizedBox(width: 30),
            Text(
              '···',
              style: context.mobileTypography.body.copyWith(
                color: tokens.muted,
                fontSize: 15,
              ),
            ),
            const SizedBox(width: 30),
            CustomPaint(
              size: const Size(14, 29),
              painter: _PairingPhoneGlyph(tokens.ink),
            ),
          ],
        ),
      ),
    );
  }
}

class _PairingLaptopGlyph extends CustomPainter {
  const _PairingLaptopGlyph(this.color);

  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.6
      ..strokeJoin = StrokeJoin.miter;
    final path = Path()
      ..moveTo(3, size.height - 2)
      ..lineTo(9, 2)
      ..lineTo(size.width - 2, 2)
      ..lineTo(size.width - 8, size.height - 2)
      ..close();
    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(_PairingLaptopGlyph oldDelegate) =>
      oldDelegate.color != color;
}

class _PairingPhoneGlyph extends CustomPainter {
  const _PairingPhoneGlyph(this.color);

  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.6;
    canvas.drawRect(Offset.zero & size, paint);
  }

  @override
  bool shouldRepaint(_PairingPhoneGlyph oldDelegate) =>
      oldDelegate.color != color;
}

class _PairingInstruction extends StatelessWidget {
  const _PairingInstruction({
    required this.number,
    required this.text,
    this.emphasis,
  });

  final String number;
  final String text;
  final String? emphasis;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    final emphasisParts = emphasis?.split('→');
    final style = context.mobileTypography.conversation.copyWith(
      color: tokens.ink,
      fontSize: 13,
      height: 1.7,
    );
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 24,
          height: 24,
          alignment: Alignment.center,
          decoration: const BoxDecoration(
            color: Color(0x20a688bb),
            shape: BoxShape.circle,
          ),
          child: Text(
            number,
            style: context.mobileTypography.metadata.copyWith(
              color: tokens.ink,
              fontSize: 11,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Text.rich(
            TextSpan(
              style: style,
              children: [
                TextSpan(text: text),
                if (emphasisParts != null)
                  for (final (index, part) in emphasisParts.indexed) ...[
                    ..._pairingInstructionEmphasis(part),
                    if (index < emphasisParts.length - 1)
                      WidgetSpan(
                        alignment: PlaceholderAlignment.middle,
                        child: ExcludeSemantics(
                          child: Icon(
                            Icons.arrow_forward_rounded,
                            color: tokens.ink,
                            size: 12,
                          ),
                        ),
                      ),
                  ],
              ],
            ),
          ),
        ),
      ],
    );
  }
}

List<InlineSpan> _pairingInstructionEmphasis(String value) {
  final punctuation = RegExp(r'[.!?]+$').firstMatch(value);
  if (punctuation == null) {
    return [
      TextSpan(
        text: value,
        style: const TextStyle(fontWeight: FontWeight.w700),
      ),
    ];
  }
  return [
    TextSpan(
      text: value.substring(0, punctuation.start),
      style: const TextStyle(fontWeight: FontWeight.w700),
    ),
    TextSpan(text: value.substring(punctuation.start)),
  ];
}

class _PairingScanView extends StatelessWidget {
  const _PairingScanView({
    required this.onCameraError,
    required this.onScan,
    required this.cameraPreviewBuilder,
  });

  final ValueChanged<MobileScannerException> onCameraError;
  final ValueChanged<String> onScan;
  final PairingCameraPreviewBuilder? cameraPreviewBuilder;

  @override
  Widget build(BuildContext context) => _PairingContent(
    children: [
      const _PairingIntro(
        title: 'Scan your desktop.',
        description: 'Point your camera at the QR code shown in Colony.',
      ),
      const SizedBox(height: 26),
      _PairingCameraPanel(
        onCameraError: onCameraError,
        onScan: onScan,
        previewBuilder: cameraPreviewBuilder,
      ),
    ],
  );
}

class _PairingCameraPanel extends StatelessWidget {
  const _PairingCameraPanel({
    required this.onCameraError,
    required this.onScan,
    required this.previewBuilder,
  });

  final ValueChanged<MobileScannerException> onCameraError;
  final ValueChanged<String> onScan;
  final PairingCameraPreviewBuilder? previewBuilder;

  @override
  Widget build(BuildContext context) => Semantics(
    container: true,
    label: 'Camera preview for scanning the desktop QR code',
    child: ClipRRect(
      borderRadius: BorderRadius.circular(Radii.container),
      child: SizedBox(
        height: 310,
        child: Stack(
          fit: StackFit.expand,
          children: [
            if (previewBuilder != null)
              previewBuilder!(context)
            else
              MobileScanner(
                fit: BoxFit.cover,
                errorBuilder: (context, error) {
                  WidgetsBinding.instance.addPostFrameCallback((_) {
                    onCameraError(error);
                  });
                  return const ColoredBox(color: Colors.black);
                },
                onDetect: (capture) {
                  for (final barcode in capture.barcodes) {
                    final value = barcode.rawValue;
                    if (value != null && value.isNotEmpty) {
                      onScan(value);
                      break;
                    }
                  }
                },
              ),
            IgnorePointer(
              child: Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    _PairingViewfinder(
                      color: Colors.white.withValues(alpha: 0.82),
                      size: 210,
                    ),
                    const SizedBox(height: 25),
                    const Text(
                      'Keep the code inside the frame',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: Colors.white,
                        fontFamily: 'Manrope',
                        fontSize: 11,
                        height: 1.3,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

class _PairingViewfinder extends StatelessWidget {
  const _PairingViewfinder({required this.color, required this.size});

  final Color color;
  final double size;

  @override
  Widget build(BuildContext context) => SizedBox(
    width: size,
    height: size,
    child: CustomPaint(painter: _PairingViewfinderPainter(color)),
  );
}

class _PairingViewfinderPainter extends CustomPainter {
  const _PairingViewfinderPainter(this.color);

  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2;
    const corner = 28.0;
    final paths = [
      Path()
        ..moveTo(0, corner)
        ..lineTo(0, 0)
        ..lineTo(corner, 0),
      Path()
        ..moveTo(size.width - corner, 0)
        ..lineTo(size.width, 0)
        ..lineTo(size.width, corner),
      Path()
        ..moveTo(0, size.height - corner)
        ..lineTo(0, size.height)
        ..lineTo(corner, size.height),
      Path()
        ..moveTo(size.width - corner, size.height)
        ..lineTo(size.width, size.height)
        ..lineTo(size.width, size.height - corner),
    ];
    for (final path in paths) {
      canvas.drawPath(path, paint);
    }
  }

  @override
  bool shouldRepaint(_PairingViewfinderPainter oldDelegate) =>
      oldDelegate.color != color;
}

class _PairingManualView extends StatelessWidget {
  const _PairingManualView({
    required this.controller,
    required this.errorMessage,
    required this.busy,
    required this.onChanged,
  });

  final TextEditingController controller;
  final String? errorMessage;
  final bool busy;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return _PairingContent(
      children: [
        const _PairingIntro(
          title: 'Enter the pairing code.',
          description: 'Copy or type the pairing code shown on your desktop.',
        ),
        const SizedBox(height: 18),
        Text(
          'Pairing code',
          style: context.mobileTypography.metadata.copyWith(
            color: tokens.ink,
            fontSize: 11,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 6),
        SizedBox(
          height: 96,
          child: TextField(
            controller: controller,
            enabled: !busy,
            expands: true,
            maxLines: null,
            minLines: null,
            textAlignVertical: TextAlignVertical.top,
            keyboardType: TextInputType.multiline,
            textInputAction: TextInputAction.newline,
            style: context.mobileTypography.conversation.copyWith(
              color: tokens.ink,
              fontSize: 13,
              height: 1.7,
            ),
            onChanged: (_) => onChanged(),
            decoration: InputDecoration(
              hintText: 'Paste the desktop pairing code',
              hintStyle: context.mobileTypography.conversation.copyWith(
                color: tokens.muted,
                fontSize: 13,
              ),
              filled: true,
              fillColor: tokens.soft,
              contentPadding: const EdgeInsets.fromLTRB(14, 13, 14, 12),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(Radii.field),
                borderSide: BorderSide(color: tokens.line),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(Radii.field),
                borderSide: BorderSide(color: tokens.line),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(Radii.field),
                borderSide: BorderSide(color: tokens.action),
              ),
            ),
          ),
        ),
        if (errorMessage != null) ...[
          const SizedBox(height: 8),
          Text(
            errorMessage!,
            style: context.mobileTypography.metadata.copyWith(
              color: context.colors.error,
              fontSize: 12,
              height: 1.4,
            ),
          ),
        ],
        const SizedBox(height: 18),
        Text(
          'Use the full pairing code, not the six-digit confirmation code.',
          style: context.mobileTypography.metadata.copyWith(
            color: tokens.muted,
            fontSize: 12,
            height: 1.65,
          ),
        ),
      ],
    );
  }
}

class _PairingCameraDeniedView extends StatelessWidget {
  const _PairingCameraDeniedView();

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return _PairingContent(
      children: [
        const _PairingIntro(
          title: 'Camera access is off.',
          description:
              'You can still pair this phone by entering the code from your desktop.',
        ),
        const SizedBox(height: 26),
        Container(
          width: 62,
          height: 62,
          alignment: Alignment.center,
          decoration: const BoxDecoration(
            color: Color(0x209d80b0),
            shape: BoxShape.circle,
          ),
          child: const CustomPaint(
            size: Size(20, 20),
            painter: _PairingPermissionGlyph(),
          ),
        ),
        const SizedBox(height: 26),
        Text(
          'To scan instead, allow camera access for Colony in your phone’s settings.',
          style: context.mobileTypography.conversation.copyWith(
            color: tokens.muted,
            fontSize: 13,
            height: 1.65,
          ),
        ),
      ],
    );
  }
}

class _PairingPermissionGlyph extends CustomPainter {
  const _PairingPermissionGlyph();

  @override
  void paint(Canvas canvas, Size size) {
    const color = Color(0xff8c7799);
    const rect = Rect.fromLTWH(1, 1, 18, 18);
    final outline = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.3;
    canvas.drawRect(rect, outline);
    canvas.save();
    canvas.clipRect(rect);
    final hatch = Paint()
      ..color = color
      ..strokeWidth = 1;
    for (var x = -16.0; x < 24; x += 5) {
      canvas.drawLine(Offset(x, 19), Offset(x + 18, 1), hatch);
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(_PairingPermissionGlyph oldDelegate) => false;
}
