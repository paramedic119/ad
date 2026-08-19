/**
 * sim.js — ボールの物理シミュレーション
 *
 * ボールは 2 つの状態を行き来する。
 *   path : 溝／レールの上を転がる（弧長 s と速度 v の 1 次元運動）
 *   free : 空中を飛ぶ（3 次元の弾道 + 反発）
 * パーツ内の溝とレールを「セグメント」として繋いだグラフを作り、
 * 端点で次のセグメントへ受け渡す。繋がっていなければ free になる。
 */
import * as THREE from 'three';
import {
  H, G, ROLL_FACTOR, BALL_R, HEX_R,
  cellCenter, portPos, surfaceY, worldToCell, clamp, Path3,
} from './core.js';
import { ckey } from './model.js';
import { PARTS } from './parts.js';

/* ─────────────── 物理パラメータ ─────────────── */
export const PHYS = {
  mu: 0.022,          // 転がり抵抗
  drag: 0.0016,       // 空気抵抗
  derailA: 5000,      // これを超える横 G でガイドを越えてコースアウト
  restitution: 0.32,  // 着地時の反発
  tangentDamp: 0.72,  // 着地時に残る水平速度
  launch: 46,         // マグネティックキャノンの初速
  releaseGap: 0.55,   // スターターがボールを出す間隔（秒）
  captureLoss: 0.34,  // キャッチャーで受けたあとに残る速さの割合
  stuckSpeed: 1.5,
  stuckTime: 1.4,
  killY: -8,
};

export const BALL_COLORS = [0xeef2f7, 0xffd166, 0x8ecae6, 0xff8fa3, 0xb5e48c, 0xd4a5ff];

/* ─────────────── セグメントグラフ ─────────────── */

const pkey = (cell, d) => ckey(cell.q, cell.r, cell.level) + ':' + d;

function toWorld(cell, pts) {
  const th = (cell.rot * Math.PI) / 3;
  const cs = Math.cos(th), sn = Math.sin(th);
  const [cx, cz] = cellCenter(cell.q, cell.r);
  const base = cell.level * H;
  return pts.map((p) => new THREE.Vector3(
    cx + p.x * cs - p.z * sn,
    base + p.y,
    cz + p.x * sn + p.z * cs));
}

function absEnd(cell, end) {
  if (end.t === 'port') return { t: 'port', cell, d: (end.d + cell.rot) % 6 };
  return { t: end.t, cell };
}

export function buildGraph(model) {
  const segs = [];
  const portMap = new Map();
  const addPort = (e, seg) => {
    if (e.t !== 'port') return;
    const k = pkey(e.cell, e.d);
    if (!portMap.has(k)) portMap.set(k, []);
    portMap.get(k).push(seg);
  };

  for (const cell of model.cells.values()) {
    const def = PARTS[cell.type];
    for (const lp of def.localPaths(cell.cfg)) {
      const seg = {
        id: segs.length,
        path: new Path3(toWorld(cell, lp.pts), lp.raw ? -1 : 0),
        walled: !!def.walled,
        cell, rail: null,
        endA: absEnd(cell, lp.ends[0]),
        endB: absEnd(cell, lp.ends[1]),
      };
      segs.push(seg);
      addPort(seg.endA, seg);
      addPort(seg.endB, seg);
    }
  }

  const a = new THREE.Vector3(), b = new THREE.Vector3();
  for (const l of model.rails) {
    if (!l.a || !l.b) continue;
    portPos(l.a.q, l.a.r, l.a.level, l.d1, a);
    portPos(l.b.q, l.b.r, l.b.level, l.d2, b);
    const seg = {
      id: segs.length,
      path: new Path3([a.clone(), b.clone()]),
      walled: false,
      cell: null, rail: l,
      endA: { t: 'port', cell: l.a, d: l.d1 },
      endB: { t: 'port', cell: l.b, d: l.d2 },
    };
    segs.push(seg);
    addPort(seg.endA, seg);
    addPort(seg.endB, seg);
  }

  return { segs, portMap };
}

/* ─────────────── シミュレータ ─────────────── */

export class Sim {
  static TERMINAL = new Set(['done', 'lost', 'stuck', 'stored']);

