/**
 * model.js — コースのデータモデル
 *
 * GraviTrax PRO と同じく「縦に積む」遊びができるよう、パーツは
 * (q, r, level) の 3 次元グリッドに置く。同じマス（コラム）の別の高さに
 * 別のパーツを置けるので、ボルテックスの真下でキャッチする…といった
 * 立体的なコースが作れる。支えは PRO のピラー／バルコニーに見立てた支柱で描く。
 */
import {
  opposite, neighbor, lineBetween, hexDistance, hexBoard, clamp, MAX_LEVEL, H, HEX_W,
} from './core.js';
import { PARTS, PART_ORDER, RAILS, RAIL_BY_SPAN, SET_INVENTORY } from './parts.js';

const TYPE_IDX = PART_ORDER.slice();

/** その「種類・形・向き」で使えるポート方向の一覧 */
export function portsFor(type, cfg, rot) {
  const out = new Set();
  for (const p of PARTS[type].localPaths(cfg)) {
    for (const e of p.ends) if (e.t === 'port') out.add((e.d + rot) % 6);
  }
  return [...out];
}

/** 同じコラムでパーツ同士に必要な高さの間隔（ボールが通れるだけの隙間） */
export const MIN_GAP = 5;

export const ckey = (q, r, l) => q + ',' + r + ',' + l;

export class Model {
  constructor(boardRadius = 5) {
    this.boardRadius = boardRadius;
    this.cells = new Map();   // "q,r,l" -> {q,r,level,type,cfg,rot,locked}
    this.rails = [];          // {q1,r1,l1,d1, q2,r2,l2,d2, span, type}
    this.ballCount = 4;
    this.title = '';
  }

  /* ── セル ─────────────────────────────── */

  onBoard(q, r) { return hexDistance(q, r, 0, 0) <= this.boardRadius; }
  getAt(q, r, l) { return this.cells.get(ckey(q, r, l)) || null; }
  get cellList() { return [...this.cells.values()]; }
  get size() { return this.cells.size; }

  /** 同じマスにあるパーツを低い順に */
  columnAt(q, r) {
    const out = [];
    for (const c of this.cells.values()) if (c.q === q && c.r === r) out.push(c);
    out.sort((a, b) => a.level - b.level);
    return out;
  }

  /** その高さに置けるか（盤外・高さ制限・上下の間隔をチェック） */
  canPlace(q, r, level, ignore = null) {
    if (!this.onBoard(q, r)) return { ok: false, why: '盤の外には置けません' };
    if (level < 0 || level > MAX_LEVEL) return { ok: false, why: '高さの範囲外です' };
    for (const c of this.columnAt(q, r)) {
      if (c === ignore) continue;
      if (Math.abs(c.level - level) < MIN_GAP) {
        return { ok: false, why: `同じマスの上下は ${MIN_GAP} 段以上あけてください` };
      }
    }
    return { ok: true };
  }

  setPart(q, r, type, cfg = 0, rot = 0, level = 0, opts = {}) {
    if (!PARTS[type]) return null;
    if (!opts.force && !this.canPlace(q, r, level).ok) return null;
    const cell = {
      q, r, type, cfg,
      rot: ((rot % 6) + 6) % 6,
      level: clamp(Math.round(level), 0, MAX_LEVEL),
      locked: !!opts.locked,
    };
    this.cells.set(ckey(q, r, cell.level), cell);
    return cell;
  }

  remove(cell) {
    if (!cell || cell.locked) return false;
    if (!this.cells.delete(ckey(cell.q, cell.r, cell.level))) return false;
    this.rails = this.rails.filter((l) => l.a !== cell && l.b !== cell);
    return true;
  }

  rotate(cell, delta = 1) {
    if (!cell) return false;
    cell.rot = ((cell.rot + delta) % 6 + 6) % 6;
    this.dropRailsAt(cell);
    return true;
  }

  cycleVariant(cell, delta = 1) {
    if (!cell) return false;
    const n = PARTS[cell.type].variants.length;
    cell.cfg = ((cell.cfg + delta) % n + n) % n;
    this.dropRailsAt(cell);
    return true;
  }

  /** 高さを変える。移動先が空いていなければ何もしない。 */
  setLevel(cell, level) {
    if (!cell) return false;
    const v = clamp(Math.round(level), 0, MAX_LEVEL);
    if (v === cell.level) return false;
    if (!this.canPlace(cell.q, cell.r, v, cell).ok) return false;
    this.cells.delete(ckey(cell.q, cell.r, cell.level));
    cell.level = v;
    this.cells.set(ckey(cell.q, cell.r, v), cell);
    // 高さが変わってもレールは繋がったまま（傾きが変わるだけ）
    return true;
  }

