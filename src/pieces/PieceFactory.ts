import * as THREE from 'three';

export type PieceColor = 'w' | 'b';
export type PieceType = 'p' | 'r' | 'n' | 'b' | 'q' | 'k';

interface PieceMaterials {
  body: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  glow: THREE.MeshStandardMaterial;
}

function makeMaterials(color: PieceColor): PieceMaterials {
  if (color === 'w') {
    return {
      body: new THREE.MeshStandardMaterial({
        color: 0xf3e3c0,
        roughness: 0.4,
        metalness: 0.18,
        emissive: 0x110a04,
      }),
      accent: new THREE.MeshStandardMaterial({
        color: 0xd8a05a,
        roughness: 0.3,
        metalness: 0.88,
        emissive: 0x301804,
      }),
      glow: new THREE.MeshStandardMaterial({
        color: 0xf7e6a9,
        emissive: 0xfff1cc,
        emissiveIntensity: 0,
        roughness: 0.3,
        metalness: 0.55,
      }),
    };
  } else {
    return {
      body: new THREE.MeshStandardMaterial({
        color: 0x2a1a30,
        roughness: 0.5,
        metalness: 0.3,
        emissive: 0x08020a,
      }),
      accent: new THREE.MeshStandardMaterial({
        color: 0x7a3a8a,
        roughness: 0.3,
        metalness: 0.85,
        emissive: 0x200a26,
      }),
      glow: new THREE.MeshStandardMaterial({
        color: 0x9a5cd4,
        emissive: 0x6228aa,
        emissiveIntensity: 0,
        roughness: 0.3,
        metalness: 0.55,
      }),
    };
  }
}

/**
 * Build a piece mesh as a Three.js Group, ready to be parented + positioned by the Game.
 * The group's origin sits at the bottom-center of the piece (so it rests on the board top).
 */
export function createPieceMesh(type: PieceType, color: PieceColor): THREE.Group {
  const mats = makeMaterials(color);
  const group = new THREE.Group();
  group.name = `piece-${color}${type}`;

  switch (type) {
    case 'p':
      buildPawn(group, mats);
      break;
    case 'r':
      buildRook(group, mats);
      break;
    case 'n':
      buildKnight(group, mats);
      break;
    case 'b':
      buildBishop(group, mats);
      break;
    case 'q':
      buildQueen(group, mats);
      break;
    case 'k':
      buildKing(group, mats);
      break;
  }

  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });

  group.userData.pieceMaterials = mats;
  return group;
}

// --- Helpers ---
const SEG = 28;

function lathe(profile: [number, number][]): THREE.LatheGeometry {
  // Profile is [y, r] pairs, ascending y. Convert to Vector2(r, y).
  return new THREE.LatheGeometry(
    profile.map(([y, r]) => new THREE.Vector2(r, y)),
    SEG,
  );
}

// ----- PAWN -----
function buildPawn(g: THREE.Group, m: PieceMaterials) {
  const body = new THREE.Mesh(
    lathe([
      [0.00, 0.34],
      [0.04, 0.34],
      [0.06, 0.32],
      [0.08, 0.30],
      [0.10, 0.26],
      [0.13, 0.22],
      [0.16, 0.16],
      [0.50, 0.13],
      [0.54, 0.18],
      [0.58, 0.22],
      [0.61, 0.18],
      [0.63, 0.16],
      [0.68, 0.16],
    ]),
    m.body,
  );
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 22, 18), m.body);
  head.position.y = 0.86;
  g.add(body, head);
  g.scale.setScalar(0.9);
}

// ----- ROOK -----
function buildRook(g: THREE.Group, m: PieceMaterials) {
  const body = new THREE.Mesh(
    lathe([
      [0.00, 0.42],
      [0.05, 0.42],
      [0.08, 0.38],
      [0.10, 0.32],
      [0.12, 0.28],
      [0.55, 0.26],
      [0.60, 0.30],
      [0.66, 0.34],
      [0.74, 0.34],
      [0.76, 0.32],
    ]),
    m.body,
  );
  g.add(body);

  // Battlements: 8 small boxes arranged in a ring
  const battlementGeo = new THREE.BoxGeometry(0.12, 0.16, 0.18);
  for (let i = 0; i < 8; i++) {
    const battlement = new THREE.Mesh(battlementGeo, m.body);
    const a = (i / 8) * Math.PI * 2;
    battlement.position.set(Math.cos(a) * 0.28, 0.84, Math.sin(a) * 0.28);
    battlement.lookAt(0, 0.84, 0);
    g.add(battlement);
  }
  g.scale.setScalar(0.95);
}

