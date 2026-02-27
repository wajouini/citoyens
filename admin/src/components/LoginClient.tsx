'use client';

import { useState, useTransition } from 'react';
import { loginAction } from '@/actions/auth';

export function LoginClient() {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      setError(null);
      const result = await loginAction(fd.get('password') as string);
      if (!result.success) {
        setError(result.error || 'Mot de passe incorrect');
      }
      // If success, the action redirects
    });
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-creme">
      <div className="bg-blanc rounded-xl border border-gris-chaud p-8 w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="flex items-baseline justify-center gap-1 mb-2">
            <span className="font-display text-[28px] font-black tracking-tighter text-noir">citoyens</span>
            <span className="font-mono text-[12px] font-medium text-bleu-clair bg-bleu-rep px-1 py-0.5 rounded">.ai</span>
          </div>
          <div className="font-mono text-[11px] text-orange uppercase tracking-[2px]">Admin Pipeline</div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="font-mono text-[12px] uppercase tracking-[1px] text-gris-clair block mb-1.5">
              Mot de passe
            </label>
            <input
              name="password"
              type="password"
              required
              autoFocus
              placeholder="••••••••"
              className="w-full bg-creme border border-gris-chaud rounded-lg px-3 py-2.5 font-mono text-[15px] text-noir placeholder-gris-clair focus:outline-none focus:border-bleu-rep"
            />
          </div>

          {error && (
            <div className="bg-rouge-doux/10 text-rouge-doux font-mono text-[13px] px-3 py-2 rounded">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isPending}
            className="w-full bg-noir text-white font-mono text-[14px] font-bold px-4 py-2.5 rounded-lg hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
          >
            {isPending ? 'Connexion...' : 'Connexion'}
          </button>
        </form>
      </div>
    </div>
  );
}
