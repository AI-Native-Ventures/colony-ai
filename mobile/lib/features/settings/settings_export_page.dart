import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';

import '../../shared/navigation/mobile_navigation.dart';
import '../../shared/navigation/mobile_route.dart';
import '../../shared/navigation/mobile_routes.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/mobile_flow_app_bar.dart';

const _exportOptions = <String>[
  'Messages and files',
  'Files only',
  'Audit trail',
];

/// Shows the designed export preview and avoids claiming a file was produced.
class SettingsExportPage extends HookWidget {
  const SettingsExportPage({super.key});

  @override
  Widget build(BuildContext context) {
    final selection = useState(_exportOptions.first);
    final colors = context.colors;
    return Scaffold(
      backgroundColor: context.mobileTokens.paper,
      appBar: const MobileFlowAppBar(title: 'Export data'),
      body: Column(
        children: [
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(
                Grid.gutter,
                Grid.twelve,
                Grid.gutter,
                Grid.lg,
              ),
              children: [
                Text('Include', style: context.textTheme.labelSmall),
                const SizedBox(height: Grid.xxs),
                DropdownButtonFormField<String>(
                  initialValue: selection.value,
                  isExpanded: true,
                  decoration: const InputDecoration(
                    border: OutlineInputBorder(),
                    constraints: BoxConstraints(minHeight: 48),
                    contentPadding: EdgeInsets.symmetric(
                      horizontal: Grid.twelve,
                      vertical: Grid.twelve,
                    ),
                  ),
                  style: context.mobileTypography.conversation.copyWith(
                    color: context.mobileTokens.ink,
                  ),
                  items: _exportOptions
                      .map(
                        (option) => DropdownMenuItem(
                          value: option,
                          child: Text(option),
                        ),
                      )
                      .toList(),
                  onChanged: (value) {
                    if (value != null) selection.value = value;
                  },
                ),
                const SizedBox(height: Grid.twelve),
                Text(
                  'Exports include only records your role permits. Preparing an export may take time.',
                  style: context.mobileTypography.conversation.copyWith(
                    fontSize: 13,
                    height: 1.6,
                    color: context.mobileTokens.muted,
                  ),
                ),
                const SizedBox(height: Grid.xxs),
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton(
                    style: TextButton.styleFrom(
                      alignment: Alignment.centerLeft,
                      foregroundColor: colors.primary,
                      minimumSize: Size.zero,
                      padding: EdgeInsets.zero,
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      textStyle: context.mobileTypography.metadata.copyWith(
                        fontSize: 12,
                      ),
                    ),
                    onPressed: () =>
                        MobileNavigation.push<NoMobileRouteArguments, Object?>(
                          context,
                          MobileRoutes.settingsExportFailed,
                          const NoMobileRouteArguments(),
                        ),
                    child: const Text('Preview export failure'),
                  ),
                ),
              ],
            ),
          ),
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
                  onPressed: () => ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text(
                        'Export prepared in this preview. No file downloaded.',
                      ),
                    ),
                  ),
                  child: const Text('Prepare export preview'),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
