/**
 * The fold studio, on its own.
 *
 * This file used to carry a `SITE=planter` switch that rewrote `/` to
 * `/planter`, so one deployment could serve two businesses from one repository
 * without duplicating the engine they shared. The planter has its own
 * repository now, so there is no second site to rewrite into and nothing left
 * to keep apart.
 */

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
