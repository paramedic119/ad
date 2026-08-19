/**
 * ui.js — 画面まわり（スマホ縦持ち向け）
 *
 * 10 さいくらいの子が読んで迷わないことを最優先にしている。
 *  ・むずかしい漢字を使わない
 *  ・ボタンはとにかく大きく、親指の届く下側にまとめる
 *  ・「つぎに何をすればいいか」を、いつも 1 行のヒントで出す
 * ロジックは持たず、操作を on(...) のコールバックで通知する。
 */
import { PARTS, RAIL_ORDER } from './parts.js';
import { MAX_LEVEL } from './core.js';

/* ─────────────── アイコン ─────────────── */

const HEX = '30,25 17,32.5 4,25 4,10 17,2.5 30,10';
const P = { 0: [30, 17.5], 1: [23.5, 28.7], 2: [10.5, 28.7], 3: [4, 17.5], 4: [10.5, 6.3], 5: [23.5, 6.3] };

const svg = (inner, color = '#c3cad3') => `<svg viewBox="0 0 34 35" aria-hidden="true">
  <polygon points="${HEX}" fill="${color}" fill-opacity=".3" stroke="${color}" stroke-width="1.6"/>${inner}</svg>`;
const arc = (a, b, c = '#fff', w = 3) =>
  `<path d="M${P[a][0]},${P[a][1]} Q17,17.5 ${P[b][0]},${P[b][1]}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/>`;

export const ICONS = {
  curve: () => svg(arc(3, 1), PARTS.curve.color),
  cross: () => svg(arc(3, 0) + arc(4, 1), PARTS.cross.color),
  splitter: () => svg(
    `<path d="M4,17.5 L17,17.5 M17,17.5 L23.5,28.7 M17,17.5 L23.5,6.3" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`,
    PARTS.splitter.color),
  starter: () => svg(`<path d="M12,10 L25,17.5 L12,25 Z" fill="#eafff0"/>`, PARTS.starter.color),
  goal: () => svg(`<circle cx="17" cy="17.5" r="8.5" fill="none" stroke="#fff6ec" stroke-width="2.4"/><circle cx="17" cy="17.5" r="3.4" fill="#fff6ec"/>`, PARTS.goal.color),
  catcher: () => svg(`<path d="M8,10 Q17,27 26,10" fill="none" stroke="#fffdf0" stroke-width="3" stroke-linecap="round"/><circle cx="17" cy="7" r="2.6" fill="#fffdf0"/>`, PARTS.catcher.color),
  freefall: () => svg(`<circle cx="17" cy="18" r="6.6" fill="none" stroke="#ffeae6" stroke-width="2.6"/><path d="M17,7 L17,13 M14.4,10.6 L17,13.4 L19.6,10.6" fill="none" stroke="#ffeae6" stroke-width="2.4" stroke-linecap="round"/>`, PARTS.freefall.color),
  vortex: () => svg(`<path d="M26,17.5 A9,9 0 1 1 17,8.5 A6.4,6.4 0 1 0 23.4,17.5 A3.4,3.4 0 1 1 17,14.2" fill="none" stroke="#f7ecff" stroke-width="2.4" stroke-linecap="round"/>`, PARTS.vortex.color),
  cannon: () => svg(`<rect x="20" y="12" width="5.5" height="11" rx="1.5" fill="#ffe2e6"/><path d="M5,17.5 L17,17.5 M12.4,13.9 L16.4,17.5 L12.4,21.1" fill="none" stroke="#ffe2e6" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>`, PARTS.cannon.color),
  rail: () => `<svg viewBox="0 0 34 35" aria-hidden="true">
    <path d="M5,12 L29,21" stroke="#aab4c0" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M5,17 L29,26" stroke="#aab4c0" stroke-width="2.6" stroke-linecap="round"/>
    <circle cx="5" cy="14.5" r="3.6" fill="#6b7684"/>
    <circle cx="29" cy="23.5" r="3.6" fill="#6b7684"/></svg>`,
};

export const TRAY_ORDER = ['curve', 'rail', 'starter', 'goal', 'splitter', 'cross', 'catcher', 'freefall', 'vortex', 'cannon'];

const iconFor = (id) => (ICONS[id] || ICONS.curve)();
const labelFor = (id) => (id === 'rail' ? 'レール' : (PARTS[id].short || PARTS[id].name));

/* ─────────────── DOM ヘルパー ─────────────── */

const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};
const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

/* ─────────────── UI 本体 ─────────────── */

export class UI {
  constructor() {
    this._h = new Map();
    this.cards = new Map();
    this.build();
  }

  on(name, fn) { this._h.set(name, fn); return this; }
  emit(name, ...a) { const f = this._h.get(name); if (f) f(...a); }

