/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  experimental: {
    typedRoutes: true,
    serverComponentsExternalPackages: ["playwright", "playwright-core"]
  }
};

export default nextConfig;
