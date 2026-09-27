import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../shared/theme/theme.dart';
import 'today_models.dart';

enum TodaySection { forYou, updates }

typedef TodayUpdatesPageBuilder =
    Widget Function(BuildContext context, bool showPublishedNotice);

class TodayPage extends HookConsumerWidget {
  const TodayPage({
    required this.communityName,
    required this.profileName,
    required this.reviewItems,
    required this.teamUpdate,
    required this.updatesPageBuilder,
    required this.onOpenReview,
    required this.onOpenUpdate,
    this.onOpenActivity,
    this.communityIconUrl,
    this.initialSection = TodaySection.forYou,
    this.initiallyPublished = false,
    this.now,
    super.key,
  });

  final String? communityName;
  final String? profileName;
  final String? communityIconUrl;
  final AsyncValue<List<TodayReviewItem>> reviewItems;
  final AsyncValue<TodayTeamUpdate?> teamUpdate;
  final TodayUpdatesPageBuilder updatesPageBuilder;
  final ValueChanged<String> onOpenReview;
  final ValueChanged<String> onOpenUpdate;
  final ValueChanged<BuildContext>? onOpenActivity;
  final TodaySection initialSection;
  final bool initiallyPublished;
  final DateTime? now;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final selected = useState(initialSection);
    final showPublishedNotice = useState(initiallyPublished);
    final mediaPadding = MediaQuery.paddingOf(context);
    final displayName = profileName?.trim();
    final greetingName = displayName?.isNotEmpty == true
        ? displayName!.split(RegExp(r'\s+')).first
        : null;
    final date = DateFormat('EEEE, d MMMM').format(now ?? DateTime.now());

    return ColoredBox(
      color: context.mobileTokens.paper,
      child: Column(
        children: [
          SafeArea(
            bottom: false,
            child: _TodayHeader(
              communityName: communityName,
              communityIconUrl: communityIconUrl,
            ),
          ),
          _TodayTabs(
            selected: selected.value,
            onSelected: (next) {
              selected.value = next;
              if (next != TodaySection.updates) {
                showPublishedNotice.value = false;
              }
            },
          ),
          Expanded(
            child: selected.value == TodaySection.updates
                ? updatesPageBuilder(context, showPublishedNotice.value)
                : _TodayForYou(
                    date: date,
                    displayName: greetingName,
                    reviewItems: reviewItems,
                    teamUpdate: teamUpdate,
                    onOpenReview: onOpenReview,
                    onOpenUpdate: onOpenUpdate,
                    onOpenActivity: onOpenActivity,
                    bottomPadding: mediaPadding.bottom,
                  ),
          ),
        ],
      ),
    );
  }
}

class _TodayHeader extends StatelessWidget {
  const _TodayHeader({this.communityName, this.communityIconUrl});

  final String? communityName;
  final String? communityIconUrl;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    final name = communityName?.trim() ?? '';
    final initials = _communityInitials(name);

    return Container(
      height: 66,
      padding: const EdgeInsets.symmetric(horizontal: Grid.xs),
      decoration: BoxDecoration(
        color: tokens.paper,
        border: Border(bottom: BorderSide(color: tokens.line)),
      ),
      child: Row(
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(Radii.sm),
            child: SizedBox(
              width: 34,
              height: 34,
              child: communityIconUrl == null
                  ? _WorkspaceInitials(initials: initials)
                  : Image.network(
                      communityIconUrl!,
                      fit: BoxFit.cover,
                      errorBuilder: (_, _, _) =>
                          _WorkspaceInitials(initials: initials),
                    ),
            ),
          ),
          const SizedBox(width: Grid.xxs),
          Text(
            'Today',
            style: context.textTheme.titleMedium?.copyWith(
              color: tokens.ink,
              fontSize: 16,
              fontWeight: FontWeight.w700,
              letterSpacing: -0.35,
            ),
          ),
        ],
      ),
    );
  }
}

class _WorkspaceInitials extends StatelessWidget {
  const _WorkspaceInitials({required this.initials});

  final String initials;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: const Color(0xffe4ede5),
      child: Center(
        child: Text(
          initials,
          style: context.textTheme.labelSmall?.copyWith(
            color: const Color(0xff63826c),
            fontSize: 10,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
    );
  }
}

class _TodayTabs extends StatelessWidget {
  const _TodayTabs({required this.selected, required this.onSelected});

  final TodaySection selected;
  final ValueChanged<TodaySection> onSelected;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Container(
      height: 56,
      padding: const EdgeInsets.symmetric(horizontal: Grid.gutter),
      decoration: BoxDecoration(
        color: tokens.paper,
        border: Border(bottom: BorderSide(color: tokens.line)),
      ),
      child: Align(
        alignment: Alignment.bottomLeft,
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            _TodayTab(
              label: 'For you',
              selected: selected == TodaySection.forYou,
              onTap: () => onSelected(TodaySection.forYou),
            ),
            _TodayTab(
              label: 'Updates',
              selected: selected == TodaySection.updates,
              onTap: () => onSelected(TodaySection.updates),
            ),
          ],
        ),
      ),
    );
  }
}

