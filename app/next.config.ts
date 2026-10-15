import type { NextConfig } from 'next';
const config: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  serverExternalPackages: ['node:sqlite'],
  outputFileTracingExcludes: {'/*':['./.env*','./.data/**','./.venv/**','./tests/**','./server/test_*.py']},
  async headers() {
    return [{source: '/:path*', headers: [
      {key: 'X-Content-Type-Options', value: 'nosniff'},
      {key: 'Referrer-Policy', value: 'same-origin'},
      {key: 'Permissions-Policy', value: 'camera=(), microphone=()'}
    ]}];
  }
};
export default config;
