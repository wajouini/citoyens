import type { Metadata } from 'next';
import './globals.css';
import { NavSidebar } from '@/components/NavSidebar';

export const metadata: Metadata = {
  title: 'Admin — Citoyens.ai',
  description: "Dashboard d'administration du pipeline Citoyens.ai",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <link
          rel="preconnect"
          href="https://fonts.googleapis.com"
        />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&family=Playfair+Display:wght@400;700;900&family=Source+Sans+3:wght@300;400;500;600;700&display=swap"
        />
      </head>
      <body className="antialiased">
        <div className="flex min-h-screen">
          <NavSidebar />
          <main className="flex-1 overflow-auto pt-14 md:pt-0">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
