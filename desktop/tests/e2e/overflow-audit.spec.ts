import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { getPublicKey } from "nostr-tools/pure";

import { FUNCTION_ORDER } from "../../src/features/cofounder/functions";
import { makeCofounderNumbersFixture } from "../../src/testing/cofounderNumbersFixtures";
import {
  REFERENCE_AGENTS,
  REFERENCE_CHANNEL_IDS,
  REFERENCE_MONEY_INVOICE_IDS,
} from "../../src/testing/e2eReferenceWorkspace";
import { waitForAnimations } from "../helpers/animations";
import { installMockBridge, openChannelBrowser } from "../helpers/bridge";
import { COLONY3_NOW, seedColony3Activity } from "../helpers/colony3Fixture";
import { colony3TodayMockOptions } from "../helpers/colony3HomeFixture";
import { installWhatsAppMockBridge } from "../helpers/whatsappOutreach";
import {
  completeR17BusinessSetup,
  openR17BusinessSetup,
} from "../helpers/onboarding";

const WIDTHS = [1920, 1440, 1280, 1024, 900, 390] as const;
const HEIGHT = 960;
const PHONE_HEIGHT = 844;
const REPORT_PATH = resolve(
  process.env.OVERFLOW_AUDIT_REPORT_PATH ??
    "test-results/overflow-audit/index.html",
);
const OWNER_PUBKEY = "deadbeef".repeat(8);
const COMPANY_OLIVE_ID = "1e1a7000-0000-4000-8000-000000000011";
const MIN_WORD_BOX_WIDTH = 180;

type Finding = {
  screen: string;
  width: number;
  state: string;
  theme: "light" | "dark";
  category: string;
  element: string;
  container: string;
  text: string;
  x: number;
  y: number;
  widthPx: number;
  heightPx: number;
  score: number;
  captureId?: string;
  crop?: { x: number; y: number; width: number; height: number };
  observed: {
    screen: string;
    width: number;
    state: string;
    theme: "light" | "dark";
  }[];
};

type CoverageIssue = { screen: string; width: number; error: string };
type Capture = { id: string; width: number; height: number; png: string };

const findings: Finding[] = [];
const findingsByKey = new Map<string, Finding>();
const coverageIssues: CoverageIssue[] = [];
const captures: Capture[] = [];
let scanSequence = 0;

const routeScreens = [
  { screen: "Activity", route: "/", selector: '[data-testid="home-inbox"]' },
  {
    screen: "Today",
    route: "/#/today",
    selector: '[data-testid="today-screen"]',
  },
  {
    screen: "Company map",
    route: "/#/company/map",
    selector: '[data-testid="cofounder-company-map"]',
  },
  ...FUNCTION_ORDER.map((functionId) => ({
    screen: `Company function: ${functionId}`,
    route: `/#/company/function/${functionId}`,
    selector: '[data-testid="cofounder-function-screen"]',
  })),
  {
    screen: "Business: Discovery",
    route: "/#/discovery",
    selector: '[data-testid="w10-discovery-page"]',
  },
  {
    screen: "Business: campaign",
    route: "/#/campaign",
    selector: '[data-testid="w10-campaign-page"]',
  },
  {
    screen: "Business: Leads",
    route: "/#/leads",
    selector: '[data-testid="w10-leads-page"]',
  },
  {
    screen: "Business: lead page",
    route: "/#/sales/lead/form-field",
    selector: '[data-testid="w10-prospect-page"]',
  },
  {
    screen: "Business: Clients",
    route: "/#/clients",
    selector: 'h1:text-is("Clients")',
  },
  {
    screen: "Business: client page",
    route: `/#/clients/${COMPANY_OLIVE_ID}`,
    selector: "main:has(h1)",
  },
  {
    screen: "Business: Money",
    route: "/#/money",
    selector: '[data-testid="money-overview"]',
  },
  {
    screen: "Business: invoices",
    route: "/#/money/invoices",
    selector: '[data-testid="money-invoice-list"]',
  },
  {
    screen: "Business: invoice page",
    route: `/#/money/invoice/${REFERENCE_MONEY_INVOICE_IDS.oliveIssued}`,
    selector: '[data-testid="money-invoice-detail"], [role="alert"]',
  },
  {
    screen: "Sales channel",
    route: `/#/channels/${REFERENCE_CHANNEL_IDS.sales}`,
    selector: '[data-testid="chat-title"]',
  },
  {
    screen: "Marketing channel",
    route: `/#/channels/${REFERENCE_CHANNEL_IDS.marketing}`,
    selector: '[data-testid="chat-title"]',
  },
  {
    screen: "Direct message: Scout",
    route: `/#/channels/${REFERENCE_CHANNEL_IDS.scoutDm}`,
    selector: '[data-testid="chat-title"]',
  },
  {
    screen: "Sales pipeline",
    route: "/#/pipeline",
    selector: "h1",
  },
  {
    screen: "Settings: Account",
    route: "/#/settings?section=profile",
    selector: '[data-testid="settings-profile"]',
  },
  {
    screen: "Settings: Appearance",
    route: "/#/settings?section=appearance",
    selector: '[data-testid="settings-appearance"]',
  },
  {
    screen: "Settings: Preferences",
    route: "/#/settings?section=notifications",
    selector: '[data-testid="settings-notifications"]',
  },
  {
    screen: "Settings: Business",
    route: "/#/settings?section=business-profile",
    selector: '[data-testid="settings-business-profile"]',
  },
  {
    screen: "Settings: Agents",
    route: "/#/settings?section=agent-defaults",
    selector: '[data-testid="settings-global-agent-config"]',
  },
  {
    screen: "Settings: WhatsApp",
    route: "/#/settings?section=whatsapp",
    selector: '[data-testid="whatsapp-settings"]',
  },
  {
    screen: "Settings: templates",
    route: "/#/settings?section=custom-emoji",
    selector: '[data-testid="settings-custom-emoji"]',
  },
  {
    screen: "Settings: App and devices",
    route: "/#/settings?section=app",
    selector: '[data-testid="settings-app-preferences"]',
  },
  {
    screen: "Agents directory",
    route: "/#/agents?rows=10",
    selector: '[data-testid="agent-directory"]',
  },
  {
    screen: "Agent profile",
    route: `/#/agents?agent=${REFERENCE_AGENTS.aya.pubkey}`,
    selector: '[data-testid="agent-profile"]',
  },
] as const;

