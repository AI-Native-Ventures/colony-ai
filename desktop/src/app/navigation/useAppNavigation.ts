import * as React from "react";
import {
  useCanGoBack,
  useLocation,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";

import type { SearchHighlightNavigation } from "@/app/navigation/searchHighlightNavigation";
import { openSearchHitWithNavigation } from "@/app/navigation/searchHitNavigation";
import {
  allowNavigation,
  type GuardedNavigation,
  traverseHistory,
} from "@/app/navigation/navigationGuard";
import type { SearchHit } from "@/shared/api/types";

type NavigationBehavior = {
  force?: boolean;
  replace?: boolean;
  resetScroll?: boolean;
};

export function useAppNavigation() {
  const router = useRouter();
  const navigate = useNavigate();
  const location = useLocation();
  const canGoBack = useCanGoBack();

  const commitNavigation = React.useCallback(
    async (
      next: {
        to: string;
        params?: Record<string, string>;
        search?: Record<string, string | undefined>;
        state?:
          | Record<string, unknown>
          | ((
              previousState: Record<string, unknown>,
            ) => Record<string, unknown>);
      },
      behavior: NavigationBehavior = {},
      guardedTarget?: GuardedNavigation,
    ) => {
      const nextLocation = router.buildLocation(next as never);
      const hasStateUpdate = next.state !== undefined;

      if (
        location.href === nextLocation.href &&
        !behavior.force &&
        !hasStateUpdate
      ) {
        return false;
      }

      if (
        !allowNavigation(
          guardedTarget ?? { kind: "route", href: nextLocation.href },
        )
      ) {
        return false;
      }

      await navigate({
        ...next,
        replace: behavior.replace,
        resetScroll: behavior.resetScroll,
      } as never);
      return true;
    },
    [location.href, navigate, router],
  );

  const goHome = React.useCallback(
    (behavior?: NavigationBehavior) =>
      commitNavigation(
        {
          to: "/",
        },
        behavior,
      ),
    [commitNavigation],
  );

  const goToday = React.useCallback(
    (behavior?: NavigationBehavior) =>
      commitNavigation(
        {
          to: "/today",
        },
        behavior,
      ),
    [commitNavigation],
  );

  const goAgents = React.useCallback(
    (behavior?: NavigationBehavior) =>
      commitNavigation(
        {
          to: "/agents",
        },
        behavior,
      ),
    [commitNavigation],
  );

  const goAgentProfile = React.useCallback(
    (agentPubkey: string, behavior?: NavigationBehavior) =>
      commitNavigation(
        {
          to: "/agents",
          search: { agent: agentPubkey },
        },
        behavior,
      ),
    [commitNavigation],
  );

  const goPower = React.useCallback(
    (behavior?: NavigationBehavior) =>
      commitNavigation({ to: "/power" }, behavior),
    [commitNavigation],
  );

  const goProfile = React.useCallback(
    (pubkey: string, behavior?: NavigationBehavior) =>
      commitNavigation(
        {
          to: "/",
          search: { profile: pubkey },
        },
        behavior,
      ),
    [commitNavigation],
  );

  const goTeam = React.useCallback(
    (behavior?: NavigationBehavior) =>
      commitNavigation({ to: "/team" }, behavior),
    [commitNavigation],
  );

  const goTeamMember = React.useCallback(
    (memberPubkey: string, behavior?: NavigationBehavior) =>
      commitNavigation(
        { to: "/team/detail/$memberPubkey", params: { memberPubkey } },
        behavior,
      ),
    [commitNavigation],
  );

  const goTeamEdit = React.useCallback(
    (memberPubkey: string, behavior?: NavigationBehavior) =>
      commitNavigation(
        { to: "/team/edit/$memberPubkey", params: { memberPubkey } },
        behavior,
      ),
    [commitNavigation],
  );

  const goTeamPause = React.useCallback(
    (memberPubkey: string, behavior?: NavigationBehavior) =>
      commitNavigation(
        { to: "/team/pause/$memberPubkey", params: { memberPubkey } },
        behavior,
      ),
    [commitNavigation],
  );

  const goTeamArchive = React.useCallback(
    (memberPubkey: string, behavior?: NavigationBehavior) =>
      commitNavigation(
        { to: "/team/archive/$memberPubkey", params: { memberPubkey } },
        behavior,
      ),
    [commitNavigation],
  );

  const goHireRoles = React.useCallback(
    (savedRolePackId?: string, behavior?: NavigationBehavior) =>
      commitNavigation(
        {
          to: "/hire/roles",
          search: { savedRolePack: savedRolePackId },
        },
        behavior,
      ),
    [commitNavigation],
  );

  const goHireRoleRecovery = React.useCallback(
    (kind: "runtime" | "provider" | "model", draftPersonaId: string) =>
      commitNavigation({
        to: "/hire/roles",
        search: {
          roleRecovery: `${kind}-empty`,
          rolePersonaId: draftPersonaId,
        },
      }),
    [commitNavigation],
  );

  const goHireConfigure = React.useCallback(
    (
      personaId: string,
      hireId: string,
      source?: { channelId?: string; askId?: string; nameTaken?: boolean },
      behavior?: NavigationBehavior,
    ) =>
      commitNavigation(
        {
          to: "/hire/configure",
          search: {
            personaId,
            hireId,
            channelId: source?.channelId,
            askId: source?.askId,
            nameTaken: source?.nameTaken ? "true" : undefined,
          },
        },
        behavior,
      ),
    [commitNavigation],
  );

  const goHireReview = React.useCallback(
    (
      hireId: string,
      source?: { channelId?: string; askId?: string },
      behavior?: NavigationBehavior,
    ) =>
      commitNavigation(
        {
          to: "/hire/review",
          search: {
            hireId,
            channelId: source?.channelId,
            askId: source?.askId,
          },
        },
        behavior,
      ),
    [commitNavigation],
  );

  const goHireSuccess = React.useCallback(
    (hireId: string, behavior?: NavigationBehavior) =>
      commitNavigation({ to: "/hire/success", search: { hireId } }, behavior),
    [commitNavigation],
  );

  const goClients = React.useCallback(
    (behavior?: NavigationBehavior) =>
      commitNavigation({ to: "/clients" }, behavior),
    [commitNavigation],
  );

  const goClient = React.useCallback(
    (clientId: string, behavior?: NavigationBehavior) =>
      commitNavigation(
        {
          to: "/clients/$clientId",
          params: { clientId },
        },
        behavior,
      ),
    [commitNavigation],
  );

  const goWork = React.useCallback(
    (clientId?: string, behavior?: NavigationBehavior) =>
      commitNavigation(
        {
          to: "/$workSurface",
          params: { workSurface: "work" },
          search: clientId ? { client: clientId } : {},
        },
        behavior,
      ),
    [commitNavigation],
  );

  const goWorkItem = React.useCallback(
    (workItemId: string, clientId?: string, behavior?: NavigationBehavior) =>
      commitNavigation(
        {
          to: "/work/$workId",
          params: { workId: workItemId },
          search: clientId ? { client: clientId } : {},
        },
        behavior,
      ),
    [commitNavigation],
  );

  const goChannel = React.useCallback(
    (
      channelId: string,
      options?: {
        /** Open the agent activity pane for this agent pubkey on arrival. */
        agentSession?: string;
        /**
         * When set, the main composer auto-submits the draft with this key
         * once on mount. Clears itself (via `?autoSend` search param) after
         * firing. Used by the Drafts panel "Send message" confirm flow.
         */
        autoSend?: string;
        /** Navigate even when the destination matches the current href.
         * Used by desktop-notification activation so a click is never
         * silently swallowed (block/buzz#3509). */
        force?: boolean;
        messageId?: string;
        /** Preserve an active search highlight; ordinary navigation clears it. */
        preserveSearchHighlight?: boolean;
        searchHighlight?: SearchHighlightNavigation;
        replace?: boolean;
        /** Open this thread panel directly without waiting for a timeline row. */
        thread?: string;
        threadRootId?: string | null;
      },
    ) => {
      return commitNavigation(
        {
          to: "/channels/$channelId",
          params: {
            channelId,
          },
          search: {
            ...(options?.messageId
              ? {
                  messageId: options.messageId,
                  threadRootId: options.threadRootId ?? undefined,
                }
              : {}),
            ...(options?.agentSession
              ? { agentSession: options.agentSession }
              : {}),
            ...(options?.thread ? { thread: options.thread } : {}),
            ...(options?.autoSend ? { autoSend: options.autoSend } : {}),
          },
          state: options?.preserveSearchHighlight
            ? undefined
            : (previousState: Record<string, unknown>) => ({
                ...previousState,
                searchHighlight: options?.searchHighlight ?? null,
              }),
        },
        {
          force: options?.force,
          replace: options?.replace,
          resetScroll: options?.messageId ? true : undefined,
        },
        options?.messageId
          ? {
              kind: "channel-message",
              channelId,
              messageId: options.messageId,
              threadRootId: options.threadRootId ?? null,
            }
          : undefined,
      );
    },
    [commitNavigation],
  );

  const goAskDetail = React.useCallback(
    (
      channelId: string,
      askId: string,
      companyToolConsentInbox = false,
      behavior?: NavigationBehavior,
    ) =>
      commitNavigation(
        {
          to: "/asks/$channelId/$askId",
          params: { channelId, askId },
          ...(companyToolConsentInbox
            ? { search: { companyToolConsentInbox: "1" } }
            : {}),
        },
        behavior,
      ),
    [commitNavigation],
  );

  const goNewMessage = React.useCallback(
    (behavior?: NavigationBehavior) =>
      commitNavigation(
        {
          to: "/messages/new",
        },
        behavior,
      ),
    [commitNavigation],
  );

  const goSettings = React.useCallback(
    (section?: string, behavior?: NavigationBehavior) =>
      commitNavigation(
        {
          to: "/settings",
          search: section ? { section } : {},
        },
        behavior,
      ),
    [commitNavigation],
  );

  const closeSettings = React.useCallback(() => {
    if (canGoBack) {
      traverseHistory(router.history, "back");
      return;
    }

    void goHome({ replace: true });
  }, [canGoBack, goHome, router.history]);

  const openSearchHit = React.useCallback(
    async (
      hit: SearchHit,
      behavior?: {
        /** Navigate even when the destination matches the current href.
         * Used by desktop-notification activation so a click is never
         * silently swallowed (block/buzz#3509). */
        force?: boolean;
        /** Search text to highlight after opening this result. */
        query?: string;
        /** Stop notification-driven routing when its owning lifecycle ends. */
        signal?: AbortSignal;
      },
    ) =>
      openSearchHitWithNavigation(hit, {
        force: behavior?.force,
        goChannel,
        query: behavior?.query,
        signal: behavior?.signal,
      }),
    [goChannel],
  );

  return {
    closeSettings,
    goAgents,
    goAgentProfile,
    goAskDetail,
    goChannel,
    goClient,
    goClients,
    goHome,
    goTeam,
    goTeamMember,
    goTeamEdit,
    goTeamPause,
    goTeamArchive,
    goHireRoles,
    goHireRoleRecovery,
    goHireConfigure,
    goHireReview,
    goHireSuccess,
    goPower,
    goToday,
    goNewMessage,
    goProfile,
    goSettings,
    goWork,
    goWorkItem,
    openSearchHit,
  };
}
