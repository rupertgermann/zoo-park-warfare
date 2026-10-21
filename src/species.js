// Every playable faction. Gameplay code reads only this table; no per-species branches elsewhere.
// Units: meters, seconds. speed = m/s on land. size scales hitbox radius and camera distance.
// primary.kind: 'shot' (straight projectile), 'lob' (arcing, splash), 'cone' (short spray, model = the wave mesh), 'melee' (arc swipe)
// special.kind: 'dash' | 'aoe' | 'summon' | 'dive' | 'lifesteal' | 'stun' | 'bomb' | 'rage'
// summon extras: speed (m/s); fly + tick (pigeons hover at the target and peck every `tick` s) or blast + knock (chicks explode at the end of their life)

export const SPECIES = [
  {
    id: 'gans', names: ['Hupert', 'Gerda', 'Gustav', 'Honkrid'], verb: ['hupt', 'weg'],
    name: 'Kanadagans', team: 'Die Hup-Mafia', tagline: 'Laut. Territorial. Unaufhaltsam.',
    color: 0x5a4632, accent: 0xf2efe6, voice: 'honk',
    hp: 205, speed: 7, size: 0.75, swims: true, flies: false, jump: 6,
    primary: { kind: 'cone', name: 'Hup-Welle', dmg: 24, rate: 0.5, range: 7, arc: 0.6, knock: 3, model: 'honk' },
    special: { kind: 'dash', name: 'Gänsemarsch', desc: 'Stürmt nach vorn und rammt alles weg.', cd: 6, dmg: 40, dist: 11, knock: 14 },
  },
  {
    id: 'schwan', names: ['Lohengrin', 'Odette', 'Sir Schwanzelot'], verb: ['faucht', 'nieder'],
    name: 'Schwan', team: 'Königshaus Weißfeder', tagline: 'Majestätisch. Und sehr, sehr wütend.',
    color: 0xfbfbf7, accent: 0xf28a1a, voice: 'hiss',
    hp: 260, speed: 6.4, size: 0.95, swims: true, flies: false, jump: 6,
    primary: { kind: 'melee', name: 'Flügelschlag', dmg: 28, rate: 0.7, range: 2.6, arc: 1.4, knock: 3, lunge: 3 },
    special: { kind: 'aoe', name: 'Königliches Zischen', desc: 'Stößt alle im Umkreis zurück und betäubt sie kurz.', cd: 8, dmg: 22, radius: 6, knock: 16, stun: 1.2 },
  },
  {
    id: 'kormoran', names: ['Kurt', 'Korinna', 'Tauch-Toni'], verb: ['taucht', 'unter'],
    name: 'Kormoran', team: 'Die Taucherbande', tagline: 'Taucht ab. Haut drauf.',
    color: 0x22252b, accent: 0xe8b33a, voice: 'croak',
    hp: 150, speed: 7, size: 0.6, swims: true, swimMult: 1.45, flies: false, jump: 7,
    primary: { kind: 'shot', name: 'Fischwurf', dmg: 20, rate: 0.4, speed: 30, model: 'fish' },
    special: { kind: 'dive', name: 'Abtauchen', desc: 'Unverwundbar und blitzschnell für kurze Zeit.', cd: 7, dur: 1.6, boost: 2.2 },
  },
  {
    id: 'nutria', names: ['Nutella', 'Zahnhilde', 'Bertram'], verb: ['nagt', 'an'],
    name: 'Nutria', team: 'Clan Orangezahn', tagline: 'Orange Zähne. Null Respekt.',
    color: 0x7a5233, accent: 0xff8a1f, voice: 'squeak',
    hp: 190, speed: 7.4, size: 0.65, swims: true, flies: false, jump: 6,
    primary: { kind: 'melee', name: 'Nagebiss', dmg: 22, rate: 0.42, range: 2.4, arc: 1.1, knock: 2, lunge: 3.5 },
    special: { kind: 'aoe', name: 'Zahnwirbel', desc: 'Dreht sich wie ein Kreisel aus Zähnen.', cd: 6, dmg: 34, radius: 4, knock: 10, stun: 0 },
  },
  {
    id: 'kaninchen', names: ['Mümmel', 'Hoppla', 'Klopfer'], verb: ['möhrt', 'ab'],
    name: 'Kaninchen', team: 'Die Möhrenmiliz', tagline: 'Flauschig. Flink. Gnadenlos.',
    color: 0xd9c4a8, accent: 0xff9ec0, voice: 'squeak',
    hp: 110, speed: 9, size: 0.5, swims: false, flies: false, jump: 10,
    primary: { kind: 'shot', name: 'Möhrenwurf', dmg: 14, rate: 0.28, speed: 34, model: 'carrot' },
    special: { kind: 'dash', name: 'Hasenhaken', desc: 'Blitzsprung in Laufrichtung, kurz unverwundbar.', cd: 3.5, dmg: 0, dist: 9, knock: 0, dir: 'move' },
  },
  {
    id: 'taube', names: ['Gurrlinde', 'Rucki', 'Kackmar'], verb: ['bekleckert', ''],
    name: 'Taube', team: 'Gurr-Syndikat', tagline: 'Gurrt. Kackt. Siegt.',
    color: 0x8a93a6, accent: 0x5fbf8f, voice: 'coo',
    hp: 100, speed: 7.6, size: 0.45, swims: false, flies: true, jump: 7,
    primary: { kind: 'lob', name: 'Kackbombe', dmg: 25, rate: 0.55, speed: 20, splash: 2.8, model: 'poop' },
    special: { kind: 'summon', name: 'Taubenschwarm', desc: 'Ruft fünf Cousins, die den nächsten Gegner piesacken.', cd: 9, count: 5, dmg: 5, dur: 5, model: 'pigeon', fly: true, speed: 11, tick: 0.7 },
  },
  {
    id: 'kraehe', names: ['Krähmund', 'Rabea', 'Nussferatu'], verb: ['nusst', 'aus'],
    name: 'Krähe', team: 'Die Schwarze Zunft', tagline: 'Klug. Schwarz. Nachtragend.',
    color: 0x1d1f26, accent: 0x6b6fff, voice: 'caw',
    hp: 125, speed: 7.2, size: 0.5, swims: false, flies: true, jump: 7,
    primary: { kind: 'shot', name: 'Nusswurf', dmg: 14, rate: 0.36, speed: 32, model: 'nut', spin: 12 },
    special: { kind: 'bomb', name: 'Walnuss-Bombe', desc: 'Eine riesige Walnuss mit Wumms.', cd: 7, dmg: 35, radius: 5, speed: 18, model: 'bignut' },
  },
  {
    id: 'elster', names: ['Bling', 'Glitzi', 'Klau-Dia'], verb: ['beklaut', ''],
    name: 'Elster', team: 'Glitzerdiebe e.V.', tagline: 'Alles, was glänzt, gehört ihr.',
    color: 0x16181f, accent: 0x2fa3ff, voice: 'chatter',
    hp: 105, speed: 7.6, size: 0.5, swims: false, flies: true, jump: 7,
    primary: { kind: 'shot', name: 'Kronkorken', dmg: 8, rate: 0.22, speed: 38, model: 'cap', spin: 20 },
    special: { kind: 'lifesteal', name: 'Lebensklau', desc: 'Klaut dem nächsten Gegner 35 Lebenspunkte.', cd: 7, dmg: 35, range: 12 },
  },
  {
    id: 'ente', names: ['Quaksi', 'Erpelino', 'Donatella'], verb: ['quakt', 'platt'],
    name: 'Stockente', team: 'Quak Force One', tagline: 'Quak happens.',
    color: 0x2f8a4a, accent: 0xf3c63a, voice: 'quack',
    hp: 130, speed: 6.8, size: 0.55, swims: true, flies: true, jump: 6,
    primary: { kind: 'shot', name: 'Quak-Blaster', dmg: 13, rate: 0.34, speed: 30, model: 'quack' },
    special: { kind: 'summon', name: 'Küken-Kamikaze', desc: 'Drei Küken watscheln los und machen Puff.', cd: 9, count: 3, dmg: 24, dur: 4, model: 'chick', speed: 7, blast: 2.6, knock: 6 },
  },
  {
    id: 'mensch', names: ['Detlef', 'Karen', 'Uwe'], verb: ['verscheucht', ''],
    name: 'Parkbesucher', team: 'Bürgerinitiative Rasen', tagline: 'Hat Brot. Und schlechte Laune.',
    color: 0x3b6fd4, accent: 0xe8b48a, voice: 'human',
    hp: 190, speed: 6, size: 0.7, swims: false, flies: false, jump: 6,
    primary: { kind: 'shot', name: 'Brotwurf', dmg: 15, rate: 0.36, speed: 28, model: 'bread' },
    special: { kind: 'stun', name: 'Selfie-Blitz', desc: 'Blendet alle vor ihm für einen Moment.', cd: 8, dmg: 10, range: 10, arc: 0.8, stun: 1.2},
  },
  {
    id: 'nilgans', names: ['Nofretete', 'Ramses', 'Kleo-Patra'], verb: ['zischt', 'weg'],
    name: 'Nilgans', team: 'Pharaonen vom Teich', tagline: 'Eingewandert. Eingerichtet. Eingeschnappt.',
    color: 0xc9a77c, accent: 0x7a3b1f, voice: 'honk', pitch: 1.45,
    hp: 185, speed: 6.8, size: 0.7, swims: true, flies: true, jump: 6,
    primary: { kind: 'melee', name: 'Flügelsporn', dmg: 28, rate: 0.45, range: 2.4, arc: 1.1, knock: 3, lunge: 3 },
    special: { kind: 'rage', name: 'Pharaonen-Zorn', desc: 'Vier Sekunden lang schneller und mit 50 % mehr Wumms.', cd: 9, dur: 4, mult: 1.5, boost: 1.3 },
  },
  {
    id: 'sittich', names: ['Pistazie', 'Kiwi', 'Limette'], verb: ['kreischt', 'nieder'],
    name: 'Halsbandsittich', team: 'Die Grüne Invasion', tagline: 'Kreischt. Klaut. Kolonisiert.',
    color: 0x3fcf4a, accent: 0xff2d55, voice: 'screech', pitch: 1.9,
    hp: 115, speed: 7.9, size: 0.45, swims: false, flies: true, jump: 7,
    primary: { kind: 'shot', name: 'Kirschkern-Salve', dmg: 6, rate: 0.15, speed: 40, model: 'cherry' },
    special: { kind: 'aoe', name: 'Kreischalarm', desc: 'Ohrenbetäubend. Betäubt alle in der Nähe.', cd: 8, dmg: 12, radius: 6, knock: 6, stun: 1.1 },
  },
];

export const BOSS = {
  id: 'eisvogel', name: 'Der Eisvogel', tagline: 'Ein blauer Blitz. Das Ende aller Teichfehden.',
  color: 0x1f8fe0, accent: 0xff7a1a, voice: 'screech',
  hp: 7000, size: 2.2,
};

export const byId = Object.fromEntries([...SPECIES, BOSS].map(s => [s.id, s]));

// Rival-team tints so you can tell teams apart even when two species look alike.
export const TEAM_COLORS = [0xffd23f, 0xff4f79, 0x3ddc97, 0x4fb3ff, 0xb77bff];

export const RULES = { teams: 5, perTeam: 3, koToWin: 20, respawn: 3, bossLives: 3 };
