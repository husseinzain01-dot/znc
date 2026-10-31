// The stage, as in the reference video:
//  - the orb: a dark disc with a bright rim and a star of light inside,
//    wrapped in long ribbons of violet-blue light, on a near-black screen;
//  - the figure: a bust of continuous light lines (a mane of bright hair, a
//    dark face with a line of light down the middle, neck and collarbones)
//    on a vivid blue, cloudy background with a great ring behind her;
//  - between them, particles stream from the orb and build her up from the
//    bottom, as her lines fade in.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { build, buildLines, faceOutline, ringBases, RINGS, rng } from './figure.js';

// ------------------------------------------------------------ shaders
const SWAY = /* glsl */ `
vec3 sway(vec3 p, float kind, float seed, float time) {
  if (kind == 1.0) p.x += sin(time * 0.9 + p.y * 2.6 + seed * 2.0) * 0.008 * (1.1 - p.y);
  p.y *= 1.0 + sin(time * 1.2) * 0.004;
  return p;
}`;

const PARTICLE_VERT = /* glsl */ `
uniform float uTime, uMix, uSpeak, uMic, uPixel, uScale;
uniform vec3 uRingU[${RINGS}], uRingV[${RINGS}];
uniform float uRingR[${RINGS}], uRingS[${RINGS}];
attribute vec3 aOrb;
attribute vec2 aRing;
attribute float aKind, aBright, aSeed, aSize;
varying float vBright;
varying vec3 vColor;
${SWAY}
mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0., -s, 0., 1., 0., s, 0., c); }
void main() {
  vec3 orb = aOrb;
  if (aRing.x >= 0.0) {
    int r = int(aRing.x + 0.5);
    float a = aRing.y + uTime * uRingS[r];
    float R = uRingR[r] * (1.0 + uMic * 0.2);
    orb = uRingU[r] * cos(a) * R + uRingV[r] * sin(a) * R + aOrb.z * cross(uRingU[r], uRingV[r]);
  } else {
    orb = rotY(uTime * 0.35 + aSeed * 0.2) * aOrb * (1.0 + uMic * 0.25 + sin(uTime * 1.6) * 0.03);
  }
  orb.y += 0.42;
  vec3 fig = sway(position, aKind, aSeed, uTime);
  if (aKind == 0.0) fig += vec3(sin(uTime * 0.2 + aSeed * 40.0), cos(uTime * 0.17 + aSeed * 30.0), 0.0) * 0.04;

  // she is built from the bottom up: low particles leave the orb first
  float low = clamp((position.y + 1.1) / 2.3, 0.0, 1.0);
  float t = clamp(uMix * 1.9 - low * 0.75 - aSeed * 0.2, 0.0, 1.0);
  t = t * t * (3.0 - 2.0 * t);
  float ang = aSeed * 6.2831 + uTime * 1.5;
  vec3 swirl = vec3(cos(ang), sin(ang * 0.7) * 0.6, sin(ang)) * sin(t * 3.14159) * (0.3 + aSeed * 0.4);
  vec3 p = mix(orb, fig, t) + swirl;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float face = (aKind >= 2.0 && aKind <= 4.0) ? 1.0 : 0.0;
  // in flight they shine; once she is formed her lines carry the shape and
  // the particles are a fine glitter on them
  float flight = sin(t * 3.14159);
  float glow = aBright * (mix(0.2 + uMic * 0.8, 0.22 + uSpeak * face * 0.8, t) + flight * 0.7);
  glow *= 0.75 + 0.25 * sin(uTime * (1.5 + aSeed * 3.0) + aSeed * 50.0);
  vBright = glow;
  vColor = mix(vec3(0.42, 0.45, 1.0), vec3(0.9, 0.94, 1.0), clamp(glow, 0.0, 1.0));
  gl_PointSize = aSize * 2.3 * uPixel * uScale / -mv.z;
}`;
const PARTICLE_FRAG = /* glsl */ `
varying float vBright;
varying vec3 vColor;
void main() {
  float r = length(gl_PointCoord - 0.5);
  if (r > 0.5) discard;
  float a = smoothstep(0.5, 0.0, r);
  gl_FragColor = vec4(vColor * vBright, a * a);
}`;

