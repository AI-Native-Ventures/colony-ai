import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../shared/relay/relay.dart';
import '../../shared/navigation/mobile_route.dart';
import 'deliverable_business_records.dart';

@immutable
class DeliverableReviewRequest {
  const DeliverableReviewRequest({
    required this.reference,
    required this.clientName,
    this.deliverableId,
    this.versionEventId,
  });

  final WorkItemReference reference;
  final String clientName;
  final String? deliverableId;
  final String? versionEventId;

  @override
  bool operator ==(Object other) =>
      other is DeliverableReviewRequest &&
      other.reference.clientId == reference.clientId &&
      other.reference.workItemId == reference.workItemId &&
      other.reference.authorPubkey == reference.authorPubkey &&
      other.reference.dTag == reference.dTag &&
      other.clientName == clientName &&
      other.deliverableId == deliverableId &&
      other.versionEventId == versionEventId;

  @override
  int get hashCode => Object.hash(
    reference.clientId,
    reference.workItemId,
    reference.authorPubkey,
    reference.dTag,
    clientName,
    deliverableId,
    versionEventId,
  );
}

abstract final class ChannelDeliverableRoutes {
  static const review = MobileRoute<DeliverableReviewRequest>(
    'channels/deliverable-review',
  );
}

@immutable
class DeliverableReviewBundle {
  const DeliverableReviewBundle({
    required this.request,
    required this.head,
    required this.version,
    required this.currentPointer,
    required this.latestApproval,
    required this.currentPubkey,
    this.unavailableReason,
  });

  final DeliverableReviewRequest request;
  final WorkItemHeadRecord? head;
  final DeliverableVersionRecord? version;
  final DeliverablePointer? currentPointer;
  final DeliverableApprovalRecord? latestApproval;
  final String? currentPubkey;
  final String? unavailableReason;

  bool get isAvailable =>
      unavailableReason == null && head != null && version != null;

  bool get isStale =>
      isAvailable &&
      (currentPointer == null ||
          currentPointer!.versionEventId != version!.event.id ||
          currentPointer!.contentDigest != version!.contentDigest ||
          currentPointer!.mediaDigest != version!.mediaDigest ||
          currentPointer!.versionDigest != version!.versionDigest);

  bool get isAuthorized =>
      isAvailable &&
      !isStale &&
      head!.status.toLowerCase() != 'archived' &&
      currentPubkey != null &&
      head!.approverPubkeys.contains(currentPubkey!.toLowerCase());

  String? get statusLabel {
    if (!isAvailable) return null;
    if (isStale) return 'This version is out of date';
    return switch (latestApproval?.decision) {
      DeliverableApprovalDecision.approved => 'Approved',
      DeliverableApprovalDecision.changesRequested => 'Changes requested',
      DeliverableApprovalDecision.rejected => 'Rejected',
      null => 'Your review is needed',
    };
  }
}

/// Relay operations used by the production parser and provider seam.
abstract interface class DeliverableRecordGateway {
  Future<List<NostrEvent>> fetch(NostrFilter filter);
  Future<void Function()> subscribe(
    NostrFilter filter,
    void Function(NostrEvent event) onEvent,
  );
  Future<NostrEvent> publish({
    required int kind,
    required String content,
    required List<List<String>> tags,
    void Function(NostrEvent event)? onSigned,
  });
}

class RelayDeliverableRecordGateway implements DeliverableRecordGateway {
  RelayDeliverableRecordGateway({required this.session, required this.nsec});

  final RelaySessionNotifier session;
  final String? nsec;

  @override
  Future<List<NostrEvent>> fetch(NostrFilter filter) =>
      session.fetchHistory(filter, timeout: const Duration(seconds: 8));

  @override
  Future<void Function()> subscribe(
    NostrFilter filter,
    void Function(NostrEvent event) onEvent,
  ) => session.subscribe(filter, onEvent);

  @override
  Future<NostrEvent> publish({
    required int kind,
    required String content,
    required List<List<String>> tags,
    void Function(NostrEvent event)? onSigned,
  }) => SignedEventRelay(
    session: session,
    nsec: nsec,
  ).submit(kind: kind, content: content, tags: tags, onSigned: onSigned);
}

final deliverableRecordGatewayProvider = Provider<DeliverableRecordGateway>(
  (ref) => RelayDeliverableRecordGateway(
    session: ref.read(relaySessionProvider.notifier),
    nsec: ref.watch(relayConfigProvider).nsec,
  ),
);

