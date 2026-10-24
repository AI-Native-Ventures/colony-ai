/**
 * Test-only: the Decision outcomes sheet (`AskOutcomes.dc.html`), built from
 * the app's real outcome card. The board is a state sheet, not a screen, so no
 * route lists the cards side by side; this mounts them from sample ask heads
 * (the Lerato Social fixture) so the sheet can be compared with the board. It
 * is mounted instead of the app when the E2E bridge asks for `showcase:
 * "colony3-ask-outcomes"`, and is never part of a production build.
 *
 * The Duty approval card of the board is left out: duties are cut from lean
 * Colony 3.0.
 */
import * as React from "react";
import ReactDOM from "react-dom/client";

import type { UserProfileLookup } from "@/features/profile/lib/identity";
import { mapSpecializedAskCard } from "@/features/company-asks/askCardMapping";
import { AskThreadOutcomeCard } from "@/features/company-asks/ui/AskOutcomeCard";
import type { OutcomeActorView } from "@/features/company-asks/ui/AskOutcomeCard";
import type {
  AskHead,
  AskOutcome,
  AskRecord,
} from "@/features/company-asks/askRecords";
import { ThemeProvider } from "@/shared/theme/ThemeProvider";
import { TooltipProvider } from "@/shared/ui/tooltip";

const LERATO = "a".repeat(63) + "1";
const NOLUTHANDO = "a".repeat(63) + "2";
const SCOUT = "a".repeat(63) + "3";

const PROFILES: UserProfileLookup = {
  [LERATO]: {
    displayName: "Lerato Molefe",
    avatarUrl: null,
    nip05Handle: null,
    ownerPubkey: null,
  },
  [NOLUTHANDO]: {
    displayName: "Noluthando Khumalo",
    avatarUrl: null,
    nip05Handle: null,
    ownerPubkey: null,
  },
  [SCOUT]: {
    displayName: "Scout",
    avatarUrl: null,
    nip05Handle: null,
    ownerPubkey: null,
    isAgent: true,
  },
};

const NAMES: Record<string, string> = {
  [LERATO]: "Lerato Molefe",
  [NOLUTHANDO]: "Noluthando Khumalo",
  [SCOUT]: "Scout",
};

function actor(pubkey: string): OutcomeActorView {
  return { pubkey, name: NAMES[pubkey] ?? pubkey, isAgent: pubkey === SCOUT };
}

type Sample = {
  key: string;
  ask: Pick<AskRecord, "type" | "category" | "title" | "options" | "items"> & {
    decideBy?: string;
  };
  asker?: string;
  resolution?: {
    outcome: AskOutcome;
    by: string;
    at: string;
    reason?: string;
    answer?: string;
    optionId?: string;
  };
  overdue?: boolean;
  canAnswer?: boolean;
  deniedMessage?: string;
};

const SAMPLES: Sample[] = [
  {
    key: "approved",
    ask: {
      type: "approval",
      category: "general",
      title: "Approve the October campaign",
    },
    resolution: {
      outcome: "approved",
      by: LERATO,
      at: "2026-10-23T13:58:00+02:00",
      reason: "Lovely work. Schedule the first three posts.",
    },
  },
  {
    key: "rejected",
    ask: {
      type: "approval",
      category: "general",
      title: "Approve the launch plan",
    },
    resolution: {
      outcome: "rejected",
      by: LERATO,
      at: "2026-10-20T10:00:00+02:00",
      reason: "Too much in one week. Split it into two launches.",
    },
  },
  {
    key: "revision",
    ask: {
      type: "approval",
      category: "general",
      title: "Approve the Cedar Café captions",
    },
    resolution: {
      outcome: "revision_requested",
      by: NOLUTHANDO,
      at: "2026-10-22T10:00:00+02:00",
      reason: "Shorter, and keep the café’s own voice.",
    },
  },
  {
    key: "answered",
    ask: {
      type: "question",
      category: "general",
      title: "Which client requirement should we prioritise?",
    },
    resolution: {
      outcome: "answered",
      by: LERATO,
      at: "2026-10-23T11:20:00+02:00",
      answer: "Publishing access for Cedar Café comes first.",
    },
  },
  {
    key: "choice",
    ask: {
      type: "choice",
      category: "general",
      title: "Choose the campaign direction",
      options: [
        { id: "customer-stories", label: "Customer stories" },
        { id: "studio-process", label: "Studio process" },
        { id: "product-education", label: "Product education" },
      ],
    },
    resolution: {
      outcome: "chosen",
      by: LERATO,
      at: "2026-10-23T09:30:00+02:00",
      optionId: "customer-stories",
    },
  },
  {
    key: "checklist",
    ask: {
      type: "checklist",
      category: "general",
      title: "Confirm the client brief is ready",
      items: [
        { id: "tone", label: "Tone matches the client brief" },
        { id: "dates", label: "Dates are confirmed" },
        { id: "owner", label: "Owner is assigned" },
      ],
    },
    resolution: {
      outcome: "confirmed",
      by: NOLUTHANDO,
      at: "2026-10-23T09:40:00+02:00",
    },
  },
  {
    key: "pass",
    ask: {
      type: "verdict",
      category: "general",
      title: "Does the revised plan meet the done condition?",
    },
    resolution: {
      outcome: "pass",
      by: NOLUTHANDO,
      at: "2026-10-23T10:05:00+02:00",
      reason: "Meets every acceptance criterion.",
    },
  },
  {
    key: "fail",
    ask: {
      type: "verdict",
      category: "general",
      title: "Is the spring brief ready for the client?",
    },
    resolution: {
      outcome: "fail",
      by: LERATO,
      at: "2026-10-21T10:00:00+02:00",
      reason: "The shoot dates are still missing.",
    },
  },
  {
    key: "budget",
    ask: {
      type: "approval",
      category: "money",
      title: "Increase Olive Studio’s October allowance by USD 120",
      decideBy: "2026-10-22T17:00:00+02:00",
    },
    asker: SCOUT,
    overdue: true,
    canAnswer: true,
  },
  {
    key: "tool",
    ask: {
      type: "tool_consent",
      category: "tool",
      title: "Connect social publishing",
    },
    asker: SCOUT,
    canAnswer: false,
    deniedMessage: "Only company owners and admins can decide this",
  },
  {
    key: "hire",
    ask: {
      type: "approval",
      category: "hire",
      title: "Compass · Hospitality Researcher",
    },
    resolution: {
      outcome: "rejected",
      by: LERATO,
      at: "2026-10-19T10:00:00+02:00",
      reason: "Not this quarter. Aya can qualify leads for now.",
    },
  },
];

