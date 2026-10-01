import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../shared/community/community_provider.dart';
import '../../shared/company/team/company_team_repository.dart';
import '../../shared/company/team/member_position_records.dart';
import '../../shared/company/team/member_position_repository.dart';
import '../../shared/profile/user_cache_provider.dart';
import '../../shared/profile/user_profile.dart';
import '../../shared/relay/relay_provider.dart';
import '../../shared/theme/theme.dart';
import '../../shared/utils/string_utils.dart';
import 'team_hero_gradient.dart';
import '../goals/goal_widgets.dart';

/// Edits the two member-position fields exposed on mobile.
class TeamPositionEditPage extends HookConsumerWidget {
  const TeamPositionEditPage({
    required this.pubkey,
    this.onBack,
    this.onSaved,
    super.key,
  });

  final String pubkey;
  final VoidCallback? onBack;
  final VoidCallback? onSaved;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final teamAsync = ref.watch(companyTeamProvider);
    final communityName = ref.watch(activeCommunityProvider).value?.name;
    final titleController = useTextEditingController();
    final titleValue = useState('');
    final managerSelection = useState<String?>(null);
    final initializedHead = useRef<String?>(null);
    final saving = useState(false);
    final failed = useState(false);
    final team = teamAsync.asData?.value;
    final member = team?.members
        .where((candidate) => candidate.pubkey == pubkey.toLowerCase())
        .firstOrNull;

    useEffect(() {
      if (member == null) return null;
      final headId = member.position?.event.id;
      if (initializedHead.value == headId) return null;
      initializedHead.value = headId;
      titleController.text = member.position?.head.title ?? '';
      titleValue.value = titleController.text;
      managerSelection.value = member.position?.head.managerPubkey;
      return null;
    }, [member?.position?.event.id]);

    useEffect(() {
      final pubkeys = team?.members
          .map((candidate) => candidate.pubkey)
          .toList();
      if (pubkeys == null) return null;
      unawaited(ref.read(userCacheProvider.notifier).preload(pubkeys));
      return null;
    }, [team?.members.map((candidate) => candidate.pubkey).join('\u0000')]);

    Future<void> save() async {
      final currentTeam = teamAsync.asData?.value;
      if (currentTeam == null) return;
      final currentMember = currentTeam.members
          .where((candidate) => candidate.pubkey == pubkey.toLowerCase())
          .firstOrNull;
      if (currentMember == null || saving.value) return;
      final currentViewer = ref.read(myPubkeyProvider)?.toLowerCase();
      final viewerRole = currentTeam.members
          .where((candidate) => candidate.pubkey == currentViewer)
          .firstOrNull
          ?.role;
      if (!canManageCompanyTeam(viewerRole)) {
        failed.value = true;
        return;
      }

      FocusScope.of(context).unfocus();
      saving.value = true;
      failed.value = false;
      try {
        await ref
            .read(memberPositionRepositoryProvider)
            .submit(
              MemberPositionAction(
                pubkey: currentMember.pubkey,
                action: MemberPositionActionKind.setPosition,
                expectedHeadEventId: currentMember.position?.event.id,
                title: titleController.text.trim(),
                changesManager: true,
                managerPubkey: managerSelection.value,
              ),
            );
        if (context.mounted) {
          final afterSaved = onSaved;
          if (afterSaved != null) {
            afterSaved();
          } else {
            Navigator.of(context).pop(true);
          }
        }
      } on Object {
        // Preserve both fields and the exact head used for this command.
        // Conflicts remain visible until the viewer reviews the newer head.
        failed.value = true;
      } finally {
        saving.value = false;
      }
    }

