# 07 System states and dialogs

Part of the Colony screen pack. Read [00-index.md](00-index.md) first: it defines the IDs, product rules, words, common states, sample company and engine items used here.

Every X entry uses the entry template from 00-index section 9, plus three extra lines: **Trigger** (exactly what causes it), **Where it shows** (which IDs) and **Clears when**. Items marked "(default)" are sensible defaults chosen while writing this pack; the ones that most need the owner are listed at the end under "Questions for the owner".

## When several states happen at once

- **States that replace the app on one computer:** X-21 (system too old), X-11 (update required) and X-12 (signed out). Only one shows, in that order.
- **Banners:** every other team-wide state uses the one banner pattern (G-04). Only one banner shows at a time: the highest in the list below. When it clears, the next one shows.
- **Not banners:** the problem card for one employee (X-08, C-18), the Today item (X-03), confirmations (X-16), the first close explanation (X-14), the quit question (X-15), permissions (X-20), empty states (X-17), loading (X-18) and problem messages (X-19). These can appear together with any banner.

Banner priority, highest first. This is the same order as the G-04 banner catalogue, which is the single source.

1. X-01 Offline (G-04f)
2. X-02 Colony unreachable (G-04g)
3. X-10 Team stopped (G-04a)
4. X-09 Scout stopped (G-04b)
5. X-05 Credits out (G-04c)
6. X-06 Own plan limit reached (G-04d)
7. X-07 Own plan disconnected (G-04e)
8. X-13 Team runs on another computer, while that computer can't be reached (G-04h)
9. X-21 Disk almost full (G-04o)
10. X-22 Team paused by a person (G-04i)
11. Website paused (G-04j, W-09)
12. X-04 Credits low (G-04k)
13. Images paused (G-04n)
14. X-11 Update ready (G-04l)
15. Notifications off (G-04m, X-20)
16. Terms updated (G-04p, W-04)

The reason for the order: nothing else can be trusted until this computer and Colony are connected. After that comes whatever stops the whole team, then money, then single problems and reminders.

---

### X-01 Offline

- **Who:** anyone on the computer that lost its internet connection.
- **Purpose:** Say the internet is gone, what still works, and that nothing is lost.
- **Trigger:** this computer has no internet connection, or can't reach anything for 5 seconds (default).
- **Where it shows:** the banner (G-04) on every screen of this computer. The menu bar or tray status (G-02) says "Offline". Disabled actions say "You're offline. This needs the internet."
- **Get here:** appears on its own.
- **Leads to:** nothing. It clears on its own.
- **Shows:** the line "You're offline"; after a minute, since when ("Offline since 09:14"); what still works ("You can read and type. Messages send when you're back."); on the team computer, "Your team waits until you're back."
- **Actions:** Try again (anyone) -> checks the connection now. Keyboard: the banner's action is reachable with Tab, and the banner is announced once to screen readers.
- **States:**
  - **Just went offline.**
  - **Offline for a while:** shows since when.
  - **Messages waiting:** "2 messages will send when you're back." Waiting messages are kept on this computer even if Colony quits (default).
  - **Back online:** toast "Back online. 2 waiting messages sent." Then the banner goes.
- **Words:**
  - "You're offline. Your team waits until you're back."
  - "You can read and type. Messages send when you're back."
  - "Offline since 09:14."
  - "Back online. 2 waiting messages sent."
- **Clears when:** the connection works again.
- **Data:** connection state and waiting messages on this computer: E-01. Employees pick up again on their own: E-29. Anything that arrived meanwhile is caught up: E-14.
- **Not here:** fixing the network, Wi-Fi settings.

---

### X-02 Colony unreachable

- **Who:** everyone.
- **Purpose:** Say Colony isn't answering, that work is safe, and that Colony keeps trying.
- **Trigger:** the internet works but Colony's service hasn't answered for 15 seconds (default), or it reports that it is having trouble.
- **Where it shows:** the banner (G-04) on every screen. The menu bar or tray status (G-02) says "Can't reach Colony".
- **Get here:** appears on its own.
- **Leads to:** nothing. It clears on its own.
- **Shows:** what is happening, that work is safe, that Colony keeps trying. After 2 minutes: "Still trying."
- **Actions:** Try now (anyone) -> tries at once.
- **States:**
  - **First minutes.**
  - **Longer than 2 minutes:** "Still trying. Your work is safe."
  - **Back:** toast "Connected again." The team catches up on anything that arrived meanwhile.
- **Words:**
  - "Colony isn't answering right now. Your work is safe, and we'll keep trying."
  - "Still trying. Your team picks up as soon as Colony answers."
  - "Connected again."
- **Clears when:** Colony's service answers.
- **Data:** service health checks: WORKS. Trying again with growing waits: E-01. Catching up afterwards: E-14.
- **Not here:** a status page, technical details.

---

### X-03 While you were away

- **Who:** everyone.
- **Purpose:** Explain a time when the team was off, what it is catching up on, and what came late.
- **Trigger:** the team didn't run for more than 30 minutes (default), because the team computer was asleep or off, Colony was quit, the team computer had no internet, or the team was paused, and during that time something was due or arrived: a routine, a message or a decision.
- **Where it shows:** one item in Today (T-01) for every person. The catch-up also appears as lines in each employee's activity (M-05).
- **Get here:** Today.
- **Leads to:** each item it lists (a conversation, a card); S-07 through "Keep my team running" when the team was off because the computer slept and the stay-awake switches are off.
- **Shows:**
  1. When the team was off and why, in plain words ("Your team was off from 06:40 to 09:20 because Lerato's MacBook Air was asleep.").
  2. What it is catching up on, in order ("Morning brief, 2 customer emails, Naledi's Tuesday posts.").
  3. What came late ("The 08:30 brief came at 09:21.").
  4. Anything that now needs a person, with a link to it in Needs you.
