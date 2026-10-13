import * as React from "react";
import { ArrowLeft, ArrowRight, X } from "lucide-react";

import { ColonyAntAvatar } from "@/shared/ui/ColonyAntAvatar";
import { StartupWindowDragRegion } from "@/shared/ui/StartupWindowDragRegion";
import {
  communityCreateErrorMessage,
  communityProvisioningFromConfig,
  validateCommunitySlug,
} from "@/features/communities/selfProvisioning";
import {
  checkCommunityAvailability,
  CommunityProvisioningRequestError,
  createSelfServeCommunity,
  fetchCommunityProvisioningConfig,
  getSelfProvisioningHttpBase,
  listMyCommunities,
  type SelfServeCommunity,
} from "@/features/communities/selfProvisioningApi";
import { rememberSignupName } from "../onboardingProfile";
import {
  saveOnboardingBusinessProfile,
  type OnboardingBusinessProfile,
} from "./BusinessSetupStep";
import { AntMark } from "./OnboardingScenePrimitives";

const DRAFT_KEY = "colony-guided-business-draft.v1";
const categories = [
  "Clothing and fashion",
  "Food and drinks",
  "Beauty and wellness",
  "Services",
  "Crafts and gifts",
  "Something else",
] as const;
const channels = [
  "Instagram",
  "Facebook",
  "TikTok",
  "My website",
  "WhatsApp",
  "Markets and pop-ups",
  "My own shop",
  "Other online stores",
] as const;
const goals = [
  "More sales",
  "More followers",
  "A better website",
  "Bulk orders and stockists",
  "Less admin",
] as const;

type BusinessDraft = {
  question: number;
  editingFromSummary: boolean;
  attemptedSlug: string;
  owner: string;
  name: string;
  category: string;
  detail: string;
  buyers: string;
  channels: string[];
  links: string[];
  linkInput: string;
  location: string;
  timeZone: string;
  goals: string[];
  goalText: string;
};

function draftKey(pubkey: string) {
  return `${DRAFT_KEY}:${pubkey.toLowerCase()}`;
}

function defaultLocation(timeZone: string) {
  if (timeZone === "Africa/Johannesburg") return "Johannesburg, South Africa";
  return timeZone.split("/").at(-1)?.replaceAll("_", " ") ?? "";
}

function initialDraft(ownerName: string): BusinessDraft {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return {
    question: ownerName.trim() ? 1 : 0,
    editingFromSummary: false,
    attemptedSlug: "",
    owner: ownerName.trim(),
    name: "",
    category: "",
    detail: "",
    buyers: "",
    channels: [],
    links: [],
    linkInput: "",
    location: defaultLocation(timeZone),
    timeZone,
    goals: [],
    goalText: "",
  };
}

function readDraft(pubkey: string, ownerName: string): BusinessDraft {
  const fresh = initialDraft(ownerName);
  try {
    const raw = localStorage.getItem(draftKey(pubkey));
    if (!raw) return fresh;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return fresh;
    const draft = value as Partial<BusinessDraft>;
    if (
      typeof draft.name !== "string" ||
      typeof draft.question !== "number" ||
      typeof draft.owner !== "string"
    ) {
      return fresh;
    }
    return {
      ...fresh,
      ...draft,
      question: Math.max(0, Math.min(8, Math.floor(draft.question))),
      attemptedSlug:
        typeof draft.attemptedSlug === "string" ? draft.attemptedSlug : "",
      channels: Array.isArray(draft.channels)
        ? draft.channels.filter(
            (item): item is string => typeof item === "string",
          )
        : [],
      links: Array.isArray(draft.links)
        ? draft.links.filter((item): item is string => typeof item === "string")
        : [],
      goals: Array.isArray(draft.goals)
        ? draft.goals.filter((item): item is string => typeof item === "string")
        : [],
    };
  } catch {
    return fresh;
  }
}

