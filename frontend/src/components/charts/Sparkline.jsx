import { useRef, useState } from 'react'

// Hand-rolled replacement for recharts' <LineChart> — a single-series
// sparkline needs none of what pulls in the ~104KB-gzipped recharts
// chunk (d3-scale/d3-shape/d3-array under the hood). This and its two
// siblings (TimeSeriesChart, BarChartMini) remove recharts entirely — it
// was loaded on the Dashboard (via this component) as well as Stats,
// costing every user that download just to render a stream card's tiny
// bitrate trend line.
export default function Sparkline({ data, height = 36, color = '#818cf8', formatValue = (v) => v }) {
  const [hoverIdx, setHoverIdx] = useState(null)
  const svgRef = useRef(null)

  if (!data || data.length === 0) return null

  const width = 100
  const pad = 3
  const values = data.filter((v) => v != null)
  const minY = values.length ? Math.min(...values) : 0
  const maxY = values.length ? Math.max(...values) : 1
  const plotH = height - pad * 2

  const xScale = (i) => (i / (data.length - 1 || 1)) * width
  const yScale = (y) => pad + plotH - ((y - minY) / (maxY - minY || 1)) * plotH

  const path = data.reduce((acc, v, i) => {
    if (v == null) return acc
    return `${acc}${acc === '' ? 'M' : 'L'}${xScale(i).toFixed(1)},${yScale(v).toFixed(1)} `
  }, '')

  function handleMove(e) {
    const rect = svgRef.current.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * width
    let nearest = 0
    let best = Infinity
    data.forEach((_, i) => {
      const dx = Math.abs(xScale(i) - px)
      if (dx < best) { best = dx; nearest = i }
    })
    setHoverIdx(nearest)
  }

  const hoveredValue = hoverIdx != null ? data[hoverIdx] : null

  return (
    <div className="relative w-full" style={{ height }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="w-full h-full"
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {path && (
          <path
            d={path}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {hoveredValue != null && (
          <circle cx={xScale(hoverIdx)} cy={yScale(hoveredValue)} r={2.5} fill={color} />
        )}
      </svg>
      {hoveredValue != null && (
        <div
          className="absolute pointer-events-none text-xs bg-surface-700 text-brand-300 px-2 py-1 rounded border border-surface-600 whitespace-nowrap z-10"
          style={{ left: `${(xScale(hoverIdx) / width) * 100}%`, top: -4, transform: 'translate(-50%, -100%)' }}
        >
          {formatValue(hoveredValue)}
        </div>
      )}
    </div>
  )
}
