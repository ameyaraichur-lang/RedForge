/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // /api/* is proxied at request time by app/api/[...path]/route.ts (RF_API_BASE).
};

export default nextConfig;
