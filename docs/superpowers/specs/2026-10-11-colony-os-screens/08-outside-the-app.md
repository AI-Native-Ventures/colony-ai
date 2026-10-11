# 08 Outside the app

Pages and emails people meet outside the Colony app: Colony's own website, the payment pages, the emails Colony sends, and the website Leo builds and runs for the owner. The rules in 00-index (sections 5, 8 and 10) apply here too, with one addition: these pages must also work on phones, because people read emails and tap links on their phones even though the app itself is desktop only.

Shared rules for every page and email in this file:

- Colony's own pages live on colony.global (default).
- No tracking cookies and no tracking pixels in emails (default). Visits are counted without cookies, so no cookie banner is needed.
- Nothing here may describe a feature that is not built at launch. At launch there is no direct posting to social networks, no reading of the owner's inbox, no checkout on owners' websites, no phone app and no lead database. Employees prepare drafts; people post and send them.
- Provider names appear in one place only: the sub-processor list in the privacy policy (W-04). Everywhere else the only names allowed are the owner's own "ChatGPT plan" or "Claude plan", and Stripe on payment pages.

---

### W-01 Landing page

- **Who:** anyone considering Colony: small business owners and first-time founders who are not technical. Invited partners who want to know what Colony is.
- **Purpose:** explain in under a minute what Colony does, what stays in the owner's control and what it costs, then get them to download it.
- **Get here:** typing colony.global, search results, social posts, word of mouth, the "What is Colony?" link on the invite page (W-07), links in email footers (W-06).
- **Leads to:** W-02 (download), W-03 (pricing), W-04 (terms and privacy), the support contact.
- **Shows** (in this order):
  1. **The promise.** One headline sentence and one supporting sentence. The main action is Download, named for the visitor's system ("Download for Mac" or "Download for Windows"). A second action, "See how it works", moves to block 2. Under the actions, one honest line: "For Mac and Windows. Your team works on your computer."
  2. **How it works, in 3 steps.**
     1. Tell Scout about your business (about 5 minutes).
     2. Meet your team and approve their first 2-week plans.
     3. Approve their work as it comes: posts, customer replies, sales messages, website changes. You post and send. Your website goes live when you say so.
  3. **Meet the team.** The six employees, each with name, role, one line on what they own and one example of what they make, using the sample company and clearly labelled as an example:
     - Scout, Chief of Staff: runs the team, morning brief, Friday wrap.
     - Maya, Growth Marketer: growth plan, campaigns, weekly numbers.
     - Naledi, Social Media Manager: posts, carousels, video scripts, images (AI-made images are labelled).
     - Sipho, Sales Director: finds shops and buyers, drafts messages, line sheets and quotes.
     - Leo, Website Builder: builds your website and keeps it fresh.
     - Grace, Customer Care and Admin: drafts replies to customers, FAQ and policies, invoices and reminders.
  4. **A day with Colony.** Three moments: the 08:30 morning brief; decisions that arrive as cards you approve in a click; the Friday wrap. One example decision card, taken from the approved app designs once they exist.
  5. **You stay in control.**
     - Nothing public without your OK.
     - Drafts first: you post and send yourself. The only thing Colony puts live is your website, and only after you approve.
     - Money only with your OK.
     - You see who approved what.
     - Pause anyone, anytime.
     - Invite a partner to help approve. Partners can't touch billing.
     - Weekly budgets per employee: include this line only if budget limits are enforced at launch (E-15).
  6. **What you need.** A Mac or Windows computer and internet. Your team works while your computer is on. If it sleeps, your team pauses and picks up where it left off when it wakes. Closing the window is fine. Plugged in, Colony can keep the computer awake.
  7. **Pricing summary.** "Pay as you go with credits, from $5." The typical week from W-03 (only once it has been measured). "Or use your ChatGPT or Claude plan." "Website hosting $10 a month, if you want Leo to run your site." Link to W-03.
  8. **Questions** (6 to 8, each expands to 1 to 3 sentences):
     - Do I need to be technical? (No.)
     - What happens when my computer is off? (Your team pauses and catches up when it's back.)
     - Can my team post on Instagram for me? (Not yet. Naledi prepares everything and you post in a few clicks.)
     - Will it email my customers by itself? (No. Grace drafts, you send.)
     - Can customers buy on my Colony website? (Your product pages link to your own payment link, your current shop, WhatsApp or an order form. Colony doesn't take payments for you.)
     - Can my business partner use it? (Yes, everyone except billing.)
     - Is my information private? (Link to W-04.)
     - What does it cost? (Link to W-03.)
  9. **Final call to action.** Download, repeated.
  10. **Footer.** Pricing, Terms, Privacy, Contact.
- **Actions:**
  - Download (anyone) -> starts the download for the detected system and opens W-02 with the matching install steps.
  - See how it works (anyone) -> moves to block 2.
  - See pricing (anyone) -> W-03.
  - A question (anyone) -> expands or collapses its answer.
  - Contact (anyone) -> opens an email to support.
  - Keyboard: every action is reachable with Tab in reading order; a "Skip to content" link comes first; Enter or Space opens a question.
- **States:**
  - Visitor on a Mac: Download for Mac.
  - Visitor on Windows: Download for Windows.
  - Visitor on a phone or tablet: no download. Instead: "Colony runs on Mac and Windows computers. Open this page on your computer." with Copy link (default).
  - Visitor on Linux, ChromeOS or anything else: the same message, saying Colony isn't available for that system yet.
  - Slow connection: the text is readable before any image loads.
  - Light or dark, following the visitor's device.
- **Words:**
  - "Your AI team. Your business. You approve what matters."
  - "Tell Scout what you need. Your team does the work. You decide what goes out."
  - "Naledi drafts your posts. You post them in a few clicks."
  - "Your team works while your computer is on. If it sleeps, they pick up where they left off."
  - "Nothing goes public without your OK."
- **Data:** static page. The visitor's system comes from the browser. Pricing numbers come from the same source as W-03. E-30 (PARTIAL: a landing page exists for the old audience and must be rewritten).
- **Not here:** claims of direct posting, inbox reading, checkout, lead databases or a phone app; "works 24/7"; testimonials, customer logos or statistics that don't exist; savings claims ("replaces a $5,000 team"); named competitors; model or provider names; any "Buzz" naming.

---

### W-02 Download and install

- **Who:** someone who chose to download: a new owner or an invited partner.
- **Purpose:** get Colony installed and opened on a Mac or Windows computer without confusion.
- **Get here:** Download on W-01 or W-03; the invite page (W-07) when Colony isn't installed; X-11 when the app can't update itself (see variant B); reinstalling after a problem (from S-09 help).
- **Leads to:** the installed app: O-01 on first open, N-01 when signing in on another computer, P-01 when joining from an invite. Support contact.
- **Shows** (in this order):
  1. The download for the detected system starts at once, with the file name and file size. If the browser blocks it, a Download button does the same.
  2. Install steps for the detected system: 3 to 5 numbered steps, each with a picture of the real installer step once designed.
  3. Requirements: macOS 12 or newer (default; confirm against the build), Windows 10 or 11 (64-bit), about 2 GB of free space (default), internet.
  4. Other systems: links to the Mac and Windows downloads.
  5. Trouble? Short answers to: the download didn't start; my Mac says Colony can't be opened; Windows says it protected my PC; Colony is already installed; contact support.
- **Mac download:** one file that works on both Apple Silicon and Intel Macs (default), so nobody has to know which chip they have. Browsers on Apple Silicon Macs often report Intel, so the page must not depend on chip detection. If the build ships as two files instead, the page shows both, with "Which Mac do I have? Apple menu, then About This Mac: 'Chip' means Apple Silicon, 'Processor' means Intel."
- **Variant A: signed installers** (later, once the owner pays for signing):
  - Mac:
    1. Open the downloaded Colony file.
    2. Drag Colony into Applications.
    3. Open Colony from Applications.
    4. If your Mac asks "Colony is an app downloaded from the internet. Are you sure you want to open it?", choose Open.
  - Windows:
    1. Open the downloaded Colony Setup file.
    2. Colony installs and opens by itself. If Windows asks whether to let the app make changes, choose Yes.
- **Variant B: unsigned installers** (launch: the owner chose not to sign yet, 11 October):
  - Mac:
    1. Open the downloaded file and drag Colony into Applications.
    2. Open Colony. Your Mac says Apple could not check it. Choose Done, not Move to Bin.
    3. Open System Settings, then Privacy and Security. Scroll down to Security. Next to the message about Colony, choose Open Anyway.
    4. Enter your Mac password if asked.
    5. Open Colony again and choose Open Anyway.
  - Windows:
    1. Open Colony Setup.
    2. Windows shows "Windows protected your PC". Choose More info, then Run anyway.
    3. Colony installs and opens.
  - Unsigned Mac apps can't update themselves. The page explains that new versions are downloaded from here (this ties to X-11).
  - Variant B shows frightening system warnings to non-technical owners. The owner accepted this for launch, so these steps must be designed with real screenshots and tested with a non-technical person.
- **Actions:**
  - Download (anyone) -> the file for the detected system.
  - Download for the other system (anyone) -> that file and its steps.
  - Copy link (phone or tablet visitors) -> copies the page address.
  - Open Colony (anyone who already has it) -> tries to open the app; if nothing happens, says "Colony doesn't seem to be installed on this computer yet."
  - Contact support (anyone) -> opens an email to support.
  - Keyboard: every step and action reachable with Tab; the steps are a real numbered list for screen readers.
- **States:** Mac; Windows; phone or tablet (no download, "Open this page on your computer", Copy link); unsupported system (Linux, ChromeOS, Windows on ARM (default: not supported at launch), macOS older than 12: "Colony needs macOS 12 or newer"); download blocked or failed (Try again plus a direct link); variant A; variant B.
- **Words:**
  - "Your download has started. Open the file when it's done."
  - "Drag Colony into Applications, then open it."
  - "Windows protected your PC? Choose More info, then Run anyway." (variant B)
  - "Colony runs on Mac and Windows computers. Open this page on your computer to download it."
  - "Already have Colony? Open it."
- **Data:** install files and the update feed from the release pipeline. E-27 (PARTIAL: unsigned and Apple Silicon only today; an Intel build and signing are needed). Page content E-30.
- **Not here:** a phone app, beta or test versions, developer tools, anything about the command line.

---

### W-03 Pricing

- **Who:** people considering Colony; owners checking what they will pay.
- **Purpose:** explain honestly what Colony costs and what uses credits.
- **Get here:** W-01 (pricing summary and footer); "How pricing works" from O-04 and S-02 (default); links in the credits emails (W-06).
- **Leads to:** W-02 (download), W-04 (terms), support contact.
- **Shows** (in this order):
  1. **How you pay**, in one line: "Pay as you go with credits, or use your own ChatGPT or Claude plan."
  2. **Credit packs** in US dollars: $5, $15, $50 and $120. Each pack adds exactly that amount of credits. Your team's work takes credits as it happens, and the app shows what each employee used, every week.
  3. **A typical week.** "A starter team of six usually uses about $X to $Y a week." The numbers come from real starter teams measured before launch (the real-run gate). Until they are measured, this block is hidden: never guess. Below it, what makes a week cost more or less: more posts and images, more lead hunting, more website changes.
  4. **What uses credits:** your employees' work (thinking, writing, research) and AI-made images. Voice notes are free: they are written down on your computer. Partners cost nothing extra (default).
  5. **Using your own plan.** If you already pay for ChatGPT or Claude, connect your plan and your team's work runs on it instead of credits. Your plan's limits still apply: when you reach them, your team waits until the plan resets, or you can switch to credits. AI-made images still use credits (default).
  6. **Website hosting.** $10 a month per website, paid monthly by card. Includes your Colony web address (for example leratodesigns.colony.site, on a separate domain from colony.global; the name is confirmed before launch), connecting your own domain (bought separately from any domain seller), visit counts and a contact form. Cancel anytime: the site stays up until the end of the month you paid for (default).
  7. **No free trial.** "You start with credits from $5, or by connecting your plan."
  8. **When credits run out.** "Your team pauses. Nothing is lost. Add credits and they carry on." Optional automatic top-up.
  9. **Questions:**
     - Do credits expire? (No (default).)
     - Can I get a refund? (No self-serve refunds. If something went wrong, contact us.)
     - Which currency? (US dollars. Your bank may add a currency conversion fee.)
     - Do partners cost extra? (No (default).)
     - Can I limit what an employee spends? (Weekly budgets: include only if enforced at launch, E-15.)
- **Actions:** Download (anyone) -> W-02. Read the terms (anyone) -> W-04. Contact (anyone) -> email to support. Questions expand and collapse (Enter or Space).
- **States:** normal; typical week not yet measured (block 3 hidden); phone width.
- **Words:**
  - "Pay as you go. Credits from $5."
  - "You see what each employee used, every week."
  - "Already pay for ChatGPT or Claude? Your team can run on your plan."
  - "Website hosting is $10 a month, if you want Leo to run your site."
  - "No free trial. Start with $5 of credits."
- **Data:** packs from the server's price list: Stripe USD packs of 5, 15, 50 and 120 dollars WORK today; each grants its full value and the usage fee is charged on use. Hosting price E-20 (MISSING). Per-employee usage E-15 (PARTIAL). Page E-30.
- **Not here:** discounts, annual plans, per-person prices, a cost calculator, savings claims, comparisons with named competitors, a free trial, a percentage breakdown of Colony's fee (default).

---

### W-04 Terms and privacy

- **Who:** everyone. Signing up means agreeing (O-01 links both pages next to the sign-in actions).
- **Purpose:** plain-language terms of service and privacy policy that match what Colony actually does.
- **Get here:** O-01; footers of W-01, W-03 and every email (W-06); S-09 (default).
- **Leads to:** support contact; back to wherever the reader came from.
- **Shows:** two pages, Terms and Privacy. Each starts with a plain-language summary of 5 to 8 points, then the full text under headings, with a "Last updated" date. When the text changes, a "What changed" note sits at the top for 30 days (default). A lawyer writes the full text; this entry lists what it must cover.
  - **Terms must cover:**
    1. Who can use Colony (businesses, people aged 18 or over), accounts, and the owner's responsibility for the company and for the partners they invite.
    2. What the AI employees do: they draft and prepare; people approve; at launch people post and send themselves; Colony puts only the owner's website live, and only after approval.
    3. The owner's responsibility for everything they post and send, including each platform's rules (Instagram, Facebook, TikTok), its AI-content labels, and direct-marketing law for Sipho's outreach (for example the South African privacy law's rules on unsolicited electronic messages).
    4. AI providers: credits pay only for work done inside Colony. They are not access to AI that can be used elsewhere, and they can't be resold. Everyone must follow the AI providers' terms and each model's terms (the flow-down Colony's AI provider requires). Colony may pause an account that breaks them.
    5. Own plan: an owner who connects a ChatGPT or Claude plan stays bound by their own agreement with that provider, including its limits.
    6. AI-made images: labelled as AI-made, never real product photos, may resemble real things. The owner decides whether and where to use them and follows any disclosure rules.
    7. Credits: prices, what uses credits, expiry (pending: none), no self-serve refunds, automatic top-up permission and how to stop it.
    8. Website hosting: monthly payment, what happens when a payment fails (grace period, then a paused site), cancellation, the owner's responsibility for the domain and the site's content, the "Made with Colony" credit.
    9. Availability: the team runs on the owner's computer and pauses when it is off or asleep. Colony does not promise that work happens while it is off.
    10. Closing the company: what stops, what is deleted and when, and that unused credits are not refunded (pending).
    11. Limits of liability, changes to the terms, governing law (default: South Africa), contact details.
  - **Privacy must cover:**
    1. What Colony collects: account details (name, email, Google sign-in details), the business profile, conversations, cards and documents, photos and files, voice notes and their transcripts, customer messages the owner forwards or pastes, website contact form messages, website visit counts, and payment status. Card details stay with Stripe.
    2. What employees read: everything inside the company (conversations, profile, photos, forwarded messages, knowledge) and public web pages they visit for research. On the computer: exactly what the engine lets employees open at launch. The text must match the real limit and promise nothing more.
    3. Who processes data: AI providers (to do the work), Stripe (payments), the email sender, website hosting, Google (sign-in), and the servers Colony runs on. A sub-processor list with names and countries; this is the only place provider names appear.
    4. Where data is stored: on Colony's servers (country to be confirmed) and on the computer that runs the team; how it is protected.
    5. Customers' personal information: the owner is responsible for it (the "responsible party" under South Africa's POPIA, the "controller" under the EU's GDPR) and Colony processes it on the owner's behalf, only to do the work asked.
    6. Partners see everything in the company.
    7. How long data is kept, and what happens when someone leaves or the company closes (pending retention period).
    8. People's rights (access, correction, deletion, objection) and how to use them.
    9. Cookies: Colony's site and owners' websites use no tracking cookies (default).
    10. Children: not for anyone under 18. Contact and complaints, including South Africa's Information Regulator.
