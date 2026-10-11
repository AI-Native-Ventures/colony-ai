# 09 Flows

End-to-end journeys through the app, step by step. Each step names who acts, on which screen (by ID from 00-index), what they do and what happens. Every flow ends with its success point and the ways it can go wrong, each pointing at the state (X ID) or screen that handles it.

Flows F-01 to F-08 also become the clickable prototype Codex delivers (00-index section 2). The sample company (00-index section 7) is used throughout. "(default)" marks a choice made here because the owner hasn't decided it yet; those choices are collected under "Questions for the owner" at the end.

---

### F-01 Owner first run

- **Goal:** a new owner goes from the landing page to a working starter team, with Scout's first real message on Today, in about 15 minutes of their own time.
- **Who:** the owner (new).
- **Starts when:** the owner decides to try Colony on the landing page.

| # | Who | Screen | Action | Result |
|-|-|-|-|-|
| 1 | Owner | W-01, W-03 | Reads the landing page (and pricing), chooses Download | The download starts; W-02 shows the install steps for their system |
| 2 | Owner | W-02 | Installs and opens Colony | The app opens at O-01 |
| 3 | Owner | O-01 | Chooses Continue with Google or Continue with email. Terms and privacy (W-04) are linked next to the choices | Google: browser sign-in, then back in the app at O-03. Email: O-02 |
| 4 | Owner | O-02 | Types their email, receives the sign-in code email (W-06), types the 6 digits | Signed in. A new company is created behind the scenes (E-03) |
| 5 | Owner | O-03 | Answers short questions in Scout's style: business name, what you sell, who buys, where you sell, links (website, Instagram, TikTok, Facebook). Links can be skipped | Business basics saved to the company (E-04). No credits needed yet |
| 6 | Owner | O-04 | Chooses how to power the team: Colony credits (recommended) or their own ChatGPT or Claude plan | Step 7a or 7b |
| 7a | Owner | O-05, W-05 | Picks a pack ($5, $15, $50 or $120); payment opens in the browser; pays | W-05 success page; back in the app; the balance shows; continues to step 8 |
| 7b | Owner | O-06 | Picks Claude or ChatGPT; Colony sets it up on this computer (progress shown); signs in to the plan in the browser | Connected; continues to step 8 |
| 8 | Scout | O-07 | First real turn: reads the links and shows what it learned as a business profile to confirm | The owner confirms or edits. Saved, and editable later in S-01 |
| 9 | Owner | O-08 | Reviews Scout's proposed team: names, first-week lines, weekly budgets, and the total against the balance. Can untick roles. Chooses Hire team | Team hired; every employee is set to start at once (E-10) |
| 10 | Owner | O-09, X-20 | Keeps "Start Colony with my computer" and "Stay awake while plugged in" on; allows notifications when the computer asks | Saved for this computer (changeable later in S-06 and S-07) |
| 11 | App | O-10, X-18 | Each employee starts and begins reading up, with progress per employee | Lands on T-01 in the app window (G-01) |
| 12 | Scout | T-01 | Posts its first message: what happens next and when plans arrive | Team lines show "Reading up on Lerato Designs" with status chips (G-07). Areas with nothing yet use X-17 |
| 13 | Team | T-01, T-05 | Within the first hour (default target), the company plan arrives as a decision | Continues in F-10 |

- **Success:** the owner is on Today, the team is working, and Scout's first message arrived within 30 seconds of O-10 (default target).
- **If something goes wrong:**
  - No internet at any step -> X-01. The step resumes when the connection is back.
  - Colony can't be reached -> X-02.
  - Wrong or expired code -> O-02's own states; a new code can be sent after 30 seconds.
  - Google sign-in cancelled -> back to O-01.
  - Too many new companies from the same network in an hour -> X-19 ("Try again in an hour.").
  - Payment cancelled -> W-05 cancelled page -> O-05 cancelled state: pick again, or choose a plan instead.
  - Paid while the app was closed -> the credits are on the company; reopening Colony resumes first run at O-07 (default: first run always resumes where it stopped).
  - Plan sign-in fails, or the plan can't be used -> O-06 failed state: try again, or use credits.
  - Scout's first turn fails -> X-09 with Restart Scout. If credits ran out -> X-05.
  - One employee can't start -> O-10 shows which one; Today shows Scout's problem card (C-18) -> F-17.
  - Notifications not allowed -> X-20. Colony still works; S-06 explains how to turn them on later.
  - Computer too old, Colony already open, or disk full -> X-21.
  - Installers are unsigned at launch (owner, 11 October) -> W-02 variant B adds the system warning steps.

---

### F-02 Partner joins

- **Goal:** Lerato brings in Kagiso, who can talk to Scout and approve work but can't touch billing.
- **Who:** the owner and a partner.
- **Starts when:** the owner chooses Invite partner in S-05.

