import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../shared/community/community_provider.dart';
import '../../shared/navigation/mobile_navigation.dart';
import '../../shared/profile/user_cache_provider.dart';
import '../../shared/theme/theme.dart';
import '../../shared/utils/string_utils.dart';
import 'pulse_actions.dart';
import 'pulse_models.dart';
import 'pulse_provider.dart';
import 'team_updates_page.dart';

class TeamUpdateNotePage extends HookConsumerWidget {
  const TeamUpdateNotePage({
    required this.noteId,
    this.onReviewCampaign,
    this.now,
    super.key,
  });

  final String noteId;
  final VoidCallback? onReviewCampaign;
  final DateTime? now;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final notesAsync = ref.watch(globalNotesProvider);
    final community = ref.watch(activeCommunityProvider).value;
    final notes = notesAsync.asData?.value ?? const <UserNote>[];
    final note = notes.where((candidate) => candidate.id == noteId).firstOrNull;
    final replies =
        notes.where((candidate) => candidate.replyParentId == noteId).toList()
          ..sort((a, b) => a.createdAt.compareTo(b.createdAt));
    final controller = useTextEditingController();
    final isSending = useState(false);
    final replyHasText = useListenableSelector(
      controller,
      () => controller.text.trim().isNotEmpty,
    );

    if (note != null) {
      ref.read(userCacheProvider.notifier).preload([
        note.pubkey,
        for (final reply in replies) reply.pubkey,
      ]);
    }

    Future<void> sendReply() async {
      final target = note;
      final text = controller.text.trim();
      if (target == null || text.isEmpty || isSending.value) return;
      isSending.value = true;
      try {
        await publishNote(ref, content: text, replyTo: target);
        controller.clear();
        ref.invalidate(globalNotesProvider);
      } catch (error, stackTrace) {
        if (context.mounted) isSending.value = false;
        Error.throwWithStackTrace(error, stackTrace);
      }
      if (context.mounted) isSending.value = false;
    }

    if (notesAsync.hasError) return const TeamUpdatesPage();

    return Scaffold(
      backgroundColor: context.mobileTokens.paper,
      resizeToAvoidBottomInset: true,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            _NoteHeader(
              communityName: community?.name,
              author: note == null
                  ? null
                  : ref.watch(
                      userCacheProvider.select(
                        (cache) => cache[note.pubkey]?.label,
                      ),
                    ),
              createdAt: note?.createdAt,
              now: now,
              onBack: () => Navigator.of(context).maybePop(),
              onOpenTeamUpdates: () => MobileNavigation.openUpdates(context),
            ),
            Expanded(
              child: notesAsync.when(
                loading: () =>
                    const Center(child: CircularProgressIndicator.adaptive()),
                error: (_, _) => const SizedBox.shrink(),
                data: (_) => note == null
                    ? _NoteMissingState(
                        onBackToTeamUpdates: () =>
                            Navigator.of(context).maybePop(),
                      )
                    : _NoteBody(
                        note: note,
                        replies: replies,
                        onReviewCampaign: onReviewCampaign,
                      ),
              ),
            ),
            if (note != null)
              _ReplyComposer(
                controller: controller,
                hasText: replyHasText,
                isSending: isSending.value,
                onSend: sendReply,
              ),
          ],
        ),
      ),
    );
  }
}

class _NoteHeader extends StatelessWidget {
  const _NoteHeader({
    required this.communityName,
    required this.author,
    required this.createdAt,
    required this.now,
    required this.onBack,
    required this.onOpenTeamUpdates,
  });

