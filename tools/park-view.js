// Park viewer. ?cam=overview|ground|orbit (default orbit)  ?debug=1  ?a=<angle rad>  ?spawn=0..4  ?freeze=1
import * as THREE from 'three';
import { buildPark } from '../src/park.js';
import { TEAM_COLORS } from '../src/species.js';

const q = new URLSearchParams(location.search);
const cam = q.get('cam') || 'orbit';
const debug = q.get('debug') === '1';
const angle0 = parseFloat(q.get('a') ?? '0.6');
const freeze = q.get('freeze') === '1';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const park = buildPark(scene);
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 400);
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

// scale-reference stand-in (1.85 m person) at the chosen spawn
const spawnIdx = parseInt(q.get('spawn') ?? '3', 10);
const sp = park.teamSpawns[spawnIdx];
{
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 1.5, 10), new THREE.MeshLambertMaterial({ color: 0x3b6fd4 }));
  body.position.y = 0.75;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), new THREE.MeshLambertMaterial({ color: 0xe8b48a }));
  head.position.y = 1.65;
  g.add(body, head); g.position.set(sp.x, 0, sp.z);
  body.castShadow = head.castShadow = true;
  scene.add(g);
}

if (debug) {
  const lines = [];
  const seg = (a, b) => lines.push(a.x, a.y, a.z, b.x, b.y, b.z);
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  for (const c of park.colliders) {
    const pts = [];
    if (c.r !== undefined) for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; pts.push([c.x + Math.cos(a) * c.r, c.z + Math.sin(a) * c.r]); }
    else pts.push([c.x - c.hx, c.z - c.hz], [c.x + c.hx, c.z - c.hz], [c.x + c.hx, c.z + c.hz], [c.x - c.hx, c.z + c.hz]);
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      seg(V(a[0], 0.1, a[1]), V(b[0], 0.1, b[1]));
      seg(V(a[0], Math.min(c.h, 4), a[1]), V(b[0], Math.min(c.h, 4), b[1]));
      if (i % 4 === 0) seg(V(a[0], 0.1, a[1]), V(a[0], Math.min(c.h, 4), a[1]));
    }
  }
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  const ls = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xffee00, depthTest: false, transparent: true }));
  ls.renderOrder = 999; scene.add(ls);
  const wp = [], wc = [];
  for (let x = -22; x <= 22; x += 1) for (let z = -16; z <= 16; z += 1) {
    const w = park.isWater(x, z); wp.push(x, 0.3, z); wc.push(w ? 1 : 0.2, w ? 0.1 : 1, w ? 0.1 : 0.2);
  }
  const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3)); wg.setAttribute('color', new THREE.Float32BufferAttribute(wc, 3));
  const pts = new THREE.Points(wg, new THREE.PointsMaterial({ size: 0.4, vertexColors: true, depthTest: false, transparent: true })); pts.renderOrder = 998; scene.add(pts);
  const mk = (geo, color, x, y, z) => { const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, depthTest: false })); m.position.set(x, y, z); m.renderOrder = 1000; scene.add(m); };
  park.teamSpawns.forEach((s, i) => { mk(new THREE.CylinderGeometry(1.2, 1.2, 8, 12), TEAM_COLORS[i], s.x, 4, s.z); });
  park.pickupSpots.forEach((s) => mk(new THREE.SphereGeometry(0.6, 10, 8), 0xffff00, s.x, 0.8, s.z));
  mk(new THREE.SphereGeometry(0.5, 10, 8), 0xff00ff, park.perch.x, park.perch.y, park.perch.z);
  mk(new THREE.CylinderGeometry(0.08, 0.08, park.perch.y, 6), 0xff00ff, park.perch.x, park.perch.y / 2, park.perch.z);
}

