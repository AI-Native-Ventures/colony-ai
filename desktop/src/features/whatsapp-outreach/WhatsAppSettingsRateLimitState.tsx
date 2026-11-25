import { WhatsAppRateLimitNotice } from "./WhatsAppRateLimitNotice";

/** Quiet recovery state for settings when the shared relay HTTP budget is busy. */
export function WhatsAppSettingsRateLimitState() {
  return (
    <section
      className="c3wa-root c3wa-settings"
      data-testid="whatsapp-settings"
    >
      <WhatsAppRateLimitNotice />
      <p>WhatsApp settings will reload shortly.</p>
    </section>
  );
}
