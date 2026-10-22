// Turns game events into sound: which clip, how loud, and whether it is close enough to the player to bother.
import { audio } from './audio.js';

export function bindSounds(g) {
  const sfx = (name, p, vol, pitch) => audio.sfx(name, p && { x: p.x, z: p.z, vol, pitch });
  const near = (a, d = 18) => a.isPlayer || a.pos.distanceTo(g.player.pos) < d;
  const voice = (a, vol) => sfx(a.spec.voice, a.pos, vol, a.spec.pitch);
  const sting = won => audio.sfx(won ? 'win' : 'lose');

  g.on('phase', p => {
    if (p === 'match') { audio.sfx('go'); audio.music('match'); }
    if (p === 'won') sting(g.crown === g.player.team);
    if (p === 'bossIntro') { audio.music(null); audio.sfx('bossIntro'); }
    if (p === 'boss') audio.music('boss');
    if (p === 'over') { sting(g.result.won); audio.music(null); }
  });
  g.on('countdown', () => audio.sfx('countdown'));
  g.on('damage', ({ t, src }) => {
    if (src.isPlayer || near(t, 25)) sfx(t.isPlayer ? 'hurt' : 'hit', t.pos, src.isPlayer || t.isPlayer ? 1 : 0.5);
  });
  g.on('ko', ({ t }) => sfx('ko', t.pos));

  g.on('attack', a => {
    const kind = a.spec.primary.kind;
    if ((a.isPlayer || Math.random() < 0.3) && (kind === 'cone' || Math.random() < 0.35)) voice(a, a.isPlayer ? 0.8 : 0.5);
    if (!near(a)) return;
    if (kind === 'shot') sfx('throw', a.pos, a.isPlayer ? 0.6 : 0.3);
    else if (kind === 'lob') sfx('throw', a.pos, 0.4);
    else sfx('swing', a.pos, a.isPlayer ? 0.7 : 0.35);
  });
  g.on('special', a => {
    const s = a.spec.special;
    switch (s.kind) {
      case 'dash': sfx('dash', a.pos); if (s.dmg) voice(a, 0.9); break;
      case 'aoe': voice(a, 1); sfx('boom', a.pos, 0.6); break;
      case 'rage': voice(a, 1); break;
      case 'dive': sfx('splash', a.pos); break;
      case 'summon': sfx('summon', a.pos); break;
      case 'lifesteal': sfx('steal', a.pos); break;
      case 'stun': sfx('stun', a.pos); break;
      case 'bomb': sfx('throw', a.pos); break;
    }
  });
  g.on('specialReady', a => a.isPlayer && audio.sfx('uiMove', { vol: 0.5, pitch: 1.5 }));
  g.on('jump', ({ a, flap }) => near(a, 12) && sfx(flap ? 'flap' : 'jump', a.pos, a.isPlayer ? 0.5 : 0.2));
  g.on('splash', a => sfx('splash', a.pos, a.isPlayer ? 0.7 : 0.25));
  g.on('pickup', a => sfx('pickup', a.pos, a.isPlayer ? 1 : 0.3));
  g.on('explode', ({ owner, pos }) => sfx('boom', pos, owner.isPlayer ? 0.8 : 0.45));
  g.on('summonHit', ({ owner, pos }) => sfx(owner.spec.voice, pos, 0.25));

  g.on('bossEnraged', b => sfx('screech', b.pos));
  g.on('bossVolley', b => sfx('screech', b.pos, 0.5, 1.3));
  g.on('bossTarget', () => sfx('screech', g.boss.pos, 0.9));
  g.on('bossDive', b => sfx('bossDive', b.pos));
  g.on('bossLand', ({ pos }) => { sfx('boom', pos); sfx('splash', pos); });
}
