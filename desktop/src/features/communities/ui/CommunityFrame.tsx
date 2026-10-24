import * as React from "react";

import "@/features/onboarding/ui/firstRun.css";

/** The Colony mark: three hexagons, the second one white. */
export function BrandMark({ size = 44 }: { size?: number }) {
  const length = `${size / 16}rem`;
  return (
    <svg aria-hidden="true" height={length} viewBox="0 0 48 48" width={length}>
      <path d="M14 4h10l5 8.7-5 8.6H14l-5-8.6z" fill="#25222C" />
      <path d="M29 13h10l5 8.7-5 8.6H29l-5-8.6z" fill="#FFFFFF" />
      <path
        d="M14 22h10l5 8.7-5 8.6H14l-5-8.6z"
        fill="#FFFFFF"
        fillOpacity=".7"
      />
    </svg>
  );
}

/** The three soft colours behind the brand text, as the community boards draw them. */
function BrandField({ edit }: { edit?: boolean }) {
  const grainId = `c3fr-brand-grain-${React.useId().replace(/:/g, "")}`;
  return (
    <div
      aria-hidden="true"
      className="c3fr-brand-field"
      data-variant={edit ? "edit" : undefined}
    >
      <div className="c3fr-field-blob" data-blob="top" />
      <div className="c3fr-field-blob" data-blob="middle" />
      <div className="c3fr-field-blob" data-blob="bottom" />
      <div className="c3fr-field-veil" />
      <svg
        aria-hidden="true"
        className="c3fr-field-grain"
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
    </div>
  );
}

export type CommunityFrameVariant = "start" | "failed" | "edit";

/** The brand panel and a content area for the community gate screens. */
export function CommunityFrame({
  testId,
  variant = "start",
  heading,
  body,
  children,
}: {
  testId: string;
  variant?: CommunityFrameVariant;
  heading: string;
  body: string;
  children: React.ReactNode;
}) {
  const edit = variant === "edit";
  return (
    <div className="c3fr-scroll" data-testid={testId}>
      <div className="c3fr-root">
        <section
          aria-label="Colony"
          className="c3fr-brand"
          data-variant={variant}
        >
          <BrandField edit={edit} />
          <div className="c3fr-brand-inner">
            <div className="c3fr-brand-mark">
              <BrandMark />
              <span>colony</span>
            </div>
            <div className="c3fr-brand-copy">
              <p className="c3fr-brand-heading">{heading}</p>
              <p className="c3fr-brand-body">{body}</p>
            </div>
          </div>
        </section>
        <main className="c3fr-brand-main" data-variant={variant}>
          {children}
        </main>
      </div>
    </div>
  );
}

/** A full-screen brand field with a dialog-sized card on it (the Add a community board). */
export function CommunityFieldScreen({
  testId,
  children,
}: {
  testId: string;
  children: React.ReactNode;
}) {
  const grainId = `c3fr-add-grain-${React.useId().replace(/:/g, "")}`;
  return (
    <div className="c3fr-scroll" data-testid={testId}>
      <div className="c3fr-add-screen">
        <div aria-hidden="true" className="c3fr-add-field">
          <div className="c3fr-add-blob" data-blob="top" />
          <div className="c3fr-add-blob" data-blob="middle" />
          <div className="c3fr-add-blob" data-blob="bottom" />
          <div className="c3fr-field-veil" />
          <svg
            aria-hidden="true"
            className="c3fr-field-grain"
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
        </div>
        <div className="c3fr-add-inner">
          <div className="c3fr-brand-mark" data-size="small">
            <BrandMark size={40} />
            <span>colony</span>
          </div>
          <div className="c3fr-add-center">{children}</div>
        </div>
      </div>
    </div>
  );
}