    return ColoredBox(
      color: context.mobileTokens.canvas,
      child: Material(
        type: MaterialType.transparency,
        child: Column(
          children: [
            GoalPageHeader(
              title: 'Your team',
              subtitle: communityName,
              onBack:
                  onBack ?? () => unawaited(Navigator.of(context).maybePop()),
              backLabel: 'Back to detail',
            ),
            Expanded(
              child: teamAsync.when(
                loading: () =>
                    const Center(child: CircularProgressIndicator.adaptive()),
                error: (error, stackTrace) => _PositionEditUnavailable(
                  onRetry: () => ref.invalidate(companyTeamProvider),
                ),
                data: (data) {
                  final current = data.members
                      .where(
                        (candidate) => candidate.pubkey == pubkey.toLowerCase(),
                      )
                      .firstOrNull;
                  if (current == null ||
                      current.status == MemberPositionStatus.terminated) {
                    return _PositionEditUnavailable(
                      onRetry: () => ref.invalidate(companyTeamProvider),
                    );
                  }
                  final viewer = ref.watch(myPubkeyProvider)?.toLowerCase();
                  final role = data.members
                      .where((candidate) => candidate.pubkey == viewer)
                      .firstOrNull
                      ?.role;
                  if (!canManageCompanyTeam(role)) {
                    return _PositionEditDenied(
                      onBack:
                          onBack ??
                          () => unawaited(Navigator.of(context).maybePop()),
                    );
                  }

                  final profiles = ref.watch(userCacheProvider);
                  final managers = data.members
                      .where(
                        (candidate) =>
                            candidate.pubkey != current.pubkey &&
                            candidate.status != MemberPositionStatus.terminated,
                      )
                      .toList(growable: false);

                  return ListView(
                    padding: const EdgeInsets.fromLTRB(
                      Grid.gutter,
                      Grid.xs,
                      Grid.gutter,
                      Grid.lg,
                    ),
                    children: [
                      _PositionEditHero(),
                      if (failed.value) ...[
                        const SizedBox(height: Grid.sm),
                        const _PositionEditNotice(
                          title: 'Your changes were not saved',
                          message:
                              'Everything you typed is kept. Try again when the connection returns.',
                          error: true,
                        ),
                      ],
                      const SizedBox(height: Grid.xxs),
                      Text(
                        'Job title',
                        style: context.mobileTypography.goalFormLabel.copyWith(
                          color: context.mobileTokens.ink,
                        ),
                      ),
                      const SizedBox(height: Grid.xxs),
                      TextField(
                        controller: titleController,
                        maxLength: memberPositionTitleLimit,
                        textCapitalization: TextCapitalization.sentences,
                        decoration: const InputDecoration(counterText: ''),
                        onChanged: (value) => titleValue.value = value,
                        enabled: !saving.value,
                      ),
                      const SizedBox(height: Grid.xxs),
                      Text(
                        'Reports to',
                        style: context.mobileTypography.goalFormLabel.copyWith(
                          color: context.mobileTokens.ink,
                        ),
                      ),
                      const SizedBox(height: Grid.xxs),
                      DropdownButtonFormField<String?>(
                        initialValue: managerSelection.value,
                        isExpanded: true,
                        decoration: const InputDecoration(),
                        items: [
                          const DropdownMenuItem<String?>(
                            value: null,
                            child: Text('No manager'),
                          ),
                          for (final candidate in managers)
                            DropdownMenuItem<String?>(
                              value: candidate.pubkey,
                              child: Text(
                                '${_positionMemberName(profiles[candidate.pubkey], candidate)} · '
                                '${candidate.position?.head.title ?? (candidate.kind == MemberPositionKind.employee ? 'AI employee' : 'Human')}',
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                        ],
                        onChanged: saving.value
                            ? null
                            : (value) => managerSelection.value = value,
                      ),
                      const SizedBox(height: Grid.md),
                      SizedBox(
                        width: double.infinity,
                        child: FilledButton(
                          onPressed:
                              saving.value || titleValue.value.trim().isEmpty
                              ? null
                              : () => unawaited(save()),
                          child: Text(
                            saving.value ? 'Saving position' : 'Save position',
                          ),
                        ),
                      ),
                      const SizedBox(height: Grid.sm),
                      const _PositionEditNotice(
                        title: 'More setup is on desktop',
                        message:
                            'Runtime, model, tools, instructions and allowances are managed there.',
                      ),
                    ],
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

String _positionMemberName(
  UserProfile? profile,
  CompanyTeamMemberRecord member,
) {
  if (profile?.displayName?.trim().isNotEmpty == true) {
    return profile!.displayName!.trim();
  }
  if (member.directoryName?.trim().isNotEmpty == true) {
    return member.directoryName!.trim();
  }
  return shortPubkey(member.pubkey);
}

class _PositionEditHero extends StatelessWidget {
  const _PositionEditHero();

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Container(
      padding: const EdgeInsets.all(Grid.gutter),
      decoration: BoxDecoration(
        gradient: teamHeroGradientFor(Theme.of(context).brightness),
        borderRadius: BorderRadius.circular(Radii.card),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'POSITION DETAILS',
            style: context.mobileTypography.companySection.copyWith(
              color: tokens.action,
            ),
          ),
          const SizedBox(height: Grid.xs),
          Text(
            'Keep the team aligned.',
            style: context.mobileTypography.goalDetailTitle.copyWith(
              color: tokens.ink,
              fontSize: 30,
              height: 1.3,
            ),
          ),
          const SizedBox(height: Grid.xs),
          Text(
            'Only title and manager are editable here.',
            style: context.mobileTypography.body.copyWith(color: tokens.ink),
          ),
        ],
      ),
    );
  }
}

class _PositionEditNotice extends StatelessWidget {
  const _PositionEditNotice({
    required this.title,
    required this.message,
    this.error = false,
  });

  final String title;
  final String message;
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
                  ? context.appColors.warning
                  : context.appColors.lilac,
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.all(Grid.gutter),
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

class _PositionEditUnavailable extends StatelessWidget {
  const _PositionEditUnavailable({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(Grid.gutter),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            'The position could not load',
            style: context.mobileTypography.goalDetailTitle,
          ),
          const SizedBox(height: Grid.sm),
          FilledButton(onPressed: onRetry, child: const Text('Try again')),
        ],
      ),
    ),
  );
}

class _PositionEditDenied extends StatelessWidget {
  const _PositionEditDenied({required this.onBack});

  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) => Column(
    children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(
          Grid.gutter,
          Grid.xxs,
          Grid.gutter,
          0,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const _PositionEditNotice(
              title: 'You can view, but cannot change this',
              message:
                  'An authorized person can make the update. Your draft has been kept.',
              error: true,
            ),
            const SizedBox(height: Grid.xxs),
            SizedBox(
              width: double.infinity,
              child: FilledButton.tonal(
                onPressed: onBack,
                style: FilledButton.styleFrom(
                  backgroundColor: context.mobileTokens.soft,
                  foregroundColor: context.mobileTokens.action,
                  side: BorderSide(color: context.mobileTokens.line),
                ),
                child: const Text('Back to the record'),
              ),
            ),
          ],
        ),
      ),
      const Expanded(child: SizedBox.shrink()),
    ],
  );
}
