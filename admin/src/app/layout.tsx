import type { Metadata } from 'next';
import { Playfair_Display, Source_Sans_3, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { NavSidebar } from '@/components/NavSidebar';

const playfair = Playfair_Display({
  subsets: ['latin'],
  weight: ['400', '700', '900'],
  variable: '--nf-display',
  display: 'swap',
});

const sourceSans = Source_Sans_3({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--nf-body',
  display: 'swap',
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--nf-mono',
  display: 'swap',
});

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
    <html lang="fr" className={`${playfair.variable} ${sourceSans.variable} ${jetbrains.variable}`} suppressHydrationWarning>
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
