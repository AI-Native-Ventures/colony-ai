import 'dart:async';

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../shared/business/mobile_business_entry_points.dart';
import '../../shared/navigation/mobile_navigation.dart';
import '../../shared/navigation/mobile_route.dart';
import '../../shared/identity/identity_components.dart';
import '../../shared/theme/theme.dart';

/// Shows the Company hub and only links to destinations registered by the app.
class CompanyHubPage extends StatelessWidget {
  /// Creates a Company hub using the registered route inventory.
  const CompanyHubPage({
    required this.routeRegistry,
    required this.settingsPageBuilder,
    this.companyName,
    this.identityInitials,
    this.identityLabel,
    this.identityAvatarUrl,
    this.onOpenQuickActions,
    super.key,
  });

  /// Routes that currently have page builders.
  final MobileRouteRegistry routeRegistry;

  /// Opens the app's existing Settings page.
  final WidgetBuilder settingsPageBuilder;

  /// The active workspace name shown below the page title.
  final String? companyName;

  /// Current person's initials for the workspace avatar.
  final String? identityInitials;

  /// Accessible label for the workspace avatar.
  final String? identityLabel;

  /// Optional current person's avatar image URL.
  final String? identityAvatarUrl;

  /// Opens the existing app quick actions.
  final VoidCallback? onOpenQuickActions;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    final available = MobileBusinessEntryPoints.availableIn(routeRegistry);

