import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { brandingFindings, STEP_NAMES } from "./safety.mjs";

const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/gu,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );

export class Evidence {
  constructor(output, metadata) {
    this.output = output;
    this.metadata = metadata;
    this.started = Date.now();
    this.rows = STEP_NAMES.map((name) => ({
      name,
      status: "BLOCKED",
      reason: "Prerequisite not reached.",
    }));
    this.scans = [];
    this.verdicts = [];
    this.observed = {};
  }
  // Release-gate rows requested by the coordinator. Re-recording a number replaces it.
  verdict(id, label, status, detail) {
    const row = { id, label, status, detail };
    const index = this.verdicts.findIndex((item) => item.id === id);
    if (index >= 0) this.verdicts[index] = row;
    else this.verdicts.push(row);
  }
  async step(name, page, operation, { timeoutMs = 20000 } = {}) {
    const row = this.rows.find((item) => item.name === name);
    const start = Date.now();
    try {
      const result = await operation(timeoutMs);
      Object.assign(row, {
        status: "PASS",
        reason: "Observed real code path.",
        ...result,
      });
    } catch (error) {
      Object.assign(row, {
        status: "FAIL",
        reason: `Expected screen or control was not reached (${error.name}). Screenshot contains the observed state. Raw locator arguments omitted.`,
      });
    }
    row.durationMs = Date.now() - start;
    row.sinceStartMs = Date.now() - this.started;
    if (page && !page.isClosed()) await this.capture(name, page, row);
    await this.write();
    return row.status === "PASS";
  }
  async capture(name, page, row) {
    const filename = `${String(this.rows.indexOf(row) + 1).padStart(2, "0")}-${name.toLowerCase().replace(/[^a-z0-9]+/gu, "-")}.png`;
    await mkdir(path.join(this.output, "screenshots"), { recursive: true });
    try {
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.race([
          Promise.allSettled(
            document
              .getAnimations()
              .filter((animation) =>
                Number.isFinite(
                  animation.effect?.getComputedTiming().iterations,
                ),
              )
              .map((animation) => animation.finished),
          ),
          new Promise((resolve) => setTimeout(resolve, 2000)),
        ]);
      });
      await page.screenshot({
        path: path.join(this.output, "screenshots", filename),
        mask: [
          page.locator(
            'input[type="password"],input[autocomplete="one-time-code"],input[maxlength="1"]',
          ),
        ],
      });
      row.screenshot = `screenshots/${filename}`;
      row.screenshotSha256 = createHash("sha256")
        .update(await readFile(path.join(this.output, row.screenshot)))
        .digest("hex");
      const title = await page.title();
      const findings = brandingFindings(
        `${await page.locator("body").innerText()}\n${title}`,
      );
      this.scans.push({
        step: name,
        findings,
        status: findings.length ? "FAIL" : "PASS",
      });
    } catch {
      row.captureFailure =
        "Screenshot or visible DOM scan failed. Screen is not proven.";
      if (row.status === "PASS") row.status = "BLOCKED";
    }
  }
  async write() {
    const data = {
      ...this.metadata,
      updatedAt: new Date().toISOString(),
      rows: this.rows,
      verdicts: this.verdicts,
      observed: this.observed,
      branding: this.scans,
    };
    await writeFile(
      path.join(this.output, "results.json"),
      JSON.stringify(data, null, 2),
    );
    const fullProof =
      this.rows.every((row) => row.status === "PASS") &&
      this.scans.every((scan) => scan.status === "PASS");
    const cards = this.rows
      .map(
        (row) =>
          `<tr><td>${escapeHtml(row.name)}</td><td class="${row.status}">${row.status}</td><td>${row.durationMs ?? "N/A"}</td><td>${escapeHtml(row.reason)}${row.screenshot ? `<a href="${row.screenshot}"><img src="${row.screenshot}" alt="${escapeHtml(row.name)}"></a>` : ""}</td></tr>`,
      )
      .join("");
    const verdicts = this.verdicts
      .map(
        (item) =>
          `<tr><td>${escapeHtml(item.id)}</td><td>${escapeHtml(item.label)}</td><td class="${item.status}">${item.status}</td><td>${escapeHtml(item.detail)}</td></tr>`,
      )
      .join("");
    const observed = Object.entries(this.observed)
      .map(
        ([key, value]) =>
          `<h3>${escapeHtml(key)}</h3><pre>${escapeHtml(typeof value === "string" ? value : JSON.stringify(value, null, 2))}</pre>`,
      )
      .join("");
    const scans = this.scans
      .map(
        (scan) =>
          `<li>${escapeHtml(scan.step)}: <strong class="${scan.status}">${scan.status}</strong> ${escapeHtml(scan.findings.join(", "))}</li>`,
      )
      .join("");
    await writeFile(
      path.join(this.output, "index.html"),
      `<!doctype html><html lang="en"><meta charset="utf-8"><title>Colony real first-run proof</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:16px/1.5 system-ui;background:#f3f5f7;color:#243343;margin:32px auto;max-width:1500px;padding:0 24px}h1{font-size:28px}section{background:white;padding:20px;border-radius:10px;margin:18px 0}table{border-collapse:collapse;width:100%;background:white}td,th{text-align:left;padding:14px;border:1px solid #d8e0e7;vertical-align:top}img{display:block;width:min(100%,700px);margin-top:12px;border:1px solid #c7d1dc}a{color:#275c88}.PASS{color:#25734e}.FAIL{color:#a32929}.BLOCKED{color:#886010}pre{white-space:pre-wrap;font-size:13px}</style><h1>Colony real first-run proof</h1><section><strong class="${fullProof ? "PASS" : "FAIL"}">Release gate: ${fullProof ? "PASS under the reported constraints" : "NOT PROVEN"}</strong><p>${escapeHtml(this.metadata.mode)}</p><p>${escapeHtml(this.metadata.scope)}</p><p>Only PASS rows were observed through the supplied packaged app. Restricted native storage and authentication are not normal owner-runtime proof. BLOCKED means no observation or no reliable prerequisite. No mock bridge, renderer state seeding or real-data deletion.</p><p>Elapsed times cover each UI operation, excluding capture. A branding PASS applies only to reached screens. Scout timing is unavailable until a real authored introduction is observed.</p><p>Account for coordinator cleanup: ${escapeHtml(this.metadata.smokeAccount ?? "No account created")}</p><a href="results.json">Machine-readable evidence</a><details><summary>Artifact and isolation provenance</summary><pre>${escapeHtml(JSON.stringify(this.metadata, null, 2))}</pre></details></section><section><h2>Release gate verdicts</h2><table><thead><tr><th>#</th><th>Assertion</th><th>Status</th><th>Detail</th></tr></thead><tbody>${verdicts || "<tr><td colspan=4>No verdict reached.</td></tr>"}</tbody></table></section><table><thead><tr><th>Step / assertion</th><th>Status</th><th>Milliseconds</th><th>Evidence and screenshot</th></tr></thead><tbody>${cards}</tbody></table><section><h2>Verbatim observations</h2>${observed || "<p>None.</p>"}</section><section><h2>Visible-text branding checks</h2><ul>${scans || "<li>BLOCKED: no rendered screen reached.</li>"}</ul><p>Each reached screen is scanned for the prohibited legacy names and symbol. Screenshots retain observed product text. Inputs holding passwords or verification codes are masked.</p></section></html>`,
    );
  }
}
