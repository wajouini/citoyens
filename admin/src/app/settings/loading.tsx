export default function SettingsLoading() {
  return (
    <div className="p-8 animate-pulse">
      <div className="h-8 bg-gris-chaud/50 rounded w-32 mb-2" />
      <div className="h-4 bg-gris-chaud/30 rounded w-56 mb-8" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-blanc rounded-xl border border-gris-chaud p-6 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-14 bg-gris-chaud/20 rounded-lg" />
          ))}
        </div>
        <div className="bg-blanc rounded-xl border border-gris-chaud p-6 space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-8 bg-gris-chaud/20 rounded" />
          ))}
        </div>
      </div>
    </div>
  );
}
