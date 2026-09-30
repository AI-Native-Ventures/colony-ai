part of 'goal_lifecycle_pages.dart';

class _GoalActionBanner extends StatelessWidget {
  const _GoalActionBanner({
    this.kicker = 'GOAL ACTIONS',
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
              kicker,
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

class _GoalActionRow extends StatelessWidget {
  const _GoalActionRow({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Material(
      color: tokens.paper,
      borderRadius: BorderRadius.circular(Radii.companyCard),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
          child: Row(
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: tokens.soft,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(icon, size: 17, color: tokens.action),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: context.mobileTypography.companyEntryTitle
                          .copyWith(color: tokens.ink),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      subtitle,
                      style: context.mobileTypography.companyEntryDescription
                          .copyWith(color: tokens.muted),
                    ),
                  ],
                ),
              ),
              Icon(LucideIcons.chevronRight, size: 16, color: tokens.muted),
            ],
          ),
        ),
      ),
    );
  }
}

class _GoalConfirmationCard extends StatelessWidget {
  const _GoalConfirmationCard({
    required this.title,
    required this.message,
    required this.primaryLabel,
    required this.primarySaving,
    required this.onConfirm,
    required this.onCancel,
    required this.cancelLabel,
    this.failure,
  });

  final String title;
  final String message;
  final String primaryLabel;
  final bool primarySaving;
  final VoidCallback onConfirm;
  final VoidCallback onCancel;
  final String cancelLabel;
  final String? failure;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: tokens.paper,
        border: Border.all(color: tokens.line),
        borderRadius: BorderRadius.circular(Radii.companyCard),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              title,
              style: context.mobileTypography.companyEntryTitle.copyWith(
                color: tokens.ink,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              message,
              style: context.mobileTypography.companyEntryDescription.copyWith(
                color: tokens.muted,
                height: 1.5,
              ),
            ),
            if (failure != null) ...[
              const SizedBox(height: 12),
              _GoalNotice(
                title: 'Could not save',
                message: failure,
                isError: true,
              ),
            ],
            const SizedBox(height: 18),
            _GoalWideButton(
              label: primaryLabel,
              isPrimary: true,
              isSaving: primarySaving,
              onPressed: onConfirm,
            ),
            const SizedBox(height: 8),
            _GoalWideButton(
              label: cancelLabel,
              isPrimary: false,
              onPressed: onCancel,
            ),
          ],
        ),
      ),
    );
  }
}

class _GoalEditFieldCard extends StatelessWidget {
  const _GoalEditFieldCard({
    required this.title,
    required this.label,
    required this.controller,
    required this.buttonLabel,
    required this.isSaving,
    required this.onSave,
    required this.onChanged,
    this.maxLines = 1,
  });

  final String title;
  final String label;
  final TextEditingController controller;
  final String buttonLabel;
  final bool isSaving;
  final int maxLines;
  final VoidCallback onSave;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return _GoalCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _GoalFieldTitle(title: title),
          const SizedBox(height: 10),
          Text(
            label,
            style: context.mobileTypography.companyEntryDescription.copyWith(
              color: tokens.muted,
            ),
          ),
          const SizedBox(height: 6),
          TextField(
            controller: controller,
            maxLines: maxLines,
            minLines: maxLines,
            onChanged: onChanged,
            decoration: _fieldDecoration(context),
          ),
          const SizedBox(height: 12),
          _GoalWideButton(
            label: buttonLabel,
            isPrimary: true,
            isSaving: isSaving,
            onPressed: onSave,
          ),
        ],
      ),
    );
  }
}

class _GoalStatusFieldCard extends StatelessWidget {
  const _GoalStatusFieldCard({
    required this.status,
    required this.isSaving,
    required this.onChanged,
    required this.onSave,
  });