  constructor(model, view) {
    this.model = model;
    this.view = view;
    this.balls = [];
    this.magazines = new Map();
    this.queue = [];
    this.running = false;
    this.time = 0;
    this.stats = { goal: 0, lost: 0, stuck: 0, derail: 0 };
    this.onEvent = null;
    this.rebuild();
  }

  rebuild() {
    const g = buildGraph(this.model);
    this.segs = g.segs;
    this.portMap = g.portMap;
    this.alt = new Map();

    this.cellSegs = new Map();
    for (const s of this.segs) {
      if (!s.cell) continue;
      const k = ckey(s.cell.q, s.cell.r, s.cell.level);
      if (!this.cellSegs.has(k)) this.cellSegs.set(k, []);
      this.cellSegs.get(k).push(s);
    }

    // 落下判定用：マスごとに高い順のパーツ一覧
    this.columns = new Map();
    for (const c of this.model.cells.values()) {
      const k = c.q + ',' + c.r;
      if (!this.columns.has(k)) this.columns.set(k, []);
      this.columns.get(k).push(c);
    }
    for (const list of this.columns.values()) list.sort((x, y) => y.level - x.level);

    this.starters = this.segs.filter((s) => s.endA.t === 'source');
    this.catchers = [];
    for (const cell of this.model.cells.values()) {
      const def = PARTS[cell.type];
      if (!def.catchZone) continue;
      const [cx, cz] = cellCenter(cell.q, cell.r);
      this.catchers.push({
        cell, x: cx, z: cz,
        y: cell.level * H + def.catchZone.y,
        r: def.catchZone.r,
        isGoal: cell.type === 'goal',
      });
    }
  }

  /* ── リセット・開始 ── */

  reset() {
    this.view.clearBalls();
    this.balls.length = 0;
    this.running = false;
    this.time = 0;
    this.queue = [];
    this.releaseAt = 0;
    this.stats = { goal: 0, lost: 0, stuck: 0, derail: 0 };
    this.rebuild();

    // マグネティックキャノンに 2 発装填しておく
    this.magazines = new Map();
    for (const cell of this.model.cells.values()) {
      if (cell.type !== 'cannon') continue;
      const k = ckey(cell.q, cell.r, cell.level);
      const seg = (this.cellSegs.get(k) || [])[0];
      const mag = [];
      for (let i = 0; i < (PARTS.cannon.usesBalls || 2); i++) {
        const b = this.makeBall(0xf5f7fa);
        b.mode = 'stored';
        b.seg = seg;
        mag.push(b);
      }
      this.magazines.set(k, mag);
    }
    for (let i = 0; i < this.model.ballCount; i++) this.queue.push(i);
    this.syncMeshes();
  }

  start() {
    if (!this.starters.length) return { ok: false, why: 'スターターを置いてください' };
    if (!this.queue.length) this.reset();
    this.running = true;
    this.releaseAt = this.time;
    return { ok: true };
  }

  get finished() {
    return this.running && this.queue.length === 0 &&
      this.balls.every((b) => Sim.TERMINAL.has(b.mode));
  }

  get active() {
    return this.balls.filter((b) => b.mode === 'path' || b.mode === 'free').length;
  }

  /* ── ボール ── */

  makeBall(color) {
    const b = {
      id: this.balls.length,
      color,
      mesh: this.view.makeBall(color),
      mode: 'free',
      seg: null, s: 0, v: 0,
      pos: new THREE.Vector3(0, -999, 0),
      vel: new THREE.Vector3(),
      slowFor: 0,
      noLandUntil: 0,
    };
    this.balls.push(b);
    return b;
  }

  spawnFromStarter() {
    const i = this.model.ballCount - this.queue.length;
    const seg = this.starters[i % this.starters.length];
    this.queue.shift();
    const b = this.makeBall(BALL_COLORS[i % BALL_COLORS.length]);
    b.mode = 'path';
    b.seg = seg;
    b.s = 0.001;
    b.v = 0.2;
    return b;
  }

  /* ── 更新 ── */

