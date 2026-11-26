/**
 * Illustrated agent avatars, built from parts (skin, hair, shirt, expression,
 * accessory). The same seed always gives the same face, so an agent keeps its
 * look everywhere without storing an image.
 *
 * Coordinates are in a 48×48 viewBox: face centered at (24, 24), radius 10.
 */

export const HAIR_STYLES = {
  short: "M14 24c0-7 4-11 10-11s10 4 10 11c-2-3-5-5-10-5s-8 2-10 5z",
  long: "M13 25c0-8 4-13 11-13s11 5 11 13v12c-2 0-4-2-4-5v-7c-2-3-4-4-7-4s-5 1-7 4v7c0 3-2 5-4 5z",
  bun: "M14 24c0-7 4-11 10-11s10 4 10 11c-2-3-5-5-10-5s-8 2-10 5zM20 11a4 4 0 1 0 8 0a4 4 0 1 0-8 0z",
  curly:
    "M13 24a4 4 0 0 1 3-7a4 4 0 0 1 5-4a4 4 0 0 1 6 0a4 4 0 0 1 5 4a4 4 0 0 1 3 7c-2-3-6-5-11-5s-9 2-11 5z",
  cap: "M13 21c1-5 5-8 11-8s10 3 11 8zM33 19h6v2.5h-6z",
  buzz: "M14.5 21c1-4 5-7 9.5-7s8.5 3 9.5 7c-3-1.5-6-2-9.5-2s-6.5.5-9.5 2z",
} as const;

export const MOUTHS = {
  smile: "M21 29.5c2 1.6 4 1.6 6 0",
  grin: "M20.5 29c2 2.6 5 2.6 7 0",
  calm: "M21.5 30h5",
  surprised: "M23 30a1 1 0 0 0 2 0",
} as const;

export const ACCESSORIES = {
  none: "",
  glasses: "M16.5 25a3 3 0 1 0 6 0a3 3 0 1 0-6 0M25.5 25a3 3 0 1 0 6 0a3 3 0 1 0-6 0M22.5 25h3",
  headphones: "M13 26a11 11 0 0 1 22 0M12.5 24v6M35.5 24v6",
  earring: "M34.5 28.5v2.5",
} as const;

export type HairStyle = keyof typeof HAIR_STYLES;
export type Mouth = keyof typeof MOUTHS;
export type Accessory = keyof typeof ACCESSORIES;

export interface AvatarSpec {
  background: string;
  skin: string;
  hair: HairStyle;
  hairColor: string;
  shirt: string;
  mouth: Mouth;
  accessory: Accessory;
  accessoryColor: string;
}

const BACKGROUNDS = [
  "#E7E3FF",
  "#FFE7CC",
  "#D6F3E6",
  "#FDE2EF",
  "#DCEBFF",
  "#E0F2FE",
  "#ECFCCB",
  "#FFEDD5",
  "#FEF3C7",
];
const SKINS = [
  "#F5D3B8",
  "#F2C9A5",
  "#E8B892",
  "#D9A27A",
  "#C98A5E",
  "#B87A4B",
  "#8D5A3B",
  "#6E4630",
];
const HAIR_COLORS = ["#1E1410", "#3B2416", "#6B4A2E", "#B5542B", "#D9A441", "#120C0A", "#4B4B57"];
const SHIRTS = [
  "#5B4CF0",
  "#F08C3C",
  "#0E8A6A",
  "#D6407F",
  "#1D6FD6",
  "#0284C7",
  "#65A30D",
  "#C2410C",
];
const ACCESSORY_COLORS = ["#1B1D2A", "#33374A", "#E0A400", "#5B4CF0"];

/** 32-bit FNV-1a: small, fast and stable across runtimes. */
export function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function pick<T>(list: readonly T[], hash: number, salt: number): T {
  const mixed = Math.imul(hash ^ (salt * 0x9e3779b1), 0x85ebca6b) >>> 0;
  return list[mixed % list.length] as T;
}

export function generateAvatar(seed: string): AvatarSpec {
  const h = hashSeed(seed);
  const accessory = pick(Object.keys(ACCESSORIES) as Accessory[], h, 6);
  return {
    background: pick(BACKGROUNDS, h, 1),
    skin: pick(SKINS, h, 2),
    hair: pick(Object.keys(HAIR_STYLES) as HairStyle[], h, 3),
    hairColor: pick(HAIR_COLORS, h, 4),
    shirt: pick(SHIRTS, h, 5),
    mouth: pick(Object.keys(MOUTHS) as Mouth[], h, 7),
    accessory,
    accessoryColor: pick(ACCESSORY_COLORS, h, 8),
  };
}
