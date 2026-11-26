import {
  FREE_AI_BUSY_MESSAGE,
  MAC_OFF_ACTION,
  MOVE_TO_MAC_ACTION,
  OUT_OF_CREDIT_MESSAGE,
  TOP_UP_ACTION,
  TRY_AGAIN_ACTION,
  macOffMessage,
  startFailureMessage,
} from "./placementCopy";
import type { HomeNoticeKind } from "./homeNoticeModel";

export type HomeNoticeAction = {
  label: string;
  onClick: () => void;
  primary?: boolean;
};

/** The text and actions of one card, from the exact copy. */
export function homeNoticeContent(
  kind: HomeNoticeKind,
  name: string,
  handlers: {
    moveToCloud: () => void;
    moveToMac: () => void;
    retry: () => void;
    topUp: () => void;
  },
): { message: string; actions: HomeNoticeAction[] } {
  switch (kind) {
    case "macOff":
      return {
        message: macOffMessage(name),
        actions: [
          {
            label: MAC_OFF_ACTION,
            onClick: handlers.moveToCloud,
            primary: true,
          },
        ],
      };
    case "outOfCredit":
      return {
        message: OUT_OF_CREDIT_MESSAGE,
        actions: [
          { label: TOP_UP_ACTION, onClick: handlers.topUp, primary: true },
          { label: MOVE_TO_MAC_ACTION, onClick: handlers.moveToMac },
        ],
      };
    case "freeAiBusy":
      return {
        message: FREE_AI_BUSY_MESSAGE,
        actions: [
          { label: TOP_UP_ACTION, onClick: handlers.topUp, primary: true },
          { label: MOVE_TO_MAC_ACTION, onClick: handlers.moveToMac },
        ],
      };
    case "startFailure":
      return {
        message: startFailureMessage(name),
        actions: [
          { label: TRY_AGAIN_ACTION, onClick: handlers.retry, primary: true },
          { label: MOVE_TO_MAC_ACTION, onClick: handlers.moveToMac },
        ],
      };
  }
}
