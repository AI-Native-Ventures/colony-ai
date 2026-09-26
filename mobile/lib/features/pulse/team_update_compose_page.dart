import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../shared/community/community_provider.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/buzz_loading_indicator.dart';
import 'team_update_drafts_provider.dart';

enum TeamUpdateComposeMode { compose, draft, failed }

const _titleHint = 'A good week ahead';
const _bodyHint =
    'Olive Studio is ready for review. Next, we’ll shape the Cedar launch brief and finish our client reports.';

class TeamUpdateComposePage extends HookConsumerWidget {
  const TeamUpdateComposePage({
    required this.onPublish,
    this.mode = TeamUpdateComposeMode.compose,
    super.key,
  });

  final Future<void> Function(String content) onPublish;
  final TeamUpdateComposeMode mode;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final draft = ref.watch(teamUpdateDraftProvider);
    final activeDraft = draft?.status == TeamUpdateDraftStatus.published
        ? null
        : draft;
    final community = ref.watch(activeCommunityProvider).value;
    final titleController = useTextEditingController(
      text: activeDraft?.title ?? '',
    );
    final bodyController = useTextEditingController(
      text: activeDraft?.body ?? '',
    );
    final currentMode = useState(mode);
    final isWorking = useState(false);
    final hasTitle = useListenableSelector(
      titleController,
      () => titleController.text.trim().isNotEmpty,
    );
    final hasBody = useListenableSelector(
      bodyController,
      () => bodyController.text.trim().isNotEmpty,
    );
    final hasContent = hasTitle || hasBody;

    useEffect(() {
      if (activeDraft == null) {
        return null;
      }
      if (titleController.text.isEmpty) {
        titleController.text = activeDraft.title;
      }
      if (bodyController.text.isEmpty) {
        bodyController.text = activeDraft.body;
      }
      return null;
    }, [activeDraft?.updatedAt]);

    useEffect(() {
      Timer? timer;
      void scheduleSave() {
        timer?.cancel();
        timer = Timer(const Duration(milliseconds: 450), () async {
          final title = titleController.text;
          final body = bodyController.text;
          if (title.trim().isEmpty && body.trim().isEmpty) return;
          try {
            await ref
                .read(teamUpdateDraftProvider.notifier)
                .save(title: title, body: body);
          } catch (error, stackTrace) {
            Error.throwWithStackTrace(error, stackTrace);
          }
        });
      }

      titleController.addListener(scheduleSave);
      bodyController.addListener(scheduleSave);
      return () {
        timer?.cancel();
        titleController.removeListener(scheduleSave);
        bodyController.removeListener(scheduleSave);
      };
    }, [titleController, bodyController]);

    Future<void> saveDraft() async {
      if (isWorking.value) return;
      isWorking.value = true;
      try {
        await ref
            .read(teamUpdateDraftProvider.notifier)
            .save(title: titleController.text, body: bodyController.text);
        if (context.mounted) Navigator.of(context).pop(false);
      } catch (error, stackTrace) {
        isWorking.value = false;
        Error.throwWithStackTrace(error, stackTrace);
      }
    }

    Future<void> publish() async {
      if (!hasContent || isWorking.value) return;
      isWorking.value = true;
      final title = titleController.text.trim();
      final body = bodyController.text.trim();
      final content = [
        title,
        body,
      ].where((part) => part.isNotEmpty).join('\n\n');
      try {
        await ref
            .read(teamUpdateDraftProvider.notifier)
            .save(title: title, body: body);
      } catch (error, stackTrace) {
        if (context.mounted) isWorking.value = false;
        Error.throwWithStackTrace(error, stackTrace);
      }
      try {
        await onPublish(content);
      } catch (_) {
        try {
          await ref
              .read(teamUpdateDraftProvider.notifier)
              .markFailed(title: title, body: body);
        } catch (error, stackTrace) {
          if (context.mounted) {
            isWorking.value = false;
            currentMode.value = TeamUpdateComposeMode.failed;
          }
          Error.throwWithStackTrace(error, stackTrace);
        }
        if (context.mounted) {
          isWorking.value = false;
          currentMode.value = TeamUpdateComposeMode.failed;
        }
        return;
      }
      try {
        await ref
            .read(teamUpdateDraftProvider.notifier)
            .markPublished(title: title, body: body);
        await ref.read(teamUpdateDraftProvider.notifier).clear();
      } catch (error, stackTrace) {
        if (context.mounted) Navigator.of(context).pop(true);
        Error.throwWithStackTrace(error, stackTrace);
      }
      if (context.mounted) Navigator.of(context).pop(true);
    }

