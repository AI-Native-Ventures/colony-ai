import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../shared/theme/theme.dart';
import 'message_presentation.dart';

class DeliverablePreviewCard extends StatelessWidget {
  final DeliverablePreviewData data;

  const DeliverablePreviewCard({super.key, required this.data});

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    final details = [
      data.title,
      data.detail,
      data.reviewStatus,
      data.versionLabel,
    ].where((value) => value.trim().isNotEmpty).join(', ');
    final hasReviewMetadata =
        data.reviewStatus.trim().isNotEmpty ||
        data.versionLabel.trim().isNotEmpty;

    return Semantics(
      container: true,
      label: details,
      child: ExcludeSemantics(
        child: Container(
          margin: const EdgeInsets.only(top: Grid.xxs),
          decoration: BoxDecoration(
            color: tokens.paper,
            border: Border.all(color: tokens.line),
            borderRadius: BorderRadius.circular(Radii.companyCard),
          ),
          clipBehavior: Clip.antiAlias,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _DeliverableArtwork(data: data),
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  Grid.xs,
                  Grid.xs,
                  Grid.xs,
                  Grid.xxs,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      data.title,
                      style: context.mobileTypography.identityName.copyWith(
                        color: tokens.ink,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    if (data.detail.trim().isNotEmpty) ...[
                      const SizedBox(height: Grid.half),
                      Text(
                        data.detail,
                        style: context.mobileTypography.metadata.copyWith(
                          color: tokens.muted,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              if (hasReviewMetadata)
                Padding(
                  padding: const EdgeInsets.fromLTRB(
                    Grid.xs,
                    0,
                    Grid.xs,
                    Grid.xs,
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      if (data.reviewStatus.trim().isNotEmpty)
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: Grid.half,
                            vertical: Grid.quarter,
                          ),
                          decoration: BoxDecoration(
                            color: tokens.warning,
                            borderRadius: BorderRadius.circular(Radii.button),
                          ),
                          child: Text(
                            data.reviewStatus,
                            style: context.mobileTypography.identityStatus
                                .copyWith(
                                  color:
                                      context.appColors.identitySageForeground,
                                  fontWeight: FontWeight.w600,
                                ),
                          ),
                        ),
                      if (data.versionLabel.trim().isNotEmpty)
                        Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(
                              data.versionLabel,
                              style: context.mobileTypography.identityStatus
                                  .copyWith(color: context.appColors.plum),
                            ),
                            const SizedBox(width: Grid.quarter),
                            Icon(
                              LucideIcons.arrowUpRight,
                              size: Grid.xs,
                              color: context.appColors.plum,
                            ),
                          ],
                        ),
                    ],
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _DeliverableArtwork extends StatelessWidget {
  final DeliverablePreviewData data;

  const _DeliverableArtwork({required this.data});

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    final colors = context.appColors;
    return SizedBox(
      height: MobileLayoutTokens.minimumRowHeight + Grid.lg,
      child: ClipRect(
        child: Stack(
          children: [
            Positioned.fill(child: ColoredBox(color: tokens.warning)),
            Positioned(
              right: -Grid.xs,
              bottom: -Grid.xl,
              child: Transform.rotate(
                angle: -0.314,
                child: Container(
                  width: Grid.xxl + Grid.xxxl,
                  height: Grid.xxl + Grid.xxxl,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.vertical(
                      top: Radius.elliptical(Grid.xxl, Grid.xxl),
                    ),
                    gradient: LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [colors.apricot, colors.identitySageForeground],
                    ),
                  ),
                ),
              ),
            ),
            Positioned(
              right: Grid.xs,
              bottom: -Grid.xxs,
              child: Transform.rotate(
                angle: 0.349,
                child: Container(
                  width: Grid.xxl,
                  height: Grid.xxl + Grid.lg,
                  decoration: BoxDecoration(
                    color: tokens.success,
                    borderRadius: BorderRadius.vertical(
                      top: Radius.elliptical(Grid.xxl, Grid.xxl),
                    ),
                  ),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(
                Grid.xs,
                Grid.xxs,
                Grid.xs,
                Grid.half,
              ),
              child: Stack(
                children: [
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        data.brand,
                        style: context.mobileTypography.identityStatus.copyWith(
                          color: colors.identitySageForeground,
                          letterSpacing: 1.1,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: Grid.xxs),
                      Text(
                        data.coverTitle,
                        maxLines: 2,
                        style: context.mobileTypography.companyHubTitle
                            .copyWith(color: colors.identitySageForeground),
                      ),
                    ],
                  ),
                  if (data.coverFooter.trim().isNotEmpty)
                    Positioned(
                      left: 0,
                      bottom: 0,
                      child: Text(
                        data.coverFooter,
                        style: context.mobileTypography.identityStatus.copyWith(
                          color: colors.identitySageForeground,
                        ),
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
}

class QuotedMessagePreview extends StatelessWidget {
  final String label;
  final String content;

  const QuotedMessagePreview({
    super.key,
    required this.label,
    required this.content,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(top: Grid.half),
      padding: const EdgeInsets.fromLTRB(
        Grid.xs,
        Grid.half,
        Grid.xs,
        Grid.half,
      ),
      decoration: BoxDecoration(
        color: context.mobileTokens.soft,
        border: Border(
          left: BorderSide(color: context.appColors.plum, width: Grid.half),
        ),
        borderRadius: BorderRadius.circular(Radii.button),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: context.mobileTypography.identityStatus.copyWith(
              color: context.mobileTokens.ink,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: Grid.half),
          Text(
            content,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: context.mobileTypography.metadata.copyWith(
              color: context.mobileTokens.muted,
            ),
          ),
        ],
      ),
    );
  }
}
