import * as THREE from 'three';
import { PieceType, PieceColor } from '../pieces/PieceFactory';
import { PieceBuild, MovementStyle } from './PieceSet';

/**
 * Neon Cyber Set — futuristic geometric pieces with emissive cores,
 * energy halos, and floating-thruster movement.
 *
 *   Pawn  : small tetrahedron with energy halo ring
 *   Rook  : stacked cubes — fortress block
 *   Knight: angular wireframe horse-head silhouette
 *   Bishop: floating prism with rotating energy core
 *   Queen : crystalline diamond with orbiting satellites
 *   King  : large gem inside a holographic ring
 *
 * All hover (no yaw), with a thruster-trail look implied by glow.
 */
export function buildNeonPiece(type: PieceType, color: PieceColor): PieceBuild {
  const palette = neonPalette(color);
  let mesh: THREE.Group;
  switch (type) {
    case 'p': mesh = buildPawn(palette); break;
    case 'r': mesh = buildRook(palette); break;
    case 'n': mesh = buildKnight(palette); break;
    case 'b': mesh = buildBishop(palette); break;
    case 'q': mesh = buildQueen(palette); break;
    case 'k': mesh = buildKing(palette); break;
  }
  applyShadows(mesh);
  return {
    mesh,
    character: null,
    motion: 'hover' as MovementStyle,
    baseY: 0.10,
  };
}

interface NeonPalette {
  core: THREE.MeshStandardMaterial;
  shell: THREE.MeshStandardMaterial;
  rim: THREE.MeshStandardMaterial;
  trail: number;
}

function neonPalette(color: PieceColor): NeonPalette {
  if (color === 'w') {
    return {
      core: new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0x40e0ff,
        emissiveIntensity: 2.4,
        roughness: 0.18,
        metalness: 0.65,
      }),
      shell: new THREE.MeshStandardMaterial({
        color: 0x18243a,
        emissive: 0x081830,
        emissiveIntensity: 0.4,
        roughness: 0.32,
        metalness: 0.95,
      }),
      rim: new THREE.MeshStandardMaterial({
        color: 0x40e0ff,
        emissive: 0x40e0ff,
        emissiveIntensity: 1.8,
        roughness: 0.2,
        metalness: 0.7,
      }),
      trail: 0x40e0ff,
    };
  }
  return {
    core: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xff2a90,
      emissiveIntensity: 2.4,
      roughness: 0.18,
      metalness: 0.65,
    }),
    shell: new THREE.MeshStandardMaterial({
      color: 0x2c0a20,
      emissive: 0x180410,
      emissiveIntensity: 0.4,
      roughness: 0.32,
      metalness: 0.95,
    }),
    rim: new THREE.MeshStandardMaterial({
      color: 0xff2a90,
      emissive: 0xff2a90,
      emissiveIntensity: 1.8,
      roughness: 0.2,
      metalness: 0.7,
    }),
    trail: 0xff2a90,
  };
}

// ----- PAWN: tetrahedron with halo ring -----
function buildPawn(p: NeonPalette): THREE.Group {
  const g = new THREE.Group();
  const tetra = new THREE.Mesh(
    new THREE.TetrahedronGeometry(0.32, 0),
    p.shell,
  );
  tetra.position.y = 0.55;
  g.add(tetra);
  // Inner core glow
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.10, 16, 14),
    p.core,
  );
  core.position.y = 0.55;
  g.add(core);
  // Halo ring at base
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(0.28, 0.025, 12, 32),
    p.rim,
  );
  halo.position.y = 0.10;
  halo.rotation.x = Math.PI / 2;
  g.add(halo);
  // Tiny floor light disc
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.22, 0.04, 24),
    p.rim,
  );
  disc.position.y = 0.05;
  g.add(disc);
  return g;
}

// ----- ROOK: stacked cubes -----
function buildRook(p: NeonPalette): THREE.Group {
  const g = new THREE.Group();
  // Base
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(0.85, 0.10, 0.85),
    p.shell,
  );
  base.position.y = 0.05;
  g.add(base);
  // Stacked tiers
  for (let i = 0; i < 4; i++) {
    const t = new THREE.Mesh(
      new THREE.BoxGeometry(0.55 - i * 0.06, 0.18, 0.55 - i * 0.06),
      i % 2 === 0 ? p.shell : p.rim,
    );
    t.position.y = 0.16 + i * 0.20;
    g.add(t);
  }
  // Glowing core inside
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.10, 14, 12),
    p.core,
  );
  core.position.y = 0.55;
  g.add(core);
  // Top antenna
  const antenna = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.02, 0.30, 8),
    p.rim,
  );
  antenna.position.y = 1.10;
  g.add(antenna);
  const antennaTip = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 12, 10),
    p.core,
  );
  antennaTip.position.y = 1.28;
  g.add(antennaTip);
  return g;
}

