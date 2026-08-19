/**
 * main.js — アプリ本体
 *
 * 操作の考えかた（こども向け）:
 *   1. したの列からパーツをえらぶ
 *   2. がめんをタップして置く（置いたパーツはそのまま「えらばれた」状態になる）
 *   3. 右のスライダーで、そのパーツの たかさ を上げ下げする
 *   4. 「レール」をえらんで、つなぎたいパーツを 2 つタップ
 *      → むきや かたち は じどうで そろう（いちばん むずかしいところを機械にやらせる）
 */
import * as THREE from 'three';
import { H, HEX_W, MAX_LEVEL, clamp, cellCenter } from './core.js';
import { PARTS, RAILS, RAIL_ORDER, SET_INVENTORY } from './parts.js';
import { Model, History } from './model.js';
import { View } from './view.js';
import { Sim } from './sim.js';
import { UI, TRAY_ORDER, esc } from './ui.js';
import { Sfx, buzz, BUZZ } from './audio.js';
import { CHALLENGES, loadChallenge, sampleSolution, challengeById } from './challenges.js';

const LS = { sandbox: 'gt3d.sandbox', saves: 'gt3d.saves', cleared: 'gt3d.cleared', seen: 'gt3d.seen2', sound: 'gt3d.sound' };
const readJSON = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* いっぱいなら何もしない */ } };

class App {
  constructor(view, ui) {
    this.view = view;
    this.ui = ui;
    this.sfx = new Sfx();
    this.mode = 'build';
    this.tool = 'curve';
    this.selected = null;
    this.targets = [];
    this.drag = null;
    this.eraseMode = false;
    this.challenge = null;
    this.cleared = new Set(readJSON(LS.cleared, []));
    this.soundOn = readJSON(LS.sound, true);
    this.history = new History();
    this.limits = { ...SET_INVENTORY };
    this.model = new Model(5);
    this.sim = new Sim(this.model, view);
  }

  /* ─────────────── はじめる ─────────────── */

  init() {
    const saved = readJSON(LS.sandbox, null);
    if (saved) { try { this.model = Model.deserialize(saved); } catch { this.model = new Model(5); } }
    if (this.model.isEmpty) this.demoCourse();

    this.sim = new Sim(this.model, this.view);
    this.sim.onEvent = (t, b) => this.onSimEvent(t, b);
    this.view.buildBoard(this.model.boardRadius);
    this.refresh();
    this.frameContent();

    this.wireUI();
    this.wireInput();
    this.mode = null;
    this.setMode('build');
    this.ui.setBalls(this.model.ballCount);
    this.ui.setSound(this.soundOn);
    this.sfx.setEnabled(this.soundOn);
    this.pick('curve', true);

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

  demoCourse() {
    const m = this.model;
    m.clearAll();
    m.boardRadius = 5;
    m.ballCount = 4;
    const st = m.setPart(0, -4, 'starter', 0, 1, 18);
    const c1 = m.setPart(0, -2, 'curve', 1, 4, 14);
    const c2 = m.setPart(3, -2, 'curve', 2, 3, 10);
    const vx = m.setPart(3, 1, 'vortex', 0, 4, 6);
    const ca = m.setPart(3, 1, 'catcher', 0, 3, 0);
    const gl = m.setPart(0, 1, 'goal', 0, 0, 0);
    m.addRail(st, c1); m.addRail(c1, c2); m.addRail(c2, vx); m.addRail(ca, gl);
  }

  /* ─────────────── UI をつなぐ ─────────────── */

  wireUI() {
    const ui = this.ui;
    ui.on('pick', (id) => this.pick(id));
    ui.on('cardDragStart', (id, x, y) => this.startPlaceDrag(id, x, y));
    ui.on('cardDrag', (x, y) => this.updateDrag(x, y));
    ui.on('cardDrop', (x, y, cancel) => this.endDrag(x, y, cancel));
    ui.on('rotate', () => this.rotate(1));
    ui.on('undo', () => this.undo());
    ui.on('erase', () => this.toggleErase());
    ui.on('go', () => this.onGo());
    ui.on('swapMode', () => this.setMode(this.mode === 'build' ? 'play' : 'build'));
    ui.on('balls', (d) => this.changeBalls(d));
    ui.on('camera', () => { this.frameContent(); this.sfx.play('tap'); });
    ui.on('sound', () => this.toggleSound());
    ui.on('help', () => this.showHelp());
    ui.on('quests', () => this.showQuests());
    ui.on('saves', () => this.showSaves());
    ui.on('quest:hint', () => this.ui.toast('💡 ' + this.challenge.hint));
    ui.on('quest:sample', () => this.showSample());
    ui.on('quest:retry', () => this.startChallenge(this.challenge));
    ui.on('quest:quit', () => this.exitChallenge());
  }

  wireInput() {
    const cam = this.view.cam;
    cam.onTap = (x, y) => this.onTap(x, y);
    cam.onHover = (x, y) => this.onHover(x, y);
    cam.hitTest = (x, y) => this.canGrab(x, y);
    cam.onDragStart = (x, y) => this.startSceneDrag(x, y);
    cam.onDrag = (x, y) => this.updateDrag(x, y);
    cam.onDragEnd = (x, y, cancel) => this.endDrag(x, y, cancel);
    const unlock = () => { this.sfx.unlock(); this.sfx.setEnabled(this.soundOn); };
    addEventListener('pointerdown', unlock, { once: true });
    addEventListener('keydown', (e) => this.onKey(e));
    addEventListener('beforeunload', () => this.autosave());
  }

  /* ─────────────── モード ─────────────── */

  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.ui.setMode(mode);
    this.view.hideGhost();
    this.view.hideHover();
    this.view.clearTargets();
    this.view.clearSpots();
    this.view.hideHandle();
    this.ui.hideBadge();
    this.drag = null;
    this.select(null);
    this.eraseMode = false;
    this.ui.setTool(this.tool);
    if (mode === 'play') {
      this.sim.reset();
      this.ui.setRunning(false);
      this.view.followEnabled = true;
      this.updateStats();
      const p = this.model.playable;
      if (!p.starter) this.hint('スタートの パーツが ないよ。「つくる」で おいてね', 'pick');
      else if (!p.goal) this.hint('ゴールが ないよ。「つくる」で おいてね', 'pick');
      else this.hint('「スタート」を おそう！', 'go');
    } else {
      this.sim.running = false;
      this.sfx.stopRolling();
      this.sim.reset();
      this.autosave();
      this.updateHint();
    }
    this.sfx.play('tap');
  }

