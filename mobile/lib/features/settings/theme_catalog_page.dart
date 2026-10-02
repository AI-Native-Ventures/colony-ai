part of 'appearance_settings_pages.dart';

class ThemeCatalogPage extends HookConsumerWidget {
  const ThemeCatalogPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final preference = ref.watch(communityThemeProvider);
    final community = ref.watch(activeCommunityProvider).asData?.value;
    final orderedThemes = [...themeCatalog]
      ..sort((left, right) {
        final leftRank = switch (left.name) {
          'buzz' => 0,
          'buzz-dark' => 1,
          _ => 2,
        };
        final rightRank = switch (right.name) {
          'buzz' => 0,
          'buzz-dark' => 1,
          _ => 2,
        };
        if (leftRank != rightRank) return leftRank.compareTo(rightRank);
        return _themeDisplayName(left).compareTo(_themeDisplayName(right));
      });

    return Scaffold(
      backgroundColor: context.mobileTokens.canvas,
      appBar: MobileFlowAppBar(
        title: 'Named themes',
        subtitle: community?.name,
        compact: true,
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(
          Grid.gutter,
          Grid.xs,
          Grid.gutter,
          Grid.gutter,
        ),
        children: [
          _ThemePreviewHero(
            eyebrow: 'APPEARANCE',
            title: 'Find your atmosphere.',
            description: 'Preview with sample content before applying.',
          ),
          const SizedBox(height: Grid.xs),
          GridView.builder(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            itemCount: orderedThemes.length,
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 2,
              crossAxisSpacing: Grid.twelve,
              mainAxisSpacing: Grid.twelve,
              mainAxisExtent: 144,
            ),
            itemBuilder: (context, index) {
              final theme = orderedThemes[index];
              return _ThemeTile(
                theme: theme,
                selected: theme.name == preference.theme,
                onPressed: () => MobileNavigation.push<String, Object?>(
                  context,
                  MobileRoutes.settingsThemePreview,
                  theme.name,
                ),
              );
            },
          ),
        ],
      ),
    );
  }
}
