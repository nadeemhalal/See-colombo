import { ACC, HAIR, HEAD, LOWER, TOP } from './models';

/** How one person looks and moves. Colours are sRGB hex; styles index the option groups in models.ts. */
export interface Look {
  lower: number; top: number; hair: number; head: number; acc: number;
  skin: number; topC: number; lowerC: number; hairC: number; accent: number; shoe: number;
  /** 0 male figure, 1 female */
  fem: number;
  /** forward lean of the upper body (radians), older people */
  stoop: number;
  /** standing height in metres, and width factor */
  height: number; girth: number;
  /** walking speed factor */
  speed: number;
}

type R = () => number;
const pick = <T>(r: R, a: readonly T[]) => a[Math.floor(r() * a.length)];
const chance = (r: R, p: number) => r() < p;

const SKIN_LK = [0x5c3b27, 0x6e4630, 0x7c5136, 0x8a5a3c, 0x9a6a48, 0x6a4430, 0x4e3222];
const SKIN_VISITOR = [0xf1d3bd, 0xe8bf9f, 0xd9a983, 0xf3d9c4, 0xe2b48c, 0xc68f63, 0x8d5a3b, 0xeac7a6];
const HAIR_DARK = [0x15110e, 0x1d1712, 0x241a12];
const HAIR_VISITOR = [0x15110e, 0x5a3b22, 0x8a6a3a, 0xc9a35f, 0xe0c487, 0x8a3c1e, 0x9a9a9a, 0x3a2a1c];
const HAIR_GREY = [0xb8b4ae, 0xd9d6d0, 0x8c8780, 0xa29d96];
const SHIRT_LIGHT = [0xf2f0ea, 0xdfe8f2, 0x9cc3e4, 0xf0d9de, 0xd9d2c0, 0xe8e3d6, 0xc9d8c4];
const TROUSER_DARK = [0x2f3542, 0x23262c, 0x4b4f57, 0x1f2a44, 0x3a3f4a];
const KHAKI = [0x8a7a5c, 0xa8966e, 0x6b6a4a, 0xb8a888];
const JEANS = [0x2c3e5c, 0x3b5578, 0x5a7598, 0x1e2a3e, 0x23262c, 0x7d93b0];
const TEE = [0xf4f4f0, 0x1f1f22, 0x7a1f2b, 0x2f6d4a, 0xe0b44a, 0x5a7bd6, 0xe07a3a, 0x8e3a8e, 0x4a6a8a, 0xd65a5a, 0x2fa3a3, 0xb6c94a];
const GENZ = [0x1a1a1c, 0xf6f6f2, 0x8fa6c7, 0xd8c8b0, 0x5d6b4e, 0xe7a4b8, 0x3d3d6b, 0xc94f3d, 0xa3b18a, 0xf2d16b];
const SARONG = [0x2c4a7a, 0x3b5e3a, 0x6b3a2a, 0x4a3b6b, 0x7a6a3a, 0x24456a, 0x5a2a4a, 0x2a2a2a];
const SAREE = [0xc8326a, 0x2f6d4a, 0x7a1f2b, 0x3a5ab0, 0xe0a030, 0x8e3a8e, 0x1b6b6b, 0xd65a5a, 0xe86a1f, 0x2a8a6a, 0xf0c8d8, 0x6a2a8a];
const BLOUSE = [0xf2f0ea, 0xe0b44a, 0x7a1f2b, 0x2f6d4a, 0x1f1f22, 0xc8326a, 0x3a5ab0];
const HIJAB = [0x1f1f22, 0x2a2a4a, 0x6b2a3a, 0x3b5a4a, 0xc9b79c, 0x8a6a8a, 0xe8e0d0, 0x4a6a8a];
const BAG = [0x1f1f22, 0x6b4a2a, 0x2a4a7a, 0x8a2a2a, 0x3a5a3a, 0xc0a070, 0xd94f8a, 0xe0c040, 0x9a9a9a];
const UMBRELLA = [0x1f1f22, 0x23315c, 0x8a1f3a, 0x2f6d4a, 0x6a3a8a, 0xe0603a, 0x2a6aa0];
const SUNHAT = [0xe6d7b0, 0xd8c9a0, 0xf2efe6, 0xc9b48a];
const CAP = [0x1f1f22, 0xf2f2f0, 0x2a4a8a, 0xc0392b, 0x2f6d4a, 0xd8c8b0];
const SANDALS = [0x3a2a1e, 0x5a3b22, 0x2a211b, 0x7a5a3a];
const TRAINERS = [0xf4f4f2, 0xe8e8e8, 0x1f1f22, 0xd8d4cc];
const OFFICE_SHOES = [0x1a1614, 0x3a2618, 0x241c18];

