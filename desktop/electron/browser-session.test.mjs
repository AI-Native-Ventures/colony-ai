import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createBrowserSessionStore } from "./browser-session.mjs";

class FakeSession extends EventEmitter {
  permissionRequestHandlers = 0;
  permissionCheckHandlers = 0;
  devicePermissionHandlers = 0;
  displayMediaHandlers = 0;
  requestFilters = [];
  webRequest = {
    onBeforeRequest: (filter, listener) => {
      this.requestFilters.push({ filter, listener });
    },
  };
  clearedStorage = 0;
  clearedCache = 0;
  clearedAuthCache = 0;

  setPermissionRequestHandler() {
    this.permissionRequestHandlers += 1;
  }

  setPermissionCheckHandler() {
    this.permissionCheckHandlers += 1;
  }

  setDevicePermissionHandler() {
    this.devicePermissionHandlers += 1;
  }

  setDisplayMediaRequestHandler() {
    this.displayMediaHandlers += 1;
  }

  async clearStorageData() {
    this.clearedStorage += 1;
  }

  async clearCache() {
    this.clearedCache += 1;
  }

  async clearAuthCache() {
    this.clearedAuthCache += 1;
  }
}

function fakeElectronSessionApi() {
  const sessions = new Map();
  const allocations = [];
  return {
    sessions,
    allocations,
    fromPartition(partition) {
      allocations.push(partition);
      let browserSession = sessions.get(partition);
      if (!browserSession) {
        browserSession = new FakeSession();
        sessions.set(partition, browserSession);
      }
      return browserSession;
    },
  };
}

function createStore({
  userDataPath,
  session,
  maxProfiles,
  downloadsPath = path.join(userDataPath, "Downloads"),
  emitTabEvent = () => {},
  showItemInFolder,
}) {
  return createBrowserSessionStore({
    session,
    userDataPath,
    maxProfiles,
    downloadsPath,
    showItemInFolder,
    getTabForContents: () => ({ id: "tab-a" }),
    emitTabEvent,
    hasTab: () => true,
  });
}

async function makeUserDataDir(t) {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), "colony-browser-"));
  t.after(() => rm(userDataPath, { recursive: true, force: true }));
  return userDataPath;
}

test("caps persistent browser profiles and registers one handler set per session", async (t) => {
  const userDataPath = await makeUserDataDir(t);
  const electronSession = fakeElectronSessionApi();
  const store = createStore({
    userDataPath,
    session: electronSession,
    maxProfiles: 2,
  });

  const clientA = await store.forScope("business-a", "client-a");
  const reopenedClientA = await store.forScope("business-a", "client-a");
  const clientB = await store.forScope("business-a", "client-b");

  assert.equal(reopenedClientA.session, clientA.session);
  assert.notEqual(clientB.session, clientA.session);
  assert.equal(clientA.session.listenerCount("will-download"), 1);
  assert.equal(clientA.session.permissionRequestHandlers, 1);
  assert.equal(clientA.session.permissionCheckHandlers, 1);
  assert.equal(clientA.session.devicePermissionHandlers, 1);
  assert.equal(clientA.session.displayMediaHandlers, 1);
  assert.equal(clientA.session.requestFilters.length, 1);
  assert.equal(electronSession.allocations.length, 2);

  await assert.rejects(
    store.forScope("business-b", "client-a"),
    /Browser profile limit reached/u,
  );
  assert.equal(electronSession.allocations.length, 2);

  const manifest = await readFile(
    path.join(userDataPath, "browser-profiles.json"),
    "utf8",
  );
  assert.doesNotMatch(manifest, /business-a|client-a|client-b/u);

  const restartedSession = fakeElectronSessionApi();
  const restartedStore = createStore({
    userDataPath,
    session: restartedSession,
    maxProfiles: 2,
  });
  await assert.rejects(
    restartedStore.forScope("business-b", "client-a"),
    /Browser profile limit reached/u,
  );
  assert.equal(restartedSession.allocations.length, 0);
});

