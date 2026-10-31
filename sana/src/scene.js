// The stage: Sana's particles on the GPU, with glow (bloom), a deep blue
// background with slow flowing lines, and the controls the rest of the app
// uses: show the figure or the orb, turn, speak, listen.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { build, ringBases, RINGS } from './figure.js';

const VERT = /* glsl */ `
uniform float uTime, uMix, uSpeak, uMic, uPixel, uScale;
uniform vec3 uRingU[${RINGS}], uRingV[${RINGS}];
uniform float uRingR[${RINGS}], uRingS[${RINGS}];
attribute vec3 aOrb;
attribute vec2 aRing;
attribute float aKind, aBright, aSeed, aSize;
varying float vBright;
varying vec3 vColor;

mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0., -s, 0., 1., 0., s, 0., c); }

void main() {
  // the orb: a turning shell, a core, and rings spinning in their planes
  vec3 orb = aOrb;
  if (aRing.x >= 0.0) {
    int r = int(aRing.x + 0.5);
    float a = aRing.y + uTime * uRingS[r];
    float R = uRingR[r] * (1.0 + uMic * 0.18 + sin(uTime * 1.3 + aSeed * 6.28) * 0.015);
    orb = uRingU[r] * cos(a) * R + uRingV[r] * sin(a) * R + aOrb.z * cross(uRingU[r], uRingV[r]);
  } else {
    float breathe = 1.0 + sin(uTime * 1.6) * 0.03 + uMic * 0.25 + uSpeak * 0.12;
    orb = rotY(uTime * 0.35 + aSeed * 0.2) * aOrb * breathe;
  }

  // the figure: hair sways, the body breathes, the lower lip moves when speaking
  vec3 fig = position;
  if (aKind == 1.0) fig.x += sin(uTime * 0.9 + fig.y * 2.6 + aSeed * 2.0) * 0.009 * (1.1 - fig.y);
  fig.y *= 1.0 + sin(uTime * 1.2) * 0.004;
  if (aKind == 4.0 && fig.y < 0.3) fig.y -= uSpeak * 0.018;
  if (aKind == 0.0) fig += vec3(sin(uTime * 0.2 + aSeed * 40.0), cos(uTime * 0.17 + aSeed * 30.0), 0.0) * 0.03;

  // morph, each particle on its own schedule, swirling on the way
  float t = clamp(uMix * 1.7 - aSeed * 0.7, 0.0, 1.0);
  t = t * t * (3.0 - 2.0 * t);
  float ang = aSeed * 6.2831 + uTime * 1.5;
  vec3 swirl = vec3(cos(ang), sin(ang * 0.7) * 0.6, sin(ang)) * sin(t * 3.14159) * (0.35 + aSeed * 0.4);
  vec3 p = mix(orb, fig, t) + swirl;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float face = (aKind >= 2.0 && aKind <= 4.0) ? 1.0 : 0.0;
  // in the orb, the shell is a faint veil and the rings carry the light
  float orbGlow = aRing.x >= 0.0 ? 1.1 : 0.22;
  float glow = aBright * mix(orbGlow * (1.0 + uMic * 1.5 + uSpeak * 0.8), 0.85 + uSpeak * face * 1.4, t);
  // twinkle
  glow *= 0.82 + 0.18 * sin(uTime * (1.5 + aSeed * 3.0) + aSeed * 50.0);
  vBright = glow;
  vec3 cold = vec3(0.30, 0.42, 1.0), hot = vec3(0.85, 0.92, 1.0);
  vColor = mix(cold, hot, clamp(glow * 0.8 + face * uSpeak * 0.5, 0.0, 1.0));
  gl_PointSize = aSize * 2.6 * uPixel * uScale / -mv.z * (1.0 + (1.0 - t) * 0.25);
}`;

const FRAG = /* glsl */ `
varying float vBright;
varying vec3 vColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d);
  if (r > 0.5) discard;
  float a = smoothstep(0.5, 0.0, r);
  gl_FragColor = vec4(vColor * vBright * 1.05, a * a);
}`;

