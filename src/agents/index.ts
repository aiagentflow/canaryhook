import { claude } from "./claude.js";
import type { Agent } from "./types.js";

export type { Agent, ToolCall, Wiring } from "./types.js";

/** Every agent canaryhook can wire, in the order they are reported. */
export const AGENTS: Agent[] = [claude];

export function agentNamed(name: string): Agent | undefined {
  return AGENTS.find((agent) => agent.name === name);
}

export { claude };