- **Actions:**
  - Dismiss (each person) -> hides it for that person.
  - Keep my team running (anyone) -> S-07.
  - Open a listed item (anyone) -> that item.
- **States:**
  - **Catching up:** "Catching up on 3 things."
  - **Caught up:** "All caught up."
  - **Long time off:** more than 3 days: "Your team was off for 4 days. Scout is checking what matters most first."
  - **Nothing missed:** no item at all.
- **Words:**
  - "Your team was off from 06:40 to 09:20 because Lerato's MacBook Air was asleep."
  - "Catching up on 3 things: the morning brief, 2 customer emails and Naledi's posts."
  - "The 08:30 brief came at 09:21."
  - "Keep this computer awake while it's plugged in, so this happens less."
- **Clears when:** the person dismisses it, after 24 hours (default), or when a newer time away replaces it.
- **Data:** catching up on missed routines and messages after the team was off: MISSING (E-14). Some routines already catch up once after a missed run: PARTIAL. Team status: E-13.
- **Not here:** a list of every missed event, blame.

---

### X-04 Credits low

- **Who:** everyone sees it. Only the owner can buy credits.
- **Purpose:** Warn early enough that the team never stops for lack of credits.
- **Trigger:** the company's credits will last less than 3 days at the last 7 days' average pace, or fall below $2, whichever comes first (default, question 1). It doesn't show while auto top-up is on and working. It does show when auto top-up failed or reached its monthly limit.
- **Where it shows:** the banner (G-04), which each person can hide until the next day. Attention words on S-02. An email to the owner (W-06).
- **Get here:** appears on its own.
- **Leads to:** S-02 (buy credits, auto top-up), W-05 (payment pages).
- **Shows:** the balance, how many days it lasts, and the fix. For partners, who can buy.
- **Actions:**
  - Buy credits (owner) -> S-02 packs, then W-05.
  - Turn on auto top-up (owner; shown when it is off) -> S-02.
  - Let Lerato know (partner) -> a notification to the owner: "Kagiso says credits are low." (default)
  - Not now (each person) -> hides the banner until the next day.
- **States:**
  - **Owner view.**
  - **Partner view:** "Only Lerato can buy credits." with "Let Lerato know".
  - **Auto top-up failed:** "Auto top-up didn't go through: your card was declined."
  - **Auto top-up limit reached:** "Auto top-up has bought credits 4 times this month."
- **Words:**
  - "Credits are low: $3.10 left, about 2 days at this pace."
  - "Buy $15 now, or turn on auto top-up so this doesn't happen again."
  - "Credits are low. Only Lerato can buy more."
  - "We let Lerato know."
  - "Auto top-up didn't go through: your card was declined."
- **Clears when:** the balance is back above the threshold.
- **Data:** balance: WORKS per person, must become one company balance (E-15). The low-balance signal: MISSING (E-15). Owner email: E-30.
- **Not here:** spending per employee (S-02 has it).

---

### X-05 Credits out (team paused)

- **Who:** everyone sees it. Only the owner can buy credits.
- **Purpose:** Make clear the team stopped because credits ran out, that nothing is lost, and how to start again.
- **Trigger:** the company's credits reach $0, or are too low for the next piece of work (below $0.50, default). On an own plan, only the work that uses credits stops (AI-made images), and the words change to say so.
- **Where it shows:** the banner (G-04) on every computer. The menu bar or tray status (G-02) says "Paused: out of credits". Every employee's status (G-07) says "paused". S-02 and S-07. A notification to everyone (G-03, urgent problems). An email to the owner (W-06).
- **Get here:** appears on its own.
- **Leads to:** S-02 (buy credits), S-03 (use my own plan instead), then the catch-up item in Today (X-03).
- **Shows:** what happened, that nothing is lost, and the fix.
- **Actions:**
  - Buy credits (owner) -> S-02, then W-05.
  - Use my own plan instead (owner) -> S-03.
  - Let Lerato know (partner) -> a notification to the owner (default).
- **States:**
  - **Owner view.**
  - **Partner view:** "Only Lerato can buy more. We let Lerato know."
  - **Own plan in use:** "Out of credits. AI-made images are paused. Everything else keeps running on your Claude plan."
  - **Waiting for payment:** "Finish paying in your browser."
  - **Resumed:** toast "Your team is back to work." Then a catch-up line in Today.
- **What happens to the team:** employees stop at the next safe point and nothing is lost. Routines wait. Messages to Scout wait. People can still read, type and approve.
- **Words:**
  - "Out of credits. Your team is paused until you add more."
  - "Nothing is lost. Everyone picks up where they stopped."
  - "Out of credits. Only Lerato can buy more. We let Lerato know."
  - "Your team is back to work."
- **Clears when:** credits are added (above $0.50) or the team switches to an own plan.
- **Data:** the credits service already refuses work when credits run out: WORKS (E-16). Pausing and resuming the team cleanly: MISSING (E-15, E-13). Notification: E-26. Email: E-30.
- **Not here:** going below zero, borrowing credits, partners paying.

---

### X-06 Own plan limit reached

- **Who:** everyone sees it. Only the owner changes how the team is powered.
- **Purpose:** Explain that the team is waiting because the owner's own plan hit its limit, and when it works again.
- **Trigger:** the owner's Claude or ChatGPT plan reports that it reached its usage limit.
- **Where it shows:** the banner (G-04). The menu bar or tray status (G-02): "Waiting until 14:00". Every employee's status (G-07): "paused", with the reason "plan limit until 14:00". S-03 and S-07.
- **Get here:** appears on its own.
- **Leads to:** S-03, S-02.
- **Shows:** which plan, when it resets, and the choice to use credits meanwhile.
- **Actions:**
  - Use credits until it resets (owner; needs credits) -> the team uses credits until the reset time, then goes back to the plan.
  - Buy credits (owner; shown when there are none) -> S-02.
  - Wait (each person) -> hides the banner for that person.
