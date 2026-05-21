import * as THREE from 'three';
import { PieceColor } from '../pieces/PieceFactory';

/**
 * Shared character anatomy helpers + material palettes.
 * Each builder returns a Group with named sub-children so animations
 * can reach into specific limbs/joints by name.
 */

export interface Palette {
  skin: THREE.MeshStandardMaterial;
  cloth: THREE.MeshStandardMaterial;
  clothAccent: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  metalAccent: THREE.MeshStandardMaterial;
  leather: THREE.MeshStandardMaterial;
  hair: THREE.MeshStandardMaterial;
  glow: THREE.MeshStandardMaterial;
  jewel: THREE.MeshStandardMaterial;
}

const paletteCache = new Map<PieceColor, Palette>();

export function makePalette(color: PieceColor): Palette {
  const cached = paletteCache.get(color);
  if (cached) return cached;

  let p: Palette;
  if (color === 'w') {
    p = {
      skin: std(0xe8c8a0, 0.55, 0.0),
      cloth: std(0xefdcb0, 0.6, 0.05, 0x180e04),
      clothAccent: std(0xb8862c, 0.45, 0.55, 0x2c1804),
      metal: std(0xd6c186, 0.32, 0.92, 0x281a04),
      metalAccent: std(0xf7e6a9, 0.28, 0.95, 0x381e04),
      leather: std(0x6e3a1a, 0.85, 0.05, 0x180a04),
      hair: std(0xa66428, 0.75, 0.05),
      glow: stdEmissive(0xfff1cc, 0xfff1cc, 1.8),
      jewel: stdEmissive(0xff5577, 0x661122, 0.7),
    };
  } else {
    p = {
      skin: std(0xcaa080, 0.6, 0.0),
      cloth: std(0x32203a, 0.55, 0.08, 0x0a0410),
      clothAccent: std(0x6a2a8a, 0.45, 0.55, 0x1a0828),
      metal: std(0x3a3046, 0.35, 0.92, 0x080208),
      metalAccent: std(0x9a5cd4, 0.32, 0.95, 0x2c0848),
      leather: std(0x2a1a18, 0.85, 0.05, 0x080202),
      hair: std(0x0c0608, 0.72, 0.05),
      glow: stdEmissive(0xa872ff, 0x6228aa, 1.8),
      jewel: stdEmissive(0x66ffdc, 0x108860, 0.7),
    };
  }
  paletteCache.set(color, p);
  return p;
}

function std(color: number, roughness = 0.5, metalness = 0.1, emissive = 0x000000): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, emissive });
}
function stdEmissive(color: number, emissive: number, intensity = 1): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color, emissive, emissiveIntensity: intensity, roughness: 0.3, metalness: 0.6,
  });
}

// =======================
//  HUMANOID
// =======================

export interface HumanoidJoints {
  root: THREE.Group;
  hips: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  leftShoulder: THREE.Group;
  rightShoulder: THREE.Group;
  leftHip: THREE.Group;
  rightHip: THREE.Group;
  leftHand: THREE.Group;
  rightHand: THREE.Group;
}

export interface HumanoidOpts {
  height?: number;
  shoulderWidth?: number;
  bodyMat?: THREE.MeshStandardMaterial;
  headMat?: THREE.MeshStandardMaterial;
  legMat?: THREE.MeshStandardMaterial;
  armMat?: THREE.MeshStandardMaterial;
}

/**
 * Build a stylized humanoid skeleton hierarchy.
 * Origin is at floor between feet. Y grows upward.
 *
 *   root
 *    └ hips (origin at hip height)
 *       ├ leftHip ── leftKnee ── leftFoot
 *       ├ rightHip ── rightKnee ── rightFoot
 *       └ torso
 *           ├ leftShoulder ── leftElbow ── leftHand
 *           ├ rightShoulder ── rightElbow ── rightHand
 *           └ head
 */
