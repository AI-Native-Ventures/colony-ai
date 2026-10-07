/** Pure redaction shared by Electron main and the browser control UI. */
export const REDACTED: string;
export const MAX_REDACTED_STRING: number;
export const INVISIBLE: RegExp;
export function luhnValid(digits: string): boolean;
export function containsSecret(text: unknown): boolean;
export function redactText(text: unknown, maxLength?: number): string;
export function redactUrl(input: unknown): string;
export function redactRecord(value: unknown, depth?: number): unknown;
export function sanitizeUntrusted(text: unknown, maxLength?: number): string;
export function wrapUntrusted(
  text: unknown,
  context?: { origin?: string; tab?: string },
): string;
export function sanitizeBlock(text: unknown, maxLength?: number): string;