- **States:**
  - **Reset time known.**
  - **Reset time unknown:** "Your team tries again every 30 minutes." (default)
  - **Using credits meanwhile:** "Using credits until your Claude plan resets at 14:00." This is also the state when the owner turned on "Use credits until my plan resets" in S-03.
  - **Plan back:** toast "Your Claude plan is back. Your team is using it again."
  - **Partner view:** no actions except Wait. "Only Lerato can switch to credits."
- **Words:**
  - "Your Claude plan hit its limit. It resets at 14:00, and your team waits until then."
  - "Use credits until 14:00?"
  - "Using credits until your Claude plan resets at 14:00."
  - "Your Claude plan is back. Your team is using it again."
- **Clears when:** the plan works again, or the owner switches the team to credits.
- **Data:** the limit and reset signals: MISSING (E-17). Using credits instead: E-16.
- **Not here:** upgrading the plan (done with Claude or ChatGPT, outside Colony).

---

### X-07 Own plan disconnected

- **Who:** everyone sees it. Only the owner reconnects or switches.
- **Purpose:** Say the owner's plan no longer works on the team computer and how to fix it.
- **Trigger:** the plan's sign-in on the team computer ended or was cancelled, the plan itself ended, or the team moved to a computer where the plan isn't connected.
- **Where it shows:** the banner (G-04). Attention words on S-03. A notification to everyone (G-03, urgent problems). Every employee's status (G-07): "paused", with the reason.
- **Get here:** appears on its own.
- **Leads to:** S-03, the browser sign-in.
- **Shows:** which plan, what happened, and two ways out.
- **Actions:**
  - Sign in again (owner, at the team computer) -> the browser sign-in, then "Signed in. Your team is back to work."
  - Use credits instead (owner) -> the team switches to credits.
  - Let Lerato know (partner) -> a notification to the owner (default).
- **States:**
  - **At the team computer.**
  - **At another computer:** "Sign in again on Lerato's MacBook Air, where your team runs."
  - **Signing in.**
  - **Sign-in failed:** X-19 pattern.
  - **Fixed:** toast.
- **Words:**
  - "Your Claude plan is signed out on this computer. Sign in again to keep your team working."
  - "Your ChatGPT plan ended. Switch to credits, or sign in again once your plan is renewed."
  - "Signed in. Your team is back to work."
- **Clears when:** the plan is connected again or the team switches to credits.
- **Data:** plan sign-in and the disconnect signal: E-17 (PARTIAL for Claude, MISSING for ChatGPT).
- **Not here:** managing the subscription itself.

---

### X-08 Employee stuck or failing

- **Who:** everyone sees it. Anyone can restart or pause the employee.
- **Purpose:** Say one employee isn't working, what Colony already tried, and offer the fix.
- **Trigger:** an employee fails to start, stops unexpectedly, stops responding for 10 minutes while it has work (default), or fails the same task 3 times in a row (default). Colony first restarts that employee once on its own (default, question 3). X-08 appears only if that doesn't fix it. If the employee is Scout, X-09 applies instead.
- **Where it shows:** a problem card (C-18) from Scout in Needs you (T-05) and in the conversation the work came from. The employee's status (G-07) says "stopped" on Team (M-01), on the employee page (M-02) and in the Today team line (T-01). A notification to everyone (G-03, urgent problems).
- **Get here:** the problem card, the notification, the employee's status.
- **Leads to:** M-06 (pause), the related conversation (T-03), S-09 (report a problem).
- **Shows:** who; what they were doing; what went wrong, in plain words; what Colony already tried; that the rest of the team keeps working.
- **Actions:**
  - Restart Naledi (anyone, from any computer) -> "Restarting Naledi", then "Naledi is back and picking up where things stopped." From a computer that doesn't run the team, the restart request goes to the team computer (default).
  - Pause Naledi (anyone) -> M-06. The card closes with "Paused by Lerato".
  - Ask Scout (anyone) -> the related conversation.
  - Get help (anyone) -> S-09, report a problem, with the details ready to send and the consent choice.
- **States:**
  - **Restarting.**
  - **Back.**
  - **Restart didn't help:** "Restarting didn't help. Send us the details so we can fix it?"
  - **Paused by a person.**
- **Words:**
  - "Naledi stopped while drafting next week's posts. I restarted Naledi once and it happened again."
  - "Restart Naledi"
  - "Naledi is back and picking up where things stopped."
  - "Restarting didn't help. Send us the details so we can fix it?"
- **Clears when:** the employee works normally for 5 minutes (default), or someone pauses or lets the employee go.
- **Data:** the employee's AI already restarts itself with growing waits: PARTIAL. When an employee's runner dies, nothing restarts it today: E-29. Restarting from another computer needs a request the team computer acts on: E-29, E-12. Status: E-13. The problem card: E-08.
- **Not here:** logs, technical reasons.

---

### X-09 Scout stopped

- **Who:** everyone.
- **Purpose:** Scout is the one voice, so when Scout stops, people must know at once and must still get decisions.
- **Trigger:** the same causes as X-08, for Scout, after Colony's own restart didn't help.
- **Where it shows:** the banner (G-04) on every computer, because Scout can't send a card about itself. Scout's status in Today (T-01). A notification to everyone (G-03, urgent problems).
- **Get here:** appears on its own.
- **Leads to:** S-09 (report a problem).
- **Shows:** that Scout stopped, that the other employees keep working, and that decisions come straight to people meanwhile.
- **What happens meanwhile:** other employees keep working. Their decisions go straight to Needs you, each marked "Came straight from Naledi while Scout is away" (default, question 4).
- **Actions:**
  - Restart Scout (anyone, from any computer) -> "Restarting Scout", then "Scout is back and catching up."
  - Get help (anyone) -> S-09.
- **States:**
  - **Restarting.**
  - **Back:** Scout catches up on what came in meanwhile.
  - **Restart didn't help:** offers Get help.
