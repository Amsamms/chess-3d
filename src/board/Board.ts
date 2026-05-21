import * as THREE from 'three';
import {
  BOARD_DIM,
  SQUARE_SIZE,
  SquareCoord,
  coordToSquareName,
  isLightSquare,
  squareToWorld,
} from './coordinates';

/**
 * The chess board: ornate base slab + 64 squares + gold frame + corner finials.
 * Owns the per-square highlight overlay used by selection.
 */
export class Board {
  readonly group = new THREE.Group();
  /** key = square name (e.g., 'e4'), value = highlight mesh hovering above the square */
  private readonly highlights = new Map<string, THREE.Mesh>();
  /** Hidden pickable plane for each square (for raycasting empty squares) */
  readonly pickPlanes: THREE.Mesh[] = [];

  constructor() {
    this.buildSlab();
    this.buildSquares();
    this.buildFrame();
    this.buildPickPlanes();
  }

  private buildSlab() {
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(BOARD_DIM + 1.8, 0.4, BOARD_DIM + 1.8),
      new THREE.MeshStandardMaterial({
        color: 0x1a0f0a,
        roughness: 0.55,
        metalness: 0.25,
      }),
    );
    slab.position.y = -0.2;
    slab.receiveShadow = true;
    slab.castShadow = true;
    this.group.add(slab);

    // Inner inlay (visible just above slab top, slightly recessed under squares)
    const inlay = new THREE.Mesh(
      new THREE.BoxGeometry(BOARD_DIM + 0.08, 0.04, BOARD_DIM + 0.08),
      new THREE.MeshStandardMaterial({
        color: 0x6b4a2a,
        roughness: 0.35,
        metalness: 0.85,
        emissive: 0x140804,
      }),
    );
    inlay.position.y = 0.02;
    inlay.receiveShadow = true;
    this.group.add(inlay);
  }

  private buildSquares() {
    // Pre-make two materials so we share them.
    const lightMat = makeMarbleMaterial('light');
    const darkMat = makeMarbleMaterial('dark');

    for (let f = 0; f < 8; f++) {
      for (let r = 0; r < 8; r++) {
        const c: SquareCoord = { fileIdx: f, rankIdx: r };
        const mat = isLightSquare(c) ? lightMat : darkMat;
        const sq = new THREE.Mesh(
          new THREE.BoxGeometry(SQUARE_SIZE * 0.99, 0.1, SQUARE_SIZE * 0.99),
          mat,
        );
        const pos = squareToWorld(c, 0.1);
        sq.position.copy(pos);
        sq.receiveShadow = true;
        sq.userData = { kind: 'square', coord: c, name: coordToSquareName(c) };
        this.group.add(sq);
      }
    }
  }

  private buildFrame() {
    // Decorative gold border that hugs the squares.
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x8a5c2a,
      roughness: 0.32,
      metalness: 0.9,
      emissive: 0x1a0c04,
    });

    const borderThickness = 0.55;
    const borderHeight = 0.14;
    const innerSize = BOARD_DIM;
    const outerSize = innerSize + borderThickness * 2;

    // Build as four trapezoidal strips around the squares.
    const lengths = [
      { len: outerSize, w: borderThickness, x: 0, z: (innerSize + borderThickness) / 2 },
      { len: outerSize, w: borderThickness, x: 0, z: -(innerSize + borderThickness) / 2 },
      { len: innerSize, w: borderThickness, x: (innerSize + borderThickness) / 2, z: 0, rot: true },
      { len: innerSize, w: borderThickness, x: -(innerSize + borderThickness) / 2, z: 0, rot: true },
    ];
    for (const s of lengths) {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(s.rot ? s.w : s.len, borderHeight, s.rot ? s.len : s.w),
        frameMat,
      );
      m.position.set(s.x, borderHeight / 2 + 0.04, s.z);
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
    }

    // Finials at the 4 corners.
    const corner = outerSize / 2;
    for (const [sx, sz] of [
      [1, 1], [1, -1], [-1, 1], [-1, -1],
    ] as const) {
      const finial = new THREE.Group();
      const ball = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 20, 14),
        frameMat,
      );
      ball.position.y = 0.55;
      const stem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.16, 0.5, 18),
        frameMat,
      );
      stem.position.y = 0.25;
      const base = new THREE.Mesh(
        new THREE.CylinderGeometry(0.26, 0.3, 0.18, 24),
        frameMat,
      );
      base.position.y = 0.05;
      finial.add(base, stem, ball);
      finial.position.set(sx * corner, 0.04, sz * corner);
      finial.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      this.group.add(finial);
    }

    // File / rank labels in gold relief.
    const labelMat = new THREE.MeshStandardMaterial({
      color: 0xf7e6a9,
      emissive: 0xc97a1c,
      emissiveIntensity: 0.5,
      roughness: 0.4,
      metalness: 0.8,
      transparent: true,
      opacity: 0.85,
    });
    void labelMat;
    // (Labels via CanvasTexture would be nicer; skipping for first pass.)
  }

  private buildPickPlanes() {
    // Invisible thin planes for raycasting clicks even on empty squares.
    const pickMat = new THREE.MeshBasicMaterial({ visible: false });
    for (let f = 0; f < 8; f++) {
      for (let r = 0; r < 8; r++) {
        const c: SquareCoord = { fileIdx: f, rankIdx: r };
        const p = new THREE.Mesh(
          new THREE.PlaneGeometry(SQUARE_SIZE, SQUARE_SIZE),
          pickMat,
        );
        p.rotation.x = -Math.PI / 2;
        const pos = squareToWorld(c, 0.16);
        p.position.copy(pos);
        p.userData = { kind: 'square', coord: c, name: coordToSquareName(c) };
        this.pickPlanes.push(p);
        this.group.add(p);
      }
    }
  }

  // ---------- Highlights ----------
  highlightSquares(coords: SquareCoord[], kind: 'move' | 'capture' | 'selected') {
    for (const c of coords) {
      const name = coordToSquareName(c);
      if (this.highlights.has(name)) continue;
      const mesh = makeHighlightMesh(kind);
      mesh.position.copy(squareToWorld(c, 0.17));
      this.group.add(mesh);
      this.highlights.set(name, mesh);
    }
  }

  clearHighlights() {
    for (const m of this.highlights.values()) {
      this.group.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.highlights.clear();
  }

  /** Animate the highlight rings (called from render loop). */
  tickHighlights(t: number) {
    for (const m of this.highlights.values()) {
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.55 + Math.sin(t * 4 + m.id) * 0.18;
    }
  }
}

