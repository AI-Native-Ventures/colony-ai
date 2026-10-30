import { AppTopChromePortal } from "@/app/AppTopChromePortal";

import "./cofounderPhase2.css";
import type {
  CofounderAccessModel,
  CofounderAccessRequest,
} from "../cofounderPhase2Model";

const ACCESS_GLYPHS: Record<string, string> = {
  whatsapp: "◉",
  gmail: "◎",
  pinterest: "◎",
  "google-calendar": "▦",
  esign: "✎",
  discovery: "⌕",
};

function accessGlyph(entryId: string) {
  return ACCESS_GLYPHS[entryId] ?? "◌";
}

function PendingAccessCard({
  request,
  onApprove,
  onDecline,
}: {
  request: CofounderAccessRequest;
  onApprove: (request: CofounderAccessRequest) => void;
  onDecline: (requestId: string) => void;
}) {
  return (
    <section
      aria-label="Pending access request"
      className="cf2-card cf2-access-request"
      data-testid="cofounder-access-pending"
    >
      <div className="cf2-card-title-row">
        <span aria-hidden="true" className="cf2-scout-tile">
          S
        </span>
        <span>
          <span className="cf2-chip cf2-chip-warm">Pending</span>
          <small>Asked today</small>
          <strong>Scout asks to {request.title}</strong>
        </span>
      </div>
      <p>{request.description}</p>
      <div className="cf2-actions">
        <button
          className="cf2-button cf2-button-primary"
          data-testid={`cofounder-access-approve-${request.id}`}
          onClick={() => onApprove(request)}
          type="button"
        >
          Approve and open browser
        </button>
        <button
          className="cf2-button"
          data-testid={`cofounder-access-decline-${request.id}`}
          onClick={() => onDecline(request.id)}
          type="button"
        >
          Not now
        </button>
      </div>
    </section>
  );
}

export function CofounderAccessScreen({
  model,
  onRevoke,
  onApproveRequest,
  onDeclineRequest,
}: {
  model: CofounderAccessModel;
  onRevoke: (entryId: string) => void;
  onApproveRequest: (request: CofounderAccessRequest) => void;
  onDeclineRequest: (requestId: string) => void;
}) {
  return (
    <div className="cf2-screen" data-testid="cofounder-access-screen">
      <AppTopChromePortal>
        <nav aria-label="Breadcrumb" className="cf2-breadcrumb">
          <a href="#/company/map">Company</a>
          <span aria-hidden="true">/</span>
          <span aria-current="page">Access</span>
        </nav>
      </AppTopChromePortal>
      <main className="cf2-page">
        <header className="cf2-page-heading">
          <h1>Access</h1>
          <p>
            Every tool and account Scout and your agents can use. Revoke any of
            them at once.
          </p>
        </header>

        {model.pendingRequest ? (
          <PendingAccessCard
            onApprove={onApproveRequest}
            onDecline={onDeclineRequest}
            request={model.pendingRequest}
          />
        ) : null}

        <div className="cf2-access-table-wrap">
          <table className="cf2-access-table">
            <thead>
              <tr>
                <th scope="col">Tool or account</th>
                <th scope="col">Used for</th>
                <th scope="col">Who</th>
                <th scope="col">Cost</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {model.entries.map((entry) => (
                <tr data-testid={`cofounder-access-${entry.id}`} key={entry.id}>
                  <th scope="row">
                    <span aria-hidden="true" className="cf2-access-glyph">
                      {accessGlyph(entry.id)}
                    </span>
                    {entry.label}
                  </th>
                  <td>{entry.usedFor}</td>
                  <td>{entry.usedBy}</td>
                  <td>{entry.cost}</td>
                  <td>
                    <button
                      aria-label={`Revoke access to ${entry.label}`}
                      className="cf2-button cf2-button-danger"
                      data-testid={`cofounder-access-revoke-${entry.id}`}
                      onClick={() => onRevoke(entry.id)}
                      type="button"
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <section aria-label="Tools and accounts" className="cf2-access-cards">
            {model.entries.map((entry) => (
              <article
                className="cf2-card cf2-access-row"
                data-testid={`cofounder-access-mobile-${entry.id}`}
                key={entry.id}
              >
                <div className="cf2-access-row-heading">
                  <span aria-hidden="true" className="cf2-access-glyph">
                    {accessGlyph(entry.id)}
                  </span>
                  <strong>{entry.label}</strong>
                </div>
                <dl>
                  <dt>Used for</dt>
                  <dd>{entry.usedFor}</dd>
                  <dt>Who</dt>
                  <dd>{entry.usedBy}</dd>
                  <dt>Cost</dt>
                  <dd>{entry.cost}</dd>
                </dl>
                <button
                  aria-label={`Revoke access to ${entry.label}`}
                  className="cf2-button cf2-button-danger"
                  onClick={() => onRevoke(entry.id)}
                  type="button"
                >
                  Revoke
                </button>
              </article>
            ))}
          </section>
        </div>
        {model.entries.length === 0 ? (
          <p className="cf2-empty-note" role="status">
            No tools or accounts are connected.
          </p>
        ) : null}
        <p className="cf2-worker-access-note">
          Workers never get tools or accounts. They only produce material for
          the agent that started them.
        </p>
      </main>
    </div>
  );
}
