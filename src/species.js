// Every playable faction. Gameplay code reads only this table; no per-species branches elsewhere.
// Names, ability names and descriptions live in i18n.js under the same ids.
// Units: meters, seconds. speed = m/s on land. size scales hitbox radius and camera distance.
// primary.kind: 'shot' (straight projectile), 'lob' (arcing, splash), 'cone' (short spray, model = the wave mesh), 'melee' (arc swipe)
// special.kind: 'dash' | 'aoe' | 'summon' | 'dive' | 'lifesteal' | 'stun' | 'bomb' | 'rage'
// summon extras: speed (m/s); fly + tick (pigeons hover at the target and peck every `tick` s) or blast + knock (chicks explode at the end of their life)

export const SPECIES = [
  {
    id: 'gans',
    color: 0x5a4632, accent: 0xf2efe6, voice: 'honk',
    hp: 205, speed: 7, size: 0.75, swims: true, flies: false, jump: 6,
    primary: { kind: 'cone', dmg: 24, rate: 0.5, range: 7, arc: 0.6, knock: 3, model: 'honk' },
    special: { kind: 'dash', cd: 6, dmg: 40, dist: 11, knock: 14 },
  },
  {
    id: 'schwan',
    color: 0xfbfbf7, accent: 0xf28a1a, voice: 'hiss',
    hp: 260, speed: 6.4, size: 0.95, swims: true, flies: false, jump: 6,
    primary: { kind: 'melee', dmg: 28, rate: 0.7, range: 2.6, arc: 1.4, knock: 3, lunge: 3 },
    special: { kind: 'aoe', cd: 8, dmg: 22, radius: 6, knock: 16, stun: 1.2 },
  },
  {
    id: 'kormoran',
    color: 0x22252b, accent: 0xe8b33a, voice: 'croak',
    hp: 150, speed: 7, size: 0.6, swims: true, swimMult: 1.45, flies: false, jump: 7,
    primary: { kind: 'shot', dmg: 20, rate: 0.4, speed: 30, model: 'fish' },
    special: { kind: 'dive', cd: 7, dur: 1.6, boost: 2.2 },
  },
  {
    id: 'nutria',
    color: 0x7a5233, accent: 0xff8a1f, voice: 'squeak',
    hp: 190, speed: 7.4, size: 0.65, swims: true, flies: false, jump: 6,
    primary: { kind: 'melee', dmg: 22, rate: 0.42, range: 2.4, arc: 1.1, knock: 2, lunge: 3.5 },
    special: { kind: 'aoe', cd: 6, dmg: 34, radius: 4, knock: 10, stun: 0 },
  },
  {
    id: 'kaninchen',
    color: 0xd9c4a8, accent: 0xff9ec0, voice: 'squeak',
    hp: 110, speed: 9, size: 0.5, swims: false, flies: false, jump: 10,
    primary: { kind: 'shot', dmg: 14, rate: 0.28, speed: 34, model: 'carrot' },
    special: { kind: 'dash', cd: 3.5, dmg: 0, dist: 9, knock: 0, dir: 'move' },
  },
  {
    id: 'taube',
    color: 0x8a93a6, accent: 0x5fbf8f, voice: 'coo',
    hp: 100, speed: 7.6, size: 0.45, swims: false, flies: true, jump: 7,
    primary: { kind: 'lob', dmg: 25, rate: 0.55, speed: 20, splash: 2.8, model: 'poop' },
    special: { kind: 'summon', cd: 9, count: 5, dmg: 5, dur: 5, model: 'pigeon', fly: true, speed: 11, tick: 0.7 },
  },
  {
    id: 'kraehe',
    color: 0x1d1f26, accent: 0x6b6fff, voice: 'caw',
    hp: 125, speed: 7.2, size: 0.5, swims: false, flies: true, jump: 7,
    primary: { kind: 'shot', dmg: 14, rate: 0.36, speed: 32, model: 'nut', spin: 12 },
    special: { kind: 'bomb', cd: 7, dmg: 35, radius: 5, speed: 18, model: 'bignut' },
  },
  {
    id: 'elster',
    color: 0x16181f, accent: 0x2fa3ff, voice: 'chatter',
    hp: 105, speed: 7.6, size: 0.5, swims: false, flies: true, jump: 7,
    primary: { kind: 'shot', dmg: 8, rate: 0.22, speed: 38, model: 'cap', spin: 20 },
    special: { kind: 'lifesteal', cd: 7, dmg: 35, range: 12 },
  },
  {
    id: 'ente',
    color: 0x2f8a4a, accent: 0xf3c63a, voice: 'quack',
    hp: 130, speed: 6.8, size: 0.55, swims: true, flies: true, jump: 6,
    primary: { kind: 'shot', dmg: 13, rate: 0.34, speed: 30, model: 'quack' },
    special: { kind: 'summon', cd: 9, count: 3, dmg: 24, dur: 4, model: 'chick', speed: 7, blast: 2.6, knock: 6 },
  },
  {
    id: 'mensch',
    color: 0x3b6fd4, accent: 0xe8b48a, voice: 'human',
    hp: 190, speed: 6, size: 0.7, swims: false, flies: false, jump: 6,
    primary: { kind: 'shot', dmg: 15, rate: 0.36, speed: 28, model: 'bread' },
    special: { kind: 'stun', cd: 8, dmg: 10, range: 10, arc: 0.8, stun: 1.2},
  },
  {
    id: 'nilgans',
    color: 0xc9a77c, accent: 0x7a3b1f, voice: 'honk', pitch: 1.45,
    hp: 185, speed: 6.8, size: 0.7, swims: true, flies: true, jump: 6,
    primary: { kind: 'melee', dmg: 28, rate: 0.45, range: 2.4, arc: 1.1, knock: 3, lunge: 3 },
    special: { kind: 'rage', cd: 9, dur: 4, mult: 1.5, boost: 1.3 },
  },
  {
    id: 'sittich',
    color: 0x3fcf4a, accent: 0xff2d55, voice: 'screech', pitch: 1.9,
    hp: 115, speed: 7.9, size: 0.45, swims: false, flies: true, jump: 7,
    primary: { kind: 'shot', dmg: 6, rate: 0.15, speed: 40, model: 'cherry' },
    special: { kind: 'aoe', cd: 8, dmg: 12, radius: 6, knock: 6, stun: 1.1 },
  },
];