  onGo() {
    if (this.mode === 'build') { this.setMode('play'); this.toggleRun(); return; }
    this.toggleRun();
  }

  /* ─────────────── つくる ─────────────── */

  pick(id, silent = false) {
    this.eraseMode = false;
    this.tool = PARTS[id] ? id : null;
    this.ui.setTool(id);
    this.updateHint();
    if (!silent) { this.sfx.play('tap'); buzz(BUZZ.tap); }
    if (id === 'rail') {
      this.ui.toast('パーツを タップすると あいてが 光るよ');
      this.ui.setTool(null);
    } else if (PARTS[id]) {
      this.hint(`「${PARTS[id].short}」を つまんで ばんに はこんでね`, 'pick');
    }
  }

  toggleErase() {
    if (this.selected) return this.deleteSelected();
    this.eraseMode = !this.eraseMode;
    this.ui.setTool(this.eraseMode ? 'erase' : this.tool);
    if (this.eraseMode) this.select(null);
    this.updateHint();
    this.sfx.play('tap');
  }

  /* ── えらぶ ── */

  select(cell) {
    this.selected = cell || null;
    this.ui.setSelected(this.selected);
    if (this.selected) {
      this.view.showSelect(this.selected.q, this.selected.r, this.selected.level);
      // お題で固定されたパーツは高さも変えられない
      if (this.selected.locked) this.view.hideHandle();
      else this.view.showHandle(this.selected);
      this.targets = this.model.railTargets(this.selected);
      this.view.showTargets(this.targets);
      // つなげる相手がいないときは、置けばつながる場所を教える
      this.spots = this.targets.length ? [] : this.model.railSpots(this.selected);
      this.view.showSpots(this.spots);
    } else {
      this.view.hideSelect();
      this.view.hideHandle();
      this.view.clearTargets();
      this.view.clearSpots();
      this.targets = [];
      this.spots = [];
    }
    this.updateHint();
  }

  hint(text, kind = '') {
    this.ui.setHint(text, kind);
    clearTimeout(this._hintTimer);
    if (this.mode === 'play') this._hintTimer = setTimeout(() => this.ui.setHint(''), 3200);
  }

  updateHint() {
    if (this.mode === 'play') return;
    if (this.eraseMode) return this.hint('けしたい ものを タップしてね', 'pick');
    if (this.selected) {
      if (this.targets && this.targets.length) {
        return this.hint('光っている パーツを タップ！', 'pick');
      }
      if (this.spots && this.spots.length) {
        return this.hint('水いろの ばしょに パーツを おくと つながるよ', 'pick');
      }
      if (this.selected.locked) return this.hint('この パーツは うごかせないよ');
      return this.hint('金の とってを つまむと たかさが かわる');
    }
    this.hint('カードを つまんで ばんに はこんでね');
  }