function makeMock() {
  const today = colony3TodayMockOptions();
  const relaySecret = hexToBytes(today.companyAskRelayPrivateKeyHex);
  const aya = REFERENCE_AGENTS.aya.pubkey;
  const scout = REFERENCE_AGENTS.scout.pubkey;
  const managedAgents = [
    [scout, "Scout", "Chief of Staff", "buzz-agent", "colony-credits"],
    [aya, "Aya", "Business Development", "codex", "openai"],
    [
      REFERENCE_AGENTS.mina.pubkey,
      "Mina",
      "Social Media Manager",
      "claude",
      "anthropic",
    ],
    [
      REFERENCE_AGENTS.theo.pubkey,
      "Theo",
      "Software Engineer",
      "claude",
      "anthropic",
    ],
  ].map(([pubkey, name, about, runtime, provider]) => ({
    pubkey,
    name,
    about,
    runtime,
    provider,
    model: "[MODEL]",
    modelSource: "definition" as const,
    status: "running" as const,
    channelNames: ["Sales", "Marketing"],
    personaId: null,
    systemPrompt: null,
    respondTo: "owner-only" as const,
    respondToAllowlist: [],
  }));

  return {
    ...today,
    referenceWorkspace: true,
    referenceWorkspaceDiscoveryStandIn: true,
    colony3Sidebar: true,
    colony3Business: true,
    windowFullscreen: true,
    relayRequiresMembership: true,
    relayRole: "owner" as const,
    relayMembers: [
      { pubkey: OWNER_PUBKEY, role: "owner" as const },
      { pubkey: aya, role: "member" as const },
      { pubkey: scout, role: "member" as const },
    ],
    relayAgents: managedAgents.map(({ pubkey, name, channelNames }) => ({
      pubkey,
      ownerPubkey: OWNER_PUBKEY,
      name,
      agentType: "agent",
      channelNames,
    })),
    managedAgents,
    relaySelf: getPublicKey(relaySecret),
    companyMemberRelayPrivateKeyHex: bytesToHex(relaySecret),
    cofounderSettings: {
      enabled: true,
      moneyPreference: "cheapest_first" as const,
      approvalSwitches: {
        approveEveryHire: false,
        approvePlaybookChanges: false,
        approveEveryDiscoveryCampaign: false,
      },
    },
    companyNumbers: makeCofounderNumbersFixture({
      ownerPubkey: OWNER_PUBKEY,
      scoutPubkey: scout,
      salesLeadPubkey: aya,
    }),
    companyFunctionHeads: FUNCTION_ORDER.map((functionId, index) => ({
      function: functionId,
      state: index === 0 ? ("filled" as const) : ("empty" as const),
      leadPubkey: index === 0 ? aya : null,
    })),
  };
}