- **Actions:** read; jump to a heading from the summary; contact support. No acceptance checkbox on the page: acceptance happens at O-01.
- **States:** normal; recently changed ("What changed" note); phone width.
- **Words:**
  - "Your team drafts. You decide what goes out."
  - "We never sell your information." (default)
  - "Your customers' details are yours. We only use them to do the work you ask for."
  - "Credits pay for work inside Colony. They can't be used anywhere else."
  - "If you close your company, we delete everything after 30 days." (pending)
- **Data:** static pages (E-30). The version of the terms each person accepted is recorded at sign-up (default; with E-02).
- **Not here:** the legal text itself (a lawyer writes it), a cookie banner, marketing copy.

---

### W-05 Payment pages

- **Who:** the owner only. Partners never reach these pages (they see "Only Lerato can..." in the app instead).
- **Purpose:** take payment for credits and website hosting safely, then bring the owner straight back to Colony.
- **Get here:** O-05 (first credits in setup); S-02 (buy credits, set up automatic top-up, change card); C-16 (approving website hosting) and D-05 (start or restart hosting); X-04 and X-05 (Buy credits); the hosting payment failed and website paused emails (W-06).
- **Leads to:** back into the app, at the screen that started the payment: O-05 continues to O-07; S-02; D-05; X-05 clears and the team resumes.
- **Shows:**
  1. **Stripe's checkout page**, in the browser: what is being bought ("Colony credits, $15" or "Website hosting for leratodesigns.colony.site, $10 a month"), the Colony name and ant mark, the owner's email, and card and wallet options. Colony controls only Stripe's settings (name, logo, colours), not the page itself.
  2. **Variants of the checkout:** a one-time credit pack; the monthly website hosting payment; saving a card for automatic top-up (no charge now); changing the card used for hosting or automatic top-up.
  3. **Colony's success page:** "Payment received", what was added ("$15 of credits added to Lerato Designs" or "Hosting is on for leratodesigns.colony.site"), and one action, Back to Colony. The app updates by itself, so closing the page is also fine.
  4. **Colony's cancelled page:** "No payment was made", and one action, Back to Colony.
