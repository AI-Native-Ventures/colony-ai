import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  extractQualificationSignals,
  isNonSiteWebsiteUrl,
  QUALIFY_SIGNALS,
  qualificationFollowupLinks,
} from "./extractors.mjs";
import {
  QualifyFetchError,
  fetchQualifyPage,
  robotsAllows,
} from "./ssrf-fetcher.mjs";

export const MAX_QUALIFY_BUSINESSES = 300;
export const MAX_QUALIFY_CONCURRENCY = 4;
export const MAX_QUALIFY_PAGES = 5;
export const MAX_QUALIFY_BUSINESS_MS = 25_000;
export const QUALIFY_FRESHNESS_SECONDS = 30 * 24 * 60 * 60;

const UUID_PATTERN =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nowSeconds(clock) {
  return Math.floor(clock() / 1_000);
}

function freshHead(head, now) {
  const checkedAt = head?.record?.checkedAt ?? head?.checkedAt;
  return (
    Number.isSafeInteger(checkedAt) &&
    checkedAt <= now &&
    now - checkedAt <= QUALIFY_FRESHNESS_SECONDS
  );
}

function timeoutSignal(parent, timeoutMs) {
  const controller = new AbortController();
  const stop = () => controller.abort(parent.reason ?? new Error("cancelled"));
  if (parent.aborted) stop();
  else parent.addEventListener("abort", stop, { once: true });
  const timer = setTimeout(
    () => controller.abort(new QualifyFetchError("business_timeout")),
    timeoutMs,
  );
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      parent.removeEventListener("abort", stop);
    },
  };
}

function outcomeFromError(error) {
  if (error instanceof QualifyFetchError) {
    if (error.code === "cancelled") throw error;
    return { kind: "failed", reason: error.code };
  }
  return { kind: "failed", reason: "request_failed" };
}

function requireRunInput(input) {
  if (
    !Array.isArray(input?.selectedSignals) ||
    input.selectedSignals.length === 0
  ) {
    throw new Error(
      "Select at least one qualification signal before starting a run.",
    );
  }
  if (
    input.selectedSignals.some((signal) => !QUALIFY_SIGNALS.includes(signal))
  ) {
    throw new Error("A qualification run contains an unknown signal.");
  }
  if (!Array.isArray(input?.leads))
    throw new Error("A qualification run needs leads.");
  if (
    input.leads.some(
      (lead) =>
        !lead ||
        typeof lead !== "object" ||
        typeof lead.leadId !== "string" ||
        !UUID_PATTERN.test(lead.leadId),
    )
  ) {
    throw new Error("Every qualification lead needs a UUID.");
  }
}

function runProgress(run) {
  const complete = run.items.filter(
    (item) => item.phase === "completed" || item.phase === "skipped_fresh",
  ).length;
  return {
    runId: run.runId,
    status: run.status,
    total: run.items.length,
    complete,
    checked: run.items.filter((item) => item.phase === "completed").length,
    skippedFresh: run.items.filter((item) => item.phase === "skipped_fresh")
      .length,
    pending: run.items.filter(
      (item) => item.phase === "pending" || item.phase === "ready_to_publish",
    ).length,
    failed: run.items.filter((item) => item.lastError).length,
  };
}

/** Create a JSON run store at an explicit app-owned path. */
export function createJsonRunStore({ filePath, filesystem = fs }) {
  return {
    async read(runId) {
      try {
        const raw = await filesystem.readFile(filePath, "utf8");
        const data = JSON.parse(raw);
        const run = data?.runs?.[runId];
        return run ? clone(run) : null;
      } catch (error) {
        if (error?.code === "ENOENT") return null;
        throw error;
      }
    },
    async write(run) {
      const existing = await this.readAll();
      const data = {
        schemaVersion: 1,
        runs: { ...existing, [run.runId]: clone(run) },
      };
      const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
      await filesystem.mkdir(path.dirname(filePath), { recursive: true });
      await filesystem.writeFile(temporary, JSON.stringify(data), {
        mode: 0o600,
      });
      await filesystem.rename(temporary, filePath);
    },
    async readAll() {
      try {
        const raw = await filesystem.readFile(filePath, "utf8");
        const data = JSON.parse(raw);
        return data?.schemaVersion === 1 &&
          data.runs &&
          typeof data.runs === "object"
          ? data.runs
          : {};
      } catch (error) {
        if (error?.code === "ENOENT") return {};
        throw error;
      }
    },
  };
}

