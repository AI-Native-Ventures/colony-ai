part of 'appearance_settings_pages.dart';

class ThemeAppliedPage extends HookConsumerWidget {
  const ThemeAppliedPage({required this.themeName, super.key});

  final String themeName;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = findTheme(themeName) ?? findTheme('buzz')!;
    final community = ref.watch(activeCommunityProvider).asData?.value;
    final displayName = _themeDisplayName(theme);
    final sparse = useState(true);
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
            eyebrow: 'APPLIED',
            title: displayName,
            description: 'Preview uses sample content, never private messages.',
          ),
          const SizedBox(height: Grid.xs),
          const _ThemeSavedNotice(),
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
            onPressed: () => ref
                .read(communityThemeProvider.notifier)
                .setPreference(
                  CommunityThemePreference(
                    theme: theme.name,
                    accent: ref.read(communityThemeProvider).accent,
                    followSystem: false,
                  ),
                ),
            child: Text('Use $displayName'),
          ),
          TextButton(
            onPressed: () =>
                MobileNavigation.push<NoMobileRouteArguments, Object?>(
                  context,
                  MobileRoutes.settingsThemes,
                  const NoMobileRouteArguments(),
                ),
            child: const Text('Back to themes'),
          ),
        ],
      ),
    );
  }
}

class _ThemeSavedNotice extends StatelessWidget {
  const _ThemeSavedNotice();

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    const statusMessage =
        'Theme selected. This preference will apply when you return to the app.';
    return Semantics(
      container: true,
      liveRegion: true,
      label: statusMessage,
      child: ExcludeSemantics(
        child: Container(
          decoration: BoxDecoration(
            color: tokens.paper,
            border: Border.all(color: tokens.line),
            borderRadius: BorderRadius.circular(Radii.dialog),
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(Radii.dialog),
            child: IntrinsicHeight(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const SizedBox(
                    width: 3,
                    child: ColoredBox(color: Color(0xFF5B9374)),
                  ),
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: Grid.xs,
                        vertical: Grid.scrollInset,
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Theme selected',
                            style: context.mobileTypography.conversation
                                .copyWith(
                                  color: tokens.ink,
                                  fontWeight: FontWeight.w700,
                                ),
                          ),
                          Text(
                            'This preference will apply when you return to the app.',
                            style: context.mobileTypography.metadata.copyWith(
                              color: tokens.muted,
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
        ),
      ),
    );
  }
}
