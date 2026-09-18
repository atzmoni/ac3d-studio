import * as THREE from 'three';
import type { Vec2, Vec3 } from './types';

/**
 * Fold a piece from its flat net to its built shape as a chain of hinge
 * rotations, not as a straight-line move of each vertex. A vertex-lerp
 * stretches every facet along the way and, for a piece nested far from its
 * neighbours, makes the whole thing look like it is flying together from
 * scattered debris rather than folding shut. A hinge chain keeps every facet
 * perfectly rigid at every value of `t`, and keeps each facet attached to the
 * one it shares an edge with throughout — because a rotation about a shared
 * edge cannot move that edge. That is what real material does, and it is the
 * only way the animation reads as one piece coming together.
 *
 * The construction avoids guessing which way a hinge turns:
 *   1. For every facet, M(1) is the rigid transform carrying its flat
 *      triangle onto its true 3D triangle — exact, since the flat net is an
 *      isometric development of the solid.
 *   2. The hinge rotation is R = M(parent)(1)^-1 · M(1). Parent and child
 *      share an edge that does not move under either transform, so R is
 *      guaranteed to be a rotation about that edge.
 *   3. Animating is M(t) = M(parent)(t) · R(angle · t). The one root facet in
 *      each piece has no parent hinge, so its pose instead eases the whole
 *      piece — pivoting about its own centre — from wherever the flat net was
 *      drawn to wherever the piece sits once built.
 */

interface FoldTriangle {
  flat: [Vec2, Vec2, Vec2];
  built: [Vec3, Vec3, Vec3];
}

interface FoldNode {
  parent: number;
  flat: THREE.Vector3[];
  built: THREE.Vector3[];
  axisOrigin: THREE.Vector3;
  axisDir: THREE.Vector3;
  angle: number;
  pivot: { quat: THREE.Quaternion; from: THREE.Vector3; to: THREE.Vector3 } | null;
}

export type FoldTree = FoldNode[];

/** Orthonormal frame built from a triangle's first corner, edge and normal. */
function frameOf(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): THREE.Matrix4 {
  const x = b.clone().sub(a).normalize();
  const ref = c.clone().sub(a);
  const z = new THREE.Vector3().crossVectors(x, ref).normalize();
  if (!Number.isFinite(z.x) || z.lengthSq() < 0.5) z.set(0, 0, 1);
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(a);
}

/** Rigid transform taking one triangle onto another — both the same triangle. */
function frameTransform(flat: THREE.Vector3[], built: THREE.Vector3[]): THREE.Matrix4 {
  const A = frameOf(flat[0], flat[1], flat[2]);
  const B = frameOf(built[0], built[1], built[2]);
  return B.clone().multiply(A.clone().invert());
}

function rotationAboutAxis(origin: THREE.Vector3, dir: THREE.Vector3, angle: number): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromAxisAngle(dir, angle);
  const out = new THREE.Matrix4().makeRotationFromQuaternion(q);
  const p = origin.clone().applyQuaternion(q);
  out.setPosition(origin.x - p.x, origin.y - p.y, origin.z - p.z);
  return out;
}

/** Signed rotation angle of R about a known axis, read from how it turns a probe. */
function angleAboutAxis(R: THREE.Matrix4, origin: THREE.Vector3, dir: THREE.Vector3): number {
  let probe = new THREE.Vector3(1, 0, 0);
  if (Math.abs(probe.dot(dir)) > 0.9) probe = new THREE.Vector3(0, 1, 0);
  const perp = probe.clone().sub(dir.clone().multiplyScalar(probe.dot(dir))).normalize();
  const p0 = origin.clone().add(perp);
  const p1 = p0.clone().applyMatrix4(R);
  const v1 = p1.sub(origin.clone().applyMatrix4(R)).normalize();
  const cos = THREE.MathUtils.clamp(perp.dot(v1), -1, 1);
  const sin = new THREE.Vector3().crossVectors(perp, v1).dot(dir);
  return Math.atan2(sin, cos);
}

/** Every triangle sharing an edge with every other, keyed by the two vertex ids. */
function edgeAdjacency(ids: [number, number, number][]): Map<string, number[]> {
  const map = new Map<string, number[]>();
  ids.forEach(([a, b, c], i) => {
    for (const [p, q] of [[a, b], [b, c], [c, a]] as [number, number][]) {
      const key = p < q ? `${p}:${q}` : `${q}:${p}`;
      const list = map.get(key);
      if (list) list.push(i); else map.set(key, [i]);
    }
  });
  return map;
}

/**
 * Every edge shared by exactly two triangles, as one owning triangle's own
 * pair of corner indices — the hinge chain keeps both owners' copies of a
 * shared edge exactly coincident at every `t`, so either one is a fine source
 * for drawing that edge as a single crease line.
 */
export function internalEdges(ids: [number, number, number][]): { tri: number; corners: [number, number] }[] {
  const adjacency = edgeAdjacency(ids);
  const out: { tri: number; corners: [number, number] }[] = [];
  for (const [key, tris] of adjacency) {
    if (tris.length < 2) continue;
    const [a, b] = key.split(':').map(Number);
    const tri = tris[0];
    const ca = ids[tri].indexOf(a);
    const cb = ids[tri].indexOf(b);
    out.push({ tri, corners: [ca, cb] });
  }
  return out;
}

