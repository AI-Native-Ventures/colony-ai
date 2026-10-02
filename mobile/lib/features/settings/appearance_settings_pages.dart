import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../profile/profile_provider.dart';
import '../profile/user_status_provider.dart';
import '../../shared/community/community_provider.dart';
import '../../shared/navigation/mobile_navigation.dart';
import '../../shared/navigation/mobile_route.dart';
import '../../shared/navigation/mobile_routes.dart';
import '../../shared/huddle/huddle.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/mobile_flow_app_bar.dart';
import 'appearance_display_preference.dart';

part 'appearance_settings_page.dart';
part 'theme_catalog_page.dart';
part 'theme_preview_page.dart';
part 'theme_applied_page.dart';
part 'personal_preferences_page.dart';

class _AppearancePreview extends StatelessWidget {
  const _AppearancePreview({
    required this.theme,
    required this.density,
    required this.dark,
    required this.displayName,
    required this.initials,
    required this.about,
    required this.statusLabel,
  });

  final ThemeColors theme;
  final AppearanceDensity density;
  final bool dark;
  final String? displayName;
  final String? initials;
  final String? about;
  final String? statusLabel;

  @override
  Widget build(BuildContext context) {
    final background = theme.bg;
    final foreground = theme.fg;
    final defaultTheme =
        theme.name.toLowerCase() == 'buzz' ||
        theme.name.toLowerCase() == 'colony';
    final gradientColors = defaultTheme
        ? dark
              ? const [Color(0xFF43414F), Color(0xFF35495A)]
              : const [Color(0xFFEFDCE8), Color(0xFFC8D5EB)]
        : [
            Color.alphaBlend(theme.fg.withValues(alpha: 0.06), background),
            Color.alphaBlend(theme.comment.withValues(alpha: 0.24), background),
          ];
    return Container(
      padding: density == AppearanceDensity.compact
          ? const EdgeInsets.all(12)
          : const EdgeInsets.fromLTRB(
              Grid.gutter,
              Grid.gutter,
              Grid.gutter,
              Grid.gutter,
            ),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: gradientColors,
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        border: Border.all(color: foreground.withValues(alpha: 0.16)),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          CircleAvatar(
            radius: 17,
            backgroundColor: defaultTheme
                ? const Color(0xFFF2E5DD)
                : theme.added ?? theme.comment,
            child: initials == null
                ? null
                : Text(
                    initials!,
                    style: TextStyle(
                      color: defaultTheme && !dark
                          ? const Color(0xFF98715E)
                          : background,
                      fontSize: 10,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
          ),
          const SizedBox(width: Grid.twelve),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (displayName != null) ...[
                  Text(
                    displayName!,
                    style: context.mobileTypography.conversation.copyWith(
                      color: defaultTheme && !dark
                          ? const Color(0xFF292632)
                          : foreground,
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  if (about != null) const SizedBox(height: Grid.twelve),
                ],
                if (about != null)
                  Text(
                    about!,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: context.mobileTypography.body.copyWith(
                      color: defaultTheme && !dark
                          ? const Color(0xFF292632)
                          : foreground,
                    ),
                  ),
                if (statusLabel != null) ...[
                  const SizedBox(height: 18),
                  DecoratedBox(
                    decoration: BoxDecoration(
                      color: defaultTheme && !dark
                          ? const Color(0xFFF6EEE1)
                          : (theme.added ?? theme.comment).withValues(
                              alpha: 0.18,
                            ),
                      borderRadius: BorderRadius.circular(Radii.sm),
                    ),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: Grid.xxs,
                        vertical: Grid.half,
                      ),
                      child: Text(
                        statusLabel!,
                        style: TextStyle(
                          color: defaultTheme && !dark
                              ? const Color(0xFF997946)
                              : foreground,
                          fontSize: 10,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _AppearanceSelect<T> extends StatelessWidget {
  const _AppearanceSelect({
    required this.label,
    required this.value,
    required this.labels,
    required this.onChanged,
  });

  final String label;
  final T value;
  final Map<T, String> labels;
  final ValueChanged<T> onChanged;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    final outline = OutlineInputBorder(
      borderRadius: BorderRadius.circular(Radii.field),
      borderSide: BorderSide(color: tokens.line),
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: bodyExtraSmallTextStyle),
        const SizedBox(height: Grid.xs),
        DropdownButtonFormField<T>(
          initialValue: value,
          isExpanded: true,
          decoration: InputDecoration(
            filled: true,
            fillColor: tokens.paper,
            border: outline,
            enabledBorder: outline,
            focusedBorder: outline.copyWith(
              borderSide: BorderSide(color: tokens.action),
            ),
            constraints: const BoxConstraints(minHeight: 48),
            contentPadding: const EdgeInsets.symmetric(
              horizontal: Grid.xs,
              vertical: Grid.twelve,
            ),
          ),
          style: context.mobileTypography.conversation.copyWith(
            color: tokens.ink,
          ),
          items: labels.entries
              .map(
                (entry) => DropdownMenuItem<T>(
                  value: entry.key,
                  child: Text(entry.value),
                ),
              )
              .toList(),
          onChanged: (next) {
            if (next != null) onChanged(next);
          },
        ),
      ],
    );
  }
}

class _SettingsLinkRow extends StatelessWidget {
  const _SettingsLinkRow({
    required this.title,
    required this.subtitle,
    required this.onPressed,
  });

  final String title;
  final String subtitle;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onPressed,
    child: Container(
      constraints: const BoxConstraints(minHeight: 68),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: context.mobileTokens.line)),
      ),
      padding: const EdgeInsets.symmetric(vertical: Grid.xs),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  title,
                  style: context.mobileTypography.conversation.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                ),
                Text(
                  subtitle,
                  style: bodyExtraSmallTextStyle.copyWith(
                    color: context.mobileTokens.muted,
                  ),
                ),
              ],
            ),
          ),
          Icon(
            LucideIcons.arrowRight,
            size: 16,
            color: context.mobileTokens.muted,
          ),
        ],
      ),
    ),
  );
}

