import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../shared/identity/identity_components.dart';
import '../../shared/theme/theme.dart';
import 'today_models.dart';

class TodayPage extends StatelessWidget {
  const TodayPage({
    required this.communityName,
    required this.profileName,
    required this.reviewItems,
    required this.movingItems,
    required this.teamUpdate,
    required this.overviewMetrics,
    required this.onOpenUpdates,
    required this.onOpenReview,
    required this.onOpenProgress,
    required this.onOpenUpdate,
    required this.onOpenActivity,
    required this.onRetryActivity,
    this.onOpenConversations,
    this.now,
    super.key,
  });

  final String? communityName;
  final String? profileName;
  final AsyncValue<List<TodayReviewItem>> reviewItems;
  final AsyncValue<List<TodayProgressItem>> movingItems;
  final AsyncValue<TodayTeamUpdate?> teamUpdate;
  final List<TodayOverviewMetric> overviewMetrics;
  final ValueChanged<BuildContext> onOpenUpdates;
  final ValueChanged<String> onOpenReview;
  final ValueChanged<String> onOpenProgress;
  final ValueChanged<String> onOpenUpdate;
  final ValueChanged<BuildContext> onOpenActivity;
  final Future<void> Function() onRetryActivity;
  final ValueChanged<BuildContext>? onOpenConversations;
  final DateTime? now;

  @override
  Widget build(BuildContext context) {
    final mediaPadding = MediaQuery.paddingOf(context);
    final date = DateFormat(
      'EEEE, d MMMM',
    ).format(now ?? DateTime.now()).toUpperCase();
    final normalizedName = profileName?.trim();
    final firstName = normalizedName?.isNotEmpty == true
        ? normalizedName!.split(RegExp(r'\s+')).first
        : null;

    final loaded =
        !reviewItems.isLoading &&
        !movingItems.isLoading &&
        !teamUpdate.isLoading;
    final unavailable =
        reviewItems.hasError || movingItems.hasError || teamUpdate.hasError;
    final hasContent =
        (reviewItems.asData?.value.isNotEmpty ?? false) ||
        (movingItems.asData?.value.isNotEmpty ?? false) ||
        teamUpdate.asData?.value != null;

    return ColoredBox(
      color: context.mobileTokens.canvas,
      child: Column(
        children: [
          SafeArea(
            bottom: false,
            child: _TodayHeader(
              communityName: communityName,
              onOpenUpdates: onOpenUpdates,
            ),
          ),
          Expanded(
            child: unavailable
                ? _TodayUnavailableState(
                    onRetry: onRetryActivity,
                    bottomPadding: mediaPadding.bottom,
                  )
                : !loaded
                ? const Center(child: CircularProgressIndicator.adaptive())
                : !hasContent
                ? _TodayEmptyState(
                    onOpenConversations: onOpenConversations,
                    bottomPadding: mediaPadding.bottom,
                  )
                : ListView(
                    padding: EdgeInsets.fromLTRB(
                      Grid.gutter,
                      Grid.half,
                      Grid.gutter,
                      mediaPadding.bottom + Grid.gutter,
                    ),
                    children: [
                      _DayOverviewCard(
                        date: date,
                        greeting: firstName == null
                            ? 'Morning.\nLet’s make it happen.'
                            : 'Morning, $firstName.\nLet’s make it happen.',
                        metrics: overviewMetrics,
                      ),
                      _NeedsYourEyeSection(
                        items: reviewItems,
                        onOpenActivity: onOpenActivity,
                        onOpenReview: onOpenReview,
                        onRetry: onRetryActivity,
                      ),
                      _MovingForwardSection(
                        items: movingItems,
                        teamUpdate: teamUpdate,
                        onOpenActivity: onOpenActivity,
                        onOpenProgress: onOpenProgress,
                        onOpenUpdate: onOpenUpdate,
                        onRetry: onRetryActivity,
                      ),
                    ],
                  ),
          ),
        ],
      ),
    );
  }
}

class _TodayHeader extends StatelessWidget {
  const _TodayHeader({
    required this.communityName,
    required this.onOpenUpdates,
  });

