(() => {
  'use strict';

  // ---------- Motion: one switch for the helix, the team conversation and the demos ----------
  const motionButton = document.querySelector('.r-motion-toggle');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let motionPaused = reducedMotion.matches;

  function applyMotion() {
    document.body.classList.toggle('r10-paused', motionPaused);
    if (motionButton) {
      motionButton.textContent = motionPaused ? 'Resume motion' : 'Pause motion';
      motionButton.setAttribute('aria-pressed', String(motionPaused));
    }
    document.dispatchEvent(new CustomEvent('colony-motion', { detail: { paused: motionPaused } }));
  }
  motionButton?.addEventListener('click', () => {
    motionPaused = !motionPaused;
    applyMotion();
  });
  reducedMotion.addEventListener('change', () => {
    motionPaused = reducedMotion.matches;
    applyMotion();
  });
  applyMotion();

  // ---------- Downloads ----------
  // Release updates edit the download cards in #download; the hero and closing buttons copy those links.
  const downloadSection = document.getElementById('download');
  if (downloadSection) {
    for (const ext of ['.dmg', '.exe']) {
      const source = downloadSection.querySelector(`a[href$="${ext}"]`);
      if (!source) continue;
      for (const link of document.querySelectorAll(`a[href$="${ext}"]`)) {
        if (link !== source) link.href = source.href;
      }
    }
  }

  // ---------- Video cards ----------
  // Cards ship with native controls so they work without JavaScript.
  // With JavaScript, a poster play button starts each one; only one plays at a time.
  const players = [...document.querySelectorAll('video')].filter((video) => video.querySelector('source') && !video.classList.contains('helix-video'));

  for (const button of document.querySelectorAll('.video-play')) {
    const video = button.closest('.video-frame')?.querySelector('video');
    if (!video) continue;
    video.controls = false;
    button.hidden = false;
    button.addEventListener('click', () => {
      button.hidden = true;
      video.controls = true;
      video.play().catch(() => {});
    });
  }

  for (const video of players) {
    video.addEventListener('play', () => {
      for (const other of players) if (other !== video && !other.paused) other.pause();
    });
  }

  // The launch film opens from the helix in a player dialog (hero.js calls showModal).
  const filmDialog = document.getElementById('film-dialog');
  const filmVideo = filmDialog?.querySelector('video');
  if (filmDialog && filmVideo) {
    for (const trigger of document.querySelectorAll('[data-dialog="film-dialog"]')) {
      trigger.addEventListener('click', () => {
        filmVideo.play().catch(() => {});
      });
    }
    filmDialog.addEventListener('close', () => filmVideo.pause());
  }

  // ---------- Colony 3.0 demos ----------
  // The frame loads /demos/desktop.html or /demos/phone.html and plays one story at a time.
  // It talks back with demo-ready and demo-status; see /demos/demo.js.
  const demos = document.querySelector('[data-demos]');
  if (!demos) return;
  const frame = demos.querySelector('iframe');
  const display = demos.querySelector('[data-demo-display]');
  const playButton = demos.querySelector('[data-demo-play]');
  const replayButton = demos.querySelector('[data-demo-replay]');
  const panel = demos.querySelector('[role="tabpanel"]');
  const tabs = [...demos.querySelectorAll('[role="tab"]')];
  const phone = matchMedia('(max-width: 700px)');
  let key = 'customers';
  let state = 'idle';
  let ready = false;
  let loaded = false;
  let visible = false;

  const send = (type, extra = {}) => frame.contentWindow?.postMessage({ type, ...extra }, location.origin);
  const allowed = () => !document.hidden && !motionPaused;

  function size() {
    const width = phone.matches ? 390 : 1280;
    frame.style.width = `${width}px`;
    frame.style.height = '800px';
    frame.style.transform = `scale(${display.clientWidth / width})`;
  }
  function paint() {
    const label = { playing: 'Pause demo', paused: 'Resume demo', ended: 'Replay demo' }[state] || 'Play demo';
    const icon = state === 'playing' ? 'Ⅱ' : state === 'ended' ? '↻' : '▶';
    playButton.innerHTML = `${label} <span aria-hidden="true">${icon}</span>`;
    playButton.setAttribute('aria-pressed', String(state === 'playing'));
    playButton.disabled = !ready;
    replayButton.disabled = !ready;
  }
  function autoplay() {
    if (ready && visible && allowed() && (state === 'idle' || state === 'paused')) send('demo-play');
  }
  function load() {
    loaded = true;
    ready = false;
    state = 'idle';
    paint();
    size();
    frame.src = `/demos/${phone.matches ? 'phone' : 'desktop'}.html?demo=${key}`;
  }
  function choose(next, focus = false) {
    key = next;
    for (const tab of tabs) {
      const selected = tab.dataset.tour === key;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focus) tab.focus();
    }
    panel.setAttribute('aria-labelledby', `tour-${key}`);
    if (!ready) return;
    state = 'idle';
    send('demo-select', { key });
    paint();
    if (visible && allowed()) send('demo-play');
  }

  window.addEventListener('message', (event) => {
    if (event.source !== frame.contentWindow || event.origin !== location.origin) return;
    const data = event.data || {};
    if (data.type === 'demo-ready') {
      ready = true;
      if (data.key !== key) send('demo-select', { key });
      paint();
      autoplay();
    } else if (data.type === 'demo-status' && data.key === key) {
      state = data.state;
      paint();
    }
  });

  playButton.addEventListener('click', () => {
    if (state === 'playing') send('demo-pause');
    else if (state === 'ended') send('demo-replay');
    else send('demo-play');
  });
  replayButton.addEventListener('click', () => send('demo-replay'));
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => choose(tab.dataset.tour));
    tab.addEventListener('keydown', (event) => {
      const last = tabs.length - 1;
      const target = { ArrowRight: index === last ? 0 : index + 1, ArrowLeft: index === 0 ? last : index - 1, Home: 0, End: last }[event.key];
      if (target === undefined) return;
      event.preventDefault();
      choose(tabs[target].dataset.tour, true);
    });
  });

  // Load the frame shortly before it scrolls into view; play while at least a third is showing.
  new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting && !loaded) load();
  }, { rootMargin: '600px 0px' }).observe(display);
  new IntersectionObserver(([entry]) => {
    if (!entry.isIntersecting) {
      visible = false;
      if (state === 'playing') send('demo-pause');
    } else if (entry.intersectionRatio >= 0.35 && !visible) {
      visible = true;
      autoplay();
    }
  }, { threshold: [0, 0.35] }).observe(display);

  document.addEventListener('colony-motion', () => {
    if (!allowed()) {
      if (state === 'playing') send('demo-pause');
    } else autoplay();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (state === 'playing') send('demo-pause');
    } else autoplay();
  });
  new ResizeObserver(size).observe(display);
  phone.addEventListener('change', () => {
    if (loaded) load();
  });
  paint();
})();
