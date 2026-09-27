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
    return Semantics(
      container: true,
      label:
          '${data.title}, ${data.detail}, ${data.reviewStatus}, ${data.versionLabel}',
      child: ExcludeSemantics(
        child: Container(
          margin: const EdgeInsets.only(top: 9),
          decoration: BoxDecoration(
            color: tokens.paper,
            border: Border.all(color: tokens.line),
            borderRadius: BorderRadius.circular(13),
          ),
          clipBehavior: Clip.antiAlias,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _DeliverableArtwork(data: data),
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 12, 12, 16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      data.title,
                      style: const TextStyle(
                        fontFamily: 'Manrope',
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        height: 1.25,
                      ).copyWith(color: tokens.ink),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      data.detail,
                      style: TextStyle(
                        fontFamily: 'Manrope',
                        fontSize: 10,
                        height: 1.3,
                        color: tokens.muted,
                      ),
                    ),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 6,
                        vertical: 4,
                      ),
                      decoration: BoxDecoration(
                        color: const Color(0xFFF4EEE2),
                        borderRadius: BorderRadius.circular(5),
                      ),
                      child: Text(
                        data.reviewStatus,
                        style: const TextStyle(
                          fontFamily: 'Manrope',
                          fontSize: 9,
                          fontWeight: FontWeight.w600,
                          height: 1.2,
                          color: Color(0xFF9C7D44),
                        ),
                      ),
                    ),
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          data.versionLabel,
                          style: TextStyle(
                            fontFamily: 'Manrope',
                            fontSize: 10,
                            fontWeight: FontWeight.w600,
                            height: 1.2,
                            color:
                                Theme.of(context).brightness == Brightness.dark
                                ? const Color(0xFFA1BCE9)
                                : const Color(0xFF45669F),
                          ),
                        ),
                        const SizedBox(width: 3),
                        Icon(
                          LucideIcons.arrowUpRight,
                          size: 10,
                          color: Theme.of(context).brightness == Brightness.dark
                              ? const Color(0xFFA1BCE9)
                              : const Color(0xFF45669F),
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
    return SizedBox(
      height: 172,
      child: ClipRect(
        child: Stack(
          children: [
            const Positioned.fill(child: ColoredBox(color: Color(0xFFE5E1CC))),
            Positioned(
              right: -58,
              bottom: -95,
              child: Transform.rotate(
                angle: -0.314,
                child: Container(
                  width: 180,
                  height: 230,
                  decoration: const BoxDecoration(
                    borderRadius: BorderRadius.vertical(
                      top: Radius.elliptical(100, 100),
                    ),
                    gradient: LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [Color(0xFFB7BD9E), Color(0xFF7C9279)],
                    ),
                  ),
                ),
              ),
            ),
            Positioned(
              right: 20,
              bottom: -60,
              child: Transform.rotate(
                angle: 0.349,
                child: Container(
                  width: 90,
                  height: 145,
                  decoration: const BoxDecoration(
                    color: Color(0xFFD1D4B8),
                    borderRadius: BorderRadius.vertical(
                      top: Radius.elliptical(70, 70),
                    ),
                  ),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 15, 18, 12),
              child: Stack(
                children: [
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        data.brand,
                        style: const TextStyle(
                          fontFamily: 'Manrope',
                          fontSize: 10,
                          letterSpacing: 2,
                          color: Color(0xFF354938),
                        ),
                      ),
                      const SizedBox(height: 19),
                      Text(
                        data.coverTitle,
                        maxLines: 2,
                        style: const TextStyle(
                          fontFamily: 'serif',
                          fontSize: 30,
                          fontWeight: FontWeight.w400,
                          height: 1.05,
                          letterSpacing: -1,
                          color: Color(0xFF354938),
                        ),
                      ),
                    ],
                  ),
                  Positioned(
                    left: 0,
                    bottom: 0,
                    child: Text(
                      data.coverFooter,
                      style: const TextStyle(
                        fontFamily: 'Manrope',
                        fontSize: 8,
                        letterSpacing: 1.3,
                        color: Color(0xFF354938),
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
      margin: const EdgeInsets.only(top: 8, bottom: 0),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: context.mobileTokens.soft,
        borderRadius: const BorderRadius.horizontal(right: Radius.circular(6)),
        border: const Border(
          left: BorderSide(color: Color(0xFFC5D2BD), width: 2),
        ),
      ),
      child: Text.rich(
        TextSpan(
          children: [
            TextSpan(text: '$label\n'),
            TextSpan(text: content),
          ],
        ),
        style: TextStyle(
          fontFamily: 'Manrope',
          fontSize: 11,
          height: 1.4,
          color: context.mobileTokens.muted,
        ),
      ),
    );
  }
}
