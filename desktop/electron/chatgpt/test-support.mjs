import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createFakeOpenAi } from "../../scripts/fake-openai-siwc.mjs";
import { createChatGptService } from "../chatgpt-oauth.mjs";
import { createChatGptStore } from "./store.mjs";

export async function fixture(t, options = {}) {
  const userData = await mkdtemp(
    path.join(os.tmpdir(), "colony-chatgpt-test-"),
  );
  let clock = Date.now();
  const now = () => clock;
  const fake = await createFakeOpenAi({ now });
  const store = createChatGptStore(userData);
  const scheduled = [];
  const env = {
    COLONY_CHATGPT_PLAN: "1",
    COLONY_CHATGPT_AUTH_ORIGIN: fake.origin,
    COLONY_CHATGPT_API_ORIGIN: fake.origin,
  };
  const base = {
    userData,
    store,
    now,
    env,
    build: { enabled: false, testBuild: true },
    random: () => 0,
    timers: {
      set: (callback, ms) => {
        const item = { callback, ms };
        scheduled.push(item);
        return item;
      },
      clear: (item) => {
        if (item) item.cancelled = true;
      },
    },
    openExternal: async (url) => {
      const response = await fetch(url);
      if (response.status !== 200) throw new Error("fake_callback_failed");
    },
  };
  const services = [];
  const create = (overrides = {}) => {
    const service = createChatGptService({ ...base, ...overrides });
    services.push(service);
    return service;
  };
  const service = create(options);
  t.after(async () => {
    for (const s of services) s.stop();
    await fake.close();
    await rm(userData, { recursive: true, force: true });
  });
  const read = () => store.locked(() => store.snapshot());
  const edit = (operation) =>
    store.locked(() => {
      const state = store.snapshot();
      operation(state);
      store.save(state);
    });
  const connect = async () => {
    const result = await service.connect();
    return result.activeAccountId;
  };
  return {
    fake,
    service,
    store,
    userData,
    env,
    create,
    scheduled,
    read,
    edit,
    connect,
    now,
    advance: (ms) => {
      clock += ms;
    },
  };
}

export function deferred() {
  let resolve;
  const promise = new Promise((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

export async function waitUntil(predicate) {
  const until = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > until) throw new Error("condition_timeout");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
