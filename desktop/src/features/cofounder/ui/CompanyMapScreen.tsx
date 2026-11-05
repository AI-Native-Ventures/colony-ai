import type { CSSProperties } from "react";
import { Link } from "@tanstack/react-router";

import { useCompanyTeamQuery } from "@/features/company-team/teamRelay";
import type { TeamMember } from "@/features/company-team/teamModels";
import { EmployeeAvatar } from "@/features/company-team/ui/EmployeeAvatar";
import { TeamPage, TeamPageTitle } from "@/features/company-team/ui/TeamPage";
import { WorkspaceMark } from "@/features/communities/ui/WorkspaceMark";
import { useCommunities } from "@/features/communities/useCommunities";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";

import type {
  FunctionId,
  FunctionSlotView,
  SlotState,
} from "../cofounderRecords";
import { FUNCTION_DETAILS, FUNCTION_ORDER } from "../functions";
import { useCofounderSettingsQuery, useFunctionSlotsQuery } from "../hooks";
import "./CompanyMapScreen.css";

type ProfileLookup = Record<
  string,
  { displayName: string | null; avatarUrl?: string | null }
>;

type Point = { x: number; y: number };

type DiagramLayout = {
  width: number;
  height: number;
  hub: Point;
  hubHalf: number;
  scout: Point;
  scoutRadius: number;
  functionRadius: number;
  functions: Record<FunctionId, Point>;
};

type MapPositionStyle = CSSProperties &
  Record<
    | "--cf-company-map-desktop-x"
    | "--cf-company-map-desktop-y"
    | "--cf-company-map-mobile-x"
    | "--cf-company-map-mobile-y",
    string
  >;

const DESKTOP_LAYOUT: DiagramLayout = {
  width: 1120,
  height: 650,
  hub: { x: 560, y: 275 },
  hubHalf: 52,
  scout: { x: 560, y: 100 },
  scoutRadius: 46,
  functionRadius: 74,
  functions: {
    brand: { x: 218, y: 88 },
    sales: { x: 902, y: 86 },
    finance: { x: 187, y: 420 },
    operations: { x: 933, y: 420 },
    customer_success: { x: 560, y: 566 },
  },
};

const MOBILE_LAYOUT: DiagramLayout = {
  width: 390,
  height: 640,
  hub: { x: 195, y: 305 },
  hubHalf: 37,
  scout: { x: 195, y: 74 },
  scoutRadius: 32,
  functionRadius: 36,
  functions: {
    brand: { x: 66, y: 186 },
    sales: { x: 324, y: 186 },
    finance: { x: 66, y: 428 },
    operations: { x: 324, y: 428 },
    customer_success: { x: 195, y: 555 },
  },
};

function displayName(member: TeamMember, profiles: ProfileLookup): string {
  return (
    profiles[member.pubkey.toLowerCase()]?.displayName?.trim() ||
    member.managedAgent?.name?.trim() ||
    member.fallbackName?.trim() ||
    "Company agent"
  );
}

function agentStatusClass(member: TeamMember | null): string {
  if (
    member?.relayAgent?.status === "online" ||
    member?.managedAgent?.status === "running"
  ) {
    return "bg-emerald-500";
  }
  if (member?.relayAgent?.status === "away") return "bg-amber-500";
  return "bg-muted-foreground/50";
}

function percentage(value: number, total: number): string {
  return `${(value / total) * 100}%`;
}

function mapPositionStyle(
  desktopPoint: Point,
  mobilePoint: Point,
): MapPositionStyle {
  return {
    "--cf-company-map-desktop-x": percentage(
      desktopPoint.x,
      DESKTOP_LAYOUT.width,
    ),
    "--cf-company-map-desktop-y": percentage(
      desktopPoint.y,
      DESKTOP_LAYOUT.height,
    ),
    "--cf-company-map-mobile-x": percentage(mobilePoint.x, MOBILE_LAYOUT.width),
    "--cf-company-map-mobile-y": percentage(
      mobilePoint.y,
      MOBILE_LAYOUT.height,
    ),
  };
}

function roundedHubEdge(layout: DiagramLayout, target: Point): Point {
  const dx = target.x - layout.hub.x;
  const dy = target.y - layout.hub.y;
  const scale = layout.hubHalf / Math.max(Math.abs(dx), Math.abs(dy));
  return {
    x: layout.hub.x + dx * scale,
    y: layout.hub.y + dy * scale,
  };
}

function circleEdge(from: Point, target: Point, radius: number): Point {
  const dx = from.x - target.x;
  const dy = from.y - target.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return target;
  return {
    x: target.x + (dx / distance) * radius,
    y: target.y + (dy / distance) * radius,
  };
}