  build() {
    const b = document.body;
    const g = (id) => document.getElementById(id);

    /* ── うえのバー ── */
    const hdr = el('div'); hdr.id = 'hdr';
    hdr.innerHTML = `
      <button class="hbtn" id="b-help" aria-label="あそびかた">?</button>
      <button class="hbtn" id="b-cam" aria-label="ぜんたいを みる">⛶</button>
      <div id="score">
        <span class="s-item"><em>🏁</em><b id="s-goal">0</b><i id="s-total">/0</i></span>
        <span class="s-item"><em>⏱</em><b id="s-time">0.0</b></span>
      </div>
      <div class="grow"></div>
      <button class="hbtn" id="b-quest" aria-label="ちょうせん">🏅</button>
      <button class="hbtn" id="b-save" aria-label="ほぞん">💾</button>
      <button class="hbtn" id="b-sound" aria-label="おと">🔊</button>`;
    b.appendChild(hdr);

    /* ── お題バナー ── */
    this.quest = el('div'); this.quest.id = 'quest';
    b.appendChild(this.quest);

    /* ── たかさスライダー（右はし） ── */
    const lift = el('div'); lift.id = 'lift';
    lift.innerHTML = `
      <button class="lift-btn" id="lift-up" aria-label="たかく">▲</button>
      <div id="lift-track"><div id="lift-fill"></div><div id="lift-knob"></div></div>
      <button class="lift-btn" id="lift-down" aria-label="ひくく">▼</button>
      <div id="lift-cap">たかさ<b id="lift-val">0</b></div>`;
    b.appendChild(lift);
    this.lift = lift;

    /* ── ヒント ── */
    this.hint = el('div'); this.hint.id = 'hint';
    b.appendChild(this.hint);

    /* ── したのドック ── */
    const dock = el('div'); dock.id = 'dock';
    dock.innerHTML = `
      <div id="tray"></div>
      <div id="acts">
        <button class="act" data-a="undo"><i>↩</i><span>もどす</span></button>
        <button class="act" data-a="rotate"><i>🔄</i><span>まわす</span></button>
        <button class="act" data-a="variant"><i>◆</i><span>かたち</span></button>
        <button class="act" data-a="erase"><i>🧹</i><span>けす</span></button>
      </div>
      <div id="ballrow">
        <span class="brow-lb">ボールの かず</span>
        <button class="bstep" id="ball-down">−</button>
        <b id="ball-val">4</b>
        <button class="bstep" id="ball-up">＋</button>
      </div>
      <div id="mainrow">
        <button id="b-swap"></button>
        <button id="b-go"></button>
      </div>`;
    b.appendChild(dock);
    this.dock = dock;

    /* ── トースト・モーダル ── */
    this.toastBox = el('div'); this.toastBox.id = 'toast';
    b.appendChild(this.toastBox);
    this.modalBox = el('div'); this.modalBox.id = 'modal';
    this.modalBox.addEventListener('pointerdown', (e) => { if (e.target === this.modalBox) this.closeModal(); });
    b.appendChild(this.modalBox);

    this.buildTray();

    /* ── 配線 ── */
    g('b-help').onclick = () => this.emit('help');
    g('b-cam').onclick = () => this.emit('camera');
    g('b-quest').onclick = () => this.emit('quests');
    g('b-save').onclick = () => this.emit('saves');
    g('b-sound').onclick = () => this.emit('sound');
    g('ball-up').onclick = () => this.emit('balls', +1);
    g('ball-down').onclick = () => this.emit('balls', -1);
    g('b-swap').onclick = () => this.emit('swapMode');
    g('b-go').onclick = () => this.emit('go');
    g('lift-up').onclick = () => this.emit('levelStep', +1);
    g('lift-down').onclick = () => this.emit('levelStep', -1);
    for (const btn of dock.querySelectorAll('.act')) {
      btn.onclick = () => this.emit(btn.dataset.a);
    }
    this.btn = {
      go: g('b-go'), swap: g('b-swap'), sound: g('b-sound'),
      undo: dock.querySelector('[data-a="undo"]'),
      rotate: dock.querySelector('[data-a="rotate"]'),
      variant: dock.querySelector('[data-a="variant"]'),
      erase: dock.querySelector('[data-a="erase"]'),
      liftVal: g('lift-val'), liftFill: g('lift-fill'), liftKnob: g('lift-knob'),
      ball: g('ball-val'), goal: g('s-goal'), total: g('s-total'), time: g('s-time'),
    };
    this._wireLift(g('lift-track'));
  }

  buildTray() {
    const tray = document.getElementById('tray');
    for (const id of TRAY_ORDER) {
      const card = el('button', 'card');
      card.dataset.id = id;
      card.innerHTML = `<div class="ic">${iconFor(id)}</div><div class="nm">${labelFor(id)}</div><div class="ct"></div>`;
      card.onclick = () => this.emit('pick', id);
      tray.appendChild(card);
      this.cards.set(id, card);
    }
  }

  /** たかさスライダーを指でつまめるようにする */
  _wireLift(track) {
    const set = (e) => {
      const r = track.getBoundingClientRect();
      const t = 1 - (e.clientY - r.top) / r.height;
      this.emit('level', Math.round(Math.max(0, Math.min(1, t)) * MAX_LEVEL));
    };
    let on = false;
    track.style.touchAction = 'none';
    track.addEventListener('pointerdown', (e) => { on = true; track.setPointerCapture(e.pointerId); set(e); });
    track.addEventListener('pointermove', (e) => { if (on) set(e); });
    const off = () => { on = false; };
    track.addEventListener('pointerup', off);
    track.addEventListener('pointercancel', off);
  }

