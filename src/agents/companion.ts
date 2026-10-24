// An AI party member: its own Claude session, a persona file, and one tool to
// declare an action. It decides; the narrator resolves.
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { type Character, armorClass, lifeState } from "../rules/character.ts";
import { VOICE_CUES } from "../speech/script.ts";
import { type AgentModel, type AgentSession, COMPANION_DEFAULT_MODEL, runAgentTurn } from "./runAgentTurn.ts";

const MAX_TOOL_TURNS = 4;
const TURN_TIMEOUT_MS = 2 * 60_000;

const SPEECH_CUES =
  "\n\n## Your voice\n\n" +
  `Your dialogue is spoken aloud. You may shape it with cues: ${VOICE_CUES}.\n` +
  "Use them sparingly, at most one or two per line.";

export type Declaration = { action: string; dialogue?: string };

export type CompanionAgent = ReturnType<typeof createCompanionAgent>;

export function createCompanionAgent(character: Character, persona: string) {
  const session: AgentSession = {};
  let model: AgentModel = COMPANION_DEFAULT_MODEL;
  let declaration: Declaration | null = null;
  const systemPrompt = persona + SPEECH_CUES;

  const toolServer = createSdkMcpServer({
    name: "companion",
    version: "1.0.0",
    tools: [
      tool("declare_action", "Declare your single action for this turn, with optional in-character dialogue.",
        { action: z.string(), dialogue: z.string().optional() },
        async (args) => {
          declaration = args;
          return { content: [{ type: "text" as const, text: "declared" }] };
        }),
    ],
  });

  const describeSheet = () =>
    `Your current sheet: lvl${character.level} ${character.characterClass}, hp ${character.hp}/${character.maxHp} ` +
    `(${lifeState(character)}), AC ${armorClass(character)}, weapon ${character.weapon}, spell slots ${character.spellSlots}.`;

  return {
    id: character.id,
    get model() { return model; },
    setModel(newModel: AgentModel) { model = newModel; },

    async declare(recentEvents: string): Promise<Declaration | null> {
      declaration = null;
      await runAgentTurn({
        prompt: `${recentEvents}\n\n${describeSheet()}\nDeclare your action now with the declare_action tool.`,
        systemPrompt,
        model,
        session,
        toolServer,
        maxToolTurns: MAX_TOOL_TURNS,
        timeoutMs: TURN_TIMEOUT_MS,
      });
      return declaration;
    },
  };
}