class _TodayTab extends StatelessWidget {
  const _TodayTab({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Semantics(
      button: true,
      selected: selected,
      label: label,
      onTap: onTap,
      child: ExcludeSemantics(
        child: InkWell(
          onTap: onTap,
          child: Container(
            height: 41,
            padding: const EdgeInsets.symmetric(horizontal: Grid.half),
            alignment: Alignment.center,
            decoration: BoxDecoration(
              border: Border(
                bottom: BorderSide(
                  color: selected ? tokens.action : Colors.transparent,
                  width: 2,
                ),
              ),
            ),
            child: Text(
              label,
              style: context.textTheme.labelMedium?.copyWith(
                color: selected ? tokens.action : tokens.muted,
                fontSize: 11,
                fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _TodayForYou extends StatelessWidget {
  const _TodayForYou({
    required this.date,
    required this.displayName,
    required this.reviewItems,
    required this.teamUpdate,
    required this.onOpenReview,
    required this.onOpenUpdate,
    required this.onOpenActivity,
    required this.bottomPadding,
  });

  final String date;
  final String? displayName;
  final AsyncValue<List<TodayReviewItem>> reviewItems;
  final AsyncValue<TodayTeamUpdate?> teamUpdate;
  final ValueChanged<String> onOpenReview;
  final ValueChanged<String> onOpenUpdate;
  final ValueChanged<BuildContext>? onOpenActivity;
  final double bottomPadding;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: EdgeInsets.fromLTRB(
        Grid.gutter,
        Grid.xxs,
        Grid.gutter,
        bottomPadding + Grid.gutter,
      ),
      children: [
        Text(
          displayName == null ? 'Good morning.' : 'Good morning, $displayName.',
          style: context.textTheme.headlineSmall?.copyWith(
            color: context.mobileTokens.ink,
            fontSize: 26,
            fontWeight: FontWeight.w700,
            letterSpacing: -0.9,
            height: 1.25,
          ),
        ),
        const SizedBox(height: Grid.half),
        Text(
          date,
          style: context.textTheme.bodySmall?.copyWith(
            color: context.mobileTokens.muted,
            fontSize: 12,
          ),
        ),
        const SizedBox(height: Grid.lg - 14),
        Row(
          children: [
            const _SectionLabel('Needs your review'),
            const Spacer(),
            if (onOpenActivity != null)
              _ActivityShortcut(onTap: () => onOpenActivity!(context)),
          ],
        ),
        const SizedBox(height: Grid.xxs),
        reviewItems.when(
          loading: () => const SizedBox.shrink(),
          error: (_, _) => const SizedBox.shrink(),
          data: (items) => items.isEmpty
              ? const SizedBox.shrink()
              : Column(
                  children: [
                    for (final item in items.take(3))
                      _ReviewRow(
                        item: item,
                        onTap: () => onOpenReview(item.id),
                      ),
                  ],
                ),
        ),
        const SizedBox(height: Grid.md - Grid.xxs),
        const _SectionLabel('Your team'),
        const SizedBox(height: Grid.xxs),
        teamUpdate.when(
          loading: () => const SizedBox.shrink(),
          error: (_, _) => const SizedBox.shrink(),
          data: (item) => item == null
              ? const SizedBox.shrink()
              : _TeamUpdateRow(item: item, onTap: () => onOpenUpdate(item.id)),
        ),
      ],
    );
  }
}

class _ActivityShortcut extends StatelessWidget {
  const _ActivityShortcut({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Semantics(
      button: true,
      label: 'Activity',
      onTap: onTap,
      child: ExcludeSemantics(
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 44),
          child: InkWell(
            onTap: onTap,
            borderRadius: BorderRadius.circular(Radii.sm),
            child: Center(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: Grid.xxs),
                child: Text(
                  'Activity',
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
      ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.label);

  final String label;

  @override
  Widget build(BuildContext context) => Text(
    label.toUpperCase(),
    style: context.textTheme.labelSmall?.copyWith(
      color: context.mobileTokens.muted,
      fontSize: 9,
      fontWeight: FontWeight.w700,
      letterSpacing: 1.05,
    ),
  );
}

class _ReviewRow extends StatelessWidget {
  const _ReviewRow({required this.item, required this.onTap});

  final TodayReviewItem item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return _TodayRow(
      onTap: onTap,
      leading: Icon(LucideIcons.image, size: 18, color: tokens.ink),
      title: item.title,
      subtitle: item.subtitle,
    );
  }
}

class _TeamUpdateRow extends StatelessWidget {
  const _TeamUpdateRow({required this.item, required this.onTap});

  final TodayTeamUpdate item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => _TodayRow(
    onTap: onTap,
    leading: _PersonInitials(initials: item.initials),
    title: item.title,
    subtitle: item.subtitle,
  );
}

class _PersonInitials extends StatelessWidget {
  const _PersonInitials({required this.initials});

  final String initials;

  @override
  Widget build(BuildContext context) => Container(
    width: 34,
    height: 34,
    alignment: Alignment.center,
    decoration: BoxDecoration(
      color: const Color(0xfff4e6df),
      borderRadius: BorderRadius.circular(Radii.sm),
    ),
    child: Text(
      initials,
      style: context.textTheme.labelSmall?.copyWith(
        color: const Color(0xff98715e),
        fontSize: 10,
        fontWeight: FontWeight.w700,
      ),
    ),
  );
}

class _TodayRow extends StatelessWidget {
  const _TodayRow({
    required this.onTap,
    required this.leading,
    required this.title,
    required this.subtitle,
  });

  final VoidCallback onTap;
  final Widget leading;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return InkWell(
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
    );
  }
}

String _communityInitials(String name) {
  final words = name
      .trim()
      .split(RegExp(r'\s+'))
      .where((part) => part.isNotEmpty);
  final initials = words.take(2).map((word) => word[0]).join();
  return initials.isEmpty ? '•' : initials.toLowerCase();
}
