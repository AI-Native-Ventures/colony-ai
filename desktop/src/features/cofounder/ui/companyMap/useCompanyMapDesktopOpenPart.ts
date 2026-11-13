import { useEffect, useRef, useState, type FocusEvent } from "react";

import type { FunctionId } from "@/features/cofounder/cofounderRecords";
import { FUNCTION_ORDER } from "@/features/cofounder/functions";
import {
  setCompanyMapOpenPart,
  useCompanyMapOpenPart,
} from "@/features/cofounder/companyMapOpenPart";

/** Keeps map-arm interactions and the map-home header on the same open part. */
export function useCompanyMapDesktopOpenPart() {
  const [pinnedPart, setPinnedPart] = useState<FunctionId | null>(null);
  const [hoveredPart, setHoveredPart] = useState<FunctionId | null>(null);
  const [focusedPart, setFocusedPart] = useState<FunctionId | null>(null);
  const activePart = useCompanyMapOpenPart();
  const hoverCloseRef = useRef<number | null>(null);
  const partStateRef = useRef({
    focusedPart: null as FunctionId | null,
    hoveredPart: null as FunctionId | null,
    pinnedPart: null as FunctionId | null,
  });
  partStateRef.current = { focusedPart, hoveredPart, pinnedPart };

  useEffect(() => {
    setCompanyMapOpenPart(null);
    return () => {
      if (hoverCloseRef.current !== null)
        window.clearTimeout(hoverCloseRef.current);
      setCompanyMapOpenPart(null);
    };
  }, []);

  useEffect(() => {
    if (activePart !== null) return;
    if (pinnedPart === null && hoveredPart === null && focusedPart === null)
      return;
    setPinnedPart(null);
    setHoveredPart(null);
    setFocusedPart(null);
  }, [activePart, focusedPart, hoveredPart, pinnedPart]);

  function closeHoverSoon() {
    if (hoverCloseRef.current !== null)
      window.clearTimeout(hoverCloseRef.current);
    hoverCloseRef.current = window.setTimeout(() => {
      setHoveredPart(null);
      const { focusedPart, pinnedPart } = partStateRef.current;
      setCompanyMapOpenPart(focusedPart ?? pinnedPart);
    }, 140);
  }

  function enterPart(functionId: FunctionId) {
    if (hoverCloseRef.current !== null)
      window.clearTimeout(hoverCloseRef.current);
    setCompanyMapOpenPart(functionId);
    setHoveredPart(functionId);
  }

  function clearOpenPart() {
    setCompanyMapOpenPart(null);
    setPinnedPart(null);
    setHoveredPart(null);
    setFocusedPart(null);
  }

  function focusPart(functionId: FunctionId) {
    setCompanyMapOpenPart(functionId);
    setFocusedPart(functionId);
  }

  function togglePinnedPart(functionId: FunctionId) {
    if (partStateRef.current.pinnedPart === functionId) {
      clearOpenPart();
      return;
    }
    setCompanyMapOpenPart(functionId);
    setPinnedPart(functionId);
    setFocusedPart(null);
  }

  function blurPart(event: FocusEvent<HTMLElement>, functionId: FunctionId) {
    const next = event.relatedTarget;
    if (
      next instanceof HTMLElement &&
      next.closest<HTMLElement>("[data-map-group]")?.dataset.mapGroup ===
        functionId
    ) {
      return;
    }
    window.setTimeout(() => {
      const current = document.activeElement;
      const nextGroup =
        current instanceof HTMLElement
          ? current.closest<HTMLElement>("[data-map-group]")?.dataset.mapGroup
          : undefined;
      const nextFocusedPart =
        FUNCTION_ORDER.find((candidate) => candidate === nextGroup) ?? null;
      setFocusedPart(nextFocusedPart);
      const { hoveredPart, pinnedPart } = partStateRef.current;
      setCompanyMapOpenPart(nextFocusedPart ?? hoveredPart ?? pinnedPart);
    }, 0);
  }

  return {
    activePart,
    blurPart,
    clearOpenPart,
    closeHoverSoon,
    enterPart,
    focusPart,
    togglePinnedPart,
  };
}
