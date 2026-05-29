const nextConfig = {
  async rewrites() {
    return [
      {
        source: "/ai-tool/:toolId/api/:path*",
        destination: "/api/:path*",
      },
    ];
  },
};

export default nextConfig;
