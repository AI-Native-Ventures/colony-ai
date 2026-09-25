# Colony landing page

The production landing page is a static site built from `site/public/`. It follows the approved Helix mockup. Product previews show sample workflows; they are not connected product features.

## Local work and build

```sh
npm --prefix site run check
npm --prefix site run build
```

The build output is `site/dist/`. Preview it over HTTP so the early-access dialog can fetch its HTML fragment:

```sh
python3 -m http.server 4173 --directory site/dist
```

Open `http://127.0.0.1:4173/`. Check mockup parity, all five business scenarios, keyboard use, reduced motion, and mobile widths including 390px. Do not open the page through `file://`; the dialog fragment uses same-origin fetch.

## Early access

The dialog validates an application locally and displays a reviewable email draft. The visitor explicitly opens their email app or copies the draft; the page does not send anything, store applications, or use analytics. The current fallback recipient is `basheer@ainative.ventures`, matching the existing flow. “Ready” means a draft is ready or copied, never that an application was received.

The behavior is in `public/early-access.js`, markup in `public/early-access-dialog.html`, and scoped styles in `public/early-access.css`. The script loads the fragment into `#early-access-slot` inside `#access-dialog`.

## Font files and licenses

Manrope is under SIL Open Font License 1.1. Its license notice is in `public/licenses/MANROPE-OFL.txt`; the official source is [Google Fonts Manrope](https://github.com/google/fonts/blob/main/ofl/manrope/OFL.txt).

Satoshi is from Fontshare under the Indian Type Foundry Free Font License (ITF FFL), not OFL. The license permits self-hosting on the licensee's own website and makes the Fontshare API optional, while restricting general redistribution. Keep Satoshi binaries out of public Git history. Before producing the owner's site, download the original package from [Fontshare Satoshi](https://www.fontshare.com/fonts/satoshi), keep it unmodified, and provide it only to the owner's site build/deployment. See [official ITF FFL terms](https://fontshare.com/licenses/itf-ffl).

## Deployment status

The intended hostname is `https://colony.global`. The site uses the separate Cloudflare Pages project `colony-global`; the older `colony-site` project remains untouched. The current Pages deployment is available at [https://d0be35e5.colony-global.pages.dev](https://d0be35e5.colony-global.pages.dev). It contains 208 runtime files (26.80 MiB).

Preview proof completed: ten local desktop/phone workflows passed, including the agents31 approved state; the early-access draft validated and made no transmission; at 390px, phone previews were centered and auto-played. The hosted Pages root returned 200 with CSP headers, the mobile browser check had no errors, and the animated hero was preserved.

Both `colony.global` and `www.colony.global` are Cloudflare active, with validation and verification active, and return HTTPS 200. A live browser check confirmed the animated hero, early-access dialog loading, working phone layout, and no browser errors. The live `index.html` and six hero/font/demo/JavaScript/video runtime files matched the deployed `dist` files byte for byte by SHA-256. Both hosts currently serve the same page; `www` does not redirect to the apex, while the page declares the apex canonical URL.

The owner attached both custom domains through the Cloudflare dashboard. Both DNS records point to `colony-global.pages.dev` as proxied CNAMEs with Auto TTL. Five MX records and the SPF TXT record were visually confirmed unchanged. This verifies the custom domains and page response; it does not establish a host redirect, which is not configured.

For the next release, once the original Satoshi font is available to the site build:

```sh
npm --prefix site run check
npm --prefix site run build
wrangler pages deploy site/dist --project-name colony-global --branch main --commit-dirty=true
```

Wrangler has Pages write access but no DNS permission. Keep `colony-global` separate from the older `colony-site` workflow. Do not change relay deployments for this static-site release. See `RELEASE-CHECKLIST.md` for current proof states and rollback records.
