import { Button } from "@/shared/ui/button";
import { WhatsAppResumeAndRetryAction } from "./WhatsAppRetryActions";
import type { WhatsAppStatus } from "./whatsappOutreachModels";

type HealthProps = {
  canManage: boolean;
  status: WhatsAppStatus;
};

function DeliveryHealthSummary({ status }: { status: WhatsAppStatus }) {
  const count = status.healthSummary.notDeliveredByMeta;
  if (count < 1) return null;
  return (
    <p
      className="c3wa-readonly-note"
      data-testid="whatsapp-delivery-health-summary"
    >
      <strong>
        {count} {count === 1 ? "message was" : "messages were"} not delivered by
        Meta
      </strong>
      <span>
        Meta is limiting marketing delivery to some recipients. Review the
        failed chats before changing your template or number strategy.
      </span>
    </p>
  );
}

/** Owner/admin recovery notice rendered at the top of every Outreach destination. */
export function WhatsAppSendHealthBanner({ canManage, status }: HealthProps) {
  const health = status.sendHealth;
  const resumeCount = health
    ? Math.max(health.waitingCount, status.accountRetryCount)
    : status.accountRetryCount;
  if (!canManage || (!health && status.healthSummary.notDeliveredByMeta < 1)) {
    return null;
  }
  return (
    <>
      {health ? (
        <section
          className="c3wa-alert"
          data-testid="whatsapp-send-health-banner"
          role="alert"
        >
          <strong>{health.banner}</strong>
          <p>{health.message}</p>
          {health.fixSteps.length ? (
            <ol>
              {health.fixSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          ) : null}
          <div className="c3wa-draft-actions">
            {health.fixUrl ? (
              <Button asChild size="sm" type="button" variant="outline">
                <a href={health.fixUrl} rel="noreferrer" target="_blank">
                  Open Meta settings
                </a>
              </Button>
            ) : null}
            {resumeCount > 0 ? (
              <WhatsAppResumeAndRetryAction count={resumeCount} />
            ) : null}
          </div>
        </section>
      ) : null}
      <DeliveryHealthSummary status={status} />
    </>
  );
}

/** A Needs You card uses the existing batch-card treatment, without creating a new board. */
export function WhatsAppSendHealthNeedsCard({
  canManage,
  status,
}: HealthProps) {
  const health = status.sendHealth;
  const resumeCount = health
    ? Math.max(health.waitingCount, status.accountRetryCount)
    : status.accountRetryCount;
  if (!canManage || !health) return null;
  return (
    <article
      className="c3wa-desk-batch"
      data-testid="outreach-needs-send-health"
    >
      <div className="c3wa-desk-batch-head">
        <span aria-hidden="true" className="c3wa-desk-batch-avatar">
          !
        </span>
        <div>
          <p className="c3wa-desk-prepared-at">WhatsApp needs your attention</p>
          <h2>WhatsApp stopped sending</h2>
          <p>{health.message}</p>
        </div>
        <span className="c3wa-desk-batch-kind">Send health</span>
      </div>
      <p>{health.banner}</p>
      {health.fixSteps.length ? (
        <ul className="c3wa-desk-quick-replies" aria-label="How to fix Meta">
          {health.fixSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ul>
      ) : null}
      <div className="c3wa-desk-actions">
        {health.fixUrl ? (
          <Button asChild size="sm" type="button" variant="outline">
            <a href={health.fixUrl} rel="noreferrer" target="_blank">
              Open Meta settings
            </a>
          </Button>
        ) : null}
        {resumeCount > 0 ? (
          <WhatsAppResumeAndRetryAction count={resumeCount} />
        ) : null}
      </div>
    </article>
  );
}
