export default function DashboardLoading() {
  return (
    <div className="p-8 animate-pulse">
      <div className="h-8 bg-gris-chaud/50 rounded w-48 mb-2" />
      <div className="h-4 bg-gris-chaud/30 rounded w-72 mb-8" />
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-blanc rounded-xl border border-gris-chaud p-4">
            <div className="h-3 bg-gris-chaud/30 rounded w-16 mb-3" />
            <div className="h-6 bg-gris-chaud/50 rounded w-12" />
          </div>
        ))}
      </div>
      <div className="h-4 bg-gris-chaud/30 rounded w-32 mb-4" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 bg-gris-chaud/30 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
