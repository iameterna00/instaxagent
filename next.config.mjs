/** @type {import('next').NextConfig} */

// The dev server rejects cross-origin requests for its own internal assets,
// which breaks as soon as the app is reached through a tunnel hostname rather
// than localhost. `npm run dev:tunnel` sets DEV_TUNNEL_HOSTNAME to the hostname
// it just opened; the wildcards cover Cloudflare quick tunnels, whose hostname
// is random on every run.
const devOrigins = ["*.trycloudflare.com", "*.cfargotunnel.com"]
if (process.env.DEV_TUNNEL_HOSTNAME) devOrigins.push(process.env.DEV_TUNNEL_HOSTNAME)

const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  allowedDevOrigins: devOrigins,
}

export default nextConfig
