/** Maximum bytes in a browser protocol input frame. */
export const MAX_JSON_LINE_BYTES = 8 * 1024 * 1024;
/** Maximum bytes waiting for the peer to read protocol output. */
export const MAX_QUEUED_OUTPUT_BYTES = 16 * 1024 * 1024;

/** Decode bounded newline-delimited UTF8, retaining no partial text after stop. */
export function createJsonLines({
  maxBytes = MAX_JSON_LINE_BYTES,
  onLine,
  onError,
}) {
  let buffer = Buffer.alloc(0);
  let length = 0;
  let stopped = false;
  const stop = () => {
    stopped = true;
    buffer = Buffer.alloc(0);
    length = 0;
  };
  const fail = () => {
    stop();
    onError();
    return false;
  };
  const append = (part) => {
    const required = length + part.length;
    if (required > maxBytes) return false;
    if (buffer.length < required) {
      const next = Buffer.allocUnsafe(
        Math.min(maxBytes, Math.max(required, buffer.length * 2, 4096)),
      );
      buffer.copy(next, 0, 0, length);
      buffer = next;
    }
    part.copy(buffer, length);
    length = required;
    return true;
  };
  return {
    push(chunk) {
      if (stopped) return false;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      let offset = 0;
      while (offset < bytes.length) {
        const newline = bytes.indexOf(10, offset);
        const end = newline === -1 ? bytes.length : newline;
        const part = bytes.subarray(offset, end);
        if (!append(part)) return fail();
        if (newline === -1) return true;
        const line = buffer.subarray(0, length).toString("utf8");
        length = 0;
        if (onLine(line) === false || stopped) {
          stop();
          return false;
        }
        offset = newline + 1;
      }
      return true;
    },
    stop,
  };
}
