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

test("agent activity display strings carry no legacy product words", () => {
  // The composer activity row and transcript rows show these strings to
  // people by default. Raw agent commands (which still name the CLI binary)
  // only reach the screen through the opt-in details disclosure.
  const files = [
    "../agents/ui/agentActivityPlainLabel.ts",
    "../agents/ui/agentSessionTranscriptPresentation.ts",
    "../channels/ui/BotActivityBar.tsx",
    "../channels/ui/BotActivityDetails.tsx",
  ];
  const legacy = /buzz|fizz|honey|pollen|\bbee\b/i;
  for (const relative of files) {
    const url = new URL(relative, import.meta.url);
    const source = ts.createSourceFile(
      url.pathname,
      readFileSync(url, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      url.pathname.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const visit = (node) => {
      if (
        ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isJsxText(node)
      ) {
        assert.doesNotMatch(node.text, legacy, `${relative}: ${node.text}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
});
