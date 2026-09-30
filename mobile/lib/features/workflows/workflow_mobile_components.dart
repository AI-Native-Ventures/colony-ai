part of 'workflow_mobile_pages.dart';

class _WorkflowPickerRow extends StatelessWidget {
  const _WorkflowPickerRow({
    required this.record,
    required this.channel,
    required this.onTap,
  });

  final WorkflowRecord record;
  final Channel? channel;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 10),
    child: _WorkflowSectionCard(
      onTap: onTap,
      title: record.name,
      trailing: const Icon(LucideIcons.chevronRight, size: 18),
      child: Row(
        children: [
          _StatusChip(label: record.isDraft ? 'Draft' : record.status.name),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              channel?.name ?? record.channelId,
              style: _mutedStyle(context),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    ),
  );
}

class _WorkflowStepSummary extends StatelessWidget {
  const _WorkflowStepSummary({required this.index, required this.step});

  final int index;
  final WorkflowStepRecord step;

  @override
  Widget build(BuildContext context) => ListTile(
    contentPadding: EdgeInsets.zero,
    leading: CircleAvatar(
      radius: 15,
      backgroundColor: context.mobileTokens.soft,
      child: Text('$index', style: _mutedStyle(context)),
    ),
    title: Text(step.title.isEmpty ? 'Step $index' : step.title),
    subtitle: Text(
      step.kind == WorkflowStepKind.agent
          ? 'Agent · ${step.expectedResult ?? 'Completion condition not set'}'
          : 'Human review · A human approves the result',
      style: _mutedStyle(context),
      maxLines: 2,
      overflow: TextOverflow.ellipsis,
    ),
  );
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

class _WorkflowSectionCard extends StatelessWidget {
  const _WorkflowSectionCard({
    required this.title,
    required this.child,
    this.onTap,
    this.trailing,
  });

  final String title;
  final Widget child;
  final VoidCallback? onTap;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) => Card(
    color: context.mobileTokens.paper,
    elevation: 0,
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(Radii.companyCard),
      side: BorderSide(color: context.mobileTokens.line),
    ),
    clipBehavior: Clip.antiAlias,
    child: InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(child: Text(title, style: _sectionStyle(context))),
                ?trailing,
              ],
            ),
            const SizedBox(height: 8),
            child,
          ],
        ),
      ),
    ),
  );
}

class _WorkflowStatusCard extends StatelessWidget {
  const _WorkflowStatusCard({
    required this.label,
    required this.detail,
    required this.icon,
  });

  final String label;
  final String detail;
  final IconData icon;

  @override
  Widget build(BuildContext context) => _WorkflowSectionCard(
    title: label,
    child: Row(
      children: [
        Icon(icon, size: 18, color: context.mobileTokens.action),
        const SizedBox(width: 8),
        Expanded(child: Text(detail, style: _mutedStyle(context))),
      ],
    ),
  );
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: BoxDecoration(
      color: context.mobileTokens.soft,
      borderRadius: BorderRadius.circular(Radii.button),
    ),
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      child: Text(label, style: _mutedStyle(context)),
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

class _WorkflowInlineError extends StatelessWidget {
  const _WorkflowInlineError({required this.message, this.title});

  final String? title;
  final String message;

  @override
  Widget build(BuildContext context) => Container(
    decoration: BoxDecoration(
      color: context.mobileTokens.soft,
      borderRadius: BorderRadius.circular(Radii.companyCard),
      border: Border.all(color: context.mobileTokens.line),
    ),
    padding: const EdgeInsets.all(14),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title ?? 'Could not save workflow', style: _sectionStyle(context)),
        const SizedBox(height: 5),
        Text(message, style: _mutedStyle(context)),
      ],
    ),
  );
}

class _WorkflowMessage extends StatelessWidget {
  const _WorkflowMessage({
    required this.title,
    this.message,
    this.actionLabel,
    this.onAction,
  });

  final String title;
  final String? message;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            title,
            style: _sectionStyle(context),
            textAlign: TextAlign.center,
          ),
          if (message != null) ...[
            const SizedBox(height: 8),
            Text(
              message!,
              style: _mutedStyle(context),
              textAlign: TextAlign.center,
            ),
          ],
          if (onAction != null && actionLabel != null) ...[
            const SizedBox(height: 16),
            TextButton(onPressed: onAction, child: Text(actionLabel!)),
          ],
        ],
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

String _stepKindLabel(WorkflowStepRecord step) =>
    step.kind == WorkflowStepKind.agent ? 'Agent step' : 'Human review';

String _statusLabel(String status) => status
    .replaceAll('_', ' ')
    .split(' ')
    .map((word) {
      if (word.isEmpty) return word;
      return '${word[0].toUpperCase()}${word.substring(1)}';
    })
    .join(' ');

String _dateLabel(int timestamp) {
  final date = DateTime.fromMillisecondsSinceEpoch(timestamp * 1000);
  return '${date.day} ${_month(date.month)} ${date.year} · ${date.hour.toString().padLeft(2, '0')}:${date.minute.toString().padLeft(2, '0')}';
}

String _month(int month) => const [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
][month - 1];
