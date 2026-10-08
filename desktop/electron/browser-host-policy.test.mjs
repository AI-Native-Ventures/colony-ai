import assert from "node:assert/strict";
import test from "node:test";
import {
  browserShortcutAction,
  checkedUrl,
  isAllowedFrameUrl,
  isAllowedWebUrl,
  isBlockedBrowserHostname,
  numberedDownloadName,
  safeDownloadName,
} from "./browser-host-policy.mjs";

const key = (overrides) => ({
  type: "keyDown",
  key: "",
  control: false,
  meta: false,
  alt: false,
  shift: false,
  isAutoRepeat: false,
  ...overrides,
});

test("download names are bare, bounded and not machine-suffixed", () => {
  assert.equal(safeDownloadName("report.pdf"), "report.pdf");
  assert.equal(safeDownloadName("../../etc/passwd"), "passwd");
  assert.equal(safeDownloadName("..\\..\\win\\evil.exe"), "evil.exe");
  assert.equal(safeDownloadName(".hidden"), "hidden");
  assert.equal(safeDownloadName(""), "download");
  assert.equal(safeDownloadName("..."), "download");
  assert.equal(safeDownloadName('a/b/c<>:"|?*.txt'), "c_______.txt");
  assert.ok(safeDownloadName(`${"x".repeat(500)}.pdf`).length <= 124);
  assert.equal(numberedDownloadName("a.tar.gz", 0), "a.tar.gz");
  assert.equal(numberedDownloadName("a.pdf", 2), "a (2).pdf");
  assert.equal(numberedDownloadName("noext", 1), "noext (1)");
});

test("page shortcuts map to app actions with the right modifier per platform", () => {
  const cases = [
    [{ key: "l" }, "focus-address"],
    [{ key: "t" }, "new-tab"],
    [{ key: "w" }, "close-tab"],
    [{ key: "r" }, "reload"],
    [{ key: "[" }, "back"],
    [{ key: "]" }, "forward"],
    [{ key: "\\" }, "toggle-dock"],
  ];
  for (const [input, action] of cases) {
    assert.equal(
      browserShortcutAction(key({ ...input, meta: true }), "darwin"),
      action,
      `darwin ${input.key}`,
    );
    assert.equal(
      browserShortcutAction(key({ ...input, control: true }), "linux"),
      action,
      `linux ${input.key}`,
    );
    assert.equal(
      browserShortcutAction(key({ ...input, control: true }), "win32"),
      action,
      `win32 ${input.key}`,
    );
    // The other platform's modifier, Shift and Alt are not these shortcuts.
    assert.equal(
      browserShortcutAction(key({ ...input, control: true }), "darwin"),
      null,
    );
    assert.equal(
      browserShortcutAction(key({ ...input, meta: true }), "linux"),
      null,
    );
    assert.equal(
      browserShortcutAction(
        key({ ...input, meta: true, shift: true }),
        "darwin",
      ),
      null,
    );
    assert.equal(
      browserShortcutAction(key({ ...input, meta: true, alt: true }), "darwin"),
      null,
    );
  }
  assert.equal(
    browserShortcutAction(key({ key: "L", meta: true }), "darwin"),
    "focus-address",
  );
});

test("history and reload keys that need no primary modifier", () => {
  assert.equal(
    browserShortcutAction(key({ key: "ArrowLeft", alt: true }), "linux"),
    "back",
  );
  assert.equal(
    browserShortcutAction(key({ key: "ArrowRight", alt: true }), "win32"),
    "forward",
  );
  // Option+Arrow is word movement in a macOS text field: never history there.
  assert.equal(
    browserShortcutAction(key({ key: "ArrowLeft", alt: true }), "darwin"),
    null,
  );
  assert.equal(
    browserShortcutAction(key({ key: "ArrowRight", alt: true }), "darwin"),
    null,
  );
  assert.equal(browserShortcutAction(key({ key: "F5" }), "linux"), "reload");
  assert.equal(browserShortcutAction(key({ key: "ArrowLeft" }), "linux"), null);
  assert.equal(
    browserShortcutAction(key({ key: "F5", shift: true }), "linux"),
    null,
  );
});

