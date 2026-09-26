import 'dart:async';
import 'dart:io';
import 'dart:math' show max, min, pi;
import 'dart:ui';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter/services.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:flutter/physics.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../shared/auth/auth.dart';
import '../../shared/community/community_icon_provider.dart';
import '../../shared/navigation/mobile_route.dart';
import '../../shared/relay/relay.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/avatar_image.dart';
import '../../shared/widgets/anchored_popover_menu.dart';
import '../../shared/widgets/bee_refresh_indicator.dart';
import '../../shared/widgets/buzz_loading_indicator.dart';
import '../../shared/widgets/buzz_titled_sheet_layout.dart';
import '../../shared/widgets/frosted_app_bar.dart';
import '../../shared/widgets/frosted_scaffold.dart';
import '../../shared/widgets/modal_presentation.dart';
import '../../shared/widgets/skeleton.dart';
import '../../shared/custom_emoji/custom_emoji.dart';
import '../../shared/custom_emoji/custom_emoji_provider.dart';
import '../../shared/custom_emoji/custom_emoji_render.dart';
import '../profile/profile_provider.dart';
import '../../shared/profile/user_cache_provider.dart';
import '../pairing/pairing_page.dart';
import '../pairing/pairing_provider.dart';
import 'channel.dart';
import 'channel_actions_sheet.dart';
import 'channel_detail_page.dart';
import 'channel_management_provider.dart';
import 'dm_channel_labels.dart';
import 'ephemeral_channel_display.dart';
import 'channel_mutes/channel_mutes_provider.dart';
import 'channel_sections/channel_sections_provider.dart';
import 'channel_sections/channel_sections_storage.dart';
import 'channel_sort/channel_sort_provider.dart';
import 'channel_sort/channel_sort_storage.dart';
import 'channel_stars/channel_stars_provider.dart';
import 'channels_provider.dart';
import '../../shared/read_state/deferred_read_state_update.dart';
import '../../shared/read_state/read_state_format.dart';
import '../../shared/read_state/read_state_provider.dart';
import '../../shared/read_state/read_state_time.dart';
import 'unread_badge/observed_unread_event.dart';

part 'channels_page/body.dart';
part 'channels_page/browse_channels_sheet.dart';
part 'channels_page/sections.dart';
part 'channels_page/channel_tile.dart';
part 'channels_page/sheets.dart';
part 'channels_page/badges.dart';
part 'channels_page/skeleton.dart';
part 'channels_page/community.dart';
part 'channels_page/quick_actions.dart';
part 'channels_page/quick_actions_launcher.dart';

enum _QuickAction { createChannel, newDm, browseChannels }

enum _ChatFilter { all, unread, direct }

const _r17ChatInk = Color(0xFF292632);
const _r17ChatMuted = Color(0xFF8B8590);
const _r17ChatLine = Color(0xFFEEEBEE);
const _r17ChatSoft = Color(0xFFF6F4F6);
const _r17ChatBlue = Color(0xFF345C99);
const _r17ChatDarkPaper = Color(0xFF25222C);
const _r17ChatDarkInk = Color(0xFFEEE8F0);
const _r17ChatDarkMuted = Color(0xFFAAA1B1);
const _r17ChatDarkLine = Color(0xFF3A3342);
const _r17ChatDarkSoft = Color(0xFF312B38);
const _r17ChatDarkBlue = Color(0xFFA1BCE9);

bool _isChatDark(BuildContext context) =>
    Theme.of(context).brightness == Brightness.dark;

Color _chatInk(BuildContext context) =>
    _isChatDark(context) ? _r17ChatDarkInk : _r17ChatInk;

Color _chatMuted(BuildContext context) =>
    _isChatDark(context) ? _r17ChatDarkMuted : _r17ChatMuted;

Color _chatLine(BuildContext context) =>
    _isChatDark(context) ? _r17ChatDarkLine : _r17ChatLine;

Color _chatSoft(BuildContext context) =>
    _isChatDark(context) ? _r17ChatDarkSoft : _r17ChatSoft;

Color _chatBlue(BuildContext context) =>
    _isChatDark(context) ? _r17ChatDarkBlue : _r17ChatBlue;

Color _chatPaper(BuildContext context) =>
    _isChatDark(context) ? _r17ChatDarkPaper : const Color(0xFFFFFEFD);

