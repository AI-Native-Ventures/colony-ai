(() => {
  const video = document.querySelector('.helix-video');
  const toggle = document.querySelector('.r-motion-toggle');
  const retry = document.querySelector('.helix-play');
  const region = document.querySelector('.world');
  if (!video || !toggle || !retry || !region) return;
  let visible = true;
  let generation = 0;
  let manuallyRequested = false;
  video.muted = true;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const wantsPlayback = () => visible && !document.hidden && (toggle.getAttribute('aria-pressed') !== 'true' || manuallyRequested) && (!reducedMotion.matches || manuallyRequested);
  function sync() {
    const current = ++generation;
    if (!wantsPlayback()) {
      video.pause();
      retry.hidden = !reducedMotion.matches || !visible || document.hidden;
      return;
    }
    video.play().then(() => {
      if (current !== generation) { if (!wantsPlayback()) video.pause(); return; }
      retry.hidden = true;
    }).catch(() => {
      if (current === generation && wantsPlayback()) retry.hidden = false;
    });
  }
  video.addEventListener('playing', () => { video.classList.add('is-playing'); });
  video.addEventListener('error', () => { video.classList.remove('is-playing'); retry.hidden = false; });
  retry.addEventListener('click', () => { manuallyRequested = true; sync(); });
  toggle.addEventListener('click', sync);
  document.addEventListener('colony-motion', event => {
    if (event.detail?.paused) manuallyRequested = false;
    else if (reducedMotion.matches) manuallyRequested = true;
    sync();
  });
  document.addEventListener('visibilitychange', sync);
  reducedMotion.addEventListener('change', () => { manuallyRequested = false; sync(); });
  new IntersectionObserver(entries => { visible = entries[0].isIntersecting; sync(); }, {threshold:0}).observe(region);
  sync();
})();
