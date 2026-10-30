import type { MockPlan } from "./e2eBridge";

/**
 * Plan seeds for the mock bridge, taken from the approved CFPlanCard and
 * CFNeedsYou boards. The UI lane renders these; pass them as
 * `mock.companyPlans`.
 */
export const NOVEMBER_PLAN_ID = "7f0c3c1e-5b1e-4d52-9a55-3d1f2b6a8c10";
export const ESIGN_PLAN_ID = "0b4c8a52-6f0e-4d19-8c1b-5a0d7e2f9c31";

/** "Get 5 Horizon Labs clients in November": proposed by Scout, six steps, about R37, target 5 won. */
export function novemberPlan(input: {
  scoutPubkey: string;
  ayaPubkey: string;
}): MockPlan {
  return {
    planId: NOVEMBER_PLAN_ID,
    status: "proposed",
    revision: 1,
    proposedByPubkey: input.scoutPubkey,
    proposedAt: 1_793_000_000,
    plan: {
      title: "Get 5 Horizon Labs clients in November",
      summary:
        "Goal for Sales. Every message to a lead still waits for your OK.",
      function: "sales",
      currency: "ZAR",
      budgetCents: 0,
      decideBy: 1_793_300_000,
      targetLabel: "5 won",
      timingLabel: "1 to 30 November",
      steps: [
        {
          stepId: "find",
          title: "Find 60 guesthouses in Linden, Melville and Parkhurst",
          owner: { kind: "lead_agent", agentPubkey: input.ayaPubkey },
          tools: ["Discovery"],
          costLabel: "Covered by subscription",
          whenLabel: "2 to 4 Nov",
        },
        {
          stepId: "previews",
          title: "Build a site preview for the best 30",
          owner: {
            kind: "worker",
            workerType: "site_build",
            agentPubkey: input.ayaPubkey,
          },
          costLabel: "Free models",
          whenLabel: "3 to 6 Nov",
        },
        {
          stepId: "opener",
          title: "Send the Built a site for you opener, 30 a day",
          owner: { kind: "lead_agent", agentPubkey: input.ayaPubkey },
          tools: ["WhatsApp"],
          costLabel: "About R0.62 per new chat",
          costEstimateCents: 3_720,
          whenLabel: "From 4 Nov",
          approvalPoint: { kind: "outreach", prompt: "You approve each batch" },
        },
        {
          stepId: "calls",
          title: "Book calls with everyone who replies",
          owner: { kind: "lead_agent", agentPubkey: input.ayaPubkey },
          tools: ["Google Calendar"],
          costLabel: "Free",
          whenLabel: "Ongoing",
        },
        {
          stepId: "quotes",
          title: "Quotes and agreements to sign",
          owner: { kind: "lead_agent", agentPubkey: input.ayaPubkey },
          costLabel: "E-sign free plan",
          whenLabel: "Ongoing",
          approvalPoint: { kind: "other", prompt: "You approve each one" },
        },
        {
          stepId: "deposits",
          title: "Deposit links and kick-off",
          owner: { kind: "function", function: "finance" },
          costLabel: "Fee per payment",
          whenLabel: "On signing",
        },
      ],
    },
  };
}

/**
 * An approved plan with the three kinds of "Needs you" step: a human-only
 * step (Do), a step at its approval point (Approve) and a step that runs.
 */
export function esignSetupPlan(input: {
  scoutPubkey: string;
  ownerPubkey: string;
}): MockPlan {
  return {
    planId: ESIGN_PLAN_ID,
    status: "approved",
    revision: 1,
    proposedByPubkey: input.scoutPubkey,
    proposedAt: 1_793_000_000,
    updatedAt: 1_793_000_900,
    approvals: [
      {
        scope: "plan",
        decision: "approved",
        actorPubkey: input.ownerPubkey,
        at: 1_793_000_500,
        revision: 1,
        actionEventId: "d".repeat(64),
      },
    ],
    plan: {
      title: "Let clients sign agreements in Colony",
      summary: "Free e-sign plan, 3 documents a month.",
      function: "finance",
      currency: "ZAR",
      budgetCents: 0,
      timingLabel: "This week",
      steps: [
        {
          stepId: "signup",
          title: "Sign up for a free e-sign tool",
          detail:
            "Sign-up page is open in the browser. Choose a password, then tell me.",
          owner: { kind: "owner" },
          costLabel: "Free",
          whenLabel: "Today",
          status: "pending",
        },
        {
          stepId: "template",
          title: "Send the first agreement template to a client",
          owner: { kind: "function", function: "finance" },
          costLabel: "Free",
          whenLabel: "After sign-up",
          approvalPoint: { kind: "taste", prompt: "You approve the template" },
          status: "waiting_approval",
        },
      ],
    },
  };
}
