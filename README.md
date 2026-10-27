# Awara

A pixel-art tabletop adventure that uses the d20 SRD 3.5 rules.
You play one character.
Claude agents play your three companions, and one more Claude agent is the narrator.

Repository: https://github.com/bettersandeep/awara

![A silent 18-second preview of play: the map opens, the hero walks, a magic missile flies, and the board switches to the duotone and palette looks](docs/video/preview.gif)

New players: watch the full game with sound (79 seconds) here:

https://github.com/user-attachments/assets/cf7b27f2-440a-4625-8bb6-4ffec92930e0

Then read the [play guide](docs/PLAY_GUIDE.md), with screenshots and step-by-step instructions.

## The board

![The same hall in four board looks: smooth, dithered light, duotone and palette](docs/screenshots/07-board-looks.png)

The board is drawn with WebGL, and everything on it moves:

- **Walking:** characters go tile by tile around walls, with a small hop per tile or one eased glide (the player chooses).
- **Combat:** the attacker lunges, the target flinches or dodges, damage numbers float up, arrows and magic missiles fly, healing sparkles, and the fallen lie down.
- **The story:** the narrator can give each story beat a motion (a lunge, a cower, a cheer, a fall), and the board plays it when the voice reaches that beat.
  A character who speaks bobs while the line plays.
- **Looks:** smooth light, or three ordered-dither looks: dithered light, duotone and a 16-colour palette.
  The simpler canvas board is still there as a fifth choice, and the board falls back to it in a browser without WebGL.

The two lists in the side panel pick the look and the walk, and the game continues when you change them.
A URL can also choose them: `http://localhost:8420/?look=duotone&motion=glide`.

## How it works

- **Rules engine** (`src/rules`): real d20 SRD dice, classes, attacks, saves and spells.
  The agents never roll dice or track hit points.
- **World** (`src/scene`): the world is data, not pixels.
  The narrator changes it only with validated scene operations, so a map looks the same every time the party returns to it.
- **Agents** (`src/agents`): the narrator and the companions are Claude Agent SDK sessions.
  They can use only their game tools: no shell, no file access, and no user settings.
  By default Claude Opus 5.5 narrates and Claude Haiku 5.5 plays the companions.
  Each seat can switch between Haiku 5.5, Sonnet 5.5 and Opus 5.5 during play.
- **Personas** (`personas`): one Markdown file per companion, plus the narrator prompt.
- **Browser client** (`public`): the WebGL board (`js/boardWebgl.js`, PixiJS) draws the map from the tile catalog and animates it.
  The rules send attack, spell, damage, heal and rest events, and the story lines carry the narrator's motions (`js/storyMotions.js` plays them with the voice).
  The dither looks are one shader (`js/boardDither.js`); `js/board.js` is the canvas board.
  The seats around the board show the party, and the side panel shows the story.
- **Speech** (`src/speech`): Kokoro-82M reads the story aloud, locally on the CPU.
  The text is split at punctuation, so commas, full stops and ellipses are real pauses, and long narration is never cut.
  NPC lines are spoken in their own voices, and the narrator can add voice cues such as `(pause)`, `(whisper)` and `*emphasis*`.
  The story log highlights each phrase while it is spoken and shows the cues, the speakers and the pronunciations.

## Requirements

A 67-second video shows the whole setup, with sound:

https://github.com/user-attachments/assets/00887afb-d882-412f-b845-4d0a941ddd16

- Node.js 24 or later (it runs TypeScript directly).
- Claude Code, logged in on this machine (`claude auth login`).
  The agents use that login, so no API key is necessary.
  Opus 5.5 needs `@anthropic-ai/claude-agent-sdk` 0.3.296 or newer, which `npm install` provides.

## Run

```sh
git clone https://github.com/bettersandeep/awara.git
cd awara
npm install
npm start
```

Open http://localhost:8420.
The first start downloads the Kokoro speech model, about 90 MB.

## Develop

```sh
npm run check   # type check and tests
```

To add a companion, write `personas/<id>.md` and add one entry to `COMPANION_POOL` in `src/party.ts`.
To add an opening, add one entry to `SCENARIOS` in `src/scenarios.ts`.

## Credits

- Tiles and sprites: [Dungeon Crawl Stone Soup tiles](https://opengameart.org/content/dungeon-crawl-32x32-tiles), CC0.
  `scripts/curate-tiles.ts` copies the chosen tiles and writes `public/catalog.json`.
- Rules: the [d20 System Reference Document](https://www.d20srd.org/), Open Game License.
- Speech: [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M), Apache 2.0.
- Board renderer: [PixiJS](https://pixijs.com/) 8, MIT.
  The dither looks follow the ordered-dither style of [shirokujaku](https://github.com/bettersandeep/shirokujaku).
