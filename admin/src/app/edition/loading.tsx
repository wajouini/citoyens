export default function EditionLoading() {
  return (
    <div className="p-8 animate-pulse">
      <div className="h-8 bg-gris-chaud/50 rounded w-52 mb-2" />
      <div className="h-4 bg-gris-chaud/30 rounded w-64 mb-8" />
      <div className="flex gap-6">
        <div className="flex-1 space-y-6">
          <div className="bg-blanc rounded-xl border border-gris-chaud p-6">
            <div className="h-4 bg-gris-chaud/30 rounded w-20 mb-3" />
            <div className="h-7 bg-gris-chaud/50 rounded w-3/4 mb-3" />
            <div className="h-4 bg-gris-chaud/20 rounded w-full mb-2" />
            <div className="h-4 bg-gris-chaud/20 rounded w-2/3" />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="bg-blanc rounded-xl border border-gris-chaud p-4 h-28" />
              ))}
            </div>
            <div className="space-y-3">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="bg-blanc rounded-xl border border-gris-chaud p-4 h-36" />
              ))}
            </div>
          </div>
        </div>
        <div className="w-72 flex-shrink-0 space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 bg-gris-chaud/30 rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  );
}
