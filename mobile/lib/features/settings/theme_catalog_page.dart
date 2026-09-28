part of 'appearance_settings_pages.dart';

class ThemeCatalogPage extends HookConsumerWidget {
  const ThemeCatalogPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final preference = ref.watch(communityThemeProvider);
    final query = useState('');
    final filter = useState('All');
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
    final matches = orderedThemes.where((theme) {
      final brightnessMatches = switch (filter.value) {
        'Light' => !theme.isDark,
        'Dark' => theme.isDark,
        _ => true,
      };
      return brightnessMatches &&
          _themeDisplayName(
            theme,
          ).toLowerCase().contains(query.value.toLowerCase());
    }).toList();
    final colors = context.colors;

    return Scaffold(
      backgroundColor: context.mobileTokens.canvas,
      appBar: const MobileFlowAppBar(title: 'Themes'),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(
          Grid.gutter,
          Grid.scrollInset,
          Grid.gutter,
          Grid.gutter,
        ),
        children: [
          Text(
            'Find your atmosphere.',
            style: context.textTheme.headlineSmall?.copyWith(
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: Grid.xs),
          SizedBox(
            height: 44,
            child: TextField(
              onChanged: (value) => query.value = value,
              style: context.mobileTypography.conversation.copyWith(
                color: context.mobileTokens.ink,
                fontSize: 13,
              ),
              decoration: InputDecoration(
                hintText: 'Search 62 themes',
                hintStyle: context.mobileTypography.conversation.copyWith(
                  color: context.mobileTokens.muted,
                  fontSize: 13,
                ),
                filled: true,
                fillColor: colors.surface,
                contentPadding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 8,
                ),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(9),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(9),
                  borderSide: BorderSide(color: context.mobileTokens.line),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(9),
                  borderSide: BorderSide(color: colors.primary),
                ),
              ),
            ),
          ),
          const SizedBox(height: Grid.xs),
          Row(
            children: [
              for (final entry in const ['All', 'Light', 'Dark'].indexed)
                Expanded(
                  child: Padding(
                    padding: EdgeInsets.only(
                      right: entry.$1 == 2 ? 0 : Grid.xxs,
                    ),
                    child: _ThemeFilter(
                      label: entry.$2,
                      selected: filter.value == entry.$2,
                      onPressed: () => filter.value = entry.$2,
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: Grid.xs + Grid.half),
          if (matches.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: Grid.lg),
              child: Column(
                children: [
                  Text('No themes found', style: context.textTheme.titleMedium),
                  const SizedBox(height: Grid.xxs),
                  Text(
                    'Try another name or clear your filters.',
                    style: context.textTheme.bodySmall,
                  ),
                ],
              ),
            )
          else
            GridView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: matches.length,
              gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: 2,
                crossAxisSpacing: 12,
                mainAxisSpacing: 18,
                mainAxisExtent: 126,
              ),
              itemBuilder: (context, index) {
                final theme = matches[index];
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

class _ThemeFilter extends StatelessWidget {
  const _ThemeFilter({
    required this.label,
    required this.selected,
    required this.onPressed,
  });

  final String label;
  final bool selected;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final foreground = selected
        ? const Color(0xFF4D3A5E)
        : context.mobileTokens.ink;
    return Semantics(
      button: true,
      selected: selected,
      label: label,
      onTap: onPressed,
      child: ExcludeSemantics(
        child: Material(
          color: selected ? const Color(0xFFE6DBED) : Colors.transparent,
          borderRadius: BorderRadius.circular(24),
          child: InkWell(
            borderRadius: BorderRadius.circular(24),
            onTap: onPressed,
            child: SizedBox(
              height: 38,
              child: Center(
                child: Text(
                  label,
                  style: TextStyle(
                    color: foreground,
                    fontSize: 12,
                    fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
