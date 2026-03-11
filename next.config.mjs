/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Kept for compatibility if pdf-parse is used in Server Components.
    // (Safe to leave even if currently unused.)
    serverComponentsExternalPackages: ["pdf-parse"],
  },
}

export default nextConfig

