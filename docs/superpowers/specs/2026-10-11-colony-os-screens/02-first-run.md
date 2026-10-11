# 02 First run

Part of the Colony screen pack. Read [00-index.md](00-index.md) first: it holds the product rules, the words list, the common states, the sample company and the engine items (E-xx) used below.

This file covers everything between opening Colony for the first time and landing in Today: signing in (O-01, O-02), telling Scout about the business (O-03), powering the team (O-04 to O-06), Scout's first real turn (O-07), hiring the starter team (O-08), keeping the team running (O-09) and the team starting (O-10). It also covers a partner joining from an invite (P-01, P-01a) and signing in on another computer (N-01, N-02).

Anything marked "(default)" was not decided by the owner. It is a sensible starting point and is listed under "Questions for the owner" at the end when it matters.

## Routes through first run

After signing in (O-01, O-02), Colony sends each person to the right place:

| Who is signing in | This computer | Goes to |
|-|-|-|
| A new person with no company and no invite | Any | O-03 |
| A person who opened an invite link | Any | P-01 |
| An owner whose setup is not finished | Any | The first unfinished step (O-03 to O-10), with Scout's line "Welcome back. Let's pick up where we left off." |
| A member of a company whose team runs on this computer | The team computer | T-01 |
| A member of a company whose team runs elsewhere | Any other computer | N-01 |
| A member of more than one company | Any | First chooses the company (default), then the rows above |

Partners never see O-03 to O-10: the company and its team already exist.

## Time budget

Targets for the owner's first run, from the first launch of the installed app to Today. Install and download time is outside this budget (W-02).

| Step | Target | When it takes longer |
|-|-|-|
| O-01 Sign in | 30 seconds with Google, 60 seconds with email | Plain waiting state; help after 2 minutes |
| O-02 Email code arrives | Under 30 seconds | After 2 minutes: "Still nothing? Check your spam folder, or use Google." |
| O-03 Your business | 2 to 3 minutes | Every question but the name can be skipped |
| O-04 Power your team | 15 seconds | None |
| O-05 Buy credits | 1 to 2 minutes, credits shown within 60 seconds of paying | After 60 seconds: "Payment received. Adding your credits." with "Check again" |
| O-06 Connect your plan | 2 to 5 minutes | After 5 minutes: slow state; "Use credits instead" always available |
| O-07 Scout's first words | Under 30 seconds after power is ready | After 30 seconds: progress line. After 90 seconds: problem with "Try again" |
| O-07 Business profile card | Under 3 minutes | "Skip reading my links" appears after 60 seconds |
| O-08 Meet your team | 1 minute | None |
| O-09 Keep your team running | 30 seconds | None |
| O-10 Team starting | Scout ready under 60 seconds, everyone under 2 minutes | After 2 minutes: people may go to Today while the rest finish |
| **Total to Today** | **Under 10 minutes with credits, under 15 minutes with an own plan** | |
| After Today | Each employee says hello within 5 minutes. Scout brings the company plan (all 2-week plans) for one OK within 60 minutes (default target). | Scout says what is late and why |

---

### O-01 Welcome and sign in

- **Who:** anyone opening Colony on this computer without being signed in: a new owner, a returning owner, a partner arriving from an invite.
- **Purpose:** Get the person signed in with Google or an email code, and record that they accept the terms and privacy policy.
- **Get here:**
  - First launch after installing (W-02). Installers are not signed at launch (owner, 11 October), so the computer shows its own warning first; W-02 explains how to get past it.
  - After signing out (S-08) or being signed out (X-12).
  - Opening an invite link (W-07) while signed out: O-01 shows the invite context, then P-01 follows sign-in.
  - "Sign in" in the menu bar or tray menu (G-02).
- **Leads to:** O-02 (email), the browser for Google, then the route table above (O-03, P-01, N-01, T-01 or the first unfinished step).
- **Shows,** in order of importance:
  1. The Colony name and mark, and one line on what Colony is: "Your AI team, running your business with you."
  2. "Continue with Google".
  3. "Continue with email", with an email field.
  4. The terms line: "By continuing, you agree to Colony's Terms and Privacy Policy." Both are links (W-04).
  5. When opened from an invite: "Lerato invited you to join Lerato Designs. Sign in to accept."
  6. "Trouble signing in?" help.
- **Actions:**
  - Continue with Google (anyone) -> opens Google sign-in in the browser; Colony shows "Finish signing in in your browser" with "Open the browser again" and "Cancel". When Google sends the person back, the route table applies. Keyboard: Tab to it, Enter.
  - Continue with email (anyone) -> checks the address looks like an email, sends a 6-digit code -> O-02. Keyboard: type the address, Enter.
  - Open Terms or Privacy (anyone) -> W-04 in the browser.
  - Trouble signing in? (anyone) -> short help: check your email address, use the other sign-in option, contact support (S-09 support address).
- **States:**
  - **First launch:** as above.
  - **Returning after sign out:** the email field is filled with the last email used on this computer (default).
  - **From an invite:** invite line shown (5 above).
  - **Waiting for Google:** "Finish signing in in your browser. We'll bring you back here." with "Open the browser again" and "Cancel".
  - **Google cancelled or closed:** "You closed Google sign-in. Try again, or use your email instead."
  - **Email looks wrong:** "That email doesn't look right. Check it and try again."
  - **Too many tries:** "Too many tries. Wait a minute, then try again."
  - **Offline:** both sign-in actions are unavailable with "Connect to the internet to sign in."
  - **Colony unreachable:** "Colony isn't answering right now. Try again in a minute."
  - **Computer too old:** X-21 instead of O-01.