    return ColoredBox(
      color: tokens.canvas,
      child: SafeArea(
        bottom: false,
        child: Column(
          children: [
            Container(
              height: MobileLayoutTokens.companyHeaderHeight,
              padding: const EdgeInsets.symmetric(horizontal: Grid.gutter),
              decoration: BoxDecoration(
                gradient: context.appColors.companyWashGradient,
                border: Border(bottom: BorderSide(color: tokens.line)),
              ),
              child: Row(
                children: [
                  IdentityAvatar(
                    initials: identityInitials ?? '?',
                    kind: IdentityKind.person,
                    imageUrl: identityAvatarUrl,
                    size: MobileLayoutTokens.companyHeaderAvatarSize,
                    semanticLabel: identityLabel,
                  ),
                  const SizedBox(width: Grid.ten),
                  Expanded(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Your company',
                          style: context.mobileTypography.companyHubTitle
                              .copyWith(color: tokens.ink),
                        ),
                        if (companyName?.trim().isNotEmpty == true) ...[
                          const SizedBox(
                            height: MobileLayoutTokens.companySubtitleGap,
                          ),
                          Text(
                            companyName!.trim(),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: context.mobileTypography.companyHubSubtitle
                                .copyWith(color: tokens.muted),
                          ),
                        ],
                      ],
                    ),
                  ),
                  if (onOpenQuickActions != null)
                    _QuickActionsButton(onTap: onOpenQuickActions!),
                ],
              ),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(
                  Grid.gutter,
                  MobileLayoutTokens.companySectionMargin,
                  Grid.gutter,
                  Grid.gutter,
                ),
                children: [
                  for (final section in MobileBusinessSection.values)
                    _CompanySection(
                      section: section,
                      entries: available
                          .where((entry) => entry.section == section)
                          .toList(),
                      onOpen: (entry) => _openEntry(context, entry),
                    ),
                  _AppearancePreferencesRow(
                    onTap: () => Navigator.of(context).push<void>(
                      MaterialPageRoute<void>(builder: settingsPageBuilder),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _openEntry(BuildContext context, MobileBusinessEntryPoint entry) {
    unawaited(
      MobileNavigation.push<NoMobileRouteArguments, void>(
        context,
        entry.route,
        const NoMobileRouteArguments(),
      ).then<void>((_) {}),
    );
  }
}

class _CompanySection extends StatelessWidget {
  const _CompanySection({
    required this.section,
    required this.entries,
    required this.onOpen,
  });

  final MobileBusinessSection section;
  final List<MobileBusinessEntryPoint> entries;
  final ValueChanged<MobileBusinessEntryPoint> onOpen;

  @override
  Widget build(BuildContext context) {
    if (entries.isEmpty) return const SizedBox.shrink();

    final tokens = context.mobileTokens;
    return Padding(
      padding: const EdgeInsets.only(
        bottom: MobileLayoutTokens.companySectionMargin,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(
              bottom: MobileLayoutTokens.companySectionTitleGap,
            ),
            child: Text(
              section.label.toUpperCase(),
              style: context.mobileTypography.companySection.copyWith(
                color: tokens.muted,
              ),
            ),
          ),
          GridView.count(
            crossAxisCount: 2,
            mainAxisSpacing: MobileLayoutTokens.companyGridGap,
            crossAxisSpacing: MobileLayoutTokens.companyGridGap,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            mainAxisExtent: MobileLayoutTokens.companyCardHeight,
            children: [
              for (final entry in entries)
                _CompanyEntryCard(entry: entry, onTap: () => onOpen(entry)),
            ],
          ),
        ],
      ),
    );
  }
}

class _CompanyEntryCard extends StatelessWidget {
  const _CompanyEntryCard({required this.entry, required this.onTap});

  final MobileBusinessEntryPoint entry;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    final label = '${entry.label}. ${entry.description}';
    return Semantics(
      button: true,
      label: label,
      onTap: onTap,
      child: ExcludeSemantics(
        child: Material(
          color: tokens.paper,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(Radii.companyCard),
            side: BorderSide(color: tokens.line),
          ),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: onTap,
            overlayColor: WidgetStatePropertyAll(
              context.appColors.plum.withValues(alpha: 0.08),
            ),
            child: Padding(
              padding: const EdgeInsets.all(
                MobileLayoutTokens.companyCardPadding,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  DecoratedBox(
                    decoration: BoxDecoration(
                      color: tokens.soft,
                      borderRadius: BorderRadius.circular(Radii.md),
                    ),
                    child: Padding(
                      padding: const EdgeInsets.all(
                        MobileLayoutTokens.companyCardIconPadding,
                      ),
                      child: Icon(
                        _iconFor(entry),
                        size: MobileLayoutTokens.companyCardIconSize,
                        color: tokens.action,
                      ),
                    ),
                  ),
                  const SizedBox(
                    height: MobileLayoutTokens.companyCardContentGap,
                  ),
                  Text(
                    entry.label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: context.mobileTypography.companyEntryTitle.copyWith(
                      color: tokens.ink,
                    ),
                  ),
                  const SizedBox(
                    height: MobileLayoutTokens.companyCardContentGap,
                  ),
                  Text(
                    entry.description,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: context.mobileTypography.companyEntryDescription
                        .copyWith(color: tokens.muted),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  IconData _iconFor(MobileBusinessEntryPoint entry) =>
      switch (entry.route.path) {
        'team' => LucideIcons.users,
        'goals' => LucideIcons.target,
        'work' => LucideIcons.briefcaseBusiness,
        'workflows' => LucideIcons.workflow,
        'business/discovery' => LucideIcons.search,
        'business/social' => LucideIcons.heart,
        'business/website' => LucideIcons.globe,
        'business/money' => LucideIcons.wallet,
        _ => LucideIcons.grid2x2,
      };
}

class _AppearancePreferencesRow extends StatelessWidget {
  const _AppearancePreferencesRow({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Semantics(
      button: true,
      label: 'Appearance and preferences',
      onTap: onTap,
      child: ExcludeSemantics(
        child: Material(
          color: tokens.soft,
          borderRadius: BorderRadius.circular(Radii.companyPinned),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: onTap,
            overlayColor: WidgetStatePropertyAll(
              context.appColors.plum.withValues(alpha: 0.08),
            ),
            child: Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: Grid.fifteen,
                vertical: Grid.twelve,
              ),
              child: Row(
                children: [
                  Icon(LucideIcons.sun, color: tokens.action),
                  const SizedBox(width: Grid.ten),
                  Expanded(
                    child: Text(
                      'Appearance & preferences',
                      style: context.mobileTypography.companyEntryDescription
                          .copyWith(color: tokens.action),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _QuickActionsButton extends StatelessWidget {
  const _QuickActionsButton({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Semantics(
      button: true,
      label: 'Quick actions',
      onTap: onTap,
      child: ExcludeSemantics(
        child: Material(
          color: tokens.paper,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(Radii.button),
            side: BorderSide(color: tokens.line),
          ),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: onTap,
            overlayColor: WidgetStatePropertyAll(
              tokens.action.withValues(alpha: 0.08),
            ),
            child: const SizedBox.square(
              dimension: MobileLayoutTokens.minimumTapTarget,
              child: Icon(LucideIcons.plus, size: 18),
            ),
          ),
        ),
      ),
    );
  }
}
