import { Link } from "@tanstack/react-router";

import { useCompanyTeamQuery } from "@/features/company-team/teamRelay";
import type { TeamMember } from "@/features/company-team/teamModels";
import { EmployeeAvatar } from "@/features/company-team/ui/EmployeeAvatar";
import { TeamPage, TeamPageTitle } from "@/features/company-team/ui/TeamPage";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import { useCommunities } from "@/features/communities/useCommunities";

import { FUNCTION_DETAILS, FUNCTION_DESCRIPTIONS } from "../functions";
import { useCofounderSettingsQuery, useFunctionSlotsQuery } from "../hooks";
import type { FunctionId, FunctionSlotView } from "../cofounderRecords";
import { WorkerList } from "./WorkerList";
import { OperationsPlaybookScreen } from "./OperationsPlaybookScreen";

type ProfileLookup = Record<
  string,
  { displayName: string | null; avatarUrl?: string | null }
>;

function memberName(member: TeamMember, profiles: ProfileLookup): string {
  const profileName =
    profiles[member.pubkey.toLowerCase()]?.displayName?.trim();
  return (
    profileName ||
    member.managedAgent?.name?.trim() ||
    member.fallbackName?.trim() ||
    "Company agent"
  );
}

function MemberAvatar({
  member,
  name,
  profile,
  className,
}: {
  member: TeamMember;
  name: string;
  profile: string | null;
  className: string;
}) {
  return member.kind === "employee" ? (
    <EmployeeAvatar
      className={className}
      instance={member.managedAgent?.avatarUrl}
      name={name}
      personaId={member.managedAgent?.personaId}
      profile={profile}
    />
  ) : (
    <ProfileAvatar avatarUrl={profile} className={className} label={name} />
  );
}

