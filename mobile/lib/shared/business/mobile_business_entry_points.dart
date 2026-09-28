import 'package:flutter/foundation.dart';

import '../navigation/mobile_route.dart';

/// Grouping used by the Company hub for route-backed entry cards.
enum MobileBusinessSection { runCompany, growBusiness }

extension MobileBusinessSectionLabel on MobileBusinessSection {
  String get label => switch (this) {
    MobileBusinessSection.runCompany => 'Run the company',
    MobileBusinessSection.growBusiness => 'Grow the business',
  };
}

/// Typed destinations used by the Company hub when an app route is available.
abstract final class MobileBusinessRoutes {
  /// Destination for the people and agents directory.
  static const team = MobileRoute<NoMobileRouteArguments>('team');

  /// Destination for shared company outcomes.
  static const goals = MobileRoute<NoMobileRouteArguments>('goals');

  /// Destination for one company goal or sub-goal.
  static const goalDetail = MobileRoute<String>('goal');

  /// Destination for company work commitments.
  static const work = MobileRoute<NoMobileRouteArguments>('work');

  /// Destination for company workflows.
  static const workflows = MobileRoute<NoMobileRouteArguments>('workflows');

  /// Destination for business discovery.
  static const discovery = MobileRoute<NoMobileRouteArguments>(
    'business/discovery',
  );

  /// Destination for social publishing.
  static const social = MobileRoute<NoMobileRouteArguments>('business/social');

  /// Destination for the business website.
  static const website = MobileRoute<NoMobileRouteArguments>(
    'business/website',
  );

  /// Destination for business finances.
  static const money = MobileRoute<NoMobileRouteArguments>('business/money');
}

@immutable
class MobileBusinessEntryPoint {
  const MobileBusinessEntryPoint({
    required this.label,
    required this.description,
    required this.section,
    required this.route,
  });

  final String label;
  final String description;
  final MobileBusinessSection section;
  final MobileRoute<NoMobileRouteArguments> route;
}

/// Company destinations and labels from the approved mobile v5 reference.
abstract final class MobileBusinessEntryPoints {
  static const team = MobileBusinessEntryPoint(
    label: 'Team',
    description: 'People & agents',
    section: MobileBusinessSection.runCompany,
    route: MobileBusinessRoutes.team,
  );
  static const goals = MobileBusinessEntryPoint(
    label: 'Goals',
    description: 'Shared outcomes',
    section: MobileBusinessSection.runCompany,
    route: MobileBusinessRoutes.goals,
  );
  static const work = MobileBusinessEntryPoint(
    label: 'Work',
    description: 'Commitments & reviews',
    section: MobileBusinessSection.runCompany,
    route: MobileBusinessRoutes.work,
  );
  static const workflows = MobileBusinessEntryPoint(
    label: 'Workflows',
    description: 'Repeatable routines',
    section: MobileBusinessSection.runCompany,
    route: MobileBusinessRoutes.workflows,
  );
  static const discovery = MobileBusinessEntryPoint(
    label: 'Discovery',
    description: 'Find your next client',
    section: MobileBusinessSection.growBusiness,
    route: MobileBusinessRoutes.discovery,
  );
  static const social = MobileBusinessEntryPoint(
    label: 'Social',
    description: 'Create & publish',
    section: MobileBusinessSection.growBusiness,
    route: MobileBusinessRoutes.social,
  );
  static const website = MobileBusinessEntryPoint(
    label: 'Website',
    description: 'Your place online',
    section: MobileBusinessSection.growBusiness,
    route: MobileBusinessRoutes.website,
  );
  static const money = MobileBusinessEntryPoint(
    label: 'Money',
    description: 'Revenue & costs',
    section: MobileBusinessSection.growBusiness,
    route: MobileBusinessRoutes.money,
  );

  static const runCompany = [team, goals, work, workflows];
  static const growBusiness = [discovery, social, website, money];
  static const all = [...runCompany, ...growBusiness];

  static List<MobileBusinessEntryPoint> availableIn(
    MobileRouteRegistry registry,
  ) => all.where((entry) => registry.contains(entry.route)).toList();
}
