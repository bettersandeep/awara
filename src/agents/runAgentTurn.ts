// Runs one Claude Agent SDK turn with game-safe defaults:
// - no built-in tools (no Bash, no file access), only the given in-process MCP server
// - no user or project settings, so the player's own Claude config never leaks in
// - "dontAsk": any tool that is not pre-approved is refused, never prompted
// Auth is the local Claude Code login; no API key is read or stored here.
import { query, type McpSdkServerConfigWithInstance, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";

export const AGENT_MODELS = ["haiku", "sonnet", "opus"] as const;
export type AgentModel = (typeof AGENT_MODELS)[number];

export const isAgentModel = (value: unknown): value is AgentModel => AGENT_MODELS.includes(value as AgentModel);

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
      model: turn.model,
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
