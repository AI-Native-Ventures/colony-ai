# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: browser-broker.spec.ts >> real Electron browser broker: allowed actions, denied destinations, revoke and confirmed submit
- Location: tests/electron/browser-broker.spec.ts:13:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: "origin_approval_required"
Received: "driver_error"
```

# Test source

```ts
  64  |   let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
  65  |   let client: ReturnType<typeof createBrokerClient> | undefined;
  66  |   try {
  67  |     application = await electron.launch({
  68  |       args: [path.resolve(import.meta.dirname, "fixtures/browser-broker.mjs")],
  69  |       env: {
  70  |         ...process.env,
  71  |         COLONY_BROWSER_AGENT: "1",
  72  |         COLONY_BROWSER_FIXTURE_URL: origin,
  73  |         COLONY_ELECTRON_USER_DATA: dir,
  74  |       },
  75  |       timeout: 30_000,
  76  |     });
  77  |     const page = await application.firstWindow();
  78  |     await page.waitForLoadState();
  79  |     const request = <T>(action: string, payload: object = {}) =>
  80  |       page.evaluate(
  81  |         async ({ action, payload }) => {
  82  |           return (window.colonyBrowserBroker as BrowserBrokerBridge).request(
  83  |             action,
  84  |             payload,
  85  |           );
  86  |         },
  87  |         { action, payload },
  88  |       ) as Promise<T>;
  89  |     expect(await request("agent-status")).toEqual({ enabled: true });
  90  |     const tab = await page.evaluate(async () => {
  91  |       const host = window.colonyBrowserHost as BrowserHostApi;
  92  |       const tab = await host.createTab({ businessId: "fixture-business" });
  93  |       await host.attach(tab.id, { x: 0, y: 50, width: 900, height: 620 });
  94  |       return tab;
  95  |     });
  96  |     const grant = await request<BrowserGrant>("agent-grant", {
  97  |       agentId: "fixture-agent",
  98  |       taskId: "fixture-task",
  99  |       businessId: "fixture-business",
  100 |       tabId: tab.id,
  101 |       allowedOrigins: [origin],
  102 |     });
  103 |     expect(JSON.stringify(grant)).not.toMatch(/token|secret/i);
  104 |     const env = await application.evaluate(
  105 |       () =>
  106 |         (
  107 |           globalThis as typeof globalThis & {
  108 |             colonyBrowserFixture: { env: Record<string, string> };
  109 |           }
  110 |         ).colonyBrowserFixture.env,
  111 |     );
  112 |     client = createBrokerClient({
  113 |       socketPath: env.COLONY_BROWSER_BROKER_SOCKET,
  114 |       secret: env.COLONY_BROWSER_BROKER_SECRET,
  115 |       agent: "fixture-agent",
  116 |     });
  117 |     client.start();
  118 |     await expect.poll(() => client?.isReady()).toBe(true);
  119 |     const connectedClient = client;
  120 |     const call = (tool: string, args: object) =>
  121 |       connectedClient.callTool(tool, { tab: tab.id, ...args });
  122 |     expect((await call("browser_navigate", { url: origin })).ok).toBe(true);
  123 |     const snapshot = await call("browser_snapshot", {});
  124 |     expect(snapshot.ok).toBe(true);
  125 |     expect(snapshot.snapshot).toContain("untrusted-page-content");
  126 |     expect(snapshot.snapshot).not.toContain("credential-do-not-leak");
  127 |     const ref = (name: string) => {
  128 |       const line = snapshot.snapshot
  129 |         .split("\n")
  130 |         .find((line: string) => line.includes(name) && line.includes("[ref="));
  131 |       const match = /\[ref=(e\d+)\]/u.exec(line ?? "");
  132 |       if (!match)
  133 |         throw new Error(`Missing ref for ${name}: ${snapshot.snapshot}`);
  134 |       return match[1];
  135 |     };
  136 |     expect(
  137 |       (await call("browser_type", { ref: ref("Note"), text: "Hello fixture" }))
  138 |         .ok,
  139 |     ).toBe(true);
  140 |     expect(
  141 |       (await call("browser_select", { ref: ref("Choice"), values: ["two"] }))
  142 |         .ok,
  143 |     ).toBe(true);
  144 |     expect((await call("browser_click", { ref: ref("Change") })).ok).toBe(true);
  145 |     expect(
  146 |       (await call("browser_wait", { text: "Changed", timeoutMs: 2_000 }))
  147 |         .matched,
  148 |     ).toBe(true);
  149 |     expect(
  150 |       (await call("browser_scroll", { direction: "down", amount: 100 })).ok,
  151 |     ).toBe(true);
  152 |     const shot = await call("browser_screenshot", {});
  153 |     expect(shot.ok).toBe(true);
  154 |     expect(shot.bytes).toBeGreaterThan(100);
  155 |     for (const [url, code] of [
  156 |       ["https://other.example/", "origin_approval_required"],
  157 |       [`${deniedOrigin}/forbidden`, "private_network_denied"],
  158 |       ["file:///private/secret", "scheme_denied"],
  159 |     ]) {
  160 |       expect((await call("browser_navigate", { url })).code).toBe(code);
  161 |     }
  162 |     expect(
  163 |       (await call("browser_navigate", { url: `${origin}/cross-origin` })).code,
> 164 |     ).toBe("origin_approval_required");
      |       ^ Error: expect(received).toBe(expected) // Object.is equality
  165 |     expect(
  166 |       (await call("browser_navigate", { url: `${origin}/redirect` })).code,
  167 |     ).toBe("private_network_denied");
  168 |     expect((await call("browser_navigate", { url: origin })).ok).toBe(true);
  169 |     const fresh = await call("browser_snapshot", {});
  170 |     const sendLine = fresh.snapshot
  171 |       .split("\n")
  172 |       .find((line: string) => line.includes("Send message"));
  173 |     const sendRef = /\[ref=(e\d+)\]/u.exec(sendLine ?? "")?.[1];
  174 |     expect(sendRef).toBeTruthy();
  175 |     const pendingClick = call("browser_click", { ref: sendRef });
  176 |     await expect
  177 |       .poll(async () => (await request<unknown[]>("agent-pending")).length)
  178 |       .toBe(1);
  179 |     expect(submits).toBe(0);
  180 |     const [pending] = await request<{ actionId: string }[]>("agent-pending");
  181 |     await request("agent-confirm", { actionId: pending.actionId });
  182 |     expect((await pendingClick).ok).toBe(true);
  183 |     await expect.poll(() => submits).toBe(1);
  184 |     await application.evaluate((_electron, id) => {
  185 |       const fixture = (
  186 |         globalThis as typeof globalThis & {
  187 |           colonyBrowserFixture: {
  188 |             browser: {
  189 |               agentAdapter: {
  190 |                 webContents(id: string): {
  191 |                   debugger: {
  192 |                     sendCommand(
  193 |                       method: string,
  194 |                       params: unknown,
  195 |                     ): Promise<unknown>;
  196 |                   };
  197 |                 };
  198 |               };
  199 |             };
  200 |             waitStarted?: boolean;
  201 |           };
  202 |         }
  203 |       ).colonyBrowserFixture;
  204 |       const debuggerApi = fixture.browser.agentAdapter.webContents(id).debugger;
  205 |       const original = debuggerApi.sendCommand.bind(debuggerApi);
  206 |       debuggerApi.sendCommand = (method, params) => {
  207 |         if (
  208 |           method === "Runtime.callFunctionOn" &&
  209 |           JSON.stringify(params).includes("Never appears")
  210 |         )
  211 |           fixture.waitStarted = true;
  212 |         return original(method, params);
  213 |       };
  214 |     }, tab.id);
  215 |     const waiting = call("browser_wait", {
  216 |       text: "Never appears",
  217 |       timeoutMs: 30_000,
  218 |     });
  219 |     await expect
  220 |       .poll(() =>
  221 |         application?.evaluate(
  222 |           () =>
  223 |             (
  224 |               globalThis as typeof globalThis & {
  225 |                 colonyBrowserFixture: { waitStarted?: boolean };
  226 |               }
  227 |             ).colonyBrowserFixture.waitStarted,
  228 |         ),
  229 |       )
  230 |       .toBe(true);
  231 |     await request("agent-revoke", { grantId: grant.id });
  232 |     expect((await waiting).ok).toBe(false);
  233 |     await expect
  234 |       .poll(async () => (await connectedClient.listTools()).length)
  235 |       .toBe(0);
  236 |     expect(forbiddenRequests).toBe(0);
  237 |     const log = await request("agent-log", { grantId: grant.id });
  238 |     expect(JSON.stringify(log)).not.toMatch(
  239 |       /credential-do-not-leak|page-fake|Hello fixture/,
  240 |     );
  241 |     const current = await page.evaluate(
  242 |       async () =>
  243 |         (await (window.colonyBrowserHost as BrowserHostApi).listTabs())[0],
  244 |     );
  245 |     expect(current.controlOwner).toBe("human");
  246 |   } finally {
  247 |     client?.close();
  248 |     await application?.close();
  249 |     deniedServer.closeAllConnections();
  250 |     await new Promise<void>((resolve) => deniedServer.close(() => resolve()));
  251 |     server.closeAllConnections();
  252 |     await new Promise<void>((resolve) => server.close(() => resolve()));
  253 |     await rm(dir, { recursive: true, force: true });
  254 |   }
  255 | });
  256 | 
```