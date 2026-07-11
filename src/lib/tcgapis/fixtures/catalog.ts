// Bundled offline catalog: Pokemon Base Set (singles + sealed).
// productIds/groupIds are SYNTHETIC (stable, but not real TCGplayer ids) -
// offline mode is for demos and development only.
// MVP scope is Pokemon only - other games return post-MVP.
import type { ApiExpansion, ApiGame, ApiProduct } from "../types";

export const FIXTURE_GAMES: ApiGame[] = [
  { categoryId: 3, name: "Pokemon", displayName: "Pokemon" },
];

export const POKEMON_BASE_SET_GROUP = 604;

export const FIXTURE_EXPANSIONS: (ApiExpansion & { categoryId: number })[] = [
  {
    groupId: POKEMON_BASE_SET_GROUP,
    categoryId: 3,
    name: "Base Set",
    abbreviation: "BS",
    publishedOn: "1999-01-09",
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

function cleanName(name: string) {
  return name.replace(/[^a-zA-Z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Real Base Set card scans from the free pokemontcg.io image CDN, addressed
 * by collector number ("4/102" -> base1/4.png). Demo/dev convenience only -
 * live catalog syncs use the provider's own image URLs.
 */
function baseSetImage(number: string): string | null {
  const n = Number.parseInt(number, 10);
  return Number.isInteger(n) && n > 0 ? `https://images.pokemontcg.io/base1/${n}.png` : null;
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
      image: baseSetImage(number),
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

  return products;
}

export const FIXTURE_PRODUCTS = buildProducts();
