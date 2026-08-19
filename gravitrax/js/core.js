/**
 * core.js — 幾何・数学の基盤
 * ヘックスグリッド座標系、寸法定数、経路(Path3)、雑多なユーティリティ。
 *
 * 座標系: three.js のワールド座標。Y が上方向。
 * ヘックスは「尖った頂点が上下(pointy-top)」で、6 つのポート(辺の中点)が
 * それぞれ +X 軸から 60°刻みの方向を向く。
 */
import * as THREE from 'three';

/* ─────────────── 寸法（1 unit ≒ 実物 1.67cm） ─────────────── */

export const HEX_R = 1.0;                 // 外接円半径（中心→頂点）
export const HEX_W = Math.sqrt(3) * HEX_R; // 対辺距離＝隣接セル中心間距離
export const PORT_D = HEX_W / 2;          // 中心→辺の中点

export const H = 0.30;                    // 高さの最小単位（小さい垂直タイル）
export const TILE_T = 2 * H;              // トラックタイル／大きい垂直タイルの厚み

export const BALL_R = 0.35;               // ボール半径（実物 φ12mm 相当）
export const ROD_R = 0.055;               // レール棒の半径
export const ROD_SEP = 0.235;             // レール棒の中心間距離の半分
// ボール中心が棒の中心平面からどれだけ上に載るか
export const ROD_DROP = Math.sqrt((BALL_R + ROD_R) ** 2 - ROD_SEP ** 2);
export const BALL_RIDE = 0.02 + ROD_DROP; // タイル上面からボール中心までの高さ

export const G = 588;                     // 重力 (units/s²)。1m = 60units として 9.8m/s²
export const ROLL_FACTOR = 5 / 7;         // 転がる剛体球の並進加速度係数

export const MAX_LEVEL = 40;              // セルの最大高さ（H 単位）

/* ─────────────── ヘックス座標 ─────────────── */

/** 方向 d(0-5) → 軸座標の差分。角度は +X から +Z 回りに 60°×d。 */
export const DIRS = [
  [1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1],
];

/** 方向 d のワールド単位ベクトル (x,z) */
export const DIR_VEC = DIRS.map((_, d) => {
  const a = (Math.PI / 3) * d;
  return [Math.cos(a), Math.sin(a)];
});

export const opposite = (d) => (d + 3) % 6;
export const wrapDir = (d) => ((d % 6) + 6) % 6;
export const key = (q, r) => q + ',' + r;
export const parseKey = (k) => k.split(',').map(Number);

export function neighbor(q, r, d) {
  const [dq, dr] = DIRS[d];
  return [q + dq, r + dr];
}

