import { GHOST_DRAW_MS, GHOST_STAGGER_MS, useGhostStore } from '../core/ghosts';
import { rectStyle } from '../core/grid';

const STROKE_INSET = 1;
const RADIUS = { panel: 8, group: 12 };

export function Ghosts() {
  const ghosts = useGhostStore((s) => s.ghosts);
  if (ghosts.length === 0) return null;
  return (
    <>
      {ghosts.map((g, i) => {
        // Draw in a 100x100 box; preserveAspectRatio="none" stretches it to the sector rectangle.
        const w = 100 - STROKE_INSET * 2;
        const h = 100 - STROKE_INSET * 2;
        const perimeter = 2 * (w + h);
        return (
          <svg
            key={g.id}
            className={`ghost ghost--${g.kind}`}
            style={{ ...rectStyle(g), animationDelay: `${i * GHOST_STAGGER_MS}ms` }}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
            data-testid="ghost"
          >
            <rect
              x={STROKE_INSET}
              y={STROKE_INSET}
              width={w}
              height={h}
              rx={RADIUS[g.kind]}
              vectorEffect="non-scaling-stroke"
              className="ghost__outline"
              style={{
                strokeDasharray: perimeter,
                strokeDashoffset: perimeter,
                animationDuration: `${GHOST_DRAW_MS}ms`,
                animationDelay: `${i * GHOST_STAGGER_MS}ms`
              }}
            />
          </svg>
        );
      })}
    </>
  );
}
