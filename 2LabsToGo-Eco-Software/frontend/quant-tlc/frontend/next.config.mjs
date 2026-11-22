/** @type {import('next').NextConfig} */
export default {
  output: "standalone",
  reactStrictMode: false,
  trailingSlash: true,
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return ["/csrf/", "/read-image/", "/Raw_densitogram/", "/Processed_densitogram/", "/peak_integration/", "/calibrate/"].map((source) => ({
      source,
      destination: "http://backend:8000" + source,
    }));
  },
};