/**
 * Create the bounded qualification scheduler. Dependencies are injected so all
 * network and persistence tests run without Electron, a real home, or live sites.
 */
export function createQualifyRunController(dependencies) {
  const {
    store,
    loadHead,
    publish,
    fetchPage = fetchQualifyPage,
    extract = extractQualificationSignals,
    followupLinks = qualificationFollowupLinks,
    robots = robotsAllows,
    isNonSiteUrl = isNonSiteWebsiteUrl,
    clock = Date.now,
    makeRunId = crypto.randomUUID,
    onProgress = () => {},
    businessTimeoutMs = MAX_QUALIFY_BUSINESS_MS,
  } = dependencies;
  if (!store || !loadHead || !publish) {
    throw new Error(
      "Qualification controller needs storage, head loading, and publishing.",
    );
  }
  const active = new Map();
  const persistence = new Map();

  async function persist(run) {
    const previous = persistence.get(run.runId) ?? Promise.resolve();
    const snapshot = clone(run);
    const next = previous.catch(() => {}).then(() => store.write(snapshot));
    persistence.set(run.runId, next);
    await next;
  }

  async function emit(run) {
    await persist(run);
    onProgress(runProgress(run));
  }

  async function fetchPagesForLead(item, run, signal) {
    const website =
      typeof item.lead.website === "string" ? item.lead.website.trim() : "";
    const observedAt = nowSeconds(clock);
    if (!website || isNonSiteUrl(website)) {
      return extract({
        selectedSignals: run.selectedSignals,
        maps: item.lead,
        pages: [],
        outcome: { kind: "success" },
        observedAt,
      });
    }
    const budget = timeoutSignal(signal, businessTimeoutMs);
    try {
      let robotsPage;
      try {
        const robotsUrl = new URL("/robots.txt", website).toString();
        robotsPage = await fetchPage(robotsUrl, {
          signal: budget.signal,
          allowNotFound: true,
        });
      } catch (error) {
        return extract({
          selectedSignals: run.selectedSignals,
          maps: item.lead,
          pages: [],
          outcome: { kind: "blocked", reason: outcomeFromError(error).reason },
          observedAt,
        });
      }
      const homepageUrl = new URL(website);
      if (!robots(robotsPage.text, homepageUrl.pathname || "/")) {
        return extract({
          selectedSignals: run.selectedSignals,
          maps: item.lead,
          pages: [],
          outcome: { kind: "blocked", reason: "blocked_by_site" },
          observedAt,
        });
      }
      let homepage;
      try {
        homepage = await fetchPage(website, { signal: budget.signal });
      } catch (error) {
        const first = outcomeFromError(error);
        if (homepageUrl.protocol !== "https:" || first.reason !== "site_down") {
          return extract({
            selectedSignals: run.selectedSignals,
            maps: item.lead,
            pages: [],
            outcome: first,
            observedAt,
          });
        }
        try {
          const fallback = new URL(website);
          fallback.protocol = "http:";
          homepage = await fetchPage(fallback.toString(), {
            signal: budget.signal,
          });
          homepage = { ...homepage, downgradedFromHttps: true };
        } catch (fallbackError) {
          return extract({
            selectedSignals: run.selectedSignals,
            maps: item.lead,
            pages: [],
            outcome: outcomeFromError(fallbackError),
            observedAt,
          });
        }
      }
      const pages = [{ url: homepage.url, html: homepage.text }];
      for (const link of followupLinks(pages[0], MAX_QUALIFY_PAGES - 1)) {
        if (signal.aborted) throw new QualifyFetchError("cancelled");
        const followupPath = new URL(link).pathname || "/";
        if (!robots(robotsPage.text, followupPath)) continue;
        try {
          const fetched = await fetchPage(link, { signal: budget.signal });
          pages.push({ url: fetched.url, html: fetched.text });
        } catch (error) {
          return extract({
            selectedSignals: run.selectedSignals,
            maps: item.lead,
            pages: [],
            outcome: outcomeFromError(error),
            observedAt,
          });
        }
      }
      return extract({
        selectedSignals: run.selectedSignals,
        maps: item.lead,
        pages,
        outcome: { kind: "success" },
        finalProtocol: homepage.finalProtocol,
        downgradedFromHttps: homepage.downgradedFromHttps,
        observedAt,
      });
    } finally {
      budget.dispose();
    }
  }

  async function prepareItem(item, run, signal) {
    const head = await loadHead(item.lead.leadId);
    if (!run.refresh && freshHead(head, nowSeconds(clock))) {
      item.phase = "skipped_fresh";
      item.lastError = null;
      await emit(run);
      return;
    }
    const extraction = await fetchPagesForLead(item, run, signal);
    item.action = {
      leadId: item.lead.leadId,
      runId: run.runId,
      expectedHeadEventId: head?.eventId,
      checkedSignals: extraction.checkedSignals,
      observations: extraction.observations.map((observation) => ({
        ...observation,
        runId: run.runId,
        notCheckedReason: observation.notCheckedReason ?? null,
      })),
    };
    item.phase = "ready_to_publish";
    item.lastError = null;
    await emit(run);
  }

  async function publishItem(item, run) {
    await publish(item.action);
    item.action = null;
    item.phase = "completed";
    item.lastError = null;
    await emit(run);
  }

  async function workItem(item, run, signal) {
    if (signal.aborted) return;
    try {
      if (item.phase === "pending") await prepareItem(item, run, signal);
      if (!signal.aborted && item.phase === "ready_to_publish")
        await publishItem(item, run);
    } catch (error) {
      if (
        signal.aborted ||
        (error instanceof QualifyFetchError && error.code === "cancelled")
      ) {
        return;
      }
      item.lastError =
        error instanceof Error ? error.message : "Qualification failed";
      await emit(run);
    }
  }

  async function drive(run) {
    const controller = new AbortController();
    active.set(run.runId, controller);
    run.status = "running";
    await emit(run);
    const work = run.items.filter(
      (item) => item.phase === "pending" || item.phase === "ready_to_publish",
    );
    let cursor = 0;
    const worker = async () => {
      while (!controller.signal.aborted) {
        const item = work[cursor];
        cursor += 1;
        if (!item) return;
        await workItem(item, run, controller.signal);
      }
    };
    try {
      await Promise.all(
        Array.from(
          { length: Math.min(MAX_QUALIFY_CONCURRENCY, work.length) },
          () => worker(),
        ),
      );
      run.status = controller.signal.aborted
        ? "cancelled"
        : run.items.some(
              (item) =>
                item.phase === "pending" || item.phase === "ready_to_publish",
            )
          ? "paused"
          : "completed";
      await emit(run);
      return clone(run);
    } finally {
      active.delete(run.runId);
      await (persistence.get(run.runId) ?? Promise.resolve());
    }
  }

  return {
    async start(input) {
      requireRunInput(input);
      const leads = input.leads.slice(0, MAX_QUALIFY_BUSINESSES);
      const runId = input.runId ?? makeRunId();
      if (typeof runId !== "string" || !UUID_PATTERN.test(runId)) {
        throw new Error("A qualification run needs a UUID.");
      }
      if (active.has(runId) || (await store.read(runId))) {
        throw new Error("A qualification run with this id already exists.");
      }
      const run = {
        schemaVersion: 1,
        runId,
        selectedSignals: [...new Set(input.selectedSignals)],
        refresh: input.refresh === true,
        status: "pending",
        startedAt: nowSeconds(clock),
        items: leads.map((lead) => ({
          lead: clone(lead),
          phase: "pending",
          action: null,
          lastError: null,
        })),
      };
      await persist(run);
      return drive(run);
    },
    async resume(runId) {
      const run = await store.read(runId);
      if (!run) throw new Error("Qualification run was not found.");
      if (active.has(runId))
        throw new Error("Qualification run is already active.");
      for (const item of run.items) {
        if (item.phase === "ready_to_publish" || item.phase === "pending")
          item.lastError = null;
      }
      return drive(run);
    },
    cancel(runId) {
      const controller = active.get(runId);
      if (!controller) return false;
      controller.abort(new QualifyFetchError("cancelled"));
      return true;
    },
    async snapshot(runId) {
      const run = await store.read(runId);
      return run ? runProgress(run) : null;
    },
  };
}
