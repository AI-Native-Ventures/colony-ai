import 'package:flutter/material.dart';

typedef EmojiGlyphBuilder = Widget Function(String emoji, double fontSize);

/// Draws an emoji with the platform font and permits deterministic test art.
class EmojiGlyph extends StatelessWidget {
  const EmojiGlyph({
    required this.emoji,
    required this.fontSize,
    this.builder,
    super.key,
  });

  final String emoji;
  final double fontSize;
  final EmojiGlyphBuilder? builder;

  @override
  Widget build(BuildContext context) {
    final customBuilder = builder;
    return customBuilder == null
        ? Text(emoji, style: TextStyle(fontSize: fontSize))
        : customBuilder(emoji, fontSize);
  }
}