  /**
   * パーツを別のマス・高さへ動かす。
   * つながっていたレールは、まだ届く相手なら張り直し、届かなくなったら外す。
   */
  moveTo(cell, q, r, level) {
    if (cell.locked) return { ok: false, why: 'この パーツは おだいで きまっているよ' };
    const chk = this.canPlace(q, r, level, cell);
    if (!chk.ok) return chk;
    if (cell.q === q && cell.r === r && cell.level === level) return { ok: true };
    this.cells.delete(ckey(cell.q, cell.r, cell.level));
    cell.q = q; cell.r = r; cell.level = level;
    this.cells.set(ckey(q, r, level), cell);
    this.revalidateRails();
    return { ok: true };
  }

  /** パーツを動かしたあとに、レールの向き・長さを付け直す */
  revalidateRails() {
    for (const l of [...this.rails]) {
      const line = lineBetween(l.a.q, l.a.r, l.b.q, l.b.r);
      if (!line || line.span < 2 || line.span > 4) { this.removeRail(l); continue; }
      l.d1 = line.dir;
      l.d2 = opposite(line.dir);
      l.span = line.span;
      l.type = RAIL_BY_SPAN[line.span];
    }
    // 同じ出入口に 2 本ついてしまったら、あとから来たほうを外す
    const used = new Set();
    for (const l of [...this.rails]) {
      const k1 = ckey(l.a.q, l.a.r, l.a.level) + ':' + l.d1;
      const k2 = ckey(l.b.q, l.b.r, l.b.level) + ':' + l.d2;
      if (used.has(k1) || used.has(k2)) { this.removeRail(l); continue; }
      used.add(k1); used.add(k2);
    }
    // 出入口の向きをそろえ直す。どうしても無理なレールは外す。
    for (const cell of new Set(this.rails.flatMap((l) => [l.a, l.b]))) {
      let guard = 8;
      while (guard-- > 0 && !this.fitPorts(cell, this._needDirs(cell))) {
        const mine = this.railsOf(cell);
        if (!mine.length) break;
        this.removeRail(mine[mine.length - 1]);
      }
    }
  }

  /**
   * そのマスに置くとちょうど良さそうな高さを返す。
   * レールが届く範囲にあるパーツのうち、いちばん近くて高いものから
   * 気持ちよく転がる坂（およそ 12 度）になる高さを選ぶ。
   */
  suggestLevel(q, r, fallback = 0) {
    let best = null;
    for (const c of this.cells.values()) {
      if (c.q === q && c.r === r) continue;
      const line = lineBetween(q, r, c.q, c.r);
      if (!line || line.span < 2 || line.span > 4) continue;
      if (!best || line.span < best.span || (line.span === best.span && c.level > best.cell.level)) {
        best = { cell: c, span: line.span };
      }
    }
    if (!best) return clamp(fallback, 0, MAX_LEVEL);
    const drop = Math.max(2, Math.round(1.25 * best.span));
    let lv = clamp(best.cell.level - drop, 0, MAX_LEVEL);
    // 上下に別のパーツがあってぶつかるなら、置ける高さまでずらす
    for (let i = 0; i < MAX_LEVEL; i++) {
      for (const d of [0, i, -i]) {
        const v = clamp(lv + d, 0, MAX_LEVEL);
        if (this.canPlace(q, r, v).ok) return v;
      }
    }
    return lv;
  }

  /**
   * レールの傾き具合。'good' 転がる / 'flat' ゆるすぎ / 'steep' 急すぎ
   * このゲームでいちばん大事なルールを目に見えるようにするために使う。
   */
  railGrade(rail) {
    const drop = Math.abs(rail.a.level - rail.b.level) * H;
    const run = (rail.span - 1) * HEX_W;
    const deg = (Math.atan2(drop, run) * 180) / Math.PI;
    if (deg < 4) return 'flat';
    if (deg > 34) return 'steep';
    return 'good';
  }

  /** 向き・形が変わって使えなくなったレールを外す */
  dropRailsAt(cell) {
    const ports = new Set(this.portsOf(cell));
    this.rails = this.rails.filter((l) => {
      if (l.a === cell) return ports.has(l.d1);
      if (l.b === cell) return ports.has(l.d2);
      return true;
    });
  }

  /** そのパーツが実際に使うポート方向（回転込み） */
  portsOf(cell) { return portsFor(cell.type, cell.cfg, cell.rot); }

  /** そのレールがこのパーツのどの向きに繋がっているか */
  dirOfRail(rail, cell) { return rail.a === cell ? rail.d1 : rail.d2; }

