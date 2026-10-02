import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../shared/company/goals/goal_records.dart';
import '../../shared/identity/identity_components.dart';
import '../../shared/profile/user_cache_provider.dart';
import '../../shared/theme/theme.dart';
import '../../shared/utils/string_utils.dart';

class GoalPageHeader extends StatelessWidget {
  const GoalPageHeader({
    required this.title,
    this.subtitle,
    this.onBack,
    this.backLabel = 'Back',
    this.action,
    this.actionLabel,
    this.actionIcon = LucideIcons.plus,
    super.key,
  });

  final String title;
  final String? subtitle;
  final VoidCallback? onBack;
  final String backLabel;
  final VoidCallback? action;
  final String? actionLabel;
  final IconData actionIcon;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    final typography = context.mobileTypography;
    return SafeArea(
      bottom: false,
      child: Container(
        height: 58,
        padding: const EdgeInsets.fromLTRB(15, 4, 15, 10),
        color: tokens.canvas,
        child: Row(
          children: [
            if (onBack != null) ...[
              IconButton(
                key: const ValueKey('goal-page-back'),
                tooltip: backLabel,
                onPressed: onBack,
                icon: const Icon(
                  LucideIcons.chevronLeft,
                  size: Grid.xs + Grid.half,
                ),
                constraints: const BoxConstraints.tightFor(
                  width: MobileLayoutTokens.minimumTapTarget,
                  height: MobileLayoutTokens.minimumTapTarget,
                ),
                padding: EdgeInsets.zero,
                style: _goalHeaderButtonStyle(context),
              ),
              const SizedBox(width: 8),
            ],
            Expanded(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: typography.companyHubTitle.copyWith(
                      color: tokens.ink,
                      fontSize: 15,
                      height: 1.35,
                    ),
                  ),
                  if (subtitle?.isNotEmpty == true)
                    Text(
                      subtitle!,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: typography.companyHubSubtitle.copyWith(
                        color: tokens.muted,
                        fontSize: 10,
                      ),
                    ),
                ],
              ),
            ),
            if (action != null)
              IconButton(
                key: const ValueKey('goal-page-action'),
                tooltip: actionLabel,
                onPressed: action,
                icon: Icon(actionIcon, size: Grid.xs + Grid.half),
                constraints: const BoxConstraints.tightFor(
                  width: MobileLayoutTokens.minimumTapTarget,
                  height: MobileLayoutTokens.minimumTapTarget,
                ),
                padding: EdgeInsets.zero,
                style: _goalHeaderButtonStyle(context),
              )
            else
              const SizedBox(width: MobileLayoutTokens.minimumTapTarget),
          ],
        ),
      ),
    );
  }
}

ButtonStyle _goalHeaderButtonStyle(BuildContext context) {
  final tokens = context.mobileTokens;
  return IconButton.styleFrom(
    backgroundColor: tokens.paper,
    foregroundColor: tokens.ink,
    minimumSize: Size.square(MobileLayoutTokens.minimumTapTarget),
    padding: EdgeInsets.zero,
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(Radii.button),
      side: BorderSide(color: tokens.line),
    ),
  );
}

class GoalStatusPill extends StatelessWidget {
  const GoalStatusPill({required this.status, super.key});

  final GoalStatus status;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    final (background, foreground, label) = switch (status) {
      GoalStatus.active => (tokens.success, tokens.ink, 'On track'),
      GoalStatus.offPace => (tokens.warning, tokens.ink, 'Needs attention'),
      GoalStatus.achieved => (tokens.success, tokens.ink, 'Achieved'),
      GoalStatus.archived => (tokens.soft, tokens.muted, 'Archived'),
      GoalStatus.deleted => (tokens.error, tokens.ink, 'Deleted goal'),
    };
    return DecoratedBox(
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(Radii.tag),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: MobileLayoutTokens.goalCardChipHorizontalPadding,
          vertical: MobileLayoutTokens.goalCardChipVerticalPadding,
        ),
        child: Text(
          label,
          style: context.mobileTypography.goalCardChip.copyWith(
            color: foreground,
          ),
        ),
      ),
    );
  }
}