  final GoalStatus status;
  final bool isSaving;
  final ValueChanged<GoalStatus> onChanged;
  final VoidCallback onSave;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return _GoalCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _GoalFieldTitle(title: 'Status'),
          const SizedBox(height: 10),
          Text(
            'Goal status',
            style: context.mobileTypography.companyEntryDescription.copyWith(
              color: tokens.muted,
            ),
          ),
          const SizedBox(height: 6),
          DropdownButtonFormField<GoalStatus>(
            isExpanded: true,
            key: ValueKey(status),
            initialValue: status,
            decoration: _fieldDecoration(context),
            items:
                const [
                      GoalStatus.active,
                      GoalStatus.offPace,
                      GoalStatus.achieved,
                    ]
                    .map(
                      (value) => DropdownMenuItem(
                        value: value,
                        child: Text(value.displayLabel),
                      ),
                    )
                    .toList(),
            onChanged: (value) {
              if (value != null) onChanged(value);
            },
          ),
          const SizedBox(height: 8),
          Text(
            'You decide when it is achieved. Progress numbers never mark a goal achieved automatically.',
            style: context.mobileTypography.companyEntryDescription.copyWith(
              color: tokens.muted,
            ),
          ),
          const SizedBox(height: 8),
          _GoalNotice(
            title: 'You decide when it is achieved',
            message:
                'Progress numbers never mark a goal achieved automatically.',
          ),
          const SizedBox(height: 12),
          _GoalWideButton(
            label: 'Save status',
            isPrimary: true,
            isSaving: isSaving,
            onPressed: onSave,
          ),
        ],
      ),
    );
  }
}

class _GoalFieldTitle extends StatelessWidget {
  const _GoalFieldTitle({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Text(
            title,
            style: context.mobileTypography.companyEntryTitle.copyWith(
              color: context.mobileTokens.ink,
            ),
          ),
        ),
      ],
    );
  }
}

class _GoalCard extends StatelessWidget {
  const _GoalCard({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: BoxDecoration(
      color: context.mobileTokens.paper,
      border: Border.all(color: context.mobileTokens.line),
      borderRadius: BorderRadius.circular(Radii.companyCard),
    ),
    child: Padding(padding: const EdgeInsets.all(14), child: child),
  );
}

class _GoalNotice extends StatelessWidget {
  const _GoalNotice({required this.title, this.message, this.isError = false});

  final String title;
  final String? message;
  final bool isError;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    final border = isError ? tokens.error : tokens.action;
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
      decoration: BoxDecoration(
        color: tokens.paper,
        border: Border.all(color: tokens.line),
        borderRadius: BorderRadius.circular(Radii.companyCard),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 3,
            height: message == null ? 20 : 44,
            margin: const EdgeInsets.only(right: 9),
            decoration: BoxDecoration(
              color: border,
              borderRadius: BorderRadius.circular(3),
            ),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: context.mobileTypography.companyEntryTitle.copyWith(
                    color: tokens.ink,
                  ),
                ),
                if (message != null) ...[
                  const SizedBox(height: 5),
                  Text(
                    message!,
                    style: context.mobileTypography.companyEntryDescription
                        .copyWith(color: tokens.muted, height: 1.45),
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

class _GoalWideButton extends StatelessWidget {
  const _GoalWideButton({
    required this.label,
    required this.isPrimary,
    required this.onPressed,
    this.isSaving = false,
  });

  final String label;
  final bool isPrimary;
  final VoidCallback? onPressed;
  final bool isSaving;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return FilledButton(
      onPressed: isSaving ? null : onPressed,
      style: FilledButton.styleFrom(
        backgroundColor: isPrimary ? context.appColors.plum : tokens.soft,
        foregroundColor: isPrimary ? tokens.canvas : tokens.action,
        minimumSize: const Size.fromHeight(44),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.button),
        ),
      ),
      child: isSaving
          ? const SizedBox.square(
              dimension: 18,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : Text(label),
    );
  }
}

InputDecoration _fieldDecoration(BuildContext context) => InputDecoration(
  filled: true,
  fillColor: context.mobileTokens.paper,
  contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
  border: OutlineInputBorder(
    borderRadius: BorderRadius.circular(Radii.button),
    borderSide: BorderSide(color: context.mobileTokens.line),
  ),
  enabledBorder: OutlineInputBorder(
    borderRadius: BorderRadius.circular(Radii.button),
    borderSide: BorderSide(color: context.mobileTokens.line),
  ),
  focusedBorder: OutlineInputBorder(
    borderRadius: BorderRadius.circular(Radii.button),
    borderSide: BorderSide(color: context.mobileTokens.action, width: 1.5),
  ),
);
