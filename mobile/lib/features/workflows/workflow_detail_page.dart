import 'dart:async';

import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../shared/company/workflows/workflow_records.dart';
import '../../shared/profile/user_cache_provider.dart';
import '../../shared/profile/user_profile.dart';
import '../../shared/relay/nostr_models.dart';
import '../../shared/theme/theme.dart';
import '../../shared/utils/string_utils.dart';
import '../../shared/widgets/avatar_image.dart';

enum _WorkflowView { detail, pause, paused, denied }

/// Shows the current state of one relay-backed workflow record.
class WorkflowDetailPage extends ConsumerStatefulWidget {
  const WorkflowDetailPage({
    required this.record,
    required this.communityName,
    required this.channelName,
    required this.canChange,
    required this.onSetStatus,
    required this.onBack,
    this.onQuickActions,
    super.key,
  });

  final WorkflowRecord record;
  final String? communityName;
  final String? channelName;
  final bool canChange;
  final Future<NostrEvent> Function(
    WorkflowRecord record,
    WorkflowStatus status,
  )
  onSetStatus;
  final VoidCallback onBack;
  final VoidCallback? onQuickActions;

  @override
  ConsumerState<WorkflowDetailPage> createState() => _WorkflowDetailPageState();
}

class _WorkflowDetailPageState extends ConsumerState<WorkflowDetailPage> {
  late WorkflowRecord _record = widget.record;
  late _WorkflowView _view = _viewFor(widget.record.status);
  bool _submitting = false;

  @override
  void initState() {
    super.initState();
    _preloadStepProfiles(widget.record);
  }

