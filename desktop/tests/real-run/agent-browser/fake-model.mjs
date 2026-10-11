const MAX_TURNS = 40;
const MAX_FRAME = 64 * 1024;

/** Deterministic FAKE provider body builder, to be served only on 127.0.0.1. */
export function createFakeModelResponder(plan) {
  if (!Array.isArray(plan) || !plan.length || plan.length > MAX_TURNS)
    throw new Error("Supply a bounded FAKE model plan");
  let turn = 0;
  const priorBrowserTools = new Set();
  return (body) => {
    if (
      Buffer.byteLength(JSON.stringify(body)) > MAX_FRAME ||
      body?.model !== "colony-browser-fake" ||
      body?.stream === true ||
      !Array.isArray(body.messages) ||
      turn >= plan.length
    )
      throw new Error("FAKE provider refuses an unexpected request");
    for (const tool of body.tools ?? []) {
      const name = tool.function?.name;
      if (
        typeof name === "string" &&
        name.length <= 256 &&
        /browser_(connect|snapshot)$/u.test(name) &&
        priorBrowserTools.size < 64
      )
        priorBrowserTools.add(name);
    }
    const step = plan[turn++];
    // Callback selects a fresh tab/ref only from actual prior tool messages.
    // It must never issue a direct broker call or fabricate the agent transcript.
    const selection =
      typeof step === "function" ? step(body.messages, body.tools ?? []) : step;
    const message = selection?.tool
      ? {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: `fixture-call-${turn}`,
              type: "function",
              function: {
                name: selection.tool,
                arguments: JSON.stringify(selection.args ?? {}),
              },
            },
          ],
        }
      : { role: "assistant", content: "Fixture task finished." };
    if (
      selection?.tool &&
      !(body.tools ?? []).some(
        (tool) => tool.function?.name === selection.tool,
      ) &&
      !(
        selection.allowStaleTool === true &&
        priorBrowserTools.has(selection.tool)
      )
    )
      throw new Error(
        "The requested tool was not advertised by the actual agent session",
      );
    const response = {
      id: `fixture-completion-${turn}`,
      object: "chat.completion",
      model: "colony-browser-fake",
      choices: [
        {
          index: 0,
          finish_reason: selection?.tool ? "tool_calls" : "stop",
          message,
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
    if (Buffer.byteLength(JSON.stringify(response)) > MAX_FRAME)
      throw new Error("FAKE provider response exceeds the frame bound");
    return response;
  };
}
