import type { ProspectDiscoveryTag } from "./businessRecordContract";

import "./discoveryTags.css";

export function DiscoveryLeadTags({
  tags,
  limit,
}: {
  tags: ProspectDiscoveryTag[] | undefined;
  limit?: number;
}) {
  const visible = [...(tags ?? [])]
    .sort((left, right) => Number(right.picked) - Number(left.picked))
    .slice(0, limit ?? Number.POSITIVE_INFINITY);
  if (!visible.length) return null;

  return (
    <ul aria-label="Matched discovery tags" className="c3d-lead-tag-list">
      {visible.map((match) => (
        <li
          className={`c3d-lead-tag${match.picked ? " is-picked" : ""}`}
          key={`${match.kind}:${match.tag}`}
        >
          {match.tag}
        </li>
      ))}
    </ul>
  );
}
