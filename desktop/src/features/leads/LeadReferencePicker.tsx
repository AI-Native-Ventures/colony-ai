import { useQuery } from "@tanstack/react-query";
import * as React from "react";
import { Link } from "@tanstack/react-router";

import { useCommunities } from "@/features/communities/useCommunities";
import {
  KIND_PROSPECT_HEAD,
  latestByDTag,
  tryParseContent,
  type ProspectHead,
} from "@/features/discovery/businessRecordContract";
import { relayClient } from "@/shared/api/relayClient";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

import { LeadStagePill } from "./LeadReferenceCard";
import {
  filterLeads,
  leadInitial,
  summarizeLead,
  type LeadSummary,
} from "./leadReferenceModel";
import { useBusinessChannelId } from "./useLeadHead";

import "./colony3-lead-reference.css";

const LEAD_LIST_LIMIT = 500;

function sortLeads(leads: LeadSummary[]): LeadSummary[] {
  return [...leads].sort(
    (left, right) =>
      (right.fitScore ?? -1) - (left.fitScore ?? -1) ||
      left.name.localeCompare(right.name),
  );
}

/**
 * The leads a message can reference. One read of the prospect heads when the
 * picker opens, with no live subscription: a picker is a quick look, not a
 * screen that has to stay current.
 */
function useLeadChoices(open: boolean) {
  const { activeCommunity } = useCommunities();
  const relayUrl = activeCommunity?.relayUrl ?? null;
  const communityId = activeCommunity?.id ?? null;
  const channel = useBusinessChannelId(open);
  const channelId = channel.data ?? null;
  const list = useQuery({
    queryKey: [
      "lead-reference-list",
      relayUrl ?? "unavailable",
      communityId ?? "unavailable",
      channelId ?? "unavailable",
    ],
    enabled: open && Boolean(channelId),
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async (): Promise<LeadSummary[]> => {
      if (!channelId) return [];
      const events = await relayClient.fetchEvents({
        kinds: [KIND_PROSPECT_HEAD],
        "#h": [channelId],
        limit: LEAD_LIST_LIMIT,
      });
      const heads = latestByDTag<ProspectHead>(events, (event) =>
        tryParseContent<ProspectHead>(event),
      );
      return sortLeads(
        heads.flatMap(({ record }) => {
          const summary = summarizeLead(record);
          return summary ? [summary] : [];
        }),
      );
    },
  });
  const noBusinessChannel = channel.isSuccess && channelId === null;
  return {
    leads: noBusinessChannel ? [] : (list.data ?? []),
    isPending: !noBusinessChannel && (channel.isPending || list.isPending),
    isError: Boolean(channel.error || list.error),
    retry: () => {
      void channel.refetch().then(() => list.refetch());
    },
  };
}

export function LeadReferencePicker({
  open,
  onOpenChange,
  onCloseAutoFocus,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
  onSelect: (lead: LeadSummary) => void;
}) {
  const [search, setSearch] = React.useState("");
  const choices = useLeadChoices(open);
  const visible = React.useMemo(
    () => filterLeads(choices.leads, search),
    [choices.leads, search],
  );

  // A fresh search each time the picker opens.
  React.useEffect(() => {
    if (open) setSearch("");
  }, [open]);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="max-w-[34rem]"
        data-testid="lead-reference-picker"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>Reference a lead</DialogTitle>
          <DialogDescription>
            Add a lead to your message so people and agents can open it, read
            its notes and work on it.
          </DialogDescription>
        </DialogHeader>
        <div className="c3r-picker">
          <input
            aria-label="Search leads"
            autoComplete="off"
            className="c3r-picker-search"
            data-testid="lead-reference-search"
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder="Search leads…"
            value={search}
          />
          {choices.isPending ? (
            <p className="c3r-note" role="status">
              Loading leads
            </p>
          ) : choices.isError ? (
            <div className="c3r-picker-empty" role="alert">
              <span>Leads could not be loaded.</span>
              <button
                className="c3r-retry"
                onClick={choices.retry}
                type="button"
              >
                Try again
              </button>
            </div>
          ) : choices.leads.length === 0 ? (
            <div
              className="c3r-picker-empty"
              data-testid="lead-reference-empty"
            >
              <span>No leads yet. Find prospects in Discovery first.</span>
              <Link onClick={() => onOpenChange(false)} to="/discovery">
                Open Discovery
              </Link>
            </div>
          ) : visible.length === 0 ? (
            <div className="c3r-picker-empty">
              <span>No leads match “{search.trim()}”.</span>
            </div>
          ) : (
            <ul className="c3r-picker-list">
              {visible.map((lead) => (
                <li key={lead.leadId}>
                  <button
                    className="c3r-picker-item"
                    data-testid={`lead-reference-option-${lead.leadId}`}
                    onClick={() => onSelect(lead)}
                    type="button"
                  >
                    <span aria-hidden="true" className="c3r-mark">
                      {leadInitial(lead.name)}
                    </span>
                    <span className="c3r-copy">
                      <span className="c3r-name">{lead.name}</span>
                      {lead.meta ? (
                        <span className="c3r-meta">{lead.meta}</span>
                      ) : null}
                    </span>
                    <LeadStagePill
                      label={lead.stageLabel}
                      tone={lead.stageTone}
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
