import { useNavigate } from "@tanstack/react-router";

import {
  BusinessTabs,
  formatZar,
  W10Button,
  W10Heading,
  W10Page,
} from "./BusinessCommon";
import { STAGES, type LeadContext } from "./leadShared";

export { LeadDetailScreen } from "./LeadDetailScreen";
export { LeadsScreen } from "./LeadsScreen";

export function PipelineScreen(context: LeadContext) {
  const navigate = useNavigate();
  const prospects = context.records.prospects.filter(
    ({ record }) =>
      record.status === "active" &&
      record.prospect.qualification === "qualified",
  );
  const openProspects = prospects.filter(
    ({ record }) => !["won", "lost"].includes(record.prospect.stage),
  );
  const potentialValue = openProspects.reduce(
    (total, { record }) =>
      total + (record.prospect.potentialMonthlyValueMinor ?? 0),
    0,
  );

  return (
    <W10Page wide testId="w10-pipeline-page">
      <W10Heading
        actions={
          <W10Button
            onClick={() => void navigate({ to: "/discovery" })}
            variant="primary"
          >
            Find prospects
          </W10Button>
        }
        title="Pipeline"
      />
      <BusinessTabs active="pipeline" />
      <section aria-label="Pipeline summary" className="w10-metrics">
        <Metric
          label="Open opportunities"
          value={openProspects.length.toString()}
        />
        <Metric
          label="Proposals"
          value={context.records.proposals
            .filter(({ acceptance }) => !acceptance)
            .length.toString()}
        />
        <Metric
          label="New clients"
          value={prospects
            .filter(({ record }) => record.prospect.stage === "won")
            .length.toString()}
        />
        <Metric
          label="Monthly opportunity"
          value={formatZar(potentialValue)}
          note="Potential service value"
        />
      </section>
      <div className="w10-pipeline-board">
        {STAGES.map((item) => {
          const cards = prospects.filter(
            ({ record }) => record.prospect.stage === item.value,
          );
          return (
            <section
              aria-label={item.label}
              className="w10-pipeline-column"
              key={item.value}
            >
              <h2>
                {item.label}
                <small>{cards.length}</small>
              </h2>
              {cards.map((row) => {
                const prospect = row.record.prospect;
                return (
                  <a
                    className="w10-opportunity-card"
                    href={`#/sales/lead/${row.record.prospectId}`}
                    key={row.eventId}
                  >
                    <strong>{prospect.party.displayName}</strong>
                    <p className="w10-opportunity-value">
                      {formatZar(prospect.potentialMonthlyValueMinor)}
                    </p>
                    <small>{prospect.contactName ?? ""}</small>
                  </a>
                );
              })}
            </section>
          );
        })}
      </div>
    </W10Page>
  );
}

function Metric({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="w10-metric">
      <small>{label}</small>
      <strong>{value}</strong>
      {note ? <span>{note}</span> : null}
    </div>
  );
}
