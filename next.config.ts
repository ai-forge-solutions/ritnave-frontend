import type { NextConfig } from 'next';
const config: NextConfig = { output: 'standalone', poweredByHeader: false, allowedDevOrigins: ['127.0.0.1', 'localhost'] };
export default config;