  /* ── 指でつまむ ── */

  /** 指の下に掴めるものがあるか（カメラを回すか、掴むかの分かれ道） */
  canGrab(x, y) {
    if (this.mode !== 'build' || this.eraseMode) return false;
    const hit = this.view.pick(x, y);
    if (!hit) return false;
    if (hit.handle) return !!this.selected;
    return !!(hit.cell && !hit.cell.locked);
  }

  /** ばんの中のものを掴みはじめた */
  startSceneDrag(x, y) {
    const probe = this.view.pick(x, y);
    if (this.selected && probe && probe.handle) {
      this.history.push(this.model);
      this.drag = { kind: 'height', cell: this.selected, startLevel: this.selected.level, startY: y };
      this.view.hideHandle();
      this.view.clearTargets();
      this.view.clearSpots();
      this.sfx.play('tap');
      return;
    }
    if (!probe || !probe.cell || probe.cell.locked) return;
    this.history.push(this.model);
    this.drag = { kind: 'move', cell: probe.cell };
    this.view.setCellVisible(probe.cell, false);
    this.view.hideSelect();
    this.view.hideHandle();
    this.view.clearTargets();
    this.view.clearSpots();
    this.sfx.play('tap');
    buzz(BUZZ.tap);
    this.updateDrag(x, y);
  }

  /** カードをつまんで運びはじめた */
  startPlaceDrag(id, x, y) {
    if (this.mode !== 'build' || !PARTS[id]) return;
    if (this.stockLeft(id) <= 0) return this.nope(`${PARTS[id].short}は もう ぜんぶ つかったよ`);
    this.eraseMode = false;
    this.tool = id;
    this.ui.setTool(id);
    this.select(null);
    this.drag = { kind: 'place', type: id, cfg: 0, rot: 0 };
    this.sfx.play('tap');
    this.updateDrag(x, y);
  }

  updateDrag(x, y) {
    const d = this.drag;
    if (!d) return;
    if (d.kind === 'height') return this.updateHeightDrag(y);

    const hit = this.view.pick(x, y);
    if (!hit || !this.model.onBoard(hit.q, hit.r)) {
      this.view.hideGhost(); this.view.hideHover(); this.ui.hideBadge();
      d.ok = false;
      return;
    }
    const type = d.kind === 'place' ? d.type : d.cell.type;
    const ignore = d.kind === 'move' ? d.cell : null;
    // 高さは自動でおすすめを出す（動かしているときは今の高さをできるだけ保つ）
    let lv = d.kind === 'move' && this.model.canPlace(hit.q, hit.r, d.cell.level, ignore).ok
      ? d.cell.level
      : this.model.suggestLevel(hit.q, hit.r, this.defaultLevel(type));
    const can = this.model.canPlace(hit.q, hit.r, lv, ignore);
    const stock = d.kind === 'place' ? this.stockLeft(type) > 0 : true;
    d.q = hit.q; d.r = hit.r; d.level = lv; d.ok = can.ok && stock;

    this.view.showHover(hit.q, hit.r, null);
    this.view.showGhost(type,
      d.kind === 'place' ? d.cfg : d.cell.cfg,
      d.kind === 'place' ? d.rot : d.cell.rot,
      hit.q, hit.r, lv, d.ok);
    this.ui.showBadge(x, y, d.ok ? `たかさ ${lv}` : (can.ok ? 'もう ないよ' : can.why), d.ok ? '' : 'bad');
  }

  updateHeightDrag(y) {
    const d = this.drag;
    const lv = clamp(d.startLevel + Math.round(this.view.pxToLevels(y - d.startY)), 0, MAX_LEVEL);
    if (lv !== d.cell.level && this.model.setLevel(d.cell, lv)) {
      this.view.rebuild(this.model);
      this.view.showSelect(d.cell.q, d.cell.r, d.cell.level);
      this.sfx.play('tap');
    }
    const g = this.gradeOf(d.cell);
    this.ui.showBadge(this.view.canvas.clientWidth / 2, y,
      `たかさ ${d.cell.level}` + (g ? '\n' + g.text : ''), g ? g.kind : '');
  }

