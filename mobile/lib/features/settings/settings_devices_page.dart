import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../shared/theme/theme.dart';
import '../../shared/widgets/mobile_flow_app_bar.dart';

/// Lists the current local device without inventing remote session records.
class SettingsDevicesPage extends StatelessWidget {
  const SettingsDevicesPage({
    required this.currentDeviceName,
    required this.onOpenCurrentDevice,
    required this.onLinkAnotherDevice,
    super.key,
  });

  final String currentDeviceName;
  final VoidCallback onOpenCurrentDevice;
  final VoidCallback onLinkAnotherDevice;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: context.mobileTokens.canvas,
      appBar: const MobileFlowAppBar(title: 'Devices'),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(
          Grid.gutter,
          Grid.xs,
          Grid.gutter,
          Grid.gutter,
        ),
        children: [
          Semantics(
            button: true,
            label: currentDeviceName,
            onTap: onOpenCurrentDevice,
            child: ExcludeSemantics(
              child: InkWell(
                onTap: onOpenCurrentDevice,
                child: Container(
                  constraints: const BoxConstraints(minHeight: 68),
                  decoration: BoxDecoration(
                    border: Border(
                      bottom: BorderSide(color: context.mobileTokens.line),
                    ),
                  ),
                  child: Row(
                    children: [
                      SizedBox(
                        width: 40,
                        child: Icon(
                          LucideIcons.signal,
                          size: 18,
                          color: context.mobileTokens.ink,
                        ),
                      ),
                      const SizedBox(width: Grid.xxs),
                      Expanded(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              currentDeviceName,
                              style: context.mobileTypography.conversation
                                  .copyWith(fontWeight: FontWeight.w600),
                            ),
                            const SizedBox(height: Grid.quarter),
                            Text(
                              'Active now',
                              style: bodyExtraSmallTextStyle.copyWith(
                                color: context.mobileTokens.muted,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(height: Grid.xs),
          SizedBox(
            width: double.infinity,
            height: 44,
            child: FilledButton.tonal(
              onPressed: onLinkAnotherDevice,
              child: const Text('Link another device'),
            ),
          ),
        ],
      ),
    );
  }
}
