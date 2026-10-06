// Preload for the dry run: redirect @playwright/test to a stub so the real driver runs without an app.
import * as nodeModule from "node:module";

const stub = new URL("./playwright-stub.mjs", import.meta.url).href;
if (typeof nodeModule.registerHooks === "function")
  nodeModule.registerHooks({
    resolve(specifier, context, nextResolve) {
      return specifier === "@playwright/test"
        ? { url: stub, shortCircuit: true }
        : nextResolve(specifier, context);
    },
  });
else nodeModule.register("./hooks.mjs", import.meta.url);
