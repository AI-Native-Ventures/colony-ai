import 'package:flutter/material.dart';

import '../../shared/theme/theme.dart';
import '../../shared/widgets/mobile_flow_app_bar.dart';

/// Shows the designed clear-downloads confirmation without claiming an
/// inventory or deleting files until the mobile cache service is available.
class SettingsClearCachePage extends StatelessWidget {
  const SettingsClearCachePage({super.key});

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Scaffold(
      backgroundColor: colors.surface,
      appBar: const MobileFlowAppBar(title: 'Clear downloads?'),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(
                Grid.gutter,
                Grid.scrollInset + Grid.half,
                Grid.gutter,
                Grid.gutter,
              ),
              children: [
                Text(
                  'Remove downloaded files from this phone. Drafts, queued messages, and server content are retained.',
                  style: context.textTheme.bodySmall?.copyWith(
                    color: colors.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(
                Grid.sm,
                Grid.xs,
                Grid.sm,
                Grid.xs,
              ),
              child: Semantics(
                enabled: false,
                label:
                    'Clear downloads. Unavailable because downloaded files are not tracked by a cache inventory or deletion service.',
                child: SizedBox(
                  width: double.infinity,
                  height: 44,
                  child: FilledButton(
                    style: mobileFlowActionButtonStyle(context),
                    onPressed: null,
                    child: const Text('Clear downloads'),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
