import { getAccountAuthClient } from "./accountAuthAdapter";
import { getProfile, updateProfile } from "@/shared/api/tauriProfiles";

const SIGNUP_NAME_KEY = "colony-signup-name.v1";

/** Preserve the submitted name across verification and restart, scoped by email. */
export function rememberSignupName(email: string, name: string) {
  localStorage.setItem(
    `${SIGNUP_NAME_KEY}:${email.trim().toLowerCase()}`,
    name.trim(),
  );
}

async function readWithDeadline<T>(
  request: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                "Account details could not be loaded. Check your connection and try again.",
              ),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Publish the account name through the same kind:0 path as Settings. */
export async function ensureOnboardingProfile(
  isCurrent = () => true,
  dependencies = {
    read: getProfile,
    account: () => getAccountAuthClient().getAccount(),
    write: updateProfile,
    storage: localStorage,
    timeoutMs: 10_000,
  },
) {
  const profile = await readWithDeadline(
    dependencies.read(),
    dependencies.timeoutMs ?? 10_000,
  );
  if (!isCurrent()) throw new Error("Community setup cancelled.");
  if (profile.hasProfileEvent) return profile;
  const account = await readWithDeadline(
    dependencies.account(),
    dependencies.timeoutMs ?? 10_000,
  );
  const email = account?.pubkey === profile.pubkey ? account.email : "";
  const key = `${SIGNUP_NAME_KEY}:${email.trim().toLowerCase()}`;
  const displayName =
    dependencies.storage.getItem(key)?.trim() ||
    email.split("@")[0] ||
    profile.displayName ||
    "You";
  if (!isCurrent()) throw new Error("Community setup cancelled.");
  const saved = await dependencies.write({ displayName });
  dependencies.storage.removeItem(key);
  return saved;
}
