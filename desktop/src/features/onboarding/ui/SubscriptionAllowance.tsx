import type { AiSubscription } from "@/shared/api/aiSubscriptions";

/** Render actual provider allowances. Missing windows never become placeholder numbers. */
export function SubscriptionAllowance({
  subscription,
}: {
  subscription?: AiSubscription;
}) {
  if (!subscription)
    return (
      <p className="usage-unavailable" role="status">
        Checking subscription…
      </p>
    );
  return (
    <>
      {subscription.plan ? (
        <p className="provider-account">
          {subscription.source === "cached"
            ? "Last known plan: "
            : "Signed in · "}
          {subscription.plan}
        </p>
      ) : null}
      {subscription.windows.length ? (
        <div className="allowances">
          {subscription.windows.map((window) => (
            <div className="allowance" key={window.label}>
              <div>
                <span>{window.label}</span>
                <strong>{window.remainingPercent}% left</strong>
              </div>
              <progress
                aria-label={`${window.label} remaining`}
                max={100}
                value={window.remainingPercent}
              />
              {window.resetsAt ? (
                <small>
                  Resets{" "}
                  {new Date(window.resetsAt).toLocaleString(undefined, {
                    weekday: "short",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </small>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {subscription.observedAt && subscription.windows.length > 0 ? (
        <small className="provider-account">
          Last checked{" "}
          {new Date(subscription.observedAt).toLocaleTimeString(undefined, {
            hour: "numeric",
            minute: "2-digit",
          })}
        </small>
      ) : null}
      {subscription.message ? (
        <p className="usage-unavailable" role="status">
          {subscription.message}
        </p>
      ) : null}
      {subscription.source === "live" &&
      subscription.signedIn &&
      subscription.plan ? (
        <span className="provider-status is-connected">Subscription found</span>
      ) : null}
    </>
  );
}
