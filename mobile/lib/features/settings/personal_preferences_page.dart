part of 'appearance_settings_pages.dart';

class PersonalPreferencesPage extends HookConsumerWidget {
  const PersonalPreferencesPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final saved = ref.watch(appearanceDisplayPreferenceProvider);
    final reduceMotion = useState(saved.reduceMotion);
    final largerTapTargets = useState(saved.largerTapTargets);
    final applying = useState(false);

    Future<void> apply() async {
      if (applying.value) return;
      applying.value = true;
      try {
        await ref
            .read(appearanceDisplayPreferenceProvider.notifier)
            .setPreference(
              AppearanceDisplayPreference(
                density: saved.density,
                textSize: saved.textSize,
                reduceMotion: reduceMotion.value,
                largerTapTargets: largerTapTargets.value,
              ),
            );
        if (context.mounted) Navigator.of(context).maybePop();
      } finally {
        applying.value = false;
      }
    }

    return Scaffold(
      backgroundColor: context.mobileTokens.paper,
      appBar: const MobileFlowAppBar(title: 'Preferences'),
      body: Column(
        children: [
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(
                Grid.gutter,
                Grid.twelve,
                Grid.gutter,
                Grid.gutter,
              ),
              children: [
                _SettingsLinkRow(
                  title: 'Notifications',
                  subtitle: 'Push notifications for this community',
                  onPressed: () =>
                      MobileNavigation.push<NoMobileRouteArguments, Object?>(
                        context,
                        MobileRoutes.settingsNotifications,
                        const NoMobileRouteArguments(),
                      ),
                ),
                _SettingsLinkRow(
                  title: 'Preview privacy',
                  subtitle: 'Hide content when locked',
                  onPressed: () =>
                      MobileNavigation.push<NoMobileRouteArguments, Object?>(
                        context,
                        MobileRoutes.settingsPrivacy,
                        const NoMobileRouteArguments(),
                      ),
                ),
                _PreferenceCheckbox(
                  title: 'Reduce motion',
                  subtitle: 'Limit transitions on this phone.',
                  value: reduceMotion.value,
                  onChanged: (value) => reduceMotion.value = value,
                ),
                _PreferenceCheckbox(
                  title: 'Larger tap targets',
                  subtitle: 'Increase row and control height.',
                  value: largerTapTargets.value,
                  onChanged: (value) => largerTapTargets.value = value,
                ),
                _SettingsLinkRow(
                  title: 'Microphone permission',
                  subtitle: 'Manage voice access',
                  onPressed: () => unawaited(
                    ref
                        .read(huddleSessionProvider.notifier)
                        .openMicrophoneSettings(),
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
                  onPressed: applying.value ? null : apply,
                  child: const Text('Apply preferences'),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