export function buildHumanoid(opts: HumanoidOpts = {}): HumanoidJoints {
  const h = opts.height ?? 1.5;
  const shoulder = opts.shoulderWidth ?? 0.30;
  const bodyMat = opts.bodyMat ?? std(0x888888, 0.5);
  const headMat = opts.headMat ?? bodyMat;
  const legMat = opts.legMat ?? bodyMat;
  const armMat = opts.armMat ?? bodyMat;

  const root = new THREE.Group();
  root.name = 'root';

  const legLen = h * 0.42;
  const torsoLen = h * 0.32;
  const headRadius = h * 0.08;
  const hipY = legLen;

  // ----- Hips
  const hips = new THREE.Group();
  hips.name = 'hips';
  hips.position.y = hipY;
  root.add(hips);

  // ----- Legs (each Hip group rotates at the hip joint)
  const buildLeg = (side: 1 | -1) => {
    const hipGroup = new THREE.Group();
    hipGroup.name = side === 1 ? 'rightHip' : 'leftHip';
    hipGroup.position.set(side * 0.09, 0, 0);
    hips.add(hipGroup);

    const thigh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.06, legLen * 0.5, 12),
      legMat,
    );
    thigh.position.y = -legLen * 0.25;
    hipGroup.add(thigh);

    const knee = new THREE.Group();
    knee.name = side === 1 ? 'rightKnee' : 'leftKnee';
    knee.position.y = -legLen * 0.5;
    hipGroup.add(knee);

    const shin = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.055, legLen * 0.5, 12),
      legMat,
    );
    shin.position.y = -legLen * 0.25;
    knee.add(shin);

    const foot = new THREE.Mesh(
      new THREE.BoxGeometry(0.10, 0.05, 0.18),
      legMat,
    );
    foot.position.set(0, -legLen * 0.5, 0.04);
    knee.add(foot);

    return hipGroup;
  };
  const leftHip = buildLeg(-1);
  const rightHip = buildLeg(1);

  // ----- Torso
  const torso = new THREE.Group();
  torso.name = 'torso';
  hips.add(torso);

  const torsoMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(shoulder * 0.85, 0.10, torsoLen, 14),
    bodyMat,
  );
  torsoMesh.position.y = torsoLen * 0.5;
  torso.add(torsoMesh);

  // ----- Head + neck
  const neck = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.06, 0.08, 10),
    headMat,
  );
  neck.position.y = torsoLen + 0.04;
  torso.add(neck);

  const head = new THREE.Group();
  head.name = 'head';
  head.position.y = torsoLen + 0.08 + headRadius;
  torso.add(head);

  const headMesh = new THREE.Mesh(
    new THREE.SphereGeometry(headRadius, 18, 16),
    headMat,
  );
  headMesh.scale.set(1.0, 1.1, 1.0);
  head.add(headMesh);

  // ----- Arms
  const armLen = h * 0.30;
  const buildArm = (side: 1 | -1) => {
    const shoulderGroup = new THREE.Group();
    shoulderGroup.name = side === 1 ? 'rightShoulder' : 'leftShoulder';
    shoulderGroup.position.set(side * shoulder, torsoLen - 0.03, 0);
    torso.add(shoulderGroup);

    const upper = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.045, armLen * 0.5, 12),
      armMat,
    );
    upper.position.y = -armLen * 0.25;
    shoulderGroup.add(upper);

    const elbow = new THREE.Group();
    elbow.name = side === 1 ? 'rightElbow' : 'leftElbow';
    elbow.position.y = -armLen * 0.5;
    shoulderGroup.add(elbow);

    const fore = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.04, armLen * 0.5, 12),
      armMat,
    );
    fore.position.y = -armLen * 0.25;
    elbow.add(fore);

    const hand = new THREE.Group();
    hand.name = side === 1 ? 'rightHand' : 'leftHand';
    hand.position.y = -armLen * 0.5 - 0.02;
    elbow.add(hand);

    const palm = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 10, 10),
      armMat,
    );
    palm.scale.set(1, 0.7, 1.2);
    hand.add(palm);

    return { shoulderGroup, hand };
  };
  const ls = buildArm(-1);
  const rs = buildArm(1);

  return {
    root,
    hips,
    torso,
    head,
    leftShoulder: ls.shoulderGroup,
    rightShoulder: rs.shoulderGroup,
    leftHip,
    rightHip,
    leftHand: ls.hand,
    rightHand: rs.hand,
  };
}

