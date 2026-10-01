part of '../app.dart';

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
            reviewItems: reviewItems,
            movingItems: movingItems,
            teamUpdate: teamUpdate,
            overviewMetrics: overviewMetrics,
            onOpenUpdates: (_) => routeContext.onOpenTeamUpdates?.call(),
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
            onOpenConversations: (_) => routeContext.onOpenChat?.call(),
          );
        },
      );
    })
    .register(MobileRoutes.activity, (context, routeContext) {
      return ActivityHomePage(
        tabReselection: routeContext.tabReselection,
        onComposeUpdate: (composeContext) async {
          final container = ProviderScope.containerOf(
            composeContext,
            listen: false,
          );
          final published = await MobileNavigation.openUpdateCompose(
            composeContext,
          );
          if (published == true) {
            container.invalidate(globalNotesProvider);
          }
        },
        onOpenConversations: routeContext.onOpenChat,
        onOpenItem: (item) => Navigator.of(context).push(
          MaterialPageRoute<void>(
            builder: (_) => ActivityPage(initialItemId: item.id),
          ),
        ),
      );
    })
    .register(
      MobileBusinessRoutes.team,
      (context, _) => Consumer(
        builder: (context, ref, _) => TeamPage(
          onBackToCompany: () => Navigator.of(context).maybePop(),
          onInvite: () => Navigator.of(context).push<void>(
            MaterialPageRoute<void>(
              builder: (_) => const CommunityInvitePage(),
            ),
          ),
          onStartConversation: (detailContext, pubkey) async {
            final channel = await ref
                .read(channelActionsProvider)
                .openDm(pubkeys: [pubkey]);
            if (!detailContext.mounted) return;
            await Navigator.of(detailContext).push<void>(
              MaterialPageRoute<void>(
                builder: (_) => ChannelDetailPage(
                  channel: channel,
                  routeRegistry: _mobileRouteRegistry,
                ),
              ),
            );
          },
        ),
      ),
    )
    .register(MobileBusinessRoutes.goals, (context, _) => const GoalsPage())
    .register(MobileBusinessRoutes.discovery, (context, _) {
      return Consumer(
        builder: (context, ref, _) {
          final channelsAsync = ref.watch(channelsProvider);
          final communityId = ref.watch(activeCommunityProvider).value?.id;
          final candidatesAsync = channelsAsync.whenData(
            (channels) => [
              for (final channel in channels)
                MobileBusinessChannelCandidate(
                  id: channel.id,
                  name: channel.name,
                  visibility: channel.visibility,
                  channelType: channel.channelType,
                  isMember: channel.isMember,
                  archived: channel.isArchived,
                ),
            ],
          );
          return DiscoveryWorkspacePage(
            channelDirectory: candidatesAsync,
            communityId: communityId,
            onRetryChannelDirectory: () => ref.invalidate(channelsProvider),
          );
        },
      );
    })
    .register(MobileBusinessRoutes.money, (context, _) {
      return Consumer(
        builder: (context, ref, _) {
          final channelsAsync = ref.watch(channelsProvider);
          final candidatesAsync = channelsAsync.whenData(
            (channels) => [
              for (final channel in channels)
                MobileBusinessChannelCandidate(
                  id: channel.id,
                  name: channel.name,
                  visibility: channel.visibility,
                  channelType: channel.channelType,
                  isMember: channel.isMember,
                  archived: channel.isArchived,
                ),
            ],
          );
          return MoneyWorkspacePage(
            channelDirectory: candidatesAsync,
            onRetryChannelDirectory: () => ref.invalidate(channelsProvider),
          );
        },
      );
    })
    .register(MobileBusinessRoutes.goalDetail, (context, goalId) {
      return Consumer(
        builder: (context, ref, _) {
          final goalAsync = ref.watch(goalHeadProvider(goalId));
          final goalHeads =
              ref.watch(goalHeadsProvider).asData?.value ?? const [];
          final currentGoal = goalAsync.asData?.value;
          final parentGoalId = currentGoal?.head.goal?.parentGoalId;
          final parentGoal = parentGoalId == null
              ? null
              : goalHeads
                    .where((record) => record.head.goalId == parentGoalId)
                    .firstOrNull;
          final channels =
              ref.watch(channelsProvider).asData?.value ?? const [];
          final linkedChannelIds = <String>{
            ...?currentGoal?.head.goal?.linkedChannelIds,
            ...?parentGoal?.head.goal?.linkedChannelIds,
          };
          final linkedChannels = channels
              .where(
                (channel) =>
                    !channel.isForum && linkedChannelIds.contains(channel.id),
              )
              .toList();
          VoidCallback? onShareInChat;
          VoidCallback? onOpenDiscussion;
          if (linkedChannels.length == 1) {
            final channel = linkedChannels.single;
            onOpenDiscussion = () {
              Navigator.of(context).push<void>(
                MaterialPageRoute<void>(
                  builder: (_) => ChannelDetailPage(
                    channel: channel,
                    routeRegistry: _mobileRouteRegistry,
                    openQuickActions: () =>
                        ChannelQuickActionsLauncher.openFromHome(ref),
                  ),
                ),
              );
            };
            onShareInChat = () {
              ref
                  .read(composeDraftsProvider.notifier)
                  .save(
                    key: composeDraftKey(channel.id),
                    channelId: channel.id,
                    text: buildGoalLink(goalId),
                  );
              onOpenDiscussion!();
            };
          }
          return GoalDetailPage(
            goalId: goalId,
            onShareInChat: onShareInChat,
            onOpenDiscussion: onOpenDiscussion,
            onOpenGoalActions: () => unawaited(
              Navigator.of(context).push<void>(
                MaterialPageRoute<void>(
                  builder: (_) => GoalActionsPage(goalId: goalId),
                ),
              ),
            ),
          );
        },
      );
    })
    .register(MobileBusinessRoutes.workflows, (context, _) {
      return const WorkflowPickerPage();
    })
    .register(MobileBusinessRoutes.workflowDetail, workflowDetailRoute)
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
    .register(
      MobileRoutes.creditsBalance,
      (context, _) => Consumer(
        builder: (context, ref, _) => CreditsBalancePage(
          communityName: ref.watch(activeCommunityProvider).value?.name,
        ),
      ),
    )
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
        builder: (context, ref, _) => _personalSettingsHomePage(
          ref,
          onOpenBusiness: () => Navigator.of(context).maybePop(),
          onOpenAgents: () => Navigator.of(context).maybePop(),
        ),
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
    })
    .register(
      ChannelDeliverableRoutes.review,
      (context, request) => DeliverableApprovalPage(request: request),
    );
