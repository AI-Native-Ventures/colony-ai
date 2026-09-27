import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../shared/community/community_provider.dart';
import '../../shared/emoji/emoji_glyph.dart';
import '../../shared/navigation/mobile_navigation.dart';
import '../../shared/navigation/mobile_route.dart';
import '../../shared/navigation/mobile_routes.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/mobile_flow_app_bar.dart';
import 'user_status.dart';
import 'user_status_provider.dart';

const _statusPresets = <(String, String)>[
  ('📅', 'In a meeting'),
  ('🚌', 'Commuting'),
  ('🍵', 'Out sick'),
  ('🏖️', 'Vacationing'),
  ('🏠', 'Working remotely'),
];

const _statusDurations = <String, Duration>{
  '1 hour': Duration(hours: 1),
  '8 hours': Duration(hours: 8),
  '1 day': Duration(days: 1),
  '1 week': Duration(days: 7),
};
const _statusDurationOptions = <String>[
  '1 hour',
  '8 hours',
  '1 day',
  '1 week',
  'Custom',
];

/// Edits the current identity's real NIP-38 status.
class ProfileStatusPage extends HookConsumerWidget {
  const ProfileStatusPage({this.emojiBuilder, super.key});

  @visibleForTesting
  final EmojiGlyphBuilder? emojiBuilder;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final statusAsync = ref.watch(userStatusProvider);
    final community = ref.watch(activeCommunityProvider).asData?.value;
    final status = statusAsync.asData?.value;
    final savedPrefs = ref.watch(savedPrefsProvider);
    final draft = _readStatusDraft(savedPrefs.getString(_statusDraftKey));
    final initialText = draft?.text ?? status?.text ?? '';
    final textController = useTextEditingController(text: initialText);
    final text = useState(textController.text);
    final emoji = useState(draft?.emoji ?? status?.emoji ?? '');
    final duration = useState(draft?.duration ?? _initialDuration(status));
    final customExpiry = useState(
      draft?.customExpiry ??
          status?.expirationDateTime ??
          DateTime.now().add(const Duration(days: 1)),
    );
    final expiryController = useTextEditingController(
      text: _formatDateTimeInput(customExpiry.value),
    );
    final dirty = useState(draft != null);
    final saving = useState(false);

    useEffect(() {
      expiryController.text = _formatDateTimeInput(customExpiry.value);
      return null;
    }, [customExpiry.value]);

    useEffect(() {
      void onTextChanged() {
        text.value = textController.text;
        dirty.value = true;
      }

      textController.addListener(onTextChanged);
      return () => textController.removeListener(onTextChanged);
    }, [textController]);

    useEffect(() {
      if (!dirty.value && statusAsync.hasValue) {
        final current = statusAsync.value;
        textController.text = current?.text ?? '';
        emoji.value = current?.emoji ?? '';
        duration.value = _initialDuration(current);
        text.value = current?.text ?? '';
      }
      return null;
    }, [statusAsync]);

    Future<void> chooseEmoji() async {
      final result = await MobileNavigation.push<String, String>(
        context,
        MobileRoutes.profileStatusEmoji,
        emoji.value,
      );
      if (result != null) {
        emoji.value = result;
        dirty.value = true;
      }
    }

