export type UsagePeriodDays = 7 | 30;

/** Build adjacent local-midnight boundaries without assuming 24-hour days. */
export function usageBucketBoundaries(
  now: Date,
  periodDays: UsagePeriodDays,
): number[] {
  const end = new Date(now);
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() + 1);

  const first = new Date(end);
  first.setDate(first.getDate() - periodDays);

  const boundaries: number[] = [];
  for (let day = 0; day <= periodDays; day += 1) {
    const boundary = new Date(first);
    boundary.setDate(first.getDate() + day);
    boundaries.push(Math.floor(boundary.getTime() / 1000));
  }
  return boundaries;
}
