import { setTimeout as delay } from "node:timers/promises";
import { ALLOWED_CDP_METHODS, FUNCTIONS } from "./cdp-functions.mjs";
import { DriverError } from "./driver-errors.mjs";

/**
 * Page driver: the ONLY module that speaks CDP, and only in the Electron main
 * process through `webContents.debugger`. It implements the PageDriver
 * interface the broker core consumes.
 *
 * Safety properties (each covered by node tests against a fake debugger):
 *   - a fixed allowlist of CDP methods; no Network, Storage, Fetch, Target,
 *     Emulation or Runtime.evaluate
 *   - page functions are constants (cdp-functions.mjs) run in an isolated
 *     world, never built from agent text
 *   - clicks are real input events at the element's centre, refused when
 *     another element covers it, and fenced immediately before dispatch
 *   - screenshots mask credential fields first and fail closed if masking fails
 *   - navigation goes through the host adapter so the broker's synchronous gate
 *     and the egress proxy apply
 *
 * Covered by the focused source Electron fixture. Packaged managed-agent
 * runtime adoption remains a separate proof gate.
 */

const WORLD_NAME = "colony-agent";
const CDP_VERSION = "1.3";
const MAX_SHOT_EDGE = 1_568;
const MAX_DOM_NODES = 50_000;
const EXTRA_TAGS = new Set([
  "INPUT",
  "TEXTAREA",
  "SELECT",
  "BUTTON",
  "A",
  "IFRAME",
  "FRAME",
]);

function attributesToMap(flat = []) {
  const map = new Map();
  for (let i = 0; i + 1 < flat.length; i += 2)
    map.set(String(flat[i]).toLowerCase(), flat[i + 1]);
  return map;
}

function resolveUrl(value, base) {
  try {
    return new URL(value, base).href;
  } catch {
    return String(value).slice(0, 500);
  }
}

/** DOM tree to the small attribute table the snapshot builder needs. */
export function extrasFromDom(root, baseUrl, limit = MAX_DOM_NODES) {
  const extras = new Map();
  if (!root) return extras;
  const stack = [{ node: root, base: baseUrl }];
  let visited = 0;
  while (stack.length > 0 && visited < limit) {
    const { node, base } = stack.pop();
    visited += 1;
    const documentBase = node.documentURL || node.baseURL || base;
    if (
      node.nodeType === 1 &&
      EXTRA_TAGS.has(String(node.nodeName).toUpperCase())
    ) {
      const attrs = attributesToMap(node.attributes);
      const entry = {};
      if (attrs.has("type"))
        entry.type = String(attrs.get("type")).toLowerCase();
      if (attrs.has("autocomplete"))
        entry.autocomplete = String(attrs.get("autocomplete")).toLowerCase();
      if (attrs.has("href"))
        entry.href = resolveUrl(attrs.get("href"), documentBase);
      const name = String(node.nodeName).toUpperCase();
      if ((name === "IFRAME" || name === "FRAME") && attrs.has("src")) {
        try {
          entry.origin = new URL(attrs.get("src"), documentBase).origin;
        } catch {
          // opaque or invalid source: leave the origin off
        }
      }
      if (name === "TEXTAREA") entry.type = "textarea";
      if (name === "SELECT") entry.type = "select-one";
      if (Number.isInteger(node.backendNodeId))
        extras.set(node.backendNodeId, entry);
    }
    for (const child of node.children ?? [])
      stack.push({ node: child, base: documentBase });
    for (const shadow of node.shadowRoots ?? [])
      stack.push({ node: shadow, base: documentBase });
    if (node.contentDocument)
      stack.push({ node: node.contentDocument, base: documentBase });
  }
  return extras;
}

