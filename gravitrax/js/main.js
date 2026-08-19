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
    this.buildLevel = 0;
    this.buildRot = 0;
    this.buildCfg = 0;
    this.selected = null;
    this.railFrom = null;
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
    this.setLevel(0);
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
    ui.on('level', (v) => this.setLevel(v));
    ui.on('levelStep', (d) => this.setLevel(this.liftValue + d));
    ui.on('rotate', () => this.rotate(1));
    ui.on('variant', () => this.variant(1));
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
    this.view.cam.onTap = (x, y) => this.onTap(x, y);
    this.view.cam.onHover = (x, y) => this.onHover(x, y);
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
    this.select(null);
    this.railFrom = null;
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
      else this.hint('「スタート」を おして ボールを ころがそう！', 'go');
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
    this.tool = id;
    this.railFrom = null;
    this.view.clearTargets();
    if (PARTS[id]) this.buildCfg = clamp(this.buildCfg, 0, PARTS[id].variants.length - 1);
    this.ui.setTool(this.tool);
    this.select(null);
    this.updateHint();
    if (!silent) { this.sfx.play('tap'); buzz(BUZZ.tap); }
  }

  toggleErase() {
    if (this.selected) return this.deleteSelected();
    this.eraseMode = !this.eraseMode;
    this.railFrom = null;
    this.view.clearTargets();
    this.ui.setTool(this.eraseMode ? 'erase' : this.tool);
    this.updateHint();
    this.sfx.play('tap');
  }

  /** スライダーが今しめしている値 */
  get liftValue() { return this.selected ? this.selected.level : this.buildLevel; }

  setLevel(v) {
    const n = clamp(Math.round(v), 0, MAX_LEVEL);
    if (this.selected) {
      if (n !== this.selected.level) {
        if (!this._levelDrag) { this.history.push(this.model); this._levelDrag = true; }
        if (this.model.setLevel(this.selected, n)) {
          this.buildLevel = n;
          this.refresh();
          this.view.showSelect(this.selected.q, this.selected.r, this.selected.level);
          this.sfx.play('tap');
        }
      }
      clearTimeout(this._levelTimer);
      this._levelTimer = setTimeout(() => { this._levelDrag = false; }, 500);
    } else {
      this.buildLevel = n;
    }
    this.ui.setLevel(this.liftValue, !!this.selected);
  }

  select(cell) {
    this.selected = cell || null;
    this.ui.setSelected(this.selected);
    if (this.selected) {
      this.view.showSelect(this.selected.q, this.selected.r, this.selected.level);
      this.buildLevel = this.selected.level;
    } else this.view.hideSelect();
    this.ui.setLevel(this.liftValue, !!this.selected);
    this.updateHint();
  }

  hint(text, kind = '') {
    this.ui.setHint(text, kind);
    clearTimeout(this._hintTimer);
    // ころがしている あいだは、じゃまに ならないよう すこしで 消す
    if (this.mode === 'play') this._hintTimer = setTimeout(() => this.ui.setHint(''), 3200);
  }

  updateHint() {
    if (this.mode === 'play') return;
    if (this.eraseMode) return this.hint('けしたい パーツを タップしてね', 'pick');
    if (this.tool === 'rail') {
      return this.hint(this.railFrom
        ? 'ひかっている パーツを タップ！'
        : 'つなぎたい パーツを タップしてね', 'pick');
    }
    if (this.selected) {
      return this.hint(`みぎの スライダーで「${PARTS[this.selected.type].short}」の たかさを かえられるよ`);
    }
    const name = PARTS[this.tool] ? PARTS[this.tool].short : '';
    this.hint(`「${name}」を タップした ばしょに おくよ`);
  }

  onHover(x, y) {
    if (this.mode !== 'build' || this.eraseMode || this.tool === 'rail') { this.view.hideGhost(); return; }
    const hit = this.view.pick(x, y);
    if (!hit || !this.model.onBoard(hit.q, hit.r)) { this.view.hideHover(); this.view.hideGhost(); return; }
    this.view.showHover(hit.q, hit.r, hit.cell ? hit.cell.level : null);
    if (PARTS[this.tool]) {
      const ok = this.model.canPlace(hit.q, hit.r, this.buildLevel).ok && this.stockLeft(this.tool) > 0;
      this.view.showGhost(this.tool, this.buildCfg, this.buildRot, hit.q, hit.r, this.buildLevel, ok);
    }
  }

  onTap(x, y) {
    if (this.mode !== 'build') return;
    const hit = this.view.pick(x, y);
    if (!hit || !this.model.onBoard(hit.q, hit.r)) { this.select(null); return; }
    if (this.eraseMode) return this.eraseAt(hit);
    if (this.tool === 'rail') return this.railAt(hit);
    if (PARTS[this.tool] && this.model.canPlace(hit.q, hit.r, this.buildLevel).ok) return this.placeAt(hit);
    if (hit.cell) { this.select(hit.cell); this.sfx.play('tap'); buzz(BUZZ.tap); return; }
    this.select(null);
  }

  stockLeft(id) {
    if (id === 'rail') {
      return RAIL_ORDER.reduce((a, r) => a + this.stockLeft(r), 0);
    }
    if (!this.limits || this.limits[id] == null) return Infinity;
    return this.limits[id] - (this.model.usage()[id] || 0);
  }

  placeAt(hit) {
    const type = this.tool;
    if (this.stockLeft(type) <= 0) return this.nope(`${PARTS[type].short}は もう ぜんぶ つかったよ`);
    const budget = this.limits && this.limits.height != null
      ? this.limits.height - this.model.usage().height : Infinity;
    if (this.buildLevel > budget) return this.nope('たかさの ざいりょうが たりないよ');
    this.history.push(this.model);
    const cell = this.model.setPart(hit.q, hit.r, type, this.buildCfg, this.buildRot, this.buildLevel);
    this.refresh();
    this.select(cell);
    this.sfx.play('place');
    buzz(BUZZ.place);
  }

  railAt(hit) {
    const cell = hit.cell;
    if (!this.railFrom) {
      if (!cell) return this.nope('パーツを タップしてね');
      const targets = this.model.railTargets(cell);
      if (!targets.length) return this.nope('この パーツから つなげる あいてが いないよ');
      this.railFrom = cell;
      this.view.showSelect(cell.q, cell.r, cell.level);
      this.view.showTargets(targets);
      this.updateHint();
      this.sfx.play('tap'); buzz(BUZZ.tap);
      return;
    }
    if (cell === this.railFrom || !cell) {
      this.railFrom = null;
      this.view.clearTargets();
      this.view.hideSelect();
      this.updateHint();
      return;
    }
    const chk = this.model.probeRail(this.railFrom, cell);
    if (!chk.ok) return this.nope(chk.why);
    if (this.stockLeft(chk.type) <= 0) {
      return this.nope(`${RAILS[chk.type].name}が もう ないよ`);
    }
    this.history.push(this.model);
    this.model.smartRail(this.railFrom, cell);
    this.railFrom = null;
    this.view.clearTargets();
    this.view.hideSelect();
    this.refresh();
    this.updateHint();
    this.sfx.play('connect');
    buzz(BUZZ.connect);
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
    if (!this.selected) { this.buildRot = (this.buildRot + d + 6) % 6; this.sfx.play('rotate'); return; }
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
    this.railFrom = null;
    this.view.clearTargets();
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
      this.hint('つづきは もういちど 「スタート」', 'go');
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
        this.hint(`ゴールは ${s.goal}こ。あと ${need - s.goal}こ！ もういちど やってみよう`, 'pick');
        this.ui.toast(`あと ${need - s.goal}こ！`, 'bad');
      }
      return;
    }
    if (s.goal > 0) {
      this.ui.toast(`ゴール ${s.goal}こ！ ${this.sim.time.toFixed(1)}びょう`, 'good');
      this.hint(`やったね！ ゴール ${s.goal}こ`, 'go');
    } else {
      this.ui.toast('ゴールに とどかなかったよ', 'bad');
      this.hint('「つくる」に もどって、さかを ゆるやかに してみよう', 'pick');
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
    this.railFrom = null;
    this.rebuildAll();
    this.ui.setBalls(this.model.ballCount);
    this.ui.setQuest(ch, { cleared: this.cleared.has(ch.id) });
    this.mode = 'play'; this.setMode('build');
    this.frameContent();
    this.hint(ch.desc, 'pick');
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

      <div class="step"><span class="n">1</span><p><b>パーツを えらぶ</b><br>したの れつから えらんで、がめんを タップすると おけるよ。</p></div>
      <div class="step"><span class="n">2</span><p><b>たかさを かえる</b><br>おいた パーツは えらばれた じょうたい。みぎの スライダーを うごかすと 上下する。<br>
        <b>たかい ところから ひくい ところへ</b> ならべるのが コツ！</p></div>
      <div class="step"><span class="n">3</span><p><b>レールで つなぐ</b><br>「レール」を えらんで、つなぎたい パーツを 2つ タップ。<br>
        パーツの むきは <b>じどうで そろう</b>から、きにしなくて だいじょうぶ。</p></div>
      <div class="step"><span class="n">4</span><p><b>ころがす！</b><br>みどりの ボタンを おすと ボールが でてくるよ。</p></div>

      <h3>ゆびの つかいかた</h3>
      <ul>
        <li>1ぽんゆびで うごかす … ぐるっと まわして みる</li>
        <li>2ほんゆびで つまむ … 大きく・小さく する</li>
        <li>2ほんゆびで うごかす … よこに ずらす</li>
      </ul>

      <h3>おぼえておくと つよい</h3>
      <ul>
        <li>はやすぎる ボールは <b>キュッと まがる みち</b>で とび出しちゃう</li>
        <li><b>キャノン</b>に とびこむと、はんたいがわの ボールが ビュン！ スタートより <b>上に のぼれる</b> ゆいいつの ほうほう</li>
        <li>おなじ ばしょでも たかさが はなれていれば パーツを <b>かさねて おける</b>（うずまきの 下に うけざら、など）</li>
        <li>パーツの かずは ほんものの セットと おなじ。ふだを みると のこりが わかるよ</li>
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
      case 'e': this.setLevel(this.liftValue + 1); break;
      case 'q': this.setLevel(this.liftValue - 1); break;
      case 'delete': case 'backspace': this.deleteSelected(); break;
      case 'escape': this.select(null); this.railFrom = null; this.view.clearTargets(); this.updateHint(); break;
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
