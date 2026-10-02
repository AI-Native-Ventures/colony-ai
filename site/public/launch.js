(() => {
  'use strict';

  const motionButton = document.querySelector('.r-motion-toggle');
  if (!motionButton) return;

  const syncAccessibleName = () => {
    motionButton.setAttribute('aria-label', motionButton.textContent.trim());
  };
  new MutationObserver(syncAccessibleName).observe(motionButton, {
    childList: true,
    characterData: true,
    subtree: true,
  });
  syncAccessibleName();
})();
