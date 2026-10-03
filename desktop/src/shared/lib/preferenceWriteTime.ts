let lastWriteTime = 0;

/** Observe a persisted preference clock without retaining community data. */
export function preferenceWriteTime(value: unknown): number {
  const time =
    typeof value === "number" && Number.isSafeInteger(value) && value > 0
      ? value
      : 0;
  lastWriteTime = Math.max(lastWriteTime, time);
  return time;
}

/** Order local preference writes even within one millisecond or after clock rollback. */
export function nextPreferenceWriteTime(): number {
  lastWriteTime = Math.max(Date.now(), lastWriteTime + 1);
  return lastWriteTime;
}
