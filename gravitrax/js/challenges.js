/**
 * challenges.js — お題（チャレンジ）
 *
 * 実物の「タスクカード」にあたる遊び方。スターターとゴールの位置は
 * 固定（locked）で動かせず、決められたパーツだけを使ってコースを完成させる。
 * どのお題にも「お手本」を用意してあり、必ず解けることを確認している。
 */
import { Model } from './model.js';

/** ヘルパー：固定パーツを置く */
const lock = (m, q, r, type, cfg, rot, level) =>
  m.setPart(q, r, type, cfg, rot, level, { force: true, locked: true });

export const CHALLENGES = [
  {
    id: 'first',
    name: 'はじめの一歩',
    desc: 'スターターとゴールをレールでつないでみよう。まずはまっすぐに。',
    goalText: 'ボールを 1 個ゴールへ',
    balls: 1, need: 1,
    limits: { curve: 3, railS: 2, railM: 2, railL: 2, height: 40 },
    hint: '高いところから低いところへ、坂道になるように高さを決めるのがコツ。',
    build(m) {
      m.boardRadius = 4;
      lock(m, 0, -3, 'starter', 0, 1, 8);
      lock(m, 0, 3, 'goal', 0, 4, 2);
    },
    solve(m) {
      const st = m.getAt(0, -3, 8), gl = m.getAt(0, 3, 2);
      const cv = m.setPart(0, 1, 'curve', 0, 1, 4);
      m.addRail(st, cv); m.addRail(cv, gl);
    },
  },
  {
    id: 'turn',
    name: 'カーブでまがれ',
    desc: 'ゴールはまっすぐの先にはない。カーブで向きを変えよう。',
    goalText: 'ボールを 1 個ゴールへ',
    balls: 1, need: 1,
    limits: { curve: 3, railS: 3, railM: 2, railL: 2, height: 40 },
    hint: 'パーツを選んで T キー（形状）を押すと、曲がり方を変えられる。',
    build(m) {
      m.boardRadius = 5;
      lock(m, 0, -4, 'starter', 0, 1, 14);
      lock(m, 4, -2, 'goal', 0, 3, 0);
    },
    solve(m) {
      const st = m.getAt(0, -4, 14), gl = m.getAt(4, -2, 0);
      const cv = m.setPart(0, -2, 'curve', 1, 4, 8);   // ゆるいカーブ（左）
      m.addRail(st, cv); m.addRail(cv, gl);
    },
  },
  {
    id: 'jump',
    name: 'ジャンプでねらえ',
    desc: 'ゴールまでレールは届かない。空中を飛ばして直接ねらおう。',
    goalText: 'ボールを 1 個ゴールへ',
    balls: 1, need: 1,
    limits: { curve: 2, railS: 2, railM: 2, height: 40 },
    hint: 'レールの先端から飛び出したボールは放物線をえがく。高さと勢いを調整しよう。',
    build(m) {
      m.boardRadius = 4;
      lock(m, 0, -4, 'starter', 0, 1, 14);
      lock(m, 0, 2, 'goal', 0, 4, 0);
    },
    solve(m) {
      const st = m.getAt(0, -4, 14);
      const cv = m.setPart(0, -1, 'curve', 0, 1, 6);
      m.addRail(st, cv);
    },
  },
  {
    id: 'catch',
    name: 'キャッチャーで受けとめろ',
    desc: 'フリーフォールで落としたボールを、真下のキャッチャーで受けてゴールへ。',
    goalText: 'ボールを 1 個ゴールへ',
    balls: 1, need: 1,
    limits: { freefall: 1, catcher: 1, curve: 2, railS: 2, railM: 2, height: 45 },
    hint: '同じマスでも高さがちがえばパーツを重ねて置ける。フリーフォールの真下にキャッチャーを置こう。',
    build(m) {
      m.boardRadius = 4;
      lock(m, 0, -3, 'starter', 0, 1, 16);
      lock(m, 0, 2, 'goal', 0, 4, 0);
    },
    solve(m) {
      const st = m.getAt(0, -3, 16), gl = m.getAt(0, 2, 0);
      const ff = m.setPart(0, 0, 'freefall', 0, 4, 12);
      const ca = m.setPart(0, 0, 'catcher', 0, 1, 0);
      m.addRail(st, ff); m.addRail(ca, gl);
    },
  },
  {
    id: 'vortex',
    name: 'うずまきをくぐれ',
    desc: 'ボルテックスの中をぐるぐる回してから、下でキャッチしてゴールへ。',
    goalText: 'ボールを 1 個ゴールへ',
    balls: 1, need: 1,
    limits: { vortex: 1, catcher: 1, curve: 2, railS: 2, railM: 2, height: 45 },
    hint: 'ボルテックスはボールを真下に落とす。落ちる先を用意しておこう。',
    build(m) {
      m.boardRadius = 4;
      lock(m, 0, -3, 'starter', 0, 1, 14);
      lock(m, 0, 2, 'goal', 0, 4, 0);
    },
    solve(m) {
      const st = m.getAt(0, -3, 14), gl = m.getAt(0, 2, 0);
      const vx = m.setPart(0, 0, 'vortex', 0, 4, 10);
      const ca = m.setPart(0, 0, 'catcher', 0, 1, 0);
      m.addRail(st, vx); m.addRail(ca, gl);
    },
  },
  {
    id: 'cannon',
    name: 'キャノンで打ち上げろ',
    desc: 'ゴールはスタートより高い場所にある。マグネティックキャノンの出番だ。',
    goalText: 'ボールを 2 個ゴールへ',
    balls: 2, need: 2,
    limits: { cannon: 1, curve: 2, railS: 2, railM: 2, railL: 2, height: 30 },
    hint: 'キャノンに飛び込んだボールが、反対側のボールを勢いよく撃ち出す。上り坂のレールを繋ごう。',
    build(m) {
      m.boardRadius = 5;
      lock(m, 3, 0, 'starter', 0, 3, 8);
      lock(m, -4, 0, 'goal', 0, 0, 6);
    },
    solve(m) {
      const st = m.getAt(3, 0, 8), gl = m.getAt(-4, 0, 6);
      const cn = m.setPart(0, 0, 'cannon', 0, 0, 0);
      m.addRail(st, cn); m.addRail(cn, gl);
    },
  },
  {
    id: 'split',
    name: 'ふたてに分けろ',
    desc: '振り分けパーツはボールが来るたびに出口を交互に変える。半分をゴールへ導こう。',
    goalText: '4 個のうち 2 個以上をゴールへ',
    balls: 4, need: 2,
    limits: { splitter: 1, curve: 3, railS: 3, railM: 3, height: 40 },
    hint: 'まず 1 本だけ繋いでみよう。交互に振り分けられるので、半分は別の方へ行く。',
    build(m) {
      m.boardRadius = 5;
      lock(m, 0, -3, 'starter', 0, 1, 12);
      lock(m, 3, 0, 'goal', 0, 3, 0);
    },
    solve(m) {
      const st = m.getAt(0, -3, 12), gl = m.getAt(3, 0, 0);
      const sp = m.setPart(0, 0, 'splitter', 0, 4, 8);
      m.addRail(st, sp); m.addRail(sp, gl);
    },
  },
  {
    id: 'all6',
    name: '6 個すべてゴールへ',
    desc: 'セットに入っているボール 6 個を、1 個も落とさずゴールへ運ぼう。',
    goalText: 'ボールを 6 個ゴールへ',
    balls: 6, need: 6,
    limits: { curve: 8, cross: 2, splitter: 2, railS: 6, railM: 4, railL: 3, height: 60 },
    hint: 'ボールどうしはぶつかる。詰まらないように、ゆるやかで長い下り坂を作ろう。',
    build(m) {
      m.boardRadius = 5;
      lock(m, 0, -4, 'starter', 0, 1, 16);
      lock(m, 0, 4, 'goal', 0, 4, 0);
    },
    solve(m) {
      const st = m.getAt(0, -4, 16), gl = m.getAt(0, 4, 0);
      const a = m.setPart(0, -1, 'curve', 0, 1, 10);
      const b = m.setPart(0, 2, 'curve', 0, 1, 4);
      m.addRail(st, a); m.addRail(a, b); m.addRail(b, gl);
    },
  },
];

/** お題からモデルを作る */
export function loadChallenge(ch) {
  const m = new Model(5);
  m.ballCount = ch.balls;
  ch.build(m);
  m.title = ch.name;
  return m;
}

/** お手本の解答 */
export function sampleSolution(ch) {
  const m = loadChallenge(ch);
  ch.solve(m);
  return m;
}

export function challengeById(id) {
  return CHALLENGES.find((c) => c.id === id) || null;
}
