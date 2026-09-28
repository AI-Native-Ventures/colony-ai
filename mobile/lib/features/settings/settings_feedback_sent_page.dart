import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../shared/navigation/mobile_routes.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/mobile_flow_app_bar.dart';

/// Confirms the local feedback preview without claiming it was delivered.
class SettingsFeedbackSentPage extends StatelessWidget {
  const SettingsFeedbackSentPage({super.key});

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Scaffold(
      backgroundColor: context.mobileTokens.canvas,
      appBar: const MobileFlowAppBar(title: 'Feedback sent'),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(
          Grid.gutter,
          Grid.lg + Grid.xs,
          Grid.gutter,
          Grid.lg,
        ),
        children: [
          Align(
            alignment: Alignment.centerLeft,
            child: Container(
              width: 62,
              height: 62,
              decoration: BoxDecoration(
                color: colors.tertiaryContainer,
                borderRadius: BorderRadius.circular(Radii.md),
              ),
              child: Icon(
                LucideIcons.check,
                color: colors.onTertiaryContainer,
                size: 24,
              ),
            ),
          ),
          const SizedBox(height: Grid.lg),
          Text(
            'Thank you',
            style: context.textTheme.headlineMedium?.copyWith(
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: Grid.xxs),
          Text(
            'Your feedback submission is shown here as a preview. No report was sent.',
            style: context.textTheme.bodySmall?.copyWith(
              color: context.mobileTokens.muted,
            ),
          ),
          const SizedBox(height: Grid.sm),
          SizedBox(
            width: double.infinity,
            height: 44,
            child: FilledButton(
              style: mobileFlowActionButtonStyle(context),
              onPressed: () => Navigator.of(context).popUntil(
                (route) =>
                    route.settings.name == MobileRoutes.settingsHome.path,
              ),
              child: const Text('Done'),
            ),
          ),
        ],
      ),
    );
  }
}