  update(dt) {
    if (!this.running) { this.syncMeshes(); return; }
    dt = Math.min(dt, 0.05);
    let maxV = 1;
    for (const b of this.balls) {
      const sp = b.mode === 'path' ? Math.abs(b.v) : b.mode === 'free' ? b.vel.length() : 0;
      if (sp > maxV) maxV = sp;
    }
    const steps = clamp(Math.ceil((maxV * dt) / 0.09), 1, 40);
    const h = dt / steps;
    for (let i = 0; i < steps; i++) this.substep(h);
    this.syncMeshes();
  }

  substep(dt) {
    this.time += dt;
    if (this.queue.length && this.time >= this.releaseAt) {
      this.spawnFromStarter();
      this.releaseAt = this.time + PHYS.releaseGap;
    }
    for (const b of this.balls) {
      if (b.mode === 'path') this.stepPath(b, dt);
      else if (b.mode === 'free') this.stepFree(b, dt);
    }
    this.resolveBallCollisions();
  }

  /* ── 溝／レールの上 ── */

  stepPath(b, dt) {
    const seg = b.seg;
    const T = seg.path.tanAt(b.s, _t1);
    const cosT = Math.sqrt(Math.max(0, 1 - T.y * T.y));
    const sgn = Math.sign(b.v) || 0;
    let a = -ROLL_FACTOR * G * T.y;
    a -= sgn * PHYS.mu * G * cosT;
    a -= PHYS.drag * b.v * Math.abs(b.v);
    const v0 = b.v;
    b.v += a * dt;
    // 平らな所では摩擦で符号が反転しないようにする
    if (sgn !== 0 && Math.sign(b.v) !== sgn && Math.abs(T.y) < 0.02) b.v = 0;
    b.s += ((v0 + b.v) / 2) * dt;

    // 横 G が大きすぎるとガイドを越えて飛び出す
    const kappa = seg.path.curvAt(b.s);
    if (!seg.walled && kappa * b.v * b.v > PHYS.derailA) return this.derail(b);

    if (Math.abs(b.v) < PHYS.stuckSpeed) {
      b.slowFor += dt;
      if (b.slowFor > PHYS.stuckTime) {
        b.seg.path.posAt(clamp(b.s, 0, b.seg.path.length), b.pos);
        b.mode = 'stuck'; this.stats.stuck++; this.emit('stuck', b);
        return;
      }
    } else b.slowFor = 0;

    if (b.s < 0) this.leave(b, seg.endA, -1);
    else if (b.s > seg.path.length) this.leave(b, seg.endB, +1);
  }

  derail(b) {
    const seg = b.seg, L = seg.path.length;
    const ds = Math.min(0.14, L * 0.1);
    const tA = seg.path.tanAt(clamp(b.s - ds, 0, L), _t2);
    const tB = seg.path.tanAt(clamp(b.s + ds, 0, L), _t3);
    const out = _v2.subVectors(tA, tB);     // 曲率中心と逆向き＝外向き
    out.y = 0;
    if (out.lengthSq() > 1e-8) out.normalize(); else out.set(0, 0, 0);
    const t = seg.path.tanAt(clamp(b.s, 0, L), _t1);
    b.mode = 'free';
    seg.path.posAt(clamp(b.s, 0, L), b.pos);
    b.pos.addScaledVector(out, BALL_R * 0.7);
    b.vel.copy(t).multiplyScalar(b.v).addScaledVector(out, Math.abs(b.v) * 0.32);
    b.vel.y += 1.5;
    b.noLandUntil = this.time + 0.14;
    this.stats.derail++;
    this.emit('derail', b);
  }

  /** セグメントの端に着いた */
  leave(b, end, side) {
    const seg = b.seg;
    const sAt = side < 0 ? 0 : seg.path.length;
    const speed = Math.abs(b.v);

    if (end.t === 'sink') {
      seg.path.posAt(sAt, b.pos);
      b.mode = 'done';
      this.stats.goal++;
      this.emit('goal', b);
      return;
    }
    if (end.t === 'catch' || end.t === 'source') {
      b.s = clamp(b.s, 0.001, seg.path.length - 0.001);
      b.v = -b.v * 0.25;
      return;
    }
    if (end.t === 'open') return this.eject(b, seg, sAt, side, speed);

    const options = this.optionsAt(seg, end);
    let next = options[0] || null;
    if (options.length > 1) next = this.chooseBranch(end, options);
    if (!next) return this.eject(b, seg, sAt, side, speed);

    if (next.cell && next.cell.type === 'cannon' && this.fireCannon(b, next, end)) return;
    this.enter(b, next, end, speed);
  }

