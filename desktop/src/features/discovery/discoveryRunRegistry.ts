/**
 * Owns the liveness fence for every campaign that a Discovery controller is
 * running. A campaign may have one live run, while one controller may own many
 * campaigns at once.
 */

export type ActiveDiscoveryRun = {
  campaignId: string;
  generation: number;
  abort: AbortController;
  done: Promise<void>;
};

export class DiscoveryRunRegistry {
  private generation = 0;
  private readonly live = new Map<string, ActiveDiscoveryRun>();
  private readonly inflight = new Set<Promise<void>>();

  begin(campaignId: string): ActiveDiscoveryRun {
    this.stop(campaignId);
    const run: ActiveDiscoveryRun = {
      campaignId,
      generation: ++this.generation,
      abort: new AbortController(),
      done: Promise.resolve(),
    };
    this.live.set(campaignId, run);
    return run;
  }

  track(run: ActiveDiscoveryRun, done: Promise<void>): void {
    run.done = done;
    this.inflight.add(done);
    const forget = () => this.inflight.delete(done);
    done.then(forget, forget);
  }

  isLive(run: ActiveDiscoveryRun): boolean {
    return this.live.get(run.campaignId) === run;
  }

  isLiveFor(campaignId: string): boolean {
    return this.live.has(campaignId);
  }

  /** Stops this exact run only when it is still the campaign's live run. */
  retire(run: ActiveDiscoveryRun): boolean {
    if (!this.isLive(run)) return false;
    this.live.delete(run.campaignId);
    run.abort.abort();
    return true;
  }

  stop(campaignId: string): ActiveDiscoveryRun | null {
    const run = this.live.get(campaignId) ?? null;
    if (!run) return null;
    this.live.delete(campaignId);
    run.abort.abort();
    return run;
  }

  stopAll(): ActiveDiscoveryRun[] {
    const stopped = [...this.live.values()];
    this.live.clear();
    for (const run of stopped) run.abort.abort();
    return stopped;
  }

  async whenIdle(): Promise<void> {
    while (this.inflight.size > 0) {
      await Promise.allSettled([...this.inflight]);
    }
  }
}
