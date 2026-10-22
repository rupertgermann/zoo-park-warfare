// The arena: a bright cartoon city park. See docs/brief.md ("src/park.js") for the contract.
// Static scenery is merged into one vertex-coloured mesh so the whole park costs a few dozen draw calls.
// Colliders: {x,z,r,h} circles or {x,z,hx,hz,h} axis-aligned boxes (hx/hz are HALF extents).
// The layout is seeded: rng() call order below decides where trees and bushes land, so do not reorder the build steps.
import * as THREE from 'three';
import { toon } from './toon.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, grassTexture, waterTexture, signAtlas, signUV, windowTexture, SIGN } from './park-textures.js';

const HALF_X = 55;
const HALF_Z = 40;
const SURF_Y = -0.2; // visible water surface
const WATER_LEVEL = -0.35; // where swimmers' roots sit
const BED_Y = -1.3;

const POND = { a: 15, b: 9.5 };
const ISLAND = { x: 1.5, z: -0.5, r: 2.6 };
const RING = { a: 22, b: 16 };
const PLAZA = { x: -38, z: -12 };
const PLAY = { x: 40, z: -14 };
const KIOSK = { x: 13, z: 31 };

const SPAWNS = [
  { x: -6, z: 27 },
  { x: -36, z: 8.7 },
  { x: -22, z: -22.6 },
  { x: 22, z: -22.6 },
  { x: 36, z: 8.7 },
];
const PICKUPS = [
  { x: 0, z: -15 }, { x: 0, z: 15 }, { x: -27, z: 13 }, { x: 27, z: 14 }, { x: -27, z: -11 },
  { x: 27, z: -11 }, { x: -10, z: -32 }, { x: 8, z: -31 }, { x: -12, z: 18 }, { x: 20.5, z: 2 },
];

const SEED = 20240607;
const NP = 96; // pond outline samples

// ---------- pond shape (single source of truth for mesh and isWater) ----------
function pondR(th) {
  const c = Math.cos(th), s = Math.sin(th);
  const e = (POND.a * POND.b) / Math.hypot(POND.b * c, POND.a * s);
  return e * (1 + 0.09 * Math.sin(3 * th + 0.7) + 0.05 * Math.sin(5 * th + 2.1) + 0.03 * Math.sin(2 * th + 1.3));
}
const MAXR2 = (POND.a * 1.2) ** 2;
function isWater(x, z) {
  const d2 = x * x + z * z;
  if (d2 > MAXR2) return false;
  if (Math.hypot(x - ISLAND.x, z - ISLAND.z) < ISLAND.r) return false;
  return Math.sqrt(d2) < pondR(Math.atan2(z, x));
}
const pondGap = (x, z) => Math.hypot(x, z) - pondR(Math.atan2(z, x)); // > 0 on land, approx metres from shore

function waveY(x, z, t) {
  return SURF_Y + 0.03 * Math.sin(x * 0.32 + t * 1.2) + 0.025 * Math.sin(z * 0.41 - t * 0.9) + 0.015 * Math.sin((x + z) * 0.8 + t * 2.1);
}

const POND_PTS = [], POND_OUT = [];
for (let i = 0; i < NP; i++) {
  const th = (i / NP) * Math.PI * 2, r = pondR(th);
  POND_PTS.push([r * Math.cos(th), r * Math.sin(th)]);
  POND_OUT.push([(r + 0.55) * Math.cos(th), (r + 0.55) * Math.sin(th)]);
}

// ---------- merged static builder ----------
// Build state is reset by buildPark, so every call produces the same park.
let rng, statics, glows, signGeos, colliders, canopies, blockers;
const rr = (a, b) => a + (b - a) * rng();
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
function resetState() {
  rng = mulberry32(SEED);
  statics = []; glows = []; signGeos = []; colliders = []; canopies = []; blockers = [];
}

const dummy = new THREE.Object3D();
dummy.rotation.order = 'YXZ';
const frame = new THREE.Matrix4();
const _m = new THREE.Matrix4();

function hash3(x, y, z) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}
function wobble(g, amt) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    p.setXYZ(i, x + (hash3(x, y, z) - 0.5) * amt, y + (hash3(x + 1.3, y, z) - 0.5) * amt, z + (hash3(x, y + 2.1, z) - 0.5) * amt);
  }
  g.computeVertexNormals();
  return g;
}

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, seg = 8) => new THREE.CylinderGeometry(rt, rb, h, seg);
const cone = (r, h, seg = 8) => new THREE.ConeGeometry(r, h, seg);
const blob = (r, wob = 0.5, detail = 1) => wobble(new THREE.IcosahedronGeometry(r, detail), r * wob);

function prep(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}
function colorize(g, color) {
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  const c = new THREE.Color(color);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
}
// put a primitive into the merged mesh. o: ry rx rz s sx sy sz jit to
function put(geo, color, x = 0, y = 0, z = 0, o = {}) {
  const g = prep(geo);
  dummy.position.set(x, y, z);
  dummy.rotation.set(o.rx || 0, o.ry || 0, o.rz || 0);
  const s = o.s ?? 1;
  dummy.scale.set(o.sx ?? s, o.sy ?? s, o.sz ?? s);
  dummy.updateMatrix();
  g.applyMatrix4(_m.multiplyMatrices(frame, dummy.matrix));
  const c = new THREE.Color(color);
  if (o.jit) c.offsetHSL(0, 0, (rng() - 0.5) * o.jit);
  colorize(g, c);
  (o.to || statics).push(g);
}
const glow = (geo, color, x, y, z, o = {}) => put(geo, color, x, y, z, { ...o, to: glows });
function inFrame(x, y, z, ry, fn) {
  const prev = frame.clone();
  dummy.position.set(x, y, z); dummy.rotation.set(0, ry, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
  frame.multiply(dummy.matrix);
  fn();
  frame.copy(prev);
}

// board face carrying one atlas cell; sits in +z facing local frame
function signFace(cellIdx, w, h, x, y, z, o = {}) {
  const g = new THREE.PlaneGeometry(w, h);
  const [u0, v0, u1, v1] = signUV(cellIdx);
  const uv = g.attributes.uv;
  for (let i = 0; i < 4; i++) uv.setXY(i, uv.getX(i) ? u1 : u0, uv.getY(i) ? v1 : v0);
  g.deleteAttribute('normal'); // the sign material is unlit
  dummy.position.set(x, y, z); dummy.rotation.set(o.rx || 0, o.ry || 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
  g.applyMatrix4(_m.multiplyMatrices(frame, dummy.matrix));
  signGeos.push(g);
}

// up-facing coloured polygon strips between two polylines
function strip(L, R, y, closed, colorFn) {
  const pos = [], col = [];
  const n = L.length, last = closed ? n : n - 1;
  const tri = (a, b, c, color) => {
    const ny = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (ny > 0) [b, c] = [c, b]; // keeps +y facing for the (x,z) plane convention used here
    for (const p of [a, b, c]) { pos.push(p[0], y, p[1]); col.push(color.r, color.g, color.b); }
  };
  for (let i = 0; i < last; i++) {
    const j = (i + 1) % n;
    const color = new THREE.Color(colorFn(i));
    tri(L[i], L[j], R[i], color);
    tri(R[i], L[j], R[j], color);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  statics.push(g);
}
function ribbon(pts, w, y, closed, colorFn) {
  const n = pts.length, L = [], R = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const a = pts[closed ? (i - 1 + n) % n : Math.max(i - 1, 0)];
    const b = pts[closed ? (i + 1) % n : Math.min(i + 1, n - 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1];
    const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    L.push([p[0] - tz * w / 2, p[1] + tx * w / 2]);
    R.push([p[0] + tz * w / 2, p[1] - tx * w / 2]);
  }
  strip(L, R, y, closed, colorFn);
}
function disc(x, z, r, y, color, seg = 24, o = {}) {
  const g = new THREE.CircleGeometry(r, seg);
  g.rotateX(-Math.PI / 2);
  put(g, color, x, y, z, o);
}

// ---------- scene state ----------
const circle = (x, z, r, h) => colliders.push({ x, z, r, h });
const rect = (x, z, hx, hz, h) => colliders.push({ x, z, hx, hz, h });
const block = (x, z, r) => blockers.push({ x, z, r });

const PATH_W = 3.6;
const PATHS = [];
{
  const ring = [];
  for (let i = 0; i < 72; i++) { const a = (i / 72) * Math.PI * 2; ring.push([RING.a * Math.cos(a), RING.b * Math.sin(a)]); }
  PATHS.push({ pts: ring, closed: true });
  PATHS.push({ pts: [[0, 15], [0, 37]] }, { pts: [[0, -15], [0, -37]] });
  PATHS.push({ pts: [[-21, 0], [-52, 0]] }, { pts: [[21, 0], [52, 0]] });
  PATHS.push({ pts: [[-17, -12], [-34, -12]] });
  PATHS.push({ pts: [[17, -12], [34, -12]] });
  PATHS.push({ pts: [[0, 29], [12, 29]] });
}
function distPath(x, z) {
  let best = 1e9;
  for (const { pts, closed } of PATHS) {
    const n = pts.length;
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz)));
      best = Math.min(best, Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t));
    }
  }
  return best;
}
function free(x, z, r, gap = 1, o = {}) {
  if (Math.abs(x) > (o.mx ?? 49) - r || Math.abs(z) > (o.mz ?? 35) - r) return false;
  if (pondGap(x, z) < r + (o.pond ?? 2.5)) return false;
  if (distPath(x, z) < r + PATH_W / 2 + (o.path ?? 0.8)) return false;
  for (const s of SPAWNS) if (Math.hypot(x - s.x, z - s.z) < r + 7) return false;
  for (const s of PICKUPS) if (Math.hypot(x - s.x, z - s.z) < r + 3) return false;
  for (const b of blockers) if (Math.hypot(x - b.x, z - b.z) < r + b.r + gap) return false;
  return true;
}