function connectorPath(
  layout: DiagramLayout,
  target: Point,
  targetRadius: number,
): string {
  const start = roundedHubEdge(layout, target);
  const end = circleEdge(layout.hub, target, targetRadius);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const horizontalDistance = Math.abs(dx);
  const verticalDistance = Math.abs(dy);

  if (horizontalDistance < 1) {
    const direction = Math.sign(dy) || 1;
    const bend = Math.max(18, Math.min(verticalDistance * 0.46, 72));
    return `M ${start.x} ${start.y} C ${start.x} ${start.y + direction * bend} ${end.x} ${end.y - direction * bend} ${end.x} ${end.y}`;
  }

  const direction = Math.sign(dx);
  const bend = Math.min(
    layout.width * 0.16,
    Math.max(42, horizontalDistance * 0.52),
  );
  return `M ${start.x} ${start.y} C ${start.x + direction * bend} ${start.y + dy * 0.04} ${end.x - direction * bend} ${end.y - dy * 0.1} ${end.x} ${end.y}`;
}

function MapConnectors({
  layout,
  slots,
  variant,
}: {
  layout: DiagramLayout;
  slots: Map<FunctionId, FunctionSlotView>;
  variant: "desktop" | "mobile";
}) {
  return (
    <svg
      aria-hidden="true"
      className={`cf-company-map-connectors cf-company-map-connectors--${variant}`}
      preserveAspectRatio="none"
      viewBox={`0 0 ${layout.width} ${layout.height}`}
    >
      <path
        className="cf-company-map-connector"
        d={connectorPath(layout, layout.scout, layout.scoutRadius)}
        data-map-connector
        data-map-target="scout"
        data-state="filled"
        data-testid="cofounder-map-connector-scout"
        fill="none"
      />
      {FUNCTION_ORDER.map((functionId) => {
        const slot = slots.get(functionId) ?? {
          functionId,
          state: "empty" as const,
          leadPubkey: null,
        };
        return (
          <path
            className="cf-company-map-connector"
            d={connectorPath(
              layout,
              layout.functions[functionId],
              layout.functionRadius,
            )}
            data-map-connector
            data-map-target={functionId}
            data-state={slot.state}
            data-testid={`cofounder-map-connector-${functionId}`}
            fill="none"
            key={functionId}
          />
        );
      })}
    </svg>
  );
}

function MapFunctionNode({
  slot,
  member,
  name,
  avatarUrl,
}: {
  slot: FunctionSlotView;
  member: TeamMember | null;
  name: string | null;
  avatarUrl: string | null;
}) {
  const detail = FUNCTION_DETAILS[slot.functionId];
  const filled = slot.state === "filled" && member !== null && name !== null;
  const covered = slot.state === "covered_by_scout";
  const visualState: SlotState = filled
    ? "filled"
    : covered
      ? "covered_by_scout"
      : "empty";
  const description =
    visualState === "covered_by_scout"
      ? `${detail.name}, covered by Scout`
      : visualState === "filled"
        ? `${detail.name}, led by ${name}`
        : `${detail.name}, empty slot`;
  const position = mapPositionStyle(
    DESKTOP_LAYOUT.functions[slot.functionId],
    MOBILE_LAYOUT.functions[slot.functionId],
  );

  return (
    <Link
      aria-label={description}
      className="cf-company-map-function"
      data-function={slot.functionId}
      data-state={visualState}
      data-testid={`cofounder-map-${slot.functionId}`}
      params={{ function: slot.functionId }}
      style={position}
      to="/company/function/$function"
    >
      <span
        className="cf-company-map-node-disc"
        data-map-circle={slot.functionId}
        data-state={visualState}
      >
        {visualState === "filled" && member && name ? (
          <>
            {member.kind === "employee" ? (
              <EmployeeAvatar
                className="size-full rounded-full"
                instance={member.managedAgent?.avatarUrl}
                name={name}
                personaId={member.managedAgent?.personaId}
                profile={avatarUrl}
                pubkey={member.pubkey}
              />
            ) : (
              <ProfileAvatar
                avatarUrl={avatarUrl}
                className="size-full rounded-full"
                label={name}
                pubkey={member.pubkey}
              />
            )}
            <span
              aria-hidden="true"
              className={`cf-company-map-presence ${agentStatusClass(member)}`}
            />
          </>
        ) : visualState === "covered_by_scout" ? (
          <>
            <EmployeeAvatar className="size-full rounded-full" name="Scout" />
            <span aria-hidden="true" className="cf-company-map-cover-ring" />
          </>
        ) : (
          <span aria-hidden="true" className="cf-company-map-plus">
            +
          </span>
        )}
      </span>
      <span className="cf-company-map-function-label">{detail.name}</span>
      {visualState === "covered_by_scout" ? (
        <span className="cf-company-map-function-caption">
          Covered by Scout
        </span>
      ) : null}
    </Link>
  );
}

