// The shapes Sana's particles take: a breathing orb with orbit rings, and a
// glowing line-art bust (long hair, face, neck, shoulders, a suit of light).
// Pure maths, no three.js: build() returns typed arrays the scene feeds to
// the GPU, so the same points are drawn in both shapes and morph between
// them. Units: the figure is about 2.1 tall, centred on the origin.

// kinds (aKind in the shader)
export const HAIR = 1, FACE = 2, FEATURE = 3, MOUTH = 4, BODY = 5, SUIT = 6;

// A seeded random, so the figure is the same every time.
export function rng(seed = 7) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Catmull-Rom through the points, `n` samples spread by length.
export function spline(pts, n) {
  const dense = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < 24; k++) {
      const t = k / 24, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      dense.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  dense.push(pts[pts.length - 1]);
  const len = [0];
  for (let i = 1; i < dense.length; i++) len.push(len[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
  const total = len[len.length - 1] || 1;
  const out = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const d = (n === 1 ? 0.5 : i / (n - 1)) * total;
    while (j < len.length - 2 && len[j + 1] < d) j++;
    const seg = len[j + 1] - len[j] || 1;
    const u = (d - len[j]) / seg;
    out.push([dense[j][0] + (dense[j + 1][0] - dense[j][0]) * u, dense[j][1] + (dense[j + 1][1] - dense[j][1]) * u]);
  }
  return out;
}

export function pathLength(pts) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return l;
}

const mirror = (pts) => pts.map(([x, y]) => [-x, y]);
const lerpPts = (a, b, f) => a.map((p, i) => [p[0] + (b[i][0] - p[0]) * f, p[1] + (b[i][1] - p[1]) * f]);

// The drawing: each stroke is [points, kind, brightness, density per unit].
export function strokes(rand = rng(11)) {
  const out = [];
  const add = (pts, kind, bright, density, both = true) => {
    out.push({ pts, kind, bright, density });
    if (both) out.push({ pts: mirror(pts), kind, bright, density });
  };

  // hair: bright strands between the face-framing line and the outer
  // silhouette, from the parting down past the shoulders (as in the video:
  // a mane of light around a dark face)
  const inner = [[-0.02, 0.99], [-0.13, 0.96], [-0.23, 0.88], [-0.28, 0.72], [-0.3, 0.5], [-0.29, 0.25], [-0.32, -0.02], [-0.37, -0.3]];
  const outer = [[-0.03, 1.07], [-0.23, 1.04], [-0.38, 0.93], [-0.47, 0.72], [-0.5, 0.42], [-0.54, 0.06], [-0.59, -0.2], [-0.65, -0.44]];
  const strands = 110;
  for (let s = 0; s < strands; s++) {
    const f = Math.pow(s / (strands - 1), 0.8);
    const base = lerpPts(inner, outer, f);
    base[0] = [base[0][0] - 0.005 - rand() * 0.05, base[0][1] - rand() * 0.012];
    const end = 0.5 + rand() * 0.5;
    const keep = Math.max(3, Math.round(base.length * end));
    const pts = base.slice(0, keep).map(([x, y], i) => [x + (rand() - 0.5) * 0.028 * i * 0.4, y + (rand() - 0.5) * 0.018]);
    if (keep < base.length) { const nx = base[keep]; const t = rand() * 0.8; pts.push([pts[keep - 1][0] + (nx[0] - pts[keep - 1][0]) * t, pts[keep - 1][1] + (nx[1] - pts[keep - 1][1]) * t]); }
    // the strands near the face and on top shine most
    const bright = 0.55 + (1 - f) * 0.45 + rand() * 0.25;
    add(pts, HAIR, bright, 16 + rand() * 10);
  }
  add(inner, HAIR, 1.6, 70);
  add(outer, HAIR, 1.0, 50);

  // the face: a bright edge, dark inside, a line of light down the middle
  add(FACE_EDGE, FACE, 1.25, 200);
  add([[0, 0.76], [0.002, 0.6], [0, 0.42]], FEATURE, 1.1, 260, false);
  add([[-0.012, 0.7], [-0.01, 0.55], [-0.006, 0.44]], FEATURE, 0.55, 160);

  // neck, collarbones, shoulders, the breastbone
  add([[-0.1, 0.22], [-0.105, 0.1], [-0.13, -0.03]], BODY, 1.0, 170);
  add([[-0.13, -0.03], [-0.3, -0.1], [-0.55, -0.16], [-0.72, -0.27], [-0.8, -0.46], [-0.84, -0.76], [-0.86, -1.08]], BODY, 1.0, 170);
  add([[-0.03, -0.13], [-0.14, -0.1], [-0.27, -0.11], [-0.4, -0.16]], BODY, 0.85, 160);
  add([[0, -0.15], [0, -0.45], [0, -0.75]], BODY, 0.55, 120, false);
  // the suit of light, faint
  add([[-0.62, -0.28], [-0.36, -0.47], [-0.14, -0.7], [0, -0.86]], SUIT, 0.5, 120);
  add([[-0.42, -0.42], [-0.3, -0.6], [-0.16, -0.66], [-0.05, -0.62]], SUIT, 0.4, 100);
  add([[-0.64, -0.55], [-0.6, -0.82], [-0.57, -1.08]], SUIT, 0.45, 100);
  return out;
}

// The face's edge, forehead to chin (one side); also the dark mask's outline.
export const FACE_EDGE = [[-0.21, 0.87], [-0.25, 0.72], [-0.255, 0.56], [-0.235, 0.41], [-0.18, 0.28], [-0.09, 0.195], [0, 0.175]];
export function faceOutline() {
  const left = spline(FACE_EDGE, 40);
  const right = mirror(left).reverse();
  return [...left, ...right.slice(1), [0.2, 0.95], [0, 1.0], [-0.2, 0.95]];
}

