# 04 Cards

Part of the Colony screen pack. Every entry follows [00-index.md](00-index.md): the entry template (section 9), product rules (section 5), words (section 8) and common states (section 10). Sample content comes from the sample company (section 7).

A card is anything the team brings to a person: a decision, a question, a draft, a plan, a problem, a result. Every card has two forms:

- **Inline form:** short, inside conversations (T-03), Today (T-01), Needs you (T-05), desks (D-01 to D-06) and Activity (M-05).
- **Full viewer:** everything on the card, its versions and its history.

C-00 defines what every card shares. Each card entry after it lists what is specific to that card. Choices the owner has not decided are marked "(default)". Questions for the owner are at the end.

### C-00 Card basics

- **Who:** employees and Scout create cards. The owner and partners act on them. Owner-only cards (billing) are read-only for partners.
- **Purpose:** One shape for everything the team brings to a person, so every decision looks and works the same way everywhere.
- **Get here:** cards appear in T-01, T-03, T-05, the desks (D-01 to D-06) and M-05. A decision notification (G-03) opens the card's full viewer.
- **Leads to:** the full viewer; T-03 ("Open conversation"); M-02 (from whom); the newer version of a replaced card.
- **Shows,** in order of importance.
  - Inline form:
    1. Status in words: "Waiting for you", "Approved by Kagiso, 10:42".
    2. Card type and title: "Social post: Linen dress in morning light".
    3. One line of summary or reason.
    4. One key preview: an image, the first lines of text, or the main number.
    5. From whom (photo, name, role; G-07) and when it arrived. "Urgent" with the reason, only when urgent.
    6. "AI-made" when any image on the card is AI-made.
    7. Up to three actions for the current status. The rest are in the full viewer.
  - Full viewer adds:
    8. Everything on the card (the fields each card lists below).
    9. Where it belongs: "In Spring launch" with "Open conversation".
    10. Versions: "Version 2: changed after Lerato's note", with earlier versions and the notes that led to each.
    11. History: every status change with who and when.
    12. Expiry, when the card is time-bound: "Decide by Friday 12:00, or the sale starts without the banner."
- **One card, one status:** a card shows the same status everywhere it appears and updates live in all of them.
- **Actions shared by most cards:**
  - **Approve**, or the card's own verb ("Make it live", "Hire", "Send", "Use this") (owner, partner, unless the card says owner only) -> status Approved with the decided-by line; the employee acts on it. A toast offers Undo for 10 seconds (default, G-06); after that the decision is final.
  - **Ask for changes** (owner, partner) -> a note opens (typed or a voice note, T-07). Sending it sets "Changes asked by Lerato", and the employee makes a new version.
  - **Decline** (owner, partner) -> optional reason. Status Declined. The employee drops it or asks Scout what to do instead.
  - **Open** (owner, partner) -> full viewer.
  - **Open conversation** (owner, partner) -> T-03 at this card.
  - **Keyboard:** Tab moves through a card's actions and Enter runs the focused one. In the full viewer, Cmd+Enter on Mac or Ctrl+Enter on Windows runs the main action (default; G-05 holds the full list). Esc closes the viewer.
