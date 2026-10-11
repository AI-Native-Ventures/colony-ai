# 06 Settings

Part of the Colony screen pack. Read [00-index.md](00-index.md) first: it defines the IDs, product rules, words, common states, sample company and engine items used here.

Items marked "(default)" are sensible defaults chosen while writing this pack. They stand unless the owner changes them. The ones that most need the owner are listed at the end under "Questions for the owner".

## The Settings area

These rules apply to every S entry.

- **Who:** owner and partners. Everyone sees the same sections. Billing parts are read-only for partners.
- **Sections, in this order:** S-01 Business profile, S-02 Credits and billing, S-03 How your team is powered, S-04 Connections, S-05 People, S-06 Notifications, S-07 Running, S-08 Account, S-09 Help and updates.
- **Opens on:** the section the person used last. The first time, S-01.
- **Attention words:** a section that needs someone shows a short reason next to its name, for example "Credits low" on S-02, "Plan signed out" on S-03, "Forwarding not set up" on S-04, "Update ready" on S-09. The words clear when the cause clears. Attention is always shown in words, never by colour alone.
- **Saving:** single switches and choices save the moment they change and confirm with a toast (G-06). Text fields that belong together (for example contact details in S-01) save with a "Save" action.
- **Keyboard:** Settings opens with the Settings shortcut (G-05). Every control is reachable with Tab and works with Enter or Space. Every confirmation (X-16) starts with focus on the safe choice, and Escape picks the safe choice.
- **Offline:** everything stays readable. Anything that needs the internet is disabled and says "You're offline. This needs the internet."

---

### S-01 Business profile

- **Who:** owner, partner. Both can edit.
- **Purpose:** Keep the facts every employee works from in one place, correct and current.
- **Get here:** Settings (G-01), Business profile section. "Edit" on the business profile card that Scout shows in O-07. A question card (C-02) from an employee who needs a missing fact ("Your phone number is missing. Add it?") opens the right field directly. Links from D-02, D-05 and D-06 when an employee points at a missing fact.
- **Leads to:** D-03 (brand kit, through "Open brand kit"), D-06 (Grace's knowledge, through "Open policies"), S-04 (social account names, through "Change in Connections"), C-01 (Scout's proposed updates after "Update from my links").
- **Shows**, in order of importance:
  1. **Business name:** "Lerato Designs". This is also the company name shown across the app.
  2. **What you sell:** one or two sentences. Sample: "Women's clothing in natural linen and cotton, made in Johannesburg."
  3. **Who buys from you:** one or two sentences. Sample: "Women aged 25 to 45 who like local, made-to-last clothing."
  4. **Where you sell:** choices (online, own shop, markets, stockists) plus city and country. Sample: "Online, weekend pop-up markets. Johannesburg, South Africa."
  5. **Website and where customers buy:** the website address (the Colony site or another site), and the link customers use to pay or order (a shop link or payment link). Leo uses this link for the "Buy" buttons on the website.
  6. **Contact details for customers:** email, phone, WhatsApp number (optional), address (optional). Used on the website and on invoices.
  7. **Brand:** a one-line summary of the brand kit ("Linen white and deep green, warm and confident") with "Open brand kit". The brand kit itself is managed on Naledi's desk (D-03).
  8. **Policies:** a one-line summary ("Delivery, returns, sizes and payment are set") with "Open policies". The policies live in Grace's knowledge (D-06).
  9. **Invoice details** (default): registered business name, registration number and VAT number (both optional), and banking details to print on invoices (optional). Grace uses these on invoices and quotes (C-13).
  10. **Time zone:** taken from the computer at setup, editable. All schedules follow it (morning brief 08:30, Friday wrap, routines).
  11. **Social accounts:** a read-only line ("Instagram @leratodesigns, TikTok @leratodesigns") with "Change in Connections" (S-04).
- **Actions:**
  - Edit a field, then Save (owner, partner) -> the change is saved and the team gets the new facts. Toast: "Saved. Scout will let the team know." Keyboard: Tab to the field, type, Tab to Save, Enter.
  - Change time zone (owner, partner) -> schedules move to the new time zone. The confirmation names the new time of the morning brief.
  - Open brand kit (anyone) -> D-03, brand kit part.
  - Open policies (anyone) -> D-06, knowledge part.
  - Change in Connections (anyone) -> S-04.
  - Update from my links (owner, partner) (default) -> Scout re-reads the website and social links and proposes changes as one decision card (C-01) listing each change. Nothing changes until someone approves.