    Future<void> chooseCustomExpiry() async {
      final selectedDate = await showDatePicker(
        context: context,
        initialDate: customExpiry.value,
        firstDate: DateTime.now(),
        lastDate: DateTime.now().add(const Duration(days: 365)),
      );
      if (selectedDate == null || !context.mounted) return;
      final selectedTime = await showTimePicker(
        context: context,
        initialTime: TimeOfDay.fromDateTime(customExpiry.value),
      );
      if (selectedTime == null) return;
      final nextExpiry = DateTime(
        selectedDate.year,
        selectedDate.month,
        selectedDate.day,
        selectedTime.hour,
        selectedTime.minute,
      );
      if (!nextExpiry.isAfter(DateTime.now())) {
        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Choose a future expiry time.')),
          );
        }
        return;
      }
      customExpiry.value = nextExpiry;
      dirty.value = true;
    }

    Future<void> save({bool clear = false}) async {
      if (saving.value) return;
      saving.value = true;
      try {
        final draftJson = jsonEncode({
          'text': text.value,
          'emoji': emoji.value,
          'duration': duration.value,
          'customExpiry': customExpiry.value.toIso8601String(),
          'clear': clear,
        });
        if (!await savedPrefs.setString(_statusDraftKey, draftJson)) {
          throw StateError('The status edit could not be kept for retry.');
        }
        try {
          if (clear) {
            await ref.read(userStatusProvider.notifier).clearStatus();
          } else {
            final expiresAt = duration.value == 'Custom'
                ? customExpiry.value
                : DateTime.now().add(_statusDurations[duration.value]!);
            await ref
                .read(userStatusProvider.notifier)
                .setStatus(text.value, emoji.value, expiresAt: expiresAt);
          }
        } catch (_) {
          if (context.mounted) {
            await MobileNavigation.push<NoMobileRouteArguments, Object?>(
              context,
              MobileRoutes.settingsSaveFailed,
              const NoMobileRouteArguments(),
            );
          }
          return;
        }

        await savedPrefs.remove(_statusDraftKey);
        if (context.mounted) {
          unawaited(
            MobileNavigation.replace<NoMobileRouteArguments>(
              context,
              MobileRoutes.profileStatusSaved,
              const NoMobileRouteArguments(),
            ),
          );
        }
      } finally {
        saving.value = false;
      }
    }

    final hasStatus = status != null && !status.isEmpty;
    final hasContent = text.value.trim().isNotEmpty || emoji.value.isNotEmpty;

    return Scaffold(
      backgroundColor: context.mobileTokens.paper,
      appBar: const MobileFlowAppBar(title: 'Set a status'),
      body: Column(
        children: [
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(
                Grid.gutter,
                MobileLayoutTokens.scrollTopPadding,
                Grid.gutter,
                Grid.md,
              ),
              children: [
                Text(
                  'What’s your status?',
                  style: context.textTheme.headlineSmall?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: Grid.xs),
                Text(
                  'Let your team know when you’re available.',
                  style: context.textTheme.bodyMedium?.copyWith(
                    color: context.mobileTokens.muted,
                  ),
                ),
                const SizedBox(height: Grid.xs),
                _StatusInput(
                  controller: textController,
                  emoji: emoji.value,
                  emojiBuilder: emojiBuilder,
                  onChooseEmoji: chooseEmoji,
                ),
                const SizedBox(height: Grid.xs),
                Text(
                  'Visible to people in ${community?.name ?? 'your community'}.',
                  style: context.textTheme.bodySmall?.copyWith(
                    color: context.mobileTokens.muted,
                  ),
                ),
                const SizedBox(height: Grid.sm),
                Text(
                  'Quick statuses',
                  style: context.textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                ),
                SizedBox(
                  height: Grid.twelve,
                  child: Align(
                    alignment: Alignment.bottomCenter,
                    child: Container(
                      height: 1,
                      color: context.mobileTokens.line,
                    ),
                  ),
                ),
                for (final preset in _statusPresets)
                  _QuickStatusRow(
                    emoji: preset.$1,
                    label: preset.$2,
                    emojiBuilder: emojiBuilder,
                    onPressed: () {
                      textController.text = preset.$2;
                      text.value = preset.$2;
                      emoji.value = preset.$1;
                      dirty.value = true;
                    },
                  ),
                const SizedBox(height: Grid.sm),
                Text('Clear after', style: bodyExtraSmallTextStyle),
                const SizedBox(height: Grid.xxs),
                SizedBox(
                  height: 48,
                  child: DropdownButtonFormField<String>(
                    initialValue: duration.value,
                    decoration: const InputDecoration(
                      isDense: false,
                      constraints: BoxConstraints(minHeight: 48),
                      contentPadding: EdgeInsets.symmetric(
                        horizontal: Grid.xs,
                        vertical: Grid.twelve,
                      ),
                    ),
                    style: context.mobileTypography.conversation.copyWith(
                      color: context.mobileTokens.ink,
                    ),
                    items: _statusDurationOptions
                        .map(
                          (value) => DropdownMenuItem(
                            value: value,
                            child: Text(value),
                          ),
                        )
                        .toList(),
                    onChanged: saving.value
                        ? null
                        : (value) async {
                            if (value == null) return;
                            duration.value = value;
                            dirty.value = true;
                            if (value == 'Custom') await chooseCustomExpiry();
                          },
                  ),
                ),
                if (duration.value == 'Custom') ...[
                  const SizedBox(height: Grid.xs),
                  TextField(
                    readOnly: true,
                    onTap: saving.value ? null : chooseCustomExpiry,
                    decoration: InputDecoration(
                      labelText: 'Clear at',
                      suffixIcon: IconButton(
                        tooltip: 'Choose expiry time',
                        onPressed: saving.value ? null : chooseCustomExpiry,
                        icon: const Icon(LucideIcons.calendarClock),
                      ),
                    ),
                    controller: expiryController,
                  ),
                ],
                if (hasStatus) ...[
                  const SizedBox(height: Grid.sm),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: TextButton(
                      onPressed: saving.value ? null : () => save(clear: true),
                      child: const Text('Clear status'),
                    ),
                  ),
                ],
              ],
            ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(
                Grid.sm,
                Grid.sm,
                Grid.sm,
                Grid.xxs,
              ),
              child: SizedBox(
                width: double.infinity,
                height: 44,
                child: FilledButton(
                  style: mobileFlowActionButtonStyle(context),
                  onPressed: hasContent && !saving.value ? () => save() : null,
                  child: const Text('Save status'),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _StatusInput extends StatelessWidget {
  const _StatusInput({
    required this.controller,
    required this.emoji,
    required this.emojiBuilder,
    required this.onChooseEmoji,
  });

  final TextEditingController controller;
  final String emoji;
  final EmojiGlyphBuilder? emojiBuilder;
  final VoidCallback onChooseEmoji;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Container(
      height: 64,
      decoration: BoxDecoration(
        color: colors.surface,
        border: Border.all(color: context.mobileTokens.line),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        children: [
          Padding(
            padding: const EdgeInsets.only(left: Grid.xxs),
            child: Semantics(
              button: true,
              label: 'Choose status emoji',
              onTap: onChooseEmoji,
              child: ExcludeSemantics(
                child: Material(
                  color: context.mobileTokens.soft,
                  borderRadius: BorderRadius.circular(Radii.sm),
                  child: InkWell(
                    onTap: onChooseEmoji,
                    borderRadius: BorderRadius.circular(Radii.sm),
                    child: SizedBox(
                      width: 44,
                      height: 44,
                      child: Center(
                        child: emoji.isEmpty
                            ? const Icon(Icons.add, size: 20)
                            : EmojiGlyph(
                                emoji: emoji,
                                fontSize: 24,
                                builder: emojiBuilder,
                              ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(width: Grid.twelve),
          Expanded(
            child: TextField(
              controller: controller,
              maxLength: 100,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(
                counterText: '',
                border: InputBorder.none,
                enabledBorder: InputBorder.none,
                focusedBorder: InputBorder.none,
                disabledBorder: InputBorder.none,
                hintText: 'What are you up to?',
                isDense: true,
                contentPadding: EdgeInsets.zero,
              ),
            ),
          ),
          const SizedBox(width: Grid.sm),
        ],
      ),
    );
  }
}

class _QuickStatusRow extends StatelessWidget {
  const _QuickStatusRow({
    required this.emoji,
    required this.label,
    required this.emojiBuilder,
    required this.onPressed,
  });

  final String emoji;
  final String label;
  final EmojiGlyphBuilder? emojiBuilder;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 56,
      child: InkWell(
        onTap: onPressed,
        child: DecoratedBox(
          decoration: BoxDecoration(
            border: Border(
              bottom: BorderSide(color: context.mobileTokens.line),
            ),
          ),
          child: Row(
            children: [
              SizedBox(
                width: 48,
                child: Center(
                  child: EmojiGlyph(
                    emoji: emoji,
                    fontSize: 22,
                    builder: emojiBuilder,
                  ),
                ),
              ),
              const SizedBox(width: Grid.xs),
              Text(label, style: context.mobileTypography.conversation),
            ],
          ),
        ),
      ),
    );
  }
}

String _initialDuration(UserStatus? status) {
  final remaining = status?.expirationDateTime?.difference(DateTime.now());
  if (remaining == null) return '1 day';
  if (remaining.inHours <= 1) return '1 hour';
  if (remaining.inHours <= 8) return '8 hours';
  if (remaining.inDays <= 1) return '1 day';
  if (remaining.inDays <= 7) return '1 week';
  return 'Custom';
}

class _StatusDraft {
  const _StatusDraft({
    required this.text,
    required this.emoji,
    required this.duration,
    required this.customExpiry,
  });

  final String text;
  final String emoji;
  final String duration;
  final DateTime customExpiry;
}

_StatusDraft? _readStatusDraft(String? encoded) {
  if (encoded == null) return null;
  try {
    final value = jsonDecode(encoded);
    if (value is! Map<String, dynamic> ||
        value['text'] is! String ||
        value['emoji'] is! String ||
        value['duration'] is! String ||
        value['customExpiry'] is! String) {
      return null;
    }
    final parsedExpiry = DateTime.tryParse(value['customExpiry'] as String);
    if (parsedExpiry == null ||
        !_statusDurationOptions.contains(value['duration'])) {
      return null;
    }
    return _StatusDraft(
      text: value['text'] as String,
      emoji: value['emoji'] as String,
      duration: value['duration'] as String,
      customExpiry: parsedExpiry,
    );
  } on FormatException {
    return null;
  }
}

const _statusDraftKey = 'buzz-profile-status-draft.v1';

String _formatDateTimeInput(DateTime value) =>
    value.toIso8601String().substring(0, 16);
