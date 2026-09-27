import 'package:flutter/foundation.dart';

@immutable
class TodayReviewItem {
  const TodayReviewItem({
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

@immutable
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
