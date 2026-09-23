export function revealElectronWindow(window, { backgroundMode = false } = {}) {
  if (!window || window.isDestroyed?.()) return false;

  if (backgroundMode) {
    window.showInactive();
    return true;
  }

  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  return true;
}
