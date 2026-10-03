# Dark sidebar contrast, 1.0.4 local polish

Measured on the mock-bridge E2E build at 1440x900, default typography, in both smoke and integration. Each number is the minimum ratio across app and Settings sidebars and both projects. App navigation was measured at the top and bottom scroll positions. All required text samples must reach 4.5:1.

Method: save computed foreground and opacity, hide glyph ink without changing layout, capture the painted background, and calculate WCAG relative luminance against every pixel under each visible text rectangle. Hit-testing excludes text clipped behind the footer. This covers gradients and translucent fills. Decorative avatars and non-sidebar page content are outside this audit.

Frame edges have no text contrast requirement. Flat themes must paint the same color at top and bottom of each sidebar. The branded dark theme keeps its approved gradient. The frame column lists app and Settings edge colors.

| Theme | Business | User | Sections | Navigation | Search | Frame edges |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| andromeeda | 11.55:1 | 9.84:1 | 9.84:1 | 9.47:1 | 10.14:1 | Flat: #16181d / #23262e |
| aurora-x | 13.99:1 | 12.73:1 | 12.73:1 | 12.30:1 | 12.23:1 | Flat: #020204 / #0f1117 |
| ayu-dark | 10.98:1 | 9.81:1 | 9.81:1 | 9.64:1 | 9.49:1 | Flat: #020304 / #10141c |
| buzz-dark | 8.79:1 | 6.08:1 | 6.02:1 | 5.49:1 | 7.64:1 | Approved gradient |
| catppuccin-frappe | 9.70:1 | 8.06:1 | 8.06:1 | 7.74:1 | 8.43:1 | Flat: #242735 / #303446 |
| catppuccin-macchiato | 11.51:1 | 9.92:1 | 9.92:1 | 9.33:1 | 10.18:1 | Flat: #191b28 / #24273a |
| catppuccin-mocha | 13.19:1 | 11.34:1 | 11.34:1 | 11.06:1 | 11.33:1 | Flat: #0f0f17 / #1e1e2e |
| dark-plus | 12.93:1 | 11.25:1 | 11.25:1 | 10.86:1 | 11.16:1 | Flat: #0f0f0f / #1e1e1e |
| dracula | 15.74:1 | 11.62:1 | 13.36:1 | 10.01:1 | 13.40:1 | Flat: #1c1d25 / #282a36 |
| dracula-soft | 15.50:1 | 11.62:1 | 13.16:1 | 10.01:1 | 13.37:1 | Flat: #1c1d25 / #282a36 |
| everforest-dark | 8.83:1 | 7.38:1 | 7.38:1 | 7.04:1 | 7.71:1 | Flat: #22282c / #2d353b |
| github-dark | 13.70:1 | 11.50:1 | 11.50:1 | 10.35:1 | 12.01:1 | Flat: #171a1d / #24292e |
| github-dark-default | 17.55:1 | 15.44:1 | 16.02:1 | 13.90:1 | 15.40:1 | Flat: #020203 / #0d1117 |
| github-dark-dimmed | 9.00:1 | 7.60:1 | 7.60:1 | 7.38:1 | 7.91:1 | Flat: #15181d / #22272e |
| github-dark-high-contrast | 18.51:1 | 15.53:1 | 17.10:1 | 14.02:1 | 16.44:1 | Flat: #030304 / #0e1014 |
| gruvbox-dark-hard | 13.88:1 | 11.95:1 | 11.95:1 | 11.62:1 | 11.98:1 | Flat: #0f1011 / #1d2021 |
| gruvbox-dark-medium | 12.42:1 | 10.75:1 | 10.75:1 | 10.04:1 | 10.89:1 | Flat: #1c1c1c / #282828 |
| gruvbox-dark-soft | 11.26:1 | 9.57:1 | 9.57:1 | 9.03:1 | 9.71:1 | Flat: #262423 / #32302f |
| houston | 17.80:1 | 14.35:1 | 15.46:1 | 12.67:1 | 15.18:1 | Flat: #060608 / #17191e |
| kanagawa-dragon | 12.09:1 | 10.76:1 | 10.76:1 | 10.49:1 | 10.48:1 | Flat: #060606 / #181616 |
| kanagawa-wave | 13.08:1 | 11.26:1 | 11.26:1 | 10.92:1 | 11.34:1 | Flat: #101014 / #1f1f28 |
| laserwave | 18.04:1 | 12.75:1 | 15.63:1 | 11.12:1 | 15.48:1 | Flat: #18151d / #27212e |
| material-theme | 14.96:1 | 10.74:1 | 12.77:1 | 9.30:1 | 12.56:1 | Flat: #1d262a / #263238 |
| material-theme-darker | 18.33:1 | 13.14:1 | 15.63:1 | 11.51:1 | 15.88:1 | Flat: #111111 / #212121 |
| material-theme-ocean | 11.30:1 | 10.26:1 | 10.26:1 | 9.95:1 | 9.87:1 | Flat: #020203 / #0f111a |
| material-theme-palenight | 8.83:1 | 7.44:1 | 7.44:1 | 7.05:1 | 7.87:1 | Flat: #1d202d / #292d3e |
| min-dark | 12.84:1 | 11.12:1 | 11.12:1 | 10.73:1 | 11.16:1 | Flat: #101010 / #1f1f1f |
| monokai | 16.57:1 | 12.13:1 | 13.94:1 | 10.49:1 | 14.11:1 | Flat: #181915 / #272822 |
| night-owl | 15.05:1 | 13.54:1 | 13.54:1 | 13.10:1 | 13.19:1 | Flat: #00060a / #011627 |
| nord | 11.07:1 | 9.25:1 | 9.25:1 | 8.82:1 | 9.50:1 | Flat: #232730 / #2e3440 |
| one-dark-pro | 7.82:1 | 6.57:1 | 6.57:1 | 6.28:1 | 6.97:1 | Flat: #1c1e24 / #282c34 |
| plastic | 8.41:1 | 7.22:1 | 7.22:1 | 6.92:1 | 7.43:1 | Flat: #15171b / #21252b |
| poimandres | 8.57:1 | 7.45:1 | 7.45:1 | 7.20:1 | 7.40:1 | Flat: #0e0f14 / #1b1e28 |
| red | 18.79:1 | 14.59:1 | 16.84:1 | 13.29:1 | 16.76:1 | Flat: #1d0000 / #390000 |
| rose-pine | 15.35:1 | 13.39:1 | 13.39:1 | 12.75:1 | 13.12:1 | Flat: #060609 / #191724 |
| rose-pine-moon | 13.68:1 | 11.86:1 | 11.86:1 | 11.14:1 | 12.02:1 | Flat: #161522 / #232136 |
| slack-dark | 14.63:1 | 12.75:1 | 12.75:1 | 11.34:1 | 12.75:1 | Flat: #151515 / #222222 |
| solarized-dark | 5.63:1 | 4.75:1 | 4.75:1 | 4.63:1 | 4.97:1 | Flat: #001b22 / #002b36 |
| synthwave-84 | 12.05:1 | 10.31:1 | 10.31:1 | 9.90:1 | 10.58:1 | Flat: #181621 / #262335 |
| tokyo-night | 9.13:1 | 8.10:1 | 8.10:1 | 7.70:1 | 7.98:1 | Flat: #0d0e13 / #1a1b26 |
| vesper | 20.75:1 | 15.52:1 | 19.03:1 | 13.99:1 | 18.32:1 | Flat: #020202 / #101010 |
| vitesse-black | 14.59:1 | 13.22:1 | 13.22:1 | 12.90:1 | 12.72:1 | Flat: #000000 / #101010 |
| vitesse-dark | 14.41:1 | 13.01:1 | 13.01:1 | 12.68:1 | 12.49:1 | Flat: #020202 / #121212 |

Result: 43 dark themes, 86 passing project cases. The regression measured low contrast in branded dark section labels and search hints, and named-theme Settings search placeholders before the token changes. No per-theme color patches were added.

Raw per-element measurements are attached by the Playwright spec as sidebar-contrast.json. GitHub Dark Settings screenshots were captured and inspected at 1440x900 and 1728x1117. This is browser mock-bridge proof, not native app, real-provider, CI or release proof.