// background: deep blue, a soft light behind the figure, slow lines of light
const BG_VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }`;
const BG_FRAG = /* glsl */ `
uniform float uTime, uAspect, uMix;
varying vec2 vUv;
float line(vec2 p, float k, float sp, float ph) {
  float y = 0.18 * sin(p.x * k + uTime * sp + ph) + 0.08 * sin(p.x * k * 2.3 - uTime * sp * 0.7 + ph * 1.7);
  return smoothstep(0.006, 0.0, abs(p.y - y)) + smoothstep(0.05, 0.0, abs(p.y - y)) * 0.12;
}
void main() {
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
  // linear colours: the output turns them to sRGB (0.09 here is a deep blue on screen)
  vec3 c = mix(vec3(0.0006, 0.001, 0.012), vec3(0.003, 0.006, 0.07), smoothstep(1.1, 0.0, length(p * vec2(0.8, 1.2))));
  c += vec3(0.004, 0.008, 0.11) * uMix * smoothstep(0.9, 0.0, length(p * vec2(1.0, 0.8)));
  float l = 0.0;
  l += line(p + vec2(0.0, 0.22), 2.2, 0.15, 0.0);
  l += line(p - vec2(0.0, 0.25), 1.7, -0.12, 2.0) * 0.8;
  l += line(p + vec2(0.0, 0.05), 3.1, 0.09, 4.0) * 0.6;
  c += vec3(0.05, 0.08, 0.45) * l * 0.35;
  gl_FragColor = vec4(c, 1.0);
}`;

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  const pixel = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pixel);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 50);
  camera.position.set(0, 0.05, 4.2);

  // background
  const bgMat = new THREE.ShaderMaterial({
    vertexShader: BG_VERT, fragmentShader: BG_FRAG, depthWrite: false, depthTest: false,
    uniforms: { uTime: { value: 0 }, uAspect: { value: 1 }, uMix: { value: 0 } },
  });
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bgMat);
  bg.frustumCulled = false;
  bg.renderOrder = -1;
  scene.add(bg);

  // the particles
  const data = build();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(data.figure, 3));
  geo.setAttribute('aOrb', new THREE.BufferAttribute(data.orb, 3));
  geo.setAttribute('aRing', new THREE.BufferAttribute(data.ring, 2));
  geo.setAttribute('aKind', new THREE.BufferAttribute(data.kind, 1));
  geo.setAttribute('aBright', new THREE.BufferAttribute(data.bright, 1));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(data.seed, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(data.size, 1));
  const rings = ringBases();
  const uniforms = {
    uTime: { value: 0 }, uMix: { value: 0 }, uSpeak: { value: 0 }, uMic: { value: 0 }, uPixel: { value: pixel }, uScale: { value: 2.2 },
    uRingU: { value: rings.map((r) => new THREE.Vector3(...r.u)) },
    uRingV: { value: rings.map((r) => new THREE.Vector3(...r.v)) },
    uRingR: { value: rings.map((r) => r.r) },
    uRingS: { value: rings.map((r) => r.speed) },
  };
  const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  const group = new THREE.Group();
  group.add(points);
  scene.add(group);

  // the orb's hot core
  const coreTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.18, 'rgba(170,190,255,.9)');
    gr.addColorStop(0.5, 'rgba(60,80,255,.25)');
    gr.addColorStop(1, 'rgba(20,30,180,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();
  const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: coreTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  core.scale.set(0.7, 0.7, 1);
  group.add(core);

  // glow
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const q = new URLSearchParams(location.search);
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), Number(q.get('bloom') ?? 1.25), 0.5, 0.12);
  if (q.get('bloom') !== '0') composer.addPass(bloom);
  composer.addPass(new OutputPass());

  function resize() {
    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    // keep the whole bust in view on a narrow window
    camera.position.z = w / h < 1 ? 4.2 / Math.max(0.55, w / h) : 4.2;
    camera.updateProjectionMatrix();
    bgMat.uniforms.uAspect.value = w / h;
    uniforms.uScale.value = h / 360;
  }
  window.addEventListener('resize', resize);
  resize();

  // what the app sets; the loop eases towards it
  const target = { mix: 0, yaw: 0, pitch: 0, speak: 0, mic: 0 };
  const now = { mix: 0, yaw: 0, pitch: 0, speak: 0, mic: 0 };
  let last = performance.now();
  let morphSpeed = 0.42; // a full morph in about 2.4 s
  function frame(t) {
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    const time = t / 1000;
    now.mix += Math.sign(target.mix - now.mix) * Math.min(Math.abs(target.mix - now.mix), dt * morphSpeed);
    for (const k of ['yaw', 'pitch']) now[k] += (target[k] - now[k]) * Math.min(1, dt * 2.2);
    now.speak += (target.speak - now.speak) * Math.min(1, dt * 14);
    now.mic += (target.mic - now.mic) * Math.min(1, dt * 10);
    uniforms.uTime.value = time;
    uniforms.uMix.value = now.mix;
    uniforms.uSpeak.value = now.speak;
    uniforms.uMic.value = now.mic;
    bgMat.uniforms.uTime.value = time;
    bgMat.uniforms.uMix.value = now.mix;
    group.rotation.y = now.yaw + Math.sin(time * 0.4) * 0.04 * now.mix;
    group.rotation.x = now.pitch;
    // the figure stands a little lower than the orb
    group.position.y = -0.05 * now.mix;
    const coreVis = 1 - Math.min(1, now.mix * 2.2);
    core.material.opacity = coreVis * (0.85 + now.speak * 0.4 + now.mic * 0.5 + Math.sin(time * 2) * 0.05);
    core.scale.setScalar((0.95 + now.mic * 0.5 + now.speak * 0.3 + Math.sin(time * 1.6) * 0.05) * 0.7);
    bloom.strength = (Number(q.get('bloom') ?? 1.25)) + now.speak * 0.35 + now.mic * 0.3;
    composer.render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    showFigure(on = true, fast = false) {
      morphSpeed = fast ? 5 : 0.42;
      target.mix = on ? 1 : 0;
      if (!on) target.yaw = 0;
    },
    get figure() { return target.mix === 1; },
    get morphing() { return Math.abs(now.mix - target.mix) > 0.001; },
    // «يمين» is the screen's right, as the one talking to her sees it
    turn(dir) { target.yaw = dir === 'right' ? 0.55 : dir === 'left' ? -0.55 : 0; },
    nod() { target.pitch = 0.12; setTimeout(() => (target.pitch = 0), 450); },
    setSpeak(v) { target.speak = Math.max(0, Math.min(1, v)); },
    setMic(v) { target.mic = Math.max(0, Math.min(1, v)); },
    get count() { return data.count; },
  };
}
