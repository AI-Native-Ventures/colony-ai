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
  else if (
    /subscription|credits|openrouter|api-key|api-error|connect|funding/.test(
      scene,
    )
  )
    guidance = {
      title: "Let’s connect your first agent.",
      copy: "Choose the connection that works for you. The supported options are all here.",
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
  const working =
    scene === "testing" ||
    scene === "subscription-scan" ||
    scene === "credits-pending" ||
    scene.endsWith("verifying");
  if (working)
    guidance = {
      title:
        scene === "testing"
          ? "Waiting for your first reply."
          : scene === "subscription-scan"
            ? "Checking your installed apps."
            : "Getting things ready.",
      copy:
        scene === "testing"
          ? "A saved connection is the start. A reply confirms your agent can work."
          : "You can see the progress alongside me.",
      status: scene === "testing" ? "Checking the connection" : "Working",
      pose: "working",
    };
  if ((error || scene.endsWith("error")) && !working)
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
