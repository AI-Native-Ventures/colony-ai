import * as React from "react";

import {
  useUpdateManagedAgentMutation,
  useUpdatePersonaMutation,
} from "@/features/agents/hooks";
import { instructionSource } from "./agentPageModel";
import type {
  AgentPersona,
  ManagedAgent,
  UpdatePersonaInput,
} from "@/shared/api/types";

const BOOK_ICON = (
  <svg
    aria-hidden="true"
    fill="none"
    height="16"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="2"
    viewBox="0 0 24 24"
    width="16"
  >
    <path d="M4.5 5.5A1.5 1.5 0 0 1 6 4h5v15H6a1.5 1.5 0 0 0-1.5 1.5zM19.5 5.5A1.5 1.5 0 0 0 18 4h-5v15h5a1.5 1.5 0 0 1 1.5 1.5z" />
  </svg>
);

function personaUpdateInput(
  persona: AgentPersona,
  systemPrompt: string,
): UpdatePersonaInput {
  return {
    id: persona.id,
    displayName: persona.displayName,
    ...(persona.avatarUrl ? { avatarUrl: persona.avatarUrl } : {}),
    description: persona.description,
    systemPrompt,
    ...(persona.runtime !== null ? { runtime: persona.runtime } : {}),
    ...(persona.model !== null ? { model: persona.model } : {}),
    ...(persona.provider !== null ? { provider: persona.provider } : {}),
    namePool: persona.namePool,
    envVars: persona.envVars,
    behavior: {
      ...(persona.respondTo ? { respondTo: persona.respondTo } : {}),
      respondToAllowlist: persona.respondToAllowlist,
      ...(persona.parallelism !== null
        ? { parallelism: persona.parallelism }
        : {}),
      ...(persona.sessionPolicy
        ? { sessionPolicy: persona.sessionPolicy }
        : {}),
    },
  };
}

/** The instructions editor of the single agent page (`AgentInstructions.dc.html`). */
export function AgentPageInstructions({
  agent,
  canEdit,
  instruction,
  ownerName,
  persona,
}: {
  agent: ManagedAgent;
  canEdit: boolean;
  instruction: string | null;
  ownerName: string | null;
  persona: AgentPersona | undefined;
}) {
  const updateAgent = useUpdateManagedAgentMutation();
  const updatePersona = useUpdatePersonaMutation();
  const [draft, setDraft] = React.useState(instruction ?? "");
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const source = instructionSource(agent, persona);
  const editable = canEdit && source !== "locked";
  const isDirty = draft !== (instruction ?? "");
  const isPending = updateAgent.isPending || updatePersona.isPending;
  const content = instruction?.trim();
  const name = agent.name || "This agent";

  React.useEffect(() => {
    setDraft(instruction ?? "");
    setSaveError(null);
  }, [instruction]);

  async function save() {
    if (!isDirty || isPending) return;
    setSaveError(null);
    try {
      if (source === "definition" && persona) {
        await updatePersona.mutateAsync(personaUpdateInput(persona, draft));
      } else {
        await updateAgent.mutateAsync({
          pubkey: agent.pubkey,
          systemPrompt: draft,
        });
      }
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "Could not save instructions.",
      );
    }
  }

  const head = (
    <div className="agents-c3-form-head">
      <h2>System instructions</h2>
      <span>Version 1{ownerName ? ` · ${ownerName}` : ""}</span>
    </div>
  );

  if (!editable) {
    return (
      <section
        aria-label="Instructions"
        className="agents-c3-form"
        data-testid="agent-instructions"
        id="instructions"
      >
        {head}
        {content ? (
          <textarea
            aria-label="System instructions"
            className="agents-c3-textarea"
            data-testid="agent-system-instructions"
            readOnly
            spellCheck={false}
            value={instruction ?? ""}
          />
        ) : (
          <p className="agents-c3-lede">
            System instructions have not been shared by the owner.
          </p>
        )}
        {source === "locked" && content ? (
          <p className="agents-c3-lede">
            These instructions come from a built-in or team definition, so they
            can only be changed there.
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <form
      aria-label="Instructions"
      className="agents-c3-form"
      data-testid="agent-instructions"
      id="instructions"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {head}
      <p className="agents-c3-lede">
        {name} reads these instructions at the start of every conversation.
        Describe the job, how to work and when to ask a person.
      </p>
      <textarea
        aria-label="System instructions"
        className="agents-c3-textarea"
        data-testid="agent-system-instructions"
        onChange={(event) => setDraft(event.currentTarget.value)}
        rows={15}
        spellCheck={false}
        value={draft}
      />
      <div className="agents-c3-knowledge">
        {BOOK_ICON}
        <span>Business knowledge remains a separate, shared reference.</span>
        <button aria-disabled="true" disabled type="button">
          View brand guide
        </button>
      </div>
      {saveError ? (
        <p className="agents-c3-error" role="alert">
          {saveError}
        </p>
      ) : null}
      <div className="agents-c3-formfoot">
        {isDirty ? (
          <span className="agents-c3-unsaved">
            Unsaved changes · applies on the next start
          </span>
        ) : (
          <span className="agents-c3-saved">
            Changes apply after Save and the next start.
          </span>
        )}
        <span className="agents-c3-grow" />
        <button
          className="agents-c3-btn"
          data-size="md"
          onClick={() => {
            setDraft(instruction ?? "");
            setSaveError(null);
          }}
          type="button"
        >
          Cancel
        </button>
        <button
          className="agents-c3-btn"
          data-size="md"
          data-variant="primary"
          disabled={!isDirty || isPending}
          type="submit"
        >
          {isPending ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}
