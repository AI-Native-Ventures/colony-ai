import { invokeTauri } from "./tauri";

export type ChatGptAccountState =
  | "active"
  | "plan_use_off"
  | "needs_sign_in"
  | "pending_revoke"
  | "disconnected";

export type ChatGptAccount = {
  id: string;
  label: string;
  email: string | null;
  plan: "ChatGPT plan";
  state: ChatGptAccountState;
  lastError: string | null;
  remoteRevocationPending: boolean;
};

export type ChatGptPlanState = {
  enabled: boolean;
  connecting: boolean;
  activeAccountId: string | null;
  accounts: ChatGptAccount[];
  pendingRegistrations?: {
    id: string;
    state: "needs_sign_in";
    remoteRevocationPending: boolean;
  }[];
  serviceError?: string | null;
};

export type ChatGptSignInOutcome = ChatGptPlanState & {
  outcome: "connected" | "cancelled";
};

/** Main-process metadata only. Tokens never enter this IPC contract. */
export const getChatGptPlan = () =>
  invokeTauri<ChatGptPlanState>("get_chatgpt_plan");
/** Start system-browser authorization with fresh state, nonce and PKCE. */
export const connectChatGptPlan = (
  options: {
    accountId?: string;
    registrationId?: string;
    consent?: boolean;
  } = {},
) => invokeTauri<ChatGptSignInOutcome>("connect_chatgpt_plan", options);
/** Retire the current attempt and close its loopback listener. */
export const cancelChatGptPlan = () =>
  invokeTauri<boolean>("cancel_chatgpt_plan");
/** Select a verified registration without merging accounts by email. */
export const selectChatGptAccount = (accountId: string) =>
  invokeTauri<ChatGptPlanState>("select_chatgpt_account", { accountId });
/** Clear usable local tokens and durably retry unconfirmed remote revocation. */
export const disconnectChatGptPlan = (accountId: string) =>
  invokeTauri<ChatGptPlanState>("disconnect_chatgpt_plan", { accountId });
/** Recheck due renewal and revocation work without sending tokens from React. */
export const refreshChatGptPlan = () =>
  invokeTauri<ChatGptPlanState>("refresh_chatgpt_plan");
