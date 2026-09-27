import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../shared/identity/identity_components.dart';
import '../../shared/profile/user_cache_provider.dart';
import '../../shared/profile/user_profile.dart';
import '../../shared/theme/theme.dart';
import '../../shared/utils/string_utils.dart';
import '../../shared/widgets/buzz_loading_indicator.dart';
import '../../shared/widgets/frosted_app_bar.dart';
import '../../shared/widgets/frosted_scaffold.dart';
import '../../shared/widgets/modal_presentation.dart';
import 'deliverable_business_records.dart';
import 'deliverable_review_provider.dart';

class DeliverableApprovalPage extends HookConsumerWidget {
  const DeliverableApprovalPage({required this.request, super.key});

  final DeliverableReviewRequest request;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final review = ref.watch(deliverableReviewProvider(request));
    final submitting = useState(false);
    final submitError = useState(false);
    Future<bool> submit(
      DeliverableApprovalDecision decision, {
      String? note,
    }) async {
      final bundle = review.asData?.value;
      final version = bundle?.version;
      if (version == null || bundle?.isAuthorized != true || submitting.value) {
        return false;
      }
      submitting.value = true;
      submitError.value = false;
      try {
        await ref
            .read(deliverableReviewRepositoryProvider)
            .submitDecision(
              request: request,
              version: version,
              decision: decision,
              note: note,
            );
        if (!context.mounted) return true;
        ref.invalidate(deliverableReviewProvider(request));
        return true;
      } catch (_) {
        submitError.value = true;
        return false;
      } finally {
        if (context.mounted) submitting.value = false;
      }
    }

    Future<void> openFeedback(DeliverableReviewBundle bundle) async {
      final sent = await showBuzzModalBottomSheet<bool>(
        context: context,
        title: 'What should change?',
        isScrollControlled: true,
        showDragHandle: true,
        builder: (sheetContext) => DeliverableFeedbackSheet(
          clientName: request.clientName,
          onSubmit: (text) async {
            final sent = await submit(
              DeliverableApprovalDecision.changesRequested,
              note: text,
            );
            if (!sent) throw StateError('Feedback could not be sent');
          },
          hasPermission: bundle.isAuthorized,
        ),
      );
      if (sent == true && context.mounted) {
        ref.invalidate(deliverableReviewProvider(request));
      }
    }

    Future<void> confirmApproval(DeliverableReviewBundle bundle) async {
      final version = bundle.version;
      if (version == null) return;
      final approved = await showBuzzModalBottomSheet<bool>(
        context: context,
        title: 'Approve this version?',
        showDragHandle: true,
        builder: (sheetContext) => _ApproveVersionSheet(
          version: version.version,
          onApprove: () => Navigator.of(sheetContext).pop(true),
        ),
      );
      if (approved == true) {
        await submit(DeliverableApprovalDecision.approved);
      }
    }