- **Words:**
  - "Scout stopped. Your team keeps working, and decisions come straight to you until Scout is back."
  - "Restart Scout"
  - "Scout is back and catching up."
  - "Came straight from Naledi while Scout is away."
- **Clears when:** Scout works normally for 5 minutes (default).
- **Data:** restart: E-29. Status: E-13. Decisions addressed to people directly: E-06.
- **Not here:** replacing Scout.

---

### X-10 Team stopped

- **Who:** everyone.
- **Purpose:** Say the whole team stopped on the team computer and how to get it going.
- **Trigger:** on the team computer, the part of Colony that runs the employees stops or fails to start, so no employee runs. For example, after a crash or a failed update.
- **Where it shows:** the banner (G-04) on every computer. The menu bar or tray status (G-02) says "Stopped". S-07. A notification to everyone (G-03, urgent problems).
- **Get here:** appears on its own.
- **Leads to:** S-07, X-16 (move the team), N-02, S-09.
- **Shows:** that the team stopped, where, and the fix for this computer.
- **Actions:**
  - Restart the team (anyone at the team computer) -> "Restarting your team. This takes about a minute."
  - Move the team here (owner, partner, at another computer) -> X-16, then N-02.
  - Get help (anyone) -> S-09.
- **States:**
  - **At the team computer.**
  - **At another computer:** "Your team stopped on Lerato's MacBook Air. Restart it there, or move the team here."
  - **Restarting.**
  - **Restart didn't work:** "Restarting didn't work. Quit Colony and open it again. If that doesn't help, send us the details."
- **Words:**
  - "Your team stopped. Restart it to get everyone back to work."
  - "Restarting your team. This takes about a minute."
  - "Your team stopped on Lerato's MacBook Air. Restart it there, or move the team here."
  - "Restarting didn't work. Quit Colony and open it again. If that doesn't help, send us the details."
- **Clears when:** the team runs again.
- **Data:** restart and repair: E-29. Starting the employees from the new app: E-01. Status: E-13.
- **Not here:** technical crash details.

---

### X-11 Update ready or required

- **Who:** everyone, on each computer.
- **Purpose:** Keep every computer on a version that works, with as little interruption as possible.
- **Trigger:** **Ready:** a new version finished downloading on this computer. **Required:** Colony's service no longer works with this version.
- **Where it shows:** **Ready:** the banner (G-04, lowest priority) and attention words on S-09. Updates also install on their own the next time Colony quits or the computer restarts (default). **Required:** replaces the app on this computer until it is updated (default, question 2).
- **Get here:** appears on its own. S-09.
- **Leads to:** W-02 (download the latest version) when updating fails.
- **Shows:** **Ready:** that an update is ready and what restarting does to the team. **Required:** that Colony must be updated to keep working, and that the team waits until then.
- **Actions:**
  - Restart to update (anyone at this computer) -> on the team computer the team pauses for about a minute; Colony restarts; toast "Updated to Colony 2.0.4."
  - Later (anyone; ready only) -> hides the banner until the next day.
  - Update now (anyone; required) -> downloads and restarts.
  - Download the latest version (anyone; when updating fails) -> W-02.
- **States:**
  - **Ready.**
  - **Required:** on the team computer the team waits until the update is done.
  - **Updating:** "Updating Colony. This takes about a minute."
  - **Update failed:** "Couldn't update. Try again, or download the latest version from colony.global."
  - **Updated:** toast.
  - **Mac at launch:** Mac installers are not signed at launch (owner, 11 October), so a Mac can't update itself. The banner says "A new version of Colony is available." with "Download update", which downloads it and shows the W-02 install steps. The team keeps working until the person quits to install. Windows installs updates on restart as described above.
- **Words:**
  - "An update is ready. Restart Colony to finish. Your team pauses for about a minute."
  - "Update Colony to keep going. Your team waits until it's done."
  - "Updating Colony. This takes about a minute."
  - "Updated to Colony 2.0.4."
  - "Couldn't update. Try again, or download the latest version from colony.global."
- **Clears when:** this computer runs the new version.
- **Data:** automatic updates: PARTIAL (exist but are unproven; unsigned Mac builds fall back to a manual download). E-27.
- **Not here:** choosing versions, long release notes (S-09 has "What's new").

---

### X-12 Signed out

- **Who:** anyone.
- **Purpose:** Say why the person is signed out and let them sign in again.
- **Trigger:** the person signed out (S-08); a partner was removed (S-05) or left (S-08); the company was closed (S-08); the sign-in on this computer is missing or damaged (default).
- **Where it shows:** replaces the app with the sign-in screen (O-01) and one line saying why.
- **Get here:** appears on its own after any trigger.
- **Leads to:** O-01, then Today or N-01.
- **Shows:** the reason line, then sign in.
- **What happens to the team:** if this was the team computer, the team stops. When someone signs in again on this computer, the team starts again (default).
- **Actions:**
  - Sign in (anyone) -> O-01.
  - Get help (anyone) -> opens an email to the Colony team (default), because S-09 needs a signed-in person.
- **States:** one line per trigger (see Words).
- **Words:**
  - "You signed out."
  - "Lerato removed you from Lerato Designs."
  - "You left Lerato Designs."
  - "Lerato Designs was closed."
  - "We couldn't find your sign-in on this computer. Sign in again. Nothing is lost."
- **Clears when:** the person signs in.
- **Data:** sign-in on this computer is the only session; nothing is cancelled on the server: E-02. Removal: E-19. Closing: E-28.
- **Not here:** account recovery beyond signing in with an email code or Google.

---

### X-13 Team runs on another computer

