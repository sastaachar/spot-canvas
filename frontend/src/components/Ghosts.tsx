import { GHOST_DRAW_MS, GHOST_STAGGER_MS, useGhostStore } from '../core/ghosts';

const STROKE_INSET = 1;
const RADIUS = { panel: 8, group: 12 };

export function Ghosts() {
  const ghosts = useGhostStore((s) => s.ghosts);
  if (ghosts.length === 0) return null;
  return (
    <>
      {ghosts.map((g, i) => {
        const w = Math.max(1, g.w - STROKE_INSET * 2);
        const h = Math.max(1, g.h - STROKE_INSET * 2);
        const perimeter = 2 * (w + h);
        return (
          <svg
            key={g.id}
            className={`ghost ghost--${g.kind}`}
            style={{ left: g.x, top: g.y, width: g.w, height: g.h, animationDelay: `${i * GHOST_STAGGER_MS}ms` }}
            viewBox={`0 0 ${g.w} ${g.h}`}
            aria-hidden="true"
            data-testid="ghost"
          >
            <rect
              x={STROKE_INSET}
              y={STROKE_INSET}
              width={w}
              height={h}
              rx={RADIUS[g.kind]}
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
