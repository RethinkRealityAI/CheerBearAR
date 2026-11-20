// The outside of Cheer Bear's house: a pastel cottage on a cloud, its arched door framed by a flat-striped rainbow
// that grows out of two little clouds, heart windows with flower boxes, a cloud roof with a chimney that puffs tiny
// hearts, a sun, a heart doormat, heart stepping stones and a little garden. An original design in the Care-a-Lot
// spirit (no copied artwork, no logos). Flat colours only.
//
// Split in two so the portal can hide what would otherwise stand inside the (much bigger) room:
//   front  everything at z >= -0.2 (the facade, the door frame, windows, garden): always drawn
//   body   the cottage behind the facade (side and back walls, the roof, the chimney, the side tree): hidden while
//          you're inside. Its walls are single-sided and face outwards, so looking in through the door you never
//          see their inner faces: you see the room.
import * as THREE from 'three';
import { PAL, RAINBOW } from '../fx';
import { COT, DOOR, DOOR_H0, DOOR_R } from './dims';
import { Builder, M, archShape, bandShape, box, cyl, dome, extrude, heart, puff, starShape } from './geo';

export const COL = {
  wall: 0xffc6de, wallSide: 0xffb8d6, trim: 0xffffff, roof: 0xf4ecff, cloud: 0xffffff, cloudLilac: 0xeee4ff,
  door: 0xff6fae, pane: 0xa9dcff, heart: 0xff4f8b, leaf: 0x6fd58f, leafDark: 0x4fbf78, lilac: 0xd7c6ff,
  chimney: 0xff9cc9, sun: 0xffd84a, sunRay: 0xffb83d, stone: [0xffd6ea, 0xd4edff, 0xfff1b8, 0xe2d6ff],
};

/** The cottage's front outline (rounded gable), bottom at y = 0. */
export function facadeShape(withDoor: boolean): THREE.Shape {
  const s = new THREE.Shape(), w = COT.w / 2;
  s.moveTo(-w, 0);
  s.lineTo(w, 0);
  s.lineTo(w, COT.wall);
  s.quadraticCurveTo(0, COT.peak * 2 - COT.wall, -w, COT.wall);
  s.lineTo(-w, 0);
  if (withDoor) {
    const hole = new THREE.Path();
    archShape(DOOR.w, DOOR.h, hole, true);
    s.holes.push(hole);
  }
  return s;
}

/** Height of the gable curve at x (for the roof). */
export function gableY(x: number): number {
  const w = COT.w / 2, t = (x + w) / (2 * w); // quadratic bezier from (w, wall) via (0, c) to (-w, wall), symmetric
  return COT.wall + 2 * t * (1 - t) * (COT.peak * 2 - COT.wall - COT.wall) ;
}

/** The rainbow door frame (white inner trim + six flat stripes, red outside), legs to the floor, facing +z. */
export function rainbowFrame(b: Builder, m: THREE.Matrix4, ri0: number, h0: number, band: number, depth: number, trim = 0.05): void {
  b.add(extrude(bandShape(ri0, ri0 + trim, h0), depth), COL.trim, m);
  for (let i = 0; i < 6; i++) {
    const ri = ri0 + trim + i * band;
    b.add(extrude(bandShape(ri, ri + band, h0), depth + 0.004 * (6 - i)), RAINBOW[5 - i], m);
  }
}

export interface Exterior {
  front: THREE.BufferGeometry;
  body: THREE.BufferGeometry;
  /** Unlit bits (the sun). */
  glow: THREE.BufferGeometry;
  /** Where the chimney puffs from (door-local). */
  chimneyTop: THREE.Vector3;
  /** The sun's centre (door-local); its mesh is built separately so it can turn. */
  sunAt: THREE.Vector3;
}

