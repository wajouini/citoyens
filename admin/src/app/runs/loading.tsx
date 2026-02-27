export default function RunsLoading() {
  return (
    <div className="p-8 animate-pulse">
      <div className="h-8 bg-gris-chaud/50 rounded w-44 mb-2" />
      <div className="h-4 bg-gris-chaud/30 rounded w-48 mb-8" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-blanc rounded-xl border border-gris-chaud p-4">
            <div className="h-3 bg-gris-chaud/30 rounded w-12 mb-3" />
            <div className="h-6 bg-gris-chaud/50 rounded w-8" />
          </div>
        ))}
      </div>
      <div className="bg-blanc rounded-xl border border-gris-chaud p-4 space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-10 bg-gris-chaud/20 rounded" />
        ))}
      </div>
    </div>
  );
}
