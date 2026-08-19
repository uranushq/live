/**
 * @file The bulb-board editor: round LED "bulbs" grouped into per-drone blocks
 * laid out in the *active board's* formation (rows × cols).
 *
 * A board synced to a flight phase instead carries a frozen `droneLayout`, and
 * is drawn in that phase's real formation shape — each drone block sits at its
 * own projected position rather than flowing into the dense grid. Only the
 * *placement* changes: a drone still owns exactly the same canvas indices, so
 * painting, copy/paste and the rubber band (which hit-tests real screen rects)
 * work identically in both modes.
 *
 * Clicking a bulb selects it (it does not paint) and activates the colour panel
 * on the right. Selection:
 *   - press anywhere (a bulb *or* the empty space around them) and drag to
 *     rubber-band a rectangular selection
 *   - Ctrl/Cmd+click a bulb to toggle it, Shift+click for a range
 *   - Ctrl+A select all, Ctrl+C / Ctrl+V copy / paste colours
 */

import Box from '@mui/material/Box';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import {
  getActiveArrangement,
  getActiveBoard,
  getActiveDroneLayout,
  getActiveGridDimensions,
  getDroneCount,
  getLedsPerDrone,
  getSelectedPixels,
} from '~/features/led-editor/selectors';
import {
  copySelection,
  pasteClipboard,
  setSelectedPixels,
} from '~/features/led-editor/slice';
import { type DroneLayoutPoint } from '~/features/led-editor/types';
import { BLACK, droneIndexForPixel, rgbToCss } from '~/features/led-editor/utils';

const BULB_SIZE = 16;
const BULB_GAP = 3;
const DRONE_GAP = 10;

/** Roughly how wide the formation should be drawn before spacing kicks in. */
const SPATIAL_TARGET_SPAN_PX = 640;
/**
 * How far past the "fit the view" scale we may zoom to keep two very close
 * drones from overlapping. Without a cap, a single near-coincident pair would
 * blow the canvas up to an unusable size.
 */
const SPATIAL_MAX_SPACING_ZOOM = 8;

type BulbRect = {
  index: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
};

type SelectionBox = { left: number; top: number; width: number; height: number };

const isLit = (pixel: [number, number, number]): boolean =>
  pixel[0] !== 0 || pixel[1] !== 0 || pixel[2] !== 0;

/** Where each drone block goes when the board is drawn in a phase's shape. */
type SpatialLayout = {
  width: number;
  height: number;
  /** Index-aligned with the drones; `left`/`top` in container pixels. */
  slots: Array<{ left: number; top: number; placed: boolean }>;
};

/**
 * Turn a phase's frozen metre coordinates into pixel positions: preserve the
 * formation's proportions, scale it to a comfortable size, and zoom in (rather
 * than shrinking the bulbs) if that is what it takes to keep neighbouring drone
 * blocks from overlapping. Drones the phase never placed are parked in rows
 * underneath the formation.
 */
