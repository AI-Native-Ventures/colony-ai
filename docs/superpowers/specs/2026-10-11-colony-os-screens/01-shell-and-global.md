# 01 Shell and global

Part of the Colony screen pack. Read [00-index.md](00-index.md) first: it holds the product rules, the words list, the common states, the sample company and the engine items (E-xx) used below.

This file covers the parts of the app that are always there, whatever screen people are on: the app window (G-01), the menu bar and tray (G-02), computer notifications (G-03), banners (G-04), keyboard (G-05), toasts and undo (G-06), how employees are shown (G-07), and themes and sizes (G-08).

Anything marked "(default)" was not decided by the owner. It is a sensible starting point and is listed under "Questions for the owner" at the end when it matters.

---

### G-01 App window

- **Who:** owner, partner. On every computer where they are signed in, whether or not that computer runs the team.
- **Purpose:** The frame around everything. It lets people move between the four areas (Today, Conversations, Team, Settings), always shows how many decisions need them and how the team is doing, and offers search and a new conversation from anywhere.
- **Get here:**
  - Opening Colony from the Dock or Applications (Mac), the Start menu or a desktop shortcut (Windows).
  - "Open Colony" in the menu bar or tray menu (G-02).
  - Clicking any computer notification (G-03).
  - Any Colony link from an email (W-06), the payment pages (W-05) or the invite page (W-07).
  - The end of first run (O-10), joining as a partner (P-01, P-01a) or signing in on another computer (N-01, N-02).
- **Leads to:** T-01 Today, T-02 Conversation list, T-03 a conversation, T-04 New conversation, T-05 Needs you, T-06 Search, M-01 Team, S-01 to S-09 Settings, the action of any banner (G-04), X-11 when an update is required, X-12 when signed out, X-14 on the first close, X-15 on quit.
- **Shows,** in order of importance:
  1. The content of the current area.
  2. **Needs you count:** the number of open decisions this person may decide. For the owner that is every open decision; for a partner it is every open decision except billing ones. Visible from every area. When nothing needs the person, no number is shown (never "0").
  3. **The four areas:** Today, Conversations, Team, Settings. The conversation list (T-02), with Today pinned on top, is reachable in one step from anywhere.
  4. **Team status in one line.** Normally a short count ("4 working, 1 waiting on you"). When something is wrong it shows the most important problem instead ("Team paused: credits ran out"). On a computer that does not run the team it says where the team runs ("Team runs on Lerato's MacBook Air"). Selecting it opens M-01.
  5. **New conversation** and **Search**, available from every area.
  6. **Who and where:** the company name and the person's own name and photo (from Google, or initials). Selecting it opens S-08 Account.
  7. **One banner at most** (G-04).
  8. **App icon badge** in the Dock (Mac) and on the taskbar (Windows) showing the Needs you count (default).
- **Actions:**
  - Go to Today, Conversations, Team or Settings (everyone) -> that area. Keyboard: Cmd/Ctrl+1, 2, 3 and Cmd/Ctrl+comma (G-05).
  - Open Needs you (everyone) -> T-05. Keyboard: Cmd/Ctrl+J.
  - New conversation (everyone) -> T-04. Keyboard: Cmd/Ctrl+N.
  - Search (everyone) -> T-06. Keyboard: Cmd/Ctrl+K.
  - Open team status (everyone) -> M-01.
  - Open account (everyone) -> S-08.
  - Switch company (everyone, only when the person belongs to more than one company) -> that company's Today (default). Keyboard: from the account entry, arrow keys and Enter.
  - Close the window (everyone) -> the window hides and Colony keeps running in the menu bar or tray (G-02). The first time, X-14 explains this. Keyboard: Cmd/Ctrl+W, and Alt+F4 on Windows.
  - Quit (everyone) -> on the team computer, the X-15 confirmation; on any other computer Colony quits at once (default). Keyboard: Cmd/Ctrl+Q.
