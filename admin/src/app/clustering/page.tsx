'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';

// ---------- Types ----------

interface ArticleNode {
  id: string;
  titre: string;
  source: string;
  rubrique: string;
  type: string;
  topic_id: string | null;
  topic_titre: string | null;
  coherence: number | null;
  x: number;
  y: number;
}

interface TopicInfo {
  id: string;
  titre: string;
  article_ids: string[];
  sources: string[];
  types: string[];
  rubriques_detectees: string[];
  score: {
    nb_sources: number;
    coherence: number;
    total: number;
    fraicheur_h: number;
  };
}

interface TopicsData {
  topics: TopicInfo[];
  unclustered_ids: string[];
  meta: {
    nb_articles: number;
    nb_topics: number;
    nb_unclustered: number;
    version_pipeline: string;
    quality: {
      avg_silhouette: number;
      avg_coherence: number;
      pct_clustered: number;
      pct_multi_source: number;
    };
  };
}

// ---------- Color palette ----------

const CLUSTER_COLORS = [
  '#2563eb', '#dc2626', '#059669', '#d97706', '#7c3aed',
  '#db2777', '#0891b2', '#65a30d', '#ea580c', '#4f46e5',
  '#0d9488', '#c026d3', '#ca8a04', '#e11d48', '#0284c7',
  '#16a34a', '#9333ea', '#f59e0b', '#06b6d4', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
  '#ef4444', '#10b981', '#a855f7', '#f43f5e', '#22d3ee',
  '#eab308', '#3b82f6', '#d946ef', '#fb923c', '#34d399',
  '#818cf8', '#f472b6', '#2dd4bf', '#fbbf24', '#a78bfa',
];

function getClusterColor(index: number): string {
  return CLUSTER_COLORS[index % CLUSTER_COLORS.length];
}

// ---------- Canvas Scatter Plot ----------