const base = (r: R, fem: boolean): Look => ({
  lower: LOWER.trousers, top: TOP.tshirt, hair: fem ? HAIR.long : HAIR.short, head: HEAD.none, acc: 0,
  skin: pick(r, SKIN_LK), topC: pick(r, TEE), lowerC: pick(r, TROUSER_DARK), hairC: pick(r, HAIR_DARK),
  accent: pick(r, BAG), shoe: pick(r, SANDALS),
  fem: fem ? 1 : 0, stoop: 0,
  height: fem ? 1.5 + r() * 0.14 : 1.6 + r() * 0.16, girth: 0.92 + r() * 0.2, speed: 1,
});
/** an umbrella against the sun or rain: very Colombo */
const umbrella = (r: R, l: Look, p: number) => { if (chance(r, p)) { l.acc |= ACC.umbrella; l.accent = pick(r, UMBRELLA); } };

const officeMan = (r: R): Look => {
  const l = base(r, false);
  l.top = TOP.shirt; l.topC = pick(r, SHIRT_LIGHT); l.lowerC = pick(r, [...TROUSER_DARK, ...KHAKI.slice(0, 1)]);
  l.hair = pick(r, [HAIR.short, HAIR.short, HAIR.buzz]); l.shoe = pick(r, OFFICE_SHOES);
  if (chance(r, 0.35)) { l.acc |= ACC.shoulderBag; l.accent = pick(r, [0x1f1f22, 0x3a2618, 0x2a2a3a]); }
  if (chance(r, 0.2)) l.acc |= ACC.phone; else umbrella(r, l, 0.1);
  return l;
};
const casualMan = (r: R): Look => {
  const l = base(r, false);
  l.top = pick(r, [TOP.tshirt, TOP.tshirt, TOP.shirt]);
  l.topC = l.top === TOP.shirt ? pick(r, [...SHIRT_LIGHT, ...TEE.slice(2, 6)]) : pick(r, TEE);
  if (chance(r, 0.3)) { l.lower = LOWER.shorts; l.lowerC = pick(r, [...KHAKI, ...JEANS.slice(0, 2)]); }
  else l.lowerC = pick(r, [...TROUSER_DARK, ...JEANS, ...KHAKI]);
  l.hair = pick(r, [HAIR.short, HAIR.curly, HAIR.buzz, HAIR.short]);
  if (chance(r, 0.25)) l.acc |= ACC.phone; else umbrella(r, l, 0.06);
  if (chance(r, 0.15)) l.acc |= ACC.shoppingBag;
  return l;
};
const sarongMan = (r: R): Look => {
  const l = base(r, false);
  l.lower = LOWER.sarong; l.lowerC = pick(r, SARONG);
  if (chance(r, 0.3)) { l.top = TOP.vest; l.topC = 0xf2f0ea; } else { l.top = pick(r, [TOP.shirt, TOP.tshirt]); l.topC = pick(r, [...SHIRT_LIGHT, 0x6f8fb0, 0x7d6b55]); }
  l.hair = pick(r, [HAIR.short, HAIR.buzz, HAIR.curly]);
  if (chance(r, 0.2)) l.hairC = pick(r, HAIR_GREY);
  umbrella(r, l, 0.12);
  if (!(l.acc & ACC.umbrella) && chance(r, 0.15)) l.acc |= ACC.shoppingBag;
  return l;
};
const sareeLady = (r: R): Look => {
  const l = base(r, true);
  l.lower = LOWER.longSkirt; l.top = TOP.saree; l.lowerC = pick(r, SAREE); l.topC = chance(r, 0.5) ? l.lowerC : pick(r, BLOUSE);
  l.hair = pick(r, [HAIR.bun, HAIR.bun, HAIR.bun, HAIR.long]); l.shoe = pick(r, [...SANDALS, 0xc9a24a]);
  umbrella(r, l, 0.28);
  if (chance(r, 0.25)) l.acc |= ACC.shoppingBag;
  if (chance(r, 0.3)) { l.acc |= ACC.shoulderBag; if (!(l.acc & ACC.umbrella)) l.accent = pick(r, BAG); }
  return l;
};
const dressLady = (r: R): Look => {
  const l = base(r, true);
  l.lower = pick(r, [LOWER.kneeDress, LOWER.longSkirt, LOWER.longSkirt]);
  l.lowerC = pick(r, SAREE);
  l.topC = chance(r, 0.6) ? l.lowerC : pick(r, [...BLOUSE, ...TEE]);
  l.top = pick(r, [TOP.tshirt, TOP.tshirt, TOP.shirt]);
  l.hair = pick(r, [HAIR.long, HAIR.bob, HAIR.ponytail, HAIR.bun]);
  if (chance(r, 0.4)) l.acc |= ACC.shoulderBag;
  umbrella(r, l, 0.2);
  return l;
};
const officeWoman = (r: R): Look => {
  const l = base(r, true);
  l.lower = pick(r, [LOWER.trousers, LOWER.longSkirt, LOWER.kneeDress]);
  l.lowerC = pick(r, [...TROUSER_DARK, 0x6a2a3a, 0x3a4a3a]);
  l.top = TOP.shirt; l.topC = pick(r, [...SHIRT_LIGHT, 0xf0e0c8, 0xd8b8c8]);
  l.hair = pick(r, [HAIR.bun, HAIR.ponytail, HAIR.bob]); l.shoe = pick(r, OFFICE_SHOES);
  if (chance(r, 0.65)) { l.acc |= ACC.shoulderBag; l.accent = pick(r, BAG); }
  if (chance(r, 0.2)) l.acc |= ACC.phone;
  return l;
};
const hijabi = (r: R): Look => {
  const l = base(r, true);
  l.lower = LOWER.longSkirt; l.lowerC = pick(r, [0x1f1f22, 0x23262c, 0x2a2a4a, 0x4a2a3a, 0x3b4a3a, 0x5a4a3a]);
  l.top = TOP.shirt; l.topC = chance(r, 0.5) ? l.lowerC : pick(r, [...SHIRT_LIGHT, 0x8a6a8a]);
  l.hair = HAIR.none; l.head = HEAD.hijab; l.accent = pick(r, HIJAB);
  if (chance(r, 0.25)) l.acc |= ACC.shoppingBag;
  return l;
};
const genz = (r: R, fem: boolean): Look => {
  const l = base(r, fem);
  l.top = chance(r, 0.18) ? TOP.hoodie : fem && chance(r, 0.15) ? TOP.vest : TOP.tshirt;
  l.topC = pick(r, GENZ);
  if (fem && chance(r, 0.25)) { l.lower = LOWER.kneeDress; l.lowerC = pick(r, [...GENZ, 0x1f1f22]); }
  else if (chance(r, 0.3)) { l.lower = LOWER.shorts; l.lowerC = pick(r, [...JEANS, ...KHAKI, 0x1f1f22]); }
  else l.lowerC = pick(r, [...JEANS, ...JEANS, ...KHAKI, 0x1f1f22]);
  l.hair = fem ? pick(r, [HAIR.long, HAIR.ponytail, HAIR.bob, HAIR.long, HAIR.curly]) : pick(r, [HAIR.curly, HAIR.short, HAIR.buzz, HAIR.curly]);
  l.shoe = pick(r, TRAINERS);
  l.height += 0.02;
  if (chance(r, fem ? 0.1 : 0.32)) { l.head = HEAD.cap; l.accent = pick(r, CAP); }
  if (chance(r, 0.45)) { l.acc |= ACC.backpack; if (l.head !== HEAD.cap) l.accent = pick(r, [...BAG, ...GENZ.slice(0, 3)]); }
  else if (fem && chance(r, 0.4)) l.acc |= ACC.shoulderBag;
  if (chance(r, 0.5)) l.acc |= ACC.phone;
  if (chance(r, 0.22)) l.acc |= ACC.sunglasses;
  l.speed = 1.05;
  return l;
};
const tourist = (r: R, fem: boolean): Look => {
  const l = base(r, fem);
  l.skin = pick(r, SKIN_VISITOR); l.hairC = pick(r, HAIR_VISITOR);
  l.height = fem ? 1.58 + r() * 0.16 : 1.7 + r() * 0.18;
  l.top = fem && chance(r, 0.3) ? TOP.vest : chance(r, 0.25) ? TOP.shirt : TOP.tshirt;
  l.topC = pick(r, [...TEE, 0xf4f4f0, 0x9cc3e4, 0xf2e6c8]);
  if (fem && chance(r, 0.3)) { l.lower = LOWER.kneeDress; l.lowerC = pick(r, [...SAREE, 0xf4f4f0]); }
  else if (chance(r, 0.6)) { l.lower = LOWER.shorts; l.lowerC = pick(r, [...KHAKI, ...JEANS, 0x5d6b4e]); }
  else l.lowerC = pick(r, [...KHAKI, ...JEANS, 0xe8e0d0]);
  l.hair = fem ? pick(r, [HAIR.long, HAIR.ponytail, HAIR.bob, HAIR.bun]) : pick(r, [HAIR.short, HAIR.short, HAIR.buzz, HAIR.curly]);
  l.shoe = pick(r, [...TRAINERS, ...SANDALS]);
  const hat = r();
  if (hat < 0.35) { l.head = HEAD.sunhat; l.accent = pick(r, SUNHAT); }
  else if (hat < 0.6) { l.head = HEAD.cap; l.accent = pick(r, CAP); }
  if (chance(r, 0.6)) { l.acc |= ACC.backpack; if (l.head === HEAD.none) l.accent = pick(r, [...BAG, 0x5d6b4e, 0x2f6d4a]); }
  if (chance(r, 0.35)) l.acc |= ACC.camera;
  if (chance(r, 0.5)) l.acc |= ACC.sunglasses;
  if (!(l.acc & ACC.camera) && chance(r, 0.25)) l.acc |= ACC.phone;
  l.speed = 0.9;
  return l;
};
const elder = (r: R, fem: boolean): Look => {
  const l = fem ? sareeLady(r) : chance(r, 0.5) ? sarongMan(r) : officeMan(r);
  l.hairC = pick(r, HAIR_GREY);
  if (l.hair === HAIR.curly) l.hair = HAIR.short;
  l.acc &= ~(ACC.phone | ACC.shoulderBag);
  l.stoop = 0.12 + r() * 0.18;
  l.height -= 0.04;
  l.speed = 0.7;
  if (!(l.acc & ACC.umbrella)) umbrella(r, l, 0.3);
  return l;
};