- **States:**
  - **Normal:** all fields filled from O-03 and O-07.
  - **Missing facts:** an empty field that an employee needs says who needs it and why, for example "Grace needs your banking details to put them on invoices."
  - **Saving, saved, save failed:** failed follows X-19 ("Couldn't save. Check your internet and try again.") with Try again. Typed text is kept.
  - **Changed by someone else:** if Kagiso saved a field after Lerato started editing it, Lerato sees "Kagiso changed this a moment ago" with two choices: "Keep Kagiso's version" or "Use mine". (default)
  - **Follow-up from an employee:** after a change that affects the website or invoices, the right employee follows up with a card. Example: Leo sends a website change (C-10) to update the contact page.
  - **Offline:** fields are read-only and say why.
  - **Partner view:** same as the owner. Partners can edit everything here.
- **Words:**
  - "Saved. Scout will let the team know."
  - "Grace needs your banking details to put them on invoices."
  - "Your morning brief will now arrive at 08:30, Johannesburg time."
  - "Kagiso changed this a moment ago. Keep Kagiso's version or use yours?"
  - "Leo will update your website's contact page with the new number. You'll see the change before it goes live."
- **Data:**
  - Reads and writes the business profile: MISSING today (stored on one computer only). E-04.
  - Business name as the company name: PARTIAL (only a short web name exists on the server). E-03.
  - Time zone for schedules: routines already run on a schedule with a time zone, WORKS. The company time zone setting itself is part of E-04.
  - Passing the profile to employees: PARTIAL (only name, website and description reach employees today). E-04, E-09.
  - Brand kit summary: E-08 (brand kit card), E-31 (photos).
- **Not here:** goals and plans (M-03, D-01), editing the brand kit (D-03), editing policies (D-06), social account names (S-04), billing (S-02), languages other than English.

---

### S-02 Credits and billing

- **Who:** owner (everything). Partner (sees everything; billing actions are read-only).
- **Purpose:** Show what the team has to spend and what it costs, and let the owner add credits and manage payments.
- **Get here:** Settings, Credits and billing section. "Buy credits" in the credits low banner (X-04) and the credits out banner (X-05). "This week's credits" on Team (M-01). "See all spending" from an employee's weekly budget (M-06). The spending line in the Friday wrap (C-19). A money request about website hosting (C-16). Coming back from the payment pages (W-05).
- **Leads to:** W-05 (payment pages in the browser, to buy credits or manage cards), M-06 (an employee's weekly budget), D-05 (website hosting details on Leo's desk), X-16 (turning off auto top-up).
- **Shows**, in order of importance:
  1. **Balance:** "$18.40 in credits", an estimate ("About 14 days at this week's pace") and a status in words: enough, low (X-04) or out (X-05).
  2. **Buy credits:** the packs on the server's price list: $5, $15, $50 and $120. Each adds exactly its price in credits. One line: "Charged in US dollars. Your bank may convert it to your currency."
  3. **This week** (Monday to Sunday in the company time zone) (default): total used ($9.10) and one line per employee with what they used and their weekly budget, for example "Naledi: $3.40 of a $5.00 weekly budget". Each line opens that employee's settings (M-06).
  4. **Auto top-up:** on or off. When on: "When credits drop below $5, buy $15 automatically. At most 4 times a month." (defaults: $5, $15, 4 times; see default 4). Threshold and pack are choices.
  5. **Website hosting:** one status line: "Active: $10 a month, renews 1 November", "Payment problem: update your card by 8 November", "Paused: payment not received", or "Not set up". With "Manage hosting payment" and "Open Leo's desk".
  6. **Payment history:** date, what it was (Credits, Auto top-up, Website hosting), amount, card ending, receipt. The last 12 months, then "Show more".
  7. **Payment cards:** "Manage payment cards", which opens the payment provider's page in the browser.
  8. **What uses credits:** "Credits pay for your team's work. AI-made images always use credits, even when your team runs on your own plan. Website hosting is a separate monthly payment."
- **Actions:**
  - Buy a pack (owner) -> the payment page opens in the browser (W-05). The app shows "Finish paying in your browser" with "Open the payment page again" and "Stop waiting". When paid: toast "Paid. $15 added to your credits." If the team was paused for credits, it resumes (X-05 clears).
  - Turn on auto top-up (owner) -> needs a saved card. Without one, the owner first buys a pack, which saves the card (default). Then the threshold and pack can be chosen.
  - Change auto top-up threshold, pack or monthly limit (owner) -> saved at once.
  - Turn off auto top-up (owner) -> confirmation (X-16), then off.
  - Change a weekly budget (owner, partner) -> M-06 for that employee. Weekly budgets are not billing, so partners can change them.
  - Manage hosting payment (owner) -> the payment provider's page in the browser.
  - Manage payment cards (owner) -> the payment provider's page in the browser.
  - Open a receipt (owner, partner) -> the receipt opens in the browser.
  - Keyboard: every pack, switch and link is reachable with Tab and works with Enter.
