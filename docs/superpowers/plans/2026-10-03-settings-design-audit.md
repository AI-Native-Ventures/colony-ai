# Settings launch design audit

Compared the frozen R17 workspace routes with the rendered mock-bridge app on
3 October 2026. Appearance and the three theme states were captured at 1728x1117
and 1440x900. The remaining routes were captured at 1440x900. These are rendered
UI observations, not native, signed-in account-service or relay integration proof.
The G1 reference fixture supplies the Lerato Social business and profile. Data
and permission differences are called out separately from layout defects.

The two owner complaints are supported by the code: SettingsPanels routed
Appearance to WorkspaceAppearanceSettingsPanel, leaving the fuller
AppearanceSettingsPanel unused. ThemeCatalogRoute used generic swatches instead
of the frozen mini-workspace tiles. The PR restores those routes and scenes.

All four primary states are CLOSE. Their controls, content order and preview
palettes now follow the reference. The shared shell still differs: 244px sidebar
instead of the reference 239px, a flat outer frame instead of the inset rounded
frame, different navigation icons and selected treatment, and text sizing.
Manrope is the owner-approved font and remains in use. The sidebar and
typography lane owns those shell differences. Appearance's message
size select also uses the native control rather than the frozen select drawing.
No pixel-perfect claim is made.

| Real section | Frozen R17 route | Verdict | Remaining difference |
| --- | --- | --- | --- |
| appearance | settings/appearance | CLOSE | Shared shell, native select drawing and mini-workspace icon details. |
| settings/themes | settings/themes | CLOSE | Shared shell and type metrics; the catalog header, search, filters, active check and palette tiles are restored. |
| settings/theme-preview | settings/theme-preview | CLOSE | Shared shell and type metrics; sample workspace, return action and purple apply action are restored. |
| settings/theme-applied | settings/theme-applied | CLOSE | Shared shell and type metrics; confirmation, workspace and Done action are restored. |
| profile | account | CLOSE | Card spacing, timezone control and fixture email/status values differ. |
| security | account/security | DIFFERENT | Current device-only recovery view lacks the approved email/password and signed-in-device panels. Mock account-service availability is not real account proof. |
| accessibility | account/accessibility | DIFFERENT | Flat controls and long shortcut list replace the approved two-column cards, dropdowns and keyboard-hint setting. |
| notifications | account/notifications | DIFFERENT | Desktop/sound/category toggles replace approved activity dropdowns and quiet-hours controls. |
| voice | settings/voice | DIFFERENT | Compact bordered rows replace approved audio tests, permission state and Messages section. |
| shortcuts | settings/shortcuts | DIFFERENT | Long list with additional captions replaces the compact grouped reference. |
| business-profile | settings | DIFFERENT | Read-only workspace identity and logo upload replace the business profile form. Work and connections tabs are absent. |
| people | settings/people | DIFFERENT | Rendered panel is blank in this fixture after network idle. Code returns null without an owner/admin relay membership. Reference has people table, invite action and client-access card. Membership permissions are not proven by this fixture. |
| agent-defaults | agent-settings/defaults | DIFFERENT | Generic disabled card, old harness name and provider placeholder replace approved two-column defaults form and actions. Runtime discovery is mock data. |
| harnesses | agent-settings/harnesses | DIFFERENT | Minimal three-runtime list replaces the approved branded harness list and grouping. Runtime availability is mock data. |
| channel-templates | settings/templates | CLOSE | Empty fixture instead of reference samples, smaller heading, missing Blocks tab and different empty-state layout. |
| custom-emoji | settings/emoji | DIFFERENT | Uploader and community fixture replace the approved built-in samples and layout. Custom emoji names are user data. |
| moderation | account/moderation | DIFFERENT | Permission-denied state differs from reference report table. This fixture does not establish moderator access. |
| audit | account/audit | DIFFERENT | Permission-denied state differs from reference activity table and refers to the moderation queue. This fixture does not establish admin access. |
| app | settings/device | DIFFERENT | Boxed toggles replace open rows; connected-work actions and activity state are absent. Privacy and Compute tabs are additional. |
| mobile | settings/mobile | DIFFERENT | QR pairing instructions with old branding replace the approved device summary and account-access links. |
| updates | settings/updates | DIFFERENT | Generic check button and old branding replace approved Colony application tile, release channel and update status. |
| experimental | settings/experiments | DIFFERENT | Individual enabled feature toggles replace approved early-access toggle and empty state. |
| storage | settings/storage | DIFFERENT | Technical local archive/observer controls replace storage usage, breakdown and workspace links. |
| archived-records | account/archive | DIFFERENT | Flat empty state replaces approved archive card and wider content inset. |
| recovery | account/recovery | DIFFERENT | One flat saved-drafts state replaces approved unsent-messages and saved-form-drafts cards. |
| privacy | company-v9 b2/settings/privacy/controls | CLOSE | Controls and copy are present; company shell, card width, spacing and button drawing differ. |
| compute | company-v9 settings/recovery/compute/retry-success | DIFFERENT | Local sharing form replaces approved connected-host summary and connection-restored state. No model was started or downloaded. |

The additional Privacy and Compute pages are compared with the latest
company-v9 privacy controls and Compute recovery-success reference. Their
verdicts are recorded in the screenshot comment. Company workflows are not
changed or claimed proven by this PR.

Coordinator follow-up: assign the remaining DIFFERENT routes as independent
fixes. Keep account-service, permissions and harness discovery gates distinct
from these mock visual findings. This PR's bounded implementation is Appearance
and named themes; it does not make every Settings group launch-ready.
