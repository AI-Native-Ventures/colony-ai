import 'package:flutter/material.dart';

/// Colors used by the frozen r17 mobile account surfaces.
abstract final class AccountFlowPalette {
  static Color paper(Brightness brightness) =>
      Color(brightness == Brightness.dark ? 0xff25222c : 0xfffffefd);

  static Color ink(Brightness brightness) =>
      Color(brightness == Brightness.dark ? 0xffeee8f0 : 0xff292632);

  static Color muted(Brightness brightness) =>
      Color(brightness == Brightness.dark ? 0xffaaa1b1 : 0xff8b8590);

  static Color line(Brightness brightness) =>
      Color(brightness == Brightness.dark ? 0xff3a3342 : 0xffeeebee);

  static Color soft(Brightness brightness) =>
      Color(brightness == Brightness.dark ? 0xff312b38 : 0xfff6f4f6);

  static Color blue(Brightness brightness) =>
      Color(brightness == Brightness.dark ? 0xffa1bce9 : 0xff345c99);

  static const action = Color(0xff45669f);

  static Color error(Brightness brightness) =>
      Color(brightness == Brightness.dark ? 0xffe5b6c5 : 0xff9b586b);

  static Color errorContainer(Brightness brightness) =>
      Color(brightness == Brightness.dark ? 0xff492f3b : 0xfff9eaf0);

  static Color onErrorContainer(Brightness brightness) =>
      Color(brightness == Brightness.dark ? 0xffe5b6c5 : 0xff9b586b);

  static Color successContainer(Brightness brightness) =>
      Color(brightness == Brightness.dark ? 0xff34404a : 0xffeaf2e9);

  static Color onSuccessContainer(Brightness brightness) =>
      Color(brightness == Brightness.dark ? 0xffbdd8c1 : 0xff60816a);
}
