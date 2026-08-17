import type { NextConfig } from 'next';

/**
 * Packages that must stay outside the bundler on the server:
 *  - @prisma/client / prisma  : ships its own query engine binary
 *  - @resvg/resvg-js          : native .node addon (SVG -> PNG)
 *  - bullmq / ioredis         : long-lived sockets, not bundler-friendly
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  /**
   * Defaults to `.next`. Override with NEXT_DIST_DIR to run a production build
   * without clobbering the artefacts a `next dev` server is serving from —
   * `NEXT_DIST_DIR=.next-build npm run build`.
   */
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  serverExternalPackages: [
    '@prisma/client',
    'prisma',
    '@resvg/resvg-js',
    'bullmq',
    'ioredis',
  ],
  typescript: {
    // Type errors must fail the build. Never flip this to true.
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
