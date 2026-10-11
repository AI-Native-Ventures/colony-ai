/** Browser access is available by default; explicit 0 is the release kill switch. */
export function browserAgentEnabled(env = process.env) {
  return (
    env.COLONY_BROWSER_AGENT === undefined || env.COLONY_BROWSER_AGENT === "1"
  );
}
