/**
 * One codebase, two sites.
 *
 * The AC3D fold studio and the DXF.TLV planter shop are different businesses
 * with different visitors, but they share an engine — the same
 * `lib/planter-engine` cuts both their files — so splitting the repository
 * would mean duplicating the one part that must never drift.
 *
 * They are split at the deployment instead. Each gets its own Vercel project
 * and its own address, and `SITE` is what tells a build which of the two it
 * is. Unset (the ac3d-studio project) nothing is rewritten and `/` is the fold
 * studio, exactly as before. Set to `planter`, the shop moves up to the root
 * so its address carries no sub-path.
 *
 * `beforeFiles` matters here: `/` is a real prerendered page, and a rewrite
 * that ran after the filesystem would never be reached.
 */
const planterAtRoot = process.env.SITE === 'planter';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    if (!planterAtRoot) return [];
    return {
      beforeFiles: [
        { source: '/', destination: '/planter' },
        { source: '/studio', destination: '/planter/studio' },
      ],
    };
  },
};

export default nextConfig;