test("only explicitly forgets inactive profiles and keeps session capacity bounded", async (t) => {
  const userDataPath = await makeUserDataDir(t);
  const electronSession = fakeElectronSessionApi();
  const store = createStore({
    userDataPath,
    session: electronSession,
    maxProfiles: 1,
  });
  const tabId = "tab-a";
  const profile = await store.forScope("business-a", "client-a", tabId);

  await assert.rejects(
    store.forgetClient("business-a", "client-a"),
    /Close all browser tabs/u,
  );
  assert.equal(profile.session.clearedStorage, 0);

  const item = new EventEmitter();
  item.getTotalBytes = () => 1;
  item.getReceivedBytes = () => 1;
  item.getFilename = () => "file.txt";
  item.setSavePath = () => {};
  item.cancel = () => {
    item.cancelled = true;
  };
  profile.session.emit("will-download", { preventDefault() {} }, item, {
    id: 1,
  });
  assert.ok(item.listenerCount("done") === 1);
  store.cancelTabDownloads(tabId);
  assert.equal(item.cancelled, true);
  store.releaseTab(profile.profileHash, tabId);

  await assert.rejects(
    store.forgetClient("business-a", "client-a"),
    /downloads to stop/u,
  );
  assert.equal(profile.session.clearedStorage, 0);
  item.emit("done", {}, "cancelled");

  assert.deepEqual(await store.forgetClient("business-a", "client-a"), {
    forgottenProfiles: 1,
  });
  assert.equal(profile.session.clearedStorage, 1);
  assert.equal(profile.session.clearedCache, 1);
  assert.equal(profile.session.clearedAuthCache, 1);

  const reopenedProfile = await store.forScope("business-a", "client-a");
  assert.equal(reopenedProfile.session, profile.session);
  assert.equal(profile.session.listenerCount("will-download"), 1);
  await store.forgetClient("business-a", "client-a");

  const manifest = JSON.parse(
    await readFile(path.join(userDataPath, "browser-profiles.json"), "utf8"),
  );
  assert.deepEqual(manifest.profiles, []);
  assert.equal(profile.session.clearedStorage, 2);

  await assert.rejects(
    store.forScope("business-a", "client-b"),
    /Browser session limit reached/u,
  );
  assert.equal(electronSession.allocations.length, 1);
});

function fakeDownloadItem({ name = "report.pdf", total = 10 } = {}) {
  const item = new EventEmitter();
  item.getTotalBytes = () => total;
  item.getReceivedBytes = () => total;
  item.getFilename = () => name;
  item.setSavePath = (target) => {
    item.savePath = target;
  };
  item.cancel = () => {
    item.cancelled = true;
  };
  return item;
}

async function startDownload(profile, item) {
  let prevented = false;
  profile.session.emit(
    "will-download",
    {
      preventDefault() {
        prevented = true;
      },
    },
    item,
    { id: 1 },
  );
  return { prevented };
}

test("saves downloads to the Downloads folder with a visible result and never overwrites", async (t) => {
  const userDataPath = await makeUserDataDir(t);
  const downloadsPath = path.join(userDataPath, "Downloads");
  await mkdir(downloadsPath, { recursive: true });
  await writeFile(path.join(downloadsPath, "report.pdf"), "existing");
  const events = [];
  const revealed = [];
  const store = createStore({
    userDataPath,
    session: fakeElectronSessionApi(),
    downloadsPath,
    emitTabEvent: (_tab, type, detail) => events.push({ type, ...detail }),
    showItemInFolder: (target) => revealed.push(target),
  });
  const profile = await store.forScope("business-a", null, "tab-a");

  const item = fakeDownloadItem({ name: "../../etc/report.pdf" });
  assert.equal((await startDownload(profile, item)).prevented, false);
  // Next to, never over, the existing file; never outside the folder.
  assert.equal(item.savePath, path.join(downloadsPath, "report (1).pdf"));
  assert.equal(
    await readFile(path.join(downloadsPath, "report.pdf"), "utf8"),
    "existing",
  );
  assert.deepEqual(events.at(-1), {
    type: "download",
    state: "started",
    downloadId: events.at(-1).downloadId,
    fileName: "report (1).pdf",
  });

  const { downloadId } = events.at(-1);
  item.emit("done", {}, "completed");
  assert.deepEqual(events.at(-1), {
    type: "download",
    state: "completed",
    downloadId,
    fileName: "report (1).pdf",
  });
  assert.deepEqual(store.revealDownload(downloadId), { revealed: true });
  assert.deepEqual(revealed, [path.join(downloadsPath, "report (1).pdf")]);
  assert.throws(() => store.revealDownload("not-a-download"), /no longer/u);
  assert.throws(() => store.revealDownload(undefined), /no longer/u);

  // A second download of the same name gets the next free spelling.
  const second = fakeDownloadItem({ name: "report.pdf" });
  await startDownload(profile, second);
  assert.equal(second.savePath, path.join(downloadsPath, "report (2).pdf"));
  // A cancelled download leaves nothing behind in Downloads.
  second.emit("done", {}, "cancelled");
  assert.equal(events.at(-1).state, "cancelled");
  assert.deepEqual((await readdir(downloadsPath)).sort(), [
    "report (1).pdf",
    "report.pdf",
  ]);
  assert.throws(() => store.revealDownload(events.at(-1).downloadId));
});

