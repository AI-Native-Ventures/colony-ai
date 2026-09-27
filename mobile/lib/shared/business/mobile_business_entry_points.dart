import 'package:flutter/foundation.dart';

import '../navigation/mobile_route.dart';

enum MobileBusinessSection { business, teamAndTools, manage }

extension MobileBusinessSectionLabel on MobileBusinessSection {
  String get label => switch (this) {
    MobileBusinessSection.business => 'Business',
    MobileBusinessSection.teamAndTools => 'Team & tools',
    MobileBusinessSection.manage => 'Manage',
  };
}

/// Stable destinations for business modules, without feature-to-feature imports.
abstract final class MobileBusinessRoutes {
  static const social = MobileRoute<NoMobileRouteArguments>('social/calendar');
  static const website = MobileRoute<NoMobileRouteArguments>('website/home');
  static const clients = MobileRoute<NoMobileRouteArguments>('clients/home');
  static const money = MobileRoute<NoMobileRouteArguments>('money/home');
  static const discovery = MobileRoute<NoMobileRouteArguments>(
    'discovery/search',
  );
  static const agents = MobileRoute<NoMobileRouteArguments>('agents/roster');
  static const softwareFactory = MobileRoute<NoMobileRouteArguments>(
    'factory/home',
  );
  static const workArea = MobileRoute<NoMobileRouteArguments>('work/files');
  static const blocks = MobileRoute<NoMobileRouteArguments>('blocks/catalog');
  static const credits = MobileRoute<NoMobileRouteArguments>('credits/balance');
  static const settings = MobileRoute<NoMobileRouteArguments>('settings/home');
}

@immutable
class MobileBusinessEntryPoint {
  const MobileBusinessEntryPoint({
    required this.label,
    required this.section,
    required this.route,
    this.description,
  });

  final String label;
  final String? description;
  final MobileBusinessSection section;
  final MobileRoute<NoMobileRouteArguments> route;
}

/// Navigation copy and route keys from the frozen mobile Business screen.
abstract final class MobileBusinessEntryPoints {
  static const social = MobileBusinessEntryPoint(
    label: 'Social',
    description: 'Content, approvals and accounts',
    section: MobileBusinessSection.business,
    route: MobileBusinessRoutes.social,
  );
  static const website = MobileBusinessEntryPoint(
    label: 'Website',
    description: 'Pages, hosting and enquiries',
    section: MobileBusinessSection.business,
    route: MobileBusinessRoutes.website,
  );
  static const clients = MobileBusinessEntryPoint(
    label: 'Clients',
    description: 'Briefs, retainers and relationships',
    section: MobileBusinessSection.business,
    route: MobileBusinessRoutes.clients,
  );
  static const money = MobileBusinessEntryPoint(
    label: 'Money',
    description: 'Revenue, costs and profitability',
    section: MobileBusinessSection.business,
    route: MobileBusinessRoutes.money,
  );
  static const discovery = MobileBusinessEntryPoint(
    label: 'Discovery',
    description: 'Find and qualify opportunities',
    section: MobileBusinessSection.business,
    route: MobileBusinessRoutes.discovery,
  );
  static const agents = MobileBusinessEntryPoint(
    label: 'Agents',
    section: MobileBusinessSection.teamAndTools,
    route: MobileBusinessRoutes.agents,
  );
  static const softwareFactory = MobileBusinessEntryPoint(
    label: 'Software Factory',
    description: 'Projects and agent work areas',
    section: MobileBusinessSection.teamAndTools,
    route: MobileBusinessRoutes.softwareFactory,
  );
  static const workArea = MobileBusinessEntryPoint(
    label: 'Work area',
    section: MobileBusinessSection.teamAndTools,
    route: MobileBusinessRoutes.workArea,
  );
  static const blocks = MobileBusinessEntryPoint(
    label: 'Blocks',
    description: 'Reusable business workflows',
    section: MobileBusinessSection.teamAndTools,
    route: MobileBusinessRoutes.blocks,
  );
  static const credits = MobileBusinessEntryPoint(
    label: 'Credits',
    section: MobileBusinessSection.manage,
    route: MobileBusinessRoutes.credits,
  );
  static const settings = MobileBusinessEntryPoint(
    label: 'Settings',
    description: 'Account, business and this phone',
    section: MobileBusinessSection.manage,
    route: MobileBusinessRoutes.settings,
  );

  static const business = [social, website, clients, money, discovery];
  static const teamAndTools = [agents, softwareFactory, workArea, blocks];
  static const manage = [credits, settings];
  static const all = [...business, ...teamAndTools, ...manage];
}
