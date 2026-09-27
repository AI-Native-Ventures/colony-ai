import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart' show visibleForTesting;

import '../../shared/emoji/emoji_glyph.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/mobile_flow_app_bar.dart';

const profileStatusEmojis = <(String, String)>[
  ('🌿', 'Herb'),
  ('🌻', 'Sunflower'),
  ('✨', 'Sparkles'),
  ('📅', 'Calendar'),
  ('🚌', 'Bus'),
  ('🍵', 'Tea'),
  ('🏖️', 'Beach'),
  ('🏠', 'House'),
  ('💻', 'Laptop'),
  ('🎨', 'Palette'),
  ('🚀', 'Rocket'),
  ('📚', 'Books'),
];

/// Lets the user choose one of the status emojis shown in the r19 flow.
class ProfileStatusEmojiPage extends StatelessWidget {
  const ProfileStatusEmojiPage({
    required this.selectedEmoji,
    this.emojiBuilder,
    super.key,
  });

  final String selectedEmoji;

  @visibleForTesting
  final EmojiGlyphBuilder? emojiBuilder;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Scaffold(
      backgroundColor: colors.surface,
      appBar: const MobileFlowAppBar(title: 'Status emoji'),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(
          Grid.gutter,
          Grid.xs,
          Grid.gutter,
          Grid.gutter,
        ),
        children: [
          Text(
            'Choose an emoji',
            style: context.textTheme.headlineSmall?.copyWith(
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: Grid.md),
          GridView.builder(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            itemCount: profileStatusEmojis.length,
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 4,
              crossAxisSpacing: Grid.xs,
              mainAxisSpacing: Grid.xs,
              childAspectRatio: 1,
            ),
            itemBuilder: (context, index) {
              final (emoji, name) = profileStatusEmojis[index];
              final selected = emoji == selectedEmoji;
              return Semantics(
                button: true,
                selected: selected,
                label: name,
                onTap: () => Navigator.of(context).pop(emoji),
                child: ExcludeSemantics(
                  child: Material(
                    color: selected
                        ? colors.primaryContainer
                        : colors.surfaceContainerLow,
                    borderRadius: BorderRadius.circular(Radii.dialog),
                    child: InkWell(
                      borderRadius: BorderRadius.circular(Radii.dialog),
                      onTap: () => Navigator.of(context).pop(emoji),
                      child: Center(
                        child: EmojiGlyph(
                          emoji: emoji,
                          fontSize: 30,
                          builder: emojiBuilder,
                        ),
                      ),
                    ),
                  ),
                ),
              );
            },
          ),
        ],
      ),
    );
  }
}
