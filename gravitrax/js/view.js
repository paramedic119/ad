/**
 * view.js — three.js のシーン構築とモデルの描画
 * レンダラ／ライティング／環境マップ／カメラ操作／盤面／コースの可視化。
 */
import * as THREE from 'three';
import {
  HEX_R, HEX_W, H, BALL_R, ROD_R, ROD_SEP, ROD_DROP,
  cellCenter, hexBoard, worldToCell, portPos, surfaceY, clamp,
} from './core.js';
import { hexPrismGeo, hexShape } from './geo.js';
import { PARTS } from './parts.js';

/* ─────────────── マテリアル ─────────────── */

export function createMaterials() {
  const cache = new Map();
  const std = (kfn) => (color) => {
    const k = kfn.name + ':' + color;
    if (!cache.has(k)) cache.set(k, kfn(color));
    return cache.get(k);
  };
  const M = {
    tile: std(function tile(color) {
      return new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.02 });
    }),
    accent: std(function accent(color) {
      return new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.06 });
    }),
    glass: std(function glass(color) {
      return new THREE.MeshStandardMaterial({
        color, roughness: 0.18, metalness: 0.0, transparent: true,
        opacity: 0.45, side: THREE.DoubleSide, depthWrite: false,
      });
    }),
    rail: std(function rail(color) {
      return new THREE.MeshStandardMaterial({ color, roughness: 0.32, metalness: 0.75 });
    }),
    groove: new THREE.MeshStandardMaterial({ color: 0x2b313a, roughness: 0.88, metalness: 0.06 }),
    railWarn: new THREE.MeshStandardMaterial({
      color: 0xffc93c, roughness: 0.35, metalness: 0.4, emissive: 0x6b4c00, emissiveIntensity: 0.8 }),
    railBad: new THREE.MeshStandardMaterial({
      color: 0xff6b6b, roughness: 0.35, metalness: 0.4, emissive: 0x6b0f0f, emissiveIntensity: 1.0 }),
    handle: new THREE.MeshStandardMaterial({
      color: 0xffd25a, roughness: 0.3, metalness: 0.2, emissive: 0x6b5200, emissiveIntensity: 0.7 }),
    invisible: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    dark: new THREE.MeshStandardMaterial({ color: 0x353b43, roughness: 0.6, metalness: 0.2 }),
    steel: new THREE.MeshStandardMaterial({ color: 0xe8ecf1, roughness: 0.13, metalness: 1.0 }),
    flag: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, side: THREE.DoubleSide }),
    support: new THREE.MeshStandardMaterial({ color: 0x8e97a3, roughness: 0.7, metalness: 0.02 }),
    plate: new THREE.MeshStandardMaterial({ color: 0x2b3138, roughness: 0.9, metalness: 0.0 }),
    ghost: new THREE.MeshStandardMaterial({
      color: 0x62d0ff, roughness: 0.4, transparent: true, opacity: 0.5,
      depthWrite: false, emissive: 0x1c6a8c, emissiveIntensity: 0.6,
    }),
    ghostBad: new THREE.MeshStandardMaterial({
      color: 0xff6b6b, roughness: 0.4, transparent: true, opacity: 0.5, depthWrite: false,
    }),
  };
  return M;
}

/* ─────────────── 背景と環境マップ ─────────────── */

function gradientTexture(top, mid, bottom) {
  const c = document.createElement('canvas');
  c.width = 8; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, top);
  grad.addColorStop(0.55, mid);
  grad.addColorStop(1, bottom);
  g.fillStyle = grad;
  g.fillRect(0, 0, 8, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 疑似スタジオ照明の環境マップ（外部アセット不要） */
function buildEnvScene() {
  const s = new THREE.Scene();
  const box = new THREE.BoxGeometry(1, 1, 1);
  const room = new THREE.Mesh(
    box, new THREE.MeshStandardMaterial({ color: 0x9aa4b0, side: THREE.BackSide, roughness: 1 }));
  room.scale.set(24, 14, 24);
  room.position.y = 4;
  s.add(room);
  const lamp = (x, y, z, sx, sy, sz, intensity, color) => {
    const m = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color }));
    m.scale.set(sx, sy, sz);
    m.position.set(x, y, z);
    m.material.color.multiplyScalar(intensity);
    s.add(m);
  };
  lamp(0, 10.4, 0, 12, 0.2, 12, 3.2, 0xffffff);
  lamp(-9, 5, 3, 0.2, 6, 10, 1.6, 0xd8e8ff);
  lamp(9, 4, -4, 0.2, 6, 10, 1.1, 0xffe6cc);
  lamp(0, 3, -10, 12, 5, 0.2, 0.8, 0xcfe0ff);
  return s;
}

