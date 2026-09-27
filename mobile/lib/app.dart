import 'dart:async';

import 'package:app_badge_plus/app_badge_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:intl/intl.dart';

import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:uuid/uuid.dart';

import 'features/age_gate/age_restriction_page.dart';
import 'features/age_gate/age_signal_provider.dart';
import 'features/activity/activity_page.dart';
import 'features/activity/activity_home_page.dart';
import 'features/activity/activity_provider.dart';
import 'features/activity/feed_item.dart';
import 'features/activity/inbox_local_state_provider.dart';
import 'features/activity/inbox_read_state.dart';
import 'features/auth/account_claim_prompt.dart';
import 'features/auth/account_claim_status_provider.dart';
import 'features/auth/auth_entry_page.dart';
import 'features/auth/request_password_reset_page.dart';
import 'features/channels/channel.dart';
import 'features/channels/channel_management_provider.dart';
import 'features/channels/channels_page.dart';
import 'features/channels/channels_provider.dart';
import 'features/channels/unread_badge/unread_badge_provider.dart';
import 'features/home/home_page.dart';
import 'features/home/company_hub_page.dart';
import 'features/today/today_models.dart';
import 'features/today/today_page.dart';
import 'features/invites/invite_join_provider.dart';
import 'features/pairing/pairing_page.dart';
import 'features/pairing/pairing_provider.dart';
import 'features/pulse/team_update_compose_page.dart';
import 'features/pulse/team_update_note_page.dart';
import 'features/pulse/pulse_actions.dart';
import 'features/pulse/pulse_provider.dart';
import 'features/pulse/team_updates_page.dart';
import 'features/search/search_page.dart';
import 'features/channels/agent_activity/observer_subscription.dart';
import 'features/channels/channel_detail_page.dart';
import 'features/channels/deep_link_dispatcher.dart';
import 'features/channels/compose_bar.dart';
import 'features/channels/message_content.dart';
import 'features/channels/channel_forum_route.dart';
import 'features/forum/forum_new_post_page.dart';
import 'features/forum/forum_posts_view.dart';
import 'features/forum/forum_presentation.dart';
import 'features/channels/voice_note_recording.dart';
import 'features/profile/user_profile_sheet.dart';
import 'features/profile/profile_provider.dart';
import 'features/profile/user_status_cache_provider.dart';
import 'features/profile/profile_avatar_page.dart';
import 'features/profile/profile_image_page.dart';
import 'features/profile/profile_avatar_crop_route_page.dart';
import 'features/profile/profile_avatar_emoji_page.dart';
import 'features/profile/profile_avatar_capture_page.dart';
import 'features/profile/profile_avatar_review_page.dart';
import 'features/profile/profile_avatar_state_page.dart';
import 'features/profile/profile_status_emoji_page.dart';
import 'features/profile/profile_status_page.dart';
import 'features/profile/profile_status_saved_page.dart';
import 'features/profile/user_status_provider.dart';
import 'features/settings/appearance_display_preference.dart';
import 'features/settings/appearance_settings_pages.dart';
import 'features/settings/personal_settings_home_page.dart';
import 'features/settings/profile_settings_page.dart';
import 'features/settings/settings_devices_page.dart';
import 'features/settings/settings_device_page.dart';
import 'features/settings/settings_feedback_page.dart';
import 'features/settings/settings_feedback_failed_page.dart';
import 'features/settings/settings_feedback_sent_page.dart';
import 'features/settings/settings_export_page.dart';
import 'features/settings/settings_export_failed_page.dart';
import 'features/settings/settings_notifications_page.dart';
import 'features/settings/settings_privacy_page.dart';
import 'features/settings/settings_clear_cache_page.dart';
import 'features/settings/settings_save_failed_page.dart';
import 'shared/auth/auth.dart';
import 'shared/deeplink/pending_deep_link_provider.dart';
import 'shared/emoji/emoji_burst.dart';
import 'shared/navigation/mobile_route.dart';
import 'shared/navigation/mobile_navigation.dart';
import 'shared/navigation/mobile_routes.dart';
import 'shared/push/push_subscription_provider.dart';
import 'shared/push/push_relay_capability_provider.dart';
import 'shared/relay/relay.dart';
import 'shared/profile/user_cache_provider.dart';
import 'shared/utils/string_utils.dart';
import 'shared/read_state/read_state_provider.dart';
import 'shared/theme/theme.dart';
import 'shared/shell/mobile_shell.dart';
import 'shared/widgets/buzz_loading_indicator.dart';

const _starterChannelNamespace = '3ce33bea-8f09-5f1b-9c85-8a7d2659e6b0';