const LINE_VERT = /* glsl */ `
uniform float uTime, uReveal, uSpeak;
uniform vec2 uShift;
attribute float aKind, aBright, aSeed;
varying float vA;
varying vec3 vColor;
${SWAY}
void main() {
  vec3 p = sway(position, aKind, aSeed, uTime);
  p.xy += uShift;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  // revealed from the bottom up
  float edge = uReveal * 2.6 - 1.2;
  float shown = smoothstep(edge, edge - 0.25, position.y);
  float face = (aKind >= 2.0 && aKind <= 4.0) ? 1.0 : 0.0;
  // the hair is many strands on top of each other: each one faint
  float hair = aKind == 1.0 ? 0.2 * (0.55 + 0.45 * smoothstep(1.06, 0.8, position.y)) : 1.0;
  float b = aBright * hair * (1.0 + face * uSpeak * 1.2);
  b *= 0.9 + 0.1 * sin(uTime * 2.0 + aSeed * 30.0 + position.y * 4.0);
  vA = shown * b;
  vColor = mix(vec3(0.55, 0.6, 1.0), vec3(1.0), clamp(b * 0.8, 0.0, 1.0));
}`;
const LINE_FRAG = /* glsl */ `
uniform float uOpacity;
varying float vA;
varying vec3 vColor;
void main() { gl_FragColor = vec4(vColor * vA * uOpacity, 1.0); }`;

// a ribbon of the orb: brightness travels along it
const RIBBON_VERT = /* glsl */ `
attribute float aT;
varying float vT;
void main() { vT = aT; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const RIBBON_FRAG = /* glsl */ `
uniform float uTime, uOpacity, uPhase, uBright;
uniform vec3 uColor;
varying float vT;
void main() {
  float w = 0.35 + 0.65 * pow(0.5 + 0.5 * sin((vT * 2.0 - uTime * 0.25 + uPhase) * 6.2831), 3.0);
  gl_FragColor = vec4(uColor * w * uBright * uOpacity, 1.0);
}`;

const BG_VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }`;
const BG_FRAG = /* glsl */ `
uniform float uTime, uAspect, uMix;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
float streak(vec2 p, float k, float sp, float ph, float off) {
  float y = off + 0.16 * sin(p.x * k + uTime * sp + ph) + 0.06 * sin(p.x * k * 2.3 - uTime * sp * 0.7 + ph * 1.7);
  float d = abs(p.y - y);
  return smoothstep(0.004, 0.0, d) + smoothstep(0.045, 0.0, d) * 0.18;
}
void main() {
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
  // linear colours (the output turns them to sRGB)
  vec3 dark = mix(vec3(0.0004, 0.0006, 0.006), vec3(0.002, 0.003, 0.03), smoothstep(0.9, 0.0, length(p)));
  float cloud = fbm(p * 2.2 + vec2(uTime * 0.015, -uTime * 0.01));
  vec3 blue = mix(vec3(0.004, 0.006, 0.12), vec3(0.018, 0.026, 0.52), smoothstep(1.0, 0.1, length(p * vec2(0.7, 1.0))));
  blue *= 0.55 + 0.75 * cloud;
  vec3 c = mix(dark, blue, uMix);
  float l = streak(p, 2.2, 0.15, 0.0, 0.3) + streak(p, 1.7, -0.12, 2.0, -0.28) * 0.8 + streak(p, 3.1, 0.09, 4.0, 0.05) * 0.5;
  c += mix(vec3(0.03, 0.03, 0.2), vec3(0.08, 0.1, 0.7), uMix) * l * (0.35 + uMix * 0.4);
  gl_FragColor = vec4(c, 1.0);
}`;

