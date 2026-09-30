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
        borderRadius: BorderRadius.circular(23),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 23),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              kicker,
              style: context.mobileTypography.companySection.copyWith(
                color: tokens.action,
                fontSize: 10,
                letterSpacing: 1.3,
              ),
            ),
            const SizedBox(height: 13),
            Text(title, style: _goalHeroTitleStyle(context)),
            if (message != null) ...[
              const SizedBox(height: 9),
              Text(message!, style: _goalHeroDescriptionStyle(context)),
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
      shape: RoundedRectangleBorder(
        side: BorderSide(color: tokens.line),
        borderRadius: BorderRadius.circular(16),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
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
                child: Icon(icon, size: 17, color: tokens.action),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: _goalRowTitleStyle(context)),
                    const SizedBox(height: 2),
                    Text(subtitle, style: _goalRowDescriptionStyle(context)),
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
        borderRadius: BorderRadius.circular(20),
      ),
      child: Padding(
        padding: const EdgeInsets.all(19),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              title,
              style: context.mobileTypography.goalSectionTitle.copyWith(
                color: tokens.ink,
                fontSize: 16.5,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              message,
              style: context.mobileTypography.goalBody.copyWith(
                color: tokens.muted,
                fontSize: 14,
                height: 1.6,
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
              fontSize: 12.5,
            ),
          ),
          const SizedBox(height: 6),
          TextField(
            controller: controller,
            maxLines: maxLines,
            minLines: maxLines,
            onChanged: onChanged,
            style: context.mobileTypography.goalBody.copyWith(
              color: tokens.ink,
              fontSize: 14,
              height: 1.6,
            ),
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
              fontSize: 12.5,
            ),
          ),
          const SizedBox(height: 6),
          DropdownButtonFormField<GoalStatus>(
            isExpanded: true,
            key: ValueKey(status),
            initialValue: status,
            decoration: _fieldDecoration(context),
            style: context.mobileTypography.goalBody.copyWith(
              color: tokens.ink,
              fontSize: 14,
              height: 1.6,
            ),
            items:
                const [
                      GoalStatus.active,
                      GoalStatus.offPace,
                      GoalStatus.achieved,
                    ]
                    .map(
                      (value) => DropdownMenuItem(
                        value: value,
                        child: Text(
                          value.displayLabel,
                          style: context.mobileTypography.goalBody.copyWith(
                            color: tokens.ink,
                            fontSize: 14,
                            height: 1.6,
                          ),
                        ),
                      ),
                    )
                    .toList(),
            onChanged: (value) {
              if (value != null) onChanged(value);
            },
          ),
          const SizedBox(height: 10),
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
            style: context.mobileTypography.goalSectionTitle.copyWith(
              color: context.mobileTokens.ink,
              fontSize: 16.5,
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
      borderRadius: BorderRadius.circular(20),
    ),
    child: Padding(padding: const EdgeInsets.all(19), child: child),
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
                  Text(
                    title,
                    style: context.mobileTypography.companyEntryTitle.copyWith(
                      color: tokens.ink,
                      fontSize: 13.5,
                    ),
                  ),
                  if (message != null) ...[
                    const SizedBox(height: 5),
                    Text(
                      message!,
                      style: context.mobileTypography.companyEntryDescription
                          .copyWith(
                            color: tokens.muted,
                            fontSize: 12.5,
                            height: 1.6,
                          ),
                    ),
                  ],
                ],
              ),
            ),
            Positioned(
              left: 0,
              top: 0,
              bottom: 0,
              child: SizedBox(width: 3, child: ColoredBox(color: border)),
            ),
          ],
        ),
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
        minimumSize: const Size.fromHeight(46),
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
  contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
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

TextStyle _goalHeroTitleStyle(BuildContext context) =>
    context.mobileTypography.companyHubTitle.copyWith(
      color: context.mobileTokens.ink,
      fontSize: 29,
      height: 1.16,
      letterSpacing: -1,
    );

TextStyle _goalHeroDescriptionStyle(BuildContext context) => context
    .mobileTypography
    .companyEntryDescription
    .copyWith(color: context.mobileTokens.muted, fontSize: 14, height: 1.6);

TextStyle _goalRowTitleStyle(BuildContext context) => context
    .mobileTypography
    .companyEntryTitle
    .copyWith(color: context.mobileTokens.ink, fontSize: 14);

TextStyle _goalRowDescriptionStyle(BuildContext context) => context
    .mobileTypography
    .companyEntryDescription
    .copyWith(color: context.mobileTokens.muted, fontSize: 11, height: 1.45);
