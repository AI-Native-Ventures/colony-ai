import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useCommunities } from "@/features/communities/useCommunities";
import { relayClient } from "@/shared/api/relayClient";
import { useIdentityQuery } from "@/shared/api/hooks";
import {
  DEFAULT_COMMUNITY_THEME,
  cacheAndApplyCommunityTheme,
  clearCommunityThemeOutbox,
  communityThemeApplyExpectation,
  communityThemePersistenceAction,
  communityThemeScopeFallback,
  hasMigratedCommunityTheme,
  markCommunityThemeMigrated,
  readCommunityThemeOutbox,
  readCommunityThemePreference,
  sameCommunityThemePreference,
  writeCommunityThemeOutbox,
  writeCommunityThemePreference,
  type CommunityThemePreference,
} from "./communityThemePreference";
import {
  CommunityThemeSyncManager,
  communityThemeHydrationRemote,
  isNewerCommunityThemeCoordinate,
  shouldSeedCommunityTheme,
  type RemoteCommunityTheme,
} from "./communityThemeSync";
import { useTheme } from "./ThemeProvider";
import {
  appearanceSnapshotKey,
  customGradientStops,
  readAppearanceSnapshot,
  isValidHexColor,
} from "@/features/settings/lib/appearanceSnapshot";
import { applyConversationMessageSize } from "@/features/settings/lib/conversationMessageSizePreference";
import { setConversationDensity } from "@/shared/lib/conversationDensityPreference";
import { setLinkPreviewStyle } from "@/shared/lib/linkPreviewStylePreference";
import { setThreadViewMode } from "@/features/channels/lib/threadViewModePreference";
import {
  LIGHT_THEMES,
  SYNTAX_THEMES,
  type SyntaxThemeName,
} from "./theme-loader";

