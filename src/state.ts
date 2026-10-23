import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const STATE_DIR = ".canaryhook";
export const STATE_FILE = "canaries.json";
export const ALERTS_FILE = "alerts.jsonl";

export interface Decoy {
  /** Project-relative path of the planted file. */
  path: string;
  /** The unique canary string hidden inside it. */
  token: string;
  kind: string;
}

export interface State {
  version: 1;
  created: string;
  decoys: Decoy[];
  hookRegistered: boolean;
}

export interface Alert {
  at: string;
  reason: "decoy-read" | "canary-exfil" | "tamper";
  decoy: string;
  tool: string;
  detail: string;
  sessionId?: string;
}

export function statePath(root: string): string {
  return join(root, STATE_DIR, STATE_FILE);
}

export function alertsPath(root: string): string {
  return join(root, STATE_DIR, ALERTS_FILE);
}

/**
 * The nearest directory at or above `start` that canaryhook was initialized in.
 * Agents and CI steps often run from a subdirectory, and looking only there
 * would see no decoys at all, which fails open.
 */
export function findRoot(start: string): string | null {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(statePath(dir))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function readState(root: string): State | null {
  const path = statePath(root);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as State;
  } catch {
    return null;
  }
}

export function writeState(root: string, state: State): void {
  mkdirSync(join(root, STATE_DIR), { recursive: true });
  writeFileSync(statePath(root), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function appendAlert(root: string, alert: Alert): void {
  mkdirSync(join(root, STATE_DIR), { recursive: true });
  writeFileSync(alertsPath(root), `${JSON.stringify(alert)}\n`, { encoding: "utf8", flag: "a" });
}

export function readAlerts(root: string): Alert[] {
  const path = alertsPath(root);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Alert];
      } catch {
        return [];
      }
    });
}

/**
 * True when the file at a decoy's path still holds that decoy's canary string.
 * Ownership has to be proven before removing anything: a recorded path may
 * since have been replaced by a real file of the user's.
 */
export function isDecoyFile(root: string, decoy: Decoy): boolean {
  const path = join(root, decoy.path);
  if (!existsSync(path)) return false;
  try {
    return readFileSync(path, "utf8").includes(decoy.token);
  } catch {
    return false;
  }
}

function randomFrom(alphabet: string, length: number): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

/** Uppercase alphanumeric run, the shape of an AWS access key id. */
export function randomToken(length: number): string {
  return randomFrom("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", length);
}

/** Mixed-case alphanumeric run, the shape of most API keys and tokens. */
export function randomKey(length: number): string {
  return randomFrom("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", length);
}

/**
 * Base64 alphabet, for the values that are really encoded bytes: an AWS secret
 * access key, the body of a private key. A decoy only works while it looks
 * like the real thing.
 */
export function randomBase64(length: number): string {
  return randomFrom("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", length);
}
