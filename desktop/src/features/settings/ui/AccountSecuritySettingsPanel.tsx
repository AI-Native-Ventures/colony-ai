import { SignOutSection } from "./SignOutSection";

/** The Sign-in & devices section of the Account page. */
export function AccountSecuritySettingsPanel() {
  return (
    <div className="cs-led">
      <h2 className="cs-section-title">Sign-in &amp; devices</h2>
      <SignOutSection />
    </div>
  );
}