  /**
   * dirs のすべての向きに出入口が来るような「形」と「向き」を探す。
   * 見つかったら適用して true。見つからなければ何も変えずに false。
   * これのおかげで、遊ぶ人はパーツの向きを自分で合わせなくてよくなる。
   */
  fitPorts(cell, dirs, apply = true) {
    if (dirs.every((d) => portsFor(cell.type, cell.cfg, cell.rot).includes(d))) return true;
    const nCfg = PARTS[cell.type].variants.length;
    const cfgs = [cell.cfg];
    for (let c = 0; c < nCfg; c++) if (c !== cell.cfg) cfgs.push(c);
    for (const cfg of cfgs) {
      for (let i = 0; i < 6; i++) {                 // 今の向きに近いものから試す
        const rot = (cell.rot + i) % 6;
        if (dirs.every((d) => portsFor(cell.type, cfg, rot).includes(d))) {
          if (apply) { cell.cfg = cfg; cell.rot = rot; }
          return true;
        }
      }
    }
    return false;
  }

  /** 今ついているレールの向き＋追加したい向き */
  _needDirs(cell, extra) {
    const need = this.railsOf(cell).map((l) => this.dirOfRail(l, cell));
    if (extra != null) need.push(extra);
    return need;
  }

  /* ── レール ───────────────────────────── */

  railAtPort(cell, d) {
    return this.rails.find((l) => (l.a === cell && l.d1 === d) || (l.b === cell && l.d2 === d)) || null;
  }

  railsOf(cell) {
    return this.rails.filter((l) => l.a === cell || l.b === cell);
  }

  canRail(a, b) {
    if (!a || !b) return { ok: false, why: '両端にパーツが必要です' };
    if (a === b) return { ok: false, why: '同じパーツ同士は繋げません' };
    const line = lineBetween(a.q, a.r, b.q, b.r);
    if (!line) return { ok: false, why: 'まっすぐ並んだマス同士だけ繋げます' };
    if (line.span < 2 || line.span > 4) return { ok: false, why: 'レールが届くのは 2〜4 マス先までです' };
    const d1 = line.dir, d2 = opposite(d1);
    if (!this.portsOf(a).includes(d1) || !this.portsOf(b).includes(d2)) {
      return { ok: false, why: 'パーツの出入口が向き合っていません（R キーで回転）' };
    }
    if (this.railAtPort(a, d1) || this.railAtPort(b, d2)) {
      return { ok: false, why: 'その出入口にはもうレールが付いています' };
    }
    return { ok: true, d1, d2, span: line.span, type: RAIL_BY_SPAN[line.span] };
  }

  addRail(a, b) {
    const c = this.canRail(a, b);
    if (!c.ok) return c;
    const rail = {
      a, b, q1: a.q, r1: a.r, l1: a.level, d1: c.d1,
      q2: b.q, r2: b.r, l2: b.level, d2: c.d2, span: c.span, type: c.type,
    };
    this.rails.push(rail);
    return { ok: true, rail };
  }

  /** a と b を繋げられるか（何も変えずに調べるだけ） */
  probeRail(a, b) {
    if (!a || !b || a === b) return { ok: false, why: 'ちがう パーツ を えらんでね' };
    const line = lineBetween(a.q, a.r, b.q, b.r);
    if (!line) return { ok: false, why: 'まっすぐ ならんだ ばしょ どうし だけ つなげるよ' };
    if (line.span < 2 || line.span > 4) {
      return { ok: false, why: line.span < 2 ? 'ちかすぎるよ。ひとつ あけてね' : 'とおすぎるよ' };
    }
    const d1 = line.dir, d2 = opposite(d1);
    if (this.railAtPort(a, d1) || this.railAtPort(b, d2)) {
      return { ok: false, why: 'そこには もう レールが ついてるよ' };
    }
    if (!this.fitPorts(a, this._needDirs(a, d1), false) ||
        !this.fitPorts(b, this._needDirs(b, d2), false)) {
      return { ok: false, why: 'この パーツ には これいじょう つなげないよ' };
    }
    return { ok: true, d1, d2, span: line.span, type: RAIL_BY_SPAN[line.span] };
  }

  /** 向きを自動で合わせながらレールを張る */
  smartRail(a, b) {
    const chk = this.probeRail(a, b);
    if (!chk.ok) return chk;
    this.fitPorts(a, this._needDirs(a, chk.d1));
    this.fitPorts(b, this._needDirs(b, chk.d2));
    return this.addRail(a, b);
  }

  /** そのパーツから繋げられる相手を全部あつめる（光らせて教えるため） */
  railTargets(a) {
    const out = [];
    for (const b of this.cells.values()) {
      if (b !== a && this.probeRail(a, b).ok) out.push(b);
    }
    return out;
  }

