import 'package:flutter/material.dart';

abstract final class Batch2MobileVisualTokens {
  static const heroForegroundLight = Color(0xFF362044);
  static const heroForegroundDark = Color(0xFFF7ECFF);

  static const neutralNoticeAccent = Color(0xFFA893C8);
  static const successNoticeAccent = Color(0xFF5B9374);
  static const errorNoticeAccent = Color(0xFFC86465);

  static const _lightHeroGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [Color(0xFFECE5FF), Color(0xFFF3E8EC), Color(0xFFFFE9D7)],
    stops: [0, 0.7, 1],
  );

  static const _darkHeroGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [Color(0xFF41334F), Color(0xFF503A48), Color(0xFF59493E)],
    stops: [0, 0.7, 1],
  );

  static LinearGradient heroGradient(Brightness brightness) =>
      brightness == Brightness.dark ? _darkHeroGradient : _lightHeroGradient;

  static Color heroForeground(Brightness brightness) =>
      brightness == Brightness.dark ? heroForegroundDark : heroForegroundLight;
}
