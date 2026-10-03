import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";
import test from "node:test";
test("startup and switch gates cannot import retired bee loaders", () => {
  const app = readFileSync(
    new URL("../../app/App.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(app, /import[^;]*(?:BuzzMark|FlappingBee|FuzzyLogo)/s);
  assert.match(app, /<ScoutLoader/);
});

test("all app surfaces reject retired bee component imports", () => {
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = new URL(
        entry.name + (entry.isDirectory() ? "/" : ""),
        directory,
      );
      if (entry.isDirectory()) {
        walk(file);
        continue;
      }
      if (!/\.[cm]?[jt]sx?$/.test(entry.name)) continue;
      const source = ts.createSourceFile(
        file.pathname,
        readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      for (const statement of source.statements) {
        if (
          !ts.isImportDeclaration(statement) &&
          !ts.isExportDeclaration(statement)
        )
          continue;
        assert.doesNotMatch(
          statement.getText(source),
          /\b(?:BuzzMark|FlappingBee|FuzzyLogo)\b/,
          file.pathname,
        );
      }
    }
  };
  walk(new URL("../../", import.meta.url));
});