| # | Who | Screen | Action | Result |
|-|-|-|-|-|
| 1 | Owner | S-05 | Types Kagiso's name and email, chooses Send invite | The invite shows as waiting; the partner invite email (W-06) is sent |
| 2 | Partner | W-06 | Opens the email, chooses Join Lerato Designs | The invite page (W-07) opens in the browser |
| 3 | Partner | W-07, W-02 | Colony installed: Open in Colony. Not installed: Download, install, open | The app opens at O-01 |
| 4 | Partner | O-01, O-02 | Signs in with Google or an email code | The invite is matched by the link and the email address |
| 5 | Partner | P-01 | Sees who invited them and what partners can do; chooses Join | Kagiso is a partner (E-19) |
| 6 | Partner | T-01 | Lands on Today in partner view: Scout says hello; billing controls are read-only | Kagiso can talk to Scout and approve decisions |
| 7 | Owner | S-05, C-19 | Sees that Kagiso joined; Scout mentions it in the next brief | From now on, cards he decides show "Approved by Kagiso" (C-00) |

- **Success:** Kagiso approves a decision and the card shows "Approved by Kagiso, 10:42".
- **If something goes wrong:**
  - Invite expired, cancelled or already used -> W-07 states; the owner sends a new invite from S-05.
  - The email didn't arrive -> the owner chooses Resend or Copy invite link in S-05 (default).
  - Kagiso signs in with a different email than the one invited -> P-01 asks whether to join with this account or switch account (default).
  - Kagiso already belongs to another company -> see Gaps (one company per person at launch, default).
  - Kagiso tries to buy credits -> partner view in S-02: "Only Lerato can buy credits."
  - Later, the owner removes Kagiso in S-05 (confirmation X-16) -> Kagiso's app shows X-12: "You no longer have access to Lerato Designs."
  - No internet -> X-01.

---

### F-03 Signing in on a new computer

- **Goal:** the owner signs in on another computer, and the team keeps running on exactly one computer.
- **Who:** the owner. Partners may also move the team (default, see Questions).
- **Starts when:** Colony is installed on a second computer (W-02) and the owner signs in.

| # | Who | Screen | Action | Result |
|-|-|-|-|-|
| 1 | Owner | O-01, O-02 | Signs in | The company is found |
| 2 | Owner | N-01 | Sees "Lerato Designs runs on Lerato's MacBook Air (active 2 minutes ago)". Chooses Keep it there or Move my team here | Keep: step 3a. Move: step 3b |
| 3a | Owner | T-01, S-07 | Keeps it there: everything is visible on this computer; S-07 says which computer runs the team | Done |
| 3b | Owner | N-02, X-16 | Confirms the move: the team stops on the old computer and starts on this one | Progress: stopping there, starting here |
| 4 | Owner | O-09 | Chooses keep-running settings for this computer (start with the computer, stay awake, notifications) | Saved for this computer |
| 5 | App | T-01 | The team runs here | The old computer shows X-13: "Your team now runs on Lerato's iMac" |

- **Success:** exactly one computer runs the team; the other shows everything.
- **If something goes wrong:**
  - The old computer is off or asleep, so it can't hand over -> N-02 offers Move anyway. The old computer stops its copy of the team the moment it wakes and shows X-13.
  - The move fails halfway -> X-10: "Your team stopped. Start it on this computer."
  - When the team stays on the other computer and that computer sleeps -> X-13 here: "Lerato's MacBook Air is asleep. Your team waits until it's back." with Move here.
  - No internet -> X-01.

---

### F-04 Daily loop

- **Goal:** in a few minutes a day, the owner sees what moved and makes the decisions only a person can make.
- **Who:** the owner (a partner works the same way).
- **Starts when:** on a weekday at 08:30, Scout's morning brief is ready.

| # | Who | Screen | Action | Result |
|-|-|-|-|-|
| 1 | Scout | C-19, G-03 | Writes the morning brief: what moved, what's stuck, what needs you | Notification: "Your morning brief is ready" |
| 2 | Owner | G-03, T-01 | Opens the notification | Today: the brief, Needs you (2), a line per employee (G-07) |
| 3 | Owner | T-01, C-04 | Approves Naledi's post from the card on Today (card parts per C-00) | "Approved by Lerato, 08:41"; the post becomes ready to post (F-06) |
| 4 | Owner | T-05, C-10 | Opens Needs you, opens Leo's website change, chooses Make it live | The change is live; Leo's done note (C-20) |
| 5 | Owner | T-01, T-04, T-03 | Writes in Today's message box: "Can we do something for Heritage Day?" (or records a voice note, F-19) | A new conversation starts and Scout replies |
| 6 | Owner | T-06, T-03 | Searches "returns" to find last month's answer about returns | Opens the matching conversation |
| 7 | Team | G-03, T-05 | During the day, new decisions arrive with notifications (respecting quiet hours from S-06) | The owner decides from the notification's card |
| 8 | Owner | G-01, X-14, G-02 | Closes the window. The first time, X-14 explains that the team keeps working from the menu bar or tray | The team keeps working |

- **Success:** Needs you is empty after a few minutes of the owner's time.
- **If something goes wrong:**
  - The computer slept overnight -> X-03 at the top of Today (F-16).
  - Credits low -> X-04 (F-14). Credits out -> X-05 (F-15).
  - An employee is stuck -> X-08 and C-18 (F-17).
  - No internet -> X-01. Colony can't be reached -> X-02.
  - The owner declines or asks for a change -> the employee revises and a new card arrives.

