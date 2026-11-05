import type { HireProposal } from "@/features/company-asks/askRecords";

import { RoleIcon, ToolChip, ToolGlyph } from "./hireTools";

type RolePack = HireProposal["rolePack"];

export function HireConfigureToolScope({ rolePack }: { rolePack: RolePack }) {
  return (
    <section
      aria-labelledby="hire-tool-scope-heading"
      className="colony-hire-configure-tool-scope"
    >
      <h2 id="hire-tool-scope-heading">Included tool scope</h2>
      {rolePack.tools.length > 0 ? (
        <div className="colony-hire-configure-tool-list">
          {rolePack.tools.map((tool) => (
            <div key={`${tool.name}:${tool.risk}`}>
              <ToolGlyph tool={tool} />
              <strong>{tool.name}</strong>
              <ToolChip tool={tool} />
            </div>
          ))}
        </div>
      ) : (
        <p>No tools are included in this role pack.</p>
      )}
      <p>
        Tools come from the role pack. Spending money, messaging outsiders,
        deleting data or publishing still needs a standing permission.
      </p>
    </section>
  );
}

export function HireConfigureRoleSummary({
  onChangeRole,
  rolePack,
}: {
  onChangeRole: () => void;
  rolePack: RolePack;
}) {
  return (
    <aside
      aria-label="Role summary"
      className="colony-hire-card colony-hire-role-summary"
    >
      <span className="colony-hire-role-summary-eyebrow">Role pack</span>
      <div className="colony-hire-role-summary-head">
        <span className="colony-hire-icon-tile" data-active="true">
          <RoleIcon job={rolePack.job} title={rolePack.title} />
        </span>
        <strong>{rolePack.title}</strong>
      </div>
      <dl>
        <div>
          <dt>Job</dt>
          <dd>{rolePack.job}</dd>
        </div>
        <div>
          <dt>Skills</dt>
          <dd className="colony-hire-role-summary-skills">
            {rolePack.skills.length > 0
              ? rolePack.skills.map((skill) => <span key={skill}>{skill}</span>)
              : "No skills listed"}
          </dd>
        </div>
        <div>
          <dt>Default allowance</dt>
          <dd>
            {rolePack.defaultAllowance
              ? `USD ${rolePack.defaultAllowance} / week`
              : "No default amount"}
          </dd>
        </div>
      </dl>
      <button className="colony-hire-link" onClick={onChangeRole} type="button">
        Change role
      </button>
    </aside>
  );
}