  endDrag(x, y, cancelled) {
    const d = this.drag;
    this.drag = null;
    this.ui.hideBadge();
    this.view.hideGhost();
    this.view.hideHover();
    if (!d) return;

    if (d.kind === 'height') {
      this.refresh();
      this.select(d.cell);
      const g = this.gradeOf(d.cell);
      if (g) this.hint(g.text, g.kind === 'good' ? 'go' : 'pick');
      buzz(BUZZ.place);
      return;
    }

    if (cancelled || !d.ok) {
      if (d.kind === 'move') this.view.setCellVisible(d.cell, true);
      this.history.past.pop();
      if (d.kind === 'move') this.select(d.cell);
      return;
    }

    if (d.kind === 'place') {
      const cell = this.model.setPart(d.q, d.r, d.type, d.cfg, d.rot, d.level);
      this.refresh();
      this.select(cell);
    } else {
      this.model.moveTo(d.cell, d.q, d.r, d.level);
      this.refresh();
      this.select(d.cell);
    }
    this.sfx.play('place');
    buzz(BUZZ.place);
  }

  /** キーボードから たかさを 1 段ずつ動かす（パソコン用） */
  nudgeLevel(d) {
    if (!this.selected) return;
    this.history.push(this.model);
    if (this.model.setLevel(this.selected, this.selected.level + d)) {
      this.refresh();
      this.select(this.selected);
      const g = this.gradeOf(this.selected);
      if (g) this.hint(g.text, g.kind === 'good' ? 'go' : 'pick');
    } else this.history.past.pop();
  }

  /** そのパーツに繋がっているレールの、坂ぐあいのまとめ */
  gradeOf(cell) {
    const rails = this.model.railsOf(cell);
    if (!rails.length) return null;
    const gm = this.model.gradeMap();
    const g = rails.map((l) => gm.get(l));
    if (g.includes('up')) return { kind: 'bad', text: 'のぼりざか！ ボールは のぼれないよ' };
    if (g.includes('flat')) return { kind: 'bad', text: 'たいらすぎて とまっちゃう' };
    if (g.includes('steep')) return { kind: 'warn', text: 'ちょっと きゅうかも' };
    if (g.includes('gentle')) return { kind: 'warn', text: 'すこし ゆるいかも' };
    return { kind: 'good', text: 'ころがる さかだよ！' };
  }

  /** はじめて置くときの、めやすの高さ */
  defaultLevel(type) {
    if (type === 'goal') return 0;
    if (type === 'starter') return 14;
    return 8;
  }

  /* ── タップ ── */

  onTap(x, y) {
    if (this.mode !== 'build') return;
    const hit = this.view.pick(x, y, this.eraseMode);
    if (!hit || !this.model.onBoard(hit.q, hit.r)) return this.select(null);
    if (this.eraseMode) return this.eraseAt(hit);

    if (hit.cell) {
      // 光っている あいてなら レールで つなぐ
      if (this.selected && this.targets && this.targets.includes(hit.cell)) {
        return this.makeRail(this.selected, hit.cell);
      }
      this.select(hit.cell);
      this.sfx.play('tap'); buzz(BUZZ.tap);
      return;
    }
    // 何もないマスを タップ：えらんだ カードが あれば そこに置く
    if (this.tool && PARTS[this.tool]) return this.quickPlace(hit);
    this.select(null);
  }

  quickPlace(hit) {
    const type = this.tool;
    if (this.stockLeft(type) <= 0) return this.nope(`${PARTS[type].short}は もう ぜんぶ つかったよ`);
    const lv = this.model.suggestLevel(hit.q, hit.r, this.defaultLevel(type));
    const can = this.model.canPlace(hit.q, hit.r, lv);
    if (!can.ok) return this.nope(can.why);
    this.history.push(this.model);
    const cell = this.model.setPart(hit.q, hit.r, type, 0, 0, lv);
    this.refresh();
    this.select(cell);
    this.sfx.play('place'); buzz(BUZZ.place);
  }

  makeRail(a, b) {
    const chk = this.model.probeRail(a, b);
    if (!chk.ok) return this.nope(chk.why);
    if (this.stockLeft(chk.type) <= 0) return this.nope(`${RAILS[chk.type].name}が もう ないよ`);
    this.history.push(this.model);
    this.model.smartRail(a, b);
    this.refresh();
    this.select(b);           // つづけて つなげられるように、つないだ先を えらぶ
    this.sfx.play('connect');
    buzz(BUZZ.connect);
    const g = this.gradeOf(b);
    if (g && g.kind !== 'good') this.ui.toast(g.text, 'bad');
  }

  stockLeft(id) {
    if (id === 'rail') return RAIL_ORDER.reduce((t, r) => t + this.stockLeft(r), 0);
    if (!this.limits || this.limits[id] == null) return Infinity;
    return this.limits[id] - (this.model.usage()[id] || 0);
  }

