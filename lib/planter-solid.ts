import * as THREE from 'three';

/**
 * The wall as a solid, built for the preview at whatever point of the fold it
 * has reached.
 *
 * The engine already knows the pot has a thickness — `PlanterSolid` carries the
 * inside face, and what the pot holds is measured on it. This is the same fact
 * said in triangles: a skin at the front, a skin one thickness behind it, a band
 * of material showing at every edge the cutter parted, and a V cut into the back
 * along every line the bit grooves.
 *
 * It is worth being exact about why the groove is modelled rather than drawn as
 * a line. A V-groove is not decoration on a fold — it IS the fold. The bit takes
 * the stock down to a residual skin, that skin is the hinge, and the two faces
 * of the cut swing together until they meet. So the groove is wide open on a
 * flat blank, shuts as the panel closes, and the angle it was cut at is exactly
 * the angle the panel ends up at. A preview that draws a hairline where the
 * groove is cannot show any of that, and the one question a shop most needs
 * answered — does this bit close this fold — is the one it leaves out.
 *
 * Everything here is in world units, already scaled. Corners arrive folded, so
 * the solid is rebuilt as the fold runs: the material stays the same thickness
 * throughout, which is the point, and the groove shuts on itself on the way.
 */

export interface SolidGroove {
  /** How deep the bit goes, from the back face (world units). */
  depth: number;
  /** How wide the cut is where it breaks the back face (world units). */
  width: number;
  /** Stock left under the cut. This is the hinge (world units). */
  skin: number;
}

export interface SolidSkin {
  /** The back face, with the grooves cut into it. */
  inner: Float32Array;
  /** Material on show at every cut edge — the mouth, the foot, the seam, a rivet line. */
  rim: Float32Array;
}

const EPSILON = 1e-9;

const edgeKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);

/**
 * Where two lines in a shared plane cross.
 *
 * Both lie in the facet, so this is a 2D problem wearing 3D coordinates, and the
 * plane's own normal is what turns the cross products back into scalars.
 */
function meet(
  a: THREE.Vector3, u: THREE.Vector3, b: THREE.Vector3, v: THREE.Vector3, n: THREE.Vector3,
): THREE.Vector3 | null {
  const denom = new THREE.Vector3().crossVectors(u, v).dot(n);
  if (Math.abs(denom) < EPSILON) return null;
  const s = new THREE.Vector3().subVectors(b, a).cross(v).dot(n) / denom;
  return a.clone().addScaledVector(u, s);
}

/**
 * Build the back face and the edge bands for one folded piece.
 *
 * `ids` is read only to find which edges are shared. An edge with a neighbour is
 * a crease: it is grooved, it keeps its skin, and it never opens. An edge with
 * no neighbour was parted by the cutter, and what a parted edge shows is the
 * thickness of the stock — which on a 4 mm panel is the single most visible sign
 * that you are looking at a made object rather than at a surface.
 */