const computeSpatialLayout = (
  layout: Array<DroneLayoutPoint | null>,
  droneCount: number,
  blockSize: number
): SpatialLayout => {
  const step = blockSize + DRONE_GAP;
  const placed: Array<{ index: number; point: DroneLayoutPoint }> = [];
  for (let i = 0; i < droneCount; i++) {
    const point = layout[i];
    if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
      placed.push({ index: i, point });
    }
  }

  const slots: SpatialLayout['slots'] = Array.from(
    { length: droneCount },
    () => ({ left: 0, top: 0, placed: false })
  );

  let formationWidth = 0;
  let formationHeight = 0;

  if (placed.length > 0) {
    const xs = placed.map((p) => p.point.x);
    const ys = placed.map((p) => p.point.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const spanX = Math.max(...xs) - minX;
    const spanY = Math.max(...ys) - minY;

    // Closest pair decides how far we must zoom in to avoid overlap.
    let minDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const dx = placed[i]!.point.x - placed[j]!.point.x;
        const dy = placed[i]!.point.y - placed[j]!.point.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 1e-6 && dist < minDist) {
          minDist = dist;
        }
      }
    }

    const largestSpan = Math.max(spanX, spanY);
    const fitScale =
      largestSpan > 1e-6 ? SPATIAL_TARGET_SPAN_PX / largestSpan : 1;
    const spacingScale = Number.isFinite(minDist) ? step / minDist : fitScale;
    const scale = Math.min(
      Math.max(fitScale, spacingScale),
      fitScale * SPATIAL_MAX_SPACING_ZOOM
    );

    for (const { index, point } of placed) {
      slots[index] = {
        left: (point.x - minX) * scale,
        top: (point.y - minY) * scale,
        placed: true,
      };
    }
    formationWidth = spanX * scale + blockSize;
    formationHeight = spanY * scale + blockSize;
  }

  // Park the drones without a position on their own rows below.
  const unplaced = slots.reduce<number[]>((acc, slot, i) => {
    if (!slot.placed) {
      acc.push(i);
    }
    return acc;
  }, []);
  let parkedWidth = 0;
  let parkedHeight = 0;
  if (unplaced.length > 0) {
    const perRow = Math.max(1, Math.floor(Math.max(formationWidth, step) / step));
    unplaced.forEach((droneIndex, n) => {
      slots[droneIndex] = {
        left: (n % perRow) * step,
        top: formationHeight + DRONE_GAP * 3 + Math.floor(n / perRow) * step,
        placed: false,
      };
    });
    parkedWidth = Math.min(unplaced.length, perRow) * step - DRONE_GAP;
    parkedHeight =
      DRONE_GAP * 3 + Math.ceil(unplaced.length / perRow) * step - DRONE_GAP;
  }

  return {
    width: Math.max(formationWidth, parkedWidth, blockSize),
    height: Math.max(formationHeight + parkedHeight, blockSize),
    slots,
  };
};