/** someone out on their own, in Colombo's mix */
export function soloLook(r: R): Look {
  const x = r();
  if (x < 0.13) return officeMan(r);
  if (x < 0.29) return casualMan(r);
  if (x < 0.37) return sarongMan(r);
  if (x < 0.5) return sareeLady(r);
  if (x < 0.6) return dressLady(r);
  if (x < 0.67) return officeWoman(r);
  if (x < 0.73) return hijabi(r);
  if (x < 0.84) return genz(r, chance(r, 0.5));
  if (x < 0.91) return tourist(r, chance(r, 0.5));
  return elder(r, chance(r, 0.5));
}
export const looks = { officeMan, casualMan, sarongMan, sareeLady, dressLady, officeWoman, hijabi, genz, tourist, elder };

/** children: heights 1.0 to 1.4 m */
export function kidLook(r: R, school: boolean, fem: boolean): Look {
  const l = base(r, fem);
  l.height = 1.0 + r() * 0.4; l.girth = 0.95 + r() * 0.1; l.speed = 1;
  l.shoe = pick(r, school ? [0x1f1f22, 0xf4f4f2] : [...TRAINERS, ...SANDALS]);
  if (school) {
    // white school uniforms: shirt and navy shorts, or a white frock
    l.topC = 0xf4f4f0;
    if (fem) { l.lower = LOWER.kneeDress; l.lowerC = 0xf4f4f0; l.top = TOP.tshirt; }
    else { l.top = TOP.shirt; l.lower = chance(r, 0.6) ? LOWER.shorts : LOWER.trousers; l.lowerC = pick(r, [0x1f2a44, 0x2a3550, 0xf4f4f0]); }
    l.acc |= ACC.backpack; l.accent = pick(r, [0x1f2a44, 0x8a2a2a, 0x2a4a7a, 0xd94f8a, 0x3a5a3a, 0xe0c040]);
  } else {
    l.top = TOP.tshirt; l.topC = pick(r, [...TEE, 0xf2d16b, 0xe7a4b8, 0x6ac0e0]);
    if (fem && chance(r, 0.6)) { l.lower = LOWER.kneeDress; l.lowerC = chance(r, 0.5) ? l.topC : pick(r, SAREE); }
    else { l.lower = LOWER.shorts; l.lowerC = pick(r, [...JEANS, ...KHAKI, 0x1f2a44]); }
    if (chance(r, 0.15)) { l.head = HEAD.cap; l.accent = pick(r, CAP); }
  }
  l.hair = fem ? pick(r, [HAIR.ponytail, HAIR.bob, HAIR.long, HAIR.bun]) : pick(r, [HAIR.short, HAIR.buzz, HAIR.curly]);
  return l;
}
/** tourist children get tourist colouring */
export function visitorKid(r: R, fem: boolean): Look {
  const l = kidLook(r, false, fem);
  l.skin = pick(r, SKIN_VISITOR); l.hairC = pick(r, HAIR_VISITOR);
  if (chance(r, 0.4)) { l.head = HEAD.sunhat; l.accent = pick(r, SUNHAT); }
  return l;
}