  onHover(x, y) {
    if (this.mode !== 'build' || this.drag) return;
    const hit = this.view.pick(x, y);
    if (!hit || !this.model.onBoard(hit.q, hit.r)) { this.view.hideHover(); return; }
    this.view.showHover(hit.q, hit.r, hit.cell ? hit.cell.level : null);
  }

  eraseAt(hit) {
    if (hit.rail) {
      this.history.push(this.model);
      this.model.removeRail(hit.rail);
      this.refresh();
      this.sfx.play('erase'); buzz(BUZZ.erase);
      return;
    }
    if (!hit.cell) return;
    if (hit.cell.locked) return this.nope('この パーツは おだいで きまっているよ');
    this.history.push(this.model);
    this.model.remove(hit.cell);
    this.select(null);
    this.refresh();
    this.sfx.play('erase'); buzz(BUZZ.erase);
  }

  rotate(d) {
    if (!this.selected) return;
    this.history.push(this.model);
    this.model.rotate(this.selected, d);
    this.refresh();
    this.sfx.play('rotate'); buzz(BUZZ.tap);
  }

  variant(d) {
    if (!this.selected) return;
    this.history.push(this.model);
    this.model.cycleVariant(this.selected, d);
    this.refresh();
    this.ui.toast(PARTS[this.selected.type].variants[this.selected.cfg]);
    this.sfx.play('rotate');
  }

  deleteSelected() {
    if (!this.selected) return;
    if (this.selected.locked) return this.nope('この パーツは おだいで きまっているよ');
    this.history.push(this.model);
    this.model.remove(this.selected);
    this.select(null);
    this.refresh();
    this.sfx.play('erase'); buzz(BUZZ.erase);
  }

  undo() {
    const m = this.history.undo(this.model);
    if (!m) return;
    this.model = m;
    this.select(null);
    this.rebuildAll();
    this.sfx.play('tap');
  }

  nope(msg) { this.ui.toast(msg, 'bad'); this.sfx.play('error'); buzz(BUZZ.error); }

  changeBalls(d) {
    if (this.challenge) return this.nope('おだいでは ボールの かずは きまっているよ');
    this.model.ballCount = clamp(this.model.ballCount + d, 1, SET_INVENTORY.balls);
    this.ui.setBalls(this.model.ballCount);
    if (this.mode === 'play') { this.sim.reset(); this.updateStats(); this.ui.setRunning(false); }
    this.autosave();
    this.sfx.play('tap');
  }

  /* ─────────────── 再描画 ─────────────── */

  refresh() {
    this.view.rebuild(this.model);
    this.sim.rebuild();
    this.ui.setUsage(this.model.usage(), this.limits);
    this.ui.setHistory(this.history.canUndo);
    this.autosave();
  }

  rebuildAll() {
    this.view.clearBurst();
    this.sim = new Sim(this.model, this.view);
    this.sim.onEvent = (t, b) => this.onSimEvent(t, b);
    this.view.buildBoard(this.model.boardRadius);
    this.refresh();
  }

  autosave() {
    if (this.challenge) return;
    writeJSON(LS.sandbox, this.model.serialize());
  }

  frameContent() {
    const cells = [...this.model.cells.values()];
    const cam = this.view.cam, camera = this.view.camera;
    // なにも置いていないときは、盤ぜんたいが見えるようにする
    let cx = 0, cz = 0, top = 1.2, rad = this.model.boardRadius * HEX_W * 0.62 + 2;
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
    // UI に隠れていない範囲にコースが収まるようにする
    const vp0 = this.view.viewport();
    const dv = (rad * 0.6 + top * 0.55) / (Math.tan(vFov / 2) * vp0.visFrac);
    const dh = (rad / Math.tan(hFov / 2)) * (camera.aspect >= 1 ? 1 : 0.85);
    cam.radius = clamp(Math.max(dv, dh) * 1.08, cam.minRadius, cam.maxRadius);
    const vp = this.view.viewport();     // 距離が決まってからずらし量を計算する
    cam.target.set(cx, Math.min(top * 0.5, 5) + vp.shiftY, cz);
    cam.userPanned = false;
    cam.update();
  }

  /* ─────────────── ころがす ─────────────── */

  toggleRun() {
    if (this.sim.running) {
      this.sim.running = false;
      this.sfx.stopRolling();
      this.ui.setRunning(false);
      this.hint('もういちど「スタート」で つづき', 'go');
      return;
    }
    if (this.sim.finished) this.sim.reset();
    const r = this.sim.start();
    if (!r.ok) return this.nope('スタートの パーツを おいてね');
    this.view.cam.userPanned = false;
    this.view.clearBurst();
    this.ui.setRunning(true);
    this.hint('ボールを おいかけよう！');
    this._judged = false;
    this.sfx.play('start');
  }

