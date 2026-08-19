/**
 * ui.js — 画面まわり（DOM）
 * パレット、上下のバー、インスペクタ、HUD、モーダル、トースト。
 * ロジックは持たず、操作を on(...) のコールバックで通知する。
 */
import { PARTS, PART_ORDER, RAILS, RAIL_ORDER } from './parts.js';

/* ─────────────── アイコン ─────────────── */

const HEX = '22.5,18.5 13,24 3.5,18.5 3.5,7.5 13,2 22.5,7.5';
const P = { 0: [22.5, 13], 1: [17.75, 21.2], 2: [8.25, 21.2], 3: [3.5, 13], 4: [8.25, 4.8], 5: [17.75, 4.8] };

function svg(inner, color = '#c3cad3') {
  return `<svg viewBox="0 0 26 26" aria-hidden="true">
    <polygon points="${HEX}" fill="${color}" fill-opacity=".22" stroke="${color}" stroke-width="1.1"/>
    ${inner}</svg>`;
}
const line = (a, b, c = '#eaf3ff', w = 2) =>
  `<path d="M${P[a][0]},${P[a][1]} Q13,13 ${P[b][0]},${P[b][1]}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/>`;

export const ICONS = {
  curve: () => svg(line(3, 1), PARTS.curve.color),
  cross: () => svg(line(3, 0) + line(4, 1), PARTS.cross.color),
  splitter: () => svg(
    `<path d="M3.5,13 L13,13" fill="none" stroke="#eaf3ff" stroke-width="2" stroke-linecap="round"/>` +
    `<path d="M13,13 L17.75,21.2 M13,13 L17.75,4.8" fill="none" stroke="#eaf3ff" stroke-width="2" stroke-linecap="round"/>`,
    PARTS.splitter.color),
  starter: () => svg(`<path d="M9.5,8 L18.5,13 L9.5,18 Z" fill="#eaffef"/>`, PARTS.starter.color),
  goal: () => svg(`<circle cx="13" cy="13" r="6" fill="none" stroke="#fff2e2" stroke-width="1.6"/><circle cx="13" cy="13" r="2.4" fill="#fff2e2"/>`, PARTS.goal.color),
  catcher: () => svg(`<path d="M6.5,8 Q13,20 19.5,8" fill="none" stroke="#fffbe8" stroke-width="2" stroke-linecap="round"/><circle cx="13" cy="6" r="2" fill="#fffbe8"/>`, PARTS.catcher.color),
  freefall: () => svg(`<circle cx="13" cy="13" r="5" fill="none" stroke="#ffe6e2" stroke-width="1.8"/><path d="M13,6 L13,10 M11,8.4 L13,10.4 L15,8.4" fill="none" stroke="#ffe6e2" stroke-width="1.6" stroke-linecap="round"/>`, PARTS.freefall.color),
  vortex: () => svg(`<path d="M20,13 A7,7 0 1 1 13,6 A5,5 0 1 0 17.4,13 A2.6,2.6 0 1 1 13,10.6" fill="none" stroke="#f3e8ff" stroke-width="1.6" stroke-linecap="round"/>`, PARTS.vortex.color),
  cannon: () => svg(`<rect x="15.5" y="9" width="4" height="8" rx="1" fill="#ffd9de"/><path d="M4,13 L13,13 M9.6,10.4 L12.6,13 L9.6,15.6" fill="none" stroke="#ffd9de" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>`, PARTS.cannon.color),
  rail: (span) => {
    const x2 = 4 + span * 5.4;
    return `<svg viewBox="0 0 26 26" aria-hidden="true">
      <path d="M4,10 L${x2},15" stroke="#9aa5b2" stroke-width="1.7" stroke-linecap="round"/>
      <path d="M4,14 L${x2},19" stroke="#9aa5b2" stroke-width="1.7" stroke-linecap="round"/>
      <circle cx="4" cy="12" r="2.4" fill="#5f6a78"/><circle cx="${x2}" cy="17" r="2.4" fill="#5f6a78"/></svg>`;
  },
  erase: () => `<svg viewBox="0 0 26 26" aria-hidden="true">
    <path d="M7,9 L19,9 L18,21 L8,21 Z" fill="none" stroke="#ff9a9a" stroke-width="1.7" stroke-linejoin="round"/>
    <path d="M10,6 L16,6 M5,9 L21,9" stroke="#ff9a9a" stroke-width="1.7" stroke-linecap="round"/></svg>`,
};

