/**
 * parts.js — GraviTrax PRO スターターセット相当のパーツ定義
 *
 * 各パーツは「ローカル空間」で定義する。
 *   原点 = セル中心、y=0 = タイル底面、回転なし（rot=0）の状態。
 * localPaths(cfg) がボール中心の通り道（端点情報つき）を返し、
 * これを描画（溝・ガイド）と物理（セグメント）の両方で使う。
 */
import * as THREE from 'three';
import { HEX_R, PORT_D, DIR_VEC, TILE_T, BALL_RIDE, wrapDir } from './core.js';
import { hexPrismGeo, hexRingPrismGeo, railPairGeo, ribbonGeo, latheGeo } from './geo.js';

/** ローカル空間でのボール中心の高さ */
export const PY = TILE_T + BALL_RIDE;

/* ─────────────── 端点の種類 ─────────────── */
export const End = {
  port: (d) => ({ t: 'port', d }),
  open: () => ({ t: 'open' }),      // 何も繋がっていない → 自由落下へ
  sink: () => ({ t: 'sink' }),      // ゴール（吸収）
  catch: () => ({ t: 'catch' }),    // 上から落ちてきたボールの受け口
  source: () => ({ t: 'source' }),  // スターターの出発点
};

/* ─────────────── 経路生成 ─────────────── */

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** ポート d のローカル位置（ボール中心の高さ） */
export function portLocal(d, y = PY) {
  const [ux, uz] = DIR_VEC[wrapDir(d)];
  return V(ux * PORT_D, y, uz * PORT_D);
}

/**
 * ポート dA → dB を結ぶ溝の点列。
 * 端点での接線がポート方向と一致する 3 次ベジェをサンプリングする。
 */
export function channelPoints(dA, dB, y = PY, samples = 22) {
  const [ax, az] = DIR_VEC[wrapDir(dA)];
  const [bx, bz] = DIR_VEC[wrapDir(dB)];
  const p0 = V(ax * PORT_D, y, az * PORT_D);
  const p3 = V(bx * PORT_D, y, bz * PORT_D);
  const chord = p0.distanceTo(p3);
  const m = Math.max(0.30, chord * 0.42);
  const c0 = V(p0.x - ax * m, y, p0.z - az * m);
  const c1 = V(p3.x - bx * m, y, p3.z - bz * m);
  const out = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples, u = 1 - t;
    const w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
    out.push(V(
      w0 * p0.x + w1 * c0.x + w2 * c1.x + w3 * p3.x,
      y,
      w0 * p0.z + w1 * c0.z + w2 * c1.z + w3 * p3.z,
    ));
  }
  return out;
}

/** ボルテックスの渦巻き経路 */
function vortexPoints(dIn) {
  const pts = [portLocal(dIn)];
  const a0 = (Math.PI / 3) * wrapDir(dIn);
  const turns = 2.15, steps = 52, yEnd = 0.22;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = a0 + turns * Math.PI * 2 * t;
    const rad = 0.80 + (0.15 - 0.80) * t;
    const y = PY + (yEnd - PY) * Math.pow(t, 1.35);
    pts.push(V(Math.cos(a) * rad, y, Math.sin(a) * rad));
  }
  // 最後は真下を向かせて自由落下へ渡す
  const last = pts[pts.length - 1];
  for (let i = 1; i <= 3; i++) pts.push(V(last.x, last.y - 0.06 * i, last.z));
  return pts;
}

/** フリーフォール：ポートから中央へ来て真下に抜ける */
function freeFallPoints(dIn) {
  const p = portLocal(dIn);
  return [
    p,
    V(p.x * 0.45, PY - 0.03, p.z * 0.45),
    V(p.x * 0.12, PY - 0.16, p.z * 0.12),
    V(0, PY - 0.42, 0),
    V(0, PY - 0.70, 0),
    V(0, 0.05, 0),
  ];
}

/* ─────────────── メッシュ用のマテリアル取得 ─────────────── */
// M は view.js が用意する { tile(color), dark, rod, metal, accent(color), glass, flag }

