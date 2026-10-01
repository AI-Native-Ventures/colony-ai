import 'package:flutter/material.dart';

import '../../shared/theme/theme.dart';

/// Compact status notice shared by the mobile team screens.
class CompanyTeamNotice extends StatelessWidget {
  /// Creates a team status notice.
  const CompanyTeamNotice({
    required this.title,
    required this.message,
    this.success = false,
    this.error = false,
    super.key,
  });

  final String title;
  final String message;
  final bool success;
  final bool error;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    final accent = error
        ? const Color(0xFFC86465)
        : success
        ? const Color(0xFF5B9374)
        : context.appColors.lilac;

    return Container(
      decoration: BoxDecoration(
        color: tokens.paper,
        borderRadius: BorderRadius.circular(13),
        border: Border.all(color: tokens.line),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(13),
        child: IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              SizedBox(width: 3, child: ColoredBox(color: accent)),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 15, 17, 15),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: context.mobileTypography.goalCardTitle.copyWith(
                          color: tokens.ink,
                          fontSize: 13.5,
                          height: 1.25,
                        ),
                      ),
                      const SizedBox(height: 9),
                      Text(
                        message,
                        style: context.mobileTypography.body.copyWith(
                          color: tokens.ink,
                          fontSize: 12.5,
                          height: 1.6,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
