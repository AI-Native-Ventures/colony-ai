import "./welcome.css";

type SuggestionChipsProps = {
  /** Who suggested them, for the group's name. */
  agentName: string;
  suggestions: readonly string[];
  onPick: (suggestion: string) => void;
  disabled?: boolean;
};

/** Tap-to-reply chips under an agent's message (`Main.dc.html`). */
export function SuggestionChips({
  agentName,
  suggestions,
  onPick,
  disabled = false,
}: SuggestionChipsProps) {
  if (suggestions.length === 0) return null;
  return (
    <fieldset
      aria-label={`Suggestions from ${agentName}`}
      className="cw-chips"
      data-testid="suggestion-chips"
    >
      {suggestions.map((suggestion) => (
        <button
          className="cw-chip"
          data-testid="suggestion-chip"
          disabled={disabled}
          key={suggestion}
          onClick={() => onPick(suggestion)}
          type="button"
        >
          {suggestion}
        </button>
      ))}
    </fieldset>
  );
}
