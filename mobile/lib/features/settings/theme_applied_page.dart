part of 'appearance_settings_pages.dart';

class ThemeAppliedPage extends ConsumerWidget {
  const ThemeAppliedPage({required this.themeName, super.key});

  final String themeName;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = findTheme(themeName) ?? findTheme('buzz')!;
    final preference = ref.watch(appearanceDisplayPreferenceProvider);
    return Scaffold(
      backgroundColor: context.mobileTokens.canvas,
      appBar: const MobileFlowAppBar(title: 'Appearance'),
      body: Column(
        children: [
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(
                Grid.gutter,
                Grid.gutter,
                Grid.gutter,
                Grid.xs,
              ),
              children: [
                Text(
                  'Your theme is set.',
                  style: context.textTheme.headlineSmall?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: Grid.sm),
                _AppliedThemePreview(theme: theme),
                const SizedBox(height: Grid.xs),
                Text(
                  _themeDisplayName(theme),
                  style: context.mobileTypography.body.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: Grid.xs),
                _PreferenceSummary(label: 'Scope', value: 'Only you'),
                _PreferenceSummary(
                  label: 'Density',
                  value: preference.density.label,
                ),
                _PreferenceSummary(
                  label: 'Text size',
                  value: preference.textSize.label,
                ),
                const SizedBox(height: Grid.sm),
                SizedBox(
                  width: double.infinity,
                  height: 44,
                  child: OutlinedButton(
                    onPressed: () =>
                        MobileNavigation.push<NoMobileRouteArguments, Object?>(
                          context,
                          MobileRoutes.settingsThemes,
                          const NoMobileRouteArguments(),
                        ),
                    child: const Text('Browse themes'),
                  ),
                ),
              ],
            ),
          ),
          SafeArea(
            top: false,
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.fromLTRB(
                Grid.gutter,
                Grid.xs,
                Grid.gutter,
                Grid.xs,
              ),
              decoration: BoxDecoration(
                border: Border(
                  top: BorderSide(color: context.mobileTokens.line),
                ),
              ),
              child: SizedBox(
                height: 44,
                child: FilledButton(
                  style: mobileFlowActionButtonStyle(context),
                  onPressed: () => Navigator.of(context).popUntil(
                    (route) =>
                        route.settings.name ==
                        MobileRoutes.settingsAppearance.path,
                  ),
                  child: const Text('Done'),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _AppliedThemePreview extends ConsumerWidget {
  const _AppliedThemePreview({required this.theme});

  final ThemeColors theme;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final channels = ref.watch(channelsProvider).asData?.value;
    if (channels == null) return const SizedBox.shrink();

    final candidates =
        channels
            .where(
              (channel) =>
                  !channel.isDm &&
                  !channel.isArchived &&
                  channel.lastMessageContent?.trim().isNotEmpty == true &&
                  channel.lastMessageCreatedAt != null,
            )
            .toList()
          ..sort(
            (left, right) => right.lastMessageCreatedAt!.compareTo(
              left.lastMessageCreatedAt!,
            ),
          );
    if (candidates.isEmpty) return const SizedBox.shrink();

    final channel = candidates.first;
    final defaultTheme =
        theme.name.toLowerCase() == 'buzz' ||
        theme.name.toLowerCase() == 'colony';
    final gradientColors = defaultTheme
        ? const [Color(0xFFEFDCE8), Color(0xFFC8D5EB)]
        : [
            Color.alphaBlend(theme.fg.withValues(alpha: 0.06), theme.bg),
            Color.alphaBlend(theme.comment.withValues(alpha: 0.24), theme.bg),
          ];

    return Container(
      height: 98,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: theme.bg,
        border: Border.all(color: theme.fg.withValues(alpha: 0.12)),
        borderRadius: BorderRadius.circular(Radii.dialog),
      ),
      child: Row(
        children: [
          SizedBox(
            width: 84,
            height: double.infinity,
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: gradientColors,
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
              ),
            ),
          ),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.all(Grid.xs),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    channel.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: theme.fg,
                      fontSize: 10,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: Grid.xxs),
                  Text(
                    channel.lastMessageContent!.trim(),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(color: theme.fg, fontSize: 10),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Saves app-local accessibility preferences without implying notification
/// controls that the current push API does not support.