function escapeHtml(value: string) {
  return value
    .replaceAll("—", "-")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function priority(score: number) {
  if (score >= 8) return "P0";
  if (score >= 5) return "P1";
  if (score >= 3) return "P2";
  return "P3";
}

async function scanState(
  page: Page,
  screen: string,
  width: number,
  state: string,
  theme: "light" | "dark",
) {
  const raw = await page.evaluate(
    ({ screen, width, state, theme, minWordWidth }) => {
      type RawFinding = Omit<Finding, "captureId" | "crop" | "observed">;
      const output: RawFinding[] = [];
      const emitted = new Set<string>();
      const all = Array.from(document.querySelectorAll<HTMLElement>("*"));
      const visible = (element: HTMLElement) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity) > 0 &&
          rect.width > 0 &&
          rect.height > 0 &&
          rect.right > 0 &&
          rect.bottom > 0 &&
          rect.left < window.innerWidth &&
          rect.top < window.innerHeight
        );
      };
      const label = (element: HTMLElement) => {
        const testId = element.getAttribute("data-testid");
        const aria = element.getAttribute("aria-label");
        const title = element.getAttribute("title");
        const text = (element.innerText || element.textContent || "")
          .replace(/\s+/gu, " ")
          .trim()
          .slice(0, 96);
        const classes =
          typeof element.className === "string"
            ? element.className.trim().split(/\s+/u).slice(0, 3).join(".")
            : "";
        return [
          element.tagName.toLowerCase(),
          testId ? `[data-testid=${testId}]` : "",
          aria ? `[aria-label=${aria}]` : "",
          title ? `[title=${title}]` : "",
          !testId && !aria && !title && classes ? `.${classes}` : "",
          text ? `: ${text}` : "",
        ]
          .filter(Boolean)
          .join("")
          .slice(0, 180);
      };
      const add = (
        element: HTMLElement,
        category: string,
        container: HTMLElement | null,
        score: number,
      ) => {
        const signature = `${category}::${label(element)}`;
        if (emitted.has(signature)) return;
        emitted.add(signature);
        const rect = element.getBoundingClientRect();
        output.push({
          screen,
          width,
          state,
          theme,
          category,
          element: label(element),
          container: container ? label(container) : "viewport",
          text: (element.innerText || element.textContent || "")
            .replace(/\s+/gu, " ")
            .trim()
            .slice(0, 180),
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          widthPx: Math.round(rect.width),
          heightPx: Math.round(rect.height),
          score,
        });
      };
      const cardSelector =
        '[role="dialog"], [role="tabpanel"], article, [data-testid*="card" i], [data-testid*="panel" i], [data-testid*="sheet" i], [class*="card" i], [class*="panel" i], [class*="sheet" i]';
      const isBordered = (element: HTMLElement) => {
        const style = getComputedStyle(element);
        return (
          [
            [style.borderTopWidth, style.borderTopColor],
            [style.borderRightWidth, style.borderRightColor],
            [style.borderBottomWidth, style.borderBottomColor],
            [style.borderLeftWidth, style.borderLeftColor],
          ].some(
            ([borderWidth, borderColor]) =>
              Number.parseFloat(borderWidth ?? "0") > 0 &&
              borderColor !== "transparent" &&
              !borderColor.endsWith(", 0)"),
          ) || style.boxShadow !== "none"
        );
      };
      const nearestContainer = (element: HTMLElement) => {
        let parent = element.parentElement;
        while (parent && parent !== document.body) {
          if (parent.matches(cardSelector) || isBordered(parent)) return parent;
          parent = parent.parentElement;
        }
        return null;
      };
      const textContent = (element: HTMLElement) =>
        (element.innerText || element.textContent || "").trim();

      for (const element of all) {
        if (!visible(element)) continue;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const container = nearestContainer(element);
        const containerRect = container?.getBoundingClientRect();
        const text = textContent(element);
        const isAction = element.matches(
          'button, a[href], [role="button"], [role="tab"], [data-testid*="chip" i], [class*="chip" i], [class*="pill" i]',
        );

        if (
          container &&
          containerRect &&
          (rect.left < containerRect.left - 2 ||
            rect.right > containerRect.right + 2 ||
            rect.top < containerRect.top - 2 ||
            rect.bottom > containerRect.bottom + 2) &&
          (isAction || element.children.length === 0)
        ) {
          add(
            element,
            isAction
              ? "control-outside-container"
              : "content-outside-container",
            container,
            isAction ? 7 : 4,
          );
        }

        const overflowX = style.overflowX;
        if (
          element.scrollWidth > element.clientWidth + 2 &&
          overflowX === "visible" &&
          element !== document.documentElement
        ) {
          const root = element === document.body;
          add(
            element,
            root
              ? "viewport-horizontal-overflow"
              : "non-scrolling-horizontal-overflow",
            container,
            root ? 8 : 3,
          );
        }

        const clippedX =
          (overflowX === "hidden" || overflowX === "clip") &&
          element.scrollWidth > element.clientWidth + 2;
        const clippedY =
          (style.overflowY === "hidden" || style.overflowY === "clip") &&
          element.scrollHeight > element.clientHeight + 2;
        if (
          text &&
          (clippedX || clippedY) &&
          (element.children.length === 0 || isAction)
        ) {
          const ellipsis =
            style.textOverflow === "ellipsis" ||
            (style as CSSStyleDeclaration & { webkitLineClamp?: string })
              .webkitLineClamp !== "none";
          const title =
            element.title || element.closest<HTMLElement>("[title]")?.title;
          if (!ellipsis || !title) {
            add(
              element,
              "text-truncated-without-ellipsis-or-title",
              container,
              3,
            );
          }
        }

        if (
          text &&
          (element.children.length === 0 ||
            element.matches("button, a, p, h1, h2, h3, h4, li"))
        ) {
          const words = Array.from(text.matchAll(/\S+/gu));
          const lineWordCounts = new Map<number, number>();
          for (const word of words) {
            const value = word[0] ?? "";
            const start = word.index ?? 0;
            const range = document.createRange();
            const node = Array.from(element.childNodes).find(
              (child): child is Text =>
                child.nodeType === Node.TEXT_NODE &&
                (child.textContent ?? "").includes(value),
            );
            if (!node) continue;
            const nodeText = node.textContent ?? "";
            const localStart = nodeText.indexOf(value);
            if (localStart < 0) continue;
            range.setStart(node, localStart);
            range.setEnd(node, localStart + value.length);
            const rects = Array.from(range.getClientRects());
            for (const wordRect of rects) {
              const line = Math.round(wordRect.top / 3) * 3;
              lineWordCounts.set(line, (lineWordCounts.get(line) ?? 0) + 1);
            }
            if (
              value.length >= 6 &&
              rects.length >= 3 &&
              element.clientWidth <= minWordWidth
            ) {
              add(element, "word-wrapped-letter-by-letter", container, 7);
              break;
            }
            if (start < 0) break;
          }
          const singleWordLines = Array.from(lineWordCounts.values()).filter(
            (count) => count === 1,
          ).length;
          if (
            words.length >= 4 &&
            singleWordLines >= 4 &&
            element.clientWidth <= minWordWidth
          ) {
            add(element, "one-word-per-line-in-narrow-box", container, 6);
          }
        }

        if (isAction) {
          let parent = element.parentElement;
          while (parent && parent !== document.body) {
            const parentStyle = getComputedStyle(parent);
            if (
              parentStyle.overflowX === "hidden" ||
              parentStyle.overflowX === "clip" ||
              parentStyle.overflowY === "hidden" ||
              parentStyle.overflowY === "clip"
            ) {
              const parentRect = parent.getBoundingClientRect();
              if (
                rect.left < parentRect.left - 2 ||
                rect.right > parentRect.right + 2 ||
                rect.top < parentRect.top - 2 ||
                rect.bottom > parentRect.bottom + 2
              ) {
                add(element, "button-or-chip-cut-by-parent", parent, 8);
              }
              break;
            }
            parent = parent.parentElement;
          }
        }
      }

      const overlapCandidates = all.filter((element) => {
        if (!visible(element)) return false;
        const text = textContent(element);
        const style = getComputedStyle(element);
        return (
          element.parentElement !== null &&
          element.parentElement !== document.body &&
          !["absolute", "fixed"].includes(style.position) &&
          (element.matches(
            'button, a[href], [role="button"], [role="tab"], article, [data-testid*="card" i], [class*="card" i], [class*="chip" i], [class*="pill" i]',
          ) ||
            (text.length > 0 &&
              text.length < 120 &&
              element.children.length === 0))
        );
      });
      const overlapCandidateSet = new Set(overlapCandidates);
      const seenOverlaps = new Set<string>();
      for (const first of overlapCandidates) {
        const siblings = Array.from(first.parentElement?.children ?? []).filter(
          (sibling): sibling is HTMLElement =>
            sibling instanceof HTMLElement && overlapCandidateSet.has(sibling),
        );
        for (const second of siblings) {
          if (first === second) continue;
          const key = [label(first), label(second)].sort().join("::");
          if (seenOverlaps.has(key)) continue;
          seenOverlaps.add(key);
          const a = first.getBoundingClientRect();
          const b = second.getBoundingClientRect();
          const overlapWidth = Math.max(
            0,
            Math.min(a.right, b.right) - Math.max(a.left, b.left),
          );
          const overlapHeight = Math.max(
            0,
            Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top),
          );
          const overlapArea = overlapWidth * overlapHeight;
          const smallerArea = Math.min(a.width * a.height, b.width * b.height);
          if (
            overlapArea >= 16 &&
            smallerArea > 0 &&
            overlapArea / smallerArea >= 0.08
          ) {
            add(first, "overlapping-siblings", first.parentElement, 6);
          }
        }
      }

      return output;
    },
    { screen, width, state, theme, minWordWidth: MIN_WORD_BOX_WIDTH },
  );

  const viewport = page.viewportSize();
  const captureIdCandidate = `overflow-capture-${scanSequence++}`;
  const needsCapture = raw.some((item) => {
    const signature = `${item.category}::${item.element}::${item.container}`;
    return !findingsByKey.get(signature)?.captureId;
  });
  let captureId: string | undefined;
  if (viewport && needsCapture) {
    const png = await page
      .screenshot({ animations: "disabled" })
      .catch(() => undefined);
    if (png) {
      captureId = captureIdCandidate;
      captures.push({
        id: captureId,
        width: viewport.width,
        height: viewport.height,
        png: png.toString("base64"),
      });
    }
  }
  const cropFor = (item: (typeof raw)[number]) => {
    const cropWidth = Math.min(420, viewport?.width ?? 420);
    const cropHeight = Math.min(260, viewport?.height ?? 260);
    return {
      x: Math.max(
        0,
        Math.min(
          (viewport?.width ?? cropWidth) - cropWidth,
          Math.round(item.x + item.widthPx / 2 - cropWidth / 2),
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          (viewport?.height ?? cropHeight) - cropHeight,
          Math.round(item.y + item.heightPx / 2 - cropHeight / 2),
        ),
      ),
      width: cropWidth,
      height: cropHeight,
    };
  };

  for (const item of raw) {
    const signature = `${item.category}::${item.element}::${item.container}`;
    const observation = {
      screen: item.screen,
      width: item.width,
      state: item.state,
      theme: item.theme,
    };
    const existing = findingsByKey.get(signature);
    if (existing) {
      if (
        !existing.observed.some(
          (seen) =>
            seen.screen === observation.screen &&
            seen.width === observation.width &&
            seen.state === observation.state &&
            seen.theme === observation.theme,
        )
      ) {
        existing.observed.push(observation);
      }
      if (existing.captureId) continue;
    }
    const crop = cropFor(item);
    if (existing) {
      existing.captureId = captureId;
      existing.crop = crop;
      continue;
    }
    const finding: Finding = {
      ...item,
      captureId,
      crop,
      observed: [observation],
    };
    findingsByKey.set(signature, finding);
    findings.push(finding);
  }
}

