// Flat chroma key for green-screen videos drawn in the engine scene (the Selfie intro).
//
// Keyed in raw sRGB (immersive skill pitfall: three hands a shader LINEAR samples from an sRGB VideoTexture, and the
// same thresholds then key far too much). The texture is NoColorSpace (raw values in), the key colour is raw sRGB, and
// the result is written straight out (no colorspace / tone mapping chunks). Distance is measured in CbCr; one small
// soft threshold (similarity -> similarity + smoothness), no gradient edges. Numbers were checked in numpy on the
// Cheer Bear wink clip: the green sits at CbCr distance < 0.05, the bear at > 0.3.
import * as THREE from 'three';

export interface ChromaOptions {
  /** Raw sRGB 0..255. Default: the Cheer Bear clips' green (0, 182, 87). */
  key?: [number, number, number];
  similarity?: number;
  smoothness?: number;
  /** 0..1: how much green spill to pull out of the kept edge pixels. */
  spill?: number;
}

export function chromaMaterial(map: THREE.Texture, o: ChromaOptions = {}): THREE.ShaderMaterial {
  const k = o.key ?? [0, 182, 87];
  map.colorSpace = THREE.NoColorSpace;
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: map },
      keyColor: { value: new THREE.Vector3(k[0] / 255, k[1] / 255, k[2] / 255) },
      similarity: { value: o.similarity ?? 0.16 },
      smoothness: { value: o.smoothness ?? 0.1 },
      spill: { value: o.spill ?? 0.85 },
      opacity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform vec3 keyColor;
      uniform float similarity;
      uniform float smoothness;
      uniform float spill;
      uniform float opacity;
      varying vec2 vUv;
      vec2 cbcr(vec3 c) {
        return vec2(-0.168736 * c.r - 0.331264 * c.g + 0.5 * c.b, 0.5 * c.r - 0.418688 * c.g - 0.081312 * c.b);
      }
      void main() {
        vec3 c = texture2D(map, vUv).rgb;
        float d = distance(cbcr(c), cbcr(keyColor));
        float a = smoothstep(similarity, similarity + smoothness, d);
        float m = max(c.r, c.b);
        if (c.g > m) c.g = mix(c.g, m + (c.g - m) * 0.15, spill);
        gl_FragColor = vec4(c, a * opacity);
      }`,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}
