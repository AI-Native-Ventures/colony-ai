import type {
  DiscoveryCampaign,
  DiscoveryCampaignProvider,
  DiscoveryRunStatus,
} from "./discoveryProvider";
import {
  campaignInputForGroupCity,
  campaignNameForCity,
  cloneGroup,
  createMultiCityCampaignGroup,
  groupForCampaign,
  readMultiCityState,
  type MultiCityCampaignGroup,
  type MultiCityCampaignInput,
  type MultiCityGroupCity,
  type MultiCityStorage,
  uniqueLocations,
  writeMultiCityState,
} from "./multiCityDiscovery";

export type MultiCityDiscoverySnapshot = {
  groups: MultiCityCampaignGroup[];
  campaigns: DiscoveryCampaign[];
};

export type MultiCityQueueAction = "pause" | "resume" | "cancel" | "retry";

export type MultiCityDiscoveryCoordinatorOptions = {
  provider: DiscoveryCampaignProvider;
  storage: MultiCityStorage | null;
  storageKey: string;
  nowSeconds?: () => number;
  groupId?: () => string;
  cityId?: () => string;
};

const TERMINAL_STATUSES = new Set<DiscoveryRunStatus>([
  "cancelled",
  "complete",
  "failed",
]);

function newId(prefix: string): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

function cloneCampaign(campaign: DiscoveryCampaign): DiscoveryCampaign {
  return {
    ...campaign,
    prospectIds: [...campaign.prospectIds],
    pickedTags: campaign.pickedTags ? [...campaign.pickedTags] : undefined,
    coverage: campaign.coverage?.map((coverage) => ({ ...coverage })),
    runLog: campaign.runLog?.map((page) => ({ ...page })),
    areasSearched: campaign.areasSearched
      ? [...campaign.areasSearched]
      : undefined,
    nearbyAreasLeft: campaign.nearbyAreasLeft
      ? [...campaign.nearbyAreasLeft]
      : undefined,
  };
}

function errorText(error: unknown): string {
  return error instanceof Error
    ? error.message.trim()
    : String(error ?? "").trim();
}

/** Errors that mean no remaining city can safely begin until the owner fixes it. */
export function isGlobalQueueFailure(error: unknown): boolean {
  const message = errorText(error).toLocaleLowerCase();
  return [
    "not configured",
    "not set up",
    "server is not",
    "no credits",
    "insufficient credits",
    "signed out",
    "sign in",
    "sign-in",
    "sales channel",
    "sales is not allowed",
    "not allowed to use sales",
    "membership",
    "tenant community",
  ].some((phrase) => message.includes(phrase));
}

function campaignForCity(
  city: MultiCityGroupCity,
  campaigns: readonly DiscoveryCampaign[],
): DiscoveryCampaign | null {
  return city.campaignId
    ? (campaigns.find((campaign) => campaign.id === city.campaignId) ?? null)
    : null;
}

function campaignIsActive(
  city: MultiCityGroupCity,
  campaigns: readonly DiscoveryCampaign[],
): boolean {
  const campaign = campaignForCity(city, campaigns);
  return campaign?.status === "running" || campaign?.status === "paused";
}

/**
 * Device-local sequential queue for normal Discovery campaigns. It deliberately
 * knows only the provider's public API, so the base Discovery engine remains a
 * single-campaign state machine.
 */
export class MultiCityDiscoveryCoordinator {
  private readonly provider: DiscoveryCampaignProvider;
  private readonly storage: MultiCityStorage | null;
  private readonly storageKey: string;
  private readonly nowSeconds: () => number;
  private readonly makeGroupId: () => string;
  private readonly makeCityId: () => string;
  private readonly listeners = new Set<
    (snapshot: MultiCityDiscoverySnapshot) => void
  >();
  private readonly armedGroups = new Set<string>();
  private readonly advancing = new Map<string, Promise<void>>();
  private knownStatuses = new Map<string, DiscoveryRunStatus>();
  private groups: MultiCityCampaignGroup[];
  private disposed = false;
  private startInFlight = false;
  private unsubscribeProvider: (() => void) | null = null;

  constructor(options: MultiCityDiscoveryCoordinatorOptions) {
    this.provider = options.provider;
    this.storage = options.storage;
    this.storageKey = options.storageKey;
    this.nowSeconds =
      options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
    this.makeGroupId = options.groupId ?? (() => newId("group"));
    this.makeCityId = options.cityId ?? (() => newId("city"));
    this.groups = readMultiCityState(this.storage, this.storageKey);
    this.reconcileInterruptedStarts();
    this.rememberStatuses(this.campaigns());
    this.unsubscribeProvider = this.provider.subscribe(() =>
      this.onProviderChanged(),
    );
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.armedGroups.clear();
    this.unsubscribeProvider?.();
    this.unsubscribeProvider = null;
    this.listeners.clear();
  }

  getSnapshot(): MultiCityDiscoverySnapshot {
    return {
      groups: this.groups.map(cloneGroup),
      campaigns: this.campaigns().map(cloneCampaign),
    };
  }

