import * as React from "react";
import { ChevronDown } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import {
  resolveIdentityLabel,
  type UserProfileLookup,
} from "@/features/profile/lib/identity";
import type {
  OutreachStatus,
  OutreachStatusRecord,
} from "./businessRecordContract";
import {
  formatOutreachStatusSetAt,
  OUTREACH_STATUS_OPTIONS,
  outreachStatusFootnote,
  outreachStatusFor,
  outreachStatusOption,
} from "./outreachStatus";

type OutreachStatusControlProps = {
  effectiveStatus?: OutreachStatus;
  outreach: OutreachStatusRecord | null | undefined;
  currentPubkey?: string | null;
  profiles?: UserProfileLookup;
  onStatusChange?: (status: OutreachStatus) => Promise<void>;
  disabled?: boolean;
  size?: "table" | "detail";
  testId?: string;
};

function setByLabel(input: {
  outreach: OutreachStatusRecord;
  currentPubkey?: string | null;
  profiles?: UserProfileLookup;
}) {
  return resolveIdentityLabel({
    pubkey: input.outreach.setBy,
    currentPubkey: input.currentPubkey,
    profiles: input.profiles,
    isAgent: input.outreach.setByAgent,
    fallbackName: input.outreach.setByAgent ? "Agent" : "A teammate",
  }).text;
}

/** Shared list-table and list-detail control for one persisted outreach state. */
export function OutreachStatusControl({
  effectiveStatus,
  outreach,
  currentPubkey,
  profiles,
  onStatusChange,
  disabled = false,
  size = "table",
  testId,
}: OutreachStatusControlProps) {
  const [pending, setPending] = React.useState(false);
  const status = effectiveStatus ?? outreachStatusFor(outreach);
  const option = outreachStatusOption(status);
  const by = outreach
    ? setByLabel({ outreach, currentPubkey, profiles })
    : null;
  const canChange = Boolean(onStatusChange);

  function chooseStatus(value: string) {
    const next = OUTREACH_STATUS_OPTIONS.find(
      (candidate) => candidate.value === value,
    );
    if (!next || !onStatusChange || pending) return;
    setPending(true);
    void onStatusChange(next.value).finally(() => setPending(false));
  }

  const badge = (
    <span
      className={`c3l-outreach-status-badge c3l-outreach-status-${status} c3l-outreach-status-${size} text-sm`}
      data-testid={canChange ? undefined : testId}
    >
      <span aria-hidden="true" className="c3l-outreach-status-dot" />
      <span>{option.label}</span>
      {canChange ? <ChevronDown aria-hidden="true" size={14} /> : null}
    </span>
  );

  if (!canChange) {
    return (
      <span className="c3l-outreach-status-readonly">
        {badge}
        {outreach && by ? (
          <span className="c3l-outreach-status-byline text-xs">
            {by}, {formatOutreachStatusSetAt(outreach.setAt)}
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label={`Outreach: ${option.label}. Change`}
            className="c3l-outreach-status-trigger"
            data-testid={testId}
            disabled={disabled || pending}
            type="button"
          >
            {badge}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          aria-label="Outreach status"
          className="c3l-outreach-status-menu"
          data-testid={testId ? `${testId}-menu` : undefined}
          sideOffset={8}
        >
          <DropdownMenuRadioGroup
            className="c3l-outreach-status-menu-options"
            onValueChange={chooseStatus}
            value={status}
          >
            {OUTREACH_STATUS_OPTIONS.map((candidate) => (
              <DropdownMenuRadioItem
                className="c3l-outreach-status-menu-item"
                disabled={disabled || pending}
                key={candidate.value}
                value={candidate.value}
              >
                <span className="c3l-outreach-status-menu-copy">
                  <span
                    aria-hidden="true"
                    className={`c3l-outreach-status-option-dot c3l-outreach-status-option-dot-${candidate.value}`}
                    data-testid={`outreach-status-option-dot-${candidate.value}`}
                  />
                  <span>
                    <strong>{candidate.label}</strong>
                    <small>{candidate.description}</small>
                  </span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          {outreach && by ? (
            <p className="c3l-outreach-status-footnote text-xs">
              {outreachStatusFootnote(outreach, by)}
            </p>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {outreach && by ? (
        <span className="c3l-outreach-status-byline text-xs">
          {by}, {formatOutreachStatusSetAt(outreach.setAt)}
        </span>
      ) : null}
    </>
  );
}
