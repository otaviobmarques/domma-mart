import './globals.css';
import type { Metadata, Viewport } from 'next';
import { NetworkBanner } from '@/components/ui';

export const metadata: Metadata = {
  title: { default: 'Domma Mart', template: '%s · Domma Mart' },
  description: 'Venda seus produtos digitais com checkout rápido, Pix na hora e área de membros.',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg' },
};
export const viewport: Viewport = { themeColor: '#5B3FE6', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;600&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body className="min-h-screen antialiased">
        <NetworkBanner />
        {children}
      </body>
    </html>
  );
}