  final String? communityName;
  final ValueChanged<BuildContext> onOpenUpdates;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    final name = communityName?.trim();
    return Container(
      key: const ValueKey('today-header'),
      height: 58,
      padding: const EdgeInsets.symmetric(horizontal: Grid.twelve),
      decoration: BoxDecoration(color: tokens.paper),
      child: Row(
        children: [
          IconButton(
            key: const ValueKey('today-back'),
            tooltip: 'Back',
            onPressed: () => Navigator.of(context).maybePop(),
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
                  'Your day',
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
          _HeaderAction(
            semanticLabel: 'Open team updates',
            icon: LucideIcons.plus,
            onTap: () => onOpenUpdates(context),
          ),
        ],
      ),
    );
  }
}

class _TodayEmptyState extends StatelessWidget {
  const _TodayEmptyState({
    required this.onOpenConversations,
    required this.bottomPadding,
  });

  final ValueChanged<BuildContext>? onOpenConversations;
  final double bottomPadding;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return ListView(
      padding: EdgeInsets.fromLTRB(
        Grid.gutter,
        Grid.xs,
        Grid.gutter,
        bottomPadding + Grid.gutter,
      ),
      children: [
        _QuietMomentCard(
          eyebrow: 'A CLEAR START',
          title: 'Room for\nwhat’s next.',
        ),
        const SizedBox(height: 50),
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
          'Nothing needs you right now',
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
          'New work and decisions will appear here when the workspace has something to show.',
          textAlign: TextAlign.center,
          style: context.textTheme.bodySmall?.copyWith(
            color: tokens.muted,
            fontSize: 12,
            height: 1.65,
          ),
        ),
        const SizedBox(height: Grid.sm + 13),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10),
          child: _FeedActionButton(
            label: 'Open conversations',
            onPressed: onOpenConversations == null
                ? null
                : () => onOpenConversations!(context),
          ),
        ),
      ],
    );
  }
}

class _TodayUnavailableState extends StatelessWidget {
  const _TodayUnavailableState({
    required this.onRetry,
    required this.bottomPadding,
  });

  final Future<void> Function() onRetry;
  final double bottomPadding;

  @override
  Widget build(BuildContext context) => _FeedUnavailableState(
    title: 'Could not load your day',
    onRetry: onRetry,
    bottomPadding: bottomPadding,
    topPadding: 63,
  );
}

class _FeedUnavailableState extends StatelessWidget {
  const _FeedUnavailableState({
    required this.title,
    required this.onRetry,
    required this.bottomPadding,
    required this.topPadding,
  });

  final String title;
  final Future<void> Function() onRetry;
  final double bottomPadding;
  final double topPadding;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return SingleChildScrollView(
      padding: EdgeInsets.fromLTRB(
        Grid.gutter,
        topPadding,
        Grid.gutter,
        bottomPadding + Grid.gutter,
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
            title,
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
            child: _FeedActionButton(
              label: 'Retry connection',
              onPressed: () => onRetry(),
            ),
          ),
        ],
      ),
    );
  }
}

class _QuietMomentCard extends StatelessWidget {
  const _QuietMomentCard({required this.eyebrow, required this.title});

  final String eyebrow;
  final String title;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      padding: const EdgeInsets.fromLTRB(22, 20, 22, 48),
      decoration: BoxDecoration(
        gradient: isDark
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
            eyebrow,
            style: context.textTheme.labelSmall?.copyWith(
              color: tokens.ink.withValues(alpha: 0.78),
              fontSize: 9,
              letterSpacing: 1.1,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: Grid.xxs),
          Text(
            title,
            style: context.mobileTypography.flowTitle.copyWith(
              color: tokens.ink,
              fontSize: 27,
              height: 1.15,
              letterSpacing: -0.8,
            ),
          ),
        ],
      ),
    );
  }
}

class _FeedActionButton extends StatelessWidget {
  const _FeedActionButton({required this.label, required this.onPressed});

  final String label;
  final VoidCallback? onPressed;

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

class _HeaderAction extends StatelessWidget {
  const _HeaderAction({
    required this.semanticLabel,
    required this.icon,
    required this.onTap,
  });

  final String semanticLabel;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return IconButton(
      key: ValueKey('today-action-$semanticLabel'),
      tooltip: semanticLabel,
      onPressed: onTap,
      style: IconButton.styleFrom(
        foregroundColor: tokens.ink,
        backgroundColor: tokens.paper,
        fixedSize: const Size(42, 42),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.button),
          side: BorderSide(color: tokens.line),
        ),
      ),
      icon: Icon(icon, size: 19),
    );
  }
}