test("ignores key-up, auto-repeat, plain typing and malformed input", () => {
  assert.equal(
    browserShortcutAction(
      key({ type: "keyUp", key: "l", meta: true }),
      "darwin",
    ),
    null,
  );
  assert.equal(
    browserShortcutAction(
      key({ key: "l", meta: true, isAutoRepeat: true }),
      "darwin",
    ),
    null,
  );
  assert.equal(browserShortcutAction(key({ key: "l" }), "darwin"), null);
  assert.equal(
    browserShortcutAction(key({ key: "a", meta: true }), "darwin"),
    null,
  );
  assert.equal(browserShortcutAction(null, "darwin"), null);
  assert.equal(browserShortcutAction("l", "darwin"), null);
  assert.equal(
    browserShortcutAction(key({ key: undefined, meta: true }), "darwin"),
    null,
  );
});

const BLOCKED_ADDRESSES = [
  "http://169.254.169.254/latest/meta-data/",
  "https://169.254.169.254:8443/",
  "http://169.254.0.1/",
  "http://169.254.255.255/",
  "http://2852039166/",
  "http://0xa9fea9fe/",
  "http://0251.0376.0251.0376/",
  "http://169.254.43518/",
  "http://169.254.169.254./",
  "http://[fd00:ec2::254]/",
  "http://[FD00:0EC2:0:0:0:0:0:254]/latest",
  "http://[::ffff:169.254.169.254]/",
  "http://[::ffff:a9fe:1]:8080/x",
  "http://[fe80::1]/",
  "http://[febf::abcd]/",
  "http://metadata.google.internal/computeMetadata/v1/",
  "https://METADATA.GOOGLE.INTERNAL/",
  "http://metadata.google.internal./",
  "http://metadata\u3002google\u3002internal/",
];

const OPEN_ADDRESSES = [
  "https://example.com/",
  "http://169.253.255.255/",
  "http://169.255.0.0/",
  "http://10.0.0.1/",
  "http://172.16.0.1/",
  "http://192.168.1.1/",
  "http://127.0.0.1:3000/",
  "http://localhost/",
  "http://[::1]/",
  "http://[fd00::1]/",
  "http://[fd00:ec2::255]/",
  "http://[fec0::1]/",
  "http://[::ffff:10.0.0.1]/",
  "http://metadata.google.internal.example.com/",
  "http://notmetadata.google.internal/",
  "http://metadata.google/",
];

test("link-local and cloud metadata addresses are refused however they are spelled", () => {
  for (const url of BLOCKED_ADDRESSES) {
    assert.throws(() => checkedUrl(url), /metadata addresses/u, url);
    assert.equal(isAllowedWebUrl(url), false, url);
    assert.equal(isAllowedFrameUrl(url, true), false, `${url} main frame`);
    assert.equal(isAllowedFrameUrl(url, false), false, `${url} subframe`);
  }
});

test("ordinary private, loopback and neighbouring addresses stay open", () => {
  for (const url of OPEN_ADDRESSES) {
    assert.doesNotThrow(() => checkedUrl(url), url);
    assert.equal(isAllowedFrameUrl(url, true), true, url);
  }
});

test("the host name check works on URL hostnames and ignores everything else", () => {
  assert.equal(isBlockedBrowserHostname("169.254.1.1"), true);
  assert.equal(isBlockedBrowserHostname("[fd00:ec2::254]"), true);
  assert.equal(isBlockedBrowserHostname("example.com"), false);
  assert.equal(isBlockedBrowserHostname("[not:an:address]"), false);
  assert.equal(isBlockedBrowserHostname("[::1::2]"), false);
});