class DeliverableReviewRepository {
  DeliverableReviewRepository(this.gateway);

  final DeliverableRecordGateway gateway;

  Future<DeliverableReviewBundle> load(
    DeliverableReviewRequest request, {
    required String? currentPubkey,
  }) async {
    final reference = request.reference;
    final headEvents = await gateway.fetch(
      NostrFilter(
        kinds: const [EventKind.workItemHead],
        authors: [reference.authorPubkey],
        tags: {
          '#h': [reference.clientId],
          '#d': [reference.dTag],
        },
        limit: 2,
      ),
    );
    if (headEvents.length > 1) {
      throw const FormatException('work item coordinate is not unique');
    }
    final headEvent = headEvents.firstOrNull;
    if (headEvent == null) {
      return DeliverableReviewBundle(
        request: request,
        head: null,
        version: null,
        currentPointer: null,
        latestApproval: null,
        currentPubkey: currentPubkey,
        unavailableReason: 'Work item is unavailable.',
      );
    }
    if (headEvent.pubkey.toLowerCase() != reference.authorPubkey) {
      throw const FormatException('work item coordinate author does not match');
    }
    final head = parseWorkItemHead(headEvent);
    if (head.clientId != reference.clientId ||
        head.workItemId != reference.workItemId) {
      throw const FormatException('work item query returned another record');
    }

    DeliverablePointer? currentPointer;
    final targetId = request.versionEventId;
    if (request.deliverableId != null) {
      currentPointer = head.deliverables
          .where((pointer) => pointer.deliverableId == request.deliverableId)
          .firstOrNull;
    } else if (targetId == null && head.deliverables.length == 1) {
      currentPointer = head.deliverables.single;
    } else if (targetId == null && head.deliverables.length != 1) {
      return DeliverableReviewBundle(
        request: request,
        head: head,
        version: null,
        currentPointer: null,
        latestApproval: null,
        currentPubkey: currentPubkey,
        unavailableReason: head.deliverables.isEmpty
            ? 'No deliverable is attached to this work item.'
            : 'This work item has more than one deliverable.',
      );
    }

    final resolvedTargetId = targetId ?? currentPointer?.versionEventId;
    if (resolvedTargetId == null) {
      return DeliverableReviewBundle(
        request: request,
        head: head,
        version: null,
        currentPointer: currentPointer,
        latestApproval: null,
        currentPubkey: currentPubkey,
        unavailableReason: 'The deliverable version is unavailable.',
      );
    }
    final versionEvents = await gateway.fetch(
      NostrFilter(
        kinds: const [EventKind.deliverableVersion],
        ids: [resolvedTargetId],
        limit: 2,
      ),
    );
    if (versionEvents.length > 1) {
      throw const FormatException('deliverable version id is not unique');
    }
    final versionEvent = versionEvents.firstOrNull;
    if (versionEvent == null) {
      return DeliverableReviewBundle(
        request: request,
        head: head,
        version: null,
        currentPointer: currentPointer,
        latestApproval: null,
        currentPubkey: currentPubkey,
        unavailableReason: 'The deliverable version is unavailable.',
      );
    }
    final version = parseDeliverableVersion(versionEvent);
    if (version.event.id != resolvedTargetId ||
        version.clientId != reference.clientId ||
        version.workItemId != reference.workItemId ||
        (request.deliverableId != null &&
            version.deliverableId != request.deliverableId)) {
      throw const FormatException(
        'deliverable version does not match its reference',
      );
    }
    currentPointer ??= head.deliverables
        .where((pointer) => pointer.deliverableId == version.deliverableId)
        .firstOrNull;
    if (currentPointer != null &&
        currentPointer.versionEventId == version.event.id &&
        (currentPointer.contentDigest != version.contentDigest ||
            currentPointer.mediaDigest != version.mediaDigest ||
            currentPointer.versionDigest != version.versionDigest)) {
      throw const FormatException(
        'work item pointer does not match the version',
      );
    }

    final approvalEvents = await gateway.fetch(
      NostrFilter(
        kinds: const [EventKind.deliverableApproval],
        tags: {
          '#h': [reference.clientId],
          '#d': [
            _deliverableApprovalDTag(reference.clientId, version.event.id),
          ],
        },
        limit: 1000,
      ),
    );
    final approvals = approvalEvents.map(parseDeliverableApproval).toList();
    if (approvals.any(
      (approval) =>
          approval.clientId != version.clientId ||
          approval.workItemId != version.workItemId ||
          approval.deliverableId != version.deliverableId ||
          approval.versionEventId != version.event.id ||
          approval.contentDigest != version.contentDigest ||
          approval.mediaDigest != version.mediaDigest,
    )) {
      throw const FormatException(
        'approval query returned a different version',
      );
    }
    approvals.sort((left, right) {
      final timeOrder = right.event.createdAt.compareTo(left.event.createdAt);
      return timeOrder != 0
          ? timeOrder
          : right.event.id.compareTo(left.event.id);
    });
    return DeliverableReviewBundle(
      request: request,
      head: head,
      version: version,
      currentPointer: currentPointer,
      latestApproval: approvals.firstOrNull,
      currentPubkey: currentPubkey,
    );
  }