    Future<void> openReviewDetails() async {
      await showBuzzModalBottomSheet<void>(
        context: context,
        title: 'Keep the context close.',
        showDragHandle: true,
        builder: (sheetContext) => Padding(
          padding: const EdgeInsets.fromLTRB(
            Grid.gutter,
            0,
            Grid.gutter,
            Grid.xs,
          ),
          child: SizedBox(
            width: double.infinity,
            child: TextButton.icon(
              key: const ValueKey('deliverable-open-discussion'),
              onPressed: () async {
                await Navigator.of(sheetContext).maybePop();
                if (context.mounted) {
                  await Navigator.of(context).maybePop();
                }
              },
              style: TextButton.styleFrom(
                alignment: Alignment.centerLeft,
                padding: const EdgeInsets.symmetric(
                  horizontal: Grid.xs,
                  vertical: Grid.xs,
                ),
                backgroundColor: context.mobileTokens.actionSoft,
                foregroundColor: context.mobileTokens.onActionSoft,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(Radii.field),
                ),
              ),
              icon: const Icon(LucideIcons.messageCircle),
              label: const Text('Open the discussion'),
            ),
          ),
        ),
      );
    }

    final contentTop =
        frostedAppBarHeight(
          context,
          titleStyle: context.mobileTypography.companyHubTitle,
          titleContentHeight: MobileLayoutTokens.appBarHeight,
        ) +
        Grid.xs;

    return FrostedScaffold(
      backgroundColor: context.mobileTokens.canvas,
      appBar: FrostedAppBar(
        titleContentHeight: MobileLayoutTokens.appBarHeight,
        titleStyle: context.mobileTypography.companyHubTitle,
        iconColor: context.mobileTokens.ink,
        horizontalInset: Grid.xs - Grid.half,
        leading: IconButton(
          tooltip: 'Back',
          onPressed: () => Navigator.of(context).maybePop(),
          icon: const Icon(LucideIcons.chevronLeft),
        ),
        title: review.maybeWhen(
          data: (bundle) => _ReviewHeaderTitle(bundle: bundle),
          orElse: () => Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Content review',
                style: context.mobileTypography.companyHubTitle,
              ),
              Text(
                request.clientName,
                style: context.mobileTypography.identityDetails.copyWith(
                  color: context.mobileTokens.muted,
                ),
              ),
            ],
          ),
        ),
        actions: [
          IconButton(
            key: const ValueKey('deliverable-review-details-action'),
            tooltip: 'Review details',
            onPressed: () => unawaited(openReviewDetails()),
            icon: const Icon(LucideIcons.ellipsis),
          ),
        ],
      ),
      body: review.when(
        loading: () => const Center(child: BuzzLoadingIndicator()),
        error: (_, _) => _ReviewLoadError(
          onRetry: () => ref.invalidate(deliverableReviewProvider(request)),
        ),
        data: (bundle) {
          if (!bundle.isAvailable) {
            return _ReviewUnavailable(
              message:
                  bundle.unavailableReason ?? 'This version is unavailable.',
              onRetry: () => ref.invalidate(deliverableReviewProvider(request)),
            );
          }
          final version = bundle.version!;
          final head = bundle.head!;
          final title = version.title ?? head.title;
          final profile = ref.watch(
            userCacheProvider.select(
              (profiles) => profiles[version.event.pubkey.toLowerCase()],
            ),
          );
          if (profile == null) {
            ref.read(userCacheProvider.notifier).get(version.event.pubkey);
          }
          final alreadyDecided = bundle.latestApproval != null;
          final canReview = bundle.isAuthorized && !alreadyDecided;
          return ListView(
            key: const ValueKey('deliverable-review-content'),
            padding: EdgeInsets.fromLTRB(
              Grid.gutter,
              contentTop,
              Grid.gutter,
              MediaQuery.paddingOf(context).bottom + Grid.gutter,
            ),
            children: [
              _ReviewStatus(bundle: bundle),
              const SizedBox(height: Grid.xs),
              Text(
                title,
                style: context.mobileTypography.companyHubTitle.copyWith(
                  color: context.mobileTokens.ink,
                ),
              ),
              if (version.content case final content?) ...[
                const SizedBox(height: Grid.xs),
                Text(
                  content,
                  style: context.mobileTypography.body.copyWith(
                    color: context.mobileTokens.muted,
                  ),
                ),
              ],
              const SizedBox(height: Grid.xs),
              _PreparedByRow(profile: profile, pubkey: version.event.pubkey),
              if (bundle.isStale)
                _ReviewNotice(
                  text: bundle.currentPointer == null
                      ? 'This version is no longer current.'
                      : 'A newer version is now current.',
                  isError: true,
                )
              else if (!bundle.isAuthorized && !alreadyDecided)
                const _ReviewNotice(
                  text: 'You are not listed as an approver for this work item.',
                  isError: true,
                )
              else if (submitError.value)
                const _ReviewNotice(
                  text:
                      'Your decision could not be sent. You can retry it here.',
                  isError: true,
                ),
              if (alreadyDecided)
                _ReviewOutcome(approval: bundle.latestApproval!),
              if (canReview) ...[
                const SizedBox(height: Grid.xs),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        key: const ValueKey('deliverable-give-feedback'),
                        onPressed: submitting.value
                            ? null
                            : () => unawaited(openFeedback(bundle)),
                        child: const Text('Give feedback'),
                      ),
                    ),
                    const SizedBox(width: Grid.xs),
                    Expanded(
                      child: FilledButton(
                        key: const ValueKey('deliverable-approve-version'),
                        onPressed: submitting.value
                            ? null
                            : () => unawaited(confirmApproval(bundle)),
                        child: submitting.value
                            ? const BuzzLoadingIndicator()
                            : Text('Approve v${version.version}'),
                      ),
                    ),
                  ],
                ),
              ],
              const SizedBox(height: Grid.xs),
              Text(
                'Approval is for this version. It does not publish anything.',
                style: context.mobileTypography.metadata.copyWith(
                  color: context.mobileTokens.muted,
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _ReviewHeaderTitle extends StatelessWidget {
  const _ReviewHeaderTitle({required this.bundle});

  final DeliverableReviewBundle bundle;

  @override
  Widget build(BuildContext context) {
    final version = bundle.version;
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Content review',
          style: context.mobileTypography.companyHubTitle.copyWith(
            color: context.mobileTokens.ink,
          ),
        ),
        Text(
          '${bundle.request.clientName} · Version ${version?.version ?? ''}',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: context.mobileTypography.identityDetails.copyWith(
            color: context.mobileTokens.muted,
          ),
        ),
      ],
    );
  }
}