- **States:**
  - **Enough credits:** normal.
  - **Low (X-04):** the balance line says "Low: about 2 days left". Buy credits comes first.
  - **Out (X-05):** "Out of credits. Your team is paused." Buy credits comes first. Each employee line says "Paused".
  - **Waiting for payment:** "Finish paying in your browser. This updates when you're done."
  - **Paid:** toast and the new balance.
  - **Cancelled or failed payment:** X-19 pattern, for example "Payment cancelled. Nothing was charged." with Try again.
  - **Auto top-up ran:** a history line "Auto top-up: $15" and an email to the owner (W-06).
  - **Auto top-up failed:** "Auto top-up didn't go through: your card was declined. Update your card or buy credits." Then X-04 or X-05 as the balance falls.
  - **Auto top-up monthly limit reached:** "Auto top-up has bought credits 4 times this month. Buy more yourself or raise the limit."
  - **Hosting payment problem:** "Your website payment didn't go through on 1 November. Update your card by 8 November or your website pauses." (7 days of grace, default). After that, the website shows W-09.
  - **Own plan in use:** a line above the balance: "Your team runs on your Claude plan. Credits pay for AI-made images."
  - **No payments yet:** "No payments yet."
  - **Partner view:** packs, auto top-up, hosting payment and cards are read-only with "Only Lerato can buy credits or change billing." Balance, this week and history stay visible.
  - **Offline:** buying and managing are disabled: "You're offline. Buying credits needs the internet."
- **Words:**
  - "$18.40 in credits. About 14 days at this week's pace."
  - "Naledi: $3.40 of a $5.00 weekly budget."
  - "Paid. $15 added to your credits."
  - "When credits drop below $5, buy $15 automatically. At most 4 times a month."
  - "Only Lerato can buy credits or change billing."
  - "Website hosting: $10 a month, renews 1 November."
- **Data:**
  - Balance: WORKS per person, but must become one balance per company paid by the owner. E-15.
  - Packs and checkout: WORKS (US dollar packs, the payment page and the payment confirmation exist; checkout needs a confirmed email address).
  - Payment history and receipts: WORKS (history and monthly usage totals exist).
  - Usage per employee and this week's totals: MISSING. E-15.
  - Weekly budgets: PARTIAL (stored, never enforced). E-15.
  - Auto top-up, saved cards, the card management page and the monthly limit: MISSING. E-15.
  - Website hosting payment and status: MISSING. E-20.
  - Auto top-up and payment problem emails: E-30.
- **Not here:** refunds (no refunds in the app; contact the Colony team through S-09), other currencies, spending limits per person, separate wallets per partner, Colony invoices beyond the payment receipts.

---

### S-03 How your team is powered

- **Who:** owner (changes). Partner (sees status, read-only) (default).
- **Purpose:** Choose what pays for the team's thinking, Colony credits or the owner's own Claude or ChatGPT plan, and see whether it is working.
- **Get here:** Settings, How your team is powered section. The own plan limit banner (X-06). The own plan disconnected banner (X-07). "Use my own plan instead" in the credits out banner (X-05). The line about own plans in S-02. After moving the team to another computer (N-02), when the plan must be connected there.
- **Leads to:** the connect steps (the same steps as O-06), S-02 (buy credits), X-16 (disconnect confirmation), S-07 (move the team here first).
- **Shows**, in order of importance:
  1. **Current choice and its status:** "Colony credits", "Your Claude plan" or "Your ChatGPT plan", with one status: Working, Limit reached until 14:00, Signed out, or Setting up on this computer.
  2. **The three choices,** one line each:
     - Colony credits: "Pay as you go. Nothing to set up." Shows the balance.
     - Your Claude plan: "Use the paid Claude plan you already have. Your team shares its limits with you."
     - Your ChatGPT plan: "Use the paid ChatGPT plan you already have. Your team shares its limits with you."
  3. **What still uses credits:** "AI-made images always use credits." "Website hosting is a separate monthly payment." "Voice notes work with every choice."
  4. **When your plan is at its limit:** a switch "Use credits until my plan resets" (off by default, see question 1).
  5. **Where the plan is connected:** "Connected on Lerato's MacBook Air, the computer that runs your team." Own plans are connected on the team computer.
- **Actions:**
  - Switch to credits (owner) -> if there are credits, the team switches at once with a toast "Your team now runs on Colony credits." With no credits, it goes to S-02 to buy first.
  - Connect Claude plan or Connect ChatGPT plan (owner, on the team computer) -> the O-06 steps: "Setting up on this computer (about 2 minutes)", sign in in the browser, "Connected". The team switches when connected. If it fails: X-19 pattern with Try again and "Use credits instead". The person may leave the screen while it sets up; a toast says when it is done.
  - Disconnect plan (owner) -> confirmation (X-16). The team switches to credits, or pauses if there are none (X-05).
  - Sign in again (owner, on the team computer) -> when the plan is signed out (X-07), the browser sign-in runs again.
  - Use credits until my plan resets (owner) -> switch on or off.
  - From a computer that does not run the team: "Connect this on Lerato's MacBook Air, where your team runs", with "Move the team here first" (S-07).
  - Keyboard: the three choices work as one group, chosen with the arrow keys and confirmed with Enter.