/** 溝（ガイドウォール＋底の帯）を group に追加 */
function addChannel(group, pts, M, color) {
  const wallColor = new THREE.Color(color).multiplyScalar(0.66).getHex();
  const walls = railPairGeo(pts, 0.075, 0.30, -(BALL_RIDE - 0.03));
  const wm = new THREE.Mesh(walls, M.tile(wallColor));
  wm.castShadow = true;
  group.add(wm);
  const floor = ribbonGeo(pts, 0.30, -(BALL_RIDE - 0.008));
  const m = new THREE.Mesh(floor, M.groove);
  m.renderOrder = 1;
  group.add(m);
}

/* ─────────────── パーツ定義 ─────────────── */

const CURVE_K = [3, 2, 4, 1, 5];
const GREY = 0xc3cad3;

/** 共通のタイル土台 */
function tileBase(group, M, color, h = TILE_T) {
  const mesh = new THREE.Mesh(hexPrismGeo(HEX_R, h), M.tile(color));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

export const PARTS = {
  /* ── カーブ（ストレート含む） ───────────────────────── */
  curve: {
    id: 'curve', name: 'カーブ', color: GREY, cat: 'track',
    short: 'カーブ',
    stock: 28,
    desc: 'コースの基本パーツ。回転と形状を変えて 5 種類の曲がり方に使える。',
    variants: ['ストレート', 'ゆるいカーブ（左）', 'ゆるいカーブ（右）', '急カーブ（左）', '急カーブ（右）'],
    localPaths(cfg) {
      const k = CURVE_K[cfg] ?? 3;
      return [{ ends: [End.port(0), End.port(k)], pts: channelPoints(0, k) }];
    },
    build(cfg, M) {
      const g = new THREE.Group();
      tileBase(g, M, this.color);
      for (const p of this.localPaths(cfg)) addChannel(g, p.pts, M, this.color);
      return g;
    },
  },

  /* ── クロス ─────────────────────────────────────── */
  cross: {
    id: 'cross', name: 'クロス', color: 0x99a3ae, cat: 'track',
    short: 'クロス',
    stock: 4,
    desc: '2 本のコースを交差させる。ボールはそれぞれまっすぐ通り抜ける。',
    variants: ['交差'],
    localPaths() {
      return [
        { ends: [End.port(0), End.port(3)], pts: channelPoints(0, 3) },
        { ends: [End.port(1), End.port(4)], pts: channelPoints(1, 4) },
      ];
    },
    build(cfg, M) {
      const g = new THREE.Group();
      tileBase(g, M, this.color);
      for (const p of this.localPaths(cfg)) addChannel(g, p.pts, M, this.color);
      return g;
    },
  },

  /* ── 振り分け（Yポイント／スイッチ） ───────────────── */
  splitter: {
    id: 'splitter', name: '振り分け', color: 0x2f86e8, cat: 'track',
    short: '振り分け',
    stock: 4,
    desc: 'ボールが来るたびに左右の出口へ交互に振り分ける。',
    variants: ['交互に振り分け'],
    alternates: true,
    localPaths() {
      return [
        { ends: [End.port(0), End.port(2)], pts: channelPoints(0, 2) },
        { ends: [End.port(0), End.port(4)], pts: channelPoints(0, 4) },
      ];
    },
    build(cfg, M) {
      const g = new THREE.Group();
      tileBase(g, M, this.color);
      for (const p of this.localPaths(cfg)) addChannel(g, p.pts, M, this.color);
      // 振り分けレバー
      const lever = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, 0.28, 8),
        M.accent(0xffd60a));
      lever.position.set(-0.10, TILE_T + 0.14, 0);
      lever.rotation.z = 0.35;
      g.add(lever);
      return g;
    },
  },

  /* ── ボルテックス ───────────────────────────────── */
  vortex: {
    id: 'vortex', name: 'ボルテックス', color: 0x9b5de5, cat: 'special',
    short: 'ボルテックス',
    walled: true, hole: 0.52,
    stock: 1,
    desc: 'すり鉢の中をぐるぐる回りながら降り、真下へ落ちていく。下でキャッチャーなどが必要。',
    variants: ['渦'],
    localPaths() {
      return [{ ends: [End.port(0), End.open()], pts: vortexPoints(0), raw: true }];
    },
    build(cfg, M) {
      const g = new THREE.Group();
      const ring = new THREE.Mesh(hexRingPrismGeo(HEX_R, TILE_T, 0.50), M.tile(this.color));
      ring.castShadow = true; ring.receiveShadow = true;
      g.add(ring);
      // すり鉢
      const funnel = latheGeo([
        [0.46, 0.02], [0.50, 0.22], [0.60, 0.52], [0.74, 0.88],
        [0.90, 1.26], [0.99, 1.34], [0.99, 1.42], [0.88, 1.36],
        [0.70, 0.94], [0.56, 0.56], [0.48, 0.24], [0.51, 0.02],
      ], 34);
      const fm = new THREE.Mesh(funnel, M.glass(this.color));
      fm.castShadow = true;
      g.add(fm);
      // 入口のガイド
      const pin = portLocal(0);
      addChannel(g, [pin, V(pin.x * 0.92, PY, pin.z * 0.92)], M, this.color);
      return g;
    },
  },

  /* ── マグネティックキャノン ─────────────────────── */
  cannon: {
    id: 'cannon', name: 'マグネティックキャノン', color: 0xe5384f, cat: 'special',
    short: 'キャノン',
    walled: true,
    stock: 1, usesBalls: 2,
    desc: '飛び込んできたボールが磁石にくっつき、反対側のボールを勢いよく撃ち出す。',
    variants: ['砲身'],
    entryPort: 0, exitPort: 3,
    localPaths() {
      return [{ ends: [End.port(0), End.port(3)], pts: channelPoints(0, 3) }];
    },
    build(cfg, M) {
      const g = new THREE.Group();
      tileBase(g, M, 0x3a3f47);
      for (const p of this.localPaths(cfg)) addChannel(g, p.pts, M, 0x3a3f47);
      // 磁石ブロック（装填された球はシミュレータ側が実体として描く）
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.36, 0.70), M.accent(this.color));
      mag.position.set(0.30, TILE_T + 0.15, 0);
      mag.castShadow = true;
      g.add(mag);
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.38, 0.74), M.dark);
      band.position.set(0.30, TILE_T + 0.15, 0);
      g.add(band);
      return g;
    },
  },

  /* ── スターター ─────────────────────────────────── */
  starter: {
    id: 'starter', name: 'スターター', color: 0x2fb457, cat: 'special',
    short: 'スターター',
    walled: true,
    stock: 1,
    desc: 'ボールをセットしてスタート。出口は 1〜3 方向に切り替えられる。',
    variants: ['出口 1 方向', '出口 2 方向', '出口 3 方向'],
    exitsFor(cfg) { return [[0], [0, 3], [0, 2, 4]][cfg] || [0]; },
    localPaths(cfg) {
      const c = V(0, PY + 0.11, 0);
      return this.exitsFor(cfg).map((d) => ({
        ends: [End.source(), End.port(d)],
        pts: [c, V(portLocal(d).x * 0.4, PY + 0.06, portLocal(d).z * 0.4), portLocal(d)],
      }));
    },
    build(cfg, M) {
      const g = new THREE.Group();
      tileBase(g, M, this.color);
      for (const p of this.localPaths(cfg)) addChannel(g, p.pts, M, this.color);
      const dome = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.34, 0.14, 16), M.accent(0x1c8a3f));
      dome.position.set(0, TILE_T + 0.07, 0);
      dome.castShadow = true;
      g.add(dome);
      return g;
    },
  },

  /* ── ゴール ─────────────────────────────────────── */
  goal: {
    id: 'goal', name: 'ゴール', color: 0xf0821e, cat: 'special',
    short: 'ゴール',
    walled: true,
    stock: 1,
    desc: 'ボールのゴール。上から落ちてきたボールも受け止める。',
    variants: ['ゴール'],
    catchZone: { r: 0.66, y: TILE_T + 0.44 },
    localPaths() {
      const p = portLocal(0);
      return [{ ends: [End.port(0), End.sink()], pts: [p, V(p.x * 0.4, PY - 0.05, p.z * 0.4), V(0, PY - 0.14, 0)] }];
    },
    build(cfg, M) {
      const g = new THREE.Group();
      tileBase(g, M, this.color);
      for (const p of this.localPaths(cfg)) addChannel(g, p.pts, M, this.color);
      const bowl = new THREE.Mesh(latheGeo([
        [0.12, 0.0], [0.46, 0.05], [0.64, 0.22], [0.68, 0.34],
        [0.74, 0.34], [0.70, 0.19], [0.52, 0.01], [0.12, -0.05],
      ], 28), M.accent(0xc4650f));
      bowl.position.y = TILE_T;
      bowl.castShadow = true;
      g.add(bowl);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.9, 8), M.dark);
      pole.position.set(-0.55, TILE_T + 0.45, 0.30);
      g.add(pole);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.26), M.flag);
      flag.position.set(-0.34, TILE_T + 0.78, 0.30);
      g.add(flag);
      return g;
    },
  },

  /* ── キャッチャー ───────────────────────────────── */
  catcher: {
    id: 'catcher', name: 'キャッチャー', color: 0xf2c531, cat: 'special',
    short: 'キャッチャー',
    walled: true,
    stock: 2,
    desc: '空中を落ちてきたボールを受け止めて、コースに戻す。',
    variants: ['受け皿'],
    catchZone: { r: 0.72, y: TILE_T + 0.62 },
    localPaths() {
      const p = portLocal(0);
      return [{ ends: [End.catch(), End.port(0)], pts: [V(0, PY, 0), V(p.x * 0.45, PY, p.z * 0.45), p] }];
    },
    build(cfg, M) {
      const g = new THREE.Group();
      tileBase(g, M, this.color);
      for (const p of this.localPaths(cfg)) addChannel(g, p.pts, M, this.color);
      const bowl = new THREE.Mesh(latheGeo([
        [0.20, 0.0], [0.46, 0.18], [0.68, 0.50], [0.78, 0.70],
        [0.84, 0.70], [0.74, 0.46], [0.52, 0.14], [0.20, -0.04],
      ], 28), M.glass(0xf2c531));
      bowl.position.y = TILE_T;
      bowl.castShadow = true;
      g.add(bowl);
      return g;
    },
  },

  /* ── フリーフォール ─────────────────────────────── */
  freefall: {
    id: 'freefall', name: 'フリーフォール', color: 0xe0503a, cat: 'special',
    short: '落とし穴',
    walled: true, hole: 0.38,
    stock: 1,
    desc: 'コースに開いた落とし穴。ボールはここから真下へ落ちる。',
    variants: ['落とし穴'],
    localPaths() {
      return [{ ends: [End.port(0), End.open()], pts: freeFallPoints(0) }];
    },
    build(cfg, M) {
      const g = new THREE.Group();
      const ring = new THREE.Mesh(hexRingPrismGeo(HEX_R, TILE_T, 0.36), M.tile(this.color));
      ring.castShadow = true; ring.receiveShadow = true;
      g.add(ring);
      const lip = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.05, 8, 24), M.accent(0xa93526));
      lip.rotation.x = Math.PI / 2;
      lip.position.y = TILE_T;
      g.add(lip);
      addChannel(g, [portLocal(0), V(portLocal(0).x * 0.62, PY, portLocal(0).z * 0.62)], M, this.color);
      return g;
    },
  },
};

