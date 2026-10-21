// Procedural low-poly cartoon models for every species, the boss, and all projectile/summon props.
// Each creature is a small rig (named groups) built from cached unit primitives and cached materials,
// normalized to its game-scale height, and animated by one shared animator that reads only the rig.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const PI = Math.PI;
const HEIGHTS = {
  taube: 0.7, kraehe: 0.8, elster: 0.8, kaninchen: 0.8, ente: 0.85, nutria: 0.75,
  kormoran: 1.1, gans: 1.2, nilgans: 1.1, sittich: 0.75, schwan: 1.5, mensch: 1.85, eisvogel: 3.5,
};

// ---------- shared geometry + materials (module-level, reused by every instance) ----------

const PRIM = {
  sphere: () => new THREE.SphereGeometry(1, 12, 9),
  ball: () => new THREE.SphereGeometry(1, 8, 6),
  dome: () => new THREE.SphereGeometry(1, 12, 6, 0, PI * 2, 0, PI / 2),
  box: () => new THREE.BoxGeometry(1, 1, 1),
  cyl: () => new THREE.CylinderGeometry(1, 1, 1, 12),
  limb: () => new THREE.CylinderGeometry(1, 0.8, 1, 8).translate(0, -0.5, 0), // hangs down from its origin
  cone: () => new THREE.ConeGeometry(1, 1, 10).translate(0, 0.5, 0).rotateX(PI / 2), // base at origin, tip at +z
  bill: () => new THREE.SphereGeometry(1, 10, 6).translate(0, 0, 1), // spoon shape from origin toward +z
  foot: () => new THREE.CylinderGeometry(1, 1, 1, 3).rotateY(PI), // webbed triangle, wide edge forward
  torus: () => new THREE.TorusGeometry(1, 0.28, 6, 16),
  arc: () => new THREE.TorusGeometry(1, 0.22, 5, 10, PI),
  xeye: () => mergeGeometries([
    new THREE.BoxGeometry(1.5, 0.32, 0.4).rotateZ(PI / 4),
    new THREE.BoxGeometry(1.5, 0.32, 0.4).rotateZ(-PI / 4),
  ]),
  star: () => {
    const s = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * PI * 2 + PI / 2, r = i % 2 ? 0.45 : 1;
      i ? s.lineTo(Math.cos(a) * r, Math.sin(a) * r) : s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    return new THREE.ExtrudeGeometry(s, { depth: 0.35, bevelEnabled: false }).center();
  },
  whiskers: () => mergeGeometries([-1, 1].flatMap(side => [-0.25, 0, 0.25].map(a =>
    new THREE.BoxGeometry(1, 0.06, 0.06).translate(0.5, 0, 0).rotateZ(a).rotateY(side > 0 ? -0.3 : PI + 0.3)
      .translate(side * 0.25, 0, 0)))),
  crown: () => mergeGeometries([
    new THREE.CylinderGeometry(1, 0.9, 0.6, 10, 1, true),
    ...[0, 1, 2, 3, 4].map(i => new THREE.ConeGeometry(0.28, 0.7, 4)
      .translate(Math.sin(i * 1.2566) * 0.92, 0.6, Math.cos(i * 1.2566) * 0.92)),
  ]),
};
const geoCache = new Map();
const g = (name) => cachedGeo(name, PRIM[name]);
function cachedGeo(key, make) {
  let geo = geoCache.get(key);
  if (!geo) geoCache.set(key, geo = make());
  return geo;
}

