import 'dart:typed_data';

import 'mobile_route.dart';
import 'mobile_route_context.dart';

/// Canonical route keys for shared mobile entry points.
abstract final class MobileRoutes {
  static const today = MobileRoute<MobileShellRouteContext>('today');
  static const chats = MobileRoute<MobileShellRouteContext>('channels');
  static const activity = MobileRoute<MobileShellRouteContext>('activity');
  static const business = MobileRoute<MobileShellRouteContext>('business');
  static const updates = MobileRoute<NoMobileRouteArguments>('updates/feed');
  static const updateNote = MobileRoute<String>('updates/note');
  static const updateCompose = MobileRoute<NoMobileRouteArguments>(
    'updates/compose',
  );
  static const updateDraft = MobileRoute<NoMobileRouteArguments>(
    'updates/draft',
  );
  static const updateFailed = MobileRoute<NoMobileRouteArguments>(
    'updates/failed',
  );
  static const updatePublished = MobileRoute<NoMobileRouteArguments>(
    'updates/published',
  );
  static const search = MobileRoute<NoMobileRouteArguments>(
    'navigation/search',
  );
  static const accountAge = MobileRoute<NoMobileRouteArguments>('account/age');
  static const profileStatus = MobileRoute<NoMobileRouteArguments>(
    'profile/status',
  );
  static const profileStatusEmoji = MobileRoute<String>('profile/status-emoji');
  static const profileStatusSaved = MobileRoute<NoMobileRouteArguments>(
    'profile/status-saved',
  );
  static const settingsProfile = MobileRoute<NoMobileRouteArguments>(
    'settings/profile',
  );
  static const settingsHome = MobileRoute<NoMobileRouteArguments>(
    'settings/home',
  );
  static const settingsAppearance = MobileRoute<NoMobileRouteArguments>(
    'settings/appearance',
  );
  static const settingsPreferences = MobileRoute<NoMobileRouteArguments>(
    'settings/preferences',
  );
  static const settingsThemes = MobileRoute<NoMobileRouteArguments>(
    'settings/themes',
  );
  static const settingsThemePreview = MobileRoute<String>(
    'settings/theme-preview',
  );
  static const settingsThemeApplied = MobileRoute<String>(
    'settings/theme-applied',
  );
  static const settingsDevices = MobileRoute<NoMobileRouteArguments>(
    'settings/devices',
  );
  static const settingsDevice = MobileRoute<String>('settings/device');
  static const settingsNotifications = MobileRoute<NoMobileRouteArguments>(
    'settings/notifications',
  );
  static const settingsPrivacy = MobileRoute<NoMobileRouteArguments>(
    'settings/privacy',
  );
  static const settingsClearCache = MobileRoute<NoMobileRouteArguments>(
    'settings/clear-cache',
  );
  static const settingsExport = MobileRoute<NoMobileRouteArguments>(
    'settings/export',
  );
  static const settingsExportFailed = MobileRoute<NoMobileRouteArguments>(
    'settings/export-failed',
  );
  static const settingsFeedback = MobileRoute<NoMobileRouteArguments>(
    'settings/feedback',
  );
  static const settingsFeedbackSent = MobileRoute<NoMobileRouteArguments>(
    'settings/feedback-sent',
  );
  static const settingsFeedbackFailed = MobileRoute<NoMobileRouteArguments>(
    'settings/feedback-failed',
  );
  static const settingsSaveFailed = MobileRoute<NoMobileRouteArguments>(
    'settings/save-failed',
  );
  static const accountForgot = MobileRoute<NoMobileRouteArguments>(
    'account/forgot',
  );
  static const profileAvatar = MobileRoute<NoMobileRouteArguments>(
    'profile/avatar',
  );
  static const profileImage = MobileRoute<NoMobileRouteArguments>(
    'profile/image',
  );
  static const profileCrop = MobileRoute<Uint8List>('profile/crop');
  static const profileInvalid = MobileRoute<NoMobileRouteArguments>(
    'profile/invalid',
  );
  static const profileSaving = MobileRoute<NoMobileRouteArguments>(
    'profile/saving',
  );
  static const profileSaved = MobileRoute<NoMobileRouteArguments>(
    'profile/saved',
  );
  static const profileFailed = MobileRoute<NoMobileRouteArguments>(
    'profile/failed',
  );
  static const profileAvatarCapture = MobileRoute<NoMobileRouteArguments>(
    'profile/avatar-capture',
  );
  static const profileAvatarCameraDenied = MobileRoute<NoMobileRouteArguments>(
    'profile/avatar-camera-denied',
  );
  static const profileAvatarEmoji = MobileRoute<NoMobileRouteArguments>(
    'profile/avatar-emoji',
  );
  static const profileAvatarReview = MobileRoute<NoMobileRouteArguments>(
    'profile/avatar-review',
  );
  static const profileAvatarSaved = MobileRoute<NoMobileRouteArguments>(
    'profile/avatar-saved',
  );
}