- **Who:** owner and partners, on a computer that doesn't run the team.
- **Purpose:** When the team is off because its computer can't be reached, offer to move the team here.
- **Trigger:** on a computer that doesn't run the team, the team computer hasn't been reachable for 10 minutes: asleep, off, without internet, or with Colony quit (default). The first sign-in on a new computer is handled by N-01 instead.
- **Where it shows:** the banner (G-04) on that computer. The status in S-07. The Today team line (T-01): "Off: Lerato's MacBook Air is asleep".
- **Get here:** appears on its own.
- **Leads to:** X-16 (move the team), N-02.
- **Shows:** the team computer's name, since when it can't be reached, and what is waiting ("3 decisions and 2 customer emails are waiting").
- **Actions:**
  - Move the team here (owner, partner) -> X-16, then N-02.
  - Not now (each person) -> hides the banner until the team computer has been unreachable for another 2 hours (default).
- **States:**
  - **Team computer unreachable.**
  - **Moving:** N-02.
  - **Moved:** "Your team now runs on Kagiso's laptop."
  - **Team computer back:** the banner clears on its own.
  - **On the old team computer after a move:** it shows "Your team moved to Kagiso's laptop" and doesn't run the team.
- **Words:**
  - "Your team is off: Lerato's MacBook Air has been asleep since 22:10."
  - "3 decisions and 2 customer emails are waiting."
  - "Move the team here to keep everyone working?"
  - "Your team now runs on Kagiso's laptop."
- **Clears when:** the team computer is back, or the team was moved here.
- **Data:** which computer runs the team, the lock and the hand-over: MISSING (E-12). Status: E-13.
- **Not here:** running the team on two computers at once.

---

### X-14 First close of the window

- **Who:** anyone.
- **Purpose:** Teach once that closing the window doesn't stop the team.
- **Trigger:** the first time a person closes the Colony window on a computer.
- **Where it shows:** as the window closes, once per computer.
- **Get here:** closing the window.
- **Leads to:** X-15 (through "Quit instead").
- **Shows:**
  - On the team computer: "Your team keeps working while the window is closed. Find Colony in the menu bar." (Mac) or "in the tray, next to the clock" (Windows). "Quitting Colony stops your team."
  - On other computers: "Colony stays in the menu bar so you still get notifications." (Mac) or the tray (Windows) (default).
- **Actions:**
  - Got it (anyone) -> the window closes and Colony keeps running.
  - Quit instead (anyone) -> X-15.
- **States:** team computer; other computer; Mac and Windows wording.
- **Words:**
  - "Your team keeps working while the window is closed. Find Colony in the menu bar."
  - "Your team keeps working while the window is closed. Find Colony in the tray, next to the clock."
  - "Quitting Colony stops your team."
- **Clears when:** dismissed. It never shows again on this computer.
- **Data:** closing to the menu bar works on Mac. On Windows, closing the window quits today and stops every employee: MISSING (E-11).
- **Not here:** settings for close behaviour.

---

### X-15 Quit

- **Who:** anyone at the team computer.
- **Purpose:** Make sure nobody stops the team by accident.
- **Trigger:** Quit from the menu bar or tray (G-02), the app menu, or the quit shortcut (G-05), on the team computer.
- **Where it shows:** before Colony quits.
- **Get here:** quitting.
- **Leads to:** Colony quits, or nothing changes.
- **Shows:** "Quit Colony? Your team stops until you open Colony again." Plus what is in progress, in one line ("Naledi is drafting 3 posts. They'll be finished after you open Colony again.").
- **Actions:**
  - Quit Colony (anyone) -> Colony quits; the team stops.
  - Keep working (anyone) -> nothing changes. This choice has focus, and Escape picks it.
- **States:**
  - **Team computer:** asks as above.
  - **Other computers:** Colony quits without asking (default).
  - **Computer shutting down or restarting:** Colony quits without asking. The team stops, and X-03 explains later.
- **Words:**
  - "Quit Colony? Your team stops until you open Colony again."
  - "Naledi is drafting 3 posts. They'll be finished after you open Colony again."
  - "Quit Colony"
  - "Keep working"
- **Clears when:** the person chooses.
- **Data:** E-11.
- **Not here:** scheduling quits.

---

### X-16 Confirmations

- **Who:** depends on the action (see the table).
- **Purpose:** One consistent way to confirm actions that are hard to undo.
- **Trigger:** one of the actions in the table.
- **Where it shows:** over the screen where the action started.
- **Get here:** the actions in the table.
- **Leads to:** the result named in each row, then a toast (G-06) saying it is done.
- **Shows:** the question, what will happen in plain words, a confirm choice that names the action, and a safe choice.
- **Rules for every confirmation:**
  - The confirm choice names the action ("Remove Kagiso"), never "OK" or "Yes".
  - The safe choice has focus. Escape picks the safe choice.
  - It never closes on its own.
  - Consequences come before the choice, in plain words, with real names and amounts.
  - The strongest one (closing the company) needs the company name typed first.
- **Catalogue:**