const _starterChannels = [
  (slug: 'general', description: 'General conversation and community updates.'),
  (
    slug: 'welcome-everyone',
    description: 'Say hi, ask a question, or share what brought you here.',
  ),
];

/// App composition is the only layer that knows concrete feature pages.
final MobileRouteRegistry _mobileRouteRegistry = MobileRouteRegistry.empty()
    .register(MobileRoutes.chats, (context, routeContext) {
      return ChannelsPage(
        settingsPageBuilder: routeContext.settingsPageBuilder,
        tabReselection: routeContext.tabReselection,
        onSettingsTransitionProgress: routeContext.onSettingsTransitionProgress,
        routeRegistry: _mobileRouteRegistry,
      );
    })
    .register(MobileRoutes.today, (context, routeContext) {
      return Consumer(
        builder: (context, ref, _) {
          final community = ref.watch(activeCommunityProvider).value;
          final profile = ref.watch(profileProvider).asData?.value;
          final activityAsync = ref.watch(activityProvider);
          final needsAction =
              activityAsync.asData?.value.needsAction ?? const <FeedItem>[];
          if (needsAction.isNotEmpty) {
            ref
                .read(userCacheProvider.notifier)
                .preload(needsAction.map((item) => item.pubkey).toList());
          }
          final reviewItems = activityAsync.whenData(
            (feed) => [
              for (final item in feed.needsAction) _todayReviewItem(ref, item),
            ],
          );
          final movingItems = activityAsync.whenData(
            (feed) => [
              for (final item in feed.agentActivity)
                if ({43002, 43003, 43004}.contains(item.kind))
                  _todayProgressItem(ref, item),
            ],
          );
          // The overview accepts only metrics supplied by their live owner.
          // The Asks lane can add its open-ask count here when its provider is
          // available; approval records are not a proxy for company asks.
          final overviewMetrics = activityAsync.when<List<TodayOverviewMetric>>(
            data: (feed) => [
              TodayOverviewMetric(
                value: '${feed.needsAction.length}',
                label: 'needs your eye',
                onTap: () => unawaited(
                  MobileNavigation.openActivity(context, routeContext),
                ),
              ),
            ],
            loading: () => const [],
            error: (_, _) => const [],
          );
          final notesAsync = ref.watch(globalNotesProvider);
          final latestNote = notesAsync.asData?.value
              .where((note) => note.replyParentId == null)
              .firstOrNull;
          final noteAuthor = latestNote == null
              ? null
              : ref.watch(
                  userCacheProvider.select((cache) => cache[latestNote.pubkey]),
                );
          if (latestNote != null && noteAuthor == null) {
            ref.read(userCacheProvider.notifier).get(latestNote.pubkey);
          }
          final teamUpdate = notesAsync.whenData((notes) {
            final note = notes
                .where((candidate) => candidate.replyParentId == null)
                .firstOrNull;
            if (note == null) return null;
            final firstParagraph = note.content
                .trim()
                .split(RegExp(r'\n\s*\n'))
                .firstOrNull
                ?.replaceAll('\n', ' ')
                .trim();
            final title = firstParagraph?.isNotEmpty == true
                ? firstParagraph!
                : 'Team update';
            final author =
                _firstName(noteAuthor?.displayName) ?? shortPubkey(note.pubkey);
            final time = DateFormat('HH:mm').format(
              DateTime.fromMillisecondsSinceEpoch(note.createdAt * 1000),
            );
            return TodayTeamUpdate(
              id: note.id,
              title: title,
              subtitle: '$author shared an update · $time',
              initials: noteAuthor?.initials ?? _pubkeyInitial(note.pubkey),
            );
          });

          return TodayPage(
            communityName: community?.name,
            profileName: profile?.displayName,
            profileInitials: profile?.initials,
            profileAvatarUrl: profile?.avatarUrl,
            reviewItems: reviewItems,
            movingItems: movingItems,
            teamUpdate: teamUpdate,
            overviewMetrics: overviewMetrics,
            onOpenUpdates: (updatesContext) =>
                unawaited(MobileNavigation.openUpdates(updatesContext)),
            onOpenReview: (itemId) => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => ActivityPage(initialItemId: itemId),
              ),
            ),
            onOpenProgress: (itemId) => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => ActivityPage(initialItemId: itemId),
              ),
            ),
            onOpenActivity: (activityContext) => unawaited(
              MobileNavigation.openActivity(activityContext, routeContext),
            ),
            onOpenUpdate: (noteId) =>
                MobileNavigation.openUpdateNote(context, noteId),
            onRetryActivity: () =>
                ref.read(activityProvider.notifier).refresh(),
          );
        },
      );
    })
    .register(MobileRoutes.activity, (context, routeContext) {
      return ActivityHomePage(
        tabReselection: routeContext.tabReselection,
        updatesPageBuilder: (_, published) =>
            TeamUpdatesPage(initiallyPublished: published),
        onOpenItem: (item) => Navigator.of(context).push(
          MaterialPageRoute<void>(
            builder: (_) => ActivityPage(initialItemId: item.id),
          ),
        ),
      );
    })
    .register(MobileRoutes.business, (context, routeContext) {
      return Consumer(
        builder: (context, ref, _) {
          final community = ref.watch(activeCommunityProvider).value;
          final profile = ref.watch(profileProvider).asData?.value;
          return CompanyHubPage(
            routeRegistry: _mobileRouteRegistry,
            settingsPageBuilder: routeContext.settingsPageBuilder,
            companyName: community?.name,
            identityInitials: profile?.initials,
            identityLabel: profile?.label,
            identityAvatarUrl: profile?.avatarUrl,
            onOpenQuickActions: () =>
                ChannelQuickActionsLauncher.openFromHome(ref),
          );
        },
      );
    })
    .register(MobileRoutes.updates, (context, _) => const TeamUpdatesPage())
    .register(
      MobileRoutes.updateNote,
      (context, noteId) => buildTeamUpdateNoteRoute(noteId),
    )
    .register(
      MobileRoutes.updateCompose,
      (context, _) => _teamUpdateComposer(TeamUpdateComposeMode.compose),
    )
    .register(
      MobileRoutes.updateDraft,
      (context, _) => _teamUpdateComposer(TeamUpdateComposeMode.draft),
    )
    .register(
      MobileRoutes.updateFailed,
      (context, _) => _teamUpdateComposer(TeamUpdateComposeMode.failed),
    )
    .register(
      MobileRoutes.updatePublished,
      (context, _) => const TeamUpdatesPage(initiallyPublished: true),
    )
    .register(MobileRoutes.search, (context, _) => const SearchPage())
    .register(
      MobileRoutes.profileStatus,
      (context, _) => const ProfileStatusPage(),
    )
    .register(
      MobileRoutes.profileStatusEmoji,
      (context, selectedEmoji) =>
          ProfileStatusEmojiPage(selectedEmoji: selectedEmoji),
    )
    .register(
      MobileRoutes.profileStatusSaved,
      (context, _) => const ProfileStatusSavedPage(),
    )
    .register(
      MobileRoutes.settingsHome,
      (context, _) => Consumer(
        builder: (context, ref, _) => _personalSettingsHomePage(ref),
      ),
    )
    .register(
      MobileRoutes.settingsProfile,
      (context, _) => Consumer(
        builder: (context, ref, _) {
          final profile = ref.watch(profileProvider).asData?.value;
          final account = ref.watch(accountProfileProvider).asData?.value;
          final status = ref.watch(userStatusProvider).asData?.value;
          final profileName = profile?.displayName?.trim() ?? '';
          final displayName = profileName.isEmpty
              ? 'Your profile'
              : profileName;
          return ProfileSettingsPage(
            displayName: displayName,
            avatarUrl: profile?.avatarUrl,
            email: account?.email,
            statusLabel: status == null || status.isEmpty
                ? 'Set a status'
                : '${status.emoji} ${status.text}'.trim(),
            onSaveDisplayName: ref
                .read(profileProvider.notifier)
                .updateDisplayName,
          );
        },
      ),
    )
    .register(
      MobileRoutes.settingsAppearance,
      (context, _) => const AppearanceSettingsPage(),
    )
    .register(
      MobileRoutes.settingsPreferences,
      (context, _) => const PersonalPreferencesPage(),
    )
    .register(
      MobileRoutes.settingsThemes,
      (context, _) => const ThemeCatalogPage(),
    )
    .register(
      MobileRoutes.settingsThemePreview,
      (context, themeName) => ThemePreviewPage(themeName: themeName),
    )
    .register(
      MobileRoutes.settingsThemeApplied,
      (context, themeName) => ThemeAppliedPage(themeName: themeName),
    )
    .register(
      MobileRoutes.settingsDevices,
      (context, _) => SettingsDevicesPage(
        currentDeviceName: _currentDeviceName,
        onOpenCurrentDevice: () => MobileNavigation.push<String, Object?>(
          context,
          MobileRoutes.settingsDevice,
          'current',
        ),
        onLinkAnotherDevice: () => Navigator.of(context).push<void>(
          MaterialPageRoute<void>(builder: (_) => const PairingPage()),
        ),
      ),
    )
    .register(
      MobileRoutes.settingsDevice,
      (context, _) => Consumer(
        builder: (context, ref, _) => SettingsDevicePage(
          deviceName: _currentDeviceName,
          communityName: ref.watch(activeCommunityProvider).asData?.value?.name,
        ),
      ),
    )
    .register(
      MobileRoutes.settingsNotifications,
      (context, _) => const SettingsNotificationsPage(),
    )
    .register(
      MobileRoutes.settingsPrivacy,
      (context, _) => const SettingsPrivacyPage(),
    )
    .register(
      MobileRoutes.settingsClearCache,
      (context, _) => const SettingsClearCachePage(),
    )
    .register(
      MobileRoutes.settingsExport,
      (context, _) => const SettingsExportPage(),
    )
    .register(
      MobileRoutes.settingsExportFailed,
      (context, _) => const SettingsExportFailedPage(),
    )
    .register(
      MobileRoutes.settingsFeedback,
      (context, _) => const SettingsFeedbackPage(),
    )
    .register(
      MobileRoutes.settingsFeedbackSent,
      (context, _) => const SettingsFeedbackSentPage(),
    )
    .register(
      MobileRoutes.settingsFeedbackFailed,
      (context, _) => const SettingsFeedbackFailedPage(),
    )
    .register(
      MobileRoutes.settingsSaveFailed,
      (context, _) => const SettingsSaveFailedPage(),
    )
    .register(
      MobileRoutes.accountForgot,
      (context, _) => RequestPasswordResetPage(
        pairIdentityPageBuilder: (_) => const PairingPage(),
      ),
    )
    .register(
      MobileRoutes.profileAvatar,
      (context, _) => const ProfileAvatarPage(),
    )
    .register(
      MobileRoutes.profileImage,
      (context, _) => const ProfileImagePage(),
    )
    .register(
      MobileRoutes.profileCrop,
      (context, bytes) => ProfileAvatarCropRoutePage(imageBytes: bytes),
    )
    .register(
      MobileRoutes.profileInvalid,
      (context, _) =>
          const ProfileAvatarStatePage(state: ProfileAvatarState.invalid),
    )
    .register(
      MobileRoutes.profileSaving,
      (context, _) =>
          const ProfileAvatarStatePage(state: ProfileAvatarState.saving),
    )
    .register(
      MobileRoutes.profileSaved,
      (context, _) =>
          const ProfileAvatarStatePage(state: ProfileAvatarState.saved),
    )
    .register(
      MobileRoutes.profileFailed,
      (context, _) =>
          const ProfileAvatarStatePage(state: ProfileAvatarState.failed),
    )
    .register(
      MobileRoutes.profileAvatarCapture,
      (context, _) => const ProfileAvatarCapturePage(),
    )
    .register(
      MobileRoutes.profileAvatarCameraDenied,
      (context, _) =>
          const ProfileAvatarStatePage(state: ProfileAvatarState.cameraDenied),
    )
    .register(
      MobileRoutes.profileAvatarEmoji,
      (context, _) => const ProfileAvatarEmojiPage(),
    )
    .register(
      MobileRoutes.profileAvatarReview,
      (context, _) => const ProfileAvatarReviewPage(),
    )
    .register(
      MobileRoutes.profileAvatarSaved,
      (context, _) =>
          const ProfileAvatarStatePage(state: ProfileAvatarState.avatarSaved),
    )
    .register(ChannelForumRoutes.posts, (context, arguments) {
      return ForumPostsView(
        channelId: arguments.channelId,
        channelName: arguments.channelName,
        currentPubkey: arguments.currentPubkey,
        isMember: arguments.isMember,
        isArchived: arguments.isArchived,
        presentation: _forumPresentation(),
      );
    })
    .register(ChannelForumRoutes.newPost, (context, arguments) {
      return ForumNewPostPage(
        channelId: arguments.channelId,
        channelName: arguments.channelName,
        memberCount: arguments.memberCount,
        presentation: _forumPresentation(),
      );
    });

