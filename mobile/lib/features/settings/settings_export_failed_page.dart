import 'package:flutter/material.dart';

import '../../shared/navigation/mobile_navigation.dart';
import '../../shared/navigation/mobile_route.dart';
import '../../shared/navigation/mobile_routes.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/mobile_flow_app_bar.dart';

/// Displays the frozen export-unavailable recovery state.
class SettingsExportFailedPage extends StatelessWidget {
  const SettingsExportFailedPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: context.mobileTokens.canvas,
      appBar: const MobileFlowAppBar(title: 'Export unavailable'),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(
              Grid.gutter,
              Grid.thirty,
              Grid.gutter,
              0,
            ),
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: _exportErrorColor(context),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Your export could not be prepared',
                    style: context.mobileTypography.conversation.copyWith(
                      fontSize: 12,
                      color: _exportErrorTextColor(context),
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 5),
                  Text(
                    'No data was removed. Retry when the host is connected.',
                    style: context.mobileTypography.conversation.copyWith(
                      fontSize: 13,
                      height: 1.6,
                      color: _exportErrorTextColor(context),
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
                Grid.xs,
                Grid.gutter,
                Grid.xs,
                Grid.xxs,
              ),
              decoration: BoxDecoration(
                border: Border(
                  top: BorderSide(color: context.mobileTokens.line),
                ),
              ),
              child: SizedBox(
                width: double.infinity,
                height: 44,
                child: FilledButton(
                  style: mobileFlowActionButtonStyle(context),
                  onPressed: () =>
                      MobileNavigation.push<NoMobileRouteArguments, Object?>(
                        context,
                        MobileRoutes.settingsExport,
                        const NoMobileRouteArguments(),
                      ),
                  child: const Text('Retry export'),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

Color _exportErrorColor(BuildContext context) =>
    Theme.of(context).brightness == Brightness.dark
    ? const Color(0xFF492F3B)
    : const Color(0xFFF9EAF0);

Color _exportErrorTextColor(BuildContext context) =>
    Theme.of(context).brightness == Brightness.dark
    ? const Color(0xFFE5B6C5)
    : const Color(0xFF9B586B);