// ---------- props ----------
const GREENS = [0x3cb043, 0x2fa04a, 0x5cc23c, 0x27923f, 0x4cbf56];
function tree(x, z, s, kind, solid = true) {
  const tr = 0.36 * s;
  put(cyl(tr * 0.7, tr, 2.9 * s, 7), 0x8a5a33, x, 1.45 * s, z, { jit: 0.08 });
  put(cyl(tr * 1.5, tr * 1.7, 0.2 * s, 7), 0x7a4e2c, x, 0.1 * s, z);
  if (kind === 'conifer') {
    put(cone(2.1 * s, 2.8 * s, 8), 0x1f7d4d, x, 3.3 * s, z, { jit: 0.06 });
    put(cone(1.65 * s, 2.5 * s, 8), 0x23995a, x, 4.7 * s, z, { jit: 0.06 });
    put(cone(1.15 * s, 2.2 * s, 8), 0x29aa63, x, 6.0 * s, z, { jit: 0.06 });
  } else {
    const base = kind === 'cherry' ? pick([0xff8fb8, 0xff7aa8, 0xffa6c9]) : kind === 'autumn' ? pick([0xf2a226, 0xe86a1f, 0xf5c333]) : pick(GREENS);
    put(blob(2.3 * s), base, x, 3.9 * s, z, { jit: 0.1, sy: 0.92 });
    for (let i = 0; i < 3; i++) {
      const a = rr(0, 6.28) + i * 2.1;
      put(blob(1.55 * s), base, x + Math.cos(a) * 1.7 * s, (3.3 + rr(0, 0.6)) * s, z + Math.sin(a) * 1.7 * s, { jit: 0.14 });
    }
    put(blob(1.5 * s), new THREE.Color(base).offsetHSL(0, 0, 0.06), x + rr(-0.4, 0.4) * s, 5.4 * s, z + rr(-0.4, 0.4) * s, { jit: 0.06 });
  }
  if (!solid) return;
  circle(x, z, tr * 1.25, 3.2 * s);
  canopies.push({ x, z, r: (kind === 'conifer' ? 2.2 : 3.3) * s, y0: 1.9 * s, y1: 6.6 * s });
  block(x, z, 2.2 * s);
}
function bench(x, z, ry) {
  inFrame(x, 0, z, ry, () => {
    for (const dz of [-0.18, 0, 0.18]) put(box(1.8, 0.06, 0.15), 0x9a6a3a, 0, 0.48, dz, { jit: 0.06 });
    for (const y of [0.72, 0.86, 1.0]) put(box(1.8, 0.1, 0.05), 0xa87444, 0, y, -0.27, { rx: -0.12, jit: 0.06 });
    for (const sx of [-0.8, 0.8]) {
      put(box(0.08, 0.48, 0.55), 0x34414f, sx, 0.24, 0);
      put(box(0.08, 0.08, 0.5), 0x34414f, sx, 0.7, 0);
      put(box(0.08, 0.6, 0.07), 0x34414f, sx, 0.78, -0.27, { rx: -0.12 });
    }
  });
  const q = Math.abs(Math.sin(ry)) > 0.5;
  rect(x, z, q ? 0.32 : 0.95, q ? 0.95 : 0.32, 0.95);
}
function lamp(x, z) {
  put(cyl(0.2, 0.26, 0.5, 8), 0x2f3a46, x, 0.25, z);
  put(cyl(0.07, 0.1, 3.9, 6), 0x2f6f4f, x, 2.2, z);
  put(cyl(0.16, 0.16, 0.12, 8), 0x2f6f4f, x, 4.2, z);
  glow(new THREE.IcosahedronGeometry(0.32, 1), 0xfff0b0, x, 4.5, z);
  put(cone(0.42, 0.34, 8), 0x2f3a46, x, 4.92, z);
  circle(x, z, 0.26, 4);
}
function bin(x, z) {
  put(cyl(0.38, 0.33, 0.85, 8), 0x2f9d5a, x, 0.43, z);
  put(cyl(0.42, 0.42, 0.09, 8), 0x23402f, x, 0.9, z);
  put(cyl(0.385, 0.385, 0.12, 8), 0xffd23f, x, 0.5, z);
  circle(x, z, 0.4, 0.95);
}
function hedge(x, z, hx, hz) {
  const long = Math.max(hx, hz) * 2, alongX = hx > hz;
  put(box(alongX ? long : 1.3, 1.1, alongX ? 1.3 : long), 0x2f8a3a, x, 0.55, z, { jit: 0.05 });
  const n = Math.round(long / 1.1);
  for (let i = 0; i < n; i++) {
    const t = -long / 2 + (i + 0.5) * (long / n);
    put(blob(0.82, 0.5), pick(GREENS), x + (alongX ? t : 0), 1.15, z + (alongX ? 0 : t), { jit: 0.1, sy: 0.9 });
  }
  rect(x, z, hx, hz, 1.5);
  block(x, z, Math.max(hx, hz) + 0.8);
}
function flowerbed(x, z, r) {
  put(cyl(r + 0.25, r + 0.3, 0.3, 14), 0x8f7a63, x, 0.15, z);
  put(cyl(r, r, 0.34, 14), 0x5a3a24, x, 0.17, z);
  put(blob(r * 0.95, 0.35), 0x2f9e45, x, 0.3, z, { sy: 0.45, jit: 0.05 });
  const cols = [0xff3b4e, 0xffd23f, 0xff7ac2, 0xb065ff, 0xffffff, 0xff8a1f, 0x35c6ff];
  const n = Math.round(r * r * 11);
  for (let i = 0; i < n; i++) {
    const a = rr(0, 6.28), d = Math.sqrt(rng()) * r * 0.85;
    const h = 0.3 + r * 0.95 * 0.45 * Math.sqrt(Math.max(0, 1 - (d / (r * 0.95)) ** 2));
    put(new THREE.IcosahedronGeometry(0.13, 0), pick(cols), x + Math.cos(a) * d, h + 0.06, z + Math.sin(a) * d);
  }
  block(x, z, r + 0.5);
}
function boulder(x, z, r) {
  put(blob(r, 0.6), 0x9aa3ab, x, r * 0.55, z, { sy: 0.8, jit: 0.1 });
  put(blob(r * 0.55, 0.6), 0x8a949c, x + r * 0.8, r * 0.28, z + r * 0.2, { jit: 0.1 });
  circle(x, z, r * 0.95, r * 1.3);
  block(x, z, r + 0.5);
}
function bush(x, z, r) {
  put(blob(r, 0.5), pick(GREENS), x, r * 0.7, z, { sy: 0.85, jit: 0.1 });
  put(blob(r * 0.7, 0.5), pick(GREENS), x + r * 0.7, r * 0.45, z - r * 0.3, { jit: 0.1 });
  put(blob(r * 0.6, 0.5), pick(GREENS), x - r * 0.6, r * 0.4, z + r * 0.4, { jit: 0.1 });
  circle(x, z, r * 1.05, r * 1.3);
  block(x, z, r + 0.6);
}
function signPost(x, z, cellIdx, w, h, faceX, faceZ, o = {}) {
  const ry = Math.atan2(faceX - x, faceZ - z);
  inFrame(x, 0, z, ry, () => {
    const top = o.top ?? 2.1;
    put(cyl(0.06, 0.07, top, 6), 0x6b4a2b, 0, top / 2, 0);
    put(box(w + 0.16, h + 0.16, 0.06), 0xe8e4d8, 0, top - 0.1 - h / 2 + 0.1, 0);
    signFace(cellIdx, w, h, 0, top - h / 2 - 0.0, 0.04);
    signFace(cellIdx, w, h, 0, top - h / 2 - 0.0, -0.04, { ry: Math.PI });
  });
  circle(x, z, 0.2, 2.2);
}