test("forgetting a profile never deletes files the person downloaded", async (t) => {
  const userDataPath = await makeUserDataDir(t);
  const downloadsPath = path.join(userDataPath, "Downloads");
  await mkdir(downloadsPath, { recursive: true });
  const store = createStore({
    userDataPath,
    session: fakeElectronSessionApi(),
    downloadsPath,
  });
  const profile = await store.forScope("business-a", null, "tab-a");
  const item = fakeDownloadItem({ name: "keep.txt" });
  await startDownload(profile, item);
  await writeFile(item.savePath, "kept");
  item.emit("done", {}, "completed");
  store.releaseTab(profile.profileHash, "tab-a");
  await store.forgetBusiness("business-a");
  assert.equal(await readFile(item.savePath, "utf8"), "kept");
});

test("refuses relative or missing downloads folders", async (t) => {
  const userDataPath = await makeUserDataDir(t);
  assert.throws(
    () =>
      createStore({
        userDataPath,
        session: fakeElectronSessionApi(),
        downloadsPath: "relative/Downloads",
      }),
    /absolute downloads folder/u,
  );
});

test("a profile cancels every request to link-local and cloud metadata hosts", async (t) => {
  const userDataPath = await makeUserDataDir(t);
  const store = createStore({
    userDataPath,
    session: fakeElectronSessionApi(),
    maxProfiles: 2,
  });
  const { session } = await store.forScope("business-a", "client-a");
  assert.equal(session.requestFilters.length, 1);
  const [{ filter, listener }] = session.requestFilters;
  assert.deepEqual(filter, { urls: ["<all_urls>"] });
  const decide = (url) => {
    let answer;
    listener({ url }, (response) => {
      answer = response;
    });
    return answer;
  };
  for (const url of [
    "http://169.254.169.254/latest/meta-data/",
    "https://metadata.google.internal/computeMetadata/v1/",
    "http://[fd00:ec2::254]/latest/meta-data/",
    "ws://169.254.169.254/socket",
    "http://2852039166/",
  ]) {
    assert.deepEqual(decide(url), { cancel: true }, url);
  }
  for (const url of [
    "https://example.com/",
    "http://192.168.1.1/",
    "http://127.0.0.1:3000/",
    "data:text/plain,hello",
    "not a url",
  ]) {
    assert.deepEqual(decide(url), { cancel: false }, url);
  }
});

test("forgetting everything clears every profile, waits for stopping downloads, and refuses while a tab is live", async (t) => {
  const userDataPath = await makeUserDataDir(t);
  const electronSession = fakeElectronSessionApi();
  const store = createStore({
    userDataPath,
    session: electronSession,
    maxProfiles: 4,
  });
  const liveTab = "tab-live";
  const a = await store.forScope("business-a", "client-a", liveTab);
  const b = await store.forScope("business-b", "client-a", "tab-b");
  store.releaseTab(b.profileHash, "tab-b");

  // A tab is still live: nothing is cleared, for any profile.
  await assert.rejects(store.forgetAll(), /Close all browser tabs/u);
  assert.equal(a.session.clearedStorage, 0);
  assert.equal(b.session.clearedStorage, 0);
  store.releaseTab(a.profileHash, liveTab);

  // A cancelled download is given a moment to stop before its profile goes.
  const item = new EventEmitter();
  item.getTotalBytes = () => 1;
  item.getReceivedBytes = () => 1;
  item.getFilename = () => "file.txt";
  item.setSavePath = () => {};
  item.cancel = () => {};
  b.session.emit("will-download", { preventDefault() {} }, item, { id: 7 });
  setTimeout(() => item.emit("done", {}, "cancelled"), 120);

  assert.deepEqual(await store.forgetAll(), { forgottenProfiles: 2 });
  for (const profile of [a, b]) {
    assert.equal(profile.session.clearedStorage, 1);
    assert.equal(profile.session.clearedCache, 1);
    assert.equal(profile.session.clearedAuthCache, 1);
  }
  assert.deepEqual(await store.forgetAll(), { forgottenProfiles: 0 });
});