export function buildExterior(): Exterior {
  const F = new Builder(), B = new Builder();
  const w = COT.w / 2, t = COT.t;

  // ---- facade (with the door hole), extruded towards the room
  F.add(extrude(facadeShape(true), t, 0, 24), COL.wall, M(0, 0, -t));
  // base band (lilac) either side of the door frame
  const fr = DOOR_R + 0.05 + 6 * 0.062; // outer radius of the rainbow
  for (const sx of [-1, 1]) {
    const x0 = fr + 0.02, x1 = w;
    F.add(box(x1 - x0, 0.16, 0.03), COL.lilac, M(sx * (x0 + x1) / 2, 0.08, 0.015));
  }
  // corner posts with round caps
  for (const sx of [-1, 1]) {
    F.add(cyl(0.1, 0.11, COT.wall, 14), COL.trim, M(sx * w, COT.wall / 2, -t / 2));
    F.add(puff(0.12, 1, 12), COL.trim, M(sx * w, COT.wall + 0.03, -t / 2));
  }
  // the rainbow door frame growing out of two clouds
  rainbowFrame(F, M(0, 0, 0), DOOR_R, DOOR_H0, 0.062, 0.05);
  for (const sx of [-1, 1]) {
    const x = sx * (DOOR_R + 0.05 + 3 * 0.062);
    F.add(dome(0.26, 0.85), COL.cloud, M(x, 0, 0.12));
    F.add(dome(0.19, 0.9), COL.cloud, M(x + sx * 0.22, 0, 0.16));
    F.add(dome(0.16, 0.9), COL.cloudLilac, M(x - sx * 0.2, 0, 0.2));
  }
  // a big heart over the door, and two little ones
  F.add(extrude(heart(0.44), 0.06, 0.02), COL.heart, M(0, DOOR.h + 0.5, 0.0));
  for (const sx of [-1, 1]) F.add(extrude(heart(0.14), 0.03, 0.01), PAL.yellow, M(sx * 0.42, DOOR.h + 0.56, 0.0, 0, 0, -sx * 0.25));

  // ---- heart windows with flower boxes
  for (const sx of [-1, 1]) {
    const x = sx * 1.36, y = 1.32;
    F.add(extrude(heart(0.74, x, y), 0.04, 0.012), COL.trim, M(0, 0, 0));
    F.add(extrude(heart(0.58, x, y), 0.012), COL.pane, M(0, 0, 0.05));
    F.add(box(0.03, 0.5, 0.02), COL.trim, M(x, y - 0.02, 0.066));
    F.add(box(0.56, 0.03, 0.02), COL.trim, M(x, y + 0.04, 0.066));
    F.add(box(0.05, 0.16, 0.008), COL.trim, M(x - 0.16, y + 0.17, 0.064, 0, 0, -0.75));
    F.add(box(0.03, 0.08, 0.008), COL.trim, M(x - 0.08, y + 0.2, 0.064, 0, 0, -0.75));
    // flower box
    F.add(box(0.7, 0.17, 0.2), COL.door, M(x, 0.8, 0.1));
    F.add(box(0.74, 0.04, 0.22), COL.trim, M(x, 0.9, 0.1));
    for (let k = 0; k < 6; k++) {
      const fx = x - 0.28 + k * 0.112;
      F.add(puff(0.065, 0.8, 8), k % 2 ? COL.leaf : COL.leafDark, M(fx, 0.95, 0.1));
      F.add(puff(0.045, 1, 8), [PAL.yellow, PAL.white, PAL.red, PAL.purple, PAL.orange, PAL.pink][(k + (sx > 0 ? 2 : 0)) % 6], M(fx + 0.02, 1.01, 0.15));
    }
  }

  // ---- the doorstep, a heart doormat and heart stepping stones
  F.add(new THREE.CylinderGeometry(0.82, 0.86, 0.05, 36, 1, false, -Math.PI / 2, Math.PI), COL.trim, M(0, 0.025, 0));
  F.add(extrude(heart(0.66), 0.012), COL.door, M(0, 0.05, 0.42, -Math.PI / 2));
  F.add(extrude(heart(0.4), 0.012), COL.trim, M(0, 0.058, 0.44, -Math.PI / 2));
  [[0.08, 1.15, 0.2], [-0.12, 1.72, -0.25], [0.1, 2.3, 0.15], [-0.06, 2.88, -0.1]].forEach(([x, z, r], i) => {
    F.add(extrude(heart(0.42), 0.014), COL.stone[i % COL.stone.length], M(x, 0.004, z, -Math.PI / 2, 0, r));
  });

  // ---- garden: round bushes with flowers, tulips along the wall
  for (const sx of [-1, 1]) {
    const bx = sx * (w - 0.05);
    F.add(dome(0.36, 1.05), COL.leafDark, M(bx, 0, 0.38));
    F.add(dome(0.27, 1.1), COL.leaf, M(bx - sx * 0.36, 0, 0.42));
    F.add(dome(0.2, 1.1), COL.leaf, M(bx + sx * 0.3, 0, 0.5));
    const dots = [[0.1, 0.33, 0.62], [-0.15, 0.27, 0.6], [0.0, 0.18, 0.72], [-0.38, 0.22, 0.6], [0.28, 0.16, 0.64]];
    dots.forEach(([dx, dy, dz], k) => F.add(puff(0.045, 1, 8), [PAL.pink, PAL.yellow, PAL.white, PAL.red, PAL.purple][k], M(bx + sx * dx, dy, dz)));
    for (let k = 0; k < 4; k++) {
      const tx = sx * (fr + 0.16 + k * 0.13), tz = 0.16 + (k % 2) * 0.08, th = 0.26 + (k % 3) * 0.05;
      F.add(cyl(0.012, 0.012, th, 6), COL.leafDark, M(tx, th / 2, tz));
      F.add(new THREE.CylinderGeometry(0.055, 0.035, 0.09, 8), [PAL.red, PAL.yellow, PAL.pink, PAL.purple][(k + (sx > 0 ? 1 : 0)) % 4], M(tx, th + 0.03, tz));
      F.add(puff(0.04, 0.5, 8), COL.leaf, M(tx + 0.04, 0.06, tz, 0, 0, 0.6));
    }
  }

  // ---- body: side and back walls (single-sided, facing out), the roof vault, cloud roof, chimney
  const d = COT.d;
  for (const sx of [-1, 1]) {
    const pg = new THREE.PlaneGeometry(d - t, COT.wall);
    B.add(pg, COL.wallSide, M(sx * w, COT.wall / 2, -t - (d - t) / 2, 0, sx * Math.PI / 2));
    // a round window on each side
    const ring = new THREE.RingGeometry(0.2, 0.27, 28);
    B.add(ring, COL.trim, M(sx * (w + 0.005), 1.35, -d * 0.55, 0, sx * Math.PI / 2));
    B.add(new THREE.CircleGeometry(0.2, 28), COL.pane, M(sx * (w + 0.004), 1.35, -d * 0.55, 0, sx * Math.PI / 2));
    B.add(box(0.01, 0.38, 0.03), COL.trim, M(sx * (w + 0.008), 1.35, -d * 0.55));
    B.add(box(0.01, 0.03, 0.38), COL.trim, M(sx * (w + 0.008), 1.35, -d * 0.55));
    B.add(cyl(0.1, 0.11, COT.wall, 14), COL.trim, M(sx * w, COT.wall / 2, -d));
    B.add(puff(0.12, 1, 12), COL.trim, M(sx * w, COT.wall + 0.03, -d));
  }
  B.add(new THREE.ShapeGeometry(facadeShape(false), 24), COL.wallSide, M(0, 0, -d, 0, Math.PI));
  // the vault under the cloud roof (a ribbon along the gable curve)
  {
    const pts: THREE.Vector2[] = [];
    const N = 24;
    for (let i = 0; i <= N; i++) {
      const x = -w - 0.08 + ((2 * w + 0.16) * i) / N;
      pts.push(new THREE.Vector2(x, gableY(THREE.MathUtils.clamp(x, -w, w)) + 0.02));
    }
    const pos: number[] = [], idx: number[] = [], z0 = 0.06, z1 = -d - 0.08;
    for (const p of pts) pos.push(p.x, p.y, z0, p.x, p.y, z1);
    for (let i = 0; i < N; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    // normals must point up/out
    const n = g.attributes.normal;
    if (n.getY(Math.floor(n.count / 2)) < 0) {
      for (let i = 0; i < idx.length; i += 3) { const tt = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = tt; }
      g.setIndex(idx);
      g.computeVertexNormals();
    }
    B.add(g, COL.roof);
  }
  // cloud roof: rows of puffs along the gable, bigger along the ridge, lilac-tinted ones underneath
  const rows = 5;
  for (let r = 0; r < rows; r++) {
    const z = 0.12 - ((d + 0.2) * r) / (rows - 1);
    const n = 7;
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1), x = (-w - 0.05) + (2 * w + 0.1) * u;
      const ridge = 1 - Math.abs(u - 0.5) * 2;
      const rad = 0.34 + 0.12 * ridge + ((i + r) % 2) * 0.04;
      const y = gableY(THREE.MathUtils.clamp(x, -w, w)) + 0.06 + ridge * 0.04;
      const col = (r === 0 || r === rows - 1) && i % 2 ? COL.cloudLilac : COL.cloud;
      B.add(puff(rad, 0.72, 14), col, M(x, y, z));
    }
  }
  // the front row of the roof overhangs the facade: put it in front so it never pops in/out with the body
  // chimney (pink, white rim, a yellow heart) poking out of the cloud
  const cx = 0.95, cz = -d * 0.62, cy0 = gableY(cx) - 0.1, ch = 0.85;
  B.add(cyl(0.17, 0.19, ch, 18), COL.chimney, M(cx, cy0 + ch / 2, cz));
  B.add(cyl(0.22, 0.22, 0.12, 18), COL.trim, M(cx, cy0 + ch, cz));
  B.add(extrude(heart(0.16), 0.02), PAL.yellow, M(cx, cy0 + ch * 0.62, cz + 0.18));
  // base clouds round the sides and back
  for (let i = 0; i < 9; i++) {
    const u = i / 8;
    for (const sx of [-1, 1]) B.add(dome(0.22 + (i % 3) * 0.05, 0.8, 12), i % 2 ? COL.cloud : COL.cloudLilac, M(sx * (w + 0.06), 0, -t - (d - t) * u));
    B.add(dome(0.24 + (i % 2) * 0.06, 0.8, 12), i % 3 ? COL.cloud : COL.cloudLilac, M(-w + 2 * w * u, 0, -d - 0.06));
  }
  // a fluffy pink tree beside the house
  B.add(cyl(0.06, 0.09, 1.3, 10), 0xd8b4ff, M(w + 0.75, 0.65, -d * 0.55));
  [[0, 1.5, 0, 0.42], [0.28, 1.36, 0.1, 0.3], [-0.26, 1.38, -0.08, 0.32], [0.05, 1.78, -0.05, 0.3], [-0.05, 1.3, 0.25, 0.26]].forEach(([x, y, z, r], i) => {
    B.add(puff(r, 0.95, 14), i % 2 ? 0xff9cc9 : 0xffb6d8, M(w + 0.75 + x, y, -d * 0.55 + z));
  });
  B.add(dome(0.3, 0.6), COL.leaf, M(w + 0.75, 0, -d * 0.55));

  // ---- the sun (unlit), drawn separately so it can turn
  const G = new Builder();
  G.add(extrude(new THREE.Shape().absarc(0, 0, 0.3, 0, Math.PI * 2, false) as THREE.Shape, 0.06, 0.015, 32), COL.sun);
  G.add(extrude(new THREE.Shape().absarc(0, 0, 0.21, 0, Math.PI * 2, false) as THREE.Shape, 0.02, 0, 32), 0xffe98a, M(0, 0, 0.075));
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2, len = i % 2 ? 0.15 : 0.22;
    const s = new THREE.Shape();
    s.moveTo(-0.06, 0); s.lineTo(0.06, 0); s.lineTo(0, len); s.closePath();
    G.add(extrude(s, 0.04), i % 2 ? COL.sunRay : COL.sun, M(Math.cos(a) * 0.34, Math.sin(a) * 0.34, 0.01, 0, 0, a - Math.PI / 2));
  }
  G.add(extrude(starShape(0.07, 0.03), 0.01), 0xffffff, M(-0.1, 0.1, 0.1));

  return {
    front: F.build(), body: B.build(), glow: G.build(),
    chimneyTop: new THREE.Vector3(cx, cy0 + ch + 0.1, cz),
    sunAt: new THREE.Vector3(w + 0.55, COT.peak + 0.75, 0.35),
  };
}