// ---------- build steps (each one a `// ----` block of the old buildPark; order matters for rng) ----------
// sky, sun, hemisphere light, fog
function addSky(scene, root) {
  scene.background = new THREE.Color(0xcfe9fb);
  scene.fog = new THREE.Fog(0xd3ebfb, 75, 280);

  const skyGeo = new THREE.SphereGeometry(280, 24, 14);
  {
    const p = skyGeo.attributes.position, col = new Float32Array(p.count * 3);
    const hor = new THREE.Color(0xd8efff), zen = new THREE.Color(0x3c9aea), low = new THREE.Color(0xd3ebfb), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const t = p.getY(i) / 280;
      if (t >= 0) c.copy(hor).lerp(zen, Math.pow(t, 0.55)); else c.copy(hor).lerp(low, Math.min(1, -t * 4));
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    skyGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -10;
  root.add(sky);

  const sun = new THREE.DirectionalLight(0xfff0d0, 3.1);
  sun.position.set(-55, 62, 38);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -72; sc.right = 72; sc.top = 72; sc.bottom = -72; sc.near = 10; sc.far = 220;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.06;
  root.add(sun, sun.target);
  root.add(new THREE.HemisphereLight(0xbfe4ff, 0x9acb78, 0.9));
  {
    const d = sun.position.clone().normalize().multiplyScalar(250);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(16, 24), new THREE.MeshBasicMaterial({ color: 0xfff7cf, fog: false, depthWrite: false }));
    disc.position.copy(d); disc.lookAt(0, 0, 0); root.add(disc);
    const halo = new THREE.Mesh(new THREE.CircleGeometry(34, 24), new THREE.MeshBasicMaterial({ color: 0xfff1b8, fog: false, transparent: true, opacity: 0.28, depthWrite: false }));
    halo.position.copy(d.clone().multiplyScalar(0.995)); halo.lookAt(0, 0, 0); root.add(halo);
  }
}

// drifting clouds; returns the per-frame updater
function addClouds(root) {
  const cloudMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
  const clouds = [];
  for (let k = 0; k < 6; k++) {
    const parts = [];
    const n = 5 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const g = blob(rr(7, 12), 0.4); g.scale(1.4, 0.7, 1);
      g.translate((i - n / 2) * 10 + rr(-3, 3), rr(-1, 3), rr(-4, 4));
      const m = prep(g); colorize(m, i % 2 ? 0xffffff : 0xf3f8ff); parts.push(m);
    }
    const mesh = new THREE.Mesh(mergeGeometries(parts), cloudMat);
    mesh.position.set(-200 + k * 75, rr(75, 105), rr(-150, 150));
    mesh.scale.setScalar(rr(0.8, 1.3));
    mesh.userData.speed = rr(1.2, 2.6);
    root.add(mesh); clouds.push(mesh);
  }
  return (dt) => {
    for (const c of clouds) { c.position.x += c.userData.speed * dt; if (c.position.x > 230) c.position.x = -230; }
  };
}

// grass with the pond cut out
function addGround(root) {
  const shape = new THREE.Shape();
  const E = 180;
  shape.moveTo(-E, -E); shape.lineTo(E, -E); shape.lineTo(E, E); shape.lineTo(-E, E); shape.lineTo(-E, -E);
  const hole = new THREE.Path();
  POND_PTS.forEach((p, i) => (i ? hole.lineTo(p[0], -p[1]) : hole.moveTo(p[0], -p[1])));
  shape.holes.push(hole);
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  const ground = new THREE.Mesh(g, toon({ map: grassTexture() }));
  ground.receiveShadow = true;
  root.add(ground);
}