class _ReviewStatus extends StatelessWidget {
  const _ReviewStatus({required this.bundle});

  final DeliverableReviewBundle bundle;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    final isStale = bundle.isStale;
    final isApproved =
        bundle.latestApproval?.decision == DeliverableApprovalDecision.approved;
    final isError =
        isStale || (bundle.latestApproval == null && !bundle.isAuthorized);
    final background = isError
        ? tokens.error
        : isApproved
        ? tokens.success
        : tokens.warning;
    final foreground = isError
        ? tokens.ink
        : isApproved
        ? context.appColors.identitySageForeground
        : context.appColors.identityPersonForeground;
    return Align(
      alignment: Alignment.centerLeft,
      child: Container(
        padding: const EdgeInsets.symmetric(
          horizontal: Grid.xs,
          vertical: Grid.half,
        ),
        decoration: BoxDecoration(
          color: background,
          borderRadius: BorderRadius.circular(Radii.sm),
        ),
        child: Text(
          bundle.statusLabel ?? 'Review unavailable',
          style: context.mobileTypography.identityStatus.copyWith(
            color: foreground,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
    );
  }
}

class _PreparedByRow extends StatelessWidget {
  const _PreparedByRow({required this.profile, required this.pubkey});

  final UserProfile? profile;
  final String pubkey;

  @override
  Widget build(BuildContext context) {
    final isAgent = profile?.isAgent == true || profile?.ownerPubkey != null;
    final name = profile?.label ?? shortPubkey(pubkey);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: Grid.xxs),
      child: Row(
        children: [
          Expanded(
            child: Text(
              'Prepared by',
              style: context.mobileTypography.identityDetails.copyWith(
                color: context.mobileTokens.muted,
              ),
            ),
          ),
          IdentityAvatar(
            initials: profile?.initials ?? pubkey.substring(0, 1).toUpperCase(),
            kind: isAgent ? IdentityKind.agent : IdentityKind.person,
            imageUrl: profile?.avatarUrl,
            size: MobileLayoutTokens.minimumTapTarget - Grid.xs,
            excludeSemantics: true,
          ),
          const SizedBox(width: Grid.xxs),
          Text(
            isAgent ? '$name · AI agent' : name,
            style: context.mobileTypography.identityName.copyWith(
              color: context.mobileTokens.ink,
            ),
          ),
        ],
      ),
    );
  }
}

class _ReviewOutcome extends StatelessWidget {
  const _ReviewOutcome({required this.approval});

  final DeliverableApprovalRecord approval;

  @override
  Widget build(BuildContext context) {
    final note = approval.note?.trim();
    if (note == null || note.isEmpty) return const SizedBox.shrink();
    return _ReviewNotice(text: note, isError: false);
  }
}

class _ReviewNotice extends StatelessWidget {
  const _ReviewNotice({required this.text, required this.isError});