  updateStats() {
    this.ui.setStats({
      goal: this.sim.stats.goal,
      need: this.challenge ? this.challenge.need : this.model.ballCount,
      time: this.sim.time,
    });
  }

  onSimEvent(type, ball) {
    switch (type) {
      case 'goal':
        this.sfx.play('goal'); buzz(BUZZ.goal);
        this.view.burstAt(ball.pos, 0xffd25a);
        break;
      case 'cannon': this.sfx.play('cannon'); buzz(BUZZ.place); break;
      case 'catch': this.sfx.play('catch'); break;
      case 'derail': this.sfx.play('derail'); break;
      case 'lost': this.sfx.play('lost'); break;
      default: break;
    }
  }

  tick(dt) {
    if (this.mode === 'play' && this.sim.running) {
      this.sim.update(dt);
      this.updateStats();
      let speed = 0;
      let lead = null;
      for (const b of this.sim.balls) {
        if (b.mode === 'path') speed += Math.abs(b.v);
        else if (b.mode === 'free') speed += b.vel.length() * 0.4;
        if ((b.mode === 'path' || b.mode === 'free') && (!lead || b.pos.y < lead.pos.y)) lead = b;
      }
      this.sfx.rolling(speed);
      if (lead) this.view.followBall(lead.pos, dt);
      if (this.sim.finished && !this._judged) { this._judged = true; this.judge(); }
    }
    this.view.update(dt);
    this.view.render();
  }

  judge() {
    this.sim.running = false;
    this.sfx.stopRolling();
    this.ui.setRunning(false);
    const s = this.sim.stats;
    const need = this.challenge ? this.challenge.need : 1;
    if (this.challenge) {
      if (s.goal >= need) {
        this.cleared.add(this.challenge.id);
        writeJSON(LS.cleared, [...this.cleared]);
        this.ui.setQuest(this.challenge, { cleared: true });
        this.sfx.play('clear'); buzz(BUZZ.clear);
        this.ui.modal('🎉 クリア！',
          `<p><b>${esc(this.challenge.name)}</b> が できました！</p>
           <p>ゴール ${s.goal}こ ／ ${this.sim.time.toFixed(1)}びょう${s.lost ? ` ／ おちた ${s.lost}こ` : ''}</p>`,
          [{ label: 'ほかの おだい', onClick: () => this.showQuests() },
           { label: 'もっと あそぶ', primary: true }]);
      } else {
        this.hint(`あと ${need - s.goal}こ！ もういちど`, 'pick');
        this.ui.toast(`あと ${need - s.goal}こ！`, 'bad');
      }
      return;
    }
    if (s.goal > 0) {
      this.ui.toast(`ゴール ${s.goal}こ！ ${this.sim.time.toFixed(1)}びょう`, 'good');
      this.hint(`やったね！ ゴール ${s.goal}こ`, 'go');
    } else {
      this.ui.toast('ゴールに とどかなかったよ', 'bad');
      this.hint('「つくる」で さかを なおしてみよう', 'pick');
    }
  }

  /* ─────────────── おだい ─────────────── */

  showQuests() {
    const cards = CHALLENGES.map((c, i) => `
      <button class="ch-card ${this.cleared.has(c.id) ? 'done' : ''}" data-id="${c.id}">
        <div class="n">${i + 1}. ${esc(c.name)} ${this.cleared.has(c.id) ? '<span class="clear">クリア！</span>' : ''}</div>
        <div class="g">${esc(c.goalText)}</div>
      </button>`).join('');
    const sheet = this.ui.modal('ちょうせん',
      `<p>スタートと ゴールの ばしょは きまっています。きめられた パーツだけで つないでみよう！</p>
       <div class="ch-list">${cards}</div>`,
      [{ label: 'じゆうに つくる', onClick: () => this.exitChallenge() }, { label: 'とじる', primary: true }]);
    for (const btn of sheet.querySelectorAll('.ch-card')) {
      btn.onclick = () => { this.ui.closeModal(); this.startChallenge(challengeById(btn.dataset.id)); };
    }
  }