// =======================
//  HORSE
// =======================

export interface HorseJoints {
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  legFL: THREE.Group; // front-left
  legFR: THREE.Group;
  legBL: THREE.Group; // back-left
  legBR: THREE.Group;
  saddle: THREE.Group;
}

export function buildHorse(palette: Palette): HorseJoints {
  const root = new THREE.Group();
  root.name = 'horse';

  const horseBody = std(0x4a3422, 0.85, 0.0);
  const horseMane = std(0x140a06, 0.85, 0.0);

  const bodyHeight = 0.85;
  root.position.y = 0;

  // ---- Body
  const body = new THREE.Group();
  body.name = 'horseBody';
  body.position.y = bodyHeight;
  root.add(body);

  const torso = new THREE.Mesh(
    new THREE.SphereGeometry(0.45, 20, 14),
    horseBody,
  );
  torso.scale.set(0.85, 0.7, 1.4);
  body.add(torso);

  // Chest bump
  const chest = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 16, 12),
    horseBody,
  );
  chest.scale.set(0.85, 0.85, 1.0);
  chest.position.set(0, -0.05, 0.55);
  body.add(chest);

  // Hindquarters
  const hind = new THREE.Mesh(
    new THREE.SphereGeometry(0.32, 16, 12),
    horseBody,
  );
  hind.position.set(0, 0.05, -0.55);
  body.add(hind);

  // ---- Neck + head
  const neck = new THREE.Mesh(
    new THREE.CylinderGeometry(0.13, 0.18, 0.5, 14),
    horseBody,
  );
  neck.position.set(0, 0.20, 0.62);
  neck.rotation.x = -0.5;
  body.add(neck);

  const head = new THREE.Group();
  head.name = 'horseHead';
  head.position.set(0, 0.40, 0.88);
  body.add(head);

  const headMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.22, 0.36),
    horseBody,
  );
  headMesh.position.set(0, 0, 0.10);
  head.add(headMesh);

  const muzzle = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.13, 0.14),
    horseBody,
  );
  muzzle.position.set(0, -0.04, 0.32);
  head.add(muzzle);

  // Ears
  for (const sx of [-1, 1]) {
    const ear = new THREE.Mesh(
      new THREE.ConeGeometry(0.04, 0.10, 8),
      horseBody,
    );
    ear.position.set(sx * 0.06, 0.14, -0.04);
    ear.rotation.x = -0.3;
    head.add(ear);
  }

  // Eyes
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.022, 8, 8),
      std(0x080404, 0.4, 0.0),
    );
    eye.position.set(sx * 0.08, 0.04, 0.16);
    head.add(eye);
  }

  // Mane
  for (let i = 0; i < 6; i++) {
    const segment = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.20 - i * 0.015, 0.10),
      horseMane,
    );
    segment.position.set(0, 0.20, 0.55 - i * 0.10);
    segment.rotation.z = (i % 2 === 0 ? 1 : -1) * 0.2;
    body.add(segment);
  }

  // Tail
  const tail = new THREE.Mesh(
    new THREE.ConeGeometry(0.08, 0.40, 10),
    horseMane,
  );
  tail.position.set(0, 0.0, -0.85);
  tail.rotation.x = -1.0;
  body.add(tail);

  // ---- Legs (each Group is a "shoulder" joint, child cylinder is the leg)
  const legLen = bodyHeight - 0.05;
  const buildLeg = (x: number, z: number, name: string) => {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(x, -bodyHeight * 0.45, z); // joint at body height attaching downward
    const upper = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.06, legLen * 0.6, 10),
      horseBody,
    );
    upper.position.y = -legLen * 0.30;
    g.add(upper);
    const knee = new THREE.Group();
    knee.position.y = -legLen * 0.60;
    g.add(knee);
    const lower = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.07, legLen * 0.40, 10),
      horseBody,
    );
    lower.position.y = -legLen * 0.20;
    knee.add(lower);
    const hoof = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.10, 0.05, 12),
      std(0x180c08, 0.8),
    );
    hoof.position.y = -legLen * 0.40;
    knee.add(hoof);
    body.add(g);
    return g;
  };
  const legFL = buildLeg(-0.18, 0.45, 'legFL');
  const legFR = buildLeg(0.18, 0.45, 'legFR');
  const legBL = buildLeg(-0.20, -0.45, 'legBL');
  const legBR = buildLeg(0.20, -0.45, 'legBR');

  // ---- Saddle
  const saddle = new THREE.Group();
  saddle.name = 'saddle';
  saddle.position.set(0, 0.32, 0);
  body.add(saddle);

  const saddleSeat = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 16, 10),
    palette.leather,
  );
  saddleSeat.scale.set(0.7, 0.45, 0.95);
  saddle.add(saddleSeat);

  const saddleBlanket = new THREE.Mesh(
    new THREE.BoxGeometry(0.85, 0.06, 0.85),
    palette.clothAccent,
  );
  saddleBlanket.position.y = -0.08;
  saddle.add(saddleBlanket);

  return { root, body, head, legFL, legFR, legBL, legBR, saddle };
}

