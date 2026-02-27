export default function SourcesLoading() {
  return (
    <div className="p-8 animate-pulse">
      <div className="h-8 bg-gris-chaud/50 rounded w-40 mb-2" />
      <div className="h-4 bg-gris-chaud/30 rounded w-60 mb-8" />
      <div className="flex gap-2 mb-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-8 bg-gris-chaud/30 rounded-lg w-24" />
        ))}
      </div>
      <div className="bg-blanc rounded-xl border border-gris-chaud p-4 space-y-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-10 bg-gris-chaud/20 rounded" />
        ))}
      </div>
    </div>
  );
}
