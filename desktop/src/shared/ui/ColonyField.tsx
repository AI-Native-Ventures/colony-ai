import * as React from "react";

import { cn } from "@/shared/lib/cn";

type ColonyFieldProps = {
  className?: string;
  /**
   * `rail` paints the narrow community rail (one wash, no blobs); `swatch`
   * is the taller sample the Foundations board shows.
   */
  variant?: "sidebar" | "rail" | "swatch";
};

/**
 * The Colony 3.0 "field": three soft colours blurred into one wall behind the
 * sidebar, under a white veil with a little grain. The three colours come from
 * `--colony-field-top`, `--colony-field-middle` and `--colony-field-bottom`
 * (see `theme.css`), so a future appearance setting only has to set those.
 * Only branded themes (`data-buzz-sidebar` on the root) paint it; other named
 * themes keep their flat sidebar colour.
 */
export function ColonyField({
  className,
  variant = "sidebar",
}: ColonyFieldProps) {
  const grainId = `colony-field-grain-${React.useId().replace(/:/g, "")}`;
  return (
    <div
      aria-hidden="true"
      className={cn("colony-field", className)}
      data-colony-field={variant}
    >
      <div className="colony-field-base" />
      {variant !== "rail" ? (
        <>
          <div className="colony-field-blob colony-field-blob-top" />
          <div className="colony-field-blob colony-field-blob-middle" />
          <div className="colony-field-blob colony-field-blob-bottom" />
          <div className="colony-field-veil" />
          <svg
            aria-hidden="true"
            className="colony-field-grain"
            height="100%"
            width="100%"
          >
            <filter id={grainId}>
              <feTurbulence
                baseFrequency=".85"
                numOctaves="2"
                stitchTiles="stitch"
                type="fractalNoise"
              />
              <feColorMatrix type="saturate" values="0" />
            </filter>
            <rect filter={`url(#${grainId})`} height="100%" width="100%" />
          </svg>
        </>
      ) : (
        <div className="colony-field-rail-shade" />
      )}
    </div>
  );
}
