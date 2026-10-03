// Original Colony design rig. See SCOUT-SOURCES.md for attribution.
export const palette = [
  { name: "Scout", top: "#a5bd8d", base: "#719763", deep: "#3d694c", shape: 0 },
  { name: "Sarah", top: "#ffc2a2", base: "#ef957a", deep: "#c56554", shape: 1 },
  { name: "Theo", top: "#b5c9ed", base: "#7fa0d6", deep: "#4c6eaa", shape: 2 },
];
export const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const ease = (x) => {
  x = clamp(x);
  return x * x * (3 - 2 * x);
};
export const spring = (t, f = 12, d = 5) =>
  1 - Math.exp(-Math.max(0, t) * d) * Math.cos(Math.max(0, t) * f);
let id = 0;
export function rig(host, skin = 0) {
  const p = palette[skin],
    uid = `ant-${++id}`;
  host.innerHTML = `<svg viewBox="-120 -145 240 235" role="img" aria-label="${p.name}, eyeless ant agent"><defs><radialGradient id="${uid}-head" cx="30%" cy="18%" r="92%"><stop offset="0" stop-color="${p.top}"/><stop offset=".50" stop-color="${p.base}"/><stop offset="1" stop-color="${p.deep}"/></radialGradient><linearGradient id="${uid}-stem" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${p.top}"/><stop offset=".5" stop-color="${p.base}"/><stop offset="1" stop-color="${p.deep}"/></linearGradient></defs><ellipse class="shadow" cx="0" cy="69" rx="37" ry="4" fill="${p.deep}" opacity=".06"/><g class="body"><g class="antennas"><path class="left-stem" fill="none" stroke="url(#${uid}-stem)" stroke-width="10" stroke-linecap="round"/><ellipse class="left-tip" fill="url(#${uid}-head)" rx="11" ry="8"/><path class="right-stem" fill="none" stroke="url(#${uid}-stem)" stroke-width="10" stroke-linecap="round"/><ellipse class="right-tip" fill="url(#${uid}-head)" rx="11" ry="8"/></g><path class="head" fill="url(#${uid}-head)"/></g></svg>`;
  const svg = host.querySelector("svg"),
    body = svg.querySelector(".body"),
    head = svg.querySelector(".head");
  const face =
    p.shape === 1
      ? "M0 -45C-34 -45 -62 -28 -62 1C-62 31 -34 45 0 45C34 45 62 29 62 1C62 -27 33 -45 0 -45Z"
      : p.shape === 2
        ? "M0 -51C-26 -52 -43 -27 -48 4C-53 36 -35 48 -2 50C34 53 52 40 49 13C46 -18 29 -51 0 -51Z"
        : "M0 -48C-30 -48 -53 -29 -53 0C-53 30 -34 49 0 49C31 49 54 34 55 6C57 -26 29 -48 0 -48Z";
  head.setAttribute("d", face);
  return {
    host,
    svg,
    body,
    head,
    shadow: svg.querySelector(".shadow"),
    stems: [svg.querySelector(".left-stem"), svg.querySelector(".right-stem")],
    tips: [svg.querySelector(".left-tip"), svg.querySelector(".right-tip")],
    skin,
  };
}
export function act(r, t, state, age, look = { x: 0, y: 0 }, intensity = 1) {
  const k = r.skin,
    a = Math.max(0, age),
    enter = ease(a / 0.42) * intensity;
  let turn = look.x * 9,
    tilt = look.x * 3,
    dy = 0,
    sx = 1,
    sy = 1,
    lift = [0, 0],
    curl = [0, 0],
    forward = [0, 0];
  const quiet = Math.sin(t * 1.7 + k) * 0.7 * intensity;
  dy = quiet;
  if (state === "listening") {
    const perk = Math.exp(-a * 4) * Math.sin(a * 15) * 9 * intensity;
    lift = [perk, perk * 0.75];
    tilt += look.x * 2;
  }
  if (state === "thinking") {
    tilt += (-7 + Math.sin(t * 0.9) * 2) * enter;
    curl = [16 * enter, -3 * enter];
    lift = [-4 * enter, 6 * enter];
    dy += 0.6 * Math.sin(t * 1.7) * enter;
  }
  if (state === "working") {
    const phase = (a + k * 0.37 + (r.phase || 0)) % 3.4,
      focus = phase < 2.65 ? Math.sin(phase * 5.3) : 0,
      other = phase < 2.65 ? Math.sin(phase * 5.3 + 1.65) : 0;
    tilt += (4 + focus * 1.3) * enter;
    turn -= 7 * enter;
    dy += focus * 0.45 * enter;
    forward = [
      12 * enter + focus * 17 * enter,
      12 * enter + other * 17 * enter,
    ];
    lift = [-5 * enter + focus * 15 * enter, -5 * enter + other * 15 * enter];
    curl = [2 * enter + other * 3 * enter, 2 * enter + focus * 3 * enter];
  }
  if (state === "handoff") {
    turn += 19 * enter;
    tilt += 4 * enter;
    forward = [5 * enter, 27 * enter];
    lift = [-3 * enter, -10 * enter];
    curl = [0, 8 * enter];
  }
  if (state === "receive") {
    const ack =
      Math.exp(-Math.max(0, a - 0.55) * 4) *
      Math.sin(Math.max(0, a - 0.55) * 13) *
      intensity;
    tilt -= 6 * enter;
    turn -= 17 * enter;
    dy -= ack * 4;
    lift = [12 * ack, 10 * ack];
    sx += ack * 0.035;
    sy -= ack * 0.035;
  }
  if (state === "done") {
    const release = Math.exp(-a * 3) * Math.sin(a * 12) * intensity;
    dy -= release * 12;
    sx += release * 0.06;
    sy -= release * 0.055;
    lift = [release * 16, release * 16];
    tilt += release * 4;
  }
  if (state === "waiting") {
    const phase = (a + k * 0.31 + (r.phase || 0)) % 5.8,
      attention = phase < 1.15 ? Math.sin((phase / 1.15) * Math.PI) : 0;
    tilt += (-8 - attention * 3) * enter;
    lift = [(8 + attention * 21) * enter, -4 * enter];
    curl = [(8 + attention * 4) * enter, 0];
    forward = [-attention * 8 * enter, 0];
  }
  if (state === "hello") {
    const hello = Math.exp(-a * 3) * Math.sin(a * 13) * intensity;
    dy -= hello * 8;
    sx += hello * 0.035;
    sy -= hello * 0.035;
    lift = [hello * 11, hello * 7];
  }
  if (
    !document.body.classList.contains("film") &&
    !(
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches
    )
  ) {
    const targetPose = {
      turn,
      tilt,
      dy,
      sx,
      sy,
      lift: [...lift],
      curl: [...curl],
      forward: [...forward],
    };
    if (r.state !== state) {
      r.from = r.current || targetPose;
      r.started = t;
      r.state = state;
    }
    const q = ease((t - r.started) / 0.28);
    if (q < 1 && r.from) {
      const mix = (old, v) => old + (v - old) * q;
      turn = mix(r.from.turn, turn);
      tilt = mix(r.from.tilt, tilt);
      dy = mix(r.from.dy, dy);
      sx = mix(r.from.sx, sx);
      sy = mix(r.from.sy, sy);
      lift = lift.map((v, i) => mix(r.from.lift[i], v));
      curl = curl.map((v, i) => mix(r.from.curl[i], v));
      forward = forward.map((v, i) => mix(r.from.forward[i], v));
    }
    r.current = {
      turn,
      tilt,
      dy,
      sx,
      sy,
      lift: [...lift],
      curl: [...curl],
      forward: [...forward],
    };
  }
  const squeeze = 1 - Math.abs(turn) * 0.0025;
  r.body.setAttribute(
    "transform",
    `translate(${turn * 0.28} ${dy}) rotate(${tilt}) scale(${sx * squeeze} ${sy})`,
  );
  r.head.setAttribute("transform", `translate(${turn * 0.1} 0)`);
  r.shadow.setAttribute("rx", String(37 + dy * 0.15));
  for (let i = 0; i < 2; i++) {
    const sign = i === 0 ? -1 : 1,
      base = sign * 25 + turn * 0.18,
      y = -35;
    const f = forward[i],
      c = curl[i],
      endX =
        sign * ((i === 0 ? 34 : 64) - c) + turn * 0.42 + look.x * 4 - f * 0.45,
      endY = -104 - lift[i] + Math.abs(turn) * 0.14 + f * 0.55;
    const elbowX =
        sign * ((i === 0 ? 79 : 48) - c * 0.55) + turn * 0.33 - f * 0.22,
      elbowY = -122 - lift[i] * 0.7 + f * 0.36;
    const sway = Math.sin(t * 2 + i * 1.3 + k) * 1.2 * intensity;
    const d = `M${base} ${y} C${base + sign * 8} ${y - 22} ${elbowX} ${elbowY + sway} ${endX} ${endY + sway}`;
    r.stems[i].setAttribute("d", d);
    r.tips[i].setAttribute(
      "transform",
      `translate(${endX} ${endY + sway}) rotate(${sign * (18 + c * 0.8)})`,
    );
  }
}
