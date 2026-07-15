/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    // CompanyCam photos are hotlinked from their CDN. When real sync is wired,
    // confirm the exact CDN host and whether URLs are signed/expiring.
    remotePatterns: [
      { protocol: "https", hostname: "**.companycam.com" },
      { protocol: "https", hostname: "dummyimage.com" },
      { protocol: "https", hostname: "picsum.photos" },
    ],
  },
};

export default nextConfig;