    final tokens = context.mobileTokens;
    final communityName = community?.name.trim();
    final audience = communityName?.isNotEmpty == true
        ? '$communityName · All members'
        : 'All members';

    return Scaffold(
      resizeToAvoidBottomInset: true,
      backgroundColor: tokens.paper,
      body: SafeArea(
        child: Column(
          children: [
            _ComposeHeader(onBack: () => Navigator.of(context).maybePop()),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(
                  Grid.gutter,
                  Grid.scrollInset,
                  Grid.gutter,
                  Grid.xs,
                ),
                children: [
                  if (currentMode.value == TeamUpdateComposeMode.draft &&
                      activeDraft != null)
                    const _ComposeNotice(
                      title: 'Your draft is here',
                      body: 'Only you can see it until you publish.',
                      tone: _NoticeTone.info,
                    ),
                  if (currentMode.value == TeamUpdateComposeMode.failed &&
                      activeDraft != null)
                    const _ComposeNotice(
                      title: 'Update wasn’t published',
                      body: 'Your draft is safe. Retry when you’re connected.',
                      tone: _NoticeTone.error,
                    ),
                  Text(
                    'SHARE WITH YOUR TEAM',
                    style: context.textTheme.labelSmall?.copyWith(
                      color: tokens.muted,
                      fontSize: 8,
                      letterSpacing: 1.15,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: Grid.lg - 15),
                  _FieldLabel(label: 'Title'),
                  const SizedBox(height: 10),
                  TextField(
                    controller: titleController,
                    textInputAction: TextInputAction.next,
                    style: context.textTheme.bodyMedium?.copyWith(fontSize: 13),
                    decoration: _fieldDecoration(context).copyWith(
                      hintText: _titleHint,
                      hintStyle: context.textTheme.bodyMedium?.copyWith(
                        color: tokens.muted,
                        fontSize: 13,
                      ),
                    ),
                  ),
                  const SizedBox(height: 19),
                  _FieldLabel(label: 'Update'),
                  const SizedBox(height: 9),
                  TextField(
                    controller: bodyController,
                    minLines: 5,
                    maxLines: 5,
                    keyboardType: TextInputType.multiline,
                    textInputAction: TextInputAction.newline,
                    style: context.textTheme.bodyMedium?.copyWith(
                      fontSize: 13,
                      height: 1.5,
                    ),
                    decoration: _fieldDecoration(context).copyWith(
                      hintText: _bodyHint,
                      hintStyle: context.textTheme.bodyMedium?.copyWith(
                        color: tokens.muted,
                        fontSize: 13,
                        height: 1.5,
                      ),
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: Grid.xs,
                        vertical: 13,
                      ),
                      constraints: const BoxConstraints(minHeight: 125),
                    ),
                  ),
                  const SizedBox(height: 15),
                  _FieldLabel(label: 'Audience'),
                  const SizedBox(height: 13),
                  DropdownButtonFormField<String>(
                    initialValue: audience,
                    isExpanded: true,
                    items: [
                      DropdownMenuItem(value: audience, child: Text(audience)),
                    ],
                    onChanged: null,
                    style: context.textTheme.bodyMedium?.copyWith(
                      color: tokens.ink,
                      fontSize: 12,
                    ),
                    decoration: _fieldDecoration(context).copyWith(
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: Grid.xs,
                        vertical: 12,
                      ),
                      constraints: const BoxConstraints(minHeight: 46),
                    ),
                    icon: Icon(
                      LucideIcons.chevronDown,
                      size: 16,
                      color: tokens.muted,
                    ),
                  ),
                ],
              ),
            ),
            _ComposeFooter(
              isWorking: isWorking.value,
              canPublish: hasContent,
              onPublish: publish,
              onSaveDraft: saveDraft,
            ),
          ],
        ),
      ),
    );
  }
}

