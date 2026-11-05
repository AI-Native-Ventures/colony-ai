import * as React from "react";
import {
  useCanGoBack,
  useLocation,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";

import { breadcrumbForPath } from "@/app/topBarBreadcrumbs";
import {
  allowNavigation,
  traverseHistory,
} from "@/app/navigation/navigationGuard";

const MAX_ROUTE_ENTRIES = 200;

export type RoutePageSnapshot = {
  backLabel?: string;
  breadcrumbs?: string[];
  viewState?: unknown;
  scrollY?: number;
  scrollTarget?: string;
};

export type RouteOrigin = {
  pathname: string;
  href: string;
  search: Record<string, unknown>;
  hash: string;
  backLabel: string;
  breadcrumbs: string[];
  snapshot: RoutePageSnapshot | null;
};

export type RouteBackFallback = {
  to: string;
  label: string;
  breadcrumbs?: string[];
};

type RouteLocation = {
  pathname: string;
  href: string;
  search: Record<string, unknown>;
  hash: string;
  state: Record<string, unknown>;
};

type RouteOriginContextValue = {
  origin: RouteOrigin | null;
  pageSnapshot: RoutePageSnapshot | null;
  savePageSnapshot: (snapshot: RoutePageSnapshot) => void;
  restorePageSnapshot: (origin: RouteOrigin) => void;
};

const RouteOriginContext = React.createContext<RouteOriginContextValue | null>(
  null,
);

function locationKey(location: RouteLocation): string {
  const key = location.state.__TSR_key ?? location.state.key;
  return typeof key === "string" ? key : location.href;
}

function remember<T>(map: Map<string, T>, key: string, value: T) {
  map.delete(key);
  map.set(key, value);
  while (map.size > MAX_ROUTE_ENTRIES) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

function fallbackOriginDetails(
  location: RouteLocation,
): Pick<RouteOrigin, "backLabel" | "breadcrumbs"> {
  const crumbs = breadcrumbForPath(location.pathname)?.map(
    ({ label }) => label,
  );
  const lastCrumb = crumbs?.at(-1);
  if (location.pathname === "/leads") {
    return {
      backLabel: "All leads",
      breadcrumbs: ["Business", "Sales", "Leads"],
    };
  }
  if (location.pathname === "/campaign") {
    return {
      backLabel: "Campaign",
      breadcrumbs: ["Business", "Discovery", "Campaign"],
    };
  }
  if (location.pathname === "/discovery") {
    return { backLabel: "Discovery", breadcrumbs: ["Business", "Discovery"] };
  }
  if (location.pathname === "/discovery/campaigns") {
    return {
      backLabel: "All campaigns",
      breadcrumbs: ["Business", "Discovery", "All campaigns"],
    };
  }
  if (location.pathname === "/whatsapp/outreach") {
    return { backLabel: "Outreach", breadcrumbs: ["Business", "Outreach"] };
  }
  if (location.pathname.startsWith("/channels/")) {
    const isOutreachChat = Boolean(location.search.whatsappContactWaId);
    return isOutreachChat
      ? { backLabel: "Outreach", breadcrumbs: ["Business", "Outreach"] }
      : { backLabel: "Chat", breadcrumbs: ["Chat"] };
  }
  if (location.pathname.startsWith("/clients/record/")) {
    return { backLabel: "All clients", breadcrumbs: ["Business", "Clients"] };
  }
  if (location.pathname.startsWith("/clients/")) {
    return { backLabel: "All clients", breadcrumbs: ["Business", "Clients"] };
  }
  if (location.pathname === "/clients") {
    return { backLabel: "All clients", breadcrumbs: ["Business", "Clients"] };
  }
  if (location.pathname.startsWith("/money/invoice/")) {
    return {
      backLabel: "All invoices",
      breadcrumbs: ["Business", "Money", "Invoices"],
    };
  }
  if (location.pathname.startsWith("/money/revenue/")) {
    return {
      backLabel: "All revenue",
      breadcrumbs: ["Business", "Money", "Revenue"],
    };
  }
  if (location.pathname.startsWith("/money/")) {
    const section = location.pathname.split("/")[2];
    const label = section === "revenue" ? "Revenue" : "Invoices";
    return {
      backLabel: label,
      breadcrumbs: ["Business", "Money", label],
    };
  }
  if (location.pathname.startsWith("/company/function/")) {
    return {
      backLabel: "Company map",
      breadcrumbs: ["Company", "Company map"],
    };
  }
  if (location.pathname.startsWith("/team/detail/")) {
    return { backLabel: "Team", breadcrumbs: ["Company", "Team"] };
  }
  if (location.pathname.startsWith("/agents") && location.search.agent) {
    return { backLabel: "Agents", breadcrumbs: ["Company", "Agents"] };
  }
  if (location.pathname === "/team") {
    return { backLabel: "Team", breadcrumbs: ["Company", "Team"] };
  }
  if (location.pathname === "/agents") {
    return { backLabel: "Agents", breadcrumbs: ["Company", "Agents"] };
  }
  if (location.pathname === "/settings") {
    return { backLabel: "Workspace", breadcrumbs: ["Settings"] };
  }
  if (location.pathname === "/") {
    return { backLabel: "Activity", breadcrumbs: ["Activity"] };
  }
  if (location.pathname === "/today") {
    return { backLabel: "Today", breadcrumbs: ["Today"] };
  }
  if (location.pathname === "/today/needs-you") {
    return {
      backLabel: "Needs you",
      breadcrumbs: ["Today", "Needs you"],
    };
  }
  if (location.pathname === "/today/reviews-empty") {
    return { backLabel: "Today", breadcrumbs: ["Today", "Reviews"] };
  }

  const labels = crumbs?.length ? crumbs : ["Workspace"];
  return { backLabel: lastCrumb ?? "Workspace", breadcrumbs: labels };
}

export function routeBackFallback(
  location: Pick<RouteLocation, "pathname"> &
    Partial<Pick<RouteLocation, "search">>,
): RouteBackFallback | null {
  const pathname = location.pathname;
  if (pathname.startsWith("/sales/lead/")) {
    return {
      to: "/leads",
      label: "All leads",
      breadcrumbs: ["Business", "Sales", "Leads"],
    };
  }
  if (
    pathname.startsWith("/clients/record/") ||
    pathname.startsWith("/clients/")
  ) {
    return {
      to: "/clients",
      label: "All clients",
      breadcrumbs: ["Business", "Clients"],
    };
  }
  if (pathname.startsWith("/money/invoice/")) {
    return {
      to: "/money/invoices",
      label: "All invoices",
      breadcrumbs: ["Business", "Money", "Invoices"],
    };
  }
  if (pathname.startsWith("/money/revenue/")) {
    return {
      to: "/money/revenue",
      label: "All revenue",
      breadcrumbs: ["Business", "Money", "Revenue"],
    };
  }
  if (pathname.startsWith("/company/function/")) {
    return {
      to: "/company/map",
      label: "Company map",
      breadcrumbs: ["Company", "Company map"],
    };
  }
  if (pathname.startsWith("/team/detail/")) {
    return { to: "/team", label: "Team", breadcrumbs: ["Company", "Team"] };
  }
  if (pathname === "/agents" && location.search?.agent) {
    return {
      to: "/agents",
      label: "Agents",
      breadcrumbs: ["Company", "Agents"],
    };
  }
  if (pathname === "/campaign") {
    return {
      to: "/discovery",
      label: "Discovery",
      breadcrumbs: ["Business", "Discovery"],
    };
  }
  if (pathname === "/discovery/campaigns") {
    return {
      to: "/discovery",
      label: "Discovery",
      breadcrumbs: ["Business", "Discovery"],
    };
  }
  if (pathname === "/settings") {
    return { to: "/today", label: "Workspace", breadcrumbs: ["Today"] };
  }
  return null;
}

export function RouteOriginProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const location = useLocation();
  const originsRef = React.useRef(new Map<string, RouteOrigin>());
  const snapshotsRef = React.useRef(new Map<string, RoutePageSnapshot>());
  const pendingRestoreRef = React.useRef<{
    href: string;
    snapshot: RoutePageSnapshot;
  } | null>(null);
  const current = location as unknown as RouteLocation;
  const currentKey = locationKey(current);

  React.useEffect(
    () =>
      router.subscribe("onBeforeNavigate", (event) => {
        const from = event.fromLocation as unknown as RouteLocation | undefined;
        const to = event.toLocation as unknown as RouteLocation;
        if (!from) return;
        const fromKey = locationKey(from);
        const toKey = locationKey(to);
        if (!toKey || fromKey === toKey) return;

        const savedOrigin = originsRef.current.get(toKey);
        if (!savedOrigin) {
          const snapshot = snapshotsRef.current.get(fromKey) ?? null;
          const defaults = fallbackOriginDetails(from);
          remember(originsRef.current, toKey, {
            pathname: from.pathname,
            href: from.href,
            search: from.search,
            hash: from.hash,
            backLabel: snapshot?.backLabel ?? defaults.backLabel,
            breadcrumbs: snapshot?.breadcrumbs ?? defaults.breadcrumbs,
            snapshot,
          });
        }

        const pendingRestore = pendingRestoreRef.current;
        if (pendingRestore && pendingRestore.href === to.href) {
          remember(snapshotsRef.current, toKey, pendingRestore.snapshot);
          pendingRestoreRef.current = null;
        }
      }),
    [router],
  );

  const savePageSnapshot = React.useCallback(
    (snapshot: RoutePageSnapshot) => {
      remember(snapshotsRef.current, currentKey, snapshot);
    },
    [currentKey],
  );

  const restorePageSnapshot = React.useCallback((origin: RouteOrigin) => {
    if (origin.snapshot) {
      pendingRestoreRef.current = {
        href: origin.href,
        snapshot: origin.snapshot,
      };
    }
  }, []);

  const value = React.useMemo(
    () => ({
      origin: originsRef.current.get(currentKey) ?? null,
      pageSnapshot: snapshotsRef.current.get(currentKey) ?? null,
      savePageSnapshot,
      restorePageSnapshot,
    }),
    [currentKey, restorePageSnapshot, savePageSnapshot],
  );

  return (
    <RouteOriginContext.Provider value={value}>
      {children}
    </RouteOriginContext.Provider>
  );
}

export function useRouteOrigin(): RouteOriginContextValue {
  const context = React.useContext(RouteOriginContext);
  if (!context) {
    return {
      origin: null,
      pageSnapshot: null,
      savePageSnapshot: () => undefined,
      restorePageSnapshot: () => undefined,
    };
  }
  return context;
}

export function useRouteBack(fallback?: RouteBackFallback) {
  const router = useRouter();
  const navigate = useNavigate();
  const canGoBack = useCanGoBack();
  const { origin, restorePageSnapshot } = useRouteOrigin();

  const goBack = React.useCallback(() => {
    if (origin && canGoBack) {
      traverseHistory(router.history, "back");
      return;
    }
    if (origin) {
      restorePageSnapshot(origin);
      if (!allowNavigation({ kind: "route", href: origin.href })) return;
      void navigate({
        to: origin.pathname,
        search: origin.search,
        hash: origin.hash,
      } as never);
      return;
    }
    if (canGoBack) {
      traverseHistory(router.history, "back");
      return;
    }
    if (fallback) {
      if (!allowNavigation({ kind: "route", href: fallback.to })) return;
      void navigate({ to: fallback.to } as never);
    }
  }, [
    canGoBack,
    fallback,
    navigate,
    origin,
    restorePageSnapshot,
    router.history,
  ]);

  return {
    origin,
    backLabel: origin?.backLabel ?? fallback?.label ?? "Back",
    breadcrumbs: origin?.breadcrumbs ?? fallback?.breadcrumbs ?? [],
    canGoBack: canGoBack || Boolean(origin) || Boolean(fallback),
    goBack,
  };
}
