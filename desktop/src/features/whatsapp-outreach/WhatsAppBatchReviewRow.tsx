import * as React from "react";

import { BusinessLogoMark } from "@/features/discovery/BusinessLogoMark";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/cn";
import {
  maskWhatsAppNumber,
  whatsappQueuedScheduleLabel,
  type WhatsAppBatchRow,
  type WhatsAppContact,
  type WhatsAppTemplate,
} from "./whatsappOutreachModels";
import "./whatsappOutreach.css";

function rolledByCap(row: WhatsAppBatchRow): boolean {
  return (
    row.state === "held" ||
    row.skipReason?.toLocaleLowerCase().includes("cap") === true
  );
}

/** Renders template variables as the outgoing message preview. */
export function TemplatePreview({
  template,
  params,
}: {
  template: WhatsAppTemplate;
  params: readonly string[];
}) {
  const segments = template.body.split(/(\{\{\d+\}\})/gu);
  let position = 0;
  const keyedSegments = segments.map((segment) => {
    const keyedSegment = { key: `${position}:${segment}`, segment };
    position += segment.length;
    return keyedSegment;
  });
  return (
    <>
      {keyedSegments.map(({ key, segment }) => {
        const slot = /^\{\{(\d+)\}\}$/u.exec(segment);
        if (!slot) return <React.Fragment key={key}>{segment}</React.Fragment>;
        const value = params[Number(slot[1]) - 1] ?? segment;
        if (/^https:\/\//u.test(value)) {
          const previewLink = value
            .replace(/^https:\/\//u, "")
            .replace(/\/+$/u, "");
          return (
            <a
              className="c3wa-preview-link"
              href={value}
              key={key}
              rel="noreferrer noopener"
              target="_blank"
            >
              {previewLink}
            </a>
          );
        }
        return (
          <mark className="c3wa-variable-highlight" key={key}>
            {value}
          </mark>
        );
      })}
    </>
  );
}

/** Shows a recipient row, with edits that are saved in the owner decision. */
export function WhatsAppBatchReviewRow({
  business = null,
  contact,
  leadName,
  materialLink,
  index,
  isNext,
  isRemoved,
  onRemove,
  onSave,
  params,
  preview,
  row,
  template,
  testIdPrefix,
  editable,
  variant = "page",
}: {
  business?: {
    name: string;
    website: string | null;
    logoUrl: string | null;
    placePhotoUrl: string | null;
  } | null;
  contact: WhatsAppContact | null;
  leadName: string | null;
  materialLink: string | null;
  index: number;
  isNext: boolean;
  isRemoved: boolean;
  onRemove: () => void;
  onSave: (params: string[]) => void;
  params: readonly string[];
  preview: string;
  row: WhatsAppBatchRow;
  template: WhatsAppTemplate | null;
  testIdPrefix: string;
  editable: boolean;
  variant?: "page" | "channel";
}) {
  const [editing, setEditing] = React.useState(false);
  const [values, setValues] = React.useState<string[]>([...params]);
  React.useEffect(() => setValues([...params]), [params]);

  function saveEdit() {
    onSave(values);
    setEditing(false);
  }
  const displayName =
    business?.name ??
    contact?.businessName ??
    leadName ??
    contact?.displayName ??
    (row.leadId ? "Linked lead" : `WhatsApp contact ${index + 1}`);

  return (
    <article
      aria-label={
        variant === "channel" ? `Message for ${displayName}` : undefined
      }
      className={cn(
        "c3wa-batch-row",
        variant === "channel" && "c3wa-channel-batch-row",
        isRemoved && "is-removed",
      )}
      data-row-tone={index % 5}
      data-testid={`${testIdPrefix}-${row.idx}`}
    >
      <div className="c3wa-batch-row-head">
        {variant === "channel" ? (
          <span aria-hidden="true" className="c3wa-contact-avatar">
            {displayName.slice(0, 1).toLocaleUpperCase()}
          </span>
        ) : (
          <span aria-hidden="true" className="c3wa-batch-row-art">
            {business ? (
              <BusinessLogoMark
                className="c3wa-batch-row-logo"
                logoUrl={business.logoUrl}
                name={business.name}
                placePhotoUrl={business.placePhotoUrl}
                website={business.website}
              />
            ) : (
              <>
                <i />
                <i />
                <i />
              </>
            )}
          </span>
        )}
        <div className="c3wa-batch-row-contact">
          <strong>{displayName}</strong>
          <span>{maskWhatsAppNumber(row.to)}</span>
        </div>
        {materialLink ? (
          <a
            className="c3wa-row-preview-link"
            href={materialLink}
            rel="noreferrer noopener"
            target="_blank"
          >
            Website preview ↗
          </a>
        ) : null}
        {variant !== "channel" &&
        (row.state === "sent" ||
          row.state === "delivered" ||
          row.state === "read") ? (
          <span
            className={cn(
              "c3wa-batch-row-state",
              row.state === "read"
                ? "is-read"
                : row.state === "delivered"
                  ? "is-delivered"
                  : "is-sent",
            )}
          >
            {row.state === "read"
              ? "Read"
              : row.state === "delivered"
                ? "Delivered"
                : "Sent"}
          </span>
        ) : null}
        {variant !== "channel" && rolledByCap(row) ? (
          <span className="c3wa-batch-row-state is-held">Tomorrow</span>
        ) : null}
        {variant !== "channel" && row.state === "failed" ? (
          <span className="c3wa-batch-row-state is-failed">Failed</span>
        ) : null}
        {variant !== "channel" &&
        (row.state === "ready" || row.state === "queued") ? (
          <span
            className="c3wa-batch-row-state"
            data-testid={`whatsapp-batch-row-schedule-${row.idx}`}
          >
            {whatsappQueuedScheduleLabel(row.sendsAt)}
          </span>
        ) : null}
        {variant !== "channel" && isNext ? (
          <span className="c3wa-batch-row-state is-next">Up next</span>
        ) : null}
        {editable && !isRemoved ? (
          <div className="c3wa-batch-row-actions">
            <button
              onClick={() => setEditing((current) => !current)}
              type="button"
            >
              {editing ? "Cancel edit" : "Edit"}
            </button>
            <button onClick={onRemove} type="button">
              Remove
            </button>
          </div>
        ) : null}
      </div>
      {editing ? (
        <div className="c3wa-batch-edit-fields">
          {values
            .map((value, slotIndex) => ({
              key: `${row.idx}:variable:${slotIndex + 1}`,
              slotIndex,
              value,
            }))
            .map(({ key, slotIndex, value }) => (
              <label key={key}>
                <span>Variable {slotIndex + 1}</span>
                <input
                  aria-label={`Row ${index + 1} variable ${slotIndex + 1}`}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setValues((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === slotIndex ? value : item,
                      ),
                    );
                  }}
                  value={value}
                />
              </label>
            ))}
          <Button onClick={saveEdit} size="sm" type="button">
            Save edit
          </Button>
          <p aria-live="polite" className="c3wa-batch-preview">
            {template ? (
              <TemplatePreview params={values} template={template} />
            ) : (
              preview
            )}
          </p>
        </div>
      ) : null}
      {row.skipReason ? (
        <p className="c3wa-batch-skip">{row.skipReason}</p>
      ) : null}
      {isRemoved ? (
        <p className="c3wa-batch-removed">
          This row will be removed when you approve.
        </p>
      ) : null}
    </article>
  );
}