/* ─────────────── カメラ操作 ─────────────── */

export class OrbitCam {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this.target = new THREE.Vector3(0, 1.0, 0);
    this.radius = 18;
    this.theta = Math.PI * 0.28;   // 方位角
    this.phi = Math.PI * 0.32;     // 天頂角
    this.minRadius = 3;
    this.maxRadius = 70;
    this.enabled = true;
    this.onTap = null;             // (clientX, clientY, button) => void
    this.onHover = null;           // (clientX, clientY) => void
    // 掴めるもの（パーツ／たかさのとって）が指の下にあるか、アプリに聞く。
    // あればそのドラッグはアプリのもの、なければカメラを回す。
    this.hitTest = null;           // (x, y) => boolean
    this.onDragStart = null;       // (x, y) => void
    this.onDrag = null;            // (x, y) => void
    this.onDragEnd = null;         // (x, y, cancelled) => void
    this._pointers = new Map();
    this._mode = null;
    this._moved = 0;
    this._pinch = 0;
    this.userPanned = false;
    this._install();
    this.update();
  }

  update() {
    const { camera, target, radius } = this;
    const sp = Math.sin(this.phi), cp = Math.cos(this.phi);
    camera.position.set(
      target.x + radius * sp * Math.cos(this.theta),
      target.y + radius * cp,
      target.z + radius * sp * Math.sin(this.theta));
    camera.lookAt(target);
  }

  frame(radius, height = 1.2) {
    this.target.set(0, height, 0);
    this.radius = clamp(radius, this.minRadius, this.maxRadius);
    this.update();
  }

  _install() {
    const dom = this.dom;
    dom.style.touchAction = 'none';
    dom.addEventListener('contextmenu', (e) => e.preventDefault());

    dom.addEventListener('pointerdown', (e) => {
      dom.setPointerCapture(e.pointerId);
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, button: e.button });
      if (this._pointers.size === 1) {
        this._moved = 0;
        this._mode = (e.button === 0 && !e.shiftKey) ? 'tap' : 'pan';
        this._canGrab = this._mode === 'tap' && !!this.hitTest && this.hitTest(e.clientX, e.clientY);
      } else if (this._pointers.size === 2) {
        if (this._mode === 'grab' && this.onDragEnd) this.onDragEnd(e.clientX, e.clientY, true);
        this._mode = 'pinch';
        this._pinch = this._pinchDist();
      }
    });

    dom.addEventListener('pointermove', (e) => {
      const p = this._pointers.get(e.pointerId);
      if (!p) { if (this.onHover) this.onHover(e.clientX, e.clientY); return; }
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      this._moved += Math.abs(dx) + Math.abs(dy);
      if (!this.enabled) return;
      if (this._mode === 'pinch') {
        const d = this._pinchDist();
        if (this._pinch > 0) this.radius = clamp(this.radius * (this._pinch / d), this.minRadius, this.maxRadius);
        this._pinch = d;
        this._pan(dx * 0.5, dy * 0.5);
        this.update();
        return;
      }
      if (this._mode === 'tap' && this._moved > 7) {
        if (this._canGrab) {
          this._mode = 'grab';
          if (this.onDragStart) this.onDragStart(e.clientX, e.clientY);
        } else this._mode = 'orbit';
      }
      if (this._mode === 'grab') { if (this.onDrag) this.onDrag(e.clientX, e.clientY); return; }
      if (this._mode === 'orbit') {
        this.theta -= dx * 0.0055;
        this.phi = clamp(this.phi - dy * 0.0055, 0.06, Math.PI * 0.495);
        this.update();
      } else if (this._mode === 'pan') {
        this._pan(dx, dy);
        this.update();
      }
    });

    const up = (e) => {
      const p = this._pointers.get(e.pointerId);
      this._pointers.delete(e.pointerId);
      if (p && this._mode === 'tap' && this._moved <= 7 && this.onTap) {
        this.onTap(e.clientX, e.clientY, p.button);
      }
      if (this._mode === 'grab' && this.onDragEnd) {
        this.onDragEnd(e.clientX, e.clientY, e.type === 'pointercancel');
      }
      if (this._pointers.size === 0) this._mode = null;
      else if (this._pointers.size === 1) { this._mode = 'orbit'; }
    };
    dom.addEventListener('pointerup', up);
    dom.addEventListener('pointercancel', up);

    dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      const s = Math.exp(clamp(e.deltaY, -120, 120) * 0.0012);
      this.radius = clamp(this.radius * s, this.minRadius, this.maxRadius);
      this.update();
    }, { passive: false });
  }

  _pinchDist() {
    const [a, b] = [...this._pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  }

  _pan(dx, dy) {
    this.userPanned = true;
    const scale = this.radius * 0.0016;
    const right = new THREE.Vector3(-Math.sin(this.theta), 0, Math.cos(this.theta));
    const fwd = new THREE.Vector3(-Math.cos(this.theta), 0, -Math.sin(this.theta));
    this.target.addScaledVector(right, -dx * scale);
    this.target.addScaledVector(fwd, -dy * scale);
    this.target.x = clamp(this.target.x, -40, 40);
    this.target.z = clamp(this.target.z, -40, 40);
    this.target.y = clamp(this.target.y, -2, 20);
  }
}

