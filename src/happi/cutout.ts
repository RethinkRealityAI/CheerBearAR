// The 3D Photo's other board: a life-size Happi standee with his face cut out, like a festival photo cutout. You
// place it in the room, a friend stands behind and puts their face through the oval, and you take the photo: they
// become Happi. Painted in code on one canvas (flat colours, a white die-cut edge), cardboard on the back, a strut.
// Model units: 1 tall (scaled to about 1.75 m), feet on y = 0, facing +z. The face hole is a human-face oval
// (about 20 x 27 cm at life size) centred at y = 0.86.
import * as THREE from 'three';
import { HAPPI } from './faceArt';

const W = 0.6; // board width (units), x -0.3..0.3
const PX = 1700; // canvas px per unit
export const CUTOUT_HOLE = { x: 0, y: 0.86, rx: 0.058, ry: 0.077 };

export function happiCutout(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'happi-cutout';
  const c = document.createElement('canvas');
  c.width = Math.round(W * PX); c.height = Math.round(1 * PX);
  const x = c.getContext('2d')!;
  const X = (u: number) => (u + W / 2) * PX, Y = (v: number) => (1 - v) * PX, L = (d: number) => d * PX;

  // every shape twice: first fat and white (the die-cut edge), then in colour
  const shapes = (edge: boolean) => {
    const pad = edge ? L(0.014) : 0;
    const fill = (col: string) => { x.fillStyle = edge ? '#ffffff' : col; };
    const ell = (cx: number, cy: number, rx: number, ry: number, col: string, rot = 0) => {
      fill(col); x.beginPath(); x.ellipse(X(cx), Y(cy), L(rx) + pad, L(ry) + pad, rot, 0, Math.PI * 2); x.fill();
    };
    const poly = (pts: Array<[number, number]>, col: string) => {
      fill(col); x.beginPath(); pts.forEach(([u, v], i) => (i ? x.lineTo(X(u), Y(v)) : x.moveTo(X(u), Y(v)))); x.closePath(); x.fill();
      if (edge) { x.lineJoin = 'round'; x.lineWidth = pad * 2; x.strokeStyle = '#ffffff'; x.stroke(); }
    };
    // tail (behind, his left = your right)
    ell(0.19, 0.56, 0.085, 0.2, HAPPI.orange, 0.35);
    ell(0.22, 0.73, 0.075, 0.07, HAPPI.orange);
    // legs and shoes
    poly([[-0.085, 0.32], [-0.015, 0.32], [-0.02, 0.06], [-0.08, 0.06]], HAPPI.navy);
    poly([[0.015, 0.32], [0.085, 0.32], [0.08, 0.06], [0.02, 0.06]], HAPPI.navy);
    ell(-0.06, 0.04, 0.055, 0.03, HAPPI.orange);
    ell(0.06, 0.04, 0.055, 0.03, HAPPI.orange);
    // sleeves out to the mittens
    poly([[-0.1, 0.7], [-0.15, 0.66], [-0.24, 0.5], [-0.2, 0.47], [-0.11, 0.58]], HAPPI.navy);
    poly([[0.1, 0.7], [0.15, 0.66], [0.24, 0.5], [0.2, 0.47], [0.11, 0.58]], HAPPI.navy);
    // the happi coat
    poly([[-0.12, 0.72], [0.12, 0.72], [0.17, 0.28], [-0.17, 0.28]], HAPPI.navy);
    // mittens, and a paper fan in his right hand (your left)
    ell(-0.265, 0.58, 0.075, 0.075, HAPPI.red);
    poly([[-0.232, 0.5], [-0.226, 0.505], [-0.252, 0.56], [-0.258, 0.555]], '#8a5a2b');
    ell(-0.22, 0.48, 0.038, 0.036, HAPPI.white);
    ell(0.22, 0.48, 0.038, 0.036, HAPPI.white);
    // ears, then the hood
    poly([[-0.17, 0.92], [-0.1, 1.0 - 0.006], [-0.05, 0.95]], HAPPI.orange);
    poly([[0.17, 0.92], [0.1, 1.0 - 0.006], [0.05, 0.95]], HAPPI.orange);
    ell(0, 0.86, 0.165, 0.135, HAPPI.orange);
  };
  shapes(true);
  shapes(false);

  // details on top (no edge pass)
  const ell = (cx: number, cy: number, rx: number, ry: number, col: string, rot = 0) => {
    x.fillStyle = col; x.beginPath(); x.ellipse(X(cx), Y(cy), L(rx), L(ry), rot, 0, Math.PI * 2); x.fill();
  };
  // inner ears
  x.fillStyle = '#d95f17';
  for (const s of [-1, 1]) { x.beginPath(); x.moveTo(X(s * 0.145), Y(0.925)); x.lineTo(X(s * 0.1), Y(0.975)); x.lineTo(X(s * 0.07), Y(0.945)); x.closePath(); x.fill(); }
  // coat: white checker trim down the front, orange obi
  const t = L(0.016);
  for (const s of [-1, 1]) {
    for (let i = 0, v = 0.72; v > 0.3; v -= 0.016, i++) {
      const u = s * (0.02 + (0.72 - v) * 0.12);
      for (let k = 0; k < 2; k++) { x.fillStyle = (i + k) % 2 ? HAPPI.white : HAPPI.navy; x.fillRect(X(u) + (s > 0 ? k * t : -(k + 1) * t), Y(v), t, t); }
    }
  }
  x.fillStyle = HAPPI.orange; x.fillRect(X(-0.155), Y(0.47), L(0.31), L(0.045));
  x.fillStyle = HAPPI.white; x.fillRect(X(-0.155), Y(0.4295), L(0.31), L(0.005));
  // a blossom on the back panel of the coat
  x.fillStyle = HAPPI.white;
  for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + (k * 2 * Math.PI) / 5; ell(0.085 * 0 + Math.cos(a) * 0.017 - 0.09, 0.62 - Math.sin(a) * 0.017, 0.012, 0.009, HAPPI.white, -a); }
  // the fan: white face with a red blossom ring
  ell(-0.265, 0.58, 0.062, 0.062, HAPPI.white);
  for (let k = 0; k < 5; k++) {
    const a = -Math.PI / 2 + (k * 2 * Math.PI) / 5;
    ell(-0.265 + Math.cos(a) * 0.022, 0.58 - Math.sin(a) * 0.022, 0.02, 0.014, '#ff94b0', -a + Math.PI / 2);
  }
  ell(-0.265, 0.58, 0.008, 0.008, HAPPI.red);
  // shoes' white soles
  x.fillStyle = HAPPI.white; x.fillRect(X(-0.115), Y(0.025), L(0.11), L(0.012)); x.fillRect(X(0.005), Y(0.025), L(0.11), L(0.012));
  // red cheeks, the forehead squirrel face
  ell(-0.115, 0.8, 0.024, 0.022, HAPPI.red);
  ell(0.115, 0.8, 0.024, 0.022, HAPPI.red);
  x.lineCap = 'round'; x.strokeStyle = HAPPI.ink; x.lineWidth = L(0.005);
  x.beginPath(); x.moveTo(X(-0.04), Y(0.965)); x.quadraticCurveTo(X(0), Y(0.975), X(0.04), Y(0.965)); x.stroke();
  for (const s of [-1, 1]) {
    ell(s * 0.022, 0.948, 0.014, 0.016, HAPPI.white); x.stroke();
    ell(s * 0.022 + 0.002, 0.946, 0.006, 0.009, HAPPI.ink);
  }
  // the white face rim, then the hole (transparent)
  const H = CUTOUT_HOLE;
  ell(H.x, H.y, H.rx + 0.017, H.ry + 0.017, HAPPI.white);
  x.globalCompositeOperation = 'destination-out';
  x.beginPath(); x.ellipse(X(H.x), Y(H.y), L(H.rx), L(H.ry), 0, 0, Math.PI * 2); x.fill();
  x.globalCompositeOperation = 'source-over';

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const geo = new THREE.PlaneGeometry(W, 1);
  geo.translate(0, 0.5, 0);
  const front = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, roughness: 0.75, side: THREE.FrontSide }));
  front.name = 'cutout-front';
  // the back: plain cardboard in the same shape (alphaMap reads green, so a white-on-black copy of the silhouette)
  const m = document.createElement('canvas');
  m.width = 256; m.height = Math.round(256 / W);
  const mx = m.getContext('2d')!;
  mx.drawImage(c, 0, 0, m.width, m.height);
  mx.globalCompositeOperation = 'source-in';
  mx.fillStyle = '#ffffff'; mx.fillRect(0, 0, m.width, m.height);
  mx.globalCompositeOperation = 'destination-over';
  mx.fillStyle = '#000000'; mx.fillRect(0, 0, m.width, m.height);
  const mask = new THREE.CanvasTexture(m);
  const back = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xc9b393, alphaMap: mask, alphaTest: 0.5, roughness: 0.9, side: THREE.BackSide }));
  back.position.z = -0.004;
  back.name = 'cutout-back';
  // a strut behind so it stands up
  const strut = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.62, 0.008), new THREE.MeshStandardMaterial({ color: 0xb39d7d, roughness: 0.9 }));
  strut.position.set(0, 0.3, -0.11);
  strut.rotation.x = -0.36;
  g.add(front, back, strut);
  return g;
}