const iconFor = (id) =>
  RAILS[id] ? ICONS.rail(RAILS[id].span) : id === 'erase' ? ICONS.erase() : (ICONS[id] || ICONS.curve)();

/* ─────────────── UI 本体 ─────────────── */

const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};

export class UI {
  constructor() {
    this._h = new Map();
    this.build();
  }

  on(name, fn) { this._h.set(name, fn); return this; }
  emit(name, ...a) { const f = this._h.get(name); if (f) f(...a); }

  /* ── DOM 構築 ── */
  build() {
    const b = document.body;

    /* 上部バー */
    const top = el('div'); top.id = 'topbar';
    top.innerHTML = `
      <div class="brand">GraviTrax <span>PRO 3D</span></div>
      <div class="modes panel">
        <button id="m-build" class="on">🔧 <span class="hide-xs">組み立て</span></button>
        <button id="m-play">▶ <span class="hide-xs">プレイ</span></button>
      </div>
      <div class="grow"></div>
      <button id="b-quest" class="panel">🏅 <span class="hide-xs">チャレンジ</span></button>
      <button id="b-save" class="panel">💾 <span class="hide-xs">保存</span></button>
      <button id="b-help" class="panel">？</button>`;
    b.appendChild(top);

    /* パレット */
    const pal = el('div', 'panel'); pal.id = 'palette';
    pal.innerHTML = '<h3>パーツ</h3><div class="pal-scroll"></div>';
    b.appendChild(pal);
    this.palScroll = pal.querySelector('.pal-scroll');
    this.palette = pal;
    this.palItems = new Map();
    this.buildPalette();

    /* 下部バー */
    const bot = el('div', 'panel'); bot.id = 'bottombar';
    bot.innerHTML = `
      <div class="build-only stepper">
        <span class="lbl">高さ</span>
        <button id="lv-down" title="低く (Q)">▼</button>
        <span class="val" id="lv-val">0</span>
        <button id="lv-up" title="高く (E)">▲</button>
      </div>
      <div class="build-only sep"></div>
      <button class="build-only" id="b-rot" title="回転 (R)">↻ <span class="hide-xs">回転</span></button>
      <button class="build-only" id="b-var" title="形状を変える (T)">◇ <span class="hide-xs">形状</span></button>
      <div class="build-only sep"></div>
      <button class="build-only" id="b-undo" title="元に戻す (Ctrl+Z)">↩</button>
      <button class="build-only" id="b-redo" title="やり直す (Ctrl+Y)">↪</button>
      <button class="build-only danger" id="b-clear" title="全部消す">🗑</button>
      <div class="play-only stepper">
        <span class="lbl">ボール</span>
        <button id="ball-down">−</button>
        <span class="val" id="ball-val">4</span>
        <button id="ball-up">＋</button>
      </div>
      <div class="play-only sep"></div>
      <button class="play-only primary" id="b-run">▶ スタート</button>
      <button class="play-only" id="b-reset">⟲ <span class="hide-xs">リセット</span></button>
      <div class="sep"></div>
      <button id="b-cam" title="視点をリセット">⌖ <span class="hide-xs">視点</span></button>`;
    b.appendChild(bot);
    this.bottom = bot;

    /* インスペクタ */
    const ins = el('div', 'panel'); ins.id = 'inspector';
    b.appendChild(ins);
    this.inspector = ins;

    /* HUD */
    const hud = el('div', 'panel'); hud.id = 'hud';
    b.appendChild(hud);
    this.hud = hud;

    /* お題バナー */
    const q = el('div', 'panel'); q.id = 'quest';
    b.appendChild(q);
    this.quest = q;

    /* トースト・モーダル */
    this.toastBox = el('div'); this.toastBox.id = 'toast';
    b.appendChild(this.toastBox);
    this.modalBox = el('div'); this.modalBox.id = 'modal';
    this.modalBox.addEventListener('pointerdown', (e) => { if (e.target === this.modalBox) this.closeModal(); });
    b.appendChild(this.modalBox);

    /* 配線 */
    const g = (id) => document.getElementById(id);
    g('m-build').onclick = () => this.emit('mode', 'build');
    g('m-play').onclick = () => this.emit('mode', 'play');
    g('b-quest').onclick = () => this.emit('quests');
    g('b-save').onclick = () => this.emit('saves');
    g('b-help').onclick = () => this.emit('help');
    g('lv-up').onclick = () => this.emit('level', +1);
    g('lv-down').onclick = () => this.emit('level', -1);
    g('b-rot').onclick = () => this.emit('rotate', 1);
    g('b-var').onclick = () => this.emit('variant', 1);
    g('b-undo').onclick = () => this.emit('undo');
    g('b-redo').onclick = () => this.emit('redo');
    g('b-clear').onclick = () => this.emit('clear');
    g('b-run').onclick = () => this.emit('run');
    g('b-reset').onclick = () => this.emit('reset');
    g('b-cam').onclick = () => this.emit('camera');
    g('ball-up').onclick = () => this.emit('balls', +1);
    g('ball-down').onclick = () => this.emit('balls', -1);
    this.btn = {
      build: g('m-build'), play: g('m-play'), run: g('b-run'),
      undo: g('b-undo'), redo: g('b-redo'), lv: g('lv-val'), balls: g('ball-val'),
    };
  }