// ------------------------------------------------------------ helpers
function texture(draw, size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// the star in the orb: a white core and fine rays
const starTex = () => texture((g, s) => {
  const h = s / 2;
  const gr = g.createRadialGradient(h, h, 0, h, h, h);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.08, 'rgba(235,240,255,.95)');
  gr.addColorStop(0.22, 'rgba(150,165,255,.45)');
  gr.addColorStop(0.55, 'rgba(70,80,255,.12)');
  gr.addColorStop(1, 'rgba(40,40,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, s, s);
  g.globalCompositeOperation = 'lighter';
  const rand = rng(21);
  for (let i = 0; i < 90; i++) {
    const a = rand() * Math.PI * 2, len = h * (0.25 + rand() * 0.55);
    const lg = g.createLinearGradient(h, h, h + Math.cos(a) * len, h + Math.sin(a) * len);
    lg.addColorStop(0, 'rgba(255,255,255,.55)');
    lg.addColorStop(1, 'rgba(160,170,255,0)');
    g.strokeStyle = lg;
    g.lineWidth = 0.6 + rand();
    g.beginPath();
    g.moveTo(h, h);
    g.lineTo(h + Math.cos(a) * len, h + Math.sin(a) * len);
    g.stroke();
  }
});
const circlePoints = (r, n = 180, cx = 0, cy = 0) => {
  const out = [];
  for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2; out.push(new THREE.Vector3(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0)); }
  return out;
};

