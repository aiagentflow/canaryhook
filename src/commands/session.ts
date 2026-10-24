import { claude, type Agent } from "../agents/index.js";
import { readAlerts, STATE_DIR, type Alert } from "../state.js";

const RECENT = 3;

function summarize(alerts: Alert[]): string {
  const recent = alerts.slice(-RECENT).reverse();
  const lines = recent.map((alert) => `  ${alert.at}  ${alert.reason}  ${alert.tool}: ${alert.detail}`);
  const more = alerts.length > recent.length ? ` (showing the last ${recent.length})` : "";
  return [
    `canaryhook: ${alerts.length} canary trip(s) recorded in this project${more}.`,
    ...lines,
    `A trip means something went looking for credentials. The full record is in`,
    `${STATE_DIR}/alerts.jsonl. Tell the user about this before doing anything else;`,
    `do not clear the record yourself.`,
  ].join("\n");
}

/**
 * SessionStart hook. A trip that nobody reads is not a detection, so the
 * outstanding ones are handed to the agent as context at the start of the next
 * session. Silent when the record is clean, and never fails loudly: a reporting
 * problem must not get in the way of a session.
 */
export function sessionStart(root: string, agent: Agent = claude): number {
  try {
    const alerts = readAlerts(root);
    if (alerts.length === 0) return 0;
    process.stdout.write(`${agent.report(summarize(alerts))}\n`);
  } catch {
    return 0;
  }
  return 0;
}