final _currentDeviceName = switch (defaultTargetPlatform) {
  TargetPlatform.iOS => 'This iPhone',
  TargetPlatform.android => 'This phone',
  _ => 'This device',
};

ForumPresentationFactories _forumPresentation() => ForumPresentationFactories(
  composeBarBuilder:
      ({
        required channelId,
        required channelName,
        required hintText,
        required onSend,
        draftKeyOverride,
        postEditorMode = false,
        allowEmptySend = false,
        enabled = true,
        submitController,
        onBodyChanged,
        onAttachmentCountChanged,
        onSubmissionChanged,
        onFailure,
      }) => ComposeBar(
        channelId: channelId,
        channelName: channelName,
        hintText: hintText,
        onSend: onSend,
        draftKeyOverride: draftKeyOverride,
        postEditorMode: postEditorMode,
        allowEmptySend: allowEmptySend,
        enabled: enabled,
        submitController: submitController,
        onBodyChanged: onBodyChanged,
        onAttachmentCountChanged: onAttachmentCountChanged,
        onSubmissionChanged: onSubmissionChanged,
        onFailure: onFailure,
      ),
  messageContentBuilder: (context, content) => MessageContent(
    content: content.content,
    mentionNames: content.mentionNames,
    agentMentionPubkeys: content.agentMentionPubkeys,
    tags: content.tags,
    baseStyle: content.baseStyle,
    maxLines: content.maxLines,
    onMentionTap: content.onMentionTap,
  ),
  openProfile: showUserProfileSheet,
  currentUserName: (ref) => ref.watch(profileProvider).value?.displayName,
);

