// Runs one Claude Agent SDK turn with game-safe defaults:
// - no built-in tools (no Bash, no file access), only the given in-process MCP server
// - no user or project settings, so the player's own Claude config never leaks in
// - "dontAsk": any tool that is not pre-approved is refused, never prompted
// Auth is the local Claude Code login; no API key is read or stored here.
import { query, type McpSdkServerConfigWithInstance, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";

// Pinned model versions. Opus 5.5 needs the Claude Code engine 2.1.280 or newer,
// which @anthropic-ai/claude-agent-sdk 0.3.296 bundles.
export const AGENT_MODELS = {
  haiku: { id: "claude-haiku-5-5", label: "Haiku 5.5" },
  sonnet: { id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
  opus: { id: "claude-opus-5-5", label: "Opus 5.5" },
} as const;
export type AgentModel = keyof typeof AGENT_MODELS;

export const NARRATOR_DEFAULT_MODEL: AgentModel = "opus";
export const COMPANION_DEFAULT_MODEL: AgentModel = "haiku";

export const isAgentModel = (value: unknown): value is AgentModel => typeof value === "string" && value in AGENT_MODELS;

export type AgentTurn = {
  prompt: string;
  systemPrompt: string;
  model: AgentModel;
  sessionId?: string; // resume this conversation; omit to start a new one
  toolServerName: string;
  toolServer: McpSdkServerConfigWithInstance;
  maxToolTurns: number;
  abortController?: AbortController;
  onMessage?: (message: SDKMessage) => void;
};

// Returns the session id, so the caller can resume the same conversation next turn.
export async function runAgentTurn(turn: AgentTurn): Promise<string | undefined> {
  const conversation = query({
    prompt: turn.prompt,
    options: {
      model: AGENT_MODELS[turn.model].id,
      systemPrompt: turn.systemPrompt,
      resume: turn.sessionId,
      maxTurns: turn.maxToolTurns,
      tools: [],
      settingSources: [],
      mcpServers: { [turn.toolServerName]: turn.toolServer },
      allowedTools: [`mcp__${turn.toolServerName}`],
      permissionMode: "dontAsk",
      abortController: turn.abortController,
    },
  });
  let sessionId = turn.sessionId;
  for await (const message of conversation) {
    if (message.type === "system" && message.subtype === "init") sessionId = message.session_id;
    turn.onMessage?.(message);
  }
  return sessionId;
}