  optionsAt(seg, end) {
    const list = this.portMap.get(pkey(end.cell, end.d)) || [];
    let options = list.filter((s) => s !== seg);
    // 同じパーツの別の溝へ直接乗り移ることはない（必ず一度外に出る）
    if (seg.cell) options = options.filter((s) => s.cell !== seg.cell);
    return options;
  }

  eject(b, seg, sAt, side, speed) {
    seg.path.tanAt(sAt, _t1);
    seg.path.posAt(sAt, b.pos);
    b.mode = 'free';
    b.vel.copy(_t1).multiplyScalar(side * speed);
    b.noLandUntil = this.time + 0.02;
  }

  enter(b, next, end, speed) {
    const atA = next.endA.t === 'port' && next.endA.cell === end.cell && next.endA.d === end.d;
    b.seg = next;
    if (atA) { b.s = 0.001; b.v = speed; } else { b.s = next.path.length - 0.001; b.v = -speed; }
    b.slowFor = 0;
  }

  /** 振り分けパーツ：来るたびに出口を交互に変える */
  chooseBranch(end, options) {
    const cell = end.cell;
    if (!cell || !PARTS[cell.type].alternates) return options[0];
    const k = ckey(cell.q, cell.r, cell.level);
    const n = this.alt.get(k) || 0;
    this.alt.set(k, n + 1);
    return options[n % options.length];
  }

  /**
   * マグネティックキャノン：入口から飛び込んだ球が磁石に吸着され、
   * 玉突きで先頭の球が反対側へ高速で撃ち出される。
   */
  fireCannon(b, seg, end) {
    const cell = seg.cell;
    if (end.d !== (PARTS.cannon.entryPort + cell.rot) % 6) return false;  // 出口側からは素通り
    const k = ckey(cell.q, cell.r, cell.level);
    const mag = this.magazines.get(k) || [];
    b.mode = 'stored';
    b.seg = seg;
    b.v = 0;
    mag.push(b);
    this.magazines.set(k, mag);
    if (mag.length < 2) return true;
    const shot = mag.shift();
    shot.mode = 'path';
    shot.seg = seg;
    shot.s = seg.path.length - 0.001;
    shot.v = PHYS.launch;
    shot.slowFor = 0;
    this.emit('cannon', shot);
    return true;
  }

  /* ── 空中 ── */

  stepFree(b, dt) {
    b.vel.y -= G * dt;
    const prevY = b.pos.y;
    b.pos.addScaledVector(b.vel, dt);

    // キャッチャー／ゴールの受け口
    for (const c of this.catchers) {
      const dx = b.pos.x - c.x, dz = b.pos.z - c.z;
      if (dx * dx + dz * dz > c.r * c.r) continue;
      if (prevY >= c.y && b.pos.y <= c.y && b.vel.y < 0) {
        if (c.isGoal) {
          b.mode = 'done'; this.stats.goal++; this.emit('goal', b);
        } else {
          const segs = this.cellSegs.get(ckey(c.cell.q, c.cell.r, c.cell.level)) || [];
          const seg = segs.find((s) => s.endA.t === 'catch');
          if (seg) {
            b.mode = 'path'; b.seg = seg; b.s = 0.001;
            b.v = Math.max(2.5, b.vel.length() * PHYS.captureLoss);
            b.slowFor = 0;
            this.emit('catch', b);
          }
        }
        return;
      }
    }

    // 下にあるものとの当たり判定（上から降りてきたときだけ）
    const [q, r] = worldToCell(b.pos.x, b.pos.z);
    const col = this.columns.get(q + ',' + r);
    let landed = null;
    if (col) {
      const [cx, cz] = cellCenter(q, r);
      const dx = b.pos.x - cx, dz = b.pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < (HEX_R * 0.94) ** 2) {
        for (const cell of col) {
          const def = PARTS[cell.type];
          if (def.hole && d2 < def.hole * def.hole) continue;   // 穴は素通り
          const surf = surfaceY(cell.level);
          if (prevY - BALL_R >= surf - 0.03 && b.pos.y - BALL_R <= surf) { landed = { cell, surf }; break; }
        }
      }
    }
    if (!landed && this.model.onBoard(q, r) && prevY - BALL_R >= -0.03 && b.pos.y - BALL_R <= 0) {
      landed = { cell: null, surf: 0 };
    }

