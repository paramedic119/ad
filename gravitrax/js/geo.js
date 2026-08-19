/**
 * geo.js — ジオメトリ生成のヘルパー
 * three.js の BufferGeometry を組み立てるための小道具群。
 */
import * as THREE from 'three';
import { HEX_R } from './core.js';

/** 同じ属性構成の BufferGeometry をまとめて 1 つにする */
export function mergeGeos(list) {
  list = list.filter(Boolean);
  if (list.length === 0) return new THREE.BufferGeometry();
  if (list.length === 1) return list[0];
  let vTotal = 0, iTotal = 0;
  for (const g of list) {
    vTotal += g.attributes.position.count;
    iTotal += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vTotal * 3);
  const nor = new Float32Array(vTotal * 3);
  const uv = new Float32Array(vTotal * 2);
  const idx = vTotal > 65535 ? new Uint32Array(iTotal) : new Uint16Array(iTotal);
  let vo = 0, io = 0;
  for (const g of list) {
    const p = g.attributes.position, n = g.attributes.normal, t = g.attributes.uv;
    pos.set(p.array.subarray(0, p.count * 3), vo * 3);
    if (n) nor.set(n.array.subarray(0, n.count * 3), vo * 3);
    if (t) uv.set(t.array.subarray(0, t.count * 2), vo * 2);
    if (g.index) {
      const gi = g.index.array;
      for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
      io += gi.length;
    } else {
      for (let i = 0; i < p.count; i++) idx[io + i] = i + vo;
      io += p.count;
    }
    vo += p.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

/** 正六角形の THREE.Shape（頂点は 30°+60k の位置、ポートは 60k の辺中点） */
export function hexShape(radius = HEX_R, round = 0.06) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + (i * Math.PI) / 3;
    pts.push(new THREE.Vector2(Math.cos(a) * radius, Math.sin(a) * radius));
  }
  const shape = new THREE.Shape();
  // 角を少し丸める
  for (let i = 0; i < 6; i++) {
    const prev = pts[(i + 5) % 6], cur = pts[i], next = pts[(i + 1) % 6];
    const a = cur.clone().lerp(prev, round);
    const b = cur.clone().lerp(next, round);
    if (i === 0) shape.moveTo(a.x, a.y); else shape.lineTo(a.x, a.y);
    shape.quadraticCurveTo(cur.x, cur.y, b.x, b.y);
  }
  shape.closePath();
  return shape;
}

/** 六角柱。y=0 が底面、y=height が上面。 */
export function hexPrismGeo(radius = HEX_R, height = 0.6, round = 0.06) {
  const bev = Math.min(0.02, height * 0.2);
  const g = new THREE.ExtrudeGeometry(hexShape(radius - bev, round), {
    depth: Math.max(0.001, height - 2 * bev), bevelEnabled: true,
    bevelThickness: bev, bevelSize: bev, bevelSegments: 1, curveSegments: 2,
  });
  g.rotateX(Math.PI / 2);
  // 実際の高さ範囲を測って底面を y=0 に合わせる
  g.computeBoundingBox();
  g.translate(0, -g.boundingBox.min.y, 0);
  g.computeVertexNormals();
  return g;
}

/** 点列に沿ったチューブ */
export function tubeGeo(points, radius, radial = 9) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5);
  const seg = Math.max(4, Math.min(160, Math.round(curve.getLength() / 0.12)));
  return new THREE.TubeGeometry(curve, seg, radius, radial, false);
}

/** 点列を横方向 lateral・上下 dy だけずらした点列を返す */
export function offsetPolyline(points, lateral, dy = 0) {
  const n = points.length;
  return points.map((p, i) => {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(n - 1, i + 1)];
    let tx = b.x - a.x, tz = b.z - a.z;
    const len = Math.hypot(tx, tz) || 1;
    tx /= len; tz /= len;
    return new THREE.Vector3(p.x + -tz * lateral, p.y + dy, p.z + tx * lateral);
  });
}

/** 2 本のロッドからなるレール（GraviTrax のレールの見た目） */
export function railPairGeo(points, rodR, sep, dy) {
  return mergeGeos([
    tubeGeo(offsetPolyline(points, sep, dy), rodR, 8),
    tubeGeo(offsetPolyline(points, -sep, dy), rodR, 8),
  ]);
}

/** 点列に沿った平たい帯（溝の底） */
export function ribbonGeo(points, halfWidth, dy = 0) {
  const n = points.length;
  const pos = new Float32Array(n * 2 * 3);
  const nor = new Float32Array(n * 2 * 3);
  const uv = new Float32Array(n * 2 * 2);
  const idx = [];
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const a = points[Math.max(0, i - 1)], b = points[Math.min(n - 1, i + 1)];
    let tx = b.x - a.x, tz = b.z - a.z;
    const len = Math.hypot(tx, tz) || 1;
    tx /= len; tz /= len;
    for (let k = 0; k < 2; k++) {
      const s = k === 0 ? halfWidth : -halfWidth;
      const o = (i * 2 + k) * 3;
      pos[o] = p.x + -tz * s; pos[o + 1] = p.y + dy; pos[o + 2] = p.z + tx * s;
      nor[o] = 0; nor[o + 1] = 1; nor[o + 2] = 0;
      uv[(i * 2 + k) * 2] = i / (n - 1);
      uv[(i * 2 + k) * 2 + 1] = k;
    }
    if (i < n - 1) {
      const v = i * 2;
      idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** LatheGeometry 用のプロファイルから回転体を作る */
export function latheGeo(profile, segments = 24) {
  const pts = profile.map(([x, y]) => new THREE.Vector2(x, y));
  return new THREE.LatheGeometry(pts, segments);
}

/** 中央に丸穴の空いた六角形シェイプ */
export function hexShapeWithHole(radius = HEX_R, holeR = 0.3, round = 0.06) {
  const shape = hexShape(radius, round);
  const hole = new THREE.Path();
  hole.absarc(0, 0, holeR, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  return shape;
}

/** 中央に穴の空いた六角柱 */
export function hexRingPrismGeo(radius, height, holeR) {
  const g = new THREE.ExtrudeGeometry(hexShapeWithHole(radius, holeR), {
    depth: height, bevelEnabled: false, curveSegments: 12,
  });
  g.rotateX(Math.PI / 2);
  g.computeBoundingBox();
  g.translate(0, -g.boundingBox.min.y, 0);
  g.computeVertexNormals();
  return g;
}
