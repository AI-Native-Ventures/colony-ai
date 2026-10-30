import type { Channel } from "@/shared/api/types";

export function findWhatsAppBatchCreatorChannel(
  channels: readonly Channel[],
  createdBy: string | null | undefined,
  currentPubkey: string | null | undefined,
): Channel | null {
  if (!createdBy) return null;

  const creator = createdBy.toLocaleLowerCase();
  const self = currentPubkey?.toLocaleLowerCase();
  return (
    channels.find(
      (channel) =>
        channel.channelType === "dm" &&
        channel.participantPubkeys.some(
          (pubkey) => pubkey.toLocaleLowerCase() === creator,
        ) &&
        (!self ||
          channel.participantPubkeys.some(
            (pubkey) => pubkey.toLocaleLowerCase() === self,
          )),
    ) ?? null
  );
}