class _ThemeTile extends StatelessWidget {
  const _ThemeTile({
    required this.theme,
    required this.selected,
    required this.onPressed,
  });

  final ThemeColors theme;
  final bool selected;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    selected: selected,
    label: 'Preview ${_themeDisplayName(theme)}',
    onTap: onPressed,
    child: ExcludeSemantics(
      child: Material(
        color: context.mobileTokens.paper,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.dialog),
          side: BorderSide(color: context.mobileTokens.line),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onPressed,
          child: Padding(
            padding: const EdgeInsets.all(Grid.xxs),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Container(
                    width: double.infinity,
                    decoration: BoxDecoration(
                      color: theme.bg,
                      border: Border.all(
                        color: theme.fg.withValues(alpha: 0.18),
                      ),
                      borderRadius: BorderRadius.circular(Radii.field),
                    ),
                    alignment: Alignment.centerLeft,
                    padding: const EdgeInsets.symmetric(horizontal: Grid.xs),
                    child: Text(
                      'Aa',
                      style: TextStyle(
                        color: theme.fg,
                        fontFamily: 'Manrope',
                        fontSize: 26,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: Grid.xxs),
                Text(
                  _themeDisplayName(theme),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: context.mobileTypography.conversation.copyWith(
                    color: context.mobileTokens.ink,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                Text(
                  theme.isDark ? 'Dark' : 'Light',
                  style: context.mobileTypography.metadata.copyWith(
                    color: context.mobileTokens.muted,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    ),
  );
}

class _ThemePreviewHero extends StatelessWidget {
  const _ThemePreviewHero({
    required this.eyebrow,
    required this.title,
    required this.description,
  });

  final String eyebrow;
  final String title;
  final String description;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final tokens = context.mobileTokens;
    return Container(
      padding: const EdgeInsets.fromLTRB(20, 28, 20, 28),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(Radii.dialog),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: dark
              ? const [Color(0xFF42384E), Color(0xFF514146)]
              : const [Color(0xFFE8DFF0), Color(0xFFF3E3D5)],
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            eyebrow,
            style: context.mobileTypography.metadata.copyWith(
              color: tokens.ink,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.5,
            ),
          ),
          const SizedBox(height: Grid.xxs),
          Text(
            title,
            style: context.mobileTypography.flowTitle.copyWith(
              color: tokens.ink,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: Grid.xxs),
          ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 310),
            child: Text(
              description,
              style: context.mobileTypography.conversation.copyWith(
                color: tokens.ink,
                height: 1.45,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _PreferenceCheckbox extends StatelessWidget {
  const _PreferenceCheckbox({
    required this.title,
    required this.subtitle,
    required this.value,
    required this.onChanged,
  });

  final String title;
  final String subtitle;
  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) => Container(
    constraints: const BoxConstraints(minHeight: 68),
    decoration: BoxDecoration(
      border: Border(bottom: BorderSide(color: context.mobileTokens.line)),
    ),
    child: CheckboxListTile(
      contentPadding: EdgeInsets.zero,
      dense: true,
      visualDensity: VisualDensity.compact,
      controlAffinity: ListTileControlAffinity.trailing,
      activeColor: const Color(0xFF55719F),
      value: value,
      onChanged: (next) {
        if (next != null) onChanged(next);
      },
      title: Text(
        title,
        style: context.mobileTypography.body.copyWith(
          fontSize: 12,
          fontWeight: FontWeight.w600,
        ),
      ),
      subtitle: Text(
        subtitle,
        style: bodyExtraSmallTextStyle.copyWith(
          color: context.mobileTokens.muted,
        ),
      ),
    ),
  );
}

String _themeDisplayName(ThemeColors theme) => switch (theme.name) {
  'buzz' => 'Colony',
  'buzz-dark' => 'Colony Dark',
  _ => theme.displayName,
};