function LeadCard({
  functionId,
  slot,
  lead,
  leadName,
  leadAvatarUrl,
  managerName,
}: {
  functionId: FunctionId;
  slot: FunctionSlotView;
  lead: TeamMember | null;
  leadName: string | null;
  leadAvatarUrl: string | null;
  managerName: string | null;
}) {
  const detail = FUNCTION_DETAILS[functionId];
  if (slot.state === "covered_by_scout") {
    return (
      <section
        aria-labelledby="function-lead-title"
        className="team-card p-5 sm:p-6"
      >
        <p className="text-2xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground">
          Lead
        </p>
        <div className="mt-3 flex items-center gap-4">
          <EmployeeAvatar
            className="size-14 rounded-full ring-2 ring-primary"
            name="Scout"
          />
          <div>
            <h2 className="text-lg font-extrabold" id="function-lead-title">
              Scout covers {detail.name}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {functionId === "operations"
                ? "Scout covers Operations until the playbook phase."
                : "Scout is covering this function for now."}
            </p>
          </div>
        </div>
      </section>
    );
  }

  if (slot.state === "filled" && lead && leadName) {
    return (
      <section
        aria-labelledby="function-lead-title"
        className="team-card p-5 sm:p-6"
      >
        <p className="text-2xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground">
          Lead
        </p>
        <div className="mt-3 flex items-center gap-4">
          <MemberAvatar
            className="size-14 rounded-full"
            member={lead}
            name={leadName}
            profile={leadAvatarUrl}
          />
          <div className="min-w-0">
            <h2
              className="truncate text-lg font-extrabold"
              id="function-lead-title"
            >
              {leadName}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {lead.position?.head.title || `${detail.name} lead`}
              {managerName ? ` · reports to ${managerName}` : ""}
            </p>
          </div>
        </div>
        <span className="mt-4 inline-flex rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-700 dark:text-emerald-300">
          On the team
        </span>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="function-lead-title"
      className="team-card p-5 sm:p-6"
    >
      <p className="text-2xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground">
        Lead
      </p>
      <div className="mt-3 flex items-center gap-4">
        <span
          aria-hidden="true"
          className="grid size-14 shrink-0 place-items-center rounded-full border-2 border-dashed border-border text-muted-foreground"
        >
          <svg
            aria-hidden="true"
            fill="none"
            height="1.5rem"
            viewBox="0 0 24 24"
            width="1.5rem"
          >
            <path
              d="M12 5v14M5 12h14"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="1.8"
            />
          </svg>
        </span>
        <div>
          <h2 className="text-lg font-extrabold" id="function-lead-title">
            No lead for {detail.name} yet
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            This function is visible and ready for a lead.
          </p>
        </div>
      </div>
    </section>
  );
}

function SubFunctionsCard({
  functionId,
  slot,
  leadName,
}: {
  functionId: FunctionId;
  slot: FunctionSlotView;
  leadName: string | null;
}) {
  return (
    <section
      aria-labelledby="function-subfunctions-title"
      className="team-card p-5 sm:p-6"
    >
      <h2 className="text-base font-extrabold" id="function-subfunctions-title">
        Sub-functions
      </h2>
      <ul className="mt-3 divide-y divide-border">
        {FUNCTION_DETAILS[functionId].subFunctions.map((name) => {
          const scoutCoversFinanceItem =
            functionId === "finance" && ["Quotes", "Deposits"].includes(name);
          const status =
            slot.state === "covered_by_scout" || scoutCoversFinanceItem
              ? "Scout covers"
              : slot.state === "filled"
                ? `Led by ${leadName ?? "the assigned lead"}`
                : "Waits for a lead";
          return (
            <li
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0"
              key={name}
            >
              <span className="text-sm font-bold">{name}</span>
              <span className="text-sm text-muted-foreground">{status}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function EmptySlotSuggestion({ functionId }: { functionId: FunctionId }) {
  const detail = FUNCTION_DETAILS[functionId];
  if (functionId === "operations") return null;
  return (
    <section
      aria-labelledby="function-suggestion-title"
      className="team-card p-5 sm:p-6"
    >
      <p className="inline-flex rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
        Scout suggests
      </p>
      <p className="ml-2 inline text-sm text-muted-foreground">
        A suggested next role for this company
      </p>
      <div className="mt-4 flex items-center gap-3">
        <EmployeeAvatar className="size-11 rounded-xl" name="Scout" />
        <div>
          <h2
            className="text-base font-extrabold"
            id="function-suggestion-title"
          >
            Hire a {detail.suggestedHire}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            This lead owns {detail.name} and runs its workers.
          </p>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap gap-3">
        <Link
          className="team-hire-button"
          data-testid="cofounder-fill-slot"
          to="/hire/roles"
        >
          Fill this slot
        </Link>
        <Link
          className="inline-flex h-11 items-center rounded-xl border border-border px-4 text-sm font-bold hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          to="/company/map"
        >
          Not yet
        </Link>
      </div>
    </section>
  );
}

export function FunctionScreen({ functionId }: { functionId: FunctionId }) {
  const { activeCommunity } = useCommunities();
  const settingsQuery = useCofounderSettingsQuery(activeCommunity?.id ?? null);
  const slots = useFunctionSlotsQuery(activeCommunity?.id ?? null);
  const teamQuery = useCompanyTeamQuery(Boolean(activeCommunity));
  const slot = slots.find(
    (candidate) => candidate.functionId === functionId,
  ) ?? {
    functionId,
    state: "empty" as const,
    leadPubkey: null,
  };
  const members = teamQuery.data?.members ?? [];
  const lead =
    slot.leadPubkey === null
      ? null
      : (members.find(
          (member) =>
            member.pubkey.toLowerCase() === slot.leadPubkey?.toLowerCase(),
        ) ?? null);
  const manager =
    lead?.position?.head.managerPubkey === undefined
      ? null
      : (members.find(
          (member) =>
            member.pubkey.toLowerCase() ===
            lead.position?.head.managerPubkey?.toLowerCase(),
        ) ?? null);
  const scout = members.find(
    (member) =>
      (member.fallbackName ?? member.managedAgent?.name ?? "").toLowerCase() ===
      "scout",
  );
  // An unfilled slot is covered by Scout, so Scout's worker runs belong here.
  const parent = slot.state === "filled" ? lead : scout;
  const profilePubkeys = [lead?.pubkey, scout?.pubkey, manager?.pubkey].filter(
    (pubkey): pubkey is string => Boolean(pubkey),
  );
  const profilesQuery = useUsersBatchQuery(profilePubkeys);
  const profiles: ProfileLookup = profilesQuery.data?.profiles ?? {};
  const leadName = lead ? memberName(lead, profiles) : null;
  const managerName = manager ? memberName(manager, profiles) : null;
  const leadAvatarUrl = lead
    ? (profiles[lead.pubkey.toLowerCase()]?.avatarUrl ?? null)
    : null;
  const parentName =
    slot.state === "filled"
      ? (leadName ?? FUNCTION_DETAILS[functionId].name)
      : "Scout";
  const detail = FUNCTION_DETAILS[functionId];

  if (settingsQuery.isPending) {
    return (
      <TeamPage testId="cofounder-function-screen" title={detail.name}>
        <p
          aria-live="polite"
          className="text-sm text-muted-foreground"
          role="status"
        >
          Checking co-founder mode.
        </p>
      </TeamPage>
    );
  }

  if (settingsQuery.isError) {
    return (
      <TeamPage testId="cofounder-function-screen" title={detail.name}>
        <div className="space-y-3" role="alert">
          <TeamPageTitle>{detail.name}</TeamPageTitle>
          <p className="text-sm text-destructive">
            Co-founder mode could not be verified.
          </p>
          <button
            className="rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            onClick={() => void settingsQuery.refetch()}
            type="button"
          >
            Try again
          </button>
        </div>
      </TeamPage>
    );
  }

  if (!settingsQuery.data?.settings.enabled) {
    return (
      <TeamPage testId="cofounder-function-screen" title={detail.name}>
        <div className="space-y-3">
          <TeamPageTitle>{detail.name}</TeamPageTitle>
          <p className="text-sm text-muted-foreground">
            Co-founder mode is off for {activeCommunity?.name ?? "this company"}
            .
          </p>
          <Link
            className="inline-flex items-center rounded-xl border border-border px-4 py-2 text-sm font-bold hover:bg-muted"
            to="/settings"
          >
            Open settings
          </Link>
        </div>
      </TeamPage>
    );
  }

  if (functionId === "operations") {
    return <OperationsPlaybookScreen />;
  }

  return (
    <TeamPage testId="cofounder-function-screen" title={detail.name}>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="team-head-copy">
          <TeamPageTitle>{detail.name}</TeamPageTitle>
          <p className="team-subtitle">{FUNCTION_DESCRIPTIONS[functionId]}</p>
        </div>
        <Link
          className="inline-flex h-11 items-center rounded-xl border border-border px-4 text-sm font-bold hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          to="/company/map"
        >
          Company map
        </Link>
      </header>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(17rem,0.9fr)]">
        <div className="space-y-5">
          <LeadCard
            functionId={functionId}
            lead={lead}
            leadAvatarUrl={leadAvatarUrl}
            leadName={leadName}
            managerName={managerName}
            slot={slot}
          />
          {slot.state === "empty" ? (
            <EmptySlotSuggestion functionId={functionId} />
          ) : null}
          <WorkerList
            parentName={parentName}
            parentPubkey={parent?.pubkey ?? null}
          />
          {slot.state === "filled" ? (
            <section
              aria-labelledby="function-scorecard-title"
              className="team-card p-5 sm:p-6"
            >
              <h2
                className="text-base font-extrabold"
                id="function-scorecard-title"
              >
                Scorecard
              </h2>
              <p className="mt-3 text-sm text-muted-foreground">
                Scorecard details will appear here when this function has
                tracked results.
              </p>
            </section>
          ) : null}
        </div>
        <div className="space-y-5">
          {slot.state === "empty" ? (
            <section
              aria-labelledby="function-filled-title"
              className="team-card p-5 sm:p-6"
            >
              <h2
                className="text-base font-extrabold"
                id="function-filled-title"
              >
                Once the slot is filled
              </h2>
              <ul className="mt-3 space-y-3 text-sm text-muted-foreground">
                <li>The lead owns this function and runs its own workers.</li>
                <li>Scorecards and approved goals live here.</li>
                <li>Anything sent or spent still waits for your OK.</li>
              </ul>
            </section>
          ) : null}
          <SubFunctionsCard
            functionId={functionId}
            leadName={leadName}
            slot={slot}
          />
        </div>
      </div>
    </TeamPage>
  );
}