// ---- Helpers ----

function makeMarbleMaterial(kind: 'light' | 'dark'): THREE.MeshStandardMaterial {
  const tex = makeMarbleTexture(kind, 512);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return new THREE.MeshStandardMaterial({
    map: tex,
    roughness: kind === 'light' ? 0.35 : 0.45,
    metalness: 0.15,
    color: kind === 'light' ? 0xf2e0b0 : 0x3a2418,
  });
}

function makeMarbleTexture(kind: 'light' | 'dark', size: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const base = kind === 'light' ? '#efe0b3' : '#3a2418';
  const vein = kind === 'light' ? 'rgba(180,140,90,0.35)' : 'rgba(220,180,120,0.18)';
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  // Noise speckle
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * (kind === 'light' ? 18 : 14);
    img.data[i] = Math.max(0, Math.min(255, img.data[i] + n));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n * 0.9));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n * 0.8));
  }
  ctx.putImageData(img, 0, 0);

  // Marble veins
  ctx.strokeStyle = vein;
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 7; i++) {
    ctx.beginPath();
    let x = Math.random() * size;
    let y = Math.random() * size;
    ctx.moveTo(x, y);
    for (let s = 0; s < 14; s++) {
      x += (Math.random() - 0.5) * 50;
      y += (Math.random() - 0.5) * 50;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Wood grain rings for dark squares
  if (kind === 'dark') {
    ctx.strokeStyle = 'rgba(20,10,4,0.25)';
    ctx.lineWidth = 0.6;
    for (let i = 0; i < 12; i++) {
      ctx.beginPath();
      ctx.moveTo(0, i * (size / 12) + Math.random() * 6);
      for (let x = 0; x < size; x += 8) {
        ctx.lineTo(x, i * (size / 12) + Math.sin(x * 0.04 + i) * 4);
      }
      ctx.stroke();
    }
  }

  return new THREE.CanvasTexture(c);
}

function makeHighlightMesh(kind: 'move' | 'capture' | 'selected'): THREE.Mesh {
  const color = kind === 'capture' ? 0xff4a2a : kind === 'selected' ? 0xf7e6a9 : 0x6affb0;
  const ring = new THREE.RingGeometry(0.32, 0.45, 32);
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.7,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(ring, mat);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}