  buildPalette() {
    const add = (title) => this.palScroll.appendChild(el('div', 'pal-group', title));
    const item = (id, name, color) => {
      const btn = el('button', 'pal-item');
      btn.innerHTML = `${iconFor(id)}<span class="pal-name">${name}</span><span class="pal-count"></span>`;
      btn.onclick = () => this.emit('pick', id);
      btn.title = PARTS[id] ? PARTS[id].name + ' — ' + PARTS[id].desc : (RAILS[id] ? RAILS[id].name : '選んだパーツを消す');
      this.palScroll.appendChild(btn);
      this.palItems.set(id, btn);
    };
    add('コース');
    for (const id of PART_ORDER) if (PARTS[id].cat === 'track') item(id, PARTS[id].short || PARTS[id].name);
    add('スペシャル');
    for (const id of PART_ORDER) if (PARTS[id].cat === 'special') item(id, PARTS[id].short || PARTS[id].name);
    add('レール');
    for (const id of RAIL_ORDER) item(id, RAILS[id].name);
    add('ツール');
    item('erase', '削除');
  }

  /* ── 更新 ── */

  setMode(mode) {
    this.btn.build.classList.toggle('on', mode === 'build');
    this.btn.play.classList.toggle('on', mode === 'play');
    this.palette.style.display = mode === 'build' ? '' : 'none';
    for (const n of this.bottom.querySelectorAll('.build-only')) n.style.display = mode === 'build' ? '' : 'none';
    for (const n of this.bottom.querySelectorAll('.play-only')) n.style.display = mode === 'play' ? '' : 'none';
    this.hud.classList.toggle('show', mode === 'play');
    if (mode !== 'build') this.setSelected(null);
  }

  setTool(tool) {
    const railMode = !!RAILS[tool];
    for (const [id, btn] of this.palItems) {
      btn.classList.toggle('on', tool === id || (railMode && !!RAILS[id]));
    }
  }

  setUsage(usage, limits) {
    for (const [id, btn] of this.palItems) {
      const c = btn.querySelector('.pal-count');
      if (!c) continue;
      if (id === 'erase' || !limits) { c.textContent = ''; btn.classList.remove('out'); continue; }
      const max = limits[id];
      if (max == null) { c.textContent = ''; btn.classList.remove('out'); continue; }
      const left = max - (usage[id] || 0);
      c.textContent = left + '/' + max;
      c.classList.toggle('zero', left <= 0);
      btn.classList.toggle('out', left <= 0);
    }
  }

