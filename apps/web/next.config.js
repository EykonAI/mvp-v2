/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'tiles.sentinel-hub.com' },
      { protocol: 'https', hostname: 'gibs.earthdata.nasa.gov' },
    ],
  },
  experimental: {
    serverActions: { bodySizeLimit: '2mb' },
  },
  // Transpile deck.gl ESM packages
  transpilePackages: [
    '@deck.gl/core',
    '@deck.gl/layers',
    '@deck.gl/geo-layers',
    '@deck.gl/react',
  ],
  webpack: (config) => {
    // Fix maplibre-gl worker
    config.resolve.alias = {
      ...config.resolve.alias,
      'maplibre-gl': 'maplibre-gl/dist/maplibre-gl.js',
    };
    return config;
  },
};

module.exports = nextConfig;
