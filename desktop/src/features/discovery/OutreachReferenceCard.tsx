import * as React from "react";
import { Compass, List, MessageCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { useCommunities } from "@/features/communities/useCommunities";
import { useTenantCommunityId } from "@/features/communities/useTenantCommunityId";
import { getRelaySelf } from "@/features/moderation/lib/relaySelf";
import { useBusinessChannelId } from "@/features/leads/useLeadHead";
import {
  KIND_DISCOVERY_CAMPAIGN_HEAD,
  KIND_OUTREACH_LIST_HEAD,
  latestByDTag,
} from "@/features/discovery/businessRecordContract";
import {
  discoveryCampaignDTag,
  parseDiscoveryCampaignHead,
  parseOutreachListHead,
  outreachListDTag,
} from "@/features/discovery/outreachRecords";
import { useDiscoveryCampaign } from "@/features/discovery/discoveryProvider";
import {
  useWhatsAppStatusQuery,
  useWhatsAppTemplatesQuery,
} from "@/features/whatsapp-outreach/whatsappOutreachQueries";
import { relayClient } from "@/shared/api/relayClient";
import type { ParsedEntityLink } from "@/shared/lib/entityLink";
import { errorMessage } from "./BusinessCommon";

import "./colony3-outreach-reference.css";

type SharedReference = {
  title: string;
  description: string;
};

function useSharedReference(
  link: Extract<ParsedEntityLink, { type: "list" | "campaign" }> | null,
) {
  const { activeCommunity } = useCommunities();
  const relayUrl = activeCommunity?.relayUrl ?? null;
  const tenant = useTenantCommunityId(relayUrl);
  const channel = useBusinessChannelId();
  const query = useQuery({
    queryKey: [
      "outreach-reference",
      link?.type ?? "unavailable",
      relayUrl ?? "unavailable",
      tenant.tenantId ?? "unavailable",
      link?.id ?? "unavailable",
    ],
    enabled: Boolean(link && relayUrl && tenant.tenantId && channel.data),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<SharedReference | null> => {
      if (!link || !tenant.tenantId || !channel.data) return null;
      const tenantId = tenant.tenantId;
      const channelId = channel.data;
      const relaySelf = await getRelaySelf();
      if (!relaySelf) {
        throw new Error("This relay does not advertise a signing identity.");
      }
      const isList = link.type === "list";
      const events = await relayClient.fetchEvents({
        kinds: [
          isList ? KIND_OUTREACH_LIST_HEAD : KIND_DISCOVERY_CAMPAIGN_HEAD,
        ],
        authors: [relaySelf],
        "#h": [channelId],
        "#d": [
          isList
            ? outreachListDTag(tenantId, link.id)
            : discoveryCampaignDTag(tenantId, link.id),
        ],
        limit: 5,
      });
      if (isList) {
        const row = latestByDTag(
          events,
          (event) =>
            parseOutreachListHead(event, tenantId, channelId)?.record ?? null,
        )[0];
        if (row?.record.status !== "active") return null;
        return {
          title: row.record.name,
          description: `${row.record.members.length} ${row.record.members.length === 1 ? "lead" : "leads"}`,
        };
      }
      const row = latestByDTag(
        events,
        (event) =>
          parseDiscoveryCampaignHead(event, tenantId, channelId)?.record ??
          null,
      )[0];
      if (!row || row.record.archived) return null;
      return {
        title: row.record.name,
        description: `${row.record.found} found · ${row.record.status}`,
      };
    },
  });
  return {
    ...query,
    setupPending: tenant.pending || channel.isPending,
    setupError: tenant.error ?? channel.error ?? null,
    retry: async () => {
      await tenant.retry();
      await channel.refetch();
      await query.refetch();
    },
  };
}

function OutreachReferenceFrame({
  children,
  state,
}: {
  children: React.ReactNode;
  state: "loading" | "ready" | "missing" | "error";
}) {
  return (
    <span className="c3o-reference" data-state={state}>
      {children}
    </span>
  );
}

export function OutreachReferenceCard({
  link,
  interactive = true,
}: {
  link: Extract<ParsedEntityLink, { type: "list" | "campaign" | "template" }>;
  interactive?: boolean;
}) {
  const navigate = useNavigate();
  const { provider } = useDiscoveryCampaign();
  const statusQuery = useWhatsAppStatusQuery(link.type === "template");
  const templatesQuery = useWhatsAppTemplatesQuery(
    link.type === "template" && statusQuery.data?.connected === true,
  );
  const sharedQuery = useSharedReference(
    link.type === "list" || link.type === "campaign" ? link : null,
  );
  const [actionError, setActionError] = React.useState("");

  let reference: SharedReference | null = null;
  let loading = false;
  let referenceError: unknown = null;
  let missing = false;
  if (link.type === "template") {
    const templates = [
      ...(templatesQuery.data ?? []),
      ...(statusQuery.data?.templates ?? []),
    ];
    const matchesTemplate = (candidate: { name: string; language: string }) =>
      candidate.name === link.name &&
      (link.language === undefined || candidate.language === link.language);
    const template =
      templates.find(matchesTemplate) ??
      templates.find((candidate) => candidate.name === link.name);
    reference = template
      ? {
          title: template.title,
          description: `${template.language} · ${template.category.toLocaleLowerCase()}`,
        }
      : statusQuery.data?.connected
        ? null
        : { title: link.name, description: "WhatsApp template" };
    loading =
      statusQuery.isPending ||
      (statusQuery.data?.connected === true && templatesQuery.isPending);
    referenceError = templatesQuery.error ?? statusQuery.error;
    missing =
      !reference &&
      !loading &&
      !referenceError &&
      statusQuery.data?.connected === true &&
      templatesQuery.isSuccess;
  } else {
    reference = sharedQuery.data ?? null;
    loading = sharedQuery.setupPending || sharedQuery.isPending;
    referenceError = sharedQuery.setupError ?? sharedQuery.error;
    missing =
      !loading && !referenceError && sharedQuery.isSuccess && !reference;
  }

  if (loading) {
    return (
      <OutreachReferenceFrame state="loading">
        <span aria-hidden="true" className="c3o-mark">
          …
        </span>
        <span className="c3o-copy">
          <strong>Loading reference</strong>
        </span>
      </OutreachReferenceFrame>
    );
  }
  if (referenceError) {
    return (
      <OutreachReferenceFrame state="error">
        <span aria-hidden="true" className="c3o-mark">
          ?
        </span>
        <span className="c3o-copy">
          <strong>Reference unavailable</strong>
        </span>
        {interactive ? (
          <button
            className="c3o-retry"
            onClick={() => {
              if (link.type === "template") {
                void statusQuery.refetch().then(() => templatesQuery.refetch());
              } else {
                void sharedQuery.retry();
              }
            }}
            type="button"
          >
            Try again
          </button>
        ) : null}
      </OutreachReferenceFrame>
    );
  }
  if (!reference || missing) {
    return (
      <OutreachReferenceFrame state="missing">
        <span aria-hidden="true" className="c3o-mark">
          ?
        </span>
        <span className="c3o-copy">
          <strong>
            {link.type === "template"
              ? "This template is no longer available"
              : `This ${link.type} is no longer available`}
          </strong>
        </span>
      </OutreachReferenceFrame>
    );
  }

  const body = (
    <>
      <span aria-hidden="true" className="c3o-mark">
        {link.type === "list" ? (
          <List size={15} strokeWidth={2.2} />
        ) : link.type === "campaign" ? (
          <Compass size={15} strokeWidth={2.2} />
        ) : (
          <MessageCircle size={15} strokeWidth={2.2} />
        )}
      </span>
      <span className="c3o-copy">
        <strong>{reference.title}</strong>
        <small>{reference.description}</small>
      </span>
      {actionError ? (
        <span className="c3o-action-error">{actionError}</span>
      ) : null}
    </>
  );

  if (!interactive || link.type === "template") {
    return (
      <OutreachReferenceFrame state="ready">{body}</OutreachReferenceFrame>
    );
  }
  if (link.type === "list") {
    return (
      <button
        aria-label={`Open outreach list: ${reference.title}`}
        className="c3o-reference c3o-reference-button"
        onClick={() =>
          void navigate({ to: "/lists/$listId", params: { listId: link.id } })
        }
        type="button"
      >
        {body}
      </button>
    );
  }

  const localCampaign = provider
    ?.getCampaigns()
    .some(({ id }) => id === link.id);
  return (
    <button
      aria-label={`${localCampaign ? "Open" : "Shared"} Discovery campaign: ${reference.title}`}
      className="c3o-reference c3o-reference-button"
      disabled={!localCampaign}
      onClick={() => {
        if (!provider || !localCampaign) return;
        setActionError("");
        void provider
          .select(link.id)
          .then(() => navigate({ to: "/campaign" }))
          .catch((error: unknown) => setActionError(errorMessage(error)));
      }}
      type="button"
    >
      {body}
    </button>
  );
}