const BoardGrid = (): JSX.Element => {
  const dispatch = useDispatch();
  const board = useSelector(getActiveBoard);
  const { width } = useSelector(getActiveGridDimensions);
  const ledsPerDrone = useSelector(getLedsPerDrone);
  const { rows, cols } = useSelector(getActiveArrangement);
  const droneCount = useSelector(getDroneCount);
  const committedSelection = useSelector(getSelectedPixels);
  const droneLayout = useSelector(getActiveDroneLayout);

  // Outer size of one drone's k×k block, including its own 4px padding.
  const blockSize =
    ledsPerDrone * BULB_SIZE + (ledsPerDrone - 1) * BULB_GAP + 8;
  const spatial = useMemo(
    () =>
      droneLayout
        ? computeSpatialLayout(droneLayout, droneCount, blockSize)
        : undefined,
    [droneLayout, droneCount, blockSize]
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  const dragging = useRef(false);
  const startClient = useRef<{ x: number; y: number } | undefined>(undefined);
  const innerOrigin = useRef<{ left: number; top: number }>({ left: 0, top: 0 });
  const bulbRects = useRef<BulbRect[]>([]);
  const anchor = useRef<number | undefined>(undefined);
  const latestMarquee = useRef<Set<number>>(new Set());

  const [marquee, setMarqueeState] = useState<Set<number>>(new Set());
  const [box, setBox] = useState<SelectionBox | undefined>(undefined);

  const setMarquee = useCallback((next: Set<number>) => {
    latestMarquee.current = next;
    setMarqueeState(next);
  }, []);

  /** Recompute the marquee from the current mouse position (client coords). */
  const updateMarquee = useCallback(
    (curX: number, curY: number) => {
      const start = startClient.current;
      if (!start) {
        return;
      }
      const left = Math.min(start.x, curX);
      const right = Math.max(start.x, curX);
      const top = Math.min(start.y, curY);
      const bottom = Math.max(start.y, curY);

      const next = new Set<number>();
      for (const b of bulbRects.current) {
        if (!(b.right < left || b.left > right || b.bottom < top || b.top > bottom)) {
          next.add(b.index);
        }
      }
      setMarquee(next);

      const o = innerOrigin.current;
      setBox({
        left: left - o.left,
        top: top - o.top,
        width: right - left,
        height: bottom - top,
      });
    },
    [setMarquee]
  );

  const onWindowMove = useCallback(
    (event: MouseEvent) => {
      if (dragging.current) {
        updateMarquee(event.clientX, event.clientY);
      }
    },
    [updateMarquee]
  );

  const onWindowUp = useCallback(() => {
    if (!dragging.current) {
      return;
    }
    dragging.current = false;
    dispatch(setSelectedPixels([...latestMarquee.current]));
    setBox(undefined);
    setMarquee(new Set());
  }, [dispatch, setMarquee]);

  useEffect(() => {
    window.addEventListener('mousemove', onWindowMove);
    window.addEventListener('mouseup', onWindowUp);
    return () => {
      window.removeEventListener('mousemove', onWindowMove);
      window.removeEventListener('mouseup', onWindowUp);
    };
  }, [onWindowMove, onWindowUp]);

  const handleMouseDown = useCallback(
    (event: React.MouseEvent) => {
      if (!board || event.button !== 0) {
        return;
      }
      containerRef.current?.focus();

      const bulbEl = (event.target as HTMLElement).closest?.(
        '[data-bulb-index]'
      ) as HTMLElement | null;
      const bulbIndex = bulbEl
        ? Number(bulbEl.dataset['bulbIndex'])
        : undefined;

      // Discrete bulb interactions (no rubber-band).
      if (bulbIndex !== undefined && event.shiftKey && anchor.current !== undefined) {
        const lo = Math.min(anchor.current, bulbIndex);
        const hi = Math.max(anchor.current, bulbIndex);
        const range: number[] = [];
        for (let i = lo; i <= hi; i++) {
          range.push(i);
        }
        dispatch(setSelectedPixels(range));
        return;
      }
      if (bulbIndex !== undefined && (event.ctrlKey || event.metaKey)) {
        const set = new Set(committedSelection);
        if (set.has(bulbIndex)) {
          set.delete(bulbIndex);
        } else {
          set.add(bulbIndex);
        }
        dispatch(setSelectedPixels([...set]));
        anchor.current = bulbIndex;
        return;
      }

      // Plain press anywhere → start a geometric rubber-band selection.
      const inner = innerRef.current;
      if (!inner) {
        return;
      }
      const rect = inner.getBoundingClientRect();
      innerOrigin.current = { left: rect.left, top: rect.top };
      bulbRects.current = [...inner.querySelectorAll('[data-bulb-index]')].map(
        (el) => {
          const r = el.getBoundingClientRect();
          return {
            index: Number((el as HTMLElement).dataset['bulbIndex']),
            left: r.left,
            top: r.top,
            right: r.right,
            bottom: r.bottom,
          };
        }
      );
      dragging.current = true;
      startClient.current = { x: event.clientX, y: event.clientY };
      if (bulbIndex !== undefined) {
        anchor.current = bulbIndex;
      }
      updateMarquee(event.clientX, event.clientY);
      event.preventDefault();
    },
    [board, committedSelection, dispatch, updateMarquee]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 'c') {
        dispatch(copySelection());
        event.preventDefault();
      } else if (key === 'v') {
        dispatch(pasteClipboard(undefined));
        event.preventDefault();
      } else if (key === 'a' && board) {
        const all: number[] = [];
        for (let i = 0; i < width * (rows * ledsPerDrone); i++) {
          if (droneIndexForPixel(i, width, ledsPerDrone, cols) < droneCount) {
            all.push(i);
          }
        }
        dispatch(setSelectedPixels(all));
        anchor.current = all[0];
        event.preventDefault();
      }
    },
    [dispatch, board, width, rows, ledsPerDrone, cols, droneCount]
  );

  if (!board) {
    return (
      <Box
        sx={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'text.secondary',
        }}
      >
        No board selected — create one on the timeline to start.
      </Box>
    );
  }

  const committedSet = new Set(committedSelection);

  return (
    <Box
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onMouseDown={handleMouseDown}
      sx={{
        flex: 1,
        overflow: 'auto',
        p: 2,
        outline: 'none',
        userSelect: 'none',
        backgroundColor: '#111',
      }}
    >
      <Box
        ref={innerRef}
        sx={
          spatial
            ? {
                position: 'relative',
                width: spatial.width,
                height: spatial.height,
              }
            : {
                position: 'relative',
                display: 'grid',
                gridTemplateColumns: `repeat(${cols}, max-content)`,
                gap: `${DRONE_GAP}px`,
                width: 'max-content',
              }
        }
      >
        {Array.from(
          { length: spatial ? droneCount : rows * cols },
          (_unused, drone) => {
            // The canvas index a drone owns never depends on how it is drawn —
            // it always comes from the board's own rows × cols — so every paint
            // / copy / paste reducer works unchanged in both modes.
            const droneRow = Math.floor(drone / cols);
            const droneCol = drone % cols;
            const present = drone < droneCount;
            const dronePixels = board.drones[drone];
            const slot = spatial?.slots[drone];
            const unplaced = Boolean(spatial) && slot?.placed === false;
            return (
              <Box
                key={drone}
                title={
                  !present
                    ? 'No drone'
                    : unplaced
                      ? `Drone #${drone + 1} — 이 phase에 위치 정보 없음`
                      : `Drone #${drone + 1}`
                }
                sx={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${ledsPerDrone}, ${BULB_SIZE}px)`,
                  gap: `${BULB_GAP}px`,
                  p: 0.5,
                  borderRadius: 1,
                  opacity: present ? (unplaced ? 0.45 : 1) : 0.18,
                  backgroundColor: present
                    ? 'rgba(255,255,255,0.04)'
                    : 'rgba(255,255,255,0.02)',
                  ...(slot
                    ? {
                        position: 'absolute',
                        left: slot.left,
                        top: slot.top,
                      }
                    : {}),
                }}
              >
                {Array.from(
                  { length: ledsPerDrone * ledsPerDrone },
                  (_u, cell) => {
                    const tx = cell % ledsPerDrone;
                    const ty = Math.floor(cell / ledsPerDrone);
                    const x = droneCol * ledsPerDrone + tx;
                    const y = droneRow * ledsPerDrone + ty;
                    const index = y * width + x;
                    const pixel = (dronePixels?.[cell] ?? BLACK) as [
                      number,
                      number,
                      number,
                    ];
                    const lit = isLit(pixel);
                    const selected =
                      marquee.has(index) || committedSet.has(index);
                    return (
                      <Box
                        key={cell}
                        {...(present ? { 'data-bulb-index': index } : {})}
                        sx={{
                          width: BULB_SIZE,
                          height: BULB_SIZE,
                          borderRadius: '50%',
                          cursor: present ? 'pointer' : 'default',
                          background: lit ? rgbToCss(pixel) : '#2a2a2a',
                          boxShadow: lit
                            ? `0 0 6px 1px ${rgbToCss(pixel)}`
                            : 'inset 0 0 0 1px rgba(255,255,255,0.12)',
                          outline: selected ? '2px solid #fff' : 'none',
                          outlineOffset: '1px',
                        }}
                      />
                    );
                  }
                )}
              </Box>
            );
          }
        )}

        {box && (
          <Box
            sx={{
              position: 'absolute',
              left: box.left,
              top: box.top,
              width: box.width,
              height: box.height,
              border: '1px solid #29b6f6',
              background: 'rgba(41,182,246,0.15)',
              pointerEvents: 'none',
            }}
          />
        )}
      </Box>
    </Box>
  );
};

export default BoardGrid;