  @override
  void didUpdateWidget(covariant WorkflowDetailPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.record.event.id != widget.record.event.id ||
        oldWidget.record.statusEvent?.id != widget.record.statusEvent?.id) {
      _record = widget.record;
      _view = _viewFor(widget.record.status);
      _preloadStepProfiles(widget.record);
    }
  }

  void _preloadStepProfiles(WorkflowRecord record) {
    final pubkeys = [
      for (final step in record.steps) ...[
        ?step.assigneePubkey,
        ?step.reviewerPubkey,
      ],
    ];
    if (pubkeys.isNotEmpty) {
      unawaited(ref.read(userCacheProvider.notifier).preload(pubkeys));
    }
  }

  Future<void> _changeStatus(WorkflowStatus status) async {
    if (_submitting) return;
    setState(() => _submitting = true);
    try {
      final event = await widget.onSetStatus(_record, status);
      if (!mounted) return;
      setState(() {
        _record = _record.withStatus(status, event);
        _view = _viewFor(status);
      });
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  void _requestStatus(WorkflowStatus status) {
    if (!widget.canChange) {
      setState(() => _view = _WorkflowView.denied);
      return;
    }
    if (status == WorkflowStatus.paused) {
      setState(() => _view = _WorkflowView.pause);
      return;
    }
    unawaited(_changeStatus(status));
  }

  @override
  Widget build(BuildContext context) {
    final profiles = ref.watch(userCacheProvider);
    final tokens = context.mobileTokens;
    return Material(
      color: tokens.canvas,
      child: Column(
        children: [
          _WorkflowHeader(
            title: _record.name,
            subtitle: widget.communityName,
            onBack: widget.onBack,
            onQuickActions: widget.onQuickActions,
          ),
          Expanded(
            child: switch (_view) {
              _WorkflowView.detail => _detailBody(context, profiles),
              _WorkflowView.pause => _pauseBody(context),
              _WorkflowView.paused => _pausedBody(context),
              _WorkflowView.denied => _deniedBody(context),
            },
          ),
        ],
      ),
    );
  }

  Widget _detailBody(BuildContext context, Map<String, UserProfile> profiles) {
    final tokens = context.mobileTokens;
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _WorkflowTriggerCard(
            record: _record,
            channelName: widget.channelName,
          ),
          if (_record.description?.isNotEmpty == true) ...[
            const SizedBox(height: 24),
            Text(
              _record.description!,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: tokens.muted,
                height: 1.55,
              ),
            ),
          ],
          const SizedBox(height: 18),
          for (var index = 0; index < _record.steps.length; index++) ...[
            if (index > 0) const SizedBox(height: 10),
            _WorkflowStepCard(
              index: index + 1,
              step: _record.steps[index],
              profiles: profiles,
            ),
          ],
          const SizedBox(height: 24),
          _WorkflowActionButton(
            key: const ValueKey('workflow-pause'),
            label: 'Pause workflow',
            onPressed: _submitting
                ? null
                : () => _requestStatus(WorkflowStatus.paused),
          ),
        ],
      ),
    );
  }

  Widget _pauseBody(BuildContext context) {
    final tokens = context.mobileTokens;
    final typography = Theme.of(context).textTheme;
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 60, 20, 28),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Align(
            child: Container(
              width: 68,
              height: 68,
              decoration: BoxDecoration(
                color: tokens.soft,
                borderRadius: BorderRadius.circular(24),
              ),
              child: Icon(Icons.work_outline_rounded, color: tokens.ink),
            ),
          ),
          const SizedBox(height: 18),
          Text(
            'Pause ${_record.name}?',
            textAlign: TextAlign.center,
            style: typography.headlineSmall?.copyWith(
              color: tokens.ink,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 12),
          Text(
            'Future runs stop. A run already waiting for approval stays visible.',
            textAlign: TextAlign.center,
            style: typography.bodyMedium?.copyWith(
              color: tokens.muted,
              height: 1.55,
            ),
          ),
          const SizedBox(height: 29),
          _WorkflowActionButton(
            key: const ValueKey('workflow-confirm-pause'),
            label: 'Confirm pause',
            height: 46,
            insetHorizontal: 10,
            onPressed: _submitting
                ? null
                : () => _changeStatus(WorkflowStatus.paused),
          ),
          const SizedBox(height: 57),
          _WorkflowActionButton(
            label: 'Keep workflow',
            secondary: true,
            height: 46,
            onPressed: _submitting
                ? null
                : () => setState(() => _view = _WorkflowView.detail),
          ),
        ],
      ),
    );
  }

  Widget _pausedBody(BuildContext context) {
    final tokens = context.mobileTokens;
    final typography = Theme.of(context).textTheme;
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 13, 20, 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            padding: const EdgeInsets.fromLTRB(22, 31, 22, 33),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [tokens.actionSoft, tokens.warning],
              ),
              borderRadius: BorderRadius.circular(22),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'STATUS UPDATED',
                  style: typography.labelSmall?.copyWith(
                    color: tokens.ink,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.7,
                  ),
                ),
                const SizedBox(height: 10),
                Text(
                  _record.name,
                  style: typography.headlineMedium?.copyWith(
                    color: tokens.ink,
                    fontWeight: FontWeight.w600,
                    height: 1.12,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 23),
          Container(
            padding: EdgeInsets.zero,
            decoration: BoxDecoration(
              color: tokens.paper,
              border: Border.all(color: tokens.line),
              borderRadius: BorderRadius.circular(16),
            ),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(16),
              child: Row(
                children: [
                  Container(
                    width: 3,
                    height: 48,
                    margin: const EdgeInsets.symmetric(vertical: 18),
                    decoration: BoxDecoration(
                      color: tokens.action,
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(12, 18, 16, 18),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Paused',
                            style: typography.titleSmall?.copyWith(
                              color: tokens.ink,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            'No new runs start until you resume it.',
                            style: typography.bodySmall?.copyWith(
                              color: tokens.muted,
                              height: 1.45,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 30),
          _WorkflowActionButton(
            key: const ValueKey('workflow-resume'),
            label: 'Resume',
            height: 46,
            insetHorizontal: 10,
            onPressed: _submitting
                ? null
                : () => _requestStatus(WorkflowStatus.active),
          ),
          const SizedBox(height: 12),
          _WorkflowActionButton(
            label: 'Back to workflows',
            secondary: true,
            height: 46,
            onPressed: widget.onBack,
          ),
        ],
      ),
    );
  }

  Widget _deniedBody(BuildContext context) {
    final tokens = context.mobileTokens;
    final typography = Theme.of(context).textTheme;
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 60, 20, 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Align(
            child: Container(
              width: 68,
              height: 68,
              decoration: BoxDecoration(
                color: tokens.soft,
                borderRadius: BorderRadius.circular(24),
              ),
              child: Icon(Icons.work_outline_rounded, color: tokens.ink),
            ),
          ),
          const SizedBox(height: 18),
          Text(
            'You can view, but not change this',
            textAlign: TextAlign.center,
            style: typography.headlineSmall?.copyWith(
              color: tokens.ink,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 10),
          Text(
            'An owner or authorized manager can update this record.',
            textAlign: TextAlign.center,
            style: typography.bodyMedium?.copyWith(
              color: tokens.muted,
              height: 1.55,
            ),
          ),
          const SizedBox(height: 28),
          _WorkflowActionButton(
            label: 'Back to detail',
            height: 46,
            insetHorizontal: 10,
            onPressed: () => setState(() => _view = _viewFor(_record.status)),
          ),
        ],
      ),
    );
  }
}