// pond bed, bank wall and stone rim
function addPondBed() {
  const wallTop = new THREE.Color(0x6b8a46), wallBot = new THREE.Color(0x1d6a82);
  const pos = [], col = [];
  const v = (x, y, z, c) => { pos.push(x, y, z); col.push(c.r, c.g, c.b); };
  for (let i = 0; i < NP; i++) {
    const a = POND_PTS[i], b = POND_PTS[(i + 1) % NP];
    v(a[0], 0, a[1], wallTop); v(b[0], 0, b[1], wallTop); v(a[0], BED_Y, a[1], wallBot);
    v(b[0], 0, b[1], wallTop); v(b[0], BED_Y, b[1], wallBot); v(a[0], BED_Y, a[1], wallBot);
    v(0, BED_Y, 0, wallBot); v(a[0], BED_Y, a[1], wallBot); v(b[0], BED_Y, b[1], wallBot);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  statics.push(g);
  strip(POND_PTS, POND_OUT, 0.03, true, (i) => (i % 4 < 2 ? 0xe2d3a8 : 0xcdbb8c));
}

function addPaths() {
  const pathCol = (i) => (i % 2 ? 0xe9d6a6 : 0xe2cd9a);
  for (const { pts, closed } of PATHS) {
    ribbon(pts, PATH_W + 0.7, 0.022, closed, () => 0xb99c68);
    ribbon(pts, PATH_W, 0.034, closed, pathCol);
  }
  // plazas
  disc(PLAZA.x, PLAZA.z, 6.7, 0.026, 0xb99c68, 32);
  disc(PLAZA.x, PLAZA.z, 6.3, 0.038, 0xeadfc6, 32);
  disc(PLAZA.x, PLAZA.z, 4.2, 0.05, 0xd9ccae, 28);
  disc(KIOSK.x - 1, KIOSK.z - 4.2, 5.2, 0.026, 0xb99c68, 24, { sz: 0.62 });
  disc(KIOSK.x - 1, KIOSK.z - 4.2, 4.9, 0.038, 0xeadfc6, 24, { sz: 0.62 });
  // playground sand + timber edge
  put(box(14, 0.05, 10), 0xf0d691, PLAY.x, 0.03, PLAY.z - 0.5);
  for (const [bx, bz, w, d] of [[0, -5.5, 14.4, 0.4], [0, 4.5, 14.4, 0.4], [-7.2, -0.5, 0.4, 10], [7.2, -0.5, 0.4, 10]]) {
    put(box(w, 0.22, d), 0x8a5a33, PLAY.x + bx, 0.11, PLAY.z + bz, { jit: 0.05 });
  }
}

function addPicnic() {
  const bx = -16, bz = 26;
  for (let i = 0; i < 12; i++) {
    for (let j = 0; j < 9; j++) {
      put(box(0.3, 0.03, 0.3), (i + j) % 2 ? 0xe63946 : 0xfff6e8, bx - 1.8 + i * 0.3 + 0.15, 0.035, bz - 1.35 + j * 0.3 + 0.15);
    }
  }
  put(box(0.7, 0.4, 0.5), 0xb4783c, bx - 0.5, 0.25, bz - 0.3, { ry: 0.3 });
  put(box(0.74, 0.08, 0.54), 0xd9a15c, bx - 0.5, 0.48, bz - 0.3, { ry: 0.3 });
  put(blob(0.28, 0.2), 0xe8b45a, bx + 0.6, 0.22, bz + 0.4, { sx: 1.5, sy: 0.7 });
  put(new THREE.IcosahedronGeometry(0.16, 1), 0xe63946, bx + 0.9, 0.2, bz - 0.5);
  put(new THREE.IcosahedronGeometry(0.16, 1), 0x7ed957, bx - 1.2, 0.2, bz + 0.5);
  put(cyl(0.11, 0.11, 0.42, 8), 0x4aa3df, bx + 0.1, 0.25, bz + 0.7);
}

function addFountain() {
  const { x, z } = PLAZA;
  const prof = [[0.01, 0], [2.7, 0], [2.7, 0.85], [2.35, 0.85], [2.35, 0.3], [0.01, 0.3]].map(([r, y]) => new THREE.Vector2(r, y));
  put(new THREE.LatheGeometry(prof, 18), 0xcfc8bc, x, 0, z);
  put(new THREE.TorusGeometry(2.52, 0.14, 5, 18).rotateX(Math.PI / 2), 0xe9e3d8, x, 0.86, z);
  put(cyl(0.45, 0.6, 1.9, 10), 0xd8d2c6, x, 1.2, z);
  const prof2 = [[0.01, 0], [1.45, 0.25], [1.5, 0.45], [1.2, 0.45], [0.01, 0.15]].map(([r, y]) => new THREE.Vector2(r, y));
  put(new THREE.LatheGeometry(prof2, 14), 0xcfc8bc, x, 1.55, z);
  put(cyl(0.2, 0.3, 1.0, 8), 0xd8d2c6, x, 2.2, z);
  put(blob(0.42, 0.2), 0xf5eee2, x, 2.85, z);
  circle(x, z, 2.75, 2.4);
  block(x, z, 7);
  for (const [dx, dz] of [[8.8, 0], [-8.8, 0], [0, 8.8], [0, -8.8]]) flowerbed(x + dx, z + dz, 1.3);
}

function addPlayground() {
  const px = PLAY.x, pz = PLAY.z;
  // slide
  inFrame(px - 5, 0, pz, 0, () => {
    for (const [sx, sz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) put(cyl(0.07, 0.07, 2.1, 6), 0xd23c3c, sx, 1.05, -1.5 + sz);
    put(box(1.5, 0.14, 1.5), 0xffd23f, 0, 2.05, -1.5);
    put(box(1.5, 0.35, 0.06), 0xd23c3c, 0, 2.3, -2.25);
    for (const sx of [-0.75, 0.75]) put(box(0.06, 0.5, 1.5), 0xd23c3c, sx, 2.3, -1.5);
    const run = 3.4, rise = 2.0, len = Math.hypot(run, rise), ang = Math.atan2(rise, run);
    put(box(1.0, 0.07, len), 0x3fa9f5, 0, 1.0 + 0.1, -0.75 + run / 2 + 0.0, { rx: ang });
    for (const sx of [-0.52, 0.52]) put(box(0.07, 0.22, len), 0x2f8ad4, sx, 1.15, -0.75 + run / 2, { rx: ang });
    for (const sx of [-0.35, 0.35]) put(box(0.06, 2.5, 0.06), 0xd23c3c, sx, 1.1, -2.3, { rx: -0.35 });
    for (let i = 0; i < 6; i++) put(box(0.8, 0.05, 0.06), 0xd23c3c, 0, 0.3 + i * 0.35, -2.55 + i * 0.12, {});
  });
  rect(px - 5, pz - 0.2, 0.95, 2.9, 2.2);
  // swing set
  inFrame(px + 2.5, 0, pz - 1, 0, () => {
    put(cyl(0.09, 0.09, 6.9, 6), 0x2f6fb5, 0, 3.1, 0, { rz: Math.PI / 2 });
    for (const sx of [-3.3, 3.3]) {
      for (const sz of [-1, 1]) put(cyl(0.07, 0.07, 3.3, 6), 0x2f6fb5, sx, 1.55, sz * 0.55, { rx: -sz * 0.33 });
    }
    for (const sx of [-1.1, 1.1]) {
      for (const dx of [-0.32, 0.32]) put(cyl(0.015, 0.015, 2.5, 4), 0x333333, sx + dx, 1.85, 0);
      put(box(0.75, 0.07, 0.28), sx > 0 ? 0xffd23f : 0xe63946, sx, 0.58, 0);
    }
  });
  rect(px + 2.5 - 3.3, pz - 1, 0.3, 1.0, 3.1);
  rect(px + 2.5 + 3.3, pz - 1, 0.3, 1.0, 3.1);
  // playhouse
  inFrame(px + 3, 0, pz + 2.5, 0, () => {
    put(box(2.6, 1.7, 2.4), 0xffe3a3, 0, 0.85, 0);
    put(box(2.6, 0.15, 2.4), 0x8a5a33, 0, 0.1, 0);
    put(cone(2.2, 1.3, 4), 0xd23c3c, 0, 2.3, 0, { ry: Math.PI / 4 });
    put(box(0.7, 1.1, 0.06), 0x3fa9f5, 0, 0.6, 1.2);
    put(box(0.55, 0.5, 0.06), 0x7ad0ff, 0.85, 1.0, 1.2);
  });
  rect(px + 3, pz + 2.5, 1.3, 1.25, 2.5);
  signPost(px - 7.8, pz + 5.8, SIGN.spiel, 1.7, 0.85, px - 10, pz + 5.8 + 3);
  block(px, pz, 9);
  bench(px - 1, pz + 5.6, Math.PI);
  bench(px - 5, pz + 5.6, Math.PI);
}

function addKiosk() {
  const { x, z } = KIOSK;
  inFrame(x, 0, z, Math.PI, () => {
    put(box(4.6, 0.25, 3.3), 0xb7a58a, 0, 0.12, 0);
    put(box(4.4, 2.9, 3.1), 0xfff0c8, 0, 1.7, 0, { jit: 0.02 });
    put(box(4.5, 0.4, 3.2), 0xd62828, 0, 3.3, 0);
    put(box(4.8, 0.14, 3.6), 0x9c1d1d, 0, 3.6, 0);
    put(box(2.5, 1.15, 0.12), 0x3a2a24, -0.4, 1.9, 1.56);
    glow(box(2.3, 0.95, 0.06), 0xffe39a, -0.4, 1.9, 1.62);
    put(box(3.0, 0.18, 0.75), 0x9a6a3a, -0.4, 1.28, 1.8);
    put(box(0.9, 1.9, 0.12), 0x5a7aa8, 1.75, 1.15, 1.56);
    for (let i = 0; i < 7; i++) {
      put(box(0.7, 0.07, 1.7), i % 2 ? 0xfff6e8 : 0xd62828, -2.1 + i * 0.7, 2.95 - 0.02, 2.35, { rx: 0.42 });
    }
    put(box(3.6, 1.15, 0.12), 0xe8e4d8, 0, 4.3, 0.2);
    signFace(SIGN.imbiss, 3.4, 1.0, 0, 4.3, 0.28);
    put(cone(0.38, 0.9, 10), 0xe6b06a, -1.6, 4.35, 0.2, { rx: Math.PI });
    put(new THREE.IcosahedronGeometry(0.36, 1), 0xff9ec0, -1.6, 4.95, 0.2);
    put(new THREE.IcosahedronGeometry(0.25, 1), 0xfff1c8, -1.6, 5.3, 0.2);
    put(box(1.3, 0.8, 0.07), 0x9a6a3a, -3.0, 1.8, 0.1, { ry: 0.0 });
    signFace(SIGN.menu, 1.15, 0.58, -3.0, 1.8, 0.15);
  });
  rect(x, z, 2.5, 1.9, 3.5);
  block(x, z, 5);
  // tables with parasols
  for (const tx of [x - 4.5, x + 4.5]) {
    const tz = z - 4.5;
    put(cyl(0.8, 0.8, 0.08, 10), 0xf0e6d0, tx, 0.82, tz);
    put(cyl(0.08, 0.1, 0.8, 6), 0x6b4a2b, tx, 0.4, tz);
    put(cyl(0.04, 0.04, 2.6, 6), 0xdddddd, tx, 1.4, tz);
    put(cone(1.5, 0.55, 10), tx > x ? 0x35c6ff : 0xffd23f, tx, 2.85, tz);
    put(new THREE.IcosahedronGeometry(0.1, 0), 0xdddddd, tx, 3.18, tz);
    for (const [dx, dz] of [[1.2, 0], [-1.2, 0]]) {
      put(cyl(0.28, 0.28, 0.05, 8), 0xd62828, tx + dx, 0.5, tz + dz);
      put(cyl(0.05, 0.05, 0.5, 5), 0x444444, tx + dx, 0.25, tz + dz);
    }
    circle(tx, tz, 0.85, 1);
    block(tx, tz, 2.0);
  }
  bin(x + 3.5, z - 1.6);
  lamp(x - 3.0, z - 7.4); lamp(x + 7, z - 7);
}

function addRingFurniture() {
  for (const sx of [-1, 1]) {
    bench(sx * 6.5, 19.3, Math.PI); bench(sx * 6.5, -19.3, 0);
    bench(sx * 25.3, 5, -sx * Math.PI / 2); bench(sx * 25.3, -5, -sx * Math.PI / 2);
    bin(sx * 9.2, 19.2); bin(sx * 9.2, -19.2); bin(sx * 25.3, 8.3); bin(sx * 24.2, -8.3);
  }
  bench(PLAZA.x - 1, PLAZA.z + 11, Math.PI); bench(PLAZA.x + 6, PLAZA.z + 7.8, Math.PI * 0.75);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.39;
    lamp(Math.cos(a) * (RING.a + 2.4), Math.sin(a) * (RING.b + 2.4));
  }
  for (const [lx, lz] of [[2.6, 35.5], [-2.6, 35.5], [2.6, -35.5], [-2.6, -35.5], [-49.5, 2.7], [-49.5, -2.7], [49.5, 2.7], [49.5, -2.7],
    [PLAZA.x + 5.5, PLAZA.z - 5.5], [PLAZA.x - 5.5, PLAZA.z + 5.5]]) lamp(lx, lz);
}

// signs, hedges, boulders, flowerbeds
function addCover() {
  signPost(-17.5, 9.5, SIGN.fuettern, 2.0, 1.0, -8, 7);
  signPost(17.5, 5, SIGN.angeln, 2.0, 1.0, 5, 3);
  signPost(-9, -23, SIGN.rasen, 1.8, 1.0, -9, -16, { top: 1.6 });
  block(-17.5, 9.5, 2); block(17.5, 5, 2); block(-9, -23, 2);
  for (const [x, z, hx, hz] of [[-12, -28, 3.5, 0.7], [22, 21, 3.5, 0.7], [-30, 24, 0.7, 3.5], [31, -29, 3.5, 0.7], [-45, -26, 0.7, 3.5],
    [44, 24, 0.7, 3.5], [-30, -6.5, 3.5, 0.7], [29, -5, 0.7, 3], [5, 32, 0.7, 2.5]]) hedge(x, z, hx, hz);
  for (const [x, z, r] of [[-20, -16, 2.2], [14, -15, 2.0]]) boulder(x, z, r);
  for (const [x, z] of [[-47, 14], [-47, -14], [47, 14], [47, -14], [-24, 33], [24, -33], [-40, 33], [41, 33]]) flowerbed(x, z, 1.6);
  for (const [x, z] of [[-4.5, 34], [4.5, 34], [-4.5, -34], [4.5, -34]]) flowerbed(x, z, 1.4);
}

// trees, bushes and boulders sampled from the free ground
function addTrees() {
  const treeKinds = () => { const p = rng(); return p < 0.62 ? 'round' : p < 0.78 ? 'conifer' : p < 0.9 ? 'cherry' : 'autumn'; };
  let planted = 0;
  const tryTree = (x, z, s) => { if (free(x, z, 2.3 * s, 2.5)) { tree(x, z, s, treeKinds()); planted++; return true; } return false; };
  for (let x = -46; x <= 46; x += rr(8, 12)) { tryTree(x, 33 + rr(-1, 0.5), rr(1, 1.3)); tryTree(x, -33 + rr(-0.5, 1), rr(1, 1.3)); }
  for (let z = -29; z <= 29; z += rr(8, 12)) { tryTree(47 + rr(-1, 0.5), z, rr(1, 1.3)); tryTree(-47 + rr(-0.5, 1), z, rr(1, 1.3)); }
  for (let i = 0; i < 600 && planted < 50; i++) {
    const x = rr(-46, 46), z = rr(-32, 32);
    const w = Math.min(1, Math.max(0.25, (Math.hypot(x / 50, z / 36) - 0.35) * 1.6));
    if (rng() > w) continue;
    tryTree(x, z, rr(0.85, 1.4));
  }
  let bushes = 0;
  for (let i = 0; i < 400 && bushes < 9; i++) {
    const x = rr(-46, 46), z = rr(-32, 32);
    if (free(x, z, 1.2, 4)) { bush(x, z, rr(0.9, 1.25)); bushes++; }
  }
  let rocks = 0;
  for (let i = 0; i < 300 && rocks < 3; i++) {
    const x = rr(-40, 40), z = rr(-30, 30);
    if (free(x, z, 1.6, 6)) { boulder(x, z, rr(1.0, 1.5)); rocks++; }
  }
}

// rim stones and reeds
function addPondDressing() {
  for (let i = 0; i < 44; i++) { // rim stones
    const th = (i / 44) * Math.PI * 2 + rr(-0.05, 0.05), r = pondR(th) + rr(0.45, 0.9);
    const s = rr(0.22, 0.45);
    put(blob(s, 0.5), 0x9aa3ab, Math.cos(th) * r, s * 0.35, Math.sin(th) * r, { sy: 0.65, jit: 0.12 });
  }
  const reedSpots = [0.2, 0.9, 1.7, 2.5, 3.1, 3.9, 4.6, 5.3, 5.9];
  for (const th of reedSpots) {
    const r = pondR(th) - 0.7, cx = Math.cos(th) * r, cz = Math.sin(th) * r;
    for (let i = 0; i < 7; i++) {
      const x = cx + rr(-0.7, 0.7), zz = cz + rr(-0.7, 0.7);
      if (!isWater(x, zz)) continue;
      const h = rr(1.9, 2.8), tilt = { rx: rr(-0.14, 0.14), rz: rr(-0.14, 0.14) };
      put(cyl(0.03, 0.045, h, 4), 0x5d9a3a, x, -0.8 + h / 2, zz, { ...tilt, jit: 0.1 });
      if (i % 2 === 0) put(cyl(0.09, 0.09, 0.4, 6), 0x6b3f21, x + tilt.rz * -h * 0.5, -0.8 + h + 0.05, zz + tilt.rx * h * 0.5);
    }
  }
}

// island with the dead tree the kingfisher perches on
function addIsland() {
  const { x, z } = ISLAND;
  put(cyl(2.3, 3.8, 1.35, 14), 0x8a6a45, x, -0.625, z, { jit: 0.04 });
  put(blob(2.5, 0.2, 2), 0x62c23f, x, 0.0, z, { sy: 0.12 });
  disc(x, z, 2.3, 0.06, 0x62c23f, 14);
  put(blob(0.75, 0.5), 0x2f9e45, x - 1.3, 0.5, z + 0.9, { jit: 0.1 });
  put(blob(0.55, 0.5), 0x3cb043, x - 0.6, 0.38, z + 1.6, { jit: 0.1 });
  put(blob(0.5, 0.5), 0x9aa3ab, x + 1.4, 0.2, z + 1.3, { sy: 0.7 });
  for (let i = 0; i < 6; i++) {
    const a = rr(0.3, 2.6), d = rr(1.6, 2.2);
    put(new THREE.IcosahedronGeometry(0.14, 0), pick([0xff3b4e, 0xffd23f, 0xffffff]), x + Math.cos(a) * d * -1, 0.2, z + Math.sin(a) * d);
  }
  // dead tree = the kingfisher perch
  const tx = x - 0.2, tz = z + 0.1;
  put(cyl(0.22, 0.55, 7.0, 7), 0x6f5f52, tx, 3.5, tz, { rz: 0.03, jit: 0.05 });
  put(cyl(0.6, 0.8, 0.3, 7), 0x6f5f52, tx, 0.1, tz);
  put(cyl(0.09, 0.15, 3.2, 6), 0x7a6a5c, tx + 1.57, 5.92, tz, { rz: -(Math.PI / 2 - 0.2) });
  put(cyl(0.05, 0.08, 1.4, 5), 0x7a6a5c, tx + 0.9, 6.2, tz + 0.05, { rz: -0.9 });
  put(cyl(0.05, 0.1, 2.0, 5), 0x7a6a5c, tx - 0.7, 5.0, tz + 0.2, { rz: 1.0, rx: 0.3 });
  put(cyl(0.05, 0.09, 1.8, 5), 0x7a6a5c, tx - 0.3, 6.0, tz - 0.4, { rz: 0.5, rx: -0.6 });
  put(cyl(0.04, 0.07, 1.2, 5), 0x7a6a5c, tx + 2.2, 6.55, tz, { rz: -0.35 });
  put(cyl(0.04, 0.05, 0.9, 5), 0x7a6a5c, tx + 0.3, 7.3, tz, { rz: 0.4 });
  circle(tx, tz, 0.6, 7);
  canopies.push({ x: tx + 0.5, z: tz, r: 2.6, y0: 4.2, y1: 8 });
}

// picket fence and hedge border
function addFence() {
  const FX = 52, FZ = 37;
  const gate = (v) => Math.abs(v) < 2.6;
  // hedge core and bumps
  put(box(2 * HALF_X, 2.2, 3), 0x2c8a3a, 0, 1.1, -(FZ + 1.5), { jit: 0.04 });
  put(box(2 * HALF_X, 2.2, 3), 0x2c8a3a, 0, 1.1, FZ + 1.5, { jit: 0.04 });
  put(box(3, 2.2, 2 * FZ), 0x2c8a3a, -(FX + 1.5), 1.1, 0);
  put(box(3, 2.2, 2 * FZ), 0x2c8a3a, FX + 1.5, 1.1, 0);
  for (let x = -HALF_X + 1; x <= HALF_X; x += 2.1) {
    for (const sz of [-1, 1]) put(blob(1.35, 0.5), pick(GREENS), x, 2.25, sz * (FZ + 1.5 + rr(-0.3, 0.3)), { jit: 0.12, sy: 0.85 });
  }
  for (let z = -FZ + 1.2; z <= FZ - 1; z += 2.1) {
    for (const sx of [-1, 1]) put(blob(1.35, 0.5), pick(GREENS), sx * (FX + 1.5 + rr(-0.3, 0.3)), 2.25, z, { jit: 0.12, sy: 0.85 });
  }
  // picket fence
  for (const sz of [-1, 1]) {
    put(box(2 * FX, 0.08, 0.1), 0xf3efe4, 0, 0.35, sz * (FZ - 0.07));
    put(box(2 * FX, 0.08, 0.1), 0xf3efe4, 0, 0.8, sz * (FZ - 0.07));
    for (let x = -FX; x <= FX; x += 0.55) {
      const g = gate(x);
      put(box(0.2, g ? 1.5 : 1.05, 0.07), g ? 0x2d6e4f : 0xfaf6ea, x, g ? 0.75 : 0.52, sz * (FZ - 0.02), { jit: g ? 0 : 0.03 });
    }
  }
  for (const sx of [-1, 1]) {
    put(box(0.1, 0.08, 2 * FZ), 0xf3efe4, sx * (FX - 0.07), 0.35, 0);
    put(box(0.1, 0.08, 2 * FZ), 0xf3efe4, sx * (FX - 0.07), 0.8, 0);
    for (let z = -FZ; z <= FZ; z += 0.55) {
      const g = gate(z);
      put(box(0.07, g ? 1.5 : 1.05, 0.2), g ? 0x2d6e4f : 0xfaf6ea, sx * (FX - 0.02), g ? 0.75 : 0.52, z, { jit: g ? 0 : 0.03 });
    }
  }
  // gate pillars
  for (const [px, pz] of [[2.9, FZ + 0.4], [-2.9, FZ + 0.4], [2.9, -FZ - 0.4], [-2.9, -FZ - 0.4], [FX + 0.4, 2.9], [FX + 0.4, -2.9], [-FX - 0.4, 2.9], [-FX - 0.4, -2.9]]) {
    put(box(0.9, 2.5, 0.9), 0xd8cfbc, px, 1.25, pz);
    put(box(1.1, 0.2, 1.1), 0xb8ad98, px, 2.6, pz);
    put(new THREE.IcosahedronGeometry(0.28, 1), 0xf5eee2, px, 2.95, pz);
  }
  // thick boxes (inner face on the fence line) so nothing tunnels through
  colliders.push({ x: 0, z: -(FZ + 3), hx: FX + 6, hz: 3, h: 4 }, { x: 0, z: FZ + 3, hx: FX + 6, hz: 3, h: 4 });
  colliders.push({ x: FX + 3, z: 0, hx: 3, hz: FZ + 6, h: 4 }, { x: -(FX + 3), z: 0, hx: 3, hz: FZ + 6, h: 4 });
}

// beyond the border: trees, sidewalks, road, cars
function addBorderland() {
  for (let x = -70; x <= 70; x += rr(10, 14)) for (const sz of [-1, 1]) tree(x, sz * rr(43, 44.5), rr(1.2, 1.7), pick(['round', 'round', 'conifer', 'cherry']), false);
  for (let z = -42; z <= 42; z += rr(10, 14)) for (const sx of [-1, 1]) tree(sx * rr(59, 60.5), z, rr(1.2, 1.7), pick(['round', 'round', 'conifer', 'autumn']), false);
  // roads
  const bandX = (x0, x1, z0, z1, y, color) => put(box(x1 - x0, 0.05, z1 - z0), color, (x0 + x1) / 2, y, (z0 + z1) / 2);
  for (const s of [-1, 1]) {
    const lo = 46.5, hi = 49, r0 = 49, r1 = 57;
    bandX(-180, 180, s > 0 ? lo : -hi, s > 0 ? hi : -lo, 0.03, 0xd6cfc2);
    bandX(-180, 180, s > 0 ? r0 : -r1, s > 0 ? r1 : -r0, 0.035, 0x4b505c);
    for (let x = -176; x < 176; x += 7) bandX(x, x + 3.5, s * 53 - 0.15, s * 53 + 0.15, 0.065, 0xf6e9a0);
    bandX(s > 0 ? 61 : -63.5, s > 0 ? 63.5 : -61, -46.5, 46.5, 0.032, 0xd6cfc2);
    bandX(s > 0 ? 63.5 : -71.5, s > 0 ? 71.5 : -63.5, -49, 49, 0.035, 0x4b505c);
    for (let z = -46; z < 46; z += 7) bandX(s * 67.5 - 0.15, s * 67.5 + 0.15, z, z + 3.5, 0.065, 0xf6e9a0);
  }
  const carCols = [0xe63946, 0xffd23f, 0x35c6ff, 0x7ed957, 0xff8a1f, 0xb065ff, 0xffffff];
  const car = (x, z, ry) => inFrame(x, 0, z, ry, () => {
    const c = pick(carCols);
    put(box(4.2, 0.9, 1.9), c, 0, 0.75, 0, { jit: 0.04 });
    put(box(2.2, 0.8, 1.7), c, -0.2, 1.55, 0, { jit: 0.04 });
    put(box(2.0, 0.6, 1.74), 0x9bd3ee, -0.2, 1.58, 0);
    for (const [wx, wz] of [[1.35, 0.9], [-1.35, 0.9], [1.35, -0.9], [-1.35, -0.9]]) put(cyl(0.38, 0.38, 0.3, 8), 0x222222, wx, 0.38, wz, { rx: Math.PI / 2 });
  });
  for (const s of [-1, 1]) {
    for (let i = 0; i < 5; i++) car(rr(-60, 60), s * (51 + (i % 2) * 3.5), Math.PI / 2 * (i % 2 ? 1 : 3));
    for (let i = 0; i < 3; i++) car(s * (65.5 + (i % 2) * 3.8), rr(-40, 40), i % 2 ? 0 : Math.PI);
  }
}

// skyline buildings (own material: window texture x vertex colour)
function addSkyline() {
  const skyGeos = [];
  const pastel = [0xf4c7a1, 0xe8d5a8, 0xe3a39d, 0xb4c9de, 0xcfdcae, 0xeab3cb, 0xc7b8e6, 0xf6e2b8, 0x9fd0d3, 0xf2a88a];
  const roofCols = [0xc4573a, 0x5a6fa8, 0x4f8f6a, 0x8a4f3a];
  const plain = (g, c, x, y, z) => {
    g.translate(x, y, z);
    const g2 = prep(g);
    g2.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g2.attributes.position.count * 2).fill(0.03), 2));
    colorize(g2, c); skyGeos.push(g2);
  };
  const building = (cx, cz, w, d, h, color) => {
    const g = box(w, h, d);
    const uv = g.attributes.uv;
    for (let f = 0; f < 6; f++) {
      for (let k = 0; k < 4; k++) {
        const i = f * 4 + k;
        if (f >= 2 && f < 4) uv.setXY(i, 0.03, 0.03);
        else uv.setXY(i, uv.getX(i) * ((f < 2 ? d : w) / 4.5), uv.getY(i) * (h / 4));
      }
    }
    g.translate(cx, h / 2, cz);
    const g2 = g.toNonIndexed(); colorize(g2, color); skyGeos.push(g2);
    const roof = rng();
    if (roof < 0.4) plain(cone(Math.max(w, d) * 0.78, Math.min(w, d) * 0.55, 4).rotateY(Math.PI / 4), pick(roofCols), cx, h + Math.min(w, d) * 0.275, cz);
    else if (roof < 0.7) plain(box(w * 0.5, 2.2, d * 0.5), 0x9aa3ab, cx, h + 1.1, cz);
    else if (roof < 0.8) { plain(cyl(w * 0.2, w * 0.2, 3, 8), 0xb04a3a, cx, h + 1.5, cz); plain(cone(w * 0.26, 2, 8), 0x7a4a3a, cx, h + 4, cz); }
  };
  const run = (fn, lo, hi, step) => { for (let t = lo; t < hi; t += step) { const sz = rr(9, 15); fn(t + sz / 2, sz); t += sz - step; } };
  for (const s of [-1, 1]) {
    run((x, w) => { const d = rr(9, 14); building(x, s * (61 + d / 2), w, d, rr(12, 26), pick(pastel)); }, -175, 175, 1.2);
    run((x, w) => { const d = rr(10, 16); building(x, s * (88 + d / 2), w, d, rr(28, 52), pick(pastel)); }, -190, 190, 1.2);
    run((z, w) => { const d = rr(9, 14); building(s * (75 + d / 2), z, d, w, rr(12, 28), pick(pastel)); }, -55, 55, 1.2);
    run((z, w) => { const d = rr(10, 16); building(s * (100 + d / 2), z, d, w, rr(28, 50), pick(pastel)); }, -90, 90, 1.2);
  }
  return skyGeos;
}

