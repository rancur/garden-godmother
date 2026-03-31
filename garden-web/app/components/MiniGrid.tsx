interface MiniGridProps {
  width: number;  // grid columns
  height: number; // grid rows
  highlightX: number;
  highlightY: number;
  size?: number; // total width in px, default 28
}

export function MiniGrid({ width, height, highlightX, highlightY, size = 28 }: MiniGridProps) {
  const cellW = size / width;
  const cellH = (size * 0.7) / height;

  return (
    <svg width={size} height={size * 0.7} className="shrink-0 rounded-sm">
      {Array.from({ length: height }, (_, y) =>
        Array.from({ length: width }, (_, x) => (
          <rect
            key={`${x}-${y}`}
            x={x * cellW}
            y={y * cellH}
            width={cellW - 0.5}
            height={cellH - 0.5}
            rx={0.5}
            fill={x === highlightX && y === highlightY ? '#22c55e' : '#374151'}
            opacity={x === highlightX && y === highlightY ? 1 : 0.3}
          />
        ))
      )}
    </svg>
  );
}
