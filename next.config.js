/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // Keep defaults; we avoid server components accessing browser-only libs.
  },
};

module.exports = nextConfig;
