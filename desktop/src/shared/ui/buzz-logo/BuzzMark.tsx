/**
 * The Colony ant mark as a plain static SVG: no SMIL, no scripting, no
 * animation machinery, painted in `currentColor` so it is complete on the very
 * first frame. The geometry is the ant from the Colony landing page
 * (site/public/refined/focused/ant.svg) on the same 466x309 viewBox the old
 * bee used, so every call site keeps its sizing.
 *
 * The component keeps its historical name so call sites and styles are
 * unchanged; the animated BuzzLogoAnimation morph is not used by the loading
 * gates any more.
 */
export function BuzzMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={["buzz-mark", className].filter(Boolean).join(" ")}
      viewBox="0 0 466 309"
      fill="currentColor"
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="14"
      >
        <path d="M198 201Q176 230 163 265 M229 211Q226 243 232 274 M259 190Q281 221 296 252 M327 114Q340 82 371 74 M343 126Q367 106 395 105" />
      </g>
      <circle cx="104" cy="172" r="80" />
      <circle cx="226" cy="164" r="52" />
      <circle cx="313" cy="148" r="46" />
    </svg>
  );
}