/** 軸座標の距離（何セル分離れているか） */
export function hexDistance(q1, r1, q2, r2) {
  const dq = q1 - q2, dr = r1 - r2;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** (q1,r1) から見て (q2,r2) が直線方向 d 上にあるなら {dir, span} を返す */
export function lineBetween(q1, r1, q2, r2) {
  const dq = q2 - q1, dr = r2 - r1;
  for (let d = 0; d < 6; d++) {
    const [ux, uy] = DIRS[d];
    if (ux === 0) {
      if (dq === 0 && dr !== 0 && Math.sign(dr) === Math.sign(uy)) {
        return { dir: d, span: Math.abs(dr) };
      }
    } else if (uy === 0) {
      if (dr === 0 && dq !== 0 && Math.sign(dq) === Math.sign(ux)) {
        return { dir: d, span: Math.abs(dq) };
      }
    } else if (dq !== 0 && dr !== 0 && dq % ux === 0 && dq / ux === dr / uy && dq / ux > 0) {
      return { dir: d, span: dq / ux };
    }
  }
  return null;
}

/** セル中心のワールド座標 (x,z) */
export function cellCenter(q, r) {
  return [HEX_W * (q + r / 2), 1.5 * HEX_R * r];
}

/** ワールド座標 (x,z) → 最も近いセルの軸座標 */
export function worldToCell(x, z) {
  const r = (2 / 3) * z / HEX_R;
  const q = x / HEX_W - r / 2;
  return roundAxial(q, r);
}

export function roundAxial(q, r) {
  const s = -q - r;
  let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return [rq, rr];
}

/** 半径 rad のヘックス盤面のセル一覧 */
export function hexBoard(rad) {
  const out = [];
  for (let q = -rad; q <= rad; q++) {
    const lo = Math.max(-rad, -q - rad), hi = Math.min(rad, -q + rad);
    for (let r = lo; r <= hi; r++) out.push([q, r]);
  }
  return out;
}

/** パーツ上面（タイルの天面）の Y 座標 */
export const surfaceY = (level) => (level + 2) * H;
/** ボール中心が通る高さ */
export const pathY = (level) => surfaceY(level) + BALL_RIDE;

/** セル(q,r) の方向 d のポート位置（ボール中心の高さ） */
export function portPos(q, r, level, d, out = new THREE.Vector3()) {
  const [cx, cz] = cellCenter(q, r);
  const [ux, uz] = DIR_VEC[d];
  return out.set(cx + ux * PORT_D, pathY(level), cz + uz * PORT_D);
}

/* ─────────────── 経路 ─────────────── */

/**
 * 弧長でパラメータ化された 3D 経路。ボール中心の軌跡を表す。
 * posAt / tanAt / curvAt はすべて弧長 s（0〜length）で参照する。
 */
export class Path3 {
  /**
   * @param {THREE.Vector3[]} pts 制御点（2 点なら直線）
   * @param {number} divisions サンプル分割数（負値ならリサンプルせず点列をそのまま使う）
   */
  constructor(pts, divisions = 0) {
    let samples;
    if (pts.length === 2 || divisions < 0) {
      samples = pts.map((p) => p.clone());
    } else {
      const curve = new THREE.CatmullRomCurve3(pts.map((p) => p.clone()), false, 'catmullrom', 0.5);
      const n = divisions || Math.max(24, pts.length * 10);
      samples = curve.getPoints(n);
    }
    this.pts = samples;
    const n = samples.length;
    this.cum = new Float64Array(n);
    for (let i = 1; i < n; i++) {
      this.cum[i] = this.cum[i - 1] + samples[i].distanceTo(samples[i - 1]);
    }
    this.length = this.cum[n - 1];

    // 接線（前後差分）
    this.tan = samples.map((_, i) => {
      const a = samples[Math.max(0, i - 1)], b = samples[Math.min(n - 1, i + 1)];
      return new THREE.Vector3().subVectors(b, a).normalize();
    });
    // 曲率（メンガー曲率）
    this.curv = new Float64Array(n);
    for (let i = 1; i < n - 1; i++) {
      const a = samples[i - 1], b = samples[i], c = samples[i + 1];
      const ab = a.distanceTo(b), bc = b.distanceTo(c), ca = c.distanceTo(a);
      if (ab < 1e-6 || bc < 1e-6 || ca < 1e-6) continue;
      const area = new THREE.Vector3().subVectors(b, a)
        .cross(new THREE.Vector3().subVectors(c, a)).length() / 2;
      this.curv[i] = (4 * area) / (ab * bc * ca);
    }
    this.curv[0] = this.curv[1] || 0;
    this.curv[n - 1] = this.curv[n - 2] || 0;
  }

  /** 弧長 s → サンプル添字と補間係数 */
  _locate(s) {
    const cum = this.cum, n = cum.length;
    if (s <= 0) return [0, 0];
    if (s >= this.length) return [n - 2, 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= s) lo = mid; else hi = mid;
    }
    const seg = cum[lo + 1] - cum[lo];
    return [lo, seg > 1e-9 ? (s - cum[lo]) / seg : 0];
  }

  posAt(s, out = new THREE.Vector3()) {
    const [i, t] = this._locate(s);
    return out.copy(this.pts[i]).lerp(this.pts[i + 1], t);
  }

  tanAt(s, out = new THREE.Vector3()) {
    const [i, t] = this._locate(s);
    return out.copy(this.tan[i]).lerp(this.tan[i + 1], t).normalize();
  }

  curvAt(s) {
    const [i, t] = this._locate(s);
    return this.curv[i] * (1 - t) + this.curv[i + 1] * t;
  }

  get start() { return this.pts[0]; }
  get end() { return this.pts[this.pts.length - 1]; }
}

/* ─────────────── 雑多 ─────────────── */

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
