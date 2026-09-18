import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import {
  SEAL_REFLECTION, SEAL_ROUGHNESS, type PlanterStoneMaterial, type PlanterStoneSeal,
} from '@/lib/planter-stone';

/**
 * The stone surface, in the preview.
 *
 * Ported from DXF-STONE's own material, because the two problems are the same
 * one: a folded pot has no sensible UV unwrap either, and a texture stretched
 * over its facets smears into stripes on every sloped one. So nothing is
 * unwrapped. The stone is sampled three times, in the YZ / XZ / XY planes, and
 * blended by the facet's normal — the same block of rock carries on across a
 * crease without a seam, because both facets are cut from the same volume.
 *
 * Three things on top of that, in order of how much they matter:
 *
 * 1. Parallax. The view ray is marched into the height map to find where it
 *    really lands, so a hollow in the stone hides what is behind it when you
 *    look across the pot and a boss covers its neighbour. This is the whole
 *    difference between a photograph of stone and stone, and it costs no
 *    triangles at all.
 * 2. A detail layer — the same normal map again several times finer, mixed in.
 *    One tile stretched over 400 mm is a texel every 0.8 mm, which is a blur at
 *    arm's length; this puts the grain back.
 * 3. Cavity. The AO channel darkens the hollows in the albedo itself, not only
 *    in the lighting. Light never reaches into a crack, and without this every
 *    crack reads as a painted line.
 *
 * Parallax runs on the two dominant planes only. The third always carries a
 * near-zero weight, and dropping it saves a third of the cost for nothing
 * anybody can see.
 */

const loader = new THREE.TextureLoader();
const cache = new Map<string, THREE.Texture>();

/**
 * Maps are fetched once per URL and shared by every material that wants them.
 *
 * Nothing suspends: the pot renders in the stone's average colour from the
 * first frame and the maps drop in when they arrive. Suspending the canvas
 * instead would blank the whole preview — pot, plant, backdrop and all — every
 * time somebody walked down the catalogue with an arrow key.
 */
function loadMap(url: string, srgb: boolean): THREE.Texture {
  const key = `${url}|${srgb ? 's' : 'l'}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const texture = loader.load(url);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.anisotropy = 8;
  cache.set(key, texture);
  return texture;
}

const UNIFORMS = /* glsl */`
uniform sampler2D uArmMap;
uniform sampler2D uDispMap;
uniform float uStoneScale;
uniform float uBlendSharp;
uniform float uNormalStrength;
uniform float uParallax;
uniform float uDetailScale;
uniform float uDetailStrength;
uniform float uToneVariation;
uniform float uToneFreq;
uniform vec3 uTint;
uniform float uCavity;
uniform float uAoStrength;
uniform vec2 uRoughRange;
varying vec3 vStonePos;
varying vec3 vStoneCamObj;
varying mat3 vStoneToView;
`;

const HELPERS = /* glsl */`
vec3 stoneBlend(vec3 n, float sharpness) {
  vec3 b = pow(abs(n), vec3(sharpness));
  return b / max(b.x + b.y + b.z, 1e-5);
}

float stoneHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float stoneNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = stoneHash(i), b = stoneHash(i + vec2(1.0, 0.0));
  float c = stoneHash(i + vec2(0.0, 1.0)), d = stoneHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float stoneFbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * stoneNoise(p); p *= 2.07; a *= 0.5; }
  return s / 0.9375;
}

/**
 * Parallax on one plane.
 *
 * The ray steps down through the height map, and at each step asks whether it
 * has gone under the surface yet. The moment it has, the hit is interpolated
 * between that step and the one before — without the interpolation you see
 * stairs. More steps are spent the more glancing the view is, because straight
 * on there is nothing to find and glancing is where the whole effect lives.
 */
vec2 stoneParallax(sampler2D heightMap, vec2 uv, vec2 viewTangent, float viewNormal, float depth) {
  if (depth <= 0.0001) return uv;
  float steps = mix(24.0, 9.0, clamp(abs(viewNormal), 0.0, 1.0));
  float layer = 1.0 / steps;
  vec2 delta = (viewTangent / max(abs(viewNormal), 0.22)) * depth * layer;

  float current = 1.0;
  vec2 cursor = uv;
  float sampled = texture2D(heightMap, cursor).r;

  for (int i = 0; i < 24; i++) {
    if (float(i) >= steps || sampled >= current) break;
    cursor -= delta;
    current -= layer;
    sampled = texture2D(heightMap, cursor).r;
  }

  vec2 previous = cursor + delta;
  float afterGap = sampled - current;
  float beforeGap = texture2D(heightMap, previous).r - (current + layer);
  float weight = afterGap / max(afterGap - beforeGap, 1e-5);
  return mix(cursor, previous, clamp(weight, 0.0, 1.0));
}

// Worked out once per fragment: all three sample sets share the same UVs and
// the same weights, so the albedo, the roughness and the normal reuse them.
vec3 gStoneN;
vec3 gStoneW;
vec2 gUvX, gUvY, gUvZ;
vec3 gStoneSign;