class _DayOverviewCard extends StatelessWidget {
  const _DayOverviewCard({
    required this.date,
    required this.greeting,
    required this.metrics,
  });

  final String date;
  final String greeting;
  final List<TodayOverviewMetric> metrics;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const ValueKey('today-day-overview'),
      margin: const EdgeInsets.only(top: 7, bottom: 27),
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(27),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFFEAC6E0), Color(0xFFD9C2EA)],
        ),
      ),
      child: Stack(
        children: [
          const Positioned.fill(
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: RadialGradient(
                  center: Alignment(0.88, -0.76),
                  radius: 1.2,
                  colors: [Color(0xFFF9CCA9), Color(0x00F9CCA9)],
                  stops: [0, 0.64],
                ),
              ),
            ),
          ),
          const Positioned.fill(
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: RadialGradient(
                  center: Alignment(-0.9, 1),
                  radius: 1.35,
                  colors: [Color(0xFFAA94D9), Color(0x00AA94D9)],
                  stops: [0, 0.74],
                ),
              ),
            ),
          ),
          Positioned(
            right: -95,
            top: 30,
            child: Container(
              width: 180,
              height: 180,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(color: Colors.white.withValues(alpha: 0.4)),
                boxShadow: [
                  BoxShadow(
                    color: Colors.white.withValues(alpha: 0.04),
                    spreadRadius: 22,
                  ),
                  BoxShadow(
                    color: Colors.white.withValues(alpha: 0.04),
                    spreadRadius: 44,
                  ),
                ],
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(23, 22, 23, 21),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  date,
                  style: context.textTheme.labelSmall?.copyWith(
                    color: const Color(0xFF684674).withValues(alpha: 0.75),
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 13),
                Text(
                  greeting,
                  style: context.textTheme.headlineSmall?.copyWith(
                    color: const Color(0xFF4C2E5E),
                    fontSize: 28,
                    fontWeight: FontWeight.w700,
                    letterSpacing: -1.05,
                    height: 1.2,
                  ),
                ),
                if (metrics.isNotEmpty) ...[
                  const SizedBox(height: 20),
                  Wrap(
                    spacing: 23,
                    runSpacing: 12,
                    children: [
                      for (final metric in metrics)
                        _OverviewFigure(metric: metric),
                    ],
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _OverviewFigure extends StatelessWidget {
  const _OverviewFigure({required this.metric});

  final TodayOverviewMetric metric;

  @override
  Widget build(BuildContext context) {
    final content = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          metric.value,
          style: context.textTheme.headlineSmall?.copyWith(
            color: const Color(0xFF4C2E5E),
            fontSize: 24,
            fontWeight: FontWeight.w700,
            letterSpacing: -0.8,
          ),
        ),
        Text(
          metric.label,
          style: context.textTheme.bodySmall?.copyWith(
            color: const Color(0xFF684674).withValues(alpha: 0.82),
            fontSize: 10,
          ),
        ),
      ],
    );
    if (metric.onTap == null) return content;

    return Semantics(
      button: true,
      label: '${metric.value} ${metric.label}',
      onTap: metric.onTap,
      child: ExcludeSemantics(
        child: InkWell(
          key: ValueKey('today-metric-${metric.label}'),
          onTap: metric.onTap,
          borderRadius: BorderRadius.circular(Radii.sm),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: Grid.half),
            child: content,
          ),
        ),
      ),
    );
  }
}

class _NeedsYourEyeSection extends StatelessWidget {
  const _NeedsYourEyeSection({
    required this.items,
    required this.onOpenActivity,
    required this.onOpenReview,
    required this.onRetry,
  });

  final AsyncValue<List<TodayReviewItem>> items;
  final ValueChanged<BuildContext> onOpenActivity;
  final ValueChanged<String> onOpenReview;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    final data = items.asData?.value;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _SectionHeading(
          title: 'Needs your eye',
          count: data?.length,
          actionLabel: 'Activity',
          onAction: () => onOpenActivity(context),
        ),
        const SizedBox(height: 13),
        items.when(
          loading: () => const SizedBox.shrink(),
          error: (_, _) => _UnavailableRow(
            message: 'Approvals are unavailable.',
            actionLabel: 'Retry',
            onTap: () => onRetry(),
          ),
          data: (values) => values.isEmpty
              ? const _CaughtUpNote()
              : Column(
                  children: [
                    for (final item in values.take(3))
                      _ReviewCard(
                        item: item,
                        onTap: () => onOpenReview(item.id),
                      ),
                  ],
                ),
        ),
      ],
    );
  }
}

