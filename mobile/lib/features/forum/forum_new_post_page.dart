import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../shared/theme/theme.dart';
import '../../shared/widgets/compose_submit_controller.dart';
import '../../shared/widgets/frosted_app_bar.dart';
import '../../shared/widgets/frosted_scaffold.dart';
import 'forum_presentation.dart';
import 'forum_published_note_page.dart';
import 'forum_provider.dart';

const _r19ForumPrimary = Color(0xFF45669F);
const _r19ForumDraftTint = Color(0x1FAD8ABE);
const _r19ForumError = Color(0xFFB96570);
const _r19ForumDanger = Color(0xFFB15D70);

/// Full-screen forum post editor and its delivery states.
class ForumNewPostPage extends HookConsumerWidget {
  final String channelId;
  final String channelName;
  final int memberCount;
  final ForumPresentationFactories presentation;

  const ForumNewPostPage({
    super.key,
    required this.channelId,
    required this.channelName,
    required this.memberCount,
    required this.presentation,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final titleController = useTextEditingController();
    final title = useValueListenable(titleController);
    final body = useState('');
    final attachmentCount = useState(0);
    final isPosting = useState(false);
    final hasFailed = useState(false);
    final isConfirmingDiscard = useState(false);
    final isDiscarding = useState(false);
    final submitController = useMemoized(ComposeSubmitController.new);
    final titleHasContent = title.text.trim().isNotEmpty;
    final hasEdits =
        titleHasContent ||
        body.value.trim().isNotEmpty ||
        attachmentCount.value > 0;
    final draftKey = 'forum-post:$channelId';
    final providerContainer = ProviderScope.containerOf(context, listen: false);
    final forumDelivery = ForumEventDelivery.capture(providerContainer);
    const appBarTitleHeight = MobileLayoutTokens.appBarHeight;

    void requestCancel() {
      if (isPosting.value) return;
      if (isConfirmingDiscard.value) {
        isConfirmingDiscard.value = false;
        return;
      }
      if (hasEdits) {
        FocusManager.instance.primaryFocus?.unfocus();
        isConfirmingDiscard.value = true;
      } else if (Navigator.of(context).canPop()) {
        Navigator.of(context).pop();
      }
    }

    void discardPost() {
      submitController.removeDraft();
      if (Navigator.of(context).canPop()) {
        isDiscarding.value = true;
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (context.mounted) Navigator.of(context).pop();
        });
      } else {
        titleController.clear();
        body.value = '';
        attachmentCount.value = 0;
        isConfirmingDiscard.value = false;
      }
    }

    final composingBar = presentation.composeBarBuilder(
      channelId: channelId,
      channelName: channelName,
      hintText: 'Share an update, a question or something worth discussing…',
      draftKeyOverride: draftKey,
      postEditorMode: true,
      allowEmptySend: true,
      enabled: !isPosting.value,
      submitController: submitController,
      onBodyChanged: (value) => body.value = value,
      onAttachmentCountChanged: (value) => attachmentCount.value = value,
      onSubmissionChanged: (value) {
        isPosting.value = value;
        if (value) {
          hasFailed.value = false;
          FocusManager.instance.primaryFocus?.unfocus();
        }
      },
      onFailure: (_) => hasFailed.value = true,
      onSend: (content, mentionPubkeys, {mediaTags = const []}) async {
        final trimmedTitle = titleController.text.trim();
        if (trimmedTitle.isEmpty) return;
        final serializedContent = '$trimmedTitle\n\n${content.trim()}';
        late final String eventId;
        try {
          eventId = await forumDelivery.createPost(
            channelId: channelId,
            content: serializedContent,
            mentionPubkeys: mentionPubkeys,
            mediaTags: mediaTags,
          );
        } catch (_) {
          if (context.mounted) {
            isPosting.value = false;
            hasFailed.value = true;
          }
          rethrow;
        }
        if (!context.mounted) return;
        submitController.removeDraft();
        Navigator.of(context).pushReplacement<void, void>(
          MaterialPageRoute<void>(
            builder: (_) => ForumPublishedNotePage(
              channelId: channelId,
              channelName: channelName,
              memberCount: memberCount,
              title: trimmedTitle,
              body: content.trim(),
              postEventId: eventId,
              mentionPubkeys: mentionPubkeys,
              eventTags: [
                ['h', channelId],
                for (final pubkey in mentionPubkeys) ['p', pubkey],
                ...mediaTags,
              ],
              presentation: presentation,
            ),
          ),
        );
      },
    );

