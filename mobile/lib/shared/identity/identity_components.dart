import 'package:flutter/material.dart';

import '../theme/theme.dart';
import '../widgets/avatar_image.dart';

/// Distinguishes a human identity from an AI agent identity.
enum IdentityKind { person, agent }

/// Selects the person tint used by a shared identity avatar.
enum IdentityAvatarTone { peach, sage }

/// A small visual marker that labels an agent identity.
class IdentityAgentBadge extends StatelessWidget {
  /// Creates the shared AI identity badge.
  const IdentityAgentBadge({super.key});

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Semantics(
      label: 'AI agent',
      child: ExcludeSemantics(
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: tokens.actionSoft,
            borderRadius: BorderRadius.circular(Radii.button),
          ),
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: Grid.half,
              vertical: Grid.quarter,
            ),
            child: Text(
              'AI',
              style: context.mobileTypography.identityStatus.copyWith(
                color: tokens.onActionSoft,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// A shared avatar treatment that distinguishes people from agents.
class IdentityAvatar extends StatelessWidget {
  /// Creates an identity avatar using shared person or agent colors.
  const IdentityAvatar({
    required this.initials,
    required this.kind,
    this.tone = IdentityAvatarTone.peach,
    this.imageUrl,
    this.size = 39,
    this.isOnline = false,
    this.roundedSquare = false,
    this.semanticLabel,
    this.excludeSemantics = false,
    super.key,
  });

  /// Initials shown when no profile image is available.
  final String initials;

  /// Identity category that controls avatar shape and color.
  final IdentityKind kind;

  /// Person tint used when [kind] is [IdentityKind.person].
  final IdentityAvatarTone tone;

  /// Optional profile image URL.
  final String? imageUrl;

  /// Avatar diameter.
  final double size;

  /// Whether to show the shared online indicator.
  final bool isOnline;

  /// Draws a person identity with the compact rounded-square treatment.
  final bool roundedSquare;

  /// Optional accessible image label.
  final String? semanticLabel;

  /// Whether to hide this avatar from semantics.
  final bool excludeSemantics;

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final tokens = context.mobileTokens;
    final isAgent = kind == IdentityKind.agent;
    final backgroundGradient = isAgent
        ? colors.agentAvatarGradient
        : switch (tone) {
            IdentityAvatarTone.peach => colors.personAvatarGradient,
            IdentityAvatarTone.sage => colors.sageAvatarGradient,
          };
    final foreground = isAgent
        ? colors.identityAgentForeground
        : switch (tone) {
            IdentityAvatarTone.peach => colors.identityPersonForeground,
            IdentityAvatarTone.sage => colors.identitySageForeground,
          };
    final useRoundedSquare = isAgent || roundedSquare;
    final borderRadius = BorderRadius.circular(size * 0.32);
    final fallback = DecoratedBox(
      decoration: BoxDecoration(
        gradient: backgroundGradient,
        shape: useRoundedSquare ? BoxShape.rectangle : BoxShape.circle,
        borderRadius: useRoundedSquare ? borderRadius : null,
      ),
      child: Center(
        child: Text(
          initials.trim().toUpperCase(),
          maxLines: 1,
          overflow: TextOverflow.clip,
          style: context.mobileTypography.identityInitials.copyWith(
            color: foreground,
          ),
        ),
      ),
    );

    final avatar = Stack(
      clipBehavior: Clip.none,
      children: [
        AvatarImage(
          imageUrl: imageUrl,
          radius: size / 2,
          backgroundColor: colors.lilac,
          fallback: fallback,
          borderRadius: roundedSquare ? borderRadius : null,
          isAgent: isAgent,
        ),
        if (isOnline)
          Positioned(
            right: 0,
            bottom: 0,
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: colors.identityPresence,
                shape: BoxShape.circle,
                border: Border.all(color: tokens.paper, width: 2),
              ),
              child: SizedBox.square(dimension: size * 0.22),
            ),
          ),
      ],
    );

    if (excludeSemantics || semanticLabel == null) {
      return ExcludeSemantics(child: avatar);
    }
    return Semantics(
      image: true,
      label: semanticLabel,
      child: ExcludeSemantics(child: avatar),
    );
  }
}

/// A compact team row for people and agents with one accessible action owner.
class IdentityRow extends StatelessWidget {
  /// Creates a compact person or agent row.
  const IdentityRow({
    required this.name,
    required this.details,
    required this.initials,
    required this.kind,
    this.status,
    this.tone = IdentityAvatarTone.peach,
    this.imageUrl,
    this.isOnline = false,
    this.onTap,
    super.key,
  });

  /// Person or agent display name.
  final String name;

  /// Role or concise identity details.
  final String details;

  /// Initials shown when no profile image is available.
  final String initials;

  /// Identity category that controls avatar shape and color.
  final IdentityKind kind;

  /// Optional status shown at the row's trailing edge.
  final String? status;

  /// Person tint used when [kind] is [IdentityKind.person].
  final IdentityAvatarTone tone;

  /// Optional profile image URL.
  final String? imageUrl;

  /// Whether to show the shared online indicator.
  final bool isOnline;

  /// Optional action invoked when the row is activated.
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    final colors = context.appColors;
    final kindLabel = kind == IdentityKind.agent ? 'AI agent' : 'Person';
    final semanticsLabel = [
      name,
      details,
      kindLabel,
      ?status,
    ].where((part) => part.trim().isNotEmpty).join(', ');
    final content = Padding(
      padding: const EdgeInsets.symmetric(vertical: 14),
      child: Row(
        children: [
          IdentityAvatar(
            initials: initials,
            kind: kind,
            tone: tone,
            imageUrl: imageUrl,
            isOnline: isOnline,
            excludeSemantics: true,
          ),
          const SizedBox(width: 11),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: context.mobileTypography.identityName.copyWith(
                    color: tokens.ink,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  details,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: context.mobileTypography.identityDetails.copyWith(
                    color: tokens.muted,
                  ),
                ),
              ],
            ),
          ),
          if (status != null && status!.isNotEmpty) ...[
            const SizedBox(width: 8),
            if (isOnline)
              Padding(
                padding: const EdgeInsets.only(right: 4),
                child: Icon(
                  Icons.circle,
                  size: 5,
                  color: colors.identityPresence,
                ),
              ),
            Text(
              status!,
              style: context.mobileTypography.identityStatus.copyWith(
                color: isOnline ? colors.identityPresence : tokens.muted,
              ),
            ),
          ],
          if (onTap != null) ...[
            const SizedBox(width: 8),
            Icon(Icons.chevron_right, color: tokens.muted),
          ],
        ],
      ),
    );
    final row = DecoratedBox(
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: tokens.line)),
      ),
      child: onTap == null ? content : InkWell(onTap: onTap, child: content),
    );

    if (onTap == null) {
      return Semantics(
        container: true,
        label: semanticsLabel,
        child: ExcludeSemantics(child: row),
      );
    }
    return Semantics(
      container: true,
      button: true,
      label: semanticsLabel,
      onTap: onTap,
      child: ExcludeSemantics(child: row),
    );
  }
}
