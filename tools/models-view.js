// Gallery: every creature + prop on a ground plane. Query: ?anim=move|air|swim|attack|hurt|stun|dead|special
// &focus=<id>|row1|row2|props (close-up) &yaw=<rad> (fixed facing instead of slow spin) &props=0
import * as THREE from 'three';
import { buildCreature, buildProp } from '../src/models.js';
import { SPECIES, BOSS, TEAM_COLORS } from '../src/species.js';

const q = new URLSearchParams(location.search);
const anim = q.get('anim') || 'idle', focus = q.get('focus'), yaw = q.get('yaw');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fd3ff);
scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x5a7a3a, 1.1));
const sun = new THREE.DirectionalLight(0xfff1d6, 2.6);
sun.position.set(8, 14, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 12, bottom: -12, near: 1, far: 50 });
scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: 0x6fbf4a, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
if (anim === 'swim') {
  const water = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: 0x2f8fd0, transparent: true, opacity: 0.75 }));
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.36;
  scene.add(water);
}

const ids = [...SPECIES.map(s => s.id), BOSS.id];
const mid = (ids.length - 2) / 2;
const creatures = ids.map((id, i) => {
  const c = buildCreature(id);
  const boss = id === BOSS.id;
  c.root.position.set(boss ? 0 : (i - mid) * 2.1, 0, boss ? -6 : 0);
  if (anim === 'swim') c.root.position.y = 0.36;
  if (anim === 'air') c.root.position.y = boss ? 2 : 1.2;
  c.setTeamColor(TEAM_COLORS[i % TEAM_COLORS.length]);
  scene.add(c.root);
  let meshes = 0;
  c.root.traverse(o => { if (o.isMesh) meshes++; });
  return { id, c, meshes };
});
const propNames = ['fish', 'carrot', 'poop', 'nut', 'bignut', 'cap', 'quack', 'bread', 'chick', 'pigeon', 'bossfish', 'cherry'];
const props = q.get('props') === '0' ? [] : propNames.map((n, i) => {
  const p = buildProp(n);
  p.position.set((i - (propNames.length - 1) / 2) * 1.3, 0.45, 3);
  scene.add(p);
  return p;
});

const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.05, 200);
const f = focus && creatures.find(x => x.id === focus);
if (f) {
  const h = Math.max(f.c.height, 1.1), p = f.c.root.position;
  camera.position.set(p.x + h * 0.9, p.y + h * 0.75, p.z + h * 2.1);
  camera.lookAt(p.x, p.y + h * 0.5, p.z);
} else if (focus === 'row1' || focus === 'row2') {
  const x = (focus === 'row1' ? -1 : 1) * (ids.length - 1) * 0.525;
  camera.position.set(x, 2.6, 0.75 * (ids.length - 1));
  camera.lookAt(x, 0.7, 0);
} else if (focus === 'props') {
  camera.position.set(0, 2.2, 8.5);
  camera.lookAt(0, 0.4, 3);
} else {
  camera.position.set(0, 5.5, 15);
  camera.lookAt(0, 1.2, -1);
}

window.__creatures = creatures;
// measured: bbox top of the idle rig in meters (ears/crests included), vs. the declared nameplate height
const measure = c => {
  c.update(0, { t: 0 });
  c.root.updateMatrixWorld(true);
  const box = new THREE.Box3(), b = new THREE.Box3();
  const walk = o => { if (!o.visible) return; if (o.isMesh) { o.geometry.computeBoundingBox(); box.union(b.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld)); } o.children.forEach(walk); };
  walk(c.root);
  return +(box.max.y - c.root.position.y).toFixed(2);
};
window.__stats = {
  meshes: Object.fromEntries(creatures.map(x => [x.id, x.meshes])),
  heights: Object.fromEntries(creatures.map(x => [x.id, x.c.height])),
  measured: Object.fromEntries(creatures.map(x => [x.id, measure(x.c)])),
};
document.getElementById('info').textContent = `anim=${anim}\n` + creatures.map(x => `${x.id}: ${x.meshes} meshes`).join('\n');

const timer = new THREE.Timer();
let frames = 0;
renderer.setAnimationLoop(ts => {
  timer.update(ts);
  const dt = timer.getDelta(), t = timer.getElapsed();
  const pulse = Math.max(0, 1 - (t % 1.3) * 3.5);
  const a = {
    t, move: anim === 'move' ? 1 : 0, air: anim === 'air', swim: anim === 'swim',
    attack: anim === 'attack' ? pulse : 0, hurt: anim === 'hurt' ? pulse : 0,
    stun: anim === 'stun', dead: anim === 'dead', special: anim === 'special' ? 1 : 0,
  };
  for (const { c } of creatures) {
    c.update(dt, a);
    c.root.rotation.y = yaw !== null ? +yaw : t * 0.4;
  }
  props.forEach((p, i) => { p.rotation.y = yaw !== null ? +yaw : t * 0.8 + i; });
  renderer.render(scene, camera);
  if (++frames === 30) { window.__stats.calls = renderer.info.render.calls; window.__ready = true; }
});