// merge everything collected so far into a few meshes
function finalizeMeshes(root, skyGeos) {
  const staticMat = toon({ vertexColors: true, side: THREE.DoubleSide });
  const staticMesh = new THREE.Mesh(mergeGeometries(statics), staticMat);
  staticMesh.castShadow = staticMesh.receiveShadow = true;
  root.add(staticMesh);
  const glowMesh = new THREE.Mesh(mergeGeometries(glows), new THREE.MeshBasicMaterial({ vertexColors: true }));
  root.add(glowMesh);
  root.add(new THREE.Mesh(mergeGeometries(signGeos), new THREE.MeshBasicMaterial({ map: signAtlas(), side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })));
  root.add(new THREE.Mesh(mergeGeometries(skyGeos), toon({ map: windowTexture(), vertexColors: true })));
}

// Cartoon pond: deep-to-shallow tint from the ring index, drifting ripple streaks and a frothy shore band.
const pondTime = { value: 0 };
function pondMaterial() {
  // writes depth so the outline pass inks the waterline instead of the pond bed's creases below
  const m = toon({ color: 0xffffff, transparent: true, opacity: 0.9 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = pondTime;
    sh.vertexShader = 'attribute float edge;\nvarying float vEdge;\nvarying vec3 vW;\n' + sh.vertexShader
      .replace('#include <project_vertex>', '#include <project_vertex>\n  vEdge = edge;\n  vW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = 'uniform float uTime;\nvarying float vEdge;\nvarying vec3 vW;\n' + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        float shallow = smoothstep(0.62, 1.0, vEdge);
        diffuseColor.rgb = mix(vec3(0.01, 0.2, 0.58), vec3(0.1, 0.55, 0.78), shallow);
        float r = sin(vW.x * 1.1 + uTime * 0.9 + sin(vW.z * 0.8 + uTime * 0.6) * 1.6)
                * sin(vW.z * 1.3 - uTime * 0.7 + sin(vW.x * 0.6 - uTime * 0.4) * 1.6);
        float streak = smoothstep(0.86, 0.9, r) * (1.0 - shallow * 0.7);
        float a = atan(vW.z, vW.x);
        float wob = sin(a * 23.0 + uTime * 1.8) * 0.018 + sin(a * 9.0 - uTime * 1.1) * 0.02;
        float foam = smoothstep(0.935 + wob, 0.95 + wob, vEdge);
        float lace = smoothstep(0.86 + wob, 0.875 + wob, vEdge) * (1.0 - smoothstep(0.895 + wob, 0.91 + wob, vEdge));
        float white = max(max(streak * 0.55, foam), lace * 0.7);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), white);
        diffuseColor.a = mix(diffuseColor.a, 1.0, white);`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * 0.12;');
  };
  return m;
}

// pond surface, fountain water and jets; returns the per-frame updater
function addWater(root) {
  const waterTex = waterTexture();
  const waterMat = new THREE.MeshPhongMaterial({ color: 0x2db4ee, map: waterTex, shininess: 110, specular: 0xbfe6ff, transparent: true, opacity: 0.88, depthWrite: false });
  const RINGS = 10;
  const wBase = [];
  const wPos = new Float32Array((RINGS * NP + 1) * 3), wUv = new Float32Array((RINGS * NP + 1) * 2), wEdge = new Float32Array(RINGS * NP + 1);
  wBase.push([0, 0]);
  for (let k = 1; k <= RINGS; k++) for (let j = 0; j < NP; j++) { const p = POND_PTS[j]; wBase.push([p[0] * k / RINGS, p[1] * k / RINGS]); }
  const wIdx = [];
  for (let j = 0; j < NP; j++) wIdx.push(0, 1 + ((j + 1) % NP), 1 + j);
  for (let k = 1; k < RINGS; k++) {
    for (let j = 0; j < NP; j++) {
      const a = 1 + (k - 1) * NP + j, b = 1 + (k - 1) * NP + ((j + 1) % NP), c = 1 + k * NP + j, d = 1 + k * NP + ((j + 1) % NP);
      wIdx.push(a, b, c, b, d, c);
    }
  }
  wBase.forEach((p, i) => { wUv[i * 2] = p[0] / 14; wUv[i * 2 + 1] = p[1] / 14; wEdge[i] = i ? Math.ceil(i / NP) / RINGS : 0; });
  const wGeo = new THREE.BufferGeometry();
  wGeo.setAttribute('position', new THREE.BufferAttribute(wPos, 3));
  wGeo.setAttribute('uv', new THREE.BufferAttribute(wUv, 2));
  wGeo.setAttribute('edge', new THREE.BufferAttribute(wEdge, 1));
  wGeo.setIndex(wIdx);
  const waterMesh = new THREE.Mesh(wGeo, pondMaterial());
  waterMesh.receiveShadow = true; waterMesh.renderOrder = 1;
  root.add(waterMesh);
  const setWater = (t) => {
    for (let i = 0; i < wBase.length; i++) { wPos[i * 3] = wBase[i][0]; wPos[i * 3 + 1] = waveY(wBase[i][0], wBase[i][1], t); wPos[i * 3 + 2] = wBase[i][1]; }
    wGeo.attributes.position.needsUpdate = true;
    wGeo.computeVertexNormals();
    waterTex.offset.set(t * 0.012, t * 0.006);
    pondTime.value = t;
  };
  setWater(0);

  // fountain water + jets
  {
    const g = new THREE.CircleGeometry(2.35, 20); g.rotateX(-Math.PI / 2);
    const uv = g.attributes.uv, p = g.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (p.getX(i) + PLAZA.x) / 14, (p.getZ(i) + PLAZA.z) / 14);
    const m = new THREE.Mesh(g, waterMat); m.position.set(PLAZA.x, 0.62, PLAZA.z); root.add(m);
  }
  const jetMat = new THREE.MeshPhongMaterial({ color: 0xa9e4ff, specular: 0xffffff, shininess: 100, transparent: true, opacity: 0.62, depthWrite: false });
  const jets = (() => {
    const parts = [];
    put(cyl(0.08, 0.2, 2.2, 8), 0xffffff, 0, 1.1, 0, { to: parts });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2, tilt = 0.55;
      const g = cyl(0.04, 0.12, 1.5, 6);
      g.translate(0, 0.75, 0); g.rotateZ(-tilt); g.rotateY(-a);
      put(g, 0xffffff, Math.cos(a) * 0.3, 0.1, Math.sin(a) * 0.3, { to: parts });
    }
    const m = new THREE.Mesh(mergeGeometries(parts), jetMat);
    m.position.set(PLAZA.x, 2.95, PLAZA.z);
    root.add(m);
    return m;
  })();
  return (dt, t) => {
    setWater(t);
    jets.scale.y = 1 + 0.07 * Math.sin(t * 5.3);
    jets.scale.x = jets.scale.z = 1 + 0.04 * Math.sin(t * 3.1);
  };
}

// lily pads (instanced, bobbing)
function addLilyPads(root) {
  const padGeo = new THREE.CircleGeometry(0.62, 12, 0.25, Math.PI * 2 - 0.5); padGeo.rotateX(-Math.PI / 2);
  const pads = [];
  for (const [cx, cz] of [[-6, 5], [7, -5.5], [-8, -4.5], [5, 6.3], [-2, 7.5]]) {
    for (let i = 0; i < 5; i++) {
      const x = cx + rr(-2.3, 2.3), z = cz + rr(-1.8, 1.8);
      if (pondGap(x, z) < -2.2 && Math.hypot(x - ISLAND.x, z - ISLAND.z) > 4.2) pads.push({ x, z, s: rr(0.7, 1.3), r: rr(0, 6.28), ph: rr(0, 6.28), f: rng() < 0.45 });
    }
  }
  const padMesh = new THREE.InstancedMesh(padGeo, toon({ color: 0xffffff, side: THREE.DoubleSide }), pads.length);
  const flowers = pads.filter((p) => p.f);
  const flowerMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.17, 0), toon({ color: 0xffffff }), flowers.length);
  pads.forEach((p, i) => padMesh.setColorAt(i, new THREE.Color(pick([0x3fae42, 0x56c23a, 0x2f9a4a, 0x6ccf45]))));
  flowers.forEach((p, i) => flowerMesh.setColorAt(i, new THREE.Color(pick([0xff7ac2, 0xffffff, 0xffd23f]))));
  padMesh.receiveShadow = true; padMesh.renderOrder = 3; flowerMesh.renderOrder = 3;
  root.add(padMesh, flowerMesh);
  const setPads = (t) => {
    pads.forEach((p, i) => {
      const y = waveY(p.x, p.z, t) + 0.045;
      dummy.position.set(p.x, y, p.z); dummy.rotation.set(Math.sin(t * 1.3 + p.ph) * 0.04, p.r + Math.sin(t * 0.3 + p.ph) * 0.1, Math.cos(t * 1.1 + p.ph) * 0.04);
      dummy.scale.setScalar(p.s); dummy.updateMatrix(); padMesh.setMatrixAt(i, dummy.matrix);
    });
    flowers.forEach((p, i) => {
      dummy.position.set(p.x + 0.12, waveY(p.x, p.z, t) + 0.17, p.z); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(p.s); dummy.updateMatrix(); flowerMesh.setMatrixAt(i, dummy.matrix);
    });
    padMesh.instanceMatrix.needsUpdate = true; flowerMesh.instanceMatrix.needsUpdate = true;
  };
  setPads(0);
  return (dt, t) => setPads(t);
}

function addButterflies(root) {
  const bflyGeo = new THREE.BufferGeometry();
  bflyGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0.22, 0.05, 0.12, 0.2, 0.0, -0.12, 0, 0, 0, -0.22, 0.05, 0.12, -0.2, 0.0, -0.12], 3));
  const flies = [];
  [[-47, 14], [47, 14], [-4.5, 34], [4.5, -34], [-38, -4], [-38, -20], [24, -33], [-24, 33]].forEach(([x, z], i) => {
    const m = new THREE.Mesh(bflyGeo, new THREE.MeshBasicMaterial({ color: pick([0xffd23f, 0xff7ac2, 0x7ad0ff, 0xffffff, 0xff8a1f]), side: THREE.DoubleSide }));
    m.userData = { x, z, ph: i * 1.7, sp: rr(0.5, 0.9), r: rr(1.5, 3) };
    root.add(m); flies.push(m);
  });
  return (dt, t) => {
    for (const f of flies) {
      const u = f.userData, a = t * u.sp + u.ph;
      f.position.set(u.x + Math.cos(a) * u.r, 0.9 + Math.sin(a * 1.7) * 0.35, u.z + Math.sin(a * 1.3) * u.r);
      f.rotation.y = -a + Math.PI / 2;
      f.scale.set(1, 0.4 + 0.6 * Math.abs(Math.sin(t * 14 + u.ph)), 1);
    }
  };
}

// grass tufts and wildflowers
function addScatter(root) {
  const parts = [];
  const tuft = (x, z, c) => {
    for (let i = 0; i < 3; i++) {
      const h = rr(0.28, 0.5), dx = rr(-0.12, 0.12), dz = rr(-0.12, 0.12), rx = rr(-0.3, 0.3), rz = rr(-0.3, 0.3);
      put(cone(0.07, h, 3), new THREE.Color(c).offsetHSL(0, 0, rr(-0.04, 0.05)), x + dx, 0.16, z + dz, { rx, rz, to: parts });
    }
  };
  let n = 0;
  for (let i = 0; i < 900 && n < 260; i++) {
    const x = rr(-50, 50), z = rr(-36, 36);
    if (pondGap(x, z) < 1 || distPath(x, z) < 2.2) continue;
    tuft(x, z, pick([0x4aaf34, 0x6bcf45, 0x39992f])); n++;
  }
  n = 0;
  for (let i = 0; i < 900 && n < 150; i++) {
    const x = rr(-50, 50), z = rr(-36, 36);
    if (pondGap(x, z) < 1 || distPath(x, z) < 2.2) continue;
    put(new THREE.IcosahedronGeometry(0.075, 0), pick([0xffffff, 0xffe14a, 0xff9ec0, 0xc08bff]), x, 0.17, z, { to: parts });
    n++;
  }
  const m = new THREE.Mesh(mergeGeometries(parts), toon({ vertexColors: true, side: THREE.DoubleSide }));
  m.receiveShadow = true;
  root.add(m);
}

// wind-swept grass blades: one instanced draw. They skip the depth buffer (drawn after the opaque
// world) so the ink-outline pass ignores them, and shrink to nothing far from the camera.
function addGrass(root) {
  const R = mulberry32(SEED + 7);
  const blade = new THREE.BufferGeometry();
  blade.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, -0.3, 0.5, 0, 0.3, 0.5, 0, 0, 1, 0], 3));
  blade.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 0.5, 1, 0.5, 0.5, 1], 2));
  blade.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(15).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  blade.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4]);
  const onGrass = (x, z) => pondGap(x, z) > 0.6 && distPath(x, z) > PATH_W / 2 + 0.25
    && Math.hypot(x - PLAZA.x, z - PLAZA.z) > 7 && Math.hypot((x - KIOSK.x + 1) / 1.0, (z - KIOSK.z + 4.2) / 0.62) > 5.4
    && !(Math.abs(x - PLAY.x) < 7.6 && Math.abs(z - PLAY.z + 0.5) < 5.6) && !(Math.abs(x + 16) < 2 && Math.abs(z - 26) < 1.6)
    && !colliders.some((c) => (c.r !== undefined ? Math.hypot(x - c.x, z - c.z) < c.r : Math.abs(x - c.x) < c.hx && Math.abs(z - c.z) < c.hz));
  const spots = [];
  for (let i = 0; i < 140000 && spots.length < 42000; i++) {
    const x = (R() * 2 - 1) * (HALF_X + 2), z = (R() * 2 - 1) * (HALF_Z + 2);
    if (onGrass(x, z)) spots.push([x, z]);
  }
  const mat = toon({ side: THREE.DoubleSide, depthWrite: false });
  const time = { value: 0 };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = time;
    sh.vertexShader = 'uniform float uTime;\nvarying float vTip;\n' + sh.vertexShader.replace('#include <begin_vertex>', `
      vec3 transformed = position;
      vec3 base = instanceMatrix[3].xyz;
      float fade = 1.0 - smoothstep(26.0, 40.0, distance(base.xz, cameraPosition.xz));
      transformed *= fade;
      float gust = sin(uTime * 1.7 + base.x * 0.21 + base.z * 0.13) * 0.5 + sin(uTime * 3.1 + base.x * 0.9) * 0.18;
      transformed.x += gust * uv.y * uv.y * 0.22 / max(0.2, length(instanceMatrix[0].xyz));
      vTip = uv.y;`);
    sh.fragmentShader = 'varying float vTip;\n' + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb *= mix(0.55, 1.15, vTip);');
  };
  const mesh = new THREE.InstancedMesh(blade, mat, spots.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), pos = new THREE.Vector3(), col = new THREE.Color();
  spots.forEach(([x, z], i) => {
    const h = 0.16 + R() * 0.2, w = 0.07 + R() * 0.05;
    q.setFromEuler(e.set(R() * 0.3 - 0.15, R() * Math.PI, R() * 0.3 - 0.15));
    mesh.setMatrixAt(i, m4.compose(pos.set(x, 0, z), q, sc.set(w, h, w)));
    mesh.setColorAt(i, col.setHSL(0.27 + R() * 0.06, 0.62, 0.36 + R() * 0.1));
  });
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  mesh.frustumCulled = false;
  root.add(mesh);
  return (dt, t) => { time.value = t; };
}

// ---------- builder ----------
export function buildPark(scene) {
  resetState();
  const root = new THREE.Group();
  root.name = 'park';
  scene.add(root);

  addSky(scene, root);
  const updateClouds = addClouds(root);
  addGround(root);
  addPondBed();
  addPaths();
  addPicnic();
  addFountain();
  addPlayground();
  addKiosk();
  addRingFurniture();
  addCover();
  addTrees();
  addPondDressing();
  addIsland();
  addFence();
  addBorderland();
  finalizeMeshes(root, addSkyline());
  const updaters = [updateClouds, addWater(root), addLilyPads(root), addButterflies(root)];
  addScatter(root);
  updaters.push(addGrass(root));

  const cols = colliders; // this build's list; module state is replaced by the next build
  return {
    bounds: { halfX: HALF_X, halfZ: HALF_Z },
    colliders,
    canopies,
    isWater,
    waterLevel: WATER_LEVEL,
    teamSpawns: SPAWNS.map((s) => ({ ...s })),
    pickupSpots: PICKUPS.map((s) => ({ ...s })),
    perch: { x: ISLAND.x - 0.2 + 2.5, y: 6.2, z: ISLAND.z + 0.1 },
    // true when a body at height y with extra margin pad touches a collider
    blocked: (x, z, y = 0, pad = 0) => cols.some((c) => y <= c.h && (c.r !== undefined
      ? Math.hypot(x - c.x, z - c.z) < c.r + pad
      : Math.abs(x - c.x) < c.hx + pad && Math.abs(z - c.z) < c.hz + pad)),
    update(dt, t) { for (const u of updaters) u(dt, t); },
  };
}