String _chatInitials(String? displayName, {String fallback = '?'}) {
  final words = (displayName ?? '')
      .trim()
      .split(RegExp(r'\s+'))
      .where((word) => word.isNotEmpty);
  final initials = words.take(2).map((word) => word[0].toUpperCase()).join();
  return initials.isEmpty ? fallback : initials;
}

const double _kChannelSectionInset = Grid.gutter;
const double _kChannelLeadingWidth = 22.0;
const double _kChannelIconSize = 18.0;
const double _kChannelLabelGap = Grid.xxs;
const double _kChannelRowVerticalPadding = Grid.xxs + Grid.quarter;
const double _kSectionSpacingTightening = Grid.half;
const double _kSectionHeaderVerticalPadding =
    _kChannelRowVerticalPadding - _kSectionSpacingTightening;
// Section headers include touch targets for their actions, so their visual
// centre sits lower than a channel row's. This keeps an expanded section's
// final row equally spaced from the following divider.
const double _kExpandedSectionTrailingPadding =
    11.0 - _kSectionSpacingTightening;
const double _kChannelLabelInset =
    _kChannelSectionInset + _kChannelLeadingWidth + _kChannelLabelGap;

/// DM avatars are circles, so they fill their box edge to edge where a channel
/// glyph leaves 4dp of slack inside the same 22dp leading column. Sizing them to
/// the glyph's ink width keeps the icon-to-label distance identical across both
/// sections while the labels stay on [_kChannelLabelInset].
const double _kTopSectionCommunityAvatarSize = 40.0;
const double _kTopSectionBottomPadding = Grid.xxs;

/// The top section's avatars are 40dp circles, which fill their box edge to
/// edge; the channel rows below lead with an 18dp glyph left-aligned in a 22dp
/// box at [_kChannelSectionInset]. Edge-aligning the two leaves the circles
/// looking pushed outward, so the bar is pulled in to sit the avatar's centre
/// near the channel-icon column.
const double _kTopSectionInset = Grid.twelve;
const Duration _kSectionExpandDuration = Duration(milliseconds: 220);
const Duration _kSectionCollapseDuration = Duration(milliseconds: 170);
const Curve _kSectionExpandCurve = Cubic(0.23, 1, 0.32, 1);
const Curve _kSectionCollapseCurve = Curves.easeInCubic;
const double _kSectionCollapsedScaleY = 0.98;

class _UnreadChannelState {
  final Set<String> ids;
  final Map<String, int> counts;

  const _UnreadChannelState({required this.ids, required this.counts});
}

_UnreadChannelState _computeUnreadChannelState({
  required Iterable<Channel> channels,
  required ReadStateState readState,
  required ChannelsNotifier channelsNotifier,
}) {
  if (!readState.isReady) {
    return const _UnreadChannelState(ids: {}, counts: {});
  }

  final latestObservedByChannel = channelsNotifier.latestObservedByChannel;
  final observedEventsByChannel =
      channelsNotifier.observedUnreadEventsByChannel;
  final ids = <String>{};
  final counts = <String, int>{};

  for (final channel in channels) {
    if (readState.locallyForcedChannelIds.contains(channel.id)) {
      ids.add(channel.id);
      counts[channel.id] = 1;
      continue;
    }

    final latestObserved = latestObservedByChannel[channel.id];
    if (latestObserved == null) continue;

    final channelReadAt = readState.effectiveTimestamp(channel.id);
    if (channelReadAt != null && latestObserved <= channelReadAt) continue;

    final observedEvents = observedEventsByChannel[channel.id];
    int? readAtForObservedEvent(ObservedUnreadEvent event) =>
        observedUnreadEventReadAt(
          event,
          channelReadAt,
          (rootId) => readState.effectiveTimestamp(threadContextKey(rootId)),
          (messageId) => readState.effectiveTimestamp(msgContextKey(messageId)),
        );

    final unreadCount = countUnreadObservedEvents(
      observedEvents,
      readAtForObservedEvent,
    );
    if (unreadCount == 0) continue;

    ids.add(channel.id);
    counts[channel.id] = unreadCount;
  }

  return _UnreadChannelState(ids: ids, counts: counts);
}

class ChannelsPage extends HookConsumerWidget {
  const ChannelsPage({
    required this.settingsPageBuilder,
    required this.onSettingsTransitionProgress,
    this.routeRegistry,
    this.tabReselection,
    super.key,
  });

  final WidgetBuilder settingsPageBuilder;
  final MobileRouteRegistry? routeRegistry;

  /// Reports Settings route progress so its foreground and Home's background
  /// render from the same timeline.
  final ValueChanged<double> onSettingsTransitionProgress;

