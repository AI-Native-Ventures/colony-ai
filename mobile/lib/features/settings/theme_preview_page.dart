part of 'appearance_settings_pages.dart';

class ThemePreviewPage extends StatelessWidget {
  const ThemePreviewPage({required this.themeName, super.key});

  final String themeName;

  @override
  Widget build(BuildContext context) => Consumer(
    builder: (context, ref, _) {
      final theme = findTheme(themeName) ?? findTheme('buzz')!;
      final current = ref.watch(communityThemeProvider);
      final display = ref.watch(appearanceDisplayPreferenceProvider);

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

      return Scaffold(
        backgroundColor: context.mobileTokens.paper,
        appBar: const MobileFlowAppBar(title: 'Preview theme'),
        body: Column(
          children: [
            Expanded(
              child: ListView(
                padding: const EdgeInsets.all(Grid.gutter),
                children: [
                  Text(
                    _themeDisplayName(theme),
                    style: context.textTheme.headlineSmall?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  Text(theme.isDark ? 'Dark theme' : 'Light theme'),
                  const SizedBox(height: Grid.sm),
                  _ConversationPreview(theme: theme),
                  const SizedBox(height: Grid.sm),
                  Text(
                    'Preview only. Your current theme stays ${_themeDisplayName(findTheme(current.theme) ?? findTheme('buzz')!)} until you apply.',
                    style: context.textTheme.bodySmall?.copyWith(
                      color: context.mobileTokens.muted,
                    ),
                  ),
                  const SizedBox(height: Grid.sm),
                  Text(
                    'Density ${display.density.label} · Text ${display.textSize.label}',
                    style: context.textTheme.bodySmall,
                  ),
                ],
              ),
            ),
            SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(
                  Grid.sm,
                  Grid.xs,
                  Grid.sm,
                  Grid.xs,
                ),
                child: SizedBox(
                  width: double.infinity,
                  height: 44,
                  child: FilledButton(
                    style: mobileFlowActionButtonStyle(context),
                    onPressed: apply,
                    child: Text('Use ${_themeDisplayName(theme)}'),
                  ),
                ),
              ),
            ),
          ],
        ),
      );
    },
  );
}
