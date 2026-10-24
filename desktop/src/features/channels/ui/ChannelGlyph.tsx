import { useIsProjectHomeChannel } from "@/features/projects/lib/projectHomeChannel";
import { ProjectChannelIcon } from "@/features/projects/ui/ProjectChannelIcon";
import type { Channel } from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";
import {
  ForumIcon,
  HashIcon,
  PrivateChannelIcon,
} from "@/shared/ui/colonyIcons";

/** Stream/forum glyph for a channel, using the project mark on project homes. */
export function ChannelGlyph({
  channel,
  className,
}: {
  channel: Pick<Channel, "channelType" | "id" | "visibility">;
  className?: string;
}) {
  const projectHome = useIsProjectHomeChannel(channel.id);
  const iconClass = cn("size-4 shrink-0", className);

  if (projectHome) {
    return <ProjectChannelIcon className={iconClass} />;
  }
  if (channel.visibility === "private") {
    return <PrivateChannelIcon className={iconClass} size={17} />;
  }
  if (channel.channelType === "forum") {
    return <ForumIcon className={iconClass} size={17} />;
  }
  return <HashIcon className={iconClass} size={17} />;
}