- **States:**
  - **Normal:** as above.
  - **First open after first run:** lands on T-01 with Scout's first message (O-10).
  - **Reopening:** returns to the last area and conversation (default). A notification or link that opened the window wins over this.
  - **Loading:** common rule. The four areas and the Needs you count appear before the content does.
  - **Offline:** offline banner (G-04f). The Needs you count keeps its last known number and is marked as last known for screen readers.
  - **Colony unreachable:** banner G-04g.
  - **Team paused** (credits out, plan limit, paused by a person): the banner and the team status line give the reason.
  - **Team stopped or Scout stopped:** the matching banner (G-04a, G-04b) and the team status line ("Team stopped").
  - **Team runs on another computer:** the team status line names that computer. A banner appears only when that computer has been off for a while (G-04h).
  - **Partner view:** billing controls are read-only everywhere. Billing decisions do not count toward the partner's Needs you number; they appear in T-05 under "Waiting on Lerato" (default).
  - **Several companies:** the switch company action is available (default). The badge and Needs you count are for the company on screen; other companies with open decisions show a mark next to their name in the switcher.
  - **Signed out** (for example the session ended on another computer): X-12 replaces the window content.
  - **Update required:** X-11 replaces the window content.
  - **Smallest window** (1024 x 700): see G-08.
- **Words:**
  - "2 need you"
  - "Team: 4 working, 1 waiting on you"
  - "Team paused: credits ran out"
  - "Team runs on Lerato's MacBook Air"
  - "Search conversations and messages"
  - "New conversation"