  setLevel(n) { this.btn.lv.textContent = n; }
  setBalls(n) { this.btn.balls.textContent = n; }
  setHistory(canUndo, canRedo) { this.btn.undo.disabled = !canUndo; this.btn.redo.disabled = !canRedo; }
  setRunning(on) { this.btn.run.innerHTML = on ? '⏸ 一時停止' : '▶ スタート'; }

  setSelected(cell) {
    const ins = this.inspector;
    if (!cell) { ins.classList.remove('show'); return; }
    const def = PARTS[cell.type];
    ins.classList.add('show');
    ins.innerHTML = `
      <div class="ins-title">${iconFor(cell.type)}${def.name}</div>
      <div class="ins-desc">${def.desc}</div>
      <div class="ins-row"><span class="k">高さ</span>
        <button data-a="lv-1">▼</button><span class="ins-variant" id="ins-lv">${cell.level}</span><button data-a="lv+1">▲</button></div>
      <div class="ins-row"><span class="k">向き</span>
        <button data-a="rot-1">↺</button><span class="ins-variant">${cell.rot * 60}°</span><button data-a="rot+1">↻</button></div>
      ${def.variants.length > 1 ? `<div class="ins-row"><span class="k">形状</span>
        <button data-a="var-1">‹</button><span class="ins-variant">${def.variants[cell.cfg]}</span><button data-a="var+1">›</button></div>` : ''}
      <div class="ins-row" style="margin-top:9px"><button class="danger" data-a="del" style="flex:1">削除 (Del)</button></div>`;
    for (const btn of ins.querySelectorAll('[data-a]')) {
      btn.onclick = () => {
        const a = btn.dataset.a;
        if (a === 'del') this.emit('delete');
        else if (a.startsWith('lv')) this.emit('cellLevel', +a.slice(2));
        else if (a.startsWith('rot')) this.emit('rotate', +a.slice(3));
        else if (a.startsWith('var')) this.emit('variant', +a.slice(3));
      };
    }
  }

  setStats(s) {
    this.hud.innerHTML = `
      <div class="row"><span>ゴール</span><b class="big ${s.goal > 0 ? 'ok' : ''}">${s.goal}</b></div>
      <div class="row"><span>コース上</span><b>${s.active}</b></div>
      <div class="row"><span>落下・停止</span><b class="${s.lost + s.stuck > 0 ? 'ng' : ''}">${s.lost + s.stuck}</b></div>
      <div class="row"><span>タイム</span><b>${s.time.toFixed(1)}s</b></div>`;
  }

  setQuest(ch, state) {
    if (!ch) { this.quest.classList.remove('show'); return; }
    this.quest.classList.add('show');
    this.quest.innerHTML = `
      <div class="q-name"><span class="tag">お題</span>${ch.name}${state.cleared ? ' <span style="color:var(--good)">クリア済み</span>' : ''}</div>
      <div class="q-desc">${ch.desc}<br><b style="color:var(--accent)">${ch.goalText}</b></div>
      <div class="q-act">
        <button data-a="hint">💡 ヒント</button>
        <button data-a="sample">👀 お手本を見る</button>
        <button data-a="retry">↺ 作り直す</button>
        <button data-a="quit">✕ 自由制作にもどる</button>
      </div>`;
    for (const btn of this.quest.querySelectorAll('[data-a]')) {
      btn.onclick = () => this.emit('quest:' + btn.dataset.a);
    }
  }

  toast(msg, kind = '') {
    const t = el('div', 'toast ' + kind, msg);
    this.toastBox.appendChild(t);
    setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; }, 2100);
    setTimeout(() => t.remove(), 2500);
  }

  modal(title, html, actions = [{ label: '閉じる' }]) {
    const sheet = el('div', 'sheet');
    sheet.innerHTML = `<h2>${title}</h2>${html}<div class="acts"></div>`;
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

export { iconFor };
