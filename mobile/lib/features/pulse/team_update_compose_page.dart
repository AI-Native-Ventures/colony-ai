import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../shared/community/community_provider.dart';
import '../../shared/navigation/mobile_navigation.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/buzz_loading_indicator.dart';
import 'team_update_drafts_provider.dart';

enum TeamUpdateComposeMode { compose, draft, failed }

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
    final currentMode = useState(
      (mode == TeamUpdateComposeMode.compose && activeDraft != null) ||
              (mode == TeamUpdateComposeMode.draft && activeDraft == null)
          ? activeDraft == null
                ? TeamUpdateComposeMode.compose
                : TeamUpdateComposeMode.draft
          : mode,
    );
    final isWorking = useState(false);
    final draftSaveFailed = useState(false);
    final discarding = useState(false);
    final saveGeneration = useRef(0);
    final debounceTimer = useRef<Timer?>(null);
    final titleFocus = useFocusNode();
    final bodyFocus = useFocusNode();
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
      void scheduleSave() {
        final generation = ++saveGeneration.value;
        debounceTimer.value?.cancel();
        debounceTimer.value = Timer(
          const Duration(milliseconds: 450),
          () async {
            final title = titleController.text;
            final body = bodyController.text;
            try {
              await ref
                  .read(teamUpdateDraftProvider.notifier)
                  .save(title: title, body: body);
              if (context.mounted && saveGeneration.value == generation) {
                draftSaveFailed.value = false;
              }
            } catch (_) {
              if (context.mounted && saveGeneration.value == generation) {
                draftSaveFailed.value = true;
              }
            }
          },
        );
      }

      titleController.addListener(scheduleSave);
      bodyController.addListener(scheduleSave);
      return () {
        debounceTimer.value?.cancel();
        titleController.removeListener(scheduleSave);
        bodyController.removeListener(scheduleSave);
      };
    }, [titleController, bodyController, context]);

    Future<void> retrySavingDraft() async {
      if (isWorking.value) return;
      isWorking.value = true;
      debounceTimer.value?.cancel();
      final generation = ++saveGeneration.value;
      try {
        await ref
            .read(teamUpdateDraftProvider.notifier)
            .save(title: titleController.text, body: bodyController.text);
        if (context.mounted && saveGeneration.value == generation) {
          draftSaveFailed.value = false;
          currentMode.value = TeamUpdateComposeMode.draft;
        }
      } catch (_) {
        if (context.mounted && saveGeneration.value == generation) {
          draftSaveFailed.value = true;
        }
      } finally {
        if (context.mounted) isWorking.value = false;
      }
    }

    Future<void> discardDraft() async {
      if (isWorking.value) return;
      isWorking.value = true;
      debounceTimer.value?.cancel();
      saveGeneration.value++;
      try {
        await ref.read(teamUpdateDraftProvider.notifier).clear();
        if (context.mounted) Navigator.of(context).pop(false);
      } catch (_) {
        if (context.mounted) {
          isWorking.value = false;
          draftSaveFailed.value = true;
          discarding.value = false;
        }
      }
    }

    void selectTextToCopy() {
      final controller = bodyController.text.isNotEmpty
          ? bodyController
          : titleController;
      final focusNode = bodyController.text.isNotEmpty ? bodyFocus : titleFocus;
      FocusScope.of(context).requestFocus(focusNode);
      controller.selection = TextSelection(
        baseOffset: 0,
        extentOffset: controller.text.length,
      );
    }

    Future<void> saveDraft() async {
      if (isWorking.value) return;
      isWorking.value = true;
      debounceTimer.value?.cancel();
      saveGeneration.value++;
      try {
        await ref
            .read(teamUpdateDraftProvider.notifier)
            .save(title: titleController.text, body: bodyController.text);
        if (context.mounted) Navigator.of(context).pop(false);
      } catch (_) {
        if (context.mounted) {
          isWorking.value = false;
          draftSaveFailed.value = true;
        }
      }
    }

    Future<void> publish() async {
      if (!hasContent || isWorking.value) return;
      isWorking.value = true;
      debounceTimer.value?.cancel();
      saveGeneration.value++;
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
      } catch (_) {
        if (context.mounted) {
          isWorking.value = false;
          draftSaveFailed.value = true;
        }
        return;
      }
      try {
        await onPublish(content);
      } catch (_) {
        try {
          await ref
              .read(teamUpdateDraftProvider.notifier)
              .markFailed(title: title, body: body);
        } catch (_) {
          if (context.mounted) {
            isWorking.value = false;
            currentMode.value = TeamUpdateComposeMode.failed;
            draftSaveFailed.value = true;
          }
          return;
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

    return Scaffold(
      resizeToAvoidBottomInset: true,
      backgroundColor: tokens.paper,
      body: SafeArea(
        child: Column(
          children: [
            _ComposeHeader(
              communityName: community?.name,
              onBack: () => Navigator.of(context).maybePop(),
              onOpenTeamUpdates: () => MobileNavigation.openUpdates(context),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(
                  Grid.gutter,
                  Grid.scrollInset,
                  Grid.gutter,
                  Grid.xs,
                ),
                children: discarding.value
                    ? [
                        _DiscardDraftView(
                          isWorking: isWorking.value,
                          onDiscard: discardDraft,
                          onKeepEditing: () => discarding.value = false,
                        ),
                      ]
                    : [
                        if (currentMode.value == TeamUpdateComposeMode.draft &&
                            activeDraft != null &&
                            !draftSaveFailed.value)
                          const _ComposeNotice(
                            title: 'Recovered the last saved draft',
                            body:
                                'The final unsaved edits may be missing. Review this version before posting.',
                            tone: _NoticeTone.info,
                          ),
                        if (draftSaveFailed.value)
                          const _ComposeNotice(
                            title: 'Draft could not save on this phone',
                            body:
                                'Keep this screen open or copy your text before leaving. Your words are still here.',
                            tone: _NoticeTone.error,
                          ),
                        if (currentMode.value == TeamUpdateComposeMode.failed &&
                            activeDraft != null)
                          const _ComposeNotice(
                            title: 'Update wasn’t published',
                            body:
                                'Your draft is safe. Retry when you’re connected.',
                            tone: _NoticeTone.error,
                          ),
                        _FieldLabel(label: 'Title'),
                        const SizedBox(height: 10),
                        TextField(
                          controller: titleController,
                          focusNode: titleFocus,
                          textInputAction: TextInputAction.next,
                          style: context.textTheme.bodyMedium?.copyWith(
                            fontSize: 13,
                          ),
                          decoration: _fieldDecoration(context),
                        ),
                        const SizedBox(height: 19),
                        _FieldLabel(label: 'Your note'),
                        const SizedBox(height: 9),
                        TextField(
                          controller: bodyController,
                          focusNode: bodyFocus,
                          minLines: 5,
                          maxLines: 5,
                          keyboardType: TextInputType.multiline,
                          textInputAction: TextInputAction.newline,
                          style: context.textTheme.bodyMedium?.copyWith(
                            fontSize: 13,
                            height: 1.5,
                          ),
                          decoration: _fieldDecoration(context).copyWith(
                            contentPadding: const EdgeInsets.symmetric(
                              horizontal: Grid.xs,
                              vertical: 13,
                            ),
                            constraints: const BoxConstraints(minHeight: 125),
                          ),
                        ),
                      ],
              ),
            ),
            if (!discarding.value)
              if (draftSaveFailed.value)
                _DraftRecoveryFooter(
                  primaryLabel: 'Retry saving draft',
                  isWorking: isWorking.value,
                  canPublish: hasContent || draftSaveFailed.value,
                  onPrimary: retrySavingDraft,
                  onSelectText: selectTextToCopy,
                  onDiscard: () => discarding.value = true,
                )
              else if (currentMode.value == TeamUpdateComposeMode.draft)
                _DraftRecoveryFooter(
                  primaryLabel: 'Post note',
                  isWorking: isWorking.value,
                  canPublish: hasContent,
                  onPrimary: publish,
                  onSelectText: selectTextToCopy,
                  onDiscard: () => discarding.value = true,
                )
              else
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
  const _ComposeHeader({
    required this.communityName,
    required this.onBack,
    required this.onOpenTeamUpdates,
  });

  final String? communityName;
  final VoidCallback onBack;
  final VoidCallback onOpenTeamUpdates;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    final name = communityName?.trim();
    return Container(
      height: 58,
      padding: const EdgeInsets.symmetric(horizontal: Grid.twelve),
      color: tokens.paper,
      child: Row(
        children: [
          IconButton(
            key: const ValueKey('update-compose-back'),
            onPressed: onBack,
            tooltip: 'Back',
            style: IconButton.styleFrom(
              foregroundColor: tokens.ink,
              backgroundColor: tokens.paper,
              fixedSize: const Size(42, 42),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(Radii.button),
                side: BorderSide(color: tokens.line),
              ),
            ),
            icon: const Icon(LucideIcons.chevronLeft, size: 19),
          ),
          const SizedBox(width: Grid.xxs),
          Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'A note for the team',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: context.textTheme.titleMedium?.copyWith(
                    color: tokens.ink,
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                    letterSpacing: -0.45,
                  ),
                ),
                Text(
                  name?.isNotEmpty == true ? name! : 'Colony',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: context.textTheme.bodySmall?.copyWith(
                    color: tokens.muted,
                    fontSize: 10,
                  ),
                ),
              ],
            ),
          ),
          IconButton(
            key: const ValueKey('update-compose-open-team-updates'),
            tooltip: 'Open team updates',
            onPressed: onOpenTeamUpdates,
            style: IconButton.styleFrom(
              foregroundColor: tokens.ink,
              backgroundColor: tokens.paper,
              fixedSize: const Size(42, 42),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(Radii.button),
                side: BorderSide(color: tokens.line),
              ),
            ),
            icon: const Icon(LucideIcons.plus, size: 19),
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
    final edge = tone == _NoticeTone.info
        ? context.appColors.lilac
        : Theme.of(context).colorScheme.error;
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 17),
      padding: const EdgeInsets.fromLTRB(14, 13, 14, 14),
      decoration: BoxDecoration(
        color: tokens.paper,
        border: Border.all(color: tokens.line),
        borderRadius: BorderRadius.circular(Radii.md),
      ),
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(
              width: 3,
              decoration: BoxDecoration(
                color: edge,
                borderRadius: BorderRadius.circular(Radii.button),
              ),
            ),
            const SizedBox(width: Grid.xs),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: context.textTheme.labelLarge?.copyWith(
                      color: tokens.ink,
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: Grid.half),
                  Text(
                    body,
                    style: context.textTheme.bodySmall?.copyWith(
                      color: tokens.muted,
                      fontSize: 11,
                      height: 1.6,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
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
                backgroundColor: tokens.action,
                foregroundColor: tokens.onAction,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(Radii.button),
                ),
                textStyle: context.textTheme.labelLarge?.copyWith(
                  color: tokens.onAction,
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
                foregroundColor: tokens.action,
                textStyle: context.textTheme.labelLarge?.copyWith(
                  color: tokens.action,
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

class _DraftRecoveryFooter extends StatelessWidget {
  const _DraftRecoveryFooter({
    required this.primaryLabel,
    required this.isWorking,
    required this.canPublish,
    required this.onPrimary,
    required this.onSelectText,
    required this.onDiscard,
  });

  final String primaryLabel;
  final bool isWorking;
  final bool canPublish;
  final Future<void> Function() onPrimary;
  final VoidCallback onSelectText;
  final VoidCallback onDiscard;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 14, 20, 10),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          _RecoveryButton(
            label: primaryLabel,
            primary: true,
            enabled: !isWorking && canPublish,
            onPressed: () => unawaited(onPrimary()),
          ),
          const SizedBox(height: Grid.xxs),
          _RecoveryButton(
            label: 'Select text to copy',
            primary: false,
            enabled: !isWorking,
            onPressed: onSelectText,
          ),
          const SizedBox(height: Grid.xxs),
          _RecoveryButton(
            label: 'Discard draft...',
            primary: false,
            enabled: !isWorking,
            onPressed: onDiscard,
          ),
          if (isWorking) ...[
            const SizedBox(height: Grid.half),
            Semantics(
              liveRegion: true,
              child: Text(
                'Saving on this phone',
                style: context.textTheme.labelSmall?.copyWith(
                  color: tokens.muted,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _RecoveryButton extends StatelessWidget {
  const _RecoveryButton({
    required this.label,
    required this.primary,
    required this.enabled,
    required this.onPressed,
  });

  final String label;
  final bool primary;
  final bool enabled;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return SizedBox(
      width: double.infinity,
      height: 44,
      child: FilledButton(
        onPressed: enabled ? onPressed : null,
        style: FilledButton.styleFrom(
          backgroundColor: primary ? tokens.action : tokens.soft,
          foregroundColor: primary ? tokens.onAction : tokens.action,
          disabledBackgroundColor: primary ? tokens.action : tokens.soft,
          disabledForegroundColor: primary
              ? tokens.onAction.withValues(alpha: 0.55)
              : tokens.muted,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(Radii.button),
          ),
          textStyle: context.textTheme.labelLarge?.copyWith(
            fontSize: 12,
            fontWeight: FontWeight.w700,
          ),
        ),
        child: Text(label),
      ),
    );
  }
}

class _DiscardDraftView extends StatelessWidget {
  const _DiscardDraftView({
    required this.isWorking,
    required this.onDiscard,
    required this.onKeepEditing,
  });

  final bool isWorking;
  final Future<void> Function() onDiscard;
  final VoidCallback onKeepEditing;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Padding(
      padding: const EdgeInsets.only(top: 38),
      child: Column(
        children: [
          Container(
            width: 66,
            height: 66,
            decoration: BoxDecoration(
              color: tokens.soft,
              borderRadius: BorderRadius.circular(22),
            ),
            child: Icon(LucideIcons.briefcaseBusiness, color: tokens.action),
          ),
          const SizedBox(height: Grid.sm),
          Text(
            'Discard this draft?',
            textAlign: TextAlign.center,
            style: context.textTheme.titleLarge?.copyWith(
              color: tokens.ink,
              fontSize: 21,
              fontWeight: FontWeight.w700,
              letterSpacing: -0.65,
            ),
          ),
          const SizedBox(height: Grid.xxs),
          Text(
            'Your saved draft will be removed from this review. You can keep editing instead.',
            textAlign: TextAlign.center,
            style: context.textTheme.bodySmall?.copyWith(
              color: tokens.muted,
              fontSize: 12,
              height: 1.65,
            ),
          ),
          const SizedBox(height: Grid.sm),
          _RecoveryButton(
            label: 'Discard draft',
            primary: true,
            enabled: !isWorking,
            onPressed: () => unawaited(onDiscard()),
          ),
          const SizedBox(height: 57),
          _RecoveryButton(
            label: 'Keep editing',
            primary: false,
            enabled: !isWorking,
            onPressed: onKeepEditing,
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
