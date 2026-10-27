import assert from "node:assert/strict";
import test from "node:test";

import { extractSupportedLinkPreviews } from "./linkPreview.ts";

import {
  alignLinkPreviewTagsWithContent,
  buildLinkPreviewSnapshotTag,
  parseLinkPreviewSnapshots,
} from "./linkPreviewSnapshot.ts";

const HASH = "a".repeat(64);
const ORIGIN = "https://relay.example";
const CONTENT = "Read https://linear.app/acme/issue/ABC-123/example";
const URL = "https://linear.app/acme/issue/ABC-123/example";
const valid = [
  "link-preview",
  "snapshot",
  "1",
  URL,
  "Example",
  "Linear",
  "Description",
  `${ORIGIN}/media/${HASH}.png`,
  HASH,
  "",
  "",
];

test("authored snapshots render only exact local media tied to message content", () => {
  assert.equal(parseLinkPreviewSnapshots([valid], CONTENT, ORIGIN).length, 1);
  assert.equal(
    parseLinkPreviewSnapshots([valid], "no matching link", ORIGIN).length,
    0,
  );
  assert.equal(parseLinkPreviewSnapshots([valid], CONTENT, null).length, 0);
});

test("authored snapshots reject remote, malformed, credentialed, and hash-mismatched media", () => {
  for (const image of [
    `https://evil.example/media/${HASH}.png`,
    `${ORIGIN}/media/${HASH}.png?token=leak`,
    `${ORIGIN}/media/${HASH}.png#fragment`,
    `https://user@relay.example/media/${HASH}.png`,
    `${ORIGIN}/media/${HASH}.svg`,
    `${ORIGIN}/media/${HASH}.png/extra`,
  ]) {
    const tag = [...valid];
    tag[7] = image;
    assert.equal(
      parseLinkPreviewSnapshots([tag], CONTENT, ORIGIN).length,
      0,
      image,
    );
  }
  const mismatch = [...valid];
  mismatch[8] = "b".repeat(64);
  assert.equal(
    parseLinkPreviewSnapshots([mismatch], CONTENT, ORIGIN).length,
    0,
  );
});

test("snapshot tags sanitize control characters and enforce UTF-8 byte limits", () => {
  const tag = buildLinkPreviewSnapshotTag({
    canonicalUrl: URL,
    title: `Title\n${"😀".repeat(100)}`,
    siteName: `Linear\u0000${"é".repeat(100)}`,
    description: `First\nSecond\t${"😀".repeat(300)}`,
    imageUrl: "",
    imageSha256: "",
    faviconUrl: "",
    faviconSha256: "",
  });

  assert.ok(tag);
  assert.equal(tag[6].startsWith("First\nSecond"), true);
  assert.equal(tag[6].includes("\t"), false);
  for (const value of tag.slice(4, 6)) {
    assert.ok(
      Array.from(value).every((char) => {
        const code = char.charCodeAt(0);
        return code > 0x1f && code !== 0x7f;
      }),
    );
  }
  assert.ok(Buffer.byteLength(tag[4], "utf8") <= 300);
  assert.ok(Buffer.byteLength(tag[5], "utf8") <= 100);
  assert.ok(Buffer.byteLength(tag[6], "utf8") <= 1000);
});

test("snapshot tags omit canonical URLs rejected by native validation", () => {
  for (const canonicalUrl of [
    `${URL}#`,
    `${URL}#details`,
    `http://linear.app/acme/issue/ABC-123/example`,
    `https://user@linear.app/acme/issue/ABC-123/example`,
  ]) {
    assert.equal(
      buildLinkPreviewSnapshotTag({
        canonicalUrl,
        title: "Example",
        siteName: "Linear",
        description: "Description",
        imageUrl: "",
        imageSha256: "",
        faviconUrl: "",
        faviconSha256: "",
      }),
      null,
      canonicalUrl,
    );
  }
});

test("messages without authored snapshots never create recipient previews", () => {
  assert.deepEqual(parseLinkPreviewSnapshots([], CONTENT, ORIGIN), []);
  assert.deepEqual(parseLinkPreviewSnapshots(undefined, CONTENT, ORIGIN), []);
});

// GATE-306B: a bare origin is typed as `https://example.com` but the preview
// identity is `new URL(...).href`, `https://example.com/`. The relay refuses a
// snapshot whose canonical URL is not text in the message, so the 400 blocked
// the whole send.
function snapshotTagFor(canonicalUrl) {
  const tag = buildLinkPreviewSnapshotTag({
    canonicalUrl,
    title: "Example Domain",
    siteName: "example.com",
    description: "",
    imageUrl: "",
    imageSha256: "",
    faviconUrl: "",
    faviconSha256: "",
  });
  assert.ok(tag, canonicalUrl);
  return tag;
}

test("a bare-origin preview is sent under the text the message contains", () => {
  const content = "see https://example.com";
  const preview = extractSupportedLinkPreviews(content)[0];
  assert.equal(preview.href, "https://example.com/");

  const { tags, dropped } = alignLinkPreviewTagsWithContent(
    [snapshotTagFor(preview.href)],
    content,
  );

  assert.deepEqual(dropped, []);
  assert.equal(tags.length, 1);
  assert.equal(tags[0][3], "https://example.com");
  assert.ok(content.includes(tags[0][3]));
  // Everything but the URL is untouched.
  assert.deepEqual(tags[0].slice(4), snapshotTagFor(preview.href).slice(4));
});