class _MovingForwardSection extends StatelessWidget {
  const _MovingForwardSection({
    required this.items,
    required this.teamUpdate,
    required this.onOpenActivity,
    required this.onOpenProgress,
    required this.onOpenUpdate,
    required this.onRetry,
  });

  final AsyncValue<List<TodayProgressItem>> items;
  final AsyncValue<TodayTeamUpdate?> teamUpdate;
  final ValueChanged<BuildContext> onOpenActivity;
  final ValueChanged<String> onOpenProgress;
  final ValueChanged<String> onOpenUpdate;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    final progress = items.asData?.value ?? const <TodayProgressItem>[];
    final update = teamUpdate.asData?.value;
    final visible = progress.isNotEmpty || update != null || items.hasError;
    if (!visible) return const SizedBox.shrink();

    return Padding(
      padding: const EdgeInsets.only(top: 9),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _SectionHeading(
            title: 'Moving forward',
            actionLabel: 'See all',
            onAction: () => onOpenActivity(context),
          ),
          const SizedBox(height: 9),
          if (items.hasError)
            _UnavailableRow(
              message: 'Progress activity is unavailable.',
              actionLabel: 'Retry',
              onTap: () => onRetry(),
            )
          else ...[
            for (final item in progress.take(3))
              _ProgressRow(item: item, onTap: () => onOpenProgress(item.id)),
          ],
          if (update != null)
            _TeamUpdateRow(item: update, onTap: () => onOpenUpdate(update.id)),
        ],
      ),
    );
  }
}

class _SectionHeading extends StatelessWidget {
  const _SectionHeading({
    required this.title,
    required this.actionLabel,
    required this.onAction,
    this.count,
  });

