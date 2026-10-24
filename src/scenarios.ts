// Opening scenarios, borrowed from the classics. Each prompt sets the place,
// terrain and hook; the narrator writes the plot from there.
import { type Rng, pickRandom } from "./rules/dice.ts";

type Scenario = { title: string; pitch: string; prompt: string };

export const SCENARIOS: Record<string, Scenario> = {
  caravan: {
    title: "The Missing Caravan",
    pitch: "A classic: a worn tavern, a ruined merchant, a road gone silent.",
    prompt: "Open in a worn roadside tavern. A ruined merchant begs the party to find his caravan, which vanished on the north road. Warm firelight, wood floors, locals with rumors.",
  },
  tempest: {
    title: "The Wreck of the Meridian",
    pitch: "Shipwrecked in a storm on an isle full of strange music. (The Tempest)",
    prompt: "Open on a beach strewn with wreckage after a magical storm destroys the party's ship. Sand and shallow water, broken timbers as props. Strange, beautiful music drifts from the island's interior. Someone summoned that storm, and the island is not uninhabited.",
  },
  heath: {
    title: "Voices on the Heath",
    pitch: "Three crones on a stormswept moor speak a prophecy with a price. (Macbeth)",
    prompt: "Open on a blasted heath at dusk, swamp and dirt terrain, dead trees. Three crones around a fire hail the party with a double-edged prophecy: glory promised, betrayal implied. The prophecy names a nearby keep. Ambition and dread in equal measure.",
  },
  meadhall: {
    title: "The Hall of Hrothgar",
    pitch: "A great mead hall celebrates by day. Something comes at night. (Beowulf)",
    prompt: "Open inside a great wooden mead hall at a feast in the party's honor. Wood floors, torches, a generous lord. The hall's warriors do not sleep here anymore: for twelve nights something has come in the dark and taken men. Tonight the party sleeps in the hall.",
  },
  battlements: {
    title: "The Unquiet King",
    pitch: "A royal ghost walks the castle walls at midnight demanding justice. (Hamlet)",
    prompt: "Open on stone castle battlements at midnight, dark lighting with sparse torches. A ghost in royal armor appears to the party and charges them: expose the murderer who now wears the crown. The court below is full of smiling suspects.",
  },
  feywood: {
    title: "The Midsummer Wood",
    pitch: "A forest that rearranges itself, ruled by quarreling fey. (A Midsummer Night's Dream)",
    prompt: "Open in a moonlit forest, grass and trees, where paths move when unwatched. Two lost nobles beg for help escaping. The fey court is quarreling and mortals are their playthings tonight; mischief first, malice if provoked.",
  },
  pilgrims: {
    title: "The Pilgrims' Road",
    pitch: "Escort nine pilgrims to a shrine. Every one of them hides something. (Canterbury Tales)",
    prompt: "Open on a cobbled road at dawn with a band of pilgrims the party is escorting to a distant shrine. Each pilgrim has a story and at least one is not what they claim. The first night's inn approaches, and something followed them from the city.",
  },
  bargain: {
    title: "The Scholar's Bargain",
    pitch: "A scholar sold his soul. Collection is tonight. (Faust)",
    prompt: "Open in a scholar's candlelit study, wood and marble, cluttered with forbidden books. The trembling scholar admits he bargained with a devil for knowledge, and the contract comes due at midnight. Find a flaw in the contract, hide him, or fight what comes.",
  },
  homeward: {
    title: "The Long Way Home",
    pitch: "Discharged soldiers, a hostile shore, and home very far away. (The Odyssey)",
    prompt: "Open on a rocky foreign shore where the party has washed up, their transport gone. Home lies far across dangerous country. A local herder warns them: the lord of this coast blinds trespassers, and the quickest road is through his lands.",
  },
  count: {
    title: "Dinner with the Count",
    pitch: "An invitation to a remote castle. The host is far too gracious. (Dracula)",
    prompt: "Open at the gates of a remote mountain castle at dusk, stone and dark walls. The party carries a sealed invitation for dinner with the Count, who pays generously for escort work. The village below shuttered its windows when they passed. Dinner is served; the doors lock.",
  },
};

// An unknown or empty key means "surprise me".
export function chooseScenario(rng: Rng, key: unknown): Scenario {
  if (typeof key === "string" && Object.hasOwn(SCENARIOS, key)) return SCENARIOS[key];
  return pickRandom(rng, Object.values(SCENARIOS));
}