test("every spelling the URL parser rewrites is sent as written", () => {
  for (const [content, written] of [
    ["https://example.com", "https://example.com"],
    ["open https://example.com now", "https://example.com"],
    ["(https://example.com)", "https://example.com"],
    ["[the site](https://example.com)", "https://example.com"],
    ["visit https://example.com.", "https://example.com"],
    ["really? https://example.com!", "https://example.com"],
    ["https://example.com#top", "https://example.com"],
    ["https://EXAMPLE.com/Path", "https://EXAMPLE.com/Path"],
    ["HTTPS://example.com/Path", "HTTPS://example.com/Path"],
    ["https://example.com:443/path", "https://example.com:443/path"],
    ["https://example.com?a=1", "https://example.com?a=1"],
    ["https://example.com/a/../b", "https://example.com/a/../b"],
    ["https://example.com/caf\u00e9", "https://example.com/caf\u00e9"],
    ["https://m\u00fcnchen.de/x", "https://m\u00fcnchen.de/x"],
  ]) {
    const [preview] = extractSupportedLinkPreviews(content);
    assert.ok(preview, content);
    const { tags, dropped } = alignLinkPreviewTagsWithContent(
      [snapshotTagFor(preview.href)],
      content,
    );
    assert.deepEqual(dropped, [], content);
    assert.equal(tags.length, 1, content);
    assert.equal(tags[0][3], written, content);
    // The relay's strict rule: the canonical URL is text in the message.
    assert.ok(content.includes(tags[0][3]), content);
  }
});

test("a canonical URL already written in the message is left alone", () => {
  for (const content of [
    "see https://example.com/",
    "see https://example.com/page?a=1",
    "see https://example.com/p#frag",
  ]) {
    const [preview] = extractSupportedLinkPreviews(content);
    const tag = snapshotTagFor(preview.href);
    const { tags, dropped } = alignLinkPreviewTagsWithContent([tag], content);
    assert.deepEqual(dropped, [], content);
    assert.deepEqual(tags, [tag], content);
  }
});

test("a preview with no URL text in the message is dropped, never sent", () => {
  for (const [content, canonicalUrl] of [
    // Schemeless GitHub link: the https:// spelling is not in the message.
    [
      "see github.com/block/buzz/pull/3",
      "https://github.com/block/buzz/pull/3",
    ],
    // The link was edited out after the preview was prepared.
    ["no link any more", "https://example.com/"],
    ["https://other.example", "https://example.com/"],
  ]) {
    const { tags, dropped } = alignLinkPreviewTagsWithContent(
      [snapshotTagFor(canonicalUrl)],
      content,
    );
    assert.deepEqual(tags, [], content);
    assert.deepEqual(dropped, [canonicalUrl], content);
  }
});

test("dropping one preview keeps the others and the suppression marker", () => {
  const content = "https://example.com and https://example.org/x";
  const kept = snapshotTagFor("https://example.org/x");
  const { tags, dropped } = alignLinkPreviewTagsWithContent(
    [snapshotTagFor("https://example.net/"), kept],
    content,
  );
  assert.deepEqual(tags, [kept]);
  assert.deepEqual(dropped, ["https://example.net/"]);

  const none = ["link-preview", "none"];
  assert.deepEqual(alignLinkPreviewTagsWithContent([none], content), {
    tags: [none],
    dropped: [],
  });
});

test("two spellings of one URL stay one snapshot", () => {
  const content = "https://example.com then https://example.com/";
  const { tags } = alignLinkPreviewTagsWithContent(
    [snapshotTagFor("https://example.com/")],
    content,
  );
  assert.equal(tags.length, 1);
  assert.ok(content.includes(tags[0][3]));
});

test("recipients render a snapshot sent under the message's own spelling", () => {
  const content = "see https://example.com";
  const { tags } = alignLinkPreviewTagsWithContent(
    [snapshotTagFor("https://example.com/")],
    content,
  );
  const previews = parseLinkPreviewSnapshots(tags, content, ORIGIN);
  assert.equal(previews.length, 1);
  assert.equal(previews[0].href, "https://example.com/");
  assert.equal(previews[0].title, "Example Domain");
  // Snapshots from clients that sent the normalized form still render.
  assert.equal(
    parseLinkPreviewSnapshots(
      [snapshotTagFor("https://example.com/")],
      content,
      ORIGIN,
    ).length,
    1,
  );
});

test("a snapshot whose URL is not a spelling of a link in the message is ignored", () => {
  const tag = snapshotTagFor("https://example.com");
  assert.equal(
    parseLinkPreviewSnapshots([tag], "see https://other.example", ORIGIN)
      .length,
    0,
  );
  assert.equal(
    parseLinkPreviewSnapshots([tag, tag], "see https://example.com", ORIGIN)
      .length,
    1,
  );
});
