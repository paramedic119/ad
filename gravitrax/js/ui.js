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

    /* ── ドラッグ中に指のそばに出るふきだし ── */
    this.badge = el('div'); this.badge.id = 'badge';
    b.appendChild(this.badge);

    /* ── ヒント ── */
    this.hint = el('div'); this.hint.id = 'hint';
    b.appendChild(this.hint);

    /* ── したのドック ── */
    const dock = el('div'); dock.id = 'dock';
    dock.innerHTML = `
      <div id="tray"></div>
      <div id="ballrow">
        <span class="brow-lb">ボールの かず</span>
        <button class="bstep" id="ball-down">−</button>
        <b id="ball-val">4</b>
        <button class="bstep" id="ball-up">＋</button>
      </div>
      <div id="mainrow">
        <button class="act" data-a="undo"><i>↩</i><span>もどす</span></button>
        <button class="act" data-a="rotate"><i>🔄</i><span>まわす</span></button>
        <button class="act" data-a="erase"><i>🧹</i><span>けす</span></button>
        <button id="b-swap"></button>
        <button id="b-go"></button>
      </div>`;
    b.appendChild(dock);
    this.dock = dock;

    /* ── トースト・モーダル ── */
    this.modalBox = el('div'); this.modalBox.id = 'modal';
    this.modalBox.addEventListener('pointerdown', (e) => { if (e.target === this.modalBox) this.closeModal(); });
    b.appendChild(this.modalBox);

    this.buildTray();
    this.measureDock();
    addEventListener('resize', () => this.measureDock());

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
    for (const btn of dock.querySelectorAll('.act')) {
      btn.onclick = () => this.emit(btn.dataset.a);
    }
    this.btn = {
      go: g('b-go'), swap: g('b-swap'), sound: g('b-sound'),
      undo: dock.querySelector('[data-a="undo"]'),
      rotate: dock.querySelector('[data-a="rotate"]'),
      variant: dock.querySelector('[data-a="variant"]'),
      erase: dock.querySelector('[data-a="erase"]'),
      ball: g('ball-val'), goal: g('s-goal'), total: g('s-total'), time: g('s-time'),
    };
  }

  buildTray() {
    const tray = document.getElementById('tray');
    for (const id of TRAY_ORDER) {
      const card = el('button', 'card');
      card.dataset.id = id;
      card.innerHTML = `<div class="ic">${iconFor(id)}</div><div class="nm">${labelFor(id)}</div><div class="ct"></div>`;
      this._wireCard(card, id);
      tray.appendChild(card);
      this.cards.set(id, card);
    }
  }

  /**
   * カードは「つまんで ばんに はこぶ」もの。
   *
   * ただし よこに ならんだ カードの列は 指で スクロールしたい。
   * そこで CSS の touch-action: pan-x と組み合わせ、
   *   よこ方向のドラッグ → ブラウザに任せてトレイをスクロール
   *   たて方向（上）のドラッグ → パーツを持ち上げて ばんへ運ぶ
   * と、動かした向きで役わりを分ける。ばんは トレイの 上にあるので、
   * 「上へ引っぱり出す」のは 自然な動きになる。
   */
  _wireCard(card, id) {
    let on = false, sx = 0, sy = 0, dragging = false, pid = null;
    const stop = () => {
      on = false; dragging = false; pid = null;
      card.classList.remove('lift');
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', cancel);
    };
    const move = (e) => {
      if (!on || e.pointerId !== pid) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!dragging) {
        // よこに動いたらスクロール。手を引いてブラウザに任せる。
        if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy)) return stop();
        if (Math.abs(dy) < 12) return;
        dragging = true;
        card.classList.add('lift');
        this.emit('cardDragStart', id, e.clientX, e.clientY);
      }
      e.preventDefault();
      this.emit('cardDrag', e.clientX, e.clientY);
    };
    const up = (e) => {
      if (!on || e.pointerId !== pid) return;
      const wasDragging = dragging;
      stop();
      if (wasDragging) this.emit('cardDrop', e.clientX, e.clientY, false);
      else this.emit('pick', id);
    };
    const cancel = (e) => {
      if (!on || e.pointerId !== pid) return;
      const wasDragging = dragging;
      stop();
      if (wasDragging) this.emit('cardDrop', e.clientX, e.clientY, true);
    };
    card.addEventListener('pointerdown', (e) => {
      if (card.classList.contains('out')) { this.emit('pick', id); return; }
      on = true; dragging = false; pid = e.pointerId;
      sx = e.clientX; sy = e.clientY;
      addEventListener('pointermove', move, { passive: false });
      addEventListener('pointerup', up);
      addEventListener('pointercancel', cancel);
    });
  }

  /** 指のそばに出すふきだし */
  showBadge(x, y, text, kind = '') {
    this.badge.textContent = text;
    this.badge.className = 'show ' + kind;
    const w = this.badge.offsetWidth || 90;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, x - w / 2));
    this.badge.style.left = left + 'px';
    this.badge.style.top = Math.max(8, y - 74) + 'px';
  }

  hideBadge() { this.badge.className = ''; }

  /* ─────────────── 更新 ─────────────── */

  setMode(mode) {
    document.body.dataset.mode = mode;
    this.btn.swap.innerHTML = mode === 'build' ? '<i>▶</i><span>ころがす</span>' : '<i>🔧</i><span>つくる</span>';
    if (mode !== 'build') this.hideBadge();
    if (mode === 'build') {
      this.btn.go.className = 'big go';
      this.btn.go.innerHTML = '<i>▶</i>ころがす！';
    } else {
      this.btn.go.className = 'big go';
      this.btn.go.innerHTML = '<i>▶</i>スタート';
    }
    if (mode !== 'build') this.setSelected(null);
    this.measureDock();
  }

  /** ドックの高さを実際に測って CSS に伝える（ヒントが隠れないように） */
  measureDock() {
    requestAnimationFrame(() => {
      const h = this.dock ? this.dock.offsetHeight : 0;
      if (h) document.documentElement.style.setProperty('--dock-h', h + 'px');
      const tray = document.getElementById('tray');
      if (tray) tray.classList.toggle('scrollable', tray.scrollWidth > tray.clientWidth + 4);
    });
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
    const cap = (id) => (limits && limits[id] != null ? limits[id] : null);
    for (const [id, card] of this.cards) {
      const ct = card.querySelector('.ct');
      let max = null, left = null;
      if (id === 'rail') {
        const caps = RAIL_ORDER.map(cap);
        if (caps.every((v) => v != null)) {
          max = caps.reduce((a, c) => a + c, 0);
          left = max - RAIL_ORDER.reduce((a, r) => a + (usage[r] || 0), 0);
        }
      } else if (cap(id) != null) {
        max = cap(id);
        left = max - (usage[id] || 0);
      }
      // そもそも 0 個しか持てないパーツは、カードごと出さない（お題のとき）
      card.classList.toggle('gone', max === 0);
      if (left == null) { ct.textContent = ''; card.classList.remove('out'); continue; }
      ct.textContent = left;
      card.classList.toggle('out', left <= 0);
      ct.classList.toggle('zero', left <= 0);
    }
    this.measureDock();
  }

  setSelected(cell) {
    this._sel = cell || null;
    this.btn.rotate.disabled = !cell;
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
    this._hintSaved = null;
    clearTimeout(this._toastTimer);
    this._showHint(text, kind);
  }

  _showHint(text, kind = '') {
    this.hint.textContent = text || '';
    this.hint.className = kind || '';
    this.hint.style.display = text ? '' : 'none';
    this.measureDock();
  }

  setQuest(ch, state) {
    if (!ch) { this.quest.classList.remove('show'); return; }
    this.quest.classList.add('show');
    this.quest.innerHTML = `
      <button class="q-head">
        <span class="q-tag">おだい</span>
        <b>${esc(ch.name)}</b>
        <span class="q-goal">${esc(ch.goalText)}</span>
        ${state.cleared ? '<span class="q-ok">✓</span>' : ''}
        <span class="q-chev">⌄</span>
      </button>
      <div class="q-act">
        <button data-a="hint">ヒント</button>
        <button data-a="sample">おてほん</button>
        <button data-a="retry">やりなおす</button>
        <button data-a="quit">やめる</button>
      </div>`;
    this.quest.classList.remove('open');
    this.quest.querySelector('.q-head').onclick = () => {
      this.quest.classList.toggle('open');
      this.measureDock();
    };
    for (const btn of this.quest.querySelectorAll('.q-act [data-a]')) {
      btn.onclick = () => this.emit('quest:' + btn.dataset.a);
    }
  }

  /**
   * 知らせ。ヒントと同じ場所を一時的に借りる。
   * 帯が 2 本 出ると どちらを読めばいいか分からなくなるので、必ず 1 本にする。
   */
  toast(msg, kind = '') {
    clearTimeout(this._toastTimer);
    if (!this._hintSaved) this._hintSaved = { text: this.hint.textContent, kind: this.hint.className };
    this._showHint(msg, kind + ' pop');
    this._toastTimer = setTimeout(() => {
      const h = this._hintSaved;
      this._hintSaved = null;
      if (h) this._showHint(h.text, h.kind);
    }, 2300);
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
