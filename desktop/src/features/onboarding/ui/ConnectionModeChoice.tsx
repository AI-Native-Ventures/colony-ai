import * as React from "react";

export type ConnectionMode = "free" | "own";

/** Start free vs Use your own AI, the top-level Connect choice. */
export type ConnectionModeChoiceProps = {
  value: ConnectionMode;
  onChange: (mode: ConnectionMode) => void;
};

const MODES: ReadonlyArray<{
  id: ConnectionMode;
  title: string;
  body: string;
}> = [
  {
    id: "free",
    title: "Start free",
    body: "Free AI on your computer. No account, no card.",
  },
  {
    id: "own",
    title: "Use your own AI",
    body: "Claude Code or Codex subscription, or OpenRouter",
  },
];

/**
 * One roving radio group: arrow keys move and select, Home and End jump.
 * Each option has one accessible name (its title) and is described by its
 * body text, so screen readers stop once per option.
 */
export function ConnectionModeChoice({
  value,
  onChange,
}: ConnectionModeChoiceProps) {
  const refs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const select = (index: number) => {
    const next = MODES[index];
    if (!next) return;
    refs.current[index]?.focus();
    onChange(next.id);
  };
  return (
    <div
      aria-label="How to connect AI"
      className="connection-modes"
      role="radiogroup"
    >
      {MODES.map((mode, index) => {
        const checked = value === mode.id;
        const bodyId = `onboarding-mode-${mode.id}-body`;
        return (
          // biome-ignore lint/a11y/useSemanticElements: Roving radio group matching the Connect route choice.
          <button
            aria-checked={checked}
            aria-describedby={bodyId}
            className="connection-mode"
            data-testid={`onboarding-mode-${mode.id}`}
            key={mode.id}
            onClick={() => onChange(mode.id)}
            onKeyDown={(event) => {
              const count = MODES.length;
              const offset =
                event.key === "ArrowRight" || event.key === "ArrowDown"
                  ? 1
                  : event.key === "ArrowLeft" || event.key === "ArrowUp"
                    ? -1
                    : 0;
              if (event.key === "Home") {
                event.preventDefault();
                select(0);
              } else if (event.key === "End") {
                event.preventDefault();
                select(count - 1);
              } else if (offset) {
                event.preventDefault();
                select((index + offset + count) % count);
              }
            }}
            ref={(element) => {
              refs.current[index] = element;
            }}
            role="radio"
            tabIndex={checked ? 0 : -1}
            type="button"
          >
            <strong>{mode.title}</strong>
            <span id={bodyId}>{mode.body}</span>
          </button>
        );
      })}
    </div>
  );
}
