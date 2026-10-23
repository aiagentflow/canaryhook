import { readAlerts, readState } from "../state.js";

/** CI gate: non-zero when anything went looking for the decoys. */
export function verify(root: string, options: { json: boolean }): number {
  // Without a planted project there is nothing that could have tripped, and
  // reporting "no trips" would be a gate that can never fail.
  if (!readState(root)) {
    const message = "canaryhook is not initialized here, so there is nothing to verify. Run canaryhook init first.";
    if (options.json) process.stdout.write(`${JSON.stringify({ clean: false, initialized: false, trips: 0 })}\n`);
    else process.stderr.write(`${message}\n`);
    return 1;
  }
  const entries = readAlerts(root);
  const clean = entries.length === 0;
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ clean, initialized: true, trips: entries.length })}\n`);
  } else if (clean) {
    process.stdout.write("No canary trips.\n");
  } else {
    process.stderr.write(`${entries.length} canary trip(s) recorded. Run canaryhook alerts.\n`);
  }
  return clean ? 0 : 1;
}