  startChallenge(ch) {
    if (!ch) return;
    this.autosave();
    this.challenge = ch;
    this.model = loadChallenge(ch);
    const zero = {};
    for (const id of TRAY_ORDER) if (PARTS[id]) zero[id] = 0;
    for (const id of RAIL_ORDER) zero[id] = 0;
    zero.height = 0;
    this.limits = { ...zero, ...ch.limits, balls: SET_INVENTORY.balls };
    this.history.clear();
    this.select(null);
    this.rebuildAll();
    this.ui.setBalls(this.model.ballCount);
    this.ui.setQuest(ch, { cleared: this.cleared.has(ch.id) });
    this.mode = 'play'; this.setMode('build');
    this.frameContent();
    this.ui.toast(ch.desc, 'pick');   // 帯を占領しないよう、みじかく出して消す
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
    this.mode = 'play'; this.setMode('build');
    this.frameContent();
  }

  showSample() {
    if (!this.challenge) return;
    this.ui.modal('おてほんを みる？',
      '<p>いま つくって いる コースは きえてしまうよ。「やりなおす」で また ちょうせん できます。</p>',
      [{ label: 'やめる' }, {
        label: 'みる', primary: true, onClick: () => {
          this.model = sampleSolution(this.challenge);
          this.history.clear();
          this.select(null);
          this.rebuildAll();
          this.frameContent();
          this.mode = 'build'; this.setMode('play');
          this.hint('「スタート」を おして うごきを みてみよう', 'go');
        },
      }]);
  }

  /* ─────────────── ほぞん ─────────────── */

  showSaves() {
    const saves = readJSON(LS.saves, []);
    const rows = saves.length ? saves.map((s, i) => `
      <div class="save-row"><span class="nm">${esc(s.name)}<br><span class="dt">${esc(s.date)}</span></span>
        <button data-load="${i}">ひらく</button><button class="danger" data-del="${i}">けす</button></div>`).join('')
      : '<p style="color:var(--muted)">まだ ほぞんした コースは ないよ。</p>';
    const sheet = this.ui.modal('ほぞん と よみこみ',
      `<h3>ほぞんした コース</h3>${rows}
       <h3>あいことば（コース の データ）</h3>
       <p>したの もじを コピーすれば、ほかの スマホや ともだちに コースを わたせるよ。</p>
       <textarea id="share-code" spellcheck="false">${esc(JSON.stringify(this.model.serialize()))}</textarea>`,
      [
        { label: 'とじる' },
        { label: 'よみこむ', onClick: (sh) => this.importCode(sh.querySelector('#share-code').value) },
        {
          label: 'ほぞんする', primary: true, onClick: () => {
            const list = readJSON(LS.saves, []);
            list.unshift({ name: 'コース ' + (list.length + 1), date: new Date().toLocaleString('ja-JP'), data: this.model.serialize() });
            writeJSON(LS.saves, list.slice(0, 20));
            this.ui.toast('ほぞん したよ！', 'good');
            this.sfx.play('goal');
          },
        },
      ]);
    for (const btn of sheet.querySelectorAll('[data-load]')) {
      btn.onclick = () => {
        const s = readJSON(LS.saves, [])[+btn.dataset.load];
        if (s) { this.loadModel(Model.deserialize(s.data)); this.ui.closeModal(); this.ui.toast('ひらいたよ！', 'good'); }
      };
    }
    for (const btn of sheet.querySelectorAll('[data-del]')) {
      btn.onclick = () => {
        const list = readJSON(LS.saves, []);
        list.splice(+btn.dataset.del, 1);
        writeJSON(LS.saves, list);
        this.ui.closeModal(); this.showSaves();
      };
    }
  }

  importCode(txt) {
    try {
      const m = Model.deserialize(JSON.parse(txt.trim()));
      if (!m.cells.size) throw new Error('からっぽ');
      this.loadModel(m);
      this.ui.toast('よみこんだよ！', 'good');
    } catch {
      this.nope('あいことばが よめなかったよ');
      return false;
    }
  }

  loadModel(m) {
    this.model = m;
    this.challenge = null;
    this.limits = { ...SET_INVENTORY };
    this.ui.setQuest(null);
    this.history.clear();
    this.select(null);
    this.rebuildAll();
    this.ui.setBalls(this.model.ballCount);
    this.frameContent();
    this.mode = 'play'; this.setMode('build');
  }

  toggleSound() {
    this.soundOn = !this.soundOn;
    writeJSON(LS.sound, this.soundOn);
    this.sfx.unlock();
    this.sfx.setEnabled(this.soundOn);
    this.ui.setSound(this.soundOn);
    if (this.soundOn) this.sfx.play('start');
  }

  /* ─────────────── あそびかた ─────────────── */