/* ─────────────── キラキラ（パーティクル） ─────────────── */

function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.85)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

class Particles {
  constructor(max = 420) {
    this.max = max;
    this.head = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.base = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.full = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.geo = geo;
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.34, vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, map: dotTexture(), sizeAttenuation: true,
    }));
    this.points.frustumCulled = false;
    this.reset();
  }

  reset() {
    this.life.fill(0);
    this.pos.fill(0);
    this.col.fill(0);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }

  spawn(p, v, colorHex, life) {
    const i = this.head; this.head = (this.head + 1) % this.max;
    const o = i * 3;
    this.pos[o] = p.x; this.pos[o + 1] = p.y; this.pos[o + 2] = p.z;
    this.vel[o] = v.x; this.vel[o + 1] = v.y; this.vel[o + 2] = v.z;
    const c = _pc.setHex(colorHex);
    this.base[o] = c.r; this.base[o + 1] = c.g; this.base[o + 2] = c.b;
    this.life[i] = life; this.full[i] = life;
  }

  update(dt) {
    let any = false;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      const o = i * 3;
      const k = Math.max(0, this.life[i] / this.full[i]);
      this.vel[o + 1] -= 16 * dt;
      this.pos[o] += this.vel[o] * dt;
      this.pos[o + 1] += this.vel[o + 1] * dt;
      this.pos[o + 2] += this.vel[o + 2] * dt;
      this.col[o] = this.base[o] * k;
      this.col[o + 1] = this.base[o + 1] * k;
      this.col[o + 2] = this.base[o + 2] * k;
      if (this.life[i] <= 0) { this.col[o] = this.col[o + 1] = this.col[o + 2] = 0; }
    }
    if (any) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.color.needsUpdate = true;
    }
  }
}

const _follow = new THREE.Vector3();
const _pv = new THREE.Vector3();
const _pc = new THREE.Color();

/* ─────────────── ビュー本体 ─────────────── */