| Action (from) | Who | Question | What it says will happen | Confirm | Safe choice |
|-|-|-|-|-|-|
| Let an employee go (M-06) | owner, partner | "Let Naledi go?" | "Naledi stops now, and Naledi's routines stop. Drafts, posts and photos stay where they are. Scout can hire a new Social Media Manager when you want." | "Let Naledi go" | "Keep Naledi" |
| Remove a partner (S-05) | owner | "Remove Kagiso from Lerato Designs?" | "Kagiso loses access right away and is signed out. Decisions Kagiso made keep Kagiso's name." | "Remove Kagiso" | "Keep Kagiso" |
| Cancel an invite (S-05) | owner, partner | "Cancel the invite for sizwe@leratodesigns.co.za?" | "The invite link stops working. You can invite Sizwe again later." | "Cancel invite" | "Keep invite" |
| Close the company (S-08) | owner | "Close Lerato Designs?" | The full list from S-08: the team stops and everything in Colony is deleted; partners lose access; the website goes offline and its payment stops; unused credits ($18.40) can't be refunded in the app; payment records are kept by law; this can't be undone. Then: "Type Lerato Designs to confirm." | "Close Lerato Designs" (works only after the name is typed) | "Keep my company" |
| Leave the company (S-08) | partner | "Leave Lerato Designs?" | "You lose access right away. Decisions you made keep your name. Lerato can invite you again." | "Leave Lerato Designs" | "Stay" |
| Move the team (S-07, X-13, N-01) | owner, partner | "Move your team to this computer?" | "Your team stops on Lerato's MacBook Air and starts here. Keep this computer on and connected so everyone can work." On an own plan, also: "Connect your Claude plan here too, or your team uses credits." | "Move team here" | "Keep it there" |
| Sign out on the team computer (S-08) | anyone signed in there | "Sign out and stop your team?" | "Your team stops on this computer until someone signs in here again or moves the team." | "Sign out and stop team" | "Stay signed in" |
| Quit on the team computer (X-15) | anyone there | "Quit Colony?" | "Your team stops until you open Colony again." Plus what is in progress. | "Quit Colony" | "Keep working" |
| Disconnect own plan (S-03) | owner | "Disconnect your Claude plan?" | "Your team switches to Colony credits ($18.40 left)." With no credits: "You have no credits, so your team pauses until you buy some or connect a plan." | "Disconnect" | "Keep connected" |
| Turn off auto top-up (S-02) | owner | "Turn off auto top-up?" | "When credits run out, your team pauses until you buy more." | "Turn off" | "Keep it on" |
| Undo a website change (C-10, D-05) | owner, partner | "Put your website back to how it was?" | "Your website goes back to how it was before the new spring banner. Leo keeps the change as a draft." | "Put it back" | "Keep it live" |
| Remove your own domain (D-05a) | owner, partner | "Stop using leratodesigns.co.za?" | "Your website stays at leratodesigns.colony.site. Links to leratodesigns.co.za stop working until you connect it again." | "Remove domain" | "Keep domain" |
| End a campaign early (D-02a) | owner, partner | "End Spring launch now?" | "Naledi, Leo and Sipho stop their spring tasks. Maya writes up what it achieved." | "End campaign" | "Keep it running" |
| Cancel a hire while starting (M-08) | owner, partner | "Cancel hiring Leo?" | "Leo stops setting up and is removed. No more credits are used for Leo." | "Cancel hire" | "Keep Leo" |
| Turn off an important routine (M-04) | owner, partner | "Turn off plan check?" | "Naledi won't send new plans until you turn it back on." For Scout's morning brief: "You won't get a morning brief until you turn it back on." | "Turn off" | "Keep it on" |
| Delete a photo that is in use (D-03a) | owner, partner | "Delete this photo?" | "It's used in 2 posts. Those posts keep their own copy." | "Delete photo" | "Keep photo" |

- **Actions that never ask** (they use a toast with Undo instead, G-06): pausing the team, archiving a conversation, marking something as posted or sent, dismissing an item, hiding a banner.
- **States:** asking; working ("Removing Kagiso"); done (toast); failed (X-19, with the safe state kept).
- **Words:** see the table.
- **Clears when:** the person chooses.
- **Data:** each action's data is in its source entry.
- **Not here:** confirmations for everyday, undoable actions.

---

### X-17 Empty states

- **Who:** everyone.
- **Purpose:** Every list says what will appear and who is making it, instead of looking broken.
- **Trigger:** a list has nothing in it.
- **Where it shows:** inside the empty list.
- **Get here:** opening the list.
- **Leads to:** the one action in the row, if there is one.
- **Shows:** one line, and at most one action.
- **Rules:** name who is making the thing ("Naledi is drafting the first week"), say when it comes if known, never say "No data" or "Nothing to show".
- **Catalogue:**

| Where | Says | Action |
|-|-|-|
| T-01 Today, Needs you part | "Nothing needs you right now." | none |
| T-01 Today, before the first brief | "Your first brief arrives tomorrow at 08:30." | none |
| T-02 Conversation list | "No conversations yet. Tell Scout what you want to work on." | New conversation |
| T-02 Archived conversations | "Nothing archived." | none |
| T-05 Needs you | "Nothing needs you. Scout brings decisions here." | none |
| T-05 Needs you, history | "Decisions you make show up here." | none |
| T-06 Search, no results | "Nothing found for "linen dress". Try another word." | none |
| T-08 Photo picker, no photos yet | "No photos yet. Add some from your computer." | Add from computer |
| M-01 Team, nobody on it | "No one on your team. Ask Scout to hire someone." | Message Scout |
| M-03 Plan tab, before the first plan | "Naledi is writing a 2-week plan. You'll get it to approve." | none |
| M-04 Schedule tab | "No routines yet." | none |
| M-05 Activity tab | "Nothing yet. Naledi's work shows up here." | none |
| M-07 Direct chat, new | "Say hi to Naledi, or ask about anything on Naledi's desk." | none |
| D-01 Brief history | "Briefs collect here, starting tomorrow at 08:30." | none |
| D-01 Handled by Scout alone | "Nothing handled by Scout alone yet." | none |
| D-01 Company plan, before approval | "Scout is putting the team's plans together." | none |
| D-02 Campaigns | "No campaigns yet. Maya is planning the first one." | none |
| D-02 Ideas | "No ideas waiting." | none |
| D-02 Numbers | "Numbers arrive after your first Thursday check-in." | none |
| D-03 Content calendar | "No posts planned yet. Naledi is drafting the first week." | none |
| D-03 Ready to post | "Nothing to post right now." | none |
| D-03 Brand kit, not ready | "Naledi is putting your brand kit together." | none |
| D-03 Photo library | "Add product photos so Naledi and Leo can use them." | Add photos |
| D-04 Deals | "No leads yet. Sipho looks for new leads every Tuesday." | none |
| D-04 Today's follow-ups | "No follow-ups today." | none |
| D-04 Target customers | "Sipho is choosing who to look for first." | none |
| D-05 No website yet | "No website yet. Leo is building the first version." | none |
| D-05 Changes waiting | "No changes waiting." | none |
| D-05 History | "Nothing has gone live yet." | none |
| D-05 Visits | "Visits show up once your site is live." | none |
| D-06 Customer messages | "No customer messages yet. Forward your customer emails to Grace to start." | Set up forwarding (S-04) |
| D-06 Knowledge | "Grace is writing your FAQ and policies." | none |
| D-06 Admin list | "Nothing on the admin list." | none |
| S-02 Payment history | "No payments yet." | none |
| S-04 Social accounts | "Add your Instagram so Naledi can open it for you at posting time." | Add account |
| S-05 Partners | "Just you for now. Invite a partner to share the work." | Invite |

