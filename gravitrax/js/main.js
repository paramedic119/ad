/**
 * main.js — アプリ本体
 * モデル・ビュー・シミュレータ・UI をつなぐコントローラ。
 */
import * as THREE from 'three';
import { H, MAX_LEVEL, clamp, cellCenter, portPos } from './core.js';
import { PARTS, PART_ORDER, RAILS, SET_INVENTORY } from './parts.js';
import { Model, History, MIN_GAP } from './model.js';
import { View } from './view.js';
import { Sim } from './sim.js';
import { UI } from './ui.js';
import { CHALLENGES, loadChallenge, sampleSolution, challengeById } from './challenges.js';

const LS = {
  sandbox: 'gt3d.sandbox',
  saves: 'gt3d.saves',
  cleared: 'gt3d.cleared',
  seen: 'gt3d.seen',
};

const readJSON = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 容量オーバーなどは無視 */ } };

class App {
  constructor(view, ui) {
    this.view = view;
    this.ui = ui;
    this.mode = 'build';
    this.tool = null;          // パーツ id / 'railS' 等 / 'erase' / null
    this.buildLevel = 0;
    this.buildRot = 0;
    this.buildCfg = 0;
    this.selected = null;
    this.railFrom = null;
    this.hover = null;
    this.challenge = null;
    this.cleared = new Set(readJSON(LS.cleared, []));
    this.history = new History();
    this.limits = { ...SET_INVENTORY };
    this.model = new Model(5);
    this.sim = new Sim(this.model, view);
    this._acc = 0;
  }

  /* ─────────────── 初期化 ─────────────── */