  /* ─────────────── 更新 ─────────────── */

  setMode(mode) {
    document.body.dataset.mode = mode;
    this.btn.swap.innerHTML = mode === 'build' ? '<i>▶</i><span>ころがす</span>' : '<i>🔧</i><span>つくる</span>';
    if (mode === 'build') {
      this.btn.go.className = 'big go';
      this.btn.go.innerHTML = '<i>▶</i>ころがす！';
    } else {
      this.btn.go.className = 'big go';
      this.btn.go.innerHTML = '<i>▶</i>スタート';
    }
    if (mode !== 'build') this.setSelected(null);
  }

  setRunning(on) {
    this.btn.go.innerHTML = on ? '<i>⏸</i>ちょっと まつ' : '<i>▶</i>スタート';
    this.btn.go.classList.toggle('pause', on);
  }

  setTool(tool) {
    for (const [id, card] of this.cards) card.classList.toggle('on', tool === id);
    this.btn.erase.classList.toggle('on', tool === 'erase');
  }

  setUsage(usage, limits) {
    const left = (id) => (limits && limits[id] != null ? limits[id] - (usage[id] || 0) : null);
    for (const [id, card] of this.cards) {
      const ct = card.querySelector('.ct');
      let n = null;
      if (id === 'rail') {
        const parts = RAIL_ORDER.map(left).filter((v) => v != null);
        n = parts.length ? parts.reduce((a, c) => a + c, 0) : null;
      } else n = left(id);
      if (n == null) { ct.textContent = ''; card.classList.remove('out'); continue; }
      ct.textContent = n;
      card.classList.toggle('out', n <= 0);
      ct.classList.toggle('zero', n <= 0);
    }
  }

  setLevel(n, forSelected = false) {
    this.btn.liftVal.textContent = n;
    const pct = (n / MAX_LEVEL) * 100;
    this.btn.liftFill.style.height = pct + '%';
    this.btn.liftKnob.style.bottom = `calc(${pct}% - 15px)`;
    this.lift.classList.toggle('sel', forSelected);
  }

  setSelected(cell) {
    this._sel = cell || null;
    const has = !!cell;
    this.btn.rotate.disabled = !has;
    this.btn.variant.disabled = !has || PARTS[cell.type].variants.length < 2;
  }

  setHistory(canUndo) { this.btn.undo.disabled = !canUndo; }
  setBalls(n) { this.btn.ball.textContent = n; }
  setSound(on) { this.btn.sound.textContent = on ? '🔊' : '🔇'; this.btn.sound.classList.toggle('off', !on); }

  setStats(s) {
    this.btn.goal.textContent = s.goal;
    this.btn.total.textContent = '/' + s.need;
    this.btn.time.textContent = s.time.toFixed(1);
    document.getElementById('score').classList.toggle('win', s.need > 0 && s.goal >= s.need);
  }

  setHint(text, kind = '') {
    this.hint.textContent = text || '';
    this.hint.className = kind;
    this.hint.style.display = text ? '' : 'none';
  }

  setQuest(ch, state) {
    if (!ch) { this.quest.classList.remove('show'); return; }
    this.quest.classList.add('show');
    this.quest.innerHTML = `
      <div class="q-top"><span class="q-tag">おだい</span><b>${esc(ch.name)}</b>${state.cleared ? '<span class="q-ok">クリア！</span>' : ''}</div>
      <div class="q-goal">${esc(ch.goalText)}</div>
      <div class="q-act">
        <button data-a="hint">ヒント</button>
        <button data-a="sample">おてほん</button>
        <button data-a="retry">やりなおす</button>
        <button data-a="quit">やめる</button>
      </div>`;
    for (const btn of this.quest.querySelectorAll('[data-a]')) {
      btn.onclick = () => this.emit('quest:' + btn.dataset.a);
    }
  }

  toast(msg, kind = '') {
    const t = el('div', 'toast ' + kind, esc(msg));
    this.toastBox.appendChild(t);
    setTimeout(() => { t.classList.add('out'); }, 1900);
    setTimeout(() => t.remove(), 2400);
  }

  modal(title, html, actions = [{ label: 'とじる' }]) {
    const sheet = el('div', 'sheet');
    sheet.innerHTML = `<h2>${title}</h2><div class="sbody">${html}</div><div class="acts"></div>`;
    const acts = sheet.querySelector('.acts');
    for (const a of actions) {
      const btn = el('button', a.primary ? 'primary' : (a.danger ? 'danger' : ''), a.label);
      btn.onclick = () => { if (!a.onClick || a.onClick(sheet) !== false) this.closeModal(); };
      acts.appendChild(btn);
    }
    this.modalBox.innerHTML = '';
    this.modalBox.appendChild(sheet);
    this.modalBox.classList.add('show');
    return sheet;
  }

  closeModal() { this.modalBox.classList.remove('show'); this.modalBox.innerHTML = ''; }
  get modalOpen() { return this.modalBox.classList.contains('show'); }
}

export { iconFor, labelFor, esc };