/// Builds the production page for a team update note route.
Widget buildTeamUpdateNoteRoute(String noteId) =>
    TeamUpdateNotePage(noteId: noteId, onReviewCampaign: null);

TodayReviewItem _todayReviewItem(WidgetRef ref, FeedItem item) {
  final author = ref.watch(
    userCacheProvider.select((cache) => cache[item.pubkey.toLowerCase()]),
  );
  if (author == null) ref.read(userCacheProvider.notifier).get(item.pubkey);
  return TodayReviewItem(
    id: item.id,
    requesterName: _firstName(author?.displayName) ?? shortPubkey(item.pubkey),
    title: item.displayContent,
    subtitle: item.channelName.isEmpty
        ? '${_firstName(author?.displayName) ?? shortPubkey(item.pubkey)} requested your review'
        : '${item.channelName} · ${_firstName(author?.displayName) ?? shortPubkey(item.pubkey)} requested your review',
    initials: author?.initials ?? _pubkeyInitial(item.pubkey),
    requesterIsAgent: author?.isAgent ?? false,
  );
}

TodayProgressItem _todayProgressItem(WidgetRef ref, FeedItem item) {
  final author = ref.watch(
    userCacheProvider.select((cache) => cache[item.pubkey.toLowerCase()]),
  );
  if (author == null) ref.read(userCacheProvider.notifier).get(item.pubkey);
  final authorName =
      _firstName(author?.displayName) ?? shortPubkey(item.pubkey);
  return TodayProgressItem(
    id: item.id,
    title: item.kind == 43004 ? 'Research completed' : item.headline,
    subtitle: '$authorName · ${item.displayContent}',
    initials: author?.initials ?? _pubkeyInitial(item.pubkey),
    isAgent: author?.isAgent ?? item.category == 'agent_activity',
  );
}