void stonePrepare() {
  gStoneN = normalize(cross(dFdx(vStonePos), dFdy(vStonePos)));
  gStoneW = stoneBlend(gStoneN, uBlendSharp);
  gStoneSign = vec3(
    gStoneN.x >= 0.0 ? 1.0 : -1.0,
    gStoneN.y >= 0.0 ? 1.0 : -1.0,
    gStoneN.z >= 0.0 ? 1.0 : -1.0
  );

  vec3 p = vStonePos * uStoneScale;
  // Flipping the UV on the back side of each plane stops the texture mirroring
  // itself round the pot.
  gUvX = vec2(p.z * gStoneSign.x, p.y);
  gUvY = vec2(p.x, p.z * gStoneSign.y);
  gUvZ = vec2(p.x * gStoneSign.z, p.y);

  float depth = uParallax * uStoneScale;
  if (depth > 0.0) {
    vec3 V = normalize(vStoneCamObj - vStonePos);
    if (gStoneW.x > 0.07) {
      gUvX = stoneParallax(uDispMap, gUvX, vec2(V.z * gStoneSign.x, V.y), V.x * gStoneSign.x, depth);
    }
    if (gStoneW.y > 0.07) {
      gUvY = stoneParallax(uDispMap, gUvY, vec2(V.x, V.z * gStoneSign.y), V.y * gStoneSign.y, depth);
    }
    if (gStoneW.z > 0.07) {
      gUvZ = stoneParallax(uDispMap, gUvZ, vec2(V.x * gStoneSign.z, V.y), V.z * gStoneSign.z, depth);
    }
  }
}

vec4 stoneSample(sampler2D tex) {
  return texture2D(tex, gUvX) * gStoneW.x
       + texture2D(tex, gUvY) * gStoneW.y
       + texture2D(tex, gUvZ) * gStoneW.z;
}

/**
 * Triplanar normal, whiteout blend, with the detail layer mixed in.
 *
 * Averaging three normal samples cancels the detail exactly where the surface
 * is most sloped — which is to say on the facets that give the stone its
 * character. Whiteout adds the tangent part instead of averaging it, so the
 * detail survives.
 */
vec3 stoneNormal(sampler2D nmap) {
  vec3 tx = texture2D(nmap, gUvX).xyz * 2.0 - 1.0;
  vec3 ty = texture2D(nmap, gUvY).xyz * 2.0 - 1.0;
  vec3 tz = texture2D(nmap, gUvZ).xyz * 2.0 - 1.0;

  if (uDetailStrength > 0.001) {
    float s = uDetailScale;
    vec3 dx = texture2D(nmap, gUvX * s).xyz * 2.0 - 1.0;
    vec3 dy = texture2D(nmap, gUvY * s).xyz * 2.0 - 1.0;
    vec3 dz = texture2D(nmap, gUvZ * s).xyz * 2.0 - 1.0;
    tx.xy += dx.xy * uDetailStrength;
    ty.xy += dy.xy * uDetailStrength;
    tz.xy += dz.xy * uDetailStrength;
  }

  tx.xy *= uNormalStrength; ty.xy *= uNormalStrength; tz.xy *= uNormalStrength;

  vec3 n = gStoneN;
  vec3 ax = vec3(tx.xy + n.zy, abs(tx.z) * n.x);
  vec3 ay = vec3(ty.xy + n.xz, abs(ty.z) * n.y);
  vec3 az = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
  return normalize(ax.zyx * gStoneW.x + ay.xzy * gStoneW.y + az.xyz * gStoneW.z);
}
`;

/** Sharpness of the blend between the three planes. High keeps facets crisp. */
const BLEND_SHARPNESS = 7;
const NORMAL_STRENGTH = 1.5;
const DETAIL_SCALE = 7;
const DETAIL_STRENGTH = 0.55;
/** How far a hand-mixed batch drifts before it repeats (mm) — about a pot and a half. */
const TONE_SCALE_MM = 900;
const CAVITY = 0.85;

export interface StoneLook {
  stone: PlanterStoneMaterial;
  /** Scene units per millimetre, from the shell — everything below is specified in mm. */
  scale: number;
  /** Relief the coat actually pays for (mm). The preview never shows more than this. */
  reliefMm: number;
  /** How far the batch drifts across one pot, 0–1. */
  toneVariation: number;
  /** The wash mixed into the glaze, `#rrggbb`. */
  tint: string;
  seal: PlanterStoneSeal;
}

const mapUrl = (id: string, kind: string): string => `/media/stone/${id}/${kind}.jpg`;

/**
 * One MeshStandardMaterial per stone, with the sampling replaced.
 *
 * Riding on the standard material rather than writing a ShaderMaterial gets the
 * whole of three's lighting pipeline for free — the environment map, the tone
 * mapping, the shadows — and changes only where the colour comes from.
 *
 * The material is rebuilt when the stone changes, because that is a new shader
 * program either way; everything else is a uniform write, so dragging the
 * relief slider does not recompile anything.
 */
