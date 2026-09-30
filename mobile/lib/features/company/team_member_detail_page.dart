import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../shared/community/community_provider.dart';
import '../../shared/company/work/company_work_records.dart';
import '../../shared/company/team/company_team_repository.dart';
import '../../shared/company/team/member_position_records.dart';
import '../../shared/company/team/member_position_repository.dart';
import '../../shared/mentions/agent_identity_provider.dart';
import '../../shared/profile/user_cache_provider.dart';
import '../../shared/profile/user_profile.dart';
import '../../shared/theme/theme.dart';
import '../../shared/utils/string_utils.dart';
import '../goals/goal_widgets.dart';
import 'team_position_edit_page.dart';
import 'team_reports_page.dart';

/// Shows a member using the latest membership and signed position heads.
class TeamMemberDetailPage extends HookConsumerWidget {
  const TeamMemberDetailPage({
    required this.pubkey,
    this.onInvite,
    this.onStartConversation,
    this.onBack,
    this.onOpenReports,
    super.key,
  });

  final String pubkey;
  final VoidCallback? onInvite;
  final Future<void> Function(BuildContext context, String pubkey)?
  onStartConversation;
  final VoidCallback? onBack;
  final ValueChanged<String>? onOpenReports;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final teamAsync = ref.watch(companyTeamProvider);
    final communityName = ref.watch(activeCommunityProvider).value?.name;
    final profile = ref.watch(
      userCacheProvider.select((profiles) => profiles[pubkey.toLowerCase()]),
    );
    final directoryName = ref.watch(
      agentDirectoryDisplayNamesProvider,
    )[pubkey.toLowerCase()];
    final current = teamAsync.asData?.value.members
        .where((member) => member.pubkey == pubkey.toLowerCase())
        .firstOrNull;
    final name = _teamDetailName(profile, directoryName, pubkey);
    final dmFailed = useState(false);
    final openingDm = useState(false);
    final editingPosition = useState(false);
    final positionSaved = useState(false);

    useEffect(() {
      final manager = current?.position?.head.managerPubkey;
      unawaited(
        ref.read(userCacheProvider.notifier).preload([pubkey, ?manager]),
      );
      return null;
    }, [pubkey, current?.position?.head.managerPubkey]);

    Future<void> openConversation() async {
      final callback = onStartConversation;
      if (callback == null || openingDm.value) return;
      openingDm.value = true;
      dmFailed.value = false;
      try {
        await callback(context, pubkey);
      } on Object {
        if (context.mounted) dmFailed.value = true;
      } finally {
        if (context.mounted) openingDm.value = false;
      }
    }

    void editPosition() => editingPosition.value = true;

    if (editingPosition.value) {
      return TeamPositionEditPage(
        pubkey: pubkey,
        onBack: () => editingPosition.value = false,
        onSaved: () {
          editingPosition.value = false;
          positionSaved.value = true;
          ref.invalidate(memberPositionHeadsProvider);
          ref.invalidate(companyTeamProvider);
        },
      );
    }

