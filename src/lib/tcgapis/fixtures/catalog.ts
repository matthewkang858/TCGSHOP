// Bundled offline catalog: Pokemon Base Set + MTG Murders at Karlov Manor.
// productIds/groupIds are SYNTHETIC (stable, but not real TCGplayer ids) -
// offline mode is for demos and development only.
import type { ApiExpansion, ApiGame, ApiProduct } from "../types";

export const FIXTURE_GAMES: ApiGame[] = [
  { categoryId: 1, name: "Magic", displayName: "Magic: The Gathering" },
  { categoryId: 2, name: "YuGiOh", displayName: "Yu-Gi-Oh!" },
  { categoryId: 3, name: "Pokemon", displayName: "Pokemon" },
];

export const POKEMON_BASE_SET_GROUP = 604;
export const MTG_MKM_GROUP = 23874;

export const FIXTURE_EXPANSIONS: (ApiExpansion & { categoryId: number })[] = [
  {
    groupId: POKEMON_BASE_SET_GROUP,
    categoryId: 3,
    name: "Base Set",
    abbreviation: "BS",
    publishedOn: "1999-01-09",
  },
  {
    groupId: MTG_MKM_GROUP,
    categoryId: 1,
    name: "Murders at Karlov Manor",
    abbreviation: "MKM",
    publishedOn: "2024-02-09",
  },
];

// [collector number, name, rarity]
type SingleTuple = [string, string, string];

