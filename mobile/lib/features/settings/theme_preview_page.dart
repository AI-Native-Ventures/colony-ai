part of 'appearance_settings_pages.dart';

class ThemePreviewPage extends HookConsumerWidget {
  const ThemePreviewPage({required this.themeName, super.key});

  final String themeName;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = findTheme(themeName) ?? findTheme('buzz')!;
    final current = ref.watch(communityThemeProvider);
    final community = ref.watch(activeCommunityProvider).asData?.value;
    final sparse = useState(false);

    Future<void> apply() async {
      ref
          .read(communityThemeProvider.notifier)
          .setPreference(
            CommunityThemePreference(
              theme: theme.name,
              accent: current.accent,
              followSystem: false,
            ),
          );
      await MobileNavigation.replace<String>(
        context,
        MobileRoutes.settingsThemeApplied,
        theme.name,
      );
    }

    final displayName = _themeDisplayName(theme);
    return Scaffold(
      backgroundColor: context.mobileTokens.canvas,
      appBar: MobileFlowAppBar(
        title: displayName,
        subtitle: community?.name,
        compact: true,
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(
          Grid.gutter,
          Grid.xs,
          Grid.gutter,
          Grid.xs,
        ),
        children: [
          _ThemePreviewHero(
            eyebrow: 'THEME PREVIEW',
            title: displayName,
            description: 'Preview uses sample content, never private messages.',
          ),
          const SizedBox(height: Grid.xs),
          _ThemeSampleConversation(theme: theme, sparse: sparse.value),
          const SizedBox(height: Grid.xxs),
          OutlinedButton(
            onPressed: () => sparse.value = !sparse.value,
            child: Text(
              sparse.value
                  ? 'Preview an empty channel'
                  : 'Preview with a message',
            ),
          ),
          const SizedBox(height: Grid.xxs),
          FilledButton(
            style: mobileFlowActionButtonStyle(context),
            onPressed: apply,
            child: Text('Use $displayName'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).maybePop(),
            child: const Text('Back to themes'),
          ),
        ],
      ),
    );
  }
}

class _ThemeSampleConversation extends StatelessWidget {
  const _ThemeSampleConversation({required this.theme, required this.sparse});

  final ThemeColors theme;
  final bool sparse;

  @override
  Widget build(BuildContext context) {
    final border = theme.fg.withValues(alpha: 0.18);
    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: theme.bg,
        border: Border.all(color: border),
        borderRadius: BorderRadius.circular(Radii.dialog),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(Grid.xs, Grid.xs, Grid.xs, 10),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '# your-channel',
                  style: context.mobileTypography.conversation.copyWith(
                    color: theme.fg,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                Text(
                  'Preview content',
                  style: context.mobileTypography.metadata.copyWith(
                    color: theme.fg.withValues(alpha: 0.72),
                  ),
                ),
              ],
            ),
          ),
          Divider(height: 1, color: border),
          SizedBox(
            height: sparse ? 216 : 223,
            child: sparse
                ? Padding(
                    padding: const EdgeInsets.all(Grid.xs),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(
                          LucideIcons.messageSquareText,
                          size: 19,
                          color: theme.comment,
                        ),
                        const SizedBox(width: Grid.xxs),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'Sample message',
                                style: context.mobileTypography.conversation
                                    .copyWith(
                                      color: theme.fg,
                                      fontWeight: FontWeight.w700,
                                    ),
                              ),
                              Text(
                                'Here is how a short message looks in this theme.',
                                style: context.mobileTypography.conversation
                                    .copyWith(color: theme.fg, height: 1.45),
                              ),
                              Text(
                                'Illustrative content',
                                style: context.mobileTypography.metadata
                                    .copyWith(color: theme.comment),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  )
                : Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(LucideIcons.sparkles, size: 24, color: theme.fg),
                      const SizedBox(height: Grid.xxs),
                      Text(
                        'A little space to begin.',
                        style: context.mobileTypography.conversation.copyWith(
                          color: theme.fg,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      Text(
                        'Your first conversation will appear here.',
                        style: context.mobileTypography.conversation.copyWith(
                          color: theme.fg,
                        ),
                      ),
                    ],
                  ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(Grid.xxs, 0, Grid.xxs, Grid.xxs),
            child: Container(
              constraints: const BoxConstraints(minHeight: 48),
              alignment: Alignment.centerLeft,
              padding: const EdgeInsets.symmetric(horizontal: Grid.xs),
              decoration: BoxDecoration(
                border: Border.all(color: border),
                borderRadius: BorderRadius.circular(Radii.field),
              ),
              child: Text(
                'Message your team...',
                style: context.mobileTypography.metadata.copyWith(
                  color: theme.comment,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