/** An acknowledged company still needs its interrupted local profile handoff. */
export function hasPendingGuidedBusinessHandoff(
  pubkey: string,
  community: SelfServeCommunity,
) {
  const draft = readDraft(pubkey, "");
  return (
    draft.question >= 8 &&
    draft.attemptedSlug === community.slug &&
    draft.name.trim().length > 0
  );
}

function validLink(value: string) {
  return (
    /^@[a-z0-9._-]{2,}$/i.test(value) ||
    /^(https?:\/\/)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?$/i.test(value)
  );
}

function toggle(values: string[], item: string) {
  return values.includes(item)
    ? values.filter((value) => value !== item)
    : [...values, item];
}

function businessSlug(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function asProfile(draft: BusinessDraft): OnboardingBusinessProfile {
  const website = draft.links.find((link) => !link.startsWith("@")) ?? "";
  return {
    name: draft.name.trim(),
    website,
    description: [draft.category, draft.detail].filter(Boolean).join(". "),
    logoDataUrl: null,
    logoUrl: null,
    category: draft.category,
    buyers: draft.buyers.trim(),
    channels: draft.channels,
    links: draft.links,
    location: draft.location.trim(),
    timeZone: draft.timeZone,
    goals: draft.goals,
    goalText: draft.goalText.trim(),
  };
}

/** O-03, backed by a durable local draft and signed company creation. */
export function GuidedBusinessSetupStep({
  email,
  ownerName,
  pubkey,
  onBack,
  onCreated,
}: {
  email: string;
  ownerName: string;
  pubkey: string;
  onBack: () => void;
  onCreated: (
    community: SelfServeCommunity,
    profile: OnboardingBusinessProfile,
  ) => void;
}) {
  const [draft, setDraft] = React.useState(() => readDraft(pubkey, ownerName));
  const [error, setError] = React.useState<string | null>(null);
  const [storageError, setStorageError] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const question = draft.question;
  const summary = question >= 8;

  React.useEffect(() => {
    if (question < 8) inputRef.current?.focus();
  }, [question]);

  const save = (next: BusinessDraft) => {
    setDraft(next);
    setError(null);
    try {
      localStorage.setItem(draftKey(pubkey), JSON.stringify(next));
      setStorageError(false);
      return true;
    } catch {
      setStorageError(true);
      return false;
    }
  };

  const advance = () => {
    if (storageError) return;
    if (question === 0 && !draft.owner.trim()) {
      setError("Tell Scout what to call you.");
      return;
    }
    if (question === 1 && !draft.name.trim()) {
      setError("Add your business name to continue.");
      return;
    }
    if (
      question === 5 &&
      draft.linkInput.trim() &&
      !validLink(draft.linkInput.trim())
    ) {
      setError(
        "That doesn't look like a link or an @name. Try again, or skip it.",
      );
      return;
    }
    save({
      ...draft,
      links:
        question === 5 && draft.linkInput.trim()
          ? [...new Set([...draft.links, draft.linkInput.trim()])]
          : draft.links,
      linkInput: question === 5 ? "" : draft.linkInput,
      question: draft.editingFromSummary ? 8 : question + 1,
      editingFromSummary: false,
    });
  };

  const skip = () => {
    const cleared =
      question === 2
        ? { category: "", detail: "" }
        : question === 3
          ? { buyers: "" }
          : question === 4
            ? { channels: [] }
            : question === 5
              ? { links: [], linkInput: "" }
              : question === 6
                ? { location: "" }
                : { goals: [], goalText: "" };
    save({
      ...draft,
      ...cleared,
      question: draft.editingFromSummary ? 8 : question + 1,
      editingFromSummary: false,
    });
  };

  const addLink = () => {
    const link = draft.linkInput.trim();
    if (!link) return;
    if (!validLink(link)) {
      setError(
        "That doesn't look like a link or an @name. Try again, or skip it.",
      );
      return;
    }
    save({
      ...draft,
      links: [...new Set([...draft.links, link])],
      linkInput: "",
    });
  };

  const create = async () => {
    if (pending || storageError || !pubkey) return;
    const { slug, error: slugError } = validateCommunitySlug(
      businessSlug(draft.name),
    );
    if (slugError) {
      setError(slugError);
      return;
    }
    if (!save({ ...draft, attemptedSlug: slug })) return;
    setPending(true);
    setError(null);
    try {
      const httpBase = await getSelfProvisioningHttpBase();
      const config = communityProvisioningFromConfig(
        await fetchCommunityProvisioningConfig(httpBase),
      );
      if (!config.selfServe || !config.domain) {
        throw new Error("Community creation is not enabled on this relay.");
      }
      const expectedHost = `${slug}.${config.domain}`.toLowerCase();
      const mine = await listMyCommunities(httpBase);
      if (mine.owner_pubkey.toLowerCase() !== pubkey.toLowerCase()) {
        throw new Error("Could not verify the signed-in account.");
      }
      let community = mine.communities.find(
        (item) =>
          item.normalized_host.toLowerCase() === expectedHost &&
          item.owner_pubkey.toLowerCase() === pubkey.toLowerCase(),
      );
      if (!community) {
        const availability = await checkCommunityAvailability(httpBase, slug);
        if (!availability.available) {
          throw new Error(
            availability.reason ?? "That address is already in use.",
          );
        }
        try {
          community = (await createSelfServeCommunity(httpBase, slug))
            .community;
        } catch (cause) {
          // A timed-out create can still have committed. Recover before retrying.
          const recovered = await listMyCommunities(httpBase);
          community = recovered.communities.find(
            (item) =>
              item.normalized_host.toLowerCase() === expectedHost &&
              item.owner_pubkey.toLowerCase() === pubkey.toLowerCase(),
          );
          if (!community) throw cause;
        }
      }
      if (
        community.normalized_host.toLowerCase() !== expectedHost ||
        community.owner_pubkey.toLowerCase() !== pubkey.toLowerCase()
      ) {
        throw new Error(
          "Could not verify that business belongs to your account.",
        );
      }
      const profile = asProfile(draft);
      saveOnboardingBusinessProfile(community.id, profile);
      if (email) rememberSignupName(email, draft.owner);
      localStorage.removeItem(draftKey(pubkey));
      onCreated(community, profile);
    } catch (cause) {
      setError(
        cause instanceof CommunityProvisioningRequestError
          ? cause.code === "request_failed"
            ? "I couldn't set up your business yet. Try again. Your answers are kept here."
            : communityCreateErrorMessage(cause.code)
          : cause instanceof Error &&
              cause.message.startsWith("Could not verify")
            ? cause.message
            : cause instanceof Error &&
                cause.message ===
                  "Community creation is not enabled on this relay."
              ? cause.message
              : navigator.onLine === false
                ? "Connect to the internet to carry on. Your answers are kept here."
                : "I couldn't set up your business yet. Try again. Your answers are kept here.",
      );
    } finally {
      setPending(false);
    }
  };

  const questions: Record<number, string> = {
    0: "What should I call you?",
    1: `Hi ${draft.owner || "there"}, I'm Scout. I'll run your team for you. First, what's your business called?`,
    2: "Nice. What do you sell?",
    3: "Who usually buys from you?",
    4: "Where do you sell today?",
    5: "Where can I see your business online? Paste your website, or your Instagram, TikTok or Facebook name.",
    6: "Where are you based?",
    7: "Last one. What would make the next 3 months a win?",
  };
  const rows: Array<[string, string, number]> = [
    ["Your name", draft.owner, 0],
    ["Business", draft.name, 1],
    [
      "What you sell",
      [draft.category, draft.detail].filter(Boolean).join(" · "),
      2,
    ],
    ["Who buys", draft.buyers, 3],
    ["Where you sell", draft.channels.join(", "), 4],
    ["Online", draft.links.join(", "), 5],
    ["Based in", draft.location, 6],
    [
      "Your goals",
      [...draft.goals, draft.goalText].filter(Boolean).join(", "),
      7,
    ],
  ];

  return (
    <div
      className="colony-canary-first-run colony-canary-business"
      data-testid="onboarding-scene-business"
    >
      <StartupWindowDragRegion />
      <aside className="colony-canary-first-run-aside">
        <div className="colony-canary-first-run-brand">
          <AntMark />
          <strong>Colony</strong>
        </div>
        <p>Your AI team, running your business with you.</p>
        <div className="colony-canary-first-run-scout">
          <ColonyAntAvatar decorative name="Scout" />
          <span>Scout will guide you.</span>
        </div>
      </aside>
      <main className="colony-canary-first-run-main">
        <button
          className="colony-canary-first-run-back"
          type="button"
          onClick={() => {
            if (summary) save({ ...draft, question: 7 });
            else if (draft.editingFromSummary)
              save({ ...draft, question: 8, editingFromSummary: false });
            else if (question > (ownerName.trim() ? 1 : 0))
              save({ ...draft, question: question - 1 });
            else onBack();
          }}
        >
          <ArrowLeft aria-hidden="true" size={16} /> Back
        </button>
        <div className="colony-canary-first-run-form colony-canary-business-form">
          <span className="colony-canary-first-run-eyebrow">YOUR BUSINESS</span>
          <h1>
            {summary ? "Here's what I have" : "Tell Scout about your business"}
          </h1>
          {summary ? (
            <>
              <div className="colony-canary-business-prompt">
                <ColonyAntAvatar decorative name="Scout" />
                <p>
                  Thanks, {draft.owner}. That's all I need for now. You can
                  change anything here.
                </p>
              </div>
              <div className="colony-canary-business-summary">
                {rows.map(([label, value, target]) => (
                  <div key={label}>
                    <span>
                      <small>{label}</small>
                      <strong>{value || "Skipped"}</strong>
                    </span>
                    <button
                      type="button"
                      aria-label={`Change ${label}`}
                      onClick={() =>
                        save({
                          ...draft,
                          question: target,
                          editingFromSummary: true,
                        })
                      }
                    >
                      Change
                    </button>
                  </div>
                ))}
              </div>
              <button
                className="colony-canary-first-run-primary"
                disabled={pending || storageError}
                onClick={() => void create()}
                type="button"
              >
                {pending ? "Setting up your business…" : "Continue"}
                <ArrowRight aria-hidden="true" size={16} />
              </button>
            </>
          ) : (
            <>
              <p className="colony-canary-business-progress" role="status">
                {question} of 7
              </p>
              <div className="colony-canary-business-prompt">
                <ColonyAntAvatar decorative name="Scout" />
                <p>{questions[question]}</p>
              </div>
              {question === 2 ? (
                <>
                  <fieldset className="colony-canary-business-options">
                    <legend className="sr-only">What you sell</legend>
                    {categories.map((item) => (
                      <button
                        key={item}
                        aria-pressed={draft.category === item}
                        className={draft.category === item ? "selected" : ""}
                        onClick={() => save({ ...draft, category: item })}
                        type="button"
                      >
                        {item}
                      </button>
                    ))}
                  </fieldset>
                  <label htmlFor="business-detail">
                    Tell me a bit more (optional)
                  </label>
                  <input
                    id="business-detail"
                    value={draft.detail}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        advance();
                      }
                    }}
                    onChange={(event) =>
                      save({ ...draft, detail: event.target.value })
                    }
                  />
                </>
              ) : question === 4 || question === 7 ? (
                <>
                  <fieldset
                    className="colony-canary-business-options"
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        advance();
                      }
                    }}
                  >
                    <legend className="sr-only">
                      {question === 4 ? "Where you sell" : "Your goals"}
                    </legend>
                    {(question === 4 ? channels : goals).map((item) => {
                      const selected =
                        question === 4
                          ? draft.channels.includes(item)
                          : draft.goals.includes(item);
                      return (
                        <button
                          key={item}
                          aria-pressed={selected}
                          className={selected ? "selected" : ""}
                          onClick={() =>
                            save(
                              question === 4
                                ? {
                                    ...draft,
                                    channels: toggle(draft.channels, item),
                                  }
                                : {
                                    ...draft,
                                    goals: toggle(draft.goals, item),
                                  },
                            )
                          }
                          type="button"
                        >
                          {item}
                        </button>
                      );
                    })}
                  </fieldset>
                  {question === 7 ? (
                    <>
                      <label htmlFor="business-goal">
                        Anything else? (optional)
                      </label>
                      <input
                        id="business-goal"
                        value={draft.goalText}
                        onChange={(event) =>
                          save({ ...draft, goalText: event.target.value })
                        }
                      />
                    </>
                  ) : null}
                </>
              ) : question === 5 ? (
                <>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      addLink();
                    }}
                  >
                    <label htmlFor="business-link">Add a link or @name</label>
                    <div className="colony-canary-business-link-row">
                      <input
                        id="business-link"
                        ref={inputRef}
                        value={draft.linkInput}
                        onChange={(event) =>
                          save({ ...draft, linkInput: event.target.value })
                        }
                        placeholder="@yourbusiness or yourbusiness.co.za"
                      />
                      <button type="submit">Add</button>
                    </div>
                  </form>
                  <div className="colony-canary-business-links">
                    {draft.links.map((link) => (
                      <span key={link}>
                        {link}
                        <button
                          type="button"
                          aria-label={`Remove ${link}`}
                          onClick={() =>
                            save({
                              ...draft,
                              links: draft.links.filter(
                                (item) => item !== link,
                              ),
                            })
                          }
                        >
                          <X aria-hidden="true" size={13} />
                        </button>
                      </span>
                    ))}
                  </div>
                </>
              ) : (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    advance();
                  }}
                >
                  <label htmlFor="business-answer">Your answer</label>
                  <input
                    key={question}
                    id="business-answer"
                    ref={inputRef}
                    autoComplete={
                      question === 0
                        ? "name"
                        : question === 1
                          ? "organization"
                          : "off"
                    }
                    value={
                      question === 0
                        ? draft.owner
                        : question === 1
                          ? draft.name
                          : question === 3
                            ? draft.buyers
                            : draft.location
                    }
                    onChange={(event) =>
                      save({
                        ...draft,
                        [question === 0
                          ? "owner"
                          : question === 1
                            ? "name"
                            : question === 3
                              ? "buyers"
                              : "location"]: event.target.value,
                      })
                    }
                    placeholder={
                      question === 1
                        ? "Your business name"
                        : question === 3
                          ? "Who buys from you?"
                          : undefined
                    }
                  />
                </form>
              )}
              <div className="colony-canary-business-actions">
                <button
                  className="colony-canary-first-run-primary"
                  disabled={storageError}
                  onClick={advance}
                  type="button"
                >
                  {question === 7 ? "Review answers" : "Continue"}
                  <ArrowRight aria-hidden="true" size={16} />
                </button>
                {question > 1 ? (
                  <button
                    className="colony-canary-business-skip"
                    disabled={storageError}
                    onClick={skip}
                    type="button"
                  >
                    Skip for now
                  </button>
                ) : null}
              </div>
            </>
          )}
          {storageError ? (
            <p className="colony-canary-first-run-feedback" role="alert">
              Your answers couldn't be saved on this computer. Free up storage,
              then try again.
            </p>
          ) : null}
          {error ? (
            <p className="colony-canary-first-run-feedback" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </main>
    </div>
  );
}