---

### F-05 New topic to done

- **Goal:** the owner says what they want in plain words; Scout organises the team; the owner approves the results.
- **Who:** the owner, Scout, Maya, Naledi, Leo, Sipho, Grace.
- **Starts when:** the owner starts a new conversation from the conversation list (T-02), from Today, or with the new conversation shortcut (G-05).

| # | Who | Screen | Action | Result |
|-|-|-|-|-|
| 1 | Owner | T-04, T-08 | Writes "Let's launch the spring linen collection on 1 November" and adds 6 product photos | The conversation starts |
| 2 | Scout | T-03, C-02 | Names it "Spring launch", says who will do what in 2 to 3 sentences, and asks one question: "Any launch discount?" | The owner answers "10% for the first weekend" |
| 3 | Scout | T-03 | Briefs Maya, Naledi, Leo, Sipho and Grace. The conversation shows who is working ("Naledi is drafting 6 posts") | Work starts |
| 4 | Maya | C-12 | The campaign brief arrives | The owner approves |
| 5 | Naledi | C-07 | AI-made background images to choose from, each labelled AI-made | The owner picks 3 |
| 6 | Naledi | C-05, C-04 | A carousel and posts | The owner approves (posting continues in F-06) |
| 7 | Leo | C-10 | A preview of the campaign page | The owner makes it live |
| 8 | Sipho | C-08 | Messages to stockists about the launch | The owner approves, sends and marks them sent (F-08) |
| 9 | Grace | C-12 | An update to the FAQ for the launch (delivery dates, the discount) | The owner approves |
| 10 | Maya | C-16 | Money request: "Boost the carousel with a $30 Instagram ad?" (paid by the owner on Instagram) | The owner or a partner approves or declines |
| 11 | Scout | C-20, T-02 | Done notes as pieces finish, and a short close-out when the launch is over | The owner archives the conversation in T-02 |

- **Success:** the launch pieces are approved, posts are marked posted, and the campaign page is live.
- **If something goes wrong:**
  - The owner asks for a change -> the employee revises and a new card arrives.
  - An employee is stuck -> X-08 (F-17).
  - Credits run out halfway -> X-05 (F-15).
  - No internet -> X-01. Typed messages wait and send when back.
  - A photo is too large or of an unsupported kind -> T-08 limits, with X-19 wording.

---

### F-06 Social post to posted

- **Goal:** approved posts reach Instagram, Facebook or TikTok on time, posted by a person.
- **Who:** Naledi, Scout, the owner.
- **Starts when:** on Monday, Naledi's weekly batch is ready (her routine, visible in M-04).