String _pubkeyInitial(String pubkey) =>
    pubkey.isNotEmpty ? pubkey[0].toUpperCase() : '?';

String? _firstName(String? name) {
  final normalized = name?.trim();
  if (normalized == null || normalized.isEmpty) return null;
  return normalized.split(RegExp(r'\s+')).first;
}

Widget _teamUpdateComposer(TeamUpdateComposeMode mode) => Consumer(
  builder: (context, ref, _) => TeamUpdateComposePage(
    mode: mode,
    onPublish: (content) => publishNote(ref, content: content),
  ),
);

final _inviteRelayConnectedProvider = FutureProvider.family<void, String>((
  ref,
  expectedRelayUrl,
) async {
  final currentConfig = ref.read(relayConfigProvider);
  if (currentConfig.baseUrl != expectedRelayUrl) {
    throw StateError('Active community changed before invite recovery');
  }
  if (ref.read(relaySessionProvider).status == SessionStatus.connected) return;

  final connected = Completer<void>();
  ref.listen(relaySessionProvider, (_, next) {
    if (connected.isCompleted) return;
    if (ref.read(relayConfigProvider).baseUrl != expectedRelayUrl) {
      connected.completeError(
        StateError('Active community changed during invite recovery'),
      );
    } else if (next.status == SessionStatus.connected) {
      connected.complete();
    }
  });
  await connected.future;
});

/// App-level bridge from invite joining to the channels feature.
class MobileInviteJoinRecovery implements InviteJoinRecovery {
  final Future<List<Channel>> Function() _loadChannels;
  final Future<Channel> Function({
    required String channelId,
    required String name,
    required String channelType,
    required String visibility,
    String? description,
    int? ttlSeconds,
  })
  _createChannel;
  final Future<void> Function(String channelId) _joinChannel;
  final String _relayHttpOrigin;
  final bool Function() _isScopeCurrent;

