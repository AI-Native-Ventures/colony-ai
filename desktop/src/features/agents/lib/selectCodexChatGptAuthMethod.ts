import type { AcpAuthMethod } from "@/shared/api/types";

/** Prefer Codex's ChatGPT OAuth method, with its device-code variant as fallback. */
export function selectCodexChatGptAuthMethod(
  methods: readonly AcpAuthMethod[],
): AcpAuthMethod | undefined {
  return (
    methods.find((method) => method.id === "chat-gpt") ??
    methods.find((method) => method.id === "chat-gpt-device-code")
  );
}