  /// Notifies this page when its already-selected tab is tapped again.
  final ValueListenable<int>? tabReselection;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final channelsAsync = ref.watch(channelsProvider);
    final sessionState = ref.watch(relaySessionProvider);
    final currentPubkey = ref
        .watch(profileProvider)
        .whenData((value) => value?.pubkey)
        .value;
    final headerTitleStyle = context.textTheme.titleSmall?.copyWith(
      fontWeight: FontWeight.w700,
      color: _chatInk(context),
    );
    final headerSubtitleStyle = context.textTheme.bodySmall?.copyWith(
      color: const Color(0xFF8B8590),
      fontSize: 11,
    );
    final textScaler = MediaQuery.textScalerOf(context);
    final communityTitleHeight =
        textScaler.scale(headerTitleStyle?.fontSize ?? 14) *
            (headerTitleStyle?.height ?? 1.2) +
        textScaler.scale(headerSubtitleStyle?.fontSize ?? 11) *
            (headerSubtitleStyle?.height ?? 1.2);
    final topSectionHeight = frostedAppBarHeight(
      context,
      titleStyle: headerTitleStyle,
      titleContentHeight: communityTitleHeight,
      bottomHeight: _kTopSectionBottomPadding,
    );
    final channelsScrollController = useScrollController();
    final reducedMotion = MediaQuery.disableAnimationsOf(context);
    useEffect(() {
      final tabReselection = this.tabReselection;
      if (tabReselection == null) return null;

      void scrollToTop() {
        if (!channelsScrollController.hasClients) return;
        final position = channelsScrollController.position;
        if (position.pixels <= position.minScrollExtent + 0.5) return;
        if (reducedMotion) {
          channelsScrollController.jumpTo(position.minScrollExtent);
          return;
        }
        unawaited(
          channelsScrollController.animateTo(
            position.minScrollExtent,
            duration: const Duration(milliseconds: 260),
            curve: Curves.easeOutCubic,
          ),
        );
      }

      tabReselection.addListener(scrollToTop);
      return () => tabReselection.removeListener(scrollToTop);
    }, [tabReselection, channelsScrollController, reducedMotion]);

    // Cache the last successfully loaded channels so the UI never flashes
    // back to a loading state when the provider rebuilds (e.g. reconnect).
    // Clear the cache on community switch so we show a full loader instead of
    // stale channels from the previous community. unwrapPrevious() ensures the
    // selector sees null during loading (not the previous community's ID).
    final activeCommunityId = ref.watch(
      activeCommunityProvider.select((v) => v.unwrapPrevious().value?.id),
    );
    final cachedChannels = useRef<List<Channel>?>(null);
    final lastCommunityId = useRef<String?>(null);
    if (lastCommunityId.value != activeCommunityId) {
      cachedChannels.value = null;
      lastCommunityId.value = activeCommunityId;
    }
    if (channelsAsync.asData?.value case final data?) {
      cachedChannels.value = data;
    }
    final channels = cachedChannels.value;
    Future<void> openChannel(Channel channel) async {
      if (!context.mounted) return;
      await Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) =>
              ChannelDetailPage(channel: channel, routeRegistry: routeRegistry),
        ),
      );
    }

    // Only surface fetch errors while the relay is stably connected. During a
    // reconnect the session owns recovery, so a cancelled in-flight query must
    // not turn into a manual Retry page.
    final showError = useState(false);
    final hasError = channelsAsync.hasError && channels == null;
    final canSurfaceError =
        hasError &&
        sessionState.status != SessionStatus.connecting &&
        sessionState.status != SessionStatus.reconnecting;
    useEffect(() {
      if (!canSurfaceError) {
        showError.value = false;
        return null;
      }
      final timer = Timer(const Duration(seconds: 2), () {
        showError.value = true;
      });
      return timer.cancel;
    }, [canSurfaceError]);

    // Keep cached content steady through brief socket flaps. A sustained
    // reconnect swaps to element-shaped skeletons that match desktop.
    final showConnectionSkeleton = useState(false);
    final isReconnectingWithContent =
        channels != null &&
        (sessionState.status == SessionStatus.connecting ||
            sessionState.status == SessionStatus.reconnecting);
    useEffect(() {
      if (!isReconnectingWithContent) {
        showConnectionSkeleton.value = false;
        return null;
      }
      final timer = Timer(const Duration(seconds: 2), () {
        showConnectionSkeleton.value = true;
      });
      return timer.cancel;
    }, [isReconnectingWithContent]);

    void openCommunitySwitcher() {
      unawaited(HapticFeedback.selectionClick());
      ref.invalidate(communityIconProvider);
      showBuzzModalBottomSheet<void>(
        context: context,
        showCloseButton: false,
        showDragHandle: false,
        builder: (_) => const _CommunitySwitcherSheet(),
      );
    }

    void openSettings() {
      unawaited(HapticFeedback.lightImpact());
      final route = _SettingsPageRoute(
        builder: settingsPageBuilder,
        onTransitionProgress: onSettingsTransitionProgress,
      );
      Navigator.of(context).push(route);
    }

    return FrostedScaffold(
      backgroundColor: _chatPaper(context),
      appBar: FrostedAppBar(
        horizontalInset: _kTopSectionInset,
        frosted: false,
        showBottomDivider: true,
        leading: const _CommunityIndicator(),
        centerTitle: false,
        titleStyle: headerTitleStyle,
        titleContentHeight: communityTitleHeight,
        title: _CommunityHeaderTitle(style: headerTitleStyle),
        actions: [
          _BusinessSwitchButton(
            key: const ValueKey('switch-business-button'),
            onTap: openCommunitySwitcher,
            onLongPress: openSettings,
          ),
        ],
        bottomHeight: _kTopSectionBottomPadding,
        bottom: const SizedBox.expand(),
      ),
      body: _ChannelsBody(
        channels: channels,
        channelsAsync: channelsAsync,
        showError: showError.value,
        sessionStatus: sessionState.status,
        showConnectionSkeleton: showConnectionSkeleton.value,
        currentPubkey: currentPubkey,
        topSectionHeight: topSectionHeight,
        scrollController: channelsScrollController,
        onRefresh: () => ref.read(channelsProvider.notifier).refresh(),
        onSelectChannel: openChannel,
        routeRegistry: routeRegistry,
      ),
    );
  }
}

