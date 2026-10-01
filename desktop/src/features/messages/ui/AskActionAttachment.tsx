import * as React from "react";

import type { UserProfileLookup } from "@/features/profile/lib/identity";
import { AskCard } from "@/features/company-asks/ui/AskCard";
import { askThreadStartFromAction } from "@/features/company-asks/askRecords";

export function AskActionAttachment({
  askId,
  channelId,
  currentPubkey,
  messageBody,
  profiles,
}: {
  askId: string;
  channelId: string | null;
  currentPubkey?: string;
  messageBody: string;
  profiles?: UserProfileLookup;
}) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = React.useState(false);
  const threadStart = askThreadStartFromAction(messageBody);

  React.useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === "undefined") {
      setNearViewport(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNearViewport(true);
          observer.disconnect();
        }
      },
      { rootMargin: "320px" },
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={rootRef}>
      {threadStart ? (
        <section
          aria-label="Discussion opening"
          className="colony-ask-create-context mb-3"
        >
          <strong>{threadStart.title}</strong>
          {threadStart.openingContext ? (
            <span>{threadStart.openingContext}</span>
          ) : null}
        </section>
      ) : null}
      <AskCard
        askId={askId}
        channelId={channelId}
        currentPubkey={currentPubkey}
        lazyQueryEnabled={nearViewport}
        profiles={profiles}
      />
    </div>
  );
}