// ----- KNIGHT: angular wireframe horse-head -----
function buildKnight(p: NeonPalette): THREE.Group {
  const g = new THREE.Group();
  // Floating base disc
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.34, 0.06, 24),
    p.rim,
  );
  disc.position.y = 0.10;
  g.add(disc);
  // Mid orb (the "engine")
  const orb = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.16, 0),
    p.core,
  );
  orb.position.y = 0.30;
  g.add(orb);
  // Horse-head silhouette via angular extruded shape
  const shape = new THREE.Shape();
  shape.moveTo(0.0, 0.0);
  shape.lineTo(-0.05, 0.05);
  shape.lineTo(-0.18, 0.20);
  shape.lineTo(-0.18, 0.42);
  shape.lineTo(-0.06, 0.55);
  shape.lineTo(0.18, 0.55);
  shape.lineTo(0.36, 0.40);
  shape.lineTo(0.40, 0.22);
  shape.lineTo(0.30, 0.10);
  shape.lineTo(0.15, 0.0);
  shape.lineTo(0.0, 0.0);
  const head = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: false, curveSegments: 8 }),
    p.shell,
  );
  head.position.set(-0.10, 0.42, -0.04);
  g.add(head);
  // Rim outline (slightly bigger duplicate as a wireframe-ish stroke)
  const outline = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shape, { depth: 0.10, bevelEnabled: false, curveSegments: 8 }),
    p.rim,
  );
  outline.scale.set(1.05, 1.05, 0.6);
  outline.position.copy(head.position).add(new THREE.Vector3(0, 0, 0.005));
  outline.material = p.rim;
  g.add(outline);
  return g;
}

// ----- BISHOP: floating prism with rotating energy core -----
function buildBishop(p: NeonPalette): THREE.Group {
  const g = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.30, 0.30, 0.06, 24),
    p.rim,
  );
  base.position.y = 0.08;
  g.add(base);
  // Main upright prism (octahedron stretched)
  const prism = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.32, 0),
    p.shell,
  );
  prism.scale.set(1.0, 1.5, 1.0);
  prism.position.y = 0.65;
  g.add(prism);
  // Glowing core
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.10, 18, 16),
    p.core,
  );
  core.position.y = 0.65;
  g.add(core);
  // Three orbiting rings
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.20 + i * 0.05, 0.012, 8, 24),
      p.rim,
    );
    ring.position.y = 0.65;
    ring.rotation.x = (Math.PI / 3) * i;
    ring.rotation.z = (Math.PI / 4) * i;
    g.add(ring);
  }
  return g;
}

// ----- QUEEN: crystalline diamond with satellites -----
function buildQueen(p: NeonPalette): THREE.Group {
  const g = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.36, 0.40, 0.10, 24),
    p.rim,
  );
  base.position.y = 0.08;
  g.add(base);
  // Diamond (two cones joined at base)
  const diamondMat = p.shell;
  const upper = new THREE.Mesh(
    new THREE.ConeGeometry(0.26, 0.50, 6),
    diamondMat,
  );
  upper.position.y = 0.80;
  g.add(upper);
  const lower = new THREE.Mesh(
    new THREE.ConeGeometry(0.26, 0.30, 6),
    diamondMat,
  );
  lower.position.y = 0.35;
  lower.rotation.x = Math.PI;
  g.add(lower);
  // Central core
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 18, 16),
    p.core,
  );
  core.position.y = 0.65;
  g.add(core);
  // Two orbiting satellites
  for (let i = 0; i < 2; i++) {
    const sat = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 12, 10),
      p.rim,
    );
    sat.position.set(0.40, 0.85 + i * 0.10, 0);
    sat.rotation.y = i * Math.PI;
    g.add(sat);
  }
  // Crown halo ring
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.28, 0.022, 10, 32),
    p.rim,
  );
  ring.position.y = 1.20;
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  return g;
}

// ----- KING: large gem inside holographic ring -----
function buildKing(p: NeonPalette): THREE.Group {
  const g = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.42, 0.46, 0.10, 24),
    p.rim,
  );
  base.position.y = 0.08;
  g.add(base);
  // Tall hexagonal column
  const column = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.28, 1.1, 6),
    p.shell,
  );
  column.position.y = 0.70;
  g.add(column);
  // Top dome
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 18, 14, 0, Math.PI * 2, 0, Math.PI / 2),
    p.shell,
  );
  dome.position.y = 1.25;
  g.add(dome);
  // Glowing core
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 20, 18),
    p.core,
  );
  core.position.y = 0.85;
  g.add(core);
  // Holographic ring around the column
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(0.45, 0.025, 12, 36),
    p.rim,
  );
  halo.position.y = 0.85;
  halo.rotation.x = Math.PI / 2;
  g.add(halo);
  // Cross atop
  const vBar = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.30, 0.05),
    p.rim,
  );
  vBar.position.y = 1.62;
  g.add(vBar);
  const hBar = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.05, 0.05),
    p.rim,
  );
  hBar.position.y = 1.62;
  g.add(hBar);
  // Top crown gem
  const gem = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.07, 0),
    p.core,
  );
  gem.position.y = 1.85;
  g.add(gem);
  return g;
}

function applyShadows(group: THREE.Group) {
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.receiveShadow = true;
      // Only cast for the larger silhouette meshes
      if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
      const r = m.geometry.boundingSphere?.radius ?? 0;
      m.castShadow = r >= 0.10;
    }
  });
}
