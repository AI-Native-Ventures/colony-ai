import 'package:flutter/material.dart';

import 'app_colors.dart';
import 'mobile_design_tokens.dart';
import 'mobile_typography_tokens.dart';

extension AppThemeExtension on BuildContext {
  ThemeData get theme => Theme.of(this);
  ColorScheme get colors => theme.colorScheme;
  TextTheme get textTheme => theme.textTheme;

  AppColors get appColors {
    final ext = theme.extension<AppColors>();
    assert(ext != null, 'AppColors not found in ThemeData.extensions');
    return ext!;
  }

  MobileDesignTokens get mobileTokens {
    final ext = theme.extension<MobileDesignTokens>();
    assert(ext != null, 'MobileDesignTokens not found in ThemeData.extensions');
    return ext!;
  }

  MobileTypographyTokens get mobileTypography {
    final ext = theme.extension<MobileTypographyTokens>();
    assert(
      ext != null,
      'MobileTypographyTokens not found in ThemeData.extensions',
    );
    return ext!;
  }
}
