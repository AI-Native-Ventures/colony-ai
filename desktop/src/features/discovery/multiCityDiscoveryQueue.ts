import type {
  DiscoveryCampaign,
  DiscoveryCampaignProvider,
  DiscoveryRunStatus,
} from "./discoveryProvider";
import { isTransientSearchError } from "./discoverySearch";
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

/** A multi-city group may search this many cities at the same time. */
export const MAX_CITIES_AT_ONCE = 3;
/** One initial attempt and these three passing-error retries are allowed. */
export const START_RETRY_DELAYS_SECONDS = [5, 20, 60] as const;
export const START_RETRY_MESSAGE = "Could not reach the server.";

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
  /** Injectable so the retry policy is falsifiable without waiting 85 seconds. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
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

function errorCode(error: unknown): string | null {
  if (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    return (error as { code: string }).code.toLocaleLowerCase();
  }
  return null;
}

function errorStatus(error: unknown): number | null {
  if (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { status?: unknown }).status === "number"
  ) {
    return (error as { status: number }).status;
  }
  return null;
}

function abortError(): DOMException {
  return new DOMException("The search was stopped.", "AbortError");
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const timeout = globalThis.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      globalThis.clearTimeout(timeout);
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Returns true only for failures that can pass without a changed owner choice.
 * Permanent setup, credit, membership, and monthly-limit errors deliberately
 * remain visible instead of making paid search attempts over and over.
 */
export function isPassingStartError(error: unknown): boolean {
  const message = errorText(error).toLocaleLowerCase();
  const code = errorCode(error);
  const status = errorStatus(error);
  const permanent = [
    "not configured",
    "not set up",
    "no credits",
    "insufficient credits",
    "monthly",
    "signed out",
    "sign in",
    "sign-in",
    "not allowed",
    "membership",
    "sales channel",
    "relay_membership_required",
    "monthly_limit",
  ];
  if (
    permanent.some(
      (phrase) => message.includes(phrase) || code?.includes(phrase) === true,
    )
  ) {
    return false;
  }
  if (isTransientSearchError(error)) return true;
  if (status === 408 || status === 504 || (status !== null && status >= 500)) {
    return true;
  }
  return [
    "timed out",
    "timeout",
    "could not reach",
    "network",
    "connection",
    "failed to fetch",
    "fetch failed",
    "socket",
    "econn",
    "temporarily unavailable",
    "provider is busy",
    "provider unavailable",
  ].some((phrase) => message.includes(phrase));
}

/** Errors that mean no remaining city can safely begin until the owner fixes it. */
export function isGlobalQueueFailure(error: unknown): boolean {
  const message = errorText(error).toLocaleLowerCase();
  const code = errorCode(error) ?? "";
  return [
    "not configured",
    "not set up",
    "server is not",
    "no credits",
    "insufficient credits",
    "monthly",
    "signed out",
    "sign in",
    "sign-in",
    "sales channel",
    "sales is not allowed",
    "not allowed to use sales",
    "not allowed",
    "membership",
    "tenant community",
    "monthly_limit",
  ].some((phrase) => message.includes(phrase) || code.includes(phrase));
}

function campaignForCity(
  city: MultiCityGroupCity,
  campaigns: readonly DiscoveryCampaign[],
): DiscoveryCampaign | null {
  return city.campaignId
    ? (campaigns.find((campaign) => campaign.id === city.campaignId) ?? null)
    : null;
}

/**
 * Device-local group scheduler. The discovery provider remains responsible for
 * each campaign's durable state; this class owns only group ordering, bounded
 * passing-error retries, and automatic continuation choices.
 */
export class MultiCityDiscoveryCoordinator {
  private readonly provider: DiscoveryCampaignProvider;
  private readonly storage: MultiCityStorage | null;
  private readonly storageKey: string;
  private readonly nowSeconds: () => number;
  private readonly makeGroupId: () => string;
  private readonly makeCityId: () => string;
  private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  private readonly listeners = new Set<
    (snapshot: MultiCityDiscoverySnapshot) => void
  >();
  private readonly armedGroups = new Set<string>();
  private readonly advancing = new Map<string, Promise<void>>();
  private readonly advanceAgain = new Set<string>();
  private readonly startControllers = new Map<string, AbortController>();
  private readonly continuingCities = new Set<string>();
  private knownStatuses = new Map<string, DiscoveryRunStatus>();
  private groups: MultiCityCampaignGroup[];
  private disposed = false;
  private unsubscribeProvider: (() => void) | null = null;

