import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../shared/navigation/mobile_navigation.dart';
import '../../shared/navigation/mobile_route.dart';
import '../../shared/navigation/mobile_routes.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/mobile_flow_app_bar.dart';

const _feedbackDraftKey = 'buzz-settings-feedback-preview.v1';
const _feedbackTopics = <String>[
  'Design feedback',
  'Something is broken',
  'Feature idea',
];

/// Keeps feedback on this phone and opens the designed preview result.
class SettingsFeedbackPage extends HookConsumerWidget {
  const SettingsFeedbackPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final savedPrefs = ref.watch(savedPrefsProvider);
    final initialDraft = _readFeedbackDraft(
      savedPrefs.getString(_feedbackDraftKey),
    );
    final topic = useState(
      initialDraft?['topic'] as String? ?? _feedbackTopics.first,
    );
    final controller = useTextEditingController(
      text: initialDraft?['body'] as String? ?? '',
    );
    final includeDiagnostics = useState(
      initialDraft?['includeDiagnostics'] as bool? ?? false,
    );
    final saving = useState(false);

    Future<void> openPreview() async {
      if (saving.value) return;
      saving.value = true;
      try {
        final stored = await savedPrefs.setString(
          _feedbackDraftKey,
          jsonEncode({
            'topic': topic.value,
            'body': controller.text,
            'includeDiagnostics': includeDiagnostics.value,
          }),
        );
        if (!stored) {
          throw StateError('The feedback preview could not be kept.');
        }
        if (context.mounted) {
          await MobileNavigation.push<NoMobileRouteArguments, Object?>(
            context,
            MobileRoutes.settingsFeedbackSent,
            const NoMobileRouteArguments(),
          );
        }
      } catch (_) {
        if (!context.mounted) return;
        await MobileNavigation.push<NoMobileRouteArguments, Object?>(
          context,
          MobileRoutes.settingsFeedbackFailed,
          const NoMobileRouteArguments(),
        );
      } finally {
        saving.value = false;
      }
    }

    final colors = context.colors;
    return Scaffold(
      backgroundColor: colors.surface,
      appBar: const MobileFlowAppBar(title: 'Send feedback'),
      body: Column(
        children: [
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(
                Grid.gutter,
                Grid.twentyEight,
                Grid.gutter,
                Grid.gutter,
              ),
              children: [
                Text(
                  'Topic',
                  style: bodyExtraSmallTextStyle.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: Grid.xxs),
                DropdownButtonFormField<String>(
                  initialValue: topic.value,
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
                    color: context.colors.onSurface,
                    fontSize: 13,
                  ),
                  items: _feedbackTopics
                      .map(
                        (value) =>
                            DropdownMenuItem(value: value, child: Text(value)),
                      )
                      .toList(),
                  onChanged: (value) {
                    if (value != null) topic.value = value;
                  },
                ),
                const SizedBox(height: Grid.xs),
                Text(
                  'Feedback',
                  style: bodyExtraSmallTextStyle.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: Grid.xxs),
                TextField(
                  controller: controller,
                  minLines: 6,
                  maxLines: 6,
                  textCapitalization: TextCapitalization.sentences,
                  decoration: const InputDecoration(
                    border: OutlineInputBorder(),
                    contentPadding: EdgeInsets.symmetric(
                      horizontal: Grid.twelve,
                      vertical: 15,
                    ),
                  ),
                ),
                const SizedBox(height: 20),
                Container(
                  constraints: const BoxConstraints(minHeight: 70),
                  decoration: BoxDecoration(
                    border: Border(
                      bottom: BorderSide(color: colors.outlineVariant),
                    ),
                  ),
                  child: CheckboxListTile(
                    contentPadding: EdgeInsets.zero,
                    dense: true,
                    visualDensity: VisualDensity.compact,
                    controlAffinity: ListTileControlAffinity.trailing,
                    activeColor: const Color(0xFF55719F),
                    value: includeDiagnostics.value,
                    onChanged: (value) {
                      if (value != null) includeDiagnostics.value = value;
                    },
                    title: Text(
                      'Include diagnostics',
                      style: context.mobileTypography.body.copyWith(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    subtitle: Text(
                      'Version and redacted errors, without messages or credentials.',
                      style: bodyExtraSmallTextStyle.copyWith(
                        color: colors.onSurfaceVariant,
                      ),
                    ),
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
                border: Border(top: BorderSide(color: colors.outlineVariant)),
              ),
              child: SizedBox(
                width: double.infinity,
                height: 44,
                child: FilledButton(
                  style: mobileFlowActionButtonStyle(context),
                  onPressed: saving.value ? null : openPreview,
                  child: const Text('Send feedback preview'),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

Map<String, Object?>? _readFeedbackDraft(String? value) {
  if (value == null) return null;
  try {
    final decoded = jsonDecode(value);
    if (decoded is! Map<String, dynamic> ||
        decoded['topic'] is! String ||
        decoded['body'] is! String ||
        decoded['includeDiagnostics'] is! bool) {
      return null;
    }
    return decoded;
  } on FormatException {
    return null;
  }
}
