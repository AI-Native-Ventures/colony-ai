# New app shell, bridge and background running (phase 1, part E) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new Electron package, `app/`, that runs the reused native host, exposes the typed ColonyBridge to a React renderer, keeps the team working from the menu bar (Mac) or tray (Windows) with the window closed, opens at login, keeps the team computer awake while plugged in, routes notifications and `colony://` links to screen IDs, updates itself (Windows installs on restart, Mac downloads), packages unsigned Mac universal and Windows x64 installers, and ships a plain engine console that exercises every bridge method.

**Architecture:** Electron main (ES modules, `.mjs`, one job per file, each with Vitest tests) owns everything privileged: the native host over stdio (a copy of the proven `NativeHost` client), relay HTTP calls that carry secrets (email code sign-in, Google sign-in, NIP-98 company creation, NIP-11), the tray, power, login item, notifications, links and updates. A sandboxed preload exposes only `window.colony`; every call crosses one IPC channel with a method allowlist and a sender check, and main checks every argument before it reaches the host. The renderer (React, Vite, TypeScript) holds a small relay WebSocket client that signs through the bridge, so the signing key never leaves the host. `main.mjs` is a thin composition root proven by a Playwright smoke test against a fake native host.

**Tech Stack:** Electron 44.4.3, electron-builder 26.15.3, electron-updater 6.8.9, esbuild 0.28.2, Node 24 (Hermit), React 19, Vite 8, TypeScript 6, Vitest 4, Playwright 1.58, nostr-tools 2.23. Rust only for three small changes in `desktop/src-tauri` (task 5.3).

**Spec:** `docs/superpowers/specs/2026-10-11-colony-os-design.md` and the screen pack `docs/superpowers/specs/2026-10-11-colony-os-screens/` (G-01, G-02, G-03, G-04l, O-09, S-07, X-11, X-14, X-15, X-20; engine items E-01, E-11 and E-27 in `10-data-and-engine.md`). Contract: `docs/superpowers/plans/2026-10-11-colony-os-engine/00-overview.md`.

## Shared code decision

Copy, do not extract. The old desktop modules worth reusing (the native host client `desktop/electron/native-host.mjs`, the updater service `desktop/electron/updater-service.mjs`, the app menu `desktop/electron/app-menu.mjs`) are copied into `app/electron/` with a provenance comment. The old app is not changed except for three host lines in task 5.3. Reasons:

1. The old app is in maintenance. A shared package would put every new-app change through the old app's CI lanes and review, and every old-app fix would risk the new app.
2. The new app deliberately differs: a typed allowlist instead of the old generic `invoke` passthrough (`desktop/electron/app-window.mjs:139-182`), a tray it owns on both platforms (the host's tray is Mac only, `desktop/src-tauri/src/lib.rs:255-259`), download-only Mac updates, and no browser broker.
3. The copies are about 700 lines of stable, tested code, and the duplication disappears when the old app is retired.


> **Integration amendments (read first):** `00-overview.md`, section "Integration decisions", items 4 (notifications are decided in main by part H; the renderer never raises G-03 notifications), 5 and 15 (agent browser deferred to E-34). Where they differ from the tasks below, the amendments win.

## Global Constraints

The overview's Global Constraints apply to every task. In addition:

- Versions match the workspace: Electron 44.4.3, electron-builder 26.15.3, electron-updater 6.8.9, semver 7.8.5, esbuild 0.28.2, React ^19.1.0, Vite ^8.0.0, TypeScript ~6.0.0, Vitest ^4.1.1, @playwright/test ^1.58.2, nostr-tools ^2.23.3.
- Package name `colony-app`, app id `global.colony.app`, product name `Colony`, data folder `Colony App` (`Colony App Dev` when not packaged). It never shares a data folder or keyring namespace with the old app (`COLONY_ELECTRON_PROFILE_ID` is derived from the new data folder).
- Every window uses `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`. The preload exposes `window.colony` and nothing else.
- No secret (the account `nsec`, a Google ID token, an email code) is ever returned to the renderer, written to disk by the shell, or logged.
- Main-process code is ES modules (`.mjs`) with JSDoc; its tests are Vitest `*.test.mjs` next to the module. Renderer code is TypeScript. The electron-builder hook is CommonJS (`.cjs`).
- Errors that reach the renderer are `BridgeError`s with a stable `code` and plain words from the screen pack; host error strings are logged (first 200 characters) and never shown.
- Installers are unsigned: Mac universal DMG and ZIP with an ad hoc seal, Windows x64 NSIS. A Mac never installs updates itself while unsigned.
- Employees run without the agent browser in this app (`COLONY_BROWSER_AGENT=0` for the host); porting the browser broker is outside this part.

## Review Focus

1. **Quit from the tray on the team computer while the renderer is hung or crashed.** Expected: a native "Quit Colony?" question appears and the team only stops after the person confirms. Pinned in task 5.11 ("asks natively when the renderer cannot answer").
2. **A payment or invite link opens Colony before the renderer has loaded.** Expected: the link is delivered to the renderer exactly once after it loads, and a second copy of the same link within 1.5 seconds is ignored. Pinned in task 5.12 ("queues links until the renderer is ready").
3. **The native host keeps crashing.** Expected: restarting the team respawns the engine at most 3 times in 10 minutes, then the person gets a plain message instead of a restart loop, and a slow old engine never replaces a newer one. Pinned in task 5.14 ("refuses a fourth restart in ten minutes", "drops an engine that started late").
4. **The laptop is unplugged, then plugged back in.** Expected: the stay-awake hold is released at once on battery and taken again on power, and never on a computer that does not run the team. Pinned in task 5.9.
5. **A sign-in answer carries the signing key.** Expected: the key goes only into the host, the returned summary and the session file never contain it, and a key whose public key does not match the account fails closed. Pinned in task 5.5.

## File structure

| File | Responsibility |
|-|-|
| `app/package.json`, `app/tsconfig.json`, `app/biome.json`, `app/vitest.config.ts`, `app/vite.config.ts`, `app/playwright.config.ts`, `app/index.html`, `app/.gitignore` | Package and tool configuration |
| `app/electron/runtime-paths.mjs` | Where the renderer, preload and native host live |
| `app/electron/native-host.mjs` | Stdio client for `colony-native-host` (copied) |
| `app/electron/bridge-errors.mjs` | `BridgeError` and its wire shape |
| `app/electron/host-commands.mjs` | Allowlisted, validated host commands and host event subscriptions |
| `app/electron/relay-http.mjs` | Accounts code sign-in, Google sign-in, NIP-98 company creation, NIP-11 |
| `app/electron/json-store.mjs` | Small JSON files written atomically |
| `app/electron/session-service.mjs` | Sign-in flows, session summary, sign-out |
| `app/electron/company-service.mjs` | Company creation from a business name |
| `app/electron/bridge-contract.mjs` | The list of bridge methods and event topics |
| `app/electron/bridge-router.mjs` | IPC handler: sender check, allowlist, error mapping |
| `app/electron/preload.cjs` | `window.colony` |
| `app/electron/login-item.mjs` | Open at login and "was this a login start" |
| `app/electron/keep-awake.mjs` | Stay awake while plugged in, team computer only |
| `app/electron/tray-model.mjs` | Pure tray state and menu items (G-02) |
| `app/electron/tray-icon.mjs` | Drawn tray glyphs, one shape per state |
| `app/electron/tray.mjs` | Electron `Tray` and `Menu` wiring |
| `app/electron/window-lifecycle.mjs` | Close to tray, first close (X-14), quit question (X-15), shutdown |
| `app/electron/navigation.mjs` | `colony://` links and screen targets, delivered once |
| `app/electron/notifications.mjs` | Computer notifications with click targets |
| `app/electron/updater-service.mjs` | Update checks and downloads (copied) |
| `app/electron/updater-runtime.mjs` | electron-updater entry, bundled to `.cjs` for packaged builds |
| `app/electron/updates.mjs` | UpdateStatus for the bridge; Mac download, Windows restart |
| `app/electron/csp.mjs` | Renderer Content-Security-Policy |
| `app/electron/build-config.mjs` | Packaging-time settings and release capabilities |
| `app/electron/engine-supervisor.mjs` | Native host start, restart budget, generation fence |
| `app/electron/purchase-resume.mjs` | Ends a credits pause after a payment link, on the team computer |
| `app/electron/app-menu.mjs` | Application menu (copied) |
| `app/electron/main.mjs` | Composition root |
| `app/src/bridge/types.ts`, `app/src/bridge/client.ts` | Renderer view of the bridge |
| `app/src/relay/nostr.ts`, `relayConnection.ts`, `conversations.ts`, `records.ts` | Minimal relay client |
| `app/src/main.tsx`, `app/src/console/EngineConsole.tsx` | Engine console |
| `app/tests/fixtures/fake-native-host.mjs`, `app/tests/e2e/engine-console.spec.ts` | Smoke test |
| `app/scripts/package-config.mjs`, `prepare-host-binaries.mjs`, `after-sign.cjs`, `package.mjs` | Unsigned installers |
| `.github/workflows/colony-app.yml`, `Justfile` | CI and local recipes |
| `desktop/src-tauri/src/electron_host/mod.rs`, `lib.rs`, `commands/identity.rs` | Host flag `COLONY_APP_SHELL` |

---

### Task 5.1: Scaffold the `app/` package and runtime paths

**Files:**
- Modify: `pnpm-workspace.yaml:1-4`
- Create: `app/package.json`, `app/biome.json`, `app/tsconfig.json`, `app/vitest.config.ts`, `app/.gitignore`, `app/electron/runtime-paths.mjs`
- Test: `app/electron/runtime-paths.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `runtimePaths({ packaged: boolean, appPath: string, resourcesPath: string, env?: Record<string, string | undefined>, platform?: NodeJS.Platform }) => { nativeHost: string, rendererRoot: string, preload: string, devUrl: string | undefined }`. Environment variables: `COLONY_NATIVE_HOST` (host override, all modes), `COLONY_APP_DEV_URL` (Vite dev server, never in packaged builds).

- [ ] **Step 1: Add the package to the workspace and create its configuration**

In `pnpm-workspace.yaml`, the `packages` list (lines 1-4) becomes:

```yaml
packages:
  - "desktop"
  - "web"
  - "admin-web"
  - "app"
```

Create `app/package.json`:

```json
{
  "name": "colony-app",
  "private": true,
  "version": "2.0.0-dev.0",
  "description": "Colony: the AI company that runs itself",
  "type": "module",
  "main": "electron/main.mjs",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "start": "electron electron/main.mjs",
    "typecheck": "tsc --noEmit",
    "check": "biome check .",
    "fix": "biome check --write .",
    "test": "vitest run",
    "test:e2e": "pnpm build && playwright test",
    "package": "node ./scripts/package.mjs"
  },
  "devDependencies": {
    "@playwright/test": "^1.58.2",
    "@types/node": "^24.0.0",
    "@types/react": "^19.1.8",
    "@types/react-dom": "^19.1.6",
    "@vitejs/plugin-react": "^6.0.0",
    "electron": "44.4.3",
    "electron-builder": "26.15.3",
    "electron-updater": "6.8.9",
    "esbuild": "0.28.2",
    "nostr-tools": "^2.23.3",
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "semver": "7.8.5",
    "typescript": "~6.0.0",
    "vite": "^8.0.0",
    "vitest": "^4.1.1"
  }
}
```

Every package is a dev dependency on purpose: the renderer is bundled by Vite, and the only runtime library main needs (electron-updater with semver) is bundled into `electron/updater-runtime.cjs` at packaging time (task 5.13), so the installer carries no `node_modules`.

Create `app/biome.json`:

```json
{
  "extends": ["../biome.json"]
}
```

Create `app/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "types": ["vite/client", "node"]
  },
  "include": ["src", "tests", "vite.config.ts", "vitest.config.ts", "playwright.config.ts"]
}
```

Create `app/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "electron/**/*.test.mjs",
      "scripts/**/*.test.mjs",
      "src/**/*.test.ts",
    ],
  },
});
```

Create `app/.gitignore`:

```gitignore
dist/
release/
test-results/
build/host/
electron/build-config.json
electron/release-capabilities.json
electron/updater-runtime.cjs
```

Run: `pnpm install`
Expected: the lockfile gains a `app` importer and the command ends without errors.

- [ ] **Step 2: Write the failing test**

Create `app/electron/runtime-paths.test.mjs`:

```js
import { describe, expect, it } from "vitest";
import { runtimePaths } from "./runtime-paths.mjs";