function ScatterCanvas({
  nodes,
  topics,
  highlightTopic,
  onHover,
  onClick,
  filter,
}: {
  nodes: ArticleNode[];
  topics: TopicInfo[];
  highlightTopic: string | null;
  onHover: (node: ArticleNode | null, x: number, y: number) => void;
  onClick: (topicId: string | null) => void;
  filter: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef({ x: 0, y: 0, scale: 1 });
  const dragRef = useRef({ dragging: false, lastX: 0, lastY: 0 });
  const sizeRef = useRef({ w: 0, h: 0 });

  // Precompute topic index → color mapping
  const topicColorMap = useMemo(() => {
    const map = new Map<string, string>();
    topics.forEach((t, i) => map.set(t.id, getClusterColor(i)));
    return map;
  }, [topics]);

  // Filtered nodes
  const filteredNodes = useMemo(() => {
    if (!filter) return nodes;
    return nodes.filter(n => {
      if (filter === 'clustered') return n.topic_id !== null;
      if (filter === 'noise') return n.topic_id === null;
      return n.rubrique === filter || n.type === filter;
    });
  }, [nodes, filter]);

  // Compute centroids for labels
  const centroids = useMemo(() => {
    const map = new Map<string, { sumX: number; sumY: number; count: number; titre: string }>();
    for (const node of nodes) {
      if (!node.topic_id) continue;
      const entry = map.get(node.topic_id) || { sumX: 0, sumY: 0, count: 0, titre: node.topic_titre || '' };
      entry.sumX += node.x;
      entry.sumY += node.y;
      entry.count++;
      map.set(node.topic_id, entry);
    }
    const result: { topicId: string; x: number; y: number; titre: string; count: number }[] = [];
    map.forEach((entry, topicId) => {
      result.push({
        topicId,
        x: entry.sumX / entry.count,
        y: entry.sumY / entry.count,
        titre: entry.titre,
        count: entry.count,
      });
    });
    return result;
  }, [nodes]);

  const toScreen = useCallback((dataX: number, dataY: number) => {
    const { x, y, scale } = transformRef.current;
    const { w, h } = sizeRef.current;
    const padding = 40;
    const baseScale = Math.min(w - padding * 2, h - padding * 2) / 2;
    return {
      sx: w / 2 + (dataX * baseScale + x) * scale,
      sy: h / 2 + (-dataY * baseScale + y) * scale, // flip Y
    };
  }, []);

  const fromScreen = useCallback((sx: number, sy: number) => {
    const { x, y, scale } = transformRef.current;
    const { w, h } = sizeRef.current;
    const padding = 40;
    const baseScale = Math.min(w - padding * 2, h - padding * 2) / 2;
    return {
      dataX: ((sx - w / 2) / scale - x) / baseScale,
      dataY: -((sy - h / 2) / scale - y) / baseScale,
    };
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    sizeRef.current = { w, h };

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);

    // Draw noise points first (behind)
    for (const node of filteredNodes) {
      if (node.topic_id) continue;
      const { sx, sy } = toScreen(node.x, node.y);
      if (sx < -10 || sx > w + 10 || sy < -10 || sy > h + 10) continue;
      ctx.beginPath();
      ctx.arc(sx, sy, 3, 0, Math.PI * 2);
      ctx.fillStyle = highlightTopic ? 'rgba(209,213,219,0.2)' : 'rgba(209,213,219,0.5)';
      ctx.fill();
    }

    // Draw clustered points
    for (const node of filteredNodes) {
      if (!node.topic_id) continue;
      const { sx, sy } = toScreen(node.x, node.y);
      if (sx < -10 || sx > w + 10 || sy < -10 || sy > h + 10) continue;

      const color = topicColorMap.get(node.topic_id) || '#888';
      const isHighlighted = !highlightTopic || highlightTopic === node.topic_id;
      const radius = isHighlighted ? 5 : 3;
      const alpha = isHighlighted ? 0.9 : 0.15;

      ctx.beginPath();
      ctx.arc(sx, sy, radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = alpha;
      ctx.fill();
      if (isHighlighted) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // Draw cluster labels at centroids (only at sufficient zoom)
    const { scale } = transformRef.current;
    if (scale >= 0.8) {
      ctx.font = '11px ui-monospace, monospace';
      ctx.textAlign = 'center';
      for (const c of centroids) {
        if (highlightTopic && highlightTopic !== c.topicId) continue;
        const { sx, sy } = toScreen(c.x, c.y);
        if (sx < -50 || sx > w + 50 || sy < -20 || sy > h + 20) continue;

        const label = c.titre.slice(0, 40) + (c.titre.length > 40 ? '...' : '');
        const metrics = ctx.measureText(label);
        const padding = 4;

        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillRect(
          sx - metrics.width / 2 - padding,
          sy - 18 - padding,
          metrics.width + padding * 2,
          14 + padding * 2
        );

        const color = topicColorMap.get(c.topicId) || '#888';
        ctx.fillStyle = color;
        ctx.fillText(label, sx, sy - 12);

        // Article count badge
        ctx.font = 'bold 9px ui-monospace, monospace';
        ctx.fillStyle = '#6b7280';
        ctx.fillText(`${c.count} art`, sx, sy - 1);
        ctx.font = '11px ui-monospace, monospace';
      }
    }

    ctx.restore();
  }, [filteredNodes, centroids, highlightTopic, topicColorMap, toScreen]);

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      sizeRef.current = { w: rect.width, h: rect.height };
      draw();
    };

    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    return () => observer.disconnect();
  }, [draw]);

  // Redraw on data/highlight change
  useEffect(() => { draw(); }, [draw]);

  // Mouse handlers
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const t = transformRef.current;
    t.scale = Math.max(0.3, Math.min(20, t.scale * delta));
    draw();
  }, [draw]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    dragRef.current = { dragging: true, lastX: e.clientX, lastY: e.clientY };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragRef.current.dragging) {
      const dx = e.clientX - dragRef.current.lastX;
      const dy = e.clientY - dragRef.current.lastY;
      transformRef.current.x += dx / transformRef.current.scale;
      transformRef.current.y += dy / transformRef.current.scale;
      dragRef.current.lastX = e.clientX;
      dragRef.current.lastY = e.clientY;
      draw();
      return;
    }

    // Hover detection
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    let closest: ArticleNode | null = null;
    let closestDist = 15; // pixel threshold

    for (const node of filteredNodes) {
      const { sx, sy } = toScreen(node.x, node.y);
      const dist = Math.sqrt((sx - mx) ** 2 + (sy - my) ** 2);
      if (dist < closestDist) {
        closest = node;
        closestDist = dist;
      }
    }

    onHover(closest, e.clientX, e.clientY);
  }, [filteredNodes, toScreen, draw, onHover]);

  const handleMouseUp = useCallback(() => {
    dragRef.current.dragging = false;
  }, []);

  const handleClick = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    let closest: ArticleNode | null = null;
    let closestDist = 15;

    for (const node of filteredNodes) {
      const { sx, sy } = toScreen(node.x, node.y);
      const dist = Math.sqrt((sx - mx) ** 2 + (sy - my) ** 2);
      if (dist < closestDist) {
        closest = node;
        closestDist = dist;
      }
    }

    onClick(closest?.topic_id ?? null);
  }, [filteredNodes, toScreen, onClick]);

  const handleDoubleClick = useCallback(() => {
    transformRef.current = { x: 0, y: 0, scale: 1 };
    onClick(null);
    draw();
  }, [draw, onClick]);

  return (
    <div ref={containerRef} className="w-full h-full relative">
      <canvas
        ref={canvasRef}
        className="w-full h-full cursor-grab active:cursor-grabbing"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      />
    </div>
  );
}

