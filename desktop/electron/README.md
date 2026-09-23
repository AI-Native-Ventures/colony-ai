# Electron shell

Electron owns the only visible window. The existing Tauri app runs as a hidden
headless child (`colony-native-host`, see `src-tauri/src/electron_host/`) and
serves every Tauri command to this shell over stdio. The renderer shim
(`src/shared/api/electronTauriShim.ts`) installs `window.__TAURI_INTERNALS__`
so the React app's `@tauri-apps/api` calls work unchanged.
