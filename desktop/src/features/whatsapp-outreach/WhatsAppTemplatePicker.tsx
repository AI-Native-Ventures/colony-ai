import type { WhatsAppTemplate } from "./whatsappOutreachModels";

export function WhatsAppTemplatePicker({
  onClose,
  onSelect,
  templates,
}: {
  onClose: () => void;
  onSelect: (template: WhatsAppTemplate) => void;
  templates: readonly WhatsAppTemplate[];
}) {
  const approved = templates.filter(
    (template) => template.status.toLocaleUpperCase() === "APPROVED",
  );

  return (
    <div
      aria-labelledby="wa-template-picker-title"
      aria-modal="true"
      className="c3wa-template-picker"
      role="dialog"
    >
      <div className="c3wa-template-picker-head">
        <strong id="wa-template-picker-title">Choose a template</strong>
        <button
          aria-label="Close template picker"
          onClick={onClose}
          type="button"
        >
          ×
        </button>
      </div>
      <div className="c3wa-template-picker-list">
        {approved.map((template) => (
          <button
            key={`${template.name}:${template.language}`}
            onClick={() => onSelect(template)}
            type="button"
          >
            <strong>{template.title}</strong>
            <span>{template.category.toLocaleLowerCase()}</span>
          </button>
        ))}
        {approved.length === 0 ? (
          <p>No approved templates are available.</p>
        ) : null}
      </div>
    </div>
  );
}