- **States:**
  - **Credits in use:** shows the balance.
  - **Plan connected and working.**
  - **Setting up:** steps with plain names and a time estimate. Can continue in the background.
  - **Setup failed:** what happened and what to do.
  - **Limit reached (X-06):** shows the reset time if known.
  - **Signed out (X-07):** "Sign in again" comes first.
  - **Not the team computer:** connect actions are replaced by the note and "Move the team here first".
  - **Partner view:** read-only with "Only Lerato can change how the team is powered." (default, see question 2)
  - **Offline:** connect and switch are disabled and say why.
- **Words:**
  - "Your team runs on Colony credits. $18.40 left."
  - "Your team runs on your Claude plan. Working."
  - "Your Claude plan hit its limit. It resets at 14:00, and your team waits until then."
  - "Setting up Claude on this computer. This takes about 2 minutes."
  - "AI-made images always use credits, whichever choice you make."
  - "Connect your plan on Lerato's MacBook Air, the computer that runs your team."
- **Data:**
  - Claude plan sign-in: PARTIAL (a hidden sign-in exists; setup takes minutes). E-17.
  - ChatGPT plan sign-in: MISSING (built but switched off and not connected). E-17.
  - Limit reached, reset time and signed-out signals: MISSING. E-17.
  - Credits as the power: PARTIAL (switched off by default, one choice of AI). E-16.
  - The team's choice is stored for the company and applied on the team computer (default). E-17, E-12.
- **Not here:** choosing AI models, entering keys, other AI services, using different plans for different employees.

---

### S-04 Connections

- **Who:** owner, partner.
- **Purpose:** Set up the few links between Colony and the outside world that the team needs at launch: the forwarding address for customer email, the website's own domain, and the names of social accounts.
- **Get here:** Settings, Connections section. "Set up forwarding" on Grace's desk (D-06) and in Grace's first-week card. The domain line on Leo's desk (D-05). A question card (C-02) from Naledi asking for an account name. "Change in Connections" in S-01.
- **Leads to:** D-05a (Connect your domain), D-05, D-06, S-01.
- **Shows**, in order of importance:
  1. **Customer email for Grace:**
     - The forwarding address, for example "leratodesigns@inbox.colony.global" (sample address; the final address comes with E-21), with Copy.
     - Status: Not set up, Waiting for the first email, Confirmation needed, Working ("Last email arrived at 10:12"), or No emails lately.
     - "Show me how": short steps for Gmail, Outlook and other email services.
     - "Send a test".
  2. **Website domain:** the status from Leo's desk. "Your site is at leratodesigns.colony.site" (no own domain), "Connecting leratodesigns.co.za: waiting for your domain settings", "Connected: leratodesigns.co.za", or "Your domain settings changed and your site can't be reached there". With "Connect your domain" (D-05a) or "Open Leo's desk" (D-05).
  3. **Social accounts:** name or link for Instagram, Facebook, TikTok, LinkedIn and X. Used to open the right app at posting time and as links on the website. One line: "Naledi prepares each post. You post it yourself."
- **Actions:**
  - Copy the forwarding address (anyone) -> toast "Copied".
  - Show me how (anyone) -> the steps for the chosen email service.
  - Send a test (owner, partner) -> Colony sends a test email to the forwarding address. When it arrives: "Test arrived. Grace can see your forwarded emails." If nothing arrives within 2 minutes: "The test didn't arrive. Check the address and try again."
  - Open the confirmation (owner, partner) -> some email services send a confirmation email to the forwarding address before forwarding starts. When that email arrives, this shows "Gmail sent a confirmation link. Open it to finish." Opening it finishes the setup.
  - Connect your domain (owner, partner) -> D-05a. Paying for hosting stays with the owner (S-02).
  - Edit a social account name (owner, partner) -> saved; Naledi and Leo use it.
  - Keyboard: Copy, Show me how, Send a test and each account field are reachable with Tab.
- **States:**
  - **Forwarding not set up:** steps come first.
  - **Waiting for the first email.**
  - **Confirmation needed:** the confirmation link comes first.
  - **Working:** time of the last email.
  - **No emails lately:** "No forwarded emails for 2 weeks. Is forwarding still on in Gmail?" (default: 14 days)
  - **Test sent, test arrived, test failed.**
  - **Domain:** the four states above, as reported by Leo's desk.
  - **No social accounts yet:** "Add your Instagram so Naledi can open it for you at posting time."
  - **Offline:** Copy works. Send a test and editing are disabled and say why.
  - **Partner view:** same as the owner.