async function visit(
  page: Page,
  route: string,
  selector: string,
  screen: string,
  width: number,
) {
  try {
    await page.evaluate(
      (nextRoute) => {
        const hashIndex = nextRoute.indexOf("#");
        window.location.hash =
          hashIndex >= 0 ? nextRoute.slice(hashIndex) : `#${nextRoute}`;
      },
      route === "/" ? "/" : route,
    );
    await page.locator(selector).waitFor({ state: "visible", timeout: 8_000 });
    await waitForAnimations(page, 100);
    return true;
  } catch (error) {
    coverageIssues.push({
      screen,
      width,
      error: String(error).split("\n")[0].slice(0, 240),
    });
    return false;
  }
}

async function setSidebarMode(
  page: Page,
  width: number,
  mode: "expanded" | "collapsed",
) {
  const isPhone = width < 768;
  if (isPhone) {
    const mobileSidebar = page.locator(
      '[data-sidebar="sidebar"][data-mobile="true"]',
    );
    const open = await mobileSidebar.isVisible().catch(() => false);
    const shouldOpen = mode === "expanded";
    if (open !== shouldOpen) {
      if (shouldOpen) {
        await page.getByTestId("mobile-open-navigation").click();
        await mobileSidebar.waitFor({ state: "visible" });
      } else {
        await page.keyboard.press("Escape");
        await mobileSidebar.waitFor({ state: "hidden" });
      }
    }
    return;
  }

  const sidebar = page.getByTestId("app-sidebar").locator("xpath=..");
  const state = await sidebar.getAttribute("data-state").catch(() => null);
  const wanted = mode === "expanded" ? "expanded" : "collapsed";
  if (state !== wanted) {
    await page.getByRole("button", { name: "Toggle Sidebar" }).click();
    await expect(sidebar).toHaveAttribute("data-state", wanted);
  }
}