/// A custom route deliberately avoids [MaterialPageRoute]'s platform exit
/// transition on Home. Settings has a centered scale-and-fade transition, not
/// a lateral page push.
class _SettingsPageRoute extends PageRouteBuilder<void> {
  _SettingsPageRoute({
    required WidgetBuilder builder,
    required this.onTransitionProgress,
  }) : super(
         pageBuilder: (context, animation, secondaryAnimation) =>
             builder(context),
         transitionsBuilder: _buildSettingsTransition,
         opaque: false,
         allowSnapshotting: false,
         transitionDuration: const Duration(milliseconds: 150),
         reverseTransitionDuration: const Duration(milliseconds: 150),
       );

  final ValueChanged<double> onTransitionProgress;

  Animation<double>? _progressAnimation;
  bool _hasStartedForwardTransition = false;

  @override
  void install() {
    super.install();
    _progressAnimation = animation?..addListener(_reportProgress);
  }

  void _reportProgress() {
    final progressAnimation = _progressAnimation;
    if (progressAnimation == null) return;

    // ProxyAnimation briefly exposes the previous completed value while the
    // route installs its new controller. Ignore that handoff notification and
    // begin reporting only once the route is genuinely moving forward.
    if (!_hasStartedForwardTransition) {
      if (progressAnimation.status != AnimationStatus.forward) return;
      _hasStartedForwardTransition = true;
    }
    onTransitionProgress(progressAnimation.value);
  }

  @override
  void dispose() {
    _progressAnimation?.removeListener(_reportProgress);
    super.dispose();
  }

  static Widget _buildSettingsTransition(
    BuildContext context,
    Animation<double> animation,
    Animation<double> secondaryAnimation,
    Widget child,
  ) {
    if (MediaQuery.disableAnimationsOf(context)) return child;

    final motion = CurvedAnimation(
      parent: animation,
      // Keep the complete page on one timeline. A gentler forward ease keeps
      // the entrance visible without letting scale finish ahead of opacity;
      // the existing reverse curve preserves the exit motion.
      curve: Curves.easeOutQuad,
      reverseCurve: Curves.easeOutCubic,
    );
    return FadeTransition(
      key: const ValueKey('settings-transition-opacity'),
      opacity: motion,
      child: RepaintBoundary(
        key: const ValueKey('settings-transition-layer'),
        child: ScaleTransition(
          key: const ValueKey('settings-transition-scale'),
          scale: Tween<double>(begin: 1.04, end: 1).animate(motion),
          alignment: Alignment.center,
          child: child,
        ),
      ),
    );
  }
}