const matCache = new Map();
// o: { metal, rough, glow (emissive intensity of its own color), opacity }
function mat(color, o = {}) {
  const f = { metal: o.metal ?? 0, rough: o.rough ?? 0.75, glow: o.glow ?? 0, opacity: o.opacity ?? 1 };
  const key = `${color}|${f.metal}|${f.rough}|${f.glow}|${f.opacity}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color, flatShading: true, metalness: f.metal, roughness: f.rough,
      emissive: f.glow ? color : 0x000000, emissiveIntensity: f.glow,
      transparent: f.opacity < 1, opacity: f.opacity, depthWrite: f.opacity >= 1,
    });
    m.userData.finish = f;
    matCache.set(key, m);
  }
  return m;
}

// Baked creature meshes carry their colors per vertex, so one material per finish covers every color.
// Glow stays "emissive = own color" by scaling the white emissive with the vertex color.
const glowFromVertexColor = sh => {
  sh.fragmentShader = sh.fragmentShader.replace('vec3 totalEmissiveRadiance = emissive;', 'vec3 totalEmissiveRadiance = emissive * vColor.rgb;');
};
const finishCache = new Map();
function finishMat(f) {
  const key = `${f.metal}|${f.rough}|${f.glow}|${f.opacity}`;
  let m = finishCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: 0xffffff, vertexColors: true, flatShading: true, metalness: f.metal, roughness: f.rough,
      emissive: f.glow ? 0xffffff : 0x000000, emissiveIntensity: f.glow,
      transparent: f.opacity < 1, opacity: f.opacity, depthWrite: f.opacity >= 1,
    });
    if (f.glow) m.onBeforeCompile = glowFromVertexColor;
    finishCache.set(key, m);
  }
  return m;
}
const WHITE = 0xffffff, BLACK = 0x111111;
const FLASH = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.9, flatShading: true });

function part(parent, shape, material, p = [0, 0, 0], s = 1, r) {
  const geo = typeof shape === 'string' ? g(shape) : shape;
  const m = new THREE.Mesh(geo, typeof material === 'number' ? mat(material) : material);
  m.position.fromArray(p);
  if (typeof s === 'number') m.scale.setScalar(s); else m.scale.fromArray(s);
  if (r) m.rotation.set(r[0], r[1], r[2]);
  m.castShadow = Math.max(m.scale.x, m.scale.y, m.scale.z) > 0.045;
  parent.add(m);
  return m;
}
function grp(parent, p = [0, 0, 0], r) {
  const o = new THREE.Group();
  o.position.fromArray(p);
  if (r) o.rotation.set(r[0], r[1], r[2]);
  parent.add(o);
  return o;
}

// ---------- rig parts shared by all species ----------

function newRig(id) {
  const root = new THREE.Group();
  const pose = grp(root);
  const model = grp(pose);
  const body = grp(model);
  return {
    id, root, pose, model, body, neck: null, head: null, jaw: null, muzzle: null,
    eyes: [], legs: [], arms: [], wings: [], ears: [], tail: null, flutters: [], throwArm: null,
    gait: 'waddle', flyer: false, boss: false, headBob: 0, peck: 0.6, lunge: 0.12, swimBody: 0.6,
    teamMat: new THREE.MeshStandardMaterial({ color: 0xffd23f, flatShading: true, roughness: 0.6 }),
  };
}

// Googly eyes: whites on one shared lid pivot (blink), a free-jittering pupil each (becomes an X on KO), optional brow.
// brow: angle (positive = angry, inner end down) or [left, right]; null = none.
function addEyes(rig, head, { r, x, y, z, yaw = 0.5, brow = 0.35, browColor = 0x1a1410, browW = 1.5, browH = 0.3 }) {
  rig.lid = grp(head, [0, y, 0]);
  [1, -1].forEach((side, i) => {
    const e = grp(rig.lid, [side * x, 0, z], [0, side * yaw, 0]);
    part(e, 'sphere', WHITE, [0, 0, 0], r);
    const pupil = part(e, 'ball', BLACK, [0, 0, r * 0.8], [r * 0.54, r * 0.54, r * 0.32]);
    pupil.userData.keep = true;
    const b = Array.isArray(brow) ? brow[i] : brow;
    if (b !== null) part(grp(head, [side * x, y, z], [0, side * yaw, 0]), 'box', browColor, [side * r * 0.05, r * 1.02, r * 0.3], [r * browW, r * browH, r * 0.4], [0, 0, side * b]);
    rig.eyes.push({ pupil, r, jx: 0, jy: 0, tx: 0, ty: 0, next: 0 });
  });
}

// Team-colored ring (scarf, headband, mask) with two fluttering knot tails at the back; ring: false = knot only.
function addBand(rig, parent, p, radius, { tilt = 0, height = 1.5, tails = 1, ring = true } = {}) {
  const b = grp(parent, p, [tilt, 0, 0]);
  if (ring) part(b, 'torus', rig.teamMat, [0, 0, 0], [radius, radius, radius * height], [PI / 2, 0, 0]);
  if (tails) {
    const knot = grp(b, [0, 0, -radius * 1.05]);
    part(knot, 'ball', rig.teamMat, [0, 0, 0], radius * 0.28);
    const f = grp(knot, [0, 0, 0], [0.5, 0, 0]);
    for (const side of [-1, 1]) part(grp(f, [0, 0, 0], [0, side * 0.35, 0]), 'box', rig.teamMat, [0, -radius * 0.55 * tails, -radius * 0.1], [radius * 0.45, radius * 1.1 * tails, radius * 0.08]);
    rig.flutters.push(f);
  }
  return b;
}

function addWing(rig, parent, side, W) {
  const w = grp(parent, [side * W.at[0], W.at[1], W.at[2]]);
  const thick = W.thick ?? W.len * 0.12;
  part(w, 'sphere', W.color, [0, -W.len * 0.5, -W.width * 0.12], [thick, W.len * 0.52, W.width * 0.5]);
  if (W.tip) part(w, 'sphere', W.tip, [0, -W.len * 0.86, -W.width * 0.3], [thick * 0.8, W.len * 0.22, W.width * 0.32]);
  w.userData = { side, rest: W.rest ?? 0.1, tilt: W.tilt ?? 1.2, thick };
  w.rotation.set(w.userData.tilt, 0, side * w.userData.rest);
  rig.wings.push(w);
  return w;
}

// Generic bird: legs + webbed feet, torso, tube neck on a peck pivot, head with beak/jaw, eyes, wings.
function bird(rig, P) {
  const { body } = rig;
  [1, -1].forEach(side => {
    const L = grp(body, [side * P.legX, P.hip, P.legZ ?? 0]);
    part(L, 'limb', P.legColor, [0, 0, 0], [P.legR, P.hip, P.legR]);
    part(L, 'foot', P.footColor ?? P.legColor, [0, -P.hip + P.foot * 0.05, P.foot * 0.6], [P.foot * 0.75, P.foot * 0.1, P.foot]);
    rig.legs.push({ g: L, phase: side > 0 ? 0 : PI });
  });
  const T = P.torso;
  part(body, 'sphere', T.color, T.at, T.size, [T.pitch ?? 0, 0, 0]);
  rig.swimDrop = P.hip + T.size[1] * rig.swimBody;

  const n = P.neck, base = n.pts[0];
  rig.neck = grp(body, base);
  const rel = n.pts.map(q => new THREE.Vector3(q[0] - base[0], q[1] - base[1], q[2] - base[2]));
  if (rel.length > 1) {
    const tube = cachedGeo(`neck:${rig.id}`, () => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rel), 16, n.r, 7));
    part(rig.neck, tube, n.color);
  }
  const end = rel[rel.length - 1], H = P.head;
  const head = rig.head = grp(rig.neck, [end.x + H.off[0], end.y + H.off[1], end.z + H.off[2]]);
  part(head, 'sphere', H.color, [0, 0, 0], H.stretch.map(s => s * H.r));

  const B = P.beak;
  const beak = grp(head, B.at, [B.pitch ?? 0, 0, 0]);
  const shape = B.shape ?? 'cone';
  const half = shape === 'bill' ? 0.5 : 1;
  part(beak, shape, B.color, [0, B.r * 0.15, 0], [B.w ?? B.r, B.h ?? B.r * 0.75, B.len * half]);
  rig.jaw = grp(beak, [0, -B.r * 0.1, 0]);
  part(rig.jaw, shape, B.color, [0, 0, 0], [(B.w ?? B.r) * 0.85, (B.h ?? B.r * 0.75) * 0.55, B.len * 0.88 * half]);
  if (B.hook) part(beak, 'cone', B.color, [0, B.r * 0.1, B.len * 0.9], [B.r * 0.45, B.r * 0.45, B.r * 1.5], [PI / 2 + 0.3, 0, 0]);
  rig.muzzle = grp(beak, [0, 0, B.len * 1.05]);
  rig.beak = beak;

  addEyes(rig, head, P.eyes);
  for (const side of [1, -1]) addWing(rig, body, side, P.wing);
  if (P.tail) {
    rig.tail = grp(body, P.tail.at);
    part(rig.tail, 'sphere', P.tail.color, [0, 0, 0], P.tail.size, [P.tail.pitch ?? 0, 0, 0]);
  }
  P.extra?.(rig);
}

// ---------- species ----------

const BUILD = {
  gans(rig) {
    bird(rig, {
      hip: 0.32, legX: 0.1, legR: 0.03, legColor: 0x2a2a2a, foot: 0.12,
      torso: { at: [0, 0.58, 0], size: [0.28, 0.25, 0.44], pitch: -0.12, color: 0x7d6650 },
      neck: { pts: [[0, 0.68, 0.3], [0, 0.86, 0.37], [0, 1.0, 0.38]], r: 0.07, color: 0x151515 },
      head: { off: [0, 0.03, 0.04], r: 0.12, stretch: [1, 0.92, 1.15], color: 0x151515 },
      beak: { at: [0, -0.02, 0.1], len: 0.15, r: 0.045, color: 0x151515, pitch: 0.12 },
      eyes: { r: 0.058, x: 0.068, y: 0.045, z: 0.07, yaw: 0.55, brow: 0.55, browColor: 0x5a4632 },
      wing: { at: [0.25, 0.7, 0.12], len: 0.42, width: 0.42, color: 0x6a5440, tip: 0x2e241b, tilt: 1.2, rest: 0.12 },
      tail: { at: [0, 0.66, -0.44], size: [0.14, 0.05, 0.13], color: 0x1a1a1a, pitch: -0.3 },
      extra(r) {
        part(r.body, 'sphere', 0xe2d8c6, [0, 0.5, 0.13], [0.25, 0.19, 0.3]);
        part(r.body, 'sphere', 0xf4f1ea, [0, 0.56, -0.36], [0.17, 0.13, 0.14]);
        part(r.body, 'sphere', 0x5f4b39, [0, 0.68, -0.06], [0.22, 0.12, 0.34]);
        part(r.head, 'sphere', WHITE, [0, -0.045, -0.02], [0.13, 0.07, 0.1]); // chin strap
        addBand(r, r.neck, [0, 0.03, 0.01], 0.09, { tilt: -0.35 });
      },
    });
  },

  nilgans(rig) {
    // Egyptian goose: pale head with a chocolate "Cleopatra" eye mask, tan body, chestnut back, pink bill and stilts
    const E = { r: 0.056, x: 0.064, y: 0.04, z: 0.066, yaw: 0.6, brow: 0.6, browColor: 0x3a2214, browW: 1.7, browH: 0.36 };
    bird(rig, {
      hip: 0.4, legX: 0.09, legR: 0.026, legColor: 0xf2909c, foot: 0.11,
      torso: { at: [0, 0.64, 0], size: [0.26, 0.23, 0.4], pitch: -0.12, color: 0xc8b08a },
      neck: { pts: [[0, 0.74, 0.27], [0, 0.88, 0.33], [0, 0.98, 0.34]], r: 0.066, color: 0xdcc9a3 },
      head: { off: [0, 0.03, 0.04], r: 0.115, stretch: [0.95, 0.95, 1.15], color: 0xefe4cc },
      beak: { at: [0, -0.02, 0.1], len: 0.14, r: 0.044, color: 0xf28a9a, pitch: -0.06 },
      eyes: E,
      wing: { at: [0.24, 0.76, 0.12], len: 0.4, width: 0.4, color: 0x9a5a34, tip: 0x241a14, tilt: 1.2, rest: 0.12 },
      tail: { at: [0, 0.71, -0.4], size: [0.13, 0.05, 0.12], color: 0x241a14, pitch: -0.3 },
      extra(r) {
        part(r.body, 'sphere', 0xdcc6a0, [0, 0.57, 0.13], [0.23, 0.18, 0.3]); // buff breast
        part(r.body, 'sphere', 0x4a2a18, [0, 0.55, 0.395], [0.075, 0.065, 0.035]); // dark chest spot
        part(r.body, 'sphere', 0xa4542a, [0, 0.75, -0.06], [0.21, 0.11, 0.32]); // rusty back
        part(r.body, 'sphere', 0xf0e6d0, [0, 0.62, -0.33], [0.15, 0.12, 0.13]);
        for (const w of r.wings) part(w, 'sphere', WHITE, [0, -0.16, -0.13], [w.userData.thick * 1.12, 0.17, 0.075]); // white coverts along the top edge
        for (const s of [1, -1]) { // eye mask: flat ellipse sunk behind each googly eye so the white still pops out
          const yaw = s * E.yaw, back = E.r * 0.45;
          part(r.head, 'sphere', 0x4a2c1c, [s * E.x - Math.sin(yaw) * back, E.y, E.z - Math.cos(yaw) * back], [E.r * 1.75, E.r * 1.35, E.r * 0.75], [0, yaw, 0]);
        }
        // Pharaonen vom Teich: team-colored broad collar with a gold rim
        part(r.neck, 'torus', r.teamMat, [0, 0.085, 0.035], [0.078, 0.078, 0.08], [PI / 2 - 0.35, 0, 0]);
        part(r.neck, 'torus', mat(0xffcc33, { metal: 0.6, rough: 0.3, glow: 0.2 }), [0, 0.05, 0.02], [0.09, 0.09, 0.04], [PI / 2 - 0.35, 0, 0]);
      },
    });
  },

  schwan(rig) {
    bird(rig, {
      hip: 0.26, legX: 0.13, legR: 0.035, legColor: 0x1a1a1a, foot: 0.16,
      torso: { at: [0, 0.58, -0.05], size: [0.38, 0.3, 0.6], pitch: -0.12, color: 0xfbfbf7 },
      neck: { pts: [[0, 0.72, 0.42], [0, 0.95, 0.6], [0, 1.15, 0.48], [0, 1.32, 0.38], [0, 1.43, 0.46]], r: 0.072, color: 0xfbfbf7 },
      head: { off: [0, 0.02, 0.03], r: 0.105, stretch: [0.9, 0.9, 1.15], color: 0xfbfbf7 },
      beak: { at: [0, -0.02, 0.095], len: 0.21, r: 0.045, color: 0xf28a1a, pitch: 0.35 },
      eyes: { r: 0.05, x: 0.06, y: 0.035, z: 0.055, yaw: 0.6, brow: 0.5 },
      wing: { at: [0.33, 0.76, 0.05], len: 0.5, width: 0.62, color: 0xfbfbf7, tip: 0xe6e6de, tilt: 1.25, rest: 0.2 },
      tail: { at: [0, 0.7, -0.62], size: [0.14, 0.07, 0.18], color: 0xfbfbf7, pitch: -0.4 },
      extra(r) {
        part(r.beak, 'sphere', BLACK, [0, 0.04, 0.025], [0.034, 0.04, 0.045]); // knob
        part(r.head, 'sphere', BLACK, [0, -0.015, 0.085], [0.058, 0.05, 0.05]); // face mask
        part(r.head, 'crown', mat(0xffcc33, { metal: 0.6, rough: 0.3, glow: 0.2 }), [0, 0.095, -0.01], [0.06, 0.07, 0.06], [-0.2, 0, 0]);
        addBand(r, r.body, [0, 0.8, 0.46], 0.095, { tilt: -0.5 });
      },
    });
  },

  kormoran(rig) {
    bird(rig, {
      hip: 0.2, legX: 0.09, legR: 0.03, legColor: 0x151515, foot: 0.16,
      torso: { at: [0, 0.52, 0], size: [0.22, 0.36, 0.24], pitch: 0.25, color: 0x22252b },
      neck: { pts: [[0, 0.8, 0.08], [0, 0.92, 0.15], [0, 1.0, 0.13]], r: 0.065, color: 0x22252b },
      head: { off: [0, 0, 0.02], r: 0.095, stretch: [0.9, 0.95, 1.1], color: 0x22252b },
      beak: { at: [0, -0.01, 0.085], len: 0.26, r: 0.032, color: 0x5a5d63, pitch: 0.05, hook: true },
      eyes: { r: 0.047, x: 0.055, y: 0.03, z: 0.05, yaw: 0.6, brow: 0.3, browColor: 0x6d7a5a },
      wing: { at: [0.2, 0.74, -0.02], len: 0.52, width: 0.3, color: 0x3d3826, tip: 0x15171b, tilt: 0.3, rest: 1.0 },
      extra(r) {
        part(r.body, 'cone', 0x15171b, [0, 0.4, -0.13], [0.1, 0.03, 0.3], [-0.64, PI, 0]); // stiff tail prop
        part(r.head, 'sphere', 0xf2a51a, [0, -0.065, 0.075], [0.06, 0.055, 0.09]); // yellow throat patch
        part(r.head, 'sphere', 0xeeeee6, [0, -0.045, -0.005], [0.1, 0.055, 0.07]); // white cheek
        addBand(r, r.neck, [0, 0.01, 0.0], 0.08, { tilt: -0.3 });
      },
    });
  },

  ente(rig) {
    rig.swimBody = 0.4;
    bird(rig, {
      hip: 0.15, legX: 0.08, legR: 0.025, legColor: 0xff8c1a, foot: 0.11,
      torso: { at: [0, 0.35, -0.02], size: [0.24, 0.19, 0.36], pitch: -0.05, color: 0xc2c0b5 },
      neck: { pts: [[0, 0.45, 0.2], [0, 0.55, 0.24]], r: 0.075, color: mat(0x1d7a3e, { metal: 0.4, rough: 0.3, glow: 0.12 }) },
      head: { off: [0, 0.08, 0.02], r: 0.12, stretch: [1, 0.95, 1.1], color: mat(0x1d7a3e, { metal: 0.4, rough: 0.3, glow: 0.12 }) },
      beak: { at: [0, -0.02, 0.1], shape: 'bill', len: 0.15, r: 0.03, w: 0.058, h: 0.024, color: 0xf3c63a, pitch: 0.15 },
      eyes: { r: 0.054, x: 0.066, y: 0.04, z: 0.06, yaw: 0.5, brow: 0.3 },
      wing: { at: [0.22, 0.42, 0.02], len: 0.28, width: 0.36, color: 0x8f8676, tip: 0x5a5244, tilt: 1.3, rest: 0.08 },
      extra(r) {
        part(r.body, 'sphere', 0x6e3a22, [0, 0.34, 0.19], [0.21, 0.17, 0.18]); // chestnut breast
        part(r.body, 'sphere', 0x161616, [0, 0.42, -0.3], [0.13, 0.12, 0.12]);
        part(r.body, 'sphere', WHITE, [0, 0.43, -0.39], [0.1, 0.05, 0.07]);
        part(r.body, 'arc', 0x161616, [0, 0.54, -0.33], [0.04, 0.04, 0.05], [0, PI / 2, 0]); // drake curl
        part(r.neck, 'torus', WHITE, [0, 0.06, 0.022], [0.078, 0.078, 0.05], [PI / 2 - 0.3, 0, 0]); // white collar
        for (const w of r.wings) part(w, 'box', 0x3b4bff, [0, -0.15, 0.02], [w.userData.thick * 2.3, 0.06, 0.14]);
        // Quak Force One: team-colored aviator cap with goggles
        part(r.head, 'dome', r.teamMat, [0, 0.025, -0.015], [0.125, 0.105, 0.13], [-0.25, 0, 0]);
        for (const s of [1, -1]) part(r.head, 'cyl', mat(0x9fe3ff, { metal: 0.4, rough: 0.3, glow: 0.12 }), [s * 0.04, 0.1, 0.07], [0.03, 0.02, 0.03], [0.9, 0, 0]);
      },
    });
  },

  taube(rig) {
    rig.headBob = 0.04;
    const shine = c => mat(c, { metal: 0.5, rough: 0.25, glow: 0.15 });
    bird(rig, {
      hip: 0.12, legX: 0.07, legR: 0.022, legColor: 0xd9556b, foot: 0.085,
      torso: { at: [0, 0.32, -0.02], size: [0.2, 0.2, 0.29], pitch: -0.1, color: 0x8a93a6 },
      neck: { pts: [[0, 0.42, 0.12], [0, 0.5, 0.15]], r: 0.085, color: shine(0x2fae74) },
      head: { off: [0, 0.06, 0.02], r: 0.095, stretch: [1, 1, 1.05], color: 0x6c7590 },
      beak: { at: [0, -0.015, 0.085], len: 0.075, r: 0.022, color: 0x2a2a2a, pitch: 0.2 },
      eyes: { r: 0.05, x: 0.058, y: 0.03, z: 0.05, yaw: 0.55, brow: -0.3, browColor: 0x4a5060 },
      wing: { at: [0.19, 0.4, 0.04], len: 0.26, width: 0.32, color: 0x9aa3b6, tip: 0x4a505c, tilt: 1.3, rest: 0.1 },
      tail: { at: [0, 0.33, -0.31], size: [0.1, 0.03, 0.13], color: 0x7c8598, pitch: 0.1 },
      extra(r) {
        part(r.body, 'sphere', 0xa49bb3, [0, 0.36, 0.13], [0.17, 0.17, 0.15]);
        part(r.tail, 'box', 0x2e323b, [0, 0, -0.1], [0.17, 0.05, 0.05]);
        part(r.neck, 'sphere', shine(0x9a3fc0), [0, 0.03, 0.065], [0.075, 0.065, 0.045]); // purple bib
        for (const s of [1, -1]) part(r.neck, 'sphere', shine(0x8a3fc0), [s * 0.065, 0.06, 0.02], [0.035, 0.05, 0.05]);
        part(r.beak, 'sphere', 0xf2f2f2, [0, 0.012, 0.012], [0.022, 0.014, 0.025]); // cere
        for (const w of r.wings) for (const y of [-0.12, -0.17]) part(w, 'box', 0x2a2d35, [0, y, -0.02], [w.userData.thick * 2.3, 0.022, 0.2]);
        // Gurr-Syndikat: team fedora with black band
        const hat = grp(r.head, [0, 0.075, -0.01], [-0.15, 0, 0.12]);
        part(hat, 'cyl', r.teamMat, [0, 0, 0], [0.13, 0.012, 0.13]);
        part(hat, 'cyl', r.teamMat, [0, 0.04, 0], [0.075, 0.07, 0.07]);
        part(hat, 'cyl', 0x161616, [0, 0.02, 0], [0.078, 0.018, 0.073]);
      },
    });
  },

  kraehe(rig) {
    const gloss = mat(0x23252e, { metal: 0.25, rough: 0.32 });
    bird(rig, {
      hip: 0.17, legX: 0.07, legR: 0.022, legColor: 0x15161a, foot: 0.09,
      torso: { at: [0, 0.38, -0.03], size: [0.17, 0.18, 0.33], pitch: -0.12, color: gloss },
      neck: { pts: [[0, 0.48, 0.13], [0, 0.55, 0.16]], r: 0.085, color: gloss },
      head: { off: [0, 0.08, 0.02], r: 0.115, stretch: [1, 1, 1.08], color: gloss },
      beak: { at: [0, -0.01, 0.09], len: 0.18, r: 0.048, color: 0x5b606a, pitch: 0.12 },
      eyes: { r: 0.054, x: 0.064, y: 0.035, z: 0.06, yaw: 0.5, brow: [0.6, -0.2], browColor: 0x8a90a8 },
      wing: { at: [0.16, 0.46, 0.04], len: 0.32, width: 0.4, color: gloss, tip: mat(0x14151a, { metal: 0.25, rough: 0.32 }), tilt: 1.25, rest: 0.1 },
      tail: { at: [0, 0.39, -0.38], size: [0.1, 0.025, 0.22], color: 0x191a20, pitch: 0.2 },
      extra(r) {
        part(r.neck, 'ball', mat(0x191a20, { metal: 0.25, rough: 0.32 }), [0, -0.01, 0.06], [0.085, 0.075, 0.06]); // shaggy throat
        addBand(r, r.neck, [0, -0.01, 0.0], 0.095, { tilt: -0.3 });
      },
    });
  },

  elster(rig) {
    const inked = c => mat(c, { metal: 0.2, rough: 0.35 }), ink = inked(0x16181f);
    const sheen = c => mat(c, { metal: 0.5, rough: 0.25, glow: 0.25 });
    bird(rig, {
      hip: 0.17, legX: 0.07, legR: 0.02, legColor: 0x15161a, foot: 0.085,
      torso: { at: [0, 0.38, -0.02], size: [0.19, 0.19, 0.3], pitch: -0.05, color: ink },
      neck: { pts: [[0, 0.48, 0.13], [0, 0.55, 0.16]], r: 0.08, color: ink },
      head: { off: [0, 0.08, 0.02], r: 0.11, stretch: [1, 1, 1.08], color: ink },
      beak: { at: [0, -0.01, 0.09], len: 0.13, r: 0.036, color: inked(0x111111), pitch: 0.1 },
      eyes: { r: 0.052, x: 0.062, y: 0.035, z: 0.06, yaw: 0.5, brow: 0.4, browColor: inked(0x2fa3ff) },
      wing: { at: [0.18, 0.46, 0.04], len: 0.3, width: 0.38, color: sheen(0x1a3470), tip: sheen(0x0d0f14), tilt: 1.25, rest: 0.1 },
      tail: { at: [0, 0.46, -0.55], size: [0.06, 0.025, 0.4], color: sheen(0x1f5aa8), pitch: 0.3 },
      extra(r) {
        part(r.body, 'sphere', inked(WHITE), [0, 0.33, 0.04], [0.172, 0.15, 0.23]); // white belly
        part(r.tail, 'sphere', sheen(0x23a37a), [0, 0.12, -0.4], [0.05, 0.022, 0.12], [0.3, 0, 0]);
        for (const w of r.wings) part(w, 'sphere', sheen(WHITE), [0, -0.08, 0.03], [w.userData.thick * 1.2, 0.1, 0.12]); // scapular patch
        // Glitzerdiebe: team bandit mask across the eyes
        addBand(r, r.head, [0, 0.035, 0.0], 0.112, { height: 0.9, tails: 0.7 });
      },
    });
  },

  sittich(rig) {
    // rose-ringed parakeet: upright green pear, chunky head, red hook beak, black+pink neck ring, very long tail
    bird(rig, {
      hip: 0.11, legX: 0.06, legR: 0.022, legColor: 0x8c8288, foot: 0.07,
      torso: { at: [0, 0.29, 0], size: [0.16, 0.21, 0.17], pitch: 0.3, color: 0x47c43a },
      neck: { pts: [[0, 0.45, 0.05]], r: 0.08, color: 0x52d044 },
      head: { off: [0, 0.13, 0.02], r: 0.14, stretch: [1, 0.95, 1.05], color: 0x5ad648 },
      beak: { at: [0, -0.025, 0.115], len: 0.085, r: 0.062, color: 0xe8221a, pitch: 0.55, hook: true },
      eyes: { r: 0.07, x: 0.078, y: 0.045, z: 0.085, yaw: 0.45, brow: [-0.4, 0.6], browColor: 0x1d6a22 },
      wing: { at: [0.14, 0.42, -0.01], len: 0.38, width: 0.19, color: 0x3aae30, tip: 0x2a7a72, tilt: 0.9, rest: 0.1 },
      tail: { at: [0, 0.16, -0.12], size: [0.06, 0.035, 0.08], color: 0x3aae30, pitch: -0.35 },
      extra(r) {
        part(r.body, 'sphere', 0x9ee06a, [0, 0.27, 0.06], [0.13, 0.17, 0.13], [0.3, 0, 0]); // yellow-green belly
        part(r.tail, 'cone', 0x3aa86a, [0, 0, 0], [0.065, 0.02, 0.45], [-0.3, PI, 0]);
        part(r.tail, 'cone', 0x3f98b0, [0, 0.012, 0], [0.036, 0.015, 0.62], [-0.28, PI, 0]); // long blue central feathers
        // neck ring hugs the bottom of the head: black under the chin, pink rising to the nape
        part(r.head, 'torus', 0x111111, [0, -0.075, 0.0], [0.112, 0.112, 0.07], [PI / 2 + 0.35, 0, 0]);
        part(r.head, 'torus', 0xff7fb0, [0, -0.045, -0.02], [0.118, 0.118, 0.06], [PI / 2 + 0.6, 0, 0]);
        // Kölner Partypapageien: team-colored punk crest (on the ears pivot so it sweeps back in the wind)
        const crest = grp(r.head, [0, 0.11, -0.01]);
        r.ears.push(crest);
        [[0.05, 0.13], [0, 0.17], [-0.05, 0.13]].forEach(([z, len]) => part(crest, 'cone', r.teamMat, [0, 0, z], [0.014, 0.04, len], [-PI / 2 - 0.45, 0, 0]));
      },
    });
  },

  eisvogel(rig) {
    rig.flyer = true; rig.boss = true; rig.flapHz = 9; rig.peck = 0.35; rig.lunge = 0.08;
    // three finishes keep the boss at 14 meshes: satin plumage, matte beak/brows/legs, glowing markings
    const satin = c => mat(c, { metal: 0.25, rough: 0.35, glow: 0.12 }), neon = c => mat(c, { glow: 0.55 });
    const cobalt = satin(0x1f7fe8), orange = satin(0xff7a1a), white = satin(WHITE);
    bird(rig, {
      hip: 0.42, legX: 0.32, legR: 0.07, legColor: 0xff2a2a, foot: 0.28,
      torso: { at: [0, 1.45, 0], size: [0.8, 0.95, 0.78], pitch: 0.2, color: cobalt },
      neck: { pts: [[0, 2.15, 0.2]], r: 0.3, color: cobalt },
      head: { off: [0, 0.45, 0.05], r: 0.85, stretch: [1, 0.95, 1.05], color: cobalt },
      beak: { at: [0, -0.15, 0.72], len: 1.75, r: 0.19, color: 0x111111, pitch: 0.08 },
      eyes: { r: 0.33, x: 0.48, y: 0.18, z: 0.55, yaw: 0.55, brow: 0.65, browColor: 0x0a1a40, browW: 1.7 },
      wing: { at: [0.72, 1.95, 0], len: 2.75, width: 1.6, thick: 0.13, color: cobalt, tip: satin(0x0c3aa8), tilt: 1.15, rest: 0.12 },
      tail: { at: [0, 0.95, -0.75], size: [0.3, 0.1, 0.45], color: 0x1660c8, pitch: 0.5 },
      extra(r) {
        part(r.body, 'sphere', orange, [0, 1.3, 0.28], [0.7, 0.8, 0.58]);
        part(r.body, 'sphere', neon(0x3ff0ff), [0, 1.75, -0.6], [0.22, 0.7, 0.16], [0.2, 0, 0]); // back stripe
        part(r.head, 'sphere', white, [0, -0.62, 0.42], [0.45, 0.3, 0.35]); // throat
        for (const s of [1, -1]) {
          part(r.head, 'sphere', orange, [s * 0.42, -0.2, 0.62], [0.2, 0.17, 0.2]); // lore
          part(r.head, 'sphere', orange, [s * 0.68, -0.12, -0.12], [0.24, 0.22, 0.32]); // ear patch
          part(r.head, 'sphere', white, [s * 0.66, -0.5, -0.25], [0.2, 0.24, 0.24]); // neck flash
        }
        const spots = neon(0x8ff4ff);
        [[0.2, 0.78, 0.25], [-0.25, 0.75, 0.15], [0.05, 0.82, -0.15], [0.4, 0.62, -0.1], [-0.42, 0.6, 0.05], [0, 0.66, 0.5]]
          .forEach(p => part(r.head, 'ball', spots, p, 0.07));
      },
    });
  },

  nutria(rig) {
    // chunky river rat: round barrel body, big head, orange buck teeth, scaly tail, team neckerchief
    rig.gait = 'scurry'; rig.peck = 0.45; rig.lunge = 0.15;
    const { body } = rig, fur = 0x7a5233, dark = 0x3a2a22;
    part(body, 'sphere', fur, [0, 0.29, -0.06], [0.31, 0.25, 0.42]);
    part(body, 'sphere', 0x5e3d24, [0, 0.38, -0.1], [0.27, 0.17, 0.36]); // shaggy back
    part(body, 'sphere', 0x9a7350, [0, 0.22, 0.02], [0.23, 0.14, 0.3]);
    [[1, 0.22, 0], [-1, 0.22, PI], [1, -0.28, PI], [-1, -0.28, 0]].forEach(([side, z, phase]) => {
      const L = grp(body, [side * 0.18, 0.13, z]);
      part(L, 'limb', fur, [0, 0, 0], [0.065, 0.11, 0.065]);
      const hind = z < 0; // webbed hind feet
      part(L, 'sphere', dark, [0, -0.105, 0.04], hind ? [0.08, 0.03, 0.12] : [0.06, 0.03, 0.08]);
      rig.legs.push({ g: L, phase });
    });
    rig.tail = grp(body, [0, 0.2, -0.44]);
    part(rig.tail, 'cone', 0x4e403c, [0, 0, 0], [0.055, 0.055, 0.6], [-0.25, PI, 0]); // round rat tail
    rig.neck = grp(body, [0, 0.38, 0.3]);
    const head = rig.head = grp(rig.neck, [0, 0.03, 0.1]);
    part(head, 'sphere', fur, [0, 0, 0], [0.18, 0.16, 0.2]);
    part(head, 'sphere', 0xe6dccd, [0, -0.05, 0.16], [0.12, 0.085, 0.11]); // pale muzzle
    part(head, 'sphere', 0x3a2020, [0, 0.0, 0.27], [0.05, 0.034, 0.03]); // nose
    rig.jaw = grp(head, [0, -0.1, 0.21]);
    for (const s of [1, -1]) part(rig.jaw, 'box', 0xff7a12, [s * 0.026, -0.045, 0.02], [0.046, 0.11, 0.024]); // buck teeth
    part(head, 'whiskers', 0xf4f0e8, [0, -0.03, 0.24], 0.14);
    for (const s of [1, -1]) part(head, 'sphere', dark, [s * 0.14, 0.12, -0.05], [0.05, 0.05, 0.028]); // round ears
    addEyes(rig, head, { r: 0.07, x: 0.095, y: 0.07, z: 0.11, yaw: 0.4, brow: 0.5, browColor: 0x2a1a10 });
    // team bandana, knotted at the back of the head
    const bandana = grp(head, [0, 0.04, -0.02], [-0.3, 0, 0]);
    part(bandana, 'dome', rig.teamMat, [0, 0, 0], [0.19, 0.14, 0.21]);
    addBand(rig, bandana, [0, 0.1, 0.05], 0.19, { ring: false, tails: 0.7 });
    rig.muzzle = grp(head, [0, -0.06, 0.28]);
    rig.swimDrop = 0.2 + 0.26 * 0.5;
  },

  kaninchen(rig) {
    rig.gait = 'hop'; rig.peck = 0.3;
    const { body } = rig, fur = 0xd9c4a8, cream = 0xf4ead8, pink = 0xff9ec0;
    part(body, 'sphere', fur, [0, 0.26, -0.04], [0.23, 0.24, 0.27]);
    part(body, 'sphere', fur, [0, 0.4, 0.05], [0.17, 0.17, 0.15]);
    part(body, 'sphere', cream, [0, 0.32, 0.12], [0.13, 0.15, 0.1]);
    const legs = grp(body, [0, 0.16, -0.02]); // hop gait: both hind legs kick together
    rig.legs.push({ g: legs, phase: 0 });
    [1, -1].forEach(side => {
      part(legs, 'sphere', fur, [side * 0.14, 0, 0], [0.09, 0.13, 0.15]);
      part(legs, 'sphere', cream, [side * 0.14, -0.13, 0.1], [0.07, 0.035, 0.16]); // big back foot
      const A = grp(body, [side * 0.08, 0.36, 0.15]);
      part(A, 'sphere', fur, [0, -0.06, 0.02], [0.042, 0.075, 0.045]);
      rig.arms.push({ g: A, phase: side > 0 ? 0 : PI });
    });
    rig.throwArm = rig.arms[1].g;
    rig.tail = grp(body, [0, 0.2, -0.3]);
    [[0, 0, 0, 0.08], [0.04, 0.03, -0.02, 0.05], [-0.04, 0.02, -0.02, 0.05]].forEach(([x, y, z, s]) => part(rig.tail, 'ball', WHITE, [x, y, z], s));
    rig.neck = grp(body, [0, 0.5, 0.08]);
    const head = rig.head = grp(rig.neck, [0, 0.08, 0.02]);
    part(head, 'sphere', fur, [0, 0, 0], [0.165, 0.15, 0.15]);
    for (const s of [1, -1]) part(head, 'sphere', cream, [s * 0.05, -0.04, 0.11], 0.06);
    part(head, 'sphere', pink, [0, 0.0, 0.155], [0.028, 0.022, 0.02]);
    rig.jaw = grp(head, [0, -0.07, 0.13]);
    for (const s of [1, -1]) part(rig.jaw, 'box', WHITE, [s * 0.012, -0.015, 0.01], [0.022, 0.04, 0.012]);
    part(head, 'whiskers', 0x8a7a6a, [0, -0.025, 0.15], 0.1);
    addEyes(rig, head, { r: 0.062, x: 0.075, y: 0.04, z: 0.1, yaw: 0.3, brow: 0.25, browColor: 0x6a4a30 });
    const ears = grp(head, [0, 0.12, -0.02]); // one pivot for both ears, the right one flops back
    rig.ears.push(ears);
    [1, -1].forEach(side => {
      const E = grp(ears, [side * 0.06, 0, 0], [side > 0 ? -0.15 : 0.35, 0, -side * 0.2]);
      part(E, 'sphere', fur, [0, 0.22, 0], [0.058, 0.25, 0.032]);
      part(E, 'sphere', pink, [0, 0.21, 0.022], [0.036, 0.19, 0.014]);
    });
    // Möhrenmiliz: team headband, Rambo style
    addBand(rig, head, [0, 0.1, -0.01], 0.145, { height: 0.55, tails: 1.3, tilt: -0.25 });
    rig.muzzle = grp(head, [0, -0.02, 0.2]);
    rig.swimDrop = 0.25;
  },

  mensch(rig) {
    // Parkbesucher: grumpy dad in a hoodie, belly first, cargo shorts, socks in sandals, team cap, bread bag
    rig.gait = 'walk'; rig.peck = 0.25; rig.lunge = 0.06;
    const { body } = rig, hoodie = 0x6f7f99, hoodDark = 0x56647c, shorts = 0xb39a68, skin = 0xf0b892, sock = 0xf4f4ee, sandal = 0x6a4326;
    [1, -1].forEach(side => {
      const L = grp(body, [side * 0.15, 0.5, 0]);
      part(L, 'limb', shorts, [0, 0.02, 0], [0.14, 0.2, 0.14]);
      part(L, 'limb', skin, [0, -0.15, 0], [0.09, 0.2, 0.09]); // calf
      part(L, 'cyl', sock, [0, -0.37, 0], [0.085, 0.13, 0.085]);
      part(L, 'sphere', sock, [0, -0.43, 0.13], [0.075, 0.045, 0.08]); // sock toes
      part(L, 'box', sandal, [0, -0.47, 0.06], [0.19, 0.06, 0.32]);
      part(L, 'box', sandal, [0, -0.42, 0.1], [0.17, 0.03, 0.05]); // strap
      rig.legs.push({ g: L, phase: side > 0 ? 0 : PI });
    });
    part(body, 'sphere', shorts, [0, 0.58, 0], [0.3, 0.16, 0.24]);
    part(body, 'sphere', hoodie, [0, 0.85, 0.03], [0.4, 0.38, 0.36]); // the belly
    part(body, 'sphere', hoodie, [0, 1.12, -0.03], [0.36, 0.26, 0.28]); // shoulders
    part(body, 'box', hoodDark, [0, 0.73, 0.35], [0.3, 0.13, 0.05], [0.35, 0, 0]); // kangaroo pocket
    part(body, 'sphere', hoodDark, [0, 1.27, -0.2], [0.25, 0.14, 0.17]); // hood
    for (const s of [1, -1]) part(body, 'limb', WHITE, [s * 0.07, 1.3, 0.25], [0.014, 0.17, 0.014], [0.25, 0, 0]);
    [1, -1].forEach(side => {
      const A = grp(body, [side * 0.4, 1.17, 0], [0, 0, side * 0.3]);
      part(A, 'limb', hoodie, [0, 0, 0], [0.1, 0.42, 0.1]);
      part(A, 'cyl', hoodDark, [0, -0.42, 0], [0.085, 0.05, 0.085]); // cuff
      part(A, 'ball', skin, [0, -0.5, 0], 0.095);
      rig.arms.push({ g: A, phase: side > 0 ? PI : 0 });
      if (side > 0) { // bread bag for the ducks, held like a weapon
        const bag = grp(A, [0, -0.66, 0.05], [0, 0, -side * 0.3]);
        part(bag, 'box', 0xe8b46a, [0, -0.03, 0], [0.17, 0.24, 0.11]); // sliced loaf
        part(bag, 'box', 0xa8642a, [0, -0.03, 0.056], [0.172, 0.24, 0.012]); // crust end
        part(bag, 'sphere', mat(0xf4f8ff, { opacity: 0.45, rough: 0.2 }), [0, 0, 0], [0.12, 0.19, 0.09]);
        part(bag, 'cone', 0xf4f8ff, [0, 0.17, 0], [0.035, 0.035, 0.08], [-PI / 2, 0, 0]);
        part(bag, 'cyl', 0xffcf33, [0, 0.19, 0], [0.026, 0.022, 0.026]); // twist tie
      } else {
        rig.throwArm = A;
        rig.muzzle = grp(A, [0, -0.6, 0.06]);
      }
    });
    rig.neck = grp(body, [0, 1.3, 0.03]);
    const head = rig.head = grp(rig.neck, [0, 0.27, 0.02]);
    part(head, 'sphere', skin, [0, 0, 0], [0.28, 0.27, 0.26]);
    part(head, 'sphere', 0xcf9f82, [0, -0.11, 0.05], [0.25, 0.15, 0.21]); // stubbly jowls
    part(head, 'sphere', 0xe8846a, [0, -0.02, 0.27], [0.075, 0.07, 0.07]); // bulb nose
    part(head, 'sphere', 0x5a3e2a, [0, -0.09, 0.245], [0.13, 0.035, 0.05], [0, 0, 0]); // walrus moustache
    for (const s of [1, -1]) part(head, 'sphere', skin, [s * 0.27, -0.02, -0.02], [0.05, 0.08, 0.045]);
    rig.jaw = grp(head, [0, -0.16, 0.24]);
    part(rig.jaw, 'arc', 0x5a2a2a, [0, -0.02, 0], [0.075, 0.045, 0.05]); // frown
    addEyes(rig, head, { r: 0.085, x: 0.1, y: 0.03, z: 0.2, yaw: 0.25, brow: 0.5, browColor: 0x4a3020, browW: 2, browH: 0.45 });
    const cap = grp(head, [0, 0.13, -0.02], [-0.2, 0, 0]);
    part(cap, 'dome', rig.teamMat, [0, 0, 0], [0.28, 0.19, 0.28]);
    part(cap, 'cyl', rig.teamMat, [0, 0.01, 0.25], [0.2, 0.02, 0.15]); // brim
    part(cap, 'ball', rig.teamMat, [0, 0.19, 0], 0.03);
    rig.swimDrop = 0.7;
  },
};

// ---------- animation ----------

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = v => Math.max(0, Math.min(1, v));
const GAIT_HZ = { waddle: 10, walk: 8, hop: 8, scurry: 16 };

function animate(rig, st, dt, a) {
  dt = Math.min(dt, 0.1);
  st.clock += dt;
  const t = a.t ?? st.clock;
  const k = rate => 1 - Math.exp(-rate * dt);
  st.move += (clamp01(a.move || 0) - st.move) * k(10);
  st.air += ((a.air ? 1 : 0) - st.air) * k(8);
  st.swim += ((a.swim ? 1 : 0) - st.swim) * k(6);
  st.att += ((a.attack || 0) - st.att) * k((a.attack || 0) > st.att ? 45 : 14);
  st.hurt += ((a.hurt || 0) - st.hurt) * k(30);
  st.spec += ((a.special || 0) - st.spec) * k(10);
  st.dead = a.dead ? Math.min(1, st.dead + dt * 3.5) : 0;
  const { pose, model, body, neck, head, jaw, h0, H } = rig;
  const air = st.air, swim = st.swim, att = st.att, spec = st.spec, hurt = st.hurt, dead = st.dead;
  const m = st.move * (1 - air) * (1 - swim * 0.6);
  st.phase += dt * GAIT_HZ[rig.gait] * Math.max(st.move, swim * 0.4);
  const ph = st.phase, s = Math.sin(ph), c = Math.cos(ph);

  // pose (meters, pivot at mid-body): swim drop, hop, wobble, topple
  let py = 0, rx = 0, rz = 0;
  py -= rig.swimDropM * swim;
  py += Math.sin(t * 2.4) * 0.025 * H * swim;
  rz += Math.sin(t * 1.7) * 0.06 * swim;
  if (rig.gait === 'hop') py += Math.max(0, s) * 0.22 * H * m;
  if (a.stun && !a.dead) { rz += Math.sin(t * 6) * 0.2; rx += Math.cos(t * 6) * 0.12; }
  if (rig.boss) { rx += att * 0.95; rx -= spec * 0.35; }
  else if (rig.flyer) rx += air * 0.3;
  rz = lerp(rz, rig.fallSide * 1.45, dead);
  py += dead * (rig.halfW - rig.pivotY);
  pose.position.set(0, rig.pivotY + py, 0);
  pose.rotation.set(rx, 0, rz);

  // model (scale about the feet): breathe, squash on hurt, puff on special, flatten on KO
  const breathe = Math.sin(t * 3) * 0.015;
  const puff = 1 + spec * (rig.boss ? 0.08 : 0.22);
  const sx = (1 + hurt * 0.25 - breathe * 0.5) * puff, sy = (1 - hurt * 0.32 + breathe) * puff * (1 - dead * 0.25);
  model.scale.set(rig.scale * sx, rig.scale * sy, rig.scale * sx);

  // body (model units, pivot at feet): waddle roll, bob, lunge
  body.position.set(0, 0, att * rig.lunge * h0);
  body.rotation.set(0, 0, 0);
  if (rig.gait === 'waddle') { body.rotation.z = s * 0.16 * m; body.position.y = Math.abs(c) * 0.03 * h0 * m; }
  if (rig.gait === 'walk') { body.rotation.z = s * 0.04 * m; body.position.y = Math.abs(c) * 0.025 * h0 * m; body.rotation.x = 0.06 * m; }
  if (rig.gait === 'scurry') { body.rotation.z = s * 0.06 * m; body.position.y = Math.abs(Math.sin(ph * 2)) * 0.02 * h0 * m; }
  if (rig.gait === 'hop') body.rotation.x = (Math.max(0, s) - 0.3) * 0.35 * m;
  st.spin = spec > 0.05 && rig.gait === 'scurry' ? st.spin + dt * 25 * spec : 0; // Zahnwirbel spin
  body.rotation.y = st.spin;

  // legs
  for (const L of rig.legs) {
    let lx = rig.gait === 'hop' ? -Math.max(0, s) * 0.9 * m : Math.sin(ph + L.phase) * (rig.gait === 'scurry' ? 0.9 : 0.7) * m;
    lx = lerp(lx, rig.flyer ? 1.1 : Math.sin(t * 16 + L.phase) * 0.9, air);
    lx += Math.sin(t * 6 + L.phase) * 0.6 * swim;
    L.g.rotation.x = lerp(lx, -0.6, dead);
  }
  // arms (walk swing, throw, flail)
  for (const A of rig.arms) {
    let ax = rig.gait === 'walk' ? Math.sin(ph + A.phase) * 0.6 * m : Math.sin(t * 2 + A.phase) * 0.05;
    ax = lerp(ax, -2.6 + Math.sin(t * 14 + A.phase) * 0.5, air);
    if (A.g === rig.throwArm) ax = lerp(ax, -2.7, att);
    ax = lerp(ax, -1.2, spec * (rig.gait === 'walk' ? 1 : 0.5)); // human: arms up to snap the selfie
    A.g.rotation.x = ax;
  }
  // wings
  for (const w of rig.wings) {
    const u = w.userData;
    let wz = u.rest, tilt = u.tilt;
    const flap = rig.flyer ? 0.85 + Math.sin(t * (rig.flapHz ?? 24)) * 0.75 : 1.0 + Math.sin(t * 17 + u.side) * 0.55;
    wz = lerp(wz, flap, air);
    wz += Math.sin(ph) * 0.08 * m;
    if (rig.boss) {
      wz = lerp(wz, 1.45 + Math.sin(t * 3) * 0.06, spec);
      wz = lerp(wz, 0.35, att); tilt = lerp(tilt, 1.7, att);
    } else {
      wz = lerp(wz, Math.max(wz, 1.2 + Math.sin(t * 9) * 0.1), spec);
      wz = lerp(wz, Math.max(wz, 0.6), att * 0.6);
    }
    const open = clamp01((wz - 0.25) / 1.1);
    tilt = lerp(tilt, 0.15, open);
    w.rotation.set(tilt, 0, u.side * lerp(wz, 0.2, dead));
    w.scale.set(1, lerp(0.62, 1, open), lerp(0.6, 1, open)); // folded wings tuck in, open wings reach full span
  }
  // neck / head / jaw
  if (neck) {
    neck.rotation.x = att * rig.peck - spec * (rig.boss ? 0.45 : 0.15) + (a.stun ? Math.sin(t * 5) * 0.15 : 0) + dead * 0.4;
    neck.rotation.z = Math.sin(t * 1.3) * 0.04;
  }
  if (head && rig.headBob) head.position.z = rig.headZ + Math.sin(ph * 2) * rig.headBob * m;
  if (jaw) jaw.rotation.x = Math.max(att, spec * 0.8) * 0.55;
  if (rig.tail) rig.tail.rotation.y = Math.sin(t * 3) * 0.12 + Math.sin(ph) * 0.3 * m;
  for (const E of rig.ears) E.rotation.x = E.userData.rx - Math.max(0, s) * 0.6 * m - air * 0.7 + Math.sin(t * 2.3 + E.userData.rx) * 0.06;
  for (const f of rig.flutters) f.rotation.x = 0.5 + m * 0.7 + air * 0.6 + Math.sin(t * 9 + f.userData.fid) * (0.12 + m * 0.2);

  // eyes: blink, googly jitter, dizzy circles, squint when hurt, X when KO
  if (t > st.blinkAt) { st.blinkEnd = t + 0.12; st.blinkAt = t + 1.8 + Math.random() * 3.5; }
  const lid = t < st.blinkEnd ? 0.1 : 1 - hurt * 0.65;
  if (rig.lid) rig.lid.scale.y = dead ? 1 : lid;
  for (const [i, e] of rig.eyes.entries()) {
    if (a.stun) { e.tx = Math.cos(t * 9 + i * PI) * 0.3; e.ty = Math.sin(t * 9 + i * PI) * 0.3; }
    else if (t > e.next) {
      e.tx = (Math.random() - 0.5) * 0.55; e.ty = (Math.random() - 0.5) * 0.45;
      e.next = t + 0.2 + Math.random() * 1.4;
    }
    e.jx += (e.tx - e.jx) * k(a.stun ? 60 : 28); e.jy += (e.ty - e.jy) * k(a.stun ? 60 : 28);
    if (a.dead) {
      e.pupil.geometry = g('xeye');
      e.pupil.position.set(0, 0, e.r * 0.92);
      e.pupil.scale.setScalar(e.r * 0.55);
    } else {
      e.pupil.geometry = g('ball');
      e.pupil.position.set(e.jx * e.r, e.jy * e.r, e.r * 0.8);
      e.pupil.scale.set(e.r * 0.54, e.r * 0.54, e.r * 0.32);
    }
  }

  // stun stars (built on first stun, most creatures never need them)
  if (a.stun && !a.dead && !rig.stars) addStars(rig);
  if (rig.stars) {
    rig.stars.visible = !!a.stun && !a.dead;
    rig.stars.rotation.y = t * 4;
    rig.stars.position.y = H * 1.08 + Math.sin(t * 5) * 0.04 * H;
  }

  // hit flash
  const flash = hurt > 0.2 && Math.floor(t * 28) % 2 === 0;
  if (flash !== st.flash) {
    st.flash = flash;
    for (const [mesh, original] of rig.meshes) mesh.material = flash ? FLASH : original;
  }
}

// ---------- public API ----------

function addStars(rig) {
  const starR = Math.max(0.2, rig.H * 0.2), starS = 0.05 + rig.H * 0.025;
  const geo = cachedGeo(`stars:${rig.id}`, () => mergeGeometries([0, 1, 2].map(i => {
    const a = (i / 3) * PI * 2;
    return g('star').clone().scale(starS, starS, starS).rotateY(a).translate(Math.cos(a) * starR, 0, Math.sin(a) * starR);
  })));
  rig.stars = new THREE.Mesh(geo, mat(0xffe14a, { glow: 0.6 }));
  rig.root.add(rig.stars);
}

// Bake every part under `scope` into one mesh per (bone, finish): parts on the same bone never move relative
// to each other, and per-vertex colors let all colors of one finish share a draw call.
// Merged geometry is cached under `key`, so later instances of a species or prop only create meshes.
function bake(scope, bones, key) {
  scope.updateMatrixWorld(true);
  const groups = new Map();
  scope.traverse(o => {
    if (!o.isMesh || o.userData.keep || Array.isArray(o.material)) return;
    let bone = o.parent;
    while (!bones.has(bone)) bone = bone.parent;
    const finish = o.material.userData.finish;
    const material = finish ? finishMat(finish) : o.material;
    const k = `${bone.id}|${material.id}`;
    if (!groups.has(k)) groups.set(k, { bone, material, parts: [] });
    groups.get(k).parts.push(o);
  });
  const toBone = new THREE.Matrix4();
  [...groups.values()].forEach(({ bone, material, parts }, i) => {
    const geo = cachedGeo(`${key}#${i}`, () => {
      const inv = bone.matrixWorld.clone().invert();
      return mergeGeometries(parts.map(o => {
        const pg = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(toBone.multiplyMatrices(inv, o.matrixWorld));
        pg.deleteAttribute('uv');
        if (material.vertexColors) {
          const c = o.material.color, n = pg.attributes.position.count, col = new Float32Array(n * 3);
          for (let v = 0; v < n; v++) col.set([c.r, c.g, c.b], v * 3);
          pg.setAttribute('color', new THREE.BufferAttribute(col, 3));
        }
        return pg;
      }));
    });
    const m = new THREE.Mesh(geo, material);
    m.castShadow = parts.some(o => o.castShadow);
    bone.add(m);
    for (const o of parts) o.removeFromParent();
  });
}