- **"Do it yourself" actions** (drafts first: any approved post, message, reply or invoice) (owner, partner):
  - Copy caption or Copy text.
  - Save images or Save files (to the computer's Downloads folder, default).
  - Open the right app: Instagram, Facebook, TikTok, your email app, or WhatsApp with the text already filled in.
  - Mark as posted or Mark as sent, with an optional link to the post.
  - Undo the mark.
- **Statuses** (the shared words; each card lists the ones it uses):
  - **Waiting for you:** arrived and needs a person.
  - **Changes asked:** a person sent a note; the employee is making a new version.
  - **Approved:** a person said yes; shows who and when.
  - **Declined:** a person said no; shows who, when and the reason if given.
  - **Ready to post, Ready to send:** approved and waiting for a person to post or send it. These items show under "To post or send" in Needs you.
  - **Posted, Sent:** a person marked it done, with a link when they added one.
  - **Live:** the website change is on the website.
  - **Expired:** the moment passed before anyone decided; the card says what happened instead.
  - **Withdrawn:** the employee or Scout pulled it, with one line why.
  - **Replaced:** a newer version exists; links to it.
  - Card-specific endings: Answered, Hired, Paid, Fixed, Chosen.
- **States:**
  - **Two people at once:** the first decision wins. The other person sees the card update ("Kagiso already approved this at 10:42") and their action is not applied.
  - **Offline:** decision actions are disabled with "You can decide when you're back online." Copy and Save still work for content already loaded (default).
  - **Team paused:** decisions still work. The card adds "Naledi will act on this when the team is back."
  - **Owner-only card seen by a partner:** read-only, "Only Lerato can approve this", with "Remind Lerato".
  - **Image did not load:** a placeholder with "Couldn't load this image." and "Try again".
  - **Loading:** common state.
- **Words:**
  - "Waiting for you since 09:12"
  - "Approved by Kagiso, 10:42"
  - "Changes asked by Lerato: use the green dress instead."
  - "Kagiso already approved this at 10:42."
  - "Version 2: changed after Lerato's note"
  - "Withdrawn by Naledi: the market was cancelled."
- **Data:**
  - Decisions are company asks: types approval, question, choice, checklist; categories general, money, hire, tool, secret, duty (head kind 30643; events 47032 and 47033), WORKS. Only human owners and admins can resolve the non-general categories, WORKS.
  - Typed card content, versions and "do it yourself" statuses: E-08, PARTIAL.
  - Decided-by line and partner limits: E-19, PARTIAL.
  - Per-person lists: E-06, PARTIAL.
  - First decision wins: needs a server check when a decision is recorded (unsure whether the relay rejects a second resolution today; E-06 and E-08 must confirm it).
- **Not here:** comment threads on cards (notes go through Ask for changes), assigning a card to one person, reactions on cards.

### C-01 Decision

- **Who:** from any employee through Scout, or from Scout itself. The owner or a partner decides. Billing decisions use C-16.
- **Purpose:** A yes-or-no choice that no other card fits.
- **Get here:** like every card (C-00); also the deciding employee's desk.
- **Leads to:** full viewer, T-03, the follow-up work (for example a customer reply C-09 after an exception is approved).
- **Shows:**
  - Inline: status; the question in one line; why, in one line; from whom; the deadline when there is one.
  - Viewer adds: details (a few sentences), what happens on yes and on no (one line each, when useful), links to related cards or documents, history.
- **Actions:**
  - Approve (owner, partner) -> Approved.
  - Decline (owner, partner) -> Declined, optional reason.
  - Ask for changes (owner, partner) -> note; a new version follows.
  - Ask Scout (owner, partner) -> quotes the card in the conversation's message box so the person can ask a follow-up question.
  - Keyboard: as C-00.
- **States:** Waiting for you, Approved, Declined, Changes asked, Expired, Withdrawn, Replaced.
- **Words:**
  - "Maya wants to run 15% off the linen range this weekend. Approve?"
  - "Aisha wore the dress once. Our policy says unworn only. Accept the return anyway?"
  - "Sipho wants to offer Juniper and Jade 10 dresses on consignment."
  - "Declined by Lerato: not before the launch."
- **Data:** approval ask (kind 30643 with events 47032 and 47033), WORKS.
- **Not here:** more than two answers (C-02), money amounts (C-16).

### C-02 Question

- **Who:** from any employee through Scout. The owner or a partner answers.
- **Purpose:** Get a fact or a choice the team needs, one question at a time.
- **Get here:** like every card (C-00).
- **Leads to:** full viewer, T-03.
- **Shows:**
  - Inline: the question; why it is needed (one line); either options to pick from or an answer box; "You decide" when the question allows it.
  - Viewer adds: the history and, once answered, the answer with who gave it.
- **Actions:**
  - Answer (owner, partner) -> type or record a voice note, then Send -> Answered.
  - Pick an option, or several when allowed (owner, partner) -> Answered. Keyboard: arrow keys move, Space picks, Enter sends.
  - Add files as the answer (owner, partner), for example when asked for photos -> Answered (files go through T-08).
  - You decide (owner, partner) -> the employee chooses and says what it chose.
  - Skip (owner, partner) -> Skipped; the employee carries on and says what it assumed.
- **States:** Waiting for you, Answered, Skipped, Expired, Withdrawn.
- **Words:**
  - "Which sizes does the linen dress come in?"
  - "What's your return window: 7, 14 or 30 days?"
  - "Can you send 10 photos of the new collection?"
  - "Answered by Lerato: XS to XL."
  - "Skipped. Naledi will use last season's photos."
- **Data:** question, choice and checklist ask types, WORKS. File answers use company media, WORKS.
- **Not here:** long forms; one question per card.

### C-03 Plan

- **Who:** each employee's 2-week plan comes from that employee through Scout. On the first day Scout sends one company plan that holds everyone's plans. The owner or a partner approves.
- **Purpose:** Agree what each employee will do for the next 2 weeks, so they can work without asking.
- **Get here:** like every card (C-00); the company plan is the main Needs you item on the first day (T-01); the "Plans" filter in T-05; M-03 shows the active plan; D-01 shows the company plan.
- **Leads to:** M-03 (once approved), M-02, T-03, C-16 (when a plan needs more budget).
- **Shows:**
  - Company plan inline: "Your team's plan for 13 to 26 October"; Scout's summary in 1 to 5 sentences; the employees covered; estimated credits per week against the balance.
  - Company plan viewer: Scout's summary; one section per employee (closed until opened) holding that employee's plan; total estimated credits per week; one list of everything the team needs from the owner.
  - Employee plan viewer: the employee; dates; the goal it serves ("More customers and sales each month"); each week's outcomes (3 to 6 lines per week); routines; decisions the owner should expect; what the employee needs from the owner ("10 photos of the new collection"); estimated credits per week against the weekly budget.
- **Actions:**
  - Approve all (owner, partner; company plan) -> every employee plan Approved; each employee starts.
  - Approve one, Ask for changes on one (owner, partner; per employee inside the company plan).
  - Approve (owner, partner; single employee plan) -> Approved; the plan becomes active (M-03).
  - Ask for changes (owner, partner) -> note; a new version follows.
  - There is no Decline: a plan always gets a better version (default).
- **States:**
  - Waiting for you, Approved (active), Changes asked, Replaced, Ended (after 2 weeks; the next plan arrives with the Monday plan check).
  - **Above weekly budget:** "Needs more than Naledi's weekly budget ($5.50 against $5.00)", with a money request (C-16) attached.
  - **Not enough credits:** the owner sees "Buy credits"; a partner sees "Only Lerato can buy credits".
- **Words:**
  - "Your team's plan for 13 to 26 October is ready. One OK starts everyone."
  - "Week 1: brand kit, 5 posts, first carousel."
  - "Naledi needs 10 photos of the new collection from you."
  - "Approved by Lerato. The team is starting."
- **Data:** plan content, E-08, PARTIAL; goals (kinds 30642, 47031), WORKS; tasks created after approval (kinds 30634, 47006), WORKS; routines are duties (kinds 30655, 47044) whose approval creates the schedule, WORKS; estimated credits and weekly budgets, E-15, PARTIAL; plans written by employees, E-09, MISSING.
- **Not here:** editing a plan by hand (ask for changes instead), plans longer than 2 weeks.

### C-04 Social post

- **Who:** from Naledi (Social Media Manager). The owner or a partner approves, then posts it themselves.
- **Purpose:** A ready-to-post social media post, or a week of them, to approve and then post.
- **Get here:** like every card (C-00); D-03 (calendar and ready to post); the "Time to post" notification (G-03).
- **Leads to:** full viewer, D-03, T-03, the social app opened by "Open Instagram", "Open Facebook" or "Open TikTok".
- **Shows:**
  - Inline (one post): status; where it goes (Instagram feed, Instagram story, Facebook, TikTok); the image or first video frame; the first line of the caption; the suggested day and time ("Tuesday 18:00"); "AI-made" when any image is.
  - Inline (week batch): "5 posts for 13 to 19 October" with small previews and a count per status.
  - Viewer: the image or video; full caption; hashtags; where it goes; suggested time and why ("Your followers are most active around 18:00"); campaign ("Spring launch"); an image description for screen reader users, written by Naledi (default); notes ("Uses your photo of the Kaya dress"); when it has AI-made images, "AI-made" and the reminder "Turn on Instagram's AI label when you post"; versions; history.
  - Batch viewer: every post as above, each with its own status and actions.
- **Actions:**
  - Waiting for you: Approve (owner, partner) -> Ready to post at its time; Ask for changes; Skip -> Skipped. A batch adds Approve all.
  - Ready to post: Copy caption (with hashtags); Save images; Open Instagram, Open Facebook or Open TikTok; Mark as posted (optional link); Change time (owner, partner, default) -> new reminder time.
  - Posted: Undo the mark; Open the post (when a link was added).
  - Keyboard: as C-00; in a batch, arrow keys move between posts.
- **States:**
  - Waiting for you, Changes asked, Ready to post, Posted, Skipped, Replaced, Withdrawn.
  - **Time to post:** at the scheduled time a notification (G-03) says "Time to post: Linen dress in morning light."
  - **Late:** 3 hours after its time without being marked posted, Naledi suggests a new time (default).
  - **Missed:** 24 hours after its time (default) without being marked posted: "Not posted yet. Post now or skip?"
- **Words:**
  - "Next week's 5 posts are ready. Want to look now?"
  - "Ready to post Tuesday at 18:00."
  - "Caption copied."
  - "1 image saved to Downloads."
  - "Marked as posted by Lerato, 18:04."
  - "This post has AI-made images. Turn on Instagram's AI label when you post."
- **Data:** post content and statuses, E-08 and E-24, PARTIAL and MISSING; images in company media, WORKS, and the photo library, E-31, MISSING; time-to-post reminders, E-24 and E-26; AI-made images, E-16, PARTIAL.
- **Not here:** posting straight to Instagram, Facebook or TikTok (later, through official connections), post statistics.

### C-05 Carousel

- **Who:** from Naledi. The owner or a partner approves, then posts it.
- **Purpose:** A multi-slide post (up to 10 slides, default) to approve and post.
- **Get here:** like C-04.
- **Leads to:** like C-04.
- **Shows:**
  - Inline: the cover slide, the number of slides ("6 slides"), the first line of the caption, where it goes, the suggested time, "AI-made" when any slide is.
  - Viewer: every slide in order with the words on it; caption; hashtags; per-slide notes; everything else as C-04.
- **Actions:**
  - As C-04.
  - Ask for changes can name slides: "Slide 3: use the green dress."
  - Save images saves every slide, numbered in order ("spring-carousel-1.jpg" to "spring-carousel-6.jpg").
  - Keyboard: left and right arrow keys move between slides in the viewer.
- **States:** as C-04.
- **Words:**
  - "6 slides: why linen, the 3 pieces, how to style them, shop the drop."
  - "Changes asked by Lerato: slide 3, use the green dress."
  - "6 images saved to Downloads."
- **Data:** as C-04.
- **Not here:** rearranging slides by hand or editing words on slides directly (ask Naledi) (default).

### C-06 Video script

- **Who:** from Naledi (reels and TikTok). The owner or a partner approves, films and posts.
- **Purpose:** Everything needed to film a short video yourself.
- **Get here:** like C-04.
- **Leads to:** like C-04.
- **Shows:**
  - Inline: where it goes, length ("20 seconds"), the hook line, number of shots, suggested time.
  - Viewer: the hook (the first line said or shown); the shot list, numbered (what to film, about how long, words on screen); the spoken words or voiceover; caption and hashtags; a music idea described in words ("upbeat Amapiano"), never a file; what you need (outfits, props, place); suggested time.
- **Actions:**
  - Waiting for you: Approve -> To film; Ask for changes; Skip.
  - To film: tick each shot as it is filmed (owner, partner); Copy script; Mark as filmed (default) -> To post.
  - To post: Copy caption; Open Instagram or Open TikTok; Mark as posted (optional link).
  - Posted: Undo the mark.
- **States:** Waiting for you, Changes asked, To film, To post, Posted, Skipped, Missed (as C-04), Replaced, Withdrawn.
- **Words:**
  - "20-second reel: 'Three ways to wear the linen shirt.' 5 shots, about 15 minutes to film."
  - "Shot 2: close-up of the fabric in sunlight, 3 seconds."
  - "Music idea: upbeat Amapiano."
- **Data:** E-08 and E-24.
- **Not here:** Naledi editing the video (default for launch), uploading the finished clip to a platform.

### C-07 Image set

- **Who:** from Naledi or Leo. The owner or a partner chooses.
- **Purpose:** Choose from AI-made images (backgrounds, lifestyle scenes, graphics) before any of them is used. Owner decision: AI-made images are allowed, each shown first, never as fake product shots.
- **Get here:** like every card (C-00); also from inside a post (C-04, C-05) or website change (C-10) that needs a picture.
- **Leads to:** full viewer, the post or page that will use the image, D-03 photo library.
- **Shows:**
  - Inline: what it is for ("Background for the spring launch post"); 2 to 6 options (4 by default) as small previews, each labelled "AI-made"; status.
  - Viewer: each option large with "AI-made. Not a photo of your product."; what was asked for, in plain words ("A sunny Johannesburg street in soft morning light"); where it will be used; credits used ("These 4 images used $0.24 of credits", default).
- **Rules:**
  - An AI-made image never shows, or claims to show, the owner's actual products. Product shots always come from the owner's own photos.
  - The "AI-made" label stays with the image everywhere inside Colony: the photo library, posts and website changes.
- **Actions:**
  - Use this (owner, partner; pick one or more) -> Chosen; the image goes into the photo library tagged "AI-made" and into the post or page.
  - More like this (owner, partner) -> a new set, which uses credits. Disabled with the reason when credits are out.
  - None of these (owner, partner) -> note; Declined; a new set may follow.
  - Save image (owner, partner).
  - Keyboard: arrow keys move between options, Space picks, Enter uses the picked ones.
- **States:** Waiting for you, Chosen, More asked, Declined, Expired, Withdrawn, Replaced. Credits out: "Out of credits, so Naledi can't make more right now."
- **Words:**
  - "4 backgrounds for the spring post. All AI-made."
  - "AI-made. Not a photo of your product."
  - "These 4 images used $0.24 of credits."
  - "Out of credits, so Naledi can't make more right now."
- **Data:** making images through the credits gateway, E-16, PARTIAL (one model today; images need their own route); photo library, E-31, MISSING; credits used, E-15, PARTIAL.
- **Not here:** AI-made images of the products themselves, editing images.

### C-08 Message draft

- **Who:** from Sipho (first messages and follow-ups to leads), Grace (supplier emails, payment reminders) and Maya (newsletter). The owner or a partner approves, then sends it.
- **Purpose:** A message ready for a person to send from their own email, WhatsApp or social account.
- **Get here:** like every card (C-00); D-04 (Sipho), D-06 (Grace), D-02 (Maya).
- **Leads to:** full viewer, the email app, WhatsApp or the social app; D-04 deal or D-06 admin list after sending.
- **Shows:**
  - Inline (one message): who it is to ("Juniper and Jade, buyer"), how to send it (email, Instagram message, Facebook message, WhatsApp), the first line, status.
  - Inline (batch): "5 first messages to boutiques" with a count per status.
  - Viewer: to (name, business, and the email address, handle or number when known); how to send it; subject (email); the message; attachments (for example the line sheet PDF); why this person (one line, for first messages); what happens next ("If there's no reply by Thursday, Sipho will draft a follow-up."); versions; history.
  - Newsletter viewer: subject, preview line, body with images, and the note "Paste this into the email tool you use for your customer list."
- **Actions:**
  - Waiting for you: Approve -> Ready to send; Ask for changes; Skip.
  - Ready to send: Copy message; Copy subject; Open your email app (a new email with the address, subject and message filled in where the email app allows it, default); Open WhatsApp with the text (when a number is known); Open Instagram or Open Facebook (the person's profile, after copying the text); Save attachments; Mark as sent.
  - Sent: Undo the mark; Add their reply (owner, partner) -> paste or forward the answer; Sipho or Grace takes it from there (the deal in D-04, or the admin list in D-06).
  - A batch adds Approve all; arrow keys move between messages.
- **States:** Waiting for you, Changes asked, Ready to send, Sent, Replied, Skipped, Replaced, Withdrawn.
- **Words:**
  - "First message to Juniper and Jade is ready. They stock 4 local designers like you."
  - "Ready to send by email."
  - "Opened your email app with the message filled in."
  - "Marked as sent by Kagiso, 11:20."
  - "No reply yet. Sipho will draft a follow-up on Thursday."
- **Data:** E-08; deals, E-23, PARTIAL; sending from Colony is not built at launch (people send themselves); WhatsApp and email open with links, no connection needed.
- **Not here:** sending from Colony, reading the inbox, sending to many addresses at once.

### C-09 Customer reply

- **Who:** from Grace (Customer Care and Admin). The owner or a partner approves, then sends it.
- **Purpose:** A kind, correct answer to a customer, ready to send.
- **Get here:** like every card (C-00); D-06 customer messages; a "customer waiting" notification (G-03).
- **Leads to:** full viewer, D-06a customer thread, the email app or WhatsApp, C-01 when an exception needs a decision first.
- **Shows:**
  - Inline: the customer's name; where they wrote (email, WhatsApp, Instagram, website form); the first line of their message; how long they have waited; status. "Urgent" after 24 hours.
  - Viewer: the customer's message (the text, or the pasted screenshot with Grace's reading of it); the drafted reply; what Grace based it on ("Returns policy: 14 days, unworn, with receipt"), linked to D-06b; a suggested next step ("After sending, resend order 1042"); earlier messages with this customer (D-06a).
- **Rule:** refunds, discounts and anything outside the policies arrive first as a decision (C-01). The reply follows the decision.
- **Actions:**
  - Waiting for you: Approve -> Ready to send; Ask for changes; Skip (no reply needed).
  - Ready to send: Copy reply; Open your email app (a reply to the customer's address); Open WhatsApp with the text (when the number is known); Open Instagram (their profile); Mark as sent.
  - Sent: Undo the mark. When the customer writes back, a person pastes or forwards it and a new card arrives in the same customer thread.
- **States:** Waiting for you, Changes asked, Ready to send, Sent, Customer replied, Skipped, Replaced, Withdrawn. Urgent after 24 hours of waiting.
- **Words:**
  - "Thabo asked where order 1042 is. It shipped Monday; here's a reply with the tracking link."
  - "Waiting 26 hours. Urgent."
  - "Based on: delivery takes 3 to 5 working days in Gauteng."
  - "Marked as sent by Lerato, 08:47."
- **Data:** customer inbox records, E-22, MISSING; forwarded email, E-21, MISSING; pasted screenshots in company media, WORKS; card content, E-08.
- **Not here:** sending from Colony, reading WhatsApp or Instagram messages automatically (later), refunds through Colony.

### C-10 Website change

- **Who:** from Leo (Website Builder). The owner or a partner makes it live.
- **Purpose:** See exactly what will change on the website, on a computer and a phone, before it goes live.
- **Get here:** like every card (C-00); D-05 (changes waiting).
- **Leads to:** full viewer, D-05, the live website ("See it live"), S-02 (owner, when hosting is unpaid).
- **Shows:**
  - Inline: what changes (one line), the pages affected, a small before-and-after preview, status.
  - Viewer: before and after for a computer screen and for a phone, with a switch between the two; the changes in plain words ("New banner: Spring linen, now in"; "Kaya dress price: R899 to R849"); why; which website (leratodesigns.colony.site); when it goes live (when approved, or at a set time); versions; history.
  - First website: the same card covering every page ("Your first website: 4 pages"), each page with its own preview.
- **Actions:**
  - Waiting for you: Make it live (owner, partner) -> Going live, then Live with "See it live"; Ask for changes; Decline.
  - Scheduled (default): Make it live now; Cancel.
  - Live: Undo (owner, partner) -> confirmation (X-16), then the website goes back to how it was before this change (Undone); See it live.
  - Didn't go live: Try again (owner, partner).
  - Keyboard: as C-00; the computer and phone switch is reachable by Tab and arrow keys.
- **States:**
  - Waiting for you, Changes asked, Scheduled, Going live, Live, Didn't go live, Undone, Declined, Replaced, Withdrawn.
  - **Website paused** because the hosting payment failed (W-09): Make it live is disabled with "Your website is paused because the hosting payment didn't go through. Lerato can fix this in billing." The owner sees "Fix billing" (S-02).
  - **No own domain yet:** works the same on the Colony address.
- **Words:**
  - "New spring banner and 2 price changes. Here's how it looks on a phone."
  - "Live. See it live"
  - "Undone. Your website is back to how it was at 09:30."
  - "Didn't go live. Try again?"
- **Data:** website hosting, previews, history and undo, E-20, MISSING.
- **Not here:** editing the website by hand, checkout and shop features (buy links only, owner decision).

### C-11 Lead list

- **Who:** from Sipho (Sales Director). The owner or a partner chooses who to contact.
- **Purpose:** Pick which potential customers Sipho should contact.
- **Get here:** like every card (C-00); D-04.
- **Leads to:** full viewer, C-08 (first messages for the chosen leads), D-04 (deals).
- **Shows:**
  - Inline: title ("20 boutiques that stock local designers"), count, the first 3 names, status.
  - Viewer: for each lead: business name, type, place, why they fit (one line), how to reach them (email, Instagram, phone, website, as found), where Sipho found them, and the suggested way to make contact. A tick box per lead. A link to the target customers this list is based on (D-04).
- **Actions:**
  - Approve chosen (owner, partner) -> Approved ("12 chosen"); Sipho drafts first messages (C-08).
  - Remove a lead (owner, partner), with an optional reason ("Not our style").
  - More like this one (owner, partner) -> Sipho looks for similar businesses.
  - Decline all (owner, partner) -> note.
  - Keyboard: arrow keys move between leads, Space ticks, Enter approves the chosen ones.
- **States:** Waiting for you, Approved, Changes asked, Declined, Expired, Withdrawn.
- **Words:**
  - "20 boutiques that stock local designers. The top 5 already carry brands like yours."
  - "Juniper and Jade, Rosebank: stocks 4 local labels, posts new arrivals every Friday."
  - "12 chosen. Sipho is writing first messages."
- **Data:** prospect records for leads and deals, E-23, PARTIAL; lead search services are not built, so Sipho researches on the web at launch.
- **Not here:** buying lead lists, contacting anyone without a person sending the message.

### C-12 Document

- **Who:** from Maya (growth plan, campaign brief), Grace (FAQ and policies), Sipho (line sheet, price list), or any employee. The owner or a partner approves.
- **Purpose:** Anything long, kept out of the chat and approved as one piece.
- **Get here:** like every card (C-00); the owning desk.
- **Leads to:** full viewer, D-06b (approved FAQ and policies become Grace's knowledge), C-10 (Leo may follow with a website change showing the new policies).
- **Shows:**
  - Inline: title, type, one line on why, status.
  - Viewer: the document with headings; what changed since the last version; versions; history; Download PDF.
- **Actions:**
  - Approve (owner, partner) -> Approved; it becomes the version the team uses.
  - Ask for changes (owner, partner) -> note, which can name a part ("Returns: 30 days, not 14").
  - Decline (owner, partner).
  - Download PDF, Copy text (owner, partner).
- **States:** Waiting for you, Changes asked, Approved, Declined, Replaced, Withdrawn. Documents that need no decision arrive as a done note (C-20) instead.
- **Words:**
  - "Your FAQ and policies are ready: delivery, returns, sizes and payment."
  - "Changed since version 1: returns are now 30 days."
  - "Approved by Lerato. Grace will use this from now on."
- **Data:** document content and versions, E-08, PARTIAL.
- **Not here:** editing the document by hand (default), inline comments.

### C-13 Invoice or quote

- **Who:** from Grace (invoices) or Sipho (quotes for bulk orders). The owner or a partner approves. These are money coming in, not Colony billing, so partners may act on them.
- **Purpose:** A correct invoice or quote, ready to send, then tracked until paid or accepted.
- **Get here:** like every card (C-00); D-06 admin list; D-04 deal.
- **Leads to:** full viewer, the email app, D-06 (admin list), D-04 (deal), C-08 (payment reminder when overdue).
- **Shows:**
  - Inline: type and number ("Invoice INV-0042"), customer, total in the business's currency ("R8,450.00"), due date or valid-until date, status.
  - Viewer: the PDF; customer (name, business, email); items (description, quantity, price); subtotal; VAT when the business is VAT registered (from the business profile); total; due or valid-until date; payment details from the business profile, shown only to the owner and partners; notes.
- **Actions:**
  - Waiting for you: Approve -> Ready to send; Ask for changes; Decline.
  - Ready to send: Download PDF; Copy email text; Open your email app (the card says to attach the PDF yourself); Mark as sent.
  - Sent invoice: Mark as paid (owner, partner) -> Paid; Cancel (owner, partner) -> Cancelled.
  - Sent quote: Accepted, Not accepted (owner, partner).
  - Overdue: Grace drafts a payment reminder (C-08) and the card links to it.
- **States:** Waiting for you, Changes asked, Ready to send, Sent, Paid, Overdue, Cancelled, Accepted, Not accepted, Declined, Replaced.
- **Words:**
  - "Invoice for Brightway Events: 30 uniforms, R8,450. Due 31 October."
  - "Attach the PDF to your email before sending."
  - "Overdue by 3 days. Grace drafted a friendly reminder."
  - "Marked as paid by Kagiso."
- **Data:** card content, E-08, PARTIAL; business details and payment details, E-04, MISSING.
- **Not here:** taking payments, bookkeeping, tax returns.

### C-14 Brand kit

- **Who:** from Naledi, in her first week. The owner or a partner approves.
- **Purpose:** Agree how the brand looks and sounds, so every post and page matches.
- **Get here:** like every card (C-00); D-03 brand kit; S-01 business profile.
- **Leads to:** full viewer, D-03, S-01.
- **Shows:**
  - Inline: the logo, the colours, the three voice words, status.
  - Viewer: logo (found on the website or Instagram, or "Add your logo"); 3 to 5 colours with plain names ("Linen", "Terracotta"); the fonts for posts and the website; voice (three words plus a "do" line and a "don't" line); photo style notes; a sample post that uses the kit.
- **Actions:**
  - Approve (owner, partner) -> Approved; Naledi and Leo use it.
  - Ask for changes (owner, partner) -> note; a new version follows.
  - Add logo (owner, partner) -> the computer's file picker (T-08 rules).
  - No Decline: the kit always gets a better version (default).
- **States:** Waiting for you, Changes asked, Approved, Replaced.
- **Words:**
  - "Here's your brand kit: linen, terracotta and olive, warm and confident."
  - "Voice: warm, proud, simple. Do: talk like a friend who sews. Don't: shout sales."
  - "I couldn't find your logo. Add it?"
- **Data:** card content, E-08; brand saved with the business profile, E-04, MISSING; logo in company media, WORKS; photo library, E-31.
- **Not here:** designing a new logo (default).

### C-15 Hire proposal

- **Who:** from Scout. The owner or a partner hires (partners hire under the owner's rule "like you, minus billing"; see Data).
- **Purpose:** Add an employee to the team with one decision.
- **Get here:** like every card (C-00); Scout suggests hires in conversations, and the owner can ask Scout for one.
- **Leads to:** full viewer, M-08 (new hire starting), M-01.
- **Shows:**
  - Inline: proposed name and role ("Leo, Website Builder"), why now (one line), weekly budget, status.
  - Viewer: role; name (can be changed before hiring); who they report to; their first week; routines; what they never do alone; weekly budget; the whole team's weekly budget after hiring against the credits balance.
- **Actions:**
  - Hire (owner, partner) -> Hired; M-08 starts.
  - Change name (owner, partner; before hiring).
  - Ask for changes (owner, partner), for example a lower weekly budget.
  - Not now (owner, partner) -> optional note; Not now.
- **States:** Waiting for you, Hired, Not now, Changes asked, Expired, Withdrawn.
- **Words:**
  - "You skipped a Website Builder at setup. Thabo's order question came from your old site's broken form. Hire Leo for $4 a week?"
  - "Hired by Lerato. Leo is getting started."
  - "Not now. Scout won't ask again for 30 days." (default)
- **Data:** hires (kinds 30650, 47039), WORKS, but the final approval is owner-only in the relay today, so partner hiring needs E-19; starting the employee at once, E-10, MISSING; role packs, E-09, MISSING.
- **Not here:** a catalog of roles (hiring goes through Scout), creating custom employees by form.

### C-16 Money request

- **Who:** from Scout, on behalf of an employee or the team. Who may approve depends on the kind:

| Kind | Example | Who approves |
|-|-|-|
| Weekly budget raise (credits inside Colony) | "Naledi needs $0.50 more a week for the launch" | Owner, partner |
| Ad spend (the owner's own money on Instagram or Facebook; Colony never spends it) | "$20 on an Instagram ad this weekend" | Owner, partner |
| Paid tool or service outside Colony | "A $9 a month scheduling app" | Owner, partner |
| Buy credits, turn on auto top-up | "Credits will run out Thursday" | Owner only |
| Website hosting payment ($10 a month: start it, fix a failed payment) | "Hosting payment didn't go through" | Owner only |

- **Purpose:** Make every money choice explicit, with who may make it.
- **Get here:** like every card (C-00); the "Money and hiring" filter in T-05.
- **Leads to:** full viewer, S-02 (owner: buy credits or fix billing), M-06 (weekly budget).
- **Shows:**
  - Inline: amount and how often ("$0.50 more a week", "$20 once"); what for; from whom; status; for partners on owner-only kinds, "Only Lerato can approve this".
  - Viewer: amount; how often; what for; why (one line); what happens if declined; the current numbers (weekly budget and this week's use; credits balance; for hosting, the next payment date); history.
- **Actions:**
  - Approve (as the table says) -> Approved. Approving ad spend means "go ahead and prepare it"; the person pays on the ad platform.
  - Change amount (whoever may approve) -> new amount, then Approve.
  - Decline (whoever may approve) -> Declined.
  - Buy credits, Fix billing (owner only) -> S-02.
  - Remind Lerato (partner, on owner-only kinds) -> notification to the owner.
- **States:** Waiting for you, Approved, Paid (purchases), Declined, Changes asked, Expired, Withdrawn.
- **Words:**
  - "Naledi needs $0.50 more a week while the launch runs. Approve?"
  - "Maya suggests $20 on an Instagram ad this weekend. You'd pay Instagram directly."
  - "Credits will run out on Thursday at this pace."
  - "Only Lerato can approve this."
- **Data:** weekly budgets (kind 30653), PARTIAL, not enforced, E-15; credits purchase (Stripe checkout), WORKS; company wallet, E-15, PARTIAL; hosting payment, E-20, MISSING; partner rules, E-19, PARTIAL.
- **Not here:** Colony paying anyone on the owner's behalf, refunds of credits (none self-serve).

### C-17 Numbers check-in

- **Who:** from Maya through Scout, every Thursday at 10:00 (default). The owner or a partner fills it in.
- **Purpose:** Give Maya this week's numbers in under a minute, with nothing to connect.
- **Get here:** like every card (C-00); D-02.
- **Leads to:** D-02 (numbers update).
- **Shows:**
  - Inline and viewer: "Thursday numbers: how was this week?" with orders this week (a number); sales this week (amount in the business's currency, optional); new followers (optional); anything to add (optional, typed or a voice note). Site visits this week appear on their own from the Colony website, when there is one.
- **Actions:**
  - Send (owner, partner) -> Sent; Maya updates D-02.
  - Skip this week (owner, partner) -> Skipped.
  - Keyboard: Tab through the fields, Enter sends.
- **States:** Waiting for you, Sent, Skipped, Expired (when next week's arrives). A field with something that is not a number says "Just the number, please."
- **Words:**
  - "Thursday numbers: how was this week?"
  - "Site visits this week: 312 (from your website)."
  - "Thanks. Orders are up 4 on last week."
- **Data:** growth numbers, E-25, MISSING; site visits, E-20, MISSING.
- **Not here:** connecting a shop, Google Analytics or Instagram statistics (owner decision: weekly question plus site stats).

### C-18 Problem

- **Who:** from Scout. The owner or a partner acts. When Scout itself has stopped, the app shows X-09 instead, because Scout cannot report its own absence.
- **Purpose:** Say in plain words that an employee is stuck or failing, and offer the fix.
- **Get here:** like every card (C-00); always urgent; the urgent notification (G-03); the employee's page (M-02).
- **Leads to:** full viewer, M-02, M-06 (pause), T-03 (Tell Scout), S-09 (Get help).
- **Shows:**
  - Inline: "Naledi stopped"; what it affects ("Next week's posts are late"); status; "Urgent".
  - Viewer: what happened in plain words; what it affects; what Scout already tried ("I restarted her once."); how long it has been going on.
- **Actions:**
  - Restart (owner, partner) -> Restarting, then Fixed or Still failing.
  - Pause (owner, partner) -> the employee is paused until someone resumes them (M-06).
  - Tell Scout (owner, partner) -> T-03 with the card quoted.
  - Get help (owner, partner; after a second failure) -> S-09 with what happened, sent only if the person agrees.
- **States:**
  - Open, Restarting, Fixed ("Naledi is back"; the card closes itself), Still failing, Paused.
  - **Team computer off** (seen from another computer): "Restarts when Lerato's MacBook is back on."
- **Words:**
  - "Naledi stopped while making next week's posts. I restarted her once; she stopped again."
  - "Restarting Naledi..."
  - "Naledi is back. Next week's posts will be ready by 14:00."
  - "Still failing. Get help from the Colony team?"
- **Data:** health and restart, E-29, PARTIAL; status, E-13, PARTIAL; restarting from another computer, E-12, MISSING.
- **Not here:** logs, technical detail, error codes.

### C-19 Brief and Friday wrap

- **Who:** from Scout. The brief comes on weekdays at 08:30; the Friday wrap on Fridays at 16:00 (default). Owner and partners read the same one.
- **Purpose:** Know in a few sentences what moved, what is stuck and what needs you.
- **Get here:** T-01 (always the latest); D-01 (past briefs); the brief notification (G-03).
- **Leads to:** the links inside it, T-04 (Reply), D-01.
- **Shows:**
  - Brief: 1 to 5 sentences on what moved, what is stuck and what needs you, with links; the time Scout wrote it.
  - Friday wrap: what got done this week, what is next week, and credits spent this week; the viewer adds the spend per employee.
- **Actions:**
  - Open a link (owner, partner).
  - Reply (owner, partner) -> a new conversation that quotes the brief.
  - Past briefs (owner, partner) -> D-01.
- **States:**
  - New and Read (for each person).
  - **Late:** when the team computer was asleep at 08:30, the brief is written when it wakes: "Written at 07:12, after your computer woke up."
- **Words:**
  - "Morning. Naledi's posts for next week are ready, Sipho found 12 boutiques, and Thabo is waiting on his order."
  - "This week: brand kit approved, 5 posts out, 3 boutiques contacted. Next week: carousel and the pop-up flyer. Credits: $9.10 of $19."
- **Data:** brief and wrap records, E-07, MISSING; the schedules are routines (duties), WORKS.
- **Not here:** long reports, charts.

### C-20 Done note

- **Who:** from any employee or Scout. No one needs to act.
- **Purpose:** A one-line result with a link, so people see progress without being asked anything.
- **Get here:** T-03, M-05, the desks; never in Needs you.
- **Leads to:** the thing it links to.
- **Shows:** from whom; one line; a link.
- **Actions:** Open (owner, partner). Undo appears only when the linked thing allows it (for example a website change, through C-10).
- **States:** shown. Several in a row collapse into "4 updates", which can be opened (default).
- **Words:**
  - "The spring banner is live. See it live"
  - "Sipho moved Juniper and Jade to Talking."
  - "Grace added the new returns policy to her knowledge."
- **Data:** a message (kind 9) with links, WORKS.
- **Not here:** anything that needs a decision.

## Defaults in this file

Chosen while writing. They stand unless the owner changes them. Items marked "Decided by the owner" were answered on 11 October.

1. **Partners hiring.** Your rule "like you, minus billing" means partners can hire. Today the server lets only the owner give the final OK on a hire. Recommendation: let partners hire, and change the server.
2. **Undo after deciding.** A 10-second Undo after Approve or Decline (G-06), then the decision is final.
3. **Times for routines.** Recommendation: Friday wrap at 16:00 and Thursday numbers at 10:00, in the company's time zone.
4. **Showing what AI-made images cost.** Recommendation: yes, show the credits a set used on the card.
5. **Posts nobody posted.** Recommendation: 24 hours after its time, mark the post "Not posted yet" and ask "Post now or skip?"