class _ComposeHeader extends StatelessWidget {
  const _ComposeHeader({required this.onBack});

  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Container(
      height: 66,
      padding: const EdgeInsets.symmetric(horizontal: Grid.xs),
      alignment: Alignment.centerLeft,
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: tokens.line)),
      ),
      child: Row(
        children: [
          IconButton(
            onPressed: onBack,
            tooltip: 'Back',
            icon: const Icon(LucideIcons.arrowLeft, size: 19),
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints.tightFor(width: 44, height: 44),
          ),
          const SizedBox(width: Grid.xxs),
          Text(
            'Write an update',
            style: context.textTheme.titleMedium?.copyWith(
              color: tokens.ink,
              fontSize: 16,
              fontWeight: FontWeight.w700,
              letterSpacing: -0.25,
            ),
          ),
        ],
      ),
    );
  }
}

enum _NoticeTone { info, error }

class _ComposeNotice extends StatelessWidget {
  const _ComposeNotice({
    required this.title,
    required this.body,
    required this.tone,
  });

  final String title;
  final String body;
  final _NoticeTone tone;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    final background = tone == _NoticeTone.info ? tokens.info : tokens.error;
    final dark = Theme.of(context).brightness == Brightness.dark;
    final foreground = switch ((tone, dark)) {
      (_NoticeTone.info, false) => const Color(0xff53718b),
      (_NoticeTone.info, true) => const Color(0xffc5d4e3),
      (_NoticeTone.error, false) => const Color(0xff9b586b),
      (_NoticeTone.error, true) => const Color(0xffe5b6c5),
    };
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 17),
      padding: const EdgeInsets.fromLTRB(14, 14, 14, 18),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(Radii.md),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: context.textTheme.labelLarge?.copyWith(
              color: foreground,
              fontSize: 12,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: Grid.half),
          Text(
            body,
            style: context.textTheme.bodySmall?.copyWith(
              color: foreground,
              fontSize: 11,
              height: 1.6,
            ),
          ),
        ],
      ),
    );
  }
}

class _FieldLabel extends StatelessWidget {
  const _FieldLabel({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) => Text(
    label,
    style: context.textTheme.labelMedium?.copyWith(
      color: context.mobileTokens.ink,
      fontSize: 10,
      fontWeight: FontWeight.w600,
    ),
  );
}

class _ComposeFooter extends StatelessWidget {
  const _ComposeFooter({
    required this.isWorking,
    required this.canPublish,
    required this.onPublish,
    required this.onSaveDraft,
  });

  final bool isWorking;
  final bool canPublish;
  final VoidCallback onPublish;
  final VoidCallback onSaveDraft;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 20, 16, 10),
      decoration: BoxDecoration(
        color: tokens.paper,
        border: Border(top: BorderSide(color: tokens.line)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(
            width: double.infinity,
            height: 44,
            child: FilledButton(
              onPressed: !isWorking && canPublish ? onPublish : null,
              style: FilledButton.styleFrom(
                backgroundColor: const Color(0xff45669f),
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10),
                ),
                textStyle: const TextStyle(
                  fontFamily: 'Manrope',
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                ),
              ),
              child: isWorking
                  ? const BuzzLoadingIndicator(
                      size: 16,
                      semanticLabel: 'Publishing update',
                    )
                  : const Text('Publish update'),
            ),
          ),
          const SizedBox(height: 6),
          SizedBox(
            height: 44,
            child: TextButton(
              onPressed: isWorking ? null : onSaveDraft,
              style: TextButton.styleFrom(
                foregroundColor: const Color(0xff345c99),
                textStyle: const TextStyle(
                  fontFamily: 'Manrope',
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                ),
              ),
              child: const Text('Save draft'),
            ),
          ),
        ],
      ),
    );
  }
}

InputDecoration _fieldDecoration(BuildContext context) {
  final tokens = context.mobileTokens;
  final border = OutlineInputBorder(
    borderRadius: BorderRadius.circular(Radii.sm),
    borderSide: BorderSide(color: tokens.line),
  );
  return InputDecoration(
    isDense: true,
    contentPadding: const EdgeInsets.symmetric(
      horizontal: Grid.xs,
      vertical: Grid.xs,
    ),
    filled: true,
    fillColor: tokens.paper,
    enabledBorder: border,
    focusedBorder: border.copyWith(
      borderSide: BorderSide(color: tokens.action),
    ),
    border: border,
  );
}
