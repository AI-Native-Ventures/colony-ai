# Colony landing page release checklist

Use this checklist for each site release. A successful local build is not proof of deployment or live behavior.

## Proven for the current Pages preview

- [x] Separate `colony-global` Pages deployment is live at [https://d0be35e5.colony-global.pages.dev](https://d0be35e5.colony-global.pages.dev), with 208 runtime files (26.80 MiB).
- [x] Ten local desktop/phone workflows passed, including the agents31 approved state; the animated hero remains present.
- [x] At 390px, the phone previews are centered and auto-play.
- [x] The early-access draft validates and makes no network transmission.
- [x] Hosted Pages root returns 200 with CSP headers; the mobile browser review had no errors.
- [x] Apex and `www` are Cloudflare active with validation and verification active; both return HTTPS 200.
- [x] Live browser review confirmed the animated hero, early-access dialog loading, working phone layout, and no browser errors.
- [x] Live `index.html` and six hero/font/demo/JavaScript/video runtime files are SHA-256 identical to the deployed `dist` files.
- [x] Both hosts currently serve the same page; `www` has no redirect to apex, and the page declares the apex canonical URL.
- [x] Apex and `www` use proxied CNAME records to `colony-global.pages.dev` with Auto TTL. Five MX records and the SPF TXT record were visually confirmed unchanged.

## Before the next deployment

- [ ] Confirm the implementation matches approved Helix r23: hero composition, wordmark, type scale, spacing, product sections, navigation, and footer attribution.
- [ ] Run `npm --prefix site run check` and `npm --prefix site run build`; confirm `site/dist/` contains the intended public files only.
- [ ] Confirm the original Satoshi font is available to the owner's build without committing font binaries; confirm Manrope is accompanied by `public/licenses/MANROPE-OFL.txt`.
- [ ] Review desktop and mobile, including 390px. Check for horizontal overflow, clipped dialog controls, legible form fields, and visible keyboard focus.
- [ ] Exercise each product preview: Find customers, Your website, Social content, Revenue & costs, and Grow your team. Confirm each selection displays its own sample workflow.
- [ ] Open and close the early-access dialog by keyboard and pointer. Verify required-field handling, invalid email rejection, whitespace-only description rejection, and draft preparation.
- [ ] Verify the draft contains the entered details and correct recipient. Email opens only after the visitor chooses the email action. Copy fallback tells them they still need to send it.
- [ ] Confirm no UI claims an application was sent or received. Confirm there is no automatic network submission, application storage, or analytics.
- [ ] Confirm CTA destinations, external links, Buzz/Block attribution, and product claims are accurate.
- [ ] Inspect console, network activity, and response headers for failed assets, JavaScript errors, mixed content, and unintended external requests.
- [ ] Confirm the owner-approved production branch for the verified `colony-global` Pages project. Ensure the older `colony-site` workflow cannot overwrite this deployment.

## After deployment

- [ ] Record the source commit and Cloudflare Pages deployment identity/status for the next release.
- [x] Verify `https://colony.global` and `https://www.colony.global` load over HTTPS and return 200 with the intended page. These domains currently serve identical content without a `www` to apex redirect.
- [ ] Repeat desktop/mobile visual review and all five scenario checks on the deployed page.
- [ ] Prepare an early-access draft with synthetic data. Confirm it remains on page until explicit email or copy action; do not send the synthetic application.
- [ ] Check headers, certificate, missing assets, console/network errors, and confirm no relay deployment changed.

## Rollback

If the page is broken or materially differs from the approved version, use Cloudflare Pages to restore the last known-good deployment for `colony-global`. If the platform cannot restore it directly, rebuild and deploy the recorded known-good commit to that project. If domain rollback is required, restore the prior apex A `192.64.119.134` (proxied, Auto TTL) and `www` CNAME `parkingpage.namecheap.com` (proxied, Auto TTL). The current records are proxied CNAMEs to `colony-global.pages.dev` with Auto TTL. Leave all five MX records and the SPF TXT record untouched. Recheck both hosts over HTTPS and record the restored deployment identity. Do not route the domain to the older Pages project as a shortcut.
