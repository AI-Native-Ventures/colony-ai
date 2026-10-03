import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

test("public favicon is the committed Colony ant artwork", () => {
  const publicIcon = readFileSync(
    new URL("../public/colony-icon.svg", import.meta.url),
    "utf8",
  );
  const nativeIcon = readFileSync(
    new URL("../src-tauri/icons/colony-icon.svg", import.meta.url),
    "utf8",
  );
  assert.equal(publicIcon.trim(), nativeIcon.trim());
  const entry = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(entry, /href="\/colony-icon\.svg"/);
  assert.equal(
    existsSync(new URL("../public/buzz.svg", import.meta.url)),
    false,
  );
});

test("dialog raster assets retain their existing density dimensions", () => {
  for (const [name, size] of [
    ["app-icon@2x.png", 112],
    ["app-icon@3x.png", 168],
  ]) {
    const png = readFileSync(new URL(`../public/${name}`, import.meta.url));
    assert.deepEqual(
      png.subarray(0, 8),
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
});
