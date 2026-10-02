import 'package:flutter/foundation.dart';

@immutable
/// A Day Overview figure backed by a live provider.
class TodayOverviewMetric {
  const TodayOverviewMetric({
    required this.value,
    required this.label,
    this.onTap,
  });

  final String value;
  final String label;
  final VoidCallback? onTap;
}

@immutable
/// An approval request displayed in Today.
class TodayReviewItem {
  const TodayReviewItem({
    required this.id,
    required this.requesterName,
    required this.title,
    required this.subtitle,
    required this.initials,
    this.requesterIsAgent = false,
  });

  final String id;
  final String requesterName;
  final String title;
  final String subtitle;
  final String initials;
  final bool requesterIsAgent;
}

@immutable
/// A real activity record that shows work moving forward.
class TodayProgressItem {
  const TodayProgressItem({
    required this.id,
    required this.title,
    required this.subtitle,
    required this.initials,
    this.isAgent = false,
  });

  final String id;
  final String title;
  final String subtitle;
  final String initials;
  final bool isAgent;
}

@immutable
/// A published team update displayed in Today.
class TodayTeamUpdate {
  const TodayTeamUpdate({
    required this.id,
    required this.title,
    required this.subtitle,
    required this.initials,
  });

  final String id;
  final String title;
  final String subtitle;
  final String initials;
}