  init() {
    const saved = readJSON(LS.sandbox, null);
    if (saved) {
      try { this.model = Model.deserialize(saved); } catch { this.model = new Model(5); }
    }
    if (this.model.isEmpty) this.demoCourse();

    this.sim = new Sim(this.model, this.view);
    this.view.buildBoard(this.model.boardRadius);
    this.refresh();
    this.frameContent();

    this.wireUI();
    this.wireInput();
    this.setMode('build', true);
    this.ui.setBalls(this.model.ballCount);
    this.pick('curve');

    if (!readJSON(LS.seen, false)) { this.showHelp(); writeJSON(LS.seen, true); }

    this.last = performance.now();
    const loop = (t) => {
      const dt = Math.min(0.05, (t - this.last) / 1000);
      this.last = t;
      this.tick(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    addEventListener('resize', () => this.view.resize());
  }

  /** 最初に表示するお手本コース */
  demoCourse() {
    const m = this.model;
    m.clearAll();
    m.boardRadius = 5;
    m.ballCount = 4;
    const st = m.setPart(0, -4, 'starter', 0, 1, 18);
    const c1 = m.setPart(0, -2, 'curve', 1, 4, 14);      // ゆるいカーブ（左）
    const c2 = m.setPart(3, -2, 'curve', 2, 3, 10);      // ゆるいカーブ（右）
    const vx = m.setPart(3, 1, 'vortex', 0, 4, 6);
    const ca = m.setPart(3, 1, 'catcher', 0, 3, 0);
    const gl = m.setPart(0, 1, 'goal', 0, 0, 0);
    m.addRail(st, c1); m.addRail(c1, c2); m.addRail(c2, vx); m.addRail(ca, gl);
  }

  /* ─────────────── UI 配線 ─────────────── */

  wireUI() {
    const ui = this.ui;
    ui.on('mode', (m) => this.setMode(m));
    ui.on('pick', (id) => this.pick(id));
    ui.on('level', (d) => this.setBuildLevel(this.buildLevel + d));
    ui.on('cellLevel', (d) => this.changeCellLevel(d));
    ui.on('rotate', (d) => this.rotate(d));
    ui.on('variant', (d) => this.variant(d));
    ui.on('delete', () => this.deleteSelected());
    ui.on('undo', () => this.undo());
    ui.on('redo', () => this.redo());
    ui.on('clear', () => this.confirmClear());
    ui.on('run', () => this.toggleRun());
    ui.on('reset', () => this.resetRun());
    ui.on('balls', (d) => this.changeBalls(d));
    ui.on('camera', () => this.frameContent());
    ui.on('help', () => this.showHelp());
    ui.on('quests', () => this.showQuests());
    ui.on('saves', () => this.showSaves());
    ui.on('quest:hint', () => this.ui.toast('💡 ' + this.challenge.hint));
    ui.on('quest:sample', () => this.showSample());
    ui.on('quest:retry', () => this.startChallenge(this.challenge));
    ui.on('quest:quit', () => this.exitChallenge());
  }

  wireInput() {
    this.view.cam.onTap = (x, y, btn) => this.onTap(x, y, btn);
    this.view.cam.onHover = (x, y) => this.onHover(x, y);
    addEventListener('keydown', (e) => this.onKey(e));
    addEventListener('beforeunload', () => this.autosave());
  }

  /* ─────────────── モード ─────────────── */

  setMode(mode, force = false) {
    if (mode === this.mode && !force) return;
    const changed = mode !== this.mode;
    this.mode = mode;
    this.ui.setMode(mode);
    this.view.hideGhost();
    this.view.hideHover();
    this.view.hideRailPreview();
    this.select(null);
    this.railFrom = null;
    if (mode === 'play') {
      this.sim.reset();
      this.ui.setRunning(false);
      this.updateStats();
      if (changed) {
        const p = this.model.playable;
        if (!p.starter) this.ui.toast('スターターがありません', 'bad');
        else if (!p.goal) this.ui.toast('ゴールがありません', 'bad');
      }
    } else {
      this.sim.running = false;
      this.sim.reset();
      this.autosave();
    }
  }

  /* ─────────────── 組み立て ─────────────── */

  pick(id) {
    this.tool = this.tool === id ? null : id;
    this.ui.setTool(this.tool);
    this.railFrom = null;
    this.view.hideRailPreview();
    if (this.tool && PARTS[this.tool]) {
      this.buildCfg = clamp(this.buildCfg, 0, PARTS[this.tool].variants.length - 1);
      this.select(null);
    } else this.view.hideGhost();
    if (RAILS[this.tool]) this.ui.toast('つなぎたいパーツを 2 つ順番にクリック（長さは自動で選ばれます）');
  }

  setBuildLevel(n) {
    this.buildLevel = clamp(n, 0, MAX_LEVEL);
    this.ui.setLevel(this.buildLevel);
  }

  select(cell) {
    this.selected = cell || null;
    this.ui.setSelected(this.selected);
    if (this.selected) this.view.showSelect(this.selected.q, this.selected.r, this.selected.level);
    else this.view.hideSelect();
  }

  onHover(x, y) {
    if (this.mode !== 'build') return;
    const hit = this.view.pick(x, y);
    this.hover = hit;
    if (!hit || !this.model.onBoard(hit.q, hit.r)) {
      this.view.hideHover(); this.view.hideGhost(); this.view.hideRailPreview();
      return;
    }
    this.view.showHover(hit.q, hit.r, hit.cell ? hit.cell.level : null);

    if (this.tool && PARTS[this.tool]) {
      const ok = this.model.canPlace(hit.q, hit.r, this.buildLevel).ok && this.stockLeft(this.tool) > 0;
      this.view.showGhost(this.tool, this.buildCfg, this.buildRot, hit.q, hit.r, this.buildLevel, ok);
    } else this.view.hideGhost();

    if (RAILS[this.tool] && this.railFrom) {
      const target = hit.cell;
      const a = new THREE.Vector3(), b = new THREE.Vector3();
      const c = target ? this.model.canRail(this.railFrom, target) : { ok: false };
      portPos(this.railFrom.q, this.railFrom.r, this.railFrom.level, c.ok ? c.d1 : 0, a);
      if (target) {
        portPos(target.q, target.r, target.level, c.ok ? c.d2 : 0, b);
        if (!c.ok) { const [cx, cz] = cellCenter(target.q, target.r); b.set(cx, target.level * H + 0.6, cz); }
        if (!c.ok) { const [cx, cz] = cellCenter(this.railFrom.q, this.railFrom.r); a.set(cx, this.railFrom.level * H + 0.6, cz); }
      } else {
        const [cx, cz] = cellCenter(this.railFrom.q, this.railFrom.r);
        a.set(cx, this.railFrom.level * H + 0.6, cz);
        b.copy(hit.point);
      }
      this.view.showRailPreview(a, b, !!c.ok);
    } else this.view.hideRailPreview();
  }

  onTap(x, y) {
    if (this.mode !== 'build') return;
    const hit = this.view.pick(x, y);
    if (!hit || !this.model.onBoard(hit.q, hit.r)) { this.select(null); return; }

    if (this.tool === 'erase') return this.eraseAt(hit);
    if (RAILS[this.tool]) return this.railAt(hit);
    if (this.tool && PARTS[this.tool]) return this.placeAt(hit);

    this.select(hit.cell);
    if (hit.cell) this.setBuildLevel(hit.cell.level);
  }

  stockLeft(id) {
    if (!this.limits || this.limits[id] == null) return Infinity;
    return this.limits[id] - (this.model.usage()[id] || 0);
  }

  placeAt(hit) {
    const type = this.tool;
    if (this.stockLeft(type) <= 0) {
      this.ui.toast(`${PARTS[type].name}の残りがありません`, 'bad');
      return;
    }
    const can = this.model.canPlace(hit.q, hit.r, this.buildLevel);
    if (!can.ok) {
      const exist = this.model.columnAt(hit.q, hit.r)
        .find((c) => Math.abs(c.level - this.buildLevel) < MIN_GAP);
      this.ui.toast(can.why, 'bad');
      if (exist) { this.select(exist); this.setBuildLevel(exist.level); }
      return;
    }
    const budget = this.limits && this.limits.height != null
      ? this.limits.height - this.model.usage().height : Infinity;
    if (this.buildLevel > budget) {
      this.ui.toast('高さユニットが足りません', 'bad');
      return;
    }
    this.history.push(this.model);
    const cell = this.model.setPart(hit.q, hit.r, type, this.buildCfg, this.buildRot, this.buildLevel);
    this.refresh();
    this.select(cell);
  }

  railAt(hit) {
    const cell = hit.cell;
    if (!cell) { this.ui.toast('パーツをクリックしてください'); return; }
    if (!this.railFrom) {
      this.railFrom = cell;
      this.select(cell);
      this.ui.toast('つなぐ相手をクリック');
      return;
    }
    if (this.railFrom === cell) { this.railFrom = null; this.view.hideRailPreview(); return; }
    const check = this.model.canRail(this.railFrom, cell);
    if (!check.ok) { this.ui.toast(check.why, 'bad'); return; }
    if (this.stockLeft(check.type) <= 0) {
      this.ui.toast(`${RAILS[check.type].name}の残りがありません`, 'bad');
      return;
    }
    this.history.push(this.model);
    this.model.addRail(this.railFrom, cell);
    this.railFrom = null;
    this.view.hideRailPreview();
    this.refresh();
  }

  eraseAt(hit) {
    if (hit.rail) {
      this.history.push(this.model);
      this.model.removeRail(hit.rail);
      this.refresh();
      return;
    }
    if (!hit.cell) return;
    if (hit.cell.locked) { this.ui.toast('お題で固定されたパーツは動かせません', 'bad'); return; }
    this.history.push(this.model);
    this.model.remove(hit.cell);
    this.select(null);
    this.refresh();
  }

  rotate(d) {
    if (this.selected) {
      this.history.push(this.model);
      this.model.rotate(this.selected, d);
      this.refresh();
      this.ui.setSelected(this.selected);
    } else {
      this.buildRot = ((this.buildRot + d) % 6 + 6) % 6;
      if (this.hover) this.onHover(...this._lastPointer());
    }
  }

  variant(d) {
    if (this.selected) {
      this.history.push(this.model);
      this.model.cycleVariant(this.selected, d);
      this.refresh();
      this.ui.setSelected(this.selected);
      this.ui.toast(PARTS[this.selected.type].variants[this.selected.cfg]);
    } else if (this.tool && PARTS[this.tool]) {
      const n = PARTS[this.tool].variants.length;
      this.buildCfg = ((this.buildCfg + d) % n + n) % n;
      this.ui.toast(PARTS[this.tool].variants[this.buildCfg]);
      if (this.hover) this.onHover(...this._lastPointer());
    }
  }

  changeCellLevel(d) {
    if (!this.selected) return;
    this.history.push(this.model);
    if (this.model.setLevel(this.selected, this.selected.level + d)) {
      this.refresh();
      this.select(this.selected);
      this.setBuildLevel(this.selected.level);
    } else {
      this.history.past.pop();
      this.ui.toast('その高さには動かせません', 'bad');
    }
  }

  deleteSelected() {
    if (!this.selected) return;
    if (this.selected.locked) { this.ui.toast('お題で固定されたパーツは消せません', 'bad'); return; }
    this.history.push(this.model);
    this.model.remove(this.selected);
    this.select(null);
    this.refresh();
  }

  undo() {
    const m = this.history.undo(this.model);
    if (!m) return;
    this.model = m;
    this.select(null);
    this.rebuildAll();
  }

  redo() {
    const m = this.history.redo(this.model);
    if (!m) return;
    this.model = m;
    this.select(null);
    this.rebuildAll();
  }

  confirmClear() {
    this.ui.modal('コースを全部消しますか？',
      '<p>置いたパーツとレールをすべて取り除きます。お題で固定されたパーツは残ります。</p>',
      [{ label: 'やめる' }, {
        label: '全部消す', danger: true, onClick: () => {
          this.history.push(this.model);
          this.model.clear();
          this.select(null);
          this.refresh();
        },
      }]);
  }

  changeBalls(d) {
    if (this.challenge) { this.ui.toast('お題ではボールの数は決まっています'); return; }
    this.model.ballCount = clamp(this.model.ballCount + d, 1, SET_INVENTORY.balls);
    this.ui.setBalls(this.model.ballCount);
    if (this.mode === 'play') { this.sim.reset(); this.updateStats(); this.ui.setRunning(false); }
    this.autosave();
  }

  /** 置いてあるパーツ全体が画面に収まるように視点を合わせる */
  frameContent() {
    const cells = [...this.model.cells.values()];
    const cam = this.view.cam, camera = this.view.camera;
    let cx = 0, cz = 0, top = 1.2, rad = 3.2;
    if (cells.length) {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const c of cells) {
        const [x, z] = cellCenter(c.q, c.r);
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
        top = Math.max(top, c.level * H + 0.9);
      }
      cx = (minX + maxX) / 2; cz = (minZ + maxZ) / 2;
      rad = Math.max(3.2, Math.hypot(maxX - minX, maxZ - minZ) / 2 + 1.6);
    }
    const vFov = (camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    // 見下ろす角度で盤面は縦方向に縮んで見えるぶんを考慮する
    const dv = (rad * 0.6 + top * 0.55) / Math.tan(vFov / 2);
    // 縦長の画面は左右がはみ出しても構わない（指で動かせるため）
    const dh = (rad / Math.tan(hFov / 2)) * (camera.aspect >= 1 ? 1 : 0.84);
    // 縦画面は下側を UI が覆うので、コースがやや上に来るよう注視点を下げる
    cam.target.set(cx, Math.min(top * 0.45, 5) * (camera.aspect >= 1 ? 1 : 0.4), cz);
    cam.radius = clamp(Math.max(dv, dh) * 1.1, cam.minRadius, cam.maxRadius);
    cam.update();
  }

  /* ─────────────── 再描画 ─────────────── */

  refresh() {
    this.view.rebuild(this.model);
    this.sim.rebuild();
    this.ui.setUsage(this.model.usage(), this.limits);
    this.ui.setHistory(this.history.canUndo, this.history.canRedo);
    this.autosave();
  }

  rebuildAll() {
    this.sim = new Sim(this.model, this.view);
    this.view.buildBoard(this.model.boardRadius);
    this.refresh();
  }

  autosave() {
    if (this.challenge) return;   // お題中はサンドボックスを上書きしない
    writeJSON(LS.sandbox, this.model.serialize());
  }

  /* ─────────────── プレイ ─────────────── */

  toggleRun() {
    if (this.sim.running) { this.sim.running = false; this.ui.setRunning(false); return; }
    if (this.sim.finished) this.sim.reset();
    const r = this.sim.start();
    if (!r.ok) { this.ui.toast(r.why, 'bad'); return; }
    this.ui.setRunning(true);
    this._judged = false;
  }

  resetRun() {
    this.sim.reset();
    this.ui.setRunning(false);
    this.updateStats();
    this._judged = false;
  }

  updateStats() {
    this.ui.setStats({
      goal: this.sim.stats.goal,
      lost: this.sim.stats.lost,
      stuck: this.sim.stats.stuck,
      active: this.sim.active,
      time: this.sim.time,
    });
  }

  tick(dt) {
    // 最初の数秒のフレームレートを見て、重い端末では影を切る
    if (!this._qualityDone) {
      this._fpsN = (this._fpsN || 0) + 1;
      this._fpsT = (this._fpsT || 0) + dt;
      if (this._fpsT > 2.5) {
        this._qualityDone = true;
        if (this._fpsN / this._fpsT < 26) {
          this.view.setQuality('low');
          this.ui.toast('動きが重いので影をオフにしました');
        }
      }
    }
    if (this.mode === 'play' && this.sim.running) {
      this.sim.update(dt);
      this.updateStats();
      if (this.sim.finished && !this._judged) { this._judged = true; this.judge(); }
    }
    this.view.render();
  }

  judge() {
    this.sim.running = false;
    this.ui.setRunning(false);
    const s = this.sim.stats;
    if (this.challenge) {
      if (s.goal >= this.challenge.need) {
        this.cleared.add(this.challenge.id);
        writeJSON(LS.cleared, [...this.cleared]);
        this.ui.setQuest(this.challenge, { cleared: true });
        this.ui.modal('🎉 クリア！',
          `<p><b>${this.challenge.name}</b> をクリアしました。</p>
           <p>ゴール ${s.goal} 個／${(this.sim.time).toFixed(1)} 秒${s.lost ? `／落下 ${s.lost} 個` : ''}</p>`,
          [{ label: '他のお題を見る', onClick: () => this.showQuests() },
           { label: 'このまま続ける', primary: true }]);
      } else {
        this.ui.toast(`ゴール ${s.goal} 個。あと ${this.challenge.need - s.goal} 個！`, 'bad');
      }
      return;
    }
    if (s.goal > 0) this.ui.toast(`ゴール ${s.goal} 個！ ${this.sim.time.toFixed(1)} 秒`, 'good');
    else this.ui.toast('ゴールにたどり着けませんでした', 'bad');
  }

  /* ─────────────── お題 ─────────────── */

  showQuests() {
    const cards = CHALLENGES.map((c, i) => `
      <button class="ch-card" data-id="${c.id}">
        <div class="n">${i + 1}. ${c.name} ${this.cleared.has(c.id) ? '<span class="clear">✔ クリア</span>' : ''}</div>
        <div class="d">${c.desc}</div>
        <div class="g">${c.goalText}</div>
      </button>`).join('');
    const sheet = this.ui.modal('チャレンジ',
      `<p>スターターとゴールの位置は決まっています。決められたパーツだけでコースを完成させましょう。</p>
       <div class="ch-list">${cards}</div>`,
      [{ label: '自由制作にもどる', onClick: () => this.exitChallenge() }, { label: '閉じる', primary: true }]);
    for (const btn of sheet.querySelectorAll('.ch-card')) {
      btn.onclick = () => { this.ui.closeModal(); this.startChallenge(challengeById(btn.dataset.id)); };
    }
  }

  startChallenge(ch) {
    if (!ch) return;
    this.autosave();
    this.challenge = ch;
    this.model = loadChallenge(ch);
    // お題に書かれていないパーツは使えない（0 個）
    const zero = {};
    for (const id of PART_ORDER) zero[id] = 0;
    for (const id of Object.keys(RAILS)) zero[id] = 0;
    zero.height = 0;
    this.limits = { ...zero, ...ch.limits, balls: SET_INVENTORY.balls };
    this.history.clear();
    this.select(null);
    this.railFrom = null;
    this.rebuildAll();
    this.ui.setBalls(this.model.ballCount);
    this.ui.setQuest(ch, { cleared: this.cleared.has(ch.id) });
    this.setMode('build');
    this.frameContent();
    this.ui.toast(`お題「${ch.name}」を始めます`);
  }

  exitChallenge() {
    this.challenge = null;
    this.limits = { ...SET_INVENTORY };
    this.ui.setQuest(null);
    const saved = readJSON(LS.sandbox, null);
    this.model = saved ? Model.deserialize(saved) : new Model(5);
    if (this.model.isEmpty) this.demoCourse();
    this.history.clear();
    this.select(null);
    this.rebuildAll();
    this.ui.setBalls(this.model.ballCount);
    this.setMode('build');
  }

  showSample() {
    if (!this.challenge) return;
    this.ui.modal('お手本を読み込みますか？',
      '<p>いま作っているコースは置きかわります。お手本を見たあと「作り直す」で自分のコースに挑戦できます。</p>',
      [{ label: 'やめる' }, {
        label: 'お手本を見る', primary: true, onClick: () => {
          this.model = sampleSolution(this.challenge);
          this.history.clear();
          this.select(null);
          this.rebuildAll();
          this.ui.toast('お手本を読み込みました。プレイして動きを見てみよう');
          this.setMode('play');
        },
      }]);
  }

  /* ─────────────── 保存 ─────────────── */

  showSaves() {
    const saves = readJSON(LS.saves, []);
    const rows = saves.length ? saves.map((s, i) => `
      <div class="save-row">
        <span class="nm">${escapeHtml(s.name)}</span>
        <span class="dt">${s.date}</span>
        <button data-load="${i}">読み込む</button>
        <button class="danger" data-del="${i}">削除</button>
      </div>`).join('') : '<p style="color:var(--muted)">まだ保存されたコースはありません。</p>';

    const sheet = this.ui.modal('コースの保存と読み込み',
      `<h3>保存されたコース</h3>${rows}
       <h3>共有コード</h3>
       <p>下のコードをコピーすれば、別の端末や友達とコースを交換できます。</p>
       <textarea id="share-code" spellcheck="false">${escapeHtml(JSON.stringify(this.model.serialize()))}</textarea>`,
      [
        { label: '閉じる' },
        {
          label: 'コードを読み込む', onClick: (sh) => {
            const txt = sh.querySelector('#share-code').value.trim();
            try {
              const m = Model.deserialize(JSON.parse(txt));
              if (!m.cells.size) throw new Error('パーツがありません');
              this.model = m;
              this.challenge = null;
              this.limits = { ...SET_INVENTORY };
              this.ui.setQuest(null);
              this.history.clear();
              this.select(null);
              this.rebuildAll();
              this.ui.setBalls(this.model.ballCount);
              this.ui.toast('コースを読み込みました', 'good');
            } catch {
              this.ui.toast('コードを読み取れませんでした', 'bad');
              return false;
            }
          },
        },
        {
          label: 'このコースを保存', primary: true, onClick: () => {
            const list = readJSON(LS.saves, []);
            const name = 'コース ' + (list.length + 1);
            list.unshift({ name, date: new Date().toLocaleString('ja-JP'), data: this.model.serialize() });
            writeJSON(LS.saves, list.slice(0, 20));
            this.ui.toast('保存しました', 'good');
          },
        },
      ]);

    for (const btn of sheet.querySelectorAll('[data-load]')) {
      btn.onclick = () => {
        const s = readJSON(LS.saves, [])[+btn.dataset.load];
        if (!s) return;
        this.model = Model.deserialize(s.data);
        this.challenge = null;
        this.limits = { ...SET_INVENTORY };
        this.ui.setQuest(null);
        this.history.clear();
        this.select(null);
        this.rebuildAll();
        this.ui.setBalls(this.model.ballCount);
        this.ui.closeModal();
        this.ui.toast('読み込みました', 'good');
      };
    }
    for (const btn of sheet.querySelectorAll('[data-del]')) {
      btn.onclick = () => {
        const list = readJSON(LS.saves, []);
        list.splice(+btn.dataset.del, 1);
        writeJSON(LS.saves, list);
        this.ui.closeModal();
        this.showSaves();
      };
    }
  }

  /* ─────────────── ヘルプ ─────────────── */

  showHelp() {
    this.ui.modal('GraviTrax PRO 3D の遊び方',
      `<p>ラベンスバーガーの立体コース玩具「GraviTrax PRO スターターセット」をモデルにした
        3D コースビルダーです。モーターも電池も使わず、<b>重力だけ</b>でボールをゴールまで導きます。</p>

      <h3>1. 組み立てる</h3>
      <ul>
        <li>左のパレットからパーツを選び、盤面をクリックして置きます。</li>
        <li><b>高さ</b>を変えてから置くと、支柱の上にパーツが乗ります。高いところから低いところへ坂を作るのがコツ。</li>
        <li>同じマスでも高さが ${MIN_GAP} 段以上はなれていれば重ねて置けます（ボルテックスの真下にキャッチャー、など）。</li>
        <li><b>レール</b>を選んで、つなぎたいパーツを 2 つ順番にクリックすると橋がかかります。まっすぐ 2〜4 マス先まで届きます。</li>
        <li>置いたパーツをクリックすると、右側で向き・形・高さを変えたり削除したりできます。</li>
      </ul>

      <h3>2. 転がす</h3>
      <ul>
        <li>上の <b>▶ プレイ</b> に切り替えて <b>スタート</b>。スターターからボールが出ます。</li>
        <li>速すぎるボールは急カーブでコースアウトします。ゆるやかな坂とカーブを選びましょう。</li>
        <li><b>マグネティックキャノン</b>に飛び込むと、反対側のボールが勢いよく飛び出します。スタートより高い場所へ登れる唯一の方法です。</li>
      </ul>

      <h3>3. 操作</h3>
      <ul>
        <li>視点を回す：ドラッグ ／ 移動：右ドラッグ・2 本指 ／ 拡大縮小：ホイール・ピンチ</li>
        <li><kbd>R</kbd> 回転　<kbd>T</kbd> 形状を変える　<kbd>Q</kbd><kbd>E</kbd> 高さ　<kbd>Delete</kbd> 削除</li>
        <li><kbd>Ctrl</kbd>+<kbd>Z</kbd> 元に戻す　<kbd>Ctrl</kbd>+<kbd>Y</kbd> やり直す　<kbd>Space</kbd> スタート／一時停止</li>
        <li><kbd>1</kbd>〜<kbd>9</kbd> パーツの早選び　<kbd>Esc</kbd> 選択解除</li>
      </ul>

      <h3>4. セットの内容</h3>
      <p>パレットの数字は「残り／セットに入っている数」です。実物の PRO スターターセットに合わせて
        カーブ 28・クロス 4・振り分け 4・レール 9/6/3・ボール 6 個などに制限されています。
        <b>チャレンジ</b>では、さらに少ないパーツで課題に挑戦します。</p>
      <p style="color:var(--muted);font-size:11.5px">※ ファンメイドの非公式ゲームです。GraviTrax は Ravensburger AG の登録商標です。</p>`,
      [{ label: 'チャレンジを見る', onClick: () => this.showQuests() }, { label: 'はじめる', primary: true }]);
  }

  /* ─────────────── キーボード ─────────────── */

  _lastPointer() { return [this._px || 0, this._py || 0]; }

  onKey(e) {
    if (this.ui.modalOpen) { if (e.key === 'Escape') this.ui.closeModal(); return; }
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); return e.shiftKey ? this.redo() : this.undo(); }
    if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); return this.redo(); }
    if (e.ctrlKey || e.metaKey) return;
    switch (k) {
      case 'r': this.rotate(e.shiftKey ? -1 : 1); break;
      case 't': this.variant(e.shiftKey ? -1 : 1); break;
      case 'e': this.setBuildLevel(this.buildLevel + 1); break;
      case 'q': this.setBuildLevel(this.buildLevel - 1); break;
      case 'delete': case 'backspace': this.deleteSelected(); break;
      case 'escape': this.select(null); this.pick(this.tool); break;
      case ' ': e.preventDefault(); if (this.mode === 'play') this.toggleRun(); else this.setMode('play'); break;
      case 'b': this.setMode('build'); break;
      default: {
        const n = parseInt(k, 10);
        if (n >= 1 && n <= 9) {
          const ids = [...this.ui.palItems.keys()];
          if (ids[n - 1]) this.pick(ids[n - 1]);
        }
      }
    }
  }
}

function escapeHtml(s) {
  return String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
}

/* ─────────────── 起動 ─────────────── */

export async function start() {
  const canvas = document.getElementById('scene');
  const view = new View(canvas);
  const ui = new UI();
  const app = new App(view, ui);

  // ポインタ位置を覚えておく（回転などのプレビュー更新に使う）
  addEventListener('pointermove', (e) => { app._px = e.clientX; app._py = e.clientY; }, { passive: true });

  app.init();
  window.__gt = app;   // デバッグ用
  window.__core = { cellCenter, H, portPos };

  const boot = document.getElementById('boot');
  boot.classList.add('gone');
  setTimeout(() => boot.remove(), 500);
  return app;
}
