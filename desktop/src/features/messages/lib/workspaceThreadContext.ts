/** Keep the reference's simple title/prose layout without flattening rich Markdown. */
export function parseWorkspaceThreadContext(content: string) {
  const lines = content.trim().split(/\r?\n/);
  const title = lines[0]?.match(/^#{1,3}\s+(.+)$/)?.[1];
  if (!title) return null;
  const description = lines.slice(1).join("\n").trim();
  // Rich messages belong to MessageThreadRow, which retains lists, code and file links.
  if (
    /[`*_~[\]<>]|^\s*(?:#{1,6}\s|[-+]\s|\d+[.)]\s)/m.test(
      `${title}\n${description}`,
    )
  )
    return null;
  return { title, description: description.replace(/\s+/g, " ") };
}
