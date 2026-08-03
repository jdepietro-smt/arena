import { useRef, useState } from 'react'

const PAD = { top: 8, right: 8, bottom: 20, left: 40 }
const VIEW_WIDTH = 600

// Single-axis line/area chart. StatsPage previously overlaid bitrate and
// RTT on one chart with two Y-axes — a dual-axis chart is the #1 dataviz
// mistake (two different-scale measures compress and mislead against a
// shared frame); this renders each metric as its own single-axis chart
// instead, indexed to nothing but itself.
export default function TimeSeriesChart({
  data, // [{ x: number, y: number|null }], x ascending
  height = 220,
  color = '#818cf8',
  variant = 'area', // 'area' | 'line'
  unit = '',
  xFormat = (v) => `${v}s`,
  yFormat = (v) => `${v}`,
}) {
  const [hoverIdx, setHoverIdx] = useState(null)
  const svgRef = useRef(null)

  const xs = data.map((d) => d.x)
  const ys = data.map((d) => d.y).filter((v) => v != null)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = ys.length ? Math.min(0, ...ys) : 0
  const maxY = ys.length ? Math.max(1, ...ys) : 1

  const plotW = VIEW_WIDTH - PAD.left - PAD.right
  const plotH = height - PAD.top - PAD.bottom

  const xScale = (x) => PAD.left + ((x - minX) / (maxX - minX || 1)) * plotW
  const yScale = (y) => PAD.top + plotH - ((y - minY) / (maxY - minY || 1)) * plotH

  const linePath = data.reduce((acc, d) => {
    if (d.y == null) return acc
    return `${acc}${acc === '' ? 'M' : 'L'}${xScale(d.x).toFixed(1)},${yScale(d.y).toFixed(1)} `
  }, '')

  const lastPoint = [...data].reverse().find((d) => d.y != null)
  const firstPoint = data.find((d) => d.y != null)
  const areaPath =
    variant === 'area' && linePath && firstPoint && lastPoint
      ? `${linePath}L${xScale(lastPoint.x).toFixed(1)},${yScale(minY).toFixed(1)} L${xScale(firstPoint.x).toFixed(1)},${yScale(minY).toFixed(1)} Z`
      : ''

  function handleMove(e) {
    const rect = svgRef.current.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * VIEW_WIDTH
    let nearest = 0
    let best = Infinity
    data.forEach((d, i) => {
      const dx = Math.abs(xScale(d.x) - px)
      if (dx < best) { best = dx; nearest = i }
    })
    setHoverIdx(nearest)
  }

  const tickCount = 4
  const yTicks = Array.from({ length: tickCount + 1 }, (_, i) => minY + ((maxY - minY) * i) / tickCount)
  const xTickPoints = [data[0], data[Math.floor((data.length - 1) / 2)], data[data.length - 1]].filter(Boolean)

  const hovered = hoverIdx != null ? data[hoverIdx] : null

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_WIDTH} ${height}`}
        className="w-full"
        style={{ height }}
        onMouseMove={data.length ? handleMove : undefined}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {yTicks.map((v, i) => (
          <line key={`grid-${i}`} x1={PAD.left} x2={VIEW_WIDTH - PAD.right} y1={yScale(v)} y2={yScale(v)} stroke="#28283c" strokeWidth={1} />
        ))}
        {yTicks.map((v, i) => (
          <text key={`ytick-${i}`} x={PAD.left - 8} y={yScale(v)} fill="#6b7280" fontSize={10} textAnchor="end" dominantBaseline="middle">
            {yFormat(Math.round(v * 100) / 100)}
          </text>
        ))}
        {xTickPoints.map((d, i) => (
          <text key={`xtick-${i}`} x={xScale(d.x)} y={height - 4} fill="#6b7280" fontSize={10} textAnchor="middle">
            {xFormat(d.x)}
          </text>
        ))}
        {areaPath && <path d={areaPath} fill={color} opacity={0.1} />}
        {linePath && (
          <path d={linePath} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        )}
        {hovered && (
          <>
            <line
              x1={xScale(hovered.x)} x2={xScale(hovered.x)}
              y1={PAD.top} y2={height - PAD.bottom}
              stroke="#6b7280" strokeWidth={1} strokeDasharray="2,2"
            />
            {hovered.y != null && (
              <circle cx={xScale(hovered.x)} cy={yScale(hovered.y)} r={4} fill={color} stroke="#14141f" strokeWidth={2} />
            )}
          </>
        )}
      </svg>
      {hovered && (
        <div
          className="absolute pointer-events-none px-2.5 py-1.5 rounded-lg bg-surface-800 border border-surface-600 text-xs shadow-xl -translate-x-1/2"
          style={{ left: `${(xScale(hovered.x) / VIEW_WIDTH) * 100}%`, top: 4 }}
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