  final String text;
  final bool isError;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Container(
      margin: const EdgeInsets.only(top: Grid.xs),
      padding: const EdgeInsets.all(Grid.xs),
      decoration: BoxDecoration(
        color: isError ? tokens.error : tokens.success,
        borderRadius: BorderRadius.circular(Radii.md),
      ),
      child: Text(
        text,
        style: context.mobileTypography.body.copyWith(
          color: isError
              ? tokens.ink
              : context.appColors.identitySageForeground,
        ),
      ),
    );
  }
}

class _ReviewLoadError extends StatelessWidget {
  const _ReviewLoadError({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => _ReviewUnavailable(
    message: 'The review could not be loaded.',
    onRetry: onRetry,
  );
}

class _ReviewUnavailable extends StatelessWidget {
  const _ReviewUnavailable({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(Grid.gutter),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            message,
            textAlign: TextAlign.center,
            style: context.mobileTypography.body.copyWith(
              color: context.mobileTokens.muted,
            ),
          ),
          const SizedBox(height: Grid.xs),
          TextButton(onPressed: onRetry, child: const Text('Try again')),
        ],
      ),
    ),
  );
}

class _ApproveVersionSheet extends StatelessWidget {
  const _ApproveVersionSheet({required this.version, required this.onApprove});

  final int version;
  final VoidCallback onApprove;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(Grid.gutter, 0, Grid.gutter, Grid.xs),
    child: Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'Approve version $version. Any changes need a fresh review. No posts are published by this action.',
          style: context.mobileTypography.body.copyWith(
            color: context.mobileTokens.muted,
          ),
        ),
        const SizedBox(height: Grid.xs),
        FilledButton(
          key: const ValueKey('deliverable-confirm-approval'),
          onPressed: onApprove,
          child: Text('Approve version $version'),
        ),
      ],
    ),
  );
}

class DeliverableFeedbackSheet extends HookConsumerWidget {
  const DeliverableFeedbackSheet({
    required this.clientName,
    required this.onSubmit,
    required this.hasPermission,
    super.key,
  });

  final String clientName;
  final Future<void> Function(String text) onSubmit;
  final bool hasPermission;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final controller = useTextEditingController();
    final text = useValueListenable(controller);
    final submitting = useState(false);
    final failed = useState(false);

    Future<void> send() async {
      if (text.text.trim().isEmpty || submitting.value || !hasPermission) {
        return;
      }
      submitting.value = true;
      failed.value = false;
      try {
        await onSubmit(text.text.trim());
        if (context.mounted) Navigator.of(context).pop(true);
      } catch (_) {
        failed.value = true;
      } finally {
        if (context.mounted) submitting.value = false;
      }
    }

    return Padding(
      padding: EdgeInsets.fromLTRB(
        Grid.gutter,
        0,
        Grid.gutter,
        MediaQuery.viewInsetsOf(context).bottom + Grid.xs,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Your feedback will be recorded with this version. This version stays unapproved.',
            style: context.mobileTypography.body.copyWith(
              color: context.mobileTokens.muted,
            ),
          ),
          const SizedBox(height: Grid.xs),
          TextField(
            key: const ValueKey('deliverable-feedback-input'),
            controller: controller,
            autofocus: true,
            minLines: 3,
            maxLines: 5,
            decoration: const InputDecoration(
              labelText: 'Feedback',
              hintText: 'What should change?',
              alignLabelWithHint: true,
            ),
          ),
          if (failed.value)
            Padding(
              padding: const EdgeInsets.only(top: Grid.xs),
              child: Text(
                'Feedback could not be sent. Your text is still here.',
                key: const ValueKey('deliverable-feedback-failed'),
                style: context.mobileTypography.metadata.copyWith(
                  color: context.mobileTokens.error,
                ),
              ),
            ),
          const SizedBox(height: Grid.xs),
          FilledButton(
            key: const ValueKey('deliverable-send-feedback'),
            onPressed:
                hasPermission &&
                    text.text.trim().isNotEmpty &&
                    !submitting.value
                ? () => unawaited(send())
                : null,
            child: submitting.value
                ? const BuzzLoadingIndicator()
                : const Text('Send feedback'),
          ),
        ],
      ),
    );
  }
}
