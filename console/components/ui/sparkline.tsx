interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  tone?: string;
  fill?: boolean;
  className?: string;
}

/** Tiny inline SVG sparkline, normalized to its own min/max. */
export function Sparkline({
  data,
  width = 96,
  height = 24,
  tone = '#22d3ee',
  fill = true,
  className,
}: SparklineProps) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pad = 2;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - pad - ((v - min) / span) * (height - pad * 2);
    return [x, y] as const;
  });
  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={className}
      preserveAspectRatio="none"
      aria-hidden
    >
      {fill && <path d={area} fill={tone} opacity={0.12} />}
      <path d={line} fill="none" stroke={tone} strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={1.8} fill={tone} />
    </svg>
  );
}
