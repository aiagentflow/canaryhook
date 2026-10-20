import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
  reason: "decoy-read" | "canary-exfil";
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

/** Uppercase alphanumeric run, the shape most cloud credentials take. */
export function randomToken(length: number): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return out;
}
