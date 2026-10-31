(() => {
  'use strict';

  // Video cards ship with native controls so they work without JavaScript.
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
})();
