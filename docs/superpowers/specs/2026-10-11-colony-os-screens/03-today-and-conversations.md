# 03 Today and conversations

Part of the Colony screen pack. Every entry follows [00-index.md](00-index.md): the entry template (section 9), product rules (section 5), words (section 8) and common states (section 10). Sample content comes from the sample company (section 7).

Choices made in this file that the owner has not decided are marked "(default)". Questions for the owner are at the end.

Keyboard notes: Enter sends and Shift+Enter adds a new line in every message box. Esc closes a viewer or cancels a recording. Arrow keys move through lists. Named shortcuts (Today, Needs you, new conversation, search, record a voice note) are defined once in G-05; entries here refer to them as "shortcut (G-05)".

### T-01 Today

- **Who:** owner, partner. Each person sees their own greeting; everything else is the same company picture.
- **Purpose:** One calm place that says how the business is doing, what needs you, and lets you talk to Scout.
- **Get here:**
  - The app opens here every time (G-01).
  - "Today", always first in the conversation list (T-02), and in the app navigation (G-01).
  - "Open Colony" in the menu bar or tray (G-02).
  - The brief or Friday wrap notification (G-03).
  - Today shortcut (G-05).
  - The end of first run (O-10) and of joining as a partner (P-01).
- **Leads to:** T-03 (a brief link, a card's conversation, or a message sent from the box), card viewers (C-01 to C-20), T-05 (see all), M-02 (an employee in the team line), D-01 (past briefs), X-03 (while you were away details), S-02 (buy credits, owner only).
- **Shows,** in order of importance:
  1. **Greeting** with the viewer's first name and the time of day: "Good morning, Lerato."
  2. **Scout's latest brief** (C-19): 1 to 5 sentences with links, the time Scout wrote it, and "Past briefs" (D-01). On Fridays, once the Friday wrap arrives it takes this place.
  3. **Needs you:** open decisions and "do it yourself" items (approved drafts waiting to be posted or sent) that this person can act on, as inline cards (C-00). Urgent first, then the items waiting longest. Up to 5 show (default), then a count of the rest with "See all" (T-05). Each item shows the card type, from whom, one line, how long it has waited, and its main actions.
  4. **While you were away** (only after the team computer was off or asleep, X-03): from when to when, what ran late and has now caught up, and anything that could not be done. Each person can dismiss it; it also goes away at the next brief.
  5. **Team line:** one line per employee: photo, name, status (G-07) and what they are doing now ("Drafting next week's posts"), or "Waiting on you: 2" linking to those items. Scout first, then the rest in team order (section 4 of the index).
  6. **Message Scout:** a box to type, record a voice note (T-07) or add files (T-08).
- **Actions:**
  - The card actions on any Needs you item (owner, partner; billing items owner only) -> same result as in the card (C-00). Keyboard: Tab into the item, Tab through its actions, Enter.
  - Open a card (owner, partner) -> its full viewer. Keyboard: Enter on the focused card.
  - See all (owner, partner) -> T-05. Keyboard: Needs you shortcut (G-05).
  - Open a brief link (owner, partner) -> the conversation, card or desk it names.
  - Past briefs (owner, partner) -> D-01.
  - Open an employee (owner, partner) -> M-02. Keyboard: Tab to the employee, Enter.
  - Dismiss "While you were away" (owner, partner; for themselves only) -> hidden for that person.
  - Send to Scout (owner, partner) -> starts a new conversation with that message and opens it (T-03). See routing below.
  - Buy credits (owner only; shown when the team is paused because credits ran out) -> credits purchase in S-02.
  - Remind Lerato (partner only; on items only the owner can decide) -> sends the owner a notification (G-03). Once per item per day (default).
- **Routing a message sent from Today:** the message starts a new conversation titled "New conversation" until Scout names it. If Scout thinks it belongs to an existing conversation, its reply offers "Move to Spring launch" and "Keep separate". Moving carries the message and Scout's reply into that conversation, removes the empty new one, and opens the target with a line "Moved here from Today". Scout never moves anything unless a person chooses to.
- **States:**
  - **First day, before plans arrive:** the brief place holds Scout's welcome ("Welcome, Lerato. The team is reading up on Lerato Designs. Plans usually arrive within the hour.") (default wording). Every employee in the team line shows "Getting to know your business". Needs you is empty or holds early questions (C-02). When the plans arrive, Scout's company plan (C-03) goes to the top of Needs you with a notification (G-03). Scout's welcome also lives in a conversation called "Getting started" (default) so replies have a home.
  - **Normal morning:** the brief written at 08:30 on weekdays (company time zone), Needs you, team line.
  - **Before today's brief** (for example at 07:00): the last brief or wrap stays, labelled with its day ("Thursday's brief").
  - **Friday:** after the Friday wrap arrives (Friday 16:00, default), it replaces the morning brief and includes this week's credits spent.
  - **Weekend:** no brief on Saturday or Sunday; Friday's wrap stays.
  - **Nothing needs you:** "Nothing needs you right now." plus the last thing decided, when there is one ("Approved by Kagiso, 10:42: next week's posts").
  - **Many decisions:** the 5 most important, then "See all 12". Related items that arrive together are already one card (a week of posts is one card).
  - **While you were away:** block 4 shows.
  - **Team paused** (credits out X-05, own plan limit X-06, paused by a person X-22): banner (G-04) with the reason and the fix. Every employee's status reads "Paused". When the reason is credits, the owner sees "Buy credits" at the top of Needs you. People can still decide; employees act on decisions when the team resumes.
  - **Scout stopped** (X-09) or **team stopped** (X-10): the brief place says so in plain words with "Restart" (owner, partner), because Scout cannot explain its own absence.
  - **Team computer off** (seen from a partner's or a second computer, X-13): "The team runs on Lerato's MacBook, which is off or asleep. Everything waits until it's back on."
  - **Partner view:** greeting with the partner's name. Same brief, team line and Needs you. Items only the owner can decide show "Only Lerato can approve this" and "Remind Lerato".
  - **Offline, loading, problem:** common states. Offline keeps the last loaded brief and items visible.
- **Words:**
  - "Good morning, Lerato."
  - "Naledi has next week's 5 posts ready, Sipho found 12 boutiques, and Thabo is still waiting about his order."
  - "Nothing needs you right now."
  - "Your computer was asleep from 21:40 to 07:05. The team has caught up."
  - "The team is paused because credits ran out. Buy credits to carry on."
  - "This sounds like Spring launch. Move it there?"
- **Data:**
  - Brief and Friday wrap: E-07, MISSING.
  - Needs you: decisions are company asks (kinds 30643, 47032, 47033), WORKS; knowing which decisions each person can act on needs E-06, PARTIAL (asks carry no addressee today, so the client scans every conversation); "do it yourself" items need typed card statuses, E-08, PARTIAL.
  - Team line: E-13, PARTIAL.
  - While you were away: E-14, MISSING.
  - Message box: creates a private topic conversation (kind 9007, members added with 9000) with the first message (kind 9), E-05, WORKS. Moving a message is a client step (post in the target, delete in the source), E-05.
  - Paused reasons and buy credits: E-15, PARTIAL; E-16, PARTIAL; E-17, PARTIAL.
  - Partner limits and "Remind Lerato": E-19, PARTIAL; E-26, PARTIAL.
- **Not here:** charts and numbers (D-02), the full conversation list (T-02), settings, talking to one employee directly (M-07), a feed of everything the team did (M-05 and D-01 hold that).

### T-02 Conversation list

- **Who:** owner, partner. Both see every conversation.
- **Purpose:** Every topic you work on with Scout, and which ones need you.
- **Get here:** "Conversations" in the app navigation (G-01); always reachable from Today and from any conversation; conversations shortcut (G-05).
- **Leads to:** T-01 (Today), T-03 (open a conversation), T-04 (new), T-06 (search), the archived list.
- **Shows,** in order of importance:
  1. **Today**, always first. It cannot be moved, renamed or archived.
  2. **Open conversations**, newest activity first (a new message, a new card, or a card changing status). Each row shows:
     - the title;
     - the last line, with who said it ("Naledi: 5 posts for next week", "You: Can we do Friday?"); a card shows as its type and title;
     - the time of the last activity;
     - an unread marker (per person);
     - a needs-you count for this person (decisions plus things to post or send);
     - the employees involved (anyone with tasks or cards in it);
     - a "someone is working here" marker while a work line is active (see T-03).
  3. **Archived**, closed by default, with a count.
  4. **New conversation** and **Search**.
- **Actions:**
  - Open (owner, partner) -> T-03. Keyboard: arrow keys to move, Enter.
  - New conversation (owner, partner) -> T-04. Keyboard: new conversation shortcut (G-05).
  - Search (owner, partner) -> T-06. Keyboard: search shortcut (G-05).
  - Rename (owner, partner) -> new title for everyone; once a person renames a conversation, Scout never renames it again. Keyboard: on the focused row, open its menu (menu key or Shift+F10), choose Rename, type, Enter.
  - Archive (owner, partner) -> moves to Archived for everyone; any work there carries on; toast with Undo (G-06). If an employee is still working there, the toast says so: "Archived. Naledi is still working there." (default).
  - Bring back (owner, partner) -> back in the open list.
  - Mark as unread, Mark as read (each person for themselves) (default).
- **States:**
  - **Normal, loading, offline:** common states. Offline shows what was already loaded.
  - **Activity in an archived conversation:** a new card or message brings it back to the open list by itself, with the line "Back from the archive: new card from Naledi" (default).
  - **Empty** (everything archived): "No open conversations. Start one with Scout." with New conversation. First run always creates "Getting started", so a brand new company is never empty.
  - **Archived list empty:** "Nothing archived."
  - **Partner view:** identical.
- **Words:**
  - "New conversation"
  - "Naledi: 5 posts for next week"
  - "2 need you"
  - "Archived. Naledi is still working there. Undo"
  - "No open conversations. Start one with Scout."
- **Data:**
  - My conversations: membership (kind 39002 with my key as `#p`) then metadata (kind 39000), E-05, WORKS.
  - Last line and time: latest message (kind 9) or card event, E-05 WORKS, E-08 PARTIAL.
  - Unread: per-person read state (kind 30078, encrypted to self), PARTIAL: no server counts, so each computer works them out.
  - Needs-you counts: E-06, PARTIAL.
  - Employees involved and work marker: tasks scoped to the conversation (kinds 30634, 47006), WORKS; live status E-13, PARTIAL.
  - Rename and archive: conversation metadata edit (kind 9002, `archived` tag for archive), E-05, WORKS.
- **Not here:** deleting conversations, pinning other conversations, folders, muting one conversation (notification choices live in S-06), conversations between people without Scout.

### T-03 Conversation

- **Who:** owner, partner.
- **Purpose:** Work on one topic with Scout: say what you want, see the team's progress, and decide on what they bring back.
- **Get here:** T-02 (a row), T-01 (a brief link, a card's conversation, or a message sent from the box), T-04 (after the first message), T-05 and card viewers ("Open conversation"), T-06 (a search result jumps to the message), notifications for a mention or a reply (G-03), M-02 and desks (a card's "Open conversation").
- **Leads to:** card viewers (C-01 to C-20), M-02 (an employee in the header or a message), T-07 (voice note), T-08 (attachments), T-02 (back), S-02 (buy credits, owner only, when paused), X-09 or X-10 (restart).
- **Who speaks here:**
  - The owner and partners, each with their name ("Lerato", "Kagiso").
  - Scout, always. Scout answers every message unless an employee was named.
  - An employee, only when a person names them with @ (they answer that message here) or when they post a card for this topic. Cards show who made them ("from Naledi").
  - Quiet event lines written by Colony itself: "Kagiso approved next week's posts", "Moved here from Today", "Lerato renamed this Spring launch".
- **Shows,** in order of importance:
  1. **Header:** the title; the employees involved, each with status (G-07); "Where this stands": one line kept up to date by Scout (default), for example "Posts approved; banner goes live Friday; Sipho is lining up 3 boutiques."
  2. **Messages and cards,** oldest at the top and newest at the bottom, with day separators. Cards appear in their inline form (C-00) and keep their status up to date wherever they are in the history.
  3. **Work lines:** one line per piece of work in progress for this topic: "Naledi is drafting 3 posts for the spring launch." When the work ends, its card or result replaces the line. Three or more lines collapse into "3 people are working on this", which can be opened.
  4. **"Scout is writing"** while Scout prepares a reply.
  5. **Composer:** text, @ to name someone, add files (T-08), record a voice note (T-07), send.
  6. **First unread marker** and **"Jump to latest"** whenever the newest message is out of view. "Jump to latest" must always be available when the person is not at the newest message (repo rule 6).
- **Actions:**
  - Send (owner, partner) -> message appears at once, marked "Sending" until the company has it. Keyboard: Enter.
  - @ to name someone (owner, partner) -> a list of the team (by current names) and the people in the company. Typing filters it; arrow keys and Enter choose; Esc closes. Naming an employee makes that employee answer this message here; Scout still sees everything, and the next message without a name goes back to Scout (default). Naming a partner or the owner sends them a notification (G-03).
  - Reply to a message (owner, partner) -> quotes it in the composer so Scout knows what you mean. Keyboard: on the focused message, open its menu, Reply.
  - Copy text (owner, partner) -> copied; toast (G-06).
  - Edit your own message (author only; until someone replies, default) -> text changes for everyone with "Edited"; Scout is told.
  - Delete your own message (author only) -> removed for everyone with "Message deleted"; Scout is told. Confirmation through toast with Undo (G-06).
  - Card actions (see C-00 and each card) -> as in the card.
  - Open an employee (owner, partner) -> M-02.
  - Rename, Archive, Mark as unread (owner, partner) -> as in T-02, from the conversation's menu.
  - Restart Scout or Restart the team (owner, partner) -> shown only in those states (X-09, X-10).
  - Buy credits (owner only) -> shown only when the team is paused for credits.
- **States:**
  - **New** (no messages yet): see T-04.
  - **Normal.**
  - **Loading and long history:** the latest messages load first; older ones load as the person scrolls back, with placeholders while they load. Cards far back stay actionable. Opening from a notification or search lands on that message and highlights it briefly.
  - **Someone working:** work lines show.
  - **Message sending, then sent.** **Not sent:** the message is marked "Not sent" with "Try again" and "Delete".
  - **Offline:** banner (G-04). New messages are marked "Waiting to send" and go out by themselves when the connection returns; card actions are disabled with "You can decide when you're back online."
  - **Team paused** (credits out, own plan limit, paused by a person): banner (G-04) with the reason. People can still send and decide. A line under the latest message says "Scout will reply when the team is back." The owner gets "Buy credits" when credits are the reason; a partner sees "Only Lerato can buy credits" and "Remind Lerato".
  - **Scout stopped** (X-09): banner "Scout has stopped." with "Restart Scout" (owner, partner). Messages still send and wait for Scout.
  - **Team stopped** (X-10): banner with "Restart the team" (owner, partner).
  - **Team computer off** (seen from a partner's or a second computer, X-13): banner "The team runs on Lerato's MacBook, which is off or asleep. Messages wait until it's back on."
  - **An employee is stuck:** Scout posts a problem card (C-18) here if the stuck work belongs to this topic; it also goes to Needs you.
  - **Archived:** the conversation opens normally with a note "Archived" and "Bring back". Sending a message brings it back (default).
  - **Partner view:** identical; owner-only cards show as read-only with "Only Lerato can approve this".
- **Words:**
  - "Naledi is drafting 3 posts for the spring launch."
  - "Maya wants to run 15% off the linen range this weekend. Approve?"
  - "Not sent. Check your internet and try again."
  - "Scout has stopped. Restart Scout to keep things moving."
  - "Scout will reply when the team is back."
  - "Where this stands: posts approved, banner goes live Friday."
- **Data:**
  - Messages: kind 9 with threading for replies, edits (kind 40003), deletes (kind 9005), E-05, WORKS.
  - Members: owner, partners and Scout from the start; employees added when they start work here (kinds 9000, 9001), WORKS.
  - Title and "Where this stands": conversation metadata (name and description, kind 39000, edited with kind 9002), WORKS; Scout keeping the line current needs E-09 (role pack instructions), MISSING.
  - "Scout is writing": typing (kind 20002), WORKS.
  - Work lines: tasks scoped to the conversation (kinds 30634, 47006; tracking 30652, 47041), WORKS; live status E-13, PARTIAL.
  - Cards: E-08, PARTIAL; decisions WORKS.
  - Read position: kind 30078, PARTIAL.
  - Paused, stopped and computer-off states: E-13, E-15, E-17, E-12, E-29.
  - Voice notes and files: see T-07 and T-08.
- **Not here:** threads inside a conversation, emoji reactions, pinned messages, editing someone else's message, a text formatting toolbar, calls, choosing which employees work on the topic (Scout decides; a person can name anyone with @).

### T-04 New conversation

- **Who:** owner, partner.
- **Purpose:** Start a new topic with Scout in one step.
- **Get here:** "New conversation" in G-01 or T-02; new conversation shortcut (G-05); "Message Scout" in the menu bar or tray (G-02); the empty state of T-02; sending from the Today box (T-01) creates one directly.
- **Leads to:** T-03 (this conversation once the first message is sent), T-02 (closing an empty one).
- **Shows,** in order of importance:
  1. Scout's opening line: "What do you want to work on?"
  2. **Starting points:** "Plan a sale", "Get more customers", "Update my website", "Answer a customer", "Something else".
  3. **Composer** with voice note (T-07) and files (T-08).
- **Actions:**
  - Choose a starting point (owner, partner) -> sends a short first message ("I want to plan a sale.") and Scout replies with one question ("Nice. Which products, and when should it run?"). "Something else" only puts the cursor in the composer. Keyboard: Tab through the starting points, Enter.
  - "Answer a customer" (owner, partner) -> Scout asks for the customer's message: paste it, add a screenshot, or forward the email to the company's forwarding address (shown with a copy action). Grace then drafts the reply (C-09).
  - Type and send (owner, partner) -> the conversation starts.
  - Close without sending (owner, partner) -> nothing is saved; back to where the person was. Keyboard: Esc.
- **States:**
  - **Empty:** the starting points show.
  - **First message sent:** title "New conversation" until Scout names it after the first exchange ("Spring sale"). People can rename it at any time.
  - **Belongs to an existing topic:** Scout offers "Move to Spring launch" or "Keep separate" (as in T-01 routing).
  - **Offline:** the message waits to send (common state); the conversation is created when back online.
  - **Team paused:** the conversation starts; Scout replies when the team is back (banner G-04).
  - **Partner view:** identical.
- **Words:**
  - "What do you want to work on?"
  - "Plan a sale"
  - "Nice. Which products, and when should it run?"
  - "Paste the customer's message here, add a screenshot, or forward the email to lerato-designs@inbox.colony.global." (address format default, see E-21)
  - "This sounds like Spring launch. Move it there?"
- **Data:** creates a private topic conversation (kind 9007) with owner, partners and Scout as members (kind 9000), E-05, WORKS; title set by Scout through metadata (kind 9002), WORKS; forwarding address E-21, MISSING.
- **Not here:** choosing employees, templates beyond the five starting points, scheduling a conversation for later.

### T-05 Needs you

- **Who:** owner, partner. Each sees what they can act on; owner-only items appear read-only for partners.
- **Purpose:** Every open decision and every "do it yourself" item in one list, so nothing waits too long.
- **Get here:** "See all" on Today (T-01); the Needs you count in the app navigation (G-01); the menu bar or tray count (G-02); a decision notification (G-03, which opens the card inside this list); Needs you shortcut (G-05).
- **Leads to:** card viewers (C-01 to C-20), T-03 ("Open conversation" on any item), M-02 (from whom), S-02 (buy credits, owner only).
- **Shows,** in order of importance:
  1. **Open items**, urgent first, then the ones waiting longest. Urgent means: money at risk, the team blocked, an employee failing, a customer waiting more than 24 hours, or something that expires today. Each item shows its inline card (C-00), from whom, its conversation, how long it has waited and, when urgent, why ("Thabo has waited 26 hours").
  2. **Filters:** All, Urgent, To post or send, Plans, Money and hiring (default set), and From one employee (used when T-05 opens from an employee's "Waiting on you" in G-07 or M-01). Each shows a count.
  3. **History:** decided items, newest first, each with what was decided, by whom and when ("Approved by Kagiso, 10:42"), and a link to the card. History can be narrowed to one person.
- **Actions:**
  - The card actions (owner, partner; billing items owner only) -> as in each card. Keyboard: arrow keys between items, Tab through an item's actions, Enter.
  - Open (owner, partner) -> full viewer.
  - Change filter (owner, partner) -> list narrows. Keyboard: Tab to the filters, arrow keys, Enter.
  - Open history (owner, partner) -> decided items.
  - Remind Lerato (partner only, on owner-only items) -> notification to the owner, once per item per day (default).
- **States:**
  - **Empty:** "Nothing needs you right now." with the most recent decision underneath.
  - **Many items:** the list is grouped only by the order above; no paging needed for the first 100 items (default).
  - **Two people deciding at once:** the first decision wins; the other person sees the card update to "Approved by Kagiso, 10:42" and their action is not sent twice.
  - **Offline:** items stay readable; actions are disabled with "You can decide when you're back online."
  - **Team paused:** decisions can still be made; each decided card says the employee will act when the team is back.
  - **Partner view:** owner-only items (billing: buying credits, auto top-up, hosting payment) show "Only Lerato can approve this" and "Remind Lerato". Everything else is the same as for the owner.
  - **Loading, problem:** common states.
- **Words:**
  - "Nothing needs you right now."
  - "Waiting since yesterday, 16:20"
  - "Urgent: Thabo has waited 26 hours."
  - "Only Lerato can approve this."
  - "Approved by Kagiso, 10:42."
- **Data:** company asks (kinds 30643, 47032, 47033) and their resolutions, WORKS; the per-person index of open items, E-06, PARTIAL; "do it yourself" items from card statuses, E-08 and E-24, PARTIAL and MISSING; who decided and partner limits, E-19, PARTIAL (today only owners and admins can resolve money, hire, tool, secret and duty asks; the partner role must map onto that); reminders, E-26, PARTIAL.
- **Not here:** approving many different items in one action (a week of posts already arrives as one card), snoozing, assigning items to a specific person.

### T-06 Search

- **Who:** owner, partner.
- **Purpose:** Find any conversation, message, voice note or card by its words.
- **Get here:** "Search" in G-01 or T-02; search shortcut (G-05).
- **Leads to:** T-03 (opens at the found message, highlighted), card viewers, T-03 with Scout (when the person asks Scout instead).
- **Shows,** in order of importance:
  1. **Search box.**
  2. **Results,** grouped: Conversations (title matches), Messages (with the matching words, who wrote it, when, and which conversation), Cards (type, title, status). Voice notes match on their transcript. Archived conversations are included and marked "Archived".
  3. **Narrow by:** person (anyone in the company or any employee) and conversation (default).
  4. Before typing: the last 5 searches and the last 5 conversations opened (default).
- **Actions:**
  - Type (owner, partner) -> results update as the person types (default).
  - Open a result (owner, partner) -> jumps to it. Keyboard: arrow keys, Enter.
  - Ask Scout (owner, partner; offered when nothing is found) -> starts a message to Scout with the search words ("Find the post about the linen dress").
  - Clear (owner, partner) -> empty box. Keyboard: Esc clears, a second Esc closes search.
- **States:**
  - **Nothing typed:** recent searches and conversations.
  - **No results:** "Nothing found for "linen dress". Try fewer words, or ask Scout."
  - **Loading:** common state.
  - **Offline:** "Search needs the internet." Recent conversations stay available.
  - **Partner view:** identical.
- **Words:**
  - "Search conversations"
  - "Nothing found for "linen dress". Try fewer words, or ask Scout."
  - "Ask Scout to find it"
  - "In Spring launch, Tuesday"
- **Data:** message search through the relay's full-text search (NIP-50), E-32, WORKS; cards are company records, which the relay leaves out of search today, so cards are found through their text in conversation messages or need E-08 to add searchable text, PARTIAL; voice note transcripts are message text, E-18, MISSING.
- **Not here:** searching inside desks (each desk has its own filters), searching the website, searching the web.

### T-07 Voice note

- **Who:** owner, partner.
- **Purpose:** Talk to Scout instead of typing, like a WhatsApp voice note. Scout gets the words.
- **Get here:** the voice note control in every message box: T-03, T-04, the Today box (T-01) and direct chat (M-07); record shortcut (G-05).
- **Leads to:** back to the message box it came from; X-20 (microphone permission).
- **How recording works,** for every way of using it:
  - **Hold** (pointer): press and hold to record, let go to send at once. Moving away from the control while holding cancels.
  - **Lock** (pointer): while holding, choose lock to keep recording hands-free, then Stop to review.
  - **Keyboard:** the record shortcut (G-05), or Enter or Space on the focused record control, starts recording; pressing it again stops and opens the review. Esc cancels.
- **Shows,** in order of importance:
  1. **While recording:** that it is recording, the time so far, a live sound level, Cancel, and Stop or Send.
  2. **Review** (after lock or keyboard recording): play back, the transcript once it is ready, Send, Discard.
  3. **Sent voice note** in the conversation: who sent it, play control, length, and the transcript under it, which can be opened in full when long.
- **Actions:**
  - Record, Stop, Cancel, Send, Discard (owner, partner) -> as described above.
  - Play and pause (owner, partner) -> plays the recording. Keyboard: Enter or Space on the focused control.
  - Fix transcript (the sender only, after sending) -> edits the words Scout reads; the note shows "Transcript fixed by Lerato" and Scout is told.
  - Try again (sender; when transcription failed) -> transcribes again.
  - Type instead (sender) -> discards the recording and puts the cursor in the message box.
- **States:**
  - **First use:** the computer asks for microphone access (X-20). If refused: "Colony can't use your microphone. Turn it on in your computer's settings." with "Open settings".
  - **No microphone found:** "No microphone found. Plug one in or type instead."
  - **Recording;** at 4 minutes 30 seconds a warning shows; at 5 minutes (default limit) recording stops and goes to review.
  - **Too short** (under 1 second): nothing is sent; toast "Hold to record." (G-06).
  - **Transcribing:** "Writing it down..." on the sent note. Scout waits for the words.
  - **Transcript ready:** shown under the note.
  - **Transcription failed:** "Couldn't write this one down." with "Try again" and "Type instead".
  - **Offline:** recording works; the note shows "Waiting to send" and sends and transcribes when back online.
  - **First voice note on this computer:** "Getting voice notes ready on this computer. This takes about a minute." Voice notes are written down on this computer, so they use no credits and work on an own plan too.
  - **Partner view:** identical.
- **Words:**
  - "Hold to record. Let go to send."
  - "Recording 0:42"
  - "Writing it down..."
  - "Couldn't write this one down. Try again, or type it instead."
  - "Voice notes can be up to 5 minutes."
  - "Transcript fixed by Lerato"
- **Data:** audio upload to company media (Blossom upload with kind 24242 authorisation, file limit 100 MB), WORKS; transcription on this computer and the transcript stored with the message, E-18, MISSING. Technical call (11 October): writing voice notes down on the computer makes them free, private and available without credits, instead of the small per-minute credit cost first discussed.
- **Not here:** Scout replying with its voice, calls, voice commands that act without a message, translating voice notes.

### T-08 Attachments

- **Who:** owner, partner.
- **Purpose:** Give the team photos, documents and screenshots, for example product photos for Naledi or a screenshot of a customer's WhatsApp message for Grace.
- **Get here:** the "add files" control in every message box (T-01 box, T-03, T-04, M-07); dragging files onto a conversation; pasting an image or file from the clipboard (Cmd+V on Mac, Ctrl+V on Windows).
- **Leads to:** the message box (files waiting to be sent), the photo viewer and document viewer (below), D-03 (photo library) when photos are added there.
- **Shows,** in order of importance:
  1. **Before sending:** each chosen file with a preview (a picture for photos, the first frame for videos, name and size for documents), a remove action per file, and room for a message.
  2. **While uploading:** progress per file ("Uploading 3 of 6").
  3. **In the conversation:** the files inside the message. Photos open in a photo viewer (next, previous, save, add to photo library). PDFs and documents open in a preview when possible, otherwise with the computer's own app, and can be saved.
  4. **Photo library offer:** when someone sends photos, Colony asks once per message: "Are these product photos? Add them to your photo library so Naledi and Leo can use them." with "Add to library" and "Not these" (default).
- **Allowed files:** photos (JPEG, PNG, HEIC, WebP), videos (MP4, MOV), PDFs, documents (Word, Excel, PowerPoint, plain text, CSV) (default list). Each message holds up to 10 files (default).
- **Limits** (from the code survey): photo 50 MB, video 500 MB, other file 100 MB each; at most 30 uploads a minute, so a large batch is sent in turns with "This takes a minute" (default).
- **Actions:**
  - Add files, remove a file, send (owner, partner). Keyboard: Tab to "add files", Enter opens the computer's file picker; files in the waiting list can be focused and removed with Delete or Backspace.
  - Drop or paste files (owner, partner) -> added to the waiting list.
  - Open, save, add to photo library (owner, partner) -> as described.
  - Try again or remove (owner, partner; on a failed upload).
- **States:**
  - **Uploading;** **upload failed:** "Couldn't upload Kaya-dress.jpg." with "Try again" and "Remove".
  - **Too big:** "This video is 620 MB. The limit is 500 MB. Trim it or share a link instead."
  - **Not allowed:** "Colony can't take .exe files. Photos, videos, PDFs and documents work."
  - **Too many:** "You can add up to 10 files at a time."
  - **Offline:** files wait and upload when back online.
  - **Screenshot of a customer message:** Scout replies that Grace will draft an answer (C-09) and the image stays with the message.
  - **Partner view:** identical.
- **Words:**
  - "Add photos or files"
  - "Uploading 3 of 6"
  - "This video is 620 MB. The limit is 500 MB."
  - "Are these product photos? Add them to your photo library so Naledi and Leo can use them."
  - "Added 6 photos to your library."
- **Data:** upload to company media (Blossom `PUT /upload` with kind 24242 authorisation, files attached to the message through `imeta` tags), WORKS; size and rate limits enforced by the relay, WORKS; photo library with tags, E-31, MISSING.
- **Not here:** editing images, picking from cloud drives (Google Drive, Dropbox), link previews for pasted web addresses, sending files to customers (people send those themselves).

## Defaults in this file

Chosen while writing. They stand unless the owner changes them. Items marked "Decided by the owner" were answered on 11 October.

1. **Voice notes without credits.** Decided as a technical call: voice notes are written down on the computer itself, so they cost nothing and always work (E-18 holds the proof gate).
2. **"Where this stands" line.** Scout keeps a one-line status at the top of every conversation so you never have to scroll back. Recommendation: yes, it cuts reading.
3. **Messages from the Today box.** Each starts a new conversation, and Scout offers to move it into an existing topic when it fits. Recommendation: keep it this way; Scout never files things on its own.
4. **Editing and deleting your own messages.** Recommendation: delete anytime, edit only until someone replies, so Scout never acts on words that later changed.
5. **One brief for everyone.** Owner and partners see the same company brief, each with their own Needs you. Recommendation: yes, one shared brief.
