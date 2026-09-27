import 'package:hooks_riverpod/hooks_riverpod.dart';

import 'profile_avatar_draft.dart';

/// Holds an unsaved avatar selection while the profile image flow is open.
final profileAvatarDraftProvider =
    NotifierProvider<ProfileAvatarDraftNotifier, ProfileAvatarDraft?>(
      ProfileAvatarDraftNotifier.new,
    );

/// Owns the prepared avatar draft shared by profile avatar routes.
class ProfileAvatarDraftNotifier extends Notifier<ProfileAvatarDraft?> {
  @override
  ProfileAvatarDraft? build() => null;

  /// Replaces the pending avatar selection.
  void setDraft(ProfileAvatarDraft draft) => state = draft;

  /// Clears the pending selection after a successful save or cancellation.
  void clear() => state = null;
}
