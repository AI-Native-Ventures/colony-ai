/* Colony 3.0 demos for colony.global.
   Each demo is a short scripted story played on a virtual clock, so pausing freezes it exactly.
   The landing page drives it with postMessage: demo-ping, demo-select, demo-play, demo-pause, demo-replay.
   It answers with demo-ready and demo-status. A viewer can also click the highlighted button themselves. */
(() => {
  'use strict';

  const KEYS = ['customers', 'money', 'team'];
  const CANCEL = Symbol('cancel');
  const layout = document.body.dataset.layout === 'phone' ? 'phone' : 'desktop';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const embedded = window.parent !== window;
  const pristine = document.querySelector('.screen').outerHTML;
  const requested = new URLSearchParams(location.search).get('demo');

  let key = KEYS.includes(requested) ? requested : 'customers';
  let state = 'idle';
  let gen = 0;
  let screen = document.querySelector('.screen');
  let cursor = screen.querySelector('[data-cursor]');

  /* ---------- Virtual clock ---------- */
  let now = 0;
  let last = performance.now();
  let timers = [];
  setInterval(() => {
    const t = performance.now();
    const dt = Math.min(t - last, 100);
    last = t;
    if (state !== 'playing') return;
    now += dt;
    for (const timer of timers.slice()) {
      if (now >= timer.at) {
        timers.splice(timers.indexOf(timer), 1);
        timer.done();
      }
    }
  }, 30);

  function sleep(ms) {
    const g = gen;
    return new Promise((resolve, reject) => {
      timers.push({ at: now + (reduced ? Math.min(ms, 400) : ms), done: () => (g === gen ? resolve() : reject(CANCEL)) });
    });
  }

  /* ---------- Helpers for the stories ---------- */
  const $ = (selector, root = screen) => root.querySelector(selector);
  const $$ = (selector, root = screen) => [...root.querySelectorAll(selector)];
  const clone = (id) => document.getElementById(id).content.firstElementChild.cloneNode(true);
  const rands = (n) => 'R ' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  function place(x, y) {
    cursor.style.setProperty('--x', `${Math.round(x)}px`);
    cursor.style.setProperty('--y', `${Math.round(y)}px`);
  }
  function pointAt(el, fx = 0.5, fy = 0.5) {
    cursor.style.opacity = '';
    const s = screen.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    place(r.left - s.left + r.width * fx, r.top - s.top + r.height * fy);
  }
  async function moveTo(el, fx, fy) {
    pointAt(el, fx, fy);
    await sleep(820);
  }
  async function park(x, y) {
    // On the phone a finger lifts away, so the touch mark fades out.
    if (layout === 'phone') cursor.style.opacity = '0';
    place(x, y);
    await sleep(500);
  }
  async function tap(el) {
    cursor.classList.remove('is-click');
    void cursor.offsetWidth;
    cursor.classList.add('is-click');
    el.classList.add('is-pressed');
    await sleep(170);
    el.classList.remove('is-pressed');
    await sleep(130);
  }
  async function click(el, fx, fy) {
    await moveTo(el, fx, fy);
    await tap(el);
  }
  // The highlighted button waits for the viewer; if they don't click, the pointer does.
  async function decide(el, ms = 2400) {
    await moveTo(el);
    const g = gen;
    el.classList.add('is-waiting');
    const byViewer = await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (viewer) => {
        if (settled) return;
        settled = true;
        el.removeEventListener('click', onClick);
        el.classList.remove('is-waiting');
        if (g !== gen) reject(CANCEL);
        else resolve(viewer);
      };
      const onClick = () => finish(true);
      el.addEventListener('click', onClick);
      sleep(ms).then(() => finish(false), () => finish(false));
    });
    if (!byViewer) await tap(el);
  }
  async function type(el, text, perSecond = 30) {
    if (reduced) {
      el.textContent += text;
      return;
    }
    el.classList.add('is-typing');
    for (const ch of text) {
      el.textContent += ch;
      await sleep(1000 / perSecond);
    }
    el.classList.remove('is-typing');
  }
  // Types into a text node, so chips already in the field stay put.
  async function typeText(node, text, perSecond = 30) {
    if (reduced) {
      node.data += text;
      return;
    }
    for (const ch of text) {
      node.data += ch;
      await sleep(1000 / perSecond);
    }
  }
  function toBottom(box) {
    box.scrollTo({ top: box.scrollHeight, behavior: reduced ? 'auto' : 'smooth' });
  }
  async function countTo(el, from, to, ms = 1000) {
    const steps = 20;
    el.classList.add('ticking');
    for (let i = 1; i <= steps; i += 1) {
      el.textContent = rands(Math.round((from + ((to - from) * i) / steps) / 100) * 100);
      await sleep(ms / steps);
    }
    el.textContent = rands(to);
    el.classList.remove('ticking');
  }
  function setChip(row, cls, text) {
    const chip = row.querySelector('.chip');
    chip.className = `chip ${cls}`;
    chip.textContent = text;
  }

  /* ---------- Stories ---------- */
  const STORIES = { desktop: {}, phone: {} };

  STORIES.desktop.customers = async () => {
    const scene = $('.scene[data-id="customers"]');
    const chat = $('[data-chat]', scene);
    const composer = $('[data-composer]', scene);
    const send = $('[data-send]', scene);
    await sleep(500);
    await moveTo(composer, 0.06, 0.5);
    // Lerato tags the agent the task is for: typing @ opens the mention picker, Scout becomes a chip.
    composer.classList.add('is-typing');
    const handle = document.createTextNode('');
    composer.append(handle);
    await typeText(handle, '@Sc', 9);
    const picker = $('[data-mention-pop]', scene);
    picker.classList.add('is-on');
    await sleep(900);
    picker.classList.remove('is-on');
    const chip = document.createElement('span');
    chip.className = 'mention';
    chip.textContent = '@Scout';
    const task = document.createTextNode(' ');
    handle.replaceWith(chip, task);
    await sleep(250);
    await typeText(task, 'Line up the Parkhurst gift shops for WhatsApp. Use the Sample posts template.', 34);
    composer.classList.remove('is-typing');
    await click(send);
    composer.textContent = '';
    chat.append(clone('t-ask'));
    toBottom(chat);
    await park(1180, 600);
    await sleep(500);
    const typing = clone('t-typing');
    chat.append(typing);
    toBottom(chat);
    await sleep(2100);
    typing.remove();
    const reply = clone('t-batch');
    chat.append(reply);
    await sleep(60);
    toBottom(chat);
    await sleep(1500);
    await moveTo($('.wa-bubble', reply), 0.7, 0.4);
    await sleep(900);
    await decide($('[data-approve]', reply));

    const sending = clone('t-sending');
    $('[data-batch]', reply).replaceWith(sending);
    await sleep(60);
    toBottom(chat);
    await park(1180, 640);
    const rows = $$('[data-row]', sending);
    const sent = $('[data-sent]', sending);
    const next = $('[data-next]', sending);
    const left = $('[data-left]', sending);
    const bar = $$('[data-bar] i', sending);
    const nextTimes = ['11:03', '11:11', '11:19', '11:27'];
    for (let i = 0; i < rows.length; i += 1) {
      await sleep(1000);
      setChip(rows[i], 'chip-soft', 'Sent');
      sent.textContent = String(i + 1);
      left.textContent = String(7 - i);
      next.textContent = nextTimes[i];
      bar[0].style.flexGrow = String(i + 1);
      bar[1].style.flexGrow = String(7 - i);
      if (rows[i + 1]) setChip(rows[i + 1], 'chip-accent', 'Up next');
      await sleep(550);
      setChip(rows[i], 'chip-soft', 'Delivered');
      if (rows[i - 1]) setChip(rows[i - 1], 'chip-info', 'Read');
    }
    await sleep(800);
    $('[data-outreach]').hidden = false;
    $('[data-toast]', scene).classList.add('is-on');
    await sleep(3600);
  };

  STORIES.desktop.money = async () => {
    const scene = $('.scene[data-id="money"]');
    const q = (selector) => $(selector, scene);
    await sleep(600);
    await moveTo(q('[data-outstanding]'), 0.4, 0.6);
    await sleep(500);
    await decide(q('[data-review]'));
    q('[data-scrim]').classList.add('is-on');
    q('[data-drawer]').classList.add('is-on');
    await sleep(900);
    await moveTo(q('.letter'), 0.62, 0.5);
    await sleep(1500);
    await decide(q('[data-approve-reminder]'));
    const review = q('[data-step-review]');
    const approved = q('[data-step-approved]');
    review.className = 'step done';
    review.querySelector('i').textContent = '✓';
    approved.className = 'step done now';
    approved.querySelector('i').textContent = '✓';
    q('[data-approve-reminder]').hidden = true;
    q('[data-edit-reminder]').hidden = true;
    const copy = q('[data-copy]');
    copy.hidden = false;
    await sleep(700);
    await click(copy);
    copy.textContent = '✓ Copied';
    await sleep(800);
    await click(q('[data-close-drawer]'));
    q('[data-drawer]').classList.remove('is-on');
    q('[data-scrim]').classList.remove('is-on');
    const ask = q('[data-ask]');
    ask.innerHTML = '<span class="ant a28 t-noor"><img src="../assets/agents/noor.svg" alt=""></span><span class="grow"><b>Reminder approved</b> · copied for you to send on WhatsApp</span><span class="chip chip-ok">Approved</span>';
    ask.classList.add('flash');
    await park(980, 700);
    await sleep(1500);
    q('[data-toast]').classList.add('is-on');
    await sleep(700);
    const payment = document.createElement('div');
    payment.className = 'pay appear flash';
    payment.innerHTML = '<span><b>Cedar Café</b><small>Invoice 0027 · 31 Oct 2026 · Recorded by Noor</small></span><strong>R 3 000</strong>';
    q('[data-pays]').prepend(payment);
    await Promise.all([countTo(q('[data-collected]'), 8000, 11000), countTo(q('[data-outstanding]'), 6200, 3200)]);
    await sleep(500);
    q('[data-attn]').innerHTML = '<div class="all-clear appear"><i>✓</i><span><b style="color: var(--ink);">Nothing overdue.</b> Cedar Café paid in full, so Noor closed the follow-up.</span></div>';
    await sleep(1400);
    q('[data-toast]').classList.remove('is-on');
    await sleep(2400);
  };

  STORIES.desktop.team = async () => {
    const scene = $('.scene[data-id="team"]');
    const q = (selector) => $(selector, scene);
    const show = (name) => $$('.hire-step', scene).forEach((step) => step.classList.toggle('is-on', step.dataset.step === name));
    await sleep(600);
    const pick = q('[data-pick-role]');
    await click(pick, 0.3, 0.5);
    pick.classList.add('is-picked');
    const next = q('[data-continue]');
    next.disabled = false;
    await decide(next, 1800);
    show('configure');
    q('[data-crumb]').textContent = 'Hospitality researcher';
    await sleep(900);
    const name = q('[data-name]');
    await click(name, 0.15, 0.5);
    name.classList.add('is-focus');
    await type(name, 'Birch', 8);
    name.classList.remove('is-focus');
    await sleep(300);
    await click(q('[data-change-pic]'));
    q('[data-swatches]').classList.add('is-on');
    await sleep(500);
    const teal = q('[data-teal]');
    await click(teal);
    q('.swatch.is-picked').classList.remove('is-picked');
    teal.classList.add('is-picked');
    const pic = q('[data-pic]');
    pic.className = 'ant a56 t-birch';
    pic.querySelector('img').src = '../assets/agents/birch.svg';
    q('[data-pic-note]').textContent = 'Teal, chosen by you. It keeps the operations gear.';
    await sleep(600);
    q('[data-swatches]').classList.remove('is-on');
    const sales = q('[data-sales]');
    await click(sales);
    sales.classList.add('is-on');
    await sleep(500);
    await decide(q('[data-to-review]'), 1800);
    show('review');
    q('[data-crumb]').textContent = 'Review';
    await sleep(1600);
    await decide(q('[data-hire]'));
    show('hired');
    q('[data-crumb]').textContent = 'Hired';
    $('[data-team-count]').textContent = '7';
    $('[data-birch]').hidden = false;
    await park(1180, 720);
    await sleep(3800);
  };

  STORIES.phone.customers = async () => {
    const scene = $('.ph-scene[data-id="customers"]');
    const body = $('[data-chat]', scene);
    await sleep(900);
    body.append(clone('t-ph-yes'));
    toBottom(body);
    await sleep(1300);
    body.append(clone('t-ph-cost'));
    toBottom(body);
    await sleep(900);
    const typing = clone('t-ph-typing');
    body.append(typing);
    toBottom(body);
    await sleep(1900);
    typing.remove();
    const draft = clone('t-ph-draft');
    body.append(draft);
    await sleep(60);
    toBottom(body);
    await sleep(1800);
    await decide($('[data-send-draft]', draft));
    draft.replaceWith(clone('t-ph-sent'));
    await sleep(60);
    toBottom(body);
    await park(330, 720);
    await sleep(3200);
  };

  STORIES.phone.money = async () => {
    const scene = $('.ph-scene[data-id="money"]');
    const q = (selector) => $(selector, scene);
    const body = q('.ph-body');
    await sleep(800);
    toBottom(body);
    await sleep(1100);
    await decide(q('[data-review]'));
    q('[data-scrim]').classList.add('is-on');
    q('[data-sheet]').classList.add('is-on');
    await sleep(1800);
    await decide(q('[data-approve-reminder]'));
    q('[data-sheet-actions]').hidden = true;
    q('[data-sheet-done]').hidden = false;
    const status = q('[data-sheet-state]');
    status.className = 'chip chip-ok';
    status.textContent = 'Approved · ready for you to send';
    await sleep(700);
    const copy = q('[data-copy]');
    await click(copy);
    copy.textContent = '✓ Copied';
    await sleep(800);
    q('[data-sheet]').classList.remove('is-on');
    q('[data-scrim]').classList.remove('is-on');
    q('[data-ask]').innerHTML = '<span class="ant a28 t-noor"><img src="../assets/agents/noor.svg" alt=""></span><span class="grow"><b>Reminder approved</b></span><span class="chip chip-ok">Copied</span>';
    await park(330, 720);
    await sleep(1300);
    q('[data-toast]').classList.add('is-on');
    body.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
    await sleep(800);
    await Promise.all([countTo(q('[data-collected]'), 8000, 11000), countTo(q('[data-outstanding]'), 6200, 3200)]);
    await sleep(500);
    q('[data-attn-count]').textContent = '0';
    q('[data-attn]').innerHTML = '<div class="all-clear appear"><i>✓</i><span><b style="color: var(--ink);">Nothing overdue.</b> Cedar Café paid in full.</span></div>';
    toBottom(body);
    await sleep(1400);
    q('[data-toast]').classList.remove('is-on');
    await sleep(2200);
  };

  STORIES.phone.team = async () => {
    const scene = $('.ph-scene[data-id="team"]');
    const q = (selector) => $(selector, scene);
    await sleep(900);
    q('[data-toast]').classList.add('is-on');
    await sleep(900);
    const row = clone('t-ph-birch');
    q('[data-team-list]').prepend(row);
    q('[data-team-sub]').textContent = '6 AI employees and 2 people';
    await sleep(1700);
    q('[data-toast]').classList.remove('is-on');
    await decide(row, 2200);
    q('[data-team-page]').hidden = true;
    q('[data-member]').hidden = false;
    await park(330, 720);
    await sleep(900);
    const doing = q('[data-doing]');
    const work = [
      ['Shortlist guesthouses in Parkhurst', 'Active'],
      ['Draft a market scan for #Sales', 'Active'],
      ['Check venue rates for December', 'Queued'],
    ];
    for (const [label, status] of work) {
      const item = document.createElement('div');
      item.className = 'doing-row appear';
      item.innerHTML = `<span>${label}</span><span class="chip ${status === 'Active' ? 'chip-accent' : 'chip-soft'}">${status}</span>`;
      doing.append(item);
      q('[data-doing-count]').textContent = `${doing.children.length} commitment${doing.children.length === 1 ? '' : 's'}`;
      await sleep(900);
    }
    await sleep(2600);
  };

  /* ---------- Playback ---------- */
  function post(type, extra = {}) {
    if (embedded) window.parent.postMessage({ type, ...extra }, location.origin);
  }
  function setState(next) {
    state = next;
    screen.classList.toggle('is-paused', next === 'paused');
    post('demo-status', { key, state: next });
  }
  function reset() {
    gen += 1;
    for (const timer of timers.splice(0)) timer.done();
    const fresh = document.createElement('template');
    fresh.innerHTML = pristine;
    screen.replaceWith(fresh.content.firstElementChild);
    screen = document.querySelector('.screen');
    cursor = screen.querySelector('[data-cursor]');
    screen.dataset.scene = key;
    // Keyboard focus stays on the page's own controls; the demo is for watching and clicking.
    for (const button of screen.querySelectorAll('button')) button.tabIndex = -1;
  }
  async function run() {
    const g = gen;
    setState('playing');
    try {
      await STORIES[layout][key]();
      if (g === gen) setState('ended');
    } catch (error) {
      if (error !== CANCEL) {
        post('demo-error', { message: String((error && error.message) || error) });
        throw error;
      }
    }
  }
  function select(next) {
    if (KEYS.includes(next)) key = next;
    reset();
    setState('idle');
  }
  function play() {
    if (state === 'playing') return;
    if (state === 'paused') {
      setState('playing');
      return;
    }
    if (state === 'ended') reset();
    run();
  }
  function pause() {
    if (state === 'playing') setState('paused');
  }
  function replay() {
    reset();
    run();
  }

  window.addEventListener('message', (event) => {
    if (!embedded || event.origin !== location.origin || event.source !== window.parent) return;
    const data = event.data || {};
    if (data.type === 'demo-ping') post('demo-ready', { key });
    else if (data.type === 'demo-select') select(data.key);
    else if (data.type === 'demo-play') play();
    else if (data.type === 'demo-pause') pause();
    else if (data.type === 'demo-replay') replay();
  });

  select(key);
  post('demo-ready', { key });
  if (!embedded) play();
})();
