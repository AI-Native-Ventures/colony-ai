import * as React from "react";
import type { Editor } from "@tiptap/react";
import {
  Compass,
  Link2,
  List,
  MessageCircle,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";

import { OtherSetupAgentMarker } from "@/features/agents/ui/OtherSetupAgentMarker";
import {
  showMentionAgentProvenanceMarker,
  type MentionSuggestion,
} from "./MentionAutocomplete";
import { COMPOSER_MESSAGE_LINK_NODE_NAME } from "@/features/messages/lib/composerMessageLinkNode";
import {
  leadReferenceContent,
  summarizeLead,
} from "@/features/leads/leadReferenceModel";
import { useBusinessRecords } from "@/features/discovery/useBusinessRecords";
import type { OutreachListHead } from "@/features/discovery/businessRecordContract";
import type { DiscoveryCampaignHead } from "@/features/discovery/businessRecordContract";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import {
  buildDiscoveryCampaignLink,
  buildLeadLink,
  buildOutreachListLink,
  buildWhatsAppTemplateLink,
} from "@/shared/lib/entityLink";
import { normalizePubkey } from "@/shared/lib/pubkey";
import {
  useWhatsAppStatusQuery,
  useWhatsAppTemplatesQuery,
} from "@/features/whatsapp-outreach/whatsappOutreachQueries";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/ui/popover";

import "@/features/leads/colony3-lead-reference.css";

type EntityChoice = {
  key: string;
  title: string;
  detail?: string;
  searchText?: string;
  href: string;
  icon: LucideIcon;
  testId?: string;
};

function matching<
  T extends { title: string; detail?: string; searchText?: string },
>(choices: readonly T[], query: string): T[] {
  const needle = query.trim().toLocaleLowerCase();
  return needle
    ? choices.filter((item) =>
        `${item.title} ${item.detail ?? ""} ${item.searchText ?? ""}`
          .toLocaleLowerCase()
          .includes(needle),
      )
    : [...choices];
}

function EntityGroup({
  title,
  choices,
  onSelect,
  onKeyDown,
}: {
  title: string;
  choices: EntityChoice[];
  onSelect: (choice: EntityChoice) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
}) {
  if (choices.length === 0) return null;
  return (
    <section aria-label={title} className="c3r-mention-group">
      <h3 className="c3r-mention-group-title">{title}</h3>
      <ul className="c3r-picker-list">
        {choices.map((choice) => (
          <li key={choice.key}>
            <button
              className="c3r-picker-item"
              data-testid={choice.testId}
              onClick={() => onSelect(choice)}
              onKeyDown={onKeyDown}
              type="button"
            >
              <span aria-hidden="true" className="c3r-mark">
                <choice.icon size={15} strokeWidth={2.2} />
              </span>
              <span className="c3r-copy">
                <span className="c3r-name" title={choice.title}>
                  {choice.title}
                </span>
                {choice.detail ? (
                  <span className="c3r-meta">{choice.detail}</span>
                ) : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function MentionIdentityGroup({
  title,
  choices,
  onSelect,
  onKeyDown,
}: {
  title: string;
  choices: Array<{
    key: string;
    title: string;
    detail: string;
    person: MentionSuggestion;
    testId: string;
    showAgentProvenanceMarker: boolean;
  }>;
  onSelect: (person: MentionSuggestion) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
}) {
  if (choices.length === 0) return null;
  return (
    <section aria-label={title} className="c3r-mention-group">
      <h3 className="c3r-mention-group-title">{title}</h3>
      <ul className="c3r-picker-list">
        {choices.map(
          ({
            key,
            title: label,
            detail,
            person,
            testId,
            showAgentProvenanceMarker,
          }) => (
            <li data-testid={testId} key={key}>
              <button
                aria-label={`Mention ${label}`}
                className="c3r-picker-item"
                onClick={() => onSelect(person)}
                onKeyDown={onKeyDown}
                type="button"
              >
                <span aria-hidden="true" className="c3r-mention-avatar">
                  <ProfileAvatar
                    avatarUrl={person.avatarUrl ?? null}
                    className="h-full w-full"
                    label={label}
                    pubkey={person.pubkey}
                    shape={
                      person.isAgent || person.kind === "persona"
                        ? "squircle"
                        : "circle"
                    }
                    testId="mention-suggestion-avatar"
                  />
                </span>
                <span className="c3r-copy">
                  <span className="c3r-mention-name-row">
                    <span className="c3r-name">{label}</span>
                    {person.isAgent ? (
                      <span
                        className="c3r-mention-agent-pill"
                        data-testid="mention-agent-icon"
                      >
                        agent
                      </span>
                    ) : null}
                    {showAgentProvenanceMarker ? (
                      <OtherSetupAgentMarker testId="mention-agent-provenance" />
                    ) : null}
                  </span>
                  <span className="c3r-meta">{detail}</span>
                </span>
              </button>
            </li>
          ),
        )}
      </ul>
    </section>
  );
}

function OutreachMentionPickerContent({
  initialQuery,
  currentPubkey,
  peopleAndAgents,
  onSelectEntity,
  onSelectPerson,
}: {
  initialQuery: string;
  currentPubkey: string | null;
  peopleAndAgents: MentionSuggestion[];
  onSelectEntity: (choice: EntityChoice) => void;
  onSelectPerson: (
    person: MentionSuggestion,
    options?: { focus?: boolean; replaceInlineQuery?: boolean },
  ) => void;
}) {
  const business = useBusinessRecords({ createIfMissing: false });
  const statusQuery = useWhatsAppStatusQuery(true);
  const templatesQuery = useWhatsAppTemplatesQuery(
    statusQuery.data?.connected === true,
  );
  const personPubkeys = React.useMemo(
    () =>
      peopleAndAgents
        .filter((item) => !item.isAgent && item.kind !== "team")
        .flatMap((item) => (item.pubkey ? [item.pubkey] : [])),
    [peopleAndAgents],
  );
  const personProfilesQuery = useUsersBatchQuery(personPubkeys);
  const [query, setQuery] = React.useState(initialQuery);
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const records = business.records;
  const currentPubkeyNormalized = currentPubkey
    ? normalizePubkey(currentPubkey)
    : null;
  const agentNameCounts = new Map<string, number>();
  for (const person of peopleAndAgents) {
    if (!person.isAgent) continue;
    const name = (person.baseDisplayName ?? person.displayName)
      .trim()
      .toLocaleLowerCase();
    agentNameCounts.set(name, (agentNameCounts.get(name) ?? 0) + 1);
  }
  const identities = peopleAndAgents
    .filter(
      (item) =>
        item.isAgent ||
        item.kind === "team" ||
        !item.pubkey ||
        !currentPubkeyNormalized ||
        normalizePubkey(item.pubkey) !== currentPubkeyNormalized,
    )
    .map((item) => {
      const suggestionKey =
        item.pubkey ??
        (item.personaId ? `persona-${item.personaId}` : null) ??
        (item.teamId ? `team-${item.teamId}` : null) ??
        item.displayName;
      const showAgentProvenanceMarker = showMentionAgentProvenanceMarker(item);
      const agentName = (item.baseDisplayName ?? item.displayName)
        .trim()
        .toLocaleLowerCase();
      const hasAgentNameCollision =
        item.isAgent && (agentNameCounts.get(agentName) ?? 0) > 1;
      const detailParts: string[] = [];

      if (item.kind === "team") {
        detailParts.push(`Team · ${item.teamMembers?.length ?? 0} agents`);
      } else if (item.isAgent) {
        detailParts.push("AI employee");
        if (item.jobTitle) detailParts.push(item.jobTitle);
        if (!item.identityLabel && item.ownerLabel) {
          detailParts.push(`managed by ${item.ownerLabel}`);
        }
        if (hasAgentNameCollision && showAgentProvenanceMarker) {
          detailParts.push("Not on this Mac");
        }
        if (item.notInChannel) detailParts.push("not in channel");
      } else {
        detailParts.push(
          item.jobTitle ??
            (item.pubkey
              ? personProfilesQuery.data?.profiles[normalizePubkey(item.pubkey)]
                  ?.jobTitle
              : null) ??
            item.ownerLabel ??
            "Person",
        );
        if (item.notInChannel) detailParts.push("not in channel");
      }

      return {
        key: suggestionKey,
        title: item.displayName,
        detail: detailParts.join(" · "),
        person: item,
        testId: `mention-suggestion-${suggestionKey}`,
        showAgentProvenanceMarker,
      };
    });
  const lists: EntityChoice[] = [...(records?.outreachLists ?? [])]
    .filter(({ record }) => record.status === "active")
    .sort((left, right) => right.record.updatedAt - left.record.updatedAt)
    .map(({ record }: { record: OutreachListHead }) => ({
      key: `list:${record.listId}`,
      title: record.name,
      detail: `${record.members.length} ${record.members.length === 1 ? "lead" : "leads"}`,
      href: buildOutreachListLink(record.listId),
      icon: List,
      testId: `outreach-mention-list-${record.listId}`,
    }));
  const campaigns: EntityChoice[] = (records?.discoveryCampaigns ?? [])
    .filter(({ record }) => !record.archived)
    .map(({ record }: { record: DiscoveryCampaignHead }) => ({
      key: `campaign:${record.campaignId}`,
      title: record.name,
      detail: `Discovery · ${record.found} found`,
      href: buildDiscoveryCampaignLink(record.campaignId),
      icon: Compass,
      testId: `outreach-mention-campaign-${record.campaignId}`,
    }));
  const templates: EntityChoice[] = (
    templatesQuery.data ??
    statusQuery.data?.templates ??
    []
  )
    .filter((item) => item.status.toLocaleUpperCase() === "APPROVED")
    .map((item) => {
      const category = item.category.toLocaleLowerCase();
      const categoryLabel = `${category.slice(0, 1).toLocaleUpperCase()}${category.slice(1)}`;
      return {
        key: `template:${item.name}:${item.language}`,
        title: item.title,
        detail: `${categoryLabel} · ${item.status.toLocaleLowerCase()}`,
        href: buildWhatsAppTemplateLink(item.name, item.language),
        icon: MessageCircle,
        testId: `outreach-mention-template-${item.name}-${item.language}`,
      };
    });
  const leads = (records?.prospects ?? [])
    .flatMap(({ record }) => {
      const summary = summarizeLead(record);
      return summary ? [summary] : [];
    })
    .map((lead) => ({
      key: `lead:${lead.leadId}`,
      title: lead.name,
      detail: `Lead · ${lead.stageLabel}`,
      searchText: lead.meta,
      href: buildLeadLink(lead.leadId),
      icon: UserRound,
      testId: `lead-reference-option-${lead.leadId}`,
      lead,
    }));

  const visibleIdentities = matching(identities, query);
  const visibleLists = matching(lists, query);
  const visibleCampaigns = matching(campaigns, query);
  const visibleTemplates = matching(templates, query);
  const visibleLeads = matching(leads, query);
  const hasChoices = Boolean(
    visibleIdentities.length ||
      visibleLists.length ||
      visibleCampaigns.length ||
      visibleTemplates.length ||
      visibleLeads.length,
  );

  React.useEffect(() => setQuery(initialQuery), [initialQuery]);
  React.useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  function handlePickerKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    const picker = event.currentTarget.closest<HTMLElement>(
      ".c3r-mention-picker",
    );
    if (!picker) return;
    if (
      event.key === "Enter" &&
      event.target instanceof HTMLInputElement &&
      !event.nativeEvent.isComposing
    ) {
      const first = picker.querySelector<HTMLButtonElement>(
        "button.c3r-picker-item",
      );
      if (first) {
        event.preventDefault();
        first.click();
      }
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = Array.from(
      picker.querySelectorAll<HTMLButtonElement>("button.c3r-picker-item"),
    );
    if (items.length === 0) return;
    const activeIndex = items.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    const nextIndex =
      event.key === "ArrowDown"
        ? activeIndex < 0 || activeIndex === items.length - 1
          ? 0
          : activeIndex + 1
        : activeIndex <= 0
          ? items.length - 1
          : activeIndex - 1;
    event.preventDefault();
    items[nextIndex]?.focus();
  }

  function selectPerson(person: MentionSuggestion) {
    onSelectPerson(person);
  }

  return (
    <div className="c3r-picker c3r-mention-picker">
      <label
        className="c3r-mention-search-wrap"
        data-query-empty={query.length === 0 ? "true" : "false"}
      >
        <Users aria-hidden="true" size={15} />
        <input
          aria-label="Search mentions and references"
          autoComplete="off"
          className="c3r-picker-search"
          data-testid="lead-reference-search"
          onKeyDown={handlePickerKeyDown}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Find people, lists, campaigns, templates or leads"
          ref={searchInputRef}
          value={query}
        />
      </label>
      {business.recordsLoading ? (
        <p className="c3r-note" role="status">
          Loading shared references
        </p>
      ) : business.recordsError ? (
        <p className="c3r-picker-empty" role="alert">
          Shared references could not be loaded. Close and open the picker to
          retry.
        </p>
      ) : null}
      {!statusQuery.data?.connected && statusQuery.isSuccess ? (
        <p className="c3r-note">
          Connect WhatsApp to browse approved templates.
        </p>
      ) : null}
      {statusQuery.data?.connected && templatesQuery.isError ? (
        <p className="c3r-picker-empty" role="alert">
          Approved templates could not be loaded.
        </p>
      ) : null}
      {hasChoices ? (
        <div className="c3r-mention-groups">
          <MentionIdentityGroup
            title="People and agents"
            choices={visibleIdentities}
            onKeyDown={handlePickerKeyDown}
            onSelect={selectPerson}
          />
          <EntityGroup
            title="Lists"
            choices={visibleLists}
            onKeyDown={handlePickerKeyDown}
            onSelect={onSelectEntity}
          />
          <EntityGroup
            title="Campaigns"
            choices={visibleCampaigns}
            onKeyDown={handlePickerKeyDown}
            onSelect={onSelectEntity}
          />
          {visibleTemplates.length ? (
            <EntityGroup
              title="Templates"
              choices={visibleTemplates}
              onKeyDown={handlePickerKeyDown}
              onSelect={onSelectEntity}
            />
          ) : null}
          <EntityGroup
            title="Leads"
            choices={visibleLeads}
            onKeyDown={handlePickerKeyDown}
            onSelect={onSelectEntity}
          />
        </div>
      ) : !business.recordsLoading && !business.recordsError ? (
        <div className="c3r-picker-empty" data-testid="lead-reference-empty">
          <span>
            {records?.prospects.length
              ? `No mentions or references match “${query.trim()}”.`
              : "No leads yet. Find prospects in Discovery first."}
          </span>
        </div>
      ) : null}
      <div className="c3r-picker-footer">
        <span>Arrows to move</span>
        <span>
          <kbd>Enter</kbd> to pick
        </span>
        <span>
          <kbd>Esc</kbd> to close
        </span>
      </div>
    </div>
  );
}

export function OutreachMentionComposerButton({
  editor,
  getCursor,
  mentionQuery,
  mentionStartIndex,
  currentPubkey,
  onReleasePeople,
  onOpenChange,
  onPreparePeople,
  onSelectPerson,
  peopleAndAgents,
  replacePlainTextRange,
}: {
  editor: Editor | null;
  getCursor: () => number;
  mentionQuery: string | null;
  mentionStartIndex: number;
  currentPubkey: string | null;
  onReleasePeople: () => void;
  onOpenChange: (open: boolean) => void;
  onPreparePeople: () => void;
  onSelectPerson: (
    person: MentionSuggestion,
    options?: { focus?: boolean; replaceInlineQuery?: boolean },
  ) => void;
  peopleAndAgents: MentionSuggestion[];
  replacePlainTextRange: (
    fromOffset: number,
    toOffset: number,
    text: string,
  ) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const openRef = React.useRef(false);
  const openGenerationRef = React.useRef(0);
  const pendingCloseGenerationsRef = React.useRef<number[]>([]);
  const suppressStaleComposerFocusRef = React.useRef(false);
  const staleComposerFocusPreventedRef = React.useRef(false);

  const setPickerOpen = React.useCallback(
    (nextOpen: boolean) => {
      const wasOpen = openRef.current;
      if (nextOpen && !wasOpen) {
        openGenerationRef.current += 1;
        onPreparePeople();
      }
      if (!nextOpen && wasOpen) {
        pendingCloseGenerationsRef.current.push(openGenerationRef.current);
        onReleasePeople();
      }
      openRef.current = nextOpen;
      setOpen(nextOpen);
      onOpenChange(nextOpen);
    },
    [onOpenChange, onPreparePeople, onReleasePeople],
  );

  function insertReference(choice: EntityChoice) {
    if (!editor || editor.isDestroyed) return;
    suppressStaleComposerFocusRef.current = true;
    if (mentionQuery !== null) {
      replacePlainTextRange(mentionStartIndex, getCursor(), "");
    }
    const caret = editor.state.selection.from;
    const textBeforeCaret = editor.state.doc.textBetween(
      Math.max(0, caret - 1),
      caret,
      "\n",
      "￼",
    );
    const insertsLeadingSpace =
      textBeforeCaret.length > 0 && !/\s$/.test(textBeforeCaret);
    const insertedContentSize =
      (insertsLeadingSpace ? 1 : 0) +
      1 + // composer message links are inline atom nodes
      1; // keep the caret after the trailing separator
    editor
      .chain()
      .focus()
      .insertContent(
        leadReferenceContent({
          textBeforeCaret,
          chipNodeName: COMPOSER_MESSAGE_LINK_NODE_NAME,
          attrs: { channelName: choice.title, href: choice.href },
        }),
      )
      .setTextSelection(caret + insertedContentSize)
      .run();
    setPickerOpen(false);
  }

  function choosePerson(person: MentionSuggestion) {
    suppressStaleComposerFocusRef.current = true;
    onSelectPerson(person, {
      focus: false,
      replaceInlineQuery: mentionQuery !== null,
    });
    setPickerOpen(false);
  }

  const virtualAnchor = React.useMemo(
    () => ({
      current: {
        getBoundingClientRect: () => {
          const composer = editor?.view.dom.closest<HTMLElement>(
            '[data-testid="message-composer"]',
          );
          return (
            composer?.getBoundingClientRect() ??
            editor?.view.dom.getBoundingClientRect() ??
            new DOMRect()
          );
        },
      },
    }),
    [editor],
  );

  return (
    <Popover onOpenChange={setPickerOpen} open={open}>
      <PopoverTrigger asChild>
        <button
          aria-label="Mention a person, agent or shared reference"
          className="c3r-composer-button"
          data-testid="reference-lead-button"
          type="button"
        >
          <Link2 aria-hidden="true" size={12} strokeWidth={2.4} />
          Reference
        </button>
      </PopoverTrigger>
      <PopoverAnchor virtualRef={virtualAnchor} />
      <PopoverContent
        align="start"
        aria-label="Mention or reference"
        data-testid="lead-reference-picker"
        side="top"
        sideOffset={8}
        collisionPadding={12}
        className="c3r-mention-popover"
        style={{ width: "min(28.75rem, calc(100vw - 1.5rem))" }}
        onFocusOutside={(event) => {
          const target = event.target;
          if (
            suppressStaleComposerFocusRef.current &&
            target instanceof HTMLElement &&
            target.matches('[data-testid="message-input"]')
          ) {
            event.preventDefault();
            staleComposerFocusPreventedRef.current = true;
          }
        }}
        onInteractOutside={(event) => {
          if (staleComposerFocusPreventedRef.current) {
            event.preventDefault();
            staleComposerFocusPreventedRef.current = false;
            suppressStaleComposerFocusRef.current = false;
          }
        }}
        onKeyDownCapture={(event) => {
          if (event.key === "Tab") {
            suppressStaleComposerFocusRef.current = false;
            staleComposerFocusPreventedRef.current = false;
          }
        }}
        onPointerDownOutside={() => {
          suppressStaleComposerFocusRef.current = false;
          staleComposerFocusPreventedRef.current = false;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const closingGeneration =
            pendingCloseGenerationsRef.current.shift() ?? null;
          requestAnimationFrame(() => {
            if (
              closingGeneration !== null &&
              closingGeneration === openGenerationRef.current &&
              !openRef.current &&
              editor &&
              !editor.isDestroyed
            ) {
              editor.commands.focus();
            }
          });
        }}
      >
        {open ? (
          <OutreachMentionPickerContent
            initialQuery={mentionQuery ?? ""}
            currentPubkey={currentPubkey}
            onSelectEntity={insertReference}
            onSelectPerson={choosePerson}
            peopleAndAgents={peopleAndAgents}
          />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