  showHelp() {
    this.ui.modal('あそびかた',
      `<p>でんちも モーターも つかいません。<b>おもさ（じゅうりょく）だけ</b>で ボールを ゴールまで はこぼう！</p>

      <div class="step"><span class="n">1</span><p><b>カードを つまんで はこぶ</b><br>
        したの カードを ゆびで つまんだまま、ばんの うえまで はこんで はなす。<br>
        <b>たかさは じどうで きまる</b>から、いいかんじの さかに なるよ。</p></div>

      <div class="step"><span class="n">2</span><p><b>パーツを タップして つなぐ</b><br>
        パーツを タップすると、つなげる あいてが <b style="color:#ffd25a">金いろに ひかる</b>。<br>
        ひかった あいてを タップ すれば レールで つながる。つづけて タップ していけば どんどん のびるよ。<br>
        パーツの むきは じどうで そろうから きにしなくて だいじょうぶ。</p></div>

      <div class="step"><span class="n">•</span><p><b>あいてが いないとき</b><br>
        レールは <b>2〜4 マス さき</b>までしか とどかない。とおすぎる ときは
        <b style="color:#6fd8ff">水いろに ひかった ばしょ</b>に パーツを おこう。そこに おけば つながるよ。</p></div>

      <div class="step"><span class="n">3</span><p><b>たかさを かえる</b><br>
        えらんだ パーツの うえに でる <b>金いろの とって</b>を、上下に つまんで うごかす。</p></div>

      <div class="step"><span class="n">4</span><p><b>レールの いろを みる</b><br>
        <span style="color:#9aa5b2">はいいろ</span>＝ちょうどいい　
        <span style="color:#ffc93c">きいろ</span>＝ゆるい／きゅう　
        <span style="color:#ff6b6b">あか</span>＝のぼりざか、ボールは のぼれない<br>
        あかい レールが あったら、たかさを かえて なおそう。</p></div>

      <div class="step"><span class="n">5</span><p><b>ころがす！</b><br>
        みどりの ボタンを おすと ボールが でてくるよ。</p></div>

      <h3>ゆびの つかいかた</h3>
      <ul>
        <li><b>おきまちがえても だいじょうぶ</b> … おいた パーツも つまんで はこべば うごかせる</li>
        <li>なにもない ところを 1本ゆびで うごかす … ぐるっと まわして みる</li>
        <li>2本ゆびで つまむ・うごかす … 大きく／小さく、よこに ずらす</li>
        <li>まちがえたら <b>もどす</b> ボタン</li>
      </ul>

      <h3>おぼえておくと つよい</h3>
      <ul>
        <li>はやすぎる ボールは <b>キュッと まがる みち</b>で とび出しちゃう</li>
        <li><b>キャノン</b>に とびこむと はんたいがわの ボールが ビュン！ スタートより <b>上に のぼれる</b> ゆいいつの ほうほう</li>
        <li>おなじ ばしょでも たかさが はなれていれば パーツを <b>かさねて おける</b>（うずまきの 下に うけざら、など）</li>
        <li>パーツの かずは ほんものの セットと おなじ。ふだの すうじが のこりの かず</li>
      </ul>
      <p style="color:var(--muted);font-size:12px">※ ファンが つくった ひこうしきの ゲームです。GraviTrax は Ravensburger AG の しょうひょうです。</p>`,
      [{ label: 'ちょうせんを みる', onClick: () => this.showQuests() }, { label: 'あそぶ！', primary: true }]);
  }

  /* ─────────────── キーボード（パソコン用） ─────────────── */

  onKey(e) {
    if (this.ui.modalOpen) { if (e.key === 'Escape') this.ui.closeModal(); return; }
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); return this.undo(); }
    if (e.ctrlKey || e.metaKey) return;
    switch (k) {
      case 'r': this.rotate(e.shiftKey ? -1 : 1); break;
      case 't': this.variant(1); break;
      case 'e': this.nudgeLevel(+1); break;
      case 'q': this.nudgeLevel(-1); break;
      case 'delete': case 'backspace': this.deleteSelected(); break;
      case 'escape': this.select(null); this.updateHint(); break;
      case ' ': e.preventDefault(); this.onGo(); break;
      case 'b': this.setMode('build'); break;
      default: {
        const n = parseInt(k, 10);
        if (n >= 1 && n <= 9 && TRAY_ORDER[n - 1]) this.pick(TRAY_ORDER[n - 1]);
      }
    }
  }
}

/* ─────────────── 起動 ─────────────── */

export async function start() {
  const canvas = document.getElementById('scene');
  const view = new View(canvas);
  const ui = new UI();
  const app = new App(view, ui);
  app.init();
  window.__gt = app;
  window.__core = { cellCenter, H, THREE };

  const boot = document.getElementById('boot');
  boot.classList.add('gone');
  setTimeout(() => boot.remove(), 500);
  return app;
}