export function buildCreature(id) {
  const rig = newRig(id);
  BUILD[id](rig);
  if (rig.head) rig.headZ = rig.head.position.z;
  for (const E of rig.ears) E.userData.rx = E.rotation.x;
  rig.flutters.forEach((f, i) => { f.userData.fid = i * 1.7; });
  bake(rig.body, new Set([rig.body, rig.neck, rig.headBob ? rig.head : null, rig.jaw, rig.tail, rig.lid,
    ...rig.legs.map(L => L.g), ...rig.arms.map(A => A.g), ...rig.wings, ...rig.ears, ...rig.flutters]), id);

  // normalize to game-scale height: the brief's heights are to the top of the head, ears stick out above
  rig.root.updateMatrixWorld(true);
  const box = new THREE.Box3(), full = new THREE.Box3();
  rig.model.traverse(o => {
    if (!o.isMesh) return;
    full.expandByObject(o);
    if (!rig.ears.includes(o.parent)) box.expandByObject(o);
  });
  rig.h0 = box.max.y;
  rig.H = HEIGHTS[id];
  rig.scale = rig.H / rig.h0;
  rig.model.scale.setScalar(rig.scale);
  rig.halfW = Math.max(box.max.x, -box.min.x) * rig.scale * 0.8;
  rig.pivotY = rig.H * 0.45;
  rig.model.position.y = -rig.pivotY;
  rig.swimDropM = (rig.swimDrop ?? 0) * rig.scale;
  rig.fallSide = Math.random() < 0.5 ? 1 : -1;

  rig.meshes = [];
  rig.root.traverse(o => { if (o.isMesh) rig.meshes.push([o, o.material]); });
  rig.stars = null;

  const st = { clock: 0, move: 0, air: 0, swim: 0, att: 0, hurt: 0, spec: 0, dead: 0, phase: 0, spin: 0, blinkAt: 2.5 + Math.random() * 3, blinkEnd: 0, flash: false };
  animate(rig, st, 0, {});
  return {
    root: rig.root,
    height: full.max.y * rig.scale,
    muzzle: rig.muzzle,
    setTeamColor(hex) { rig.teamMat.color.setHex(hex); },
    update(dt, a) { animate(rig, st, dt, a); },
  };
}