const BASE_SET_SINGLES: SingleTuple[] = [
  ["1/102", "Alakazam", "Rare Holo"],
  ["2/102", "Blastoise", "Rare Holo"],
  ["3/102", "Chansey", "Rare Holo"],
  ["4/102", "Charizard", "Rare Holo"],
  ["5/102", "Clefairy", "Rare Holo"],
  ["6/102", "Gyarados", "Rare Holo"],
  ["7/102", "Hitmonchan", "Rare Holo"],
  ["8/102", "Machamp", "Rare Holo"],
  ["9/102", "Magneton", "Rare Holo"],
  ["10/102", "Mewtwo", "Rare Holo"],
  ["11/102", "Nidoking", "Rare Holo"],
  ["12/102", "Ninetales", "Rare Holo"],
  ["13/102", "Poliwrath", "Rare Holo"],
  ["14/102", "Raichu", "Rare Holo"],
  ["15/102", "Venusaur", "Rare Holo"],
  ["16/102", "Zapdos", "Rare Holo"],
  ["17/102", "Beedrill", "Rare"],
  ["18/102", "Dragonair", "Rare"],
  ["19/102", "Dugtrio", "Rare"],
  ["20/102", "Electabuzz", "Rare"],
  ["21/102", "Electrode", "Rare"],
  ["22/102", "Pidgeotto", "Rare"],
  ["23/102", "Arcanine", "Uncommon"],
  ["24/102", "Charmeleon", "Uncommon"],
  ["25/102", "Dewgong", "Uncommon"],
  ["26/102", "Dratini", "Uncommon"],
  ["27/102", "Farfetch'd", "Uncommon"],
  ["28/102", "Growlithe", "Uncommon"],
  ["29/102", "Haunter", "Uncommon"],
  ["30/102", "Ivysaur", "Uncommon"],
  ["31/102", "Jynx", "Uncommon"],
  ["32/102", "Kadabra", "Uncommon"],
  ["33/102", "Kakuna", "Uncommon"],
  ["34/102", "Machoke", "Uncommon"],
  ["35/102", "Magikarp", "Uncommon"],
  ["36/102", "Magmar", "Uncommon"],
  ["37/102", "Nidorino", "Uncommon"],
  ["38/102", "Poliwhirl", "Uncommon"],
  ["39/102", "Porygon", "Uncommon"],
  ["40/102", "Raticate", "Uncommon"],
  ["41/102", "Seel", "Uncommon"],
  ["42/102", "Wartortle", "Uncommon"],
  ["43/102", "Abra", "Common"],
  ["44/102", "Bulbasaur", "Common"],
  ["45/102", "Caterpie", "Common"],
  ["46/102", "Charmander", "Common"],
  ["47/102", "Diglett", "Common"],
  ["48/102", "Doduo", "Common"],
  ["49/102", "Drowzee", "Common"],
  ["50/102", "Gastly", "Common"],
  ["51/102", "Koffing", "Common"],
  ["52/102", "Machop", "Common"],
  ["53/102", "Magnemite", "Common"],
  ["54/102", "Metapod", "Common"],
  ["55/102", "Nidoran M", "Common"],
  ["56/102", "Onix", "Common"],
  ["57/102", "Pidgey", "Common"],
  ["58/102", "Pikachu", "Common"],
  ["59/102", "Poliwag", "Common"],
  ["60/102", "Ponyta", "Common"],
  ["61/102", "Rattata", "Common"],
  ["62/102", "Sandshrew", "Common"],
  ["63/102", "Squirtle", "Common"],
  ["64/102", "Starmie", "Common"],
  ["65/102", "Staryu", "Common"],
  ["66/102", "Tangela", "Common"],
  ["67/102", "Voltorb", "Common"],
  ["68/102", "Vulpix", "Common"],
  ["69/102", "Weedle", "Common"],
  ["70/102", "Clefairy Doll", "Rare"],
  ["71/102", "Computer Search", "Rare"],
  ["72/102", "Devolution Spray", "Rare"],
  ["73/102", "Impostor Professor Oak", "Rare"],
  ["74/102", "Item Finder", "Rare"],
  ["75/102", "Lass", "Rare"],
  ["76/102", "Pokemon Breeder", "Rare"],
  ["77/102", "Pokemon Trader", "Rare"],
  ["78/102", "Scoop Up", "Rare"],
  ["79/102", "Super Energy Removal", "Rare"],
  ["80/102", "Defender", "Uncommon"],
  ["81/102", "Energy Retrieval", "Uncommon"],
  ["82/102", "Full Heal", "Uncommon"],
  ["83/102", "Maintenance", "Uncommon"],
  ["84/102", "PlusPower", "Uncommon"],
  ["85/102", "Pokemon Center", "Uncommon"],
  ["86/102", "Pokemon Flute", "Uncommon"],
  ["87/102", "Pokedex", "Uncommon"],
  ["88/102", "Professor Oak", "Uncommon"],
  ["89/102", "Revive", "Uncommon"],
  ["90/102", "Super Potion", "Uncommon"],
  ["91/102", "Bill", "Common"],
  ["92/102", "Energy Removal", "Common"],
  ["93/102", "Gust of Wind", "Common"],
  ["94/102", "Potion", "Common"],
  ["95/102", "Switch", "Common"],
  ["96/102", "Double Colorless Energy", "Uncommon"],
  ["97/102", "Fighting Energy", "Common"],
  ["98/102", "Fire Energy", "Common"],
  ["99/102", "Grass Energy", "Common"],
  ["100/102", "Lightning Energy", "Common"],
  ["101/102", "Psychic Energy", "Common"],
  ["102/102", "Water Energy", "Common"],
];

// name only - sealed rows have no number/rarity
const BASE_SET_SEALED: string[] = [
  "Base Set Booster Box",
  "Base Set Booster Pack",
  "Base Set Blackout Theme Deck",
  "Base Set Brushfire Theme Deck",
  "Base Set Overgrowth Theme Deck",
  "Base Set Zap Theme Deck",
  "Base Set 2-Player Starter Set",
  "Base Set Booster Display Case",
];