    return ColoredBox(
      color: context.mobileTokens.canvas,
      child: Column(
        children: [
          GoalPageHeader(
            title: 'Your team',
            subtitle: communityName,
            onBack: onBack ?? () => unawaited(Navigator.of(context).maybePop()),
            backLabel: 'Back to team',
          ),
          Expanded(
            child: teamAsync.when(
              loading: () => _TeamMemberLoading(name: name),
              error: (error, stackTrace) => _TeamMemberFailure(
                onRetry: () => ref.invalidate(companyTeamProvider),
                onInvite: onInvite,
              ),
              data: (data) {
                final member = data.members
                    .where(
                      (candidate) => candidate.pubkey == pubkey.toLowerCase(),
                    )
                    .firstOrNull;
                if (member == null) {
                  return _TeamMemberFailure(
                    onRetry: () => ref.invalidate(companyTeamProvider),
                    onInvite: onInvite,
                  );
                }
                final reports = data.members
                    .where(
                      (candidate) =>
                          candidate.position?.head.managerPubkey
                              ?.toLowerCase() ==
                          member.pubkey,
                    )
                    .toList(growable: false);
                final manager = member.position?.head.managerPubkey == null
                    ? null
                    : data.members
                          .where(
                            (candidate) =>
                                candidate.pubkey ==
                                member.position!.head.managerPubkey!
                                    .toLowerCase(),
                          )
                          .firstOrNull;
                final managerProfile = manager == null
                    ? null
                    : ref.watch(
                        userCacheProvider.select(
                          (profiles) => profiles[manager.pubkey],
                        ),
                      );
                final managerName = manager == null
                    ? 'Not assigned'
                    : _teamDetailName(
                        managerProfile,
                        manager.directoryName,
                        manager.pubkey,
                      );
                final managerLabel = manager == null
                    ? managerName
                    : '$managerName${manager.position?.head.title == null ? '' : ' · ${manager.position!.head.title}'}';

                if (dmFailed.value) {
                  return _TeamDmFailure(
                    name: name,
                    onTryAgain: () => unawaited(openConversation()),
                    onBack:
                        onBack ??
                        () => unawaited(Navigator.of(context).maybePop()),
                  );
                }
                if (member.status == MemberPositionStatus.terminated) {
                  return _TeamTerminatedDetail(
                    member: member,
                    name: name,
                    managerLabel: managerLabel,
                    directReportCount: reports.length,
                    onOpenReports: reports.isEmpty
                        ? null
                        : () => _openReports(context, member.pubkey),
                    onBack:
                        onBack ??
                        () => unawaited(Navigator.of(context).maybePop()),
                  );
                }
                return _TeamActiveDetail(
                  member: member,
                  name: name,
                  managerLabel: managerLabel,
                  directReportCount: reports.length,
                  positionSaved: positionSaved.value,
                  openingDm: openingDm.value,
                  onOpenReports: reports.isEmpty
                      ? null
                      : () => _openReports(context, member.pubkey),
                  onMessage: onStartConversation == null
                      ? null
                      : () => unawaited(openConversation()),
                  onEdit: editPosition,
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  void _openReports(BuildContext context, String managerPubkey) {
    final callback = onOpenReports;
    if (callback != null) {
      callback(managerPubkey);
      return;
    }
    Navigator.of(context).push<void>(
      MaterialPageRoute<void>(
        builder: (_) => TeamMemberReportsPage(
          managerPubkey: managerPubkey,
          onBack: () => unawaited(Navigator.of(context).maybePop()),
          onOpenMember: (pubkey) => Navigator.of(context).push<void>(
            MaterialPageRoute<void>(
              builder: (_) => TeamMemberDetailPage(
                pubkey: pubkey,
                onInvite: onInvite,
                onStartConversation: onStartConversation,
                onBack: () => unawaited(Navigator.of(context).maybePop()),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _TeamActiveDetail extends ConsumerWidget {
  const _TeamActiveDetail({
    required this.member,
    required this.name,
    required this.managerLabel,
    required this.directReportCount,
    required this.positionSaved,
    required this.openingDm,
    required this.onOpenReports,
    required this.onMessage,
    required this.onEdit,
  });

  final CompanyTeamMemberRecord member;
  final String name;
  final String managerLabel;
  final int directReportCount;
  final bool positionSaved;
  final bool openingDm;
  final VoidCallback? onOpenReports;
  final VoidCallback? onMessage;
  final VoidCallback onEdit;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tokens = context.mobileTokens;
    final title =
        member.position?.head.title ??
        (member.kind == MemberPositionKind.employee ? 'AI employee' : 'Human');
    return ListView(
      padding: const EdgeInsets.fromLTRB(
        Grid.gutter,
        Grid.xs,
        Grid.gutter,
        Grid.lg,
      ),
      children: [
        _TeamMemberHero(
          label: member.kind == MemberPositionKind.employee
              ? 'AI EMPLOYEE'
              : 'HUMAN MEMBER',
          name: name,
          title: title,
        ),
        if (positionSaved) ...[
          const SizedBox(height: Grid.xxs),
          const _TeamNotice(
            title: 'Position updated',
            message: 'Title and manager were saved.',
            success: true,
          ),
        ],
        if (positionSaved) const SizedBox(height: Grid.xxs),
        _TeamInfoRow(label: 'Reports to', value: managerLabel),
        _TeamInfoRow(label: 'Status', value: member.status.displayLabel),
        if (member.status == MemberPositionStatus.active) ...[
          const SizedBox(height: Grid.half),
          _MemberDoingNow(pubkey: member.pubkey),
        ],
        if (directReportCount > 0) ...[
          const SizedBox(height: Grid.xxs),
          _DirectReportsCard(count: directReportCount, onTap: onOpenReports),
        ],
        if (onMessage != null) ...[
          const SizedBox(height: Grid.xxs),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: openingDm ? null : onMessage,
              child: Text(openingDm ? 'Opening conversation' : 'Message $name'),
            ),
          ),
        ],
        const SizedBox(height: Grid.xxs),
        SizedBox(
          width: double.infinity,
          child: FilledButton.tonal(
            onPressed: onEdit,
            style: FilledButton.styleFrom(
              backgroundColor: tokens.soft,
              foregroundColor: tokens.action,
              side: BorderSide(color: tokens.line),
              minimumSize: const Size.fromHeight(
                MobileLayoutTokens.minimumTapTarget,
              ),
            ),
            child: const Text('Edit position'),
          ),
        ),
      ],
    );
  }
}

class _TeamTerminatedDetail extends StatelessWidget {
  const _TeamTerminatedDetail({
    required this.member,
    required this.name,
    required this.managerLabel,
    required this.directReportCount,
    required this.onOpenReports,
    required this.onBack,
  });

  final CompanyTeamMemberRecord member;
  final String name;
  final String managerLabel;
  final int directReportCount;
  final VoidCallback? onOpenReports;
  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return ListView(
      padding: const EdgeInsets.fromLTRB(
        Grid.gutter,
        Grid.xs,
        Grid.gutter,
        Grid.lg,
      ),
      children: [
        _TeamMemberHero(
          label: 'TERMINATED',
          name: name,
          title: member.position?.head.title ?? 'Former employee',
        ),
        const SizedBox(height: Grid.xxs),
        _TeamNotice(
          title: 'No longer active',
          message: 'Reason: ${member.position?.head.reason ?? ''}',
        ),
        const SizedBox(height: Grid.xxs),
        _TeamInfoRow(label: 'Manager', value: managerLabel),
        _TeamInfoRow(label: 'Work access', value: 'No new assignments'),
        _TeamInfoRow(label: 'History', value: 'Retained'),
        if (directReportCount > 0) ...[
          const SizedBox(height: Grid.sm),
          _DirectReportsCard(count: directReportCount, onTap: onOpenReports),
        ],
        const SizedBox(height: Grid.sm),
        FilledButton.tonal(
          onPressed: onBack,
          style: FilledButton.styleFrom(
            backgroundColor: tokens.soft,
            foregroundColor: tokens.action,
            side: BorderSide(color: tokens.line),
            minimumSize: const Size.fromHeight(
              MobileLayoutTokens.minimumTapTarget,
            ),
          ),
          child: const Text('Back to team'),
        ),
      ],
    );
  }
}

class _MemberDoingNow extends ConsumerWidget {
  const _MemberDoingNow({required this.pubkey});

  final String pubkey;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final records = ref.watch(companyMemberWorkProvider(pubkey));
    return records.when(
      loading: () =>
          const _TeamInfoRow(label: 'Doing now', value: 'Loading commitments'),
      error: (error, stackTrace) => const SizedBox.shrink(),
      data: (items) {
        if (items.isEmpty) {
          return const _TeamInfoRow(
            label: 'Doing now',
            value: 'No current commitments.',
          );
        }
        return Column(
          children: [
            for (final item in items)
              _TeamInfoRow(label: 'Doing now', value: item.title),
          ],
        );
      },
    );
  }
}

class _TeamMemberHero extends StatelessWidget {
  const _TeamMemberHero({
    required this.label,
    required this.name,
    required this.title,
  });

  final String label;
  final String name;
  final String title;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Container(
      padding: const EdgeInsets.all(Grid.gutter),
      decoration: BoxDecoration(
        gradient: context.appColors.companyWashGradient,
        borderRadius: BorderRadius.circular(Radii.card),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: context.mobileTypography.companySection.copyWith(
              color: tokens.action,
            ),
          ),
          const SizedBox(height: Grid.xs),
          Text(
            name,
            style: context.mobileTypography.goalDetailTitle.copyWith(
              color: tokens.ink,
              fontSize: 28,
              height: 1.3,
            ),
          ),
          if (title.isNotEmpty) ...[
            const SizedBox(height: Grid.xs),
            Text(
              title,
              style: context.mobileTypography.body.copyWith(color: tokens.ink),
            ),
          ],
        ],
      ),
    );
  }
}

class _DirectReportsCard extends StatelessWidget {
  const _DirectReportsCard({required this.count, required this.onTap});

  final int count;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    final text = '$count ${count == 1 ? 'position' : 'positions'}';
    return Material(
      color: tokens.paper,
      borderRadius: BorderRadius.circular(Radii.card),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(Radii.card),
        child: Container(
          constraints: const BoxConstraints(minHeight: 76),
          padding: const EdgeInsets.symmetric(horizontal: Grid.sm),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(Radii.card),
            border: Border.all(color: tokens.line),
          ),
          child: Row(
            children: [
              Container(
                width: 38,
                height: 38,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: context.appColors.lilac.withValues(alpha: 0.35),
                  borderRadius: BorderRadius.circular(Radii.button),
                ),
                child: Icon(
                  LucideIcons.cornerDownRight,
                  color: tokens.action,
                  size: 19,
                ),
              ),
              const SizedBox(width: Grid.sm),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(
                      'Direct reports',
                      style: context.mobileTypography.goalCardTitle,
                    ),
                    const SizedBox(height: Grid.xxs),
                    Text(
                      text,
                      style: context.mobileTypography.metadata.copyWith(
                        color: tokens.muted,
                      ),
                    ),
                  ],
                ),
              ),
              Icon(LucideIcons.chevronRight, color: tokens.muted, size: 18),
            ],
          ),
        ),
      ),
    );
  }
}