- **Words:**
  - "Forward your customer emails here, and Grace drafts every reply."
  - "Gmail sent a confirmation link. Open it to finish."
  - "Test arrived. Grace can see your forwarded emails."
  - "Your website is at leratodesigns.colony.site. Connect your own domain with Leo."
  - "Naledi prepares each post. You post it yourself."
  - "No forwarded emails for 2 weeks. Is forwarding still on in Gmail?"
- **Data:**
  - Forwarding address, incoming email and the confirmation email: MISSING. E-21.
  - Where forwarded emails land (Grace's customer messages): MISSING. E-22.
  - Domain status: MISSING. E-20.
  - Social account names, stored with the business profile: MISSING. E-04.
- **Not here:** posting to social networks from Colony, reading the owner's inbox, sending email from Colony, WhatsApp, any other connection. These are not built, so nothing here mentions them.

---

### S-05 People

- **Who:** owner (everything). Partner (sees everyone, can invite; cannot remove people).
- **Purpose:** See who can use this company's Colony, invite partners and manage invites.
- **Get here:** Settings, People section. A done note (C-20) such as "Kagiso joined Lerato Designs" opens here.
- **Leads to:** X-16 (remove a partner, cancel an invite), W-06 (the invite email that gets sent), P-01 (what the invited person sees).
- **Shows**, in order of importance:
  1. **People:** one line each with name, role, email and last activity. Samples: "Lerato Mokoena, owner, lerato@leratodesigns.co.za, active now"; "Kagiso Dlamini, partner, kagiso@leratodesigns.co.za, active 2 hours ago". The person whose computer runs the team has "runs the team" next to their name.
  2. **Pending invites:** email, who invited, when sent, when it stops working (7 days, default), with Resend and Cancel.
  3. **Invite a partner:** an email field with "Invite", and "Copy invite link" (default: the link works once, for 7 days, so it can be sent on WhatsApp).
  4. **What partners can do:** "Partners see everything and can approve any decision. Only the owner buys credits, changes billing, removes people or closes the company."
- **Actions:**
  - Invite (owner, partner) -> the invite email goes out (W-06) and a pending line appears. Toast: "Invite sent to sizwe@leratodesigns.co.za. It works for 7 days." When a partner invites someone, the owner sees a done note (C-20) "Kagiso invited Sizwe Mthembu."
  - Copy invite link (owner, partner) -> toast "Invite link copied. It works once, for 7 days."
  - Resend (owner, partner) -> a new email goes out and the 7 days start again.
  - Cancel invite (owner, partner) -> confirmation (X-16), then the link stops working.
  - Remove a partner (owner only) -> confirmation (X-16). The partner loses access at once. Their past decisions keep their name.
  - Keyboard: each person and invite line has its actions reachable with Tab.
- **States:**
  - **Just the owner:** "Just you for now. Invite a partner to share the work."
  - **Invite pending.**
  - **Invite expired:** "This invite stopped working. Resend?"
  - **Invite failed:** X-19 pattern ("We couldn't send the invite to sizwe@leratodesigns.co.za. Check the address and try again.")
  - **Already a member or already invited:** "Sizwe is already invited. Resend the invite?"
  - **Partner view:** no Remove actions. "Only Lerato can remove people."
  - **Offline:** inviting and cancelling are disabled and say why.
- **Words:**
  - "Partners see everything and can approve any decision. Only the owner buys credits, changes billing, removes people or closes the company."
  - "Invite sent to sizwe@leratodesigns.co.za. It works for 7 days."
  - "Kagiso invited Sizwe Mthembu."
  - "Remove Kagiso? Kagiso loses access right away. Decisions Kagiso made keep Kagiso's name."
  - "Only Lerato can remove people."
- **Data:**
  - Invites with an expiry and a use limit, and accepting them: WORKS. E-19.
  - Owner and admin roles: WORKS. The partner role (everything except billing) needs its rules. E-19.
  - People list: PARTIAL (no simple list for clients). E-19.
  - Removing a partner: PARTIAL. E-19.
  - Invite emails: MISSING (email is used only for sign-in codes today). E-19, E-30.
  - "Decided by" names on decisions: E-19.
- **Not here:** roles other than partner (for example view-only or bookkeeper), per-person permissions, handing the company to someone else (contact the Colony team), employees (they are on Team, M-01).

---

### S-06 Notifications

- **Who:** each person, for themselves (owner, partner).
- **Purpose:** Choose what pops up on this computer and when Colony stays quiet.
- **Get here:** Settings, Notifications section. "Change notifications" on a notification (G-03). The notification permission prompt (X-20) when notifications were turned off. Step O-09 sends people here later if they skipped it.
- **Leads to:** X-20 (asking for permission), the computer's own notification settings (outside Colony).
- **Shows**, in order of importance:
  1. **Permission on this computer:** "Colony can show notifications on this computer", or "Notifications are off for Colony on this computer" with "Open notification settings" (X-20), or "Colony hasn't asked yet" with "Allow notifications".
  2. **What notifies you,** one line each with a switch (types from G-03):
     - Decisions waiting for you: always on (see question 3).
     - Urgent problems (an employee stuck, the team stopped, credits out): always on (see question 3).
     - Morning brief ready: on.
     - Friday wrap ready: on.
     - Time to post (from Naledi): on.
     - A customer waiting more than a day (from Grace): on.
  3. **Quiet hours:** on, from 21:00 to 07:00 (default). "During quiet hours nothing pops up or makes a sound. Everything waits in Needs you." A switch "Let urgent problems through" (on by default, so things that need you still reach you).
  4. **Sound:** on or off (on by default).
  5. **Where notifications reach you:** "Notifications reach you on computers where Colony is open or in the menu bar or tray. Colony doesn't have a phone app."
  6. **Email (owner only):** "Lerato also gets an email when credits are low or run out, and when a website payment fails." These emails can't be turned off. (default)
- **Actions:**
  - Turn a notification type on or off (each person) -> saved at once for that person.
  - Change quiet hours (each person) -> saved at once.
  - Let urgent problems through (each person) -> switch.
  - Sound on or off (each person) -> switch.
  - Allow notifications or Open notification settings (each person) -> X-20.
  - Send a test notification (each person) (default) -> a test appears; the screen asks "Did you see it?"
  - Keyboard: every switch is reachable with Tab and changes with Space.
- **States:**
  - **Allowed.**
  - **Turned off on this computer (X-20):** the switches still work but a line says nothing will pop up until notifications are allowed.
  - **Not asked yet.**
  - **Quiet hours on now:** "Quiet until 07:00."
  - **Partner view:** the same; each person has their own settings.
  - **Offline:** settings still change on this computer and sync when back.
- **Words:**
  - "Decisions and urgent problems always reach you. You can quiet everything else."
  - "Quiet hours: 21:00 to 07:00. Everything waits in Needs you."
  - "Notifications are off for Colony on this computer. Turn them on in your computer's settings."
  - "Test sent. Did you see it?"
- **Data:**
  - Showing notifications on the computer: WORKS. The rules for when to notify live in the old app today and must move. E-26.
  - Per-person settings, quiet hours and syncing across a person's computers: MISSING. E-26.
  - Owner emails: E-30.
- **Not here:** phone notifications, email digests, muting single conversations, a notification history (Needs you is the history).

---

### S-07 Running

- **Who:** owner, partner. Both can move, pause, resume and restart the team. Settings for "this computer" belong to whoever uses that computer.
- **Purpose:** Control where and how the team runs: which computer, starting with the computer, staying awake, pausing and restarting.
- **Get here:** Settings, Running section. The team on another computer banner (X-13). The team stopped banner (X-10). The paused banner (X-22). Pause and Resume in the menu bar or tray (G-02). Step O-09 after setup. N-01 on a new computer.
- **Leads to:** N-02 (moving your team), X-16 (move the team), X-22 (paused), X-10 (stopped), S-03 (when an own plan must be connected after a move).
- **Shows**, in order of importance:
  1. **Team status:** "Your team is working", "Paused by Kagiso at 14:02", "Paused: out of credits", "Waiting for your Claude plan to reset at 14:00", "Stopped", or "Off: Lerato's MacBook Air has been asleep since 22:10".
  2. **Which computer runs the team:** its name ("Lerato's MacBook Air, this computer") or, on another computer, its name and when it was last seen. On other computers: "Move the team here".
  3. **On this computer:**
     - "Start Colony when this computer starts". On by default on the team computer (set in O-09), off by default on other computers.
     - "Keep this computer awake while it's plugged in". On by default on the team computer. Not shown on other computers.
     - The plain rule: "On battery, your team works while the computer is awake. When the lid closes or the computer sleeps, your team stops and catches up when it wakes."
  4. **Pause the team** or **Resume the team.**
  5. **Restart the team:** "Use this if your team seems stuck."
- **Actions:**
  - Move the team here (owner, partner; only on a computer that doesn't run the team) -> confirmation (X-16), then N-02. If the team runs on an own plan, a line says the plan must be connected on this computer too, or the team uses credits.
  - Start Colony when this computer starts (person at this computer) -> switch.
  - Keep this computer awake while it's plugged in (person at the team computer) -> switch.
  - Pause the team (owner, partner) -> the team pauses (X-22). No confirmation. Toast with Undo (G-06).
  - Resume the team (owner, partner) -> "Your team is back to work."
  - Restart the team (owner, partner; on the team computer) -> "Restarting your team. This takes about a minute." Work in progress continues after the restart. From another computer, this action is replaced by "Someone at Lerato's MacBook Air needs to restart the team, or move the team here." (default)
  - Keyboard: every switch and action is reachable with Tab.
- **States:**
  - **Working.**
  - **Paused by a person (X-22):** Resume comes first.
  - **Paused for credits (X-05):** Resume is replaced by "Buy credits" for the owner and by "Only Lerato can buy credits" for partners.
  - **Waiting for the own plan (X-06):** shows the reset time.
  - **Stopped (X-10):** Restart comes first.
  - **Team computer off or asleep (X-13, on other computers):** Move the team here comes first.
  - **Moving (N-02):** progress in steps.
  - **Restarting.**
  - **Offline:** moving, pausing and restarting are disabled and say why. The switches for this computer still work.
  - **Mac and Windows words:** "menu bar" on Mac, "tray" on Windows.
- **Words:**
  - "Your team runs on Lerato's MacBook Air. Last seen 2 minutes ago."
  - "Move the team here? It stops on Lerato's MacBook Air and starts on this computer."
  - "Keep this computer awake while it's plugged in, so your team keeps working."
  - "When the lid closes, your team stops and catches up when the computer wakes."
  - "Team paused by Kagiso at 14:02. Nothing new starts until someone resumes."
  - "Restarting your team. This takes about a minute."
- **Data:**
  - Menu bar, tray, start with the computer and staying awake: PARTIAL (Mac only; no start with the computer; staying awake is Mac only, off unless turned on, and limited to an hour of idle time). E-11.
  - Which computer runs the team, the lock and the hand-over: MISSING. E-12.
  - Team status: PARTIAL. E-13.
  - Restart the team: PARTIAL. E-29.
  - Pause and resume the whole team: MISSING (the same pause and resume is needed when weekly budgets are enforced). E-15, E-13.
- **Not here:** running the team on two computers at once, running in the cloud, working hours for the team, technical details about the computer.

---

### S-08 Account

- **Who:** each person, for themselves. "Close the company" is for the owner; "Leave the company" is for partners.
- **Purpose:** Your own profile and preferences, signing out, and closing or leaving the company.
- **Get here:** Settings, Account section.
- **Leads to:** X-16 (sign out on the team computer, close the company, leave the company), O-01 (after signing out or leaving), X-12 (the signed-out screen with its reason).
- **Shows**, in order of importance:
  1. **Profile:** name (shown to the team and on decisions, as in "Approved by Kagiso"), photo, email, and how this person signs in ("Signs in with Google" or "Signs in with an email code").
  2. **Appearance** (for this person) (see G-08): theme (Match this computer, Light, Dark) and text size (Default, Large, Larger), as in G-08.
  3. **Sign out.**
  4. **For the owner: Close Lerato Designs.** For a partner: **Leave Lerato Designs.**
- **Actions:**
  - Edit name or photo (self) -> saved; everyone sees the new name and photo.
  - Change theme or text size (self) -> applies at once.
  - Sign out (self) -> on the team computer, a warning first (X-16): the team stops on this computer unless it is moved. Then the sign-in screen (O-01).
  - Close the company (owner only) -> a strong confirmation (X-16) where the owner types the company name. The consequences are listed before the final step:
    - All six employees stop, and everything in Colony is deleted: conversations, desks, drafts, documents and photos.
    - Partners lose access at once and get an email (W-06).
    - The Colony website goes offline and its monthly payment stops. The owner's own domain stays theirs.
    - Unused credits ($18.40) can't be refunded in the app.
    - Payment records are kept because the law requires it.
    - The owner's Colony account closes too, unless they belong to another company (default).
    - This can't be undone. "Want a copy of your things first? Ask the Colony team before you close (Help and updates, S-09)." (default, see question 5)
  - Leave the company (partner) -> confirmation (X-16). The partner loses access at once; their past decisions keep their name. Then the sign-in screen (O-01) with "You left Lerato Designs."
  - Keyboard: every field and action is reachable with Tab. The close confirmation needs the typed company name before its final action works.
- **States:**
  - **Normal.**
  - **Editing, saved, save failed** (X-19).
  - **This is the team computer:** Sign out shows the warning.
  - **Closing:** "Closing Lerato Designs. This takes a minute." Then a final screen: "Lerato Designs is closed. Thank you for working with Colony."
  - **Close failed:** X-19 with "Try again" and "Get help" (S-09).
  - **Offline:** sign out still works on this computer. Closing and leaving are disabled and say why.
- **Words:**
  - "Kagiso Dlamini, partner. Signs in with Google."
  - "Signing out here stops your team on this computer. Move the team first, or it waits until someone signs in here again."
  - "Close Lerato Designs? Your team stops and everything in Colony is deleted: conversations, desks, drafts, documents and photos. This can't be undone."
  - "Unused credits ($18.40) can't be refunded in the app."
  - "Type Lerato Designs to confirm."
  - "Leave Lerato Designs? You'll lose access right away. Decisions you made keep your name."
- **Data:**
  - Name and photo: WORKS (stored per company; photo upload works).
  - Sign-in method: E-02.
  - Signing out: PARTIAL (this computer forgets the sign-in; nothing is cancelled on the server). E-02.
  - Closing the company: PARTIAL (deleting an account likely fails once someone has paid, and companies and their records stay behind). E-28.
  - Leaving the company: E-19, E-28.
  - Appearance is stored for this person (default). G-08.
- **Not here:** changing email or sign-in method (contact the Colony team), handing the company to someone else (contact the Colony team), downloading everything before closing (see question 5), more than one company, languages other than English.

---

### S-09 Help and updates

- **Who:** everyone.
- **Purpose:** Get help, tell the Colony team about problems and ideas, and keep the app up to date.
- **Get here:** Settings, Help and updates section. "Get help" in problem messages (X-19) and on employee problem cards (C-18, X-08). The update ready banner (X-11).
- **Leads to:** X-11 (restart to update), W-02 (download the latest version, if updating fails), W-04 (terms and privacy, in the browser).
- **Shows**, in order of importance:
  1. **Version and updates:** "Colony 2.0.3. You're up to date.", "Checking for updates", "Downloading an update", "An update is ready", or "Couldn't check for updates".
  2. **What's new:** the last three updates in one plain line each.
  3. **Get help:** "Message the Colony team": what happened, and the email address for the reply (filled in). One line: "We reply by email."
  4. **Report a problem:** a description, an optional screenshot, and a choice "Include details from this computer to help us fix it", with a plain list of what is included: the app version, the type of computer, and recent problem messages. "We never include your conversations unless you paste them in."
  5. **Send feedback:** free text.
  6. **Scout can help too:** "Scout can explain how Colony works. Just ask in any conversation."
  7. **Terms and privacy:** links that open in the browser (W-04).
- **Actions:**
  - Check for updates (anyone) -> checking, then up to date or downloading.
  - Restart to update (anyone at this computer) -> X-11. The team pauses for about a minute on the team computer.
  - Send a help message, a problem report or feedback (anyone) -> "Sent. We'll reply by email to lerato@leratodesigns.co.za."
  - Open terms or privacy (anyone) -> the browser.
  - Keyboard: every field and action is reachable with Tab; Send works with Enter from the action.
- **States:**
  - **Up to date, checking, downloading, ready.**
  - **Update failed:** "Couldn't update. We'll try again later." with "Download the latest version" (W-02).
  - **Sending, sent.**
  - **Sending failed:** the text is kept: "Couldn't send. We'll keep your message and try again when you're back online."
  - **Offline:** checking and sending are disabled and say why. Typed text is kept.
- **Words:**
  - "Colony 2.0.3. You're up to date."
  - "An update is ready. Restart Colony to finish. Your team pauses for about a minute."
  - "Tell us what went wrong. Include details from this computer?"
  - "We include the app version, the type of computer and recent problem messages. We never include your conversations unless you paste them in."
  - "Sent. We'll reply by email to lerato@leratodesigns.co.za."
- **Data:**
  - Updates: PARTIAL (automatic updates exist but are unproven; unsigned Mac builds fall back to a manual download). E-27.
  - Help messages, problem reports, feedback and the details from the computer: MISSING. E-33.
  - Terms and privacy pages: E-30.
- **Not here:** logs, file paths, technical details, test versions, live chat with the Colony team.

---

## Defaults in this file

Chosen while writing. They stand unless the owner changes them. The few that need a real answer are collected in the product design, section 9.

1. **When your own plan reaches its limit, should the team switch to credits on its own?** Recommendation: off by default. The limit banner (X-06) offers "Use credits until it resets" as one tap, so spending only happens when someone chooses it.
2. **Can partners change how the team is powered (own plan or credits)?** Recommendation: owner only, because it changes what the company spends.
3. **Should "Decisions waiting" and "Urgent problems" notifications always stay on?** Recommendation: yes. Quiet hours hold decisions overnight; urgent problems come through unless the person turns that off.
4. **Should auto top-up stop after 4 purchases in a month?** Recommendation: yes, with an email after each automatic purchase, so a runaway month can't drain the card.
5. **When the owner closes the company, is everything deleted at once (except payment records), with no download in the app?** Recommendation: yes for launch. The close confirmation says the Colony team can send a copy if asked before closing.
