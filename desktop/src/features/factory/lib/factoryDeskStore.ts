import type { FactoryScope } from "@/shared/api/factoryRuntime";

export type FactoryDeskTab = { id: string; name: string };
export type FactoryDesk = {
  tabs: FactoryDeskTab[];
  activeTabId: string;
  runToTab: Record<string, string>;
};

export function factoryDeskStorageKey(scope: FactoryScope) {
  return `colony.factory.desk.v1:${[
    scope.relayUrl,
    scope.identityPubkey,
    scope.businessCommunityId,
    scope.clientChannelId ?? "",
  ]
    .map((part) => encodeURIComponent(part))
    .join(":")}`;
}

export function loadFactoryDesk(
  storage: Pick<Storage, "getItem">,
  scope: FactoryScope,
): FactoryDesk {
  const raw = storage.getItem(factoryDeskStorageKey(scope));
  if (raw === null) {
    return {
      tabs: [{ id: "build-desk", name: "Build desk" }],
      activeTabId: "build-desk",
      runToTab: {},
    };
  }
  const value: unknown = JSON.parse(raw);
  if (
    !value ||
    typeof value !== "object" ||
    !Array.isArray((value as FactoryDesk).tabs) ||
    (value as FactoryDesk).tabs.length === 0 ||
    typeof (value as FactoryDesk).runToTab !== "object" ||
    (value as FactoryDesk).runToTab === null
  ) {
    throw new Error("Factory desk layout is invalid.");
  }
  return value as FactoryDesk;
}

export function saveFactoryDesk(
  storage: Pick<Storage, "setItem">,
  scope: FactoryScope,
  desk: FactoryDesk,
): FactoryDesk {
  storage.setItem(factoryDeskStorageKey(scope), JSON.stringify(desk));
  return desk;
}

export function assignRunToFactoryTab(
  desk: FactoryDesk,
  runId: string,
  tabId: string,
): FactoryDesk {
  return {
    ...desk,
    runToTab: { ...desk.runToTab, [runId]: tabId },
  };
}