// ---- Misc helpers ----

export function makeCape(palette: Palette, lengthY = 0.7, width = 0.55): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(width, lengthY, 6, 10);
  // Curve the cape outward slightly so it doesn't z-fight with the body.
  const pos = geo.attributes.position!;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = (y + lengthY / 2) / lengthY; // 0 at bottom, 1 at top
    const sway = Math.sin(t * Math.PI) * 0.10;
    pos.setZ(i, sway);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  const mat = palette.clothAccent.clone();
  mat.side = THREE.DoubleSide;
  return new THREE.Mesh(geo, mat);
}

export function makeCrown(palette: Palette, points = 6, radius = 0.16, pointHeight = 0.10): THREE.Group {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius, 0.022, 10, 28),
    palette.metalAccent,
  );
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.025, pointHeight, 10),
      palette.metalAccent,
    );
    cone.position.set(Math.cos(a) * radius, pointHeight / 2 + 0.012, Math.sin(a) * radius);
    g.add(cone);
    // Jewel atop each point
    const jewel = new THREE.Mesh(
      new THREE.SphereGeometry(0.018, 10, 8),
      palette.jewel,
    );
    jewel.position.set(Math.cos(a) * radius, pointHeight + 0.022, Math.sin(a) * radius);
    g.add(jewel);
  }
  return g;
}

export function makeHelmet(palette: Palette, withVisor = true): THREE.Group {
  const g = new THREE.Group();
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 18, 14, 0, Math.PI * 2, 0, Math.PI / 1.7),
    palette.metal,
  );
  dome.scale.set(1.0, 1.1, 1.05);
  g.add(dome);

  // Neck guard
  const neck = new THREE.Mesh(
    new THREE.CylinderGeometry(0.13, 0.14, 0.06, 18),
    palette.metal,
  );
  neck.position.y = -0.04;
  g.add(neck);

  if (withVisor) {
    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.05, 0.14),
      palette.metal,
    );
    visor.position.set(0, -0.01, 0.06);
    g.add(visor);
    // Eye slit (dark sliver)
    const slit = new THREE.Mesh(
      new THREE.BoxGeometry(0.10, 0.012, 0.02),
      std(0x080404, 0.5),
    );
    slit.position.set(0, -0.01, 0.135);
    g.add(slit);
  }

  // Plume
  const plume = new THREE.Mesh(
    new THREE.ConeGeometry(0.04, 0.18, 10),
    palette.clothAccent,
  );
  plume.position.set(0, 0.20, -0.02);
  g.add(plume);

  return g;
}

export function makeSpear(palette: Palette, len = 0.9): THREE.Group {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018, 0.020, len, 8),
    palette.leather,
  );
  g.add(shaft);
  const head = new THREE.Mesh(
    new THREE.ConeGeometry(0.04, 0.16, 10),
    palette.metal,
  );
  head.position.y = len / 2 + 0.08;
  g.add(head);
  // wrap below head
  const wrap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.028, 0.028, 0.05, 10),
    palette.clothAccent,
  );
  wrap.position.y = len / 2 - 0.02;
  g.add(wrap);
  return g;
}