describe("runtimePaths", () => {
  it("uses the bundled host inside a packaged Mac app", () => {
    const paths = runtimePaths({
      packaged: true,
      appPath: "/Applications/Colony.app/Contents/Resources/app.asar",
      resourcesPath: "/Applications/Colony.app/Contents/Resources",
      env: {},
      platform: "darwin",
    });
    expect(paths.nativeHost).toBe(
      "/Applications/Colony.app/Contents/Resources/colony-native-host",
    );
    expect(paths.rendererRoot).toBe(
      "/Applications/Colony.app/Contents/Resources/app.asar/dist",
    );
    expect(paths.preload).toBe(
      "/Applications/Colony.app/Contents/Resources/app.asar/electron/preload.cjs",
    );
    expect(paths.devUrl).toBeUndefined();
  });

  it("adds .exe to the host on Windows", () => {
    const paths = runtimePaths({
      packaged: true,
      appPath: "C:\\Colony\\resources\\app.asar",
      resourcesPath: "C:\\Colony\\resources",
      env: {},
      platform: "win32",
    });
    expect(paths.nativeHost).toBe(
      "C:\\Colony\\resources\\colony-native-host.exe",
    );
  });

  it("uses the desktop debug host and the dev server in development", () => {
    const paths = runtimePaths({
      packaged: false,
      appPath: "/repo/app",
      resourcesPath: "/unused",
      env: { COLONY_APP_DEV_URL: "http://localhost:4180" },
      platform: "darwin",
    });
    expect(paths.nativeHost).toBe(
      "/repo/desktop/src-tauri/target/debug/colony-native-host",
    );
    expect(paths.devUrl).toBe("http://localhost:4180");
  });

  it("lets COLONY_NATIVE_HOST override the host everywhere", () => {
    const paths = runtimePaths({
      packaged: true,
      appPath: "/a",
      resourcesPath: "/r",
      env: { COLONY_NATIVE_HOST: "/tmp/host" },
      platform: "darwin",
    });
    expect(paths.nativeHost).toBe("/tmp/host");
  });

  it("never uses a dev server in a packaged app", () => {
    const paths = runtimePaths({
      packaged: true,
      appPath: "/a",
      resourcesPath: "/r",
      env: { COLONY_APP_DEV_URL: "http://localhost:4180" },
      platform: "darwin",
    });
    expect(paths.devUrl).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --dir app exec vitest run electron/runtime-paths.test.mjs`
Expected: FAIL, the test file cannot load `./runtime-paths.mjs` because it does not exist yet.

- [ ] **Step 4: Write minimal implementation**

Create `app/electron/runtime-paths.mjs`:

```js
import path from "node:path";

/**
 * Resolve the renderer, preload and native host for this run of the app.
 * Development uses the desktop crate's debug host build
 * (`cargo build --manifest-path desktop/src-tauri/Cargo.toml --features electron-host --bin colony-native-host`).
 */
export function runtimePaths({
  packaged,
  appPath,
  resourcesPath,
  env = process.env,
  platform = process.platform,
}) {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const suffix = platform === "win32" ? ".exe" : "";
  const nativeHost = env.COLONY_NATIVE_HOST
    ? env.COLONY_NATIVE_HOST
    : packaged
      ? pathApi.join(resourcesPath, `colony-native-host${suffix}`)
      : pathApi.join(
          appPath,
          "..",
          "desktop",
          "src-tauri",
          "target",
          "debug",
          `colony-native-host${suffix}`,
        );
  return {
    nativeHost,
    rendererRoot: pathApi.join(appPath, "dist"),
    preload: pathApi.join(appPath, "electron", "preload.cjs"),
    devUrl: packaged ? undefined : env.COLONY_APP_DEV_URL,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --dir app exec vitest run electron/runtime-paths.test.mjs`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml app/package.json app/biome.json app/tsconfig.json app/vitest.config.ts app/.gitignore app/electron/runtime-paths.mjs app/electron/runtime-paths.test.mjs
git commit -s -m "feat(app): scaffold the new Colony app package"
```

---

### Task 5.2: Native host client and the host command allowlist

**Files:**
- Create: `app/electron/native-host.mjs` (copy of `desktop/electron/native-host.mjs`, edited below), `app/electron/bridge-errors.mjs`, `app/electron/host-commands.mjs`
- Test: `app/electron/native-host.test.mjs`, `app/electron/host-commands.test.mjs`

**Interfaces:**
- Consumes: the host commands from part D (`team_set_companies`, `team_claim_status`, `team_claim`, `team_hire_complete`, `team_restart_employee`, `team_restart_all`, `team_pause`, `team_resume`, `team_status`, events `team://status` and `team://problem`) and existing host commands (`sign_event` at `desktop/src-tauri/src/commands/identity.rs:132`, `create_auth_event` :666, `import_identity` :361, `get_identity` :48, `sign_out` :561, `get_relay_ws_url` :115, `get_relay_http_url` :120, `google_desktop_sign_in` in `commands/google_auth.rs:397`). Tauri maps camelCase argument keys to the snake_case Rust parameters.
- Produces:
  - `class NativeHost extends EventEmitter` with `ready: Promise<void>`, `ended: boolean`, `request(type, params?, id?) => Promise<unknown>`, `nextId() => number`, `close() => Promise<void>`, events `event`, `channel`, `disconnected`; `nativeRequestTimeout(type, command, fallback) => number`.
  - `class BridgeError extends Error { code: string }`; `toWire(error) => { code: string, message: string }`.
  - `HOST_COMMANDS`, `HOST_EVENTS`, `RENDERER_SIGNABLE_KINDS: Set<number>`, `NIP98_KIND = 27235`.
  - `assertRelayUrl(value) => string` (returns `scheme://host[:port]`), `assertPubkey(value) => string`, `assertTimeZone(value) => string`, `validTeamCompany(value)`, `validHireInput(value)`, `validUnsignedEvent(value, allowKinds)`.
  - `createHostCommands(host) => { teamSetCompanies(companies), teamClaimStatus(relayUrl), teamClaim(relayUrl, force), teamHireComplete(input), teamRestartEmployee(agentPubkey), teamRestartAll(relayUrl), teamPause(relayUrl), teamResume(relayUrl), teamStatus(relayUrl), signEvent(input, allowKinds?), createAuthEvent({ challenge, relayUrl }), importIdentity(nsec), getIdentity(), signOut(), relayUrls() => { wsUrl, httpUrl }, googleDesktopSignIn(clientId) }`.
  - `subscribeHostEvent(host, event, handler) => Promise<() => void>`.

- [ ] **Step 1: Write the failing tests**

Create `app/electron/native-host.test.mjs`:

```js
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { NativeHost, nativeRequestTimeout } from "./native-host.mjs";

const hosts = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.fail("Test cleanup");
});

function fixture(options = {}) {
  const child = new EventEmitter();
  const requests = [];
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new Writable({
    write(chunk, _encoding, done) {
      for (const line of chunk.toString().split("\n").filter(Boolean))
        requests.push(JSON.parse(line));
      done();
    },
  });
  child.kill = () => {
    queueMicrotask(() => child.emit("exit", null, "SIGTERM"));
    return true;
  };
  const spawned = [];
  const host = new NativeHost("colony-native-host", {
    spawnProcess: (...args) => {
      spawned.push(args);
      return child;
    },
    timeout: 1000,
    ...options,
  });
  hosts.push(host);
  const send = (message) =>
    child.stdout.write(`@colony-native:${JSON.stringify(message)}\n`);
  send({ type: "ready", version: 1 });
  return { host, child, requests, send, spawned };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe("NativeHost", () => {
  it("passes the given environment and marks the Electron host", () => {
    const { spawned } = fixture({
      env: { COLONY_APP_SHELL: "1", PATH: "/bin" },
    });
    expect(spawned[0][2].env).toMatchObject({
      COLONY_APP_SHELL: "1",
      PATH: "/bin",
      COLONY_ELECTRON_HOST: "1",
    });
  });

  it("matches responses to requests by id", async () => {
    const { host, requests, send } = fixture();
    const first = host.request("invoke", {
      command: "team_status",
      args: { relayUrl: "wss://a.example" },
    });
    const second = host.request("invoke", { command: "get_identity", args: {} });
    await tick();
    send({ type: "response", id: requests[1].id, error: "no identity" });
    send({ type: "response", id: requests[0].id, result: [] });
    await expect(second).rejects.toBe("no identity");
    await expect(first).resolves.toEqual([]);
  });

  it("forwards host events", async () => {
    const { host, send } = fixture();
    const events = [];
    host.on("event", (message) => events.push(message));
    await host.ready;
    send({ type: "event", id: 7, payload: { state: "running" } });
    await tick();
    expect(events).toEqual([
      { type: "event", id: 7, payload: { state: "running" } },
    ]);
  });

  it("gives hire completion five minutes", () => {
    expect(nativeRequestTimeout("invoke", "team_hire_complete", 60_000)).toBe(
      300_000,
    );
    expect(nativeRequestTimeout("invoke", "team_status", 60_000)).toBe(60_000);
    expect(nativeRequestTimeout("listen", "team_hire_complete", 60_000)).toBe(
      60_000,
    );
  });

  it("fails every pending request when the host exits", async () => {
    const { host, child } = fixture();
    await host.ready;
    const pending = host.request("invoke", { command: "team_status", args: {} });
    child.emit("exit", 1, null);
    await expect(pending).rejects.toThrow("Native host exited");
    expect(host.ended).toBe(true);
  });
});
```

Create `app/electron/host-commands.test.mjs`:

```js
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { BridgeError } from "./bridge-errors.mjs";
import {
  HOST_COMMANDS,
  NIP98_KIND,
  assertRelayUrl,
  createHostCommands,
  subscribeHostEvent,
} from "./host-commands.mjs";

function fakeHost(results = {}) {
  const host = new EventEmitter();
  host.calls = [];
  let sequence = 0;
  host.nextId = () => {
    sequence += 1;
    return sequence;
  };
  host.request = vi.fn(async (type, params, id = host.nextId()) => {
    host.calls.push({ type, params, id });
    if (type !== "invoke") return id;
    const result = results[params.command];
    if (typeof result === "string" && result.startsWith("error:"))
      throw result.slice("error:".length);
    return result;
  });
  return host;
}

const SCOUT = "a".repeat(64);
const HOME = "9f28288a-d724-587a-9709-92dc7f967110";
const HIRE = "0b6f4d55-3b6f-4d6b-9a8c-2f8f0a4d1e11";

describe("host commands", () => {
  it("normalises company addresses and refuses unsafe ones", () => {
    expect(assertRelayUrl("wss://lerato-designs.colony.global/")).toBe(
      "wss://lerato-designs.colony.global",
    );
    expect(assertRelayUrl("ws://localhost:3000")).toBe("ws://localhost:3000");
    for (const bad of [
      "ws://example.com",
      "https://example.com",
      "wss://user:pw@example.com",
      "wss://example.com/x?y=1",
      "not a url",
    ])
      expect(() => assertRelayUrl(bad)).toThrow(BridgeError);
  });

  it("sends team commands with checked camelCase arguments", async () => {
    const host = fakeHost({ [HOST_COMMANDS.teamStatus]: [] });
    await createHostCommands(host).teamStatus(
      "wss://lerato-designs.colony.global",
    );
    expect(host.calls[0]).toMatchObject({
      type: "invoke",
      params: {
        command: "team_status",
        args: { relayUrl: "wss://lerato-designs.colony.global" },
      },
    });
  });

  it("validates hire input before it reaches the host", async () => {
    const host = fakeHost({
      [HOST_COMMANDS.teamHireComplete]: { agentPubkey: SCOUT, state: "started" },
    });
    const commands = createHostCommands(host);
    const input = {
      relayUrl: "wss://a.example",
      hireId: HIRE,
      personaId: "builtin:scout",
      displayName: "Scout",
      homeChannelId: HOME,
      timeZone: "Africa/Johannesburg",
    };
    await expect(
      commands.teamHireComplete({ ...input, hireId: "nope" }),
    ).rejects.toThrow("That hire is not valid.");
    await expect(
      commands.teamHireComplete({ ...input, timeZone: "Mars/Olympus" }),
    ).rejects.toThrow("That time zone is not valid.");
    expect(host.calls).toHaveLength(0);
    await expect(commands.teamHireComplete(input)).resolves.toEqual({
      agentPubkey: SCOUT,
      state: "started",
    });
    expect(host.calls[0].params.args).toEqual({ input });
  });

  it("signs only allowed kinds for the renderer", async () => {
    const event = {
      id: "1",
      pubkey: SCOUT,
      kind: 9,
      content: "hi",
      tags: [],
      created_at: 1,
      sig: "s",
    };
    const host = fakeHost({ [HOST_COMMANDS.signEvent]: JSON.stringify(event) });
    const commands = createHostCommands(host);
    await expect(
      commands.signEvent({ kind: 9, content: "hi", tags: [["h", "x"]] }),
    ).resolves.toEqual(event);
    await expect(
      commands.signEvent({ kind: NIP98_KIND, content: "", tags: [] }),
    ).rejects.toThrow("Colony can't sign that.");
    await expect(
      commands.signEvent(
        { kind: NIP98_KIND, content: "", tags: [] },
        new Set([NIP98_KIND]),
      ),
    ).resolves.toEqual(event);
  });

  it("turns host failures into plain words", async () => {
    const host = fakeHost({
      [HOST_COMMANDS.teamPause]: "error:agent runtime: process 4312 failed at /Users/x",
    });
    const error = await createHostCommands(host)
      .teamPause("wss://a.example")
      .catch((caught) => caught);
    expect(error).toBeInstanceOf(BridgeError);
    expect(error.code).toBe("host_failed");
    expect(error.message).not.toContain("/Users");
  });

  it("reports a stopped engine as engine_stopped", async () => {
    const host = fakeHost();
    host.request = vi.fn(async () => {
      throw new Error("Native host is disconnected: Native host exited");
    });
    await expect(
      createHostCommands(host).teamStatus("wss://a.example"),
    ).rejects.toMatchObject({ code: "engine_stopped" });
  });

  it("subscribes to host events by reserved id and unsubscribes", async () => {
    const host = fakeHost();
    const seen = [];
    const stop = await subscribeHostEvent(host, "team://status", (payload) =>
      seen.push(payload),
    );
    const listenId = host.calls[0].id;
    host.emit("event", { type: "event", id: listenId, payload: { state: "running" } });
    host.emit("event", { type: "event", id: listenId + 99, payload: { state: "other" } });
    stop();
    host.emit("event", { type: "event", id: listenId, payload: { state: "late" } });
    expect(seen).toEqual([{ state: "running" }]);
    expect(host.calls.at(-1)).toMatchObject({
      type: "unlisten",
      params: { subscription: listenId },
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --dir app exec vitest run electron/native-host.test.mjs electron/host-commands.test.mjs`
Expected: FAIL, neither `./native-host.mjs` nor `./host-commands.mjs` exists.

- [ ] **Step 3: Copy the native host client and apply four edits**

Run: `cp desktop/electron/native-host.mjs app/electron/native-host.mjs`

Then edit `app/electron/native-host.mjs`:

1. Replace line 1 (`import { browserAgentEnabled } from "./browser-broker/feature-flag.mjs";`) with:

```js
// Copied from desktop/electron/native-host.mjs at 64534835d. The new app passes
// its own complete environment and has no browser broker.
```

2. Replace the `LONG_COMMANDS` map (lines 12-19) with:

```js
const LONG_COMMANDS = new Map([
  // Native Google OAuth allows 180 seconds for the browser and 20 for exchange.
  ["google_desktop_sign_in", 210_000],
  // Creating, joining and starting a new employee can outlast one minute.
  ["team_hire_complete", 5 * 60_000],
  // Restarting every employee waits for each one to stop and start again.
  ["team_restart_all", 3 * 60_000],
]);
```

3. Delete the whole `browserNativeEnvironment` function and its doc comment (lines 26-70).

4. In the constructor's options (lines 84-92) delete the line `browserAgentHost,`, and in the `spawnProcess` call (lines 107-114) replace `...browserNativeEnvironment(env, browserAgentHost),` with `...env,`.

Create `app/electron/bridge-errors.mjs`:

```js
/**
 * A failure the renderer may show: a stable code and plain words. It never
 * carries a stack, a path, a key or a raw host message.
 */
export class BridgeError extends Error {
  /**
   * @param {string} code stable machine-readable reason
   * @param {string} message plain words for a person
   */
  constructor(code, message) {
    super(message);
    this.name = "BridgeError";
    this.code = code;
  }
}

/** The shape sent over IPC for any thrown value. */
export function toWire(error) {
  if (error instanceof BridgeError)
    return { code: error.code, message: error.message };
  return { code: "internal", message: "Something went wrong. Try again." };
}
```

- [ ] **Step 4: Write the host command allowlist**

Create `app/electron/host-commands.mjs`:

```js
import { BridgeError } from "./bridge-errors.mjs";

/** Host commands the new app may call. Nothing else reaches the native host. */
export const HOST_COMMANDS = Object.freeze({
  teamSetCompanies: "team_set_companies",
  teamClaimStatus: "team_claim_status",
  teamClaim: "team_claim",
  teamHireComplete: "team_hire_complete",
  teamRestartEmployee: "team_restart_employee",
  teamRestartAll: "team_restart_all",
  teamPause: "team_pause",
  teamResume: "team_resume",
  teamStatus: "team_status",
  signEvent: "sign_event",
  createAuthEvent: "create_auth_event",
  importIdentity: "import_identity",
  getIdentity: "get_identity",
  signOut: "sign_out",
  relayWsUrl: "get_relay_ws_url",
  relayHttpUrl: "get_relay_http_url",
  googleDesktopSignIn: "google_desktop_sign_in",
});

/** Host events the shell listens to. */
export const HOST_EVENTS = Object.freeze({
  teamStatus: "team://status",
  teamProblem: "team://problem",
});

/** NIP-98 HTTP auth. Only main signs it, never on the renderer's behalf. */
export const NIP98_KIND = 27235;

/**
 * Kinds the renderer may ask the host to sign. NIP-42 auth goes through
 * createAuthEvent. Add a kind here, with a test, when a screen needs it.
 */
export const RENDERER_SIGNABLE_KINDS = Object.freeze(
  new Set([
    0, 5, 7, 9, 9000, 9001, 9002, 9005, 9007, 9021, 9022, 30078, 40003, 47006,
    47031, 47032, 47039, 47046,
  ]),
);

const PUBKEY = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const MAX_CONTENT = 256 * 1024;

const invalid = (message) => new BridgeError("invalid_input", message);

/** A company relay address: wss anywhere, plain ws only on this computer. */
export function assertRelayUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw invalid("That company address is not valid.");
  }
  const secure = url.protocol === "wss:";
  const local = url.protocol === "ws:" && LOOPBACK.has(url.hostname);
  if (
    (!secure && !local) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  )
    throw invalid("That company address is not valid.");
  return `${url.protocol}//${url.host}`;
}

export function assertPubkey(value) {
  const text = String(value ?? "").toLowerCase();
  if (!PUBKEY.test(text)) throw invalid("That employee is not valid.");
  return text;
}

function assertUuid(value, what) {
  const text = String(value ?? "").toLowerCase();
  if (!UUID.test(text)) throw invalid(`That ${what} is not valid.`);
  return text;
}

function assertText(value, max, what) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw invalid(`That ${what} is not valid.`);
  return value;
}

export function assertTimeZone(value) {
  const zone = assertText(value, 64, "time zone");
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
  } catch {
    throw invalid("That time zone is not valid.");
  }
  return zone;
}

export function validTeamCompany(value) {
  return {
    relayUrl: assertRelayUrl(value?.relayUrl),
    ownerPubkey: assertPubkey(value?.ownerPubkey),
  };
}

export function validHireInput(value) {
  return {
    relayUrl: assertRelayUrl(value?.relayUrl),
    hireId: assertUuid(value?.hireId, "hire"),
    personaId: assertText(value?.personaId, 128, "role"),
    displayName: assertText(value?.displayName, 64, "name"),
    homeChannelId: assertUuid(value?.homeChannelId, "conversation"),
    timeZone: assertTimeZone(value?.timeZone),
  };
}

export function validUnsignedEvent(value, allowKinds) {
  const kind = value?.kind;
  if (!Number.isInteger(kind) || !allowKinds.has(kind))
    throw new BridgeError("not_allowed", "Colony can't sign that.");
  if (typeof value.content !== "string" || value.content.length > MAX_CONTENT)
    throw invalid("That message is too long.");
  if (
    !Array.isArray(value.tags) ||
    value.tags.length > 2000 ||
    value.tags.some(
      (tag) =>
        !Array.isArray(tag) ||
        tag.length === 0 ||
        tag.some((part) => typeof part !== "string" || part.length > 4096),
    )
  )
    throw invalid("That message is not valid.");
  const createdAt = value.createdAt;
  if (
    createdAt !== undefined &&
    (!Number.isSafeInteger(createdAt) || createdAt < 0)
  )
    throw invalid("That message time is not valid.");
  return {
    kind,
    content: value.content,
    tags: value.tags,
    ...(createdAt === undefined ? {} : { createdAt }),
  };
}

function hostFailure(command, error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("Native command timed out"))
    return new BridgeError("timeout", "That took too long. Try again.");
  if (
    message.startsWith("Native host is disconnected") ||
    message.startsWith("Native host exited")
  )
    return new BridgeError(
      "engine_stopped",
      "Colony's engine stopped. Restart your team to get it going again.",
    );
  if (message === "Native host is busy")
    return new BridgeError("busy", "Colony is busy. Try again in a moment.");
  console.error(
    `Colony host command ${command} failed: ${message.slice(0, 200)}`,
  );
  return new BridgeError("host_failed", "Colony couldn't finish that. Try again.");
}

/** Typed calls into the native host. Every input is checked before it leaves main. */
export function createHostCommands(host) {
  async function invoke(command, args = {}) {
    try {
      return await host.request("invoke", { command, args });
    } catch (error) {
      throw hostFailure(command, error);
    }
  }
  async function signed(command, args) {
    const json = await invoke(command, args);
    try {
      return JSON.parse(json);
    } catch {
      throw new BridgeError("host_failed", "Colony couldn't finish that. Try again.");
    }
  }
  return {
    teamSetCompanies(companies) {
      if (!Array.isArray(companies) || companies.length > 5)
        throw invalid("Colony can run up to 5 companies on one computer.");
      return invoke(HOST_COMMANDS.teamSetCompanies, {
        companies: companies.map(validTeamCompany),
      });
    },
    teamClaimStatus: async (relayUrl) =>
      invoke(HOST_COMMANDS.teamClaimStatus, { relayUrl: assertRelayUrl(relayUrl) }),
    teamClaim: async (relayUrl, force) =>
      invoke(HOST_COMMANDS.teamClaim, {
        relayUrl: assertRelayUrl(relayUrl),
        force: force === true,
      }),
    teamHireComplete: async (input) =>
      invoke(HOST_COMMANDS.teamHireComplete, { input: validHireInput(input) }),
    teamRestartEmployee: async (agentPubkey) =>
      invoke(HOST_COMMANDS.teamRestartEmployee, {
        agentPubkey: assertPubkey(agentPubkey),
      }),
    teamRestartAll: async (relayUrl) =>
      invoke(HOST_COMMANDS.teamRestartAll, { relayUrl: assertRelayUrl(relayUrl) }),
    teamPause: async (relayUrl) =>
      invoke(HOST_COMMANDS.teamPause, { relayUrl: assertRelayUrl(relayUrl) }),
    teamResume: async (relayUrl) =>
      invoke(HOST_COMMANDS.teamResume, { relayUrl: assertRelayUrl(relayUrl) }),
    teamStatus: async (relayUrl) =>
      invoke(HOST_COMMANDS.teamStatus, { relayUrl: assertRelayUrl(relayUrl) }),
    signEvent: async (input, allowKinds = RENDERER_SIGNABLE_KINDS) =>
      signed(HOST_COMMANDS.signEvent, validUnsignedEvent(input, allowKinds)),
    createAuthEvent: async (input) =>
      signed(HOST_COMMANDS.createAuthEvent, {
        challenge: assertText(input?.challenge, 512, "sign-in challenge"),
        relayUrl: assertRelayUrl(input?.relayUrl),
      }),
    importIdentity: (nsec) => invoke(HOST_COMMANDS.importIdentity, { nsec }),
    getIdentity: () => invoke(HOST_COMMANDS.getIdentity),
    signOut: () => invoke(HOST_COMMANDS.signOut),
    relayUrls: async () => ({
      wsUrl: await invoke(HOST_COMMANDS.relayWsUrl),
      httpUrl: await invoke(HOST_COMMANDS.relayHttpUrl),
    }),
    googleDesktopSignIn: async (clientId) =>
      invoke(HOST_COMMANDS.googleDesktopSignIn, {
        clientId: assertText(clientId, 256, "Google sign-in"),
      }),
  };
}

/**
 * Listen to one host event. The subscription id is reserved before listening
 * so an early push cannot be lost. Returns an unsubscribe function.
 */
export async function subscribeHostEvent(host, event, handler) {
  const id = host.nextId();
  const listener = (message) => {
    if (message.id === id) handler(message.payload);
  };
  host.on("event", listener);
  try {
    await host.request("listen", { event }, id);
  } catch (error) {
    host.off("event", listener);
    throw error;
  }
  return () => {
    host.off("event", listener);
    void host.request("unlisten", { subscription: id }).catch(() => {});
  };
}
```

The `teamSetCompanies` method is the only non-async one: its validation throws synchronously, and the router (task 5.7) awaits every handler, so a synchronous throw still becomes a `BridgeError` reply.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --dir app exec vitest run electron/native-host.test.mjs electron/host-commands.test.mjs`
Expected: PASS, 12 tests.

- [ ] **Step 6: Commit**

```bash
git add app/electron/native-host.mjs app/electron/native-host.test.mjs app/electron/bridge-errors.mjs app/electron/host-commands.mjs app/electron/host-commands.test.mjs
git commit -s -m "feat(app): native host client with a checked command allowlist"
```

---

### Task 5.3: Host flag for the new app shell

**Files:**
- Modify: `desktop/src-tauri/src/electron_host/mod.rs:20-23` (new functions after `enabled()`) and `:128-149` (tests)
- Modify: `desktop/src-tauri/src/lib.rs:255-259` (skip the host's own tray)
- Modify: `desktop/src-tauri/src/commands/identity.rs:580-585` (exit instead of restarting after sign-out)
- Test: the `tests` module in `desktop/src-tauri/src/electron_host/mod.rs`

**Interfaces:**
- Consumes: `electron_host::enabled()`.
- Produces: environment variable `COLONY_APP_SHELL=1` (set by the new app, task 5.14); `pub(crate) fn electron_host::app_shell() -> bool`. With the flag, the host installs no menu bar icon of its own, and `sign_out` ends the host process with exit code 0 after writing the reset sentinel instead of spawning a replacement host (the shell then relaunches, task 5.14). Without the flag nothing changes for the old app.

- [ ] **Step 1: Write the failing test**

In `desktop/src-tauri/src/electron_host/mod.rs`, inside `mod tests` (after `profiles_have_distinct_native_namespaces`), add:

```rust
    #[test]
    fn app_shell_flag_accepts_only_one() {
        assert!(super::app_shell_value(Some("1")));
        assert!(!super::app_shell_value(Some("0")));
        assert!(!super::app_shell_value(Some("true")));
        assert!(!super::app_shell_value(None));
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path desktop/src-tauri/Cargo.toml --no-default-features --lib electron_host::tests`
Expected: FAIL to compile with "cannot find function `app_shell_value` in the parent module". (This compiles the desktop crate; if that is too slow locally, push and let CI run it, as the overview allows.)

- [ ] **Step 3: Write minimal implementation**

In `desktop/src-tauri/src/electron_host/mod.rs`, after `pub(crate) fn enabled()` (line 23), add:

```rust
/// Whether the parent is the new Colony app (`COLONY_APP_SHELL=1`).
///
/// The new app draws its own menu bar (Mac) and tray (Windows) icon and
/// relaunches itself after sign-out, so the host must not install a second
/// icon or restart itself into a process no shell is connected to.
pub(crate) fn app_shell() -> bool {
    enabled() && app_shell_value(std::env::var("COLONY_APP_SHELL").ok().as_deref())
}

fn app_shell_value(value: Option<&str>) -> bool {
    value == Some("1")
}
```

In `desktop/src-tauri/src/lib.rs`, the block at lines 255-259 becomes:

```rust
            #[cfg(target_os = "macos")]
            {
                // The new Colony app owns its menu bar icon; never install a second one.
                if !electron_host::app_shell() {
                    tray_menu::init(&app_handle)?;
                }
                macos_notifications::init(&app_handle)?;
            }
```

In `desktop/src-tauri/src/commands/identity.rs`, inside `sign_out`, replace:

```rust
    // Tauri restarts only after normal shutdown, avoiding a single-instance
    // race. If restarting does not complete, the sentinel makes a manual open
    // finish the reset.
    app.request_restart();
    Ok(())
```

with:

```rust
    if crate::electron_host::app_shell() {
        // The new Colony app relaunches itself once the host has exited; a
        // restart here would leave a host process no shell is connected to.
        // The sentinel makes the next start finish the reset.
        app.exit(0);
    } else {
        // Tauri restarts only after normal shutdown, avoiding a single-instance
        // race. If restarting does not complete, the sentinel makes a manual open
        // finish the reset.
        app.request_restart();
    }
    Ok(())
```

The tray commands registered at `lib.rs:939-945` stay registered; nothing in the host calls them on its own (only the old app's screens do), so a missing icon is never touched.

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --manifest-path desktop/src-tauri/Cargo.toml --no-default-features --lib electron_host::tests`
Expected: PASS, 2 tests (`profiles_have_distinct_native_namespaces`, `app_shell_flag_accepts_only_one`).

Run: `cargo fmt --manifest-path desktop/src-tauri/Cargo.toml -- --check`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add desktop/src-tauri/src/electron_host/mod.rs desktop/src-tauri/src/lib.rs desktop/src-tauri/src/commands/identity.rs
git commit -s -m "feat(host): let the new app own its menu bar and relaunch after sign-out"
```

---

### Task 5.4: Relay HTTP calls that stay in main

**Files:**
- Create: `app/electron/relay-http.mjs`
- Test: `app/electron/relay-http.test.mjs`

**Interfaces:**
- Consumes: `BridgeError` (task 5.2); `NIP98_KIND` (task 5.2); a `signEvent(input, allowKinds)` function (the host commands' `signEvent`, task 5.2); the part A endpoints `POST /api/accounts/code/start` and `POST /api/accounts/code/verify`, `POST /api/accounts/google` (with optional `termsVersion`), and the existing `POST /api/communities` (`crates/buzz-relay/src/api/self_provisioning.rs:424-500`, body `{ "name": slug }`, answer `{ "community": { "id", "slug", "normalized_host", ... } }`, NIP-98 auth).
- Produces:
  - `httpUrlFromWs(wsUrl: string) => string`
  - `createRelayHttp({ baseHttpUrl, fetchImpl?, signEvent }) => { startEmailCode(email) => Promise<{ resendAfterSeconds: number }>, verifyEmailCode({ email, code, termsVersion, displayName }) => Promise<RawSession>, googleSession({ idToken, termsVersion }) => Promise<RawSession>, createCommunity(slug) => Promise<{ id: string, slug: string, normalizedHost: string }>, relaySelf(httpUrl) => Promise<string | null> }`
  - `RawSession = { account: { id: string, email: string, pubkey: string, googleLinked: boolean }, nsec: string, created: boolean }` (pubkey lower case).

- [ ] **Step 1: Write the failing test**

Create `app/electron/relay-http.test.mjs`:

```js
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { BridgeError } from "./bridge-errors.mjs";
import { createRelayHttp, httpUrlFromWs } from "./relay-http.mjs";

function jsonResponse(status, body) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const PUBKEY = "b".repeat(64);
const session = {
  account: {
    id: "acc_1",
    email: "lerato@leratodesigns.co.za",
    pubkey: PUBKEY.toUpperCase(),
    has_password: false,
    google_linked: false,
  },
  nsec: "nsec1secret",
  created: true,
};
const base = "https://relay.example";

describe("relay HTTP", () => {
  it("maps socket addresses to HTTP addresses", () => {
    expect(httpUrlFromWs("wss://lerato-designs.colony.global")).toBe(
      "https://lerato-designs.colony.global",
    );
    expect(httpUrlFromWs("ws://localhost:3000")).toBe("http://localhost:3000");
  });

  it("starts an email code and reads the resend delay", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { sent: true, resendAfterSeconds: 30 }),
    );
    const http = createRelayHttp({ baseHttpUrl: base, fetchImpl, signEvent: vi.fn() });
    await expect(http.startEmailCode("lerato@leratodesigns.co.za")).resolves.toEqual({
      resendAfterSeconds: 30,
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://relay.example/api/accounts/code/start");
    expect(JSON.parse(init.body)).toEqual({ email: "lerato@leratodesigns.co.za" });
  });

  it("returns the session with a lower-case pubkey and the created flag", async () => {
    const http = createRelayHttp({
      baseHttpUrl: base,
      fetchImpl: async () => jsonResponse(200, session),
      signEvent: vi.fn(),
    });
    const result = await http.verifyEmailCode({
      email: "lerato@leratodesigns.co.za",
      code: "482913",
      termsVersion: "2026-10-11",
      displayName: null,
    });
    expect(result).toEqual({
      account: {
        id: "acc_1",
        email: "lerato@leratodesigns.co.za",
        pubkey: PUBKEY,
        googleLinked: false,
      },
      nsec: "nsec1secret",
      created: true,
    });
  });

  it.each([
    [400, { error: "invalid_code" }, "invalid_code", "That code didn't work. Check it and try again."],
    [410, { error: "code_expired" }, "code_expired", "That code has expired."],
    [429, { error: "too_many_attempts" }, "too_many_attempts", "Too many tries. Wait 15 minutes, or continue with Google."],
    [429, { error: "rate limited" }, "rate_limited", "Too many tries. Wait a minute, then try again."],
    [503, { error: "down" }, "unreachable", "Colony isn't answering right now. Try again in a minute."],
  ])("maps HTTP %i to plain words", async (status, body, code, message) => {
    const http = createRelayHttp({
      baseHttpUrl: base,
      fetchImpl: async () => jsonResponse(status, body),
      signEvent: vi.fn(),
    });
    const error = await http
      .verifyEmailCode({ email: "a@b.co", code: "000000", termsVersion: "t" })
      .catch((caught) => caught);
    expect(error).toBeInstanceOf(BridgeError);
    expect(error).toMatchObject({ code, message });
  });

  it("reports a network failure as unreachable", async () => {
    const http = createRelayHttp({
      baseHttpUrl: base,
      fetchImpl: async () => {
        throw new TypeError("fetch failed");
      },
      signEvent: vi.fn(),
    });
    await expect(http.startEmailCode("a@b.co")).rejects.toMatchObject({
      code: "unreachable",
    });
  });

  it("signs company creation with NIP-98 over the exact URL and body", async () => {
    const signEvent = vi.fn(async (input) => ({
      ...input,
      id: "e",
      pubkey: PUBKEY,
      created_at: 1,
      sig: "s",
    }));
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        community: {
          id: "c1",
          name: "lerato-designs",
          slug: "lerato-designs",
          normalized_host: "lerato-designs.colony.global",
          owner_pubkey: PUBKEY,
        },
      }),
    );
    const http = createRelayHttp({ baseHttpUrl: base, fetchImpl, signEvent });
    await expect(http.createCommunity("lerato-designs")).resolves.toEqual({
      id: "c1",
      slug: "lerato-designs",
      normalizedHost: "lerato-designs.colony.global",
    });
    const [input, allow] = signEvent.mock.calls[0];
    expect(input.kind).toBe(27235);
    expect(allow.has(27235)).toBe(true);
    expect(input.tags.slice(0, 2)).toEqual([
      ["u", "https://relay.example/api/communities"],
      ["method", "POST"],
    ]);
    const init = fetchImpl.mock.calls[0][1];
    expect(input.tags[2]).toEqual([
      "payload",
      createHash("sha256").update(init.body).digest("hex"),
    ]);
    const header = init.headers.Authorization;
    expect(header.startsWith("Nostr ")).toBe(true);
    expect(
      JSON.parse(Buffer.from(header.slice(6), "base64").toString("utf8")).kind,
    ).toBe(27235);
  });

  it("reads the relay's own pubkey from NIP-11 and rejects bad values", async () => {
    const good = createRelayHttp({
      baseHttpUrl: base,
      fetchImpl: async () => jsonResponse(200, { self: PUBKEY.toUpperCase() }),
      signEvent: vi.fn(),
    });
    await expect(
      good.relaySelf("https://lerato-designs.colony.global"),
    ).resolves.toBe(PUBKEY);
    const bad = createRelayHttp({
      baseHttpUrl: base,
      fetchImpl: async () => jsonResponse(200, { self: "nope" }),
      signEvent: vi.fn(),
    });
    await expect(
      bad.relaySelf("https://lerato-designs.colony.global"),
    ).resolves.toBeNull();
  });

  it("refuses an answer larger than 256 KB", async () => {
    const http = createRelayHttp({
      baseHttpUrl: base,
      fetchImpl: async () => new Response("x".repeat(300 * 1024), { status: 200 }),
      signEvent: vi.fn(),
    });
    await expect(http.startEmailCode("a@b.co")).rejects.toMatchObject({
      code: "invalid_response",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir app exec vitest run electron/relay-http.test.mjs`
Expected: FAIL, `./relay-http.mjs` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `app/electron/relay-http.mjs`:

```js
import { createHash, randomUUID } from "node:crypto";
import { BridgeError } from "./bridge-errors.mjs";
import { NIP98_KIND } from "./host-commands.mjs";

const TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 256 * 1024;
const NIP98_ONLY = new Set([NIP98_KIND]);
const HEX64 = /^[0-9a-f]{64}$/;

const unreachable = () =>
  new BridgeError(
    "unreachable",
    "Colony isn't answering right now. Try again in a minute.",
  );
const invalidResponse = () =>
  new BridgeError(
    "invalid_response",
    "Colony sent an answer this app doesn't understand. Update Colony and try again.",
  );

/** `wss://host` becomes `https://host`; `ws://localhost:3000` becomes `http://localhost:3000`. */
export function httpUrlFromWs(wsUrl) {
  const url = new URL(wsUrl);
  return `${url.protocol === "ws:" ? "http:" : "https:"}//${url.host}`;
}

async function readBody(response) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw invalidResponse();
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function errorFor(status, body) {
  const code = typeof body?.error === "string" ? body.error : "";
  if (status === 400 && code === "invalid_code")
    return new BridgeError("invalid_code", "That code didn't work. Check it and try again.");
  if (status === 410) return new BridgeError("code_expired", "That code has expired.");
  if (status === 429 && code === "too_many_attempts")
    return new BridgeError(
      "too_many_attempts",
      "Too many tries. Wait 15 minutes, or continue with Google.",
    );
  if (status === 429)
    return new BridgeError("rate_limited", "Too many tries. Wait a minute, then try again.");
  if (status === 409 && code.startsWith("taken"))
    return new BridgeError("taken", "That name is taken.");
  if (status === 409 && code.startsWith("limit_reached"))
    return new BridgeError(
      "limit_reached",
      "You already run 5 companies on Colony, which is the most for now.",
    );
  if (status === 401 || status === 403)
    return new BridgeError("not_allowed", "Colony can't do that for this account yet.");
  if (status >= 500) return unreachable();
  return new BridgeError("request_failed", "That didn't work. Try again.");
}

function sessionFrom(body) {
  const account = body?.account;
  const pubkey =
    typeof account?.pubkey === "string" ? account.pubkey.toLowerCase() : "";
  if (
    typeof body?.nsec !== "string" ||
    !body.nsec ||
    typeof account?.id !== "string" ||
    typeof account?.email !== "string" ||
    !HEX64.test(pubkey) ||
    typeof account?.google_linked !== "boolean"
  )
    throw invalidResponse();
  return {
    account: {
      id: account.id,
      email: account.email,
      pubkey,
      googleLinked: account.google_linked,
    },
    nsec: body.nsec,
    created: body.created === true,
  };
}

/**
 * HTTP calls that carry secrets or need NIP-98, made from main so the
 * renderer never sees an email code, a Google token or a signing key.
 */
export function createRelayHttp({ baseHttpUrl, fetchImpl = globalThis.fetch, signEvent }) {
  async function call(method, url, body, { nip98 = false, accept = "application/json" } = {}) {
    let text = body === undefined ? undefined : JSON.stringify(body);
    try {
      const headers = { Accept: accept };
      if (text !== undefined) headers["Content-Type"] = "application/json";
      if (nip98) {
        const tags = [
          ["u", url],
          ["method", method],
        ];
        if (text !== undefined)
          tags.push(["payload", createHash("sha256").update(text).digest("hex")]);
        tags.push(["nonce", randomUUID()]);
        const event = await signEvent({ kind: NIP98_KIND, content: "", tags }, NIP98_ONLY);
        headers.Authorization = `Nostr ${Buffer.from(JSON.stringify(event)).toString("base64")}`;
      }
      let response;
      try {
        response = await fetchImpl(url, {
          method,
          headers,
          body: text,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        throw unreachable();
      }
      const raw = await readBody(response);
      let parsed = null;
      if (raw) {
        try {
          parsed = JSON.parse(raw);
        } catch {
          if (response.ok) throw invalidResponse();
        }
      }
      if (!response.ok) throw errorFor(response.status, parsed);
      return parsed;
    } finally {
      // Codes, tokens and keys are dropped as soon as the request is done.
      text = undefined;
    }
  }

  const api = (path) => `${baseHttpUrl.replace(/\/$/, "")}${path}`;

  return {
    async startEmailCode(email) {
      const body = await call("POST", api("/api/accounts/code/start"), { email });
      const seconds = Number(body?.resendAfterSeconds);
      return {
        resendAfterSeconds:
          Number.isFinite(seconds) && seconds > 0 ? Math.min(Math.round(seconds), 600) : 30,
      };
    },
    async verifyEmailCode({ email, code, termsVersion, displayName }) {
      return sessionFrom(
        await call("POST", api("/api/accounts/code/verify"), {
          email,
          code,
          termsVersion,
          displayName: displayName ?? null,
        }),
      );
    },
    async googleSession({ idToken, termsVersion }) {
      return sessionFrom(
        await call("POST", api("/api/accounts/google"), {
          id_token: idToken,
          termsVersion,
        }),
      );
    },
    async createCommunity(slug) {
      const body = await call("POST", api("/api/communities"), { name: slug }, { nip98: true });
      const community = body?.community;
      if (
        typeof community?.id !== "string" ||
        typeof community?.slug !== "string" ||
        typeof community?.normalized_host !== "string"
      )
        throw invalidResponse();
      return {
        id: community.id,
        slug: community.slug,
        normalizedHost: community.normalized_host,
      };
    },
    async relaySelf(httpUrl) {
      const body = await call("GET", `${httpUrl.replace(/\/$/, "")}/`, undefined, {
        accept: "application/nostr+json",
      });
      const self = typeof body?.self === "string" ? body.self.toLowerCase() : "";
      return HEX64.test(self) ? self : null;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir app exec vitest run electron/relay-http.test.mjs`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add app/electron/relay-http.mjs app/electron/relay-http.test.mjs
git commit -s -m "feat(app): relay sign-in, company creation and NIP-11 calls from main"
```

---

### Task 5.5: JSON store and the session service

**Files:**
- Create: `app/electron/json-store.mjs`, `app/electron/session-service.mjs`
- Test: `app/electron/json-store.test.mjs`, `app/electron/session-service.test.mjs`

**Interfaces:**
- Consumes: `BridgeError` (task 5.2); `createRelayHttp` result (task 5.4) through a `getRelayHttp()` factory; host commands `importIdentity`, `getIdentity`, `signOut`, `googleDesktopSignIn` (task 5.2).
- Produces:
  - `createJsonStore(filePath, defaults) => { read() => Promise<object>, update(patch) => Promise<object> }`
  - `createSessionService({ getRelayHttp, host, store, googleClientId }) => { startEmailCode(email), verifyEmailCode({ email, code, termsVersion, displayName? }), signInWithGoogle(termsVersion), session(), signOut() }`
  - `SessionSummary = { accountId: string, email: string, pubkey: string, googleLinked: boolean, created: boolean }` (the overview's `SessionSummary`; this part fixes its fields, see Contract changes).

- [ ] **Step 1: Write the failing tests**

Create `app/electron/json-store.test.mjs`:

```js
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createJsonStore } from "./json-store.mjs";

const dirs = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function tempFile() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "colony-store-"));
  dirs.push(dir);
  return path.join(dir, "nested", "settings.json");
}

describe("json store", () => {
  it("returns the defaults when the file is missing", async () => {
    const store = createJsonStore(tempFile(), { keepAwake: true });
    expect(await store.read()).toEqual({ keepAwake: true });
  });

  it("returns the defaults when the file is damaged", async () => {
    const file = tempFile();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "{ not json");
    expect(await createJsonStore(file, { a: 1 }).read()).toEqual({ a: 1 });
  });

  it("keeps concurrent updates in order and writes them to disk", async () => {
    const file = tempFile();
    const store = createJsonStore(file, { a: 0, b: 0 });
    await Promise.all([store.update({ a: 1 }), store.update({ b: 2 })]);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ a: 1, b: 2 });
    expect(await createJsonStore(file, { a: 0, b: 0 }).read()).toEqual({ a: 1, b: 2 });
  });
});
```

Create `app/electron/session-service.test.mjs`:

```js
import { describe, expect, it, vi } from "vitest";
import { BridgeError } from "./bridge-errors.mjs";
import { createSessionService } from "./session-service.mjs";

const PUBKEY = "b".repeat(64);
const rawSession = () => ({
  account: { id: "acc_1", email: "lerato@leratodesigns.co.za", pubkey: PUBKEY, googleLinked: false },
  nsec: "nsec1secret",
  created: true,
});

function memoryStore() {
  let data = { session: null };
  return {
    written: [],
    read: async () => data,
    update: async function update(patch) {
      data = { ...data, ...patch };
      this.written.push(JSON.stringify(data));
      return data;
    },
  };
}

function setup({ importedPubkey = PUBKEY, identityPubkey = PUBKEY } = {}) {
  const http = {
    startEmailCode: vi.fn(async () => ({ resendAfterSeconds: 30 })),
    verifyEmailCode: vi.fn(async () => rawSession()),
    googleSession: vi.fn(async () => rawSession()),
  };
  const host = {
    importIdentity: vi.fn(async () => ({ pubkey: importedPubkey })),
    getIdentity: vi.fn(async () => ({ pubkey: identityPubkey })),
    signOut: vi.fn(async () => null),
    googleDesktopSignIn: vi.fn(async () => "google-id-token"),
  };
  const store = memoryStore();
  const service = createSessionService({
    getRelayHttp: async () => http,
    host,
    store,
    googleClientId: "client-id",
  });
  return { http, host, store, service };
}

const verifyInput = {
  email: " lerato@leratodesigns.co.za ",
  code: "482913",
  termsVersion: "2026-10-11",
};

describe("session service", () => {
  it("puts the key into the host and returns a summary without it", async () => {
    const { http, host, store, service } = setup();
    const summary = await service.verifyEmailCode(verifyInput);
    expect(http.verifyEmailCode).toHaveBeenCalledWith({
      email: "lerato@leratodesigns.co.za",
      code: "482913",
      termsVersion: "2026-10-11",
      displayName: null,
    });
    expect(host.importIdentity).toHaveBeenCalledWith("nsec1secret");
    expect(summary).toEqual({
      accountId: "acc_1",
      email: "lerato@leratodesigns.co.za",
      pubkey: PUBKEY,
      googleLinked: false,
      created: true,
    });
    expect(JSON.stringify(summary)).not.toContain("nsec");
    expect(store.written.join("\n")).not.toContain("nsec");
  });

  it("fails closed when the imported key belongs to someone else", async () => {
    const { store, service } = setup({ importedPubkey: "c".repeat(64) });
    await expect(service.verifyEmailCode(verifyInput)).rejects.toMatchObject({
      code: "identity_import_failed",
    });
    expect(store.written).toHaveLength(0);
  });

  it("refuses a code that is not six digits without calling Colony", async () => {
    const { http, service } = setup();
    await expect(
      service.verifyEmailCode({ ...verifyInput, code: "12ab" }),
    ).rejects.toBeInstanceOf(BridgeError);
    expect(http.verifyEmailCode).not.toHaveBeenCalled();
  });

  it("refuses an email that does not look like one", async () => {
    const { service } = setup();
    await expect(service.startEmailCode("lerato")).rejects.toMatchObject({
      code: "invalid_email",
    });
  });

  it("signs in with Google through the host and drops the token", async () => {
    const { http, host, service } = setup();
    await service.signInWithGoogle("2026-10-11");
    expect(host.googleDesktopSignIn).toHaveBeenCalledWith("client-id");
    expect(http.googleSession).toHaveBeenCalledWith({
      idToken: "google-id-token",
      termsVersion: "2026-10-11",
    });
  });

  it("returns no session once the host holds a different key", async () => {
    const { service } = setup({ identityPubkey: "d".repeat(64) });
    await service.verifyEmailCode(verifyInput);
    await expect(service.session()).resolves.toBeNull();
  });

  it("forgets the session before the host signs out", async () => {
    const { host, store, service } = setup();
    await service.verifyEmailCode(verifyInput);
    await service.signOut();
    expect((await store.read()).session).toBeNull();
    expect(host.signOut).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --dir app exec vitest run electron/json-store.test.mjs electron/session-service.test.mjs`
Expected: FAIL, the modules do not exist.

- [ ] **Step 3: Write minimal implementation**

Create `app/electron/json-store.mjs`:

```js
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * A small JSON file in the app's data folder. Updates are serialized and
 * written to a temporary file that replaces the old one, so a crash never
 * leaves half a file. A missing or damaged file reads as the defaults.
 */
export function createJsonStore(filePath, defaults) {
  let cache = null;
  let chain = Promise.resolve();

  async function read() {
    if (cache) return cache;
    try {
      const parsed = JSON.parse(await readFile(filePath, "utf8"));
      cache = { ...defaults, ...(parsed && typeof parsed === "object" ? parsed : {}) };
    } catch (error) {
      if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
      cache = { ...defaults };
    }
    return cache;
  }

  function update(patch) {
    const next = chain.then(async () => {
      const value = { ...(await read()), ...patch };
      await mkdir(path.dirname(filePath), { recursive: true });
      const temporary = `${filePath}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
      await rename(temporary, filePath);
      cache = value;
      return value;
    });
    chain = next.catch(() => {});
    return next;
  }

  return { read, update };
}
```

Create `app/electron/session-service.mjs`:

```js
import { BridgeError } from "./bridge-errors.mjs";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TERMS_VERSION = /^[0-9A-Za-z.-]{1,32}$/;

const importFailed = () =>
  new BridgeError(
    "identity_import_failed",
    "Colony couldn't finish signing in on this computer. Try again.",
  );

function normalizeEmail(value) {
  const email = typeof value === "string" ? value.trim() : "";
  if (email.length > 254 || !EMAIL.test(email))
    throw new BridgeError("invalid_email", "That email doesn't look right. Check it and try again.");
  return email;
}

function termsVersionOf(value) {
  if (typeof value !== "string" || !TERMS_VERSION.test(value))
    throw new BridgeError(
      "invalid_input",
      "Colony couldn't record that you accepted the terms. Update Colony and try again.",
    );
  return value;
}

/**
 * Sign-in flows. The signing key goes from the relay's answer straight into
 * the host and is never stored, returned or logged by the shell.
 */
export function createSessionService({ getRelayHttp, host, store, googleClientId }) {
  async function adopt(session) {
    let nsec = session.nsec;
    session.nsec = "";
    try {
      let identity;
      try {
        identity = await host.importIdentity(nsec);
      } catch {
        throw importFailed();
      }
      if (
        typeof identity?.pubkey !== "string" ||
        identity.pubkey.toLowerCase() !== session.account.pubkey
      )
        throw importFailed();
    } finally {
      nsec = "";
    }
    const summary = {
      accountId: session.account.id,
      email: session.account.email,
      pubkey: session.account.pubkey,
      googleLinked: session.account.googleLinked,
      created: session.created === true,
    };
    await store.update({ session: summary });
    return summary;
  }

  return {
    async startEmailCode(email) {
      return (await getRelayHttp()).startEmailCode(normalizeEmail(email));
    },
    async verifyEmailCode(input) {
      const email = normalizeEmail(input?.email);
      const code = typeof input?.code === "string" ? input.code.trim() : "";
      if (!/^\d{6}$/.test(code))
        throw new BridgeError("invalid_code", "That code didn't work. Check it and try again.");
      const name = typeof input?.displayName === "string" ? input.displayName.trim() : "";
      return adopt(
        await (await getRelayHttp()).verifyEmailCode({
          email,
          code,
          termsVersion: termsVersionOf(input?.termsVersion),
          displayName: name ? name.slice(0, 64) : null,
        }),
      );
    },
    async signInWithGoogle(termsVersion) {
      const version = termsVersionOf(termsVersion);
      if (!googleClientId)
        throw new BridgeError(
          "google_unavailable",
          "Google sign-in isn't available in this version. Use your email instead.",
        );
      let idToken = await host.googleDesktopSignIn(googleClientId);
      try {
        if (typeof idToken !== "string" || !idToken)
          throw new BridgeError(
            "google_failed",
            "You closed Google sign-in. Try again, or use your email instead.",
          );
        return await adopt(
          await (await getRelayHttp()).googleSession({ idToken, termsVersion: version }),
        );
      } finally {
        idToken = "";
      }
    },
    async session() {
      const { session } = await store.read();
      if (!session) return null;
      let identity;
      try {
        identity = await host.getIdentity();
      } catch {
        return null;
      }
      return typeof identity?.pubkey === "string" &&
        identity.pubkey.toLowerCase() === session.pubkey
        ? session
        : null;
    },
    async signOut() {
      await store.update({ session: null });
      await host.signOut();
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --dir app exec vitest run electron/json-store.test.mjs electron/session-service.test.mjs`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add app/electron/json-store.mjs app/electron/json-store.test.mjs app/electron/session-service.mjs app/electron/session-service.test.mjs
git commit -s -m "feat(app): sign-in flows that keep the key inside the host"
```

---

### Task 5.6: Company creation from a business name

**Files:**
- Create: `app/electron/company-service.mjs`
- Test: `app/electron/company-service.test.mjs`

**Interfaces:**
- Consumes: `BridgeError`; `createRelayHttp(...).createCommunity(slug)` (task 5.4); host `relayUrls()` (task 5.2). Relay slug rules from `crates/buzz-relay/src/api/self_provisioning.rs:77-157` (lower case letters, digits, single hyphens, at most 63 characters, reserved names).
- Produces: `slugFromName(name) => string`, `companyRelayUrl(baseWsUrl, normalizedHost) => string`, `createCompanyService({ getRelayHttp, getRelayUrls }) => { create({ name }) => Promise<{ communityId: string, slug: string, relayUrl: string }> }`.

- [ ] **Step 1: Write the failing test**

Create `app/electron/company-service.test.mjs`:

```js
import { describe, expect, it, vi } from "vitest";
import { BridgeError } from "./bridge-errors.mjs";
import {
  companyRelayUrl,
  createCompanyService,
  slugFromName,
} from "./company-service.mjs";

const taken = () => new BridgeError("taken", "That name is taken.");

function setup(createCommunity) {
  const http = { createCommunity: vi.fn(createCommunity) };
  const service = createCompanyService({
    getRelayHttp: async () => http,
    getRelayUrls: async () => ({ wsUrl: "wss://relay.colony.global", httpUrl: "https://relay.colony.global" }),
  });
  return { http, service };
}

describe("company creation", () => {
  it("turns business names into the relay's slug rule", () => {
    expect(slugFromName("Lerato Designs")).toBe("lerato-designs");
    expect(slugFromName("Café   Ünïcode!!")).toBe("cafe-unicode");
    expect(slugFromName("   ")).toBe("my-company");
    expect(slugFromName("Help")).toBe("help-co");
    const long = slugFromName("A ".repeat(60));
    expect(long.length).toBeLessThanOrEqual(40);
    expect(long.endsWith("-")).toBe(false);
  });

  it("keeps the base relay's scheme and port", () => {
    expect(
      companyRelayUrl("wss://relay.colony.global", "lerato-designs.colony.global"),
    ).toBe("wss://lerato-designs.colony.global");
    expect(companyRelayUrl("ws://localhost:3000", "lerato-designs.localhost")).toBe(
      "ws://lerato-designs.localhost:3000",
    );
    expect(companyRelayUrl("ws://localhost:3000", "a.localhost:4000")).toBe(
      "ws://a.localhost:4000",
    );
  });

  it("tries a numbered name when the first is taken", async () => {
    const { http, service } = setup(async (slug) => {
      if (slug === "lerato-designs") throw taken();
      return { id: "c2", slug, normalizedHost: `${slug}.colony.global` };
    });
    await expect(service.create({ name: "Lerato Designs" })).resolves.toEqual({
      communityId: "c2",
      slug: "lerato-designs-2",
      relayUrl: "wss://lerato-designs-2.colony.global",
    });
    expect(http.createCommunity.mock.calls.map(([slug]) => slug)).toEqual([
      "lerato-designs",
      "lerato-designs-2",
    ]);
  });

  it("gives up after six taken names", async () => {
    const { http, service } = setup(async () => {
      throw taken();
    });
    await expect(service.create({ name: "Lerato Designs" })).rejects.toMatchObject({
      code: "taken",
    });
    expect(http.createCommunity).toHaveBeenCalledTimes(6);
  });

  it("stops at once on any other failure", async () => {
    const { http, service } = setup(async () => {
      throw new BridgeError("limit_reached", "You already run 5 companies on Colony, which is the most for now.");
    });
    await expect(service.create({ name: "Lerato Designs" })).rejects.toMatchObject({
      code: "limit_reached",
    });
    expect(http.createCommunity).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir app exec vitest run electron/company-service.test.mjs`
Expected: FAIL, `./company-service.mjs` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `app/electron/company-service.mjs`:

```js
import { BridgeError } from "./bridge-errors.mjs";

const MAX_BASE = 40;
const MAX_ATTEMPTS = 6;
// Mirrors RESERVED_SLUGS in crates/buzz-relay/src/api/self_provisioning.rs.
const RESERVED = new Set([
  "admin", "api", "app", "assets", "help", "imap", "mail", "media", "mx",
  "ns1", "ns2", "relay", "smtp", "static", "status", "support", "www",
]);

/** A web-safe company name: lower case letters, digits and single hyphens. */
export function slugFromName(name) {
  const base = String(name ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_BASE)
    .replace(/-+$/g, "");
  if (!base) return "my-company";
  return RESERVED.has(base) ? `${base}-co` : base;
}

/** The company's relay socket address, keeping the base relay's scheme and port. */
export function companyRelayUrl(baseWsUrl, normalizedHost) {
  const base = new URL(baseWsUrl);
  const port = !/:\d+$/.test(normalizedHost) && base.port ? `:${base.port}` : "";
  return `${base.protocol}//${normalizedHost}${port}`;
}

/** Create the company for a new owner, trying numbered names when one is taken. */
export function createCompanyService({ getRelayHttp, getRelayUrls }) {
  return {
    async create(input) {
      const name = typeof input?.name === "string" ? input.name.trim() : "";
      if (!name || name.length > 120)
        throw new BridgeError("invalid_input", "Business names can be up to 120 characters.");
      const http = await getRelayHttp();
      const { wsUrl } = await getRelayUrls();
      const base = slugFromName(name);
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        const slug = attempt === 1 ? base : `${base}-${attempt}`;
        try {
          const community = await http.createCommunity(slug);
          return {
            communityId: community.id,
            slug: community.slug,
            relayUrl: companyRelayUrl(wsUrl, community.normalizedHost),
          };
        } catch (error) {
          if (!(error instanceof BridgeError) || error.code !== "taken") throw error;
        }
      }
      throw new BridgeError(
        "taken",
        "That business name is taken. Add a word, like your city, and try again.",
      );
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir app exec vitest run electron/company-service.test.mjs`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add app/electron/company-service.mjs app/electron/company-service.test.mjs
git commit -s -m "feat(app): create a company from the business name"
```

---

### Task 5.7: Bridge contract, router, preload and renderer types

**Files:**
- Create: `app/electron/bridge-contract.mjs`, `app/electron/bridge-router.mjs`, `app/electron/preload.cjs`, `app/src/bridge/types.ts`, `app/src/bridge/client.ts`
- Test: `app/electron/bridge-router.test.mjs`, `app/electron/preload.test.mjs`, `app/src/bridge/client.test.ts`

**Interfaces:**
- Consumes: `BridgeError`, `toWire` (task 5.2).
- Produces:
  - `BRIDGE_CHANNEL = "colony:bridge"`, `BRIDGE_EVENT_CHANNEL = "colony:bridge-event"`, `BRIDGE_METHODS: readonly string[]`, `BRIDGE_EVENTS: readonly string[]`.
  - `createBridgeRouter({ handlers: Record<string, (...args) => unknown>, isTrustedSender: (event) => boolean }) => (event, method, args) => Promise<{ ok: true, result } | { ok: false, error: { code, message } }>`. It throws at construction when a handler is missing or unknown.
  - `window.colony: ColonyBridge` (the overview's bridge plus the additions listed under Contract changes). Pushes arrive as `{ topic, payload }` on `BRIDGE_EVENT_CHANNEL`. A failed call rejects with a plain object `{ code, message }`.
  - Renderer: `type ColonyBridge` and every payload type in `app/src/bridge/types.ts`; `bridge() => ColonyBridge`; `callBridge<T>(run: () => Promise<T>) => Promise<T>`; `class BridgeCallError extends Error { code: string }`.

- [ ] **Step 1: Write the failing tests**

Create `app/electron/bridge-router.test.mjs`:

```js
import { describe, expect, it, vi } from "vitest";
import { BRIDGE_METHODS } from "./bridge-contract.mjs";
import { BridgeError } from "./bridge-errors.mjs";
import { createBridgeRouter } from "./bridge-router.mjs";

function allHandlers(overrides = {}) {
  const handlers = Object.fromEntries(
    BRIDGE_METHODS.map((method) => [method, vi.fn(async () => method)]),
  );
  return { ...handlers, ...overrides };
}
const trusted = () => true;

describe("bridge router", () => {
  it("needs exactly one handler per method", () => {
    const missing = allHandlers();
    delete missing["team.status"];
    expect(() =>
      createBridgeRouter({ handlers: missing, isTrustedSender: trusted }),
    ).toThrow("Missing bridge handler team.status");
    expect(() =>
      createBridgeRouter({
        handlers: { ...allHandlers(), "team.extra": vi.fn() },
        isTrustedSender: trusted,
      }),
    ).toThrow("Unknown bridge handler team.extra");
  });

  it("calls the handler with the arguments", async () => {
    const handlers = allHandlers();
    const handle = createBridgeRouter({ handlers, isTrustedSender: trusted });
    await expect(handle({}, "team.claim", ["wss://a.example", true])).resolves.toEqual({
      ok: true,
      result: "team.claim",
    });
    expect(handlers["team.claim"]).toHaveBeenCalledWith("wss://a.example", true);
  });

  it("turns an empty result into null", async () => {
    const handle = createBridgeRouter({
      handlers: allHandlers({ "system.hideWindow": vi.fn(async () => undefined) }),
      isTrustedSender: trusted,
    });
    await expect(handle({}, "system.hideWindow", [])).resolves.toEqual({ ok: true, result: null });
  });

  it("blocks other frames and unknown methods", async () => {
    const blocked = createBridgeRouter({ handlers: allHandlers(), isTrustedSender: () => false });
    await expect(blocked({}, "auth.session", [])).resolves.toEqual({
      ok: false,
      error: { code: "untrusted", message: "This request was blocked." },
    });
    const open = createBridgeRouter({ handlers: allHandlers(), isTrustedSender: trusted });
    await expect(open({}, "system.exec", [])).resolves.toMatchObject({
      ok: false,
      error: { code: "unknown_method" },
    });
  });

  it("refuses oversized arguments", async () => {
    const handle = createBridgeRouter({ handlers: allHandlers(), isTrustedSender: trusted });
    await expect(handle({}, "system.notify", ["x".repeat(300 * 1024)])).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_input" },
    });
  });

  it("passes plain-word errors and hides everything else", async () => {
    const handle = createBridgeRouter({
      handlers: allHandlers({
        "auth.session": vi.fn(async () => {
          throw new BridgeError("engine_stopped", "Colony's engine stopped.");
        }),
        "team.status": vi.fn(async () => {
          throw new Error("ENOENT /Users/lerato/secret");
        }),
      }),
      isTrustedSender: trusted,
    });
    await expect(handle({}, "auth.session", [])).resolves.toEqual({
      ok: false,
      error: { code: "engine_stopped", message: "Colony's engine stopped." },
    });
    await expect(handle({}, "team.status", [])).resolves.toEqual({
      ok: false,
      error: { code: "internal", message: "Something went wrong. Try again." },
    });
  });
});
```

Create `app/electron/preload.test.mjs`:

```js
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { BRIDGE_EVENTS, BRIDGE_METHODS } from "./bridge-contract.mjs";

function loadPreload() {
  const exposed = {};
  const handlers = new Map();
  const ipcRenderer = {
    invoke: vi.fn(async (_channel, method) => ({ ok: true, result: method })),
    on: vi.fn((channel, handler) => handlers.set(channel, handler)),
  };
  const electron = {
    contextBridge: {
      exposeInMainWorld: (key, value) => {
        exposed[key] = value;
      },
    },
    ipcRenderer,
  };
  const code = readFileSync(new URL("./preload.cjs", import.meta.url), "utf8");
  vm.runInNewContext(code, {
    require: (name) => {
      if (name !== "electron") throw new Error(`unexpected require ${name}`);
      return electron;
    },
    process: { platform: "darwin" },
  });
  return { api: exposed.colony, ipcRenderer, handlers };
}

const EVENT_FUNCTIONS = {
  "team.status": ["team", "onStatus"],
  "team.problem": ["team", "onProblem"],
  "system.navigate": ["system", "onNavigate"],
  "system.firstClose": ["system", "onFirstClose"],
  "system.quitRequested": ["system", "onQuitRequested"],
  "system.update": ["system", "update", "onStatus"],
};
const at = (object, path) => path.reduce((value, key) => value?.[key], object);

describe("preload", () => {
  it("exposes one function per bridge method and calls it by name", async () => {
    const { api, ipcRenderer } = loadPreload();
    expect(api.platform).toBe("darwin");
    for (const method of BRIDGE_METHODS) {
      const fn = at(api, method.split("."));
      expect(typeof fn, method).toBe("function");
      await fn();
      expect(ipcRenderer.invoke).toHaveBeenLastCalledWith("colony:bridge", method, []);
    }
  });

  it("covers every pushed topic and routes each to its own listeners", () => {
    const { api, handlers } = loadPreload();
    expect(Object.keys(EVENT_FUNCTIONS).sort()).toEqual([...BRIDGE_EVENTS].sort());
    const deliver = handlers.get("colony:bridge-event");
    for (const topic of BRIDGE_EVENTS) {
      const seen = [];
      const stop = at(api, EVENT_FUNCTIONS[topic])((payload) => seen.push(payload));
      deliver({}, { topic, payload: { topic } });
      deliver({}, { topic: "other.topic", payload: 1 });
      stop();
      deliver({}, { topic, payload: "late" });
      expect(seen, topic).toEqual([{ topic }]);
    }
  });

  it("rejects with the plain error from main", async () => {
    const { api, ipcRenderer } = loadPreload();
    ipcRenderer.invoke.mockResolvedValueOnce({
      ok: false,
      error: { code: "invalid_code", message: "That code didn't work. Check it and try again." },
    });
    await expect(api.auth.verifyEmailCode({})).rejects.toEqual({
      code: "invalid_code",
      message: "That code didn't work. Check it and try again.",
    });
  });
});
```

Create `app/src/bridge/client.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { BridgeCallError, bridge, callBridge } from "./client";

afterEach(() => {
  delete (globalThis as { colony?: unknown }).colony;
});

describe("bridge client", () => {
  it("explains when the page runs outside the app", () => {
    expect(() => bridge()).toThrow("Open this page inside the Colony app.");
  });

  it("returns the exposed bridge", () => {
    const fake = { platform: "darwin" };
    (globalThis as { colony?: unknown }).colony = fake;
    expect(bridge()).toBe(fake);
  });

  it("turns main's error objects into BridgeCallError", async () => {
    const error = await callBridge(() =>
      Promise.reject({ code: "invalid_code", message: "That code didn't work." }),
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BridgeCallError);
    expect(error).toMatchObject({ code: "invalid_code", message: "That code didn't work." });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --dir app exec vitest run electron/bridge-router.test.mjs electron/preload.test.mjs src/bridge/client.test.ts`
Expected: FAIL, `./bridge-contract.mjs`, `./bridge-router.mjs`, `./preload.cjs` and `./client` do not exist.

- [ ] **Step 3: Write the contract, router and preload**

Create `app/electron/bridge-contract.mjs`:

```js
/** IPC channel for renderer calls into main. */
export const BRIDGE_CHANNEL = "colony:bridge";

/** IPC channel for pushes from main to the renderer. */
export const BRIDGE_EVENT_CHANNEL = "colony:bridge-event";

/** Every bridge method the renderer may call. preload.cjs and main must match (tested). */
export const BRIDGE_METHODS = Object.freeze([
  "auth.startEmailCode",
  "auth.verifyEmailCode",
  "auth.signInWithGoogle",
  "auth.session",
  "auth.signOut",
  "company.create",
  "relay.urls",
  "relay.signEvent",
  "relay.createAuthEvent",
  "relay.selfPubkey",
  "team.setCompanies",
  "team.claimStatus",
  "team.claim",
  "team.hireComplete",
  "team.restartEmployee",
  "team.restartAll",
  "team.pause",
  "team.resume",
  "team.status",
  "system.getOpenAtLogin",
  "system.setOpenAtLogin",
  "system.getKeepAwakeWhilePluggedIn",
  "system.setKeepAwakeWhilePluggedIn",
  "system.notificationPermission",
  "system.notify",
  "system.closeNotification",
  "system.setTraySummary",
  "system.hideWindow",
  "system.requestQuit",
  "system.confirmQuit",
  "system.cancelQuit",
  "system.update.status",
  "system.update.download",
  "system.update.restartToInstall",
]);

/** Topics main pushes to the renderer. */
export const BRIDGE_EVENTS = Object.freeze([
  "team.status",
  "team.problem",
  "system.navigate",
  "system.firstClose",
  "system.quitRequested",
  "system.update",
]);
```

Create `app/electron/bridge-router.mjs`:

```js
import { BRIDGE_METHODS } from "./bridge-contract.mjs";
import { BridgeError, toWire } from "./bridge-errors.mjs";

const MAX_ARGUMENT_BYTES = 256 * 1024;

/**
 * The single IPC handler for bridge calls. It refuses callers other than our
 * own top frame, methods outside the allowlist and oversized arguments, and
 * turns every failure into `{ ok: false, error: { code, message } }`.
 */
export function createBridgeRouter({ handlers, isTrustedSender }) {
  for (const method of BRIDGE_METHODS)
    if (typeof handlers[method] !== "function")
      throw new Error(`Missing bridge handler ${method}`);
  for (const method of Object.keys(handlers))
    if (!BRIDGE_METHODS.includes(method))
      throw new Error(`Unknown bridge handler ${method}`);

  return async function handleBridgeCall(event, method, args) {
    try {
      if (!isTrustedSender(event))
        throw new BridgeError("untrusted", "This request was blocked.");
      if (typeof method !== "string" || !BRIDGE_METHODS.includes(method))
        throw new BridgeError("unknown_method", "This request was blocked.");
      if (
        !Array.isArray(args) ||
        Buffer.byteLength(JSON.stringify(args)) > MAX_ARGUMENT_BYTES
      )
        throw new BridgeError("invalid_input", "That request was too large.");
      return { ok: true, result: (await handlers[method](...args)) ?? null };
    } catch (error) {
      if (!(error instanceof BridgeError))
        console.error(
          `Colony bridge ${String(method)} failed:`,
          error instanceof Error ? error.message : String(error),
        );
      return { ok: false, error: toWire(error) };
    }
  };
}
```

Create `app/electron/preload.cjs`:

```js
"use strict";

// Sandboxed preload for the new Colony app. It exposes the typed bridge
// (app/src/bridge/types.ts) as window.colony and nothing else. No Node or
// Electron object crosses this boundary. Method names must match
// app/electron/bridge-contract.mjs; preload.test.mjs checks that.
const { contextBridge, ipcRenderer } = require("electron");

const CHANNEL = "colony:bridge";
const EVENT_CHANNEL = "colony:bridge-event";
const listeners = new Map();

ipcRenderer.on(EVENT_CHANNEL, (_event, message) => {
  const callbacks = message && listeners.get(message.topic);
  if (!callbacks) return;
  for (const callback of callbacks) {
    try {
      callback(message.payload);
    } catch {
      // A throwing renderer listener must not starve the others.
    }
  }
});

async function call(name, args) {
  const reply = await ipcRenderer.invoke(CHANNEL, name, args);
  if (reply?.ok) return reply.result;
  // Errors cross the context bridge as plain objects; the renderer's
  // callBridge turns them into BridgeCallError.
  throw {
    code: reply?.error?.code || "internal",
    message: reply?.error?.message || "Something went wrong. Try again.",
  };
}

const method =
  (name) =>
  (...args) =>
    call(name, args);

const on = (topic) => (callback) => {
  if (typeof callback !== "function") throw new Error("Invalid listener");
  let callbacks = listeners.get(topic);
  if (!callbacks) {
    callbacks = new Set();
    listeners.set(topic, callbacks);
  }
  callbacks.add(callback);
  return () => callbacks.delete(callback);
};

contextBridge.exposeInMainWorld("colony", {
  platform: process.platform,
  auth: {
    startEmailCode: method("auth.startEmailCode"),
    verifyEmailCode: method("auth.verifyEmailCode"),
    signInWithGoogle: method("auth.signInWithGoogle"),
    session: method("auth.session"),
    signOut: method("auth.signOut"),
  },
  company: { create: method("company.create") },
  relay: {
    urls: method("relay.urls"),
    signEvent: method("relay.signEvent"),
    createAuthEvent: method("relay.createAuthEvent"),
    selfPubkey: method("relay.selfPubkey"),
  },
  team: {
    setCompanies: method("team.setCompanies"),
    claimStatus: method("team.claimStatus"),
    claim: method("team.claim"),
    hireComplete: method("team.hireComplete"),
    restartEmployee: method("team.restartEmployee"),
    restartAll: method("team.restartAll"),
    pause: method("team.pause"),
    resume: method("team.resume"),
    status: method("team.status"),
    onStatus: on("team.status"),
    onProblem: on("team.problem"),
  },
  system: {
    getOpenAtLogin: method("system.getOpenAtLogin"),
    setOpenAtLogin: method("system.setOpenAtLogin"),
    getKeepAwakeWhilePluggedIn: method("system.getKeepAwakeWhilePluggedIn"),
    setKeepAwakeWhilePluggedIn: method("system.setKeepAwakeWhilePluggedIn"),
    notificationPermission: method("system.notificationPermission"),
    notify: method("system.notify"),
    closeNotification: method("system.closeNotification"),
    setTraySummary: method("system.setTraySummary"),
    hideWindow: method("system.hideWindow"),
    requestQuit: method("system.requestQuit"),
    confirmQuit: method("system.confirmQuit"),
    cancelQuit: method("system.cancelQuit"),
    onNavigate: on("system.navigate"),
    onFirstClose: on("system.firstClose"),
    onQuitRequested: on("system.quitRequested"),
    update: {
      status: method("system.update.status"),
      download: method("system.update.download"),
      restartToInstall: method("system.update.restartToInstall"),
      onStatus: on("system.update"),
    },
  },
});
```

- [ ] **Step 4: Write the renderer types and client**

Create `app/src/bridge/types.ts`:

```ts
/** The bridge main exposes as `window.colony` (app/electron/preload.cjs). */
export type Unsubscribe = () => void;

export type NostrEvent = {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
};

export type UnsignedEventInput = {
  kind: number;
  content: string;
  tags: string[][];
  createdAt?: number;
};

export type SessionSummary = {
  accountId: string;
  email: string;
  pubkey: string;
  googleLinked: boolean;
  created: boolean;
};

export type TeamCompany = { relayUrl: string; ownerPubkey: string };

export type TeamComputerInfo = {
  computerId: string;
  computerName: string;
  lastSeenAt: number;
};

export type TeamComputerStatus = {
  thisComputerId: string;
  holder: TeamComputerInfo | null;
  isThisComputer: boolean;
};

export type HireCompleteInput = {
  relayUrl: string;
  hireId: string;
  personaId: string;
  displayName: string;
  homeChannelId: string;
  timeZone: string;
};

export type HireCompleteResult = {
  agentPubkey: string;
  state: "started" | "resumed" | "already_complete";
};

export type EmployeeRuntimeState =
  | "starting"
  | "running"
  | "paused"
  | "stopped"
  | "failing"
  | "away";

/** Why a paused employee is paused: a person paused it, credits ran out, or the AI plan hit its limit (part I). */
export type PauseReason = "person" | "credits" | "plan_limit";

export type EmployeeRuntimeStatus = {
  agentPubkey: string;
  name: string;
  state: EmployeeRuntimeState;
  since: number;
  restartsInWindow: number;
  /** Set while `state` is "paused". */
  pauseReason?: PauseReason;
};

/** `agentPubkey` is null when the whole engine stopped. */
export type EmployeeProblem = {
  agentPubkey: string | null;
  kind: "start_failed" | "crashed" | "crash_loop" | "credits_out";
  detail: string;
};

/** `screen` is a screen pack ID such as "T-05". */
export type NavTarget = { screen: string; id?: string };

export type AppNotification = {
  id: string;
  title: string;
  body: string;
  target: NavTarget;
};

export type UpdateStatus = {
  state: "none" | "available" | "downloading" | "ready";
  version?: string;
  installMode: "restart" | "download";
};

export type CompanyCreated = {
  communityId: string;
  slug: string;
  relayUrl: string;
};

/** What the renderer knows and the tray shows (G-02). */
export type TraySummary = {
  signedIn: boolean;
  setupFinished: boolean;
  companyName: string | null;
  relayUrl: string | null;
  statusLine: string | null;
  needsYouCount: number;
  isTeamComputer: boolean;
  teamComputerName: string | null;
  offline: boolean;
  /** Why the whole team is paused, or null. The tray offers Resume only for a person's pause. */
  teamPause: PauseReason | null;
  employees: { agentPubkey: string; name: string; statusWords: string }[];
};

export type FirstCloseEvent = { isTeamComputer: boolean; platform: string };

export interface ColonyBridge {
  platform: string;
  auth: {
    startEmailCode(email: string): Promise<{ resendAfterSeconds: number }>;
    verifyEmailCode(input: {
      email: string;
      code: string;
      termsVersion: string;
      displayName?: string;
    }): Promise<SessionSummary>;
    signInWithGoogle(termsVersion: string): Promise<SessionSummary>;
    session(): Promise<SessionSummary | null>;
    signOut(): Promise<void>;
  };
  company: { create(input: { name: string }): Promise<CompanyCreated> };
  relay: {
    urls(): Promise<{ wsUrl: string; httpUrl: string }>;
    signEvent(input: UnsignedEventInput): Promise<NostrEvent>;
    createAuthEvent(input: { challenge: string; relayUrl: string }): Promise<NostrEvent>;
    selfPubkey(relayUrl: string): Promise<string | null>;
  };
  team: {
    setCompanies(companies: TeamCompany[]): Promise<void>;
    claimStatus(relayUrl: string): Promise<TeamComputerStatus>;
    claim(relayUrl: string, force: boolean): Promise<TeamComputerStatus>;
    hireComplete(input: HireCompleteInput): Promise<HireCompleteResult>;
    restartEmployee(agentPubkey: string): Promise<void>;
    restartAll(relayUrl: string): Promise<void>;
    pause(relayUrl: string): Promise<void>;
    resume(relayUrl: string): Promise<void>;
    status(relayUrl: string): Promise<EmployeeRuntimeStatus[]>;
    onStatus(callback: (status: EmployeeRuntimeStatus) => void): Unsubscribe;
    onProblem(callback: (problem: EmployeeProblem) => void): Unsubscribe;
  };
  system: {
    getOpenAtLogin(): Promise<boolean>;
    setOpenAtLogin(on: boolean): Promise<void>;
    getKeepAwakeWhilePluggedIn(): Promise<boolean>;
    setKeepAwakeWhilePluggedIn(on: boolean): Promise<void>;
    notificationPermission(): Promise<"granted" | "denied" | "unknown">;
    notify(notification: AppNotification): Promise<void>;
    closeNotification(id: string): Promise<void>;
    setTraySummary(summary: TraySummary): Promise<void>;
    hideWindow(): Promise<void>;
    requestQuit(): Promise<void>;
    confirmQuit(): Promise<void>;
    cancelQuit(): Promise<void>;
    onNavigate(callback: (target: NavTarget) => void): Unsubscribe;
    onFirstClose(callback: (event: FirstCloseEvent) => void): Unsubscribe;
    onQuitRequested(callback: () => void): Unsubscribe;
    update: {
      status(): Promise<UpdateStatus>;
      download(): Promise<void>;
      restartToInstall(): Promise<void>;
      onStatus(callback: (status: UpdateStatus) => void): Unsubscribe;
    };
  };
}

declare global {
  interface Window {
    colony?: ColonyBridge;
  }
}
```

Create `app/src/bridge/client.ts`:

```ts
import type { ColonyBridge } from "./types";

/** A failure from main, with its stable code and plain words. */
export class BridgeCallError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BridgeCallError";
    this.code = code;
  }
}

/** The bridge, or a clear failure when this page runs outside the app. */
export function bridge(): ColonyBridge {
  const value = (globalThis as { colony?: ColonyBridge }).colony;
  if (!value) throw new BridgeCallError("no_bridge", "Open this page inside the Colony app.");
  return value;
}

/** Run a bridge call and turn main's plain error objects into BridgeCallError. */
export async function callBridge<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && "message" in error)
      throw new BridgeCallError(
        String((error as { code: unknown }).code),
        String((error as { message: unknown }).message),
      );
    throw error;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --dir app exec vitest run electron/bridge-router.test.mjs electron/preload.test.mjs src/bridge/client.test.ts`
Expected: PASS, 12 tests.

Run: `pnpm --dir app typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/electron/bridge-contract.mjs app/electron/bridge-router.mjs app/electron/bridge-router.test.mjs app/electron/preload.cjs app/electron/preload.test.mjs app/src/bridge
git commit -s -m "feat(app): typed bridge with one checked IPC channel"
```

---

### Task 5.8: Open at login

**Files:**
- Create: `app/electron/login-item.mjs`
- Test: `app/electron/login-item.test.mjs`

**Interfaces:**
- Consumes: Electron `app.getLoginItemSettings(options)` and `app.setLoginItemSettings(settings)`.
- Produces: `LOGIN_ARG = "--colony-at-login"`; `createLoginItem({ app, platform? }) => { get() => boolean, set(on: boolean) => void }`; `launchedAtLogin({ app, argv?, platform? }) => boolean`.

- [ ] **Step 1: Write the failing test**

Create `app/electron/login-item.test.mjs`:

```js
import { describe, expect, it, vi } from "vitest";
import { LOGIN_ARG, createLoginItem, launchedAtLogin } from "./login-item.mjs";

function fakeApp(settings = {}) {
  return {
    setLoginItemSettings: vi.fn(),
    getLoginItemSettings: vi.fn(() => settings),
  };
}

describe("open at login", () => {
  it("passes the login argument on Windows", () => {
    const app = fakeApp({ openAtLogin: true });
    const item = createLoginItem({ app, platform: "win32" });
    item.set(true);
    expect(app.setLoginItemSettings).toHaveBeenCalledWith({
      args: [LOGIN_ARG],
      openAtLogin: true,
    });
    expect(item.get()).toBe(true);
    expect(app.getLoginItemSettings).toHaveBeenCalledWith({ args: [LOGIN_ARG] });
  });

  it("uses plain settings on a Mac", () => {
    const app = fakeApp({ openAtLogin: false });
    const item = createLoginItem({ app, platform: "darwin" });
    item.set(false);
    expect(app.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: false });
    expect(item.get()).toBe(false);
  });

  it("knows a login start from the argument or from macOS", () => {
    expect(
      launchedAtLogin({ app: fakeApp(), argv: ["Colony.exe", LOGIN_ARG], platform: "win32" }),
    ).toBe(true);
    expect(
      launchedAtLogin({ app: fakeApp({ wasOpenedAtLogin: true }), argv: [], platform: "darwin" }),
    ).toBe(true);
    expect(
      launchedAtLogin({ app: fakeApp({ wasOpenedAtLogin: true }), argv: [], platform: "win32" }),
    ).toBe(false);
    expect(launchedAtLogin({ app: fakeApp(), argv: [], platform: "darwin" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir app exec vitest run electron/login-item.test.mjs`
Expected: FAIL, `./login-item.mjs` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `app/electron/login-item.mjs`:

```js
/** Argument Windows passes when Colony starts with the computer. */
export const LOGIN_ARG = "--colony-at-login";

/**
 * "Open Colony when this computer starts" (O-09, S-07). Windows adds
 * LOGIN_ARG so a login start can stay in the tray.
 */
export function createLoginItem({ app, platform = process.platform }) {
  const options = platform === "win32" ? { args: [LOGIN_ARG] } : {};
  return {
    get: () => app.getLoginItemSettings(options).openAtLogin === true,
    set(on) {
      app.setLoginItemSettings({ ...options, openAtLogin: on === true });
    },
  };
}

/** Whether this start came from logging in, so the window stays hidden. */
export function launchedAtLogin({ app, argv = process.argv, platform = process.platform }) {
  if (argv.includes(LOGIN_ARG)) return true;
  return platform === "darwin" && app.getLoginItemSettings().wasOpenedAtLogin === true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir app exec vitest run electron/login-item.test.mjs`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add app/electron/login-item.mjs app/electron/login-item.test.mjs
git commit -s -m "feat(app): open Colony when the computer starts"
```

---

### Task 5.9: Keep the team computer awake while plugged in

**Files:**
- Create: `app/electron/keep-awake.mjs`
- Test: `app/electron/keep-awake.test.mjs`

**Interfaces:**
- Consumes: Electron `powerSaveBlocker` (`start`, `stop`, `isStarted`) and `powerMonitor` (`isOnBatteryPower()`, events `on-ac` and `on-battery`, available on Mac and Windows).
- Produces: `createKeepAwake({ powerSaveBlocker, powerMonitor }) => { setEnabled(on), setTeamComputer(on), isActive() => boolean, dispose() }`. It holds `prevent-app-suspension` (the computer stays awake, the screen may still sleep) only when the setting is on, this computer runs the team, and it is not on battery. The old Mac-only, one-hour idle limit (`desktop/src-tauri/src/prevent_sleep.rs`) is not used by the new app.

- [ ] **Step 1: Write the failing test**

Create `app/electron/keep-awake.test.mjs`:

```js
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createKeepAwake } from "./keep-awake.mjs";

function fakes({ onBattery = false } = {}) {
  const powerMonitor = new EventEmitter();
  powerMonitor.battery = onBattery;
  powerMonitor.isOnBatteryPower = () => powerMonitor.battery;
  let next = 0;
  const started = new Set();
  const powerSaveBlocker = {
    start: vi.fn(() => {
      next += 1;
      started.add(next);
      return next;
    }),
    stop: vi.fn((id) => started.delete(id)),
    isStarted: vi.fn((id) => started.has(id)),
  };
  const keepAwake = createKeepAwake({ powerSaveBlocker, powerMonitor });
  return { powerMonitor, powerSaveBlocker, keepAwake };
}

describe("keep awake", () => {
  it("never holds the computer awake unless it runs the team", () => {
    const { powerSaveBlocker, keepAwake } = fakes();
    keepAwake.setEnabled(true);
    expect(powerSaveBlocker.start).not.toHaveBeenCalled();
    expect(keepAwake.isActive()).toBe(false);
  });

  it("holds the team computer awake on power and lets go on battery", () => {
    const { powerMonitor, powerSaveBlocker, keepAwake } = fakes();
    keepAwake.setEnabled(true);
    keepAwake.setTeamComputer(true);
    expect(powerSaveBlocker.start).toHaveBeenCalledWith("prevent-app-suspension");
    expect(keepAwake.isActive()).toBe(true);
    powerMonitor.battery = true;
    powerMonitor.emit("on-battery");
    expect(powerSaveBlocker.stop).toHaveBeenCalledOnce();
    expect(keepAwake.isActive()).toBe(false);
    powerMonitor.battery = false;
    powerMonitor.emit("on-ac");
    expect(powerSaveBlocker.start).toHaveBeenCalledTimes(2);
    expect(keepAwake.isActive()).toBe(true);
  });

  it("does not start on battery", () => {
    const { powerSaveBlocker, keepAwake } = fakes({ onBattery: true });
    keepAwake.setEnabled(true);
    keepAwake.setTeamComputer(true);
    expect(powerSaveBlocker.start).not.toHaveBeenCalled();
  });

  it("lets go when the setting is turned off", () => {
    const { powerSaveBlocker, keepAwake } = fakes();
    keepAwake.setTeamComputer(true);
    keepAwake.setEnabled(true);
    keepAwake.setEnabled(false);
    expect(powerSaveBlocker.stop).toHaveBeenCalledOnce();
    expect(keepAwake.isActive()).toBe(false);
  });

  it("stops listening and lets go when disposed", () => {
    const { powerMonitor, powerSaveBlocker, keepAwake } = fakes();
    keepAwake.setTeamComputer(true);
    keepAwake.setEnabled(true);
    keepAwake.dispose();
    expect(powerSaveBlocker.stop).toHaveBeenCalledOnce();
    expect(powerMonitor.listenerCount("on-ac")).toBe(0);
    expect(powerMonitor.listenerCount("on-battery")).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir app exec vitest run electron/keep-awake.test.mjs`
Expected: FAIL, `./keep-awake.mjs` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `app/electron/keep-awake.mjs`:

```js
/**
 * "Keep this computer awake while it's plugged in" (O-09, S-07, G-02). Only
 * the computer that runs the team is held awake, and never on battery: when
 * the laptop is unplugged the hold is released at once.
 */
export function createKeepAwake({ powerSaveBlocker, powerMonitor }) {
  let enabled = false;
  let teamComputer = false;
  let blockerId = null;

  function apply() {
    const wanted = enabled && teamComputer && !powerMonitor.isOnBatteryPower();
    if (wanted && blockerId === null) {
      blockerId = powerSaveBlocker.start("prevent-app-suspension");
    } else if (!wanted && blockerId !== null) {
      if (powerSaveBlocker.isStarted(blockerId)) powerSaveBlocker.stop(blockerId);
      blockerId = null;
    }
  }

  powerMonitor.on("on-ac", apply);
  powerMonitor.on("on-battery", apply);

  return {
    setEnabled(on) {
      enabled = on === true;
      apply();
    },
    setTeamComputer(on) {
      teamComputer = on === true;
      apply();
    },
    isActive: () => blockerId !== null,
    dispose() {
      powerMonitor.off("on-ac", apply);
      powerMonitor.off("on-battery", apply);
      enabled = false;
      apply();
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir app exec vitest run electron/keep-awake.test.mjs`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add app/electron/keep-awake.mjs app/electron/keep-awake.test.mjs
git commit -s -m "feat(app): keep the team computer awake while plugged in"
```

---

### Task 5.10: Menu bar and tray (G-02)

**Files:**
- Create: `app/electron/tray-model.mjs`, `app/electron/tray-icon.mjs`, `app/electron/tray.mjs`
- Test: `app/electron/tray-model.test.mjs`, `app/electron/tray-icon.test.mjs`, `app/electron/tray.test.mjs`

**Interfaces:**
- Consumes: `BridgeError`, `assertPubkey`, `assertRelayUrl` (task 5.2); `TraySummary` (task 5.7); `EmployeeRuntimeStatus` from the host, including part I's `pauseReason`; `UpdateStatus` (task 5.13 produces it; this task only reads `state` and `installMode`); Electron `Tray`, `Menu`, `nativeImage`, `nativeTheme`.
- Produces:
  - `validTraySummary(value) => TraySummary` (checked and trimmed).
  - `trayIconState({ summary, hostStatuses, engineStopped? }) => "normal" | "needs-you" | "paused" | "problem" | "offline"`.
  - `trayModel({ platform, summary, hostStatuses?, engineStopped?, update, keepAwake }) => { iconState, title, tooltip, items: TrayItem[] }` where `TrayItem = { id, label?, type?: "separator" | "checkbox", enabled?, checked?, action? }` and `action` is one of `{ type: "open" }`, `{ type: "navigate", target: NavTarget }`, `{ type: "pause" }`, `{ type: "resume" }`, `{ type: "toggleKeepAwake" }`, `{ type: "update" }`, `{ type: "quit" }`.
  - `TRAY_STATES`, `drawTrayGlyph(state, size, rgb?) => Buffer`, `trayImage({ nativeImage, state, platform, darkTaskbar }) => NativeImage`.
  - `menuTemplate(items, onAction)`, `createTrayController({ Tray, Menu, nativeImage, nativeTheme, platform, onAction }) => { render(model), destroy() }`.

The icon shapes drawn here are working stand-ins with one distinct shape per state, as G-02 requires. When Codex's approved tray icons exist, `trayImage` loads them instead; the states and the menu do not change.

- [ ] **Step 1: Write the failing tests**

Create `app/electron/tray-model.test.mjs`:

```js
import { describe, expect, it } from "vitest";
import { BridgeError } from "./bridge-errors.mjs";
import { trayIconState, trayModel, validTraySummary } from "./tray-model.mjs";

const NALEDI = "a".repeat(64);
const summary = (overrides = {}) => ({
  signedIn: true,
  setupFinished: true,
  companyName: "Lerato Designs",
  relayUrl: "wss://lerato-designs.colony.global",
  statusLine: "Team working",
  needsYouCount: 0,
  isTeamComputer: true,
  teamComputerName: "Lerato's MacBook Air",
  offline: false,
  teamPause: null,
  employees: [{ agentPubkey: NALEDI, name: "Naledi", statusWords: "Working" }],
  ...overrides,
});
const noUpdate = { state: "none", installMode: "download" };
const labels = (model) =>
  model.items.filter((item) => item.type !== "separator").map((item) => item.label);
const item = (model, id) => model.items.find((entry) => entry.id === id);

describe("tray model", () => {
  it("shows only sign in and quit when signed out", () => {
    const model = trayModel({ platform: "darwin", summary: null, update: noUpdate });
    expect(labels(model)).toEqual(["Signed out", "Sign in", "Quit Colony"]);
    expect(item(model, "sign-in").action).toEqual({
      type: "navigate",
      target: { screen: "O-01" },
    });
  });

  it("asks to finish setting up before first run is done", () => {
    const model = trayModel({
      platform: "darwin",
      summary: summary({ setupFinished: false }),
      update: noUpdate,
    });
    expect(labels(model)).toEqual(["Finish setting up", "Open Colony", "Quit Colony"]);
  });

  it("lists the G-02 items in order on the team computer", () => {
    const model = trayModel({
      platform: "darwin",
      summary: summary({ needsYouCount: 2 }),
      hostStatuses: [],
      update: noUpdate,
      keepAwake: true,
    });
    expect(labels(model)).toEqual([
      "Lerato Designs: Team working",
      "Needs you (2)",
      "Message Scout",
      "Open Colony",
      "Naledi: Working",
      "Pause team",
      "Keep this computer awake while plugged in",
      "Quit Colony",
    ]);
    expect(item(model, "needs-you").action).toEqual({
      type: "navigate",
      target: { screen: "T-05" },
    });
    expect(item(model, `employee-${NALEDI}`).action).toEqual({
      type: "navigate",
      target: { screen: "M-02", id: NALEDI },
    });
    expect(item(model, "keep-awake")).toMatchObject({ type: "checkbox", checked: true });
    expect(model.title).toBe("2");
    expect(model.tooltip).toBe("Colony: 2 things need you");
    expect(model.iconState).toBe("needs-you");
  });

  it("drops the stay-awake item on other computers and the title on Windows", () => {
    const model = trayModel({
      platform: "win32",
      summary: summary({ isTeamComputer: false, needsYouCount: 1 }),
      update: noUpdate,
      keepAwake: true,
    });
    expect(labels(model)).not.toContain("Keep this computer awake while plugged in");
    expect(model.title).toBe("");
    expect(model.tooltip).toBe("Colony: 1 thing needs you");
  });

  it("explains why pausing is unavailable offline", () => {
    const model = trayModel({
      platform: "darwin",
      summary: summary({ offline: true }),
      update: noUpdate,
    });
    expect(labels(model)[0]).toBe("Lerato Designs: You're offline");
    expect(item(model, "pause")).toMatchObject({
      label: "Pause team (needs the internet)",
      enabled: false,
    });
    expect(model.iconState).toBe("offline");
  });

  it("offers resume when a person paused the team", () => {
    const model = trayModel({
      platform: "darwin",
      summary: summary({ teamPause: "person", statusLine: "Team paused" }),
      update: noUpdate,
    });
    expect(item(model, "pause")).toMatchObject({
      label: "Resume team",
      action: { type: "resume" },
    });
    expect(model.iconState).toBe("paused");
  });

  it("shows a credits pause as a problem and offers no resume, since it clears by itself", () => {
    const model = trayModel({
      platform: "darwin",
      summary: summary({ employees: [], statusLine: null }),
      hostStatuses: [{ agentPubkey: NALEDI, name: "Scout", state: "paused", pauseReason: "credits" }],
      update: noUpdate,
    });
    expect(labels(model)[0]).toBe("Lerato Designs: Team paused: credits ran out");
    expect(item(model, "pause")).toBeUndefined();
    expect(model.iconState).toBe("problem");
  });

  it("offers the right update action per platform", () => {
    const windows = trayModel({
      platform: "win32",
      summary: summary(),
      update: { state: "ready", installMode: "restart" },
    });
    expect(item(windows, "update")).toMatchObject({ label: "Restart to update" });
    const mac = trayModel({
      platform: "darwin",
      summary: summary(),
      update: { state: "available", version: "2.0.1", installMode: "download" },
    });
    expect(item(mac, "update")).toMatchObject({ label: "Download update" });
  });

  it("falls back to the host's statuses when the renderer sent no employees", () => {
    const model = trayModel({
      platform: "darwin",
      summary: summary({ employees: [], statusLine: null }),
      hostStatuses: [{ agentPubkey: NALEDI, name: "Scout", state: "running" }],
      update: noUpdate,
    });
    expect(labels(model)).toContain("Scout: Working");
    expect(labels(model)[0]).toBe("Lerato Designs: Team working");
  });

  it("picks the icon by priority", () => {
    expect(
      trayIconState({
        summary: summary({ offline: true, needsYouCount: 3 }),
        hostStatuses: [{ state: "failing" }],
        engineStopped: true,
      }),
    ).toBe("offline");
    expect(
      trayIconState({ summary: summary({ needsYouCount: 3 }), hostStatuses: [{ state: "failing" }] }),
    ).toBe("problem");
    expect(
      trayIconState({ summary: summary({ needsYouCount: 3 }), hostStatuses: [], engineStopped: true }),
    ).toBe("problem");
    expect(
      trayIconState({ summary: summary({ needsYouCount: 3, teamPause: "person" }), hostStatuses: [] }),
    ).toBe("paused");
    expect(
      trayIconState({ summary: summary({ needsYouCount: 3, teamPause: "credits" }), hostStatuses: [] }),
    ).toBe("problem");
    expect(
      trayIconState({
        summary: summary({ needsYouCount: 3 }),
        hostStatuses: [{ state: "paused", pauseReason: "plan_limit" }],
      }),
    ).toBe("problem");
    expect(trayIconState({ summary: summary({ needsYouCount: 3 }), hostStatuses: [] })).toBe(
      "needs-you",
    );
    expect(trayIconState({ summary: summary(), hostStatuses: [] })).toBe("normal");
  });

  it("checks and trims the renderer's summary", () => {
    expect(() =>
      validTraySummary({
        ...summary(),
        employees: [{ agentPubkey: "nope", name: "x", statusWords: "y" }],
      }),
    ).toThrow(BridgeError);
    const valid = validTraySummary({
      ...summary(),
      needsYouCount: 5000,
      companyName: "x".repeat(500),
      teamPause: "sleepy",
    });
    expect(valid.needsYouCount).toBe(999);
    expect(valid.companyName).toHaveLength(120);
    expect(valid.teamPause).toBeNull();
  });
});
```

Create `app/electron/tray-icon.test.mjs`:

```js
import { describe, expect, it, vi } from "vitest";
import { TRAY_STATES, drawTrayGlyph, trayImage } from "./tray-icon.mjs";

describe("tray icon", () => {
  it("draws every state at the asked size with a visible shape", () => {
    for (const state of TRAY_STATES) {
      const pixels = drawTrayGlyph(state, 16);
      expect(pixels.length).toBe(16 * 16 * 4);
      let visible = 0;
      for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) visible += 1;
      expect(visible, state).toBeGreaterThan(20);
    }
  });

  it("gives each state its own shape", () => {
    const shapes = TRAY_STATES.map((state) => drawTrayGlyph(state, 32).toString("base64"));
    expect(new Set(shapes).size).toBe(TRAY_STATES.length);
  });

  it("paints the glyph in the given colour", () => {
    const pixels = drawTrayGlyph("normal", 16, [255, 255, 255]);
    expect([pixels[0], pixels[1], pixels[2]]).toEqual([255, 255, 255]);
  });

  it("refuses an unknown state", () => {
    expect(() => drawTrayGlyph("sparkly", 16)).toThrow("Unknown tray state sparkly");
  });

  it("makes a template image on a Mac and a light glyph on a dark Windows taskbar", () => {
    const image = { addRepresentation: vi.fn(), setTemplateImage: vi.fn() };
    const nativeImage = { createFromBitmap: vi.fn(() => image) };
    trayImage({ nativeImage, state: "normal", platform: "darwin", darkTaskbar: true });
    expect(image.setTemplateImage).toHaveBeenCalledWith(true);
    const [macPixels, options] = nativeImage.createFromBitmap.mock.calls[0];
    expect(options).toEqual({ width: 16, height: 16, scaleFactor: 1 });
    expect(macPixels[0]).toBe(0);
    expect(image.addRepresentation).toHaveBeenCalledWith(
      expect.objectContaining({ scaleFactor: 2, width: 32, height: 32 }),
    );
    nativeImage.createFromBitmap.mockClear();
    image.setTemplateImage.mockClear();
    trayImage({ nativeImage, state: "normal", platform: "win32", darkTaskbar: true });
    expect(nativeImage.createFromBitmap.mock.calls[0][0][0]).toBe(255);
    expect(image.setTemplateImage).not.toHaveBeenCalled();
  });
});
```

Create `app/electron/tray.test.mjs`:

```js
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createTrayController } from "./tray.mjs";

function fakes(platform) {
  const instances = [];
  class Tray {
    constructor(image) {
      this.image = image;
      this.handlers = {};
      instances.push(this);
    }
    on(event, handler) {
      this.handlers[event] = handler;
    }
    setImage(image) {
      this.image = image;
    }
    setToolTip(text) {
      this.tooltip = text;
    }
    setTitle(text) {
      this.title = text;
    }
    setContextMenu(menu) {
      this.menu = menu;
    }
    destroy() {
      this.destroyed = true;
    }
  }
  const Menu = { buildFromTemplate: (template) => template };
  const nativeImage = {
    createFromBitmap: () => ({ addRepresentation() {}, setTemplateImage() {} }),
  };
  const nativeTheme = new EventEmitter();
  nativeTheme.shouldUseDarkColors = false;
  const onAction = vi.fn();
  const controller = createTrayController({ Tray, Menu, nativeImage, nativeTheme, platform, onAction });
  return { instances, controller, onAction, nativeTheme };
}

const model = {
  iconState: "needs-you",
  title: "2",
  tooltip: "Colony: 2 things need you",
  items: [
    { id: "needs-you", label: "Needs you (2)", action: { type: "navigate", target: { screen: "T-05" } } },
    { id: "s1", type: "separator" },
    {
      id: "keep-awake",
      type: "checkbox",
      label: "Keep this computer awake while plugged in",
      checked: true,
      action: { type: "toggleKeepAwake" },
    },
    { id: "header", label: "Lerato Designs: Team working", enabled: false },
  ],
};

describe("tray controller", () => {
  it("builds the menu and turns clicks into actions", () => {
    const { instances, controller, onAction } = fakes("darwin");
    controller.render(model);
    const [tray] = instances;
    expect(tray.title).toBe("2");
    expect(tray.tooltip).toBe("Colony: 2 things need you");
    tray.menu[0].click();
    expect(onAction).toHaveBeenCalledWith({ type: "navigate", target: { screen: "T-05" } });
    expect(tray.menu[1]).toEqual({ type: "separator" });
    expect(tray.menu[2]).toMatchObject({ type: "checkbox", checked: true });
    expect(tray.menu[3]).toMatchObject({ enabled: false });
    expect(tray.menu[3].click).toBeUndefined();
  });

  it("opens the window on a Windows click and sets no title", () => {
    const { instances, controller, onAction } = fakes("win32");
    controller.render(model);
    instances[0].handlers.click();
    expect(onAction).toHaveBeenCalledWith({ type: "open" });
    expect(instances[0].title).toBeUndefined();
  });

  it("reuses one icon and redraws when the theme changes", () => {
    const { instances, controller, nativeTheme } = fakes("darwin");
    controller.render(model);
    controller.render({ ...model, iconState: "normal" });
    nativeTheme.emit("updated");
    expect(instances).toHaveLength(1);
  });

  it("removes the icon when destroyed", () => {
    const { instances, controller, nativeTheme } = fakes("darwin");
    controller.render(model);
    controller.destroy();
    expect(instances[0].destroyed).toBe(true);
    expect(nativeTheme.listenerCount("updated")).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --dir app exec vitest run electron/tray-model.test.mjs electron/tray-icon.test.mjs electron/tray.test.mjs`
Expected: FAIL, the three modules do not exist.

- [ ] **Step 3: Write the tray model**

Create `app/electron/tray-model.mjs`:

```js
import { BridgeError } from "./bridge-errors.mjs";
import { assertPubkey, assertRelayUrl } from "./host-commands.mjs";

const STATE_WORDS = {
  starting: "Starting",
  running: "Working",
  paused: "Paused",
  stopped: "Stopped",
  failing: "Stopped",
  away: "Away",
};

const text = (value, max) => (typeof value === "string" ? value.slice(0, max) : null);
const PAUSE_REASONS = new Set(["person", "credits", "plan_limit"]);

/** Check and trim the renderer's summary before the tray shows it. */
export function validTraySummary(value) {
  if (!value || typeof value !== "object")
    throw new BridgeError("invalid_input", "That team summary is not valid.");
  const employees = Array.isArray(value.employees)
    ? value.employees.slice(0, 50).map((employee) => ({
        agentPubkey: assertPubkey(employee?.agentPubkey),
        name: text(employee?.name, 40) ?? "",
        statusWords: text(employee?.statusWords, 80) ?? "",
      }))
    : [];
  const count = value.needsYouCount;
  return {
    signedIn: value.signedIn === true,
    setupFinished: value.setupFinished === true,
    companyName: text(value.companyName, 120),
    relayUrl: value.relayUrl ? assertRelayUrl(value.relayUrl) : null,
    statusLine: text(value.statusLine, 120),
    needsYouCount: Number.isSafeInteger(count) && count > 0 ? Math.min(count, 999) : 0,
    isTeamComputer: value.isTeamComputer === true,
    teamComputerName: text(value.teamComputerName, 80),
    offline: value.offline === true,
    teamPause: PAUSE_REASONS.has(value.teamPause) ? value.teamPause : null,
    employees,
  };
}

const stoppedState = (status) => status.state === "failing" || status.state === "stopped";
// Credits and plan limits are team problems in G-02 and clear by themselves
// (G-04c), so Resume could not help. Only a person's pause shows as paused.
const clearsByItself = (reason) => reason === "credits" || reason === "plan_limit";

/**
 * Why the whole team is paused, or null: the host's answer when every
 * employee is paused (part I's pauseReason; a pause with no reason is a
 * person's), otherwise the renderer's.
 */
function pauseReasonOf(summary, hostStatuses) {
  if (hostStatuses.length > 0 && hostStatuses.every((status) => status.state === "paused"))
    return hostStatuses.find((status) => status.pauseReason)?.pauseReason ?? "person";
  return summary?.teamPause ?? null;
}

/** offline, then problem, then paused, then needs-you, then normal (G-02 icon states). */
export function trayIconState({ summary, hostStatuses, engineStopped = false }) {
  if (summary?.offline) return "offline";
  const pause = pauseReasonOf(summary, hostStatuses);
  if (engineStopped || hostStatuses.some(stoppedState) || clearsByItself(pause)) return "problem";
  if (pause === "person") return "paused";
  if ((summary?.needsYouCount ?? 0) > 0) return "needs-you";
  return "normal";
}

function fallbackStatusLine(summary, hostStatuses, engineStopped) {
  if (engineStopped) return "Team stopped";
  if (hostStatuses.some(stoppedState)) return "Someone on your team stopped";
  const pause = pauseReasonOf(summary, hostStatuses);
  if (pause === "credits") return "Team paused: credits ran out";
  if (pause === "plan_limit") return "Team paused: plan limit reached";
  if (pause === "person") return "Team paused";
  return "Team working";
}

function employeeItems(summary, hostStatuses) {
  const lines =
    summary.employees.length > 0
      ? summary.employees.map((employee) => ({
          agentPubkey: employee.agentPubkey,
          label: `${employee.name}: ${employee.statusWords}`,
        }))
      : hostStatuses.map((status) => ({
          agentPubkey: status.agentPubkey,
          label: `${status.name}: ${STATE_WORDS[status.state] ?? "Starting"}`,
        }));
  return lines.map((line) => ({
    id: `employee-${line.agentPubkey}`,
    label: line.label,
    action: { type: "navigate", target: { screen: "M-02", id: line.agentPubkey } },
  }));
}

/** The menu bar (Mac) or tray (Windows) menu, from G-02, as plain data. */
export function trayModel({
  platform,
  summary,
  hostStatuses = [],
  engineStopped = false,
  update,
  keepAwake,
}) {
  const quit = { id: "quit", label: "Quit Colony", action: { type: "quit" } };
  const open = { id: "open", label: "Open Colony", action: { type: "open" } };
  const separator = (id) => ({ id, type: "separator" });

  if (!summary?.signedIn)
    return {
      iconState: "normal",
      title: "",
      tooltip: "Colony: signed out",
      items: [
        { id: "header", label: "Signed out", enabled: false },
        { id: "sign-in", label: "Sign in", action: { type: "navigate", target: { screen: "O-01" } } },
        separator("s1"),
        quit,
      ],
    };

  if (!summary.setupFinished)
    return {
      iconState: "normal",
      title: "",
      tooltip: "Colony: finish setting up",
      items: [
        { id: "header", label: "Finish setting up", action: { type: "open" } },
        open,
        separator("s1"),
        quit,
      ],
    };

  const iconState = trayIconState({ summary, hostStatuses, engineStopped });
  const statusLine = summary.offline
    ? "You're offline"
    : summary.statusLine || fallbackStatusLine(summary, hostStatuses, engineStopped);
  const count = summary.needsYouCount;
  const items = [
    {
      id: "header",
      label: summary.companyName ? `${summary.companyName}: ${statusLine}` : statusLine,
      enabled: false,
    },
    count > 0
      ? {
          id: "needs-you",
          label: `Needs you (${count})`,
          action: { type: "navigate", target: { screen: "T-05" } },
        }
      : { id: "needs-you", label: "Nothing needs you", enabled: false },
    {
      id: "message-scout",
      label: "Message Scout",
      action: { type: "navigate", target: { screen: "T-04" } },
    },
    open,
    separator("s1"),
    ...employeeItems(summary, hostStatuses),
    separator("s2"),
  ];
  const pause = pauseReasonOf(summary, hostStatuses);
  if (summary.relayUrl && !clearsByItself(pause)) {
    const word = pause === "person" ? "Resume team" : "Pause team";
    items.push(
      summary.offline
        ? { id: "pause", label: `${word} (needs the internet)`, enabled: false }
        : {
            id: "pause",
            label: word,
            action: { type: pause === "person" ? "resume" : "pause" },
          },
    );
  }
  if (summary.isTeamComputer)
    items.push({
      id: "keep-awake",
      type: "checkbox",
      label: "Keep this computer awake while plugged in",
      checked: keepAwake === true,
      action: { type: "toggleKeepAwake" },
    });
  if (update?.state === "ready" && update.installMode === "restart")
    items.push({ id: "update", label: "Restart to update", action: { type: "update" } });
  if (update?.state === "available" && update.installMode === "download")
    items.push({ id: "update", label: "Download update", action: { type: "update" } });
  items.push(separator("s3"), quit);

  const tooltip =
    iconState === "needs-you"
      ? `Colony: ${count === 1 ? "1 thing needs you" : `${count} things need you`}`
      : `Colony: ${statusLine}`;
  return {
    iconState,
    title: platform === "darwin" && count > 0 ? String(count) : "",
    tooltip,
    items,
  };
}
```

- [ ] **Step 4: Write the icon and the controller**

Create `app/electron/tray-icon.mjs`:

```js
/** Tray icon states (G-02). Each differs in shape, not only in colour. */
export const TRAY_STATES = Object.freeze(["normal", "needs-you", "paused", "problem", "offline"]);

const SAMPLES = 4;
const distance = (x, y, size) => Math.hypot(x - size / 2, y - size / 2);
const inRing = (x, y, size) => {
  const d = distance(x, y, size);
  return d <= size * 0.42 && d >= size * 0.31;
};
const inRect = (x, y, size, [left, top, right, bottom]) =>
  x >= size * left && x <= size * right && y >= size * top && y <= size * bottom;

const SHAPES = {
  normal: (x, y, s) => inRing(x, y, s) || distance(x, y, s) <= s * 0.1,
  "needs-you": (x, y, s) => inRing(x, y, s) || distance(x, y, s) <= s * 0.2,
  paused: (x, y, s) =>
    inRing(x, y, s) ||
    inRect(x, y, s, [0.36, 0.33, 0.45, 0.67]) ||
    inRect(x, y, s, [0.55, 0.33, 0.64, 0.67]),
  problem: (x, y, s) =>
    inRing(x, y, s) ||
    inRect(x, y, s, [0.45, 0.27, 0.55, 0.57]) ||
    inRect(x, y, s, [0.45, 0.64, 0.55, 0.73]),
  offline: (x, y, s) =>
    (inRing(x, y, s) && !(x > s * 0.5 && y < s * 0.5)) ||
    (Math.abs(x - y) <= s * 0.07 && distance(x, y, s) <= s * 0.42),
};

/** Pixels for one glyph, four bytes per pixel; the shape lives in the alpha byte. */
export function drawTrayGlyph(state, size, rgb = [0, 0, 0]) {
  const inside = SHAPES[state];
  if (!inside) throw new Error(`Unknown tray state ${state}`);
  const pixels = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let covered = 0;
      for (let sy = 0; sy < SAMPLES; sy += 1)
        for (let sx = 0; sx < SAMPLES; sx += 1)
          if (inside(px + (sx + 0.5) / SAMPLES, py + (sy + 0.5) / SAMPLES, size)) covered += 1;
      const index = (py * size + px) * 4;
      pixels[index] = rgb[0];
      pixels[index + 1] = rgb[1];
      pixels[index + 2] = rgb[2];
      pixels[index + 3] = Math.round((covered * 255) / (SAMPLES * SAMPLES));
    }
  }
  return pixels;
}

/** A template image on a Mac; a light or dark glyph to match the Windows taskbar. */
export function trayImage({ nativeImage, state, platform, darkTaskbar }) {
  const rgb = platform !== "darwin" && darkTaskbar ? [255, 255, 255] : [0, 0, 0];
  const image = nativeImage.createFromBitmap(drawTrayGlyph(state, 16, rgb), {
    width: 16,
    height: 16,
    scaleFactor: 1,
  });
  image.addRepresentation({
    scaleFactor: 2,
    width: 32,
    height: 32,
    buffer: drawTrayGlyph(state, 32, rgb),
  });
  if (platform === "darwin") image.setTemplateImage(true);
  return image;
}
```

Create `app/electron/tray.mjs`:

```js
import { trayImage } from "./tray-icon.mjs";

/** Turn tray items into an Electron menu template; clicks become actions. */
export function menuTemplate(items, onAction) {
  return items.map((item) =>
    item.type === "separator"
      ? { type: "separator" }
      : {
          label: item.label,
          type: item.type === "checkbox" ? "checkbox" : "normal",
          ...(item.type === "checkbox" ? { checked: item.checked === true } : {}),
          enabled: item.enabled !== false,
          ...(item.action ? { click: () => onAction(item.action) } : {}),
        },
  );
}

/** The menu bar (Mac) or tray (Windows) icon and its menu. */
export function createTrayController({ Tray, Menu, nativeImage, nativeTheme, platform, onAction }) {
  let tray = null;
  let last = null;
  const darkTaskbar = () =>
    nativeTheme.shouldUseDarkColorsForSystemIntegratedUI ?? nativeTheme.shouldUseDarkColors;

  function render(model) {
    last = model;
    const image = trayImage({ nativeImage, state: model.iconState, platform, darkTaskbar: darkTaskbar() });
    if (!tray) {
      tray = new Tray(image);
      // The usual Windows habit: a click opens the window; the menu is on right-click.
      if (platform === "win32") tray.on("click", () => onAction({ type: "open" }));
    } else {
      tray.setImage(image);
    }
    tray.setToolTip(model.tooltip);
    if (platform === "darwin") tray.setTitle(model.title);
    tray.setContextMenu(Menu.buildFromTemplate(menuTemplate(model.items, onAction)));
  }

  const redraw = () => {
    if (last && tray) render(last);
  };
  nativeTheme.on("updated", redraw);

  return {
    render,
    destroy() {
      nativeTheme.off("updated", redraw);
      tray?.destroy();
      tray = null;
    },
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --dir app exec vitest run electron/tray-model.test.mjs electron/tray-icon.test.mjs electron/tray.test.mjs`
Expected: PASS, 20 tests.

- [ ] **Step 6: Commit**

```bash
git add app/electron/tray-model.mjs app/electron/tray-model.test.mjs app/electron/tray-icon.mjs app/electron/tray-icon.test.mjs app/electron/tray.mjs app/electron/tray.test.mjs
git commit -s -m "feat(app): menu bar and tray menu with one icon shape per state"
```

---

### Task 5.11: Close to the tray, first close and the quit question

**Files:**
- Create: `app/electron/window-lifecycle.mjs`
- Test: `app/electron/window-lifecycle.test.mjs`

**Interfaces:**
- Consumes: a settings store with `read()` and `update(patch)` (task 5.5, `firstCloseExplained`); `sendEvent(topic, payload)`, `revealWindow()`, `isTeamComputer()`, `askNativeQuit() => Promise<boolean>`, `quitNow() => Promise<void>`, `stopForUpdate() => Promise<void>` from main (task 5.14).
- Produces: `createWindowLifecycle(deps) => { attach(window), isQuitting(), hideAfterExplaining(), requestQuit(), confirmQuit(), cancelQuit(), prepareForUpdate(), onBeforeQuit(event), onSystemShutdown() }`. Pushes `system.firstClose` with `{ isTeamComputer, platform }` (X-14) and `system.quitRequested` with `{}` (X-15).

- [ ] **Step 1: Write the failing test**

Create `app/electron/window-lifecycle.test.mjs`:

```js
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createWindowLifecycle } from "./window-lifecycle.mjs";

function fakeWindow() {
  const window = new EventEmitter();
  window.hide = vi.fn();
  window.isDestroyed = () => false;
  window.webContents = { isCrashed: vi.fn(() => false) };
  return window;
}

function setup({ teamComputer = true, explained = false, nativeAnswer = true } = {}) {
  const window = fakeWindow();
  let stored = { firstCloseExplained: explained };
  const settings = {
    read: vi.fn(async () => stored),
    update: vi.fn(async (patch) => {
      stored = { ...stored, ...patch };
      return stored;
    }),
  };
  const deps = {
    getWindow: () => window,
    settings,
    sendEvent: vi.fn(),
    revealWindow: vi.fn(),
    isTeamComputer: () => teamComputer,
    askNativeQuit: vi.fn(async () => nativeAnswer),
    quitNow: vi.fn(async () => {}),
    stopForUpdate: vi.fn(async () => {}),
    platform: "darwin",
  };
  const lifecycle = createWindowLifecycle(deps);
  lifecycle.attach(window);
  return { window, settings, deps, lifecycle };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));
const quitEvent = () => ({ preventDefault: vi.fn() });

describe("window lifecycle", () => {
  it("explains the first close instead of hiding", async () => {
    const { window, deps } = setup();
    const event = quitEvent();
    window.emit("close", event);
    await flush();
    expect(event.preventDefault).toHaveBeenCalled();
    expect(deps.sendEvent).toHaveBeenCalledWith("system.firstClose", {
      isTeamComputer: true,
      platform: "darwin",
    });
    expect(window.hide).not.toHaveBeenCalled();
  });

  it("hides after the explanation and on every later close", async () => {
    const { window, lifecycle, settings } = setup();
    await lifecycle.hideAfterExplaining();
    expect(settings.update).toHaveBeenCalledWith({ firstCloseExplained: true });
    expect(window.hide).toHaveBeenCalledTimes(1);
    window.emit("close", quitEvent());
    await flush();
    expect(window.hide).toHaveBeenCalledTimes(2);
  });

  it("hides without explaining when the renderer crashed", async () => {
    const { window, deps } = setup();
    window.webContents.isCrashed.mockReturnValue(true);
    window.emit("close", quitEvent());
    await flush();
    expect(window.hide).toHaveBeenCalled();
    expect(deps.sendEvent).not.toHaveBeenCalled();
  });

  it("quits at once on a computer that does not run the team", async () => {
    const { lifecycle, deps } = setup({ teamComputer: false });
    lifecycle.requestQuit();
    await flush();
    expect(deps.quitNow).toHaveBeenCalledOnce();
    expect(deps.sendEvent).not.toHaveBeenCalled();
  });

  it("asks through the renderer on the team computer", async () => {
    const { lifecycle, deps } = setup();
    lifecycle.requestQuit();
    await flush();
    expect(deps.revealWindow).toHaveBeenCalled();
    expect(deps.sendEvent).toHaveBeenCalledWith("system.quitRequested", {});
    expect(deps.quitNow).not.toHaveBeenCalled();
    lifecycle.confirmQuit();
    await flush();
    expect(deps.quitNow).toHaveBeenCalledOnce();
  });

  it("asks natively when the renderer cannot answer", async () => {
    const { window, lifecycle, deps } = setup({ nativeAnswer: true });
    window.emit("unresponsive");
    lifecycle.requestQuit();
    await flush();
    expect(deps.askNativeQuit).toHaveBeenCalledOnce();
    expect(deps.quitNow).toHaveBeenCalledOnce();
  });

  it("keeps working when the native question is declined", async () => {
    const { window, lifecycle, deps } = setup({ nativeAnswer: false });
    window.emit("unresponsive");
    lifecycle.requestQuit();
    await flush();
    expect(deps.quitNow).not.toHaveBeenCalled();
  });

  it("quits without asking when the computer shuts down", async () => {
    const { window, deps } = setup();
    window.emit("session-end");
    await flush();
    expect(deps.quitNow).toHaveBeenCalledOnce();
    expect(deps.sendEvent).not.toHaveBeenCalledWith("system.quitRequested", {});
  });

  it("turns Cmd+Q into the quit question and lets the real quit through", async () => {
    const { lifecycle, deps } = setup();
    const first = quitEvent();
    lifecycle.onBeforeQuit(first);
    expect(first.preventDefault).toHaveBeenCalled();
    lifecycle.confirmQuit();
    await flush();
    const second = quitEvent();
    lifecycle.onBeforeQuit(second);
    expect(second.preventDefault).not.toHaveBeenCalled();
    expect(deps.quitNow).toHaveBeenCalledOnce();
  });

  it("stops the engine for an update without asking", async () => {
    const { lifecycle, deps } = setup();
    await lifecycle.prepareForUpdate();
    expect(deps.stopForUpdate).toHaveBeenCalledOnce();
    const event = quitEvent();
    lifecycle.onBeforeQuit(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir app exec vitest run electron/window-lifecycle.test.mjs`
Expected: FAIL, `./window-lifecycle.mjs` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `app/electron/window-lifecycle.mjs`:

```js
/**
 * Window and quit rules (G-01, X-14, X-15). Closing hides the window and the
 * team keeps working. The first close on this computer asks the renderer to
 * explain that once. Quitting on the team computer asks first: through the
 * renderer when it can answer, through a native question when it cannot. A
 * computer that is shutting down quits without asking.
 */
export function createWindowLifecycle({
  getWindow,
  settings,
  sendEvent,
  revealWindow,
  isTeamComputer,
  askNativeQuit,
  quitNow,
  stopForUpdate,
  platform,
}) {
  let quitting = false;
  let shuttingDown = false;
  let unresponsive = false;

  function rendererCanAnswer() {
    const window = getWindow();
    return Boolean(
      window && !window.isDestroyed() && !window.webContents.isCrashed() && !unresponsive,
    );
  }

  async function quit() {
    if (quitting) return;
    quitting = true;
    await quitNow();
  }

  function requestQuit() {
    if (quitting) return;
    if (shuttingDown || !isTeamComputer()) {
      void quit();
      return;
    }
    if (rendererCanAnswer()) {
      revealWindow();
      sendEvent("system.quitRequested", {});
      return;
    }
    void askNativeQuit().then((confirmed) => (confirmed ? quit() : undefined));
  }

  function onSystemShutdown() {
    shuttingDown = true;
    void quit();
  }

  return {
    isQuitting: () => quitting,
    attach(window) {
      window.on("close", (event) => {
        if (quitting) return;
        event.preventDefault();
        void settings
          .read()
          .then(({ firstCloseExplained }) => {
            if (firstCloseExplained || !rendererCanAnswer()) window.hide();
            else sendEvent("system.firstClose", { isTeamComputer: isTeamComputer(), platform });
          })
          .catch(() => window.hide());
      });
      window.on("unresponsive", () => {
        unresponsive = true;
      });
      window.on("responsive", () => {
        unresponsive = false;
      });
      // Windows reports the end of a session (log off, shut down) on the window.
      window.on("session-end", onSystemShutdown);
    },
    async hideAfterExplaining() {
      await settings.update({ firstCloseExplained: true });
      getWindow()?.hide();
    },
    requestQuit,
    confirmQuit() {
      void quit();
    },
    cancelQuit() {},
    async prepareForUpdate() {
      // The person already chose "Restart to update"; nothing else may ask.
      quitting = true;
      await stopForUpdate();
    },
    onBeforeQuit(event) {
      if (quitting) return;
      event.preventDefault();
      requestQuit();
    },
    onSystemShutdown,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir app exec vitest run electron/window-lifecycle.test.mjs`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add app/electron/window-lifecycle.mjs app/electron/window-lifecycle.test.mjs
git commit -s -m "feat(app): close to the tray and ask before quitting the team computer"
```

---

### Task 5.12: Links and notifications that open screens

**Files:**
- Create: `app/electron/navigation.mjs`, `app/electron/notifications.mjs`
- Test: `app/electron/navigation.test.mjs`, `app/electron/notifications.test.mjs`

**Interfaces:**
- Consumes: `BridgeError`; Electron `Notification` (`isSupported()`, events `click` and `close`, `show()`, `close()`).
- Produces:
  - `SCREEN_ID` (screen pack ID pattern), `validNavTarget(value) => NavTarget`, `navTargetFromLink(link) => NavTarget | null` for `colony://open?screen=<ID>&id=<id>`, `colony://join?invite=<code>` (P-01) and `colony://payment?status=success|cancelled` (S-02).
  - `createNavigator({ deliver, revealWindow, onLink?, now?, dedupeMs? }) => { navigate(target), openLink(link) => boolean, openFromArgv(argv) => boolean, setReady(), setNotReady() }` (at most 16 waiting targets). `onLink(target)` hears each accepted link once, at once, even before the renderer has loaded.
  - `createNotifier({ Notification, navigate }) => { permission() => "unknown" | "denied", notify(notification), close(id) }` (at most 50 on screen).

- [ ] **Step 1: Write the failing tests**

Create `app/electron/navigation.test.mjs`:

```js
import { describe, expect, it, vi } from "vitest";
import { BridgeError } from "./bridge-errors.mjs";
import { createNavigator, navTargetFromLink, validNavTarget } from "./navigation.mjs";

describe("links", () => {
  it("reads the three link forms", () => {
    expect(navTargetFromLink("colony://open?screen=T-05")).toEqual({ screen: "T-05" });
    expect(navTargetFromLink(`colony://open?screen=M-02&id=${"a".repeat(64)}`)).toEqual({
      screen: "M-02",
      id: "a".repeat(64),
    });
    expect(navTargetFromLink("colony://join?invite=abcDEF12_-")).toEqual({
      screen: "P-01",
      id: "abcDEF12_-",
    });
    expect(navTargetFromLink("colony://payment?status=success")).toEqual({
      screen: "S-02",
      id: "success",
    });
  });

  it("ignores the renderer origin, other schemes and bad values", () => {
    for (const link of [
      "colony://app/",
      "https://colony.global/open?screen=T-05",
      "colony://open?screen=Z-99",
      "colony://join?invite=short",
      "colony://payment?status=maybe",
      `colony://open?screen=T-05&id=${"x".repeat(300)}`,
      `colony://open?screen=T-05&x=${"y".repeat(5000)}`,
    ])
      expect(navTargetFromLink(link), link).toBeNull();
  });

  it("checks targets from notifications", () => {
    expect(() => validNavTarget({ screen: "T-05; drop" })).toThrow(BridgeError);
    expect(validNavTarget({ screen: "C-18", id: "x" })).toEqual({ screen: "C-18", id: "x" });
    expect(validNavTarget({ screen: "D-05a" })).toEqual({ screen: "D-05a" });
  });
});

describe("navigator", () => {
  it("queues links until the renderer is ready, then delivers each once", () => {
    const deliver = vi.fn();
    const revealWindow = vi.fn();
    let time = 1000;
    const navigator = createNavigator({ deliver, revealWindow, now: () => time });
    navigator.openLink("colony://payment?status=success");
    navigator.openLink("colony://payment?status=success");
    expect(deliver).not.toHaveBeenCalled();
    navigator.setReady();
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith({ screen: "S-02", id: "success" });
    time += 2000;
    navigator.openLink("colony://payment?status=success");
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(revealWindow).toHaveBeenCalled();
  });

  it("tells main about each accepted link once, before the renderer is ready", () => {
    const onLink = vi.fn();
    const navigator = createNavigator({ deliver: vi.fn(), revealWindow: vi.fn(), onLink });
    navigator.openLink("colony://payment?status=success");
    navigator.openLink("colony://payment?status=success");
    navigator.openLink("colony://payment?status=maybe");
    expect(onLink).toHaveBeenCalledTimes(1);
    expect(onLink).toHaveBeenCalledWith({ screen: "S-02", id: "success" });
  });

  it("keeps at most 16 waiting targets", () => {
    const deliver = vi.fn();
    const navigator = createNavigator({ deliver, revealWindow: vi.fn() });
    for (let index = 0; index < 20; index += 1)
      navigator.navigate({ screen: "T-05", id: String(index) });
    navigator.setReady();
    expect(deliver).toHaveBeenCalledTimes(16);
    expect(deliver.mock.calls[0][0]).toEqual({ screen: "T-05", id: "4" });
  });

  it("finds links among launch arguments", () => {
    const deliver = vi.fn();
    const navigator = createNavigator({ deliver, revealWindow: vi.fn() });
    navigator.setReady();
    expect(
      navigator.openFromArgv(["Colony.exe", "--colony-at-login", "colony://open?screen=T-01"]),
    ).toBe(true);
    expect(deliver).toHaveBeenCalledWith({ screen: "T-01" });
    expect(navigator.openFromArgv(["Colony.exe"])).toBe(false);
  });
});
```

Create `app/electron/notifications.test.mjs`:

```js
import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BridgeError } from "./bridge-errors.mjs";
import { createNotifier } from "./notifications.mjs";

class FakeNotification extends EventEmitter {
  static supported = true;
  static created = [];
  static isSupported() {
    return FakeNotification.supported;
  }
  constructor(options) {
    super();
    this.options = options;
    this.shown = false;
    this.closed = false;
    FakeNotification.created.push(this);
  }
  show() {
    this.shown = true;
  }
  close() {
    this.closed = true;
    this.emit("close");
  }
}

beforeEach(() => {
  FakeNotification.created = [];
  FakeNotification.supported = true;
});

const note = (overrides = {}) => ({
  id: "decision:1",
  title: "Scout",
  body: "Naledi's posts for next week are ready for your OK.",
  target: { screen: "T-05", id: "ask-1" },
  ...overrides,
});

describe("notifications", () => {
  it("shows a notification that opens its target", () => {
    const navigate = vi.fn();
    const notifier = createNotifier({ Notification: FakeNotification, navigate });
    notifier.notify(note());
    const [shown] = FakeNotification.created;
    expect(shown.options).toEqual({
      title: "Scout",
      body: "Naledi's posts for next week are ready for your OK.",
    });
    expect(shown.shown).toBe(true);
    shown.emit("click");
    expect(navigate).toHaveBeenCalledWith({ screen: "T-05", id: "ask-1" });
  });

  it("replaces a notification with the same id and closes on request", () => {
    const notifier = createNotifier({ Notification: FakeNotification, navigate: vi.fn() });
    notifier.notify(note());
    notifier.notify(note());
    expect(FakeNotification.created[0].closed).toBe(true);
    expect(FakeNotification.created[1].closed).toBe(false);
    notifier.close("decision:1");
    expect(FakeNotification.created[1].closed).toBe(true);
  });

  it("keeps at most 50 on screen", () => {
    const notifier = createNotifier({ Notification: FakeNotification, navigate: vi.fn() });
    for (let index = 0; index < 55; index += 1) notifier.notify(note({ id: `n:${index}` }));
    expect(FakeNotification.created.slice(0, 5).every((item) => item.closed)).toBe(true);
    expect(FakeNotification.created[5].closed).toBe(false);
  });

  it("refuses bad notifications", () => {
    const notifier = createNotifier({ Notification: FakeNotification, navigate: vi.fn() });
    expect(() => notifier.notify(note({ title: "" }))).toThrow(BridgeError);
    expect(() => notifier.notify(note({ target: { screen: "nowhere" } }))).toThrow(BridgeError);
    expect(() => notifier.notify(note({ id: "bad id with spaces" }))).toThrow(BridgeError);
  });

  it("reports what Electron can know about permission", () => {
    const notifier = createNotifier({ Notification: FakeNotification, navigate: vi.fn() });
    expect(notifier.permission()).toBe("unknown");
    FakeNotification.supported = false;
    expect(notifier.permission()).toBe("denied");
    expect(() => notifier.notify(note())).toThrow(
      "Notifications aren't available on this computer.",
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --dir app exec vitest run electron/navigation.test.mjs electron/notifications.test.mjs`
Expected: FAIL, the modules do not exist.

- [ ] **Step 3: Write minimal implementation**

Create `app/electron/navigation.mjs`:

```js
import { BridgeError } from "./bridge-errors.mjs";

/** A screen pack ID such as T-05 or D-05a. */
export const SCREEN_ID = /^[GOPNTCMDSXW]-\d{2}[a-z]?$/;

const MAX_LINK = 4096;
const MAX_ID = 256;
const MAX_WAITING = 16;
const INVITE = /^[A-Za-z0-9_-]{8,256}$/;

const nowhere = () => new BridgeError("invalid_input", "That place in Colony doesn't exist.");

/** A checked screen target: a screen pack ID and an optional record id. */
export function validNavTarget(value) {
  const screen = value?.screen;
  if (typeof screen !== "string" || !SCREEN_ID.test(screen)) throw nowhere();
  const id = value?.id;
  if (id === undefined || id === null) return { screen };
  if (typeof id !== "string" || !id || id.length > MAX_ID) throw nowhere();
  return { screen, id };
}

/**
 * The links Colony's pages and emails use (W-05, W-06, W-07):
 * colony://open?screen=<ID>&id=<id>, colony://join?invite=<code> and
 * colony://payment?status=success|cancelled. colony://app is the renderer's
 * own origin and never a link.
 */
export function navTargetFromLink(value) {
  if (typeof value !== "string" || value.length > MAX_LINK) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "colony:") return null;
  const host = url.hostname.toLowerCase();
  if (host === "open") {
    try {
      return validNavTarget({
        screen: url.searchParams.get("screen") ?? "",
        id: url.searchParams.get("id") ?? undefined,
      });
    } catch {
      return null;
    }
  }
  if (host === "join") {
    const invite = url.searchParams.get("invite") ?? "";
    return INVITE.test(invite) ? { screen: "P-01", id: invite } : null;
  }
  if (host === "payment") {
    const status = url.searchParams.get("status");
    return status === "success" || status === "cancelled" ? { screen: "S-02", id: status } : null;
  }
  return null;
}

/**
 * Deliver links and notification clicks to the renderer once each, after it
 * has loaded. The same link arriving twice within `dedupeMs` counts once.
 * `onLink` hears each accepted link at once, even before the renderer has
 * loaded (main ends a credits pause after a payment link).
 */
export function createNavigator({
  deliver,
  revealWindow,
  onLink = () => {},
  now = Date.now,
  dedupeMs = 1500,
}) {
  const waiting = [];
  const recent = new Map();
  let ready = false;

  function navigate(target) {
    revealWindow();
    if (ready) {
      deliver(target);
      return;
    }
    if (waiting.length >= MAX_WAITING) waiting.shift();
    waiting.push(target);
  }

  function openLink(link) {
    const target = navTargetFromLink(link);
    if (!target) return false;
    const time = now();
    for (const [seen, at] of recent) if (time - at >= dedupeMs) recent.delete(seen);
    if (recent.has(link)) return true;
    recent.set(link, time);
    onLink(target);
    navigate(target);
    return true;
  }

  return {
    navigate,
    openLink,
    openFromArgv(argv) {
      let found = false;
      for (const value of Array.isArray(argv) ? argv : []) found = openLink(value) || found;
      return found;
    },
    setReady() {
      ready = true;
      for (const target of waiting.splice(0)) deliver(target);
    },
    setNotReady() {
      ready = false;
    },
  };
}
```

Create `app/electron/notifications.mjs`:

```js
import { BridgeError } from "./bridge-errors.mjs";
import { validNavTarget } from "./navigation.mjs";

const MAX_ON_SCREEN = 50;
const ID = /^[A-Za-z0-9:._-]{1,128}$/;

function validNotification(value) {
  if (
    typeof value?.id !== "string" ||
    !ID.test(value.id) ||
    typeof value.title !== "string" ||
    !value.title.trim() ||
    value.title.length > 120 ||
    typeof value.body !== "string" ||
    value.body.length > 400
  )
    throw new BridgeError("invalid_input", "That notification is not valid.");
  return { id: value.id, title: value.title, body: value.body, target: validNavTarget(value.target) };
}

/**
 * Computer notifications (G-03). A click opens the notification's target. The
 * same id replaces an older notification, and close(id) removes one that was
 * handled elsewhere. Electron cannot read the computer's notification
 * permission, so permission() says "unknown" whenever notifications exist.
 */
export function createNotifier({ Notification, navigate }) {
  const onScreen = new Map();

  function close(id) {
    const notification = onScreen.get(id);
    if (!notification) return;
    onScreen.delete(id);
    notification.close();
  }

  return {
    permission: () => (Notification.isSupported() ? "unknown" : "denied"),
    notify(value) {
      const item = validNotification(value);
      if (!Notification.isSupported())
        throw new BridgeError(
          "notifications_unsupported",
          "Notifications aren't available on this computer.",
        );
      close(item.id);
      const notification = new Notification({ title: item.title, body: item.body });
      notification.on("click", () => navigate(item.target));
      notification.on("close", () => {
        if (onScreen.get(item.id) === notification) onScreen.delete(item.id);
      });
      onScreen.set(item.id, notification);
      while (onScreen.size > MAX_ON_SCREEN) close(onScreen.keys().next().value);
      notification.show();
    },
    close,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --dir app exec vitest run electron/navigation.test.mjs electron/notifications.test.mjs`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add app/electron/navigation.mjs app/electron/navigation.test.mjs app/electron/notifications.mjs app/electron/notifications.test.mjs
git commit -s -m "feat(app): colony links and notifications open the right screen"
```

---

### Task 5.13: Updates (Windows installs on restart, a Mac downloads)

**Files:**
- Create: `app/electron/updater-service.mjs` (copy of `desktop/electron/updater-service.mjs`, edited below), `app/electron/updater-runtime.mjs`, `app/electron/updates.mjs`
- Test: `app/electron/updates.test.mjs`

**Interfaces:**
- Consumes: `BridgeError`; electron-updater's `autoUpdater`; release capabilities `{ schemaVersion: 1, release, autoUpdate, signed, platformKey }` (written by task 5.17, read by task 5.14).
- Produces:
  - `createElectronUpdaterService({ autoUpdater, currentVersion, currentBuild, platformKey, metadataUrl, releaseUrl, fetchImpl?, setIntervalImpl?, clearIntervalImpl?, checkIntervalMs?, onStatus? })`, unchanged apart from requiring `metadataUrl` and `releaseUrl`.
  - `app/electron/updater-runtime.mjs` exporting `autoUpdater` and `createElectronUpdaterService`; task 5.17 bundles it to `updater-runtime.cjs` for packaged builds.
  - `installModeFor({ platform, capabilities }) => "restart" | "download"`, `toUpdateStatus(raw, installMode) => UpdateStatus`.
  - `createUpdates({ service, platform, capabilities, openExternal, downloadPageUrl, onStatus }) => { status() => UpdateStatus, handleRaw(raw), canInstall() => boolean, download() => Promise<void>, restartToInstall() => Promise<void> }`.

- [ ] **Step 1: Write the failing test**

Create `app/electron/updates.test.mjs`:

```js
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createElectronUpdaterService } from "./updater-service.mjs";
import { createUpdates, installModeFor, toUpdateStatus } from "./updates.mjs";

const manifest = {
  schemaVersion: 1,
  version: "2.0.1",
  platforms: {
    "darwin-universal": { signed: false, autoUpdate: false },
    "win32-x64": { signed: false, autoUpdate: true },
  },
};

function fakeAutoUpdater() {
  const updater = new EventEmitter();
  updater.checkForUpdates = vi.fn(async () => ({ updateInfo: { version: "2.0.1" } }));
  updater.downloadUpdate = vi.fn(async () => {
    updater.emit("update-downloaded", { version: "2.0.1" });
  });
  updater.quitAndInstall = vi.fn();
  return updater;
}

function setup(platform) {
  const capabilities = {
    schemaVersion: 1,
    release: true,
    autoUpdate: platform === "win32",
    signed: false,
    platformKey: platform === "darwin" ? "darwin-universal" : "win32-x64",
  };
  const autoUpdater = fakeAutoUpdater();
  const pushed = [];
  let updates = null;
  const service = createElectronUpdaterService({
    autoUpdater,
    currentVersion: "2.0.0",
    currentBuild: capabilities,
    platformKey: capabilities.platformKey,
    metadataUrl: "https://example.test/update-metadata.json",
    releaseUrl: "https://example.test/release",
    fetchImpl: async () => new Response(JSON.stringify(manifest), { status: 200 }),
    setIntervalImpl: () => 1,
    clearIntervalImpl: () => {},
    onStatus: (raw) => updates?.handleRaw(raw),
  });
  const openExternal = vi.fn(async () => {});
  updates = createUpdates({
    service,
    platform,
    capabilities,
    openExternal,
    downloadPageUrl: "https://colony.global/download",
    onStatus: (status) => pushed.push(status),
  });
  return { service, updates, autoUpdater, openExternal, pushed };
}

describe("updates", () => {
  it("sends a Mac to the download page while installers are unsigned", async () => {
    const { service, updates, openExternal, autoUpdater } = setup("darwin");
    await service.start();
    await vi.waitFor(() => expect(updates.status().state).toBe("available"));
    expect(updates.status()).toEqual({ state: "available", version: "2.0.1", installMode: "download" });
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled();
    await updates.download();
    expect(openExternal).toHaveBeenCalledWith("https://colony.global/download");
    expect(updates.canInstall()).toBe(false);
    await expect(updates.restartToInstall()).rejects.toMatchObject({ code: "update_not_ready" });
  });

  it("downloads on Windows and installs on restart", async () => {
    const { service, updates, autoUpdater, pushed } = setup("win32");
    await service.start();
    await vi.waitFor(() => expect(updates.status().state).toBe("ready"));
    expect(updates.status()).toEqual({ state: "ready", installMode: "restart" });
    expect(updates.canInstall()).toBe(true);
    await updates.restartToInstall();
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true);
    expect(pushed.map((status) => status.state)).toContain("ready");
  });

  it("maps every other state to none and needs a release build to restart", () => {
    for (const state of ["idle", "checking", "up-to-date", "unavailable", "error"])
      expect(toUpdateStatus({ state }, "restart").state).toBe("none");
    expect(installModeFor({ platform: "win32", capabilities: null })).toBe("download");
    expect(installModeFor({ platform: "darwin", capabilities: { autoUpdate: true } })).toBe("download");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir app exec vitest run electron/updates.test.mjs`
Expected: FAIL, `./updater-service.mjs` and `./updates.mjs` do not exist.

- [ ] **Step 3: Copy the updater service and apply two edits**

Run: `cp desktop/electron/updater-service.mjs app/electron/updater-service.mjs`

Then edit `app/electron/updater-service.mjs`:

1. Replace lines 4-9 (the `UPDATE_METADATA_URL`, `UPDATE_RELEASE_URL` and `UPDATE_ASSETS_URL` constants) with:

```js
// Copied from desktop/electron/updater-service.mjs at 64534835d. The new app
// publishes on its own release channel, so the caller passes both addresses.
```

2. In the parameters of `createElectronUpdaterService` (lines 76-88) replace `metadataUrl = UPDATE_METADATA_URL,` with `metadataUrl,` and `releaseUrl = UPDATE_RELEASE_URL,` with `releaseUrl,`, and make the first statement of the function body:

```js
  if (!metadataUrl || !releaseUrl) throw new Error("Update addresses are required.");
```

Create `app/electron/updater-runtime.mjs`:

```js
// Update support for packaged builds. scripts/package.mjs bundles this file
// into updater-runtime.cjs, so the installer carries no node_modules.
import electronUpdater from "electron-updater";
import { createElectronUpdaterService } from "./updater-service.mjs";

export const autoUpdater = electronUpdater.autoUpdater;
export { createElectronUpdaterService };
```

- [ ] **Step 4: Write the bridge view of updates**

Create `app/electron/updates.mjs`:

```js
import { BridgeError } from "./bridge-errors.mjs";

const STATES = {
  idle: "none",
  checking: "none",
  "up-to-date": "none",
  unavailable: "none",
  error: "none",
  available: "available",
  "manual-required": "available",
  downloading: "downloading",
  installing: "downloading",
  ready: "ready",
};

/** Windows installs on restart; a Mac downloads while its installers are unsigned. */
export function installModeFor({ platform, capabilities }) {
  return platform === "win32" && capabilities?.autoUpdate === true ? "restart" : "download";
}

/** The updater service's state, as the bridge's UpdateStatus. */
export function toUpdateStatus(raw, installMode) {
  const state = STATES[raw?.state] ?? "none";
  return {
    state,
    ...(typeof raw?.version === "string" ? { version: raw.version } : {}),
    installMode,
  };
}

/** Updates for the bridge, the tray and the banner (X-11, G-04l, S-09). */
export function createUpdates({ service, platform, capabilities, openExternal, downloadPageUrl, onStatus }) {
  const installMode = installModeFor({ platform, capabilities });
  const status = () => toUpdateStatus(service ? service.snapshot() : { state: "idle" }, installMode);
  return {
    status,
    handleRaw: (raw) => onStatus(toUpdateStatus(raw, installMode)),
    canInstall: () => installMode === "restart" && status().state === "ready",
    async download() {
      if (installMode === "download") {
        await openExternal(downloadPageUrl);
        return;
      }
      await service?.check();
    },
    async restartToInstall() {
      if (installMode !== "restart" || !service || !(await service.installAndRelaunch()))
        throw new BridgeError("update_not_ready", "There's no update ready to install yet.");
    },
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --dir app exec vitest run electron/updates.test.mjs`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add app/electron/updater-service.mjs app/electron/updater-runtime.mjs app/electron/updates.mjs app/electron/updates.test.mjs
git commit -s -m "feat(app): updates that install on Windows and download on a Mac"
```

---

### Task 5.14: The main process

**Files:**
- Create: `app/electron/csp.mjs`, `app/electron/build-config.mjs`, `app/electron/engine-supervisor.mjs`, `app/electron/purchase-resume.mjs`, `app/electron/app-menu.mjs` (copy of `desktop/electron/app-menu.mjs`), `app/electron/main.mjs`
- Test: `app/electron/csp.test.mjs`, `app/electron/build-config.test.mjs`, `app/electron/engine-supervisor.test.mjs`, `app/electron/purchase-resume.test.mjs`, `app/electron/app-menu.test.mjs`; `main.mjs` itself is proven by the smoke test in task 5.16.

**Interfaces:**
- Consumes: every module from tasks 5.1 to 5.13; Electron `app`, `BrowserWindow`, `Menu`, `Notification`, `Tray`, `dialog`, `ipcMain`, `nativeImage`, `nativeTheme`, `net`, `powerMonitor`, `powerSaveBlocker`, `protocol`, `shell`.
- Produces:
  - `inlineScriptHashes(html) => string[]`, `rendererCsp({ html, devOrigin?, allowLoopback }) => string`.
  - `DEFAULT_UPDATE_METADATA_URL`, `DEFAULT_UPDATE_RELEASE_URL`, `DEFAULT_DOWNLOAD_PAGE_URL`, `loadBuildConfig({ file, env?, read? }) => { googleDesktopClientId, updateMetadataUrl, updateReleaseUrl, downloadPageUrl }`, `readReleaseCapabilities({ file, read? }) => capabilities | null`, `hostRelayEnv(env?) => { BUZZ_RELAY_URL, BUZZ_RELAY_HTTP } | {}`.
  - `createEngineSupervisor({ start, now?, maxRestarts?, windowMs? }) => { get(), isCurrent(generation), startFirst(), ensureRunning() }`.
  - `pausedForCredits(statuses) => boolean`, `createPurchaseResumer({ getCompany, teamStatus, teamResume, sleep, delaysMs? }) => { afterPurchase() => Promise<"resumed" | "not-paused" | "skipped" | "gave-up"> }`.
  - The running app: data folder `Colony App`, single instance, `colony://` links, renderer served at `colony://app/` with the CSP, host started with `COLONY_APP_SHELL=1`, `COLONY_BROWSER_AGENT=0`, `COLONY_ELECTRON_PACKAGED` and `COLONY_ELECTRON_PROFILE_ID`; environment overrides for tests: `COLONY_APP_USER_DATA`, `COLONY_APP_BACKGROUND=1` (never take focus), `COLONY_APP_SMOKE=1` (load, print `colony-app-smoke: ok`, exit), `COLONY_RELAY_URL` (another relay, used by part I's real-run gate); a `colony://payment?status=success` link ends a credits pause on the team computer.

- [ ] **Step 1: Write the failing tests**

Create `app/electron/csp.test.mjs`:

```js
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { inlineScriptHashes, rendererCsp } from "./csp.mjs";

describe("renderer CSP", () => {
  it("allows only our files and secure relay sockets in a packaged app", () => {
    const csp = rendererCsp({
      html: '<script type="module" src="./assets/index.js"></script>',
      allowLoopback: false,
    });
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'self' wss:;");
    expect(csp).toContain("script-src 'self';");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("ws://localhost");
  });

  it("hashes inline scripts but not external ones", () => {
    const html = '<script>window.x=1</script><script src="/a.js"></script>';
    expect(inlineScriptHashes(html)).toEqual([
      `'sha256-${createHash("sha256").update("window.x=1").digest("base64")}'`,
    ]);
  });

  it("adds loopback relays outside packaged builds and the dev server in development", () => {
    const csp = rendererCsp({ html: "", allowLoopback: true, devOrigin: "http://localhost:4180" });
    expect(csp).toContain("ws://localhost:*");
    expect(csp).toContain("ws://*.localhost:*");
    expect(csp).toContain("script-src 'self' http://localhost:4180");
    expect(csp).toContain("ws://localhost:4180");
  });
});
```

Create `app/electron/build-config.test.mjs`:

```js
import { describe, expect, it } from "vitest";
import {
  DEFAULT_DOWNLOAD_PAGE_URL,
  DEFAULT_UPDATE_METADATA_URL,
  DEFAULT_UPDATE_RELEASE_URL,
  hostRelayEnv,
  loadBuildConfig,
  readReleaseCapabilities,
} from "./build-config.mjs";

const missing = () => {
  throw new Error("ENOENT");
};

describe("build config", () => {
  it("prefers the packaged file over the environment", () => {
    const config = loadBuildConfig({
      file: "build-config.json",
      env: { COLONY_GOOGLE_DESKTOP_CLIENT_ID: "env-id" },
      read: () => JSON.stringify({ googleDesktopClientId: "file-id" }),
    });
    expect(config.googleDesktopClientId).toBe("file-id");
  });

  it("falls back to the environment, then to the defaults", () => {
    expect(
      loadBuildConfig({
        file: "x",
        env: { COLONY_GOOGLE_DESKTOP_CLIENT_ID: "env-id" },
        read: missing,
      }).googleDesktopClientId,
    ).toBe("env-id");
    expect(loadBuildConfig({ file: "x", env: {}, read: missing })).toEqual({
      googleDesktopClientId: "",
      updateMetadataUrl: DEFAULT_UPDATE_METADATA_URL,
      updateReleaseUrl: DEFAULT_UPDATE_RELEASE_URL,
      downloadPageUrl: DEFAULT_DOWNLOAD_PAGE_URL,
    });
  });

  it("accepts only well-formed release capabilities", () => {
    const good = {
      schemaVersion: 1,
      release: true,
      autoUpdate: false,
      signed: false,
      platformKey: "darwin-universal",
    };
    expect(readReleaseCapabilities({ file: "x", read: () => JSON.stringify(good) })).toEqual(good);
    expect(
      readReleaseCapabilities({ file: "x", read: () => JSON.stringify({ ...good, autoUpdate: "yes" }) }),
    ).toBeNull();
    expect(readReleaseCapabilities({ file: "x", read: missing })).toBeNull();
  });

  it("hands COLONY_RELAY_URL to the host under the names it reads", () => {
    expect(hostRelayEnv({ COLONY_RELAY_URL: " wss://canary.example " })).toEqual({
      BUZZ_RELAY_URL: "wss://canary.example",
      BUZZ_RELAY_HTTP: "https://canary.example",
    });
    expect(hostRelayEnv({ COLONY_RELAY_URL: "ws://localhost:3000" })).toEqual({
      BUZZ_RELAY_URL: "ws://localhost:3000",
      BUZZ_RELAY_HTTP: "http://localhost:3000",
    });
    expect(hostRelayEnv({})).toEqual({});
  });

  it("stops on a relay address that is not safe", () => {
    for (const value of ["ws://canary.example", "https://canary.example", "wss://canary.example/x"])
      expect(() => hostRelayEnv({ COLONY_RELAY_URL: value }), value).toThrow("COLONY_RELAY_URL must be");
  });
});
```

Create `app/electron/engine-supervisor.test.mjs`:

```js
import { describe, expect, it, vi } from "vitest";
import { createEngineSupervisor } from "./engine-supervisor.mjs";

const engineFake = () => ({ ended: false, close: vi.fn(async () => {}) });

describe("engine supervisor", () => {
  it("starts once and reuses a running engine", async () => {
    const start = vi.fn(async () => engineFake());
    const supervisor = createEngineSupervisor({ start });
    const first = await supervisor.startFirst();
    await expect(supervisor.ensureRunning()).resolves.toBe(first);
    expect(start).toHaveBeenCalledOnce();
  });

  it("refuses a fourth restart in ten minutes", async () => {
    let time = 0;
    const engines = [];
    const start = vi.fn(async () => {
      const engine = engineFake();
      engines.push(engine);
      return engine;
    });
    const supervisor = createEngineSupervisor({ start, now: () => time });
    await supervisor.startFirst();
    for (let restart = 0; restart < 3; restart += 1) {
      engines.at(-1).ended = true;
      await supervisor.ensureRunning();
    }
    engines.at(-1).ended = true;
    await expect(supervisor.ensureRunning()).rejects.toMatchObject({ code: "engine_crash_loop" });
    time += 10 * 60_000;
    const restarted = await supervisor.ensureRunning();
    expect(restarted).toBe(engines.at(-1));
    expect(restarted.ended).toBe(false);
  });

  it("drops an engine that started late", async () => {
    let releaseSlow = () => {};
    const slow = engineFake();
    const fast = engineFake();
    const start = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseSlow = () => resolve(slow);
          }),
      )
      .mockImplementationOnce(async () => fast);
    const supervisor = createEngineSupervisor({ start });
    const first = supervisor.startFirst();
    await expect(supervisor.ensureRunning()).resolves.toBe(fast);
    releaseSlow();
    await expect(first).rejects.toMatchObject({ code: "engine_stopped" });
    expect(slow.close).toHaveBeenCalled();
    expect(supervisor.get()).toBe(fast);
  });
});
```

Create `app/electron/app-menu.test.mjs`:

```js
import { describe, expect, it, vi } from "vitest";
import { appMenuTemplate, installAppMenu } from "./app-menu.mjs";

describe("app menu", () => {
  it("keeps the Edit roles that make copy and paste work on a Mac", () => {
    const edit = appMenuTemplate({ name: "Colony", platform: "darwin" }).find(
      (menu) => menu.label === "Edit",
    );
    expect(edit.submenu.map((entry) => entry.role).filter(Boolean)).toEqual([
      "undo",
      "redo",
      "cut",
      "copy",
      "paste",
      "selectAll",
    ]);
  });

  it("hides the menu bar on Windows", () => {
    const Menu = { buildFromTemplate: vi.fn((template) => template), setApplicationMenu: vi.fn() };
    installAppMenu({ Menu, app: { getName: () => "Colony" }, platform: "win32" });
    expect(Menu.setApplicationMenu).toHaveBeenCalledWith(null);
  });
});
```

Create `app/electron/purchase-resume.test.mjs`:

```js
import { describe, expect, it, vi } from "vitest";
import { createPurchaseResumer, pausedForCredits } from "./purchase-resume.mjs";

const RELAY = "wss://lerato-designs.colony.global";
const teamComputer = { relayUrl: RELAY, isTeamComputer: true };
const creditsPause = [
  { agentPubkey: "a".repeat(64), name: "Scout", state: "paused", pauseReason: "credits" },
];

function setup({ company = teamComputer, statuses = creditsPause, teamResume = vi.fn(async () => {}) } = {}) {
  const teamStatus = vi.fn(async () => statuses);
  const sleep = vi.fn(async () => {});
  const resumer = createPurchaseResumer({ getCompany: () => company, teamStatus, teamResume, sleep });
  return { resumer, teamStatus, teamResume, sleep };
}

describe("resume after a purchase", () => {
  it("resumes a team paused for credits on the team computer", async () => {
    const { resumer, teamResume } = setup();
    await expect(resumer.afterPurchase()).resolves.toBe("resumed");
    expect(teamResume).toHaveBeenCalledWith(RELAY);
  });

  it("never lifts a person's pause and leaves other computers to the team computer", async () => {
    const person = setup({ statuses: [{ ...creditsPause[0], pauseReason: "person" }] });
    await expect(person.resumer.afterPurchase()).resolves.toBe("not-paused");
    expect(person.teamResume).not.toHaveBeenCalled();
    const laptop = setup({ company: { relayUrl: RELAY, isTeamComputer: false } });
    await expect(laptop.resumer.afterPurchase()).resolves.toBe("skipped");
    expect(laptop.teamStatus).not.toHaveBeenCalled();
  });

  it("tries again while the payment has not reached the balance, then leaves it to the host", async () => {
    const teamResume = vi.fn(async () => {
      throw new Error("Not enough credits yet.");
    });
    const { resumer, sleep } = setup({ teamResume });
    await expect(resumer.afterPurchase()).resolves.toBe("gave-up");
    expect(teamResume).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([10_000, 30_000, 60_000]);
  });

  it("runs once when the same payment arrives twice", async () => {
    const { resumer, teamResume } = setup();
    const first = resumer.afterPurchase();
    expect(resumer.afterPurchase()).toBe(first);
    await first;
    expect(teamResume).toHaveBeenCalledTimes(1);
  });

  it("counts only a credits pause", () => {
    expect(pausedForCredits(creditsPause)).toBe(true);
    expect(
      pausedForCredits([{ state: "running" }, { state: "paused", pauseReason: "plan_limit" }]),
    ).toBe(false);
    expect(pausedForCredits(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --dir app exec vitest run electron/csp.test.mjs electron/build-config.test.mjs electron/engine-supervisor.test.mjs electron/purchase-resume.test.mjs electron/app-menu.test.mjs`
Expected: FAIL, none of the five modules exists.

- [ ] **Step 3: Write the helpers**

Create `app/electron/csp.mjs`:

```js
import { createHash } from "node:crypto";

/** sha256 sources for the inline scripts in our own index.html. */
export function inlineScriptHashes(html) {
  return [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
    .filter((match) => !/\bsrc=/.test(match[1]) && match[2].trim())
    .map((match) => `'sha256-${createHash("sha256").update(match[2]).digest("base64")}'`);
}

/**
 * The renderer loads only our own files. It talks to company relays over wss
 * (relays live on per-company host names, so any wss host is allowed), and to
 * relays on this computer only outside packaged builds.
 */
export function rendererCsp({ html, devOrigin, allowLoopback }) {
  const script = ["'self'", ...inlineScriptHashes(html)];
  const connect = ["'self'", "wss:"];
  if (allowLoopback) connect.push("ws://localhost:*", "ws://127.0.0.1:*", "ws://*.localhost:*");
  if (devOrigin) {
    script.push(devOrigin);
    connect.push(devOrigin, devOrigin.replace(/^http/, "ws"));
  }
  return [
    "default-src 'self'",
    `script-src ${script.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    `connect-src ${connect.join(" ")}`,
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
  ].join("; ");
}
```

Create `app/electron/build-config.mjs`:

```js
import { readFileSync } from "node:fs";
import { assertRelayUrl } from "./host-commands.mjs";
import { httpUrlFromWs } from "./relay-http.mjs";

export const DEFAULT_UPDATE_METADATA_URL =
  "https://github.com/AI-Native-Ventures/colony-ai/releases/download/colony-app-channel/update-metadata.json";
export const DEFAULT_UPDATE_RELEASE_URL =
  "https://github.com/AI-Native-Ventures/colony-ai/releases/tag/colony-app-channel";
export const DEFAULT_DOWNLOAD_PAGE_URL = "https://colony.global/download";

const readText = (file) => readFileSync(file, "utf8");

/** Settings fixed at packaging time (scripts/package.mjs); development reads the environment. */
export function loadBuildConfig({ file, env = process.env, read = readText }) {
  let fromFile = {};
  try {
    const parsed = JSON.parse(read(file));
    if (parsed && typeof parsed === "object") fromFile = parsed;
  } catch {
    fromFile = {};
  }
  const pick = (key, envKey, fallback) =>
    (typeof fromFile[key] === "string" && fromFile[key]) || env[envKey] || fallback;
  return {
    googleDesktopClientId: pick("googleDesktopClientId", "COLONY_GOOGLE_DESKTOP_CLIENT_ID", ""),
    updateMetadataUrl: pick("updateMetadataUrl", "COLONY_APP_UPDATE_METADATA_URL", DEFAULT_UPDATE_METADATA_URL),
    updateReleaseUrl: pick("updateReleaseUrl", "COLONY_APP_UPDATE_RELEASE_URL", DEFAULT_UPDATE_RELEASE_URL),
    downloadPageUrl: pick("downloadPageUrl", "COLONY_APP_DOWNLOAD_PAGE_URL", DEFAULT_DOWNLOAD_PAGE_URL),
  };
}

/** The release capabilities file written by scripts/package.mjs, or null in development. */
export function readReleaseCapabilities({ file, read = readText }) {
  try {
    const value = JSON.parse(read(file));
    if (
      value?.schemaVersion !== 1 ||
      typeof value.release !== "boolean" ||
      typeof value.autoUpdate !== "boolean" ||
      typeof value.signed !== "boolean" ||
      typeof value.platformKey !== "string"
    )
      return null;
    return value;
  } catch {
    return null;
  }
}

/**
 * COLONY_RELAY_URL points the app and its engine at another relay (part I's
 * real-run gate uses a test relay). The host reads BUZZ_RELAY_URL and
 * BUZZ_RELAY_HTTP (desktop/src-tauri/src/relay.rs:39-43 and :106-116), so main
 * hands the override to the host under those names. A bad value stops startup
 * instead of quietly using the default relay.
 */
export function hostRelayEnv(env = process.env) {
  const value = typeof env.COLONY_RELAY_URL === "string" ? env.COLONY_RELAY_URL.trim() : "";
  if (!value) return {};
  let relayUrl;
  try {
    relayUrl = assertRelayUrl(value);
  } catch {
    throw new Error("COLONY_RELAY_URL must be a wss:// address, or a ws:// address on this computer.");
  }
  return { BUZZ_RELAY_URL: relayUrl, BUZZ_RELAY_HTTP: httpUrlFromWs(relayUrl) };
}
```

Create `app/electron/engine-supervisor.mjs`:

```js
import { BridgeError } from "./bridge-errors.mjs";

/**
 * Start the native host, start it again when asked, and refuse a crash loop:
 * at most `maxRestarts` restarts within `windowMs`. Every start has a
 * generation, and an engine that finishes starting after a newer one is closed.
 */
export function createEngineSupervisor({ start, now = Date.now, maxRestarts = 3, windowMs = 10 * 60_000 }) {
  let current = null;
  let generation = 0;
  const restarts = [];

  async function launch() {
    generation += 1;
    const mine = generation;
    const engine = await start(mine);
    if (mine !== generation) {
      await engine.close?.();
      throw new BridgeError(
        "engine_stopped",
        "Colony's engine stopped. Restart your team to get it going again.",
      );
    }
    current = engine;
    return engine;
  }

  return {
    get: () => current,
    isCurrent: (mine) => mine === generation,
    startFirst: () => launch(),
    async ensureRunning() {
      if (current && !current.ended) return current;
      const time = now();
      while (restarts.length > 0 && time - restarts[0] >= windowMs) restarts.shift();
      if (restarts.length >= maxRestarts)
        throw new BridgeError(
          "engine_crash_loop",
          "Colony's engine keeps stopping. Quit Colony and open it again. If that doesn't help, get help.",
        );
      restarts.push(time);
      return launch();
    },
  };
}
```

Create `app/electron/purchase-resume.mjs`:

```js
const RETRY_DELAYS_MS = [0, 10_000, 30_000, 60_000];

/** True while the team is paused because credits ran out (part I's pauseReason). */
export function pausedForCredits(statuses) {
  return (
    Array.isArray(statuses) &&
    statuses.some((status) => status?.state === "paused" && status.pauseReason === "credits")
  );
}

/**
 * After the owner pays (colony://payment?status=success), end a credits pause
 * at once instead of at the host's next balance poll (part I). Only the team
 * computer does this, and only while the team is paused for credits, so a
 * person's pause is not lifted. The host's team_resume checks the balance
 * itself and refuses until the payment has landed, so this tries a few times;
 * after that the host's own polling resumes the team.
 */
export function createPurchaseResumer({
  getCompany,
  teamStatus,
  teamResume,
  sleep,
  delaysMs = RETRY_DELAYS_MS,
}) {
  let running = null;

  async function attempt(relayUrl) {
    for (const delay of delaysMs) {
      if (delay > 0) await sleep(delay);
      const company = getCompany();
      if (company?.relayUrl !== relayUrl || company.isTeamComputer !== true) return "skipped";
      try {
        if (!pausedForCredits(await teamStatus(relayUrl))) return "not-paused";
        await teamResume(relayUrl);
        return "resumed";
      } catch {
        // The payment may not have reached the balance yet, or the engine is restarting.
      }
    }
    return "gave-up";
  }

  return {
    afterPurchase() {
      if (running) return running;
      const company = getCompany();
      if (!company?.relayUrl || company.isTeamComputer !== true) return Promise.resolve("skipped");
      running = attempt(company.relayUrl).finally(() => {
        running = null;
      });
      return running;
    },
  };
}
```

Run: `cp desktop/electron/app-menu.mjs app/electron/app-menu.mjs`, then in the copy replace the first sentence of the doc comment ("Mirrors the Tauri app's menu (`src-tauri/src/app_menu.rs`), which the hidden host no longer installs.") with "Copied from desktop/electron/app-menu.mjs at 64534835d."

- [ ] **Step 4: Run the helper tests to verify they pass**

Run: `pnpm --dir app exec vitest run electron/csp.test.mjs electron/build-config.test.mjs electron/engine-supervisor.test.mjs electron/purchase-resume.test.mjs electron/app-menu.test.mjs`
Expected: PASS, 18 tests.

- [ ] **Step 5: Write the composition root**

Create `app/electron/main.mjs`:

```js
// Composition root for the new Colony app. Every privileged job lives in a
// small module with its own tests; this file only wires them to Electron.
// tests/e2e/engine-console.spec.ts proves it end to end.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  app,
  dialog,
  ipcMain,
  nativeImage,
  nativeTheme,
  net,
  powerMonitor,
  powerSaveBlocker,
  protocol,
  shell,
} from "electron";
import { installAppMenu } from "./app-menu.mjs";
import { BRIDGE_CHANNEL, BRIDGE_EVENT_CHANNEL } from "./bridge-contract.mjs";
import { BridgeError } from "./bridge-errors.mjs";
import { createBridgeRouter } from "./bridge-router.mjs";
import { hostRelayEnv, loadBuildConfig, readReleaseCapabilities } from "./build-config.mjs";
import { createCompanyService } from "./company-service.mjs";
import { rendererCsp } from "./csp.mjs";
import { createEngineSupervisor } from "./engine-supervisor.mjs";
import {
  HOST_EVENTS,
  assertRelayUrl,
  createHostCommands,
  subscribeHostEvent,
} from "./host-commands.mjs";
import { createJsonStore } from "./json-store.mjs";
import { createKeepAwake } from "./keep-awake.mjs";
import { createLoginItem, launchedAtLogin } from "./login-item.mjs";
import { NativeHost } from "./native-host.mjs";
import { createNavigator } from "./navigation.mjs";
import { createNotifier } from "./notifications.mjs";
import { createPurchaseResumer } from "./purchase-resume.mjs";
import { createRelayHttp, httpUrlFromWs } from "./relay-http.mjs";
import { runtimePaths } from "./runtime-paths.mjs";
import { createSessionService } from "./session-service.mjs";
import { createTrayController } from "./tray.mjs";
import { trayModel, validTraySummary } from "./tray-model.mjs";
import { createUpdates } from "./updates.mjs";
import { createWindowLifecycle } from "./window-lifecycle.mjs";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const smoke = process.env.COLONY_APP_SMOKE === "1";
const background = process.env.COLONY_APP_BACKGROUND === "1";
const runtime = runtimePaths({
  packaged: app.isPackaged,
  appPath: appRoot,
  resourcesPath: process.resourcesPath,
  env: process.env,
  platform: process.platform,
});
const buildConfig = loadBuildConfig({ file: path.join(appRoot, "electron", "build-config.json") });
const capabilities = readReleaseCapabilities({
  file: path.join(appRoot, "electron", "release-capabilities.json"),
});
const devOrigin = runtime.devUrl ? new URL(runtime.devUrl).origin : null;
const RUNTIME_STATES = new Set(["starting", "running", "paused", "stopped", "failing", "away"]);
const ENGINE_STOPPED = "Colony's engine stopped. Restart your team to get it going again.";

app.setName("Colony");
app.setPath(
  "userData",
  process.env.COLONY_APP_USER_DATA ||
    path.join(app.getPath("appData"), app.isPackaged ? "Colony App" : "Colony App Dev"),
);
if (process.platform === "win32") app.setAppUserModelId("global.colony.app");
const primary = smoke || app.requestSingleInstanceLock();
if (!primary) app.quit();

protocol.registerSchemesAsPrivileged([
  {
    scheme: "colony",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

const settings = createJsonStore(path.join(app.getPath("userData"), "shell-settings.json"), {
  keepAwakeWhilePluggedIn: true,
  firstCloseExplained: false,
});
const sessionStore = createJsonStore(path.join(app.getPath("userData"), "session.json"), {
  session: null,
});
const state = { summary: null, hostStatuses: new Map(), engineStopped: false, keepAwake: true };
let mainWindow = null;
let commands = null;
let expectHostExit = false;
let relaunching = false;
let tray = null;
let keepAwake = null;
let updaterService = null;
let relayEnv = {};
let updates = createUpdates({
  service: null,
  platform: process.platform,
  capabilities,
  openExternal,
  downloadPageUrl: buildConfig.downloadPageUrl,
  onStatus: () => {},
});

function openExternal(url) {
  try {
    const parsed = new URL(url);
    if (["https:", "http:", "mailto:"].includes(parsed.protocol)) return shell.openExternal(parsed.href);
  } catch {
    // Ignore malformed targets.
  }
  return Promise.resolve();
}

function sendEvent(topic, payload) {
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send(BRIDGE_EVENT_CHANNEL, { topic, payload });
}

function revealWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (background) {
    mainWindow.showInactive();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

const isTeamComputer = () => state.summary?.isTeamComputer === true;
const purchases = createPurchaseResumer({
  getCompany: () => state.summary,
  teamStatus: (relayUrl) => host().teamStatus(relayUrl),
  teamResume: (relayUrl) => host().teamResume(relayUrl),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});
const navigator = createNavigator({
  deliver: (target) => sendEvent("system.navigate", target),
  revealWindow,
  onLink: (target) => {
    // Part I: a paid checkout ends a credits pause now, not at the next balance poll.
    if (target.screen === "S-02" && target.id === "success") void purchases.afterPurchase();
  },
});
const notifier = createNotifier({ Notification, navigate: (target) => navigator.navigate(target) });
const loginItem = createLoginItem({ app });
const engine = createEngineSupervisor({ start: startEngine });
const lifecycle = createWindowLifecycle({
  getWindow: () => mainWindow,
  settings,
  sendEvent,
  revealWindow,
  isTeamComputer,
  askNativeQuit,
  quitNow,
  stopForUpdate,
  platform: process.platform,
});

function host() {
  const current = engine.get();
  if (!commands || !current || current.ended) throw new BridgeError("engine_stopped", ENGINE_STOPPED);
  return commands;
}

async function relayHttp() {
  const { httpUrl } = await host().relayUrls();
  return createRelayHttp({
    baseHttpUrl: httpUrl,
    signEvent: (input, allowKinds) => host().signEvent(input, allowKinds),
  });
}

const sessions = createSessionService({
  getRelayHttp: relayHttp,
  host: {
    importIdentity: (nsec) => host().importIdentity(nsec),
    getIdentity: () => host().getIdentity(),
    signOut: () => host().signOut(),
    googleDesktopSignIn: (clientId) => host().googleDesktopSignIn(clientId),
  },
  store: sessionStore,
  googleClientId: buildConfig.googleDesktopClientId,
});
const companies = createCompanyService({
  getRelayHttp: relayHttp,
  getRelayUrls: () => host().relayUrls(),
});

async function startEngine(generation) {
  const native = new NativeHost(runtime.nativeHost, {
    env: {
      ...process.env,
      ...relayEnv,
      COLONY_APP_SHELL: "1",
      COLONY_BROWSER_AGENT: "0",
      COLONY_ELECTRON_PACKAGED: app.isPackaged ? "1" : "0",
      COLONY_ELECTRON_PROFILE_ID: createHash("sha256")
        .update(app.getPath("userData"))
        .digest("hex")
        .slice(0, 16),
    },
    timeout: 120_000,
  });
  native.on("disconnected", (message) => onEngineDisconnected(generation, message));
  await native.ready;
  await subscribeHostEvent(native, HOST_EVENTS.teamStatus, onTeamStatus);
  await subscribeHostEvent(native, HOST_EVENTS.teamProblem, (problem) =>
    sendEvent("team.problem", problem),
  );
  if (engine.isCurrent(generation)) {
    commands = createHostCommands(native);
    state.engineStopped = false;
    renderTray();
  }
  return native;
}

function relaunchOnce() {
  if (relaunching) return;
  relaunching = true;
  app.relaunch();
  app.exit(0);
}

function onEngineDisconnected(generation, message) {
  if (!engine.isCurrent(generation) || lifecycle.isQuitting()) return;
  commands = null;
  if (expectHostExit) {
    // Sign-out: the host wrote its reset marker and exited (COLONY_APP_SHELL).
    relaunchOnce();
    return;
  }
  console.error(`Colony engine stopped: ${String(message).slice(0, 200)}`);
  state.engineStopped = true;
  state.hostStatuses.clear();
  sendEvent("team.problem", { agentPubkey: null, kind: "crashed", detail: ENGINE_STOPPED });
  renderTray();
}

function onTeamStatus(status) {
  if (typeof status?.agentPubkey !== "string" || !RUNTIME_STATES.has(status.state)) return;
  state.hostStatuses.set(status.agentPubkey, status);
  sendEvent("team.status", status);
  renderTray();
}

function renderTray() {
  tray?.render(
    trayModel({
      platform: process.platform,
      summary: state.summary,
      hostStatuses: [...state.hostStatuses.values()],
      engineStopped: state.engineStopped,
      update: updates.status(),
      keepAwake: state.keepAwake,
    }),
  );
}

async function setKeepAwake(on) {
  state.keepAwake = on === true;
  await settings.update({ keepAwakeWhilePluggedIn: state.keepAwake });
  keepAwake?.setEnabled(state.keepAwake);
  renderTray();
}

async function askNativeQuit() {
  const { response } = await dialog.showMessageBox({
    type: "question",
    buttons: ["Keep working", "Quit Colony"],
    defaultId: 0,
    cancelId: 0,
    message: "Quit Colony?",
    detail: "Your team stops until you open Colony again.",
  });
  return response === 1;
}

async function stopEngine() {
  try {
    await engine.get()?.close();
  } catch (error) {
    console.error("Colony engine shutdown:", error instanceof Error ? error.message : error);
  }
}

async function quitNow() {
  updaterService?.stop();
  keepAwake?.dispose();
  tray?.destroy();
  await stopEngine();
  app.quit();
}

async function stopForUpdate() {
  keepAwake?.dispose();
  await stopEngine();
}

async function signOutAndRelaunch() {
  expectHostExit = true;
  try {
    await sessions.signOut();
  } catch (error) {
    // The host may exit before it answers; that is the expected end of sign-out.
    if (!(error instanceof BridgeError) || error.code !== "engine_stopped") {
      expectHostExit = false;
      throw error;
    }
    if (!engine.get() || engine.get().ended) relaunchOnce();
  }
}

async function installUpdate() {
  if (!updates.canInstall())
    throw new BridgeError("update_not_ready", "There's no update ready to install yet.");
  await lifecycle.prepareForUpdate();
  await updates.restartToInstall();
}

async function onTrayAction(action) {
  try {
    if (action.type === "open") revealWindow();
    else if (action.type === "navigate") navigator.navigate(action.target);
    else if (action.type === "pause" && state.summary?.relayUrl)
      await host().teamPause(state.summary.relayUrl);
    else if (action.type === "resume" && state.summary?.relayUrl)
      await host().teamResume(state.summary.relayUrl);
    else if (action.type === "toggleKeepAwake") await setKeepAwake(!state.keepAwake);
    else if (action.type === "update") {
      if (updates.status().installMode === "download") await updates.download();
      else await installUpdate();
    } else if (action.type === "quit") lifecycle.requestQuit();
  } catch (error) {
    console.error("Colony tray action failed:", error instanceof Error ? error.message : error);
  }
}

function bridgeHandlers() {
  return {
    "auth.startEmailCode": (email) => sessions.startEmailCode(email),
    "auth.verifyEmailCode": (input) => sessions.verifyEmailCode(input),
    "auth.signInWithGoogle": (termsVersion) => sessions.signInWithGoogle(termsVersion),
    "auth.session": () => sessions.session(),
    "auth.signOut": () => signOutAndRelaunch(),
    "company.create": (input) => companies.create(input),
    "relay.urls": () => host().relayUrls(),
    "relay.signEvent": (input) => host().signEvent(input),
    "relay.createAuthEvent": (input) => host().createAuthEvent(input),
    "relay.selfPubkey": async (relayUrl) =>
      (await relayHttp()).relaySelf(httpUrlFromWs(assertRelayUrl(relayUrl))),
    "team.setCompanies": (list) => host().teamSetCompanies(list),
    "team.claimStatus": (relayUrl) => host().teamClaimStatus(relayUrl),
    "team.claim": (relayUrl, force) => host().teamClaim(relayUrl, force),
    "team.hireComplete": (input) => host().teamHireComplete(input),
    "team.restartEmployee": (agentPubkey) => host().teamRestartEmployee(agentPubkey),
    "team.restartAll": async (relayUrl) => {
      await engine.ensureRunning();
      return host().teamRestartAll(relayUrl);
    },
    "team.pause": (relayUrl) => host().teamPause(relayUrl),
    "team.resume": (relayUrl) => host().teamResume(relayUrl),
    "team.status": async (relayUrl) => {
      const list = await host().teamStatus(relayUrl);
      if (Array.isArray(list)) for (const status of list) onTeamStatus(status);
      return list;
    },
    "system.getOpenAtLogin": () => loginItem.get(),
    "system.setOpenAtLogin": (on) => loginItem.set(on === true),
    "system.getKeepAwakeWhilePluggedIn": () => state.keepAwake,
    "system.setKeepAwakeWhilePluggedIn": (on) => setKeepAwake(on === true),
    "system.notificationPermission": () => notifier.permission(),
    "system.notify": (notification) => notifier.notify(notification),
    "system.closeNotification": (id) => notifier.close(String(id ?? "")),
    "system.setTraySummary": (summary) => {
      state.summary = validTraySummary(summary);
      keepAwake?.setTeamComputer(state.summary.isTeamComputer);
      renderTray();
    },
    "system.hideWindow": () => lifecycle.hideAfterExplaining(),
    "system.requestQuit": () => lifecycle.requestQuit(),
    "system.confirmQuit": () => lifecycle.confirmQuit(),
    "system.cancelQuit": () => lifecycle.cancelQuit(),
    "system.update.status": () => updates.status(),
    "system.update.download": () => updates.download(),
    "system.update.restartToInstall": () => installUpdate(),
  };
}

function trusted(url) {
  try {
    return devOrigin ? new URL(url).origin === devOrigin : url.startsWith("colony://app/");
  } catch {
    return false;
  }
}

/** Serve the built renderer at colony://app/ with the CSP header (desktop/electron/main.mjs:189-207). */
function serveRenderer(csp) {
  const root = runtime.rendererRoot;
  protocol.handle("colony", async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== "app") return new Response("Not found", { status: 404 });
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const file = path.resolve(root, !relative || !path.extname(relative) ? "index.html" : relative);
    if (!file.startsWith(root + path.sep)) return new Response("Not found", { status: 404 });
    const response = await net.fetch(pathToFileURL(file).href);
    const headers = new Headers(response.headers);
    headers.set("Content-Security-Policy", csp);
    return new Response(response.body, { status: response.status, headers });
  });
}

async function boot() {
  // First, so a wrong test relay stops startup instead of using the default relay.
  relayEnv = hostRelayEnv(process.env);
  await app.whenReady();
  installAppMenu({ Menu, app });
  if (process.defaultApp)
    app.setAsDefaultProtocolClient("colony", process.execPath, [
      path.resolve(process.argv[1] ?? appRoot),
    ]);
  else app.setAsDefaultProtocolClient("colony");

  const html = runtime.devUrl
    ? await (await fetch(runtime.devUrl)).text()
    : await readFile(path.join(runtime.rendererRoot, "index.html"), "utf8");
  serveRenderer(rendererCsp({ html, devOrigin: devOrigin ?? undefined, allowLoopback: !app.isPackaged }));

  state.keepAwake = (await settings.read()).keepAwakeWhilePluggedIn === true;
  keepAwake = createKeepAwake({ powerSaveBlocker, powerMonitor });
  keepAwake.setEnabled(state.keepAwake);
  // Windows reports shutdown on the window instead (window-lifecycle.mjs).
  if (process.platform !== "win32") powerMonitor.on("shutdown", () => lifecycle.onSystemShutdown());

  if (app.isPackaged && capabilities?.release && !smoke) {
    const loaded = await import("./updater-runtime.cjs");
    const updaterRuntime = loaded.default ?? loaded;
    updaterService = updaterRuntime.createElectronUpdaterService({
      autoUpdater: updaterRuntime.autoUpdater,
      currentVersion: app.getVersion(),
      currentBuild: capabilities,
      platformKey: capabilities.platformKey,
      metadataUrl: buildConfig.updateMetadataUrl,
      releaseUrl: buildConfig.updateReleaseUrl,
      onStatus: (raw) => {
        updates.handleRaw(raw);
        renderTray();
      },
    });
  }
  updates = createUpdates({
    service: updaterService,
    platform: process.platform,
    capabilities,
    openExternal,
    downloadPageUrl: buildConfig.downloadPageUrl,
    onStatus: (status) => sendEvent("system.update", status),
  });

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    title: "Colony",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#17151b" : "#ffffff",
    webPreferences: {
      preload: runtime.preload,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  lifecycle.attach(mainWindow);
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!trusted(url)) event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) navigator.setNotReady();
  });
  mainWindow.webContents.on("did-finish-load", () => navigator.setReady());
  ipcMain.handle(
    BRIDGE_CHANNEL,
    createBridgeRouter({
      handlers: bridgeHandlers(),
      isTrustedSender: (event) =>
        Boolean(
          mainWindow &&
            event.sender === mainWindow.webContents &&
            event.senderFrame === mainWindow.webContents.mainFrame &&
            trusted(event.senderFrame.url),
        ),
    }),
  );

  tray = createTrayController({
    Tray,
    Menu,
    nativeImage,
    nativeTheme,
    platform: process.platform,
    onAction: (action) => void onTrayAction(action),
  });
  renderTray();

  try {
    await engine.startFirst();
  } catch (error) {
    state.engineStopped = true;
    console.error("Colony engine could not start:", error instanceof Error ? error.message : error);
    renderTray();
  }
  void updaterService?.start();
  navigator.openFromArgv(process.argv);

  await mainWindow.loadURL(runtime.devUrl || "colony://app/");
  if (smoke) {
    console.log("colony-app-smoke: ok");
    await stopEngine();
    app.exit(0);
    return;
  }
  if (launchedAtLogin({ app })) return;
  if (background) mainWindow.showInactive();
  else mainWindow.show();
}

app.on("open-url", (event, url) => {
  event.preventDefault();
  navigator.openLink(url);
});
app.on("second-instance", (_event, argv) => {
  if (!navigator.openFromArgv(argv)) revealWindow();
});
app.on("before-quit", (event) => lifecycle.onBeforeQuit(event));
app.on("activate", () => revealWindow());
app.on("window-all-closed", () => {
  // The team keeps working with no window open; only Quit stops it.
});

if (primary)
  void boot().catch(async (error) => {
    console.error("Colony startup failed:", error instanceof Error ? error.message : error);
    await stopEngine();
    app.exit(1);
  });
```

- [ ] **Step 6: Check the composition root parses and lints**

Run: `node --check app/electron/main.mjs`
Expected: no output (the file parses).

Run: `pnpm --dir app check`
Expected: no errors. The full proof of `main.mjs` is the smoke test in task 5.16.

- [ ] **Step 7: Commit**

```bash
git add app/electron/csp.mjs app/electron/csp.test.mjs app/electron/build-config.mjs app/electron/build-config.test.mjs app/electron/engine-supervisor.mjs app/electron/engine-supervisor.test.mjs app/electron/purchase-resume.mjs app/electron/purchase-resume.test.mjs app/electron/app-menu.mjs app/electron/app-menu.test.mjs app/electron/main.mjs
git commit -s -m "feat(app): main process that wires the engine, bridge, tray and updates"
```

---

### Task 5.15: Minimal relay client in the renderer

**Files:**
- Create: `app/src/relay/nostr.ts`, `app/src/relay/relayConnection.ts`, `app/src/relay/conversations.ts`, `app/src/relay/records.ts`
- Test: `app/src/relay/relayConnection.test.ts`, `app/src/relay/conversations.test.ts`, `app/src/relay/records.test.ts`

**Interfaces:**
- Consumes: `NostrEvent`, `UnsignedEventInput` (task 5.7); the bridge's `relay.createAuthEvent` and `relay.signEvent` (passed in as functions, so these modules stay testable); part A's records: `KIND_BUSINESS_PROFILE_HEAD = 30657` (`d` = `business-profile`, relay-signed, `["revision", "<n>"]` tag), `KIND_BUSINESS_PROFILE_ACTION = 47046` (content `{ profile, expectedRevision }`), `KIND_TEAM_COMPUTER_HEAD = 30658` (`d` = `team-computer`); NIP-29 kinds 9007 (create group, tags `h`, `name`, `visibility`, `channel_type`, see `crates/buzz-sdk/src/builders.rs:699-731`), 9000 (add member, tags `h`, `p`, `builders.rs:593-608`) and 9 (message with `h`).
- Produces:
  - `type Filter`, `isNostrEvent(value) => value is NostrEvent`, `tagValue(event, name) => string | undefined`.
  - `class RelayConnection(url, signAuth, openSocket?) { connect(), subscribe(filters, { onEvent, onEose?, onClosed? }) => () => void, publish(event), close() }`, `class RelayRejected extends Error { reason }`, `interface SocketLike`.
  - `createTopicConversation({ connection, sign, name, memberPubkeys, newId? }) => Promise<string>`, `sendMessage({ connection, sign, channelId, content, mentionPubkeys? }) => Promise<NostrEvent>`, `watchMessages({ connection, channelId, since?, onMessage, onEose? }) => () => void`.
  - `type BusinessProfile`, `type TeamComputerRecord`, `decodeProfileHead(event, relayPubkey) => { profile, revision } | null`, `decodeTeamComputerHead(event, relayPubkey) => TeamComputerRecord | null`, `profileAction(profile, expectedRevision) => UnsignedEventInput`.

- [ ] **Step 1: Write the failing tests**

Create `app/src/relay/relayConnection.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NostrEvent } from "../bridge/types";
import { type AuthSigner, RelayConnection, RelayRejected, type SocketLike } from "./relayConnection";

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: unknown[][] = [];
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
    this.onclose?.({});
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  push(message: unknown[]) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

const event = (id: string, kind = 9): NostrEvent => ({
  id,
  pubkey: "c".repeat(64),
  created_at: 1,
  kind,
  tags: [],
  content: "",
  sig: "s",
});

async function opened(signAuth: AuthSigner = vi.fn(async () => event("auth1", 22242))) {
  const socket = new FakeSocket();
  const connection = new RelayConnection("wss://lerato-designs.colony.global", signAuth, () => socket);
  const ready = connection.connect();
  socket.open();
  await vi.advanceTimersByTimeAsync(0);
  return { socket, connection, ready, signAuth };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("RelayConnection", () => {
  it("connects without sign-in when the relay sends no challenge", async () => {
    const { ready } = await opened();
    await vi.advanceTimersByTimeAsync(1500);
    await expect(ready).resolves.toBeUndefined();
  });

  it("answers a NIP-42 challenge before sending requests", async () => {
    const auth = event("auth1", 22242);
    const { socket, connection, ready, signAuth } = await opened(vi.fn(async () => auth));
    socket.push(["AUTH", "challenge-1"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(signAuth).toHaveBeenCalledWith({
      challenge: "challenge-1",
      relayUrl: "wss://lerato-designs.colony.global",
    });
    expect(socket.sent).toContainEqual(["AUTH", auth]);
    connection.subscribe([{ kinds: [9], "#h": ["x"] }], { onEvent: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    expect(socket.sent.some((frame) => frame[0] === "REQ")).toBe(false);
    socket.push(["OK", "auth1", true, ""]);
    await ready;
    await vi.advanceTimersByTimeAsync(0);
    expect(socket.sent.at(-1)).toEqual(["REQ", "s1", { kinds: [9], "#h": ["x"] }]);
  });

  it("resolves a publish on OK and rejects with the relay's reason", async () => {
    const { socket, connection, ready } = await opened();
    await vi.advanceTimersByTimeAsync(1500);
    await ready;
    const accepted = connection.publish(event("e1"));
    await vi.advanceTimersByTimeAsync(0);
    socket.push(["OK", "e1", true, ""]);
    await expect(accepted).resolves.toBeUndefined();
    const refused = connection.publish(event("e2"));
    await vi.advanceTimersByTimeAsync(0);
    socket.push(["OK", "e2", false, "blocked: not a member"]);
    await expect(refused).rejects.toBeInstanceOf(RelayRejected);
  });

  it("retries a request once after auth-required, then reports the close", async () => {
    const { socket, connection, ready } = await opened();
    await vi.advanceTimersByTimeAsync(1500);
    await ready;
    const onClosed = vi.fn();
    connection.subscribe([{ kinds: [9] }], { onEvent: vi.fn(), onClosed });
    await vi.advanceTimersByTimeAsync(0);
    socket.push(["CLOSED", "s1", "auth-required: sign in first"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(socket.sent.filter((frame) => frame[0] === "REQ")).toHaveLength(2);
    socket.push(["CLOSED", "s1", "auth-required: sign in first"]);
    expect(onClosed).toHaveBeenCalledWith("auth-required: sign in first");
  });

  it("delivers valid events to their view and ignores bad frames", async () => {
    const { socket, connection, ready } = await opened();
    await vi.advanceTimersByTimeAsync(1500);
    await ready;
    const onEvent = vi.fn();
    connection.subscribe([{ kinds: [9] }], { onEvent });
    await vi.advanceTimersByTimeAsync(0);
    socket.push(["EVENT", "s1", event("m1")]);
    socket.push(["EVENT", "s1", { id: "bad" }]);
    socket.onmessage?.({ data: "not json" });
    socket.onmessage?.({ data: JSON.stringify({ not: "an array" }) });
    socket.onmessage?.({ data: `["EVENT","s1",${"x".repeat(600 * 1024)}]` });
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith(event("m1"));
  });

  it("fails waiting publishes when the socket closes", async () => {
    const { socket, connection, ready } = await opened();
    await vi.advanceTimersByTimeAsync(1500);
    await ready;
    const onClosed = vi.fn();
    connection.subscribe([{ kinds: [9] }], { onEvent: vi.fn(), onClosed });
    const pending = connection.publish(event("e3"));
    await vi.advanceTimersByTimeAsync(0);
    socket.close();
    await expect(pending).rejects.toThrow("Lost the connection to your company.");
    expect(onClosed).toHaveBeenCalledWith("connection closed");
  });
});
```

Create `app/src/relay/conversations.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { NostrEvent, UnsignedEventInput } from "../bridge/types";
import { createTopicConversation, sendMessage, watchMessages } from "./conversations";
import type { RelayConnection } from "./relayConnection";

const SCOUT = "a".repeat(64);
const PARTNER = "b".repeat(64);

function fakes() {
  const published: NostrEvent[] = [];
  const connection = {
    publish: vi.fn(async (event: NostrEvent) => {
      published.push(event);
    }),
    subscribe: vi.fn(() => () => {}),
  } as unknown as RelayConnection & { subscribe: ReturnType<typeof vi.fn> };
  const sign = vi.fn(async (input: UnsignedEventInput) => ({
    id: `id-${published.length}`,
    pubkey: "e".repeat(64),
    created_at: 1,
    kind: input.kind,
    tags: input.tags,
    content: input.content,
    sig: "s",
  }));
  return { connection, sign, published };
}

describe("conversations", () => {
  it("creates a private topic conversation and adds Scout and partners", async () => {
    const { connection, sign, published } = fakes();
    const channelId = await createTopicConversation({
      connection,
      sign,
      name: "  New conversation  ",
      memberPubkeys: [SCOUT, PARTNER],
      newId: () => "9f28288a-d724-587a-9709-92dc7f967110",
    });
    expect(channelId).toBe("9f28288a-d724-587a-9709-92dc7f967110");
    expect(published.map((event) => event.kind)).toEqual([9007, 9000, 9000]);
    expect(published[0].tags).toEqual([
      ["h", channelId],
      ["name", "New conversation"],
      ["visibility", "private"],
      ["channel_type", "stream"],
    ]);
    expect(published[1].tags).toEqual([
      ["h", channelId],
      ["p", SCOUT],
    ]);
  });

  it("refuses a member that is not a valid key before publishing", async () => {
    const { connection, sign, published } = fakes();
    await expect(
      createTopicConversation({ connection, sign, name: "Spring launch", memberPubkeys: ["nope"] }),
    ).rejects.toThrow("A member of this conversation is not valid.");
    expect(published).toHaveLength(0);
  });

  it("sends a trimmed message that wakes the named employee", async () => {
    const { connection, sign } = fakes();
    const message = await sendMessage({
      connection,
      sign,
      channelId: "c1",
      content: "  Plan a spring sale  ",
      mentionPubkeys: [SCOUT, "bad"],
    });
    expect(message.content).toBe("Plan a spring sale");
    expect(message.tags).toEqual([
      ["h", "c1"],
      ["p", SCOUT],
    ]);
    await expect(
      sendMessage({ connection, sign, channelId: "c1", content: "   " }),
    ).rejects.toThrow("Write something first.");
  });

  it("watches only messages of the conversation", () => {
    const { connection } = fakes();
    const onMessage = vi.fn();
    watchMessages({ connection, channelId: "c1", since: 100, onMessage });
    const [filters, handlers] = connection.subscribe.mock.calls[0];
    expect(filters).toEqual([{ kinds: [9], "#h": ["c1"], since: 100, limit: 200 }]);
    handlers.onEvent({ kind: 7 });
    handlers.onEvent({ kind: 9, content: "hi" });
    expect(onMessage).toHaveBeenCalledTimes(1);
  });
});
```

Create `app/src/relay/records.test.ts`:

```ts
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";
import type { NostrEvent } from "../bridge/types";
import {
  type BusinessProfile,
  KIND_BUSINESS_PROFILE_ACTION,
  KIND_BUSINESS_PROFILE_HEAD,
  KIND_TEAM_COMPUTER_HEAD,
  decodeProfileHead,
  decodeTeamComputerHead,
  profileAction,
} from "./records";

const relayKey = generateSecretKey();
const relayPubkey = getPublicKey(relayKey);
const profile: BusinessProfile = {
  schemaVersion: 1,
  name: "Lerato Designs",
  whatYouSell: "Women's clothing in natural linen and cotton, made in Johannesburg.",
  whoBuys: null,
  whereYouSell: ["instagram"],
  city: "Johannesburg",
  country: "South Africa",
  timeZone: "Africa/Johannesburg",
  links: [],
  voiceWords: ["warm"],
  goals: [],
  contact: { email: null, phone: null, whatsapp: null, address: null },
  buyLink: null,
  invoice: { registeredName: null, registrationNumber: null, vatNumber: null, bankDetails: null },
  socialAccounts: { instagram: "leratodesigns", facebook: null, tiktok: null, linkedin: null, x: null },
};

/** A head signed by `key`, passed through JSON as it would arrive from the relay. */
function head(kind: number, d: string, content: unknown, key = relayKey, extra: string[][] = []): NostrEvent {
  const signed = finalizeEvent(
    { kind, created_at: 1760180000, tags: [["d", d], ...extra], content: JSON.stringify(content) },
    key,
  );
  return JSON.parse(JSON.stringify(signed)) as NostrEvent;
}

describe("company records", () => {
  it("reads a relay-signed business profile and its revision", () => {
    const event = head(KIND_BUSINESS_PROFILE_HEAD, "business-profile", profile, relayKey, [["revision", "3"]]);
    expect(decodeProfileHead(event, relayPubkey)).toEqual({ profile, revision: 3 });
  });

  it("ignores a profile signed by anyone but the relay", () => {
    const event = head(KIND_BUSINESS_PROFILE_HEAD, "business-profile", profile, generateSecretKey());
    expect(decodeProfileHead(event, relayPubkey)).toBeNull();
  });

  it("ignores a tampered profile and one with the wrong address", () => {
    const event = head(KIND_BUSINESS_PROFILE_HEAD, "business-profile", profile);
    const tampered = { ...event, content: JSON.stringify({ ...profile, name: "Someone Else" }) };
    expect(decodeProfileHead(tampered, relayPubkey)).toBeNull();
    expect(decodeProfileHead(head(KIND_BUSINESS_PROFILE_HEAD, "other", profile), relayPubkey)).toBeNull();
  });

  it("reads the team computer record and refuses a bad one", () => {
    const record = {
      computerId: "3f6e2b1a-0c4d-4e5f-8a9b-0c1d2e3f4a5b",
      computerName: "Lerato's MacBook Air",
      claimedBy: "a".repeat(64),
      claimedAt: 1760180000,
      lastSeenAt: 1760180300,
    };
    expect(decodeTeamComputerHead(head(KIND_TEAM_COMPUTER_HEAD, "team-computer", record), relayPubkey)).toEqual(record);
    expect(
      decodeTeamComputerHead(head(KIND_TEAM_COMPUTER_HEAD, "team-computer", { ...record, claimedBy: "x" }), relayPubkey),
    ).toBeNull();
  });

  it("builds the profile action with the expected revision", () => {
    expect(profileAction(profile, 3)).toEqual({
      kind: KIND_BUSINESS_PROFILE_ACTION,
      content: JSON.stringify({ profile, expectedRevision: 3 }),
      tags: [],
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --dir app exec vitest run src/relay`
Expected: FAIL, the relay modules do not exist.

- [ ] **Step 3: Write the relay modules**

Create `app/src/relay/nostr.ts`:

```ts
import type { NostrEvent } from "../bridge/types";

export type { NostrEvent, UnsignedEventInput } from "../bridge/types";

/** A relay filter. It always names kinds: the relay refuses kindless filters. */
export type Filter = {
  ids?: string[];
  authors?: string[];
  kinds: number[];
  since?: number;
  until?: number;
  limit?: number;
  [tag: `#${string}`]: string[] | undefined;
};

const HEX64 = /^[0-9a-f]{64}$/;

/** Shape check for events arriving from a socket. */
export function isNostrEvent(value: unknown): value is NostrEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  return (
    typeof event.id === "string" &&
    typeof event.pubkey === "string" &&
    HEX64.test(event.pubkey) &&
    Number.isInteger(event.created_at) &&
    Number.isInteger(event.kind) &&
    typeof event.content === "string" &&
    typeof event.sig === "string" &&
    Array.isArray(event.tags) &&
    event.tags.every((tag) => Array.isArray(tag) && tag.every((part) => typeof part === "string"))
  );
}

export function tagValue(event: NostrEvent, name: string): string | undefined {
  return event.tags.find((tag) => tag[0] === name)?.[1];
}
```

Create `app/src/relay/relayConnection.ts`:

```ts
import { type Filter, type NostrEvent, isNostrEvent } from "./nostr";

/** The part of WebSocket this client uses; tests pass a fake. */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export type AuthSigner = (input: { challenge: string; relayUrl: string }) => Promise<NostrEvent>;

export type SubscriptionHandlers = {
  onEvent: (event: NostrEvent) => void;
  onEose?: () => void;
  onClosed?: (reason: string) => void;
};

/** The relay refused an event. `reason` is the relay's text, starting with its machine prefix. */
export class RelayRejected extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason || "Your company didn't accept that.");
    this.name = "RelayRejected";
    this.reason = reason;
  }
}

const OPEN = 1;
const MAX_SUBSCRIPTIONS = 64;
const MAX_WAITING = 256;
const MAX_FRAME_CHARS = 512 * 1024;
const ACK_TIMEOUT_MS = 15_000;
const AUTH_WAIT_MS = 1_500;
const UNREACHABLE = "Couldn't reach your company. Check your internet and try again.";

type Waiting = {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
type Subscription = SubscriptionHandlers & { filters: Filter[]; retried: boolean };

/**
 * One relay socket: NIP-42 sign-in (the host signs through the bridge),
 * subscriptions, and publishing that waits for the relay's OK. Requests wait
 * until sign-in is done; a relay that sends no challenge within 1.5 seconds
 * is treated as open.
 */
export class RelayConnection {
  readonly url: string;
  private readonly signAuth: AuthSigner;
  private readonly openSocket: (url: string) => SocketLike;
  private socket: SocketLike | null = null;
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly waiting = new Map<string, Waiting>();
  private gate: Promise<void> = Promise.resolve();
  private openGate: (() => void) | null = null;
  private gateTimer: ReturnType<typeof setTimeout> | null = null;
  private sequence = 0;

  constructor(
    url: string,
    signAuth: AuthSigner,
    openSocket: (url: string) => SocketLike = (target) => new WebSocket(target) as unknown as SocketLike,
  ) {
    this.url = url;
    this.signAuth = signAuth;
    this.openSocket = openSocket;
  }

  async connect(): Promise<void> {
    if (this.socket) return;
    this.closeGate();
    this.gateTimer = setTimeout(() => this.releaseGate(), AUTH_WAIT_MS);
    const socket = this.openSocket(this.url);
    this.socket = socket;
    try {
      await new Promise<void>((resolve, reject) => {
        socket.onopen = () => resolve();
        socket.onerror = () => reject(new Error(UNREACHABLE));
        socket.onclose = () => reject(new Error(UNREACHABLE));
      });
    } catch (error) {
      this.socket = null;
      this.releaseGate();
      throw error;
    }
    socket.onmessage = (event) => this.receive(event.data);
    socket.onclose = () => this.closed("connection closed");
    socket.onerror = null;
    await this.gate;
  }

  subscribe(filters: Filter[], handlers: SubscriptionHandlers): () => void {
    if (this.subscriptions.size >= MAX_SUBSCRIPTIONS) throw new Error("Too many live views are open.");
    this.sequence += 1;
    const id = `s${this.sequence}`;
    this.subscriptions.set(id, { ...handlers, filters, retried: false });
    void this.gate.then(() => {
      if (this.subscriptions.has(id)) this.send(["REQ", id, ...filters]);
    });
    return () => {
      if (this.subscriptions.delete(id)) this.send(["CLOSE", id]);
    };
  }

  async publish(event: NostrEvent): Promise<void> {
    await this.gate;
    await this.acknowledged(event.id, () => this.send(["EVENT", event]));
  }

  close(): void {
    const socket = this.socket;
    this.closed("closed by Colony");
    socket?.close();
  }

  private acknowledged(id: string, sendFrame: () => void): Promise<void> {
    if (this.waiting.size >= MAX_WAITING)
      return Promise.reject(new Error("Too many messages are waiting. Try again in a moment."));
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error("Your company didn't answer in time. Try again."));
      }, ACK_TIMEOUT_MS);
      this.waiting.set(id, { resolve, reject, timer });
      sendFrame();
    });
  }

  private send(message: unknown[]): void {
    if (this.socket && this.socket.readyState === OPEN) this.socket.send(JSON.stringify(message));
  }

  private closeGate(): void {
    if (this.openGate) return;
    this.gate = new Promise<void>((resolve) => {
      this.openGate = resolve;
    });
  }

  private releaseGate(): void {
    if (this.gateTimer) clearTimeout(this.gateTimer);
    this.gateTimer = null;
    const open = this.openGate;
    this.openGate = null;
    open?.();
  }

  private receive(data: unknown): void {
    if (typeof data !== "string" || data.length > MAX_FRAME_CHARS) return;
    let message: unknown;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    if (!Array.isArray(message) || typeof message[0] !== "string") return;
    const [type, first, second, third] = message;
    if (type === "AUTH" && typeof first === "string") void this.authenticate(first);
    else if (type === "EVENT" && typeof first === "string" && isNostrEvent(second))
      this.subscriptions.get(first)?.onEvent(second);
    else if (type === "EOSE" && typeof first === "string") this.subscriptions.get(first)?.onEose?.();
    else if (type === "CLOSED" && typeof first === "string")
      this.handleClosed(first, typeof second === "string" ? second : "");
    else if (type === "OK" && typeof first === "string")
      this.settle(first, second === true, typeof third === "string" ? third : "");
  }

  private async authenticate(challenge: string): Promise<void> {
    if (this.gateTimer) {
      clearTimeout(this.gateTimer);
      this.gateTimer = null;
    }
    this.closeGate();
    try {
      const event = await this.signAuth({ challenge, relayUrl: this.url });
      await this.acknowledged(event.id, () => this.send(["AUTH", event]));
    } catch {
      // A failed sign-in shows up as auth-required on the next request.
    } finally {
      this.releaseGate();
    }
  }

  private settle(id: string, ok: boolean, reason: string): void {
    const entry = this.waiting.get(id);
    if (!entry) return;
    this.waiting.delete(id);
    clearTimeout(entry.timer);
    if (ok) entry.resolve();
    else entry.reject(new RelayRejected(reason));
  }

  private handleClosed(id: string, reason: string): void {
    const subscription = this.subscriptions.get(id);
    if (!subscription) return;
    if (reason.startsWith("auth-required:") && !subscription.retried) {
      subscription.retried = true;
      void this.gate.then(() => {
        if (this.subscriptions.has(id)) this.send(["REQ", id, ...subscription.filters]);
      });
      return;
    }
    this.subscriptions.delete(id);
    subscription.onClosed?.(reason);
  }

  private closed(reason: string): void {
    this.socket = null;
    this.releaseGate();
    for (const [id, entry] of this.waiting) {
      clearTimeout(entry.timer);
      this.waiting.delete(id);
      entry.reject(new Error("Lost the connection to your company."));
    }
    for (const [id, subscription] of this.subscriptions) {
      this.subscriptions.delete(id);
      subscription.onClosed?.(reason);
    }
  }
}
```

Create `app/src/relay/conversations.ts`:

```ts
import type { NostrEvent, UnsignedEventInput } from "./nostr";
import type { RelayConnection } from "./relayConnection";

export type Signer = (input: UnsignedEventInput) => Promise<NostrEvent>;

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * A private topic conversation (T-03): the person who creates it, Scout and
 * any partners. Members are added one NIP-29 add-member event at a time.
 */
export async function createTopicConversation({
  connection,
  sign,
  name,
  memberPubkeys,
  newId = () => crypto.randomUUID(),
}: {
  connection: RelayConnection;
  sign: Signer;
  name: string;
  memberPubkeys: string[];
  newId?: () => string;
}): Promise<string> {
  if (memberPubkeys.some((pubkey) => !HEX64.test(pubkey)))
    throw new Error("A member of this conversation is not valid.");
  const title = name.trim().slice(0, 80) || "New conversation";
  const channelId = newId();
  await connection.publish(
    await sign({
      kind: 9007,
      content: "",
      tags: [
        ["h", channelId],
        ["name", title],
        ["visibility", "private"],
        ["channel_type", "stream"],
      ],
    }),
  );
  for (const pubkey of memberPubkeys)
    await connection.publish(
      await sign({
        kind: 9000,
        content: "",
        tags: [
          ["h", channelId],
          ["p", pubkey],
        ],
      }),
    );
  return channelId;
}

/** A message in a conversation. Named employees get a p tag so they are woken. */
export async function sendMessage({
  connection,
  sign,
  channelId,
  content,
  mentionPubkeys = [],
}: {
  connection: RelayConnection;
  sign: Signer;
  channelId: string;
  content: string;
  mentionPubkeys?: string[];
}): Promise<NostrEvent> {
  const text = content.trim();
  if (!text) throw new Error("Write something first.");
  if (text.length > 64_000) throw new Error("That message is too long.");
  const event = await sign({
    kind: 9,
    content: text,
    tags: [
      ["h", channelId],
      ...mentionPubkeys.filter((pubkey) => HEX64.test(pubkey)).map((pubkey) => ["p", pubkey]),
    ],
  });
  await connection.publish(event);
  return event;
}

/** Live messages of one conversation, newest 200 first, then everything new. */
export function watchMessages({
  connection,
  channelId,
  since,
  onMessage,
  onEose,
}: {
  connection: RelayConnection;
  channelId: string;
  since?: number;
  onMessage: (event: NostrEvent) => void;
  onEose?: () => void;
}): () => void {
  return connection.subscribe(
    [{ kinds: [9], "#h": [channelId], ...(since ? { since } : {}), limit: 200 }],
    {
      onEvent: (event) => {
        if (event.kind === 9) onMessage(event);
      },
      onEose,
    },
  );
}
```

Create `app/src/relay/records.ts`:

```ts
import { verifyEvent } from "nostr-tools/pure";
import { type NostrEvent, type UnsignedEventInput, tagValue } from "./nostr";

export const KIND_BUSINESS_PROFILE_HEAD = 30657;
export const KIND_BUSINESS_PROFILE_ACTION = 47046;
export const KIND_TEAM_COMPUTER_HEAD = 30658;

/** The business profile from the overview contract (schema version 1). */
export type BusinessProfile = {
  schemaVersion: 1;
  name: string;
  whatYouSell: string | null;
  whoBuys: string | null;
  whereYouSell: string[];
  city: string | null;
  country: string | null;
  timeZone: string;
  links: string[];
  voiceWords: string[];
  goals: string[];
  contact: { email: string | null; phone: string | null; whatsapp: string | null; address: string | null };
  buyLink: string | null;
  invoice: {
    registeredName: string | null;
    registrationNumber: string | null;
    vatNumber: string | null;
    bankDetails: string | null;
  };
  socialAccounts: {
    instagram: string | null;
    facebook: string | null;
    tiktok: string | null;
    linkedin: string | null;
    x: string | null;
  };
};

export type TeamComputerRecord = {
  computerId: string;
  computerName: string;
  claimedBy: string;
  claimedAt: number;
  lastSeenAt: number;
};

const HEX64 = /^[0-9a-f]{64}$/;

/** A head we trust: the right kind and address, signed by this company's relay. */
function trusted(event: NostrEvent, kind: number, d: string, relayPubkey: string): boolean {
  return (
    event.kind === kind &&
    event.pubkey === relayPubkey &&
    tagValue(event, "d") === d &&
    verifyEvent(event as Parameters<typeof verifyEvent>[0])
  );
}

function parse(content: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(content);
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function decodeProfileHead(
  event: NostrEvent,
  relayPubkey: string,
): { profile: BusinessProfile; revision: number } | null {
  if (!trusted(event, KIND_BUSINESS_PROFILE_HEAD, "business-profile", relayPubkey)) return null;
  const value = parse(event.content);
  if (
    !value ||
    value.schemaVersion !== 1 ||
    typeof value.name !== "string" ||
    !value.name ||
    typeof value.timeZone !== "string"
  )
    return null;
  const revision = Number(tagValue(event, "revision") ?? "0");
  return {
    profile: value as unknown as BusinessProfile,
    revision: Number.isSafeInteger(revision) && revision >= 0 ? revision : 0,
  };
}

export function decodeTeamComputerHead(event: NostrEvent, relayPubkey: string): TeamComputerRecord | null {
  if (!trusted(event, KIND_TEAM_COMPUTER_HEAD, "team-computer", relayPubkey)) return null;
  const value = parse(event.content);
  if (
    !value ||
    typeof value.computerId !== "string" ||
    typeof value.computerName !== "string" ||
    typeof value.claimedBy !== "string" ||
    !HEX64.test(value.claimedBy) ||
    !Number.isSafeInteger(value.claimedAt) ||
    !Number.isSafeInteger(value.lastSeenAt)
  )
    return null;
  return {
    computerId: value.computerId,
    computerName: value.computerName,
    claimedBy: value.claimedBy,
    claimedAt: value.claimedAt as number,
    lastSeenAt: value.lastSeenAt as number,
  };
}

/** The action that saves the profile; the relay refuses it when the revision moved on. */
export function profileAction(profile: BusinessProfile, expectedRevision: number | null): UnsignedEventInput {
  return {
    kind: KIND_BUSINESS_PROFILE_ACTION,
    content: JSON.stringify({ profile, expectedRevision }),
    tags: [],
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --dir app exec vitest run src/relay`
Expected: PASS, 15 tests.

Run: `pnpm --dir app typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/src/relay
git commit -s -m "feat(app): minimal relay client that signs through the bridge"
```

---

### Task 5.16: Engine console and the smoke test

**Files:**
- Create: `app/index.html`, `app/vite.config.ts`, `app/src/main.tsx`, `app/src/console/EngineConsole.tsx`, `app/playwright.config.ts`, `app/tests/fixtures/fake-native-host.mjs`
- Test: `app/tests/e2e/engine-console.spec.ts`

**Interfaces:**
- Consumes: the bridge (task 5.7), the relay client (task 5.15), the main process (task 5.14).
- Produces: a renderer that loads at `colony://app/`, headed "Colony engine console", with one control per bridge method and these test ids: `console-output`, `team-status-events`, `team-problems`, `navigations`, `messages`, `first-close-panel`, `quit-panel`. A fake native host that speaks the stdio protocol (`ready`, `invoke`, `listen`, `unlisten`, `shutdown`) for tests. This page is a development tool, not a product screen; the product screens come from Codex's approved designs.

- [ ] **Step 1: Write the fake host and the failing smoke test**

Create `app/tests/fixtures/fake-native-host.mjs`:

```js
#!/usr/bin/env node
// A stand-in for colony-native-host that speaks the same stdio protocol, for
// the engine console smoke test. It never touches keys, employees or the network.
import readline from "node:readline";

const PREFIX = "@colony-native:";
const send = (message) => process.stdout.write(`${PREFIX}${JSON.stringify(message)}\n`);
const scout = {
  agentPubkey: "a".repeat(64),
  name: "Scout",
  state: "running",
  since: 1760180000,
  restartsInWindow: 0,
};
const subscriptions = new Map();
const results = {
  get_relay_ws_url: "ws://localhost:3999",
  get_relay_http_url: "http://localhost:3999",
  get_identity: { pubkey: "" },
  team_status: [scout],
  team_claim_status: { thisComputerId: "fake-computer", holder: null, isThisComputer: false },
  team_set_companies: null,
};

send({ type: "ready", version: 1 });
const input = readline.createInterface({ input: process.stdin });
input.on("line", (line) => {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    process.exit(2);
  }
  if (request.type === "shutdown") process.exit(0);
  if (request.type === "listen") {
    subscriptions.set(request.event, request.id);
    send({ type: "response", id: request.id, result: request.id });
    return;
  }
  if (request.type === "unlisten") {
    send({ type: "response", id: request.id, result: null });
    return;
  }
  if (request.type !== "invoke") return;
  if (Object.hasOwn(results, request.command))
    send({ type: "response", id: request.id, result: results[request.command] });
  else send({ type: "response", id: request.id, error: `fake host has no ${request.command}` });
  if (request.command === "team_status" && subscriptions.has("team://status"))
    send({ type: "event", id: subscriptions.get("team://status"), payload: scout });
});
input.on("close", () => process.exit(0));
```

Run: `chmod +x app/tests/fixtures/fake-native-host.mjs`

Create `app/playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  outputDir: "test-results",
  reporter: [["list"]],
  use: { screenshot: "only-on-failure", trace: "retain-on-failure" },
});
```

Create `app/tests/e2e/engine-console.spec.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

const appRoot = path.resolve(import.meta.dirname, "../..");
const fakeHost = path.join(appRoot, "tests", "fixtures", "fake-native-host.mjs");

test("the engine console reaches the host through the typed bridge", async () => {
  const userData = mkdtempSync(path.join(os.tmpdir(), "colony-app-e2e-"));
  const application = await electron.launch({
    cwd: appRoot,
    args: [path.join(appRoot, "electron", "main.mjs")],
    env: {
      ...process.env,
      COLONY_NATIVE_HOST: fakeHost,
      COLONY_APP_USER_DATA: userData,
      COLONY_APP_BACKGROUND: "1",
    },
    timeout: 60_000,
  });
  try {
    const page = await application.firstWindow();
    await expect(page.getByRole("heading", { name: "Colony engine console" })).toBeVisible();

    await page.getByLabel("Company address").fill("ws://localhost:3999");
    await page.getByRole("button", { name: "Team status" }).click();
    await expect(page.getByTestId("console-output")).toContainText("Scout");
    await expect(page.getByTestId("team-status-events")).toContainText("Scout: running");

    await page.getByRole("button", { name: "Claim status" }).click();
    await expect(page.getByTestId("console-output")).toContainText("fake-computer");

    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
    await expect(page.getByTestId("first-close-panel")).toBeVisible();
    await page.getByRole("button", { name: "Got it" }).click();
    await expect
      .poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible()))
      .toBe(false);
  } finally {
    await application.evaluate(({ app }) => app.exit(0)).catch(() => {});
    rmSync(userData, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the smoke test to verify it fails**

Run: `node app/node_modules/electron/install.js` (pnpm does not run Electron's own install script, so fetch the binary once).
Run: `pnpm --dir app exec playwright test`
Expected: FAIL, Electron exits during boot because `app/dist/index.html` does not exist yet (`Colony startup failed`).

- [ ] **Step 3: Write the renderer**

Create `app/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Colony</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Create `app/vite.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  base: "./",
  server: { port: 4180, strictPort: true },
  build: { outDir: "dist", sourcemap: false },
});
```

Create `app/src/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { EngineConsole } from "./console/EngineConsole";

const root = document.getElementById("root");
if (!root) throw new Error("The page has no #root element.");
createRoot(root).render(
  <StrictMode>
    <EngineConsole />
  </StrictMode>,
);
```

Create `app/src/console/EngineConsole.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { BridgeCallError, bridge, callBridge } from "../bridge/client";
import type {
  EmployeeProblem,
  EmployeeRuntimeStatus,
  FirstCloseEvent,
  NavTarget,
  NostrEvent,
  UpdateStatus,
} from "../bridge/types";
import { createTopicConversation, sendMessage, watchMessages } from "../relay/conversations";
import {
  type BusinessProfile,
  KIND_BUSINESS_PROFILE_HEAD,
  KIND_TEAM_COMPUTER_HEAD,
  decodeProfileHead,
  decodeTeamComputerHead,
  profileAction,
} from "../relay/records";
import { RelayConnection } from "../relay/relayConnection";

const TERMS_VERSION = "2026-10-11";

type Line = { at: string; label: string; text: string };

function shown(value: unknown): string {
  if (value === undefined || value === null) return "done";
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function failure(error: unknown): string {
  if (error instanceof BridgeCallError) return `${error.code}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label>
      {label} <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

/** A development page that calls every bridge method. Not a product screen. */
export function EngineConsole() {
  const [lines, setLines] = useState<Line[]>([]);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [relayUrl, setRelayUrl] = useState("");
  const [ownerPubkey, setOwnerPubkey] = useState("");
  const [employeePubkey, setEmployeePubkey] = useState("");
  const [channelId, setChannelId] = useState("");
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<NostrEvent[]>([]);
  const [profileJson, setProfileJson] = useState("");
  const [profileRevision, setProfileRevision] = useState<number | null>(null);
  const [hireId, setHireId] = useState("");
  const [personaId, setPersonaId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [homeChannelId, setHomeChannelId] = useState("");
  const [timeZone, setTimeZone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [statuses, setStatuses] = useState<EmployeeRuntimeStatus[]>([]);
  const [problems, setProblems] = useState<EmployeeProblem[]>([]);
  const [navigations, setNavigations] = useState<NavTarget[]>([]);
  const [firstClose, setFirstClose] = useState<FirstCloseEvent | null>(null);
  const [quitAsked, setQuitAsked] = useState(false);
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const connection = useRef<RelayConnection | null>(null);
  const relayPubkey = useRef<string | null>(null);
  const stopWatching = useRef<(() => void) | null>(null);

  const record = (label: string, text: string) =>
    setLines((current) => [...current.slice(-199), { at: new Date().toLocaleTimeString(), label, text }]);
  const run = (label: string, action: () => Promise<unknown>) => {
    void callBridge(action).then(
      (value) => record(label, shown(value)),
      (error: unknown) => record(label, failure(error)),
    );
  };

  useEffect(() => {
    const api = bridge();
    const stops = [
      api.team.onStatus((status) =>
        setStatuses((list) => [...list.filter((item) => item.agentPubkey !== status.agentPubkey), status]),
      ),
      api.team.onProblem((problem) => setProblems((list) => [...list.slice(-19), problem])),
      api.system.onNavigate((target) => setNavigations((list) => [...list.slice(-19), target])),
      api.system.onFirstClose((event) => setFirstClose(event)),
      api.system.onQuitRequested(() => setQuitAsked(true)),
      api.system.update.onStatus((status) => setUpdate(status)),
    ];
    return () => {
      for (const stop of stops) stop();
      stopWatching.current?.();
      connection.current?.close();
    };
  }, []);

  const company = () => relayUrl.trim();
  const live = () => {
    if (!connection.current) throw new Error("Connect to the company first.");
    return connection.current;
  };
  const sign = (input: Parameters<ReturnType<typeof bridge>["relay"]["signEvent"]>[0]) =>
    bridge().relay.signEvent(input);

  async function connect() {
    stopWatching.current?.();
    connection.current?.close();
    const next = new RelayConnection(company(), (input) => bridge().relay.createAuthEvent(input));
    await next.connect();
    connection.current = next;
    relayPubkey.current = await bridge().relay.selfPubkey(company());
    return `Connected. Relay key: ${relayPubkey.current ?? "not advertised"}`;
  }

  function readHead<T>(kind: number, d: string, decode: (event: NostrEvent, relay: string) => T | null) {
    const socket = live();
    const relay = relayPubkey.current;
    if (!relay) return Promise.reject(new Error("This company does not advertise its relay key."));
    return new Promise<T | null>((resolve, reject) => {
      let best: { at: number; value: T } | null = null;
      const stop = socket.subscribe([{ kinds: [kind], authors: [relay], "#d": [d], limit: 5 }], {
        onEvent: (event) => {
          const value = decode(event, relay);
          if (value !== null && (!best || event.created_at > best.at)) best = { at: event.created_at, value };
        },
        onEose: () => {
          stop();
          resolve(best ? best.value : null);
        },
        onClosed: (reason) => reject(new Error(reason || "Your company closed this view.")),
      });
    });
  }

  async function readProfile() {
    const result = await readHead(KIND_BUSINESS_PROFILE_HEAD, "business-profile", decodeProfileHead);
    if (!result) return "No business profile yet.";
    setProfileJson(JSON.stringify(result.profile, null, 2));
    setProfileRevision(result.revision);
    return result;
  }

  async function saveProfile() {
    const profile = JSON.parse(profileJson) as BusinessProfile;
    await live().publish(await sign(profileAction(profile, profileRevision)));
    return "Profile sent.";
  }

  function watch(id: string) {
    stopWatching.current?.();
    setMessages([]);
    stopWatching.current = watchMessages({
      connection: live(),
      channelId: id,
      onMessage: (event) =>
        setMessages((list) => [...list.filter((item) => item.id !== event.id), event].slice(-200)),
    });
  }

  async function startConversation() {
    const id = await createTopicConversation({
      connection: live(),
      sign,
      name: "New conversation",
      memberPubkeys: [employeePubkey.trim()],
    });
    setChannelId(id);
    watch(id);
    return `Conversation ${id}`;
  }

  async function send() {
    await sendMessage({
      connection: live(),
      sign,
      channelId,
      content: message,
      mentionPubkeys: [employeePubkey.trim()],
    });
    setMessage("");
    return "Sent.";
  }

  const traySummary = () => ({
    signedIn: true,
    setupFinished: true,
    companyName: companyName || null,
    relayUrl: company() || null,
    statusLine: null,
    needsYouCount: 2,
    isTeamComputer: true,
    teamComputerName: null,
    offline: false,
    teamPause: null,
    employees: statuses.map((status) => ({
      agentPubkey: status.agentPubkey,
      name: status.name,
      statusWords: status.state,
    })),
  });

  const api = () => bridge();

  return (
    <main>
      <h1>Colony engine console</h1>
      <p>A development page that calls every bridge method. Not a product screen.</p>

      {firstClose && (
        <section data-testid="first-close-panel" aria-label="First close">
          <h2>Colony keeps working in the {firstClose.platform === "darwin" ? "menu bar" : "tray"}</h2>
          <button type="button" onClick={() => { setFirstClose(null); run("Got it", () => api().system.hideWindow()); }}>
            Got it
          </button>
          <button type="button" onClick={() => { setFirstClose(null); run("Quit instead", () => api().system.requestQuit()); }}>
            Quit instead
          </button>
        </section>
      )}

      {quitAsked && (
        <section data-testid="quit-panel" aria-label="Quit question">
          <h2>Quit Colony? Your team stops until you open Colony again.</h2>
          <button type="button" onClick={() => { setQuitAsked(false); run("Quit Colony", () => api().system.confirmQuit()); }}>
            Quit Colony
          </button>
          <button type="button" onClick={() => { setQuitAsked(false); run("Keep working", () => api().system.cancelQuit()); }}>
            Keep working
          </button>
        </section>
      )}

      <section aria-label="Sign in">
        <h2>Sign in</h2>
        <Field label="Email" value={email} onChange={setEmail} />
        <button type="button" onClick={() => run("Send code", () => api().auth.startEmailCode(email))}>Send code</button>
        <Field label="Code" value={code} onChange={setCode} />
        <button type="button" onClick={() => run("Verify code", () => api().auth.verifyEmailCode({ email, code, termsVersion: TERMS_VERSION }))}>
          Verify code
        </button>
        <button type="button" onClick={() => run("Google", () => api().auth.signInWithGoogle(TERMS_VERSION))}>
          Continue with Google
        </button>
        <button type="button" onClick={() => run("Session", () => api().auth.session())}>Session</button>
        <button type="button" onClick={() => run("Sign out", () => api().auth.signOut())}>Sign out</button>
      </section>

      <section aria-label="Company and team">
        <h2>Company and team</h2>
        <Field label="Business name" value={companyName} onChange={setCompanyName} />
        <button
          type="button"
          onClick={() =>
            run("Create company", async () => {
              const created = await api().company.create({ name: companyName });
              setRelayUrl(created.relayUrl);
              return created;
            })
          }
        >
          Create company
        </button>
        <Field label="Company address" value={relayUrl} onChange={setRelayUrl} />
        <Field label="Owner key" value={ownerPubkey} onChange={setOwnerPubkey} />
        <button type="button" onClick={() => run("Save team list", () => api().team.setCompanies([{ relayUrl: company(), ownerPubkey: ownerPubkey.trim() }]))}>
          Save team list
        </button>
        <button type="button" onClick={() => run("Claim status", () => api().team.claimStatus(company()))}>Claim status</button>
        <button type="button" onClick={() => run("Claim this computer", () => api().team.claim(company(), false))}>Claim this computer</button>
        <button type="button" onClick={() => run("Move team here", () => api().team.claim(company(), true))}>Move team here</button>
        <button type="button" onClick={() => run("Team status", () => api().team.status(company()))}>Team status</button>
        <button type="button" onClick={() => run("Pause team", () => api().team.pause(company()))}>Pause team</button>
        <button type="button" onClick={() => run("Resume team", () => api().team.resume(company()))}>Resume team</button>
        <button type="button" onClick={() => run("Restart team", () => api().team.restartAll(company()))}>Restart team</button>
        <Field label="Employee key" value={employeePubkey} onChange={setEmployeePubkey} />
        <button type="button" onClick={() => run("Restart employee", () => api().team.restartEmployee(employeePubkey.trim()))}>
          Restart employee
        </button>
        <fieldset>
          <legend>Hire</legend>
          <Field label="Hire id" value={hireId} onChange={setHireId} />
          <Field label="Role id" value={personaId} onChange={setPersonaId} />
          <Field label="Name" value={displayName} onChange={setDisplayName} />
          <Field label="Home conversation id" value={homeChannelId} onChange={setHomeChannelId} />
          <Field label="Time zone" value={timeZone} onChange={setTimeZone} />
          <button
            type="button"
            onClick={() =>
              run("Complete hire", () =>
                api().team.hireComplete({ relayUrl: company(), hireId, personaId, displayName, homeChannelId, timeZone }),
              )
            }
          >
            Complete hire
          </button>
        </fieldset>
        <ul data-testid="team-status-events">
          {statuses.map((status) => (
            <li key={status.agentPubkey}>
              {status.name}: {status.state}
              {status.pauseReason ? ` (${status.pauseReason})` : ""}
            </li>
          ))}
        </ul>
        <pre data-testid="team-problems">{problems.map((problem) => `${problem.kind}: ${problem.detail}`).join("\n")}</pre>
      </section>

      <section aria-label="Company records">
        <h2>Company records</h2>
        <button type="button" onClick={() => run("Connect", connect)}>Connect</button>
        <button type="button" onClick={() => run("Read profile", readProfile)}>Read profile</button>
        <label>
          Business profile JSON
          <textarea value={profileJson} onChange={(event) => setProfileJson(event.target.value)} rows={8} cols={80} />
        </label>
        <button type="button" onClick={() => run("Save profile", saveProfile)}>Save profile</button>
        <button type="button" onClick={() => run("Read team computer", () => readHead(KIND_TEAM_COMPUTER_HEAD, "team-computer", decodeTeamComputerHead))}>
          Read team computer
        </button>
      </section>

      <section aria-label="Conversation">
        <h2>Conversation</h2>
        <button type="button" onClick={() => run("New conversation", startConversation)}>New conversation with the employee</button>
        <Field label="Message" value={message} onChange={setMessage} />
        <button type="button" onClick={() => run("Send", send)}>Send</button>
        <ul data-testid="messages">
          {messages.map((event) => (
            <li key={event.id}>{event.content}</li>
          ))}
        </ul>
      </section>

      <section aria-label="This computer">
        <h2>This computer</h2>
        <button type="button" onClick={() => run("Open at login", () => api().system.getOpenAtLogin())}>Open at login?</button>
        <button type="button" onClick={() => run("Open at login on", () => api().system.setOpenAtLogin(true))}>Open at login: on</button>
        <button type="button" onClick={() => run("Open at login off", () => api().system.setOpenAtLogin(false))}>Open at login: off</button>
        <button type="button" onClick={() => run("Stay awake", () => api().system.getKeepAwakeWhilePluggedIn())}>Stay awake?</button>
        <button type="button" onClick={() => run("Stay awake on", () => api().system.setKeepAwakeWhilePluggedIn(true))}>Stay awake: on</button>
        <button type="button" onClick={() => run("Stay awake off", () => api().system.setKeepAwakeWhilePluggedIn(false))}>Stay awake: off</button>
        <button type="button" onClick={() => run("Notification permission", () => api().system.notificationPermission())}>Notification permission</button>
        <button
          type="button"
          onClick={() =>
            run("Test notification", () =>
              api().system.notify({ id: "test:1", title: "Scout", body: "This is a test notification.", target: { screen: "T-05" } }),
            )
          }
        >
          Test notification
        </button>
        <button type="button" onClick={() => run("Close notification", () => api().system.closeNotification("test:1"))}>Close notification</button>
        <button type="button" onClick={() => run("Send tray summary", () => api().system.setTraySummary(traySummary()))}>Send tray summary</button>
        <button type="button" onClick={() => run("Quit", () => api().system.requestQuit())}>Quit</button>
        <pre data-testid="navigations">{navigations.map((target) => `${target.screen}${target.id ? ` ${target.id}` : ""}`).join("\n")}</pre>
      </section>

      <section aria-label="Updates">
        <h2>Updates</h2>
        <p>Update: {update ? `${update.state} (${update.installMode})` : "not checked"}</p>
        <button type="button" onClick={() => run("Update status", () => api().system.update.status())}>Update status</button>
        <button type="button" onClick={() => run("Download update", () => api().system.update.download())}>Download update</button>
        <button type="button" onClick={() => run("Restart to update", () => api().system.update.restartToInstall())}>Restart to update</button>
      </section>

      <section aria-label="Output">
        <h2>Output</h2>
        <pre data-testid="console-output">{lines.map((line) => `[${line.at}] ${line.label}\n${line.text}`).join("\n\n")}</pre>
      </section>
    </main>
  );
}
```

Run: `pnpm --dir app check` and fix any formatting with `pnpm --dir app fix`.

- [ ] **Step 4: Build and run the smoke test to verify it passes**

Run: `pnpm --dir app build`
Expected: `app/dist/index.html` and `app/dist/assets/` exist.

Run: `pnpm --dir app exec playwright test`
Expected: PASS, 1 test. On Linux run it under `xvfb-run -a`.

- [ ] **Step 5: Commit**

```bash
git add app/index.html app/vite.config.ts app/src/main.tsx app/src/console app/playwright.config.ts app/tests
git add --chmod=+x app/tests/fixtures/fake-native-host.mjs
git commit -s -m "feat(app): engine console and an Electron smoke test against a fake host"
```

---

### Task 5.17: Unsigned installers for Mac (universal) and Windows (x64)

**Files:**
- Create: `app/scripts/package-config.mjs`, `app/scripts/prepare-host-binaries.mjs`, `app/scripts/after-sign.cjs`, `app/scripts/package.mjs`
- Test: `app/scripts/package-config.test.mjs`

**Interfaces:**
- Consumes: `app/package.json` version; esbuild; electron-builder; host and sidecar binaries per architecture from the release build (E-27); the binary list in `desktop/scripts/electron-package-config.mjs:70-88`; the ad hoc seal rule in `desktop/scripts/electron-package-config.mjs:92-102`.
- Produces: `APP_ID`, `PRODUCT_NAME`, `DEFAULT_UPDATE_ASSETS_URL`, `hostBinaryNames(platform)`, `parsePackageArgs(args)`, `releaseCapabilities(platform)`, `createBuilderConfig({ appRoot, platform, version, hostDir, updateAssetsUrl? })`; `lipoArguments({ name, arm64Dir, x64Dir, outDir })`, `parseHostArgs(args)`; the electron-builder `afterSign` hook with `adhocSignArguments` and `verifySignatureArguments`; `pnpm --dir app package -- --platform=darwin|win32 --host-dir=<dir>` writing `release-capabilities.json`, `build-config.json` and `updater-runtime.cjs`, building the renderer and running electron-builder.

- [ ] **Step 1: Write the failing test**

Create `app/scripts/package-config.test.mjs`:

```js
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createBuilderConfig,
  hostBinaryNames,
  parsePackageArgs,
  releaseCapabilities,
} from "./package-config.mjs";
import { lipoArguments, parseHostArgs } from "./prepare-host-binaries.mjs";

describe("packaging", () => {
  it("builds unsigned Mac universal installers that keep the host binaries as they are", () => {
    const config = createBuilderConfig({ appRoot: "/repo/app", platform: "darwin", version: "2.0.0", hostDir: "/host" });
    expect(config.appId).toBe("global.colony.app");
    expect(config.productName).toBe("Colony");
    expect(config.mac.target).toEqual([
      { target: "dmg", arch: ["universal"] },
      { target: "zip", arch: ["universal"] },
    ]);
    expect(config.mac.identity).toBeNull();
    expect(config.mac.x64ArchFiles).toBe(
      "Contents/Resources/{colony-native-host,buzz-acp,buzz-agent,buzz-dev-mcp,git-credential-nostr,buzz,buzz-backend-kubernetes}",
    );
    expect(config.extraResources[0]).toEqual({
      from: path.join("/host", "colony-native-host"),
      to: "colony-native-host",
    });
    expect(config.artifactName).toBe(`Colony-\${version}-\${arch}-UNSIGNED.\${ext}`);
    expect(config.afterSign).toBe(path.join("/repo/app", "scripts", "after-sign.cjs"));
    expect(config.files).toContain("!electron/updater-runtime.mjs");
  });

  it("builds an unsigned Windows x64 installer", () => {
    const config = createBuilderConfig({ appRoot: "/repo/app", platform: "win32", version: "2.0.0", hostDir: "/host" });
    expect(config.win.target).toEqual([{ target: "nsis", arch: ["x64"] }]);
    expect(config.win.verifyUpdateCodeSignature).toBe(false);
    expect(hostBinaryNames("win32")).toContain("colony-native-host.exe");
    expect(hostBinaryNames("win32")).not.toContain("buzz-backend-kubernetes.exe");
  });

  it("refuses a version that is not semantic", () => {
    expect(() =>
      createBuilderConfig({ appRoot: "/a", platform: "darwin", version: "two", hostDir: "/h" }),
    ).toThrow("semantic versioning");
  });

  it("marks Windows for automatic updates and a Mac for downloads", () => {
    expect(releaseCapabilities("win32")).toEqual({
      schemaVersion: 1,
      release: true,
      autoUpdate: true,
      signed: false,
      platformKey: "win32-x64",
    });
    expect(releaseCapabilities("darwin")).toMatchObject({
      autoUpdate: false,
      signed: false,
      platformKey: "darwin-universal",
    });
  });

  it("reads the package and host arguments", () => {
    expect(parsePackageArgs(["--", "--platform=darwin", "--host-dir=build/host/darwin-universal"])).toEqual({
      platform: "darwin",
      hostDir: "build/host/darwin-universal",
    });
    expect(() => parsePackageArgs(["--platform=linux", "--host-dir=x"])).toThrow("--platform must be darwin or win32.");
    expect(() => parsePackageArgs(["--platform=darwin"])).toThrow("--host-dir is required.");
    expect(parseHostArgs(["--arm64-dir=/arm", "--x64-dir=/x64", "--out-dir=/out"])).toEqual({
      arm64Dir: "/arm",
      x64Dir: "/x64",
      outDir: "/out",
    });
  });

  it("merges each host binary with lipo", () => {
    expect(lipoArguments({ name: "buzz-acp", arm64Dir: "/arm", x64Dir: "/x64", outDir: "/out" })).toEqual([
      "-create",
      path.join("/arm", "buzz-acp"),
      path.join("/x64", "buzz-acp"),
      "-output",
      path.join("/out", "buzz-acp"),
    ]);
  });

  it("seals an unsigned Mac app ad hoc and verifies the seal", () => {
    const afterSign = createRequire(import.meta.url)("./after-sign.cjs");
    expect(afterSign.adhocSignArguments("/x/Colony.app")).toEqual(["--force", "--deep", "--sign", "-", "/x/Colony.app"]);
    expect(afterSign.verifySignatureArguments("/x/Colony.app")).toEqual([
      "--verify",
      "--deep",
      "--strict",
      "/x/Colony.app",
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir app exec vitest run scripts/package-config.test.mjs`
Expected: FAIL, the script modules do not exist.

- [ ] **Step 3: Write the packaging modules**

Create `app/scripts/package-config.mjs`:

```js
import path from "node:path";
import semver from "semver";

export const APP_ID = "global.colony.app";
export const PRODUCT_NAME = "Colony";
export const DEFAULT_UPDATE_ASSETS_URL =
  "https://github.com/AI-Native-Ventures/colony-ai/releases/download/colony-app-channel/";

// The binaries the host starts, as in desktop/scripts/electron-package-config.mjs:75-88.
const SIDECARS = ["buzz-acp", "buzz-agent", "buzz-dev-mcp", "git-credential-nostr", "buzz"];

export function hostBinaryNames(platform) {
  const suffix = platform === "win32" ? ".exe" : "";
  const names = [
    "colony-native-host",
    ...SIDECARS,
    ...(platform === "win32" ? [] : ["buzz-backend-kubernetes"]),
  ];
  return names.map((name) => `${name}${suffix}`);
}

export function parsePackageArgs(args) {
  const options = {};
  for (const argument of args) {
    if (argument === "--") continue;
    const separator = argument.indexOf("=");
    const flag = separator === -1 ? argument : argument.slice(0, separator);
    const value = separator === -1 ? "" : argument.slice(separator + 1);
    const key = { "--platform": "platform", "--host-dir": "hostDir" }[flag];
    if (!key) throw new Error(`Unknown argument ${JSON.stringify(argument)}.`);
    if (!value) throw new Error(`${flag} cannot be empty.`);
    options[key] = value;
  }
  if (!["darwin", "win32"].includes(options.platform))
    throw new Error("--platform must be darwin or win32.");
  if (!options.hostDir) throw new Error("--host-dir is required.");
  return options;
}

/** Read by the app at start (build-config.mjs): Windows installs updates, a Mac downloads them. */
export function releaseCapabilities(platform) {
  return {
    schemaVersion: 1,
    release: true,
    autoUpdate: platform === "win32",
    signed: false,
    platformKey: platform === "darwin" ? "darwin-universal" : "win32-x64",
  };
}

/** electron-builder settings for unsigned installers: Mac universal DMG and ZIP, Windows x64 NSIS. */
export function createBuilderConfig({
  appRoot,
  platform,
  version,
  hostDir,
  updateAssetsUrl = DEFAULT_UPDATE_ASSETS_URL,
}) {
  if (!semver.valid(version)) throw new Error("The app version must use semantic versioning.");
  const binaries = hostBinaryNames(platform);
  const icons = path.join(appRoot, "..", "desktop", "src-tauri", "icons");
  const common = {
    appId: APP_ID,
    productName: PRODUCT_NAME,
    asar: true,
    directories: { output: path.join(appRoot, "release") },
    files: [
      "electron/**/*",
      "!electron/**/*.test.mjs",
      "!electron/updater-runtime.mjs",
      "dist/**/*",
      "package.json",
    ],
    extraResources: binaries.map((name) => ({ from: path.join(hostDir, name), to: name })),
    artifactName: `Colony-\${version}-\${arch}-UNSIGNED.\${ext}`,
    protocols: [{ name: "Colony", schemes: ["colony"] }],
    publish: [{ provider: "generic", url: updateAssetsUrl }],
    afterSign: path.join(appRoot, "scripts", "after-sign.cjs"),
  };
  if (platform === "darwin")
    return {
      ...common,
      mac: {
        target: [
          { target: "dmg", arch: ["universal"] },
          { target: "zip", arch: ["universal"] },
        ],
        category: "public.app-category.business",
        icon: path.join(icons, "icon.icns"),
        identity: null,
        hardenedRuntime: false,
        gatekeeperAssess: false,
        // The host binaries are already universal (prepare-host-binaries.mjs), so the
        // universal merge must copy them rather than try to merge them again.
        x64ArchFiles: `Contents/Resources/{${binaries.join(",")}}`,
        extendInfo: {
          NSMicrophoneUsageDescription: "Colony uses your microphone only while you record a voice note.",
        },
      },
    };
  return {
    ...common,
    win: {
      target: [{ target: "nsis", arch: ["x64"] }],
      icon: path.join(icons, "icon.ico"),
      verifyUpdateCodeSignature: false,
    },
    nsis: { oneClick: true, perMachine: false, allowElevation: false },
  };
}
```

Create `app/scripts/prepare-host-binaries.mjs`:

```js
import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { hostBinaryNames } from "./package-config.mjs";

const exec = promisify(execFile);

/** lipo arguments that merge one Apple Silicon and one Intel binary into one universal file. */
export function lipoArguments({ name, arm64Dir, x64Dir, outDir }) {
  return [
    "-create",
    path.join(arm64Dir, name),
    path.join(x64Dir, name),
    "-output",
    path.join(outDir, name),
  ];
}

export function parseHostArgs(args) {
  const options = {};
  for (const argument of args) {
    if (argument === "--") continue;
    const separator = argument.indexOf("=");
    const flag = argument.slice(0, separator);
    const key = { "--arm64-dir": "arm64Dir", "--x64-dir": "x64Dir", "--out-dir": "outDir" }[flag];
    const value = separator === -1 ? "" : argument.slice(separator + 1);
    if (!key || !value) throw new Error(`Bad argument ${JSON.stringify(argument)}.`);
    options[key] = value;
  }
  for (const key of ["arm64Dir", "x64Dir", "outDir"])
    if (!options[key]) throw new Error("--arm64-dir, --x64-dir and --out-dir are required.");
  return options;
}

async function main(args) {
  const { arm64Dir, x64Dir, outDir } = parseHostArgs(args);
  await mkdir(outDir, { recursive: true });
  for (const name of hostBinaryNames("darwin"))
    await exec("lipo", lipoArguments({ name, arm64Dir, x64Dir, outDir }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main(process.argv.slice(2));
```

Create `app/scripts/after-sign.cjs`:

```js
"use strict";

// electron-builder afterSign hook. An unsigned Mac build still needs one valid
// ad hoc seal over the whole bundle, or macOS reports the app as damaged and
// offers no way to open it (desktop/scripts/electron-package-config.mjs:92-102).
const { execFileSync } = require("node:child_process");
const path = require("node:path");

function adhocSignArguments(appPath) {
  return ["--force", "--deep", "--sign", "-", appPath];
}

function verifySignatureArguments(appPath) {
  return ["--verify", "--deep", "--strict", appPath];
}

async function afterSign(context) {
  if (context.electronPlatformName !== "darwin") return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync("codesign", adhocSignArguments(appPath), { stdio: "inherit" });
  execFileSync("codesign", verifySignatureArguments(appPath), { stdio: "inherit" });
}

module.exports = afterSign;
module.exports.adhocSignArguments = adhocSignArguments;
module.exports.verifySignatureArguments = verifySignatureArguments;
```

Create `app/scripts/package.mjs`:

```js
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { createBuilderConfig, parsePackageArgs, releaseCapabilities } from "./package-config.mjs";

const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: appRoot,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} exited with ${code}`)),
    );
  });
}

const { platform, hostDir } = parsePackageArgs(process.argv.slice(2));
const { version } = JSON.parse(await readFile(path.join(appRoot, "package.json"), "utf8"));
await writeFile(
  path.join(appRoot, "electron", "release-capabilities.json"),
  `${JSON.stringify(releaseCapabilities(platform), null, 2)}\n`,
);
await writeFile(
  path.join(appRoot, "electron", "build-config.json"),
  `${JSON.stringify({ googleDesktopClientId: process.env.COLONY_GOOGLE_DESKTOP_CLIENT_ID ?? "" }, null, 2)}\n`,
);
// Update support ships as one bundled file, so the installer carries no node_modules.
await build({
  entryPoints: [path.join(appRoot, "electron", "updater-runtime.mjs")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["electron"],
  outfile: path.join(appRoot, "electron", "updater-runtime.cjs"),
  logLevel: "warning",
});
await run(pnpm, ["build"]);
const temporary = await mkdtemp(path.join(os.tmpdir(), "colony-app-builder-"));
try {
  const configPath = path.join(temporary, "electron-builder.json");
  await writeFile(
    configPath,
    JSON.stringify(
      createBuilderConfig({ appRoot, platform, version, hostDir: path.resolve(hostDir) }),
      null,
      2,
    ),
  );
  await run(pnpm, [
    "exec",
    "electron-builder",
    "--config",
    configPath,
    "--publish",
    "never",
    platform === "darwin" ? "--mac" : "--win",
  ]);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir app exec vitest run scripts/package-config.test.mjs`
Expected: PASS, 7 tests.

- [ ] **Step 5: Verify a real Mac package once**

This needs the host and sidecar binaries for both Mac architectures from the release build (E-27); it is a manual check on a Mac, not a CI step.

Run: `node app/scripts/prepare-host-binaries.mjs --arm64-dir=<arm64 binaries> --x64-dir=<x64 binaries> --out-dir=app/build/host/darwin-universal`
Run: `pnpm --dir app package -- --platform=darwin --host-dir=build/host/darwin-universal`
Expected: `app/release/Colony-2.0.0-dev.0-universal-UNSIGNED.dmg` and `.zip` exist.

Run: `codesign --verify --deep --strict app/release/mac-universal/Colony.app && lipo -archs app/release/mac-universal/Colony.app/Contents/Resources/colony-native-host`
Expected: no output from codesign, then `x86_64 arm64`.

- [ ] **Step 6: Commit**

```bash
git add app/scripts
git commit -s -m "feat(app): unsigned Mac universal and Windows x64 installers"
```

---

### Task 5.18: CI and local recipes

**Files:**
- Create: `.github/workflows/colony-app.yml`
- Modify: `Justfile:149-151` (new recipes after `desktop-build`)

**Interfaces:**
- Consumes: the package scripts from task 5.1 (`check`, `typecheck`, `test`, `build`); the fake host from task 5.16.
- Produces: `just app-check`, `just app-typecheck`, `just app-test`; a GitHub workflow "Colony app" that runs lint, type checks and unit tests on Ubuntu, then the engine console smoke in real Electron on Ubuntu (under Xvfb) and macOS, on pull requests that touch `app/**`, the lockfile or the workspace file.

- [ ] **Step 1: Add the recipes**

In `Justfile`, after the `desktop-build` recipe (lines 149-151), add:

```just
# New Colony app (app/): lint and format checks
app-check:
    cd app && pnpm check

# New Colony app: TypeScript checks
app-typecheck:
    cd app && pnpm typecheck

# New Colony app: unit tests
app-test:
    cd app && pnpm test
```

Run: `just app-check app-typecheck app-test`
Expected: no lint or type errors; every unit test from tasks 5.1 to 5.17 passes (149 tests).

- [ ] **Step 2: Add the workflow**

Create `.github/workflows/colony-app.yml`:

```yaml
name: Colony app

# Lint, type checks and unit tests for the new Colony app (app/), then the
# engine console smoke in real Electron against a fake native host. It needs
# no relay, no real host build and no signing, so it is quick.

on:
  pull_request:
    paths:
      - ".github/workflows/colony-app.yml"
      - "app/**"
      - "pnpm-lock.yaml"
      - "pnpm-workspace.yaml"
  workflow_dispatch:

concurrency:
  group: ${{ github.workflow }}-${{ github.event_name == 'pull_request' && github.ref || github.sha }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}

permissions:
  contents: read

jobs:
  checks:
    name: Colony app checks
    runs-on: ubuntu-22.04
    timeout-minutes: 20
    steps:
      - name: Check out the reviewed commit
        uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6.0.3

      - name: Activate the pinned toolchain
        uses: cashapp/activate-hermit@cea9af7913204a965fd488637a8d1811bba2e616 # v1

      - name: Install app dependencies
        shell: bash
        run: |
          set -euo pipefail
          . ./bin/activate-hermit
          pnpm install --frozen-lockfile --filter colony-app

      - name: Lint, type checks and unit tests
        shell: bash
        run: |
          set -euo pipefail
          . ./bin/activate-hermit
          just app-check
          just app-typecheck
          just app-test

  smoke:
    name: Engine console smoke (${{ matrix.os }})
    needs: checks
    strategy:
      fail-fast: false
      matrix:
        os:
          - ubuntu-22.04
          - macos-14
    runs-on: ${{ matrix.os }}
    timeout-minutes: 20
    steps:
      - name: Check out the reviewed commit
        uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6.0.3

      - name: Activate the pinned toolchain
        uses: cashapp/activate-hermit@cea9af7913204a965fd488637a8d1811bba2e616 # v1

      - name: Install Linux display dependencies
        if: runner.os == 'Linux'
        env:
          DEBIAN_FRONTEND: noninteractive
        run: |
          sudo apt-get update -o Acquire::Retries=3
          sudo apt-get install -y --no-install-recommends -o DPkg::Lock::Timeout=120 xvfb

      - name: Install app dependencies
        shell: bash
        run: |
          set -euo pipefail
          . ./bin/activate-hermit
          pnpm install --frozen-lockfile --filter colony-app

      - name: Make sure the Electron binary is installed
        shell: bash
        run: |
          set -euo pipefail
          . ./bin/activate-hermit
          node app/node_modules/electron/install.js

      - name: Install Linux Electron runtime libraries
        if: runner.os == 'Linux'
        shell: bash
        run: |
          set -euo pipefail
          . ./bin/activate-hermit
          pnpm --dir app exec playwright install-deps chromium

      - name: Build the renderer and run the smoke
        shell: bash
        run: |
          set -euo pipefail
          . ./bin/activate-hermit
          pnpm --dir app build
          if [[ "$RUNNER_OS" == "Linux" ]]; then
            xvfb-run -a pnpm --dir app exec playwright test
          else
            pnpm --dir app exec playwright test
          fi
```

Run: `scripts/test-ci-required-context-isolation.sh`
Expected: it passes; the new workflow is separate from `ci.yml` and adds no required context.

- [ ] **Step 3: Commit**

```bash
git add Justfile .github/workflows/colony-app.yml
git commit -s -m "ci(app): lint, type checks, unit tests and the Electron smoke for the new app"
```

---

## Contract changes

These extend the overview's contract. Later parts use them as written here.

1. **Bridge additions** (all in `app/electron/bridge-contract.mjs` and `app/src/bridge/types.ts`):
   - `platform: string`.
   - `company.create({ name }) => { communityId, slug, relayUrl }`. Company creation runs in main with NIP-98; it retries numbered names when one is taken.
   - `relay.urls()`, `relay.signEvent(input)`, `relay.createAuthEvent({ challenge, relayUrl })` and `relay.selfPubkey(relayUrl)`. The renderer's relay client needs to sign; signing stays in the host, and main allows only the kinds in `RENDERER_SIGNABLE_KINDS`. A later part that needs a new kind adds it there, with a test.
   - `system.closeNotification(id)`, so a decision handled elsewhere loses its notification (G-03).
   - `system.setTraySummary(summary: TraySummary)`, because the menu bar shows relay facts (company name, Needs you count, status words) that only the renderer has.
   - `system.hideWindow()`, `system.requestQuit()`, `system.confirmQuit()` and `system.cancelQuit()`, plus `system.onFirstClose(callback)` and `system.onQuitRequested(callback)`, for X-14 and X-15.
   - `system.update.onStatus(callback)`.
2. **`EmployeeProblem.agentPubkey` may be `null`.** It is null when the whole engine stopped (X-10) rather than one employee.
3. **`SessionSummary` fields** are fixed as `{ accountId, email, pubkey, googleLinked, created }`.
4. **Host flag `COLONY_APP_SHELL=1`** (task 5.3). The new app sets it. The host then installs no menu bar icon of its own, and `sign_out` ends the host process instead of restarting it; the shell relaunches itself after the host exits.
5. **App links** for W-05, W-06 and W-07 (and any later page or email):
   - `colony://open?screen=<screen pack ID>&id=<id>`
   - `colony://join?invite=<code>`
   - `colony://payment?status=success|cancelled`

   The new app registers the `colony` scheme. Installing it where the old app is still installed may route `colony://` links to either app.
6. **Update channel.** The new app reads `update-metadata.json` and its Windows update files from a dedicated GitHub release tagged `colony-app-channel`, and sends Mac owners to `https://colony.global/download`. The release work (E-27) must publish to that channel, using platform keys `darwin-universal` and `win32-x64`.
7. **No agent browser yet.** The new app starts the host with `COLONY_BROWSER_AGENT=0`, because the browser broker (`desktop/electron/browser-broker/`, about 16,000 lines) is not ported in this part. Employees use their own web tools until it is.
8. **`EmployeeRuntimeStatus.pauseReason?: "person" | "credits" | "plan_limit"`** (part I, through the coordinator). `app/src/bridge/types.ts` exports it with a `PauseReason` type, and main passes it through untouched. The tray reads it: a credits or plan-limit pause shows the problem icon (G-02 lists both as team problems) with the header "Team paused: credits ran out" or "Team paused: plan limit reached", and the tray then offers neither Pause nor Resume, because those pauses clear by themselves (G-04c). That last choice is a default of this part. `TraySummary.teamPause: PauseReason | null` replaces the boolean `teamPaused`. Part I's plan file still says `"credits_out"` (its contract change 1 and `allPausedForCredits`); it must use `"credits"`.
9. **`COLONY_RELAY_URL`** (part I). Main checks it like a company address (wss anywhere, ws only on this computer) and starts the host with `BUZZ_RELAY_URL` and `BUZZ_RELAY_HTTP` set from it, the names the host reads (`desktop/src-tauri/src/relay.rs:39-43` and `:106-116`). `relay.urls()` then returns the override, and new company addresses are built on it. A bad value stops startup with a plain message.
10. **Resume after a purchase** (part I). When `colony://payment?status=success` arrives, main checks, on the team computer only, whether the active company's team is paused for credits, and if so calls `team_resume`. The host's `resume_if_funded` is the balance check: it resumes only when the balance covers work and refuses otherwise, so main tries at 0, 10, 30 and 60 seconds and then leaves it to the host's polling. Other computers leave it to the team computer. One narrow race remains: if the host's poll clears the credits pause between main's status read and its `team_resume`, `team_resume` falls through to a person's resume (part I contract change 3) and would lift a person's pause too. A credits-only resume command in part D would close it.
11. **Closing the window hides it.** The window is never destroyed while Colony runs, because the renderer behind it holds the relay subscriptions that feed notifications and the tray (G-03 notifies with the window closed). Reopening from the menu bar or tray shows the same window. The first close keeps the window up with X-14 until the person answers. Part I's gate row `close-window` waits for a new `window` event, which never comes; it must answer X-14 when it shows and then wait for the same window's `isVisible()` after the reopen.
12. **Tests.** `pnpm --dir app test` runs Vitest over `electron/`, `scripts/` and `src/` only. Part I appends `node --test tests/real-run/first-run/*.test.mjs` to the `test` script for its `node:test` files; neither runner collects the other's files, and CI runs both through `just app-test`.

## Self-review

**Spec coverage** (the directive's scope against tasks):

| Scope item | Task |
|-|-|
| Electron main spawns and supervises `colony-native-host` | 5.2, 5.14 (engine supervisor with restart budget and generation fence) |
| Copy versus shared package, with reasons | "Shared code decision" at the top |
| Preload with the typed ColonyBridge; main handlers call part D's host commands | 5.2, 5.7, 5.14 |
| Renderer engine console exercising every bridge method | 5.16 (one control per method in `BRIDGE_METHODS`) |
| Minimal relay client: sign in (part A endpoints), private topic conversation with Scout, send and receive, profile and team computer records | 5.4 and 5.5 (sign-in in main), 5.15, 5.16 |
| Menu bar on Mac and tray on Windows with the G-02 items | 5.10, wired in 5.14; the host's own Mac icon is turned off in 5.3 |
| Close to tray on both platforms; first close event (X-14); quit confirmation on the team computer (X-15) | 5.11, wired in 5.14 |
| Open at login | 5.8 |
| Keep awake while plugged in, on Mac and Windows | 5.9 |
| Updates: Windows installs on restart, Mac download-only | 5.13, wired in 5.14 |
| Packaging: Mac universal and Windows x64 NSIS, unsigned | 5.17 |
| Vitest tests for every main-process module; one Playwright smoke | Every task; 5.16 for the smoke |
| CI | 5.18 |
| Part I: pause reasons, `COLONY_RELAY_URL`, resume after a purchase | 5.7 (types), 5.10 (tray), 5.12 (`onLink`), 5.14 (`hostRelayEnv`, `createPurchaseResumer`) |

**Placeholder scan:** no "TBD", "TODO" or "similar to Task N". Every code step shows its code. The one step without code is the manual Mac package check in 5.17, which lists its exact commands and expected output.

**Type consistency:** these names are used identically everywhere:
- `createHostCommands`, `subscribeHostEvent`, `HOST_COMMANDS`, `HOST_EVENTS`, `RENDERER_SIGNABLE_KINDS`, `NIP98_KIND`
- `BridgeError` and `toWire`
- `BRIDGE_METHODS`, `BRIDGE_EVENTS`, `BRIDGE_CHANNEL`, `BRIDGE_EVENT_CHANNEL`
- `createBridgeRouter`, `createSessionService`, `createCompanyService`, `createRelayHttp`, `httpUrlFromWs`
- `trayModel`, `trayIconState`, `validTraySummary`, `createTrayController`
- `createWindowLifecycle` with `prepareForUpdate` and `stopForUpdate`
- `createNavigator` with `openLink`, `openFromArgv`, `setReady`
- `createNotifier`, `createUpdates` with `canInstall` and `restartToInstall`
- `createEngineSupervisor` with `startFirst`, `ensureRunning`, `isCurrent`
- `PauseReason`, `pauseReason`, `TraySummary.teamPause`, `hostRelayEnv`, `pausedForCredits`, `createPurchaseResumer` with `afterPurchase`, and `createNavigator`'s `onLink`
- `RelayConnection`, `createTopicConversation`, `sendMessage`, `watchMessages`, `decodeProfileHead`, `decodeTeamComputerHead`, `profileAction`

Host command names and argument shapes match the overview's "Host commands" list.

**Review Focus:** each of the five lines has a pinned test:
1. "asks natively when the renderer cannot answer" (5.11).
2. "queues links until the renderer is ready, then delivers each once" (5.12).
3. "refuses a fourth restart in ten minutes" and "drops an engine that started late" (5.14).
4. "holds the team computer awake on power and lets go on battery" and "never holds the computer awake unless it runs the team" (5.9).
5. "puts the key into the host and returns a summary without it" and "fails closed when the imported key belongs to someone else" (5.5).

**Known limits, stated rather than hidden:**
- Electron cannot read the computer's notification permission, so `notificationPermission()` answers "unknown" (X-20 needs host help later).
- A closed laptop lid still sleeps the computer (S-07 says so in plain words).
- The real-host, real-relay run of this shell is the phase 1 gate in part I. The smoke test here uses a fake host.
- A payment link that arrives before the renderer has sent its tray summary (for example one that starts Colony) leaves the resume to the host's own balance polling, at most about two minutes later (part I).
