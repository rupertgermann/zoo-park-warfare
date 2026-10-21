import * as THREE from 'three';

// Particle bursts (feathers, splashes, crumbs) share one InstancedMesh; rings are a small mesh pool.
const MAX = 700;
const dummy = new THREE.Object3D();
const color = new THREE.Color();

export function createFx(scene) {
  const mesh = new THREE.InstancedMesh(
    new THREE.TetrahedronGeometry(0.12),
    new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.7 }),
    MAX,
  );
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;
  scene.add(mesh);
  const parts = [];

  const ringGeo = new THREE.RingGeometry(0.85, 1, 48);
  ringGeo.rotateX(-Math.PI / 2);
  const rings = [];

  function burst(pos, hex, n = 12, o = {}) {
    const speed = o.speed ?? 5, up = o.up ?? 4, life = o.life ?? 0.8, size = o.size ?? 1, g = o.gravity ?? 14;
    for (let i = 0; i < n && parts.length < MAX; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.4 + Math.random() * 0.6);
      parts.push({
        p: new THREE.Vector3(pos.x, pos.y, pos.z),
        v: new THREE.Vector3(Math.cos(a) * s, up * (0.5 + Math.random()), Math.sin(a) * s),
        r: new THREE.Vector3(Math.random() * 6, Math.random() * 6, 0),
        life, max: life, size: size * (0.6 + Math.random() * 0.8), g,
        c: color.set(Array.isArray(hex) ? hex[i % hex.length] : hex).clone(),
        drag: o.drag ?? 1.5,
      });
    }
  }

  function ring(pos, radius, hex, life = 0.45, o = {}) {
    let r = rings.find(r => !r.mesh.visible);
    if (!r) {
      r = { mesh: new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide })) };
      scene.add(r.mesh);
      rings.push(r);
    }
    r.mesh.visible = true;
    r.mesh.material.color.set(hex);
    r.mesh.position.set(pos.x, (pos.y ?? 0) + 0.06, pos.z);
    Object.assign(r, { radius, life, max: life, grow: o.grow ?? true, follow: o.follow ?? null });
    return r;
  }

  function update(dt, eye) {
    let n = 0;
    for (let i = parts.length - 1; i >= 0; i--) {
      const q = parts[i];
      q.life -= dt;
      if (q.life <= 0) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
      q.v.y -= q.g * dt;
      q.v.multiplyScalar(Math.max(0, 1 - q.drag * dt));
      q.p.addScaledVector(q.v, dt);
      if (q.p.y < 0.05) { q.p.y = 0.05; q.v.y *= -0.3; q.v.x *= 0.6; q.v.z *= 0.6; }
      q.r.x += dt * 8; q.r.y += dt * 6;
      dummy.position.copy(q.p);
      dummy.rotation.set(q.r.x, q.r.y, 0);
      const near = eye ? Math.min(1, q.p.distanceTo(eye) / 3) : 1;
      dummy.scale.setScalar(q.size * near * Math.min(1, q.life / q.max * 2.5));
      dummy.updateMatrix();
      mesh.setMatrixAt(n, dummy.matrix);
      mesh.setColorAt(n, q.c);
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    for (const r of rings) {
      if (!r.mesh.visible) continue;
      r.life -= dt;
      if (r.life <= 0) { r.mesh.visible = false; continue; }
      const k = 1 - r.life / r.max;
      if (r.follow) r.mesh.position.set(r.follow.x, 0.06, r.follow.z);
      r.mesh.scale.setScalar(r.grow ? r.radius * (0.3 + 0.7 * k) : r.radius);
      r.mesh.material.opacity = r.grow ? 1 - k : 0.35 + 0.45 * Math.abs(Math.sin(k * 18));
    }
  }

  function clear() {
    parts.length = 0;
    for (const r of rings) r.mesh.visible = false;
  }

  return { burst, ring, update, clear };
}
