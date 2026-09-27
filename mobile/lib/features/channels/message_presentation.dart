import 'package:flutter/foundation.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

@immutable
class DeliverablePreviewData {
  final String title;
  final String detail;
  final String brand;
  final String coverTitle;
  final String coverFooter;
  final String reviewStatus;
  final String versionLabel;

  const DeliverablePreviewData({
    required this.title,
    required this.detail,
    required this.brand,
    required this.coverTitle,
    required this.coverFooter,
    required this.reviewStatus,
    required this.versionLabel,
  });
}

@immutable
class QuotedMessagePreviewData {
  final String label;
  final String content;

  const QuotedMessagePreviewData({required this.label, required this.content});
}

@immutable
class ChannelMessagePresentation {
  final DeliverablePreviewData? deliverable;
  final QuotedMessagePreviewData? quote;
  final int? threadReplyCount;

  const ChannelMessagePresentation({
    this.deliverable,
    this.quote,
    this.threadReplyCount,
  });
}

/// Optional UI records for previews that are not encoded in message events.
/// Production message behavior remains driven by the relay event contract.
final channelMessagePresentationProvider =
    Provider<Map<String, ChannelMessagePresentation>>(
      (ref) => const <String, ChannelMessagePresentation>{},
    );
