type AccountSettingsHeaderProps = {
  businessName?: string;
  onSectionChange: (section: "profile" | "security") => void;
  section: "profile" | "security";
  title: string;
};

export function AccountSettingsHeader({
  businessName,
  onSectionChange,
  section,
  title,
}: AccountSettingsHeaderProps) {
  return (
    <>
      <header className="w20-account-profile-header">
        <h1 className="w20-account-page-title">{title}</h1>
        {businessName ? (
          <span
            className="w20-account-business-name"
            data-testid="account-business-name"
          >
            {businessName}
          </span>
        ) : null}
      </header>
      <div
        aria-label="Account settings sections"
        className="w20-account-route-tabs"
        role="tablist"
      >
        <button
          aria-selected={section === "profile"}
          className={section === "profile" ? "is-active" : ""}
          data-testid="settings-inner-profile"
          onClick={() => onSectionChange("profile")}
          role="tab"
          type="button"
        >
          Profile
        </button>
        <button
          aria-selected={section === "security"}
          className={section === "security" ? "is-active" : ""}
          data-testid="settings-inner-security"
          onClick={() => onSectionChange("security")}
          role="tab"
          type="button"
        >
          Sign-in &amp; devices
        </button>
      </div>
    </>
  );
}