_WorkflowView _viewFor(WorkflowStatus status) => status == WorkflowStatus.paused
    ? _WorkflowView.paused
    : _WorkflowView.detail;

/// Shows the designed loading state for a workflow detail route.
class WorkflowDetailLoadingPage extends StatelessWidget {
  const WorkflowDetailLoadingPage({
    required this.onBack,
    this.workflowName = 'Workflow',
    this.communityName,
    this.onQuickActions,
    super.key,
  });

  final VoidCallback onBack;
  final String workflowName;
  final String? communityName;
  final VoidCallback? onQuickActions;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    final typography = Theme.of(context).textTheme;
    return Material(
      color: tokens.canvas,
      child: Column(
        children: [
          _WorkflowHeader(
            title: workflowName,
            subtitle: communityName,
            onBack: onBack,
            onQuickActions: onQuickActions,
          ),
          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(20, 13, 20, 24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Container(
                    constraints: const BoxConstraints(minHeight: 104),
                    padding: const EdgeInsets.fromLTRB(0, 12, 16, 12),
                    decoration: BoxDecoration(
                      color: tokens.paper,
                      border: Border.all(color: tokens.line),
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Container(
                          width: 3,
                          height: 56,
                          decoration: BoxDecoration(
                            color: tokens.action,
                            borderRadius: BorderRadius.circular(2),
                          ),
                        ),
                        const SizedBox(width: 13),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Text(
                                'Loading $workflowName',
                                style: typography.labelLarge?.copyWith(
                                  color: tokens.ink,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                'Fetching the latest shared record. Actions will be ready when it arrives.',
                                style: typography.labelSmall?.copyWith(
                                  color: tokens.muted,
                                  height: 1.5,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 21),
                  const _WorkflowSkeleton(height: 12, radius: 12),
                  const SizedBox(height: 14),
                  const _WorkflowSkeleton(height: 44, radius: 0),
                  const SizedBox(height: 14),
                  const _WorkflowSkeleton(height: 44, radius: 0),
                  const SizedBox(height: 14),
                  const _WorkflowSkeleton(height: 44, radius: 0),
                  const SizedBox(height: 14),
                  const _WorkflowSkeleton(height: 44, radius: 14, bottom: 14),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Shows the designed unavailable state for a workflow detail route.
class WorkflowDetailUnavailablePage extends StatelessWidget {
  const WorkflowDetailUnavailablePage({
    required this.onBack,
    required this.onRetry,
    super.key,
  });

  final VoidCallback onBack;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    final typography = Theme.of(context).textTheme;
    return Material(
      color: tokens.canvas,
      child: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 126, 20, 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Align(
                child: Container(
                  width: 68,
                  height: 68,
                  decoration: BoxDecoration(
                    color: tokens.soft,
                    borderRadius: BorderRadius.circular(24),
                  ),
                  child: Icon(Icons.work_outline_rounded, color: tokens.ink),
                ),
              ),
              const SizedBox(height: 18),
              Text(
                'This workflow could not load',
                textAlign: TextAlign.center,
                style: typography.headlineSmall?.copyWith(
                  color: tokens.ink,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 12),
              Text(
                'The record has not been removed. Retry to get its current state.',
                textAlign: TextAlign.center,
                style: typography.bodyMedium?.copyWith(
                  color: tokens.muted,
                  height: 1.55,
                ),
              ),
              const SizedBox(height: 28),
              _WorkflowActionButton(
                label: 'Try again',
                height: 46,
                insetHorizontal: 10,
                onPressed: onRetry,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _WorkflowSkeleton extends StatelessWidget {
  const _WorkflowSkeleton({
    required this.height,
    required this.radius,
    this.bottom = 0,
  });

  final double height;
  final double radius;
  final double bottom;

  @override
  Widget build(BuildContext context) => Container(
    height: height,
    margin: EdgeInsets.only(bottom: bottom),
    decoration: BoxDecoration(
      color: context.mobileTokens.soft,
      borderRadius: BorderRadius.vertical(
        top: Radius.circular(radius),
        bottom: Radius.circular(radius),
      ),
    ),
  );
}

class _WorkflowHeader extends StatelessWidget {
  const _WorkflowHeader({
    required this.title,
    required this.onBack,
    this.subtitle,
    this.onQuickActions,
  });

  final String title;
  final String? subtitle;
  final VoidCallback onBack;
  final VoidCallback? onQuickActions;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    final typography = context.mobileTypography;
    return SafeArea(
      bottom: false,
      child: Container(
        height: MobileLayoutTokens.appBarHeight,
        padding: const EdgeInsets.symmetric(horizontal: 20),
        color: tokens.canvas,
        child: Row(
          children: [
            IconButton(
              tooltip: 'Back',
              onPressed: onBack,
              icon: const Icon(LucideIcons.chevronLeft, size: 22),
              style: IconButton.styleFrom(
                backgroundColor: tokens.paper,
                foregroundColor: tokens.ink,
                minimumSize: const Size.square(42),
                padding: EdgeInsets.zero,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(Radii.button),
                  side: BorderSide(color: tokens.line),
                ),
              ),
            ),
            const SizedBox(width: 8),
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
                    ),
                  ),
                  if (subtitle?.isNotEmpty == true)
                    Text(
                      subtitle!,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: typography.companyHubSubtitle.copyWith(
                        color: tokens.muted,
                      ),
                    ),
                ],
              ),
            ),
            if (onQuickActions != null) ...[
              const SizedBox(width: 8),
              IconButton(
                tooltip: 'Quick actions',
                onPressed: onQuickActions,
                icon: const Icon(LucideIcons.plus, size: 21),
                style: IconButton.styleFrom(
                  backgroundColor: tokens.paper,
                  foregroundColor: tokens.ink,
                  minimumSize: const Size.square(42),
                  padding: EdgeInsets.zero,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(Radii.button),
                    side: BorderSide(color: tokens.line),
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _WorkflowTriggerCard extends StatelessWidget {
  const _WorkflowTriggerCard({required this.record, required this.channelName});

  final WorkflowRecord record;
  final String? channelName;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    final typography = Theme.of(context).textTheme;
    final trigger = _triggerDescription(record.trigger);
    final channel = channelName?.isNotEmpty == true ? '#$channelName' : null;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
      decoration: BoxDecoration(
        color: tokens.actionSoft,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(LucideIcons.clock, color: tokens.onActionSoft, size: 18),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  trigger,
                  style: typography.labelSmall?.copyWith(
                    color: tokens.ink,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  [
                    if (record.trigger.isScheduled) 'Johannesburg time',
                    ?channel,
                  ].join(' · '),
                  style: typography.labelSmall?.copyWith(color: tokens.muted),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _WorkflowStepCard extends StatelessWidget {
  const _WorkflowStepCard({
    required this.index,
    required this.step,
    required this.profiles,
  });

  final int index;
  final WorkflowStepRecord step;
  final Map<String, UserProfile> profiles;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    final typography = Theme.of(context).textTheme;
    final pubkey = step.assigneePubkey ?? step.reviewerPubkey;
    final profile = pubkey == null ? null : profiles[pubkey];
    final label =
        profile?.label ??
        (step.reviewerScope == null
            ? null
            : _reviewerScope(step.reviewerScope!)) ??
        (pubkey == null ? null : shortPubkey(pubkey));
    final role = step.kind == WorkflowStepKind.agent
        ? 'Runs this step · AI agent'
        : 'Human reviewer';
    final title = step.title.isNotEmpty ? step.title : step.instruction;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 26,
          height: 26,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: tokens.actionSoft,
            shape: BoxShape.circle,
          ),
          child: Text(
            '$index',
            style: typography.labelSmall?.copyWith(
              color: tokens.onActionSoft,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: tokens.paper,
              border: Border.all(color: tokens.line),
              borderRadius: BorderRadius.circular(16),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: typography.titleSmall?.copyWith(
                    color: tokens.ink,
                    fontWeight: FontWeight.w600,
                    height: 1.35,
                  ),
                ),
                if (pubkey != null || label != null) ...[
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      _WorkflowPersonAvatar(profile: profile, label: label),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              label ?? 'Human reviewer',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: typography.bodySmall?.copyWith(
                                color: tokens.ink,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            Text(
                              role,
                              style: typography.labelSmall?.copyWith(
                                color: tokens.muted,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ],
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _WorkflowPersonAvatar extends StatelessWidget {
  const _WorkflowPersonAvatar({required this.profile, required this.label});

  final UserProfile? profile;
  final String? label;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return AvatarImage(
      imageUrl: profile?.avatarUrl,
      radius: 15,
      backgroundColor: profile?.isAgent == true
          ? tokens.actionSoft
          : tokens.warning,
      fallback: Text(
        profile?.initials ?? (label == null ? '' : _initials(label!)),
        style: TextStyle(color: tokens.ink, fontWeight: FontWeight.w600),
      ),
      isAgent: profile?.isAgent ?? false,
    );
  }
}

class _WorkflowActionButton extends StatelessWidget {
  const _WorkflowActionButton({
    required this.label,
    required this.onPressed,
    this.secondary = false,
    this.height = 48,
    this.insetHorizontal = 0,
    super.key,
  });

  final String label;
  final VoidCallback? onPressed;
  final bool secondary;
  final double height;
  final double insetHorizontal;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Padding(
      padding: EdgeInsets.symmetric(horizontal: insetHorizontal),
      child: SizedBox(
        height: height,
        child: FilledButton(
          onPressed: onPressed,
          style: FilledButton.styleFrom(
            backgroundColor: secondary ? tokens.soft : tokens.action,
            foregroundColor: secondary ? tokens.onActionSoft : tokens.onAction,
            disabledBackgroundColor: secondary ? tokens.soft : tokens.action,
            disabledForegroundColor: secondary
                ? tokens.onActionSoft
                : tokens.onAction,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(Radii.button),
            ),
          ),
          child: Text(label),
        ),
      ),
    );
  }
}

String _triggerDescription(WorkflowTriggerRecord trigger) {
  if (!trigger.isScheduled) return 'When you choose Run workflow';
  final time =
      '${(trigger.hour ?? 0).toString().padLeft(2, '0')}:'
      '${(trigger.minute ?? 0).toString().padLeft(2, '0')}';
  if (trigger.frequency == 'daily') return 'Every day at $time';
  const weekdays = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ];
  final day = weekdays[trigger.dayOfWeek ?? 0];
  return 'Every $day at $time';
}

String _reviewerScope(String scope) => switch (scope) {
  'owner_or_admin' => 'Owner or admin',
  'channel_member' => 'Channel member',
  'any' => 'Anyone',
  _ => scope,
};

String _initials(String value) {
  final words = value.trim().split(RegExp(r'\s+'));
  if (words.isEmpty || words.first.isEmpty) return '';
  if (words.length == 1) return words.first.characters.first.toUpperCase();
  return '${words.first.characters.first}${words.last.characters.first}'
      .toUpperCase();
}
