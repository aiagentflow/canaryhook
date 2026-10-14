#!/usr/bin/env node
import { VERSION } from "./version.js";

const HELP = `canarykit ${VERSION}: honeyfiles and canary tokens for AI coding agents

Usage
  canarykit <command> [options]

Commands
  init        Plant decoy credential files and register the tool-call hooks
  status      Show whether decoys are planted and hooks are wired
  alerts      List recorded trips (--json for machine output)
  verify      Exit non-zero if a decoy was read or a canary string leaked
  clean       Remove planted decoys and unregister hooks

Options
  -h, --help     Show this help
  -v, --version  Show version
  --json         Machine-readable output where supported

Pre-release: 0.0.x reserves the name and ships the CLI surface only.
The commands above are not implemented yet. Follow along at
https://github.com/aiagentflow/canarykit
`;

const PLANNED = ["init", "status", "alerts", "verify", "clean"];

function main(argv: string[]): number {
  const args = argv.slice(2);
  const json = args.includes("--json");
  const command = args.find((a) => !a.startsWith("-"));

  if (args.includes("-v") || args.includes("--version")) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  if (!command || args.includes("-h") || args.includes("--help")) {
    process.stdout.write(HELP);
    return 0;
  }

  if (PLANNED.includes(command)) {
    const message = `canarykit ${command} is not implemented in ${VERSION}`;
    if (json) {
      process.stdout.write(
        `${JSON.stringify({ command, implemented: false, version: VERSION, message })}\n`,
      );
    } else {
      process.stderr.write(`${message}\nSee https://github.com/aiagentflow/canarykit\n`);
    }
    return 2;
  }

  process.stderr.write(`Unknown command: ${command}\n\n${HELP}`);
  return 1;
}

process.exitCode = main(process.argv);