/** The door itself (separate so it can swing open into the room): hinge on the left, local x from 0 to the width. */
export function buildDoorLeaf(): THREE.BufferGeometry {
  const L = new Builder(), w = DOOR.w - 0.03, h = DOOR.h - 0.015, dz = 0.05;
  const shape = archShape(w, h) as THREE.Shape;
  L.add(extrude(shape, dz, 0, 24), COL.door, M(w / 2, 0, -dz / 2));
  for (const side of [-1, 1]) {
    const z = side * (dz / 2 + 0.004);
    L.add(extrude(heart(0.36, w / 2, 1.5), 0.008), COL.trim, M(0, 0, side > 0 ? z - 0.002 : z - 0.006));
    L.add(extrude(heart(0.27, w / 2, 1.5), 0.008), COL.pane, M(0, 0, side > 0 ? z + 0.002 : z - 0.01));
    L.add(box(w * 0.62, 0.025, 0.01), COL.trim, M(w / 2, 0.95, z));
    L.add(box(w * 0.62, 0.025, 0.01), COL.trim, M(w / 2, 0.35, z));
    L.add(box(0.025, 0.6, 0.01), COL.trim, M(w / 2 - w * 0.31, 0.65, z));
    L.add(box(0.025, 0.6, 0.01), COL.trim, M(w / 2 + w * 0.31, 0.65, z));
    L.add(puff(0.045, 1, 10), PAL.yellow, M(w - 0.12, 1.0, side * 0.05));
  }
  return L.build();
}