class GoalProgressMeter extends StatelessWidget {
  const GoalProgressMeter({required this.head, super.key});

  final GoalHead head;

  @override
  Widget build(BuildContext context) {
    final ratio = goalProgressRatio(head);
    if (ratio == null) return const SizedBox.shrink();
    final tokens = context.mobileTokens;
    final colors = context.appColors;
    return Semantics(
      label: 'Goal progress',
      value: '${(ratio * 100).round()}%',
      child: ExcludeSemantics(
        child: ClipRRect(
          borderRadius: BorderRadius.circular(Radii.full),
          child: SizedBox(
            height: MobileLayoutTokens.goalProgressHeight,
            child: LayoutBuilder(
              builder: (context, constraints) => Stack(
                fit: StackFit.expand,
                children: [
                  ColoredBox(
                    key: const ValueKey('goal-progress-track'),
                    color: tokens.soft,
                  ),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: SizedBox(
                      key: const ValueKey('goal-progress-fill'),
                      width: constraints.maxWidth * ratio,
                      height: MobileLayoutTokens.goalProgressHeight,
                      child: DecoratedBox(
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            colors: [colors.lilac, colors.apricot],
                          ),
                        ),
                      ),
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

class GoalOwnerLine extends ConsumerWidget {
  const GoalOwnerLine({required this.pubkey, this.dueDate, super.key});

  final String pubkey;
  final String? dueDate;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tokens = context.mobileTokens;
    final normalized = pubkey.toLowerCase();
    final profile = ref.watch(
      userCacheProvider.select((profiles) => profiles[normalized]),
    );
    if (profile == null) {
      ref.read(userCacheProvider.notifier).get(normalized);
    }
    final displayName = profile?.label ?? shortPubkey(normalized);
    final initials =
        profile?.initials ?? normalized.substring(0, 1).toUpperCase();
    return Column(
      children: [
        _GoalInfoRow(
          label: 'Owner',
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              IdentityAvatar(
                initials: initials,
                kind: profile?.isAgent == true
                    ? IdentityKind.agent
                    : IdentityKind.person,
                imageUrl: profile?.avatarUrl,
                size: Grid.twentyEight,
                roundedSquare: true,
                semanticLabel: displayName,
              ),
              const SizedBox(width: Grid.xxs),
              Text(
                displayName,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: context.mobileTypography.identityName.copyWith(
                  color: tokens.ink,
                ),
              ),
            ],
          ),
        ),
        if (dueDate?.isNotEmpty == true)
          _GoalInfoRow(
            label: 'Due',
            child: Text(
              _longDueDate(dueDate!),
              style: context.mobileTypography.identityName.copyWith(
                color: tokens.ink,
              ),
            ),
          ),
      ],
    );
  }
}

class _GoalInfoRow extends StatelessWidget {
  const _GoalInfoRow({required this.label, required this.child});

  final String label;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Container(
      padding: const EdgeInsets.symmetric(
        vertical: MobileLayoutTokens.goalInfoRowPadding,
      ),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: tokens.line)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: context.mobileTypography.metadata.copyWith(
                color: tokens.muted,
              ),
            ),
          ),
          child,
        ],
      ),
    );
  }
}

class GoalLoadError extends StatelessWidget {
  const GoalLoadError({required this.onRetry, super.key});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(Grid.gutter),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(LucideIcons.cloudOff, color: tokens.muted),
            const SizedBox(height: Grid.xxs),
            Text(
              'Goals are unavailable right now.',
              textAlign: TextAlign.center,
              style: context.mobileTypography.body.copyWith(color: tokens.ink),
            ),
            const SizedBox(height: Grid.xxs),
            TextButton(onPressed: onRetry, child: const Text('Try again')),
          ],
        ),
      ),
    );
  }
}

String _longDueDate(String dueDate) {
  final parsed = DateTime.tryParse(dueDate);
  if (parsed == null) return dueDate;
  return '${parsed.day} ${_longMonths[parsed.month - 1]}';
}

const _longMonths = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