  /// Creates recovery from channel-loading, creation, and join operations.
  MobileInviteJoinRecovery({
    required Future<List<Channel>> Function() loadChannels,
    required Future<Channel> Function({
      required String channelId,
      required String name,
      required String channelType,
      required String visibility,
      String? description,
      int? ttlSeconds,
    })
    createChannel,
    required Future<void> Function(String channelId) joinChannel,
    required String relayHttpOrigin,
    bool Function()? isScopeCurrent,
  }) : _loadChannels = loadChannels,
       _createChannel = createChannel,
       _joinChannel = joinChannel,
       _relayHttpOrigin = relayHttpOrigin,
       _isScopeCurrent = isScopeCurrent ?? _alwaysCurrent;

  /// Ensures memberships in the same public starter channels as desktop.
  ///
  /// All starter work is fenced to the community and identity that started it.
  /// A partial setup remains recoverable, so a failed operation deliberately
  /// propagates to the invite flow instead of being reported as success.
  @override
  Future<String?> ensureStarterChannels() async {
    _ensureScopeCurrent();
    var channels = await _loadChannels();
    _ensureScopeCurrent();
    String? welcomeEveryoneId;

    for (final starter in _starterChannels) {
      _ensureScopeCurrent();
      var channel = _findStarterChannel(channels, starter.slug);
      if (channel == null) {
        final channelId = desktopStarterChannelId(
          relayHttpOrigin: _relayHttpOrigin,
          slug: starter.slug,
        );
        try {
          channel = await _createChannel(
            channelId: channelId,
            name: starter.slug,
            channelType: 'stream',
            visibility: 'open',
            description: starter.description,
          );
          _ensureScopeCurrent();
        } catch (error) {
          if (!_isDuplicateChannelError(error)) rethrow;
          _ensureScopeCurrent();
          channels = await _loadChannels();
          _ensureScopeCurrent();
          channel =
              _findStarterChannel(channels, starter.slug) ??
              channels
                  .where((candidate) => candidate.id == channelId)
                  .firstOrNull;
          if (channel == null) rethrow;
        }
      }

      _ensureScopeCurrent();
      if (!channel.isMember) {
        await _joinChannel(channel.id);
        _ensureScopeCurrent();
      }
      if (starter.slug == 'welcome-everyone') {
        welcomeEveryoneId = channel.id;
      }
    }

    return welcomeEveryoneId;
  }

  static bool _alwaysCurrent() => true;

  void _ensureScopeCurrent() {
    if (!_isScopeCurrent()) {
      throw StateError('Active community changed during invite recovery');
    }
  }
}

Channel? _findStarterChannel(List<Channel> channels, String name) {
  final normalizedName = name.trim().toLowerCase();
  return channels
      .where(
        (channel) =>
            channel.name.trim().toLowerCase() == normalizedName &&
            channel.isStream &&
            channel.visibility == 'open' &&
            !channel.isArchived,
      )
      .firstOrNull;
}

bool _isDuplicateChannelError(Object error) =>
    error.toString().contains('duplicate: channel already exists');

/// Returns desktop's deterministic per-relay UUID for a public starter.
@visibleForTesting
String desktopStarterChannelId({
  required String relayHttpOrigin,
  required String slug,
}) {
  final scope = relayHttpOrigin.trim().replaceFirst(RegExp(r'/+$'), '');
  return const Uuid().v5(
    _starterChannelNamespace,
    'starter-channel:v1:$scope:$slug',
  );
}

/// Builds one fresh, identity-scoped invite recovery against the app container.
InviteJoinRecovery buildMobileInviteJoinRecovery(
  Ref ref,
  InviteJoinRecoveryScope scope,
) {
  final expectedConfig = ref.read(relayConfigProvider);
  if (expectedConfig.baseUrl != scope.relayHttpOrigin ||
      expectedConfig.nsec != scope.nsec) {
    throw StateError('Active community changed before invite recovery');
  }
  final channelActions = ref.read(channelActionsProvider);

  bool isScopeCurrent() {
    final currentConfig = ref.read(relayConfigProvider);
    return currentConfig.baseUrl == scope.relayHttpOrigin &&
        currentConfig.nsec == scope.nsec;
  }

  void ensureScopeCurrent() {
    if (!isScopeCurrent()) {
      throw StateError('Active community changed during invite recovery');
    }
  }

  return MobileInviteJoinRecovery(
    loadChannels: () async {
      ensureScopeCurrent();
      await ref.read(activeCommunityProvider.future);
      ensureScopeCurrent();
      await ref
          .read(_inviteRelayConnectedProvider(scope.relayHttpOrigin).future)
          .timeout(const Duration(seconds: 15));
      ensureScopeCurrent();
      await ref.read(channelsProvider.notifier).refresh(fetchDirectory: true);
      ensureScopeCurrent();
      final channels = await ref.read(channelsProvider.future);
      ensureScopeCurrent();
      return channels;
    },
    createChannel:
        ({
          required channelId,
          required name,
          required channelType,
          required visibility,
          description,
          ttlSeconds,
        }) => channelActions.createChannel(
          channelId: channelId,
          name: name,
          channelType: channelType,
          visibility: visibility,
          description: description,
          ttlSeconds: ttlSeconds,
        ),
    joinChannel: channelActions.joinChannel,
    relayHttpOrigin: scope.relayHttpOrigin,
    isScopeCurrent: isScopeCurrent,
  );
}

