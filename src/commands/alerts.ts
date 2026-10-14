import { readAlerts } from "../state.js";

export function alerts(root: string, options: { json: boolean }): number {
  const entries = readAlerts(root);
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ count: entries.length, alerts: entries })}\n`);
    return 0;
  }
  if (entries.length === 0) {
    process.stdout.write("No trips recorded.\n");
    return 0;
  }
  for (const alert of entries) {
    process.stdout.write(`${alert.at}  ${alert.reason}  ${alert.tool}\n  ${alert.detail}\n`);
  }
  process.stdout.write(`\n${entries.length} trip(s) in .canaryhook/alerts.jsonl\n`);
  return 0;
}
