import type { ScoutPose } from "../ui/scoutGuidance";

/** Original frozen Colony ant rig, mounted only into its dedicated avatar host. */
export function rig(host: HTMLElement, skin?: number): object;

/** Draws a frozen-design pose at a bounded frame time and motion intensity. */
export function act(
  avatar: object,
  time: number,
  state: ScoutPose,
  age: number,
  look?: { x: number; y: number },
  intensity?: number,
): void;