function makeReport() {
  const captureById = new Map(captures.map((capture) => [capture.id, capture]));
  const ordered = [...findings].sort(
    (a, b) =>
      b.score - a.score ||
      a.screen.localeCompare(b.screen) ||
      a.width - b.width,
  );
  const counts = new Map<string, number>();
  for (const finding of findings) {
    for (const screen of new Set(
      finding.observed.map((observation) => observation.screen),
    )) {
      counts.set(screen, (counts.get(screen) ?? 0) + 1);
    }
  }
  const summary = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(
      ([screen, count]) =>
        `<tr><td>${escapeHtml(screen)}</td><td>${count}</td></tr>`,
    )
    .join("");
  const observationCount = findings.reduce(
    (count, finding) => count + finding.observed.length,
    0,
  );
  const cards = ordered
    .map((finding, index) => {
      const capture =
        finding.captureId && finding.crop
          ? captureById.get(finding.captureId)
          : undefined;
      const image =
        capture && finding.crop
          ? `<svg class="finding-crop" role="img" aria-label="Screenshot crop for ${escapeHtml(finding.element)}" width="${finding.crop.width}" height="${finding.crop.height}" viewBox="${finding.crop.x} ${finding.crop.y} ${finding.crop.width} ${finding.crop.height}" preserveAspectRatio="xMidYMid slice" style="display:block;max-width:100%;height:auto;border:1px solid #deded7;border-radius:5px;margin-top:12px"><use href="#${capture.id}" width="${capture.width}" height="${capture.height}"></use></svg>`
          : "<p>Screenshot crop unavailable.</p>";
      const observed = finding.observed
        .map(
          (entry) =>
            `${escapeHtml(entry.screen)} at ${entry.width}px ${escapeHtml(entry.state)} ${entry.theme} theme`,
        )
        .join("; ");
      return `<article class="finding p${priority(finding.score).slice(1)}">
        <header><span class="priority">${priority(finding.score)}</span><strong>${index + 1}. ${escapeHtml(finding.screen)}</strong><span>${finding.width}px</span></header>
        <p><b>${escapeHtml(finding.category)}</b> · ${escapeHtml(finding.state)} · ${finding.theme} theme</p>
        <dl><dt>Element</dt><dd>${escapeHtml(finding.element)}</dd><dt>Container</dt><dd>${escapeHtml(finding.container)}</dd><dt>Text</dt><dd>${escapeHtml(finding.text || "[no text]")}</dd><dt>Box</dt><dd>${finding.widthPx} × ${finding.heightPx} at (${finding.x}, ${finding.y})</dd><dt>Observed</dt><dd>${observed}</dd></dl>
        ${image}
      </article>`;
    })
    .join("\n");
  const captureDefs = `<svg class="capture-defs" aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden"><defs>${captures
    .map(
      (capture) =>
        `<image id="${capture.id}" x="0" y="0" width="${capture.width}" height="${capture.height}" href="data:image/png;base64,${capture.png}"/>`,
    )
    .join("")}</defs></svg>`;
  const issues = coverageIssues
    .map(
      (issue) =>
        `<li>${escapeHtml(issue.screen)} at ${issue.width}px: ${escapeHtml(issue.error)}</li>`,
    )
    .join("");
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Colony desktop overflow audit</title>
  <style>
    :root{color-scheme:light;font:15px/1.5 Inter,system-ui,sans-serif;background:#f5f4f0;color:#272723}body{max-width:1200px;margin:0 auto;padding:32px}h1{font-size:28px;margin:0 0 8px}p{color:#64645e}.summary{display:grid;grid-template-columns:2fr 1fr;gap:24px;align-items:start}.summary table{border-collapse:collapse;width:100%;background:#fff;border:1px solid #deded7;border-radius:8px;overflow:hidden}.summary td,.summary th{text-align:left;padding:8px 12px;border-bottom:1px solid #e7e7e1}.summary th{background:#eeeee8}.finding{background:#fff;border:1px solid #deded7;border-left:5px solid #9b6b32;border-radius:8px;padding:18px;margin:18px 0;box-shadow:0 2px 8px #2727230d}.finding.p0{border-left-color:#b52b2b}.finding.p1{border-left-color:#c46a24}.finding.p2{border-left-color:#bf9a26}.finding.p3{border-left-color:#75836e}.finding header{display:flex;align-items:center;gap:12px}.finding header span:last-child{margin-left:auto;color:#64645e}.priority{font-size:12px;font-weight:700;border:1px solid currentColor;border-radius:99px;padding:2px 8px}.finding dl{display:grid;grid-template-columns:110px 1fr;gap:4px 12px}.finding dt{font-weight:600}.finding dd{margin:0;overflow-wrap:anywhere}.finding img{display:block;max-width:100%;height:auto;border:1px solid #deded7;border-radius:5px;margin-top:12px}.coverage{background:#fff3e8;border:1px solid #e7c6a2;padding:12px 16px;border-radius:8px}@media(max-width:700px){body{padding:16px}.summary{display:block}.finding dl{grid-template-columns:1fr}.finding dd{margin-bottom:8px}}
  </style><body>${captureDefs}<h1>Colony desktop overflow audit</h1>
  <p>${findings.length} unique findings across ${counts.size} screens, seen in ${observationCount} screen and width states. Scanned light theme at 1920, 1440, 1280, 1024, 900 and 390 pixels, expanded and collapsed sidebar states, dock states, dialogs, sheets, onboarding and Outreach desk tabs. Findings are ranked by likely visibility and impact.</p>
  <div class="summary"><table><thead><tr><th>Screen</th><th>Findings</th></tr></thead><tbody>${summary || "<tr><td>None</td><td>0</td></tr>"}</tbody></table>
  <div><h2>Coverage</h2><p>Overflow categories include content outside bordered cards, non-scrolling horizontal overflow, text clipping without ellipsis and a title, narrow word wrapping, clipped controls, and overlapping siblings.</p>${coverageIssues.length ? `<div class="coverage"><b>${coverageIssues.length} screen states could not be reached</b><ul>${issues}</ul></div>` : "<p>All declared screens reached.</p>"}</div></div>
  <h2>Findings</h2>${cards || "<p>No overflow findings.</p>"}</body></html>`;
}

test.describe.configure({ mode: "serial", timeout: 15 * 60_000 });

test("all screens, widths and important states", async ({ page, browser }) => {
  process.env.COLONY3_PROOF_THEME = "light";
  page.setDefaultTimeout(2_000);
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: WIDTHS[0], height: HEIGHT });
  await page.clock.setFixedTime(new Date(COLONY3_NOW));
  const mock = makeMock();
  await installMockBridge(page, mock);
  await page.goto("/#/today");
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await seedColony3Activity(page);

  for (const width of WIDTHS) {
    await page.setViewportSize({
      width,
      height: width === 390 ? PHONE_HEIGHT : HEIGHT,
    });
    for (const routeScreen of routeScreens) {
      if (
        !(await visit(
          page,
          routeScreen.route,
          routeScreen.selector,
          routeScreen.screen,
          width,
        ))
      )
        continue;
      if (routeScreen.screen.startsWith("Settings:")) {
        await scanState(
          page,
          routeScreen.screen,
          width,
          "settings-panel",
          "light",
        );
        console.log(
          `[overflow-audit] ${routeScreen.screen} @ ${width}px: scanned settings panel`,
        );
        continue;
      }
      for (const mode of ["expanded", "collapsed"] as const) {
        try {
          await setSidebarMode(page, width, mode);
          await scanState(
            page,
            routeScreen.screen,
            width,
            `sidebar-${mode}`,
            "light",
          );
        } catch (error) {
          coverageIssues.push({
            screen: `${routeScreen.screen} / sidebar-${mode}`,
            width,
            error: String(error).split("\n")[0].slice(0, 240),
          });
        }
      }
      const screenFindings = findings.filter((finding) =>
        finding.observed.some(
          (entry) =>
            entry.screen === routeScreen.screen && entry.width === width,
        ),
      ).length;
      console.log(
        `[overflow-audit] ${routeScreen.screen} @ ${width}px: ${screenFindings} findings; ${findings.length} total; ${coverageIssues.length} coverage issues`,
      );
      const categories = findings
        .filter((finding) =>
          finding.observed.some((entry) => entry.screen === routeScreen.screen),
        )
        .reduce<Record<string, number>>((counts, finding) => {
          counts[finding.category] = (counts[finding.category] ?? 0) + 1;
          return counts;
        }, {});
      console.log(
        `[overflow-audit] categories ${routeScreen.screen}: ${JSON.stringify(categories)}`,
      );
      if (coverageIssues.length > 0) {
        console.log(
          "[overflow-audit] recent coverage issues",
          JSON.stringify(coverageIssues.slice(-2)),
        );
      }
    }

    const dialogStates: Array<{
      screen: string;
      route: string;
      selector?: string;
      action: () => Promise<void>;
    }> = [
      {
        screen: "Discovery campaign dialog",
        route: "/#/discovery",
        action: async () => {
          await page.getByRole("button", { name: /Beauty & Wellness/ }).click();
          await page
            .getByRole("button", { name: /Find prospects/ })
            .first()
            .click();
          const details = page.getByTestId("discovery-type-details-dialog");
          await details.getByRole("button", { name: /Find prospects/ }).click();
          await page
            .getByTestId("discovery-campaign-dialog")
            .waitFor({ state: "visible" });
        },
      },
      {
        screen: "Settings status dialog",
        route: "/#/settings?section=profile",
        selector: '[data-testid="account-profile-status"]',
        action: async () => {
          await page.getByTestId("account-profile-status").click();
          await page
            .getByTestId("set-status-dialog")
            .waitFor({ state: "visible" });
        },
      },
      {
        screen: "Money create invoice dialog",
        route: "/#/money/invoices",
        action: async () => {
          await page.getByRole("button", { name: "New invoice" }).click();
          await page
            .getByRole("dialog", { name: "New invoice" })
            .waitFor({ state: "visible" });
        },
      },
      {
        screen: "Channel management sheet",
        route: `/#/channels/${REFERENCE_CHANNEL_IDS.sales}`,
        action: async () => {
          await page.getByTestId("channel-management-trigger").first().click();
          await page
            .getByTestId("channel-management-sheet")
            .waitFor({ state: "visible" });
        },
      },
      {
        screen: "Lead add dialog",
        route: "/#/leads",
        action: async () => {
          await page.getByRole("button", { name: "Add lead" }).first().click();
          await page
            .getByTestId("w10-add-lead-dialog")
            .waitFor({ state: "visible" });
        },
      },
      {
        screen: "Channel browser dialog",
        route: "/#/today",
        selector: '[data-testid="today-screen"]',
        action: async () => {
          await openChannelBrowser(page);
          await page
            .getByTestId("channel-browser-dialog")
            .waitFor({ state: "visible" });
        },
      },
      {
        screen: "Thread panel",
        route: `/#/channels/${REFERENCE_CHANNEL_IDS.welcome}`,
        selector: '[data-testid="chat-title"]',
        action: async () => {
          const channelName = "Welcome";
          await expect(page.getByTestId("chat-title")).toHaveText(channelName);
          await expect
            .poll(() =>
              page.evaluate(
                (name) =>
                  (
                    window as Window & {
                      __BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?: (input: {
                        channelName: string;
                      }) => boolean;
                    }
                  ).__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
                    channelName: name,
                  }) ?? false,
                channelName,
              ),
            )
            .toBe(true);
          const root = await page.evaluate(
            ({ channelName, content }) =>
              (
                window as Window & {
                  __BUZZ_E2E_EMIT_MOCK_MESSAGE__?: (input: {
                    channelName: string;
                    content: string;
                  }) => { id: string };
                }
              ).__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
                channelName,
                content,
              }),
            { channelName, content: "Overflow audit thread root" },
          );
          if (!root?.id) throw new Error("Could not seed the thread root");
          await page.evaluate(
            ({ channelName, content, parentEventId }) =>
              (
                window as Window & {
                  __BUZZ_E2E_EMIT_MOCK_MESSAGE__?: (input: {
                    channelName: string;
                    content: string;
                    parentEventId: string;
                  }) => unknown;
                }
              ).__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
                channelName,
                content,
                parentEventId,
              }),
            {
              channelName,
              content: "Overflow audit thread reply",
              parentEventId: root.id,
            },
          );
          await page.getByTestId("message-thread-summary").first().waitFor({
            state: "visible",
          });
          await page.getByTestId("message-thread-summary").first().click();
          await page
            .getByTestId("message-thread-panel")
            .waitFor({ state: "visible" });
        },
      },
      {
        screen: "Search dialog",
        route: "/#/today",
        selector: '[data-testid="today-screen"]',
        action: async () => {
          await page.getByTestId("open-search").click();
          await page.getByRole("dialog").waitFor({ state: "visible" });
        },
      },
    ];
    for (const dialog of dialogStates) {
      if (
        !(await visit(
          page,
          dialog.route,
          "selector" in dialog ? dialog.selector : "body",
          dialog.screen,
          width,
        ))
      ) {
        console.log(
          `[overflow-audit] ${dialog.screen} @ ${width}px: route unavailable`,
        );
        continue;
      }
      try {
        if (dialog.screen !== "Settings status dialog") {
          await setSidebarMode(page, width, "collapsed");
        }
        await dialog.action();
        await waitForAnimations(page);
        await scanState(page, dialog.screen, width, "dialog-open", "light");
      } catch (error) {
        coverageIssues.push({
          screen: dialog.screen,
          width,
          error: String(error).split("\n")[0].slice(0, 240),
        });
      } finally {
        await page.keyboard.press("Escape").catch(() => {});
        await page
          .getByRole("dialog")
          .last()
          .waitFor({ state: "hidden", timeout: 750 })
          .catch(() => {});
      }
    }

    for (const dialog of dialogStates) {
      const screenFindings = findings.filter((finding) =>
        finding.observed.some(
          (entry) => entry.screen === dialog.screen && entry.width === width,
        ),
      ).length;
      console.log(
        `[overflow-audit] ${dialog.screen} @ ${width}px: ${screenFindings} findings; ${coverageIssues.length} coverage issues`,
      );
    }

    if (
      await visit(
        page,
        `/#/channels/${REFERENCE_CHANNEL_IDS.oliveHouse}`,
        '[data-testid="chat-title"]',
        "Work area dock",
        width,
      )
    ) {
      for (const tab of ["canvas", "files", "terminal"]) {
        try {
          await page.evaluate((kind) => {
            window.dispatchEvent(
              new CustomEvent("colony:open-work-area-tab", { detail: kind }),
            );
          }, tab);
          await page
            .getByTestId("work-area-panel")
            .waitFor({ state: "visible", timeout: 5_000 });
          await waitForAnimations(page);
          await scanState(
            page,
            `Work area dock: ${tab}`,
            width,
            "dock-open",
            "light",
          );
          await page
            .getByTestId("work-area-close")
            .evaluate((button) => (button as HTMLButtonElement).click());
          await page
            .getByTestId("work-area-panel")
            .waitFor({ state: "hidden" });
          await scanState(
            page,
            `Work area dock: ${tab}`,
            width,
            "dock-closed",
            "light",
          );
        } catch (error) {
          coverageIssues.push({
            screen: `Work area dock: ${tab}`,
            width,
            error: String(error).split("\n")[0].slice(0, 240),
          });
        }
      }
    }
    console.log(
      `[overflow-audit] completed light route, dialog and dock width ${width}px`,
    );
  }

  for (const width of WIDTHS) {
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? PHONE_HEIGHT : HEIGHT },
      colorScheme: "light",
    });
    const onboardingPage = await context.newPage();
    onboardingPage.setDefaultTimeout(2_000);
    try {
      await onboardingPage.clock.setFixedTime(new Date(COLONY3_NOW));
      await installMockBridge(
        onboardingPage,
        { accountLinked: true },
        { skipCommunitySeed: true, skipOnboardingSeed: true },
      );
      await onboardingPage.goto("/");
      await onboardingPage
        .getByTestId("onboarding-scene-account")
        .waitFor({ state: "visible" });
      await scanState(
        onboardingPage,
        "Onboarding: account",
        width,
        "account-entry",
        "light",
      );
      await openR17BusinessSetup(onboardingPage);
      await scanState(
        onboardingPage,
        "Onboarding: business",
        width,
        "business-setup",
        "light",
      );
      await completeR17BusinessSetup(onboardingPage);
      await onboardingPage
        .getByTestId("onboarding-scene-connect")
        .waitFor({ state: "visible" });
      await scanState(
        onboardingPage,
        "Onboarding: connection",
        width,
        "connection-setup",
        "light",
      );
    } catch (error) {
      coverageIssues.push({
        screen: "Onboarding",
        width,
        error: String(error).split("\n")[0].slice(0, 240),
      });
    } finally {
      await context.close();
    }
  }

  for (const width of WIDTHS) {
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? PHONE_HEIGHT : HEIGHT },
      colorScheme: "light",
    });
    const outreachPage = await context.newPage();
    outreachPage.setDefaultTimeout(2_000);
    try {
      await installWhatsAppMockBridge(outreachPage, "light", {
        deskFixture: true,
      });
      await outreachPage.goto("/");
      await setSidebarMode(outreachPage, width, "expanded");
      await outreachPage.getByTestId("channel-Outreach").click();
      await outreachPage
        .getByTestId("outreach-desk-needs-you")
        .waitFor({ state: "visible" });
      const tabs = await outreachPage
        .locator('[data-testid^="channel-view-tab-"]')
        .evaluateAll((elements) =>
          elements
            .map((element) => element.getAttribute("data-testid"))
            .filter((value): value is string => value !== null),
        );
      for (const tabId of tabs) {
        await outreachPage.getByTestId(tabId).click();
        await waitForAnimations(outreachPage);
        await scanState(
          outreachPage,
          `Outreach desk: ${tabId.replace("channel-view-tab-", "")}`,
          width,
          "desk-tab",
          "light",
        );
      }
    } catch (error) {
      coverageIssues.push({
        screen: "Outreach desk tabs",
        width,
        error: String(error).split("\n")[0].slice(0, 240),
      });
    } finally {
      await context.close();
    }
  }

  for (const width of [1440, 390] as const) {
    const previousTheme = process.env.COLONY3_PROOF_THEME;
    process.env.COLONY3_PROOF_THEME = "dark";
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? PHONE_HEIGHT : HEIGHT },
      colorScheme: "dark",
    });
    const darkPage = await context.newPage();
    darkPage.setDefaultTimeout(2_000);
    try {
      await darkPage.clock.setFixedTime(new Date(COLONY3_NOW));
      await installMockBridge(darkPage, makeMock());
      await darkPage.goto("/#/today");
      await expect(darkPage.getByTestId("today-screen")).toBeVisible();
      await scanState(
        darkPage,
        "Today (dark spot check)",
        width,
        "light-sidebar",
        "dark",
      );
      for (const screen of [
        {
          name: "Discovery",
          route: "/#/discovery",
          selector: '[data-testid="w10-discovery-page"]',
        },
        {
          name: "Money",
          route: "/#/money",
          selector: '[data-testid="money-overview"]',
        },
        {
          name: "Agents",
          route: "/#/agents",
          selector: '[data-testid="agent-directory"]',
        },
        {
          name: "Sales channel",
          route: `/#/channels/${REFERENCE_CHANNEL_IDS.sales}`,
          selector: '[data-testid="chat-title"]',
        },
      ]) {
        if (
          await visit(
            darkPage,
            screen.route,
            screen.selector,
            `${screen.name} dark`,
            width,
          )
        ) {
          await scanState(
            darkPage,
            `${screen.name} (dark spot check)`,
            width,
            "light-sidebar",
            "dark",
          );
        }
      }
    } catch (error) {
      coverageIssues.push({
        screen: "Dark theme spot checks",
        width,
        error: String(error).split("\n")[0].slice(0, 240),
      });
    } finally {
      await context.close();
      if (previousTheme === undefined) delete process.env.COLONY3_PROOF_THEME;
      else process.env.COLONY3_PROOF_THEME = previousTheme;
    }
  }

  const counts = new Map<string, number>();
  for (const finding of findings)
    counts.set(finding.screen, (counts.get(finding.screen) ?? 0) + 1);
  console.log(
    "OVERFLOW_AUDIT_COUNTS_BY_SCREEN",
    JSON.stringify(Object.fromEntries(counts)),
  );
  console.log("OVERFLOW_AUDIT_COVERAGE_ISSUES", JSON.stringify(coverageIssues));
  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, makeReport());
  expect(
    coverageIssues,
    "Every declared screen and state must be reached",
  ).toEqual([]);
  expect(
    findings
      .filter((finding) => !finding.captureId || !finding.crop)
      .map((finding) => ({
        screen: finding.screen,
        width: finding.width,
        element: finding.element,
      })),
    "Every finding needs an evidence crop",
  ).toEqual([]);
  expect(
    findings.length,
    "Overflow audit findings by screen are printed above",
  ).toBe(0);
});
