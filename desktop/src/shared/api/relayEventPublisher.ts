import type { RelayEvent } from "@/shared/api/types";
import type { PendingEvent } from "@/shared/api/relayClientShared";
import {
  isRateLimited,
  rateLimitRemainingMs,
  waitForRateLimit,
  waitForRateLimitWithin,
} from "@/shared/api/relayRateLimitGate";
import { PUBLISH_TIMEOUT_MS } from "@/shared/api/relayClientTimings";

const MAX_RATE_LIMIT_RETRIES = 3;
const MAX_RATE_LIMIT_WAIT_MS = 30_000;
const MAX_RETRY_JITTER_MS = 500;

type PublishSession = {
  generation: () => number;
  ownership: () => number;
  pendingEvents: Map<string, PendingEvent>;
  send: (payload: unknown[], generation: number) => Promise<void>;
  reconnect: () => Promise<number>;
  normalizeError: (error: unknown, fallback: string) => Error;
  recoverSocketFailure: (error: unknown, fallback: string) => Error;
};

/** Publish the same signed event again after a bounded relay back-pressure wait. */
export async function publishSessionEvent(
  session: PublishSession,
  event: RelayEvent,
  timeoutMessage: string,
  sendErrorMessage: string,
): Promise<RelayEvent> {
  const publishOwnership = session.ownership();
  await waitForRateLimit();
  assertPublishOwnership(session, publishOwnership);

  let retryDeadline: number | null = null;
  let lastRateLimitError = new Error(
    "rate-limited: relay retry window expired",
  );
  let retries = 0;

  while (true) {
    if (retries > 0) {
      if (retryDeadline === null) {
        throw new Error("Relay publish retry deadline was not initialized.");
      }
      if (
        !(await waitForRelayRateLimit(session, publishOwnership, retryDeadline))
      ) {
        throw lastRateLimitError;
      }

      const jitterMs = Math.floor(Math.random() * (MAX_RETRY_JITTER_MS + 1));
      const remainingMs = retryDeadline - Date.now();
      if (remainingMs <= 0) throw lastRateLimitError;
      if (jitterMs > 0) {
        await delay(Math.min(jitterMs, remainingMs));
        assertPublishOwnership(session, publishOwnership);
        if (Date.now() >= retryDeadline) throw lastRateLimitError;
        if (
          !(await waitForRelayRateLimit(
            session,
            publishOwnership,
            retryDeadline,
          ))
        ) {
          throw lastRateLimitError;
        }
      }
    }

    try {
      return await publishOnce(
        session,
        event,
        publishOwnership,
        timeoutMessage,
        sendErrorMessage,
      );
    } catch (error) {
      const publishError = session.normalizeError(error, sendErrorMessage);
      if (!publishError.message.startsWith("rate-limited:")) {
        throw publishError;
      }

      lastRateLimitError = publishError;
      if (retryDeadline === null) {
        retryDeadline = Date.now() + MAX_RATE_LIMIT_WAIT_MS;
      }
      if (retries >= MAX_RATE_LIMIT_RETRIES) {
        throw publishError;
      }
      retries++;
    }
  }
}

async function waitForRelayRateLimit(
  session: PublishSession,
  publishOwnership: number,
  retryDeadline: number,
): Promise<boolean> {
  while (isRateLimited()) {
    assertPublishOwnership(session, publishOwnership);
    const remainingBudgetMs = retryDeadline - Date.now();
    if (remainingBudgetMs <= 0) return false;

    const cleared = await waitForRateLimitWithin(
      Math.min(rateLimitRemainingMs(), remainingBudgetMs),
    );
    assertPublishOwnership(session, publishOwnership);
    if (!cleared) return false;
  }
  return true;
}

function assertPublishOwnership(
  session: PublishSession,
  publishOwnership: number,
) {
  if (publishOwnership !== session.ownership()) {
    throw new Error("Relay disconnected for community switch.");
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** One OK-addressed attempt, with one reconnect retry for socket send errors. */
function publishOnce(
  session: PublishSession,
  event: RelayEvent,
  publishOwnership: number,
  timeoutMessage: string,
  sendErrorMessage: string,
): Promise<RelayEvent> {
  const publishGeneration = session.generation();

  return new Promise<RelayEvent>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      if (session.pendingEvents.get(event.id) === pendingEvent) {
        session.pendingEvents.delete(event.id);
      }
      reject(new Error(timeoutMessage));
    }, PUBLISH_TIMEOUT_MS);
    const pendingEvent = { event, resolve, reject, timeout };
    session.pendingEvents.set(event.id, pendingEvent);

    void session
      .send(["EVENT", event], publishGeneration)
      .catch(async (error) => {
        // A disconnect may already have rejected this operation while the send
        // was in flight. Its late failure must not reset the replacement session.
        if (
          publishOwnership !== session.ownership() ||
          publishGeneration !== session.generation() ||
          session.pendingEvents.get(event.id) !== pendingEvent
        ) {
          return;
        }

        // Remove this entry before resetting the socket so its original promise
        // remains available for the one transport retry.
        session.pendingEvents.delete(event.id);
        const sendError = session.recoverSocketFailure(error, sendErrorMessage);
        session.pendingEvents.set(event.id, pendingEvent);
        let retryGeneration: number | null = null;

        try {
          retryGeneration = await session.reconnect();
          if (
            publishOwnership !== session.ownership() ||
            session.generation() !== retryGeneration ||
            session.pendingEvents.get(event.id) !== pendingEvent
          ) {
            throw new Error(
              "Relay publish was superseded by a session change.",
            );
          }
          await session.send(["EVENT", event], retryGeneration);
        } catch (retryError) {
          if (session.pendingEvents.get(event.id) !== pendingEvent) return;

          window.clearTimeout(timeout);
          session.pendingEvents.delete(event.id);
          reject(
            publishOwnership === session.ownership() &&
              retryGeneration !== null &&
              session.generation() === retryGeneration
              ? session.recoverSocketFailure(retryError, sendError.message)
              : session.normalizeError(retryError, sendError.message),
          );
        }
      });
  });
}
