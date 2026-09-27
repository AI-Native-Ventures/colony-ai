import 'package:flutter/material.dart';

import '../../shared/theme/theme.dart';
import '../../shared/widgets/mobile_flow_app_bar.dart';

/// Shows facts about the active local device without fabricating session data.
class SettingsDevicePage extends StatelessWidget {
  const SettingsDevicePage({
    required this.deviceName,
    required this.communityName,
    super.key,
  });

  final String deviceName;
  final String? communityName;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: context.mobileTokens.paper,
      appBar: MobileFlowAppBar(title: deviceName),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(
          Grid.gutter,
          Grid.xs,
          Grid.gutter,
          Grid.gutter,
        ),
        children: [
          _DeviceFact(label: 'Status', value: 'Active now'),
          _DeviceFact(
            label: 'Community',
            value: communityName ?? 'Unavailable',
          ),
        ],
      ),
    );
  }
}

class _DeviceFact extends StatelessWidget {
  const _DeviceFact({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Container(
    constraints: const BoxConstraints(minHeight: 58),
    decoration: BoxDecoration(
      border: Border(bottom: BorderSide(color: context.mobileTokens.line)),
    ),
    padding: const EdgeInsets.symmetric(vertical: Grid.xs),
    child: Row(
      children: [
        Expanded(
          child: Text(
            label,
            style: bodyExtraSmallTextStyle.copyWith(
              color: context.mobileTokens.muted,
            ),
          ),
        ),
        Text(value, style: context.mobileTypography.conversation),
      ],
    ),
  );
}
