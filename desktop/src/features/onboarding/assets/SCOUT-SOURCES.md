# Scout artwork

`scout.svg` preserves the eyeless green Scout rig from the approved frozen Colony onboarding package: `20260930-onboarding-scout-r4/reference/app/onboarding/ant.js`. It was exported from its rendered neutral reduced-motion pose on 3 October 2026. Source palette: Scout, top #a5bd8d, base #719763, deep #3d694c.

Original Colony design artwork. The typed `ui/ScoutAvatar.tsx` uses the same silhouette and gradients, with locally scoped SVG IDs for repeated controls. Prototype DOM stamping and timers are not imported. No upstream bee artwork is used for the new Scout avatar. Existing persona and protocol coordinates remain unchanged for compatibility.

`scoutRig.js` is the original frozen r4 `reference/app/onboarding/ant.js` motion rig. The React wrapper pauses it when hidden, offscreen, or reduced motion is enabled.

Additional harness marks in `harness-logos/` were copied unchanged from frozen r4 `reference/app/onboarding/assets/harnesses/`: OpenCode, Pi, Oh My Pi and Prime Agent. These are the supplied provider identity assets.
