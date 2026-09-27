import 'package:flutter/material.dart';

import '../../shared/theme/theme.dart';
import '../../shared/widgets/mobile_flow_app_bar.dart';

/// Displays the saved-feedback retry state from the mobile settings flow.
class SettingsFeedbackFailedPage extends StatelessWidget {
  const SettingsFeedbackFailedPage({super.key});

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Scaffold(
      backgroundColor: colors.surface,
      appBar: const MobileFlowAppBar(title: 'Feedback not sent'),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(
              Grid.gutter,
              Grid.sm,
              Grid.gutter,
              0,
            ),
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.all(Grid.xs),
              decoration: BoxDecoration(
                color: colors.errorContainer,
                borderRadius: BorderRadius.circular(Radii.sm),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Your feedback is retained',
                    style: context.textTheme.labelMedium?.copyWith(
                      color: colors.onErrorContainer,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: Grid.xxs),
                  Text(
                    'Retry from your draft.',
                    style: context.textTheme.bodySmall?.copyWith(
                      color: colors.onErrorContainer,
                    ),
                  ),
                ],
              ),
            ),
          ),
          const Spacer(),
          SafeArea(
            top: false,
            child: Container(
              padding: const EdgeInsets.fromLTRB(
                Grid.sm,
                Grid.xs,
                Grid.sm,
                Grid.xs,
              ),
              decoration: BoxDecoration(
                border: Border(top: BorderSide(color: colors.outlineVariant)),
              ),
              child: SizedBox(
                width: double.infinity,
                height: 44,
                child: FilledButton(
                  style: mobileFlowActionButtonStyle(context),
                  onPressed: () => Navigator.of(context).pop(),
                  child: const Text('Return to draft'),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
