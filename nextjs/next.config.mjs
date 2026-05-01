/** @type {import('next').NextConfig} */
const nextConfig = {
  // API Routes 文件上传限制（500MB，大剧本支持）
  experimental: {
    serverActions: {
      bodySizeLimit: "500mb",
    },
  },
};

export default nextConfig;