  getGroups(): MultiCityCampaignGroup[] {
    return this.groups.map(cloneGroup);
  }

  getGroup(groupId: string): MultiCityCampaignGroup | null {
    const group = this.groups.find(
      (candidate) => candidate.groupId === groupId,
    );
    return group ? cloneGroup(group) : null;
  }

  getGroupForCampaign(campaignId: string): MultiCityCampaignGroup | null {
    const group = groupForCampaign(this.groups, campaignId);
    return group ? cloneGroup(group) : null;
  }

  subscribe(
    listener: (snapshot: MultiCityDiscoverySnapshot) => void,
  ): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  async startGroup(
    input: MultiCityCampaignInput,
  ): Promise<MultiCityCampaignGroup> {
    const locations = uniqueLocations(input.locations);
    if (locations.length < 2) {
      throw new Error(
        "Choose at least two different cities for this campaign.",
      );
    }
    const group = createMultiCityCampaignGroup({
      groupId: this.makeGroupId(),
      cityIds: locations.map(() => this.makeCityId()),
      input: { ...input, locations },
      createdAt: this.nowSeconds(),
    });
    this.groups = [group, ...this.groups];
    this.persistAndNotify();
    this.armedGroups.add(group.groupId);
    await this.requestAdvance(group.groupId);
    return this.getGroup(group.groupId) ?? group;
  }

  async retryGroup(groupId: string): Promise<void> {
    const updated = this.updateGroup(groupId, (group) => ({
      ...group,
      blockedReason: null,
      cities: group.cities.map((city) =>
        city.campaignId
          ? city
          : {
              ...city,
              state:
                city.state === "not_started" || city.state === "failed"
                  ? "waiting"
                  : city.state,
              reason: null,
            },
      ),
    }));
    if (!updated) return;
    this.armedGroups.add(groupId);
    await this.requestAdvance(groupId);
  }

  async selectCity(groupId: string, cityId: string): Promise<void> {
    const city = this.groups
      .find((group) => group.groupId === groupId)
      ?.cities.find((candidate) => candidate.cityId === cityId);
    if (!city?.campaignId) return;
    await this.provider.select(city.campaignId);
  }

  async openGroup(groupId: string): Promise<string | null> {
    const group = this.groups.find(
      (candidate) => candidate.groupId === groupId,
    );
    if (!group) return null;
    const campaigns = this.campaigns();
    const city =
      group.cities.find(
        (candidate) =>
          campaignForCity(candidate, campaigns)?.status === "running",
      ) ?? group.cities.find((candidate) => Boolean(candidate.campaignId));
    if (!city?.campaignId) return null;
    await this.provider.select(city.campaignId);
    return city.campaignId;
  }

  async performAction(
    campaignId: string,
    action: MultiCityQueueAction,
  ): Promise<void> {
    const group = groupForCampaign(this.groups, campaignId);
    await this.provider.select(campaignId);
    if (action === "pause") {
      if (group) this.armedGroups.delete(group.groupId);
    } else if (group) {
      this.armedGroups.add(group.groupId);
    }
    await this.provider[action]();
    this.onProviderChanged();
  }

  private campaigns(): DiscoveryCampaign[] {
    return this.provider.getCampaigns();
  }