export const BOSS = {
  id: 'eisvogel',
  color: 0x1f8fe0, accent: 0xff7a1a, voice: 'screech',
  hp: 7000, size: 2.2,
};

export const byId = Object.fromEntries([...SPECIES, BOSS].map(s => [s.id, s]));

// cosmetic per-actor gender ('m' | 'f'): only the park visitor has one, it never touches the stats
export const gendered = spec => spec.id === 'mensch';
export const voicePitch = (spec, gender) => (spec.pitch ?? 1) * (gender === 'f' ? 1.35 : 1);

// Rival-team tints so you can tell teams apart even when two species look alike.
export const TEAM_COLORS = [0xffd23f, 0xff4f79, 0x3ddc97, 0x4fb3ff, 0xb77bff];

export const RULES = { teams: 5, perTeam: 3, koToWin: 20, respawn: 3 };

// Multipliers for rival bots and the boss; 'schwer' is the tuned baseline.
// speed: bot movement, boss: boss flight speed, rate: attack cooldown, aim: aim error, dmg: damage taken by the player.
export const DIFFICULTY = [
  { id: 'leicht', speed: 0.72, boss: 0.85, rate: 1.7, aim: 2, dmg: 0.45, lives: 5 },
  { id: 'mittel', speed: 0.86, boss: 0.93, rate: 1.3, aim: 1.4, dmg: 0.7, lives: 4 },
  { id: 'schwer', speed: 1, boss: 1, rate: 1, aim: 1, dmg: 1, lives: 3 },
];
