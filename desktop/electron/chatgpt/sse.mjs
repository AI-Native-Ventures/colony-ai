import { ChatGptError } from "./policy.mjs";

/** Bounded SSE decoder. Only a terminal Responses event can finish a request. */
export function createPlanSse({ maxFrameBytes = 1024 * 1024 } = {}) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let pending = "";
  let terminal = null;
  function feed(bytes) {
    pending += decoder.decode(bytes, { stream: true });
    const frames = [];
    for (;;) {
      const separator = /\r?\n\r?\n/.exec(pending);
      if (!separator) break;
      const frame = pending.slice(0, separator.index);
      pending = pending.slice(separator.index + separator[0].length);
      if (Buffer.byteLength(frame) > maxFrameBytes)
        throw new ChatGptError("stream_frame_too_large");
      const data = frame
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data || data === "[DONE]") continue;
      let event;
      try {
        event = JSON.parse(data);
      } catch {
        throw new ChatGptError("invalid_stream");
      }
      if (
        !event ||
        typeof event.type !== "string" ||
        !/^[a-zA-Z0-9_.]{1,100}$/.test(event.type)
      )
        throw new ChatGptError("invalid_stream");
      if (terminal) throw new ChatGptError("event_after_terminal");
      if (
        [
          "response.completed",
          "response.failed",
          "response.incomplete",
          "error",
        ].includes(event.type)
      )
        terminal = event.type;
      frames.push(event);
    }
    if (Buffer.byteLength(pending) > maxFrameBytes)
      throw new ChatGptError("stream_frame_too_large");
    return frames;
  }
  return {
    feed,
    finish() {
      pending += decoder.decode();
      if (pending.trim() || !terminal)
        throw new ChatGptError("stream_interrupted");
      return terminal;
    },
  };
}
