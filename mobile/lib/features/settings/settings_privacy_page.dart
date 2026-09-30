import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../shared/community/community_provider.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/mobile_flow_app_bar.dart';

const _privacyPreviewKey = 'buzz-notification-privacy-preview.v1';
const _showMessagePreviewsValue = 'Show message previews';
const _hideMessagePreviewsValue = 'Always hide content';

/// Stores the on-device notification preview preference.
class SettingsPrivacyPage extends HookConsumerWidget {
  const SettingsPrivacyPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final prefs = ref.watch(savedPrefsProvider);
    final initialValue = prefs.getString(_privacyPreviewKey);
    final showPreviews = useState(initialValue == _showMessagePreviewsValue);
    final saved = useState(false);
    final saving = useState(false);
    final community = ref.watch(activeCommunityProvider).asData?.value;

    Future<void> save() async {
      if (saving.value) return;
      saving.value = true;
      try {
        final value = showPreviews.value
            ? _showMessagePreviewsValue
            : _hideMessagePreviewsValue;
        if (!await prefs.setString(_privacyPreviewKey, value)) {
          throw StateError('Notification preview preference was not saved.');
        }
        if (context.mounted) saved.value = true;
      } catch (_) {
        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Your selection is still here. Try saving again.'),
            ),
          );
        }
      } finally {
        if (context.mounted) saving.value = false;
      }
    }

    return Scaffold(
      backgroundColor: context.mobileTokens.canvas,
      appBar: MobileFlowAppBar(
        title: saved.value ? 'Preferences' : 'Privacy',
        subtitle: community?.name,
        compact: true,
      ),
      body: saved.value
          ? _PrivacySavedContent(
              showPreviews: showPreviews.value,
              onBack: () => saved.value = false,
            )
          : ListView(
              padding: const EdgeInsets.fromLTRB(
                Grid.gutter,
                Grid.xs,
                Grid.gutter,
                Grid.lg,
              ),
              children: [
                const _PrivacyHero(),
                const SizedBox(height: Grid.sm),
                CheckboxListTile(
                  contentPadding: EdgeInsets.zero,
                  controlAffinity: ListTileControlAffinity.trailing,
                  activeColor: context.mobileTokens.action,
                  value: showPreviews.value,
                  onChanged: (value) {
                    if (value != null) showPreviews.value = value;
                  },
                  title: Text(
                    'Show message previews',
                    style: context.mobileTypography.conversation.copyWith(
                      color: context.mobileTokens.ink,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  subtitle: Text(
                    'Include message text in notifications',
                    style: context.mobileTypography.metadata.copyWith(
                      color: context.mobileTokens.muted,
                    ),
                  ),
                ),
                const SizedBox(height: Grid.xs),
                const _PrivacyLockScreenNote(),
                const SizedBox(height: Grid.xs),
                SizedBox(
                  width: double.infinity,
                  height: 44,
                  child: FilledButton(
                    style: mobileFlowActionButtonStyle(context),
                    onPressed: saving.value ? null : save,
                    child: Text(saving.value ? 'Saving...' : 'Save preference'),
                  ),
                ),
              ],
            ),
    );
  }
}

class _PrivacyHero extends StatelessWidget {
  const _PrivacyHero();

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    final dark = Theme.of(context).brightness == Brightness.dark;
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
            'NOTIFICATIONS',
            style: context.mobileTypography.metadata.copyWith(
              color: tokens.ink,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.5,
            ),
          ),
          const SizedBox(height: Grid.xxs),
          Text(
            'Choose what shows.',
            style: context.mobileTypography.flowTitle.copyWith(
              color: tokens.ink,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: Grid.xxs),
          Text(
            'These settings apply on this phone.',
            style: context.mobileTypography.conversation.copyWith(
              color: tokens.ink,
            ),
          ),
        ],
      ),
    );
  }
}

class _PrivacyLockScreenNote extends StatelessWidget {
  const _PrivacyLockScreenNote();

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Container(
      padding: const EdgeInsets.all(Grid.xs),
      decoration: BoxDecoration(
        color: tokens.paper,
        border: Border.all(color: tokens.line),
        borderRadius: BorderRadius.circular(Radii.dialog),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 3,
            height: 52,
            decoration: BoxDecoration(
              color: tokens.action.withValues(alpha: 0.58),
              borderRadius: BorderRadius.circular(3),
            ),
          ),
          const SizedBox(width: Grid.xs),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Consider your lock screen',
                  style: context.mobileTypography.conversation.copyWith(
                    color: tokens.ink,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                Text(
                  'When off, you see that there is a new message without its contents.',
                  style: context.mobileTypography.metadata.copyWith(
                    color: tokens.muted,
                    height: 1.5,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _PrivacySavedContent extends StatelessWidget {
  const _PrivacySavedContent({
    required this.showPreviews,
    required this.onBack,
  });

  final bool showPreviews;
  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return ListView(
      padding: const EdgeInsets.fromLTRB(
        Grid.gutter,
        Grid.xs,
        Grid.gutter,
        Grid.gutter,
      ),
      children: [
        _PrivacySavedNotice(showPreviews: showPreviews),
        const SizedBox(height: Grid.xxs),
        FilledButton.tonal(
          style: FilledButton.styleFrom(
            minimumSize: const Size.fromHeight(44),
            backgroundColor: tokens.soft,
            foregroundColor: tokens.action,
          ),
          onPressed: onBack,
          child: const Text('Back to privacy'),
        ),
      ],
    );
  }
}

class _PrivacySavedNotice extends StatelessWidget {
  const _PrivacySavedNotice({required this.showPreviews});

  final bool showPreviews;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    final description = showPreviews
        ? 'Message previews are shown in notifications.'
        : 'Message contents are hidden in notifications.';
    return Semantics(
      container: true,
      liveRegion: true,
      label: 'Notification preference saved. $description',
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
                            'Notification preference saved',
                            style: context.mobileTypography.conversation
                                .copyWith(
                                  color: tokens.ink,
                                  fontWeight: FontWeight.w700,
                                ),
                          ),
                          Text(
                            description,
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