const MKM_SINGLES: SingleTuple[] = [
  ["1", "Anzrag, the Quake-Mole", "Mythic"],
  ["2", "Aurelia, the Law Above", "Mythic"],
  ["3", "Massacre Girl, Known Killer", "Mythic"],
  ["4", "Vein Ripper", "Mythic"],
  ["5", "Kaya, Spirits' Justice", "Mythic"],
  ["6", "Rakdos, Patron of Chaos", "Mythic"],
  ["7", "Niv-Mizzet, Guildpact", "Mythic"],
  ["8", "Voja, Jaws of the Conclave", "Mythic"],
  ["9", "Etrata, Deadly Fugitive", "Mythic"],
  ["10", "Yarus, Roar of the Old Gods", "Mythic"],
  ["11", "Delney, Streetwise Lookout", "Rare"],
  ["12", "Leyline of the Guildpact", "Rare"],
  ["13", "Archdruid's Charm", "Rare"],
  ["14", "Judith, Carnage Connoisseur", "Rare"],
  ["15", "Teysa, Opulent Oligarch", "Rare"],
  ["16", "Tomik, Wielder of Law", "Rare"],
  ["17", "Trostani, Three Whispers", "Rare"],
  ["18", "Izoni, Center of the Web", "Rare"],
  ["19", "Lazav, Wearer of Faces", "Rare"],
  ["20", "Kellan, Inquisitive Prodigy", "Rare"],
  ["21", "Assemble the Players", "Rare"],
  ["22", "Case of the Gateway Express", "Rare"],
  ["23", "Doppelgang", "Rare"],
  ["24", "Fanatical Strength", "Common"],
  ["25", "Deduce", "Common"],
  ["26", "Forensic Gadgeteer", "Rare"],
  ["27", "Undercover Crocodelf", "Uncommon"],
  ["28", "Curious Cadaver", "Uncommon"],
  ["29", "Gleaming Geardrake", "Uncommon"],
  ["30", "Evidence Examiner", "Uncommon"],
];

// combinatorial filler to reach a realistic set size (~100 singles)
const MKM_ADJ = [
  "Shadowed",
  "Gilded",
  "Relentless",
  "Cryptic",
  "Vigilant",
  "Wrongful",
  "Midnight",
  "Guildless",
  "Ostentatious",
  "Meticulous",
];
const MKM_NOUN = [
  "Informant",
  "Barrister",
  "Prowler",
  "Constable",
  "Illusionist",
  "Enforcer",
  "Archivist",
];
const MKM_RARITY_CYCLE = ["Common", "Common", "Common", "Uncommon", "Uncommon", "Rare"];

function mkmFiller(): SingleTuple[] {
  const out: SingleTuple[] = [];
  let n = 31;
  for (const adj of MKM_ADJ) {
    for (const noun of MKM_NOUN) {
      out.push([String(n), `${adj} ${noun}`, MKM_RARITY_CYCLE[n % MKM_RARITY_CYCLE.length]]);
      n++;
    }
  }
  return out;
}

const MKM_SEALED: string[] = [
  "Murders at Karlov Manor Play Booster Box",
  "Murders at Karlov Manor Play Booster Pack",
  "Murders at Karlov Manor Collector Booster Display",
  "Murders at Karlov Manor Collector Booster Pack",
  "Murders at Karlov Manor Bundle",
  "Murders at Karlov Manor Prerelease Pack",
  "Murders at Karlov Manor Commander Deck - Deadly Disguise",
  "Murders at Karlov Manor Commander Deck - Blame Game",
  "Murders at Karlov Manor Commander Deck - Revenant Recon",
  "Murders at Karlov Manor Commander Deck - Deep Clue Sea",
];

function cleanName(name: string) {
  return name.replace(/[^a-zA-Z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

function buildProducts(): (ApiProduct & { groupId: number })[] {
  const products: (ApiProduct & { groupId: number })[] = [];

  BASE_SET_SINGLES.forEach(([number, name, rarity], i) => {
    products.push({
      productId: 42300 + i + 1,
      groupId: POKEMON_BASE_SET_GROUP,
      name,
      cleanName: cleanName(name),
      number,
      rarity,
      image: null,
    });
  });
  BASE_SET_SEALED.forEach((name, i) => {
    products.push({
      productId: 42480 + i + 1,
      groupId: POKEMON_BASE_SET_GROUP,
      name,
      cleanName: cleanName(name),
      number: null,
      rarity: null,
      image: null,
    });
  });

  const mkmAll = [...MKM_SINGLES, ...mkmFiller()];
  mkmAll.forEach(([number, name, rarity], i) => {
    products.push({
      productId: 530000 + i + 1,
      groupId: MTG_MKM_GROUP,
      name,
      cleanName: cleanName(name),
      number,
      rarity,
      image: null,
    });
  });
  MKM_SEALED.forEach((name, i) => {
    products.push({
      productId: 530500 + i + 1,
      groupId: MTG_MKM_GROUP,
      name,
      cleanName: cleanName(name),
      number: null,
      rarity: null,
      image: null,
    });
  });

  return products;
}

export const FIXTURE_PRODUCTS = buildProducts();
