import 'package:flutter/material.dart';

/// Accessible, compact status callout for email-code actions.
class AccountCodeStatusCallout extends StatelessWidget {
  const AccountCodeStatusCallout({
    required this.title,
    required this.detail,
    this.isSuccess = false,
    super.key,
  });

  final String title;
  final String detail;
  final bool isSuccess;

  @override
  Widget build(BuildContext context) {
    final brightness = Theme.of(context).brightness;
    final background = switch ((brightness, isSuccess)) {
      (Brightness.light, false) => const Color(0xfffbefeb),
      (Brightness.dark, false) => const Color(0xff442f33),
      (Brightness.light, true) => const Color(0xffedf4ed),
      (Brightness.dark, true) => const Color(0xff2c4235),
    };
    final foreground = switch ((brightness, isSuccess)) {
      (Brightness.light, false) => const Color(0xff975649),
      (Brightness.dark, false) => const Color(0xffe6b2a5),
      (Brightness.light, true) => const Color(0xff507456),
      (Brightness.dark, true) => const Color(0xffc0d6c2),
    };

    return Semantics(
      container: true,
      liveRegion: true,
      label: '$title $detail',
      child: ExcludeSemantics(
        child: Container(
          width: double.infinity,
          margin: const EdgeInsets.symmetric(vertical: 16),
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: background,
            borderRadius: BorderRadius.circular(10),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: TextStyle(
                  color: foreground,
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  height: 1.5,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                detail,
                style: TextStyle(color: foreground, fontSize: 12, height: 1.5),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
