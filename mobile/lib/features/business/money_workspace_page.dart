import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:intl/intl.dart';

import '../../shared/business/mobile_business_records.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/buzz_loading_indicator.dart';

part 'money_workspace_page/content.dart';
part 'money_workspace_page/detail.dart';

/// Shows invoice revenue backed by records in joined private client channels.
class MoneyWorkspacePage extends HookConsumerWidget {
  const MoneyWorkspacePage({
    required this.channelDirectory,
    required this.onRetryChannelDirectory,
    this.title = 'Money',
    this.onBack,
    this.showDueDates = true,
    this.onOpenIssuedInvoice,
    super.key,
  });

  final AsyncValue<List<MobileBusinessChannelCandidate>> channelDirectory;
  final VoidCallback onRetryChannelDirectory;
  final String title;
  final VoidCallback? onBack;
  final bool showDueDates;
  final ValueChanged<MobileBusinessRecord>? onOpenIssuedInvoice;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final refreshVersion = useState(0);
    final section = useState(_MoneySection.revenue);
    final selectedClientId = useState<String?>(null);
    final repository = ref.watch(mobileBusinessRepositoryProvider);
    final channels = channelDirectory.asData?.value ?? const [];
    final channelKey = channels.map((channel) => channel.id).join(',');
    final recordsFuture = useMemoized(() => repository.loadMoney(channels), [
      repository,
      channelKey,
      refreshVersion.value,
    ]);
    final recordsSnapshot = useFuture(recordsFuture);

    return ColoredBox(
      color: context.mobileTokens.canvas,
      child: Column(
        children: [
          _MoneyPageHeader(
            title: title,
            backLabel: onBack == null ? 'Back to company' : 'Back to Business',
            onBack: onBack ?? () => unawaited(Navigator.of(context).maybePop()),
          ),
          Expanded(
            child: channelDirectory.hasError
                ? _MoneyLoadError(onRetry: onRetryChannelDirectory)
                : channelDirectory.isLoading
                ? const Center(child: BuzzLoadingIndicator())
                : recordsSnapshot.hasError
                ? _MoneyLoadError(onRetry: () => refreshVersion.value++)
                : recordsSnapshot.connectionState != ConnectionState.done
                ? const Center(child: BuzzLoadingIndicator())
                : _MoneyWorkspaceContent(
                    records: recordsSnapshot.data!,
                    section: section.value,
                    selectedClientId: selectedClientId.value,
                    showDueDates: showDueDates,
                    onOpenIssuedInvoice: onOpenIssuedInvoice,
                    onSectionChanged: (value) => section.value = value,
                    onClientChanged: (value) => selectedClientId.value = value,
                    onRecordChanged: () => refreshVersion.value++,
                  ),
          ),
        ],
      ),
    );
  }
}
