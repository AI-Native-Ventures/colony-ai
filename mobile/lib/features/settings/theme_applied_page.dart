part of 'appearance_settings_pages.dart';

class ThemeAppliedPage extends ConsumerWidget {
  const ThemeAppliedPage({required this.themeName, super.key});

  final String themeName;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = findTheme(themeName) ?? findTheme('buzz')!;
    final preference = ref.watch(appearanceDisplayPreferenceProvider);
    return Scaffold(
      backgroundColor: context.colors.surface,
      appBar: const MobileFlowAppBar(title: 'Appearance'),
      body: ListView(
        padding: const EdgeInsets.all(Grid.gutter),
        children: [
          Text(
            'Your theme is set.',
            style: context.textTheme.headlineSmall?.copyWith(
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: Grid.sm),
          _ConversationPreview(theme: theme),
          const SizedBox(height: Grid.sm),
          _PreferenceSummary(label: 'Scope', value: 'Only you'),
          _PreferenceSummary(label: 'Density', value: preference.density.label),
          _PreferenceSummary(
            label: 'Text size',
            value: preference.textSize.label,
          ),
          const SizedBox(height: Grid.sm),
          OutlinedButton(
            onPressed: () =>
                MobileNavigation.push<NoMobileRouteArguments, Object?>(
                  context,
                  MobileRoutes.settingsThemes,
                  const NoMobileRouteArguments(),
                ),
            child: const Text('Browse themes'),
          ),
          FilledButton(
            style: mobileFlowActionButtonStyle(context),
            onPressed: () => Navigator.of(context).popUntil(
              (route) =>
                  route.settings.name == MobileRoutes.settingsAppearance.path,
            ),
            child: const Text('Done'),
          ),
        ],
      ),
    );
  }
}

/// Saves app-local accessibility preferences without implying notification
/// controls that the current push API does not support.