/// App-shell projection that joins Activity state for the Home navigation.
///
/// This belongs at the composition root because it deliberately aggregates
/// Activity feature providers for a sibling navigation surface.
final _unreadInboxItemCountProvider = Provider<int>((ref) {
  final readState = ref.watch(readStateProvider);
  if (!readState.isReady) return 0;

  final localState = ref.watch(inboxLocalStateProvider);
  final items = ref.watch(inboxItemsProvider);
  return items
      .where(
        (item) => !isInboxItemDone(
          item,
          markerOf: readState.effectiveTimestamp,
          localUnreadOverrides: localState.unreadIds,
          localDoneSet: localState.doneIds,
        ),
      )
      .length;
});

final _mobileRootNavigatorKey = GlobalKey<NavigatorState>();

class App extends HookConsumerWidget {
  const App({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ageSignalState = ref.watch(ageSignalProvider);
    ref.listen(ageSignalProvider, (_, next) {
      if (next == AgeSignalState.restricted) {
        ref.read(pairingProvider.notifier).reset();
      }
    });
    final communityTheme = ageSignalState != AgeSignalState.restricted
        ? ref.watch(communityThemeProvider)
        : defaultCommunityTheme;
    final displayPreference = ref.watch(appearanceDisplayPreferenceProvider);
    final baseVisualDensity = displayPreference.density.visualDensity;
    final effectiveVisualDensity = VisualDensity(
      horizontal: baseVisualDensity.horizontal,
      vertical:
          baseVisualDensity.vertical +
          (displayPreference.largerTapTargets ? 1 : 0),
    );
    final themeMode = communityTheme.mode;
    final accentIndex = effectiveAccentIndex(
      communityTheme.theme,
      communityTheme.accent,
    );
    final schemeName = communityTheme.theme;
    final authState = ref.watch(authProvider);

    useEffect(() {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        unawaited(ref.read(ageSignalProvider.notifier).request());
      });
      return null;
    }, const []);

    final resolved = resolveSchemes(schemeName, themeMode);
    final lightScheme = applyAccent(resolved.light, accentIndex);
    final darkScheme = applyAccent(resolved.dark, accentIndex);
    // Light/Dark modes pin the brightness; System leaves it null so Flutter
    // follows the OS across the selected theme and its pair.
    final effectiveMode = resolved.forcedMode ?? themeMode;

    // Derive the gradient from the themes that produced each color scheme.
    // This keeps fallbacks and pinned brightness changes aligned with the
    // rendered palette rather than the raw persisted selection.
    final buzzLightGradient = buzzTopSectionGradient(
      resolved.lightTheme?.name ?? '',
      lightScheme.brightness,
    );
    final buzzDarkGradient = buzzTopSectionGradient(
      resolved.darkTheme?.name ?? '',
      darkScheme.brightness,
    );

    // Eagerly initialize websocket session and lifecycle observer when
    // authenticated. These providers connect and manage the websocket.
    var hasUnreadInbox = false;
    if (ageSignalState != AgeSignalState.restricted &&
        authState.value?.status == AuthStatus.authenticated) {
      ref.watch(relaySessionProvider);
      ref.watch(observerRelayProvider);
      ref.watch(appLifecycleProvider);
      ref.watch(userStatusCacheProvider);
      if (ref.watch(activeCommunityProvider).value?.pushNotificationsEnabled ==
              true &&
          ref.watch(currentRelayPushDescriptorProvider).value != null) {
        ref.watch(pushSubscriptionSyncProvider);
      }
      hasUnreadInbox = ref.watch(_unreadInboxItemCountProvider) > 0;
    }

    // Start listening for buzz:// links immediately (even pre-auth) so a
    // cold-start link survives until the authenticated UI can dispatch it.
    ref.watch(pendingDeepLinkProvider);

    void applyBadge(UnreadBadgeState state) {
      if (state.highPriorityCount > 0) {
        AppBadgePlus.updateBadge(state.highPriorityCount);
      } else if (state.generalUnreadCount > 0) {
        AppBadgePlus.updateBadge(1);
      } else {
        AppBadgePlus.updateBadge(0);
      }
    }

