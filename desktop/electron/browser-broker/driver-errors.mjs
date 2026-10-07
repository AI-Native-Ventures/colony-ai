/**
 * Errors a page driver may surface to the broker. Only these codes cross to
 * the agent; every other thrown error becomes a generic `driver_error`, so
 * internal messages and paths never leak.
 */

export const DRIVER_ERROR_CODES = Object.freeze({
  click_intercepted:
    "Another element covers the target, so the click was not sent.",
  element_not_actionable: "The element cannot be used right now.",
  debugger_detached: "The browser control channel for this tab is unavailable.",
  tab_crashed: "The tab is unavailable or crashed.",
  cdp_timeout: "The page did not respond in time.",
});

export class DriverError extends Error {
  constructor(driverCode, message) {
    super(message ?? DRIVER_ERROR_CODES[driverCode] ?? driverCode);
    this.name = "DriverError";
    this.driverCode = driverCode;
  }
}

export const isDriverError = (error) =>
  error instanceof DriverError && error.driverCode in DRIVER_ERROR_CODES;