/** パレットの並び順 */
export const PART_ORDER = ['curve', 'cross', 'splitter', 'starter', 'goal', 'catcher', 'freefall', 'vortex', 'cannon'];

/* ─────────────── レール ─────────────── */

export const RAILS = {
  railS: { id: 'railS', name: '短いレール', span: 2, stock: 9, color: 0x8d98a5 },
  railM: { id: 'railM', name: '中くらいのレール', span: 3, stock: 6, color: 0x8d98a5 },
  railL: { id: 'railL', name: '長いレール', span: 4, stock: 3, color: 0x8d98a5 },
};
export const RAIL_ORDER = ['railS', 'railM', 'railL'];
export const RAIL_BY_SPAN = { 2: 'railS', 3: 'railM', 4: 'railL' };

/* ─────────────── セットの内容（PRO スターターセット準拠） ─────────────── */

export const SET_INVENTORY = {
  curve: 28, cross: 4, splitter: 4, vortex: 1, cannon: 1,
  starter: 1, goal: 1, catcher: 2, freefall: 1,
  railS: 9, railM: 6, railL: 3,
  balls: 6,
  /** 高さユニット（大タイル・小タイル・支柱・バルコニーを H 単位で合算した目安） */
  height: 220,
};

export function partDef(id) { return PARTS[id] || null; }
export function isRail(id) { return !!RAILS[id]; }