    useEffect(() {
      if (ageSignalState != AgeSignalState.restricted) {
        applyBadge(ref.read(unreadBadgeProvider));
      } else {
        AppBadgePlus.updateBadge(0);
      }
      return null;
    }, [ageSignalState]);
    if (ageSignalState != AgeSignalState.restricted) {
      ref.listen<UnreadBadgeState>(unreadBadgeProvider, (_, next) {
        applyBadge(next);
      });
    }

    return MaterialApp(
      navigatorKey: _mobileRootNavigatorKey,
      navigatorObservers: [voiceNoteRouteObserver],
      title: 'Buzz',
      theme: AppTheme.light(
        colorScheme: lightScheme,
        topSectionGradient: buzzLightGradient,
        mobileTokens: isBuzzTheme(schemeName)
            ? MobileDesignTokens.light
            : MobileDesignTokens.fromColorScheme(lightScheme),
      ).copyWith(visualDensity: effectiveVisualDensity),
      darkTheme: AppTheme.dark(
        colorScheme: darkScheme,
        topSectionGradient: buzzDarkGradient,
        mobileTokens: isBuzzTheme(schemeName)
            ? MobileDesignTokens.dark
            : MobileDesignTokens.fromColorScheme(darkScheme),
      ).copyWith(visualDensity: effectiveVisualDensity),
      themeMode: effectiveMode,
      // Above the navigator, so an age restriction cannot be bypassed by a
      // route that was pushed while the store signal request was in flight.
      builder: (context, child) {
        final appContent = switch (ageSignalState) {
          AgeSignalState.restricted => const AgeRestrictionPage(),
          _ => AppMarkdownTheme(
            child: MobileHuddleShell(
              navigatorKey: _mobileRootNavigatorKey,
              child: EmojiBurstOverlay(child: child ?? const SizedBox.shrink()),
            ),
          ),
        };
        final mediaQuery = MediaQuery.of(context);
        return MediaQuery(
          data: mediaQuery.copyWith(
            disableAnimations:
                mediaQuery.disableAnimations || displayPreference.reduceMotion,
            textScaler: applyAppearanceTextSize(
              mediaQuery.textScaler,
              displayPreference.textSize,
            ),
          ),
          child: appContent,
        );
      },
      home: authState.when(
        loading: () => const _SplashScreen(),
        error: (_, _) => AuthEntryPage(
          advancedIdentityPageBuilder: (_) => const PairingPage(),
        ),
        data: (state) => switch (state.status) {
          AuthStatus.authenticated => DeepLinkDispatcher(
            child: HomePage(
              routeRegistry: _mobileRouteRegistry,
              settingsPageBuilder: _buildSettingsPage,
              hasUnreadInbox: hasUnreadInbox,
              accountClaimPrompt: const AccountClaimPrompt(),
              overlayBuilder: (context, shellContext) =>
                  ChannelQuickActionsLauncher(
                    visible:
                        shellContext.destination ==
                            MobileShellDestination.chat ||
                        shellContext.destination ==
                            MobileShellDestination.company,
                    navigationBarHeight: shellContext.navigationBarHeight,
                    navigationBarBottomGap:
                        shellContext.navigationBarHeight + Grid.half,
                    navigationBarWidth: shellContext.navigationBarWidth,
                    systemBottomInset: shellContext.bottomInset,
                    rightInset: Grid.xs,
                    routeRegistry: _mobileRouteRegistry,
                  ),
            ),
          ),
          _ => DeepLinkDispatcher(
            dispatchMessageLinks: false,
            child: AuthEntryPage(
              advancedIdentityPageBuilder: (_) => const PairingPage(),
            ),
          ),
        },
      ),
    );
  }
}

Widget _buildSettingsPage(BuildContext context) => const _SettingsPageContent();

class _SettingsPageContent extends ConsumerWidget {
  const _SettingsPageContent();

  @override
  Widget build(BuildContext context, WidgetRef ref) =>
      _personalSettingsHomePage(ref);
}

Widget _personalSettingsHomePage(WidgetRef ref) {
  final profile = ref.watch(profileProvider).asData?.value;
  final account = ref.watch(accountProfileProvider).asData?.value;
  final profileName = profile?.displayName?.trim() ?? '';
  return PersonalSettingsHomePage(
    displayName: profileName.isEmpty ? 'Your profile' : profileName,
    email: account?.email,
    avatarUrl: profile?.avatarUrl,
  );
}

class _SplashScreen extends StatelessWidget {
  const _SplashScreen();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(
        child: BuzzLoadingIndicator(size: 56, semanticLabel: 'Starting Buzz'),
      ),
    );
  }
}
