import {
  getShortcutsByCategory,
  getPlatformKeys,
} from "@/shared/lib/keyboard-shortcuts";

/** Shortcuts for features that are not in the lean app are not listed. */
const NOT_LISTED = new Set(["publish-note", "toggle-huddle", "push-to-talk"]);

/** "⇧⌘K" reads "⇧ ⌘ K"; "Escape" reads "Esc"; "Ctrl+K" reads "Ctrl K". */
function spacedKeys(keys: string): string {
  return keys
    .replace(/Escape/g, "Esc")
    .replace(/([⌘⇧⌥⌃])/g, " $1 ")
    .replace(/(?<=\S)\+(?=\S)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function KeyboardShortcutsCard() {
  const categories = getShortcutsByCategory();

  return (
    <div className="cs-led" data-testid="settings-shortcuts">
      <h2 className="cs-section-title">Keyboard shortcuts</h2>
      <div className="cs-shortcut-grid">
        {[...categories.entries()].map(([category, shortcuts]) => {
          const listed = shortcuts.filter(
            (shortcut) => !NOT_LISTED.has(shortcut.id),
          );
          if (listed.length === 0) return null;
          return (
            <section className="cs-card cs-shortcut-card" key={category}>
              <h3 className="cs-eyebrow">{category}</h3>
              {listed.map((shortcut) => (
                <div className="cs-shortcut" key={shortcut.id}>
                  <span title={shortcut.description}>{shortcut.label}</span>
                  <kbd>{spacedKeys(getPlatformKeys(shortcut))}</kbd>
                </div>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