export function CompanyMapScreen() {
  const { activeCommunity } = useCommunities();
  const settingsQuery = useCofounderSettingsQuery(activeCommunity?.id ?? null);
  const slots = useFunctionSlotsQuery(activeCommunity?.id ?? null);
  const teamQuery = useCompanyTeamQuery(Boolean(activeCommunity));
  const members = teamQuery.data?.members ?? [];
  const profilePubkeys = members.map((member) => member.pubkey);
  const profilesQuery = useUsersBatchQuery(profilePubkeys, {
    enabled: profilePubkeys.length > 0,
  });
  const profiles: ProfileLookup = profilesQuery.data?.profiles ?? {};
  const scout = members.find(
    (member) => displayName(member, profiles).toLowerCase() === "scout",
  );
  const companyName = activeCommunity?.name ?? "Company";

  if (settingsQuery.isLoading || teamQuery.isLoading) {
    return (
      <TeamPage testId="cofounder-company-map" title="Company map">
        <p aria-live="polite" className="text-sm text-muted-foreground">
          Loading the company map
        </p>
      </TeamPage>
    );
  }
  if (settingsQuery.isError || teamQuery.isError) {
    return (
      <TeamPage testId="cofounder-company-map" title="Company map">
        <div role="alert" className="space-y-3">
          <TeamPageTitle>Company map</TeamPageTitle>
          <p className="text-sm text-destructive">
            The company map could not load.
          </p>
          <button
            className="rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            onClick={() => {
              void settingsQuery.refetch();
              void teamQuery.refetch();
            }}
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
      <TeamPage testId="cofounder-company-map" title="Company map">
        <div className="space-y-3">
          <TeamPageTitle>Company map</TeamPageTitle>
          <p className="text-sm text-muted-foreground">
            Co-founder mode is off for {companyName}.
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

  const slotByFunction = new Map(slots.map((slot) => [slot.functionId, slot]));
  const hubPosition = mapPositionStyle(DESKTOP_LAYOUT.hub, MOBILE_LAYOUT.hub);
  const scoutPosition = mapPositionStyle(
    DESKTOP_LAYOUT.scout,
    MOBILE_LAYOUT.scout,
  );

  return (
    <TeamPage testId="cofounder-company-map" title="Company map">
      <header className="team-head-copy">
        <TeamPageTitle>Company map</TeamPageTitle>
        <p className="team-subtitle">How {companyName} is run.</p>
      </header>
      <section
        aria-label={`${companyName} company map`}
        className="cf-company-map-stage"
        data-testid="cofounder-map-stage"
      >
        <MapConnectors
          layout={DESKTOP_LAYOUT}
          slots={slotByFunction}
          variant="desktop"
        />
        <MapConnectors
          layout={MOBILE_LAYOUT}
          slots={slotByFunction}
          variant="mobile"
        />

        <figure
          aria-label="Scout, Chief of Staff"
          className="cf-company-map-scout"
          data-testid="cofounder-map-scout"
          style={scoutPosition}
        >
          <span className="cf-company-map-scout-avatar" data-map-circle="scout">
            <EmployeeAvatar
              className="size-full rounded-full"
              name="Scout"
              pubkey={scout?.pubkey}
            />
            <span
              aria-hidden="true"
              className={`cf-company-map-presence ${agentStatusClass(scout ?? null)}`}
            />
          </span>
          <figcaption
            className="cf-company-map-scout-label"
            data-testid="cofounder-map-scout-label"
          >
            <strong>Scout</strong>
            <span>Chief of Staff</span>
          </figcaption>
        </figure>

        <div className="cf-company-map-hub" style={hubPosition}>
          <WorkspaceMark
            className="cf-company-map-company-logo"
            communityIconFit="cover"
            communityId={activeCommunity?.id}
            dataTestId="cofounder-map-company-logo"
            fallbackContent={
              <span>{companyName.trim().slice(0, 1).toUpperCase() || "C"}</span>
            }
            imageClassName="cf-company-map-company-logo-image"
            imageFit="contain"
            name={companyName}
            relayUrl={activeCommunity?.relayUrl}
          />
          <span aria-hidden="true" className="cf-company-map-hub-dot" />
        </div>

        {FUNCTION_ORDER.map((functionId) => {
          const slot = slotByFunction.get(functionId) ?? {
            functionId,
            state: "empty" as const,
            leadPubkey: null,
          };
          const member =
            slot.state === "filled" && slot.leadPubkey
              ? (members.find(
                  (candidate) =>
                    candidate.pubkey.toLowerCase() ===
                    slot.leadPubkey?.toLowerCase(),
                ) ?? null)
              : null;
          const name = member ? displayName(member, profiles) : null;
          const avatarUrl = member
            ? (profiles[member.pubkey.toLowerCase()]?.avatarUrl ?? null)
            : null;
          return (
            <MapFunctionNode
              avatarUrl={avatarUrl}
              key={functionId}
              member={member}
              name={name}
              slot={slot}
            />
          );
        })}
      </section>
    </TeamPage>
  );
}