- **Words:**
  - "Your AI team, running your business with you."
  - "Continue with Google"
  - "Continue with email"
  - "Finish signing in in your browser. We'll bring you back here."
  - "You closed Google sign-in. Try again, or use your email instead."
  - "By continuing, you agree to Colony's Terms and Privacy Policy."
- **Data:**
  - Google sign-in: WORKS (needs Google client ids configured).
  - Email code sign-in: E-02 (PARTIAL: today email sign-in needs a password; codes only verify a new account or reset a password).
  - The account's signing key is held by the server and handed to this computer, then kept in the computer's keychain (WORKS). Keys are never shown.
  - Terms acceptance with time and version: MISSING (E-30 for the pages, E-02 for the record).
  - Return from the browser to the app: Colony links (AS IS).
- **Not here:** passwords, a separate "create account" path (one path for both), Apple or phone sign-in, recovery phrases or keys, choosing a company (after sign-in).

---

### O-02 Email code

- **Who:** anyone who chose "Continue with email".
- **Purpose:** Confirm the email address with a 6-digit code. The same step signs in an existing person and creates a new one.
- **Get here:** O-01 "Continue with email".
- **Leads to:** the route table (O-03, P-01, N-01, T-01, first unfinished step); O-01 to change the email.
- **Shows:**
  1. "Check your email" and the address the code went to.
  2. A 6-digit code entry that accepts typing and pasting.
  3. "Send a new code", available 30 seconds after the last one.
  4. "Use a different email".
  5. A small hint: "The code works for 10 minutes. Check your spam folder if it's not there." (default 10 minutes)
- **Actions:**
  - Enter the code (anyone) -> checks it as soon as 6 digits are in; on success follows the route table. Keyboard: type or paste; Enter also submits.
  - Send a new code (anyone, after 30 seconds) -> sends another code; the old one stops working.
  - Use a different email (anyone) -> O-01 with the field ready.
- **States:**
  - **Waiting for the code:** as above.
  - **Checking:** short wait after the sixth digit.
  - **Wrong code:** "That code didn't work. Check it and try again." The entry clears and keeps focus.
  - **Expired code:** "That code has expired." with "Send a new code".
  - **Too many wrong codes:** "Too many tries. Wait 15 minutes, or continue with Google." (default 15 minutes)
  - **No email after 2 minutes:** "Still nothing? Check your spam folder, or use Google."
  - **New code cooling down:** "Send a new code in 24 seconds."
  - **Offline:** "Connect to the internet to check your code." Typed digits stay.
  - **Colony unreachable:** common problem state with "Try again".
- **Words:**
  - "Check your email"
  - "We sent a 6-digit code to lerato@leratodesigns.co.za."
  - "That code didn't work. Check it and try again."
  - "That code has expired."
  - "Still nothing? Check your spam folder, or use Google."
- **Data:**
  - Sending and checking codes: E-02 (PARTIAL: codes exist for verifying new accounts and resets, with a 30-second resend cooldown and limits of 10 tries per email per minute; sign-in by code alone is MISSING).
  - The code email itself: W-06 (sending WORKS today for verify and reset codes).
- **Not here:** magic links, passwords, phone codes.

---

### O-03 Your business

- **Who:** a new owner.
- **Purpose:** Learn the basics about the business through a short guided chat in Scout's voice. It works with no AI and no credits: the questions are written in advance, and nothing is read from the web yet.
- **Get here:** the route table, after signing in with no company and no invite. Also when resuming an unfinished setup at this step.
- **Leads to:** O-04 after the last question; the same question again when the person goes back to change an answer.
- **Shows:**
  1. A chat with Scout, one question at a time, each with quick replies where they help and a text box for anything else.
  2. "Skip for now" on every question except the business name.
  3. A sense of progress ("2 of 7"), as words for screen readers too.
  4. At the end, a summary card of every answer, each with "Change", and "Continue".

The questions:

| # | Scout asks | Answer | Needed | Used for |
|-|-|-|-|-|
| 0 | "What should I call you?" (only for email sign-ins; Google gives the name) | Text | Yes | Greetings everywhere |
| 1 | "Hi Lerato, I'm Scout. I'll run your team for you. First, what's your business called?" | Text | Yes | Company name, created at once in the background |
| 2 | "Nice. What do you sell?" | Quick replies: "Clothing and fashion", "Food and drinks", "Beauty and wellness", "Services", "Crafts and gifts", "Something else". Then "Tell me a bit more" as text, optional | Yes, one reply is enough | Profile, team proposal |
| 3 | "Who usually buys from you?" | Text, for example "Women in Joburg, 25 to 40, who like local labels" | No | Profile |
| 4 | "Where do you sell today?" | Pick any: "Instagram", "Facebook", "TikTok", "My website", "WhatsApp", "Markets and pop-ups", "My own shop", "Other online stores" | No | Profile, team proposal |
| 5 | "Where can I see your business online? Paste your website, or your Instagram, TikTok or Facebook name." | Any number of links or @names | No | What Scout reads in O-07 |
| 6 | "Where are you based?" | Filled in from this computer's time zone, for example "Johannesburg, South Africa"; can be changed | Yes, filled in | Company time zone, Sipho's leads |
| 7 | "Last one. What would make the next 3 months a win?" | Pick any: "More sales", "More followers", "A better website", "Bulk orders and stockists", "Less admin", plus text | No | Goals, the team's first plans |

