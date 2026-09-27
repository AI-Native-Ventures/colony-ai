import 'package:flutter/material.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/mobile_flow_app_bar.dart';

/// Keeps the current settings form mounted behind the designed save retry state.
class SettingsSaveFailedPage extends StatelessWidget {
  const SettingsSaveFailedPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: context.mobileTokens.paper,
      appBar: const MobileFlowAppBar(title: 'Changes not saved'),
      body: Padding(
        padding: const EdgeInsets.fromLTRB(Grid.gutter, 30, Grid.gutter, 0),
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: _settingsErrorColor(context),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Your edits are kept',
                style: context.mobileTypography.conversation.copyWith(
                  fontSize: 12,
                  color: _settingsErrorTextColor(context),
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 5),
              Text(
                'The server did not confirm your update. Return to the same form and retry.',
                style: context.mobileTypography.conversation.copyWith(
                  fontSize: 13,
                  height: 1.6,
                  color: _settingsErrorTextColor(context),
                ),
              ),
            ],
          ),
        ),
      ),
      bottomNavigationBar: SafeArea(
        top: false,
        child: Container(
          padding: const EdgeInsets.fromLTRB(
            Grid.xs,
            Grid.gutter,
            Grid.xs,
            Grid.xxs,
          ),
          decoration: BoxDecoration(
            border: Border(top: BorderSide(color: context.mobileTokens.line)),
          ),
          child: SizedBox(
            height: 44,
            child: FilledButton(
              style: mobileFlowActionButtonStyle(context),
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Return to my edits'),
            ),
          ),
        ),
      ),
    );
  }
}

Color _settingsErrorColor(BuildContext context) =>
    Theme.of(context).brightness == Brightness.dark
    ? const Color(0xFF492F3B)
    : const Color(0xFFF9EAF0);

Color _settingsErrorTextColor(BuildContext context) =>
    Theme.of(context).brightness == Brightness.dark
    ? const Color(0xFFE5B6C5)
    : const Color(0xFF9B586B);
