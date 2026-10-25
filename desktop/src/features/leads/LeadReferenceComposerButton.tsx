import type { Editor } from "@tiptap/react";
import { UserRound } from "lucide-react";
import * as React from "react";

import { COMPOSER_MESSAGE_LINK_NODE_NAME } from "@/features/messages/lib/composerMessageLinkNode";
import { buildLeadLink } from "@/shared/lib/entityLink";

import { LeadReferencePicker } from "./LeadReferencePicker";
import { leadReferenceContent, type LeadSummary } from "./leadReferenceModel";

import "./colony3-lead-reference.css";

/**
 * Puts a lead reference chip at the caret. The chip carries only the
 * `buzz://lead/<id>` link, so the sent message is plain text that agents read
 * and that every client renders as a lead card.
 */
function insertLeadReference(editor: Editor | null, lead: LeadSummary) {
  if (!editor || editor.isDestroyed) return false;
  if (!editor.schema.nodes[COMPOSER_MESSAGE_LINK_NODE_NAME]) return false;
  const caret = editor.state.selection.from;
  const textBeforeCaret = editor.state.doc.textBetween(
    Math.max(0, caret - 1),
    caret,
    "\n",
    "￼",
  );
  return editor
    .chain()
    .focus()
    .insertContent(
      leadReferenceContent({
        textBeforeCaret,
        chipNodeName: COMPOSER_MESSAGE_LINK_NODE_NAME,
        attrs: { channelName: lead.name, href: buildLeadLink(lead.leadId) },
      }),
    )
    .run();
}

export function LeadReferenceComposerButton({
  editor,
}: {
  editor: Editor | null;
}) {
  const [open, setOpen] = React.useState(false);

  const handleSelect = React.useCallback(
    (lead: LeadSummary) => {
      insertLeadReference(editor, lead);
      setOpen(false);
    },
    [editor],
  );

  // The dialog would hand focus back to this button; the composer is where
  // the writer wants to keep typing.
  const handleCloseAutoFocus = React.useCallback(
    (event: Event) => {
      event.preventDefault();
      if (editor && !editor.isDestroyed) editor.commands.focus();
    },
    [editor],
  );

  return (
    <>
      <button
        className="c3r-composer-button"
        data-testid="reference-lead-button"
        onClick={() => setOpen(true)}
        type="button"
      >
        <UserRound aria-hidden="true" size={12} strokeWidth={2.4} />
        Reference lead
      </button>
      <LeadReferencePicker
        onCloseAutoFocus={handleCloseAutoFocus}
        onOpenChange={setOpen}
        onSelect={handleSelect}
        open={open}
      />
    </>
  );
}
