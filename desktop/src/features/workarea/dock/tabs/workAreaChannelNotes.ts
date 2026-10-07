/**
 * The channel's standing notes, from what is already stored for every channel:
 * its topic and purpose (NIP-29 metadata, part of the channel list) and its
 * canvas (kind 40100). No new event, no new writer: these are the notes a team
 * already keeps in a channel, shown beside what its AI employees remember.
 */
export type ChannelNote =
  | { kind: "topic"; text: string }
  | { kind: "purpose"; text: string }
  | { kind: "canvas"; preview: string };

const PREVIEW_MAX = 140;

/** First non-empty line of a Markdown canvas, without its list or heading marks. */
export function canvasPreview(content: string): string {
  const line =
    content
      .split("\n")
      .map((candidate) =>
        candidate
          .trim()
          .replace(/^(?:#{1,6}\s+|[-*+]\s+|>\s*|\d+[.)]\s+)+/, "")
          .replaceAll("**", "")
          .trim(),
      )
      .find((candidate) => candidate.length > 0) ?? "";
  return line.length > PREVIEW_MAX
    ? `${line.slice(0, PREVIEW_MAX - 1)}…`
    : line;
}

export function channelNotes(input: {
  topic: string | null | undefined;
  purpose: string | null | undefined;
  /** `null` or empty when the channel has no canvas. */
  canvasContent: string | null | undefined;
}): ChannelNote[] {
  const notes: ChannelNote[] = [];
  const topic = input.topic?.trim();
  if (topic) notes.push({ kind: "topic", text: topic });
  const purpose = input.purpose?.trim();
  if (purpose) notes.push({ kind: "purpose", text: purpose });
  const preview = canvasPreview(input.canvasContent ?? "");
  if (preview) notes.push({ kind: "canvas", preview });
  return notes;
}
