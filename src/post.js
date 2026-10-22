import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// Ink outlines from the depth buffer, then a light grade. Runs after tone mapping, in display space.
// 1/viewZ is linear across a flat surface in screen space, so its Laplacian is ~0 on ground and walls
// and spikes only at silhouettes and creases: no extra scene pass and no false lines on grazing ground.
const FinalShader = {
  uniforms: {
    tDiffuse: { value: null }, tDepth: { value: null },
    texel: { value: new THREE.Vector2() }, near: { value: 0.1 }, far: { value: 400 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    #include <packing>
    uniform sampler2D tDiffuse, tDepth;
    uniform vec2 texel;
    uniform float near, far;
    varying vec2 vUv;
    float invZ(vec2 uv) { return 1.0 / -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, near, far); }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float w = invZ(vUv);
      float lap = invZ(vUv + vec2(texel.x, 0.0)) + invZ(vUv - vec2(texel.x, 0.0))
                + invZ(vUv + vec2(0.0, texel.y)) + invZ(vUv - vec2(0.0, texel.y)) - 4.0 * w;
      float z = 1.0 / w;
      float ink = smoothstep(0.03, 0.09, abs(lap) / w) * (1.0 - smoothstep(35.0, 90.0, z));
      c = mix(c, c * vec3(0.16, 0.12, 0.22), ink * 0.85);
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(vec3(l), c, 1.12);
      vec2 v = vUv - 0.5;
      c *= 1.0 - dot(v, v) * 0.35;
      gl_FragColor = vec4(c, 1.0);
    }`,
};

export function createPost(renderer, scene, camera) {
  // MSAA at 2x pixel ratio halves the frame rate and the pixels are small enough without it
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: renderer.getPixelRatio() > 1.5 ? 0 : 4 });
  rt.depthTexture = new THREE.DepthTexture(1, 1);
  const composer = new EffectComposer(renderer, rt);
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.3, 0.4, 1.3);
  const final = new ShaderPass(FinalShader);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  composer.addPass(final);

  return {
    render() {
      // RenderPass and bloom draw into readBuffer in place; the two later passes swap back, so at
      // frame start readBuffer always holds the scene and its depth.
      final.uniforms.tDepth.value = composer.readBuffer.depthTexture;
      final.uniforms.near.value = camera.near;
      final.uniforms.far.value = camera.far;
      composer.render();
    },
    setSize(w, h) {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(w, h);
      // sample one CSS pixel apart so lines keep the same weight on hi-dpi screens
      final.uniforms.texel.value.set(1.2 / w, 1.2 / h);
    },
  };
}
