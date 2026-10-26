import { autoUpdater } from "electron-updater";
import { createMacSelfUpdater } from "./mac-self-update.mjs";
import {
  createElectronUpdaterService,
  resolveUpdateMetadataUrl,
  UPDATE_METADATA_URL,
} from "./updater-service.mjs";

export { autoUpdater };
export {
  createElectronUpdaterService,
  createMacSelfUpdater,
  resolveUpdateMetadataUrl,
  UPDATE_METADATA_URL,
};