export function CommunityThemeController() {
  const { activeCommunity } = useCommunities();
  const identity = useIdentityQuery();
  const theme = useTheme();
  const pubkey = identity.data?.pubkey;
  const relayUrl = activeCommunity?.relayUrl;
  const managerRef = useRef<CommunityThemeSyncManager | null>(null);
  const scopeRef = useRef("");
  const expectedAppliedRef = useRef<CommunityThemePreference | null>(null);
  const scopedPreferenceRef = useRef<CommunityThemePreference | null>(null);
  const lastRemoteRef = useRef({ createdAt: 0, eventId: "" });
  const initialPreferenceRef = useRef<CommunityThemePreference>({
    version: 1,
    theme: theme.selectedThemeName as CommunityThemePreference["theme"],
    accent: theme.accentColor,
    followSystem: theme.followSystem,
  });

  const currentPreferenceRef = useRef<CommunityThemePreference>({
    version: 1,
    theme: theme.selectedThemeName as CommunityThemePreference["theme"],
    accent: theme.accentColor,
    followSystem: theme.followSystem,
  });
  currentPreferenceRef.current = {
    version: 1,
    theme: theme.selectedThemeName as CommunityThemePreference["theme"],
    accent: theme.accentColor,
    followSystem: theme.followSystem,
  };

  const applyPreference = useCallback(
    (preference: CommunityThemePreference) => {
      expectedAppliedRef.current = communityThemeApplyExpectation(
        preference,
        currentPreferenceRef.current,
      );
      theme.applyAppearance(preference);
    },
    [theme.applyAppearance],
  );

  useLayoutEffect(() => {
    if (!pubkey || !relayUrl) return;
    const local = readCommunityThemePreference(pubkey, relayUrl);
    const dirty = readCommunityThemeOutbox(pubkey, relayUrl);
    const snapshot = activeCommunity?.id
      ? readAppearanceSnapshot(
          appearanceSnapshotKey(pubkey, activeCommunity.id),
        )
      : null;
    // The single Settings save is authoritative even if a legacy cache write
    // failed. Keep that snapshot as the durable recovery record.
    const saved: CommunityThemePreference | null =
      snapshot &&
      SYNTAX_THEMES.includes(snapshot.theme as SyntaxThemeName) &&
      typeof snapshot.accent === "string" &&
      isValidHexColor(snapshot.accent) &&
      typeof snapshot.followSystem === "boolean"
        ? {
            version: 1,
            theme: snapshot.theme as SyntaxThemeName,
            accent: snapshot.accent,
            followSystem: snapshot.followSystem,
          }
        : null;
    if (saved && (!local || !sameCommunityThemePreference(saved, local))) {
      writeCommunityThemePreference(pubkey, relayUrl, saved);
      writeCommunityThemeOutbox(pubkey, relayUrl, saved);
    }
    // Preserve the user's existing global appearance the first time this
    // feature sees their current community. Later missing/malformed target
    // records use the stable default so the previous community never leaks.
    const fallback = communityThemeScopeFallback(
      hasMigratedCommunityTheme(pubkey),
      initialPreferenceRef.current,
    );
    const scopedPreference = saved ?? dirty ?? local ?? fallback;
    scopedPreferenceRef.current = scopedPreference;
    applyPreference(scopedPreference);
    // Initialization is programmatic even when the provider already exposes
    // this exact value. Mark it after applyPreference so its no-op optimization
    // cannot make the persistence effect mistake the fallback for a user edit.
    expectedAppliedRef.current = communityThemeApplyExpectation(
      scopedPreference,
      currentPreferenceRef.current,
      true,
    );
  }, [pubkey, relayUrl, activeCommunity?.id, applyPreference]);

  // Restore full local appearance before Settings is opened after a restart.
  useLayoutEffect(() => {
    if (!pubkey || !activeCommunity?.id) return;
    const business = readAppearanceSnapshot(
      appearanceSnapshotKey(pubkey, activeCommunity.id),
    );
    const global = readAppearanceSnapshot(
      appearanceSnapshotKey(pubkey, "global-conversations"),
    );
    const root = document.documentElement;
    const colors = business?.customLight;
    if (
      business?.custom &&
      Array.isArray(colors) &&
      colors.length === 2 &&
      colors.every(isValidHexColor)
    ) {
      const mode = business.followSystem
        ? theme.isDark
          ? "dark"
          : "light"
        : LIGHT_THEMES.has(business.theme as SyntaxThemeName)
          ? "light"
          : "dark";
      const [first, second] = customGradientStops(colors, mode);
      root.style.setProperty("--w20-custom-gradient-start", first);
      root.style.setProperty("--w20-custom-gradient-end", second);
      root.classList.add("w20-custom-appearance");
    } else {
      root.style.removeProperty("--w20-custom-gradient-start");
      root.style.removeProperty("--w20-custom-gradient-end");
      root.classList.remove("w20-custom-appearance");
    }
    const conversations = global ?? business;
    const size = conversations?.messageSize;
    if (size === "smaller" || size === "default" || size === "larger")
      applyConversationMessageSize(size);
    const density = conversations?.density;
    if (
      density === "compact" ||
      density === "comfortable" ||
      density === "spacious"
    )
      setConversationDensity(density);
    const links = conversations?.linkPreview;
    if (links === "compact" || links === "rich") setLinkPreviewStyle(links);
    const threads = conversations?.threadLayout;
    if (threads === "split" || threads === "focus") setThreadViewMode(threads);
  }, [pubkey, activeCommunity?.id, theme.isDark]);

  useEffect(() => {
    if (!pubkey || !relayUrl) return;
    const scope = `${pubkey}:${relayUrl}`;
    scopeRef.current = scope;
    lastRemoteRef.current = { createdAt: 0, eventId: "" };
    const manager = new CommunityThemeSyncManager(pubkey, (published) => {
      const last = lastRemoteRef.current;
      if (isNewerCommunityThemeCoordinate(published, last)) {
        lastRemoteRef.current = {
          createdAt: published.createdAt,
          eventId: published.eventId,
        };
      }
      clearCommunityThemeOutbox(pubkey, relayUrl, published.preference);
    });
    managerRef.current = manager;
    const durablePending = readCommunityThemeOutbox(pubkey, relayUrl);
    if (durablePending) manager.publish(durablePending);

    const applyRemote = (remote: RemoteCommunityTheme) => {
      if (scopeRef.current !== scope) return;
      const last = lastRemoteRef.current;
      if (!isNewerCommunityThemeCoordinate(remote, last)) {
        return;
      }
      const dirty = readCommunityThemeOutbox(pubkey, relayUrl);
      if (dirty) {
        lastRemoteRef.current = {
          createdAt: remote.createdAt,
          eventId: remote.eventId,
        };
        manager.acceptRemote(remote);
        manager.publish(dirty);
        return;
      }
      // Keep the restart record in step with an accepted remote preference.
      // On storage failure retain the durable local record and retry hydration
      // on the next reconnect rather than applying a torn preference.
      if (activeCommunity?.id) {
        const key = appearanceSnapshotKey(pubkey, activeCommunity.id);
        const snapshot = readAppearanceSnapshot(key);
        if (snapshot) {
          try {
            window.localStorage.setItem(
              key,
              JSON.stringify({ ...snapshot, ...remote.preference }),
            );
          } catch {
            return;
          }
        }
      }
      lastRemoteRef.current = {
        createdAt: remote.createdAt,
        eventId: remote.eventId,
      };
      manager.acceptRemote(remote);
      scopedPreferenceRef.current = remote.preference;
      manager.cancelPendingPublish();
      cacheAndApplyCommunityTheme(
        pubkey,
        relayUrl,
        remote.preference,
        applyPreference,
      );
    };

    let unsubscribe: (() => Promise<void>) | null = null;
    void manager
      .subscribeAndFetch(applyRemote)
      .then(({ result, unsubscribe: dispose }) => {
        if (scopeRef.current !== scope) {
          void dispose();
          return;
        }
        unsubscribe = dispose;
        const remote = communityThemeHydrationRemote(result);
        if (remote) {
          applyRemote(remote);
          markCommunityThemeMigrated(pubkey);
        } else if (shouldSeedCommunityTheme(result)) {
          const local =
            readCommunityThemeOutbox(pubkey, relayUrl) ??
            readCommunityThemePreference(pubkey, relayUrl) ??
            scopedPreferenceRef.current ??
            DEFAULT_COMMUNITY_THEME;
          writeCommunityThemePreference(pubkey, relayUrl, local);
          writeCommunityThemeOutbox(pubkey, relayUrl, local);
          markCommunityThemeMigrated(pubkey);
          manager.publish(local);
        }
        // Invalid or unavailable hydration keeps the already-applied fallback
        // without publishing over relay state we could not establish safely.
      });
    const unsubscribeReconnect = relayClient.subscribeToReconnects(() => {
      void manager.fetchRemote().then((result) => {
        if (result.status === "valid") {
          applyRemote(result.remote);
          return;
        }
        if (result.status !== "absent") return;
        const pending = readCommunityThemeOutbox(pubkey, relayUrl);
        if (pending) manager.publish(pending);
      });
    });

    return () => {
      if (scopeRef.current === scope) scopeRef.current = "";
      manager.destroy();
      if (managerRef.current === manager) managerRef.current = null;
      unsubscribeReconnect();
      if (unsubscribe) void unsubscribe();
    };
  }, [pubkey, relayUrl, activeCommunity?.id, applyPreference]);

  useEffect(() => {
    if (!pubkey || !relayUrl) return;
    const preference: CommunityThemePreference = {
      version: 1,
      theme: theme.selectedThemeName as CommunityThemePreference["theme"],
      accent: theme.accentColor,
      followSystem: theme.followSystem,
    };
    const persistenceAction = communityThemePersistenceAction(
      expectedAppliedRef.current,
      preference,
    );
    if (persistenceAction === "defer") return;
    if (persistenceAction === "acknowledge") {
      expectedAppliedRef.current = null;
      return;
    }
    const stored = readCommunityThemePreference(pubkey, relayUrl);
    if (stored && sameCommunityThemePreference(stored, preference)) return;
    scopedPreferenceRef.current = preference;
    if (!writeCommunityThemePreference(pubkey, relayUrl, preference)) return;
    if (!writeCommunityThemeOutbox(pubkey, relayUrl, preference)) return;
    managerRef.current?.publish(preference);
  }, [
    pubkey,
    relayUrl,
    theme.selectedThemeName,
    theme.accentColor,
    theme.followSystem,
  ]);

  return null;
}
