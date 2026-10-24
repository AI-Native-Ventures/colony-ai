import React from "react";
import { cn } from "@/shared/lib/cn";
import { useSmoothCorners } from "@/shared/ui/smoothCorners";

/**
 * A caption is the image's alt text when a person wrote one. Composer uploads
 * fall back to the file name, which is not a caption.
 */
function imageCaption(child: React.ReactNode): string | null {
  if (!React.isValidElement<{ alt?: unknown }>(child)) return null;
  const alt = child.props.alt;
  if (typeof alt !== "string") return null;
  const text = alt.trim();
  if (!text || text.toLowerCase() === "image") return null;
  if (/\.[a-z0-9]{2,5}$/i.test(text)) return null;
  return text;
}

/** Grid layout for messages that contain multiple standalone images. */
export function ImageMosaic({ children }: { children: React.ReactNode[] }) {
  const mosaicRef = React.useRef<HTMLDivElement | null>(null);
  const isTriptych = children.length === 3;
  const hasOddTail = children.length > 3 && children.length % 2 === 1;
  useSmoothCorners(mosaicRef);

  return (
    <div
      className={cn(
        "mt-1 grid w-full min-w-0 max-w-[calc(540*var(--colony-px))] gap-2 [&_br]:hidden [&_[data-block-media]]:h-full [&_[data-block-media]]:min-h-0 [&_[data-block-media]]:max-w-none [&_[data-block-media]]:overflow-hidden [&_[data-block-media]>button]:m-0 [&_[data-block-media]>button]:h-full [&_[data-block-media]>button]:w-full [&_[data-block-media]>button]:max-w-none [&_[data-block-media]>button]:rounded-none [&_[data-block-media]_[data-progressive-image-frame]]:!h-full [&_[data-block-media]_[data-progressive-image-frame]]:!w-full [&_[data-block-media]_img]:!h-full [&_[data-block-media]_img]:!max-h-none [&_[data-block-media]_img]:!w-full [&_[data-block-media]_img]:!max-w-none [&_[data-block-media]_img]:rounded-none [&_[data-block-media]_img]:object-cover",
        "[&>[data-mosaic-tile]]:relative [&>[data-mosaic-tile]]:overflow-hidden [&>[data-mosaic-tile]]:rounded-[calc(14*var(--colony-px))]",
        isTriptych
          ? "grid-cols-3 [&>[data-mosaic-tile]]:h-[calc(128*var(--colony-px))]"
          : "grid-cols-2 [&>[data-mosaic-tile]]:h-48",
        hasOddTail && "[&>[data-mosaic-tile]:last-child]:col-span-2",
      )}
      data-image-mosaic=""
      data-image-mosaic-count={children.length}
      ref={mosaicRef}
    >
      {children.map((child, index) => {
        const caption = imageCaption(child);
        return (
          <div
            data-mosaic-tile=""
            // biome-ignore lint/suspicious/noArrayIndexKey: the mosaic is a static run of images
            key={index}
          >
            {child}
            {caption ? (
              <span className="c3c-mosaic-caption" data-testid="image-caption">
                {caption}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
