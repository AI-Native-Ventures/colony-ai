import {
  ListPlus,
  Globe2,
  MessageCircle,
  MoreHorizontal,
  Sparkles,
} from "lucide-react";

import type { ProspectStage } from "./businessRecordContract";
import { STAGES } from "./leadShared";

export function OutreachSelectionBar({
  count,
  onAddToList,
  onCheckWebsites,
  onWhatsAppBatch,
  onAskScout,
  onChangeStage,
  onMarkLost,
  onDiscuss,
  onClear,
}: {
  count: number;
  onAddToList: () => void;
  onCheckWebsites: () => void;
  onWhatsAppBatch: () => void;
  onAskScout: () => void;
  onChangeStage: (stage: ProspectStage) => void;
  onMarkLost: () => void;
  onDiscuss?: () => void;
  onClear: () => void;
}) {
  if (count === 0) return null;
  return (
    <section
      aria-label="Selected leads"
      className="c3l-selection-bar"
      role="toolbar"
    >
      <strong>{count} selected</strong>
      <button
        className="c3l-selection-action c3l-selection-action-primary c3l-selection-add"
        onClick={onAddToList}
        type="button"
      >
        <ListPlus aria-hidden="true" size={15} />
        <span className="c3l-selection-desktop-label">
          Add to outreach list
        </span>
        <span className="c3l-selection-mobile-label">Add to list</span>
      </button>
      <button
        className="c3l-selection-action c3l-selection-websites"
        onClick={onCheckWebsites}
        type="button"
      >
        <Globe2 aria-hidden="true" size={15} />
        <span>Check their websites (free)</span>
      </button>
      <button
        className="c3l-selection-action c3l-selection-batch"
        onClick={onWhatsAppBatch}
        type="button"
      >
        <MessageCircle aria-hidden="true" size={15} />
        <span className="c3l-selection-desktop-label">WhatsApp batch</span>
        <span className="c3l-selection-mobile-label">Batch</span>
      </button>
      <button
        className="c3l-selection-action c3l-selection-scout"
        onClick={onAskScout}
        type="button"
      >
        <Sparkles aria-hidden="true" size={15} />
        <span>Ask Scout</span>
      </button>
      <details className="c3l-selection-more">
        <summary aria-label="More actions">
          <MoreHorizontal aria-hidden="true" size={15} />
          <span>More</span>
        </summary>
        <div className="c3l-selection-more-menu">
          <button
            className="c3l-selection-mobile-only"
            onClick={onAskScout}
            type="button"
          >
            Ask Scout
          </button>
          <details className="c3l-selection-stage-menu">
            <summary>
              Change stage <span aria-hidden="true">›</span>
            </summary>
            <div>
              {STAGES.filter((stage) => stage.value !== "lost").map((stage) => (
                <button
                  key={stage.value}
                  onClick={() => onChangeStage(stage.value)}
                  type="button"
                >
                  {stage.label}
                </button>
              ))}
            </div>
          </details>
          <button onClick={onMarkLost} type="button">
            Mark lost
          </button>
          {onDiscuss ? (
            <button onClick={onDiscuss} type="button">
              Discuss in Sales
            </button>
          ) : null}
        </div>
      </details>
      <button className="c3l-selection-clear" onClick={onClear} type="button">
        Clear
      </button>
    </section>
  );
}