- **States:** empty, then filled.
- **Words:** see the table.
- **Clears when:** the list gets its first item.
- **Data:** none beyond each list's own data.
- **Not here:** illustrations or tips (Codex may design them, but the words above are fixed).

---

### X-18 Loading

- **Who:** everyone.
- **Purpose:** One set of loading rules so Colony never looks frozen or blank.
- **Trigger:** anything that takes time to appear.
- **Where it shows:** wherever the content will appear.
- **Get here:** any screen.
- **Leads to:** the loaded content, or a problem message (X-19).
- **Shows and rules:**
  1. Under 300 ms: nothing new. Over 300 ms: placeholder shapes in the place of the content. Over 10 s: one plain line: "Still loading. Check your internet if this keeps going."
  2. Opening Colony shows the last known content from this computer at once, marked "Updating", until fresh content arrives. Never a blank window. (default)
  3. Work by employees is not loading. It shows as work in progress in the employee's status (G-07), with what and, when known, how long: "Naledi is drafting 3 posts, about 10 minutes."
  4. An action that starts something shows its own progress in words ("Restarting") and can't be started twice.
  5. Anything over 30 s: "This is taking longer than usual. You can leave this screen. We'll tell you when it's done." (default)
  6. Setups with several steps (O-06, N-02, D-05a) show each step by name with a time estimate.
  7. Screen readers hear "Loading" once and "Loaded" once.
- **Actions:** none, except leaving the screen.
- **States:** short wait, placeholders, long wait, very long action, done.
- **Words:**
  - "Still loading. Check your internet if this keeps going."
  - "Updating"
  - "This is taking longer than usual. You can leave this screen. We'll tell you when it's done."
- **Clears when:** the content arrives or a problem message replaces it.
- **Data:** last known content kept on this computer: E-01.
- **Not here:** progress percentages for employee work.

---

### X-19 Problem messages

- **Who:** everyone.
- **Purpose:** Every problem reads the same way: what happened, what it means, what to do.
- **Trigger:** any action or background task that fails.
- **Where it shows:** with the thing that failed: a field, a card, a toast for background actions, the banner for team-wide problems, a problem card (C-18) for an employee.
- **Get here:** any failure.
- **Leads to:** the fix action, or S-09 through "Get help".
- **Shows, always in this order:**
  1. What happened, in plain words, naming who when it is an employee ("Leo couldn't make the change live").
  2. What it means: what still works and that nothing is lost, when true.
  3. What to do: one action. "Get help" is added when the same problem repeats.
- **Rules:** never blame the person, never show error codes or technical words, keep anything the person typed.
- **Examples:**

| Situation | Message | Actions |
|-|-|-|
| Payment cancelled in the browser | "Payment cancelled. Nothing was charged." | Try again |
| Card declined during auto top-up | "Your card was declined, so auto top-up didn't run. Your team keeps going until credits run out." | Update card (owner) |
| Photo too large | "This photo is too big to send. Photos can be up to 50 MB." | Choose another photo |
| Invite email failed | "We couldn't send the invite to sizwe@leratodesigns.co.za. Check the address and try again." | Try again |
| Website change didn't go live | "Leo couldn't make the new spring page live. Your site still shows the old version." | Try again, Ask Leo (M-07) |
| Plan sign-in didn't finish | "Signing in to your Claude plan didn't finish. Try again, or use credits for now." | Try again, Use credits (owner) |

- **Actions:** the fix action in each message; Get help when it repeats.
- **States:** first time, repeated (adds Get help), fixed (the message goes away).
- **Words:** see the examples.
- **Clears when:** the problem is fixed or the person moves on.
- **Data:** plain-language problems instead of warning messages from employees: E-29.
- **Not here:** technical details, "Show details".

---

### X-20 Permissions (notifications, microphone)

- **Who:** each person, on each computer.
- **Purpose:** Ask for the two computer permissions Colony needs, explain why first, and give a way back after a "no".
- **Trigger:** **Notifications:** "Allow notifications" in O-09 or S-06, or the first decision that arrives when Colony never asked (default). **Microphone:** the first time someone presses record for a voice note (T-07).
- **Where it shows:** a short Colony explanation, then the computer's own question. After a "no": S-06 (notifications) or T-07 (microphone).
- **Get here:** the triggers above.
- **Leads to:** the computer's own settings, through "Open notification settings" or "Open microphone settings".
- **Shows:**
  - **Notifications:**
    - Before asking: "Allow notifications so decisions reach you right away."
    - Mac: the computer asks "Colony would like to send you notifications", with Allow and Don't Allow.
    - Mac, denied: S-06 shows "Notifications are off for Colony on this computer" with "Open notification settings" and the steps "Find Colony, then turn on Allow notifications."
    - Windows: notifications are usually allowed. If they are off for Colony or for the whole computer, S-06 says so with "Open notification settings". If Do not disturb is on and Colony can tell, S-06 says "Do not disturb is on. Notifications wait until it's off." (default)
    - Colony asks only once. After a "no" it shows the off state with steps and never asks again by itself.
  - **Microphone:**
    - Before asking: "Colony needs your microphone for voice notes. Nothing is recorded until you press record."
    - Mac: the computer asks "Colony would like to access the microphone."
    - Mac, denied: T-07 shows "The microphone is off for Colony" with "Open microphone settings" (Privacy and Security, Microphone) and "Type instead".
    - Windows: microphone access for desktop apps must be on in the computer's privacy settings. Denied: the same pattern, with "Open microphone settings" and "Type instead".
    - No microphone found: "No microphone found. Plug one in, or type instead."
    - Microphone in use by another app: "Your microphone is busy in another app. Close it and try again, or type instead." (default)
    - After turning the microphone on in the computer's settings, if Colony must restart to use it: "Restart Colony to use the microphone." with Restart Colony.
