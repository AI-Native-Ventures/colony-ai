// The local fixture site shared by the browser host proofs: the real-Electron
// smoke (browser-smoke-main.mjs, CI) and the packaged-app real run
// (tests/real-run/browser-tab.mjs). `/probe` stores what `?set=` says in a
// cookie, localStorage and IndexedDB and reports what the page can see in its
// title; `/popup` opens a web window and a file: window; `/download.txt` is an
// attachment named report.txt; `/redirect-metadata` redirects to the cloud
// metadata address; `/metadata-page` reaches for that address from a page (a
// fetch and a window) and reports what happened in its title.
import { createServer } from "node:http";

export function startFixtureSite() {
  let port = 0;
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/download.txt") {
      response.writeHead(200, {
        "content-type": "text/plain",
        "content-disposition": 'attachment; filename="report.txt"',
      });
      response.end("fixture download body");
      return;
    }
    if (url.pathname === "/redirect-metadata") {
      response.writeHead(302, {
        location: "http://169.254.169.254/latest/meta-data/",
      });
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    if (url.pathname === "/metadata-page") {
      response.end(`<!doctype html><meta charset="utf-8"><title>pending</title>
<script>
(async () => {
  // A request the browser cancels rejects at once; one that is sent to an
  // address with nothing behind it would hang, so a missing guard is a timeout.
  const settle = (run) =>
    Promise.race([
      run.then(() => "allowed", () => "blocked"),
      new Promise((resolve) => setTimeout(() => resolve("timeout"), 5000)),
    ]);
  const fetched = await settle(
    fetch("http://169.254.169.254/latest/meta-data/", { mode: "no-cors" }),
  );
  window.open("http://169.254.169.254/latest/meta-data/", "_blank");
  document.title = JSON.stringify({ fetched });
})();
</script>`);
      return;
    }
    if (url.pathname === "/popup") {
      response.end(`<!doctype html><meta charset="utf-8"><title>popup-parent</title>
<script>
  window.open("http://127.0.0.1:${port}/probe", "_blank");
  // Chromium refuses a file: window from a web page before the app is asked;
  // ftp: reaches the app's window handler, which must refuse it.
  window.open("file:///etc/hosts", "_blank");
  window.open("ftp://127.0.0.1:1/", "_blank");
  document.title = "popup-parent-ready";
</script>`);
      return;
    }
    response.end(`<!doctype html><meta charset="utf-8"><title>pending</title>
<script>
(async () => {
  const set = new URLSearchParams(location.search).get("set");
  if (set) {
    document.cookie = "scope=" + set + "; Path=/; SameSite=Lax; Max-Age=3600";
    localStorage.setItem("scope", set);
    await new Promise((resolve) => {
      const open = indexedDB.open("scopedb-" + set);
      open.onsuccess = () => { open.result.close(); resolve(); };
      open.onerror = () => resolve();
    });
  }
  let dbs = [];
  try { dbs = (await indexedDB.databases()).map((db) => db.name); } catch {}
  let notification = "unsupported";
  try { notification = await Notification.requestPermission(); } catch {}
  let geolocation = "unsupported";
  try {
    geolocation = await new Promise((resolve) =>
      navigator.geolocation.getCurrentPosition(
        () => resolve("granted"),
        (error) => resolve("denied:" + error.code),
        { timeout: 4000 },
      ),
    );
  } catch {}
  document.title = JSON.stringify({
    cookie: document.cookie,
    local: localStorage.getItem("scope"),
    dbs,
    notification,
    geolocation,
    tauri: typeof window.__TAURI_INTERNALS__,
    desktopBridge: typeof window.colonyDesktop,
    browserBridge: typeof window.colonyBrowserHost,
  });
})();
</script>`);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      port = server.address().port;
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}