- **Actions:** Pay (owner, on Stripe's page); Back to Colony (owner) -> opens the app at the screen that started the payment; Close.
- **States:**
  - Paid, app open: the app shows the new balance or the hosting status within seconds. Credits are added only when Colony's server confirms the payment with Stripe, never by the browser page.
  - Paid, app closed: the credits are already on the company; they show the next time Colony opens. Back to Colony opens the app.
  - Paid on another device (a phone, a different computer): "Your credits are ready. Open Colony on your computer." (default)
  - Payment still confirming (a slow bank): "Your payment is being confirmed. You can close this page. Colony updates when it's done." The app shows its own confirming state (O-05, S-02).
  - Cancelled: Colony's cancelled page.
  - Declined: shown on Stripe's page; the owner can try another card.
  - Old link: "This payment link has expired. Start again from Colony."
- **Words:**
  - "Payment received. $15 of credits added to Lerato Designs."
  - "Hosting is on. Leo is putting your website live now."
  - "No payment was made. You can try again from Colony anytime."
  - "Your payment is being confirmed. You can close this page."
  - "This payment link has expired. Start again from Colony."
- **Data:** Stripe checkout and its server confirmation WORK for credit packs (USD 5, 15, 50, 120; needs a verified email). The company wallet E-15 (PARTIAL: credits are per account today). Hosting payments E-20 (MISSING). A saved card for automatic top-up E-15 (MISSING). Return links into the app E-01.
- **Not here:** PayFast (default: Stripe only in the new app), coupons, tax invoices with company tax numbers (default: not at launch), refunds.

---

### W-06 Emails

Rules for every email: sent from "Colony" at a colony.global address (default); one short paragraph; exactly one action; works on a phone; no tracking pixels; a footer saying why the person got it, with Terms, Privacy and Contact. Billing emails go to the owner only (default). Colony never emails the owner's customers.

| Email | To | When | Subject | Body | Action |
|-|-|-|-|-|-|
| Sign-in code | The person signing in | They ask for a code at O-02 | "Your Colony code: 482913" | "Here's your code to sign in to Colony: 482913. It works for 10 minutes (default). If you didn't ask for it, you can ignore this email." | The code itself (typed into O-02) |
| Partner invite | The invited person | The owner sends an invite in S-05 | "Lerato invited you to Lerato Designs on Colony" | "Lerato Mokoena invited you to help run Lerato Designs. Colony is where her AI team works: you'll be able to talk to Scout, see everything the team does and approve their work. This invite works for 7 days (default)." | "Join Lerato Designs" -> W-07 |
| Payment receipt | Owner | After every payment: credit pack, automatic top-up, monthly hosting | "Receipt: $15 of Colony credits" or "Receipt: website hosting, October" | What was paid, when, the card's last four digits, and the company. Default: Stripe's own receipt email, with Colony's name and logo set in Stripe. | "View in Colony" -> S-02 |
| Credits low | Owner | The balance drops below about 3 days of the team's usual use (X-04) and automatic top-up is off | "Your team has about 3 days of credits left" | "Lerato Designs has $4.20 of credits left. At this week's pace that's about 3 days of work. Add credits to keep your team going." | "Add credits" -> Colony at S-02 |
| Credits low: top-up failed (variant) | Owner | An automatic top-up is declined | "We couldn't top up your credits" | "Your card was declined, so we couldn't add credits automatically. Lerato Designs has $2.10 left. Update your card to keep your team going." | "Update card" -> W-05 |
| Credits out | Owner | The balance reaches zero (X-05) | "Your team has paused: credits ran out" | "Lerato Designs ran out of credits at 14:20, so your team has paused. Nothing is lost. Add credits and they carry on where they stopped." | "Add credits" -> Colony at S-02 |
| Hosting payment failed | Owner | A monthly hosting payment fails; reminders on day 3 and day 6 (default) | "We couldn't take your website payment" | "The $10 payment for leratodesigns.co.za didn't go through. Your website stays up for 7 more days (default). Update your card to keep it online." | "Update card" -> W-05 |
| Website paused | Owner | The grace period ends unpaid (W-09) | "Your website is paused" | "We paused leratodesigns.co.za because the hosting payment didn't go through. Visitors now see a short 'taking a break' page. Pay and Leo puts it straight back, exactly as it was. We keep your site for 90 days (default)." | "Bring my website back" -> W-05 |
| Company closed | Owner | The owner closes the company (F-22) | "Lerato Designs is closed" | "You closed Lerato Designs on 11 October. Your team has stopped, your website is offline and partners no longer have access. We delete everything on 10 November (default: 30 days). If this wasn't you, contact us now." | "Contact us" |
| Company closed: partner (variant) | Each partner | Same moment | "Lerato Designs is closed" | "Lerato closed Lerato Designs on Colony, so you no longer have access to it." | "Contact us" |

- **Who:** owners, partners and invited people, as listed per email.
- **Purpose:** tell people only what they need to know outside the app, each with one clear action.
- **Get here:** sent by Colony when the events above happen.
- **Leads to:** O-02, W-07, S-02, W-05 or support, as listed.
- **Shows:** subject, one paragraph, one action, footer. Amounts and dates are real values; the sample values above are examples.
- **Actions:** the single action per email (the recipient), as listed. Links open the app when it is installed, otherwise the matching web page.
- **States:** delivered; bounced (the owner's address doesn't work: the app tells the owner in S-08 (default)); a link opened on a phone (pages work on phones; the app can't open there, so the page says to continue on the computer).
- **Words:** as in the table.
- **Data:** sign-in codes use the existing email sender (E-02, PARTIAL: codes exist only for verify and reset today). Invites E-19 (invites WORK on the server; invite emails MISSING). Receipts from Stripe. Every other email E-30 (MISSING).
- **Not here:** newsletters or marketing emails, a weekly summary email (the Friday wrap stays in the app at launch (default)), any email that goes to the owner's customers.

---

### W-07 Invite page

- **Who:** a person invited as a partner.
- **Purpose:** show who invited them and get them into Colony, whether or not Colony is installed yet.
- **Get here:** "Join Lerato Designs" in the partner invite email (W-06), or an invite link the owner copied in S-05 (default: S-05 offers Copy invite link).
- **Leads to:** the app at P-01 (installed), W-02 (not installed), W-01 ("What is Colony?").
- **Shows** (in this order):
  1. "Lerato Mokoena invited you to Lerato Designs."
  2. What a partner can do: talk to Scout, see everything the team does, approve their work. Partners can't change billing.
  3. The main action. The page first tries to open Colony ("Open in Colony"). If nothing opens within a few seconds, it shows "Download Colony" and the install path (default: the page can't know for sure whether Colony is installed).
  4. "After installing, sign in with kagiso@example.com and your invite will be waiting." The invite is matched by the link and by the invited email address.
  5. "This invite works until 18 October."
- **Actions:**
  - Open in Colony (invited person) -> the app at P-01.
  - Download Colony (invited person) -> W-02.
  - What is Colony? (invited person) -> W-01.
  - Keyboard: both actions reachable with Tab; the expiry date is plain text for screen readers.
- **States:**
  - Valid: installed, or not installed.
  - Expired: "This invite has expired. Ask Lerato to send a new one."
  - Already used by this person: "You've already joined. Open Colony."
  - Cancelled by the owner: "This invite was cancelled. Ask Lerato if you still need access."
  - Invalid link: "This link doesn't work. Ask Lerato to send it again."
  - Opened on a phone or tablet: "Colony runs on Mac and Windows. Open this link on your computer." with Copy link.
  - Company closed: "Lerato Designs is no longer on Colony."
- **Words:**
  - "Lerato Mokoena invited you to help run Lerato Designs."
  - "You'll be able to talk to Scout, see everything the team does and approve their work."
  - "Already have Colony? Open it to join."
  - "This invite has expired. Ask Lerato to send a new one."
  - "Colony runs on Mac and Windows. Open this link on your computer."
- **Data:** the invite (server invites WORK: expiry, number of uses, claiming makes the person a member; E-19 PARTIAL: invite emails and the accept flow are MISSING). Company name E-03 (PARTIAL: only a short name today). Opening the app from a link E-01 (join links work in the old app).
- **Not here:** signing in on the web (sign-in happens in the app), company details beyond its name and who invited, a way to message the owner.

---

### W-08 The owner's website (Colony-hosted)

- **Who:** the owner's customers and anyone looking up the business. The owner and partners see it in D-05 (preview and live).
- **Purpose:** a fast, current website for the business that Leo builds and keeps fresh, with clear ways to buy and to get in touch.
- **Get here:** the site's address (leratodesigns.colony.site, or leratodesigns.co.za once connected), the Instagram bio, Naledi's posts, Sipho's messages, search engines.
- **Leads to:** buy links (outside Colony), the contact form (lands with Grace in D-06), the business's social profiles, WhatsApp and email.
- **Shows** (page types; each site uses the ones that fit the business):
  1. **Home:** business name and logo; one line on what it sells; a main photo; a short intro; featured products or the current collection; the current campaign, if any; how to buy; how to get in touch.
  2. **Products or lookbook:** a product list (photo, name, price, sizes or options, buy link) and a page per product (more photos, description, price, sizes, details or care, buy link, "Ask a question", which opens the contact form about that product). A lookbook version for collections shown without prices (default).
  3. **About:** the owner's story and photo, the city, what the business stands for.
  4. **Contact:** a form (name, email or phone, message, and what it's about: an order, a question, something else (default)), plus the WhatsApp, Instagram and email links the owner chose to show. Optional business hours and pop-up locations.
  5. **FAQ and policies:** delivery, returns, sizes, payment. The text comes from Grace's knowledge (D-06) and always matches it.
  6. **Campaign pages:** made by Leo for Maya's campaigns ("Spring linen launch: 1 November"), with the campaign's products, date, offer and buy links. Taken down when the campaign ends.
  7. **On every page:** contact and social links, links to the policies, and a small "Made with Colony" credit (default).
  8. **Form sent:** "Thanks. Lerato Designs will get back to you soon."
  9. **Page not found:** one friendly line and a link to the home page.
  - **Buy link types** (the owner picks per product in D-05 (default)): the owner's own payment link from any provider; the product's page on a shop they already use; a WhatsApp chat with a ready-made message ("Hi, I'd like the Linen Wrap Dress in M"); the order form, which reaches Grace as an order request.
  - **Photos:** product photos are always the owner's real photos. AI-made images may appear only as backgrounds or mood images, never as product photos, and each carries a small "AI-made image" caption (default).
  - **Sharing:** every page has a title, a description and a sharing picture, so links look good in WhatsApp, Instagram and search results.
  - Prices on the site are in the owner's own currency (rand for the sample company), not in credits.
- **Actions** (visitors): browse; open a buy link (leaves the site); send the contact or order form; open WhatsApp, Instagram or email. Everything works by keyboard and screen reader, on phones and computers, and loads quickly on slow mobile data.
- **States:** normal; phone width; computer width; form sending; form sent; form problem ("That didn't send. Check your connection and try again.", keeping what they typed); product sold out (the owner marks it: "Sold out", buy link hidden (default)); campaign ended (its page sends visitors to the home page (default)); preview (inside the app only, in D-05, clearly labelled "Preview", never public); paused (W-09); closed (W-09, closed variant).
- **Words:**
  - "Linen Wrap Dress. R1,250. Sizes S to XL."
  - "Order on WhatsApp"
  - "Ask a question about this dress"
  - "Thanks. Lerato Designs will get back to you soon."
  - "Spring linen launch: 1 November."
  - "This page doesn't exist. Go to the home page."
- **Data:** hosting, pages, publishing, the Colony address, own domains and visit counts: E-20 (MISSING). Contact and order form messages to Grace's customer messages: E-22 (MISSING). Visit counts for Maya's numbers: E-25 (MISSING). Product photos and AI-made images from the photo library: E-31 (MISSING). FAQ and policies from Grace's knowledge: E-08 (PARTIAL). Owner sites live on a separate Colony domain (owner, 11 October); the domain name is confirmed before launch.
- **Not here:** a cart or checkout, customer accounts, stock tracking, a blog (default: not at launch), a live chat window (Grace doesn't chat live), cookie banners, AI-made images used as product photos.

---

### W-09 Website paused page

- **Who:** visitors to a paused or closed website; the owner checking their own site.
- **Purpose:** keep a paused website polite and useful for visitors without exposing the business's payment problem, and point the owner to the fix.
- **Get here:** visiting the site after the hosting grace period ends unpaid (F-09), after the owner cancels hosting and the paid month ends (default), or after the company is closed (F-22, closed variant).
- **Leads to:** the business's public contact links; for the owner, Colony (D-05, and W-05 through the website paused email).
- **Shows** (in this order):
  1. The business name and logo.
  2. "Lerato Designs' website is taking a short break."
  3. Ways to reach the business: the public contact links from the business profile (Instagram, WhatsApp, email) (default: shown).
  4. One small line: "Is this your website? Open Colony to bring it back." (default)
  5. Nothing about payments or money.
  - **Closed variant:** only "This website is no longer available." No business links (default).
  - The owner sees the reason only inside Colony: D-05 shows "Paused: the hosting payment didn't go through" with "Bring it back" (owner) or a read-only note (partner), plus the emails in W-06.
- **Actions:** the contact links (visitors); "Open Colony" (the owner) -> opens the app if installed, otherwise W-01 (default).
- **States:** paused, unpaid; paused, hosting cancelled; closed; restored (once paid, the full site returns at once, exactly as it was).
- **Words:**
  - "Lerato Designs' website is taking a short break."
  - "You can still reach Lerato Designs on Instagram or WhatsApp."
  - "Is this your website? Open Colony to bring it back."
  - "This website is no longer available."
- **Data:** hosting status and the paused page: E-20 (MISSING). Contact links from the business profile: E-04 (MISSING on the server today).
- **Not here:** payment details, debt or warning messages, adverts, links to other businesses.

---

## Defaults in this file

Chosen while writing. They stand unless the owner changes them. The few that need a real answer are collected in the product design, section 9.

1. **The typical week on the pricing page.** Recommendation: measure real starter teams in the real-run gate, publish a range ("about $X to $Y a week"), refresh it monthly, and show no number until it has been measured.
2. **Owners who use their own ChatGPT or Claude plan.** Recommendation: they can set up and run without credits; the first time they want AI-made images, Colony asks them to add credits. Voice notes are free.
3. **Credit basics.** Recommendation: credits never expire, no self-serve refunds (as decided on 24 September), and partners cost nothing extra.
4. **Grace periods and keeping data.** Recommendation: a 7-day grace period after a failed hosting payment before the site pauses; a paused site kept for 90 days; a closed company's data deleted after 30 days.
5. **Extras on the owner's website.** Recommendation: a small "Made with Colony" credit, which the owner can switch off once their own domain is connected; and a visible "AI-made image" caption on any AI-made image used on the public site.
