import { createChatGptService } from "../chatgpt-oauth.mjs";
import { createChatGptRelay } from "./inference-relay.mjs";
import { ChatGptError } from "./policy.mjs";
import { createChatGptStore } from "./store.mjs";

/** Main-process lifecycle. No socket or inference state exists when disabled. */
export function createChatGptRuntime(options, dependencies = {}) {
  const createService = dependencies.createService ?? createChatGptService;
  const createRelay = dependencies.createRelay ?? createChatGptRelay;
  const store = options.store ?? createChatGptStore(options.userData);
  const service = createService({ ...options, store });
  let relay = null;
  let started;
  let closing;
  let closed = false;
  return {
    service,
    get relay() {
      if (!relay || closed) throw new ChatGptError("plan_not_ready");
      return relay;
    },
    get state() {
      if (!relay || closed) throw new ChatGptError("plan_not_ready");
      return relay.state;
    },
    start() {
      if (closed) return Promise.reject(new ChatGptError("plan_not_ready"));
      started ??= (async () => {
        try {
          await service.start();
          if (!service.policy.enabled || closed) return;
          relay = await createRelay({
            service,
            store,
            now: options.now,
            env: options.env ?? process.env,
          });
          // Shutdown can arrive while the socket is being bound.
          if (closed) await relay.close();
        } catch (error) {
          closed = true;
          service.stop();
          throw error;
        }
      })();
      return started;
    },
    close() {
      closing ??= (async () => {
        closed = true;
        service.stop();
        // Startup errors already propagate to the boot caller. Wait so a late
        // bind cannot leave a listener alive after native-host shutdown.
        await started?.catch(() => {});
        await relay?.close();
      })();
      return closing;
    },
  };
}