- **Actions:**
  - Answer by typing or with a quick reply (owner) -> the next question. Keyboard: type and Enter; quick replies are in the Tab order and work with Enter or Space; multi-pick replies use Space to tick and Enter to send.
  - Skip for now (owner) -> the next question; the answer stays empty.
  - Change an earlier answer (owner) -> that question again, then back to where the person was.
  - Paste links (owner) -> each link or @name becomes its own item that can be removed.
  - Continue (owner, at the summary) -> O-04.
- **States:**
  - **Asking:** as above.
  - **Answer looks wrong:** for question 5 only: "That doesn't look like a link or an @name. Try again, or skip it."
  - **Company being created:** invisible. It starts after question 1 and finishes while the chat goes on.
  - **Company creation failed:** shown at the summary: "I couldn't set up Lerato Designs yet. Try again." with "Try again".
  - **Too many new companies from this network:** shown at the summary: "Too many new companies were set up from this network in the last hour. Try again in 20 minutes." The person can still finish the chat; their answers are kept.
  - **Owner already has the most companies allowed:** "You already run 5 companies on Colony, which is the most for now." with "Get help".
  - **Closing Colony halfway:** answers are kept; the next launch resumes at the same question.
  - **Offline:** answers are kept on this computer and saved when back; the summary's "Continue" waits for the connection: "Connect to the internet to carry on."
  - **No voice:** there is no voice note action in this step (voice comes once the team runs).
- **Words:**
  - "Hi Lerato, I'm Scout. I'll run your team for you. First, what's your business called?"
  - "Nice. What do you sell?"
  - "Where can I see your business online? Paste your website, or your Instagram, TikTok or Facebook name."
  - "Thanks, Lerato. That's all I need for now. Here's what I have."
  - "Too many new companies were set up from this network in the last hour. Try again in 20 minutes."
  - Scout never claims to have read anything in this step: no "I see your Instagram".
- **Data:**
  - Company creation for a new person: E-03 (PARTIAL: behind a setting; by default a new person who is not yet a member anywhere is refused; in the open mode there are limits of 3 per network and 50 per hour overall, and at most 5 companies per owner; only a short web name is stored, the real company name is MISSING).
  - Answers: the business profile on the server, E-04 (MISSING: today it lives on one computer only). Kept on this computer until the company exists.
  - The person's name in the company: profile (WORKS).
- **Not here:** AI, credits, choosing employees, logo or brand colours (later, in the brand kit C-14), prices, a product list.

---

### O-04 Power your team

- **Who:** a new owner.
- **Purpose:** Choose how the team's AI is paid for: Colony credits, or the owner's own ChatGPT or Claude plan.
- **Get here:** O-03 "Continue". Resuming setup at this step.
- **Leads to:** O-05 (credits), O-06 (own plan), O-07 (when power is already in place), O-03 summary (back).
- **Shows:**
  1. One line: "Your team needs AI to think and work. Choose how to power it."
  2. **Colony credits** (recommended): "Buy credits once and you're done. Nothing else to set up. You set a weekly budget for each employee, and most weeks cost less than the budget." With the estimate for a team of six: "Up to $19 a week" (default budgets).
  3. **My ChatGPT or Claude plan:** "If you already pay for ChatGPT or Claude, your team can use your plan. Setting it up takes a few minutes. AI-made images still use credits."
  4. "You can change this later in Settings."
- **Actions:**
  - Choose Colony credits (owner) -> O-05.
  - Choose my plan (owner) -> O-06.
  - "What are credits?" (owner) -> a short explanation in place: credits are paid in advance, employees use them as they work, Colony adds its fee to what the AI costs, and each employee has a weekly budget.
  - Back (owner) -> O-03 summary.
  - Keyboard: arrow keys choose between the two options, Enter continues.
- **States:**
  - **Normal:** as above.
  - **Credits already bought** (setup resumed after paying): "You have $50.00 in credits." with "Continue" -> O-07.
  - **A plan is already set up on this computer:** "Your Claude plan is already set up on this computer." with "Use it" -> O-06 test, then O-07.
  - **Offline:** both choices are unavailable with "Connect to the internet to carry on."
- **Words:**
  - "Your team needs AI to think and work. Choose how to power it."
  - "Colony credits: buy once, nothing else to set up."
  - "Use my ChatGPT or Claude plan"
  - "AI-made images still use credits."
  - "You can change this later in Settings."
- **Data:**
  - Credits balance: WORKS, per person today; the company wallet is E-15 (PARTIAL).
  - Finding a plan already set up on this computer: AS IS (the engine already detects installed AI tools).
  - Weekly estimate: the sum of the default weekly budgets in the six role packs (E-09, E-15).
- **Not here:** other AI providers, keys, choosing models, technical words.

---

### O-05 Buy credits

- **Who:** a new owner. (Later top-ups use the same steps from S-02 and X-04 or X-05.)
- **Purpose:** Buy a credit pack in the browser through Stripe and come back with credits in place.
- **Get here:** O-04 "Colony credits".
- **Leads to:** the browser payment page (W-05), then O-07 once credits arrive; O-04 (back, to choose a plan instead).
- **Shows:**
  1. The packs: $5, $15, $50 and $120. Each says how long it lasts at most at the team's weekly budgets: "$50: at least 2 weeks". Packs are shown by amount, not by name (the names "Starter" and "Growth" would clash with role names) (default).
  2. The recommended pack marked as recommended: $50 (default).
  3. What credits pay for: "Your employees' work and AI-made images."
  4. "You'll pay in your browser. Payments are handled by Stripe; Colony never sees your card."