- **Data:**
  - Needs you count: the Needs you index, E-06 (PARTIAL: today the client scans the decisions in every conversation, and a decision does not name who it is for).
  - Team status: E-13 (PARTIAL: an employee's "ready" state reaches the engine only through the old app's screens).
  - Which computer runs the team and when it was last seen: E-12 (MISSING).
  - Company name: E-03 (PARTIAL: only a short web name is stored today).
  - Person's name and photo: profile per company (WORKS). Photo upload: media upload (WORKS).
  - Badge, single window, Colony links (colony://): the existing desktop shell has these (AS IS); the new shell wires them (E-01).
- **Not here:** a permanent list of employees in the frame (the Team area has it), unread counts per employee, an activity feed, technical status (connection dots, logs, version numbers), company or billing figures.

---

### G-02 Menu bar and tray

- **Who:** owner, partner. On every computer where Colony is running.
- **Purpose:** Keep Colony reachable while the window is closed, show at a glance whether the team is working and whether anything needs the person, and offer the few actions that make sense without opening the window.
- **Get here:** Always present while Colony runs, on the team computer and on every other computer.
  - Mac: the Colony icon in the menu bar. Clicking it opens the menu.
  - Windows: the Colony icon in the tray, near the clock. Clicking opens the Colony window; right-clicking opens the menu (default, the usual Windows habit).
- **Leads to:** G-01 (Open Colony), T-05 (Needs you), T-04 (Message Scout), M-02 (an employee), X-22 (Pause team), X-15 (Quit), O-01 (Sign in, when signed out), the first unfinished first-run step (Finish setting up), X-11 (Restart to update).
- **Shows** (menu items, in this order):
  1. **Header:** the company name and one status line, the same text as the G-01 team status line: "Team working", "1 waiting on you", "Team paused: credits ran out", "Team runs on Lerato's MacBook Air", "Lerato's MacBook Air is off".
  2. **"Needs you (2)"** -> T-05. When nothing needs the person: "Nothing needs you", not selectable.
  3. **"Message Scout"** -> opens the window on T-04 with the message box ready for typing.
  4. **"Open Colony"** -> G-01 at the last screen.
  5. **Team:** one line per employee with name and status words (G-07), for example "Naledi: Working". Selecting a line opens that employee's page (M-02).
  6. **"Pause team"** or **"Resume team"** (owner, partner) -> X-22. Works from any computer; the team computer carries it out (default).
  7. **"Keep this computer awake while plugged in"** with a tick when on. Team computer only. Same setting as S-07.
  8. **"Restart to update"** (Windows) or **"Download update"** (Mac, while installers are unsigned), only when an update is ready (X-11).
  9. **"Quit Colony"** -> X-15 on the team computer; quits at once elsewhere.
- **Icon states:** normal; something needs you (Mac: the count next to the icon where the menu bar has room; Windows: a small count on the icon); team paused; team problem (stopped, credits out, plan limit, plan disconnected); offline. Each state differs in shape, not only in colour. Every state has hover text on Windows and a screen reader name, for example "Colony: 2 things need you" or "Colony: team paused, credits ran out".
- **Actions:** as listed in Shows. Who may: everyone, except "Pause team" and "Resume team" (owner, partner; both are people) and the keep-awake tick (whoever is using the team computer). Keyboard: the computer's own keys reach the menu (Mac: Control+F8 moves to the menu bar icons; Windows: Win+B moves to the tray), then arrow keys and Enter.
- **States:**
  - Normal, as above.
  - **Before first run is finished:** header "Finish setting up", then "Open Colony" and "Quit Colony" only.
  - **Signed out:** header "Signed out", then "Sign in" (opens O-01) and "Quit Colony".
  - **Computer that does not run the team:** no keep-awake item; the header says where the team runs.
  - **Offline:** header "You're offline"; Needs you shows the last known number; Pause and Resume are unavailable with the reason "Needs the internet".
  - **Update ready:** "Restart to update" appears above "Quit Colony".
- **Words:**
  - "Lerato Designs: Team working"
  - "Needs you (2)"
  - "Message Scout"
  - "Pause team" / "Resume team"
  - "Keep this computer awake while plugged in"
  - "Quit Colony"
- **Data:**
  - Mac menu bar menu exists today (CHANGES: it lists running employees, Open and Quit only).
  - Windows tray: MISSING. Today, closing the window on Windows quits Colony and stops every employee (E-11).
  - Team status E-13, Needs you E-06.
  - Pause and resume the whole team: E-29 and X-22 (MISSING today: a paused employee keeps working and there is no resume).
  - Keep awake: Mac only, off unless turned on, stops after 1 hour idle (CHANGES, E-11).
- **Not here:** approving or declining from the menu, the credits balance, settings, a list of conversations.

---

### G-03 Computer notifications

- **Who:** owner, partner. On every computer where they are signed in and Colony is running, with the window open or closed.
- **Purpose:** Reach people outside the app only when something needs them or something they asked for is done, with exact words and a click that lands on the right thing.
- **Get here:** the events in the table below. They appear in the computer's notification area.
- **Leads to:** the target listed for each type.
- **Shows:** every notification type. All notifications speak as Scout (product rule 1), except the few about Colony itself, which come from "Colony".

| Type | Sent when | Who gets it | Title / body | Click opens |
|-|-|-|-|-|
| Decision | A new decision arrives | Everyone who may decide it (billing decisions: owner only) | "Scout" / "Naledi's posts for next week are ready for your OK." | T-05 with that card's viewer open (C-xx) |
| Several decisions | 2 or more decisions arrive within 1 minute | Same | "Scout" / "3 things need you: posts, a website change and a reply to Thabo." | T-05 |
| Employee problem | An employee stopped or keeps failing | Everyone | "Scout" / "Sipho has stopped working. Want me to restart him?" | C-18 viewer |
| Scout stopped | Scout is not running | Everyone | "Colony" / "Scout has stopped, so nobody is running your team. Open Colony to restart Scout." | X-09 |
| Team stopped | The whole team stopped unexpectedly | Everyone | "Colony" / "Your team has stopped. Open Colony to restart it." | X-10 |
| Team paused | Credits ran out, the own plan reached its limit, or the plan was disconnected | Owner; partners too, with words that say who can fix it | Owner: "Colony" / "Your team is paused: credits ran out. Buy credits to carry on." Partner: "Colony" / "Your team is paused: credits ran out. Lerato can top up." | Owner: S-02 at Buy credits. Partner: T-01 |
| Credits low | The balance covers about 3 days or less at this week's pace (default) | Owner only | "Colony" / "Credits are running low: about 2 days left." | S-02 |
| Morning brief | Weekdays at 08:30, company time zone | Everyone (can be turned off in S-06) | "Scout" / "Morning, Lerato. 2 things need you today." | T-01 |
| Friday wrap | Fridays at 16:00, company time zone (default) | Everyone (can be turned off in S-06) | "Scout" / "Friday wrap: 14 things done this week, 1 needs you." | T-01 |
| Time to post | A ready-to-post item reaches its suggested time | Everyone (can be turned off in S-06) | "Scout" / "Time to post Naledi's spring linen carousel on Instagram." | C-05 or C-04 viewer, ready-to-post view |
| Customer waiting | A customer has waited 24 hours and Grace's reply draft is ready | Everyone (can be turned off in S-06) | "Scout" / "Thabo has waited a day for a reply. Grace's draft is ready." | C-09 viewer |
| Reply to you | Scout or an employee answers something this person asked, while Colony is not in front | The person who asked | "Scout" / "Done. The price list is in Spring launch." | T-03 at that message |
| Team moved away | The team was moved to another computer | Whoever is signed in on the old team computer | "Colony" / "Your team now runs on Kagiso's laptop." | X-13 |

- **Actions:**
  - Click (everyone) -> the target in the table.
  - Dismiss (everyone) -> nothing changes. The decision stays in Needs you.
  - There are no approve or decline actions inside notifications: people always see a decision before deciding it (default).
- **States and rules:**
  - **Quiet hours** (S-06; on by default from 21:00 to 07:00): only employee problem, Scout stopped, team stopped and team paused come through, unless the person turned off "Let urgent problems through" in S-06.
  - **The computer's own Do Not Disturb or Focus** is always respected.
  - **Notifications turned off on the computer:** nothing is sent. Banner G-04m explains, and S-06 shows the same line.
  - **Handled elsewhere:** when a decision is decided on another computer or by another person, Colony removes its notification from this computer and updates the badge.
  - **Looking at it already:** no notification for the conversation or card that is open and in front. Everything else still notifies.
  - **Grouping:** decisions that arrive within 1 minute become one notification. Problems are never grouped with ordinary decisions.
  - **No repeats:** Colony never repeats a notification. Open decisions appear in the next morning brief instead (default).
  - **Colony quit on this computer:** no notifications on this computer. S-07 says this in plain words.
  - **Signed out:** no notifications.
- **Words:** as in the table. Every body is one sentence, names who the work is from, and never uses an error code.
- **Data:**
  - Showing notifications and opening a conversation on click: exists (AS IS).
  - Deciding when to notify: lives in the old app's screens today (E-26 PARTIAL); quiet hours MISSING (E-26).
  - Decision events: decisions and workflow approvals arrive live; a decision does not name who it is for (E-06).
  - Brief and Friday wrap: E-07 (MISSING). Time to post: E-24 (MISSING). Customer waiting: E-22 (MISSING). Credits low: E-15 (MISSING). Team moved: E-12 (MISSING). Plan limit and disconnect: E-17 (MISSING).
- **Not here:** email or phone notifications (W-06 covers only account and billing emails), different sounds per type (Codex may propose in notes), actions inside notifications.

---

### G-04 Banners

- **Who:** owner, partner, as listed per banner.
- **Purpose:** One consistent way to say "something about the whole team or this app is not normal", with the fix right there.
- **Get here:** banners appear by themselves when their trigger happens, on every area of G-01. Ranks 1 to 11 also replace the status line in the G-02 header.
- **Leads to:** the action listed per banner.
- **Shows:** one banner at a time: the highest priority one. When more than one applies, the banner adds "+2 more", which lists the others (default). Each banner has: one sentence saying what happened and what it means for the team, and at most two actions.

| ID | Banner | Trigger | Words (owner) | Words (partner) | Actions | Clears when | Rank |
|-|-|-|-|-|-|-|-|
| G-04a | Team stopped | The team stopped unexpectedly (X-10) | "Your team has stopped. Restart it to carry on." | Same | "Restart team" (owner, partner, at the team computer; other computers offer "Move team here") | The team runs again | 3 |
| G-04b | Scout stopped | Scout is not running (X-09) | "Scout has stopped, so nobody is running your team." | Same | "Restart Scout" (owner, partner) | Scout runs again | 4 |
| G-04c | Credits out | The company has no credits and the team runs on credits (X-05) | "Your team is paused: credits ran out." | "Your team is paused: credits ran out. Only Lerato can buy credits." | Owner: "Buy credits" (S-02). Partner: "Remind Lerato" (sends the owner one notification; at most once every 12 hours) (default) | Credits are added; the team resumes by itself | 5 |
| G-04d | Plan limit | The own plan reached its limit (X-06) | "Your team is paused until 14:00: your Claude plan reached its limit." | "Your team is paused until 14:00: Lerato's Claude plan reached its limit." | Owner: "Use credits until then" (only when there are credits), "Change" (S-03) | The limit resets or the owner switches to credits | 6 |
| G-04e | Plan disconnected | The own plan stopped answering because the sign-in ended (X-07) | "Your team can't reach your Claude plan. Sign in again to carry on." | "Your team can't reach Lerato's Claude plan. Lerato needs to sign in again on Lerato's MacBook Air." | Owner on the team computer: "Sign in again" (S-03) | The plan is connected again | 7 |
| G-04f | Offline | This computer has no internet (X-01) | Team computer: "You're offline. Your team waits until you're back." Other computers: "You're offline. You'll see new things when you're back." | Same as owner | "Try again" appears after 30 seconds | The connection is back | 1 |
| G-04g | Colony unreachable | The internet works but Colony does not answer (X-02) | "Colony isn't answering right now. Your team will catch up when it's back." | Same | "Try again" | Colony answers | 2 |
| G-04h | Team computer off | Shown on other computers when the team computer has not been seen for 10 minutes (default) (X-13) | "Your team is waiting: Lerato's MacBook Air has been off since 18:40." | Same | "Move team here" (owner, partner) (N-02) | The team computer is back, or the team moved | 8 |
| G-04i | Paused by a person | Someone paused the team (X-22) | "Your team is paused. Kagiso paused it at 15:20." | Same | "Resume team" (owner, partner) | The team resumes | 10 |
| G-04j | Website paused | The website hosting payment failed and the site is paused (W-09) | "Your website is paused: the hosting payment didn't go through." | "Your website is paused: the hosting payment didn't go through. Only Lerato can update the payment." | Owner: "Update payment" (S-02) | The payment succeeds | 11 |
| G-04k | Credits low | Credits cover about 3 days or less at this week's pace (X-04) | "Credits are low: about 2 days left at this week's pace." | Not shown | "Buy credits", "Turn on auto top-up" (S-02), "Not now" (hides it for 24 hours) | Credits are above the line | 12 |
| G-04l | Update ready | Windows: a new version is downloaded. Mac: a new version is available (X-11) | Windows, team computer: "A new version of Colony is ready. Restart Colony to update. Your team pauses for about a minute." Windows, other computers: "A new version of Colony is ready. Restart Colony to update." Mac (installers are unsigned at launch, so a Mac can't update itself): "A new version of Colony is available. Download it to update." | Same | Windows: "Restart now", "Later" (hides it for 24 hours). Mac: "Download update" (W-02 steps), "Later" | This computer runs the new version | 14 |
| G-04m | Notifications off | The computer blocks Colony's notifications (X-20) | "Notifications are off, so you'll only see decisions while Colony is open." | Same | "Turn on" (opens the computer's notification settings), "Not now" (hides it for 7 days) | Notifications are allowed | 15 |
| G-04n | Images paused | No credits, but the team runs on an own plan, so only AI-made images stop | "Credits ran out, so AI-made images are paused. Your team keeps working." | "Credits ran out, so AI-made images are paused. Only Lerato can buy credits." | Owner: "Buy credits" (S-02), "Not now" (hides it for 24 hours) | Credits are added | 13 |
| G-04o | Disk almost full | Less than 1 GB free on this computer (X-21) | "This computer is almost out of space. Colony needs at least 1 GB free to keep your team working." | Same | "Open storage settings" | Space is freed | 9 |
| G-04p | Terms updated | Colony's terms or privacy policy changed (W-04) | "We updated our terms. Here's what changed." | Same | "See what changed" (W-04), "OK" | The person opens or dismisses it | 16 |

- **Actions:** as in the table. Every action is reachable by keyboard: the banner's actions follow the area name in the Tab order (G-05).
- **States and rules:**
  - Rank 1 shows first. 07-system-states.md lists the same order.
  - These can be hidden for the time stated in their row or state: plan limit (until the reset), team computer off (2 hours), credits low, images paused and update ready (24 hours), notifications off (7 days), terms updated (once dismissed). All others stay until they clear.
  - A new banner is announced once by screen readers. A banner never moves focus.
  - The words name the computer by its name as people set it (for example "Lerato's MacBook Air"), never by an internal name.
- **Words:** as in the table.
- **Data:** credits balance and the "out of credits" answer from the credits gateway (WORKS, E-15, E-16); plan limit and disconnect signals (MISSING, E-17); team status (E-13); team computer last seen (MISSING, E-12); pause (MISSING, E-29); website payment (MISSING, E-20); update ready (CHANGES, E-27); notification permission (read from the computer, E-26).
- **Not here:** marketing messages, tips, "what's new" announcements, anything that is a decision (those are cards in Needs you).

---

### G-05 Keyboard

- **Who:** owner, partner.
- **Purpose:** Every action in Colony works from the keyboard, the same way on Mac (Cmd) and Windows (Ctrl), and focus never gets lost.
- **Get here:** anywhere. "Show all shortcuts" (Cmd/Ctrl+/) lists them inside the app.
- **Leads to:** the targets below.
- **Shows:** the shortcut list (from Cmd/Ctrl+/) and, for each control that has a shortcut, the shortcut in its hover text.

| Action | Mac | Windows |
|-|-|-|
| Today | Cmd+1 | Ctrl+1 |
| Conversations | Cmd+2 | Ctrl+2 |
| Team | Cmd+3 | Ctrl+3 |
| Settings | Cmd+, | Ctrl+, |
| Needs you | Cmd+J | Ctrl+J |
| New conversation | Cmd+N | Ctrl+N |
| Search everything | Cmd+K | Ctrl+K |
| Find in this conversation | Cmd+F | Ctrl+F |
| Previous or next conversation | Option+Up, Option+Down | Alt+Up, Alt+Down |
| Send message | Enter | Enter |
| New line in a message | Shift+Enter | Shift+Enter |
| Start or stop a voice note (T-07) | Cmd+Shift+R (default) | Ctrl+Shift+R (default) |
| Attach a file (T-08) | Cmd+Shift+A (default) | Ctrl+Shift+A (default) |
| Main action of the open card, for example Approve | Cmd+Enter | Ctrl+Enter |
| Close a card viewer or cancel | Esc | Esc |
| Undo, while its toast shows (G-06) | Cmd+Z | Ctrl+Z |
| Show all shortcuts | Cmd+/ | Ctrl+/ |
| Bigger, smaller, normal text | Cmd+=, Cmd+-, Cmd+0 | Ctrl+=, Ctrl+-, Ctrl+0 |
| Close the window (the team keeps working) | Cmd+W | Ctrl+W or Alt+F4 |
| Quit Colony | Cmd+Q | Ctrl+Q |

- **Actions:** as in the table.
- **Focus rules:**
  1. Every action can be reached with Tab and Shift+Tab, in reading order, and used with Enter or Space.
  2. Moving to another area puts focus at the start of that area's main content, and the area's name is announced.
  3. Opening a conversation puts focus in its message box.
  4. Opening a card viewer moves focus into the viewer and keeps it there until it closes. Closing returns focus to the card that opened it.
  5. Lists (conversations, Needs you, team, desk lists) move with the arrow keys; Enter opens the item.
  6. A new decision is announced once, politely ("New decision from Scout: Naledi's posts for next week"). New messages in the open conversation are announced politely as they arrive. Nothing else is announced by itself.
  7. While someone types in a message box, no shortcut fires except Esc and the Cmd/Ctrl combinations above.
  8. Pointer and keyboard reach the same states. For example, a voice note started by holding the pointer and one started with Cmd/Ctrl+Shift+R go through the same recording, review and send states (T-07).
  9. Shortcuts that act on a card (Cmd/Ctrl+Enter) work only when the card or its viewer has focus.
- **States:** the shortcut list itself has a normal state only. Shortcuts for areas that are unavailable (for example during first run, or when update is required) do nothing and are not listed.
- **Words:**
  - "Keyboard shortcuts"
  - "Approve (Cmd+Enter)"
  - "Close (Esc)"
- **Data:** none. Client only (E-01).
- **Not here:** custom shortcuts, shortcuts that work when Colony is not in front (default: none at launch), single-letter shortcuts.

---

### G-06 Toasts and undo

- **Who:** owner, partner.
- **Purpose:** Confirm small things quietly and give people a short chance to undo.
- **Get here:** after the actions in the table.
- **Leads to:** the toast's own action ("Undo", "Show"), otherwise nowhere.
- **Shows:** one short line and at most one action. One toast at a time; a new one replaces the old one.

| After | Words | Action | Shown for |
|-|-|-|-|
| Approving a decision | "Approved. Naledi will get going." | Undo | 10 seconds |
| Declining a decision | "Declined. Scout will let Maya know." | Undo | 10 seconds |
| Marking as posted | "Marked as posted." | Undo | 10 seconds |
| Marking as sent | "Marked as sent." | Undo | 10 seconds |
| Copying a caption or message | "Copied." | none | 3 seconds |
| Saving images or files | "Saved to Downloads." | Show (opens the folder) | 5 seconds |
| Archiving a conversation | "Conversation archived." | Undo | 10 seconds |
| Renaming an employee | "Naledi is now Thandi." | Undo | 10 seconds |
| Sending a partner invite | "Invite sent to kagiso@leratodesigns.co.za." | none (cancelling lives in S-05) | 5 seconds |

- **Actions:**
  - Undo (whoever did the action) -> puts things back as they were. Keyboard: Cmd/Ctrl+Z while the toast shows.
  - Show (whoever saved) -> opens the folder on the computer.
- **States and rules:**
  - The timer pauses while the pointer or keyboard focus is on the toast.
  - **Approvals wait for the undo time (default).** An approval or decline is held on this computer for the 10 seconds of its toast, then sent. If Colony closes during those 10 seconds, it is sent at once, because that was the person's choice. This gives people a real way back from a misclick before an employee starts.
  - Undo after the toast is gone is not possible; the card's history shows what happened.
  - Toasts are announced politely by screen readers and never take focus.
  - Toasts never carry problems that need action (those are banners or cards) and never ask for decisions.
  - Settings save as soon as they change and show no toast.
- **Words:** as in the table.
- **Data:** client only (E-01), plus the decision and draft status records the actions write (E-08).
- **Not here:** toast history, toasts for things employees do on their own (those appear in conversations, desks or the activity tab).

---

### G-07 Employee identity

- **Who:** owner, partner see it. It describes the six employees (and any later hires).
- **Purpose:** Show every employee the same way everywhere, so people always know who did something and what each employee is doing right now.
- **Get here:** wherever an employee appears: messages and cards (T-03, C-xx), Today's team line (T-01), the team list (M-01), the employee page (M-02), the menu bar or tray menu (G-02), first run (O-08, O-10).
- **Leads to:** selecting an employee anywhere opens their page (M-02).
- **Shows:**
  1. **Photo.** A default portrait per role; Scout's relates to the Colony mark (default). The owner or a partner can change it in M-06.
  2. **First name**, for example "Naledi".
  3. **Role**, for example "Social Media Manager". Role titles are fixed.
  4. **Status words** with an extra line, from the table below.

| Status | Words | Means | Extra line | From the engine |
|-|-|-|-|-|
| Starting | "Starting" | Getting ready: just hired, restarted, or the computer just woke up | "Getting ready" | Starting, waking |
| Working | "Working" | Busy on a task right now | The task in plain words: "Drafting next week's posts". If a decision is also open: "1 decision waiting" | Ready, with an active task (E-13) |
| Free | "Free" | Running, with nothing to do right now | The next routine: "Next: lead hunt, Tuesday 09:00" | Ready or listening, no task |
| Waiting on you | "Waiting on you" | Cannot go on until a person decides something | "1 decision" (opens T-05 showing this employee's decisions) | An open decision from this employee and no other task |
| Paused | "Paused" | Paused by a person, or the whole team is paused | The reason: "Paused by Kagiso", "Credits ran out", "Claude plan limit until 14:00", "Weekly budget used until Monday" | E-15, E-17, X-22 |
| Stopped | "Stopped" | Something went wrong and the employee is not running | "Stopped at 11:02. Restart?" | Failed, or stopped without anyone asking |
| Away | "Away" | The computer that runs the team is off or asleep, or Colony was quit there | "Lerato's MacBook Air is off" | Team computer not seen (E-12) |

  - **Order when several are true:** Stopped, Paused, Away, Starting, Waiting on you, Working, Free. An employee who is working while a decision of theirs is open shows "Working" with "1 decision waiting".
  - "Away" is not in the index list for G-07. It is needed because a computer that is off is not a fault and not a pause (default).
  - Weekly budgets run from Monday 00:00 to Sunday 23:59, company time (default).
- **Actions:**
  - Open the employee (everyone) -> M-02. Keyboard: Enter on the name.
  - From "Waiting on you": open that employee's decisions (everyone) -> T-05, filtered.
  - From "Stopped": "Restart" (owner, partner) -> X-08.
- **States:** the seven statuses above, plus "Hiring" during O-08 and M-08 ("Hiring Naledi").
- **Rules for names:** a first name of 1 to 20 characters (letters, spaces, hyphens, apostrophes), unique in the company. Scout cannot be renamed. People (owner and partners) appear with their own name and photo or initials and never get a status chip.
- **Team order:** Scout first, then Maya, Naledi, Sipho, Leo, Grace, then later hires by hire date (default).
- **Words:**
  - "Naledi, Social Media Manager: Working on next week's posts"
  - "Sipho: Free. Next: lead hunt, Tuesday 09:00"
  - "Leo: Waiting on you. 1 decision"
  - "Grace: Paused. Credits ran out"
  - "Maya: Away. Lerato's MacBook Air is off"
  - Screen reader: "Naledi, Social Media Manager, Working: drafting next week's posts"
- **Data:** engine runtime states (starting, listening, waking, ready, failed, stopped; CHANGES, E-13), current task (work items, WORKS), open decisions (E-06), names (profile per company, WORKS), photos (media upload WORKS, E-31), role titles (E-09), budget state (E-15), team computer last seen (E-12).
- **Not here:** model or provider names, cost per message, "online" dots without words, technical health details.

---

### G-08 Themes and sizes

- **Who:** owner, partner. Each person on each computer.
- **Purpose:** Colony is comfortable to read in light or dark, at larger text, and in small windows.
- **Get here:** Settings, S-08 Account, "Appearance" (default location); text size also with Cmd/Ctrl+= and Cmd/Ctrl+-.
- **Leads to:** nowhere new.
- **Shows:**
  1. **Theme:** "Match this computer" (default), "Light", "Dark".
  2. **Text size:** "Default", "Large", "Larger". Cmd/Ctrl+= and Cmd/Ctrl+- move between them; Cmd/Ctrl+0 returns to Default.
- **Actions:** choose theme (everyone) -> applies at once; choose text size (everyone) -> applies at once.
- **States and rules:**
  - **Smallest window:** 1024 x 700. The window cannot be made smaller. At that size the main content and its actions stay visible; secondary information may move behind an action; the window never scrolls sideways; long names wrap or show in full when focused or hovered.
  - **Large text at the smallest window:** nothing is cut off without a way to read all of it.
  - **Full screen** on Mac and maximised windows on Windows work like any other size.
  - **Reduced motion:** follows the computer's setting.
  - **Higher contrast:** follows the computer's increased contrast (Mac) and contrast themes (Windows) (default).
  - **Language:** English only at launch (default).
  - **Times:** shown in the time zone of the person's computer. Schedules that run in the company time zone say so when it differs: "08:30 Johannesburg time".
  - **Money:** credits in US dollars with cents: "$18.40".
- **Words:**
  - "Appearance"
  - "Match this computer"
  - "Text size: Large"
- **Data:** preferences saved on this computer (client, E-01).
- **Not here:** the September theme catalogue and density options (dropped: the owner chose a fresh look on 11 October), custom fonts (Manrope only), per-conversation themes.

---

## Defaults in this file

Chosen while writing. They stand unless the owner changes them. Items marked "Decided by the owner" were answered on 11 October.

1. **Undo before an approval takes effect.** Approvals and declines are held for 10 seconds with Undo, then sent (G-06). Recommendation: keep it; it protects against misclicks at a cost of 10 seconds per decision.
2. **People in more than one company.** A person who belongs to two companies (for example an owner with two businesses) gets a "Switch company" action (G-01). Recommendation: yes, shown only to people with more than one company.
3. **Friday wrap time.** Recommendation: Fridays at 16:00 in the company's time zone, sent as a notification like the morning brief (G-03).
