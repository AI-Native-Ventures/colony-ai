import { createChatGptService } from "../chatgpt-oauth.mjs";
import { createChatGptStore } from "./store.mjs";

// Disposable fake-server driver for the cross-process rotation regression.
const userData = process.argv[2];
const store = createChatGptStore(userData);
const state = await store.locked(() => store.snapshot());
const account = state.accounts[0];
const service = createChatGptService({
  userData,
  store,
  env: {
    COLONY_CHATGPT_PLAN: "1",
    COLONY_CHATGPT_AUTH_ORIGIN: process.argv[3],
    COLONY_CHATGPT_API_ORIGIN: process.argv[3],
  },
  build: { enabled: false, testBuild: true },
});
process.send({ ready: true });
process.once("message", async () => {
  try {
    await service.refresh(account.id, account.access_token);
    process.send({ done: true });
  } catch {
    process.send({ failed: true });
    process.exitCode = 1;
  } finally {
    service.stop();
    process.disconnect();
  }
});