  Future<NostrEvent> submitDecision({
    required DeliverableReviewRequest request,
    required DeliverableVersionRecord version,
    required DeliverableApprovalDecision decision,
    String? note,
    void Function(NostrEvent event)? onSigned,
  }) async {
    final decisionText = switch (decision) {
      DeliverableApprovalDecision.approved => 'approved',
      DeliverableApprovalDecision.changesRequested => 'changes_requested',
      DeliverableApprovalDecision.rejected => 'rejected',
    };
    final content = jsonEncode({
      'schemaVersion': businessRecordSchemaVersion,
      'clientId': version.clientId,
      'workItemId': version.workItemId,
      'deliverableId': version.deliverableId,
      'versionEventId': version.event.id,
      'contentDigest': version.contentDigest,
      'mediaDigest': version.mediaDigest,
      'decision': decisionText,
      'note': note,
    });
    return gateway.publish(
      kind: EventKind.deliverableApproval,
      content: content,
      tags: [
        ['h', version.clientId],
        ['d', _deliverableApprovalDTag(version.clientId, version.event.id)],
      ],
      onSigned: onSigned,
    );
  }

  Future<void Function()> subscribe(
    DeliverableReviewRequest request,
    void Function(NostrEvent event) onEvent,
  ) => gateway.subscribe(
    NostrFilter(
      kinds: const [
        EventKind.workItemHead,
        EventKind.deliverableVersion,
        EventKind.deliverableApproval,
      ],
      tags: {
        '#h': [request.reference.clientId],
      },
      limit: 1000,
      since: DateTime.now().millisecondsSinceEpoch ~/ 1000,
    ),
    onEvent,
  );
}

final deliverableReviewRepositoryProvider =
    Provider<DeliverableReviewRepository>(
      (ref) => DeliverableReviewRepository(
        ref.watch(deliverableRecordGatewayProvider),
      ),
    );

final deliverableReviewProvider = StreamProvider.autoDispose
    .family<DeliverableReviewBundle, DeliverableReviewRequest>((
      ref,
      request,
    ) async* {
      final repository = ref.watch(deliverableReviewRepositoryProvider);
      final currentPubkey = ref.watch(myPubkeyProvider)?.toLowerCase();
      final controller = StreamController<DeliverableReviewBundle>();
      var active = true;
      var generation = 0;
      Future<void Function()>? pendingSubscription;
      void Function()? unsubscribe;

      Future<void> refresh() async {
        final turn = ++generation;
        try {
          final result = await repository.load(
            request,
            currentPubkey: currentPubkey,
          );
          if (active && turn == generation) controller.add(result);
        } catch (error, stackTrace) {
          if (active && turn == generation) {
            controller.addError(error, stackTrace);
          }
        }
      }

      ref.onDispose(() {
        active = false;
        unsubscribe?.call();
        controller.close();
      });

      pendingSubscription = repository.subscribe(request, (_) {
        unawaited(refresh());
      });
      try {
        final cancel = await pendingSubscription;
        if (!active) {
          cancel();
          return;
        }
        unsubscribe = cancel;
        await refresh();
        yield* controller.stream;
      } catch (error, stackTrace) {
        if (active) controller.addError(error, stackTrace);
        yield* controller.stream;
      } finally {
        active = false;
        unsubscribe?.call();
        if (!controller.isClosed) await controller.close();
      }
    });

String _deliverableApprovalDTag(String clientId, String versionEventId) =>
    'client:$clientId:deliverable-approval:$versionEventId';