| # | Who | Screen | Action | Result |
|-|-|-|-|-|
| 1 | Naledi | C-04, C-05, C-06, G-03 | Drafts next week's posts, a carousel and a reel script; Scout puts them in Needs you as one batch | Notification: "Next week's 5 posts are ready" |
| 2 | Owner | T-05, C-05 | Opens the batch, approves 4, asks for a change on 1 with a note | Approved posts become ready to post in D-03's calendar |
| 3 | Naledi | C-04 | Sends the changed post | The owner approves it |
| 4 | App | G-03 | At the planned time: "Time to post: Spring linen carousel" | Opens the card in its ready-to-post state |
| 5 | Owner | C-05 | Copy caption, Save images, Open Instagram, then posts in Instagram. If an image is AI-made, the card reminds them to switch on Instagram's AI label | Posted, outside Colony |
| 6 | Owner | C-05, G-06 | Mark as posted (can paste the post's link) | A toast with Undo; D-03 shows it as posted |
| 7 | Owner | C-06 | For the reel script: films it with the shot list, posts on TikTok, marks it posted | D-03 shows it as posted |

- **Success:** the week's posts show as posted in D-03.
- **If something goes wrong:**
  - Not marked posted 3 hours after the planned time (default) -> Naledi asks (C-02): "Post it tomorrow at 18:00 instead?"
  - The owner skips a post -> it shows as skipped in D-03.
  - Saving images fails -> X-19.
  - No internet -> X-01 (copying still works; saving images waits).

---

### F-07 Customer message to sent reply

- **Goal:** every customer gets a kind, correct answer quickly, drafted by Grace and sent by a person.
- **Who:** a customer (outside Colony), the owner, Grace, Scout.
- **Starts when:** a customer message reaches Grace in one of three ways: an email forwarded to the company's forwarding address (set up in S-04 or D-06), a message or screenshot the owner pastes (in D-06 or in M-07 with Grace), or the contact form on the owner's website (W-08).

| # | Who | Screen | Action | Result |
|-|-|-|-|-|
| 1 | Customer | W-08 (or outside) | Thabo asks "Where is my order?" | The message lands in D-06's customer messages (E-21, E-22) |
| 2 | Grace | C-02 | Needs one fact she doesn't have: "Has Thabo's order been sent?" | The owner answers "Yes, on Tuesday" |
| 3 | Grace | C-09 | Drafts a reply using what she knows | Scout puts it in Needs you (T-05) |
| 4 | Owner | T-05, C-09 | Reads Thabo's message and the draft; approves it (or asks for a change) | The card shows the ways to send |
| 5 | Owner | C-09 | Copy reply, Open email app (reply ready to paste) or Open WhatsApp; sends; Mark as sent | The thread in D-06 moves to waiting on the customer |
| 6 | Grace | D-06 | When Thabo answers (forwarded again), the thread continues | The same loop |

- **Branches:**
  - Refund or exception: Aisha wants to return a dress 3 days late. Grace asks first with a decision (C-01): "Accept Aisha's late return?" Then she drafts the reply (C-09).
  - A customer waits more than 24 hours: an urgent notification (G-03), "Thabo has waited a day for a reply."
- **Success:** the thread is marked sent and, when nothing more is needed, done.
- **If something goes wrong:**
  - Forwarding isn't set up -> D-06's empty state (X-17) with the setup steps; S-04 can send a test.
  - The test email doesn't arrive -> X-19 with what to check.
  - Credits out -> X-05 (drafts wait).
  - No internet -> X-01.

---

### F-08 Sales outreach

- **Goal:** Sipho finds good leads and drafts messages; the owner sends them; deals move forward.
- **Who:** Sipho, Scout, the owner.
- **Starts when:** on Tuesday, Sipho's lead hunt routine runs.

| # | Who | Screen | Action | Result |
|-|-|-|-|-|
| 1 | Sipho | C-11 | Finds 12 leads that fit the target customers set in D-04 (Juniper and Jade, Kalahari Collective, Brightway Events and more) | Scout puts the list in Needs you |
| 2 | Owner | C-11 | Selects 5 to contact and approves | The others are dropped or kept for later |
| 3 | Sipho | C-08 | Drafts a first message for each (email, Instagram message or WhatsApp text) | The owner approves each, sends it from their own app and marks it sent; D-04 moves them to Contacted |
| 4 | Sipho | C-08 | The daily follow-up check drafts follow-ups that are due | The same approve, send and mark loop |
| 5 | Owner | D-04 or M-07 | Pastes Juniper and Jade's reply: "Send us a line sheet" | Sipho moves them to Talking |
| 6 | Sipho | C-12, C-13 | A line sheet and a quote. Any discount or special terms come first as a decision (C-01) | The owner approves |
| 7 | Owner | D-04 | Marks the deal Won (or Lost) | The Friday wrap mentions it (F-21) |

- **Success:** leads are contacted and tracked through their stages in D-04.
- **If something goes wrong:**
  - No good leads found -> Sipho asks (C-02) to widen the target, for example to more cities.
  - Credits out -> X-05.
  - No internet -> X-01.

---

### F-09 First website and own domain

- **Goal:** Lerato Designs has a live website on Colony, then on its own domain.
- **Who:** Leo, Scout, the owner (billing), a partner (can approve changes but not the hosting payment).
- **Starts when:** in Leo's first week, after the plans are approved (F-10).

| # | Who | Screen | Action | Result |
|-|-|-|-|-|
| 1 | Leo | C-10 | Builds the first version from the business profile, the photo library (D-03) and the brand kit (C-14); sends a preview for computer and phone | It appears in Needs you |
| 2 | Owner | C-10 | Reviews, asks for one change, approves the new version | Going live needs hosting |
| 3 | Scout | C-16 | Money request: website hosting, $10 a month (owner only) | The owner approves |
| 4 | Owner | W-05 | Pays the first month in the browser | Back to Colony |
| 5 | Leo | C-20, W-08 | The site goes live at leratodesigns.colony.site | D-05 shows it live; visits start counting |
| 6 | Leo | D-05, S-04 | Suggests connecting leratodesigns.co.za; the owner opens the connect-your-domain steps (see Gaps) | Leo shows exactly what to enter at the domain seller; S-04 shows the domain's status |
| 7 | Owner | (outside) | Adds the two records at the domain seller | Leo checks every few minutes |
| 8 | Leo | C-20 | "Your website is live at leratodesigns.co.za." | The old address forwards to the new one |

- **Success:** the site is live on the owner's domain, and visits show in D-05 and in Maya's numbers (D-02).
- **If something goes wrong:**
  - A partner approved the change, but hosting needs the owner -> partner view of C-16: "Only Lerato can start website hosting." Scout lets Lerato know.
  - Payment cancelled -> the site stays a preview; Leo asks again the next week (default).
  - The domain records are wrong -> D-05 says in plain words what's different (X-19 pattern).
  - Going live fails -> C-10's "Didn't go live" state with Try again.
  - Later, a monthly payment fails -> the hosting payment failed email (W-06); after 7 days (default) the site shows W-09 and the website paused email goes out; the owner pays in W-05 and the site comes back.

---

### F-10 Approving the 2-week plans

- **Goal:** every employee works to a plan a person approved.
- **Who:** the employees, Scout, the owner.
- **Starts when:** after hiring (F-01 or F-12), and every second Monday from each employee's plan review routine (M-04).

| # | Who | Screen | Action | Result |
|-|-|-|-|-|
| 1 | Employees | (working) | Study the business and do their first-week work: Naledi's brand kit, Grace's FAQ and policies | Each sends a 2-week plan to Scout |
| 2 | Scout | C-03 | Combines them into one company plan (first run), or brings one employee's refreshed plan later | It appears in Needs you |
| 3 | Owner | C-03 | Reads, per employee: goal, weekly outcomes, what they'll ask you, estimated credits. Approves all, or asks for a change on one | Approved plans start |
| 4 | Owner | C-14, C-12 | Approves Naledi's brand kit and Grace's FAQ and policies | Used from now on |
| 5 | Employees | M-03 | Create their tasks; each plan tab shows progress | Work starts |

- **Success:** every employee shows an approved plan in M-03.
- **If something goes wrong:**
  - A change is requested -> that employee revises and sends again.
  - The estimated credits are more than the balance -> C-03 says so; X-04 if the balance is low.
  - No answer for a day -> Scout mentions it in the brief (default).
  - An employee doesn't send a plan -> X-08 (F-17).

---

### F-11 Talking to one employee

- **Goal:** the owner talks to one employee directly when that's easier than going through Scout.
- **Who:** the owner and one employee.
- **Starts when:** the owner opens Team (M-01).

| # | Who | Screen | Action | Result |
|-|-|-|-|-|
| 1 | Owner | M-01, M-02, M-05 | Opens Naledi's page and looks at her Activity tab | Sees what she has done |
| 2 | Owner | M-07 | Writes "Make the captions more playful" | Naledi answers directly; Scout isn't part of this chat |
| 3 | Naledi | C-14 | Sends an updated voice section for the brand kit | The owner approves |
| 4 | Owner | T-03 | Elsewhere, in "Website refresh", writes "@Leo fix the typo on the About page" | Leo answers in that conversation and a change (C-10) follows |

- **Success:** the employee acts on the owner's words.
- **If something goes wrong:**
  - The employee is paused -> M-07 says so, with Resume (X-22 wording for one employee).
  - The employee is stuck -> X-08 (F-17).
  - No internet -> X-01.

---

### F-12 Hiring another employee

- **Goal:** the team grows when the business needs it, with one approval.
- **Who:** the owner (or a partner), Scout.
- **Starts when:** the owner asks Scout ("I need help with my website after all") or Scout sees a need, for example a starter role the owner unticked in O-08.

| # | Who | Screen | Action | Result |
|-|-|-|-|-|
| 1 | Scout | C-15 | Hire proposal: name, role, why, first week, weekly budget | It appears in Needs you |
| 2 | Owner | C-15 | Hire (or Not now) | M-08: the new hire is starting |
| 3 | App | M-08, M-01 | The employee starts and joins the team | Their first week begins |
| 4 | Employee | C-03 | Their 2-week plan arrives | F-10 |

- **Success:** the new employee is working to an approved plan.
- **If something goes wrong:**
  - The employee can't start -> X-08.
  - Credits are low -> C-15 shows the weekly budget against the balance; X-04.
  - Not now -> nothing changes; Scout won't propose it again for 2 weeks (default).

---

### F-13 Pause, restart, let go

- **Goal:** the owner is in control of each employee and of the whole team.
- **Who:** the owner or a partner.
- **Starts when:** the owner opens an employee's Settings tab (M-06), or the menu bar or tray (G-02).

| # | Who | Screen | Action | Result |
|-|-|-|-|-|
| 1 | Owner | M-02, M-06 | Pauses Naledi | Her status chip says Paused (G-07); her open work waits; Scout knows |
| 2 | Owner | M-06 | Resumes Naledi | She continues where she stopped |
| 3 | Owner | M-06 | Restarts Sipho because he's acting oddly | "Restarting", then Working; nothing is lost |
| 4 | Owner | M-06, X-16 | Lets Sipho go. The confirmation says what stays (his drafts, leads and history) and what stops | Sipho leaves the team (M-01); Scout posts a done note (C-20) |
| 5 | Owner | G-02 or S-07 | Pauses the whole team | X-22 everywhere: "Your team is paused. Resume anytime." |
| 6 | Owner | X-22 | Resumes the team | Everyone continues |

- **Success:** what each status chip says matches what each employee is doing.
- **If something goes wrong:**
  - No internet -> X-01.
  - A restart doesn't help -> X-08 (F-17).
  - Letting go fails -> X-19.

---

### F-14 Credits low and top-up

- **Goal:** credits never run out by surprise.
- **Who:** the owner (billing); partners see the warning but can't buy.
- **Starts when:** the balance drops below about 3 days of the team's usual use (default).

| # | Who | Screen | Action | Result |
|-|-|-|-|-|
| 1 | App | X-04, G-04, W-06 | A banner and a Needs you item for the owner; the credits low email | The owner sees it |
| 2 | Owner | S-02 | Chooses Buy credits and picks a pack | W-05 opens in the browser |
| 3 | Owner | W-05 | Pays | Back in Colony; the balance updates; X-04 clears |
| 4 | Owner | S-02, W-05 | Turns on automatic top-up and saves a card | Future top-ups happen by themselves, each with a receipt (W-06) |

- **Success:** the balance is healthy and the warning is gone.
- **If something goes wrong:**
  - A partner sees X-04 -> partner view: "Only Lerato can buy credits. Scout has let her know."
  - The payment fails -> X-04 stays; try again.
  - An automatic top-up is declined -> the top-up failed email (W-06) -> update the card in W-05.

---

### F-15 Credits out and resume

- **Goal:** when credits run out nothing breaks, and the team carries on after a top-up.
- **Who:** the owner and partners.
- **Starts when:** the balance reaches zero.

| # | Who | Screen | Action | Result |
|-|-|-|-|-|
| 1 | App | X-05, G-04, G-03, W-06 | The team pauses safely; a banner on every screen; a notification; the credits out email to the owner | Employees show Paused (G-07) |
| 2 | Owner | S-02, W-05 | Buys credits and pays | Back in Colony |
| 3 | App | T-01 | The team resumes by itself; routines missed while paused run once | Work continues |

- **Branches for owners on their own plan:**
  - The plan's limit is reached -> X-06: "Your Claude plan's limit resets at 14:00." Wait, or switch to credits in S-03.
  - Signed out of the plan -> X-07: reconnect in S-03.
- **Success:** the team is working again and nothing was lost.
- **If something goes wrong:**
  - A partner can't buy -> partner view in S-02.
  - The payment fails -> X-05 stays.

---

### F-16 Computer asleep overnight

- **Goal:** sleeping or quitting is safe; the team catches up when the computer is back.
- **Who:** the owner and the app; a partner sees the effect.
- **Starts when:** the team's computer goes to sleep, or the owner quits Colony.

| # | Who | Screen | Action | Result |
|-|-|-|-|-|
| 1 | Owner | G-02, X-15 | (Variant) Quits Colony from the menu bar or tray. X-15 warns: "Your team stops until you open Colony again." | The team stops |
| 2 | Owner | (the computer) | Closes the laptop at 21:00; the computer sleeps | The team pauses |
| 3 | (outside) | | Overnight, customer emails reach the forwarding address; Naledi's 07:00 routine is missed | Everything waits on Colony's servers |
| 4 | Owner | (the computer) | Opens the laptop at 07:30 | Colony wakes and the team starts again (E-11, E-14) |
| 5 | App | X-03, T-01 | At the top of Today: "Your computer was asleep from 21:04 to 07:31. Grace has 2 new customer messages. Your brief is ready." Missed routines ran once | The owner carries on with F-04 |
| 6 | Partner | X-13 | Overnight, Kagiso's app said: "Lerato's computer is asleep. Your team waits until it's back." | Clears at 07:30 |

- **Success:** nothing is lost and missed work is done exactly once.
- **If something goes wrong:**
  - A catch-up fails -> X-08.
  - Credits ran out overnight -> X-05.
  - Prevention: "Stay awake while plugged in" in S-07.

---

### F-17 Employee stuck

- **Goal:** when an employee fails, the owner hears about it in plain words and fixes it in one click.
- **Who:** Scout and the owner.
- **Starts when:** an employee fails repeatedly (E-29).

| # | Who | Screen | Action | Result |
|-|-|-|-|-|
| 1 | Scout | C-18, G-03, X-08 | Problem card (urgent): "Sipho stopped working twice this morning. Restart him?" | Urgent notification; Sipho's page (M-02) shows the stuck state |
| 2 | Owner | C-18 | Restart Sipho | Status: Starting, then Working (G-07) |
| 3 | Owner | M-05 | (Optional) checks Sipho's activity to see where he stopped | |
| 4 | Scout | C-20 | "Sipho is back." | The problem card is resolved |

- **Branches:**
  - Still stuck after 2 restarts -> C-18 offers Get help -> S-09 (send a problem report).
  - Scout itself has stopped -> X-09 on Today, with Restart Scout.
  - The whole team has stopped -> X-10, with Restart team.
- **Success:** the employee is working and the card is resolved.

---

### F-18 App update

- **Goal:** updates install with almost no interruption.
- **Who:** the owner and partners.
- **Starts when:** a new version has downloaded in the background.

| # | Who | Screen | Action | Result |
|-|-|-|-|-|
| 1 | App | X-11, G-04 | Banner: "Update ready. Restart Colony to update. Your team pauses for about a minute." | Restart now, or Later |
| 2 | App | (quitting) | Later: the update installs the next time Colony quits | |
| 3 | App | S-09 | After the restart, "What's new" is in Help and updates | The team resumes |

- **Branches:**
  - Required update (Colony's service needs a newer app) -> X-11 required: a blocking screen with Update now.
  - A Mac can't update itself while installers are unsigned (owner, 11 October) -> X-11 sends the owner to W-02 to download the new version.
- **If something goes wrong:** the download fails -> Colony tries again later, without bothering anyone.

---

### F-19 Voice note

- **Goal:** the owner talks instead of typing.
- **Who:** the owner (a partner works the same way).
- **Starts when:** the owner chooses the voice note control in any message box: a conversation (T-03), Today's message box (T-01) or a direct chat (M-07).

| # | Who | Screen | Action | Result |
|-|-|-|-|-|
| 1 | Owner | T-07, X-20 | The first time, the computer asks for the microphone | Allowed |
| 2 | Owner | T-07 | Records (a timer shows), stops, listens back, then sends (or deletes) | The voice note appears in the conversation |
| 3 | App | T-07 | Turns it into words; the transcript shows under the voice note | Scout replies to what was said |

- **Success:** Scout's reply shows it understood the voice note.
- **If something goes wrong:**
  - Microphone not allowed -> X-20 explains how to allow it in the computer's settings, with Type instead.
  - Too long (over 5 minutes, default) -> recording stops at the limit and can still be sent.
  - The words can't be made out -> X-19: "Couldn't hear that clearly. Try again or type it."
  - No internet -> it sends when back (X-01).
  - First voice note on this computer -> T-07 gets voice notes ready (about a minute); no credits are used.

---

### F-20 Thursday numbers

- **Goal:** Maya knows the business's numbers without connecting any accounts.
- **Who:** Maya, Scout, the owner.
- **Starts when:** Thursday at 10:00 (default), Maya's numbers routine (visible in M-04).

| # | Who | Screen | Action | Result |
|-|-|-|-|-|
| 1 | Scout | C-17, T-05 | Numbers check-in in Needs you: "How many orders this week? Rough is fine." Optional: sales amount, new followers | Waits quietly; no notification (default) |
| 2 | Owner | C-17 | Fills it in and sends (or Skip) | Saved |
| 3 | Maya | D-02 | Combines the answers with website visits (from W-08) | D-02's numbers update; a line goes into the Friday wrap |

- **Success:** D-02 shows this week's numbers.
- **If something goes wrong:**
  - Skipped -> Maya uses website visits only.
  - No website yet -> Maya uses the answers only.
  - No internet -> X-01.

---

### F-21 Friday wrap

- **Goal:** one short look back and ahead each week.
- **Who:** Scout and the owner.
- **Starts when:** Friday at 16:00 (default), Scout's wrap routine.

| # | Who | Screen | Action | Result |
|-|-|-|-|-|
| 1 | Scout | C-19, G-03 | Writes the wrap: what got done, what's next, credits used this week | Notification: "Your Friday wrap is ready" |
| 2 | Owner | T-01 | Reads it where the brief goes | Can answer in a conversation |
| 3 | Owner | D-01 | Older briefs and wraps are on Scout's desk | |
| 4 | Owner | S-02 | The credits line opens this week's use per employee | |

- **Success:** the owner knows the week in under a minute.
- **If something goes wrong:** the computer is asleep at 16:00 -> the wrap is written when it wakes and shows the real time (F-16).

---

### F-22 Closing the company

- **Goal:** the owner can close the company cleanly; a partner can leave.
- **Who:** the owner (closing), a partner (leaving).
- **Starts when:** the owner chooses Close company in S-08.

| # | Who | Screen | Action | Result |
|-|-|-|-|-|
| 1 | Owner | S-08, X-16 | The confirmation lists what happens: the team stops and is removed, the website goes offline, hosting is cancelled, partners lose access, unused credits aren't refunded (pending), everything is deleted after 30 days (pending). The owner types the company name to confirm (default) | Close |
| 2 | App | W-09 | Stops the team, cancels hosting, takes the website offline (closed variant), removes partners (E-28) | |
| 3 | App | W-06 | Company closed email to the owner, and a short one to each partner | |
| 4 | App | O-01 | The owner is signed out to O-01 with "Lerato Designs is closed." (default) | |

- **Branch:** a partner leaves: S-08, Leave company, confirmation (X-16). The partner's app returns to O-01; the owner sees it in S-05.
- **Success:** the company is closed and everyone affected has been told.
- **If something goes wrong:** closing fails -> X-19: "We couldn't close Lerato Designs. Nothing was deleted. Contact us." -> S-09.

---

## Gaps found while writing (resolved on 11 October)

1. **Connect your domain steps.** Now a formal sub-screen, D-05a, listed in 00-index.
2. **Belonging to more than one company.** G-01 offers a company switcher only to people in more than one company (default).
3. **Where the theme switch lives.** S-08 Account, under Appearance (G-08).
4. **Extra roles.** At launch Scout proposes only the six launch roles (00-index section 4); custom employees come later.
5. **Credits low in Needs you.** The owner gets a C-16 money request of the kind "Buy credits" (owner only).
6. **Adding a customer message by hand.** D-06c Paste a customer message.
7. **Telling people that the terms changed.** Banner G-04p "Terms updated".
8. **Downloading data before closing.** Not at launch; S-08 tells the owner to ask the Colony team for a copy first.

## Defaults in this file

Chosen while writing. They stand unless the owner changes them. Items marked "Decided by the owner" were answered on 11 October.

1. **Who may move the team to another computer?** Recommendation: the owner and partners (this follows "like you, minus billing"), with a notice to the owner whenever a partner moves it.
2. **People in more than one company.** A company switcher shows only for them (G-01, default).
3. **Routine times.** The morning brief at 08:30 on weekdays is already decided. Recommendation: the numbers check-in on Thursday at 10:00 and the Friday wrap at 16:00, both in the owner's time zone.
4. **Posts that weren't marked posted.** Recommendation: 3 hours after the planned time, Naledi suggests a new time.
5. **Letting an employee go.** Recommendation: their drafts, leads and history stay; their open tasks close; Scout lists what was left unfinished.

## Coverage

Every screen, card and state ID from 00-index section 11, and the flows that use it. The flow IDs (F-01 to F-22) are the flows themselves and are not listed.

| ID | Used in flows |
|-|-|
| G-01 | F-01, F-04 |
| G-02 | F-04, F-13, F-16 |
| G-03 | F-04, F-06, F-07, F-15, F-17, F-21 |
| G-04 | F-14, F-15, F-18 |
| G-05 | F-05 |
| G-06 | F-06 |
| G-07 | F-01, F-04, F-13, F-15, F-17 |
| G-08 | none |
| O-01 | F-01, F-02, F-03, F-22 |
| O-02 | F-01, F-02, F-03 |
| O-03 | F-01 |
| O-04 | F-01 |
| O-05 | F-01 |
| O-06 | F-01 |
| O-07 | F-01 |
| O-08 | F-01, F-12 |
| O-09 | F-01, F-03 |
| O-10 | F-01 |
| P-01 | F-02 |
| N-01 | F-03 |
| N-02 | F-03 |
| T-01 | F-01, F-02, F-03, F-04, F-15, F-16, F-19, F-21 |
| T-02 | F-05 |
| T-03 | F-04, F-05, F-11, F-19 |
| T-04 | F-04, F-05 |
| T-05 | F-01, F-04, F-06, F-07, F-20 |
| T-06 | F-04 |
| T-07 | F-19 |
| T-08 | F-05 |
| C-00 | F-02, F-04 |
| C-01 | F-07, F-08 |
| C-02 | F-05, F-06, F-07, F-08 |
| C-03 | F-10, F-12 |
| C-04 | F-04, F-05, F-06 |
| C-05 | F-05, F-06 |
| C-06 | F-06 |
| C-07 | F-05 |
| C-08 | F-05, F-08 |
| C-09 | F-07 |
| C-10 | F-04, F-05, F-09, F-11 |
| C-11 | F-08 |
| C-12 | F-05, F-08, F-10 |
| C-13 | F-08 |
| C-14 | F-09, F-10, F-11 |
| C-15 | F-12 |
| C-16 | F-05, F-09 |
| C-17 | F-20 |
| C-18 | F-01, F-04, F-17 |
| C-19 | F-02, F-04, F-21 |
| C-20 | F-04, F-05, F-09, F-13, F-17 |
| M-01 | F-11, F-12, F-13 |
| M-02 | F-11, F-13, F-17 |
| M-03 | F-10 |
| M-04 | F-06, F-10, F-20 |
| M-05 | F-11, F-17 |
| M-06 | F-13 |
| M-07 | F-07, F-08, F-11, F-19 |
| M-08 | F-12 |
| D-01 | F-21 |
| D-02 | F-09, F-20 |
| D-03 | F-06, F-09 |
| D-04 | F-08 |
| D-05 | F-09 |
| D-06 | F-07 |
| S-01 | F-01 |
| S-02 | F-02, F-14, F-15, F-21 |
| S-03 | F-15 |
| S-04 | F-07, F-09 |
| S-05 | F-02, F-22 |
| S-06 | F-01, F-04 |
| S-07 | F-01, F-03, F-13, F-16 |
| S-08 | F-22 |
| S-09 | F-17, F-18, F-22 |
| X-01 | F-01, F-02, F-03, F-04, F-05, F-06, F-07, F-08, F-11, F-13, F-19, F-20 |
| X-02 | F-01, F-04 |
| X-03 | F-04, F-16 |
| X-04 | F-04, F-10, F-12, F-14 |
| X-05 | F-01, F-04, F-05, F-07, F-08, F-15, F-16, F-19 |
| X-06 | F-15 |
| X-07 | F-15 |
| X-08 | F-04, F-05, F-10, F-11, F-12, F-13, F-16, F-17 |
| X-09 | F-01, F-17 |
| X-10 | F-03, F-17 |
| X-11 | F-18 |
| X-12 | F-02 |
| X-13 | F-03, F-16 |
| X-14 | F-04 |
| X-15 | F-16 |
| X-16 | F-02, F-03, F-13, F-22 |
| X-17 | F-01, F-07 |
| X-18 | F-01 |
| X-19 | F-01, F-05, F-06, F-07, F-09, F-13, F-19, F-22 |
| X-20 | F-01, F-19 |
| X-21 | F-01 |
| X-22 | F-11, F-13 |
| W-01 | F-01 |
| W-02 | F-01, F-02, F-03, F-18 |
| W-03 | F-01 |
| W-04 | F-01 |
| W-05 | F-01, F-09, F-14, F-15 |
| W-06 | F-01, F-02, F-09, F-14, F-15, F-22 |
| W-07 | F-02 |
| W-08 | F-07, F-09, F-20 |
| W-09 | F-09, F-22 |

Used by no flow: **G-08** (themes, text size, smallest window). It is a global design rule rather than a step anyone takes, and its manual theme switch has no settings screen yet (Gaps, item 3).
