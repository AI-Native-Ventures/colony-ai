import 'package:flutter/material.dart';

import '../../shared/theme/theme.dart';
import '../../shared/widgets/avatar_image.dart';

/// Shows the current avatar inside the image-flow preview surface.
class ProfileAvatarPreviewStage extends StatelessWidget {
  const ProfileAvatarPreviewStage({
    required this.initials,
    this.imageUrl,
    this.avatar,
    super.key,
  });

  final String initials;
  final String? imageUrl;
  final Widget? avatar;

  @override
  Widget build(BuildContext context) => Container(
    height: 230,
    width: double.infinity,
    decoration: BoxDecoration(
      color: context.mobileTokens.soft,
      borderRadius: BorderRadius.circular(18),
    ),
    child:
        avatar ??
        Center(
          child: AvatarImage(
            imageUrl: imageUrl,
            radius: 65,
            backgroundColor: const Color(0xFFE8E2EC),
            fallback: Text(
              initials,
              style: const TextStyle(
                color: Color(0xFF76657D),
                fontSize: 38,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ),
  );
}