export function makeShield(palette: Palette, w = 0.22, h = 0.30): THREE.Group {
  const g = new THREE.Group();
  const shield = new THREE.Mesh(
    new THREE.CylinderGeometry(w * 0.6, w * 0.7, h, 6, 1, false, 0, Math.PI),
    palette.metalAccent,
  );
  shield.rotation.z = Math.PI / 2;
  g.add(shield);
  // boss in center
  const boss = new THREE.Mesh(
    new THREE.SphereGeometry(0.04, 10, 8),
    palette.metal,
  );
  boss.position.x = 0;
  g.add(boss);
  return g;
}

export function makeStaff(palette: Palette, len = 1.4): THREE.Group {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.022, 0.026, len, 10),
    palette.leather,
  );
  g.add(shaft);
  // gnarled top
  const top = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 12, 10),
    palette.leather,
  );
  top.position.y = len / 2;
  g.add(top);
  // glowing orb
  const orb = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 20, 16),
    palette.glow,
  );
  orb.position.y = len / 2 + 0.10;
  g.add(orb);
  // claw cradle holding the orb
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const claw = new THREE.Mesh(
      new THREE.ConeGeometry(0.012, 0.07, 6),
      palette.leather,
    );
    claw.position.set(Math.cos(a) * 0.055, len / 2 + 0.06, Math.sin(a) * 0.055);
    claw.rotation.z = -Math.cos(a) * 0.4;
    claw.rotation.x = Math.sin(a) * 0.4;
    g.add(claw);
  }
  return g;
}

export function makeScepter(palette: Palette, len = 0.55): THREE.Group {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.016, 0.020, len, 10),
    palette.metalAccent,
  );
  g.add(shaft);
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 14, 12),
    palette.metalAccent,
  );
  ball.position.y = len / 2 + 0.04;
  g.add(ball);
  const jewel = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 14, 12),
    palette.jewel,
  );
  jewel.position.y = len / 2 + 0.10;
  g.add(jewel);
  return g;
}

export function makeBeard(palette: Palette, length = 0.16): THREE.Mesh {
  const geo = new THREE.ConeGeometry(0.08, length, 14, 1, true);
  const mat = palette.hair.clone();
  mat.side = THREE.DoubleSide;
  const m = new THREE.Mesh(geo, mat);
  m.rotation.x = Math.PI; // point down
  return m;
}

export function makeRobe(palette: Palette, height = 1.1, topR = 0.18, botR = 0.46): THREE.Mesh {
  const profile: [number, number][] = [
    [0.00, botR],
    [0.05, botR * 0.95],
    [0.30, botR * 0.7],
    [0.60, topR * 1.4],
    [0.85, topR * 1.05],
    [height, topR],
  ];
  const geo = new THREE.LatheGeometry(
    profile.map(([y, r]) => new THREE.Vector2(r, y)),
    32,
  );
  const mat = palette.cloth.clone();
  return new THREE.Mesh(geo, mat);
}

export function makeWizardHat(palette: Palette): THREE.Group {
  const g = new THREE.Group();
  // Brim
  const brim = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.22, 0.025, 24),
    palette.cloth,
  );
  g.add(brim);
  // Cone — tilted slightly for character
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(0.13, 0.40, 20),
    palette.cloth,
  );
  cone.position.y = 0.20;
  cone.rotation.z = -0.18;
  g.add(cone);
  // Band
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(0.135, 0.135, 0.04, 22),
    palette.clothAccent,
  );
  band.position.y = 0.04;
  g.add(band);
  // Tiny moon/star jewel at front
  const jewel = new THREE.Mesh(
    new THREE.SphereGeometry(0.022, 10, 10),
    palette.jewel,
  );
  jewel.position.set(0.12, 0.05, 0);
  g.add(jewel);
  return g;
}