  final String? communityName;
  final String? author;
  final int? createdAt;
  final DateTime? now;
  final VoidCallback onBack;
  final VoidCallback onOpenTeamUpdates;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Container(
      height: 58,
      padding: const EdgeInsets.symmetric(horizontal: Grid.twelve),
      color: tokens.paper,
      child: Row(
        children: [
          IconButton(
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
                  'Team note',
                  style: context.textTheme.titleMedium?.copyWith(
                    color: tokens.ink,
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                Text(
                  author != null && createdAt != null
                      ? '$author · ${_relativeDayLabel(createdAt!, now: now)}'
                      : communityName?.trim().isNotEmpty == true
                      ? communityName!.trim()
                      : 'Colony',
                  style: context.textTheme.bodySmall?.copyWith(
                    color: tokens.muted,
                    fontSize: 10,
                  ),
                ),
              ],
            ),
          ),
          IconButton(
            key: const ValueKey('team-note-open-updates'),
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

class _NoteMissingState extends StatelessWidget {
  const _NoteMissingState({required this.onBackToTeamUpdates});

  final VoidCallback onBackToTeamUpdates;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(Grid.gutter),
        child: Column(
          mainAxisSize: MainAxisSize.min,
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
              'This note is no longer here',
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
              'It may have been removed or you may no longer have access. We cannot show its replies.',
              textAlign: TextAlign.center,
              style: context.textTheme.bodySmall?.copyWith(
                color: tokens.muted,
                fontSize: 12,
                height: 1.65,
              ),
            ),
            const SizedBox(height: Grid.sm),
            SizedBox(
              width: double.infinity,
              height: 44,
              child: FilledButton(
                onPressed: onBackToTeamUpdates,
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
                child: const Text('Back to team updates'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _NoteBody extends ConsumerWidget {
  const _NoteBody({
    required this.note,
    required this.replies,
    this.onReviewCampaign,
  });

  final UserNote note;
  final List<UserNote> replies;
  final VoidCallback? onReviewCampaign;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final paragraphs = note.content.trim().split(RegExp(r'\n\s*\n'));
    final title = paragraphs.firstOrNull ?? '';
    final body = paragraphs.skip(1).join('\n\n').trim();
    final date = DateFormat(
      'd MMMM',
    ).format(DateTime.fromMillisecondsSinceEpoch(note.createdAt * 1000));
    final tokens = context.mobileTokens;

    return ListView(
      padding: const EdgeInsets.fromLTRB(0, Grid.sm + Grid.half, 0, Grid.xs),
      children: [
        _noteGutter(
          Text(
            'THIS WEEK · $date'.toUpperCase(),
            style: context.textTheme.labelSmall?.copyWith(
              color: tokens.muted,
              fontSize: 9,
              letterSpacing: 1.1,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
        const SizedBox(height: Grid.sm),
        _noteGutter(
          Text(
            _editorialTitle(title.isEmpty ? 'Team update' : title),
            style: context.textTheme.headlineSmall?.copyWith(
              color: tokens.ink,
              fontSize: 28,
              height: 1.18,
              letterSpacing: -1,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
        if (body.isNotEmpty) ...[
          for (final entry in _updateBodyBlocks(body).indexed) ...[
            SizedBox(height: entry.$1 == 0 ? Grid.sm - Grid.half : Grid.xs),
            _noteGutter(_UpdateBodyBlock(text: entry.$2)),
            if (entry.$1 == 1 &&
                body.toLowerCase().contains('review') &&
                onReviewCampaign != null) ...[
              const SizedBox(height: Grid.twelve),
              _noteGutter(
                TextButton(
                  onPressed: onReviewCampaign,
                  style: TextButton.styleFrom(
                    foregroundColor: tokens.action,
                    minimumSize: const Size(0, 29),
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    alignment: Alignment.centerLeft,
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    textStyle: const TextStyle(
                      fontFamily: 'Manrope',
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  child: const Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text('Review the campaign'),
                      SizedBox(width: Grid.xxs),
                      Icon(LucideIcons.arrowRight, size: 16),
                    ],
                  ),
                ),
              ),
            ],
          ],
        ],
        const SizedBox(height: Grid.sm),
        if (replies.isNotEmpty) ...[
          Container(
            padding: const EdgeInsets.fromLTRB(18, 9, 18, 10),
            decoration: BoxDecoration(
              border: Border(bottom: BorderSide(color: tokens.line)),
            ),
            child: Text(
              'Conversation · ${replies.length} ${replies.length == 1 ? 'reply' : 'replies'}',
              style: context.textTheme.labelSmall?.copyWith(
                color: tokens.muted,
                fontSize: 10,
              ),
            ),
          ),
          for (final reply in replies) _ReplyRow(note: reply),
        ],
      ],
    );
  }
}

Widget _noteGutter(Widget child) => Padding(
  padding: const EdgeInsets.symmetric(horizontal: Grid.gutter),
  child: child,
);

List<String> _updateBodyBlocks(String body) => body
    .split(RegExp(r'\n\s*\n'))
    .where((part) => part.trim().isNotEmpty)
    .map((part) => part.trim())
    .toList();

String _editorialTitle(String title) {
  if (title.contains('\n')) return title;
  final sentenceEnd = title.indexOf('. ');
  if (sentenceEnd <= 0 || title.length < 26) return title;
  return '${title.substring(0, sentenceEnd + 1)}\n'
      '${title.substring(sentenceEnd + 2)}';
}

class _ReplyRow extends ConsumerWidget {
  const _ReplyRow({required this.note});

  final UserNote note;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profile = ref.watch(
      userCacheProvider.select((cache) => cache[note.pubkey]),
    );
    final author = profile?.label ?? shortPubkey(note.pubkey);
    final tokens = context.mobileTokens;
    final time = DateFormat(
      'HH:mm',
    ).format(DateTime.fromMillisecondsSinceEpoch(note.createdAt * 1000));
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 18, 16, 18),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 34,
            height: 34,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: const Color(0xffe8e2ec),
              borderRadius: BorderRadius.circular(11),
            ),
            child: Text(
              profile?.initials ?? _initial(note.pubkey),
              style: context.textTheme.labelSmall?.copyWith(
                color: const Color(0xff76657d),
                fontSize: 11,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text.rich(
                  TextSpan(
                    children: [
                      TextSpan(
                        text: author,
                        style: context.textTheme.labelMedium?.copyWith(
                          color: tokens.ink,
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      TextSpan(
                        text: '  $time',
                        style: context.textTheme.labelSmall?.copyWith(
                          color: tokens.muted,
                          fontSize: 10,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 9),
                Text(
                  note.content,
                  style: context.textTheme.bodySmall?.copyWith(
                    color: tokens.ink,
                    fontSize: 13,
                    height: 1.6,
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

class _UpdateBodyBlock extends StatelessWidget {
  const _UpdateBodyBlock({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    final lines = text.split('\n');
    final hasSectionHeading = RegExp(r'^\d{2} / ').hasMatch(lines.first);
    if (!hasSectionHeading) {
      return Text(
        text,
        style: context.textTheme.bodySmall?.copyWith(
          color: tokens.muted,
          fontSize: 12,
          height: 1.65,
        ),
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          lines.first,
          style: context.textTheme.titleSmall?.copyWith(
            color: tokens.ink,
            fontSize: 14,
            fontWeight: FontWeight.w700,
          ),
        ),
        if (lines.skip(1).join('\n').trim().isNotEmpty) ...[
          const SizedBox(height: Grid.eighteen),
          Text(
            lines.skip(1).join('\n').trim(),
            style: context.textTheme.bodySmall?.copyWith(
              color: tokens.muted,
              fontSize: 12,
              height: 1.65,
            ),
          ),
        ],
      ],
    );
  }
}

class _ReplyComposer extends StatelessWidget {
  const _ReplyComposer({
    required this.controller,
    required this.hasText,
    required this.isSending,
    required this.onSend,
  });

  final TextEditingController controller;
  final bool hasText;
  final bool isSending;
  final VoidCallback onSend;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 27),
      decoration: BoxDecoration(
        color: tokens.paper,
        border: Border(top: BorderSide(color: tokens.line)),
      ),
      child: Container(
        height: 51,
        padding: const EdgeInsets.all(3),
        decoration: BoxDecoration(
          color: tokens.paper,
          border: Border.all(color: const Color(0xffdfd9e4)),
          borderRadius: BorderRadius.circular(14),
        ),
        child: Row(
          children: [
            SizedBox(
              width: 37,
              child: Center(
                child: Semantics(
                  label: 'Attachments are unavailable for team updates',
                  child: Icon(LucideIcons.plus, size: 18, color: tokens.ink),
                ),
              ),
            ),
            Expanded(
              child: SizedBox(
                height: 43,
                child: TextField(
                  controller: controller,
                  minLines: 1,
                  maxLines: 1,
                  textInputAction: TextInputAction.send,
                  onSubmitted: (_) => onSend(),
                  style: context.textTheme.bodyMedium?.copyWith(fontSize: 13),
                  decoration: const InputDecoration(
                    hintText: 'Message campaign-studio…',
                    isDense: true,
                    contentPadding: EdgeInsets.symmetric(
                      horizontal: 2,
                      vertical: 11,
                    ),
                    border: InputBorder.none,
                    enabledBorder: InputBorder.none,
                    focusedBorder: InputBorder.none,
                  ),
                ),
              ),
            ),
            SizedBox(
              width: 37,
              child: Center(
                child: hasText
                    ? IconButton(
                        onPressed: isSending ? null : onSend,
                        tooltip: 'Send reply',
                        padding: EdgeInsets.zero,
                        constraints: const BoxConstraints.tightFor(
                          width: 37,
                          height: 43,
                        ),
                        icon: Icon(
                          LucideIcons.arrowUp,
                          color: tokens.action,
                          size: 18,
                        ),
                      )
                    : Semantics(
                        label: 'Voice notes are unavailable for team updates',
                        child: Icon(LucideIcons.mic, size: 18),
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

String _initial(String pubkey) =>
    pubkey.isNotEmpty ? pubkey[0].toUpperCase() : '?';

String _relativeDayLabel(int createdAt, {DateTime? now}) {
  final date = DateTime.fromMillisecondsSinceEpoch(createdAt * 1000);
  final today = now ?? DateTime.now();
  if (date.year == today.year &&
      date.month == today.month &&
      date.day == today.day) {
    return 'Today';
  }
  return DateFormat('d MMMM').format(date);
}
