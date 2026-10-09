import type { OnboardingSceneId } from "./onboardingScenes";

export type ScoutPose = "hello" | "listening" | "waiting" | "working" | "done";
export type ScoutGuidance = {
  title: string;
  copy: string;
  status: string;
  pose: ScoutPose;
};

/** Presentation state only. Runtime owners supply working, feedback and reply evidence. */
export function scoutGuidance(
  scene: OnboardingSceneId,
  error?: string | null,
  override?: ScoutGuidance,
  focusTopic?: string,
  connectionChecking = false,
): ScoutGuidance {
  if (override) return override;
  let guidance: ScoutGuidance = {
    title: "Welcome. Let’s create a colony.",
    copy: "I’m Scout, your Chief of Staff. I’ll help you get set up.",
    status: "Here to help",
    pose: "hello",
  };
  if (scene.includes("business") || scene === "additional")
    guidance = {
      title: "Let’s get to know your business.",
      copy: "Add the essentials here. A website can help fill in the details.",
      status: "Your turn",
      pose: "waiting",
    };
  else if (/subscription|credits|openrouter|connect|funding/.test(scene))
    guidance = {
      title: "Let’s connect your first agent.",
      copy: "Use your own Claude Code or Codex plan, or let Colony Agent do the work. Other tools and keys live in Settings.",
      status: "Your turn",
      pose: "waiting",
    };
  if (/signin|forgot|reset|new-password|email-sent/.test(scene))
    guidance = {
      title: "Let’s get you back in.",
      copy: "Your business and your team will be right where you left them.",
      status: "Here to help",
      pose: "listening",
    };
  if (/verify|code/.test(scene))
    guidance = {
      title: "Check your email.",
      copy: "Enter the six-digit code here. I’ll be here while you finish.",
      status: "Your turn",
      pose: "waiting",
    };
  const fieldCopy: Record<string, [string, string]> = {
    "full-name": [
      "What should I call you?",
      "Use the name you’d like your team to know.",
    ],
    "business-name": [
      "What’s your business called?",
      "A working name is enough to get started.",
    ],
    "business-website": [
      "Already have a website?",
      "I can bring its details into this same form.",
    ],
    "business-description": [
      "What does your business do?",
      "Tell me who you help and what you do for them.",
    ],
  };
  const focused = focusTopic ? fieldCopy[focusTopic] : undefined;
  if (
    (scene.includes("business") ||
      scene === "additional" ||
      scene === "account") &&
    focused
  )
    guidance = { ...guidance, title: focused[0], copy: focused[1] };
  const working =
    scene === "testing" ||
    scene === "subscription-scan" ||
    scene === "credits-pending" ||
    connectionChecking;
  if (working)
    guidance = {
      title:
        scene === "testing"
          ? "Waiting for your first reply."
          : scene === "subscription-scan" || connectionChecking
            ? "Checking your installed apps."
            : "Getting things ready.",
      copy:
        scene === "testing"
          ? "A saved connection is the start. A reply confirms your agent can work."
          : "You can see the progress alongside me.",
      status: scene === "testing" ? "Checking the connection" : "Working",
      pose: "working",
    };
  const inlineErrorScenes: OnboardingSceneId[] = [
    "account-error",
    "business-error",
    "connection-error",
    "credits-failed",
    "credits-price-error",
    "openrouter-error",
    "openrouter-limit",
    "subscription-models-error",
    "subscription-exhausted",
  ];
  const codeFeedback = scene.startsWith("verify") || scene.startsWith("reset");
  if (
    ((error && !codeFeedback) || inlineErrorScenes.includes(scene)) &&
    !working
  )
    guidance = {
      title: "We can sort this out.",
      copy: "Your next step is shown alongside me. You can retry or use another option.",
      status: "Needs your attention",
      pose: "waiting",
    };
  if (scene === "connected")
    guidance = {
      title: "There you are. We’re connected.",
      copy: "Your first reply is here. Let’s open your colony and get to work.",
      status: "First reply received",
      pose: "done",
    };
  return guidance;
}
