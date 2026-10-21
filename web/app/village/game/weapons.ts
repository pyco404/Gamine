import type * as Phaser from "phaser";

/**
 * What each agent carries through the village: one weapon, fixed by its id so
 * it is the same on every visit. Presentation only, like the character it goes
 * with - it never reaches a match, whose result the decision tables alone
 * decide.
 *
 * The art is drawn for Gamine (public/fixtures/weapons), one pixel per
 * world pixel like the bodies, pointing up. `grip` is the row the hand holds,
 * and `h` the picture's height, so the hand holds it where a hand would.
 */
export const WEAPONS = {
  sword: { h: 23, grip: 17 },
  axe: { h: 23, grip: 18 },
  spear: { h: 32, grip: 22 },
  hammer: { h: 23, grip: 18 },
  mace: { h: 21, grip: 16 },
  dagger: { h: 14, grip: 10 },
  bow: { h: 26, grip: 13 },
  staff: { h: 30, grip: 21 },
  club: { h: 19, grip: 15 },
  trident: { h: 30, grip: 21 },
} as const;

export type WeaponName = keyof typeof WEAPONS;
const NAMES = Object.keys(WEAPONS) as WeaponName[];

export const weaponTexture = (name: WeaponName) => `weapon-${name}`;

/** FNV-1a: a stable spread of ids over the weapons. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The weapon an agent carries. Salted, so it does not follow the knight it would otherwise be drawn as. */
export const weaponOf = (agentId: string): WeaponName => NAMES[hash(`${agentId}#weapon`) % NAMES.length]!;

/** Queue every weapon's picture. The loader's path must be the site's root. */
export function loadWeapons(scene: Phaser.Scene): void {
  for (const name of NAMES) if (!scene.textures.exists(weaponTexture(name))) scene.load.image(weaponTexture(name), `/fixtures/weapons/${name}.png`);
}