  removeRail(rail) {
    const i = this.rails.indexOf(rail);
    if (i >= 0) { this.rails.splice(i, 1); return true; }
    return false;
  }

  /* ── 支え（支柱）の高さ ───────────────── */

  /** そのパーツを支える支柱が始まる高さ（level 単位） */
  supportBase(cell) {
    let base = 0;
    for (const c of this.columnAt(cell.q, cell.r)) {
      if (c === cell || c.level >= cell.level) continue;
      base = Math.max(base, c.level + 2);
    }
    return base;
  }

  /* ── 在庫 ─────────────────────────────── */

  usage() {
    const u = { height: 0, balls: 0 };
    for (const id of PART_ORDER) u[id] = 0;
    for (const id of Object.keys(RAILS)) u[id] = 0;
    for (const c of this.cells.values()) {
      if (c.locked) continue;   // お題であらかじめ置かれているパーツは持ち物に数えない
      u[c.type] = (u[c.type] || 0) + 1;
      u.height += Math.max(0, c.level - this.supportBase(c));
      if (PARTS[c.type].usesBalls) u.balls += PARTS[c.type].usesBalls;
    }
    for (const l of this.rails) u[l.type] = (u[l.type] || 0) + 1;
    u.balls += this.ballCount;
    return u;
  }

  overBudget(limits) {
    if (!limits) return [];
    const u = this.usage();
    const over = [];
    for (const k of Object.keys(limits)) {
      if (limits[k] != null && u[k] > limits[k]) over.push({ id: k, used: u[k], max: limits[k] });
    }
    return over;
  }

  /* ── 保存・復元 ───────────────────────── */

  serialize() {
    const cells = [...this.cells.values()];
    const idx = new Map(cells.map((c, i) => [c, i]));
    return {
      v: 2,
      r: this.boardRadius,
      b: this.ballCount,
      t: this.title || undefined,
      c: cells.map((c) => [c.q, c.r, c.level, TYPE_IDX.indexOf(c.type), c.cfg, c.rot, c.locked ? 1 : 0]),
      l: this.rails.map((x) => [idx.get(x.a), idx.get(x.b)]).filter(([i, j]) => i != null && j != null),
    };
  }

  static deserialize(data) {
    const m = new Model(data.r ?? 5);
    m.ballCount = data.b ?? 4;
    m.title = data.t || '';
    const cells = [];
    for (const [q, r, level, ti, cfg, rot, locked] of data.c || []) {
      const type = TYPE_IDX[ti];
      cells.push(type ? m.setPart(q, r, type, cfg, rot, level, { force: true, locked: !!locked }) : null);
    }
    for (const pair of data.l || []) {
      const a = cells[pair[0]], b = cells[pair[1]];
      if (a && b) m.addRail(a, b);
    }
    return m;
  }

  clone() { return Model.deserialize(this.serialize()); }

  clear() {
    for (const c of [...this.cells.values()]) if (!c.locked) this.remove(c);
  }

  clearAll() { this.cells.clear(); this.rails.length = 0; }

  get isEmpty() { return this.cells.size === 0; }

  trimToBoard() {
    for (const c of [...this.cells.values()]) {
      if (!this.onBoard(c.q, c.r)) { c.locked = false; this.remove(c); }
    }
  }

  /** スターターとゴールが揃っているか */
  get playable() {
    let s = false, g = false;
    for (const c of this.cells.values()) {
      if (c.type === 'starter') s = true;
      if (c.type === 'goal') g = true;
    }
    return { starter: s, goal: g };
  }
}

export function stepAlong(q, r, d, n) {
  let cq = q, cr = r;
  for (let i = 0; i < n; i++) [cq, cr] = neighbor(cq, cr, d);
  return [cq, cr];
}

/* ─────────────── アンドゥ履歴 ─────────────── */

export class History {
  constructor(limit = 80) { this.limit = limit; this.past = []; this.future = []; }
  push(model) {
    this.past.push(JSON.stringify(model.serialize()));
    if (this.past.length > this.limit) this.past.shift();
    this.future.length = 0;
  }
  undo(model) {
    if (!this.past.length) return null;
    this.future.push(JSON.stringify(model.serialize()));
    return Model.deserialize(JSON.parse(this.past.pop()));
  }
  redo(model) {
    if (!this.future.length) return null;
    this.past.push(JSON.stringify(model.serialize()));
    return Model.deserialize(JSON.parse(this.future.pop()));
  }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  clear() { this.past.length = 0; this.future.length = 0; }
}

export { SET_INVENTORY, hexBoard };
