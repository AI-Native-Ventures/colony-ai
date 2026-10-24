import * as React from "react";

import { DEFAULT_EPHEMERAL_TTL_SECONDS } from "@/features/channels/lib/ephemeralChannel";
import type { ChannelVisibility } from "@/shared/api/types";

export type CreateChannelKind = "stream";

export type CreateChannelInput = {
  name: string;
  description?: string;
  visibility: ChannelVisibility;
  ttlSeconds?: number;
};

type UseCreateChannelFormOptions = {
  channelKind: CreateChannelKind;
  /**
   * When this flips to `true` the form resets its fields (and applies
   * `initialName`). Pass the dialog/mode's open state.
   */
  active: boolean;
  initialName?: string;
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
  nameInputRef: React.RefObject<HTMLInputElement | null>;
  isCreating: boolean;
  canSubmit: boolean;
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
  const nameInputRef = React.useRef<HTMLInputElement>(null);
  const kindLabel = "channel";
  React.useEffect(() => {
    if (!active) return;

    setName(initialName ?? "");
    setDescription("");
    setVisibility("open");
    setEphemeral(false);
    setTtlSeconds(DEFAULT_EPHEMERAL_TTL_SECONDS);
    setErrorMessage(null);

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
  }, [active, autoFocusName, initialName]);

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
    [description, ephemeral, name, onCreate, onCreated, ttlSeconds, visibility],
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
    setVisibility,
    ephemeral,
    setEphemeral,
    ttlSeconds,
    setTtlSeconds,
    errorMessage,
    nameInputRef,
    isCreating,
    canSubmit: name.trim().length > 0 && !isCreating,
    handleSubmit,
  };
}
