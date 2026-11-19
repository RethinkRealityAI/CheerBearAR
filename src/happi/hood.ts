// The selfie's Happi hood, built in code so it is smooth and clean at any distance (the scanned model it replaces
// was rough and jagged up close). Face units (FU), the face looks down -z, x = the wearer's left, y up:
//   shell    a smooth orange head, a bit bigger than yours, open at the front in a human-face oval and open
//            under the chin
//   rim      a soft white roll round the opening (Happi's white face), so your face sits in his
//   ears     his tall pointed ears, leaning out a little, with a darker inner face
//   cheeks   his red cheek dots on the hood either side of your face
//   brow     the little squirrel face from his forehead
// Flat colours, no textures except the small forehead canvas.
import * as THREE from 'three';

const ORANGE = 0xf37321, ORANGE_IN = 0xd95f17, RED = 0xe8222a, WHITE = 0xfff7ee;

/** The shell ellipsoid (centre and radii) and the face opening (oval, centred at oy). */
export const HOOD = {
  c: new THREE.Vector3(0, 0.1, 0.12), r: new THREE.Vector3(0.84, 1.0, 0.82),
  ox: 0.54, oy: -0.04, oh: 0.74, chin: -0.62,
};

/** A point on the front of the shell at (x, y). */
function front(x: number, y: number, out = new THREE.Vector3()): THREE.Vector3 {
  const { c, r } = HOOD;
  const u = 1 - ((x - c.x) / r.x) ** 2 - ((y - c.y) / r.y) ** 2;
  return out.set(x, y, c.z - r.z * Math.sqrt(Math.max(0, u)));
}
function normalAt(p: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
  const { c, r } = HOOD;
  return out.set((p.x - c.x) / (r.x * r.x), (p.y - c.y) / (r.y * r.y), (p.z - c.z) / (r.z * r.z)).normalize();
}
const inOpening = (x: number, y: number) => (x / HOOD.ox) ** 2 + ((y - HOOD.oy) / HOOD.oh) ** 2 < 1;

function shell(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 112, 80);
  g.scale(HOOD.r.x, HOOD.r.y, HOOD.r.z);
  g.translate(HOOD.c.x, HOOD.c.y, HOOD.c.z);
  const pos = g.attributes.position, idx = g.index!;
  const keep: number[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), cc = new THREE.Vector3();
  for (let i = 0; i < idx.count; i += 3) {
    a.fromBufferAttribute(pos, idx.getX(i)); b.fromBufferAttribute(pos, idx.getX(i + 1)); cc.fromBufferAttribute(pos, idx.getX(i + 2));
    const x = (a.x + b.x + cc.x) / 3, y = (a.y + b.y + cc.y) / 3, z = (a.z + b.z + cc.z) / 3;
    if (y < HOOD.chin) continue; // open under the chin
    if (z < HOOD.c.z && inOpening(x, y)) continue; // the face opening
    keep.push(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2));
  }
  g.setIndex(keep);
  return g;
}

function rim(): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  const N = 96;
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    const x = HOOD.ox * Math.cos(t), y = HOOD.oy + HOOD.oh * Math.sin(t);
    if (y < HOOD.chin) { pts.push(front(x, HOOD.chin)); continue; }
    pts.push(front(x, y));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 160, 0.05, 14, true);
}

function ear(side: 1 | -1): THREE.Group {
  const g = new THREE.Group();
  const outer = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.78, 40, 1, false), new THREE.MeshStandardMaterial({ color: ORANGE, roughness: 0.55 }));
  outer.scale.set(1, 1, 0.55);
  const inner = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.5, 32, 1, false), new THREE.MeshStandardMaterial({ color: ORANGE_IN, roughness: 0.7 }));
  inner.scale.set(1, 1, 0.3);
  inner.position.set(0, -0.06, -0.1);
  g.add(outer, inner);
  g.position.set(side * 0.5, 1.02, 0.16);
  g.rotation.set(-0.12, 0, -side * 0.42);
  return g;
}

function decalAt(x: number, y: number, mesh: THREE.Mesh, lift = 0.012): THREE.Mesh {
  const p = front(x, y), n = normalAt(p);
  mesh.position.copy(p).addScaledVector(n, lift);
  mesh.lookAt(p.clone().add(n));
  return mesh;
}

/** The little squirrel face from Happi's forehead (canvas). */
function browTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 192;
  const g = c.getContext('2d')!;
  g.lineCap = 'round';
  g.strokeStyle = '#1b1b1f'; g.lineWidth = 9;
  g.fillStyle = '#ffffff';
  g.beginPath(); g.moveTo(52, 46); g.quadraticCurveTo(128, 18, 204, 46); g.stroke();
  for (const x of [104, 128, 152]) { g.beginPath(); g.ellipse(x, 52, 7, 18, 0, 0, Math.PI * 2); g.fill(); g.stroke(); }
  for (const x of [96, 160]) {
    g.fillStyle = '#ffffff';
    g.beginPath(); g.ellipse(x, 116, 30, 34, 0, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = '#1b1b1f'; g.beginPath(); g.ellipse(x + 2, 120, 12, 18, 0, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = '#1b1b1f'; g.beginPath(); g.ellipse(128, 160, 9, 7, 0, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function buildHood(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'happi-hood-code';
  const orange = new THREE.MeshStandardMaterial({ color: ORANGE, roughness: 0.55, metalness: 0, side: THREE.DoubleSide });
  const sh = new THREE.Mesh(shell(), orange);
  sh.name = 'hood-shell';
  const rm = new THREE.Mesh(rim(), new THREE.MeshStandardMaterial({ color: WHITE, roughness: 0.6 }));
  rm.name = 'hood-rim';
  root.add(sh, rm, ear(1), ear(-1));
  const red = new THREE.MeshBasicMaterial({ color: RED, toneMapped: false, side: THREE.DoubleSide });
  for (const sx of [-1, 1]) root.add(decalAt(sx * 0.66, -0.3, new THREE.Mesh(new THREE.CircleGeometry(0.12, 40), red)));
  const brow = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.3), new THREE.MeshBasicMaterial({ map: browTexture(), transparent: true, toneMapped: false, side: THREE.DoubleSide, depthWrite: false }));
  decalAt(0, 0.86, brow, 0.014);
  brow.scale.x = -1; // reads the right way round in the mirrored selfie
  root.add(brow);
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.renderOrder = 1; });
  return root;
}
