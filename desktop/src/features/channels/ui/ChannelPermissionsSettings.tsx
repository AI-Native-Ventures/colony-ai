import { ChevronDown, Globe, Lock } from "lucide-react";

import { useCommunities } from "@/features/communities/useCommunities";
import type { ChannelVisibility } from "@/shared/api/types";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { cn } from "@/shared/lib/cn";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { CHANNEL_FORM_LABEL_CLASS } from "./channelFormStyles";
import { ChannelFormSegmented } from "./ChannelFormSegmented";
import { GlobeGlyph } from "./dialogIcons";
import { PrivateChannelIcon } from "@/shared/ui/colonyIcons";

const VISIBILITY_OPTIONS = [
  { value: "private", label: "Private", Icon: Lock },
  { value: "open", label: "Public", Icon: Globe },
] as const;

const CARD_VISIBILITY_OPTIONS = [
  { value: "private", label: "Private", Icon: PrivateChannelIcon },
  { value: "open", label: "Public", Icon: GlobeGlyph },
] as const;

const VISIBILITY_CARDS = [
  {
    value: "private",
    label: "Private",
    description: () => "Only people and agents you add",
  },
  {
    value: "open",
    label: "Public",
    description: (communityName: string) =>
      `Anyone in ${communityName} can join`,
  },
] as const;

function VisibilityCards({
  disabled,
  onVisibilityChange,
  testIdPrefix,
  visibility,
}: {
  disabled?: boolean;
  onVisibilityChange: (visibility: ChannelVisibility) => void;
  testIdPrefix: string;
  visibility: ChannelVisibility;
}) {
  const { activeCommunity } = useCommunities();
  const communityName = activeCommunity?.name ?? "this community";

  return (
    <fieldset
      className="m-0 flex min-w-0 flex-col gap-[7px] border-0 p-0"
      data-testid={`${testIdPrefix}-permissions-container`}
      disabled={disabled}
    >
      <legend className={cn("mb-[7px] p-0", CHANNEL_FORM_LABEL_CLASS)}>
        Visibility
      </legend>
      <div
        className="grid grid-cols-2 gap-2.5"
        data-testid={`${testIdPrefix}-permissions`}
      >
        {VISIBILITY_CARDS.map((card) => {
          const selected = visibility === card.value;
          return (
            <label
              className={cn(
                "flex cursor-pointer gap-2.5 rounded-colony-chip px-3.5 py-3",
                selected
                  ? "bg-colony-accent-soft/25 shadow-[inset_0_0_0_2px_hsl(var(--colony-accent))]"
                  : "shadow-[inset_0_0_0_1px_hsl(var(--colony-border-strong))]",
              )}
              data-testid={`${testIdPrefix}-permissions-option-${card.value}`}
              key={card.value}
            >
              <input
                checked={selected}
                className="m-0 mt-[3px] accent-colony-accent"
                name={`${testIdPrefix}-visibility`}
                onChange={() => onVisibilityChange(card.value)}
                type="radio"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-control font-extrabold text-colony-fg">
                  {card.label}
                </span>
                <span className="text-xs font-medium text-colony-muted">
                  {card.description(communityName)}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function ChannelPermissionsSettings({
  disabled,
  onVisibilityChange,
  testIdPrefix,
  visibility,
  variant = "dropdown",
}: {
  disabled?: boolean;
  onVisibilityChange: (visibility: ChannelVisibility) => void;
  testIdPrefix: string;
  visibility: ChannelVisibility;
  variant?: "dropdown" | "segmented" | "cards" | "card";
}) {
  const visibilityLabel = visibility === "private" ? "Private" : "Public";

  if (variant === "card") {
    return (
      <div
        className="flex items-center justify-between gap-3 rounded-colony-chip bg-colony-pop py-2.5 pl-3.5 pr-2.5 shadow-[0_0_0_1px_hsl(var(--colony-border-strong))]"
        data-testid={`${testIdPrefix}-permissions-container`}
      >
        <span
          className={cn("text-menu font-bold", disabled && "opacity-50")}
          id={`${testIdPrefix}-permissions-label`}
        >
          Visibility
        </span>
        <ChannelFormSegmented
          disabled={disabled}
          legend="Visibility"
          onValueChange={onVisibilityChange}
          optionTestIdPrefix={`${testIdPrefix}-permissions-option`}
          options={CARD_VISIBILITY_OPTIONS}
          testId={`${testIdPrefix}-permissions`}
          value={visibility}
        />
      </div>
    );
  }

  if (variant === "cards") {
    return (
      <VisibilityCards
        disabled={disabled}
        onVisibilityChange={onVisibilityChange}
        testIdPrefix={testIdPrefix}
        visibility={visibility}
      />
    );
  }

  return (
    <div
      className={cn(
        "flex min-h-12 items-center justify-between gap-4 rounded-xl border border-input bg-background px-3 py-3",
        disabled && variant === "dropdown" && "opacity-50",
      )}
      data-testid={`${testIdPrefix}-permissions-container`}
    >
      <span
        className={cn(
          "text-sm font-medium text-foreground",
          disabled && variant === "segmented" && "opacity-50",
        )}
      >
        Visibility
      </span>
      {variant === "segmented" ? (
        <SegmentedControl
          disabled={disabled}
          legend="Visibility"
          onValueChange={onVisibilityChange}
          optionTestIdPrefix={`${testIdPrefix}-permissions-option`}
          options={VISIBILITY_OPTIONS}
          testId={`${testIdPrefix}-permissions`}
          value={visibility}
        />
      ) : (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label={`Visibility: ${visibilityLabel}`}
              className="-mr-2.5 ml-auto h-9 w-fit justify-end px-2.5 text-right text-sm font-medium text-foreground hover:bg-muted/50"
              data-testid={`${testIdPrefix}-permissions`}
              disabled={disabled}
              type="button"
              variant="ghost"
            >
              <span aria-live="polite" className="text-right">
                {visibilityLabel}
              </span>
              <ChevronDown className="size-4 shrink-0 text-muted-foreground/70" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            onCloseAutoFocus={(event) => event.preventDefault()}
            style={{
              minWidth: "var(--radix-dropdown-menu-trigger-width)",
            }}
          >
            <DropdownMenuRadioGroup
              onValueChange={(nextVisibility) =>
                onVisibilityChange(
                  nextVisibility === "private" ? "private" : "open",
                )
              }
              value={visibility}
            >
              <DropdownMenuRadioItem
                data-testid={`${testIdPrefix}-permissions-option-open`}
                value="open"
              >
                Public
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem
                data-testid={`${testIdPrefix}-permissions-option-private`}
                value="private"
              >
                Private
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
