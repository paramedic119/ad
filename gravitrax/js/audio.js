/**
 * audio.js — 効果音と振動
 *
 * 音のファイルは使わず、Web Audio ですべて合成する（読み込み待ちゼロ・追加アセット不要）。
 * スマホでは最初のタップまで音を鳴らせないので、unlock() を必ず操作イベントから呼ぶ。
 */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.rollGain = null;
    this.rollFilter = null;
  }

  /** 最初のユーザー操作から呼ぶ */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.32;
    this.master.connect(this.ctx.destination);
    this._buildRolling();
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? 0.32 : 0;
  }

  get t() { return this.ctx.currentTime; }

  /** 単音（エンベロープつき） */
  _tone(freq, { at = 0, dur = 0.12, type = 'sine', gain = 0.5, to = null, attack = 0.005 } = {}) {
    const c = this.ctx, t0 = this.t + at;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  /** ノイズ（ぶつかる音・消す音） */
  _noise({ at = 0, dur = 0.16, gain = 0.35, freq = 1200, q = 1, to = null } = {}) {
    const c = this.ctx, t0 = this.t + at;
    const len = Math.ceil(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(freq, t0);
    if (to) f.frequency.exponentialRampToValueAtTime(Math.max(60, to), t0 + dur);
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0);
  }

  /** 転がる音（速さに応じて鳴らしっぱなしにする） */
  _buildRolling() {
    const c = this.ctx;
    const len = c.sampleRate * 2;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 420;
    f.Q.value = 3.5;
    const g = c.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(this.master);
    src.start();
    this.rollGain = g;
    this.rollFilter = f;
  }

  /** 毎フレーム呼ぶ。speed はボールの速さの合計 */
  rolling(speed) {
    if (!this.ctx || !this.rollGain) return;
    const v = clamp(speed / 90, 0, 1);
    const g = this.rollGain.gain;
    g.setTargetAtTime(this.enabled ? v * 0.22 : 0, this.t, 0.08);
    this.rollFilter.frequency.setTargetAtTime(300 + v * 900, this.t, 0.1);
  }

  stopRolling() { if (this.rollGain) this.rollGain.gain.setTargetAtTime(0, this.t, 0.05); }

  /* ── 効果音 ── */
  play(name) {
    if (!this.ctx || !this.enabled) return;
    switch (name) {
      case 'tap':
        this._tone(660, { dur: 0.06, type: 'triangle', gain: 0.30 }); break;
      case 'place':
        this._tone(520, { dur: 0.10, type: 'triangle', gain: 0.45, to: 880 });
        this._noise({ dur: 0.07, gain: 0.16, freq: 2400 }); break;
      case 'connect':
        this._tone(880, { dur: 0.09, type: 'square', gain: 0.22 });
        this._tone(1320, { at: 0.07, dur: 0.14, type: 'square', gain: 0.20 }); break;
      case 'rotate':
        this._tone(1100, { dur: 0.045, type: 'square', gain: 0.16 }); break;
      case 'erase':
        this._noise({ dur: 0.22, gain: 0.30, freq: 1800, to: 200 }); break;
      case 'start':
        [523, 659, 784].forEach((f, i) =>
          this._tone(f, { at: i * 0.07, dur: 0.16, type: 'triangle', gain: 0.34 })); break;
      case 'goal':
        [784, 988, 1175, 1568].forEach((f, i) =>
          this._tone(f, { at: i * 0.075, dur: 0.32, type: 'triangle', gain: 0.40 })); break;
      case 'clear':
        [523, 659, 784, 1047, 1319].forEach((f, i) =>
          this._tone(f, { at: i * 0.09, dur: 0.45, type: 'triangle', gain: 0.42 })); break;
      case 'lost':
        this._tone(392, { dur: 0.30, type: 'sawtooth', gain: 0.22, to: 150 }); break;
      case 'cannon':
        this._noise({ dur: 0.20, gain: 0.42, freq: 900, to: 120, q: 0.6 });
        this._tone(150, { dur: 0.22, type: 'square', gain: 0.28, to: 60 }); break;
      case 'catch':
        this._tone(700, { dur: 0.10, type: 'sine', gain: 0.26, to: 1000 }); break;
      case 'derail':
        this._noise({ dur: 0.16, gain: 0.26, freq: 2600, to: 700 }); break;
      case 'error':
        this._tone(210, { dur: 0.16, type: 'square', gain: 0.20 });
        this._tone(160, { at: 0.11, dur: 0.20, type: 'square', gain: 0.20 }); break;
      default: break;
    }
  }
}

/** 触覚フィードバック（対応端末のみ） */
export function buzz(pattern) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch { /* 未対応なら何もしない */ }
}

export const BUZZ = {
  tap: 8,
  place: 14,
  connect: [10, 30, 18],
  erase: 22,
  goal: [0, 40, 60, 40],
  clear: [0, 50, 80, 50, 80, 90],
  error: [0, 25, 40, 25],
};
