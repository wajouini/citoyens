'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { logoutAction } from '@/actions/auth';

const navItems = [
  { label: 'Dashboard', href: '/', icon: '📊' },
  { label: 'Édition', href: '/edition', icon: '📰' },
  { label: 'Historique', href: '/edition/history', icon: '📚' },
  { label: 'Éditorial', href: '/editorial', icon: '🎯' },
  { label: 'Espace Sémantique', href: '/clustering', icon: '🌌' },
  { label: 'Prévisualisation', href: '/preview', icon: '👁' },
  { label: 'Sources', href: '/sources', icon: '📡' },
  { label: 'Runs', href: '/runs', icon: '⚡' },
  { label: 'Utilisateurs', href: '/users', icon: '👥' },
  { label: 'Settings', href: '/settings', icon: '⚙️' },
];

function SidebarContent({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <>
      <div className="p-5 border-b border-white/10">
        <Link href="/" className="flex items-baseline gap-1 no-underline text-white" onClick={onNavigate}>
          <span className="font-display text-[22px] font-black tracking-tighter">citoyens</span>
          <span className="font-mono text-[12px] font-medium text-bleu-clair bg-bleu-rep px-1 py-0.5 rounded">.ai</span>
        </Link>
        <div className="font-mono text-[11px] text-orange uppercase tracking-[2px] mt-1">Admin Pipeline</div>
      </div>
      <nav className="flex-1 py-3">
        {navItems.map((item) => {
          const isActive = item.href === '/'
            ? pathname === '/'
            : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={`flex items-center gap-2.5 px-5 py-2.5 text-[15px] font-medium no-underline transition-colors ${
                isActive
                  ? 'text-white bg-white/10 border-r-2 border-bleu-rep'
                  : 'text-white/70 hover:text-white hover:bg-white/5'
              }`}
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="p-5 border-t border-white/10 space-y-2">
        <a
          href={process.env.NEXT_PUBLIC_SITE_URL || 'https://citoyens.ai'}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[13px] text-white/40 no-underline hover:text-white/70 font-mono block"
        >
          ← Retour au site
        </a>
        <button
          onClick={() => logoutAction()}
          className="text-[13px] text-white/30 hover:text-rouge-doux font-mono cursor-pointer bg-transparent border-0 p-0"
        >
          Déconnexion
        </button>
      </div>
    </>
  );
}

export function NavSidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  if (pathname === '/login') return null;

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="w-56 bg-noir text-white flex-col shrink-0 hidden md:flex">
        <SidebarContent pathname={pathname} />
      </aside>

      {/* Mobile header */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 bg-noir text-white flex items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-baseline gap-1 no-underline text-white">
          <span className="font-display text-[18px] font-black tracking-tighter">citoyens</span>
          <span className="font-mono text-[11px] font-medium text-bleu-clair bg-bleu-rep px-1 py-0.5 rounded">.ai</span>
        </Link>
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="text-white bg-transparent border-0 cursor-pointer text-[20px] p-1"
          aria-label="Menu"
        >
          {mobileOpen ? '✕' : '☰'}
        </button>
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-noir/70" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-64 bg-noir text-white flex flex-col">
            <SidebarContent pathname={pathname} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}
    </>
  );
}