class _TeamInfoRow extends StatelessWidget {
  const _TeamInfoRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Container(
      padding: const EdgeInsets.symmetric(vertical: Grid.xxs),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: tokens.line)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: context.mobileTypography.body.copyWith(
                color: tokens.muted,
              ),
            ),
          ),
          const SizedBox(width: Grid.xs),
          Flexible(
            child: Text(
              value,
              textAlign: TextAlign.end,
              style: context.mobileTypography.body.copyWith(color: tokens.ink),
            ),
          ),
        ],
      ),
    );
  }
}

class _TeamNotice extends StatelessWidget {
  const _TeamNotice({
    required this.title,
    required this.message,
    this.success = false,
    this.error = false,
  });

  final String title;
  final String message;
  final bool success;
  final bool error;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Container(
      decoration: BoxDecoration(
        color: tokens.paper,
        borderRadius: BorderRadius.circular(Radii.card),
        border: Border.all(color: tokens.line),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(Radii.card),
        child: Row(
          children: [
            Container(
              width: 3,
              color: error
                  ? tokens.error
                  : success
                  ? context.appColors.success
                  : context.appColors.lilac,
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.all(Grid.sm),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: context.mobileTypography.goalCardTitle),
                    const SizedBox(height: Grid.xxs),
                    Text(
                      message,
                      style: context.mobileTypography.body.copyWith(
                        color: tokens.ink,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _TeamMemberLoading extends StatelessWidget {
  const _TeamMemberLoading({required this.name});

  final String name;

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(Grid.gutter),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            'Loading $name',
            textAlign: TextAlign.center,
            style: context.mobileTypography.goalDetailTitle,
          ),
          const SizedBox(height: Grid.xs),
          Text(
            'Fetching the latest shared record. Actions will be ready when it arrives.',
            textAlign: TextAlign.center,
            style: context.mobileTypography.body,
          ),
          const SizedBox(height: Grid.md),
          const CircularProgressIndicator.adaptive(),
        ],
      ),
    ),
  );
}

class _TeamMemberFailure extends StatelessWidget {
  const _TeamMemberFailure({required this.onRetry, required this.onInvite});

  final VoidCallback onRetry;
  final VoidCallback? onInvite;

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(Grid.gutter),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            'This profile could not load',
            textAlign: TextAlign.center,
            style: context.mobileTypography.goalDetailTitle,
          ),
          const SizedBox(height: Grid.xs),
          Text(
            'The record has not been removed. Retry to get its current state.',
            textAlign: TextAlign.center,
            style: context.mobileTypography.body,
          ),
          const SizedBox(height: Grid.md),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: onRetry,
              child: const Text('Try again'),
            ),
          ),
          if (onInvite != null) ...[
            const SizedBox(height: Grid.xs),
            TextButton(
              onPressed: onInvite,
              child: const Text('Add a team member'),
            ),
          ],
        ],
      ),
    ),
  );
}