export function solidSkin(
  corners: THREE.Vector3[][],
  ids: [number, number, number][],
  thickness: number,
  groove: SolidGroove,
): SolidSkin {
  const inner: number[] = [];
  const rim: number[] = [];
  if (!(thickness > 0) || corners.length === 0) {
    return { inner: new Float32Array(), rim: new Float32Array() };
  }

  const shared = new Map<string, number>();
  for (const [a, b, c] of ids) {
    for (const [p, q] of [[a, b], [b, c], [c, a]] as [number, number][]) {
      shared.set(edgeKey(p, q), (shared.get(edgeKey(p, q)) ?? 0) + 1);
    }
  }

  // Face normals first: the back face is one thickness along them, and the
  // mitre at a crease is built out of the ones that meet there.
  const normals = corners.map(([p0, p1, p2]) => new THREE.Vector3()
    .subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p2, p0)).normalize());

  /**
   * One direction per corner, shared by every facet that owns it.
   *
   * Two facets meeting at a crease each have their own idea of "back", and if
   * each pushes the groove floor along its own the two never quite land on the
   * same line — the crease then shows a hairline split down it, which is exactly
   * the artefact a grooved fold must not have, because a grooved fold is one
   * piece of material. Agreeing on one direction per corner removes the question.
   */
  const mitre = new Map<number, THREE.Vector3>();
  ids.forEach((tri, t) => {
    tri.forEach((id, k) => {
      const self = corners[t][k];
      const u = new THREE.Vector3().subVectors(corners[t][(k + 1) % 3], self);
      const v = new THREE.Vector3().subVectors(corners[t][(k + 2) % 3], self);
      const lu = u.length();
      const lv = v.length();
      if (lu < EPSILON || lv < EPSILON) return;
      // Angle-weighted, so a sliver facet does not pull the corner round as hard
      // as the broad one beside it.
      const weight = Math.acos(THREE.MathUtils.clamp(u.dot(v) / (lu * lv), -1, 1));
      const acc = mitre.get(id) ?? new THREE.Vector3();
      mitre.set(id, acc.addScaledVector(normals[t], weight));
    });
  });
  for (const [id, sum] of mitre) {
    if (sum.lengthSq() < EPSILON) mitre.delete(id); else sum.normalize();
  }

  const push = (into: number[], ...points: THREE.Vector3[]) => {
    for (const p of points) into.push(p.x, p.y, p.z);
  };

  // A crease is only grooved where there is a groove to cut. Acrylic is bent
  // hot over a former and never touched by the bit, so its creases are unbroken
  // material and the back face runs straight through them.
  const cutting = groove.depth > EPSILON && groove.width > EPSILON;

  ids.forEach((tri, t) => {
    const P = corners[t];
    const n = normals[t];
    if (!Number.isFinite(n.x)) return;

    // What each edge gives up to the groove, which is half of it: the cut is
    // centred on the crease, so the two facets share it. A parted edge gives up
    // nothing — there is no groove on it.
    const crease = [0, 1, 2]
      .map((e) => cutting && (shared.get(edgeKey(tri[e], tri[(e + 1) % 3])) ?? 0) > 1);
    const held = crease.map((yes) => (yes ? groove.width / 2 : 0));

    // Each edge, pushed into the facet by what it gives up. The third corner
    // settles which way "in" is — a winding argument would hold right up until
    // the first mirrored piece.
    const lines = [0, 1, 2].map((e) => {
      const from = P[e];
      const dir = new THREE.Vector3().subVectors(P[(e + 1) % 3], from);
      const into = new THREE.Vector3().crossVectors(n, dir).normalize();
      if (into.dot(new THREE.Vector3().subVectors(P[(e + 2) % 3], from)) < 0) into.negate();
      return { at: from.clone().addScaledVector(into, held[e]), dir };
    });

    // A corner of the held-back facet is where its two edges now cross.
    let held3 = [0, 1, 2].map((k) => {
      const a = lines[(k + 2) % 3];
      const b = lines[k];
      return meet(a.at, a.dir, b.at, b.dir, n) ?? P[k].clone();
    });
    // A groove wider than the facet turns it inside out. Collapsing to the
    // middle keeps the mesh sane; the check beside it says the fold cannot be cut.
    const flipped = new THREE.Vector3()
      .subVectors(held3[1], held3[0])
      .cross(new THREE.Vector3().subVectors(held3[2], held3[0])).dot(n) <= 0;
    if (flipped) {
      const mid = held3.reduce((sum, p) => sum.add(p), new THREE.Vector3()).multiplyScalar(1 / 3);
      held3 = [mid.clone(), mid.clone(), mid.clone()];
    }

    const back = held3.map((p) => p.clone().addScaledVector(n, -thickness));
    // Wound against the front face, so the back looks into the pot.
    push(inner, back[0], back[2], back[1]);

    for (let e = 0; e < 3; e += 1) {
      const j = e;
      const k = (e + 1) % 3;
      if (crease[e]) {
        // The groove's own two walls: they start at the back face, half a width
        // out on either side, and run down to the skin the bit left behind.
        const floorJ = P[j].clone().addScaledVector(mitre.get(tri[j]) ?? n, -groove.skin);
        const floorK = P[k].clone().addScaledVector(mitre.get(tri[k]) ?? n, -groove.skin);
        push(inner, back[j], floorJ, floorK);
        push(inner, back[j], floorK, back[k]);
      } else if ((shared.get(edgeKey(tri[j], tri[k])) ?? 0) < 2) {
        // A parted edge. This band is the material itself, seen end on.
        push(rim, P[j], P[k], back[k]);
        push(rim, P[j], back[k], back[j]);
      }
    }
  });

  return { inner: new Float32Array(inner), rim: new Float32Array(rim) };
}
