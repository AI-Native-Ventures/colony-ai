import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../shared/community/community_provider.dart';
import '../../shared/navigation/mobile_navigation.dart';
import '../../shared/profile/user_cache_provider.dart';
import '../../shared/theme/theme.dart';
import '../../shared/utils/string_utils.dart';
import '../../shared/widgets/bee_refresh_indicator.dart';
import 'pulse_models.dart';
import 'pulse_provider.dart';
import 'team_update_drafts_provider.dart';

class TeamUpdatesPage extends HookConsumerWidget {
  const TeamUpdatesPage({
    this.initiallyPublished = false,
    this.showHeader = true,
    super.key,
  });

  final bool initiallyPublished;
  final bool showHeader;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final notesAsync = ref.watch(globalNotesProvider);
    final draft = ref.watch(teamUpdateDraftProvider);
    final community = ref.watch(activeCommunityProvider).value;
    final published = useState(initiallyPublished);
    final notes = (notesAsync.asData?.value ?? const <UserNote>[])
        .where((note) => note.replyParentId == null)
        .toList(growable: false);
    if (notes.isNotEmpty) preloadPulseProfiles(ref, notes);

    Future<void> openCompose() async {
      final didPublish = await MobileNavigation.openUpdateCompose(context);
      if (didPublish == true && context.mounted) {
        published.value = true;
        ref.invalidate(globalNotesProvider);
      }
    }

    Future<void> refresh() async {
      ref.invalidate(globalNotesProvider);
      try {
        await ref.read(globalNotesProvider.future);
      } catch (_) {
        // The provider retains the failure for the visible retry state.
      }
    }

    final visibleDraft = draft?.status == TeamUpdateDraftStatus.published
        ? null
        : draft;
    final page = notesAsync.when<Widget>(
      loading: () => const Center(child: CircularProgressIndicator.adaptive()),
      error: (_, _) => _TeamUpdatesUnavailable(
        onRetry: refresh,
        topPadding: showHeader ? 63 : 151,
      ),
      data: (_) => notes.isEmpty
          ? _TeamUpdatesEmpty(
              draft: visibleDraft,
              onOpenDraft: () =>
                  visibleDraft?.status == TeamUpdateDraftStatus.failed
                  ? MobileNavigation.openUpdateFailed(context)
                  : MobileNavigation.openUpdateDraft(context),
              onCompose: openCompose,
            )
          : _TeamUpdatesFeed(
              notes: notes,
              draft: visibleDraft,
              communityName: community?.name,
              showPublishedNotice: published.value,
              onOpenNote: (id) => MobileNavigation.openUpdateNote(context, id),
              onOpenDraft: () =>
                  visibleDraft?.status == TeamUpdateDraftStatus.failed
                  ? MobileNavigation.openUpdateFailed(context)
                  : MobileNavigation.openUpdateDraft(context),
              onCompose: openCompose,
            ),
    );

    return SafeArea(
      top: showHeader,
      bottom: false,
      child: Column(
        children: [
          if (showHeader)
            _TeamUpdatesHeader(
              communityName: community?.name,
              onBack: () => Navigator.of(context).maybePop(),
              onCompose: openCompose,
            ),
          Expanded(
            child: BeeRefreshIndicator(onRefresh: refresh, child: page),
          ),
        ],
      ),
    );
  }
}

class _TeamUpdatesHeader extends StatelessWidget {
  const _TeamUpdatesHeader({
    required this.communityName,
    required this.onBack,
    required this.onCompose,
  });

  final String? communityName;
  final VoidCallback onBack;
  final VoidCallback onCompose;

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
            key: const ValueKey('team-updates-back'),
            tooltip: 'Back',
            onPressed: onBack,
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
                  'Team updates',
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
            key: const ValueKey('team-updates-compose'),
            tooltip: 'Write a team note',
            onPressed: onCompose,
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

class _TeamUpdatesEmpty extends StatelessWidget {
  const _TeamUpdatesEmpty({
    required this.draft,
    required this.onOpenDraft,
    required this.onCompose,
  });

