import { autoUpdater } from "electron-updater";
import {
  createElectronUpdaterService,
  UPDATE_METADATA_URL,
} from "./updater-service.mjs";

export { autoUpdater };
export { createElectronUpdaterService, UPDATE_METADATA_URL };
