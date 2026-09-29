import 'dart:async';

import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../channels/channels_page.dart';
import '../channels/channels_provider.dart';
import 'workflow_detail_page.dart';
import '../../shared/auth/auth.dart';
import '../../shared/company/workflows/workflow_records.dart';
import '../../shared/company/workflows/workflow_repository.dart';
import '../../shared/community/community_membership_provider.dart';
import '../../shared/relay/relay.dart';

/// Builds the relay-backed workflow detail destination for the mobile router.
Widget workflowDetailRoute(BuildContext context, String workflowId) {
  return Consumer(
    builder: (context, ref, _) {
      void onBack() => unawaited(Navigator.of(context).maybePop());
      void onQuickActions() => ChannelQuickActionsLauncher.openFromHome(ref);
      final communityName = ref.watch(activeCommunityProvider).value?.name;

      if (!isWorkflowId(workflowId)) {
        return WorkflowDetailUnavailablePage(onBack: onBack, onRetry: onBack);
      }
      final channelsAsync = ref.watch(channelsProvider);
      return channelsAsync.when(
        loading: () => WorkflowDetailLoadingPage(
          onBack: onBack,
          communityName: communityName,
          onQuickActions: onQuickActions,
        ),
        error: (_, _) => WorkflowDetailUnavailablePage(
          onBack: onBack,
          onRetry: () => ref.invalidate(channelsProvider),
        ),
        data: (channels) {
          final availableChannels = channels
              .where((channel) => channel.isMember && channel.isStream)
              .toList();
          final channelIds =
              availableChannels
                  .map((channel) => channel.id.toLowerCase())
                  .toSet()
                  .toList()
                ..sort();
          final query = WorkflowQuery(
            workflowId: workflowId.toLowerCase(),
            channelIds: channelIds,
          );
          final workflowAsync = ref.watch(workflowRecordProvider(query));
          return workflowAsync.when(
            loading: () => WorkflowDetailLoadingPage(
              onBack: onBack,
              communityName: communityName,
              onQuickActions: onQuickActions,
            ),
            error: (_, _) => WorkflowDetailUnavailablePage(
              onBack: onBack,
              onRetry: () => ref.invalidate(workflowRecordProvider(query)),
            ),
            data: (record) {
              if (record == null) {
                return WorkflowDetailUnavailablePage(
                  onBack: onBack,
                  onRetry: () => ref.invalidate(workflowRecordProvider(query)),
                );
              }
              final channel = availableChannels
                  .where(
                    (candidate) =>
                        candidate.id.toLowerCase() == record.channelId,
                  )
                  .firstOrNull;
              final role = ref
                  .watch(currentCommunityRoleProvider)
                  .asData
                  ?.value
                  ?.name;
              final actor = ref.watch(myPubkeyProvider)?.toLowerCase();
              return WorkflowDetailPage(
                record: record,
                communityName: communityName,
                channelName: channel?.name,
                canChange:
                    actor == record.ownerPubkey ||
                    role == 'owner' ||
                    role == 'admin',
                onBack: onBack,
                onQuickActions: onQuickActions,
                onSetStatus: (expectedRecord, status) async {
                  try {
                    return await ref
                        .read(workflowRepositoryProvider)
                        .setStatus(
                          expectedRecord: expectedRecord,
                          status: status,
                          channelIds: channelIds,
                        );
                  } finally {
                    ref.invalidate(workflowRecordProvider(query));
                  }
                },
              );
            },
          );
        },
      );
    },
  );
}