  constructor(options: MultiCityDiscoveryCoordinatorOptions) {
    this.provider = options.provider;
    this.storage = options.storage;
    this.storageKey = options.storageKey;
    this.nowSeconds =
      options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
    this.makeGroupId = options.groupId ?? (() => newId("group"));
    this.makeCityId = options.cityId ?? (() => newId("city"));
    this.sleep = options.sleep ?? defaultSleep;
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
    this.advanceAgain.clear();
    for (const controller of this.startControllers.values()) controller.abort();
    this.startControllers.clear();
    this.continuingCities.clear();
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

  /** Retries every failed city, with the normal three-slot scheduler. */
  async retryGroup(groupId: string): Promise<void> {
    const updated = this.updateGroup(groupId, (group) => ({
      ...group,
      blockedReason: null,
      cities: group.cities.map((city) => {
        const campaign = campaignForCity(city, this.campaigns());
        if (campaign?.status === "failed") {
          return {
            ...city,
            state: "starting",
            reason: null,
            retryRequested: true,
          };
        }
        if (!city.campaignId && ["not_started", "failed"].includes(city.state)) {
          return {
            ...city,
            state: "waiting",
            reason: null,
            retryRequested: false,
          };
        }
        return city;
      }),
    }));
    if (!updated) return;
    this.armedGroups.add(groupId);
    await this.requestAdvance(groupId);
  }

  /** Alias used by the owner-facing "Try again all failed" control. */
  retryFailedCities(groupId: string): Promise<void> {
    return this.retryGroup(groupId);
  }

  async retryCity(groupId: string, cityId: string): Promise<void> {
    const group = this.groups.find((candidate) => candidate.groupId === groupId);
    const city = group?.cities.find((candidate) => candidate.cityId === cityId);
    if (!group || !city) return;
    const campaign = campaignForCity(city, this.campaigns());
    if (campaign?.status === "failed") {
      this.updateGroup(groupId, (current) => ({
        ...current,
        blockedReason: null,
        cities: current.cities.map((candidate) =>
          candidate.cityId === cityId
            ? {
                ...candidate,
                state: "starting",
                reason: null,
                retryRequested: true,
              }
            : candidate,
        ),
      }));
    } else if (!city.campaignId && city.state === "failed") {
      this.updateGroup(groupId, (current) => ({
        ...current,
        blockedReason: null,
        cities: current.cities.map((candidate) =>
          candidate.cityId === cityId
            ? {
                ...candidate,
                state: "waiting",
                reason: null,
                retryRequested: false,
              }
            : candidate,
        ),
      }));
    } else {
      return;
    }
    this.armedGroups.add(groupId);
    await this.requestAdvance(groupId);
  }

  /** Cancels an unstarted retry without allowing its waiting work to restart. */
  async cancelCity(groupId: string, cityId: string): Promise<void> {
    const key = this.cityKey(groupId, cityId);
    const controller = this.startControllers.get(key);
    if (controller) {
      controller.abort();
      this.updateGroup(groupId, (group) => ({
        ...group,
        cities: group.cities.map((city) =>
          city.cityId === cityId
            ? {
                ...city,
                state: "not_started",
                reason: null,
                retryRequested: false,
              }
            : city,
        ),
      }));
      return;
    }
    const city = this.groups
      .find((group) => group.groupId === groupId)
      ?.cities.find((candidate) => candidate.cityId === cityId);
    if (city?.campaignId) await this.performAction(city.campaignId, "cancel");
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
    // Pausing consumes this city's slot but must not disarm the rest of its
    // group. A later completion can still fill a genuinely free slot, while
    // the pause itself starts nothing because it is not terminal.
    if (group) this.armedGroups.add(group.groupId);
    await this.provider[action]();
    this.onProviderChanged();
    // A restored group is intentionally idle until the owner resumes or
    // retries one city. That action must immediately reconcile every free
    // group slot, without treating a pause as permission to spend again.
    if (group && action !== "pause" && this.armedGroups.has(group.groupId)) {
      await this.requestAdvance(group.groupId);
    }
  }

  private campaigns(): DiscoveryCampaign[] {
    return this.provider.getCampaigns();
  }

  private cityKey(groupId: string, cityId: string): string {
    return `${groupId}:${cityId}`;
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
          return {
            ...city,
            campaignId: matching.id,
            state: "waiting",
            retryRequested: false,
          };
        }
        // No durable campaign exists, so an app restart must never issue a
        // paid retry by itself. The owner can choose Try again.
        return { ...city, state: "not_started", retryRequested: false };
      }),
    }));
    if (changed) writeMultiCityState(this.storage, this.storageKey, this.groups);
  }

  private onProviderChanged(): void {
    if (this.disposed) return;
    const campaigns = this.campaigns();
    const groupsToAdvance = new Set<string>();

    for (const group of this.groups) {
      for (const city of group.cities) {
        const campaign = campaignForCity(city, campaigns);
        if (!campaign) continue;
        const previous = this.knownStatuses.get(campaign.id);

        if (
          city.state === "starting" &&
          city.retryRequested &&
          campaign.status === "running"
        ) {
          this.updateGroup(group.groupId, (current) => ({
            ...current,
            cities: current.cities.map((candidate) =>
              candidate.cityId === city.cityId
                ? {
                    ...candidate,
                    state: "waiting",
                    reason: null,
                    retryRequested: false,
                  }
                : candidate,
            ),
          }));
        }
        if (city.state === "continuing" && campaign.status === "running") {
          this.updateGroup(group.groupId, (current) => ({
            ...current,
            cities: current.cities.map((candidate) =>
              candidate.cityId === city.cityId
                ? { ...candidate, state: "waiting", reason: null }
                : candidate,
            ),
          }));
        }

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
          continue;
        }
        if (
          campaign.status === "complete" &&
          this.tryAutomaticContinuation(group, city, campaign)
        ) {
          continue;
        }
        if (TERMINAL_STATUSES.has(campaign.status)) {
          groupsToAdvance.add(group.groupId);
        }
      }
    }
    // A synchronous provider stand-in can publish a continuation while this
    // callback is still handling the completed snapshot. Read again so the
    // nested update cannot restore an old status fence.
    this.rememberStatuses(this.campaigns());
    this.notify();
    for (const groupId of groupsToAdvance) {
      if (this.armedGroups.has(groupId)) void this.requestAdvance(groupId);
    }
  }

  private tryAutomaticContinuation(
    group: MultiCityCampaignGroup,
    city: MultiCityGroupCity,
    campaign: DiscoveryCampaign,
  ): boolean {
    const attempts = city.automaticContinuations ?? 0;
    if (
      !this.armedGroups.has(group.groupId) ||
      campaign.endReason !== "approved_budget" ||
      campaign.count >= campaign.target ||
      attempts >= 3
    ) {
      return false;
    }
    const continuation = this.provider.getContinuationFor(campaign.id);
    if (!continuation || continuation.state !== "ready") return false;
    const key = this.cityKey(group.groupId, city.cityId);
    if (this.continuingCities.has(key)) return true;
    this.continuingCities.add(key);
    this.updateGroup(group.groupId, (current) => ({
      ...current,
      cities: current.cities.map((candidate) =>
        candidate.cityId === city.cityId
          ? {
              ...candidate,
              state: "continuing",
              reason: null,
              automaticContinuations: attempts + 1,
            }
          : candidate,
      ),
    }));
    void this.continueCity(group.groupId, city.cityId, campaign.id, key);
    return true;
  }

  private async continueCity(
    groupId: string,
    cityId: string,
    campaignId: string,
    key: string,
  ): Promise<void> {
    try {
      await this.provider.continueCampaignFor(campaignId);
    } catch {
      // An unavailable continuation is a truthful completed city, not a
      // failure. Its existing end note remains visible.
      this.updateGroup(groupId, (group) => ({
        ...group,
        cities: group.cities.map((city) =>
          city.cityId === cityId ? { ...city, state: "waiting" } : city,
        ),
      }));
    } finally {
      this.continuingCities.delete(key);
      this.onProviderChanged();
      if (this.armedGroups.has(groupId)) void this.requestAdvance(groupId);
    }
  }

  private occupiedSlots(
    group: MultiCityCampaignGroup,
    campaigns: readonly DiscoveryCampaign[],
  ): number {
    return group.cities.filter((city) => {
      if (this.startControllers.has(this.cityKey(group.groupId, city.cityId))) {
        return true;
      }
      const campaign = campaignForCity(city, campaigns);
      // A failed campaign marked for retry is waiting for a slot, not holding
      // one. Once `startCity` owns it, the controller above reserves the slot.
      if (
        city.state === "starting" &&
        city.retryRequested &&
        campaign?.status === "failed"
      ) {
        return false;
      }
      if (city.state === "starting" || city.state === "continuing") return true;
      // A paused city deliberately keeps its slot. Pausing must never buy a
      // different city's first page just because this one stopped.
      return campaign?.status === "running" || campaign?.status === "paused";
    }).length;
  }

  private nextCities(
    group: MultiCityCampaignGroup,
    campaigns: readonly DiscoveryCampaign[],
  ): MultiCityGroupCity[] {
    return group.cities.filter((city) => {
      if (this.startControllers.has(this.cityKey(group.groupId, city.cityId))) {
        return false;
      }
      const campaign = campaignForCity(city, campaigns);
      if (!campaign) return city.state === "waiting";
      return (
        campaign.status === "failed" &&
        city.state === "starting" &&
        city.retryRequested === true
      );
    });
  }

  private blockGroup(
    groupId: string,
    failedCampaignId: string | null,
    reason: string,
  ): void {
    const group = this.groups.find((candidate) => candidate.groupId === groupId);
    if (!group) return;
    this.armedGroups.delete(groupId);
    for (const city of group.cities) {
      if (!city.campaignId) {
        this.startControllers.get(this.cityKey(groupId, city.cityId))?.abort();
      }
    }
    this.updateGroup(groupId, (current) => ({
      ...current,
      blockedReason: reason || "Discovery cannot start another city yet.",
      cities: current.cities.map((city) => {
        if (failedCampaignId && city.campaignId === failedCampaignId) {
          return { ...city, reason: reason || city.reason };
        }
        if (city.campaignId) return city;
        return {
          ...city,
          state: "not_started",
          reason: reason || "Discovery cannot start another city yet.",
          retryRequested: false,
        };
      }),
    }));
  }

  private requestAdvance(groupId: string): Promise<void> {
    const existing = this.advancing.get(groupId);
    if (existing) {
      // A provider can publish while the first advancement is completing.
      // Remember that edge so a retry or replacement never gets stranded.
      this.advanceAgain.add(groupId);
      return existing;
    }
    const advancing = Promise.resolve()
      .then(() => this.advance(groupId))
      .finally(() => {
        this.advancing.delete(groupId);
        if (this.advanceAgain.delete(groupId) && !this.disposed) {
          void this.requestAdvance(groupId);
        }
      });
    this.advancing.set(groupId, advancing);
    return advancing;
  }

  private async advance(groupId: string): Promise<void> {
    if (this.disposed || !this.armedGroups.has(groupId)) return;
    const group = this.groups.find((candidate) => candidate.groupId === groupId);
    if (!group || group.blockedReason) return;
    const campaigns = this.campaigns();
    const available = MAX_CITIES_AT_ONCE - this.occupiedSlots(group, campaigns);
    if (available <= 0) return;
    const cities = this.nextCities(group, campaigns).slice(0, available);
    if (cities.length === 0) return;

    for (const city of cities) {
      const campaign = campaignForCity(city, campaigns);
      if (!campaign) {
        this.updateGroup(groupId, (current) => ({
          ...current,
          cities: current.cities.map((candidate) =>
            candidate.cityId === city.cityId
              ? {
                  ...candidate,
                  state: "starting",
                  reason: null,
                  retryRequested: false,
                }
              : candidate,
          ),
        }));
      }
      void this.startCity(groupId, city.cityId, Boolean(campaign));
    }
  }

  private async startCity(
    groupId: string,
    cityId: string,
    retryCampaign: boolean,
  ): Promise<void> {
    const key = this.cityKey(groupId, cityId);
    if (this.startControllers.has(key) || this.disposed) return;
    const controller = new AbortController();
    this.startControllers.set(key, controller);
    try {
      if (retryCampaign) {
        await this.retryExistingCampaign(groupId, cityId, controller.signal);
      } else {
        await this.startNewCampaign(groupId, cityId, controller.signal);
      }
    } finally {
      if (this.startControllers.get(key) === controller) {
        this.startControllers.delete(key);
      }
      if (!this.disposed && this.armedGroups.has(groupId)) {
        void this.requestAdvance(groupId);
      }
    }
  }

  private async retryExistingCampaign(
    groupId: string,
    cityId: string,
    signal: AbortSignal,
  ): Promise<void> {
    const city = this.groups
      .find((group) => group.groupId === groupId)
      ?.cities.find((candidate) => candidate.cityId === cityId);
    if (!city?.campaignId || signal.aborted) return;
    try {
      await this.provider.retryCampaign(city.campaignId);
      this.updateGroup(groupId, (group) => ({
        ...group,
        cities: group.cities.map((candidate) =>
          candidate.cityId === cityId
            ? {
                ...candidate,
                state: "waiting",
                reason: null,
                retryRequested: false,
              }
            : candidate,
        ),
      }));
    } catch (error) {
      if (signal.aborted || isAbortError(error)) return;
      this.updateGroup(groupId, (group) => ({
        ...group,
        cities: group.cities.map((candidate) =>
          candidate.cityId === cityId
            ? {
                ...candidate,
                state: "failed",
                reason: errorText(error) || "Discovery could not restart this city.",
                retryRequested: false,
              }
            : candidate,
        ),
      }));
    }
  }

  private async startNewCampaign(
    groupId: string,
    cityId: string,
    signal: AbortSignal,
  ): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      if (signal.aborted || this.disposed) return;
      const group = this.groups.find((candidate) => candidate.groupId === groupId);
      const city = group?.cities.find((candidate) => candidate.cityId === cityId);
      if (!group || !city || city.campaignId || group.blockedReason) return;
      try {
        const campaign = await this.provider.start(
          campaignInputForGroupCity(group, city),
        );
        if (this.disposed) return;
        // A simultaneous global setup failure may abort this city's retry
        // after its probe returned. Record the created campaign before
        // stopping so it stays visible and is never started a second time.
        if (signal.aborted) {
          this.updateGroup(groupId, (current) => ({
            ...current,
            cities: current.cities.map((candidate) =>
              candidate.cityId === cityId && !candidate.campaignId
                ? {
                    ...candidate,
                    campaignId: campaign.id,
                    state: "waiting",
                    reason: null,
                    retryRequested: false,
                  }
                : candidate,
            ),
          }));
          this.rememberStatuses(this.campaigns());
          return;
        }
        this.updateGroup(groupId, (current) => ({
          ...current,
          cities: current.cities.map((candidate) =>
            candidate.cityId === cityId
              ? {
                  ...candidate,
                  campaignId: campaign.id,
                  state: "waiting",
                  reason: null,
                  retryRequested: false,
                }
              : candidate,
          ),
        }));
        this.rememberStatuses(this.campaigns());
        if (
          campaign.status === "failed" &&
          isGlobalQueueFailure(campaign.failureReason)
        ) {
          this.blockGroup(groupId, campaign.id, campaign.failureReason ?? "");
        }
        return;
      } catch (error) {
        if (signal.aborted || isAbortError(error) || this.disposed) return;
        const reason = errorText(error) || "Discovery could not start this city.";
        if (isGlobalQueueFailure(error)) {
          this.blockGroup(groupId, null, reason);
          return;
        }
        const delay = START_RETRY_DELAYS_SECONDS[attempt];
        if (delay !== undefined && isPassingStartError(error)) {
          this.updateGroup(groupId, (current) => ({
            ...current,
            cities: current.cities.map((candidate) =>
              candidate.cityId === cityId
                ? {
                    ...candidate,
                    state: "starting",
                    reason: `${START_RETRY_MESSAGE} Trying again in ${delay} s.`,
                  }
                : candidate,
            ),
          }));
          try {
            await this.sleep(delay * 1_000, signal);
            continue;
          } catch (sleepError) {
            if (signal.aborted || isAbortError(sleepError)) return;
            throw sleepError;
          }
        }
        this.updateGroup(groupId, (current) => ({
          ...current,
          cities: current.cities.map((candidate) =>
            candidate.cityId === cityId
              ? {
                  ...candidate,
                  state: "failed",
                  reason,
                  retryRequested: false,
                }
              : candidate,
          ),
        }));
        return;
      }
    }
  }
}

export function createMultiCityDiscoveryCoordinator(
  options: MultiCityDiscoveryCoordinatorOptions,
): MultiCityDiscoveryCoordinator {
  return new MultiCityDiscoveryCoordinator(options);
}
