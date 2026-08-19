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
    name: 'はじめの いっぽ',
    desc: 'スタートと ゴールを レールで つないでみよう。まずは まっすぐ。',
    goalText: 'ボールを 1こ ゴールへ',
    balls: 1, need: 1,
    limits: { curve: 3, railS: 2, railM: 2, railL: 2, height: 40 },
    hint: 'たかい ところから ひくい ところへ。さかみちに なるように たかさを きめよう。',
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
    name: 'カーブで まがれ',
    desc: 'ゴールは まっすぐの さきに ないよ。とちゅうで まがろう。',
    goalText: 'ボールを 1こ ゴールへ',
    balls: 1, need: 1,
    limits: { curve: 3, railS: 3, railM: 2, railL: 2, height: 40 },
    hint: 'レールで つなげば、まがりかたは じどうで きまるよ。',
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
    name: 'ジャンプで ねらえ',
    desc: 'ゴールまで レールが とどかない。そらを とばして ねらおう。',
    goalText: 'ボールを 1こ ゴールへ',
    balls: 1, need: 1,
    limits: { curve: 2, railS: 2, railM: 2, height: 40 },
    hint: 'レールの さきから とび出す ボールは カーブを えがく。たかさを かえて ちょうせつ しよう。',
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
    name: 'うけざらで うけとめろ',
    desc: 'おとしあなで おとした ボールを、まっすぐ 下の うけざらで うけとめて ゴールへ。',
    goalText: 'ボールを 1こ ゴールへ',
    balls: 1, need: 1,
    limits: { freefall: 1, catcher: 1, curve: 2, railS: 2, railM: 2, height: 45 },
    hint: 'おなじ ばしょでも たかさが ちがえば かさねて おけるよ。おとしあなの 下に うけざらを おこう。',
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
    name: 'うずまきを くぐれ',
    desc: 'うずまきの なかを ぐるぐる まわしてから、下で うけとめて ゴールへ。',
    goalText: 'ボールを 1こ ゴールへ',
    balls: 1, need: 1,
    limits: { vortex: 1, catcher: 1, curve: 2, railS: 2, railM: 2, height: 45 },
    hint: 'うずまきは ボールを まっすぐ 下に おとすよ。おちる さきを ようい しておこう。',
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
    name: 'キャノンで うちあげろ',
    desc: 'ゴールが スタートより たかい ところに ある！ キャノンの でばんだ。',
    goalText: 'ボールを 2こ ゴールへ',
    balls: 2, need: 2,
    limits: { cannon: 1, curve: 2, railS: 2, railM: 2, railL: 2, height: 30 },
    hint: 'キャノンに とびこんだ ボールが、はんたいがわの ボールを うちだす。のぼりざかの レールを つなごう。',
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
    name: 'ふたてに わけろ',
    desc: 'わかれみちは、ボールが くるたび でぐちを こうごに かえるよ。はんぶんを ゴールへ みちびこう。',
    goalText: '4こ のうち 2こ いじょうを ゴールへ',
    balls: 4, need: 2,
    limits: { splitter: 1, curve: 3, railS: 3, railM: 3, height: 40 },
    hint: 'まずは 1ぽんだけ つないでみよう。こうごに わかれるから、はんぶんは べつの ほうへ いくよ。',
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
    name: '6こ ぜんぶ ゴールへ',
    desc: 'ボール 6こを、1こも おとさずに ゴールへ はこぼう。',
    goalText: 'ボールを 6こ ゴールへ',
    balls: 6, need: 6,
    limits: { curve: 8, cross: 2, splitter: 2, railS: 6, railM: 4, railL: 3, height: 60 },
    hint: 'ボールどうしは ぶつかるよ。つまらないように、ゆるやかで ながい くだりざかを つくろう。',
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