const PROPS = {
  fish(o) {
    const scale = mat(0x8fb4d0, { metal: 0.4, rough: 0.35 });
    part(o, 'sphere', scale, [0, 0, 0], [0.075, 0.11, 0.2]);
    part(o, 'sphere', 0x4f7898, [0, 0.04, -0.01], [0.06, 0.07, 0.17]);
    part(o, 'cone', 0x6f9cc0, [0, 0, -0.33], [0.015, 0.12, 0.15]);
    part(o, 'cone', 0x6f9cc0, [0, 0.08, -0.05], [0.012, 0.07, 0.12], [-0.5, 0, 0]);
    for (const s of [1, -1]) {
      part(o, 'ball', WHITE, [s * 0.055, 0.025, 0.12], 0.032);
      part(o, 'ball', BLACK, [s * 0.075, 0.025, 0.13], 0.016);
    }
  },
  carrot(o) {
    part(o, 'cone', mat(0xff7a1a, { rough: 0.6 }), [0, 0, -0.17], [0.075, 0.075, 0.42]);
    for (const a of [-0.5, 0, 0.5]) part(o, 'cone', 0x3fae3a, [0, 0, -0.15], [0.03, 0.012, 0.16], [a, PI, 0]);
  },
  poop(o) {
    const brown = mat(0x6b4423, { rough: 0.5 });
    part(o, 'sphere', brown, [0, 0, 0], [0.15, 0.08, 0.15]);
    part(o, 'sphere', brown, [0, 0.085, 0], [0.11, 0.07, 0.11]);
    part(o, 'sphere', brown, [0, 0.155, 0], [0.07, 0.055, 0.07]);
    part(o, 'cone', brown, [0, 0.18, 0], [0.035, 0.035, 0.08], [-PI / 2 + 0.3, 0, 0]);
    for (const s of [1, -1]) {
      part(o, 'ball', WHITE, [s * 0.04, 0.1, 0.1], 0.03);
      part(o, 'ball', BLACK, [s * 0.04, 0.1, 0.125], 0.014);
    }
  },
  nut(o) {
    part(o, 'sphere', 0xa0662a, [0, -0.02, 0], [0.09, 0.11, 0.09]);
    part(o, 'dome', 0x6b4a2a, [0, 0.02, 0], [0.1, 0.07, 0.1]);
    part(o, 'cyl', 0x5a3a1a, [0, 0.1, 0], [0.012, 0.05, 0.012]);
  },
  bignut(o) {
    part(o, 'ball', 0xc49a62, [0, 0, 0], [0.3, 0.27, 0.32]);
    part(o, 'torus', 0x9a7442, [0, 0, 0], [0.31, 0.29, 0.25], [0, PI / 2, 0]);
    part(o, 'limb', 0x2a2a2a, [0, 0.36, 0], [0.025, 0.1, 0.025], [PI, 0, 0]);
    part(o, 'ball', mat(0xffb020, { glow: 1.2 }), [0, 0.38, 0], 0.05);
  },
  cherry(o) {
    part(o, 'sphere', mat(0xd8102a, { metal: 0.3, rough: 0.2, glow: 0.12 }), [0, 0, 0], [0.1, 0.092, 0.1]);
    part(o, 'ball', WHITE, [0.04, 0.045, 0.06], 0.022); // shine
    part(o, 'limb', 0x5a7a2a, [0, 0.07, 0], [0.012, 0.15, 0.012], [PI - 0.5, 0, 0]); // stem trails back in flight
    part(o, 'sphere', 0x3fae3a, [0.03, 0.2, -0.08], [0.05, 0.01, 0.025], [0, 0.6, 0.3]);
  },
  cap(o) {
    part(o, 'cyl', mat(0xd8dde4, { metal: 0.8, rough: 0.25 }), [0, 0, 0], [0.15, 0.045, 0.15]);
    part(o, 'cyl', 0xe23b3b, [0, 0.024, 0], [0.12, 0.01, 0.12]);
  },
  quack(o) { shout(o, 'QUAK!'); },
  honk(o) { shout(o, 'HUP!'); },
  bread(o) {
    const geo = cachedGeo('toast', () => {
      const s = new THREE.Shape();
      s.moveTo(-0.13, -0.15); s.lineTo(0.13, -0.15); s.lineTo(0.13, 0.06);
      s.absarc(0.07, 0.08, 0.075, -0.3, PI * 0.85, false);
      s.absarc(-0.07, 0.08, 0.075, PI * 0.15, PI * 1.3, false);
      s.lineTo(-0.13, -0.15);
      return new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: false }).center();
    });
    const m = new THREE.Mesh(geo, [mat(0xf2d79a), mat(0xb8742e)]);
    m.castShadow = true;
    o.add(m);
  },
  chick(o) {
    const yellow = 0xffd93a, beak = 0xff8a1a;
    part(o, 'sphere', yellow, [0, 0.11, 0], [0.11, 0.1, 0.12]);
    part(o, 'sphere', yellow, [0, 0.23, 0.06], 0.08);
    part(o, 'ball', yellow, [0, 0.31, 0.05], 0.025);
    part(o, 'bill', beak, [0, 0.22, 0.13], [0.035, 0.014, 0.03]);
    for (const s of [1, -1]) {
      part(o, 'ball', WHITE, [s * 0.04, 0.25, 0.115], 0.03);
      part(o, 'ball', BLACK, [s * 0.042, 0.25, 0.14], 0.015);
      part(o, 'sphere', 0xf0c020, [s * 0.1, 0.12, -0.01], [0.025, 0.05, 0.07], [0, 0, s * 0.4]);
      part(o, 'foot', beak, [s * 0.04, 0.005, 0.04], [0.035, 0.01, 0.05]);
    }
  },
  pigeon(o) {
    part(o, 'sphere', 0x8a93a6, [0, 0, 0], [0.09, 0.09, 0.14]);
    part(o, 'sphere', mat(0x2fae74, { metal: 0.5, rough: 0.25, glow: 0.15 }), [0, 0.06, 0.09], [0.06, 0.06, 0.05]);
    part(o, 'sphere', 0x6c7590, [0, 0.1, 0.12], 0.055);
    part(o, 'cone', 0x2a2a2a, [0, 0.09, 0.17], [0.014, 0.012, 0.045]);
    part(o, 'sphere', 0x4a505c, [0, 0.01, -0.16], [0.05, 0.015, 0.07]);
    for (const s of [1, -1]) {
      part(o, 'sphere', 0x9aa3b6, [s * 0.15, 0.04, 0], [0.13, 0.012, 0.07], [0, 0, s * 0.25]);
      part(o, 'ball', WHITE, [s * 0.035, 0.12, 0.155], 0.024);
      part(o, 'ball', BLACK, [s * 0.037, 0.12, 0.175], 0.012);
    }
  },
  crown(o) { // the phase-1 winner's crown; the game sizes and places it on the head
    part(o, 'crown', mat(0xffcc33, { metal: 0.6, rough: 0.3, glow: 0.2 }), [0, 0, 0], 0.165);
  },
  bossfish(o) {
    part(o, 'sphere', 0x5d8a3a, [0, 0, 0], [0.15, 0.19, 0.45]);
    part(o, 'sphere', 0xe8e070, [0, -0.07, 0.02], [0.12, 0.12, 0.38]);
    part(o, 'cone', 0x4a7030, [0, 0, -0.68], [0.025, 0.24, 0.28]);
    part(o, 'cone', 0x4a7030, [0, 0.15, -0.15], [0.02, 0.12, 0.22], [-0.5, 0, 0]);
    for (const s of [1, -1]) {
      part(o, 'ball', WHITE, [s * 0.1, 0.06, 0.3], 0.06);
      part(o, 'ball', BLACK, [s * 0.14, 0.06, 0.32], 0.03);
      part(o, 'box', BLACK, [s * 0.11, 0.12, 0.32], [0.07, 0.015, 0.03], [0, 0, s * 0.5]);
    }
    for (const x of [-0.04, 0, 0.04]) part(o, 'cone', WHITE, [x, -0.03, 0.42], [0.012, 0.012, 0.035], [PI / 2, 0, 0]);
  },
};