  final TeamUpdateDraft? draft;
  final VoidCallback onOpenDraft;
  final VoidCallback onCompose;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: EdgeInsets.fromLTRB(Grid.gutter, 15, Grid.gutter, Grid.gutter),
      children: [
        Container(
          padding: const EdgeInsets.fromLTRB(22, 20, 22, 48),
          decoration: BoxDecoration(
            gradient: Theme.of(context).brightness == Brightness.dark
                ? const LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [Color(0xff4f365d), Color(0xff563f46)],
                  )
                : context.appColors.channelInfoHeroGradient,
            borderRadius: BorderRadius.circular(27),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'YOUR TEAM’S JOURNAL',
                style: context.textTheme.labelSmall?.copyWith(
                  color: tokens.ink.withValues(alpha: 0.78),
                  fontSize: 9,
                  letterSpacing: 1.1,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: Grid.xxs),
              Text(
                'Start a\nconversation.',
                style: context.mobileTypography.flowTitle.copyWith(
                  color: tokens.ink,
                  fontSize: 27,
                  height: 1.15,
                  letterSpacing: -0.8,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 51),
        Center(
          child: Container(
            width: 66,
            height: 66,
            decoration: BoxDecoration(
              color: tokens.soft,
              borderRadius: BorderRadius.circular(22),
            ),
            child: Icon(LucideIcons.briefcaseBusiness, color: tokens.action),
          ),
        ),
        const SizedBox(height: Grid.sm),
        Text(
          'No team notes yet',
          textAlign: TextAlign.center,
          style: context.textTheme.titleLarge?.copyWith(
            color: tokens.ink,
            fontSize: 22,
            fontWeight: FontWeight.w700,
            letterSpacing: -0.65,
          ),
        ),
        const SizedBox(height: Grid.xxs + 7),
        Text(
          'Share a useful update, a decision or something the team learned.',
          textAlign: TextAlign.center,
          style: context.textTheme.bodySmall?.copyWith(
            color: tokens.muted,
            fontSize: 13,
            height: 1.65,
          ),
        ),
        if (draft != null) ...[
          const SizedBox(height: Grid.sm),
          _DraftRow(draft: draft!, onTap: onOpenDraft),
        ],
        const SizedBox(height: Grid.sm + 5),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10),
          child: _TeamUpdatesAction(
            label: 'Write a team note',
            onPressed: onCompose,
          ),
        ),
      ],
    );
  }
}

class _TeamUpdatesUnavailable extends StatelessWidget {
  const _TeamUpdatesUnavailable({
    required this.onRetry,
    required this.topPadding,
  });

  final Future<void> Function() onRetry;
  final double topPadding;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return SingleChildScrollView(
      padding: EdgeInsets.fromLTRB(
        Grid.gutter,
        topPadding,
        Grid.gutter,
        Grid.gutter,
      ),
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
          const SizedBox(height: 13),
          Text(
            'Could not load team updates',
            textAlign: TextAlign.center,
            style: context.textTheme.titleLarge?.copyWith(
              color: tokens.ink,
              fontSize: 22,
              fontWeight: FontWeight.w700,
              letterSpacing: -0.65,
            ),
          ),
          const SizedBox(height: Grid.xxs + 10),
          Text(
            'The workspace connection is unavailable. This is not an empty list. Your local drafts are safe.',
            textAlign: TextAlign.center,
            style: context.textTheme.bodySmall?.copyWith(
              color: tokens.muted,
              fontSize: 13,
              height: 1.65,
            ),
          ),
          const SizedBox(height: Grid.sm + 8),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 10),
            child: _TeamUpdatesAction(
              label: 'Retry connection',
              onPressed: () => unawaited(onRetry()),
            ),
          ),
        ],
      ),
    );
  }
}

