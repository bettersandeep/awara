// An AI party member: its own Claude session, a persona file, and one tool to
// declare an action. It decides; the narrator resolves.
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { type Character, armorClass, lifeState } from "../rules/character.ts";
import { type AgentModel, runAgentTurn } from "./runAgentTurn.ts";

const MAX_TOOL_TURNS = 4;

export type Declaration = { action: string; dialogue?: string };

export type CompanionAgent = ReturnType<typeof createCompanionAgent>;

export function createCompanionAgent(character: Character, persona: string) {
  let sessionId: string | undefined;
  let model: AgentModel = "haiku";
  let declaration: Declaration | null = null;

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
      sessionId = await runAgentTurn({
        prompt: `${recentEvents}\n\n${describeSheet()}\nDeclare your action now with the declare_action tool.`,
        systemPrompt: persona,
        model,
        sessionId,
        toolServerName: "companion",
        toolServer,
        maxToolTurns: MAX_TOOL_TURNS,
      });
      return declaration;
    },
  };
}
