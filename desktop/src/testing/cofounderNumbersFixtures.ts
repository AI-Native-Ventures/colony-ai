import type { CofounderNumbersFixture } from "@/features/cofounder/cofounderNumbers";

/** Horizon Labs sample values from the approved Phase 5 review boards. */
export const COFOUNDER_NUMBERS_FIXTURE: CofounderNumbersFixture = {
  dateLabel: "Friday 30 October",
  rangeLabel: "26 to 30 October",
  rows: [
    {
      functionId: "sales",
      current: "24 contacted · 7 replied · 3 calls · 1 won",
      change: "+4 contacted · +2 replied · +1 won",
      direction: "up",
    },
    {
      functionId: "operations",
      current: "3 jobs · 6 days to deliver · 2 revisions",
      change: "+1 job · 2 days faster",
      direction: "up",
    },
    {
      functionId: "customer_success",
      current: "2 live clients · no lead yet",
      change: "+1 live client",
      direction: "up",
    },
    {
      functionId: "finance",
      current: "1 deposit paid · 1 invoice waiting",
      change: "+1 deposit paid",
      direction: "up",
    },
    {
      functionId: "brand",
      current: "About R37 per new client",
      change: "R12 less per client",
      direction: "down",
    },
  ],
  worked: "Built a site for you gets 3x the replies of the other openers.",
  missed: "Has a website: refresh did not get a reply this week.",
  proposedChange:
    "Use Built a site for you for every new guesthouse. Pause Has a website: refresh on your radar?",
  decisions: [
    {
      id: "november-plan",
      kind: "plan",
      title: "Approve the November plan",
      detail: "Get 5 Horizon Labs clients in November.",
      primaryLabel: "Approve plan",
      secondaryLabel: "Open plan",
    },
    {
      id: "customer-success-hire",
      kind: "hire",
      title: "Hire a Customer Success lead?",
      detail: "Two clients are active and renewals need an owner.",
      primaryLabel: "Yes, hire",
      secondaryLabel: "Not yet",
    },
  ],
  scorecards: {
    sales: [
      { value: "64", label: "Leads" },
      { value: "41", label: "Contacted" },
      { value: "12", label: "Replied" },
      { value: "5", label: "Calls" },
      { value: "3", label: "Quotes" },
      { value: "2", label: "Won" },
    ],
    operations: [
      { value: "3", label: "Jobs in progress" },
      { value: "6 days", label: "Days to deliver" },
      { value: "2", label: "Revisions" },
    ],
    customer_success: [
      { value: "2", label: "Active clients" },
      { value: "1", label: "Renewals" },
      { value: "1", label: "Referrals" },
    ],
    finance: [
      { value: "R15k", label: "Cash in" },
      { value: "R4k", label: "Owed" },
      { value: "R30k", label: "Recurring" },
      { value: "R3k", label: "Costs" },
    ],
    brand: [
      { value: "R37", label: "Cost per client" },
      { value: "7", label: "Replies from best opener" },
    ],
  },
  scorecardNotes: {
    sales: "November so far. Replies come mostly from Built a site for you.",
    operations: "Three client jobs are moving through delivery this week.",
    customer_success: "Two clients are active. One renewal is coming up.",
    finance: "One deposit has been paid. One invoice is waiting.",
    brand: "Built a site for you is bringing in the most replies.",
  },
  goals: {
    sales: {
      approved: [
        {
          id: "sales-november-clients",
          title: "5 new clients in November",
          current: 2,
          target: 5,
          owner: "Aya",
          approvedBy: "you",
          approvedOn: "30 Oct",
        },
      ],
      proposed: [],
      suggested: {
        id: "sales-follow-up-goal",
        title: "Follow up with 5 new leads in November",
        current: 0,
        target: 5,
        owner: "Aya",
      },
    },
    operations: {
      approved: [
        {
          id: "operations-launch-window",
          title: "Launch each job within 7 days",
          current: 1,
          target: 1,
          owner: "Scout",
          approvedBy: "you",
          approvedOn: "30 Oct",
        },
      ],
      proposed: [],
      suggested: {
        id: "operations-revisions-goal",
        title: "Keep revisions to 2 rounds per job",
        current: 0,
        target: 2,
        owner: "Scout",
      },
    },
    customer_success: {
      approved: [
        {
          id: "customer-success-referrals",
          title: "Earn 5 client referrals in November",
          current: 1,
          target: 5,
          owner: "Scout",
          approvedBy: "you",
          approvedOn: "30 Oct",
        },
      ],
      proposed: [],
      suggested: {
        id: "customer-success-renewals-goal",
        title: "Renew both active client agreements",
        current: 0,
        target: 2,
        owner: "Scout",
      },
    },
    finance: {
      approved: [
        {
          id: "finance-recurring-goal",
          title: "Reach R30k recurring a month",
          current: 18,
          target: 30,
          owner: "Scout",
          approvedBy: "you",
          approvedOn: "30 Oct",
        },
      ],
      proposed: [],
      suggested: {
        id: "finance-invoice-goal",
        title: "Clear the invoice waiting for payment",
        current: 0,
        target: 1,
        owner: "Scout",
      },
    },
    brand: {
      approved: [],
      proposed: [],
      suggested: {
        id: "brand-replies-goal",
        title: "Get 10 replies from the best opener",
        current: 7,
        target: 10,
        owner: "Scout",
      },
    },
  },
};
