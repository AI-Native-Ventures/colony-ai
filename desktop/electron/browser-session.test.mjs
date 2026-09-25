import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createBrowserSessionStore } from "./browser-session.mjs";

class FakeSession extends EventEmitter {
  permissionRequestHandlers = 0;
  permissionCheckHandlers = 0;
  devicePermissionHandlers = 0;
  displayMediaHandlers = 0;
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

function createStore({ userDataPath, session, maxProfiles }) {
  return createBrowserSessionStore({
    session,
    userDataPath,
    maxProfiles,
    getTabForContents: () => ({ id: "tab-a" }),
    emitTabEvent: () => {},
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
  const downloadDirectory = path.join(
    userDataPath,
    "browser-downloads",
    profile.profileHash,
  );
  await assert.rejects(stat(downloadDirectory), { code: "ENOENT" });

  const reopenedProfile = await store.forScope("business-a", "client-a");
  assert.equal(reopenedProfile.session, profile.session);
  await stat(downloadDirectory);
  assert.equal(profile.session.listenerCount("will-download"), 1);
  await store.forgetClient("business-a", "client-a");
  await assert.rejects(stat(downloadDirectory), { code: "ENOENT" });

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
