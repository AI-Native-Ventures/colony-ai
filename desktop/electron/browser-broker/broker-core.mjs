import { randomUUID } from "node:crypto";
import { createActionLog, summarizeToolArgs } from "./action-log.mjs";
import { classifyAction, confirmationSummary } from "./classifier.mjs";
import {
  redactUrl,
  sanitizeBlock,
  sanitizeUntrusted,
  wrapUntrusted,
} from "./redaction.mjs";
import { DRIVER_ERROR_CODES, isDriverError } from "./driver-errors.mjs";
import { buildSnapshot, createRefRegistry } from "./snapshot.mjs";
import {
  DEFAULT_WAIT_MS,
  MAX_WAIT_MS,
  isToolName,
  toolDescriptors,
  validateToolInput,
} from "./tool-definitions.mjs";
import { guardNavigation, checkUrl, originOf } from "./url-policy.mjs";

/**
 * Broker core: the only place agent tool calls are executed. It is pure with
 * respect to the browser: everything that touches a page goes through the
 * injected `driver`, so the whole gating order is unit tested with a fake.
 *
 * Gating order for every call
 *   1. authenticate the capability token (grant active, not expired)
 *   2. validate the arguments strictly
 *   3. serialize per grant (bounded queue)
 *   4. resolve the tab (bound to the grant, same business, not human owned)
 *   5. the page origin must be approved (the agent never reads other pages)
 *   6. element actions: resolve the ref, describe the element, classify,
 *      deny or park for the person's confirmation, then re-verify the element
 *   7. fence check immediately before the driver acts and again before the
 *      result is returned (a revoke mid task discards the result)
 *
 * Page derived text is wrapped as untrusted data. Nothing here reads page
 * text to decide anything.
 */

export class BrokerError extends Error {
  constructor(code, message, extra = {}) {
    super(message ?? MESSAGES[code] ?? code);
    this.name = "BrokerError";
    this.code = code;
    this.extra = extra;
  }
}

const MESSAGES = {
  no_grant: "No browser access has been granted for this task.",
  grant_expired: "The browser grant has expired.",
  grant_revoked: "The browser grant was revoked or taken over by the person.",
  fenced: "The action was cancelled because access changed.",
  origin_denied: "That site is not allowed.",
  origin_approval_required: "The person must approve this site first.",
  private_network_denied:
    "Local and private network addresses are not allowed.",
  scheme_denied: "Only http and https pages are allowed.",
  confirmation_required:
    "The person must confirm this action but cannot be asked right now.",
  confirmation_denied: "The person did not confirm the action.",
  stale_ref: "That element reference is out of date. Take a new snapshot.",
  not_found: "No such tab for this task.",
  credential_field: "The person enters credentials and payment details.",
  secret_in_text: "Text that looks like a secret cannot be typed into a page.",
  use_upload_tool: "File choosers open through browser_upload.",
  timeout: "The page did not respond in time.",
  tab_limit: "Too many tabs for this task.",
  invalid_input: "Invalid input.",
  busy: "Another browser action is still running for this task.",
  too_large: "The result was too large.",
  driver_error: "The browser could not complete the action.",
  dns_failed: "The site could not be resolved.",
};

const ENDING_EVENTS = new Set(["revoked", "expired", "taken-over"]);
const FENCE_CODES = new Set([
  "fenced",
  "grant_revoked",
  "grant_expired",
  "no_grant",
]);
const DENIED_CODES = new Set([
  "credential_field",
  "secret_in_text",
  "use_upload_tool",
  "scheme_denied",
  "private_network_denied",
  "origin_denied",
  "origin_approval_required",
  "confirmation_required",
]);

const fail = (code, message, extra = {}) => ({
  ok: false,
  code,
  message: message ?? MESSAGES[code] ?? "Browser action failed.",
  ...extra,
});

const approvedAboutBlank = (url) => url === "about:blank" || url === "";

function describeHash(described) {
  const element = described?.element ?? {};
  return JSON.stringify([
    element.role,
    element.name,
    element.inputType,
    element.buttonType,
    element.href,
    described?.form?.action,
    described?.form?.fields?.length,
  ]);
}

