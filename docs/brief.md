# Zoo Park Warfare: brief and module contracts

A funny, colorful third-person arena brawler in a city park, homage to karenwarfare.fun.
The player picks one of twelve factions (see `src/species.js`, the single source of truth for stats).
Phase 1 "Revierkampf": 5 teams of 3 (player + 2 bots of the same species vs 4 rival species), first team to `RULES.koToWin` (20) KOs wins. That team is crowned (gold crown, +30 % damage against the boss).
Phase 2 "Endgegner": a giant kingfisher (Eisvogel) attacks, always, whoever won phase 1. All survivors call a truce and fight it together; the player has 3 to 5 lives depending on difficulty.
Difficulty (`DIFFICULTY` in `src/species.js`, picked in the menu, saved as `pw.diff`): Leicht, Mittel, Schwer. It scales rival bots and the boss only; Schwer is the tuned baseline.
All UI text is in German and English (`src/i18n.js`, switch on the start screen, saved as `pw.lang`). Stack: Vite + three.js 0.186 (ES modules, `import * as THREE from 'three'`). No other runtime deps.

## World conventions
- Y up, ground at y = 0. Meters. Creatures face +Z in local space; the root origin is at the feet.
- Park spans x in [-55, 55], z in [-40, 40]. A pond sits roughly in the middle.
- Swimmers float with their root at `park.waterLevel` (about -0.35) inside the pond.
- Art style: chunky low-poly cartoon, saturated colors, cel shading, big googly eyes, exaggerated proportions.
- Rendering: every lit material comes from `toon()` in `src/toon.js` (shared 3-step ramp). `src/post.js` adds bloom and
  ink outlines from the depth buffer, so anything that should not get outlines (grass blades) skips depth writes.
  Readability beats realism: tiny animals are scaled up (see heights below). Silhouettes must be distinct at 20 m.

## `src/models.js`
```js
export function buildCreature(id /* species id or 'eisvogel' */) -> Creature
// Creature = {
//   root: THREE.Group,            // add to scene; position/rotation.y set by game
//   height: number,               // top of head in meters (for nameplates)
//   muzzle: THREE.Object3D,       // child; world position = where projectiles spawn
//   setTeamColor(hex: number),    // tints an accessory (scarf/bandana/cap) in the team color
//   update(dt: number, a: Anim),  // procedural animation, called every frame
// }
// Anim = { move: 0..1, air: bool, swim: bool, attack: 0..1 (1 at trigger, game decays it),
//          hurt: 0..1 (1 when hit), stun: bool, special: 0..1, dead: bool, t: seconds }
export function buildProp(name) -> THREE.Object3D
// Projectile/summon meshes, ~0.3-0.6 m: 'fish','carrot','poop','nut','bignut','cap','quack','honk','bread','chick','pigeon','bossfish','crown'
// 'quack'/'honk' are cartoon shockwave rings reading "QUAK!"/"HUP!"; 'chick' is a duckling; 'pigeon' a mini pigeon.
```
Game-scale heights: taube 0.7, kraehe 0.8, elster 0.8, kaninchen 0.8, ente 0.85, nutria 0.75, kormoran 1.1, gans 1.2, schwan 1.5, mensch 1.85, eisvogel ~3.5 tall with ~7 m wingspan.

## `src/park.js`
```js
export function buildPark(scene) -> Park
// Park = {
//   bounds: { halfX: 55, halfZ: 40 },
//   colliders: Array<{x,z,r,h} | {x,z,hx,hz,h}>,  // circles or axis-aligned boxes; h = height (projectiles above h pass)
//   isWater(x, z) -> bool,
//   blocked(x, z, y = 0, pad = 0) -> bool,  // true if a collider at least y tall is within pad of the point
//   canopies: Array<{x,z,r,y0,y1}>,         // tree crowns, for the camera
//   waterLevel: number,
//   teamSpawns: Array<{x,z}>,   // exactly 5, spread around the pond, >= 25 m apart
//   pickupSpots: Array<{x,z}>,  // 8-10 open spots for health snacks
//   perch: {x,y,z},             // where the kingfisher lands between attacks (tall branch/sign at the pond)
//   update(dt, t),              // animate water, ambient life
// }
// buildPark also adds sky, sun (DirectionalLight with shadows, shadow camera covering the park), hemisphere light, fog.
```

## `src/audio.js`
WebAudio, fully synthesized, no files.
```js
export const audio = {
  unlock(),                          // call on first user gesture
  sfx(name, { x, z, vol, pitch } = {}),  // x/z optional for positional pan + distance falloff
  setListener(x, z, yaw),
  setVolume(v /* 0..1 */), getVolume(), toggleMute() -> bool muted,
  music(mode /* 'menu' | 'match' | 'boss' | null */),
}
```
Names: voices `honk hiss croak squeak coo caw chatter quack human screech`, plus
`hit hurt ko pickup jump flap splash throw swing boom dash stun summon steal ui uiMove countdown go win lose bossIntro bossDive`.
