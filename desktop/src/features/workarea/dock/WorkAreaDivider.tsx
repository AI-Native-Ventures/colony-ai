import * as React from "react";

import {
  clampWorkAreaWidth,
  WORK_AREA_KEY_STEP,
  WORK_AREA_KEY_STEP_LARGE,
  WORK_AREA_MAX_WIDTH,
  WORK_AREA_MIN_WIDTH,
} from "./workAreaTypes";

type WorkAreaDividerProps = {
  width: number;
  layoutRef: React.RefObject<HTMLDivElement | null>;
  onResize: (width: number) => void;
  onReset: () => void;
  onClose: () => void;
};

/**
 * Vertical separator between the conversation and the dock. Pointer drags
 * update the layout's CSS variable directly and commit once on release (one
 * user action, one persisted write). Keyboard: Left/Right resize by 2%,
 * Shift+Left/Right by 10%, Home resets, Escape closes the dock. Modified
 * arrows (Cmd, Ctrl, Alt) are left alone for the platform.
 */
export function WorkAreaDivider({
  width,
  layoutRef,
  onResize,
  onReset,
  onClose,
}: WorkAreaDividerProps) {
  const [dragging, setDragging] = React.useState(false);
  const dragRef = React.useRef<{
    pointerId: number;
    value: number;
  } | null>(null);

  const widthFromPointer = (clientX: number) => {
    const rect = layoutRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    return clampWorkAreaWidth(((rect.right - clientX) / rect.width) * 100);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, value: width };
    setDragging(true);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const next = widthFromPointer(event.clientX);
    if (next === null) return;
    drag.value = next;
    layoutRef.current?.style.setProperty("--colony-work-area-size", `${next}%`);
    event.currentTarget.setAttribute("aria-valuenow", String(next));
  };

  const finishDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onResize(drag.value);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "Home") {
      event.preventDefault();
      onReset();
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.shiftKey ? WORK_AREA_KEY_STEP_LARGE : WORK_AREA_KEY_STEP;
    // The dock is on the right, so the divider moving left makes it wider.
    onResize(width + (event.key === "ArrowLeft" ? step : -step));
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable, resizable separator is the ARIA window-splitter pattern; <hr> cannot be a widget.
    <div
      aria-label="Work area size"
      aria-orientation="vertical"
      aria-valuemax={WORK_AREA_MAX_WIDTH}
      aria-valuemin={WORK_AREA_MIN_WIDTH}
      aria-valuenow={width}
      aria-valuetext={`${width}% of the conversation area`}
      className="colony-work-area-divider"
      data-dragging={dragging ? "true" : undefined}
      data-testid="work-area-divider"
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
      onLostPointerCapture={finishDrag}
      onPointerCancel={finishDrag}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishDrag}
      role="separator"
      tabIndex={0}
    />
  );
}