export function createBroker({
  capabilities,
  driver,
  log = createActionLog(),
  resolver,
  now = Date.now,
  confirmationTimeoutMs = 120_000,
  maxQueue = 4,
  maxScreenshotBytes = 2 * 1024 * 1024,
  maxActionMs = 60_000,
} = {}) {
  const registries = new Map();
  const documentIds = new Map();
  const controllers = new Map();
  const queues = new Map();
  const pending = new Map();
  const openedTabs = new Map();
  const uploads = new Map();
  const listeners = new Set();
  const approvalNotices = new Map();

  function emit(type, payload = {}) {
    for (const listener of [...listeners]) {
      try {
        listener({ type, ...payload });
      } catch {
        // An observer must never break a tool call.
      }
    }
  }

  function registryFor(tabId) {
    let registry = registries.get(tabId);
    if (!registry) {
      registry = createRefRegistry();
      registries.set(tabId, registry);
    }
    return registry;
  }

  function record(grant, tool, args, status, started, extra = {}) {
    const entry = log.append({
      grantId: grant?.id,
      agentId: grant?.agentId,
      taskId: grant?.taskId,
      businessId: grant?.businessId,
      tabId: typeof args?.tab === "string" ? args.tab : undefined,
      tool,
      status,
      durationMs: now() - started,
      args: summarizeToolArgs(tool, args),
      ...extra,
    });
    emit("agent-action", { entry });
    return entry;
  }

  function noticeOrigin(grant, tabId, origin, url) {
    const key = `${grant.id}|${tabId}|${origin}`;
    const last = approvalNotices.get(key) ?? 0;
    if (now() - last < 5_000) return;
    approvalNotices.set(key, now());
    if (approvalNotices.size > 200) approvalNotices.clear();
    emit("origin-approval-requested", {
      grantId: grant.id,
      tabId,
      origin,
      url: redactUrl(url),
    });
  }

  // ---- grant lifecycle -------------------------------------------------

  function endGrant(event) {
    const grant = capabilities.getGrant(event.grantId);
    for (const controller of controllers.get(event.grantId) ?? [])
      controller.abort();
    for (const [actionId, entry] of pending) {
      if (entry.grantId === event.grantId) settle(actionId, "fenced");
    }
    for (const [uploadId, upload] of uploads) {
      if (upload.grantId === event.grantId) uploads.delete(uploadId);
    }
    for (const tabId of grant?.tabIds ?? []) {
      void Promise.resolve(driver.stopTab?.(tabId)).catch(() => undefined);
      void Promise.resolve(driver.setControl?.(tabId, "human")).catch(
        () => undefined,
      );
    }
    for (const tabId of grant?.tabIds ?? []) {
      // Element references never outlive the grant that created them.
      registries.delete(tabId);
      documentIds.delete(tabId);
    }
    openedTabs.delete(event.grantId);
    queues.delete(event.grantId);
    emit("grant-changed", {
      grantId: event.grantId,
      state: event.state,
      reason: event.reason,
    });
  }

  capabilities.onChange((event) => {
    if (ENDING_EVENTS.has(event.type)) endGrant(event);
    else
      emit("grant-changed", {
        grantId: event.grantId,
        state: event.state,
        change: event.type,
      });
  });

  // ---- confirmation parking ---------------------------------------------

  function settle(actionId, outcome) {
    const entry = pending.get(actionId);
    if (!entry) return false;
    pending.delete(actionId);
    clearTimeout(entry.timer);
    entry.resolve(outcome);
    emit("confirmation-resolved", {
      actionId,
      grantId: entry.grantId,
      outcome,
    });
    return true;
  }

  async function requestConfirmation(ctx, { tabId, summary, result }) {
    if (listeners.size === 0) throw new BrokerError("confirmation_required");
    const actionId = randomUUID();
    const outcome = await new Promise((resolve) => {
      const timer = setTimeout(
        () => settle(actionId, "timeout"),
        confirmationTimeoutMs,
      );
      timer.unref?.();
      pending.set(actionId, {
        grantId: ctx.grant.id,
        tabId,
        resolve,
        timer,
        summary,
      });
      void Promise.resolve(
        driver.setControl?.(tabId, "agent-awaiting-confirmation"),
      ).catch(() => undefined);
      emit("confirmation-requested", {
        actionId,
        grantId: ctx.grant.id,
        tabId,
        summary,
        category: result.category,
        reasons: result.reasons.map((reason) => reason.code),
        expiresAt: now() + confirmationTimeoutMs,
      });
      ctx.signal.addEventListener("abort", () => settle(actionId, "fenced"), {
        once: true,
      });
    });
    if (capabilities.getGrant(ctx.grant.id)?.state === "active")
      void Promise.resolve(driver.setControl?.(tabId, "agent")).catch(
        () => undefined,
      );
    if (outcome === "approved") return;
    if (outcome === "fenced") {
      ctx.check();
      throw new BrokerError(
        "fenced",
        "The page changed while waiting for confirmation.",
      );
    }
    throw new BrokerError("confirmation_denied");
  }

  // ---- shared helpers ----------------------------------------------------

  function makeContext(token, grant) {
    const controller = new AbortController();
    const set = controllers.get(grant.id) ?? new Set();
    set.add(controller);
    controllers.set(grant.id, set);
    const ctx = {
      token,
      grant,
      controller,
      timedOut: false,
      signal: controller.signal,
      fence: capabilities.fence(token),
      refresh() {
        ctx.fence = capabilities.fence(token);
      },
      check() {
        const verdict = ctx.fence?.check() ?? { ok: false, code: "no_grant" };
        if (!verdict.ok) throw new BrokerError(verdict.code);
        if (controller.signal.aborted) throw new BrokerError("fenced");
      },
      release() {
        set.delete(controller);
      },
    };
    return ctx;
  }

  async function resolveTab(ctx, tabId) {
    ctx.check();
    const authorized = capabilities.authorize(ctx.token, { tabId });
    if (!authorized.ok)
      throw new BrokerError(
        authorized.code === "tab_denied" ? "not_found" : authorized.code,
      );
    const info = await driver.getTab(tabId);
    if (
      !info ||
      info.businessId !== ctx.grant.businessId ||
      (ctx.grant.clientId !== null && info.clientId !== ctx.grant.clientId)
    )
      throw new BrokerError("not_found");
    if (info.controlOwner === "human")
      throw new BrokerError("fenced", "The person is controlling this tab.");
    ctx.check();
    return info;
  }

  function requireApprovedPage(ctx, tabId, info) {
    if (approvedAboutBlank(info.url)) return;
    const authorized = capabilities.authorize(ctx.token, {
      tabId,
      url: info.url,
    });
    if (authorized.ok) return;
    if (authorized.code === "origin_approval_required") {
      noticeOrigin(ctx.grant, tabId, authorized.origin, info.url);
      throw new BrokerError("origin_approval_required", undefined, {
        origin: authorized.origin,
      });
    }
    throw new BrokerError(authorized.code);
  }

  async function approvedNavigationTarget(ctx, tabId, url) {
    const guarded = await guardNavigation(url, {
      resolver,
      privateExceptions: ctx.grant.privateExceptions,
    });
    if (!guarded.ok) throw new BrokerError(guarded.code, guarded.reason);
    ctx.check();
    const authorized = capabilities.authorize(ctx.token, { url: guarded.url });
    if (!authorized.ok) {
      if (authorized.code === "origin_approval_required") {
        noticeOrigin(ctx.grant, tabId ?? "new", authorized.origin, guarded.url);
        throw new BrokerError("origin_approval_required", undefined, {
          origin: authorized.origin,
        });
      }
      throw new BrokerError(authorized.code);
    }
    return guarded;
  }

  function entryFor(tabId, ref) {
    const entry = registryFor(tabId).resolve(ref);
    if (!entry) throw new BrokerError("stale_ref");
    return entry;
  }

  function tabView(info, grant) {
    return {
      id: info.id,
      url: redactUrl(info.url),
      title: sanitizeUntrusted(info.title ?? "", 120),
      loading: Boolean(info.loading),
      primary: grant.primaryTabId === info.id,
    };
  }

  async function pageFinal(ctx, tabId) {
    const info = await driver.getTab(tabId);
    if (info && !approvedAboutBlank(info.url)) {
      const authorized = capabilities.authorize(ctx.token, {
        tabId,
        url: info.url,
      });
      if (!authorized.ok && authorized.code === "origin_approval_required") {
        noticeOrigin(ctx.grant, tabId, authorized.origin, info.url);
        throw new BrokerError("origin_approval_required", undefined, {
          origin: authorized.origin,
        });
      }
    }
    return info;
  }

  function blocked(result) {
    if (result?.blocked)
      throw new BrokerError(
        result.blocked.code ?? "origin_approval_required",
        undefined,
        {
          origin: result.blocked.origin,
        },
      );
  }

  /** Resolve, describe, classify and (if needed) park for confirmation. */
  async function guardedElementAction(
    ctx,
    args,
    action,
    { text, submit } = {},
  ) {
    const info = await resolveTab(ctx, args.tab);
    requireApprovedPage(ctx, args.tab, info);
    const registry = registryFor(args.tab);
    const entry = entryFor(args.tab, args.ref);
    const generation = registry.generation;
    const described = await driver.describe(args.tab, entry.backendNodeId, {
      signal: ctx.signal,
    });
    ctx.check();
    if (!described) {
      registry.forget(args.ref);
      throw new BrokerError("stale_ref");
    }
    const origin = originOf(info.url) ?? "";
    const input = {
      action,
      element: described.element ?? {},
      form: described.form ?? null,
      page: { origin },
      submit,
      text,
    };
    const verdict = classifyAction(input);
    if (verdict.decision === "deny") {
      const code = verdict.reasons[0]?.code ?? "invalid_input";
      throw new BrokerError(
        code === "external_protocol_link" ? "scheme_denied" : code,
      );
    }
    if (verdict.decision === "confirm") {
      await requestConfirmation(ctx, {
        tabId: args.tab,
        summary: confirmationSummary(input, verdict),
        result: verdict,
      });
      ctx.check();
      if (registryFor(args.tab).generation !== generation)
        throw new BrokerError(
          "fenced",
          "The page changed while waiting for confirmation.",
        );
      const again = await driver.describe(args.tab, entry.backendNodeId, {
        signal: ctx.signal,
      });
      ctx.check();
      if (!again || describeHash(again) !== describeHash(described))
        throw new BrokerError(
          "fenced",
          "The element changed while waiting for confirmation.",
        );
      const fresh = await driver.getTab(args.tab);
      if (!fresh || fresh.controlOwner === "human")
        throw new BrokerError("fenced");
      requireApprovedPage(ctx, args.tab, fresh);
    }
    ctx.check();
    return { info, entry, origin };
  }

  // ---- tools ---------------------------------------------------------------

  const TOOL_IMPL = {
    async browser_tabs(ctx) {
      const tabs = [];
      for (const tabId of ctx.grant.tabIds) {
        const info = await driver.getTab(tabId);
        if (info && info.businessId === ctx.grant.businessId)
          tabs.push(tabView(info, ctx.grant));
      }
      return { tabs };
    },

    async browser_open(ctx, args) {
      const target = await approvedNavigationTarget(ctx, undefined, args.url);
      const created = await driver.openTab({
        businessId: ctx.grant.businessId,
        clientId: ctx.grant.clientId,
        url: target.url,
        pinned: target.pinned,
        signal: ctx.signal,
      });
      try {
        capabilities.bindTab(ctx.grant.id, created.id);
      } catch (error) {
        await driver.closeTab(created.id);
        throw new BrokerError(error?.code ?? "tab_limit");
      }
      ctx.refresh();
      const set = openedTabs.get(ctx.grant.id) ?? new Set();
      set.add(created.id);
      openedTabs.set(ctx.grant.id, set);
      await driver.setControl?.(created.id, "agent");
      return { tab: tabView(created, ctx.grant) };
    },

    async browser_close(ctx, args) {
      await resolveTab(ctx, args.tab);
      if (!openedTabs.get(ctx.grant.id)?.has(args.tab))
        throw new BrokerError(
          "invalid_input",
          "Only tabs opened by this task can be closed.",
        );
      await driver.closeTab(args.tab);
      capabilities.unbindTab(ctx.grant.id, args.tab);
      openedTabs.get(ctx.grant.id)?.delete(args.tab);
      registries.delete(args.tab);
      ctx.refresh();
      return { closed: true };
    },

    async browser_navigate(ctx, args) {
      const info = await resolveTab(ctx, args.tab);
      let result;
      if (args.url !== undefined) {
        const target = await approvedNavigationTarget(ctx, args.tab, args.url);
        ctx.check();
        result = await driver.navigate(args.tab, target.url, {
          pinned: target.pinned,
          signal: ctx.signal,
          check: ctx.check,
        });
      } else {
        requireApprovedPage(ctx, args.tab, info);
        ctx.check();
        result = await driver.history(args.tab, args.action, {
          signal: ctx.signal,
          check: ctx.check,
        });
      }
      blocked(result);
      const after = await pageFinal(ctx, args.tab);
      return { tab: tabView(after ?? info, ctx.grant) };
    },

    async browser_snapshot(ctx, args) {
      const info = await resolveTab(ctx, args.tab);
      requireApprovedPage(ctx, args.tab, info);
      const raw = await driver.snapshot(args.tab, { signal: ctx.signal });
      ctx.check();
      const registry = registryFor(args.tab);
      if (
        raw.documentId !== undefined &&
        documentIds.get(args.tab) !== raw.documentId
      ) {
        if (documentIds.has(args.tab)) registry.reset();
        documentIds.set(args.tab, raw.documentId);
      }
      const after = await pageFinal(ctx, args.tab);
      const built = buildSnapshot({
        nodes: raw.nodes,
        extras: raw.extras,
        registry,
        url: raw.url ?? after?.url ?? info.url,
        title: raw.title ?? info.title,
        text: args.text === false ? "none" : "inline",
        maxChars: args.maxChars,
      });
      const origin = originOf(raw.url ?? info.url) ?? "";
      return {
        tab: args.tab,
        origin,
        generation: built.generation,
        snapshot: wrapUntrusted(built.text, { origin, tab: args.tab }),
        stats: built.stats,
      };
    },

    async browser_screenshot(ctx, args) {
      const info = await resolveTab(ctx, args.tab);
      requireApprovedPage(ctx, args.tab, info);
      const entry = args.ref ? entryFor(args.tab, args.ref) : null;
      const shot = await driver.screenshot(args.tab, {
        backendNodeId: entry?.backendNodeId,
        fullPage: args.fullPage === true,
        // Credential and card fields must never appear in an image.
        maskCredentialFields: true,
        signal: ctx.signal,
      });
      ctx.check();
      const bytes = Math.floor((String(shot.data ?? "").length * 3) / 4);
      if (!shot.data || bytes > maxScreenshotBytes)
        throw new BrokerError("too_large");
      return {
        tab: args.tab,
        mimeType: shot.mimeType ?? "image/png",
        data: shot.data,
        bytes,
      };
    },

    async browser_read(ctx, args) {
      const info = await resolveTab(ctx, args.tab);
      requireApprovedPage(ctx, args.tab, info);
      const entry = args.ref ? entryFor(args.tab, args.ref) : null;
      const maxChars = args.maxChars ?? 8_000;
      const raw = await driver.readText(args.tab, {
        backendNodeId: entry?.backendNodeId,
        maxChars: maxChars * 2,
        signal: ctx.signal,
      });
      ctx.check();
      await pageFinal(ctx, args.tab);
      const clean = sanitizeBlock(raw?.text ?? "", maxChars);
      const origin = originOf(info.url) ?? "";
      return {
        tab: args.tab,
        origin,
        text: wrapUntrusted(clean.text, { origin, tab: args.tab }),
        truncated: clean.truncated,
      };
    },

    async browser_click(ctx, args) {
      const { entry } = await guardedElementAction(ctx, args, "click");
      const result = await driver.click(args.tab, entry.backendNodeId, {
        signal: ctx.signal,
        check: ctx.check,
      });
      blocked(result);
      ctx.check();
      await pageFinal(ctx, args.tab);
      return { tab: args.tab, clicked: args.ref };
    },

    async browser_type(ctx, args) {
      const { entry } = await guardedElementAction(ctx, args, "type", {
        text: args.text,
        submit: args.submit === true,
      });
      const result = await driver.type(
        args.tab,
        entry.backendNodeId,
        args.text,
        {
          submit: args.submit === true,
          signal: ctx.signal,
          check: ctx.check,
        },
      );
      blocked(result);
      ctx.check();
      await pageFinal(ctx, args.tab);
      return {
        tab: args.tab,
        typed: args.text.length,
        submitted: args.submit === true,
      };
    },

    async browser_select(ctx, args) {
      const { entry } = await guardedElementAction(ctx, args, "select");
      await driver.select(args.tab, entry.backendNodeId, args.values, {
        signal: ctx.signal,
        check: ctx.check,
      });
      ctx.check();
      return { tab: args.tab, selected: args.values.length };
    },

    async browser_scroll(ctx, args) {
      const info = await resolveTab(ctx, args.tab);
      requireApprovedPage(ctx, args.tab, info);
      const entry = args.ref ? entryFor(args.tab, args.ref) : null;
      ctx.check();
      await driver.scroll(args.tab, {
        backendNodeId: entry?.backendNodeId,
        direction: args.direction,
        amount: args.amount ?? 600,
        signal: ctx.signal,
      });
      ctx.check();
      return { tab: args.tab, scrolled: args.direction };
    },

    async browser_wait(ctx, args) {
      const info = await resolveTab(ctx, args.tab);
      requireApprovedPage(ctx, args.tab, info);
      const timeoutMs = Math.min(
        args.timeoutMs ?? DEFAULT_WAIT_MS,
        MAX_WAIT_MS,
      );
      const condition = {};
      if (args.text !== undefined) condition.text = args.text;
      if (args.textGone !== undefined) condition.textGone = args.textGone;
      if (args.url !== undefined) condition.url = args.url;
      if (args.idleMs !== undefined) condition.idleMs = args.idleMs;
      if (args.ref !== undefined)
        condition.backendNodeId = entryFor(args.tab, args.ref).backendNodeId;
      const outcome = await driver.wait(args.tab, condition, {
        timeoutMs,
        signal: ctx.signal,
        check: ctx.check,
      });
      ctx.check();
      await pageFinal(ctx, args.tab);
      return {
        tab: args.tab,
        matched: outcome?.matched === true,
        timedOut: outcome?.matched !== true,
      };
    },

    async browser_upload(ctx, args) {
      const upload = uploads.get(args.uploadId);
      if (!upload || upload.grantId !== ctx.grant.id || upload.used)
        throw new BrokerError(
          "invalid_input",
          "Unknown or already used upload.",
        );
      // Uploads always need the person's confirmation: the classifier says so.
      const { entry } = await guardedElementAction(ctx, args, "upload");
      upload.used = true;
      await driver.upload(args.tab, entry.backendNodeId, upload.path, {
        signal: ctx.signal,
        check: ctx.check,
      });
      uploads.delete(args.uploadId);
      ctx.check();
      return {
        tab: args.tab,
        uploaded: sanitizeUntrusted(upload.name ?? "file", 80),
        bytes: upload.size,
      };
    },
  };

  // ---- dispatch ------------------------------------------------------------

  function enqueue(grantId, task) {
    const queue = queues.get(grantId) ?? { tail: Promise.resolve(), depth: 0 };
    if (queue.depth >= maxQueue) return Promise.resolve(fail("busy"));
    queue.depth += 1;
    const run = queue.tail.then(task, task).finally(() => {
      queue.depth -= 1;
    });
    queue.tail = run.catch(() => undefined);
    queues.set(grantId, queue);
    return run;
  }

  async function execute(token, grant, name, args, started) {
    const ctx = makeContext(token, grant);
    if (!ctx.fence) return fail("no_grant");
    const limit = setTimeout(() => {
      ctx.timedOut = true;
      ctx.controller.abort();
    }, maxActionMs);
    limit.unref?.();
    // A driver that ignores the abort signal must not be able to hang a call
    // past a revoke, take over or timeout: the race settles on abort.
    const aborted = new Promise((_, reject) => {
      ctx.signal.addEventListener(
        "abort",
        () => reject(new BrokerError("fenced")),
        {
          once: true,
        },
      );
    });
    aborted.catch(() => undefined);
    try {
      ctx.check();
      const data = await Promise.race([TOOL_IMPL[name](ctx, args), aborted]);
      ctx.check();
      record(grant, name, args, "ok", started, {
        summary: `${name} ok`,
        origin: typeof data?.origin === "string" ? data.origin : undefined,
      });
      return { ok: true, ...data };
    } catch (error) {
      if (ctx.signal.aborted) {
        const verdict = ctx.fence?.check();
        const code = ctx.timedOut
          ? "timeout"
          : verdict && !verdict.ok
            ? verdict.code
            : "fenced";
        record(grant, name, args, "fenced", started, {
          code,
          summary: `${name}: ${code}`,
        });
        return fail(code);
      }
      if (error instanceof BrokerError) {
        const status = FENCE_CODES.has(error.code)
          ? "fenced"
          : error.code === "confirmation_denied"
            ? "rejected"
            : DENIED_CODES.has(error.code)
              ? "denied"
              : "error";
        record(grant, name, args, status, started, {
          code: error.code,
          summary: `${name}: ${error.code}`,
        });
        return fail(error.code, error.message, error.extra);
      }
      if (isDriverError(error)) {
        record(grant, name, args, "error", started, {
          code: error.driverCode,
          summary: `${name}: ${error.driverCode}`,
        });
        return fail(error.driverCode, DRIVER_ERROR_CODES[error.driverCode]);
      }
      record(grant, name, args, "error", started, {
        code: "driver_error",
        summary: `${name}: driver_error`,
      });
      return fail("driver_error");
    } finally {
      clearTimeout(limit);
      ctx.release();
    }
  }

  async function call(token, name, rawArgs) {
    const started = now();
    const auth = capabilities.authenticate(token);
    if (!auth.ok) return fail(auth.code);
    const grant = auth.grant;
    if (!isToolName(name)) {
      record(grant, String(name).slice(0, 40), {}, "error", started, {
        code: "invalid_input",
        summary: "unknown tool",
      });
      return fail("invalid_input", "Unknown tool.");
    }
    const valid = validateToolInput(name, rawArgs);
    if (!valid.ok) {
      record(grant, name, {}, "error", started, {
        code: "invalid_input",
        summary: `${name}: invalid input`,
      });
      return fail("invalid_input", valid.message);
    }
    return enqueue(grant.id, () =>
      execute(token, grant, name, valid.value, started),
    );
  }

  // ---- host (person facing) API ---------------------------------------------

  return {
    /** Tools exist only while a grant is active. */
    toolsFor(token) {
      return capabilities.authenticate(token).ok ? toolDescriptors() : [];
    },
    call,
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    confirm: (actionId) => settle(actionId, "approved"),
    reject: (actionId) => settle(actionId, "rejected"),
    pendingConfirmations() {
      return [...pending].map(([actionId, entry]) => ({
        actionId,
        grantId: entry.grantId,
        tabId: entry.tabId,
        summary: entry.summary,
      }));
    },
    approveOrigin: (grantId, url, options) =>
      capabilities.approveOrigin(grantId, url, options),
    revoke: (grantId, reason) => capabilities.revoke(grantId, reason),
    takeOver: (grantId) => capabilities.takeOver(grantId),
    /** Host registers a file the person chose. The agent only gets the id. */
    registerUpload(grantId, { path, name, size }) {
      const grant = capabilities.getGrant(grantId);
      if (grant?.state !== "active") throw new BrokerError("no_grant");
      const uploadId = `u-${randomUUID()}`;
      uploads.set(uploadId, { grantId, path, name, size, used: false });
      return uploadId;
    },
    getLog: (options) => log.entries(options),
    sweep: () => capabilities.sweep(),
    notifyDocumentChanged(tabId) {
      registries.get(tabId)?.reset();
      documentIds.delete(tabId);
      for (const [actionId, entry] of pending) {
        if (entry.tabId === tabId) settle(actionId, "fenced");
      }
    },
    notifyTabClosed(tabId) {
      registries.delete(tabId);
      documentIds.delete(tabId);
      const grant = capabilities.grantForTab(tabId);
      if (grant) capabilities.unbindTab(grant.id, tabId);
    },
    /**
     * Synchronous navigation gate for the driver's will-navigate and
     * will-redirect handlers (they cannot await). Only tabs under an active
     * grant that is agent controlled are restricted.
     */
    checkNavigationSync(tabId, url) {
      const grant = capabilities.grantForTab(tabId);
      if (!grant || driver.controlOwnerOf?.(tabId) === "human")
        return { allow: true };
      const checked = checkUrl(url, {
        privateExceptions: grant.privateExceptions,
      });
      if (!checked.ok) return { allow: false, code: checked.code };
      if (!grant.allowedOrigins.includes(checked.origin)) {
        noticeOrigin(grant, tabId, checked.origin, url);
        return {
          allow: false,
          code: "origin_approval_required",
          origin: checked.origin,
        };
      }
      return { allow: true };
    },
  };
}