function center(quad) {
  if (!Array.isArray(quad) || quad.length < 8 || !quad.every(Number.isFinite))
    return null;
  const xs = [quad[0], quad[2], quad[4], quad[6]];
  const ys = [quad[1], quad[3], quad[5], quad[7]];
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  if (width < 1 || height < 1) return null;
  return {
    x: xs.reduce((a, b) => a + b, 0) / 4,
    y: ys.reduce((a, b) => a + b, 0) / 4,
    left: Math.min(...xs),
    top: Math.min(...ys),
    width,
    height,
  };
}

export function createPageDriver({
  internals,
  adapter,
  downloads,
  cdpTimeoutMs = 15_000,
  loadTimeoutMs = 30_000,
  pollMs = 150,
  sleep = (ms) => delay(ms),
} = {}) {
  if (!adapter) throw new Error("A browser host adapter is required");
  const sessions = new Map();
  let broker = null;

  // ---- CDP plumbing ------------------------------------------------------

  async function rawSend(session, method, params, signal) {
    if (signal?.aborted) throw new DriverError("cdp_timeout");
    if (!ALLOWED_CDP_METHODS.has(method))
      throw new Error(`CDP method not allowed: ${String(method).slice(0, 60)}`);
    let timer;
    let onAbort;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new DriverError("cdp_timeout")),
        cdpTimeoutMs,
      );
      timer.unref?.();
    });
    const aborted = signal
      ? new Promise((_, reject) => {
          if (signal.aborted) reject(new DriverError("cdp_timeout"));
          onAbort = () => reject(new DriverError("cdp_timeout"));
          signal.addEventListener("abort", onAbort, { once: true });
        })
      : null;
    try {
      return await Promise.race(
        [
          session.contents.debugger.sendCommand(method, params),
          timeout,
          aborted,
        ].filter(Boolean),
      );
    } finally {
      clearTimeout(timer);
      if (onAbort) signal.removeEventListener("abort", onAbort);
    }
  }

  async function sessionFor(tabId) {
    const contents = adapter.webContents(tabId);
    if (!contents) throw new DriverError("tab_crashed");
    let session = sessions.get(tabId);
    if (session && session.contents !== contents) {
      sessions.delete(tabId);
      session = undefined;
    }
    if (!session) {
      session = { tabId, contents, ready: false, world: null };
      sessions.set(tabId, session);
      contents.debugger.on("detach", () => {
        if (sessions.get(tabId) === session) sessions.delete(tabId);
      });
    }
    try {
      if (!contents.debugger.isAttached())
        contents.debugger.attach(CDP_VERSION);
      if (!session.ready) {
        for (const method of [
          "Page.enable",
          "DOM.enable",
          "Accessibility.enable",
        ])
          await rawSend(session, method, {});
        session.ready = true;
      }
    } catch (error) {
      sessions.delete(tabId);
      throw error instanceof DriverError
        ? error
        : new DriverError("debugger_detached");
    }
    return session;
  }

  const send = (session, method, params, signal) =>
    rawSend(session, method, params, signal);

  /** One isolated world per document, so the page cannot tamper with built-ins. */
  async function worldFor(session, signal) {
    const tree = await send(session, "Page.getFrameTree", {}, signal);
    const { id: frameId, loaderId } = tree.frameTree.frame;
    if (session.world?.loaderId === loaderId) return session.world;
    const created = await send(
      session,
      "Page.createIsolatedWorld",
      { frameId, worldName: WORLD_NAME },
      signal,
    );
    session.world = {
      loaderId,
      frameId,
      contextId: created.executionContextId,
    };
    return session.world;
  }

  async function resolve(session, backendNodeId, signal) {
    const world = await worldFor(session, signal);
    const reply = await send(
      session,
      "DOM.resolveNode",
      { backendNodeId, executionContextId: world.contextId },
      signal,
    );
    const objectId = reply?.object?.objectId;
    if (!objectId) throw new DriverError("element_not_actionable");
    return objectId;
  }

  async function documentObject(session, signal) {
    const doc = await send(session, "DOM.getDocument", { depth: 0 }, signal);
    return resolve(session, doc.root.backendNodeId, signal);
  }

  async function call(session, objectId, key, args = [], signal) {
    const declaration = FUNCTIONS[key];
    if (!declaration) throw new Error("Unknown page function");
    const reply = await send(
      session,
      "Runtime.callFunctionOn",
      {
        objectId,
        functionDeclaration: declaration,
        arguments: args.map((value) => ({ value })),
        returnByValue: true,
        awaitPromise: false,
        userGesture: false,
      },
      signal,
    );
    if (reply?.exceptionDetails)
      throw new DriverError("element_not_actionable");
    return reply?.result?.value;
  }

  async function release(session, objectId) {
    try {
      await send(session, "Runtime.releaseObject", { objectId });
    } catch {
      // best effort
    }
  }

  async function boxOf(session, backendNodeId, signal) {
    await send(
      session,
      "DOM.scrollIntoViewIfNeeded",
      { backendNodeId },
      signal,
    ).catch(() => {
      throw new DriverError("element_not_actionable");
    });
    const reply = await send(
      session,
      "DOM.getBoxModel",
      { backendNodeId },
      signal,
    ).catch(() => {
      throw new DriverError("element_not_actionable");
    });
    const box = center(reply?.model?.content);
    if (!box) throw new DriverError("element_not_actionable");
    return box;
  }

  // ---- PageDriver interface ------------------------------------------------

  // Test hook: lets unit tests prove the CDP allowlist actually guards.
  if (internals && typeof internals === "object")
    internals.send = async (tabId, method, params) =>
      send(await sessionFor(tabId), method, params);

  const driver = {
    attach(value) {
      broker = value;
      adapter.onDocumentChanged?.((tabId) =>
        broker?.notifyDocumentChanged(tabId),
      );
      adapter.onTabClosed?.((tabId) => {
        downloads?.cancelTab(tabId);
        sessions.delete(tabId);
        broker?.notifyTabClosed(tabId);
      });
      adapter.setNavigationGate?.((tabId, url, isMainFrame) =>
        isMainFrame && broker
          ? broker.checkNavigationSync(tabId, url)
          : { allow: true },
      );
    },

    async getTab(tabId) {
      const tab = adapter.getTab(tabId);
      if (!tab) return null;
      const { id, businessId, clientId, url, title, loading, controlOwner } =
        tab;
      return { id, businessId, clientId, url, title, loading, controlOwner };
    },

    controlOwnerOf: (tabId) => adapter.getTab(tabId)?.controlOwner,

    async openTab({ businessId, clientId, primaryTabId }) {
      const created = await adapter.createTab({
        businessId,
        clientId,
        primaryTabId,
      });
      const deadline = Date.now() + loadTimeoutMs;
      while (adapter.getTab(created.id)?.loading && Date.now() < deadline)
        await sleep(pollMs);
      return driver.getTab(created.id);
    },

    async closeTab(tabId) {
      sessions.delete(tabId);
      await adapter.closeTab(tabId);
    },

    async navigate(tabId, url, { signal, check } = {}) {
      check?.();
      if (signal?.aborted) throw new DriverError("cdp_timeout");
      adapter.consumeBlocked?.(tabId);
      const onAbort = () => adapter.stop(tabId);
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        await adapter.loadUrl(tabId, url);
      } finally {
        signal?.removeEventListener("abort", onAbort);
      }
      const blocked = adapter.consumeBlocked?.(tabId);
      return blocked ? { blocked } : { url: adapter.getTab(tabId)?.url };
    },

    async history(tabId, action, { signal, check } = {}) {
      check?.();
      if (signal?.aborted) throw new DriverError("cdp_timeout");
      adapter.consumeBlocked?.(tabId);
      const onAbort = () => adapter.stop(tabId);
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        await adapter.history(tabId, action);
      } finally {
        signal?.removeEventListener("abort", onAbort);
      }
      const blocked = adapter.consumeBlocked?.(tabId);
      return blocked ? { blocked } : {};
    },

    async snapshot(tabId, { signal } = {}) {
      const session = await sessionFor(tabId);
      await worldFor(session, signal);
      const [ax, dom, tree] = await Promise.all([
        send(session, "Accessibility.getFullAXTree", {}, signal),
        send(session, "DOM.getDocument", { depth: -1, pierce: true }, signal),
        send(session, "Page.getFrameTree", {}, signal),
      ]);
      const tab = adapter.getTab(tabId);
      return {
        nodes: ax.nodes ?? [],
        extras: extrasFromDom(dom.root, tab?.url),
        url: tab?.url,
        title: tab?.title,
        documentId: tree.frameTree.frame.loaderId,
      };
    },

    async describe(tabId, backendNodeId, { signal } = {}) {
      const session = await sessionFor(tabId);
      let objectId;
      try {
        objectId = await resolve(session, backendNodeId, signal);
      } catch (error) {
        if (error instanceof DriverError && error.driverCode === "cdp_timeout")
          throw error;
        return null;
      }
      try {
        const [partial, facts] = await Promise.all([
          send(
            session,
            "Accessibility.getPartialAXTree",
            { backendNodeId, fetchRelatives: false },
            signal,
          ),
          call(session, objectId, "describe", [], signal),
        ]);
        const node = partial?.nodes?.[0] ?? {};
        return {
          element: {
            role: String(node.role?.value ?? "").toLowerCase(),
            name: node.name?.value ?? facts.label ?? "",
            description: node.description?.value,
            inputType: facts.inputType,
            autocomplete: facts.autocomplete,
            buttonType: facts.buttonType,
            href: facts.href,
            inDialog: facts.inDialog,
            dialogRole: facts.dialogRole,
            dialogText: facts.dialogText,
          },
          form: facts.form ?? null,
        };
      } finally {
        await release(session, objectId);
      }
    },

    async click(tabId, backendNodeId, { signal, check } = {}) {
      const session = await sessionFor(tabId);
      const objectId = await resolve(session, backendNodeId, signal).catch(
        () => {
          throw new DriverError("element_not_actionable");
        },
      );
      try {
        const box = await boxOf(session, backendNodeId, signal);
        check?.();
        const hit = await call(
          session,
          objectId,
          "hitTest",
          [box.x, box.y],
          signal,
        );
        if (!hit) throw new DriverError("click_intercepted");
        // Last gate before real input: a revoke or take over lands here.
        check?.();
        adapter.consumeBlocked?.(tabId);
        const base = {
          x: box.x,
          y: box.y,
          button: "left",
          pointerType: "mouse",
        };
        await send(
          session,
          "Input.dispatchMouseEvent",
          { ...base, type: "mouseMoved" },
          signal,
        );
        check?.();
        await send(
          session,
          "Input.dispatchMouseEvent",
          { ...base, type: "mousePressed", clickCount: 1 },
          signal,
        );
        check?.();
        await send(
          session,
          "Input.dispatchMouseEvent",
          { ...base, type: "mouseReleased", clickCount: 1 },
          signal,
        );
      } finally {
        await release(session, objectId);
      }
      const blocked = adapter.consumeBlocked?.(tabId);
      return blocked ? { blocked } : {};
    },

    async type(
      tabId,
      backendNodeId,
      text,
      { submit = false, signal, check } = {},
    ) {
      const session = await sessionFor(tabId);
      const objectId = await resolve(session, backendNodeId, signal).catch(
        () => {
          throw new DriverError("element_not_actionable");
        },
      );
      try {
        await send(session, "DOM.focus", { backendNodeId }, signal).catch(
          () => {
            throw new DriverError("element_not_actionable");
          },
        );
        await call(session, objectId, "selectContents", [], signal);
        check?.();
        adapter.consumeBlocked?.(tabId);
        if (text.length > 0) {
          await send(session, "Input.insertText", { text }, signal);
        } else {
          for (const type of ["keyDown", "keyUp"])
            await send(
              session,
              "Input.dispatchKeyEvent",
              {
                type,
                key: "Delete",
                code: "Delete",
                windowsVirtualKeyCode: 46,
              },
              signal,
            );
        }
        if (submit) {
          check?.();
          await send(
            session,
            "Input.dispatchKeyEvent",
            {
              type: "keyDown",
              key: "Enter",
              code: "Enter",
              windowsVirtualKeyCode: 13,
              text: "\r",
            },
            signal,
          );
          await send(
            session,
            "Input.dispatchKeyEvent",
            {
              type: "keyUp",
              key: "Enter",
              code: "Enter",
              windowsVirtualKeyCode: 13,
            },
            signal,
          );
        }
      } finally {
        await release(session, objectId);
      }
      const blocked = adapter.consumeBlocked?.(tabId);
      return blocked ? { blocked } : {};
    },

    async select(tabId, backendNodeId, values, { signal, check } = {}) {
      const session = await sessionFor(tabId);
      const objectId = await resolve(session, backendNodeId, signal).catch(
        () => {
          throw new DriverError("element_not_actionable");
        },
      );
      try {
        check?.();
        const outcome = await call(
          session,
          objectId,
          "selectOptions",
          [values],
          signal,
        );
        if (!outcome?.ok) throw new DriverError("element_not_actionable");
      } finally {
        await release(session, objectId);
      }
      return {};
    },

    async upload(tabId, backendNodeId, path, { signal, check } = {}) {
      const described = await driver.describe(tabId, backendNodeId, { signal });
      if (described?.element?.inputType !== "file")
        throw new DriverError("element_not_actionable");
      const session = await sessionFor(tabId);
      check?.();
      await send(
        session,
        "DOM.setFileInputFiles",
        { files: [path], backendNodeId },
        signal,
      );
      return {};
    },

    async scroll(
      tabId,
      { backendNodeId, direction, amount = 600, signal } = {},
    ) {
      const session = await sessionFor(tabId);
      if (
        (direction === "top" || direction === "bottom") &&
        backendNodeId === undefined
      ) {
        const objectId = await documentObject(session, signal);
        try {
          await call(session, objectId, "scrollPageTo", [direction], signal);
        } finally {
          await release(session, objectId);
        }
        return {};
      }
      let point;
      if (backendNodeId !== undefined) {
        point = await boxOf(session, backendNodeId, signal);
      } else {
        const metrics = await send(
          session,
          "Page.getLayoutMetrics",
          {},
          signal,
        );
        const view = metrics.cssVisualViewport ?? {
          clientWidth: 800,
          clientHeight: 600,
        };
        point = { x: view.clientWidth / 2, y: view.clientHeight / 2 };
      }
      const deltas = {
        up: [0, -amount],
        down: [0, amount],
        left: [-amount, 0],
        right: [amount, 0],
        top: [0, -100_000],
        bottom: [0, 100_000],
      }[direction] ?? [0, amount];
      await send(
        session,
        "Input.dispatchMouseEvent",
        {
          type: "mouseWheel",
          x: point.x,
          y: point.y,
          deltaX: deltas[0],
          deltaY: deltas[1],
        },
        signal,
      );
      return {};
    },

    async screenshot(
      tabId,
      {
        backendNodeId,
        fullPage = false,
        maskCredentialFields = true,
        signal,
      } = {},
    ) {
      const session = await sessionFor(tabId);
      const objectId = await documentObject(session, signal);
      let masked = false;
      try {
        if (maskCredentialFields) {
          // Fail closed: no mask, no screenshot.
          masked = true;
          await call(session, objectId, "maskCredentials", [], signal);
        }
        let clip;
        if (backendNodeId !== undefined) {
          const box = await boxOf(session, backendNodeId, signal);
          clip = {
            x: box.left,
            y: box.top,
            width: box.width,
            height: box.height,
          };
        } else {
          const metrics = await send(
            session,
            "Page.getLayoutMetrics",
            {},
            signal,
          );
          const view = fullPage
            ? (metrics.cssContentSize ?? metrics.contentSize)
            : (metrics.cssVisualViewport ?? {
                clientWidth: 800,
                clientHeight: 600,
              });
          const width = view.width ?? view.clientWidth;
          const height = view.height ?? view.clientHeight;
          clip = { x: 0, y: 0, width, height };
        }
        const scale = Math.min(
          1,
          MAX_SHOT_EDGE / Math.max(clip.width, clip.height, 1),
        );
        const shot = await send(
          session,
          "Page.captureScreenshot",
          {
            format: "png",
            clip: { ...clip, scale },
            captureBeyondViewport: fullPage,
          },
          signal,
        );
        return { mimeType: "image/png", data: shot.data };
      } finally {
        if (masked)
          await call(
            session,
            objectId,
            "unmaskCredentials",
            [],
            undefined,
          ).catch(() => undefined);
        await release(session, objectId);
      }
    },

    async readText(tabId, { backendNodeId, maxChars = 8_000, signal } = {}) {
      const session = await sessionFor(tabId);
      const objectId =
        backendNodeId === undefined
          ? await documentObject(session, signal)
          : await resolve(session, backendNodeId, signal).catch(() => {
              throw new DriverError("element_not_actionable");
            });
      try {
        const text = await call(
          session,
          objectId,
          "readText",
          [maxChars],
          signal,
        );
        return { text: String(text ?? "") };
      } finally {
        await release(session, objectId);
      }
    },

    async wait(tabId, condition, { timeoutMs = 10_000, signal, check } = {}) {
      const deadline = Date.now() + timeoutMs;
      let quietSince = null;
      while (Date.now() < deadline) {
        check?.();
        if (signal?.aborted) throw new DriverError("cdp_timeout");
        if (condition.url !== undefined) {
          if (String(adapter.getTab(tabId)?.url ?? "").includes(condition.url))
            return { matched: true };
        } else if (condition.idleMs !== undefined) {
          if (adapter.getTab(tabId)?.loading) quietSince = null;
          else {
            quietSince ??= Date.now();
            if (Date.now() - quietSince >= condition.idleMs)
              return { matched: true };
          }
        } else {
          const session = await sessionFor(tabId);
          let matched = false;
          if (
            condition.text !== undefined ||
            condition.textGone !== undefined
          ) {
            const objectId = await documentObject(session, signal);
            try {
              const needle = condition.text ?? condition.textGone;
              const present = await call(
                session,
                objectId,
                "pageHasText",
                [needle],
                signal,
              );
              matched =
                condition.text !== undefined
                  ? present === true
                  : present !== true;
            } finally {
              await release(session, objectId);
            }
          } else if (condition.backendNodeId !== undefined) {
            try {
              const objectId = await resolve(
                session,
                condition.backendNodeId,
                signal,
              );
              const connected = await call(
                session,
                objectId,
                "isConnected",
                [],
                signal,
              );
              await release(session, objectId);
              matched = connected === true;
            } catch {
              matched = false;
            }
          }
          if (matched) return { matched: true };
        }
        await sleep(pollMs);
      }
      return { matched: false };
    },

    async download(tabId, url, options) {
      if (!downloads) throw new DriverError("element_not_actionable");
      return downloads.download(tabId, url, options);
    },

    async stopTab(tabId) {
      downloads?.cancelTab(tabId);
      await adapter.stop(tabId);
    },

    async setControl(tabId, owner) {
      await adapter.setControlOwner(tabId, owner);
    },
  };
  return driver;
}
