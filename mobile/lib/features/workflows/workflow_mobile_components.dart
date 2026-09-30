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
      padding: const EdgeInsets.only(bottom: 12),
      child: Material(
        color: tokens.paper,
        shape: RoundedRectangleBorder(
          side: BorderSide(color: tokens.line),
          borderRadius: BorderRadius.circular(16),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 78),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 15),
              child: Row(
                children: [
                  Container(
                    width: 38,
                    height: 40,
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
                        Text(record.name, style: _rowTitleStyle(context)),
                        const SizedBox(height: 2),
                        Text(
                          subtitle,
                          style: _rowDescriptionStyle(context),
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
    final brightness = Theme.of(context).brightness;
    final foreground = Batch2MobileVisualTokens.heroForeground(brightness);
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: Batch2MobileVisualTokens.heroGradient(brightness),
        borderRadius: BorderRadius.circular(23),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 23),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              kicker.toUpperCase(),
              style: context.mobileTypography.companySection.copyWith(
                color: foreground,
                fontSize: 10,
                letterSpacing: 1.3,
              ),
            ),
            const SizedBox(height: 13),
            Text(
              title,
              style: _heroTitleStyle(context).copyWith(color: foreground),
            ),
            if (message != null) ...[
              const SizedBox(height: 9),
              Text(
                message!,
                style: _heroDescriptionStyle(
                  context,
                ).copyWith(color: foreground),
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
      _WorkflowNoticeKind.neutral =>
        Batch2MobileVisualTokens.neutralNoticeAccent,
      _WorkflowNoticeKind.success =>
        Batch2MobileVisualTokens.successNoticeAccent,
      _WorkflowNoticeKind.error => Batch2MobileVisualTokens.errorNoticeAccent,
    };
    return Container(
      decoration: BoxDecoration(
        color: tokens.paper,
        borderRadius: BorderRadius.circular(13),
        border: Border.all(color: tokens.line),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(13),
        child: Stack(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 15, 17, 15),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: _noticeTitleStyle(context)),
                  if (message != null) ...[
                    const SizedBox(height: 5),
                    Text(message!, style: _noticeDescriptionStyle(context)),
                  ],
                ],
              ),
            ),
            Positioned(
              left: 0,
              top: 0,
              bottom: 0,
              child: SizedBox(width: 3, child: ColoredBox(color: accent)),
            ),
          ],
        ),
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
    padding: const EdgeInsets.fromLTRB(20, 16, 20, 28),
    children: [
      const _WorkflowHero(
        kicker: 'Connection unavailable',
        title: 'Let’s try again.',
        message: 'This is not an empty record.',
      ),
      const SizedBox(height: 12),
      _WorkflowActionButton(label: 'Retry connection', onPressed: onRetry),
    ],
  );
}