/** Parent-before-child order over one connected piece, from a breadth-first walk. */
function spanningParents(ids: [number, number, number][], adjacency: Map<string, number[]>, root: number): number[] {
  const parents = new Array(ids.length).fill(-1);
  const visited = new Array(ids.length).fill(false);
  visited[root] = true;
  const queue = [root];
  while (queue.length) {
    const cur = queue.shift() as number;
    const [a, b, c] = ids[cur];
    for (const [p, q] of [[a, b], [b, c], [c, a]] as [number, number][]) {
      const key = p < q ? `${p}:${q}` : `${q}:${p}`;
      for (const other of adjacency.get(key) ?? []) {
        if (other !== cur && !visited[other]) {
          visited[other] = true;
          parents[other] = cur;
          queue.push(other);
        }
      }
    }
  }
  return parents;
}

/**
 * Build the hinge chain for one piece (a band, or a whole single-sheet wall).
 * `ids` gives each triangle's 3 vertex ids, used only to find which triangles
 * share an edge — the flat/built geometry itself comes from `triangles`.
 * `pivot` is where the piece's own centre sits in the flat net, for the one
 * root facet that has no parent hinge to ride on; where that centre ends up
 * once built is derived from the root's own transform, not chosen separately
 * — anything else would only be exact at t = 1 by coincidence.
 */
export function buildFoldTree(
  triangles: FoldTriangle[],
  ids: [number, number, number][],
  pivot: Vec2,
): FoldTree {
  const adjacency = edgeAdjacency(ids);
  const parents = spanningParents(ids, adjacency, 0);
  const nodes: FoldTree = [];
  const m1s: THREE.Matrix4[] = [];

  triangles.forEach((tri, i) => {
    const flat = tri.flat.map((p) => new THREE.Vector3(p.x, p.y, 0));
    const built = tri.built.map((p) => new THREE.Vector3(p.x, p.y, p.z));
    const m1 = frameTransform(flat, built);
    m1s.push(m1);

    const parent = parents[i];
    let axisOrigin = new THREE.Vector3();
    let axisDir = new THREE.Vector3(0, 0, 1);
    let angle = 0;
    let pivotBase: FoldNode['pivot'] = null;

    if (parent >= 0) {
      const R = m1s[parent].clone().invert().multiply(m1);
      const shared = ids[i].filter((id) => ids[parent].includes(id));
      const at = (id: number) => flat[ids[i].findIndex((v) => v === id)];
      const [sa, sb] = shared.length >= 2 ? [at(shared[0]), at(shared[1])] : [flat[0], flat[1]];
      axisOrigin = sa.clone();
      axisDir = sb.clone().sub(sa).normalize();
      angle = angleAboutAxis(R, axisOrigin, axisDir);
    } else {
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      m1.decompose(pos, quat, scale);
      const from = new THREE.Vector3(pivot.x, pivot.y, 0);
      pivotBase = { quat, from, to: from.clone().applyMatrix4(m1) };
    }

    nodes.push({ parent, flat, built, axisOrigin, axisDir, angle, pivot: pivotBase });
  });

  return nodes;
}

/** Evaluate every triangle's transform at fold amount `t`, in [0, 1]. */
export function poseAt(tree: FoldTree, t: number): THREE.Matrix4[] {
  const poses: THREE.Matrix4[] = [];
  tree.forEach((node, i) => {
    let local: THREE.Matrix4;
    if (node.parent >= 0 && Math.abs(node.angle) > 1e-12) {
      local = rotationAboutAxis(node.axisOrigin, node.axisDir, node.angle * t);
    } else if (node.pivot) {
      const q = new THREE.Quaternion().slerp(node.pivot.quat, t);
      const c = new THREE.Vector3().lerpVectors(node.pivot.from, node.pivot.to, t);
      const p = node.pivot.from.clone().applyQuaternion(q);
      local = new THREE.Matrix4().compose(
        new THREE.Vector3(c.x - p.x, c.y - p.y, c.z - p.z), q, new THREE.Vector3(1, 1, 1),
      );
    } else {
      local = new THREE.Matrix4();
    }
    const parent = node.parent >= 0 ? poses[node.parent] : null;
    poses.push(parent ? new THREE.Matrix4().multiplyMatrices(parent, local) : local);
  });
  return poses;
}

/**
 * World-space corner positions of every triangle at fold amount `t`.
 *
 * The chain is only EXACT where every hinge it turns on is isometric — the
 * same length flat and built. That holds for a developable piece (a banded
 * strip, always; a single-sheet wall wherever it "develops flat to 0.00 mm").
 * Where it does not — real curvature the chain cannot pass through as a pure
 * rotation, a bulge on a single-sheet wall being the standing example —
 * `angleAboutAxis` keeps only the rotation part of a transform that was never
 * only a rotation, and that dropped remainder compounds down the chain into a
 * final pose that can be wildly wrong: a shape that never closes, facets
 * flying out past the model's own size.
 *
 * The fix is a per-triangle correction — the gap between the chain's own t=1
 * guess and the corner's true built position — eased in as `t` runs 0 -> 1
 * with a smoothstep. For a developable piece that gap is ~0, so this changes
 * nothing. For a non-developable one it costs nothing at t = 0 (still exactly
 * the flat net), grows through the fold, and lands EXACTLY on the true solid
 * at t = 1 — bounded to one facet's own gap, never the whole chain's.
 */
export function cornersAt(tree: FoldTree, t: number): THREE.Vector3[][] {
  const poses = poseAt(tree, t);
  const ease = t * t * (3 - 2 * t);
  if (ease <= 0) return tree.map((node, i) => node.flat.map((p) => p.clone().applyMatrix4(poses[i])));
  const posesAtEnd = t >= 1 ? poses : poseAt(tree, 1);
  return tree.map((node, i) => node.flat.map((p, k) => {
    const corner = p.clone().applyMatrix4(poses[i]);
    const atEnd = p.clone().applyMatrix4(posesAtEnd[i]);
    const correction = node.built[k].clone().sub(atEnd);
    return corner.addScaledVector(correction, ease);
  }));
}