class _TeamUpdatesAction extends StatelessWidget {
  const _TeamUpdatesAction({required this.label, required this.onPressed});

  final String label;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return SizedBox(
      width: double.infinity,
      height: 44,
      child: FilledButton(
        onPressed: onPressed,
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
        child: Text(label),
      ),
    );
  }
}

class _TeamUpdatesFeed extends StatelessWidget {
  const _TeamUpdatesFeed({
    required this.notes,
    required this.draft,
    required this.communityName,
    required this.showPublishedNotice,
    required this.onOpenNote,
    required this.onOpenDraft,
    required this.onCompose,
  });

  final List<UserNote> notes;
  final TeamUpdateDraft? draft;
  final String? communityName;
  final bool showPublishedNotice;
  final ValueChanged<String> onOpenNote;
  final VoidCallback onOpenDraft;
  final VoidCallback onCompose;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(
        Grid.gutter,
        Grid.xxs,
        Grid.gutter,
        Grid.xs,
      ),
      children: [
        if (showPublishedNotice)
          _FeedNotice(
            title: 'Update published',
            body:
                'Shared with ${communityName?.trim().isNotEmpty == true ? communityName : 'your team'} in this preview.',
            color: tokens.success,
            foreground: Theme.of(context).brightness == Brightness.dark
                ? const Color(0xffc5d4e3)
                : const Color(0xff60816a),
          ),
        Text(
          'From your team.',
          style: context.textTheme.headlineSmall?.copyWith(
            color: tokens.ink,
            fontSize: 26,
            fontWeight: FontWeight.w700,
            letterSpacing: -0.9,
            height: 1.22,
          ),
        ),
        const SizedBox(height: Grid.half),
        Text(
          'Plans, progress and the bigger picture.',
          style: context.textTheme.bodySmall?.copyWith(
            color: tokens.muted,
            fontSize: 12,
          ),
        ),
        for (final note in notes.take(10))
          _EditorialNoteCard(note: note, onTap: () => onOpenNote(note.id)),
        if (draft != null) _DraftRow(draft: draft!, onTap: onOpenDraft),
        _FeedFooter(onCompose: onCompose),
      ],
    );
  }
}

class _EditorialNoteCard extends ConsumerWidget {
  const _EditorialNoteCard({required this.note, required this.onTap});

  final UserNote note;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profile = ref.watch(
      userCacheProvider.select((cache) => cache[note.pubkey]),
    );
    final author = profile?.label ?? shortPubkey(note.pubkey);
    final parts = _splitUpdate(note.content);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(Radii.md),
      child: Container(
        margin: const EdgeInsets.only(top: 26, bottom: 19),
        padding: const EdgeInsets.fromLTRB(25, 32, 25, 29),
        decoration: BoxDecoration(
          color: Theme.of(context).brightness == Brightness.dark
              ? const Color(0xff39342e)
              : const Color(0xffece8e0),
          borderRadius: BorderRadius.circular(14),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'THIS WEEK / ${author.toUpperCase()}',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: context.textTheme.labelSmall?.copyWith(
                color: Theme.of(context).brightness == Brightness.dark
                    ? const Color(0xffd2c8b9)
                    : const Color(0xff645c52),
                fontSize: 8,
                letterSpacing: 1.25,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 26),
            Text(
              parts.title,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style:
                  const TextStyle(
                    fontFamily: 'Georgia',
                    fontSize: 32,
                    height: 1.1,
                    letterSpacing: -0.9,
                    fontWeight: FontWeight.w400,
                  ).copyWith(
                    color: Theme.of(context).brightness == Brightness.dark
                        ? const Color(0xffd2c8b9)
                        : const Color(0xff645c52),
                  ),
            ),
            if (parts.body.isNotEmpty) ...[
              const SizedBox(height: 26),
              Text(
                parts.body,
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
                style: context.textTheme.bodySmall?.copyWith(
                  color: Theme.of(context).brightness == Brightness.dark
                      ? const Color(0xffd2c8b9)
                      : const Color(0xff645c52),
                  fontSize: 12,
                  height: 1.7,
                ),
              ),
            ],
            const SizedBox(height: Grid.xs + Grid.half),
            TextButton(
              onPressed: onTap,
              style: TextButton.styleFrom(
                foregroundColor: context.mobileTokens.action,
                padding: const EdgeInsets.symmetric(
                  vertical: 10,
                  horizontal: 3,
                ),
                minimumSize: Size.zero,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                alignment: Alignment.centerLeft,
                textStyle: const TextStyle(
                  fontFamily: 'Manrope',
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                ),
              ),
              child: const Text('Read update'),
            ),
          ],
        ),
      ),
    );
  }
}