    return PopScope<void>(
      canPop: (!hasEdits && !isPosting.value) || isDiscarding.value,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) requestCancel();
      },
      child: FrostedScaffold(
        backgroundColor: context.mobileTokens.paper,
        resizeToAvoidBottomInset: true,
        appBar: FrostedAppBar(
          leading: IconButton(
            onPressed: requestCancel,
            tooltip: 'Back',
            icon: const Icon(LucideIcons.arrowLeft, size: 20),
          ),
          titleContentHeight: appBarTitleHeight,
          title: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'New post',
                style: context.mobileTypography.body.copyWith(
                  color: context.mobileTokens.ink,
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                  height: 1.25,
                  letterSpacing: -0.4,
                ),
              ),
              Text(
                channelName,
                style: context.mobileTypography.body.copyWith(
                  color: context.mobileTokens.muted,
                  fontSize: 11,
                  height: 1.25,
                ),
              ),
            ],
          ),
          horizontalInset: Grid.gutter,
          iconColor: context.mobileTokens.ink,
          frostedSurfaceOpacity: 0,
          frostedBlurSigma: 0,
          bottomDividerOpacity: 1,
        ),
        body: SizedBox.expand(
          child: Stack(
            fit: StackFit.expand,
            children: [
              Offstage(
                offstage: isConfirmingDiscard.value,
                child: _NewPostEditor(
                  topInset: frostedAppBarHeight(
                    context,
                    titleContentHeight: appBarTitleHeight,
                  ),
                  channelName: channelName,
                  titleController: titleController,
                  isPosting: isPosting.value,
                  hasFailed: hasFailed.value,
                  composer: composingBar,
                  canPost: titleHasContent && !isPosting.value,
                  onPost: () {
                    if (!titleController.text.trim().isNotEmpty ||
                        isPosting.value) {
                      return;
                    }
                    submitController.submit();
                  },
                  onCancel: requestCancel,
                ),
              ),
              if (isConfirmingDiscard.value)
                _DiscardPostContent(
                  topInset: frostedAppBarHeight(
                    context,
                    titleContentHeight: appBarTitleHeight,
                  ),
                  title: titleController.text,
                  body: body.value,
                  attachmentCount: attachmentCount.value,
                  onKeepEditing: () => isConfirmingDiscard.value = false,
                  onDiscard: discardPost,
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _NewPostEditor extends StatelessWidget {
  final double topInset;
  final String channelName;
  final TextEditingController titleController;
  final bool isPosting;
  final bool hasFailed;
  final Widget composer;
  final bool canPost;
  final VoidCallback onPost;
  final VoidCallback onCancel;

  const _NewPostEditor({
    required this.topInset,
    required this.channelName,
    required this.titleController,
    required this.isPosting,
    required this.hasFailed,
    required this.composer,
    required this.canPost,
    required this.onPost,
    required this.onCancel,
  });

  @override
  Widget build(BuildContext context) {
    final labelStyle = context.mobileTypography.body.copyWith(
      color: context.mobileTokens.muted,
      fontSize: 12,
      fontWeight: FontWeight.w600,
    );
    return Column(
      children: [
        Expanded(
          child: SingleChildScrollView(
            padding: EdgeInsets.fromLTRB(20, topInset + 6, 20, Grid.xs),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (isPosting) _PostingNotice(channelName: channelName),
                if (hasFailed) const _PostFailureNotice(),
                Text('Title', style: labelStyle),
                const SizedBox(height: 8),
                TextField(
                  key: const ValueKey('forum-post-title'),
                  controller: titleController,
                  enabled: !isPosting,
                  textCapitalization: TextCapitalization.sentences,
                  style: context.mobileTypography.body.copyWith(
                    color: context.mobileTokens.ink,
                    fontSize: 22,
                    fontWeight: FontWeight.w600,
                  ),
                  decoration: InputDecoration(
                    hintText: 'Give your team a clear headline',
                    hintStyle: context.mobileTypography.body.copyWith(
                      color: context.mobileTokens.muted,
                      fontSize: 18,
                    ),
                    border: InputBorder.none,
                    enabledBorder: InputBorder.none,
                    focusedBorder: InputBorder.none,
                    disabledBorder: InputBorder.none,
                    contentPadding: const EdgeInsets.only(top: 3, bottom: 11),
                    isDense: true,
                  ),
                ),
                Divider(height: 14, color: context.mobileTokens.line),
                const SizedBox(height: 18),
                Text('Post', style: labelStyle),
                const SizedBox(height: 11),
                KeyedSubtree(
                  key: ValueKey('forum-post-composer:$channelName'),
                  child: composer,
                ),
                const SizedBox(height: 11),
                if (!isPosting)
                  Text(
                    'Visible to members of $channelName.',
                    style: context.mobileTypography.body.copyWith(
                      color: context.mobileTokens.muted,
                      fontSize: 11,
                    ),
                  ),
              ],
            ),
          ),
        ),
        _PostComposerFooter(
          isPosting: isPosting,
          hasFailed: hasFailed,
          canPost: canPost,
          onPost: onPost,
          onCancel: onCancel,
        ),
      ],
    );
  }
}

class _PostingNotice extends StatelessWidget {
  final String channelName;

  const _PostingNotice({required this.channelName});

  @override
  Widget build(BuildContext context) {
    return Semantics(
      liveRegion: true,
      label: 'Posting to $channelName…',
      child: Padding(
        padding: const EdgeInsets.only(bottom: 20),
        child: Row(
          children: [
            Container(
              width: 9,
              height: 9,
              decoration: BoxDecoration(
                color: const Color(0xFFA386B6),
                shape: BoxShape.circle,
              ),
            ),
            const SizedBox(width: 10),
            Text(
              'Posting to $channelName…',
              style: context.mobileTypography.body.copyWith(
                color: context.mobileTokens.muted,
                fontSize: 12,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PostFailureNotice extends StatelessWidget {
  const _PostFailureNotice();

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 22),
      padding: const EdgeInsets.all(13),
      decoration: BoxDecoration(
        color: _r19ForumError.withValues(alpha: 0.06),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: _r19ForumError.withValues(alpha: 0.31)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Your post wasn’t sent.',
            style: context.mobileTypography.body.copyWith(
              color: context.mobileTokens.ink,
              fontSize: 13,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 7),
          Text(
            'Your title, text and attachments are kept. Check your connection, then retry.',
            style: context.mobileTypography.body.copyWith(
              color: context.mobileTokens.muted,
              fontSize: 12,
              height: 1.7,
            ),
          ),
        ],
      ),
    );
  }
}

class _PostComposerFooter extends StatelessWidget {
  final bool isPosting;
  final bool hasFailed;
  final bool canPost;
  final VoidCallback onPost;
  final VoidCallback onCancel;

  const _PostComposerFooter({
    required this.isPosting,
    required this.hasFailed,
    required this.canPost,
    required this.onPost,
    required this.onCancel,
  });

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.viewPaddingOf(context).bottom;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: context.mobileTokens.paper,
        border: Border(top: BorderSide(color: context.mobileTokens.line)),
      ),
      child: Padding(
        padding: EdgeInsets.fromLTRB(16, 12, 16, bottom + 37),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 8),
            SizedBox(
              width: double.infinity,
              height: 44,
              child: FilledButton(
                onPressed: canPost ? onPost : null,
                style: FilledButton.styleFrom(
                  backgroundColor: _r19ForumPrimary,
                  foregroundColor: Colors.white,
                  disabledBackgroundColor: _r19ForumPrimary.withValues(
                    alpha: 0.4,
                  ),
                  disabledForegroundColor: Colors.white.withValues(alpha: 0.65),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(8),
                  ),
                ),
                child: Text(
                  isPosting
                      ? 'Posting…'
                      : hasFailed
                      ? 'Retry post'
                      : 'Post',
                ),
              ),
            ),
            if (!isPosting) ...[
              const SizedBox(height: 8),
              TextButton(
                onPressed: onCancel,
                style: TextButton.styleFrom(
                  foregroundColor: context.mobileTokens.action,
                  textStyle: context.mobileTypography.body.copyWith(
                    fontSize: 12,
                  ),
                ),
                child: const Text('Cancel'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _DiscardPostContent extends StatelessWidget {
  final double topInset;
  final String title;
  final String body;
  final int attachmentCount;
  final VoidCallback onKeepEditing;
  final VoidCallback onDiscard;

  const _DiscardPostContent({
    required this.topInset,
    required this.title,
    required this.body,
    required this.attachmentCount,
    required this.onKeepEditing,
    required this.onDiscard,
  });

  @override
  Widget build(BuildContext context) {
    final nonEmptyTitle = title.trim().isEmpty ? 'Untitled post' : title.trim();
    final trimmedBody = body.trim();
    final summaryBody = trimmedBody.isEmpty
        ? 'No text added yet'
        : '${trimmedBody.length > 110 ? trimmedBody.substring(0, 110) : trimmedBody}'
              '${trimmedBody.length > 110 ? '…' : ''}';
    return Column(
      children: [
        Expanded(
          child: ListView(
            padding: EdgeInsets.fromLTRB(20, topInset + 20, 20, Grid.md),
            children: [
              Align(
                alignment: Alignment.centerLeft,
                child: SizedBox(
                  width: 50,
                  height: 50,
                  child: Container(
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: _r19ForumDraftTint,
                      borderRadius: BorderRadius.circular(13),
                    ),
                    child: Icon(
                      LucideIcons.file,
                      size: 19,
                      color: context.mobileTokens.ink,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: Grid.sm),
              Text(
                'Discard this post?',
                style: context.mobileTypography.body.copyWith(
                  color: context.mobileTokens.ink,
                  fontSize: 24,
                  fontWeight: FontWeight.w700,
                  height: 1.3,
                  letterSpacing: -0.8,
                ),
              ),
              const SizedBox(height: 17),
              Text(
                'Your title, text and attachments will be removed from this draft.',
                style: context.mobileTypography.body.copyWith(
                  color: context.mobileTokens.muted,
                  fontSize: 14,
                  height: 1.7,
                ),
              ),
              const SizedBox(height: Grid.twentyEight),
              Container(
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: context.mobileTokens.paper,
                  border: Border.all(color: context.mobileTokens.line),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      nonEmptyTitle,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: context.mobileTypography.body.copyWith(
                        color: context.mobileTokens.ink,
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: Grid.xxs),
                    Text(
                      summaryBody,
                      maxLines: 4,
                      overflow: TextOverflow.ellipsis,
                      style: context.mobileTypography.body.copyWith(
                        color: context.mobileTokens.muted,
                        fontSize: 13,
                        height: 1.8,
                      ),
                    ),
                    const SizedBox(height: Grid.xs),
                    Text(
                      '$attachmentCount ${attachmentCount == 1 ? 'attachment' : 'attachments'}',
                      style: context.mobileTypography.body.copyWith(
                        color: context.mobileTokens.muted,
                        fontSize: 11,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        DecoratedBox(
          decoration: BoxDecoration(
            color: context.mobileTokens.paper,
            border: Border(top: BorderSide(color: context.mobileTokens.line)),
          ),
          child: Padding(
            padding: EdgeInsets.fromLTRB(
              16,
              12,
              16,
              MediaQuery.viewPaddingOf(context).bottom + 44,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const SizedBox(height: 8),
                SizedBox(
                  height: 44,
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: onKeepEditing,
                    style: FilledButton.styleFrom(
                      backgroundColor: _r19ForumPrimary,
                      foregroundColor: Colors.white,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8),
                      ),
                    ),
                    child: const Text('Keep editing'),
                  ),
                ),
                const SizedBox(height: 8),
                SizedBox(
                  height: 44,
                  width: double.infinity,
                  child: TextButton(
                    onPressed: onDiscard,
                    style: TextButton.styleFrom(
                      foregroundColor: _r19ForumDanger,
                      backgroundColor: context.mobileTokens.soft,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8),
                      ),
                    ),
                    child: const Text('Discard post'),
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