// ----- KNIGHT -----
function buildKnight(g: THREE.Group, m: PieceMaterials) {
  const base = new THREE.Mesh(
    lathe([
      [0.00, 0.40],
      [0.06, 0.40],
      [0.08, 0.36],
      [0.11, 0.32],
      [0.14, 0.28],
      [0.18, 0.24],
      [0.36, 0.20],
      [0.40, 0.26],
      [0.44, 0.28],
      [0.46, 0.22],
    ]),
    m.body,
  );
  g.add(base);

  // Horse head silhouette via extruded shape
  const shape = new THREE.Shape();
  shape.moveTo(0.0, 0.0);
  shape.bezierCurveTo(-0.05, 0.05, -0.18, 0.15, -0.18, 0.32);
  shape.bezierCurveTo(-0.18, 0.45, -0.06, 0.55, 0.05, 0.55);
  shape.bezierCurveTo(0.18, 0.55, 0.30, 0.50, 0.36, 0.40);
  shape.bezierCurveTo(0.40, 0.32, 0.40, 0.22, 0.35, 0.18);
  shape.bezierCurveTo(0.30, 0.12, 0.25, 0.10, 0.22, 0.06);
  shape.bezierCurveTo(0.20, 0.02, 0.18, 0.0, 0.15, 0.0);
  shape.lineTo(0.0, 0.0);

  const headGeo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.16,
    bevelEnabled: true,
    bevelSegments: 5,
    bevelSize: 0.025,
    bevelThickness: 0.025,
    curveSegments: 18,
  });
  const head = new THREE.Mesh(headGeo, m.body);
  head.position.set(-0.1, 0.46, -0.08);
  head.scale.set(1.0, 1.05, 1.0);
  g.add(head);

  // Tiny mane (small box behind)
  const mane = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.16, 0.16),
    m.accent,
  );
  mane.position.set(-0.18, 0.78, 0);
  mane.rotation.z = 0.3;
  g.add(mane);

  // Small eye dot
  const eye = new THREE.Mesh(
    new THREE.SphereGeometry(0.022, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0x100404, roughness: 0.3 }),
  );
  eye.position.set(0.16, 0.78, 0.085);
  g.add(eye);

  g.scale.setScalar(1.05);
}

// ----- BISHOP -----
function buildBishop(g: THREE.Group, m: PieceMaterials) {
  const body = new THREE.Mesh(
    lathe([
      [0.00, 0.36],
      [0.05, 0.36],
      [0.07, 0.32],
      [0.10, 0.28],
      [0.13, 0.24],
      [0.16, 0.18],
      [0.55, 0.15],
      [0.60, 0.22],
      [0.65, 0.26],
      [0.69, 0.20],
      [0.72, 0.16],
    ]),
    m.body,
  );
  g.add(body);

  // Mitre head — ellipsoid sphere
  const mitre = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 22, 18),
    m.body,
  );
  mitre.position.y = 0.86;
  mitre.scale.set(1.0, 1.45, 1.0);
  g.add(mitre);

  // Mitre slot — small dark box subtracted visually
  const slot = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.18, 0.22),
    new THREE.MeshStandardMaterial({ color: 0x100808, roughness: 0.7 }),
  );
  slot.position.set(0, 0.92, 0);
  g.add(slot);

  // Tiny top sphere (finial)
  const finial = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 12, 10),
    m.accent,
  );
  finial.position.y = 1.16;
  g.add(finial);

  g.scale.setScalar(1.0);
}

// ----- QUEEN -----
function buildQueen(g: THREE.Group, m: PieceMaterials) {
  const body = new THREE.Mesh(
    lathe([
      [0.00, 0.42],
      [0.05, 0.42],
      [0.08, 0.38],
      [0.11, 0.30],
      [0.14, 0.24],
      [0.16, 0.20],
      [0.65, 0.18],
      [0.72, 0.26],
      [0.78, 0.32],
      [0.82, 0.32],
      [0.83, 0.30],
    ]),
    m.body,
  );
  g.add(body);

  // Crown ring
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.26, 0.04, 12, 32),
    m.accent,
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.86;
  g.add(ring);

  // 8 crown points
  for (let i = 0; i < 8; i++) {
    const point = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 12, 10),
      m.accent,
    );
    const a = (i / 8) * Math.PI * 2;
    point.position.set(Math.cos(a) * 0.26, 0.94, Math.sin(a) * 0.26);
    g.add(point);
  }

  // Top central jewel
  const jewel = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 14, 12),
    new THREE.MeshStandardMaterial({
      color: 0xff5577,
      roughness: 0.2,
      metalness: 0.4,
      emissive: 0x661122,
      emissiveIntensity: 0.4,
    }),
  );
  jewel.position.y = 1.02;
  g.add(jewel);

  g.scale.setScalar(1.05);
}

// ----- KING -----
function buildKing(g: THREE.Group, m: PieceMaterials) {
  const body = new THREE.Mesh(
    lathe([
      [0.00, 0.44],
      [0.05, 0.44],
      [0.08, 0.40],
      [0.11, 0.32],
      [0.14, 0.26],
      [0.17, 0.22],
      [0.72, 0.20],
      [0.78, 0.28],
      [0.84, 0.34],
      [0.88, 0.34],
      [0.90, 0.32],
    ]),
    m.body,
  );
  g.add(body);

  // Crown ring
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.28, 0.045, 12, 32),
    m.accent,
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.92;
  g.add(ring);

  // 4 crown points
  for (let i = 0; i < 4; i++) {
    const point = new THREE.Mesh(
      new THREE.ConeGeometry(0.06, 0.12, 12),
      m.accent,
    );
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    point.position.set(Math.cos(a) * 0.28, 1.0, Math.sin(a) * 0.28);
    g.add(point);
  }

  // Cross — vertical bar
  const vBar = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.26, 0.06),
    m.accent,
  );
  vBar.position.y = 1.18;
  g.add(vBar);

  // Cross — horizontal bar
  const hBar = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.05, 0.06),
    m.accent,
  );
  hBar.position.y = 1.18;
  g.add(hBar);

  g.scale.setScalar(1.1);
}
