import { formatTtlDuration } from "@/features/channels/lib/ephemeralChannel";

export type ChannelLifecycle = "ongoing" | "temporary";

export function channelLifecycle(input: {
  temporary: boolean;
}): ChannelLifecycle {
  return input.temporary ? "temporary" : "ongoing";
}

export function channelLifecycleLabel(
  lifecycle: ChannelLifecycle,
  ttlSeconds: number | null,
): string {
  if (lifecycle === "temporary" && ttlSeconds != null) {
    return `Temporary · ${formatTtlDuration(ttlSeconds)}`;
  }
  if (lifecycle === "temporary") return "Temporary";
  return "Ongoing";
}
