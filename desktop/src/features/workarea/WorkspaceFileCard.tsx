import { FileTabIcon } from "./dock/workAreaIcons";

/**
 * A file an agent wrote, as a card in a message: its name and "Open in the
 * work area". The card stays highlighted while its file is the one open in the
 * work area. Opening is the caller's: `onOpen` asks the dock for the file.
 */
export function WorkspaceFileCard({
  fileName,
  path,
  active,
  onOpen,
}: {
  fileName: string;
  path: string;
  active: boolean;
  onOpen: () => void;
}) {
  return (
    <a
      aria-current={active ? "true" : undefined}
      className="colony-file-card"
      data-active={active ? "true" : "false"}
      data-testid="workspace-file-card"
      href={`#work-area-file=${encodeURIComponent(path)}`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpen();
      }}
    >
      <span aria-hidden="true" className="colony-file-card-icon">
        <FileTabIcon aria-hidden="true" />
      </span>
      <span className="colony-file-card-text">
        <span className="colony-file-card-name">{fileName}</span>
        <span className="colony-file-card-hint">Open in the work area</span>
      </span>
    </a>
  );
}