class _TeamDmFailure extends StatelessWidget {
  const _TeamDmFailure({
    required this.name,
    required this.onTryAgain,
    required this.onBack,
  });

  final String name;
  final VoidCallback onTryAgain;
  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return ListView(
      padding: const EdgeInsets.fromLTRB(
        Grid.gutter,
        Grid.xs,
        Grid.gutter,
        Grid.lg,
      ),
      children: [
        _TeamMemberHero(
          label: 'MESSAGE ${name.toUpperCase()}',
          name: 'Conversation unavailable.',
          title: '',
        ),
        const SizedBox(height: Grid.xs),
        const _TeamNotice(
          title: 'Could not open the direct message',
          message: 'No message was sent. Retry opening the conversation.',
          error: true,
        ),
        const SizedBox(height: Grid.sm),
        SizedBox(
          width: double.infinity,
          child: FilledButton(
            onPressed: onTryAgain,
            child: const Text('Retry opening conversation'),
          ),
        ),
        const SizedBox(height: Grid.xs),
        SizedBox(
          width: double.infinity,
          child: FilledButton.tonal(
            onPressed: onBack,
            style: FilledButton.styleFrom(
              backgroundColor: tokens.soft,
              foregroundColor: tokens.action,
              side: BorderSide(color: tokens.line),
            ),
            child: Text('Back to $name'),
          ),
        ),
      ],
    );
  }
}

String _teamDetailName(
  UserProfile? profile,
  String? directoryName,
  String pubkey,
) {
  if (profile?.displayName?.trim().isNotEmpty == true) {
    return profile!.displayName!.trim();
  }
  if (directoryName?.trim().isNotEmpty == true) return directoryName!.trim();
  return shortPubkey(pubkey);
}