    if (landed && b.vel.y <= 0) {
      if (landed.cell && this.tryLandOnTrack(b, landed.cell)) return;
      b.pos.y = landed.surf + BALL_R;
      b.vel.y = -b.vel.y * PHYS.restitution;
      b.vel.x *= PHYS.tangentDamp;
      b.vel.z *= PHYS.tangentDamp;
      if (b.vel.y < 12) {
        b.vel.y = 0;
        const f = Math.exp(-2.6 * dt);
        b.vel.x *= f; b.vel.z *= f;
        if (b.vel.lengthSq() < 1.5) {
          b.slowFor += dt;
          if (b.slowFor > PHYS.stuckTime) { b.mode = 'stuck'; this.stats.stuck++; this.emit('stuck', b); }
        } else b.slowFor = 0;
      }
    }

    if (b.pos.y < PHYS.killY) { b.mode = 'lost'; this.stats.lost++; this.emit('lost', b); }
  }

  /** 落ちてきた球をそのパーツの溝に乗せられるか試す */
  tryLandOnTrack(b, cell) {
    if (this.time < b.noLandUntil) return false;
    const segs = this.cellSegs.get(ckey(cell.q, cell.r, cell.level)) || [];
    let best = null, bestD = 0.34 * 0.34;
    for (const seg of segs) {
      const pts = seg.path.pts;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const dx = p.x - b.pos.x, dz = p.z - b.pos.z;
        const d = dx * dx + dz * dz;
        if (d < bestD && Math.abs(p.y - b.pos.y) < 0.45) { bestD = d; best = { seg, i }; }
      }
    }
    if (!best) return false;
    const s = best.seg.path.cum[best.i];
    const t = best.seg.path.tanAt(s, _t1);
    const along = t.x * b.vel.x + t.z * b.vel.z + t.y * b.vel.y * 0.4;
    b.mode = 'path';
    b.seg = best.seg;
    b.s = clamp(s, 0.001, best.seg.path.length - 0.001);
    b.v = along * 0.75;
    b.slowFor = 0;
    this.emit('land', b);
    return true;
  }

  /* ── 同じセグメント上での球どうしの衝突 ── */

  resolveBallCollisions() {
    const bySeg = new Map();
    for (const b of this.balls) {
      if (b.mode !== 'path') continue;
      if (!bySeg.has(b.seg.id)) bySeg.set(b.seg.id, []);
      bySeg.get(b.seg.id).push(b);
    }
    for (const list of bySeg.values()) {
      if (list.length < 2) continue;
      list.sort((x, y) => x.s - y.s);
      for (let i = 0; i < list.length - 1; i++) {
        const a = list[i], c = list[i + 1];
        const gap = c.s - a.s;
        if (gap < BALL_R * 2) {
          const push = (BALL_R * 2 - gap) / 2;
          a.s -= push; c.s += push;
          if (a.v > c.v) { const t = a.v; a.v = c.v * 0.96; c.v = t * 0.96; }
          a.slowFor = 0; c.slowFor = 0;
        }
      }
    }
  }

  /* ── 表示の更新 ── */

  syncMeshes() {
    for (const b of this.balls) {
      if (b.mode === 'path') b.seg.path.posAt(clamp(b.s, 0, b.seg.path.length), b.pos);
      b.mesh.visible = b.mode !== 'lost' && b.pos.y > -900;
      b.mesh.position.copy(b.pos);
    }
    for (const mag of this.magazines.values()) {
      mag.forEach((b, i) => {
        if (!b.seg) { b.mesh.visible = false; return; }
        const s = b.seg.path.length - (0.30 + i * BALL_R * 2.05);
        b.seg.path.posAt(clamp(s, 0, b.seg.path.length), b.pos);
        b.mesh.position.copy(b.pos);
        b.mesh.visible = true;
      });
    }
  }

  emit(type, ball) { if (this.onEvent) this.onEvent(type, ball); }
}

const _v2 = new THREE.Vector3();
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _t3 = new THREE.Vector3();
