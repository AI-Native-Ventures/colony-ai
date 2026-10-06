// A stand-in for @playwright/test's _electron, just enough for fresh-home-proof.mjs to run its whole
// orchestration (guards, onboarding, prompts, judging, report) against scripted data. It proves the
// driver's wiring, never the product: every "page" answer here is made up by the dry run.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const fixtureName = process.env.DRYRUN_FIXTURE ?? "brand-capture-clean.json";
const fixture = JSON.parse(
  await readFile(
    new URL(`../fixtures/${fixtureName}`, import.meta.url),
    "utf8",
  ),
);

// A disposable inbox without the network: mail.tm is replaced by canned answers.
globalThis.fetch = async (url, options = {}) => {
  const endpoint = String(url).replace("https://api.mail.tm", "");
  const body =
    endpoint === "/domains"
      ? {
          "hydra:member": [
            { domain: "example.test", isActive: true, isPrivate: false },
          ],
        }
      : endpoint === "/token"
        ? { token: "dry-run" }
        : endpoint === "/messages"
          ? { "hydra:member": [{ id: "1" }] }
          : endpoint.startsWith("/messages/")
            ? { subject: "code", text: "Your code is 123456", html: [] }
            : {};
  void options;
  return { ok: true, json: async () => body };
};

const locator = () => {
  const target = {};
  const proxy = new Proxy(target, {
    get(_t, name) {
      if (name === "then") return undefined;
      if (name === "isVisible") return async () => true;
      if (name === "isHidden") return async () => false;
      if (name === "count") return async () => 1;
      if (name === "inputValue")
        return async () => "A business that sells things";
      if (name === "innerText") return async () => "";
      if (
        [
          "waitFor",
          "click",
          "fill",
          "press",
          "pressSequentially",
          "focus",
          "evaluate",
          "scrollIntoViewIfNeeded",
        ].includes(name)
      )
        return async () => undefined;
      return () => proxy;
    },
  });
  return proxy;
};

let rowCalls = 0;
function makePage(outputDir) {
  const page = {
    isClosed: () => false,
    setViewportSize: async () => undefined,
    waitForLoadState: async () => undefined,
    screenshot: async ({ path: file }) => {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    },
    keyboard: { press: async () => undefined },
    evaluate: async (fn) => {
      const src = String(fn);
      if (src.includes("window.__brand.surfaces") && src.includes("ticks"))
        return { ticks: 5, surfaces: fixture.surfaces };
      if (src.includes("window.__brand.mode")) return undefined;
      if (src.includes("installed")) return "installed";
      if (src.includes("channel-composer-activity-row")) {
        rowCalls += 1;
        return rowCalls <= 3
          ? { row: "Checking channels", trigger: true, details: true }
          : { row: "", trigger: false, details: false };
      }
      return undefined;
    },
  };
  for (const name of [
    "getByTestId",
    "getByRole",
    "getByLabel",
    "getByText",
    "locator",
  ])
    page[name] = () => locator();
  void outputDir;
  return page;
}

export const _electron = {
  async launch(options) {
    const userDataDir = options.args
      .find((a) => a.startsWith("--user-data-dir="))
      .split("=")[1];
    const home = options.env.HOME;
    // What a fresh install does on a build with the new folder: create ~/.colony and log the choice.
    await mkdir(path.join(home, ".colony"), { recursive: true });
    await writeFile(
      options.env.COLONY_NATIVE_HOST_LOG,
      `noise\nbuzz-desktop: nest-folder: chosen=.colony reason=fresh-install path=${home}/.colony\n`,
    );
    const page = makePage(path.dirname(options.env.COLONY_NATIVE_HOST_LOG));
    return {
      evaluate: async (fn) => {
        const src = String(fn);
        if (src.includes("getVersion"))
          return {
            version: "1.0.6",
            packaged: true,
            userData: userDataDir,
            home,
            envHome: home,
          };
        if (src.includes("Notification.prototype.show")) return "hooked";
        if (src.includes("BrowserWindow")) return ["Colony"];
        return [];
      },
      firstWindow: async () => page,
      windows: () => [page],
      process: () => ({ kill() {} }),
      close: async () => undefined,
    };
  },
};
