import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";

import {
  CHANNEL_FORM_BARE_INPUT_CLASS,
  CHANNEL_FORM_INPUT_SHELL_CLASS,
  CHANNEL_FORM_LABEL_CLASS,
} from "@/features/channels/ui/channelFormStyles";
import { ChannelPermissionsSettings } from "@/features/channels/ui/ChannelPermissionsSettings";
import { ChannelTypeSettings } from "@/features/channels/ui/ChannelTypeSettings";
import type { CreateChannelFormState } from "@/features/sidebar/lib/useCreateChannelForm";

export const CREATE_CHANNEL_FORM_ID = "create-channel-form";

/**
 * The body of the create-channel form (name, description, type, expiry,
 * visibility). Rendered inside both the standalone dialog and the "Add
 * channel" browser's create mode. Wrap in a `<form>` with
 * `id={CREATE_CHANNEL_FORM_ID}` and hook up `form.handleSubmit`.
 */
export function CreateChannelFormFields({
  form,
}: {
  form: CreateChannelFormState;
}) {
  const { kindLabel, isCreating } = form;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-[7px]">
        <label
          className={CHANNEL_FORM_LABEL_CLASS}
          htmlFor="create-channel-name"
        >
          Name
        </label>
        {/* The board's Name shell is 46px inside a 1px border: 48px outside. */}
        <div className={cn(CHANNEL_FORM_INPUT_SHELL_CLASS, "h-12")}>
          <span
            aria-hidden="true"
            className="text-base font-bold text-colony-muted"
          >
            #
          </span>
          <input
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            className={cn(
              CHANNEL_FORM_BARE_INPUT_CLASS,
              "font-semibold placeholder:font-medium",
            )}
            data-testid="create-channel-name"
            disabled={isCreating}
            id="create-channel-name"
            onChange={(event) => form.setName(event.target.value)}
            placeholder="release-notes"
            ref={form.nameInputRef}
            spellCheck={false}
            value={form.name}
          />
        </div>
      </div>

      <div className="flex flex-col gap-[7px]">
        <label
          className={CHANNEL_FORM_LABEL_CLASS}
          htmlFor="create-channel-description"
        >
          Description{" "}
          <span className="font-semibold text-colony-muted">· Optional</span>
        </label>
        <div className={CHANNEL_FORM_INPUT_SHELL_CLASS}>
          <input
            autoComplete="off"
            className={cn(CHANNEL_FORM_BARE_INPUT_CLASS, "font-medium")}
            data-testid="create-channel-description"
            disabled={isCreating}
            id="create-channel-description"
            onChange={(event) => form.setDescription(event.target.value)}
            placeholder={`What this ${kindLabel} is for`}
            value={form.description}
          />
        </div>
      </div>

      <ChannelTypeSettings
        disabled={isCreating}
        label="Channel type"
        onTemporaryChange={form.setEphemeral}
        onTtlSecondsChange={form.setTtlSeconds}
        temporary={form.ephemeral}
        testIdPrefix="create-channel"
        ttlSeconds={form.ttlSeconds}
        variant="form"
      />

      <ChannelPermissionsSettings
        disabled={isCreating}
        onVisibilityChange={form.setVisibility}
        testIdPrefix="create-channel"
        visibility={form.visibility}
        variant="cards"
      />

      {form.errorMessage ? (
        <p className="text-xs font-semibold text-colony-danger">
          {form.errorMessage}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Footer for the create-channel form: Cancel (when the caller has somewhere to
 * go back to) and the submit button, bound to the form via
 * `form={CREATE_CHANNEL_FORM_ID}`.
 */
export function CreateChannelFormFooter({
  form,
  onCancel,
  submitLabel,
}: {
  form: CreateChannelFormState;
  onCancel?: () => void;
  submitLabel?: string;
}) {
  const { isCreating, kindLabel } = form;

  return (
    <div className="flex w-full items-center justify-end gap-2.5 pt-1">
      {onCancel ? (
        <Button
          className="h-11.5 px-4.5 text-sm font-bold"
          data-testid="create-channel-cancel"
          disabled={isCreating}
          onClick={onCancel}
          type="button"
          variant="outline"
        >
          Cancel
        </Button>
      ) : null}
      <Button
        className="h-11.5 px-5 text-sm"
        data-testid="create-channel-submit"
        disabled={!form.canSubmit}
        form={CREATE_CHANNEL_FORM_ID}
        type="submit"
      >
        {isCreating ? "Creating..." : (submitLabel ?? `Create ${kindLabel}`)}
      </Button>
    </div>
  );
}
