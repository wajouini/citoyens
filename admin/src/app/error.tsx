'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[admin]', error);
  }, [error]);

  return (
    <div className="p-8 flex items-center justify-center min-h-[60vh]">
      <div className="bg-blanc rounded-xl border border-rouge-doux/30 p-8 max-w-md w-full text-center">
        <div className="text-[36px] mb-3">⚠️</div>
        <h2 className="font-display text-[20px] font-bold text-noir mb-2">
          Une erreur est survenue
        </h2>
        <p className="text-[13px] text-gris-texte mb-4">
          {error.message || 'Erreur inattendue'}
        </p>
        {error.digest && (
          <p className="font-mono text-[10px] text-gris-clair mb-4">
            Digest : {error.digest}
          </p>
        )}
        <button
          onClick={reset}
          className="bg-noir text-white font-mono text-[12px] font-bold px-6 py-2.5 rounded-lg hover:opacity-90 cursor-pointer"
        >
          Réessayer
        </button>
      </div>
    </div>
  );
}
