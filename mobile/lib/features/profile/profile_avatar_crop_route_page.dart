import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:image/image.dart' as image;

import '../../shared/theme/theme.dart';
import '../../shared/widgets/mobile_flow_app_bar.dart';

/// Crop controls styled for the frozen mobile profile image route.
class ProfileAvatarCropRoutePage extends HookWidget {
  const ProfileAvatarCropRoutePage({required this.imageBytes, super.key});

  final Uint8List imageBytes;

  @override
  Widget build(BuildContext context) {
    final zoom = useState(1.0);
    final horizontal = useState(0.0);
    final vertical = useState(0.0);
    final saving = useState(false);

    Future<void> save() async {
      if (saving.value) return;
      saving.value = true;
      try {
        final cropped = await compute(_cropAvatarBytes, (
          bytes: imageBytes,
          zoom: zoom.value,
          x: horizontal.value,
          y: vertical.value,
        ));
        if (context.mounted) Navigator.of(context).pop(cropped);
      } catch (_) {
        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text("We couldn't prepare that photo.")),
          );
        }
      } finally {
        if (context.mounted) saving.value = false;
      }
    }

    return Scaffold(
      backgroundColor: context.mobileTokens.canvas,
      appBar: const MobileFlowAppBar(title: 'Crop photo'),
      body: Column(
        children: [
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(
                Grid.gutter,
                Grid.twentyEight,
                Grid.gutter,
                Grid.lg,
              ),
              children: [
                if (imageBytes.isEmpty)
                  _CropMessageCard(
                    title: 'Choose a photo first',
                    detail: 'The crop preview uses your selected file.',
                    color: _cropMessageColor(context),
                    textColor: _cropMessageTextColor(context),
                  )
                else
                  ClipRRect(
                    borderRadius: BorderRadius.circular(Radii.md),
                    child: AspectRatio(
                      aspectRatio: 1,
                      child: Transform.scale(
                        scale: zoom.value,
                        child: Image.memory(
                          imageBytes,
                          fit: BoxFit.cover,
                          alignment: Alignment(
                            (horizontal.value / 30).clamp(-1, 1),
                            (vertical.value / 30).clamp(-1, 1),
                          ),
                        ),
                      ),
                    ),
                  ),
                const SizedBox(height: 18),
                _CropSlider(
                  label: 'Zoom',
                  value: zoom.value,
                  min: 1,
                  max: 3,
                  onChanged: (value) => zoom.value = value,
                ),
                _CropSlider(
                  label: 'Horizontal position',
                  value: horizontal.value,
                  min: -30,
                  max: 30,
                  onChanged: (value) => horizontal.value = value,
                ),
                _CropSlider(
                  label: 'Vertical position',
                  value: vertical.value,
                  min: -30,
                  max: 30,
                  onChanged: (value) => vertical.value = value,
                ),
              ],
            ),
          ),
          SafeArea(
            top: false,
            child: Container(
              padding: const EdgeInsets.fromLTRB(
                Grid.xs,
                Grid.gutter,
                Grid.xs,
                Grid.xxs,
              ),
              decoration: BoxDecoration(
                border: Border(
                  top: BorderSide(color: context.mobileTokens.line),
                ),
              ),
              child: SizedBox(
                width: double.infinity,
                height: 44,
                child: FilledButton(
                  style: mobileFlowActionButtonStyle(context),
                  onPressed: saving.value
                      ? null
                      : imageBytes.isEmpty
                      ? () => ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                            content: Text('Choose a photo first.'),
                          ),
                        )
                      : save,
                  child: Text(saving.value ? 'Saving photo…' : 'Save photo'),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _CropSlider extends StatelessWidget {
  const _CropSlider({
    required this.label,
    required this.value,
    required this.min,
    required this.max,
    required this.onChanged,
  });

  final String label;
  final double value;
  final double min;
  final double max;
  final ValueChanged<double> onChanged;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(label, style: context.textTheme.labelSmall),
      Padding(
        padding: const EdgeInsets.only(top: 18, bottom: 14),
        child: Transform.scale(
          scaleX: 1.035,
          alignment: Alignment.center,
          child: SliderTheme(
            data: SliderTheme.of(context).copyWith(
              activeTrackColor: const Color(0xFF007BFF),
              inactiveTrackColor:
                  Theme.of(context).brightness == Brightness.dark
                  ? const Color(0xFFE2E2E2)
                  : const Color(0xFFBDBDBD),
              thumbColor: const Color(0xFF007BFF),
              overlayColor: Colors.transparent,
              trackHeight: 7,
              thumbShape: const RoundSliderThumbShape(
                enabledThumbRadius: 7,
                elevation: 0,
                pressedElevation: 0,
              ),
              overlayShape: SliderComponentShape.noOverlay,
            ),
            child: Slider(
              value: value,
              min: min,
              max: max,
              onChanged: onChanged,
            ),
          ),
        ),
      ),
    ],
  );
}

Color _cropMessageColor(BuildContext context) =>
    Theme.of(context).brightness == Brightness.dark
    ? const Color(0xFF364650)
    : const Color(0xFFEAF0F6);

Color _cropMessageTextColor(BuildContext context) =>
    Theme.of(context).brightness == Brightness.dark
    ? const Color(0xFFD7E0E8)
    : const Color(0xFF53718B);

class _CropMessageCard extends StatelessWidget {
  const _CropMessageCard({
    required this.title,
    required this.detail,
    required this.color,
    required this.textColor,
  });

  final String title;
  final String detail;
  final Color color;
  final Color textColor;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(14),
    decoration: BoxDecoration(
      color: color,
      borderRadius: BorderRadius.circular(10),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: context.mobileTypography.conversation.copyWith(
            fontSize: 12,
            color: textColor,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: Grid.xxs),
        Text(
          detail,
          style: context.mobileTypography.metadata.copyWith(
            fontSize: 11,
            height: 1.6,
            color: textColor,
          ),
        ),
      ],
    ),
  );
}

Uint8List _cropAvatarBytes(
  ({Uint8List bytes, double zoom, double x, double y}) input,
) {
  final decoded = image.decodeImage(input.bytes);
  if (decoded == null) {
    throw const FormatException('Photo could not be decoded');
  }
  final side = math.min(decoded.width, decoded.height) / input.zoom;
  final offsetX = input.x / 30 * side * 0.3;
  final offsetY = input.y / 30 * side * 0.3;
  final x = ((decoded.width - side) / 2 + offsetX)
      .clamp(0, decoded.width - side)
      .round();
  final y = ((decoded.height - side) / 2 + offsetY)
      .clamp(0, decoded.height - side)
      .round();
  final cropped = image.copyCrop(
    decoded,
    x: x,
    y: y,
    width: side.round(),
    height: side.round(),
  );
  final resized = image.copyResize(cropped, width: 256, height: 256);
  return Uint8List.fromList(image.encodeJpg(resized, quality: 90));
}
