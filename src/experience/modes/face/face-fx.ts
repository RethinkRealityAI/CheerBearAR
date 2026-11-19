// What the Selfie puts on your face: Cheer Bear ears, a heart nose and two cheek hearts. Flat coloured meshes in face
// units (1 FU ~ 118-139 mm; x = wearer's left, y up, the face looks down -z), DoubleSide because the display is
// mirrored. A depth-only head occluder hides the far ear when you turn.
import * as THREE from 'three';

const PINK_FUR = 0xf46db1; // Cheer Bear's fur, sampled from her clips
const PINK_INNER = 0xffd6ea; // --cb-pink-soft
const HEART = 0xff389b; // --cb-pink
const CHEEK = 0xff8fc8;
const WHITE = 0xffffff;

// fallbacks (FU) when the engine does not send an attachment point (immersive skill: measured points)
const NOSE_TIP = new THREE.Vector3(0, -0.26, -0.74);
const CHEEKS = { left: new THREE.Vector3(0.36, -0.26, -0.5), right: new THREE.Vector3(-0.36, -0.26, -0.5) };

function heartShape(size: number): THREE.ShapeGeometry {
  // classic two-lobe heart, point down, centred, `size` wide
  const s = new THREE.Shape();
  const k = size / 2;
  s.moveTo(0, -0.95 * k);
  s.bezierCurveTo(-0.15 * k, -0.75 * k, -1.0 * k, -0.25 * k, -1.0 * k, 0.25 * k);
  s.bezierCurveTo(-1.0 * k, 0.75 * k, -0.35 * k, 0.95 * k, 0, 0.5 * k);
  s.bezierCurveTo(0.35 * k, 0.95 * k, 1.0 * k, 0.75 * k, 1.0 * k, 0.25 * k);
  s.bezierCurveTo(1.0 * k, -0.25 * k, 0.15 * k, -0.75 * k, 0, -0.95 * k);
  return new THREE.ShapeGeometry(s, 16);
}

const flat = (color: number) =>
  new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });

/** A piece that pops in (scale) when the face is found. */
interface Piece { node: THREE.Object3D; delay: number }

export class FaceFx {
  readonly group = new THREE.Group();
  private pieces: Piece[] = [];
  private nose = new THREE.Group();
  private cheekL = new THREE.Group();
  private cheekR = new THREE.Group();
  private popT = 1;

  constructor() {
    this.group.name = 'face-fx';
    // depth-only head: hides whatever is behind your head (the far ear, the bear behind you)
    const occ = new THREE.Mesh(
      new THREE.SphereGeometry(1, 28, 18),
      new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true }),
    );
    occ.scale.set(0.52, 0.74, 0.58);
    occ.position.set(0, 0.04, 0.03);
    occ.renderOrder = -1;
    occ.name = 'head-occluder';
    this.group.add(occ);

    // ears on top of the head, tilted out a little
    const furM = flat(PINK_FUR), innerM = flat(PINK_INNER);
    const outerG = new THREE.CircleGeometry(0.2, 40), innerG = new THREE.CircleGeometry(0.115, 32);
    for (const side of [1, -1]) {
      const ear = new THREE.Group();
      const o = new THREE.Mesh(outerG, furM);
      const i = new THREE.Mesh(innerG, innerM);
      i.position.set(0, -0.015, -0.012); // in front of the fur disc (the face looks down -z)
      i.renderOrder = 2;
      o.renderOrder = 1;
      ear.add(o, i);
      ear.position.set(0.44 * side, 0.82, -0.18);
      ear.rotation.set(0, 0.25 * side, -0.32 * side);
      ear.name = side > 0 ? 'ear-left' : 'ear-right';
      this.group.add(ear);
      this.pieces.push({ node: ear, delay: side > 0 ? 0 : 0.08 });
    }

    // heart nose with a flat white shine
    const nose = new THREE.Mesh(heartShape(0.17), flat(HEART));
    const shine = new THREE.Mesh(new THREE.CircleGeometry(0.02, 16), flat(WHITE));
    shine.position.set(-0.035, 0.025, -0.004);
    shine.renderOrder = 3;
    nose.renderOrder = 2;
    this.nose.add(nose, shine);
    this.nose.name = 'heart-nose';
    this.group.add(this.nose);
    this.pieces.push({ node: this.nose, delay: 0.16 });

    const cheekG = heartShape(0.1), cheekM = flat(CHEEK);
    for (const [g, name] of [[this.cheekL, 'cheek-left'], [this.cheekR, 'cheek-right']] as const) {
      const m = new THREE.Mesh(cheekG, cheekM);
      m.renderOrder = 2;
      g.add(m);
      g.name = name;
      this.group.add(g);
      this.pieces.push({ node: g, delay: 0.22 });
    }
    this.place(null);
  }

  /** Follow the engine's attachment points (face units), falling back to measured positions. */
  place(points: Record<string, { position: { x: number; y: number; z: number } }> | null): void {
    const p = (name: string, fb: THREE.Vector3, out: THREE.Object3D, dz: number) => {
      const q = points?.[name]?.position;
      if (q) out.position.set(q.x, q.y, q.z + dz);
      else out.position.set(fb.x, fb.y, fb.z + dz);
    };
    p('noseTip', NOSE_TIP, this.nose, -0.03);
    p('leftCheek', CHEEKS.left, this.cheekL, -0.035);
    p('rightCheek', CHEEKS.right, this.cheekR, -0.035);
    // cheek hearts sit a touch lower and out from the engine's cheek points
    this.cheekL.position.y -= 0.02;
    this.cheekR.position.y -= 0.02;
  }

  /** Start the pop-in. */
  pop(): void {
    this.popT = 0;
  }

  update(dt: number, reduced: boolean): void {
    if (this.popT >= 1.6) return;
    this.popT += dt;
    for (const pc of this.pieces) {
      const t = Math.max(0, Math.min(1, (this.popT - (reduced ? 0 : pc.delay)) / (reduced ? 0.2 : 0.45)));
      // ease out back (a small overshoot), plain ease under reduced motion
      const c = 1.7;
      const k = reduced ? t : 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
      pc.node.scale.setScalar(Math.max(0.001, k));
    }
  }
}
