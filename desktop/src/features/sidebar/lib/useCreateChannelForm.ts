import * as React from "react";

import { useChannelTemplatesQuery } from "@/features/channel-templates/hooks";
import { DEFAULT_EPHEMERAL_TTL_SECONDS } from "@/features/channels/lib/ephemeralChannel";
import type { ChannelTemplate, ChannelVisibility } from "@/shared/api/types";

export type CreateChannelKind = "stream" | "forum";

export type CreateChannelInput = {
  name: string;
  description?: string;
  visibility: ChannelVisibility;
  ttlSeconds?: number;
  templateId?: string;
};

export type CreateChannelFormDraft = {
  name: string;
  description: string;
  visibility: ChannelVisibility;
  ephemeral: boolean;
  ttlSeconds: number;
  visibilityTouched: boolean;
  selectedTemplateId: string | null;
};

type UseCreateChannelFormOptions = {
  channelKind: CreateChannelKind;
  /**
   * When this flips to `true` the form resets its fields (and applies
   * `initialName`). Pass the dialog/mode's open state.
   */
  active: boolean;
  initialName?: string;
  initialDraft?: CreateChannelFormDraft | null;
  initialTemplateId?: string | null;
  isCreating: boolean;
  onCreate: (input: CreateChannelInput) => Promise<void>;
  onCreated?: () => void;
  autoFocusName?: boolean;
};

export type CreateChannelFormState = {
  channelKind: CreateChannelKind;
  kindLabel: string;
  name: string;
  setName: (value: string) => void;
  description: string;
  setDescription: (value: string) => void;
  visibility: ChannelVisibility;
  setVisibility: (value: ChannelVisibility) => void;
  ephemeral: boolean;
  setEphemeral: (value: boolean) => void;
  ttlSeconds: number;
  setTtlSeconds: (value: number) => void;
  errorMessage: string | null;
  selectedTemplateId: string | null;
  handleTemplateChange: (templateId: string) => void;
  handleTemplateCreated: (template: ChannelTemplate) => void;
  templates: ChannelTemplate[];
  nameInputRef: React.RefObject<HTMLInputElement | null>;
  isCreating: boolean;
  canSubmit: boolean;
  getDraft: () => CreateChannelFormDraft;
  handleSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
};

/**
 * Shared state + submit logic for the create-channel form. Powers both the
 * standalone `CreateChannelDialog` and the create mode of the unified
 * "Add channel" browser dialog, so the two stay behaviorally identical.
 */
export function useCreateChannelForm({
  channelKind,
  active,
  initialName,
  initialDraft,
  initialTemplateId,
  isCreating,
  onCreate,
  onCreated,
  autoFocusName = true,
}: UseCreateChannelFormOptions): CreateChannelFormState {
  const [name, setName] = React.useState(initialName ?? "");
  const [description, setDescription] = React.useState("");
  const [visibility, setVisibility] = React.useState<ChannelVisibility>("open");
  const [ephemeral, setEphemeral] = React.useState(false);
  const [ttlSeconds, setTtlSeconds] = React.useState(
    DEFAULT_EPHEMERAL_TTL_SECONDS,
  );
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = React.useState<
    string | null
  >(null);
  const nameInputRef = React.useRef<HTMLInputElement>(null);
  const visibilityTouchedRef = React.useRef(false);

  const templatesQuery = useChannelTemplatesQuery();
  const templates = templatesQuery.data ?? [];

  const kindLabel = channelKind === "forum" ? "forum" : "channel";
  React.useEffect(() => {
    if (!active) return;

    setName(initialDraft?.name ?? initialName ?? "");
    setDescription(initialDraft?.description ?? "");
    setVisibility(initialDraft?.visibility ?? "open");
    setEphemeral(initialDraft?.ephemeral ?? false);
    setTtlSeconds(initialDraft?.ttlSeconds ?? DEFAULT_EPHEMERAL_TTL_SECONDS);
    setErrorMessage(null);
    setSelectedTemplateId(initialDraft?.selectedTemplateId ?? null);
    visibilityTouchedRef.current = initialDraft?.visibilityTouched ?? false;

    if (!autoFocusName) return;

    // Small delay to let the dialog animation start before focusing.
    const timerId = globalThis.setTimeout(() => {
      const activeElement = document.activeElement;
      if (
        activeElement instanceof HTMLElement &&
        activeElement.closest("#create-channel-form")
      ) {
        return;
      }
      const input = nameInputRef.current;
      if (!input) return;
      input.focus();
      // Place the caret at the end of any prefilled name.
      const end = input.value.length;
      input.setSelectionRange(end, end);
    }, 50);
    return () => globalThis.clearTimeout(timerId);
  }, [active, autoFocusName, initialDraft, initialName]);

  const applyTemplate = React.useCallback((template: ChannelTemplate) => {
    setSelectedTemplateId(template.id);
    setDescription(template.description ?? "");
    if (!visibilityTouchedRef.current) setVisibility(template.visibility);
    setErrorMessage(null);
  }, []);

  const handleTemplateChange = React.useCallback(
    (templateId: string) => {
      if (!templateId) {
        setSelectedTemplateId(null);
        setDescription("");
        if (!visibilityTouchedRef.current) setVisibility("open");
        setErrorMessage(null);
        return;
      }

      const template = templates.find(
        (t: ChannelTemplate) => t.id === templateId,
      );
      if (!template) return;

      applyTemplate(template);
    },
    [applyTemplate, templates],
  );

  React.useEffect(() => {
    if (!active || !initialTemplateId) return;
    const template = templates.find((item) => item.id === initialTemplateId);
    if (!template) return;

    applyTemplate(template);
  }, [active, applyTemplate, initialTemplateId, templates]);

  const handleSubmit = React.useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const trimmedName = name.trim();
      if (!trimmedName) return;

      setErrorMessage(null);

      void (async () => {
        try {
          await onCreate({
            name: trimmedName,
            description: description.trim() || undefined,
            visibility,
            ttlSeconds: ephemeral ? ttlSeconds : undefined,
            templateId: selectedTemplateId ?? undefined,
          });
          onCreated?.();
        } catch (error) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : `Failed to create ${kindLabel}.`,
          );
        }
      })();
    },
    [
      description,
      ephemeral,
      kindLabel,
      name,
      onCreate,
      onCreated,
      selectedTemplateId,
      ttlSeconds,
      visibility,
    ],
  );

  const getDraft = React.useCallback(
    (): CreateChannelFormDraft => ({
      name,
      description,
      visibility,
      ephemeral,
      ttlSeconds,
      visibilityTouched: visibilityTouchedRef.current,
      selectedTemplateId,
    }),
    [description, ephemeral, name, selectedTemplateId, ttlSeconds, visibility],
  );

  return {
    channelKind,
    kindLabel,
    name,
    setName: (value: string) => {
      setName(value);
      setErrorMessage(null);
    },
    description,
    setDescription: (value: string) => {
      setDescription(value);
      setErrorMessage(null);
    },
    visibility,
    setVisibility: (value: ChannelVisibility) => {
      visibilityTouchedRef.current = true;
      setVisibility(value);
    },
    ephemeral,
    setEphemeral,
    ttlSeconds,
    setTtlSeconds,
    errorMessage,
    selectedTemplateId,
    handleTemplateChange,
    handleTemplateCreated: applyTemplate,
    templates,
    nameInputRef,
    isCreating,
    canSubmit: name.trim().length > 0 && !isCreating,
    getDraft,
    handleSubmit,
  };
}
