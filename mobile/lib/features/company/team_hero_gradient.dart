import 'package:flutter/material.dart';

const _teamHeroLight = LinearGradient(
  begin: Alignment.topLeft,
  end: Alignment.bottomRight,
  colors: [Color(0xFFECE5FF), Color(0xFFF3E8EC), Color(0xFFFFE9D7)],
  stops: [0, 0.7, 1],
);

const _teamHeroDark = LinearGradient(
  begin: Alignment.topLeft,
  end: Alignment.bottomRight,
  colors: [Color(0xFF41334F), Color(0xFF503A48), Color(0xFF59493E)],
  stops: [0, 0.7, 1],
);

const _teamTerminatedHeroLight = LinearGradient(
  begin: Alignment.topLeft,
  end: Alignment.bottomRight,
  colors: [Color(0xFFF5DCE7), Color(0xFFF3E7F9)],
);

Gradient teamHeroGradientFor(Brightness brightness, {bool terminated = false}) {
  if (brightness == Brightness.dark) return _teamHeroDark;
  return terminated ? _teamTerminatedHeroLight : _teamHeroLight;
}
