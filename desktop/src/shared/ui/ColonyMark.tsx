/** Colony ant silhouette from the frozen onboarding design. */
export function ColonyMark({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="currentColor"
      viewBox="0 0 466 309"
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="14"
      >
        <path d="M198 201Q176 230 163 265M229 211Q226 243 232 274M259 190Q281 221 296 252M327 114Q340 82 371 74M343 126Q367 106 395 105" />
      </g>
      <circle cx="104" cy="172" r="80" />
      <circle cx="226" cy="164" r="52" />
      <circle cx="313" cy="148" r="46" />
    </svg>
  );
}
