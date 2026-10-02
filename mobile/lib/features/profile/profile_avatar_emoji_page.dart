import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../shared/emoji/emoji_avatar.dart';
import '../../shared/emoji/emoji_glyph.dart';
import '../../shared/navigation/mobile_navigation.dart';
import '../../shared/navigation/mobile_route.dart';
import '../../shared/navigation/mobile_routes.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/mobile_flow_app_bar.dart';
import 'profile_provider.dart';

const _avatarEmojis = <(String, String)>[
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
const _avatarBackgrounds = <(String, int)>[
  ('Sage', 0xFFDDE8DB),
  ('Rose', 0xFFF0D8E3),
  ('Sky', 0xFFD7E3F6),
  ('Sand', 0xFFEFE3CA),
  ('Lilac', 0xFFE4DCF3),
  ('Ink', 0xFF33313E),
];

/// Selects a real emoji avatar and publishes it through the profile provider.
class ProfileAvatarEmojiPage extends HookConsumerWidget {
  const ProfileAvatarEmojiPage({this.emojiBuilder, super.key});

  @visibleForTesting
  final EmojiGlyphBuilder? emojiBuilder;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final emoji = useState(_avatarEmojis.first.$1);
    final background = useState(_avatarBackgrounds.first.$2);
    final saving = useState(false);

    Future<void> save() async {
      if (saving.value) return;
      saving.value = true;
      try {
        await ref
            .read(profileProvider.notifier)
            .updateAvatarUrl(emojiAvatarDataUrl(emoji.value, background.value));
        if (context.mounted) {
          await _push(context, MobileRoutes.profileAvatarSaved);
        }
      } catch (_) {
        if (context.mounted) await _push(context, MobileRoutes.profileFailed);
      } finally {
        if (context.mounted) saving.value = false;
      }
    }

    return Scaffold(
      backgroundColor: context.mobileTokens.canvas,
      appBar: const MobileFlowAppBar(title: 'Emoji avatar'),
      body: Column(
        children: [
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(
                Grid.gutter,
                Grid.scrollInset,
                Grid.gutter,
                Grid.lg,
              ),
              children: [
                Text(
                  'A little more you.',
                  style: context.textTheme.headlineSmall?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: Grid.lg),
                Center(
                  child: Container(
                    width: 108,
                    height: 108,
                    decoration: BoxDecoration(
                      color: Color(background.value),
                      shape: BoxShape.circle,
                    ),
                    alignment: Alignment.center,
                    child: EmojiGlyph(
                      emoji: emoji.value,
                      fontSize: 42,
                      builder: emojiBuilder,
                    ),
                  ),
                ),
                const SizedBox(height: Grid.xl),
                Text(
                  'Emoji',
                  style: context.mobileTypography.conversation.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: Grid.fourteen),
                GridView.builder(
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  itemCount: _avatarEmojis.length,
                  gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: 6,
                    mainAxisSpacing: Grid.xxs,
                    crossAxisSpacing: Grid.xxs,
                    childAspectRatio: 1.15,
                  ),
                  itemBuilder: (context, index) {
                    final candidate = _avatarEmojis[index];
                    final selected = candidate.$1 == emoji.value;
                    return Semantics(
                      button: true,
                      selected: selected,
                      label: candidate.$2,
                      onTap: () => emoji.value = candidate.$1,
                      child: ExcludeSemantics(
                        child: Material(
                          color: selected
                              ? const Color(0xFFE9DEF0)
                              : context.mobileTokens.soft,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(9),
                            side: BorderSide(
                              color: selected
                                  ? const Color(0xFF9474AE)
                                  : Colors.transparent,
                            ),
                          ),
                          clipBehavior: Clip.antiAlias,
                          child: InkWell(
                            onTap: () => emoji.value = candidate.$1,
                            child: Center(
                              child: EmojiGlyph(
                                emoji: candidate.$1,
                                fontSize: 23,
                                builder: emojiBuilder,
                              ),
                            ),
                          ),
                        ),
                      ),
                    );
                  },
                ),
                const SizedBox(height: Grid.xxs),
                Text(
                  'Background',
                  style: context.mobileTypography.conversation.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: Grid.xxs),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    for (final swatch in _avatarBackgrounds)
                      _BackgroundSwatch(
                        label: swatch.$1,
                        color: swatch.$2,
                        selected: swatch.$2 == background.value,
                        onPressed: () => background.value = swatch.$2,
                      ),
                  ],
                ),
                const SizedBox(height: Grid.xs),
                Text(
                  'Shown beside your messages and on your profile.',
                  style: context.textTheme.labelSmall?.copyWith(
                    color: context.mobileTokens.muted,
                  ),
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
                  onPressed: saving.value ? null : save,
                  child: Text(saving.value ? 'Saving avatar…' : 'Save avatar'),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _BackgroundSwatch extends StatelessWidget {
  const _BackgroundSwatch({
    required this.label,
    required this.color,
    required this.selected,
    required this.onPressed,
  });

  final String label;
  final int color;
  final bool selected;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    selected: selected,
    label: '$label background',
    onTap: onPressed,
    child: ExcludeSemantics(
      child: InkWell(
        onTap: onPressed,
        customBorder: const CircleBorder(),
        child: Container(
          width: 43,
          height: 43,
          padding: const EdgeInsets.all(3),
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            border: selected
                ? Border.all(color: const Color(0xFF806493))
                : null,
          ),
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: Color(color),
              shape: BoxShape.circle,
            ),
          ),
        ),
      ),
    ),
  );
}

Future<void> _push(
  BuildContext context,
  MobileRoute<NoMobileRouteArguments> route,
) => MobileNavigation.push<NoMobileRouteArguments, Object?>(
  context,
  route,
  const NoMobileRouteArguments(),
);
