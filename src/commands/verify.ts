import { readAlerts } from "../state.js";

/** CI gate: non-zero when anything went looking for the decoys. */
export function verify(root: string, options: { json: boolean }): number {
  const entries = readAlerts(root);
  const clean = entries.length === 0;
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ clean, trips: entries.length })}\n`);
  } else if (clean) {
    process.stdout.write("No canary trips.\n");
  } else {
    process.stderr.write(`${entries.length} canary trip(s) recorded. Run canaryhook alerts.\n`);
  }
  return clean ? 0 : 1;
}