export function createScene(canvas) {
  const q = new URLSearchParams(location.search);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  const pixel = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pixel);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 50);
  const look = new THREE.Vector3(0, 0.3, 0);

  // background
  const bgMat = new THREE.ShaderMaterial({ vertexShader: BG_VERT, fragmentShader: BG_FRAG, depthWrite: false, depthTest: false, uniforms: { uTime: { value: 0 }, uAspect: { value: 1 }, uMix: { value: 0 } } });
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bgMat);
  bg.frustumCulled = false;
  bg.renderOrder = -10;
  scene.add(bg);

  const group = new THREE.Group();
  scene.add(group);
  const additive = { transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending };

  // ---- the figure
  // the great ring behind her
  const halo = new THREE.Line(new THREE.BufferGeometry().setFromPoints(circlePoints(1.42, 240, 0, 0.5)), new THREE.LineBasicMaterial({ color: 0x6f7cff, ...additive, opacity: 0 }));
  halo.position.z = -0.6;
  halo.renderOrder = -6;
  group.add(halo);
  // her face: dark, hiding what is behind it
  const shape = new THREE.Shape(faceOutline().map(([x, y]) => new THREE.Vector2(x, y + 0.02)));
  const mask = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: 0x03061f, transparent: true, opacity: 0, depthWrite: false, depthTest: false }));
  mask.position.z = 0.1;
  mask.renderOrder = -5;
  group.add(mask);
  // her lines, drawn twice (a hair apart) so they read as strokes of light
  const L = buildLines();
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(L.position, 3));
  lineGeo.setAttribute('aBright', new THREE.BufferAttribute(L.bright, 1));
  lineGeo.setAttribute('aKind', new THREE.BufferAttribute(L.kind, 1));
  lineGeo.setAttribute('aSeed', new THREE.BufferAttribute(L.seed, 1));
  const lineUniforms = { uTime: { value: 0 }, uReveal: { value: 0 }, uSpeak: { value: 0 } };
  for (const [x, y, op] of [[0, 0, 0.85], [0.0022, 0.0012, 0.45]]) {
    const m = new THREE.ShaderMaterial({
      vertexShader: LINE_VERT, fragmentShader: LINE_FRAG, ...additive,
      uniforms: { ...lineUniforms, uShift: { value: new THREE.Vector2(x, y) }, uOpacity: { value: op } },
    });
    const ls = new THREE.LineSegments(lineGeo, m);
    ls.frustumCulled = false;
    ls.renderOrder = 1;
    group.add(ls);
  }

  // ---- the particles (orb glitter ↔ her)
  const data = build();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(data.figure, 3));
  for (const [k, v, n] of [['aOrb', data.orb, 3], ['aRing', data.ring, 2], ['aKind', data.kind, 1], ['aBright', data.bright, 1], ['aSeed', data.seed, 1], ['aSize', data.size, 1]]) geo.setAttribute(k, new THREE.BufferAttribute(v, n));
  const rings = ringBases();
  const uniforms = {
    uTime: { value: 0 }, uMix: { value: 0 }, uSpeak: { value: 0 }, uMic: { value: 0 }, uPixel: { value: pixel }, uScale: { value: 2 },
    uRingU: { value: rings.map((r) => new THREE.Vector3(...r.u)) }, uRingV: { value: rings.map((r) => new THREE.Vector3(...r.v)) },
    uRingR: { value: rings.map((r) => r.r) }, uRingS: { value: rings.map((r) => r.speed) },
  };
  const points = new THREE.Points(geo, new THREE.ShaderMaterial({ vertexShader: PARTICLE_VERT, fragmentShader: PARTICLE_FRAG, uniforms, ...additive }));
  points.frustumCulled = false;
  points.renderOrder = 2;
  group.add(points);

  // ---- the orb
  const orb = new THREE.Group();
  orb.position.y = 0.42;
  group.add(orb);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.4, 96), new THREE.MeshBasicMaterial({ color: 0x010208, transparent: true, depthWrite: false, depthTest: false }));
  disc.renderOrder = -4;
  orb.add(disc);
  const rimMat = new THREE.LineBasicMaterial({ color: 0xc9d0ff, ...additive });
  const rim = new THREE.Line(new THREE.BufferGeometry().setFromPoints(circlePoints(0.4, 160)), rimMat);
  rim.renderOrder = 3;
  orb.add(rim);
  const rim2Mat = new THREE.LineBasicMaterial({ color: 0x8090ff, ...additive, opacity: 0.6 });
  const rim2 = new THREE.Line(new THREE.BufferGeometry().setFromPoints(circlePoints(0.405, 160)), rim2Mat);
  rim2.renderOrder = 3;
  orb.add(rim2);
  const star = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTex(), ...additive }));
  star.scale.set(0.62, 0.62, 1);
  star.renderOrder = 4;
  orb.add(star);
  // the ribbons
  const ribbons = [];
  const rr = rng(33);
  for (let i = 0; i < 13; i++) {
    const k = 2 + Math.floor(rr() * 2), ph = rr() * 6.28, base = 0.5 + rr() * 0.42, wob = 0.08 + rr() * 0.12;
    const pts = [], ts = [];
    const n = 320;
    for (let j = 0; j <= n; j++) {
      const t = (j / n) * Math.PI * 2;
      const r = base + wob * Math.sin(k * t + ph);
      pts.push(Math.cos(t) * r, Math.sin(t) * r * 0.75, Math.sin(t * k + ph * 2) * 0.22);
      ts.push(j / n);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    g.setAttribute('aT', new THREE.Float32BufferAttribute(ts, 1));
    const color = new THREE.Color().setHSL(0.66 + rr() * 0.06, 0.85, 0.62);
    const mat = new THREE.ShaderMaterial({ vertexShader: RIBBON_VERT, fragmentShader: RIBBON_FRAG, ...additive, uniforms: { uTime: { value: 0 }, uOpacity: { value: 1 }, uPhase: { value: rr() * 6.28 }, uBright: { value: 0.55 + rr() * 0.6 }, uColor: { value: color } } });
    const holder = new THREE.Group();
    holder.rotation.set((rr() - 0.5) * 1.6, (rr() - 0.5) * 1.6, rr() * 3.14);
    for (const off of [0, 0.006]) {
      const line = new THREE.Line(g, mat);
      line.position.set(off, off * 0.5, 0);
      line.renderOrder = 3;
      line.frustumCulled = false;
      holder.add(line);
    }
    holder.userData.spin = new THREE.Vector3((rr() - 0.5) * 0.25, (rr() - 0.5) * 0.35, (rr() - 0.5) * 0.3);
    holder.userData.mat = mat;
    orb.add(holder);
    ribbons.push(holder);
  }

  // glow
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloomBase = Number(q.get('bloom') ?? 0.95);
  // a tight glow: around the lines, not over her face
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), bloomBase, 0.32, 0.2);
  if (q.get('bloom') !== '0') composer.addPass(bloom);
  composer.addPass(new OutputPass());

  function resize() {
    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.position.set(0, 0.32, w / h < 1 ? 3.9 / Math.max(0.55, w / h) : 3.9);
    camera.lookAt(look);
    camera.updateProjectionMatrix();
    bgMat.uniforms.uAspect.value = w / h;
    uniforms.uScale.value = h / 360;
  }
  window.addEventListener('resize', resize);
  resize();

  const target = { mix: 0, yaw: 0, pitch: 0, speak: 0, mic: 0 };
  const now = { mix: 0, yaw: 0, pitch: 0, speak: 0, mic: 0 };
  let last = performance.now();
  let morphSpeed = 0.36;
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  function frame(t) {
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    const time = t / 1000;
    now.mix += Math.sign(target.mix - now.mix) * Math.min(Math.abs(target.mix - now.mix), dt * morphSpeed);
    for (const k of ['yaw', 'pitch']) now[k] += (target[k] - now[k]) * Math.min(1, dt * 2.2);
    now.speak += (target.speak - now.speak) * Math.min(1, dt * 14);
    now.mic += (target.mic - now.mic) * Math.min(1, dt * 10);
    const m = now.mix;
    const orbVis = 1 - smooth(0.0, 0.32, m);
    const figVis = smooth(0.45, 1.0, m);

    uniforms.uTime.value = time;
    uniforms.uMix.value = m;
    uniforms.uSpeak.value = now.speak;
    uniforms.uMic.value = now.mic;
    lineUniforms.uTime.value = time;
    lineUniforms.uReveal.value = smooth(0.3, 1.0, m) * 1.05;
    lineUniforms.uSpeak.value = now.speak;
    bgMat.uniforms.uTime.value = time;
    bgMat.uniforms.uMix.value = smooth(0.4, 1.0, m);
    mask.material.opacity = figVis;
    halo.material.opacity = figVis * (0.32 + now.speak * 0.25 + Math.sin(time * 0.8) * 0.05);

    // the orb: spinning ribbons, the star breathing with the voices
    orb.visible = orbVis > 0.001;
    const pulse = 1 + now.mic * 0.35 + now.speak * 0.2 + Math.sin(time * 1.7) * 0.04;
    orb.scale.setScalar((0.6 + orbVis * 0.4) * (1 + now.mic * 0.08));
    for (const h of ribbons) {
      h.rotation.x += h.userData.spin.x * dt;
      h.rotation.y += h.userData.spin.y * dt;
      h.rotation.z += h.userData.spin.z * dt;
      h.userData.mat.uniforms.uTime.value = time;
      h.userData.mat.uniforms.uOpacity.value = orbVis * (0.85 + now.mic * 0.6);
    }
    disc.material.opacity = orbVis;
    rimMat.opacity = orbVis;
    rim2Mat.opacity = orbVis * 0.6;
    star.material.opacity = orbVis;
    star.scale.setScalar(0.62 * pulse);

    group.rotation.y = now.yaw + Math.sin(time * 0.4) * 0.03 * m;
    group.rotation.x = now.pitch;
    bloom.strength = bloomBase + now.speak * 0.35 + now.mic * 0.3;
    composer.render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    showFigure(on = true, fast = false) {
      morphSpeed = fast ? 5 : 0.36;
      target.mix = on ? 1 : 0;
      if (!on) target.yaw = 0;
    },
    get figure() { return target.mix === 1; },
    get morphing() { return Math.abs(now.mix - target.mix) > 0.001; },
    // «يمين» is the screen's right, as the one talking to her sees it
    turn(dir) { target.yaw = dir === 'right' ? 0.5 : dir === 'left' ? -0.5 : 0; },
    nod() { target.pitch = 0.08; setTimeout(() => (target.pitch = 0), 450); },
    setSpeak(v) { target.speak = Math.max(0, Math.min(1, v)); },
    setMic(v) { target.mic = Math.max(0, Math.min(1, v)); },
    get count() { return data.count; },
  };
}
