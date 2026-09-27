import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../shared/theme/theme.dart';
import '../../shared/widgets/mobile_flow_app_bar.dart';

const _privacyPreviewKey = 'buzz-notification-privacy-preview.v1';
const _privacyChoices = <String>[
  'Hide content when locked',
  'Always hide content',
  'Show message previews',
];

/// Stores the on-device notification privacy preview preference.
class SettingsPrivacyPage extends HookConsumerWidget {
  const SettingsPrivacyPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final prefs = ref.watch(savedPrefsProvider);
    final initial = prefs.getString(_privacyPreviewKey);
    final selection = useState(
      _privacyChoices.contains(initial) ? initial! : _privacyChoices.first,
    );
    final saving = useState(false);

    Future<void> save() async {
      if (saving.value) return;
      saving.value = true;
      try {
        if (!await prefs.setString(_privacyPreviewKey, selection.value)) {
          throw StateError('Privacy preview could not be saved.');
        }
        if (context.mounted) Navigator.of(context).pop();
      } catch (_) {
        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('The preview preference could not be saved.'),
            ),
          );
        }
      } finally {
        if (context.mounted) saving.value = false;
      }
    }

    final preview = selection.value == 'Show message previews'
        ? 'Maya · Campaign studio: The designs are ready.'
        : 'Colony · You have a new notification.';

    return Scaffold(
      backgroundColor: context.mobileTokens.paper,
      appBar: const MobileFlowAppBar(title: 'Preview privacy'),
      body: Column(
        children: [
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(
                Grid.gutter,
                Grid.twentyEight,
                Grid.gutter,
                Grid.lg,
              ),
              children: [
                Text(
                  'Notification content',
                  style: context.textTheme.labelSmall,
                ),
                const SizedBox(height: Grid.xxs),
                DropdownButtonFormField<String>(
                  initialValue: selection.value,
                  isExpanded: true,
                  decoration: const InputDecoration(
                    border: OutlineInputBorder(),
                    constraints: BoxConstraints(minHeight: 48),
                    contentPadding: EdgeInsets.symmetric(
                      horizontal: Grid.twelve,
                      vertical: Grid.twelve,
                    ),
                  ),
                  style: context.mobileTypography.conversation.copyWith(
                    color: context.mobileTokens.ink,
                  ),
                  items: _privacyChoices
                      .map(
                        (choice) => DropdownMenuItem(
                          value: choice,
                          child: Text(choice),
                        ),
                      )
                      .toList(),
                  onChanged: (value) {
                    if (value != null) selection.value = value;
                  },
                ),
                const SizedBox(height: Grid.xs),
                Container(
                  padding: const EdgeInsets.all(Grid.xs),
                  decoration: BoxDecoration(
                    color: _privacyPreviewColor(context),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Lock-screen preview',
                        style: context.mobileTypography.conversation.copyWith(
                          fontSize: 12,
                          color: _privacyPreviewTextColor(context),
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: Grid.xxs),
                      Text(
                        preview,
                        style: context.mobileTypography.conversation.copyWith(
                          fontSize: 13,
                          height: 1.6,
                          color: _privacyPreviewTextColor(context),
                        ),
                      ),
                    ],
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
                  onPressed: saving.value ? null : save,
                  child: const Text('Save preview privacy'),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

Color _privacyPreviewColor(BuildContext context) =>
    Theme.of(context).brightness == Brightness.dark
    ? const Color(0xFF34404A)
    : const Color(0xFFEAF0F6);

Color _privacyPreviewTextColor(BuildContext context) =>
    Theme.of(context).brightness == Brightness.dark
    ? const Color(0xFFC5D4E3)
    : const Color(0xFF53718B);