function report() {
  const out = { colliders: park.colliders.length, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, issues: [] };
  const dEdge = (c, x, z) => c.r !== undefined ? Math.hypot(x - c.x, z - c.z) - c.r
    : Math.hypot(Math.max(Math.abs(x - c.x) - c.hx, 0), Math.max(Math.abs(z - c.z) - c.hz, 0));
  const clearance = (x, z) => Math.min(...park.colliders.map((c) => dEdge(c, x, z)));
  park.teamSpawns.forEach((s, i) => {
    if (park.isWater(s.x, s.z)) out.issues.push(`spawn ${i} in water`);
    const c = clearance(s.x, s.z); if (c < 3) out.issues.push(`spawn ${i} clearance ${c.toFixed(1)}`);
    park.teamSpawns.forEach((t, j) => { if (j > i && Math.hypot(s.x - t.x, s.z - t.z) < 25) out.issues.push(`spawns ${i}-${j} too close`); });
  });
  out.spawns = park.teamSpawns.length;
  park.pickupSpots.forEach((s, i) => {
    if (park.isWater(s.x, s.z)) out.issues.push(`pickup ${i} in water`);
    const c = clearance(s.x, s.z); if (c < 2) out.issues.push(`pickup ${i} clearance ${c.toFixed(1)}`);
  });
  // flood fill of walkable land (agent radius 0.7) from spawn 0
  const step = 0.5, nx = Math.round(110 / step), nz = Math.round(80 / step);
  const ok = new Uint8Array(nx * nz), seen = new Uint8Array(nx * nz);
  const wx = (i) => -55 + (i + 0.5) * step, wz = (j) => -40 + (j + 0.5) * step;
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) ok[i * nz + j] = !park.isWater(wx(i), wz(j)) && clearance(wx(i), wz(j)) > 0.7 ? 1 : 0;
  const st = [[Math.floor((park.teamSpawns[0].x + 55) / step), Math.floor((park.teamSpawns[0].z + 40) / step)]];
  seen[st[0][0] * nz + st[0][1]] = 1; let reached = 0;
  while (st.length) {
    const [i, j] = st.pop(); reached++;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= nx || b >= nz || !ok[a * nz + b] || seen[a * nz + b]) continue;
      seen[a * nz + b] = 1; st.push([a, b]);
    }
  }
  let stranded = 0, strandedPts = [];
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) if (ok[i * nz + j] && !seen[i * nz + j]) {
    if (Math.hypot(wx(i) - 1.5, wz(j) + 0.5) > 3.2) { stranded++; if (strandedPts.length < 6) strandedPts.push([wx(i), wz(j)]); }
  }
  out.walkableCells = reached; out.strandedLandCells = stranded; out.strandedSample = strandedPts;
  for (const s of park.teamSpawns) { const i = Math.floor((s.x + 55) / step), j = Math.floor((s.z + 40) / step); if (!seen[i * nz + j]) out.issues.push('spawn disconnected'); }
  return out;
}

const hud = document.getElementById('hud');
let last = performance.now();
let t = 0, frames = 0;
function frame() {
  const now = performance.now(), dt = Math.min((now - last) / 1000, 0.05); last = now;
  if (!freeze) t += dt; else t = 3;
  park.update(dt, t);
  const a = angle0 + (freeze ? 0 : t * 0.15);
  if (cam === 'overview') {
    camera.position.set(Math.sin(a) * 45, 100, Math.cos(a) * 62); camera.lookAt(0, 0, 0);
  } else if (cam === 'ground') {
    // third-person-ish: behind and above the stand-in, looking toward the pond
    const dx = -sp.x, dz = -sp.z, l = Math.hypot(dx, dz), ux = dx / l, uz = dz / l;
    camera.position.set(sp.x - ux * 7 - uz * 1.5, 3.4, sp.z - uz * 7 + ux * 1.5);
    camera.lookAt(sp.x + ux * 8, 1.2, sp.z + uz * 8);
  } else if (cam === 'free') {
    const P = q.get('p').split(',').map(Number), L = q.get('l').split(',').map(Number);
    camera.position.set(...P); camera.lookAt(...L);
  } else {
    camera.position.set(Math.sin(a) * 60, 32, Math.cos(a) * 55); camera.lookAt(0, 0, 0);
  }
  renderer.render(scene, camera);
  frames++;
  if (frames === 5) {
    window.__park = report();
    console.log('PARKREPORT ' + JSON.stringify(window.__park));
    hud.textContent = `calls ${window.__park.calls}  tris ${window.__park.triangles}  colliders ${window.__park.colliders}`;
    window.__ready = true;
  }
  requestAnimationFrame(frame);
}
frame();
