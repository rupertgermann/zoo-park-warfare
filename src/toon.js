import * as THREE from 'three';

// Shared cel-shading ramp: shadow, mid, lit. NearestFilter keeps the bands hard.
const ramp = new THREE.DataTexture(new Uint8Array([80, 160, 215]), 3, 1, THREE.RedFormat);
ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
ramp.generateMipmaps = false;
ramp.needsUpdate = true;

export function toon(params = {}) {
  return new THREE.MeshToonMaterial({ gradientMap: ramp, ...params });
}
