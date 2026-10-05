import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { startSourceLoader } from "./support.mjs";

let loader;
let download;

before(async () => {
  loader = await startSourceLoader();
  download = await loader.load("/src/shared/lib/colony-download.ts");
});

after(async () => {
  await loader?.close();
});

const BASE =
  "https://github.com/AI-Native-Ventures/colony-ai/releases/download";

function release(tag, version, overrides = {}) {
  return {
    tag_name: tag,
    draft: false,
    prerelease: false,
    assets: [
      `Colony-${version}-arm64-UNSIGNED.dmg`,
      `Colony-${version}-arm64-UNSIGNED.dmg.blockmap`,
      `Colony-${version}-x64-UNSIGNED.exe`,
      `Colony-${version}-x64-UNSIGNED.AppImage`,
      "checksums.txt",
    ].map((name) => ({
      name,
      browser_download_url: `${BASE}/${tag}/${name}`,
    })),
    ...overrides,
  };
}

const mac = { operatingSystem: "macos", architecture: "arm64" };
const windows = { operatingSystem: "windows", architecture: "x64" };
const linux = { operatingSystem: "linux", architecture: "x64" };

test("picks the newest desktop release, whatever order the API returns", () => {
  const releases = [
    release("desktop-v1.0.3", "1.0.3"),
    release("desktop-v1.0.10", "1.0.10"),
    release("desktop-v1.0.4", "1.0.4"),
  ];
  assert.equal(
    download.selectColonyDownloadUrl(releases, mac),
    `${BASE}/desktop-v1.0.10/Colony-1.0.10-arm64-UNSIGNED.dmg`,
  );
  assert.equal(
    download.selectColonyDownloadUrl(releases, windows),
    `${BASE}/desktop-v1.0.10/Colony-1.0.10-x64-UNSIGNED.exe`,
  );
  assert.equal(
    download.selectColonyDownloadUrl(releases, linux),
    `${BASE}/desktop-v1.0.10/Colony-1.0.10-x64-UNSIGNED.AppImage`,
  );
});

test("only desktop-v tags count: relay, mobile and draft releases never win", () => {
  const releases = [
    release("relay-v9.9.9", "9.9.9"),
    release("mobile-v8.0.0", "8.0.0"),
    release("desktop-v7.0.0", "7.0.0", { draft: true }),
    release("desktop-v6.0.0", "6.0.0", { prerelease: true }),
    release("desktop-v1.0.4", "1.0.4"),
  ];
  assert.equal(
    download.selectColonyDownloadUrl(releases, mac),
    `${BASE}/desktop-v1.0.4/Colony-1.0.4-arm64-UNSIGNED.dmg`,
  );
  assert.equal(
    download.selectColonyDownloadUrl([release("relay-v9.9.9", "9.9.9")], mac),
    undefined,
  );
});

test("falls back to an older desktop release that carries the file", () => {
  const newestWithoutMac = release("desktop-v1.0.5", "1.0.5", {
    assets: [],
  });
  assert.equal(
    download.selectColonyDownloadUrl(
      [newestWithoutMac, release("desktop-v1.0.4", "1.0.4")],
      mac,
    ),
    `${BASE}/desktop-v1.0.4/Colony-1.0.4-arm64-UNSIGNED.dmg`,
  );
});

test("a Mac with unknown architecture gets the Apple Silicon DMG; Intel and ARM Linux get none", () => {
  const releases = [release("desktop-v1.0.4", "1.0.4")];
  assert.match(
    download.selectColonyDownloadUrl(releases, {
      operatingSystem: "macos",
      architecture: "unknown",
    }),
    /arm64-UNSIGNED\.dmg$/,
  );
  assert.equal(
    download.selectColonyDownloadUrl(releases, {
      operatingSystem: "macos",
      architecture: "x64",
    }),
    undefined,
  );
  assert.equal(
    download.selectColonyDownloadUrl(releases, {
      operatingSystem: "linux",
      architecture: "arm64",
    }),
    undefined,
  );
  for (const operatingSystem of ["ios", "android", "unknown"]) {
    assert.equal(
      download.selectColonyDownloadUrl(releases, {
        operatingSystem,
        architecture: "unknown",
      }),
      undefined,
    );
  }
});

test("resolving asks the Colony releases API and returns the file for the OS", async (t) => {
  const requested = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    requested.push(String(url));
    return Response.json([
      release("relay-v9.9.9", "9.9.9"),
      release("desktop-v1.0.4", "1.0.4"),
    ]);
  });

  const url = await download.resolveColonyDownloadUrlForPlatform(windows);
  assert.equal(url, `${BASE}/desktop-v1.0.4/Colony-1.0.4-x64-UNSIGNED.exe`);
  assert.equal(requested.length, 1);
  assert.match(
    requested[0],
    /^https:\/\/api\.github\.com\/repos\/AI-Native-Ventures\/colony-ai\/releases/,
  );
});

test("resolving falls back to the Colony download page on any failure and never calls out for mobile", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("offline");
  });
  assert.equal(
    await download.resolveColonyDownloadUrlForPlatform(mac),
    "https://colony.global#download",
  );
  assert.equal(fetchMock.mock.callCount(), 1);

  fetchMock.mock.mockImplementation(
    async () => new Response("", { status: 403 }),
  );
  assert.equal(
    await download.resolveColonyDownloadUrlForPlatform(linux),
    "https://colony.global#download",
  );

  const callsBefore = fetchMock.mock.callCount();
  for (const operatingSystem of ["ios", "android"]) {
    assert.equal(
      await download.resolveColonyDownloadUrlForPlatform({
        operatingSystem,
        architecture: "unknown",
      }),
      "https://colony.global#download",
    );
  }
  assert.equal(fetchMock.mock.callCount(), callsBefore);
});
