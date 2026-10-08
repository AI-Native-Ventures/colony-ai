/**
 * In memory PageDriver used by the broker unit tests. It is test support, not
 * a test: it has no assertions. The real driver (CDP, main process only)
 * implements the same interface.
 */

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export async function until(read, timeoutMs = 1_000) {
  const start = Date.now();
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error("until: timed out");
    await new Promise((resolve) => setImmediate(resolve));
  }
}

export function createFakePageDriver() {
  const tabs = new Map();
  const calls = [];
  const holds = new Map();
  let broker = null;
  let tabCounter = 0;
  let docCounter = 0;
  let failNext = null;

  const originOfUrl = (url) => {
    try {
      return new URL(url).origin;
    } catch {
      return null;
    }
  };

  function newDocument(tab) {
    docCounter += 1;
    tab.docId = `doc-${docCounter}`;
    broker?.notifyDocumentChanged(tab.id);
  }

  async function maybeHold(op) {
    const gate = holds.get(op);
    if (!gate) return;
    holds.delete(op);
    await gate.promise;
  }

  function maybeFail(op) {
    if (failNext === op) {
      failNext = null;
      throw new Error("driver exploded with /Users/secret/path");
    }
  }

  function requireTab(id) {
    const tab = tabs.get(id);
    if (!tab) throw new Error("no such tab");
    return tab;
  }

  /** Follow redirects, asking the broker's synchronous gate for every hop. */
  function performNavigation(tab, url) {
    let hop = url;
    for (let guard = 0; guard < 10; guard += 1) {
      const gate = broker
        ? broker.checkNavigationSync(tab.id, hop)
        : { allow: true };
      if (!gate.allow)
        return { blocked: { code: gate.code, origin: gate.origin } };
      const next = tab.redirects?.[hop];
      if (!next) break;
      hop = next;
    }
    tab.history.push(tab.url);
    tab.url = hop;
    tab.title = tab.sites?.[hop]?.title ?? "";
    if (tab.sites?.[hop]?.page) tab.page = tab.sites[hop].page;
    newDocument(tab);
    return { url: hop };
  }

  function findElement(tab, backendNodeId) {
    return (tab.page?.elements ?? []).find(
      (el) => el.backend === backendNodeId,
    );
  }

  const driver = {
    calls,
    tabs,
    attach(value) {
      broker = value;
    },
    hold(op) {
      const gate = deferred();
      holds.set(op, gate);
      return gate;
    },
    failNext(op) {
      failNext = op;
    },
    addTab({
      id = `opened-${++tabCounter}`,
      businessId = "biz-1",
      clientId = null,
      url = "about:blank",
      title = "",
      controlOwner = "agent",
      page = { text: "", elements: [] },
      redirects = {},
      sites = {},
    } = {}) {
      const tab = {
        id,
        businessId,
        clientId,
        url,
        title,
        controlOwner,
        page,
        redirects,
        sites,
        history: [],
        loading: false,
        docId: "",
      };
      docCounter += 1;
      tab.docId = `doc-${docCounter}`;
      tabs.set(id, tab);
      return tab;
    },
    setPage(id, page) {
      requireTab(id).page = page;
      newDocument(tabs.get(id));
    },
    count(op) {
      return calls.filter((call) => call.op === op).length;
    },

    async getTab(id) {
      const tab = tabs.get(id);
      if (!tab) return null;
      const { businessId, clientId, url, title, controlOwner, loading } = tab;
      return { id, businessId, clientId, url, title, controlOwner, loading };
    },
    controlOwnerOf: (id) => tabs.get(id)?.controlOwner,
    async openTab({ businessId, clientId, url }) {
      maybeFail("openTab");
      calls.push({ op: "openTab", url });
      const tab = driver.addTab({
        businessId,
        clientId,
        url,
        controlOwner: "human",
      });
      return driver.getTab(tab.id);
    },
    async closeTab(id) {
      calls.push({ op: "closeTab", id });
      tabs.delete(id);
      broker?.notifyTabClosed(id);
    },
    async navigate(id, url, options) {
      maybeFail("navigate");
      calls.push({ op: "navigate", id, url, pinned: options?.pinned });
      await maybeHold("navigate");
      return performNavigation(requireTab(id), url);
    },
    async history(id, action) {
      calls.push({ op: "history", id, action });
      const tab = requireTab(id);
      if (action === "back" && tab.history.length > 0) {
        const target = tab.history.at(-1);
        const gate = broker?.checkNavigationSync(id, target) ?? { allow: true };
        if (!gate.allow)
          return { blocked: { code: gate.code, origin: gate.origin } };
        tab.history.pop();
        tab.url = target;
        newDocument(tab);
      }
      return {};
    },
    async snapshot(id) {
      maybeFail("snapshot");
      calls.push({ op: "snapshot", id });
      await maybeHold("snapshot");
      const tab = requireTab(id);
      const nodes = [
        {
          nodeId: "1",
          role: { value: "RootWebArea" },
          name: { value: tab.title },
          childIds: tab.page.elements.map((_, index) => String(index + 2)),
        },
      ];
      const extras = new Map();
      tab.page.elements.forEach((el, index) => {
        nodes.push({
          nodeId: String(index + 2),
          parentId: "1",
          role: { value: el.role },
          name: { value: el.name ?? "" },
          ...(el.value !== undefined ? { value: { value: el.value } } : {}),
          backendDOMNodeId: el.backend,
          childIds: [],
        });
        extras.set(el.backend, el.extra ?? {});
      });
      return {
        nodes,
        extras,
        url: tab.url,
        title: tab.title,
        documentId: tab.docId,
      };
    },
    async describe(id, backendNodeId) {
      calls.push({ op: "describe", id, backendNodeId });
      const el = findElement(requireTab(id), backendNodeId);
      if (!el) return null;
      return {
        element: {
          role: el.role,
          name: el.name,
          inputType: el.extra?.type,
          autocomplete: el.extra?.autocomplete,
          href: el.extra?.href,
          ...(el.describe ?? {}),
        },
        form: el.form ?? null,
      };
    },
    async screenshot(id, options) {
      calls.push({ op: "screenshot", id, options });
      await maybeHold("screenshot");
      return (
        requireTab(id).screenshot ?? { mimeType: "image/png", data: "AAAA" }
      );
    },
    async readText(id, options) {
      calls.push({ op: "readText", id, options });
      return { text: requireTab(id).page.text ?? "" };
    },
    async click(id, backendNodeId, options) {
      maybeFail("click");
      calls.push({ op: "click", id, backendNodeId });
      await maybeHold("click");
      options?.check?.();
      const tab = requireTab(id);
      const el = findElement(tab, backendNodeId);
      el?.onClick?.(tab);
      if (el?.navigatesTo) return performNavigation(tab, el.navigatesTo);
      return {};
    },
    async type(id, backendNodeId, text, options) {
      calls.push({
        op: "type",
        id,
        backendNodeId,
        text,
        submit: options?.submit,
      });
      await maybeHold("type");
      const el = findElement(requireTab(id), backendNodeId);
      if (el) el.value = text;
      return {};
    },
    async select(id, backendNodeId, values) {
      calls.push({ op: "select", id, backendNodeId, values });
      return {};
    },
    async upload(id, backendNodeId, path) {
      calls.push({ op: "upload", id, backendNodeId, path });
      return {};
    },
    async scroll(id, options) {
      calls.push({ op: "scroll", id, options });
      return {};
    },
    async wait(id, condition, options) {
      calls.push({ op: "wait", id, condition });
      const tab = requireTab(id);
      for (let poll = 0; poll < (tab.waitPolls ?? 1); poll += 1) {
        await maybeHold("wait");
        await Promise.resolve();
        options?.check?.();
      }
      return { matched: tab.waitMatches !== false };
    },
    async stopTab(id) {
      calls.push({ op: "stopTab", id });
    },
    async setControl(id, owner) {
      calls.push({ op: "setControl", id, owner });
      const tab = tabs.get(id);
      if (tab) tab.controlOwner = owner;
    },
  };
  return Object.assign(driver, { originOfUrl });
}