export function useStoneMaterial(look: StoneLook | null): THREE.MeshStandardMaterial | null {
  const id = look?.stone.id ?? null;

  const material = useMemo(() => {
    if (!id) return null;
    const uniforms = {
      uArmMap: { value: loadMap(mapUrl(id, 'arm'), false) },
      uDispMap: { value: loadMap(mapUrl(id, 'disp'), false) },
      uStoneScale: { value: 1 },
      uBlendSharp: { value: BLEND_SHARPNESS },
      uNormalStrength: { value: NORMAL_STRENGTH },
      uParallax: { value: 0 },
      uDetailScale: { value: DETAIL_SCALE },
      uDetailStrength: { value: DETAIL_STRENGTH },
      uToneVariation: { value: 0.35 },
      uToneFreq: { value: 1 / TONE_SCALE_MM },
      uTint: { value: new THREE.Color('#ffffff') },
      uCavity: { value: CAVITY },
      uAoStrength: { value: 1 },
      uRoughRange: { value: new THREE.Vector2(0.72, 1) },
    };

    const mat = new THREE.MeshStandardMaterial({
      map: loadMap(mapUrl(id, 'diff'), true),
      normalMap: loadMap(mapUrl(id, 'nor'), false),
      roughness: 1,
      metalness: 0,
      side: THREE.DoubleSide,
      // Off deliberately. It would force one normal per face and throw away the
      // normal map and the parallax with it; the facets come through anyway,
      // from the geometric normal the shader derives per fragment.
      flatShading: false,
    });
    mat.userData.stoneUniforms = uniforms;

    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
varying vec3 vStonePos;
varying vec3 vStoneCamObj;
varying mat3 vStoneToView;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
vStonePos = position;
vStoneToView = normalMatrix;
// The camera in object space. The rotation is transposed by hand rather than
// inverted, so this compiles on WebGL1 as well.
mat3 stoneRt = mat3(
  modelMatrix[0][0], modelMatrix[1][0], modelMatrix[2][0],
  modelMatrix[0][1], modelMatrix[1][1], modelMatrix[2][1],
  modelMatrix[0][2], modelMatrix[1][2], modelMatrix[2][2]
);
vStoneCamObj = stoneRt * (cameraPosition - modelMatrix[3].xyz);`);

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${UNIFORMS}${HELPERS}`)

        .replace('#include <map_fragment>', /* glsl */`
          stonePrepare();
          vec3 stoneArm = stoneSample(uArmMap).rgb;
          vec3 albedo = stoneSample(map).rgb;

          // Cavity: the hollows are darkened in the albedo itself. Light does
          // not reach into a narrow crack, and without this every one of them
          // comes out too bright.
          albedo *= mix(1.0, stoneArm.r, uCavity);

          // The hand-mixed batch, drifting across the pot. This is the one part
          // of the look that is about it having been painted by a person.
          float tone = mix(1.0, 0.62 + 0.76 * stoneFbm(vStonePos.xy * uToneFreq), uToneVariation);
          albedo *= tone;
          albedo *= uTint;
          albedo = clamp((albedo - 0.5) * 1.08 + 0.5, 0.0, 4.0);
          diffuseColor.rgb *= albedo;
        `)

        .replace('#include <roughnessmap_fragment>', /* glsl */`
          float roughnessFactor = mix(uRoughRange.x, uRoughRange.y, stoneArm.g);
        `)

        .replace('#include <aomap_fragment>', /* glsl */`
          float stoneAo = mix(1.0, stoneArm.r, uAoStrength);
          reflectedLight.indirectDiffuse *= stoneAo;
          #if defined( USE_ENVMAP ) && defined( STANDARD )
            float stoneDotNV = saturate(dot(geometryNormal, geometryViewDir));
            reflectedLight.indirectSpecular *= computeSpecularOcclusion(stoneDotNV, stoneAo, material.roughness);
          #endif
        `)

        .replace('#include <normal_fragment_maps>', /* glsl */`
          normal = normalize(vStoneToView * stoneNormal(normalMap));
        `);
    };

    return mat;
  }, [id]);

  // Dispose the program when the stone changes or the studio unmounts. The maps
  // themselves are cached and shared, so they are deliberately left alone.
  useEffect(() => () => { material?.dispose(); }, [material]);

  useEffect(() => {
    if (!material || !look) return;
    const u = material.userData.stoneUniforms as Record<string, { value: unknown }>;
    // The pot's geometry is in scene units, so both the tile and the relief are
    // converted out of millimetres here — which is what keeps a 600 mm ashlar
    // block reading as one block on a 300 mm pot instead of as gravel.
    const perMm = look.scale;
    u.uStoneScale.value = 1 / Math.max(look.stone.tileMm * perMm, 1e-6);
    u.uParallax.value = Math.max(look.reliefMm, 0) * perMm;
    u.uToneVariation.value = look.toneVariation;
    (u.uTint.value as THREE.Color).set(look.tint);
    const [low, high] = SEAL_ROUGHNESS[look.seal];
    (u.uRoughRange.value as THREE.Vector2).set(low, high);
    material.envMapIntensity = SEAL_REFLECTION[look.seal];
    material.needsUpdate = true;
  }, [material, look]);

  return material;
}
