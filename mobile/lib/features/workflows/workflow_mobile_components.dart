part of 'workflow_mobile_pages.dart';

class _WorkflowPickerRow extends HookConsumerWidget {
  const _WorkflowPickerRow({required this.record, required this.onTap});

  final WorkflowRecord record;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final members = ref
        .watch(channelMembersProvider(record.channelId))
        .asData
        ?.value;
    final runners = _stepRunnerNames(record.steps, members);
    final status = record.isDraft
        ? 'Draft · Not running'
        : _statusLabel(record.status.name);
    final subtitle = runners.isEmpty
        ? status
        : '$status · ${runners.join(' + ')}';
    final tokens = context.mobileTokens;
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Material(
        color: tokens.paper,
        borderRadius: BorderRadius.circular(Radii.companyCard),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(Radii.companyCard),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 13),
            child: Row(
              children: [
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    color: tokens.soft,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(
                    record.isDraft ? LucideIcons.plus : LucideIcons.workflow,
                    size: 17,
                    color: tokens.action,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(record.name, style: _sectionStyle(context)),
                      const SizedBox(height: 2),
                      Text(
                        subtitle,
                        style: _mutedStyle(context),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
                Icon(LucideIcons.chevronRight, size: 17, color: tokens.muted),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _WorkflowHero extends StatelessWidget {
  const _WorkflowHero({
    required this.kicker,
    required this.title,
    this.message,
  });

  final String kicker;
  final String title;
  final String? message;

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final tokens = context.mobileTokens;
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: colors.companyWashGradient,
        borderRadius: BorderRadius.circular(Radii.companyCard),
      ),
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              kicker.toUpperCase(),
              style: context.mobileTypography.companyEntryDescription.copyWith(
                color: tokens.action,
                fontWeight: FontWeight.w800,
                letterSpacing: 0.8,
              ),
            ),
            const SizedBox(height: 10),
            Text(
              title,
              style: context.mobileTypography.companyHubTitle.copyWith(
                color: tokens.ink,
              ),
            ),
            if (message != null) ...[
              const SizedBox(height: 8),
              Text(
                message!,
                style: context.mobileTypography.companyEntryDescription
                    .copyWith(color: tokens.muted, height: 1.45),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _WorkflowNotice extends StatelessWidget {
  const _WorkflowNotice({
    required this.title,
    this.message,
    this.kind = _WorkflowNoticeKind.neutral,
  });

  final String title;
  final String? message;
  final _WorkflowNoticeKind kind;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    final accent = switch (kind) {
      _WorkflowNoticeKind.neutral => tokens.action,
      _WorkflowNoticeKind.success => const Color(0xFF4C957B),
      _WorkflowNoticeKind.error => const Color(0xFFD8798C),
    };
    return Container(
      decoration: BoxDecoration(
        color: tokens.paper,
        borderRadius: BorderRadius.circular(Radii.companyCard),
        border: Border(left: BorderSide(color: accent, width: 3)),
      ),
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: _sectionStyle(context)),
          if (message != null) ...[
            const SizedBox(height: 5),
            Text(message!, style: _mutedStyle(context).copyWith(height: 1.45)),
          ],
        ],
      ),
    );
  }
}

enum _WorkflowNoticeKind { neutral, success, error }

class _WorkflowUnavailableContent extends StatelessWidget {
  const _WorkflowUnavailableContent({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
    children: [
      const _WorkflowHero(
        kicker: 'Connection unavailable',
        title: 'Let’s try again.',
        message: 'This is not an empty record.',
      ),
      const SizedBox(height: 12),
      _WorkflowActionButton(
        label: 'Retry connection',
        icon: LucideIcons.refreshCw,
        onPressed: onRetry,
      ),
    ],
  );
}

class _WorkflowLoadingContent extends StatelessWidget {
  const _WorkflowLoadingContent();

  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
    children: [
      const _WorkflowNotice(
        title: 'Loading the latest information',
        message: 'Actions will appear when this record is ready.',
      ),
      const SizedBox(height: 12),
      Container(
        height: 244,
        decoration: BoxDecoration(
          color: context.mobileTokens.paper,
          borderRadius: BorderRadius.circular(Radii.companyCard),
        ),
      ),
    ],
  );
}

class _WorkflowFactRow extends StatelessWidget {
  const _WorkflowFactRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Column(
    children: [
      Padding(
        padding: const EdgeInsets.symmetric(vertical: 10),
        child: Row(
          children: [
            Expanded(child: Text(label, style: _mutedStyle(context))),
            const SizedBox(width: 12),
            Flexible(
              child: Text(
                value,
                style: _sectionStyle(context),
                textAlign: TextAlign.end,
              ),
            ),
          ],
        ),
      ),
      Divider(height: 1, color: context.mobileTokens.line),
    ],
  );
}

class _WorkflowStepCard extends StatelessWidget {
  const _WorkflowStepCard({
    required this.index,
    required this.step,
    required this.members,
    this.onEdit,
  });

  final int index;
  final WorkflowStepRecord step;
  final List<ChannelMember>? members;
  final VoidCallback? onEdit;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    final runner = _stepRunnerName(step, members);
    final completion = step.kind == WorkflowStepKind.agent
        ? step.expectedResult
        : 'A human approves the result';
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 9),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              CircleAvatar(
                radius: 14,
                backgroundColor: tokens.soft,
                child: Text('$index', style: _mutedStyle(context)),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(step.title, style: _sectionStyle(context)),
                    const SizedBox(height: 3),
                    Text(step.instruction, style: _bodyStyle(context)),
                    const SizedBox(height: 9),
                    Row(
                      children: [
                        CircleAvatar(
                          radius: 12,
                          backgroundColor: tokens.soft,
                          child: Text(
                            _initials(runner),
                            style: _mutedStyle(context),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(runner, style: _sectionStyle(context)),
                              if (completion?.isNotEmpty == true)
                                Text(
                                  completion!,
                                  style: _mutedStyle(context),
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
          if (onEdit != null) ...[
            const SizedBox(height: 9),
            SizedBox(
              height: 42,
              child: FilledButton.tonal(
                onPressed: onEdit,
                style: FilledButton.styleFrom(
                  foregroundColor: tokens.action,
                  backgroundColor: tokens.soft,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(Radii.button),
                  ),
                ),
                child: Text('Edit step $index'),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

String _stepRunnerName(WorkflowStepRecord step, List<ChannelMember>? members) {
  final pubkey = step.kind == WorkflowStepKind.agent
      ? step.assigneePubkey
      : step.reviewerPubkey;
  if (pubkey == null) return _workflowReviewerScope(step.reviewerScope ?? '');
  final member = members
      ?.where(
        (candidate) => candidate.pubkey.toLowerCase() == pubkey.toLowerCase(),
      )
      .firstOrNull;
  final displayName = member?.displayName?.trim();
  return displayName?.isNotEmpty == true ? displayName! : shortPubkey(pubkey);
}

String _workflowReviewerScope(String scope) => switch (scope) {
  'owner_or_admin' => 'Owner or admin',
  'channel_member' => 'Channel member',
  'any' => 'Anyone',
  _ => scope,
};

List<String> _stepRunnerNames(
  List<WorkflowStepRecord> steps,
  List<ChannelMember>? members,
) {
  final names = <String>[];
  for (final step in steps) {
    final name = _stepRunnerName(step, members);
    if (name.isNotEmpty && !names.contains(name)) names.add(name);
  }
  return names;
}

String _initials(String name) {
  final words = name
      .trim()
      .split(RegExp(r'\s+'))
      .where((word) => word.isNotEmpty);
  final initials = words.take(2).map((word) => word[0].toUpperCase()).join();
  return initials.isEmpty ? '?' : initials;
}

class _WorkflowHeader extends StatelessWidget {
  const _WorkflowHeader({required this.title, this.subtitle, this.onBack});

  final String title;
  final String? subtitle;
  final VoidCallback? onBack;

  @override
  Widget build(BuildContext context) => SafeArea(
    bottom: false,
    child: SizedBox(
      height: 56,
      child: Row(
        children: [
          if (onBack != null)
            IconButton(
              tooltip: 'Back',
              onPressed: onBack,
              icon: const Icon(LucideIcons.chevronLeft),
            ),
          Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: context.mobileTypography.companyHubTitle.copyWith(
                    color: context.mobileTokens.ink,
                  ),
                ),
                if (subtitle?.isNotEmpty == true)
                  Text(subtitle!, style: _mutedStyle(context)),
              ],
            ),
          ),
          const SizedBox(width: 16),
        ],
      ),
    ),
  );
}

class _WorkflowActionButton extends StatelessWidget {
  const _WorkflowActionButton({
    required this.label,
    required this.icon,
    required this.onPressed,
    this.isLoading = false,
  });

  final String label;
  final IconData icon;
  final VoidCallback? onPressed;
  final bool isLoading;

  @override
  Widget build(BuildContext context) => FilledButton.icon(
    onPressed: onPressed,
    icon: isLoading
        ? const SizedBox.square(
            dimension: 16,
            child: CircularProgressIndicator(strokeWidth: 2),
          )
        : Icon(icon, size: 18),
    label: Text(label),
    style: FilledButton.styleFrom(
      minimumSize: const Size.fromHeight(46),
      backgroundColor: context.appColors.plum,
      foregroundColor: context.mobileTokens.canvas,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(Radii.button),
      ),
    ),
  );
}

InputDecoration _workflowFieldDecoration(
  BuildContext context, {
  required String label,
}) => InputDecoration(
  labelText: label,
  filled: true,
  fillColor: context.mobileTokens.paper,
  border: OutlineInputBorder(borderRadius: BorderRadius.circular(Radii.button)),
);

TextStyle _sectionStyle(BuildContext context) => context
    .mobileTypography
    .companyHubTitle
    .copyWith(color: context.mobileTokens.ink);

TextStyle _bodyStyle(BuildContext context) =>
    context.mobileTypography.goalBody.copyWith(color: context.mobileTokens.ink);

TextStyle _mutedStyle(BuildContext context) => context
    .mobileTypography
    .companyEntryDescription
    .copyWith(color: context.mobileTokens.muted);

String _triggerLabel(WorkflowTriggerRecord trigger) {
  if (trigger.frequency == 'manual') return 'When someone starts it';
  final time =
      '${(trigger.hour ?? 0).toString().padLeft(2, '0')}:${(trigger.minute ?? 0).toString().padLeft(2, '0')}';
  return trigger.frequency == 'weekly'
      ? 'Weekly · day ${trigger.dayOfWeek ?? ''} · $time'
      : 'Daily · $time';
}

String _statusLabel(String status) => status
    .replaceAll('_', ' ')
    .split(' ')
    .map((word) {
      if (word.isEmpty) return word;
      return '${word[0].toUpperCase()}${word.substring(1)}';
    })
    .join(' ');