  private notify(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  private persistAndNotify(): void {
    writeMultiCityState(this.storage, this.storageKey, this.groups);
    this.notify();
  }

  private updateGroup(
    groupId: string,
    updater: (group: MultiCityCampaignGroup) => MultiCityCampaignGroup,
  ): MultiCityCampaignGroup | null {
    let next: MultiCityCampaignGroup | null = null;
    this.groups = this.groups.map((group) => {
      if (group.groupId !== groupId) return group;
      const updated = updater(cloneGroup(group));
      next = updated;
      return updated;
    });
    if (next) this.persistAndNotify();
    return next;
  }

  private rememberStatuses(campaigns: readonly DiscoveryCampaign[]): void {
    this.knownStatuses = new Map(
      campaigns.map((campaign) => [campaign.id, campaign.status]),
    );
  }

  private reconcileInterruptedStarts(): void {
    const campaigns = this.campaigns();
    const claimed = new Set(
      this.groups.flatMap((group) =>
        group.cities.flatMap((city) =>
          city.campaignId ? [city.campaignId] : [],
        ),
      ),
    );
    let changed = false;
    this.groups = this.groups.map((group) => ({
      ...group,
      cities: group.cities.map((city) => {
        if (city.campaignId || city.state !== "starting") return city;
        const matching = campaigns.find(
          (campaign) =>
            !claimed.has(campaign.id) &&
            campaign.name === campaignNameForCity(group.name, city.label) &&
            campaign.location === city.locationSelection.label,
        );
        changed = true;
        if (matching) {
          claimed.add(matching.id);
          return { ...city, campaignId: matching.id, state: "waiting" };
        }
        return { ...city, state: "waiting" };
      }),
    }));
    if (changed)
      writeMultiCityState(this.storage, this.storageKey, this.groups);
  }

  private onProviderChanged(): void {
    if (this.disposed) return;
    const campaigns = this.campaigns();
    let groupChanged = false;
    const groupsToAdvance = new Set<string>();

    for (const group of this.groups) {
      for (const city of group.cities) {
        const campaign = campaignForCity(city, campaigns);
        if (!campaign) continue;
        const previous = this.knownStatuses.get(campaign.id);
        if (previous === campaign.status) continue;
        if (
          campaign.status === "failed" &&
          isGlobalQueueFailure(campaign.failureReason)
        ) {
          this.blockGroup(
            group.groupId,
            campaign.id,
            campaign.failureReason ?? "",
          );
          groupChanged = true;
        }
        if (TERMINAL_STATUSES.has(campaign.status)) {
          groupsToAdvance.add(group.groupId);
        }
      }
    }
    this.rememberStatuses(campaigns);
    if (!groupChanged) this.notify();
    for (const groupId of this.armedGroups) {
      if (!this.hasRunningCampaign(campaigns)) groupsToAdvance.add(groupId);
    }
    for (const groupId of groupsToAdvance) {
      if (this.armedGroups.has(groupId)) void this.requestAdvance(groupId);
    }
  }

  private hasRunningCampaign(campaigns: readonly DiscoveryCampaign[]): boolean {
    return campaigns.some((campaign) => campaign.status === "running");
  }

  private blockGroup(
    groupId: string,
    failedCampaignId: string | null,
    reason: string,
  ): void {
    this.updateGroup(groupId, (group) => ({
      ...group,
      blockedReason: reason || "Discovery cannot start another city yet.",
      cities: group.cities.map((city) => {
        if (failedCampaignId && city.campaignId === failedCampaignId) {
          return { ...city, reason: reason || city.reason };
        }
        if (city.campaignId) return city;
        return {
          ...city,
          state: "not_started",
          reason: reason || "Discovery cannot start another city yet.",
        };
      }),
    }));
    this.armedGroups.delete(groupId);
  }

  private requestAdvance(groupId: string): Promise<void> {
    const existing = this.advancing.get(groupId);
    if (existing) return existing;
    const advancing = Promise.resolve()
      .then(() => this.advance(groupId))
      .finally(() => this.advancing.delete(groupId));
    this.advancing.set(groupId, advancing);
    return advancing;
  }

  private async advance(groupId: string): Promise<void> {
    while (!this.disposed && this.armedGroups.has(groupId)) {
      const group = this.groups.find(
        (candidate) => candidate.groupId === groupId,
      );
      if (!group || group.blockedReason) return;
      const campaigns = this.campaigns();
      if (
        this.startInFlight ||
        this.hasRunningCampaign(campaigns) ||
        group.cities.some((city) => campaignIsActive(city, campaigns)) ||
        group.cities.some((city) => city.state === "starting")
      ) {
        return;
      }
      const city = group.cities.find(
        (candidate) => !candidate.campaignId && candidate.state === "waiting",
      );
      if (!city) {
        this.armedGroups.delete(groupId);
        this.notify();
        return;
      }

      this.updateGroup(groupId, (current) => ({
        ...current,
        cities: current.cities.map((candidate) =>
          candidate.cityId === city.cityId
            ? { ...candidate, state: "starting", reason: null }
            : candidate,
        ),
      }));
      this.startInFlight = true;
      try {
        const fresh = this.groups
          .find((candidate) => candidate.groupId === groupId)
          ?.cities.find((candidate) => candidate.cityId === city.cityId);
        const currentGroup = this.groups.find(
          (candidate) => candidate.groupId === groupId,
        );
        if (!fresh || !currentGroup) return;
        const campaign = await this.provider.start(
          campaignInputForGroupCity(currentGroup, fresh),
        );
        this.updateGroup(groupId, (current) => ({
          ...current,
          cities: current.cities.map((candidate) =>
            candidate.cityId === city.cityId
              ? {
                  ...candidate,
                  campaignId: campaign.id,
                  state: "waiting",
                  reason: null,
                }
              : candidate,
          ),
        }));
        this.rememberStatuses(this.campaigns());
        if (!TERMINAL_STATUSES.has(campaign.status)) return;
        if (
          campaign.status === "failed" &&
          isGlobalQueueFailure(campaign.failureReason)
        ) {
          this.blockGroup(groupId, campaign.id, campaign.failureReason ?? "");
          return;
        }
      } catch (error) {
        const reason =
          errorText(error) || "Discovery could not start this city.";
        if (isGlobalQueueFailure(error)) {
          this.blockGroup(groupId, null, reason);
          return;
        }
        this.updateGroup(groupId, (current) => ({
          ...current,
          cities: current.cities.map((candidate) =>
            candidate.cityId === city.cityId
              ? { ...candidate, state: "failed", reason }
              : candidate,
          ),
        }));
      } finally {
        this.startInFlight = false;
      }
    }
  }
}

export function createMultiCityDiscoveryCoordinator(
  options: MultiCityDiscoveryCoordinatorOptions,
): MultiCityDiscoveryCoordinator {
  return new MultiCityDiscoveryCoordinator(options);
}