function headFor(sample: Sample): AskHead {
  const askId = `00000000-0000-4000-8000-${sample.key
    .padEnd(12, "0")
    .slice(0, 12)
    .replace(/[^0-9a-f]/g, "0")}`;
  return {
    schemaVersion: 1,
    askId,
    status: sample.resolution ? "resolved" : "open",
    askerPubkey: sample.asker ?? LERATO,
    createdAt: "2026-10-22T09:00:00+02:00",
    ask: {
      schemaVersion: 1,
      askId,
      threadRootEventId: "b".repeat(64),
      ...sample.ask,
    },
    resolution: sample.resolution
      ? {
          outcome: sample.resolution.outcome,
          ...(sample.resolution.reason
            ? { reason: sample.resolution.reason }
            : {}),
          ...(sample.resolution.answer
            ? { answer: sample.resolution.answer }
            : {}),
          ...(sample.resolution.optionId
            ? { optionId: sample.resolution.optionId }
            : {}),
          ...(sample.resolution.outcome === "confirmed"
            ? { checkedItemIds: ["tone", "dates", "owner"] }
            : {}),
          resolvedByPubkey: sample.resolution.by,
          resolvedAt: sample.resolution.at,
          responseEventId: "c".repeat(64),
        }
      : null,
    cancellation: null,
    sourceActionEventId: "d".repeat(64),
  };
}

function OutcomesSheet() {
  return (
    <div
      className="colony-outcomes-sheet"
      data-testid="colony3-ask-outcomes"
      style={{ boxSizing: "border-box", marginLeft: 280, paddingTop: 92 }}
    >
      <h1>Decision outcomes</h1>
      <div className="colony-outcomes-grid">
        {SAMPLES.map((sample) => {
          const head = headFor(sample);
          const kind = mapSpecializedAskCard(head.ask)?.kind;
          return (
            <AskThreadOutcomeCard
              accessFailure={false}
              askId={head.askId}
              asker={actor(head.askerPubkey)}
              canAnswer={sample.canAnswer ?? false}
              canceller={null}
              conversationLink={
                <a className="colony-outcome-link" href="#conversation">
                  Open conversation
                </a>
              }
              deniedMessage={sample.deniedMessage ?? ""}
              detailLink={
                <a className="colony-outcome-button" href="#decision">
                  Open decision
                </a>
              }
              head={head}
              isOverdue={sample.overdue ?? false}
              key={sample.key}
              kind={kind}
              liveUnavailable={false}
              profiles={PROFILES}
              resolver={
                head.resolution ? actor(head.resolution.resolvedByPubkey) : null
              }
              titleLink={(title) => title}
            />
          );
        })}
      </div>
    </div>
  );
}

export function renderAskOutcomesShowcase() {
  const root = document.getElementById("root");
  if (!root) return;
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <ThemeProvider defaultTheme="buzz">
        <TooltipProvider>
          <OutcomesSheet />
        </TooltipProvider>
      </ThemeProvider>
    </React.StrictMode>,
  );
}