- **Actions:**
  - Choose a pack (owner) -> selects it. Keyboard: arrow keys.
  - Pay (owner) -> opens Stripe checkout in the browser (W-05) for the chosen pack; Colony shows the waiting state.
  - Open the payment page again (owner, while waiting) -> the same checkout in the browser.
  - Copy the payment link (owner, while waiting, when the browser did not open) -> copies it; toast "Copied."
  - Cancel (owner, while waiting) -> back to the packs.
  - Back (owner) -> O-04.
- **States:**
  - **Choosing:** as above.
  - **Waiting for payment:** "Finish paying in your browser. We'll bring you back here."
  - **Paid and credits added:** "Paid. $50.00 in credits added." -> continues to O-07 by itself after a moment, with "Continue" for keyboard users.
  - **Paid, credits still on the way:** "Payment received. Adding your credits." After 60 seconds: "This is taking longer than usual. Your credits will appear as soon as Stripe confirms." with "Check again" and "Get help".
  - **Cancelled in the browser:** "You cancelled the payment. Choose a pack to try again."
  - **Came back without paying:** "Payment wasn't finished. Choose a pack to try again."
  - **Card declined:** handled on Stripe's page; Colony keeps waiting until the person returns.
  - **Email not confirmed** (should not happen after O-02 or Google): "Confirm your email first." -> O-02.
  - **Offline:** "Connect to the internet to buy credits."
  - **Colony unreachable:** common problem state with "Try again".
- **Words:**
  - "Choose your credits"
  - "$50: at least 2 weeks for your team"
  - "Finish paying in your browser. We'll bring you back here."
  - "Paid. $50.00 in credits added."
  - "You cancelled the payment. Choose a pack to try again."