// cartoon shockwave: two rings plus the sound word as a sprite
function shout(o, word) {
  const ring = mat(0xffe14a, { glow: 0.6 });
  part(o, 'torus', ring, [0, 0, 0], [0.3, 0.3, 0.4]);
  part(o, 'torus', ring, [0, 0, -0.12], [0.2, 0.2, 0.3]);
  o.add(wordSprite(word));
}
const wordTex = {};
function wordSprite(word) {
  if (!wordTex[word]) {
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 128;
    const c = cv.getContext('2d');
    c.font = '900 84px "Arial Black", Impact, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.lineWidth = 14; c.strokeStyle = '#3a2a00'; c.strokeText(word, 128, 66);
    c.fillStyle = '#ffe14a'; c.fillText(word, 128, 66);
    wordTex[word] = new THREE.CanvasTexture(cv);
    wordTex[word].colorSpace = THREE.SRGBColorSpace;
  }
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: wordTex[word], depthWrite: false, depthTest: false }));
  sp.scale.set(0.56, 0.28, 1);
  sp.renderOrder = 10;
  return sp;
}

const propTemplates = new Map();
// Props face +Z (direction of travel); geometry and materials are shared between clones.
export function buildProp(name) {
  let tpl = propTemplates.get(name);
  if (!tpl) {
    tpl = new THREE.Group();
    PROPS[name](tpl);
    bake(tpl, new Set([tpl]), `prop:${name}`);
    propTemplates.set(name, tpl);
  }
  return tpl.clone();
}