// Depth: the head and the body are rounded, the hair sits behind the face.
export function depth(x, y, kind) {
  if (kind === HAIR) return -0.06 + 0.16 * Math.sqrt(Math.max(0, 1 - (x / 0.62) ** 2));
  if (y > 0.15) return 0.24 * Math.sqrt(Math.max(0, 1 - (x / 0.3) ** 2));
  return 0.32 * Math.sqrt(Math.max(0, 1 - (x / 0.95) ** 2));
}

// The same strokes as continuous lines of light (pairs of points for
// THREE.LineSegments): what the figure is made of once it has formed.
export function buildLines() {
  const all = strokes(rng(11));
  const pos = [], bright = [], kind = [], seed = [];
  const rand = rng(9);
  for (const st of all) {
    const n = Math.max(4, Math.round(pathLength(st.pts) * 90));
    const pts = spline(st.pts, n);
    const sd = rand();
    for (let i = 0; i < pts.length - 1; i++) {
      for (const [x, y] of [pts[i], pts[i + 1]]) {
        pos.push(x, y + 0.02, depth(x, y, st.kind));
        bright.push(st.bright);
        kind.push(st.kind);
        seed.push(sd);
      }
    }
  }
  return { position: new Float32Array(pos), bright: new Float32Array(bright), kind: new Float32Array(kind), seed: new Float32Array(seed) };
}

export const RINGS = 6;

// Everything the GPU needs, one entry per particle.
export function build(opts = {}) {
  const rand = rng(opts.seed || 3);
  const all = strokes(rng(11));
  const fig = [];
  for (const s of all) {
    const n = Math.max(3, Math.round(pathLength(s.pts) * s.density));
    for (const [x, y] of spline(s.pts, n)) {
      // a little scatter around the line, more for the hair
      const j = s.kind === HAIR ? 0.006 : 0.004;
      const px = x + (rand() - 0.5) * j, py = y + (rand() - 0.5) * j;
      fig.push({ x: px, y: py, z: depth(px, py, s.kind) + (rand() - 0.5) * 0.02, kind: s.kind, bright: s.bright * (0.75 + rand() * 0.4) });
    }
  }
  // a faint glow inside the face and a soft halo of stray dust
  for (let i = 0; i < 300; i++) {
    const a = rand() * Math.PI * 2, r = Math.sqrt(rand());
    const x = Math.cos(a) * r * 0.18, y = 0.5 + Math.sin(a) * r * 0.28;
    fig.push({ x, y, z: 0.22, kind: FEATURE, bright: 0.06 + rand() * 0.06 });
  }
  for (let i = 0; i < 700; i++) {
    const x = (rand() - 0.5) * 1.9, y = -1.1 + rand() * 2.3;
    fig.push({ x, y, z: (rand() - 0.5) * 0.6, kind: 0, bright: 0.08 + rand() * 0.12 });
  }

  const n = fig.length;
  const figure = new Float32Array(n * 3), orb = new Float32Array(n * 3), ring = new Float32Array(n * 2);
  const kind = new Float32Array(n), bright = new Float32Array(n), seed = new Float32Array(n), size = new Float32Array(n);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const p = fig[i];
    figure.set([p.x, p.y + 0.02, p.z], i * 3);
    kind[i] = p.kind;
    bright[i] = p.bright;
    seed[i] = rand();
    size[i] = p.kind === 0 ? 1.4 + rand() * 1.6 : 1.6 + rand() * 1.4;
    // the orb: a shell, a hot core, and rings (drawn by the shader)
    const r = rand();
    ring[i * 2] = -1;
    if (r < 0.62) {
      const k = i + 0.5, yy = 1 - (2 * ((k * 7919) % n)) / n;
      const rad = Math.sqrt(Math.max(0, 1 - yy * yy)), th = golden * k;
      const R = 0.5 + (rand() - 0.5) * 0.12;
      orb.set([Math.cos(th) * rad * R, yy * R, Math.sin(th) * rad * R], i * 3);
    } else if (r < 0.7) {
      const a = rand() * Math.PI * 2, b = Math.acos(2 * rand() - 1), R = Math.pow(rand(), 2) * 0.16;
      orb.set([Math.sin(b) * Math.cos(a) * R, Math.cos(b) * R, Math.sin(b) * Math.sin(a) * R], i * 3);
    } else {
      ring[i * 2] = Math.floor(rand() * RINGS);
      ring[i * 2 + 1] = rand() * Math.PI * 2;
      orb.set([0, 0, (rand() - 0.5) * 0.04], i * 3); // thickness of the ring
    }
  }
  return { count: n, figure, orb, ring, kind, bright, seed, size };
}

// The rings' planes and sizes (fixed, so the orb always looks the same).
export function ringBases(seed = 5) {
  const rand = rng(seed);
  const out = [];
  for (let i = 0; i < RINGS; i++) {
    const a = rand() * Math.PI, b = (rand() - 0.5) * Math.PI * 0.9;
    const nx = Math.sin(a) * Math.cos(b), ny = Math.sin(b), nz = Math.cos(a) * Math.cos(b);
    // two axes in the ring's plane
    let ux = ny, uy = -nx, uz = 0;
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul; uy /= ul;
    const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;
    out.push({ u: [ux, uy, uz], v: [vx, vy, vz], r: 0.6 + rand() * 0.42, speed: (0.25 + rand() * 0.5) * (rand() < 0.5 ? -1 : 1) });
  }
  return out;
}