- **Data:**
  - Packs: WORKS (US dollar packs of $5, $15, $50 and $120; dollar packs add their full value and Colony's fee is charged as credits are used).
  - Stripe checkout and its confirmation: WORKS (needs a confirmed email).
  - Balance: WORKS per person; the company wallet E-15 (PARTIAL).
  - Return from the browser: Colony links (AS IS), W-05.
  - Credits powering employees: the credits gateway, E-16 (PARTIAL: off by default; it must be on before launch).
- **Not here:** card entry inside Colony, prices in rand, auto top-up (offered later in S-02 and X-04), invoices (Stripe emails the receipt, W-06).

---

### O-06 Connect your plan

- **Who:** a new owner who chose their own plan.
- **Purpose:** Let the team use the owner's existing Claude or ChatGPT plan, with no terminal and no technical steps.
- **Get here:** O-04 "Use my ChatGPT or Claude plan". S-03 uses the same steps later.
- **Leads to:** O-07 once connected and tested; O-05 ("Use credits instead"); O-04 (back).
- **Shows:**
  1. "Which plan do you have?" with two choices: "Claude (Pro or Max)" and "ChatGPT (Plus, Pro or Business)" (default plan list, to confirm in E-17).
  2. After choosing, three plain steps with progress: "Get Claude ready on this computer", "Sign in to Claude in your browser", "Check that it works".
  3. "Use credits instead" at every step.
- **Actions:**
  - Choose Claude or ChatGPT (owner) -> starts step 1. Keyboard: arrow keys, Enter.
  - Sign in (owner, step 2) -> opens the plan's sign-in page in the browser.
  - Try again (owner, after a problem) -> repeats the step that failed.
  - Cancel (owner) -> stops and returns to the plan choice.
  - Use credits instead (owner) -> O-05.
- **States:**
  - **Getting ready on this computer:** "Getting Claude ready on this computer. This takes 2 to 5 minutes." with progress in steps, not percentages of files.
  - **Slow:** after 5 minutes: "Still working. A slow internet connection can make this take longer."
  - **Not enough space:** "There isn't enough free space on this computer. Free up 2 GB and try again." (X-21 has the full screen.) (default size)
  - **Getting ready failed:** "Something stopped Claude from getting ready. Try again, or use credits instead."
  - **Waiting for browser sign-in:** "Sign in to Claude in your browser. We'll bring you back here."
  - **Sign-in cancelled:** "You closed the sign-in. Try again, or use credits instead."
  - **Plan can't run a team:** "Your Claude account is on the free plan. Your team needs Claude Pro or Max." with "See Claude plans" (opens the plan page in the browser) and "Use credits instead".
  - **Checking:** "Checking that your plan answers."
  - **Check failed:** "Your plan is connected but didn't answer. Try again in a minute, or use credits instead."
  - **Connected:** "Connected: Claude Pro." -> O-07.
  - **Already set up on this computer:** skips to "Check that it works".
  - **Offline:** "Connect to the internet to carry on."
- **Words:**
  - "Which plan do you have?"
  - "Getting Claude ready on this computer. This takes 2 to 5 minutes."
  - "Sign in to Claude in your browser. We'll bring you back here."
  - "Your Claude account is on the free plan. Your team needs Claude Pro or Max."
  - "Connected: Claude Pro."
- **Data:**
  - Getting the plan's tools onto this computer: CHANGES (today an in-app installer runs downloads that take minutes; on Windows the bundled Colony Agent also needs Git for Windows, which must go: E-17).
  - Claude sign-in: CHANGES (runs hidden today; must open the browser and return).
  - ChatGPT sign-in: MISSING (today it opens a Terminal window; plan sign-in work is merged but switched off and not wired: E-17).
  - Checking the plan's tier and noticing later limits or sign-outs: MISSING (E-17).
  - Testing the connection: exists in the old first run (CHANGES).
  - The plan is connected on this computer only. This matters when the team moves (N-02).
- **Not here:** product names of the tools that run underneath, commands, keys, model choices, a terminal window at any point.

---

### O-07 Scout gets to know you

- **Who:** a new owner.
- **Purpose:** Scout's first real turn: Scout reads the owner's links, completes the business profile and asks the owner to confirm it.
- **Get here:** O-05 or O-06 once power is in place; O-04 when power already existed. Resuming setup at this step.
- **Leads to:** O-08 after the profile is confirmed.
- **Shows:**
  1. The same chat as O-03, now with Scout working for real. Scout's first words arrive within 30 seconds: "Thanks, Lerato. I'm reading your Instagram and website now. This takes a minute or two."
  2. Short progress lines while Scout reads, in plain words: "Looking at your last 30 Instagram posts", "Reading leratodesigns.co.za".
  3. The **business profile card** (a C-12 document card), with each field editable:
     - Business name
     - What you sell, in one sentence
     - Best sellers Scout noticed (up to 3)
     - Who buys
     - Where you sell
     - Price range, if Scout saw prices
     - How you sound, in three words (for example "warm, confident, local")
     - Goals for the next 3 months
     - Links
     - Based in, and the time zone
  4. "Looks right" and "Change something".
- **Actions:**
  - Looks right (owner) -> saves the profile -> O-08. Keyboard: Cmd/Ctrl+Enter on the card.
  - Edit a field (owner) -> edits in place, saves on Enter or when focus leaves.
  - Change something (owner) -> the message box, to tell Scout in words ("We also sell to bridesmaids").
  - Skip reading my links (owner, after 60 seconds) -> Scout stops reading and builds the profile from the answers.
  - Try again (owner, after a problem) -> restarts Scout's turn.
- **States:**
  - **Getting Scout ready:** the first time Scout runs: "Getting Scout ready. The first time takes up to a minute." (shown after 30 seconds without words).
  - **Reading:** progress lines as above.
  - **A link can't be read:** "I couldn't open your Instagram. It might be private. I'll work with what you told me."
  - **No links given:** Scout builds the profile from the answers and says so: "I've filled this in from what you told me."
  - **Profile ready:** the card waits for the owner.
  - **Scout can't start:** after 90 seconds without words: "Scout couldn't start. Try again, or get help." with "Try again" and "Get help".
  - **Credits ran out or plan limit during the turn:** the matching team-paused state (X-05, X-06) with its fix.
  - **Offline:** "You're offline. Scout carries on when you're back."
- **Words:**
  - "Thanks, Lerato. I'm reading your Instagram and website now. This takes a minute or two."
  - "Looking at your last 30 Instagram posts."
  - "Here's Lerato Designs as I understand it. Anything to fix?"
  - "I couldn't open your Instagram. It might be private. I'll work with what you told me."
  - "Scout couldn't start. Try again, or get help."
- **Data:**
  - Starting Scout as an employee on this computer: create and start work today (AS IS); starting at once instead of on the first mention is E-10 (MISSING); the new shell's start-up logic is E-01.
  - Scout's AI: the credits gateway E-16 or the own plan E-17.
  - Reading web pages: the engine's browser for employees (exists).
  - The confirmed profile: E-04 (MISSING server record); handed to every employee as their business context (PARTIAL today: name, website and description only).
  - The profile card: a typed card record, E-08.
  - Time to Scout's first words is measured (proof gate in the product design).
- **Not here:** the team proposal (O-08), payments, any message that pretends to be Scout before Scout is really running.

---

### O-08 Meet your team

- **Who:** a new owner. (Partners never see this step.)
- **Purpose:** Hire the starter team Scout proposes, in one approval.
- **Get here:** O-07 "Looks right".
- **Leads to:** O-09 after hiring; O-07 (back to the profile).
- **Shows:**
  1. Scout's line: "Here's the team I'd start with for Lerato Designs."
  2. Six employee cards, Scout first and already on the team. Each card shows:
     - Photo, first name and role (G-07).
     - Who they report to ("Reports to Maya" for Naledi).
     - One first-week line written for this business, for example Naledi: "Plan your spring linen posts and draft the first week."
     - Their weekly budget in credits (default budgets: Scout $2, Maya $3, Naledi $5, Sipho $3, Leo $4, Grace $2).
     - "Why this role?" with Scout's one-line reason.
  3. The total: "Up to $19 a week. You only pay for what they use."
  4. How far the credits go: "Your $50 covers at least 2 weeks." (Own plan: "Your Claude plan powers the team. AI-made images use credits.")
  5. "Everything public comes to you as a draft first."
- **Actions:**
  - Hire team (owner) -> hires every ticked employee at once -> progress, then O-09. Keyboard: Cmd/Ctrl+Enter, or Tab to it and Enter.
  - Untick or tick an employee (owner) -> they are left out or brought back; the total updates. Scout cannot be unticked. If Maya is left out, Naledi reports to Scout (default).
  - Rename (owner) -> edits the first name in place, using the G-07 name rules. Can also be done later in M-06.
  - Tell Scout what to change (owner) -> the message box ("I don't need a website person, I'm on Shopify"); Scout updates the proposal.
  - Back (owner) -> O-07.
- **States:**
  - **Putting the team together:** "Putting your team together." (under 30 seconds).
  - **Proposal ready:** as above.
  - **Some unticked:** totals and reporting lines update.
  - **Only Scout left:** "Scout can still help on its own, but most work needs the team." Hiring is still allowed.
  - **Name not allowed:** "Names can use letters, spaces, hyphens and apostrophes, up to 20 characters." or "Grace is already on your team. Pick another name."
  - **Credits cover less than a week:** a warning, not a block: "Your credits cover about 4 days at these budgets. You can add more now or later." with "Add credits" (-> O-05) and "Hire anyway".
  - **Hiring:** each employee shows "Hiring Naledi" until done.
  - **One hire failed:** "I couldn't hire Sipho yet." with "Try again"; the others carry on. The owner can continue; Sipho's retry shows later as a problem card (C-18) if it keeps failing.
  - **Offline:** "Connect to the internet to hire your team."
- **Words:**
  - "Here's the team I'd start with for Lerato Designs."
  - "Naledi, Social Media Manager. Reports to Maya. First week: plan your spring linen posts and draft the first week."
  - "Up to $19 a week. You only pay for what they use."
  - "Your $50 covers at least 2 weeks."
  - "Everything public comes to you as a draft first."
- **Data:**
  - Hires: proposal, approval and completion WORK today (the final approval must be the owner; completion needs an employee already created on this computer and its hello message).
  - Role packs with jobs, first-week routines and default budgets: E-09 (MISSING: the format exists, the content does not).
  - Starting each employee at once, not on its first mention: E-10 (MISSING).
  - Weekly budgets: written as allowances (PARTIAL: stored but not enforced, E-15).
  - Names and photos: profile per company (WORKS).
  - Adding employees to the company's conversations: WORKS.
- **Not here:** a catalogue of other roles, custom employees, choosing skills or models, changing budgets (later in M-06).

---

### O-09 Keep your team running

- **Who:** a new owner on the computer that will run the team. (Partners get P-01a instead; a moved team gets the same choices at the end of N-02.)
- **Purpose:** Set this computer up so the team keeps working: open Colony when the computer starts, keep the computer awake while plugged in, and allow notifications.
- **Get here:** O-08 after hiring.
- **Leads to:** O-10.
- **Shows:**
  1. One line: "Your team works on this computer. When it's off or asleep, they pause and catch up when it's back."
  2. Three choices, all on by default:
     - "Open Colony when this computer starts"
     - "Keep this computer awake while it's plugged in" (computers without a battery: "Keep this computer awake")
     - "Let Colony send notifications"
  3. What closing the window does. Mac: "Closing the window keeps your team working. Colony stays in the menu bar; quit it there to stop your team." Windows: "Closing the window keeps your team working. Colony stays in the tray near the clock; quit it there to stop your team."
- **Actions:**
  - Turn each choice on or off (owner) -> saved at once. Keyboard: Tab and Space.
  - Allow notifications (owner) -> Mac: the computer asks for permission. Windows: notifications are usually already allowed; Colony checks and shows the result.
  - Continue (owner) -> O-10.
- **States:**
  - **Normal:** as above.
  - **Notifications allowed:** "Notifications are on."
  - **Notifications refused:** "Notifications are off. You'll only see decisions while Colony is open. You can turn them on later in your computer's settings." with "Open settings".
  - **The computer adds its own message** about Colony opening at start (Mac shows a note that Colony was added to login items): nothing to do; Colony mentions it: "Your Mac may tell you Colony will open when it starts. That's this setting."
  - **Desktop computer (no battery):** the second choice drops the "plugged in" part.
- **Words:**
  - "Your team works on this computer. When it's off or asleep, they pause and catch up when it's back."
  - "Open Colony when this computer starts"
  - "Keep this computer awake while it's plugged in"
  - "Closing the window keeps your team working."
  - "Notifications are off. You'll only see decisions while Colony is open."
- **Data:**
  - Open with the computer: MISSING (E-11).
  - Stay awake: Mac only, off unless turned on, stops after 1 hour of no use (CHANGES, E-11: needs Windows, needs "while plugged in", no 1-hour stop).
  - Close to the tray on Windows: MISSING (E-11).
  - Notification permission: read from the computer (E-26).
  - All three saved on this computer and shown again in S-07.
- **Not here:** the microphone (asked the first time someone records a voice note: T-07, X-20), battery saving details, which computer runs the team (S-07).

---

### O-10 Team starting

- **Who:** a new owner.
- **Purpose:** Show each employee getting ready, then land in Today where Scout's first message is a real turn.
- **Get here:** O-09 "Continue".
- **Leads to:** T-01 Today.
- **Shows:**
  1. "Your team is getting ready. This takes about a minute."
  2. One line per hired employee, Scout first, with their status (G-07): "Starting", then "Free", then what they are doing first ("Reading up on Lerato Designs").
  3. "Go to Today", available as soon as Scout is ready.
- **Actions:**
  - Go to Today (owner) -> T-01. Colony also goes there by itself once everyone is ready. Keyboard: Enter.
  - Try again (owner, on a failed line) -> restarts that employee.
- **States:**
  - **Starting:** as above.
  - **Slow:** after 2 minutes: "Taking longer than usual. Your team will keep getting ready while you look around."
  - **One employee failed:** "Leo couldn't start." with "Try again". If the owner goes on to Today, Scout raises a problem card (C-18) about Leo.
  - **Scout failed:** Today cannot work without Scout: "Scout couldn't start. Try again, or get help." with "Try again" and "Get help". "Go to Today" stays unavailable until Scout runs.
  - **Credits ran out or plan limit:** the matching team-paused state with its fix (X-05, X-06).
  - **Offline:** "You're offline. Your team starts when you're back."
  - **Landing in Today:** T-01 shows Scout's first message, written by Scout in a real turn: it greets the owner by name, says what happens next and asks what to focus on first. The team line shows everyone reading up.
- **Words:**
  - "Your team is getting ready. This takes about a minute."
  - "Naledi: Reading up on Lerato Designs"
  - "Leo couldn't start."
  - Scout's first message in Today (example of a real turn): "Welcome to your team, Lerato. Everyone is reading up on Lerato Designs, and their 2-week plans will reach you for one OK within the hour. What should we focus on first?"
- **Data:**
  - Starting employees and their states (starting, ready, failed): AS IS in the engine; the "ready" state reaches the engine only through the old app's screens today (E-13); the new shell takes over start-up (E-01).
  - Hire completion and the first instruction to each employee: E-10 (MISSING: employees start on their first mention today).
  - Scout's first turn in Today: E-01, E-10; today the old app posted a written-in-advance message instead, which this design replaces.
  - Employees' hello messages: WORK (required for hire completion).
- **Not here:** the plans themselves (they arrive later as C-03 cards), logs, technical progress, per-file download bars.

---

### P-01 Join a company

- **Who:** a person invited as a partner.
- **Purpose:** Accept an invite and land in Today as a partner.
- **Get here:**
  - The invite email (W-06) -> the invite page (W-07) -> "Open Colony" opens P-01 when Colony is installed and signed in.
  - Not installed: W-07 -> W-02 -> install -> O-01 with the invite context -> sign in -> P-01. If Colony did not receive the invite during install, O-01 says: "Got an invite? Open the link in your email again."
  - Signed out: O-01 with the invite context, then P-01 after sign-in.
- **Leads to:** P-01a after accepting; O-01 ("Use a different account"); after "Not now": G-01 at the person's other company when they already belong to one, otherwise a short note with "Start my own business" (-> O-03) and "I'll use the invite later" (closes the window) (default).
- **Shows:**
  1. "Lerato invited you to join Lerato Designs as a partner."
  2. What partners can do: "See everything, talk to Scout and the team, and approve decisions. Billing stays with Lerato."
  3. Who they are signed in as: "You're signed in as kagiso@leratodesigns.co.za."
  4. "Accept" and "Not now".
- **Actions:**
  - Accept (the invited person) -> joins the company -> P-01a. Keyboard: Enter.
  - Not now (the invited person) -> leaves the invite unused; it stays valid until it expires.
  - Use a different account (the invited person) -> signs out -> O-01 with the invite context.
- **States:**
  - **Valid invite:** as above.
  - **Signed in with a different email:** "This invite is for kagiso@leratodesigns.co.za. Sign in with that email to join." with "Use a different account". Accepting is not possible (default: invites belong to one email address).
  - **Expired:** "This invite has expired. Ask Lerato to send a new one." (default expiry 7 days)
  - **Cancelled or already used:** "This invite was cancelled or already used. Ask Lerato for a new one."
  - **Already a member:** "You're already part of Lerato Designs." with "Open".
  - **Company closed:** "Lerato Designs is no longer on Colony."
  - **Joining failed:** "That didn't work. Try again." with "Try again".
  - **Offline:** "Connect to the internet to join."
- **Words:**
  - "Lerato invited you to join Lerato Designs as a partner."
  - "See everything, talk to Scout and the team, and approve decisions. Billing stays with Lerato."
  - "This invite is for kagiso@leratodesigns.co.za. Sign in with that email to join."
  - "This invite has expired. Ask Lerato to send a new one."
- **Data:**
  - Invites: WORK (an owner or admin creates them with an expiry and a number of uses; claiming one makes the person a member).
  - Tying an invite to one email address, the partner role (everything except billing) and the email itself: E-19 (PARTIAL: invites are links today, not tied to an email).
  - The person's name in the company: profile (WORKS).
- **Not here:** payment, powering the team, hiring, the business chat.

### P-01a Stay in the loop

- **Who:** a partner who just joined.
- **Purpose:** Set the partner's computer up to receive decisions: notifications and opening with the computer. This computer does not run the team.
- **Get here:** P-01 "Accept".
- **Leads to:** T-01 Today (partner view).
- **Shows:**
  1. "You'll get decisions as notifications while Colony is running. Lerato's team runs on Lerato's MacBook Air."
  2. Two choices, on by default: "Open Colony when this computer starts" and "Let Colony send notifications".
  3. "Continue".
- **Actions:** turn each choice on or off (partner) -> saved at once; allow notifications (partner) -> same as O-09; Continue (partner) -> T-01.
- **States:** notifications allowed; notifications refused (same words as O-09); team not running anywhere yet (the owner has not finished setup): "Lerato's team isn't running yet. You'll see it here once it is."
- **Words:**
  - "Lerato's team runs on Lerato's MacBook Air."
  - "Open Colony when this computer starts"
  - "Let Colony send notifications"
- **Data:** E-11 (open with the computer), E-26 (notifications), E-12 (which computer runs the team).
- **Not here:** keeping the computer awake (only the team computer needs it). T-01 then shows Scout's short welcome to the partner, written in a real turn (default): "Hi Kagiso, I'm Scout. I run the team for Lerato Designs. Ask me anything about what we're working on."

---

### N-01 Welcome back

- **Who:** an owner or partner signing in on a computer that does not run the team: a second laptop, a new laptop, or the same laptop after Colony was reinstalled.
- **Purpose:** Explain that the team runs on another computer and let the person keep it there or move it here.
- **Get here:** the route table, after O-01 or O-02.
- **Leads to:** T-01 ("Keep it there"), N-02 ("Move it here"), the first unfinished first-run step (when the owner's setup never finished).
- **Shows:**
  1. "Welcome back, Lerato."
  2. Where the team runs and when that computer was last seen: "Your team runs on Lerato's MacBook Air. Last seen 2 minutes ago."
  3. "Your team can only run on one computer at a time."
  4. "Keep it there" and "Move it here".
- **Actions:**
  - Keep it there (owner, partner) -> T-01; this computer shows everything but does not run the team.
  - Move it here (owner, partner (default)) -> N-02.
  - Keyboard: Tab, Enter.
- **States:**
  - **Team computer online:** as above; "Keep it there" is the suggested choice.
  - **Team computer off for a while:** "Your team ran on Lerato's MacBook Air until 09:12 on Thursday. Move it here so they can keep working?" "Move it here" is the suggested choice.
  - **Team never started** (owner's setup unfinished): straight to the unfinished step instead of N-01.
  - **Partner:** words name the owner's computer; moving follows the N-02 power rules.
  - **Several companies:** the company is chosen first.
  - **Offline:** "Connect to the internet to see your team."
- **Words:**
  - "Welcome back, Lerato."
  - "Your team runs on Lerato's MacBook Air. Last seen 2 minutes ago."
  - "Your team can only run on one computer at a time."
  - "Your team ran on Lerato's MacBook Air until 09:12 on Thursday. Move it here so they can keep working?"
- **Data:**
  - Which computer runs the team and when it was last seen: E-12 (MISSING: there is no lock and no hand-over today; live presence exists only while connected).
  - Company membership: WORKS. Business profile: E-04.
- **Not here:** running the team on two computers, choosing which employees run where.

---

### N-02 Moving your team

- **Who:** an owner, or a partner (default), who chose "Move it here".
- **Purpose:** Move the whole team to this computer safely, so it never runs in two places.
- **Get here:** N-01 "Move it here"; the G-04h banner "Move team here"; S-07 "Move team here".
- **Leads to:** T-01 after the move, with the O-09 choices shown first; N-01 or the previous screen when cancelled; O-06 or O-05 when power is needed here.
- **Shows:**
  1. The confirmation: "Move your team to this computer? On Lerato's MacBook Air, your team will stop."
  2. What moves: all employees, their work in progress and their schedules.
  3. What this computer needs: when the team runs on credits: nothing ("Credits work on any computer"). When it runs on the owner's plan: "Your team uses Lerato's Claude plan. Connect a plan on this computer or use credits." The plan must be connected here before moving.
  4. "Move team" and "Cancel".
  5. After confirming: one line per employee ("Moving Naledi", then "Starting", then "Free").
  6. When done: "Your team now runs on this computer." followed by the O-09 choices for this computer.
- **Actions:**
  - Move team (owner, partner) -> starts the move. Keyboard: Cmd/Ctrl+Enter.
  - Connect a plan (owner on this computer; a partner may connect their own plan) -> O-06 steps, then back here.
  - Use credits (owner; a partner only when the company already has credits (default)) -> back here with credits as power.
  - Cancel (owner, partner) -> nothing changes.
  - Try again (owner, partner, after a problem) -> retries what failed.
- **States:**
  - **Confirming:** as above.
  - **Old computer online:** it hands the team over, stops its employees, and shows X-13 there with a "Team moved away" notification (G-03).
  - **Old computer off:** "Lerato's MacBook Air is off. Your team moves here now. When that computer comes back, it will see that the team moved and won't start it." The move goes ahead.
  - **Moving:** per-employee lines as above.
  - **One employee failed to move:** "Sipho didn't move yet." with "Try again"; the others run here.
  - **Move failed:** "Your team is still on Lerato's MacBook Air. Try again." Nothing changed.
  - **Power needed here:** the move waits until a plan is connected or credits are chosen.
  - **Offline:** "Connect to the internet to move your team."
  - **Done:** as above, then T-01.
- **Words:**
  - "Move your team to this computer? On Lerato's MacBook Air, your team will stop."
  - "Credits work on any computer."
  - "Your team uses Lerato's Claude plan. Connect a plan on this computer or use credits."
  - "Moving Naledi"
  - "Your team now runs on this computer."
- **Data:**
  - The one-computer rule and hand-over: E-12 (MISSING). Today employees' private keys live only in the keychain of the computer that created them, so a hand-over must move them safely or keep them on the server, as the account key already is.
  - Settings for this computer: E-11. The plan per computer: E-17. Catching up on anything missed during the move: E-14.
- **Not here:** splitting the team across computers, moving one employee, moving conversations (they are on the server and need no move).

---

## Defaults in this file

Chosen while writing. They stand unless the owner changes them. Items marked "Decided by the owner" were answered on 11 October.

1. **Default weekly budgets and the first pack.** Decided by the owner on 11 October: Scout $2, Maya $3, Naledi $5 (AI-made images), Sipho $3, Leo $4, Grace $2, so up to $19 a week; recommend the $50 pack first (at least 2 weeks), with $15 as the smaller choice.
2. **Partners moving the team to their own computer.** Recommendation: allowed after the confirmation, as long as the team can be powered there by the company's existing credits or the partner's own plan.
