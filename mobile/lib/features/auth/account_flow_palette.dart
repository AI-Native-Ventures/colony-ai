import 'package:flutter/material.dart';

/// Colors used by the frozen v6 mobile account surfaces.
abstract final class AccountFlowPalette {
  static Color paper(Brightness brightness) =>
      Color(brightness == Brightness.dark ? 0xff1f1925 : 0xfff6f4f9);

  static Color ink(Brightness brightness) =>
      Color(brightness == Brightness.dark ? 0xfff3edf7 : 0xff302837);

  static Color muted(Brightness brightness) =>
      Color(brightness == Brightness.dark ? 0xffbdb2c6 : 0xff817987);

  static Color line(Brightness brightness) =>
      Color(brightness == Brightness.dark ? 0xff43364d : 0xffe8e4ec);

  static Color soft(Brightness brightness) =>
      Color(brightness == Brightness.dark ? 0xff2a2233 : 0xffefecf3);

  static Color field(Brightness brightness) =>
      Color(brightness == Brightness.dark ? 0xff292032 : 0xfffffdfd);

  static Color accent(Brightness brightness) =>
      Color(brightness == Brightness.dark ? 0xffc4a8db : 0xff624679);

  static Color onAccent(Brightness brightness) =>
      Color(brightness == Brightness.dark ? 0xff251a2d : 0xffffffff);

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