- **Actions:** Allow notifications; Open notification settings; Open microphone settings; Type instead; Restart Colony (when needed).
- **States:** not asked, explaining, allowed, denied, no device, device busy, restart needed.
- **Words:**
  - "Allow notifications so decisions reach you right away."
  - "Notifications are off for Colony on this computer. Turn them on in your computer's settings."
  - "Colony needs your microphone for voice notes. Nothing is recorded until you press record."
  - "The microphone is off for Colony. Turn it on in your computer's settings, or type instead."
  - "No microphone found. Plug one in, or type instead."
- **Clears when:** the permission is granted, or the person chooses to type instead.
- **Data:** notifications: E-26. Voice notes and the microphone: E-18.
- **Not here:** camera, screen recording, file access (dragging files in needs no permission).

---

### X-21 Can't run here

- **Who:** anyone.
- **Purpose:** Explain the few cases where Colony can't run or can't run well on this computer.
- **Trigger and where it shows, per case:**
  1. **System too old:** the computer runs a system older than Colony supports (default minimums: macOS 12 on Mac, Windows 10 on Windows; confirm in the engine plan). Replaces the app.
  2. **Already open:** someone opens Colony while it is already running. The open window comes forward. If the open copy isn't responding, Colony says so.
  3. **Disk almost full:** less than 1 GB free (default). The banner (G-04o, rank 9). If the team can't save its work, the team pauses with this reason.
- **Get here:** opening Colony (cases 1 and 2), appears on its own (case 3).
- **Leads to:** the computer's update settings (case 1), the computer's storage settings (case 3).
- **Shows:** the case, in plain words, and the one fix.
- **Actions:**
  - How to update your computer (case 1) -> opens the computer's update settings.
  - Close the other Colony (case 2, when it isn't responding) (default) -> closes it and opens this one.
  - Open storage settings (case 3) -> opens the computer's storage settings.
- **States:** one per case; case 3 also has "Team paused: not enough space".
- **Words:**
  - "Colony needs macOS 12 or newer. This Mac has macOS 11."
  - "Colony needs Windows 10 or newer."
  - "Colony is already open but not responding. Close it and try again?"
  - "This computer is almost out of space. Colony needs at least 1 GB free to keep your team working."
- **Clears when:** the system is updated (case 1), the other copy closes (case 2), space is freed (case 3).
- **Data:** single open copy: WORKS (E-01). Supported systems and builds for Apple Silicon and Intel Macs: E-27.
- **Not here:** installing (W-02 handles the computer's install warnings).

---

### X-22 Team paused by a person

- **Who:** everyone sees it. Owner and partners can resume.
- **Purpose:** Show that someone paused the team on purpose, who, and how to resume.
- **Trigger:** the owner or a partner pauses the team (S-07 or the menu bar or tray, G-02).
- **Where it shows:** the banner (G-04) on every computer: "Team paused by Kagiso at 14:02". The menu bar or tray status (G-02) says "Paused". Every employee's status (G-07) says "paused". S-07.
- **Get here:** appears on its own after a pause.
- **Leads to:** S-07.
- **Shows:** who paused and when, what pausing means, Resume.
- **What happens while paused:** no employee starts new work. Work in progress stops at the next safe point. Routines don't run. When the team resumes, each missed routine runs once if it is still useful (default). Messages to Scout wait. Approvals still work, and employees act on them after resuming.
- **Actions:**
  - Resume (owner, partner) -> "Your team is back to work."
  - Undo (the person who paused, right after pausing, G-06).
- **States:**
  - **Paused.**
  - **Resuming.**
  - **Resumed:** toast.
  - **Paused for a long time:** after 24 hours, one notification (G-03): "Your team has been paused since yesterday at 14:02. Resume?" (default, question 5)
- **Words:**
  - "Team paused by Kagiso at 14:02. Nothing new starts until someone resumes."
  - "Resume"
  - "Your team is back to work."
  - "Your team has been paused since yesterday at 14:02. Resume?"
- **Clears when:** someone resumes the team.
- **Data:** pausing and resuming the whole team: MISSING (the same mechanism is needed when weekly budgets are enforced, E-15). Status: E-13. Notification: E-26.
- **Not here:** pausing one employee (M-06), scheduled pauses.

---

## Defaults in this file

Chosen while writing. They stand unless the owner changes them. The few that need a real answer are collected in the product design, section 9.

1. **When are credits "low"?** Recommendation: when they will last less than 3 days at the last week's pace, or fall below $2. This adapts to the size of the team.
2. **Should a required update block the app until it is updated?** Recommendation: yes. The old version can't work with Colony's service anyway, and the screen always offers a download.
3. **Should Colony restart a stuck employee once on its own before telling anyone?** Recommendation: yes. Most stalls clear with one restart, and people only hear about the ones that don't.
4. **While Scout is stopped, should employees' decisions come straight to Needs you?** Recommendation: yes, each marked "Came straight from Naledi while Scout is away", so nothing waits on Scout.
5. **Should Colony remind people after the team has been paused for 24 hours?** Recommendation: yes, with one notification, so a forgotten pause doesn't stop the business for days.
