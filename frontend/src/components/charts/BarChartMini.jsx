import { useState } from 'react'

const PAD = { top: 8, right: 8, bottom: 20, left: 40 }
const VIEW_WIDTH = 600

// Single-series bar chart with a per-bar hover tooltip (no crosshair —
// bars/cells get their own hit target per dataviz convention, not a
// shared vertical line).
export default function BarChartMini({
  data, // [{ x: number, y: number|null }]
  height = 120,
  color = '#fbbf24',
  unit = '',
  xFormat = (v) => `${v}s`,
  yFormat = (v) => `${v}`,
}) {
  const [hoverIdx, setHoverIdx] = useState(null)

  const ys = data.map((d) => d.y).filter((v) => v != null)
  const maxY = ys.length ? Math.max(1, ...ys) : 1

  const plotW = VIEW_WIDTH - PAD.left - PAD.right
  const plotH = height - PAD.top - PAD.bottom
  const n = data.length || 1
  const bandW = plotW / n
  const barW = Math.min(8, bandW * 0.6)

  const xCenter = (i) => PAD.left + bandW * i + bandW / 2
  const yScale = (y) => PAD.top + plotH - (y / maxY) * plotH

  const tickCount = 2
  const yTicks = Array.from({ length: tickCount + 1 }, (_, i) => (maxY * i) / tickCount)
  const xTickPoints = [
    { d: data[0], i: 0 },
    { d: data[Math.floor((data.length - 1) / 2)], i: Math.floor((data.length - 1) / 2) },
    { d: data[data.length - 1], i: data.length - 1 },
  ]
    .filter((t) => t.d)
    // Small datasets (n <= 3) collapse first/middle/last onto the same
    // index — dedupe or React sees duplicate keys within this one map.
    .filter((t, idx, arr) => arr.findIndex((o) => o.i === t.i) === idx)

  const hovered = hoverIdx != null ? data[hoverIdx] : null

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${VIEW_WIDTH} ${height}`} className="w-full" style={{ height }}>
        {yTicks.map((v, i) => (
          <line key={`grid-${i}`} x1={PAD.left} x2={VIEW_WIDTH - PAD.right} y1={yScale(v)} y2={yScale(v)} stroke="#28283c" strokeWidth={1} />
        ))}
        {yTicks.map((v, i) => (
          <text key={`ytick-${i}`} x={PAD.left - 8} y={yScale(v)} fill="#6b7280" fontSize={10} textAnchor="end" dominantBaseline="middle">
            {yFormat(Math.round(v * 100) / 100)}
          </text>
        ))}
        {xTickPoints.map(({ d, i }) => (
          <text key={`xtick-${i}`} x={xCenter(i)} y={height - 4} fill="#6b7280" fontSize={10} textAnchor="middle">
            {xFormat(d.x)}
          </text>
        ))}
        {data.map((d, i) => {
          if (d.y == null) return null
          const h = (d.y / maxY) * plotH
          return (
            <rect
              key={`bar-${i}`}
              x={xCenter(i) - barW / 2}
              y={yScale(d.y)}
              width={barW}
              height={Math.max(0, h)}
              rx={2}
              fill={color}
              opacity={hoverIdx === i ? 1 : 0.85}
            />
          )
        })}
        {data.map((d, i) => (
          <rect
            key={`hit-${i}`}
            x={PAD.left + bandW * i}
            y={PAD.top}
            width={bandW}
            height={plotH}
            fill="transparent"
            onMouseEnter={() => setHoverIdx(i)}
            onMouseLeave={() => setHoverIdx(null)}
          />
        ))}
      </svg>
      {hovered && (
        <div
          className="absolute pointer-events-none px-2.5 py-1.5 rounded-lg bg-surface-800 border border-surface-600 text-xs shadow-xl -translate-x-1/2"
          style={{ left: `${(xCenter(hoverIdx) / VIEW_WIDTH) * 100}%`, top: 4 }}
        >
          <div className="text-gray-500">{xFormat(hovered.x)} ago</div>
          <div className="text-white font-mono font-medium">
            {hovered.y != null ? `${yFormat(hovered.y)}${unit}` : '—'}
          </div>
        </div>
      )}
    </div>
  )
}