export class View {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.16;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = gradientTexture('#141a22', '#1d2732', '#38414c');
    this.scene.fog = new THREE.Fog(0x232b35, 46, 110);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 400);
    this.cam = new OrbitCam(this.camera, canvas);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = buildEnvScene();
    this.scene.environment = pmrem.fromScene(envScene, 0.04).texture;
    this.scene.environmentIntensity = 0.85;
    pmrem.dispose();

    const hemi = new THREE.HemisphereLight(0xd8e9ff, 0x2f3742, 0.72);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff3e0, 2.0);
    sun.position.set(9, 17, 7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.near = 1; sc.far = 70; sc.left = -22; sc.right = 22; sc.top = 22; sc.bottom = -22;
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun);
    this.sun = sun;
    const fill = new THREE.DirectionalLight(0x8fb4ff, 0.4);
    fill.position.set(-11, 7, -9);
    this.scene.add(fill);

    this.M = createMaterials();

    this.boardGroup = new THREE.Group();
    this.courseGroup = new THREE.Group();
    this.ballGroup = new THREE.Group();
    this.helperGroup = new THREE.Group();
    this.targetGroup = new THREE.Group();
    this.scene.add(this.boardGroup, this.courseGroup, this.ballGroup, this.helperGroup, this.targetGroup);
    this.particles = new Particles();
    this.scene.add(this.particles.points);
    this.followEnabled = true;

    this._templates = new Map();
    this._pickables = [];
    this._ray = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    this._buildHelpers();
    this.resize();
  }

  /** 端末が重いときに影などを落として軽くする */
  setQuality(q) {
    if (this.quality === q) return;
    this.quality = q;
    const low = q === 'low';
    this.renderer.shadowMap.enabled = !low;
    this.renderer.setPixelRatio(low ? 1 : Math.min(devicePixelRatio || 1, 2.5));
    this.scene.traverse((o) => { if (o.isMesh && o.material) o.material.needsUpdate = true; });
    this.resize();
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    // 縦長の画面では画角を広げて、コース全体が入りやすいようにする
    this.camera.fov = clamp(45 / Math.min(1, this.camera.aspect * 1.25), 45, 62);
    this.camera.updateProjectionMatrix();
  }

  render() { this.renderer.render(this.scene, this.camera); }

  /* ── 盤面 ── */

  buildBoard(radius) {
    const g = this.boardGroup;
    g.clear();
    const outer = radius * HEX_W + HEX_R * 0.98;
    const shape = new THREE.Shape();
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      const x = Math.cos(a) * outer, y = Math.sin(a) * outer;
      if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
    }
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.42, bevelEnabled: false });
    geo.rotateX(Math.PI / 2);
    geo.computeBoundingBox();
    geo.translate(0, -geo.boundingBox.max.y, 0);
    const plate = new THREE.Mesh(geo, this.M.plate);
    plate.receiveShadow = true;
    plate.name = 'plate';
    g.add(plate);

    // セルの目印（線）
    const pos = [];
    for (const [q, r] of hexBoard(radius)) {
      const [cx, cz] = cellCenter(q, r);
      for (let i = 0; i < 6; i++) {
        const a1 = Math.PI / 6 + (i * Math.PI) / 3;
        const a2 = Math.PI / 6 + ((i + 1) * Math.PI) / 3;
        pos.push(cx + Math.cos(a1) * HEX_R * 0.93, 0.004, cz + Math.sin(a1) * HEX_R * 0.93);
        pos.push(cx + Math.cos(a2) * HEX_R * 0.93, 0.004, cz + Math.sin(a2) * HEX_R * 0.93);
      }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({
      color: 0x5a6673, transparent: true, opacity: 0.4,
    }));
    g.add(lines);
    this._plate = plate;
    this.boardRadius = radius;
  }

  /* ── 補助表示（ホバー・ゴースト・レール下書き） ── */

  _buildHelpers() {
    const ringGeo = new THREE.BufferGeometry();
    const p = [];
    for (let i = 0; i <= 6; i++) {
      const a = Math.PI / 6 + (i * Math.PI) / 3;
      p.push(Math.cos(a) * HEX_R * 0.96, 0, Math.sin(a) * HEX_R * 0.96);
    }
    ringGeo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    this.hoverRing = new THREE.Line(ringGeo, new THREE.LineBasicMaterial({ color: 0x62d0ff }));
    this.hoverRing.visible = false;
    this.helperGroup.add(this.hoverRing);

    const fill = new THREE.Mesh(
      new THREE.ExtrudeGeometry(hexShape(HEX_R * 0.94, 0.1), { depth: 0.02, bevelEnabled: false }),
      new THREE.MeshBasicMaterial({ color: 0x62d0ff, transparent: true, opacity: 0.16, depthWrite: false }));
    fill.geometry.rotateX(Math.PI / 2);
    this.hoverFill = fill;
    this.hoverFill.visible = false;
    this.helperGroup.add(fill);

    this.selectRing = new THREE.Line(ringGeo, new THREE.LineBasicMaterial({ color: 0xffd60a, linewidth: 2 }));
    this.selectRing.visible = false;
    this.helperGroup.add(this.selectRing);

    this.ghost = new THREE.Group();
    this.ghost.visible = false;
    this.helperGroup.add(this.ghost);

    this.railPreview = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineDashedMaterial({ color: 0x62d0ff, dashSize: 0.25, gapSize: 0.15 }));
    this.railPreview.visible = false;
    this.helperGroup.add(this.railPreview);

    // 支柱の見た目（縦のガイド）
    this.pillarPreview = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 1, 6),
      new THREE.MeshBasicMaterial({ color: 0x62d0ff, transparent: true, opacity: 0.4 }));
    this.pillarPreview.visible = false;
    this.helperGroup.add(this.pillarPreview);
  }

  showHover(q, r, level) {
    const [cx, cz] = cellCenter(q, r);
    const y = level != null ? surfaceY(level) + 0.01 : 0.01;
    this.hoverRing.position.set(cx, y, cz);
    this.hoverFill.position.set(cx, y - 0.005, cz);
    this.hoverRing.visible = this.hoverFill.visible = true;
  }
  hideHover() { this.hoverRing.visible = this.hoverFill.visible = false; }

  showSelect(q, r, level) {
    const [cx, cz] = cellCenter(q, r);
    this.selectRing.position.set(cx, surfaceY(level) + 0.02, cz);
    this.selectRing.visible = true;
  }
  hideSelect() { this.selectRing.visible = false; }

  showGhost(type, cfg, rot, q, r, level, ok = true) {
    this.ghost.clear();
    const tpl = this.template(type, cfg).clone();
    tpl.traverse((o) => { if (o.isMesh) { o.material = ok ? this.M.ghost : this.M.ghostBad; o.castShadow = false; } });
    tpl.rotation.y = -rot * Math.PI / 3;
    this.ghost.add(tpl);
    const [cx, cz] = cellCenter(q, r);
    this.ghost.position.set(cx, level * H, cz);
    this.ghost.visible = true;
    if (level > 0) {
      this.pillarPreview.position.set(cx, level * H / 2, cz);
      this.pillarPreview.scale.y = level * H;
      this.pillarPreview.visible = true;
    } else this.pillarPreview.visible = false;
  }
  hideGhost() { this.ghost.visible = false; this.pillarPreview.visible = false; }

  showRailPreview(a, b, ok) {
    const g = this.railPreview.geometry;
    g.setFromPoints([a, b]);
    this.railPreview.computeLineDistances();
    this.railPreview.material.color.set(ok ? 0x62d0ff : 0xff6b6b);
    this.railPreview.visible = true;
  }
  hideRailPreview() { this.railPreview.visible = false; }

  /* ── パーツのテンプレート ── */

  template(type, cfg) {
    const k = type + '|' + cfg;
    if (!this._templates.has(k)) {
      this._templates.set(k, PARTS[type].build(cfg, this.M));
    }
    return this._templates.get(k);
  }

  /* ── コース全体の再構築 ── */

  rebuild(model) {
    const g = this.courseGroup;
    g.clear();
    this._pickables.length = 0;
    this._railPickables = [];
    this._cellNodes = new Map();
    this._railNodes = new Map();

    if (!this._postGeo) {
      // 高さ 1 の柱（下端が y=0）。インスタンスごとに y 方向へ伸ばして使う。
      this._postGeo = new THREE.CylinderGeometry(0.072, 0.072, 1, 8);
      this._postGeo.translate(0, 0.5, 0);
      this._balconyGeo = hexPrismGeo(HEX_R * 0.94, 0.09, 0.12);
    }

    // ── 支柱（PRO のピラー／バルコニーに相当） ──
    const raised = [...model.cells.values()]
      .map((c) => ({ c, base: model.supportBase(c) }))
      .filter((x) => x.c.level > x.base);
    if (raised.length) {
      const posts = new THREE.InstancedMesh(this._postGeo, this.M.support, raised.length * 3);
      const balc = new THREE.InstancedMesh(this._balconyGeo, this.M.support, raised.length);
      posts.castShadow = balc.castShadow = true;
      posts.receiveShadow = balc.receiveShadow = true;
      const m4 = new THREE.Matrix4();
      let pi = 0;
      raised.forEach((x, i) => {
        const [cx, cz] = cellCenter(x.c.q, x.c.r);
        const y0 = x.base * H;
        const h = x.c.level * H - y0;
        for (let k = 0; k < 3; k++) {
          const a = Math.PI / 6 + (k * 2 * Math.PI) / 3;
          m4.makeScale(1, h, 1);
          m4.setPosition(cx + Math.cos(a) * 0.63, y0, cz + Math.sin(a) * 0.63);
          posts.setMatrixAt(pi++, m4);
        }
        m4.makeTranslation(cx, x.c.level * H - 0.09, cz);
        balc.setMatrixAt(i, m4);
      });
      posts.instanceMatrix.needsUpdate = true;
      balc.instanceMatrix.needsUpdate = true;
      g.add(posts, balc);
    }

    // ── パーツ ──
    for (const c of model.cells.values()) {
      const node = this.template(c.type, c.cfg).clone();
      node.rotation.y = (-c.rot * Math.PI) / 3;
      const [cx, cz] = cellCenter(c.q, c.r);
      node.position.set(cx, c.level * H, cz);
      node.userData.cell = c;
      node.traverse((o) => { if (o.isMesh) { o.userData.cell = c; this._pickables.push(o); } });
      g.add(node);
      this._cellNodes.set(c, node);
      if (c.locked) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(HEX_R * 0.99, 0.028, 6, 6),
          new THREE.MeshBasicMaterial({ color: 0xffd60a, transparent: true, opacity: 0.75 }));
        ring.rotation.set(Math.PI / 2, 0, Math.PI / 6);
        ring.position.set(cx, c.level * H + 0.03, cz);
        g.add(ring);
      }
    }

    // ── レール（坂ぐあいで色を変える） ──
    const grades = model.gradeMap();
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    for (const l of model.rails) {
      if (!l.a || !l.b) continue;
      portPos(l.a.q, l.a.r, l.a.level, l.d1, a);
      portPos(l.b.q, l.b.r, l.b.level, l.d2, b);
      const node = this.railNode(a, b, grades.get(l));
      node.userData.rail = l;
      // レールは「けす」ときだけ当たり判定に入れる。
      // ふだんも入れてしまうと、パーツの手前に重なって掴めなくなる。
      node.traverse((o) => { if (o.isMesh) { o.userData.rail = l; this._railPickables.push(o); } });
      g.add(node);
      this._railNodes.set(l, node);
    }
  }

  /** 坂の良し悪しに応じたレールのマテリアル。ふつうは金属色のまま。 */
  railMaterial(grade) {
    if (grade === 'up' || grade === 'flat') return this.M.railBad;
    if (grade === 'gentle' || grade === 'steep') return this.M.railWarn;
    return this.M.rail(0x99a3ae);
  }

  /** 動かしている最中のパーツを一時的に消す */
  setCellVisible(cell, on) {
    const node = this._cellNodes && this._cellNodes.get(cell);
    if (node) node.visible = on;
  }

  /** 2 点を結ぶレールのメッシュ（形状はスケールで使い回す） */
  railNode(p0, p1, grade) {
    if (!this._railTpl) {
      const rod = new THREE.CylinderGeometry(ROD_R, ROD_R, 1, 10);
      rod.rotateZ(-Math.PI / 2);
      const holder = new THREE.Group();
      for (const s of [1, -1]) {
        const m = new THREE.Mesh(rod, this.M.rail(0x99a3ae));
        m.position.set(0, -ROD_DROP, s * ROD_SEP);
        m.castShadow = true;
        m.userData.rod = true;
        holder.add(m);
      }
      const capGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.11, 10);
      this._railTpl = { holder, capGeo };
    }
    const grp = new THREE.Group();
    const holder = this._railTpl.holder.clone();
    const mat = this.railMaterial(grade);
    holder.traverse((o) => { if (o.isMesh && o.userData.rod) o.material = mat; });
    const len = p0.distanceTo(p1);
    holder.scale.x = len;
    grp.add(holder);
    for (const s of [-0.5, 0.5]) {
      const cap = new THREE.Mesh(this._railTpl.capGeo, this.M.dark);
      cap.position.set(s * len, -ROD_DROP, 0);
      grp.add(cap);
    }
    const x = new THREE.Vector3().subVectors(p1, p0).normalize();
    const z = new THREE.Vector3().crossVectors(x, new THREE.Vector3(0, 1, 0)).normalize();
    const y = new THREE.Vector3().crossVectors(z, x).normalize();
    const m4 = new THREE.Matrix4().makeBasis(x, y, z);
    m4.setPosition(new THREE.Vector3().addVectors(p0, p1).multiplyScalar(0.5));
    grp.applyMatrix4(m4);
    return grp;
  }

  /* ── ピッキング ── */

  setNdc(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    this._ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1);
    this._ray.setFromCamera(this._ndc, this.camera);
  }

  /**
   * 画面座標から、盤面のセルと当たったオブジェクトを求める。
   * @returns {{cell:?object, rail:?object, q:number, r:number, point:THREE.Vector3}|null}
   */
  /**
   * 画面の座標から、そこにあるものを調べる。
   * @param {boolean} withRails レールも対象にするか（「けす」ときだけ true）
   */
  pick(clientX, clientY, withRails = false) {
    this.setNdc(clientX, clientY);
    let list = this._pickables;
    if (withRails && this._railPickables) list = [...list, ...this._railPickables];
    if (this._handle && this._handle.visible && this._handleHit) list = [this._handleHit, ...list];
    const hits = this._ray.intersectObjects(list, false);
    const camPos = this.camera.position;
    let best = null, bestDist = Infinity;
    if (hits.length) {
      const h = hits[0];
      if (h.object.userData.handle) return { handle: true, q: 0, r: 0, point: h.point };
      best = { cell: h.object.userData.cell || null, rail: h.object.userData.rail || null, point: h.point };
      bestDist = h.point.distanceTo(camPos);
    }
    const p = new THREE.Vector3();
    const onPlate = this._ray.ray.intersectPlane(this._plane, p) ? p.distanceTo(camPos) : Infinity;
    if (onPlate < bestDist) {
      const [q, r] = worldToCell(p.x, p.z);
      return { cell: null, rail: null, q, r, point: p.clone(), onPlate: true };
    }
    if (best) {
      if (best.cell) return { ...best, q: best.cell.q, r: best.cell.r };
      if (best.rail) return { ...best, q: best.rail.q1, r: best.rail.r1 };
    }
    return null;
  }

  /* ── たかさの とって（3D の中で直接つまむ） ── */

  showHandle(cell) {
    if (!this._handle) {
      const g = new THREE.Group();
      // パーツ本体を掴む操作と ぶつからないよう、じゅうぶん上に離して立てる。
      // 下は細いガイド、上が つまむところ。
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.5, 8), this.M.handle);
      stem.position.y = 0.85;
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 1.15, 10), this.M.handle);
      rod.position.y = 2.15;
      const grip = new THREE.Mesh(new THREE.SphereGeometry(0.46, 20, 14), this.M.handle);
      grip.position.y = 2.15;
      const up = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.42, 12), this.M.handle);
      up.position.y = 2.94;
      const dn = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.42, 12), this.M.handle);
      dn.position.y = 1.36;
      dn.rotation.z = Math.PI;
      // 指で掴みやすいように、見えない当たり判定（パーツより ずっと上だけ）
      const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 2.3, 8), this.M.invisible);
      hit.position.y = 2.2;
      hit.userData.handle = true;
      this._handleHit = hit;
      g.add(stem, rod, grip, up, dn, hit);
      this._handle = g;
      this.helperGroup.add(g);
    }
    const [cx, cz] = cellCenter(cell.q, cell.r);
    this._handle.position.set(cx, surfaceY(cell.level) + 0.1, cz);
    this._handle.visible = true;
  }

  hideHandle() { if (this._handle) this._handle.visible = false; }

  /** 指の下に とって があるか（パーツより手前にあるときだけ） */
  hitHandle(x, y) {
    const hit = this.pick(x, y);
    return !!(hit && hit.handle);
  }

  /* ── つなげる あいて を光らせる ── */

  showTargets(cells) {
    this.clearTargets();
    if (!this._targetGeo) {
      this._targetGeo = new THREE.TorusGeometry(HEX_R * 0.86, 0.10, 10, 28);
      this._targetGeo.rotateX(Math.PI / 2);
      this._targetMat = new THREE.MeshBasicMaterial({ color: 0xffd25a, transparent: true, opacity: 0.95 });
      this._arrowGeo = new THREE.ConeGeometry(0.34, 0.62, 12);
      this._arrowGeo.rotateX(Math.PI);
    }
    for (const c of cells) {
      const [cx, cz] = cellCenter(c.q, c.r);
      const y = surfaceY(c.level);
      const ring = new THREE.Mesh(this._targetGeo, this._targetMat);
      ring.position.set(cx, y + 0.08, cz);
      const arrow = new THREE.Mesh(this._arrowGeo, this._targetMat);
      arrow.position.set(cx, y + 1.15, cz);
      this.targetGroup.add(ring, arrow);
    }
    this._targetT = 0;
  }

  clearTargets() { this.targetGroup.clear(); }

  /** 画面 1px が、注視点のあたりでワールド何単位にあたるか */
  perPixel() {
    const h = this.canvas.clientHeight || window.innerHeight;
    const vFov = (this.camera.fov * Math.PI) / 180;
    return (2 * this.cam.radius * Math.tan(vFov / 2)) / h;
  }

  /** 画面の縦移動量 → たかさ（レベル）の変化量 */
  pxToLevels(dyPx) {
    return (-dyPx * this.perPixel()) / Math.max(0.35, Math.sin(this.cam.phi)) / H;
  }

  /* ── 画面のうち UI に隠れていない範囲 ── */

  /**
   * 下のドックと上のバーで隠れるぶんを測り、
   *  visFrac : 見えている高さの割合
   *  shiftY  : コースを見える範囲の中央に寄せるための注視点の上下ずらし量（ワールド単位）
   * を返す。これをしないと、スマホではコースの下半分がドックの裏に隠れてしまう。
   */
  viewport() {
    const h = this.canvas.clientHeight || window.innerHeight;
    const dock = document.getElementById('dock');
    const hdr = document.getElementById('hdr');
    const quest = document.getElementById('quest');
    const top = (hdr ? hdr.offsetHeight : 56) + (quest && quest.classList.contains('show') ? quest.offsetHeight + 8 : 0) + 8;
    const bottom = h - (dock ? dock.offsetHeight : 0) - 46;   // ヒント表示のぶんも空ける
    const visFrac = Math.max(0.32, (bottom - top) / h);
    const shiftPx = (top + bottom) / 2 - h / 2;
    const vFov = (this.camera.fov * Math.PI) / 180;
    const perPx = (2 * this.cam.radius * Math.tan(vFov / 2)) / h;
    const shiftY = (shiftPx * perPx) / Math.max(0.35, Math.sin(this.cam.phi));
    return { visFrac, shiftY, top, bottom };
  }

  /* ── ボールを おいかける ── */

  followBall(p, dt) {
    if (!this.followEnabled || this.cam.userPanned) return;
    const k = 1 - Math.exp(-3.2 * dt);
    _follow.set(p.x, p.y + 0.5 + this.viewport().shiftY, p.z);
    this.cam.target.lerp(_follow, k);
    this.cam.update();
  }

  /* ── キラキラ（ゴールの お祝いと ボールの あと） ── */

  burstAt(pos, color = 0xffd25a) {
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2 + Math.random();
      const up = 6 + Math.random() * 9;
      const r = 3 + Math.random() * 6;
      this.particles.spawn(pos,
        _pv.set(Math.cos(a) * r, up, Math.sin(a) * r),
        color, 0.75 + Math.random() * 0.5);
    }
  }

  sparkle(pos, color = 0xbfe6ff) {
    this.particles.spawn(pos, _pv.set(0, 0.4, 0), color, 0.28);
  }

  clearBurst() { this.particles.reset(); }

  /** 毎フレーム呼ぶ（アニメーション） */
  update(dt) {
    this.particles.update(dt);
    if (this.targetGroup.children.length) {
      this._targetT = (this._targetT || 0) + dt;
      const s = 1 + Math.sin(this._targetT * 5) * 0.12;
      const dy = Math.sin(this._targetT * 5) * 0.12;
      for (let i = 0; i < this.targetGroup.children.length; i++) {
        const o = this.targetGroup.children[i];
        if (i % 2 === 0) o.scale.setScalar(s);
        else o.position.y += (dy - (o.userData.dy || 0));
        if (i % 2 === 1) o.userData.dy = dy;
      }
    }
  }

  /* ── ボール ── */

  makeBall(color = 0xe8ecf1) {
    if (!this._ballGeo) this._ballGeo = new THREE.SphereGeometry(BALL_R, 28, 20);
    if (!this._ballMats) this._ballMats = new Map();
    if (!this._ballMats.has(color)) {
      this._ballMats.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.12, metalness: 1.0 }));
    }
    const m = new THREE.Mesh(this._ballGeo, this._ballMats.get(color));
    m.castShadow = true;
    this.ballGroup.add(m);
    return m;
  }
  clearBalls() { this.ballGroup.clear(); }
}
