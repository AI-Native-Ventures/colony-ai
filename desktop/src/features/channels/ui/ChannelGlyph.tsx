import type { Channel } from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";
import { HashIcon, PrivateChannelIcon } from "@/shared/ui/colonyIcons";

/** Stream glyph for a channel. */
export function ChannelGlyph({
  channel,
  className,
}: {
  channel: Pick<Channel, "channelType" | "id" | "visibility">;
  className?: string;
}) {
  const iconClass = cn("size-4 shrink-0", className);

  if (channel.visibility === "private") {
    return <PrivateChannelIcon className={iconClass} size={17} />;
  }
  return <HashIcon className={iconClass} size={17} />;
}
