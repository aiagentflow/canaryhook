/** One tool call as an agent's hook reported it, in canaryhook's terms. */
export interface ToolCall {
  /** Before the call runs, when it can still be denied, or after, with its output. */
  phase: "pre" | "post";
  /** Directories to look for the project in, nearest first. */
  dirs: (string | undefined)[];
  tool: string;
  /** Tool input, with the shell command at `command` and the path at `file_path`. */
  input: unknown;
  output: unknown;
  sessionId?: string;
}

export interface Wiring {
  /** The hook that checks a call before it runs. */
  pre: boolean;
  /** The hook that checks what a call returned. */
  post: boolean;
  /** The hook that reports past trips when a session starts. */
  session: boolean;
}

/**
 * Everything canaryhook needs to know about one coding agent: where its hooks
 * are configured, what its hook payloads look like, and how it expects to be
 * answered. The detection itself is the same for every agent.
 */
export interface Agent {
  name: string;
  label: string;
  /** Project-relative file the hooks are registered in. */
  configPath: string;
  /** Other config files that can switch the hooks off without holding them. */
  alsoProtect?: string[];
  hookCommand: string;
  sessionCommand: string;
  /** Whether the project already uses this agent, so init wires it by default. */
  detect(root: string): boolean;
  /** Throws SettingsError when the config file cannot be read safely. */
  wiring(root: string): Wiring;
  register(root: string): boolean;
  unregister(root: string): boolean;
  /** The hook payload as JSON, or null when it is not one this agent sends. */
  parse(payload: unknown): ToolCall | null;
  /** Stdout for a call that tripped nothing, or "" to print nothing. */
  pass(phase: ToolCall["phase"]): string;
  /** Stdout denying a call before it runs. */
  deny(reason: string): string;
  /** Stdout telling the agent a call that already ran read a decoy. */
  flag(reason: string): string;
  /** Stdout handing past trips to the agent at the start of a session. */
  report(context: string): string;
  /** A payload for `doctor` to send through the hook, asking about a read of `path`. */
  probe(root: string, path: string): unknown;
  /**
   * What the hook's stdout decided about a probe: "deny", "pass" for letting it
   * through, another decision by name, or null when the output is unreadable.
   */
  verdict(stdout: string): string | null;
}
