import electronUpdater from "electron-updater";
import {
  createElectronUpdaterService,
  UPDATE_METADATA_URL,
} from "./updater-service.mjs";

export const { autoUpdater } = electronUpdater;
export { createElectronUpdaterService, UPDATE_METADATA_URL };
