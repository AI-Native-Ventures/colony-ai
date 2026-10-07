import assert from "node:assert/strict";
import test from "node:test";
import { createJsonLines } from "./json-lines.mjs";

function fixture(maxBytes) {
  const frames = [];
  let errors = 0;
  const reader = createJsonLines({
    maxBytes,
    onLine: (line) => frames.push(line),
    onError: () => {
      errors += 1;
    },
  });
  return { reader, frames, errors: () => errors };
}

test("UTF8 survives byte-by-byte input and multiple frames in one chunk", () => {
  const h = fixture(64);
  for (const byte of Buffer.from('{"name":"é😺"}\n'))
    assert.equal(h.reader.push(Buffer.from([byte])), true);
  h.reader.push(Buffer.from("one\r\ntwo\n"));
  assert.deepEqual(h.frames, ['{"name":"é😺"}', "one\r", "two"]);
  assert.equal(h.errors(), 0);
});

test("a frame at the byte ceiling passes and overflow permanently releases the reader", () => {
  const h = fixture(4);
  h.reader.push("éé\n");
  assert.deepEqual(h.frames, ["éé"]);
  h.reader.push(Buffer.from("é"));
  h.reader.push(Buffer.from("é"));
  assert.equal(h.reader.push("x"), false);
  assert.equal(h.errors(), 1);
  assert.equal(h.reader.push("\nallowed\n"), false);
  assert.equal(h.errors(), 1);
  assert.deepEqual(h.frames, ["éé"]);
});

test("retirement during dispatch stops the rest of the same input chunk", () => {
  const frames = [];
  const reader = createJsonLines({
    onLine(line) {
      frames.push(line);
      return false;
    },
    onError: () => assert.fail("no framing error"),
  });
  assert.equal(reader.push("first\nsecond\n"), false);
  assert.deepEqual(frames, ["first"]);
  reader.stop();
  assert.equal(reader.push("third\n"), false);
});
