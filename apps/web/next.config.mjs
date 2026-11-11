const API = process.env.API_URL || 'http://127.0.0.1:4000';

/** CSP restrita na página de pagamento (PCI-DSS v4, seção 11.1). Ajuste os domínios do gateway real. */
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://connect.facebook.net https://www.googletagmanager.com https://3ds-nx-js.stone.com.br",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob:",
  "connect-src 'self' https://www.google-analytics.com https://api.pwnedpasswords.com https://api.pagar.me https://3ds.stone.com.br https://3ds-sdx.stone.com.br https://viacep.com.br",
  // 3-D Secure: a página de confirmação é do banco emissor (domínio variável), aberta num iframe
  "frame-src https://challenges.cloudflare.com https:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' https:", // 3DS Method envia um formulário ao servidor do emissor
].join('; ');

export default {
  reactStrictMode: true,
  poweredByHeader: false,
  async rewrites() {
    return [
      { source: '/v1/:path*', destination: `${API}/v1/:path*` },
      { source: '/api/v1/:path*', destination: `${API}/api/v1/:path*` }, // API pública
      { source: '/r/:path*', destination: `${API}/r/:path*` },
      { source: '/webhooks/:path*', destination: `${API}/webhooks/:path*` },
    ];
  },
  async headers() {
    const base = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
    ];
    return [
      { source: '/:path*', headers: base },
      { source: '/pay/:path*', headers: [{ key: 'Content-Security-Policy', value: csp }] },
      { source: '/pix/:path*', headers: [{ key: 'Content-Security-Policy', value: csp }] },
    ];
  },
};