// ---------- Main Page ----------

export default function ClusteringPage() {
  const [nodes, setNodes] = useState<ArticleNode[]>([]);
  const [topicsData, setTopicsData] = useState<TopicsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<{ node: ArticleNode; x: number; y: number } | null>(null);
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    fetch('/api/pipeline/clustering')
      .then((res) => {
        if (!res.ok) throw new Error('Données non trouvées. Lancez cluster-topics.ts.');
        return res.json();
      })
      .then((json) => {
        setNodes(json.nodes || json); // backward compat
        setTopicsData(json.topics || null);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  const topics = topicsData?.topics || [];
  const meta = topicsData?.meta;

  const handleHover = useCallback((node: ArticleNode | null, x: number, y: number) => {
    setHoveredNode(node ? { node, x, y } : null);
  }, []);

  const handleClick = useCallback((topicId: string | null) => {
    setSelectedTopic(prev => prev === topicId ? null : topicId);
  }, []);

  const selectedTopicInfo = useMemo(() => {
    if (!selectedTopic) return null;
    return topics.find(t => t.id === selectedTopic) || null;
  }, [selectedTopic, topics]);

  const selectedArticles = useMemo(() => {
    if (!selectedTopic) return [];
    return nodes.filter(n => n.topic_id === selectedTopic);
  }, [selectedTopic, nodes]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
          <p className="text-gray-600 font-mono">Chargement de la projection t-SNE...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-8 max-w-2xl mx-auto mt-12 text-center">
        <h2 className="text-red-700 font-bold text-xl mb-4">Donn&eacute;es indisponibles</h2>
        <p className="text-red-600 mb-6">{error}</p>
      </div>
    );
  }

  const clusteredCount = nodes.filter(n => n.topic_id).length;

  return (
    <div className="h-[calc(100vh-2rem)] flex gap-4">
      {/* Main visualization area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header stats */}
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">Espace s&eacute;mantique</h1>
          <div className="flex items-center gap-3 text-xs font-mono text-gray-500">
            <span>{nodes.length} articles</span>
            <span className="text-gray-300">|</span>
            <span className="text-blue-600">{topics.length} topics</span>
            <span className="text-gray-300">|</span>
            <span>{(clusteredCount / nodes.length * 100).toFixed(0)}% regroup&eacute;s</span>
            {meta && (
              <>
                <span className="text-gray-300">|</span>
                <span title="Silhouette score">sil={meta.quality.avg_silhouette}</span>
                <span className="text-gray-300">|</span>
                <span title="Coherence moyenne">coh={meta.quality.avg_coherence}</span>
              </>
            )}
          </div>
        </div>

        {/* Filter bar */}
        <div className="mb-3 flex gap-2 flex-wrap">
          <button
            onClick={() => setFilter('')}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${!filter ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            Tout
          </button>
          <button
            onClick={() => setFilter('clustered')}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${filter === 'clustered' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            Regroup&eacute;s
          </button>
          <button
            onClick={() => setFilter('noise')}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${filter === 'noise' ? 'bg-gray-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            Bruit
          </button>
          <span className="text-gray-300">|</span>
          {['international', 'politique', 'tech', 'science', 'societe', 'economie'].map(r => (
            <button
              key={r}
              onClick={() => setFilter(filter === r ? '' : r)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${filter === r ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              {r}
            </button>
          ))}
          <span className="text-gray-300">|</span>
          {['mainstream', 'etranger', 'investigation', 'fact-check'].map(t => (
            <button
              key={t}
              onClick={() => setFilter(filter === t ? '' : t)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${filter === t ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Canvas */}
        <div className="flex-1 bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden relative">
          <ScatterCanvas
            nodes={nodes}
            topics={topics}
            highlightTopic={selectedTopic}
            onHover={handleHover}
            onClick={handleClick}
            filter={filter}
          />

          {/* Tooltip */}
          {hoveredNode && (
            <div
              className="fixed z-50 pointer-events-none bg-white border border-gray-200 rounded-lg shadow-xl p-3 max-w-xs"
              style={{ left: hoveredNode.x + 12, top: hoveredNode.y - 10 }}
            >
              <p className="font-semibold text-gray-900 text-sm leading-tight mb-1">
                {hoveredNode.node.titre}
              </p>
              <p className="text-xs text-gray-500 mb-1">
                {hoveredNode.node.source} &middot; {hoveredNode.node.rubrique} &middot; {hoveredNode.node.type}
              </p>
              {hoveredNode.node.topic_id ? (
                <div className="bg-blue-50 px-2 py-1 rounded text-xs">
                  <span className="font-mono font-bold text-blue-700">{hoveredNode.node.topic_id}</span>
                  {hoveredNode.node.coherence !== null && (
                    <span className="text-blue-500 ml-2">coh={hoveredNode.node.coherence.toFixed(2)}</span>
                  )}
                </div>
              ) : (
                <div className="bg-gray-100 px-2 py-1 rounded text-xs font-mono text-gray-400">
                  bruit
                </div>
              )}
            </div>
          )}

          {/* Controls hint */}
          <div className="absolute bottom-3 left-3 bg-white/80 backdrop-blur px-2 py-1 rounded text-[10px] text-gray-400 font-mono">
            scroll=zoom &middot; drag=pan &middot; click=s&eacute;lect &middot; dblclick=reset
          </div>
        </div>
      </div>

      {/* Side panel: topic list or topic detail */}
      <div className="w-80 flex-shrink-0 overflow-y-auto">
        {selectedTopicInfo ? (
          /* Topic detail */
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <button
              onClick={() => setSelectedTopic(null)}
              className="text-xs text-blue-600 hover:text-blue-800 mb-3 flex items-center gap-1"
            >
              &larr; Tous les topics
            </button>
            <h2 className="font-bold text-gray-900 text-sm leading-tight mb-2">
              {selectedTopicInfo.titre}
            </h2>
            <div className="flex flex-wrap gap-1.5 mb-3">
              <span className="bg-blue-100 text-blue-700 text-[10px] font-mono px-1.5 py-0.5 rounded">
                {selectedTopicInfo.id}
              </span>
              <span className="bg-green-100 text-green-700 text-[10px] font-mono px-1.5 py-0.5 rounded">
                score={selectedTopicInfo.score.total}
              </span>
              <span className="bg-purple-100 text-purple-700 text-[10px] font-mono px-1.5 py-0.5 rounded">
                coh={selectedTopicInfo.score.coherence.toFixed(2)}
              </span>
              <span className="bg-orange-100 text-orange-700 text-[10px] font-mono px-1.5 py-0.5 rounded">
                {selectedTopicInfo.article_ids.length} art
              </span>
              <span className="bg-gray-100 text-gray-600 text-[10px] font-mono px-1.5 py-0.5 rounded">
                {selectedTopicInfo.score.nb_sources} src
              </span>
            </div>
            {selectedTopicInfo.rubriques_detectees.length > 0 && (
              <div className="flex gap-1 mb-3">
                {selectedTopicInfo.rubriques_detectees.map(r => (
                  <span key={r} className="bg-violet-50 text-violet-600 text-[10px] px-1.5 py-0.5 rounded">
                    {r}
                  </span>
                ))}
              </div>
            )}
            <div className="border-t border-gray-100 pt-3">
              <h3 className="text-xs font-bold text-gray-500 uppercase mb-2">
                Articles ({selectedArticles.length})
              </h3>
              <div className="space-y-2">
                {selectedArticles.map(a => (
                  <div key={a.id} className="text-xs border-l-2 border-gray-200 pl-2 py-0.5">
                    <p className="text-gray-800 leading-tight">{a.titre}</p>
                    <p className="text-gray-400 mt-0.5">{a.source}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          /* Topic list */
          <div className="space-y-1.5">
            <h2 className="text-sm font-bold text-gray-700 mb-2 px-1">
              Topics ({topics.length})
            </h2>
            {topics.map((t, i) => (
              <button
                key={t.id}
                onClick={() => setSelectedTopic(t.id)}
                className="w-full text-left bg-white border border-gray-200 rounded-lg px-3 py-2 hover:border-blue-300 hover:shadow-sm transition-all group"
              >
                <div className="flex items-center gap-2 mb-1">
                  <div
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: getClusterColor(i) }}
                  />
                  <span className="text-[10px] font-mono text-gray-400">{t.id}</span>
                  <span className="text-[10px] font-mono text-green-600 ml-auto">{t.score.total}</span>
                </div>
                <p className="text-xs text-gray-800 leading-tight line-clamp-2 group-hover:text-blue-900">
                  {t.titre}
                </p>
                <div className="flex gap-2 mt-1 text-[10px] text-gray-400 font-mono">
                  <span>{t.article_ids.length} art</span>
                  <span>{t.score.nb_sources} src</span>
                  <span>coh={t.score.coherence.toFixed(2)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