class _WorkflowLoadingContent extends StatelessWidget {
  const _WorkflowLoadingContent();

  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.fromLTRB(20, 16, 20, 28),
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
                style: _factValueStyle(context),
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
      padding: const EdgeInsets.symmetric(vertical: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 29,
                height: 29,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: tokens.soft,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text('$index', style: _stepNumberStyle(context)),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(step.title, style: _stepTitleStyle(context)),
                    const SizedBox(height: 3),
                    Text(
                      step.instruction,
                      style: _stepDescriptionStyle(context),
                    ),
                    const SizedBox(height: 13),
                    Row(
                      children: [
                        Container(
                          width: 28,
                          height: 28,
                          alignment: Alignment.center,
                          decoration: BoxDecoration(
                            color: tokens.soft,
                            borderRadius: BorderRadius.circular(9),
                          ),
                          child: Text(
                            _initials(runner),
                            style: _runnerInitialStyle(context),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(runner, style: _runnerTitleStyle(context)),
                              if (completion?.isNotEmpty == true)
                                Text(
                                  completion!,
                                  style: _runnerDescriptionStyle(context),
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
            const SizedBox(height: 10),
            SizedBox(
              height: 46,
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

class _WorkflowLatestRunButton extends StatelessWidget {
  const _WorkflowLatestRunButton({required this.status, required this.onTap});

  final String status;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Material(
      color: tokens.paper,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          constraints: const BoxConstraints(minHeight: 78),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 15),
          decoration: BoxDecoration(
            border: Border.all(color: tokens.line),
            borderRadius: BorderRadius.circular(16),
          ),
          child: Row(
            children: [
              Icon(LucideIcons.refreshCw, size: 17, color: tokens.action),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Latest run', style: _rowTitleStyle(context)),
                    const SizedBox(height: 2),
                    Text(
                      status,
                      style: _rowDescriptionStyle(context),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Icon(LucideIcons.chevronRight, size: 17, color: tokens.muted),
            ],
          ),
        ),
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
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return SafeArea(
      bottom: false,
      child: SizedBox(
        height: 56,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(15, 4, 15, 8),
          child: Row(
            children: [
              if (onBack != null) ...[
                IconButton(
                  tooltip: 'Back',
                  onPressed: onBack,
                  icon: const Icon(LucideIcons.chevronLeft),
                  constraints: const BoxConstraints.tightFor(
                    width: MobileLayoutTokens.minimumTapTarget,
                    height: MobileLayoutTokens.minimumTapTarget,
                  ),
                  padding: EdgeInsets.zero,
                  style: IconButton.styleFrom(
                    backgroundColor: tokens.paper,
                    foregroundColor: tokens.ink,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(Radii.button),
                      side: BorderSide(color: tokens.line),
                    ),
                  ),
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
                      style: context.mobileTypography.companyEntryTitle
                          .copyWith(
                            color: tokens.ink,
                            fontSize: 15,
                            height: 1.35,
                          ),
                    ),
                    if (subtitle?.isNotEmpty == true)
                      Text(subtitle!, style: _headerSubtitleStyle(context)),
                  ],
                ),
              ),
              const SizedBox(width: MobileLayoutTokens.minimumTapTarget),
            ],
          ),
        ),
      ),
    );
  }
}

class _WorkflowActionButton extends StatelessWidget {
  const _WorkflowActionButton({
    required this.label,
    required this.onPressed,
    this.isLoading = false,
    this.isPrimary = true,
  });

  final String label;
  final VoidCallback? onPressed;
  final bool isLoading;
  final bool isPrimary;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return FilledButton(
      onPressed: onPressed,
      style: FilledButton.styleFrom(
        minimumSize: const Size.fromHeight(46),
        backgroundColor: isPrimary ? context.appColors.plum : tokens.soft,
        foregroundColor: isPrimary ? tokens.canvas : tokens.action,
        disabledBackgroundColor: tokens.soft,
        disabledForegroundColor: tokens.muted,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.button),
        ),
      ),
      child: isLoading
          ? const SizedBox.square(
              dimension: 16,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : Text(label),
    );
  }
}

InputDecoration _workflowFieldDecoration(
  BuildContext context, {
  required String hint,
}) => InputDecoration(
  hintText: hint,
  hintStyle: TextStyle(
    color: context.mobileTokens.paper,
    fontSize: 14,
    height: 1.6,
  ),
  filled: true,
  fillColor: context.mobileTokens.paper,
  contentPadding: const EdgeInsets.all(12),
  border: OutlineInputBorder(
    borderRadius: BorderRadius.circular(12),
    borderSide: BorderSide(color: context.mobileTokens.line),
  ),
  enabledBorder: OutlineInputBorder(
    borderRadius: BorderRadius.circular(12),
    borderSide: BorderSide(color: context.mobileTokens.line),
  ),
  focusedBorder: OutlineInputBorder(
    borderRadius: BorderRadius.circular(12),
    borderSide: BorderSide(color: context.mobileTokens.action, width: 1.5),
  ),
);

Widget _workflowFieldLabel(BuildContext context, String label) =>
    ExcludeSemantics(
      child: Padding(
        padding: const EdgeInsets.only(top: 16, bottom: 7),
        child: Text(
          label,
          style: context.mobileTypography.companyEntryTitle.copyWith(
            color: context.mobileTokens.ink,
            fontSize: 12.5,
          ),
        ),
      ),
    );

TextStyle _workflowControlStyle(BuildContext context) => context
    .mobileTypography
    .goalBody
    .copyWith(color: context.mobileTokens.ink, fontSize: 14, height: 1.6);

TextStyle _sectionStyle(BuildContext context) => context
    .mobileTypography
    .goalSectionTitle
    .copyWith(color: context.mobileTokens.ink, fontSize: 16);

TextStyle _heroTitleStyle(BuildContext context) =>
    context.mobileTypography.companyHubTitle.copyWith(
      color: context.mobileTokens.ink,
      fontSize: 29,
      height: 1.16,
      letterSpacing: -1,
    );

TextStyle _heroDescriptionStyle(BuildContext context) => context
    .mobileTypography
    .companyEntryDescription
    .copyWith(color: context.mobileTokens.muted, fontSize: 14, height: 1.6);

TextStyle _noticeTitleStyle(BuildContext context) => context
    .mobileTypography
    .companyEntryTitle
    .copyWith(color: context.mobileTokens.ink, fontSize: 13.5);

TextStyle _noticeDescriptionStyle(BuildContext context) => context
    .mobileTypography
    .companyEntryDescription
    .copyWith(color: context.mobileTokens.muted, fontSize: 12.5, height: 1.6);

TextStyle _stepTitleStyle(BuildContext context) => context
    .mobileTypography
    .goalSectionTitle
    .copyWith(color: context.mobileTokens.ink, fontSize: 15);

TextStyle _stepDescriptionStyle(BuildContext context) => context
    .mobileTypography
    .goalBody
    .copyWith(color: context.mobileTokens.ink, fontSize: 14, height: 1.6);

TextStyle _runnerTitleStyle(BuildContext context) => context
    .mobileTypography
    .companyEntryTitle
    .copyWith(color: context.mobileTokens.ink, fontSize: 13);

TextStyle _runnerDescriptionStyle(BuildContext context) => context
    .mobileTypography
    .companyEntryDescription
    .copyWith(color: context.mobileTokens.muted, fontSize: 11, height: 1.45);

TextStyle _runnerInitialStyle(BuildContext context) => context
    .mobileTypography
    .companyEntryDescription
    .copyWith(color: context.mobileTokens.action, fontSize: 10, height: 1.2);

TextStyle _stepNumberStyle(BuildContext context) => context
    .mobileTypography
    .companyEntryDescription
    .copyWith(color: context.mobileTokens.action, fontSize: 13, height: 1.2);

TextStyle _rowTitleStyle(BuildContext context) => context
    .mobileTypography
    .companyEntryTitle
    .copyWith(color: context.mobileTokens.ink, fontSize: 14);

TextStyle _rowDescriptionStyle(BuildContext context) => context
    .mobileTypography
    .companyEntryDescription
    .copyWith(color: context.mobileTokens.muted, fontSize: 11, height: 1.45);

TextStyle _factValueStyle(BuildContext context) => context
    .mobileTypography
    .companyEntryTitle
    .copyWith(color: context.mobileTokens.ink, fontSize: 13);

TextStyle _headerSubtitleStyle(BuildContext context) => context
    .mobileTypography
    .companyEntryDescription
    .copyWith(color: context.mobileTokens.muted, fontSize: 10.5, height: 1.4);

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