class _DraftRow extends StatelessWidget {
  const _DraftRow({required this.draft, required this.onTap});

  final TeamUpdateDraft draft;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return InkWell(
      onTap: onTap,
      child: Container(
        constraints: const BoxConstraints(minHeight: 70),
        padding: const EdgeInsets.symmetric(vertical: Grid.xxs),
        decoration: BoxDecoration(
          border: Border(bottom: BorderSide(color: tokens.line)),
        ),
        child: Row(
          children: [
            SizedBox(
              width: 36,
              child: Center(
                child: Icon(LucideIcons.file, size: 18, color: tokens.ink),
              ),
            ),
            const SizedBox(width: Grid.twelve),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    'Your unpublished update',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: context.textTheme.bodyMedium?.copyWith(
                      color: tokens.ink,
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: Grid.half),
                  Text(
                    draft.status == TeamUpdateDraftStatus.failed
                        ? 'Saved on this phone · Not published'
                        : 'Saved on this phone',
                    style: context.textTheme.bodySmall?.copyWith(
                      color: tokens.muted,
                      fontSize: 11,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: Grid.xxs),
            Icon(LucideIcons.arrowRight, size: 15, color: tokens.muted),
          ],
        ),
      ),
    );
  }
}

class _FeedNotice extends StatelessWidget {
  const _FeedNotice({
    required this.title,
    required this.body,
    required this.color,
    required this.foreground,
  });

  final String title;
  final String body;
  final Color color;
  final Color foreground;

  @override
  Widget build(BuildContext context) => Container(
    margin: const EdgeInsets.only(top: 9, bottom: 17),
    padding: const EdgeInsets.fromLTRB(14, 14, 14, 17),
    decoration: BoxDecoration(
      color: color,
      borderRadius: BorderRadius.circular(Radii.md),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: context.textTheme.labelLarge?.copyWith(
            color: foreground,
            fontWeight: FontWeight.w700,
            fontSize: 12,
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

class _FeedFooter extends StatelessWidget {
  const _FeedFooter({required this.onCompose});

  final VoidCallback onCompose;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Container(
      padding: const EdgeInsets.symmetric(vertical: Grid.sm),
      color: tokens.paper,
      child: SizedBox(
        width: double.infinity,
        height: 44,
        child: FilledButton(
          onPressed: onCompose,
          style: FilledButton.styleFrom(
            backgroundColor: tokens.action,
            foregroundColor: tokens.onAction,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(10),
            ),
            textStyle: const TextStyle(
              fontFamily: 'Manrope',
              fontSize: 12,
              fontWeight: FontWeight.w700,
            ),
          ),
          child: const Text('Write an update'),
        ),
      ),
    );
  }
}

({String title, String body}) _splitUpdate(String content) {
  final paragraphs = content.trim().split(RegExp(r'\n\s*\n'));
  final title = paragraphs.firstOrNull?.trim() ?? '';
  return (
    title: title.isEmpty ? 'Team update' : title,
    body: paragraphs.skip(1).join('\n\n').trim(),
  );
}
