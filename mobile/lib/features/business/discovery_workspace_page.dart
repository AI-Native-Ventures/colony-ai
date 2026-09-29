import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../shared/business/mobile_business_records.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/buzz_loading_indicator.dart';

part 'discovery_workspace_page/content.dart';

/// Shows prospects backed by business records in the private Sales stream.
class DiscoveryWorkspacePage extends HookConsumerWidget {
  const DiscoveryWorkspacePage({
    required this.channelDirectory,
    required this.communityId,
    required this.onRetryChannelDirectory,
    super.key,
  });

  final AsyncValue<List<MobileBusinessChannelCandidate>> channelDirectory;
  final String? communityId;
  final VoidCallback onRetryChannelDirectory;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final refreshVersion = useState(0);
    final query = useState('');
    final stage = useState('all');
    final repository = ref.watch(mobileBusinessRepositoryProvider);
    final channels = channelDirectory.asData?.value ?? const [];
    final channelKey = channels.map((channel) => channel.id).join(',');
    final recordsFuture = useMemoized(
      () => communityId == null
          ? Future<MobileDiscoveryRecords>.error(
              StateError('The active community is unavailable.'),
            )
          : repository.loadDiscovery(channels, communityId: communityId!),
      [repository, channelKey, communityId, refreshVersion.value],
    );
    final recordsSnapshot = useFuture(recordsFuture);

    return ColoredBox(
      color: context.mobileTokens.canvas,
      child: Column(
        children: [
          _BusinessPageHeader(
            title: 'Your leads',
            onBack: () => unawaited(Navigator.of(context).maybePop()),
          ),
          Expanded(
            child: channelDirectory.hasError
                ? _BusinessLoadError(onRetry: onRetryChannelDirectory)
                : channelDirectory.isLoading
                ? const Center(child: BuzzLoadingIndicator())
                : recordsSnapshot.hasError
                ? _BusinessLoadError(onRetry: () => refreshVersion.value++)
                : recordsSnapshot.connectionState != ConnectionState.done
                ? const Center(child: BuzzLoadingIndicator())
                : _DiscoveryWorkspaceContent(
                    records: recordsSnapshot.data!,
                    query: query.value,
                    selectedStage: stage.value,
                    onQueryChanged: (value) => query.value = value,
                    onStageChanged: (value) => stage.value = value,
                  ),
          ),
        ],
      ),
    );
  }
}