  final String title;
  final String actionLabel;
  final VoidCallback onAction;
  final int? count;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Row(
      children: [
        Flexible(
          child: Text(
            title,
            style: context.textTheme.titleSmall?.copyWith(
              color: tokens.ink,
              fontSize: 15,
              fontWeight: FontWeight.w700,
              letterSpacing: -0.35,
            ),
          ),
        ),
        if (count != null) ...[
          const SizedBox(width: 7),
          Container(
            constraints: const BoxConstraints(minWidth: 19, minHeight: 19),
            padding: const EdgeInsets.symmetric(horizontal: Grid.half),
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: tokens.soft,
              borderRadius: BorderRadius.circular(Radii.sm),
            ),
            child: Text(
              '$count',
              style: context.textTheme.labelSmall?.copyWith(
                color: tokens.action,
                fontSize: 10,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
        const Spacer(),
        Semantics(
          button: true,
          label: actionLabel,
          onTap: onAction,
          child: ExcludeSemantics(
            child: InkWell(
              key: ValueKey('today-section-action-$actionLabel'),
              onTap: onAction,
              borderRadius: BorderRadius.circular(Radii.sm),
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: Grid.xxs,
                  vertical: Grid.half,
                ),
                child: Text(
                  actionLabel,
                  style: context.mobileTypography.companyEntryDescription
                      .copyWith(
                        color: tokens.action,
                        fontWeight: FontWeight.w700,
                      ),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _ReviewCard extends StatelessWidget {
  const _ReviewCard({required this.item, required this.onTap});

  final TodayReviewItem item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Semantics(
      button: true,
      label: 'Review ${item.title}. ${item.subtitle}',
      onTap: onTap,
      child: ExcludeSemantics(
        child: Material(
          color: tokens.paper,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(21),
            side: BorderSide(color: tokens.line),
          ),
          child: InkWell(
            key: ValueKey('today-review-${item.id}'),
            borderRadius: BorderRadius.circular(21),
            onTap: onTap,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      IdentityAvatar(
                        initials: item.initials,
                        kind: item.requesterIsAgent
                            ? IdentityKind.agent
                            : IdentityKind.person,
                        size: 28,
                        semanticLabel: item.requesterName,
                        excludeSemantics: true,
                      ),
                      const SizedBox(width: Grid.xxs),
                      Expanded(
                        child: Text(
                          item.requesterName,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: context.textTheme.labelMedium?.copyWith(
                            color: tokens.ink,
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                      const SizedBox(width: Grid.xxs),
                      _ReadyTag(),
                    ],
                  ),
                  const SizedBox(height: 14),
                  Text(
                    item.title,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: context.textTheme.titleSmall?.copyWith(
                      color: tokens.ink,
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                      letterSpacing: -0.35,
                    ),
                  ),
                  const SizedBox(height: 7),
                  Text(
                    item.subtitle,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: context.textTheme.bodySmall?.copyWith(
                      color: tokens.muted,
                      fontSize: 11,
                      height: 1.6,
                    ),
                  ),
                  const SizedBox(height: 12),
                  Align(
                    alignment: Alignment.centerRight,
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          'Take a look',
                          style: context
                              .mobileTypography
                              .companyEntryDescription
                              .copyWith(
                                color: tokens.action,
                                fontWeight: FontWeight.w700,
                              ),
                        ),
                        const SizedBox(width: Grid.half),
                        Icon(
                          LucideIcons.arrowRight,
                          size: 16,
                          color: tokens.action,
                        ),
                      ],
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

class _ReadyTag extends StatelessWidget {
  const _ReadyTag();

  @override
  Widget build(BuildContext context) {
    final orange = context.appColors.warning;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
      decoration: BoxDecoration(
        color: orange.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(Radii.sm),
      ),
      child: Text(
        'Ready for review',
        style: context.textTheme.labelSmall?.copyWith(
          color: orange,
          fontSize: 9,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

class _CaughtUpNote extends StatelessWidget {
  const _CaughtUpNote();

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: Grid.xs, vertical: 16),
      decoration: BoxDecoration(
        color: context.appColors.success.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(Radii.compactCard),
      ),
      child: Row(
        children: [
          Icon(LucideIcons.check, size: 18, color: context.appColors.success),
          const SizedBox(width: Grid.xxs),
          Expanded(
            child: Text(
              'You’re all caught up.',
              style: context.textTheme.bodySmall?.copyWith(
                color: tokens.ink,
                fontSize: 12,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ProgressRow extends StatelessWidget {
  const _ProgressRow({required this.item, required this.onTap});

  final TodayProgressItem item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return _TodayRow(
      leading: IdentityAvatar(
        initials: item.initials,
        kind: item.isAgent ? IdentityKind.agent : IdentityKind.person,
        size: 34,
        excludeSemantics: true,
      ),
      title: item.title,
      subtitle: item.subtitle,
      onTap: onTap,
    );
  }
}

class _TeamUpdateRow extends StatelessWidget {
  const _TeamUpdateRow({required this.item, required this.onTap});

  final TodayTeamUpdate item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => _TodayRow(
    leading: IdentityAvatar(
      initials: item.initials,
      kind: IdentityKind.person,
      size: 34,
      excludeSemantics: true,
    ),
    title: item.title,
    subtitle: item.subtitle,
    onTap: onTap,
  );
}

class _TodayRow extends StatelessWidget {
  const _TodayRow({
    required this.leading,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final Widget leading;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Semantics(
      button: true,
      label: '$title. $subtitle',
      onTap: onTap,
      child: ExcludeSemantics(
        child: InkWell(
          onTap: onTap,
          child: Container(
            constraints: const BoxConstraints(minHeight: 68),
            padding: const EdgeInsets.symmetric(vertical: Grid.xxs),
            decoration: BoxDecoration(
              border: Border(bottom: BorderSide(color: tokens.line)),
            ),
            child: Row(
              children: [
                SizedBox(width: 36, child: Center(child: leading)),
                const SizedBox(width: Grid.xxs),
                Expanded(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
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
                        subtitle,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
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
        ),
      ),
    );
  }
}

class _UnavailableRow extends StatelessWidget {
  const _UnavailableRow({
    required this.message,
    required this.actionLabel,
    required this.onTap,
  });

  final String message;
  final String actionLabel;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: Grid.xxs),
      child: Row(
        children: [
          Expanded(
            child: Text(
              message,
              style: context.textTheme.bodySmall?.copyWith(
                color: tokens.muted,
                fontSize: 11,
              ),
            ),
          ),
          TextButton(onPressed: onTap, child: Text(actionLabel)),
        ],
      ),
    );
  }
}
