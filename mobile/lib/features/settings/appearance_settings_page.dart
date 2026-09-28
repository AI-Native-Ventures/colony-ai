part of 'appearance_settings_pages.dart';

class AppearanceSettingsPage extends HookConsumerWidget {
  const AppearanceSettingsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final savedTheme = ref.watch(communityThemeProvider);
    final savedDisplay = ref.watch(appearanceDisplayPreferenceProvider);
    final mode = useState(savedTheme.mode);
    final themeName = useState(savedTheme.theme);
    final density = useState(savedDisplay.density);
    final textSize = useState(savedDisplay.textSize);

    Future<void> apply() async {
      final compatibleTheme =
          schemeForAppearanceMode(themeName.value, mode.value) ??
          themeName.value;
      await ref
          .read(appearanceDisplayPreferenceProvider.notifier)
          .setPreference(
            AppearanceDisplayPreference(
              density: density.value,
              textSize: textSize.value,
              reduceMotion: savedDisplay.reduceMotion,
              largerTapTargets: savedDisplay.largerTapTargets,
            ),
          );
      ref
          .read(communityThemeProvider.notifier)
          .setPreference(
            CommunityThemePreference(
              theme: compatibleTheme,
              accent: savedTheme.accent,
              followSystem: mode.value == ThemeMode.system,
            ),
          );
      if (context.mounted) Navigator.of(context).maybePop();
    }

    final previewTheme = findTheme(themeName.value) ?? findTheme('buzz')!;
    return Scaffold(
      backgroundColor: context.mobileTokens.paper,
      appBar: const MobileFlowAppBar(title: 'Appearance'),
      body: Column(
        children: [
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(
                Grid.gutter,
                Grid.twelve,
                Grid.gutter,
                Grid.md,
              ),
              children: [
                _AppearancePreview(
                  theme: previewTheme,
                  density: density.value,
                  dark:
                      mode.value == ThemeMode.dark ||
                      (mode.value == ThemeMode.system &&
                          MediaQuery.platformBrightnessOf(context) ==
                              Brightness.dark),
                ),
                const SizedBox(height: 26),
                _AppearanceSelect<ThemeMode>(
                  label: 'Mode',
                  value: mode.value,
                  labels: const {
                    ThemeMode.system: 'System',
                    ThemeMode.light: 'Light',
                    ThemeMode.dark: 'Dark',
                  },
                  onChanged: (value) => mode.value = value,
                ),
                const SizedBox(height: Grid.xs),
                _AppearanceSelect<String>(
                  label: 'Theme',
                  value: themeName.value,
                  labels: {
                    for (final theme in themeCatalog)
                      theme.name: _themeDisplayName(theme),
                  },
                  onChanged: (value) => themeName.value = value,
                ),
                const SizedBox(height: Grid.xs),
                _AppearanceSelect<AppearanceDensity>(
                  label: 'Density',
                  value: density.value,
                  labels: {
                    for (final value in AppearanceDensity.values)
                      value: value.label,
                  },
                  onChanged: (value) => density.value = value,
                ),
                const SizedBox(height: Grid.xs),
                _AppearanceSelect<AppearanceTextSize>(
                  label: 'Text size',
                  value: textSize.value,
                  labels: {
                    for (final value in AppearanceTextSize.values)
                      value: value.label,
                  },
                  onChanged: (value) => textSize.value = value,
                ),
                const SizedBox(height: Grid.xs),
                Text(
                  'Preview updates as you choose. Apply saves the complete preference set.',
                  style: context.mobileTypography.conversation.copyWith(
                    fontSize: 13,
                    height: 1.6,
                    color: context.mobileTokens.muted,
                  ),
                ),
                const SizedBox(height: Grid.twelve),
                _SettingsLinkRow(
                  title: 'Browse named themes',
                  subtitle: '62 themes · Preview before applying',
                  onPressed: () =>
                      MobileNavigation.push<NoMobileRouteArguments, Object?>(
                        context,
                        MobileRoutes.settingsThemes,
                        const NoMobileRouteArguments(),
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
                  onPressed: apply,
                  child: const Text('Apply appearance'),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
