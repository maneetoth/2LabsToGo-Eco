/** @type {import('next').NextConfig} */
export default {
  output: "standalone",
  reactStrictMode: false,
  trailingSlash: true,
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return ["/csrf/", "/api/rtlc/:path*/", "/media/:path*"].map((source) => ({
      source,
      destination: "http://backend:8000" + source,
    }));
  },
};
