import { claude } from "./claude.js";
import { codex } from "./codex.js";
import { cursor } from "./cursor.js";
import type { State } from "../state.js";
import type { Agent } from "./types.js";

export type { Agent, ToolCall, Wiring } from "./types.js";

/** Every agent canaryhook can wire, in the order they are reported. */
export const AGENTS: Agent[] = [claude, cursor, codex];

export function agentNamed(name: string): Agent | undefined {
  return AGENTS.find((agent) => agent.name === name);
}

/** The agents named in a comma-separated list, or the first unknown name. */
export function parseAgents(list: string): { agents: Agent[] } | { unknown: string } {
  const agents: Agent[] = [];
  for (const name of list.split(",").map((n) => n.trim()).filter((n) => n.length > 0)) {
    const agent = agentNamed(name);
    if (!agent) return { unknown: name };
    if (!agents.includes(agent)) agents.push(agent);
  }
  return { agents };
}

/** The agents init wired for this project. */
export function wiredAgents(state: State): Agent[] {
  return (state.agents ?? [claude.name]).flatMap((name) => agentNamed(name) ?? []);
}

export { claude, codex, cursor };
