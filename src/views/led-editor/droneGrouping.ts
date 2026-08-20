/**
 * @file Splitting a synced board's drones into the sub-formations they
 * actually fly in, so each can be drawn in its true shape.
 *
 * A phase is a 3D formation, but the editor is flat. Projecting the whole
 * thing onto the audience plane collapses depth: any two drones that differ
 * only in world x land on the same spot, so a wall seen edge-on becomes a line
 * and two walls at different depths become one. Splitting the drones into the
 * planes they occupy, and drawing each plane separately, is what makes the
 * shape readable again.
 */

import { type DroneLayoutPoint } from '~/features/led-editor/types';

/** How flat a set of drones must be, in metres, to count as sharing a plane. */
const PLANE_TOLERANCE_M = 1.0;

/**
 * In-plane gap, in metres, that separates two formations rather than spacing
 * out one. Two walls on the same plane should not merge just because they
 * happen to be coplanar.
 */
const CLUSTER_GAP_M = 6.0;

/** Below this a "plane" is just noise, so its drones stay ungrouped. */
const MIN_PLANE_MEMBERS = 3;

/** Gap between neighbouring drone blocks, in pixels. */
const BLOCK_GAP_PX = 10;

/**
 * Fraction of nearest-neighbour distances allowed to be tighter than the
 * spacing the scale is built around.
 *
 * Sizing off the single closest pair let one unusually tight pair dictate the
 * scale for everything: a 0.3 m pair inside an otherwise 3 m formation blew a
 * 200 px panel up to 1670 px and scattered every other group with it. A low
 * percentile tracks the formation's real pitch and simply lets the rare outlier
 * pair sit close together, which is what it does in the air anyway.
 */
const SPACING_PERCENTILE = 0.2;

/** Upper bound on a group's drawn size, in pixels. The canvas zooms, so this
 * only has to stop a pathological formation from being unusable. */
const MAX_GROUP_SPAN_PX = 2400;

/**
 * The spacing a group is really built on: a low percentile of the per-drone
 * nearest-neighbour distances.
 */
const typicalSpacing = (
  points: Array<{ x: number; y: number }>
): number | undefined => {
  const nearest: number[] = [];
  for (let i = 0; i < points.length; i++) {
    let best = Number.POSITIVE_INFINITY;
    for (let j = 0; j < points.length; j++) {
      if (i === j) continue;
      const distance = Math.hypot(
        points[i]!.x - points[j]!.x,
        points[i]!.y - points[j]!.y
      );
      if (distance > 1e-6 && distance < best) {
        best = distance;
      }
    }

    if (Number.isFinite(best)) {
      nearest.push(best);
    }
  }

  if (nearest.length === 0) {
    return undefined;
  }

  nearest.sort((a, b) => a - b);
  return nearest[Math.floor(nearest.length * SPACING_PERCENTILE)];
};

export type DroneGroupKind = 'path' | 'plane-yz' | 'plane-xy' | 'loose';

export type GroupedPanel = {
  key: string;
  label: string;
  kind: DroneGroupKind;
  width: number;
  height: number;
  slots: Array<{ index: number; left: number; top: number }>;
};

type World = { x: number; y: number; z: number };
type Placed = { index: number; world: World };
type PlaneNormal = 'x' | 'z';

const spread = (values: number[]): number =>
  values.length === 0 ? 0 : Math.max(...values) - Math.min(...values);

/**
 * Split a set of coplanar drones into runs separated by more than
 * `CLUSTER_GAP_M`, measured inside the plane.
 *
 * Single-linkage rather than k-means: the number of formations is not known up
 * front, and "these two are within arm's reach" is exactly the relation that
 * makes one shape one shape.
 */
const clusterInPlane = (members: Placed[], normal: PlaneNormal): Placed[][] => {
  const axes: Array<keyof World> = normal === 'x' ? ['y', 'z'] : ['x', 'y'];
  const remaining = [...members];
  const clusters: Placed[][] = [];

  while (remaining.length > 0) {
    const cluster = [remaining.pop()!];
    let grew = true;
    while (grew) {
      grew = false;
      for (let i = remaining.length - 1; i >= 0; i--) {
        const candidate = remaining[i]!;
        const touches = cluster.some((member) => {
          const da = member.world[axes[0]!] - candidate.world[axes[0]!];
          const db = member.world[axes[1]!] - candidate.world[axes[1]!];
          return Math.hypot(da, db) <= CLUSTER_GAP_M;
        });
        if (touches) {
          cluster.push(candidate);
          remaining.splice(i, 1);
          grew = true;
        }
      }
    }

    clusters.push(cluster);
  }

  return clusters;
};

/**
 * Find the planar sub-formations among drones that no explicit group claimed.
 *
 * Both orientations are tried — a vertical wall (drones sharing a world x, so
 * one YZ plane) and a flat carpet (sharing a world z, one XY plane) — and the
 * largest candidate wins each round. Its members are removed before the next
 * round, which is what keeps any drone out of two groups: whichever plane
 * explains more of the formation gets to claim it.
 */
const detectPlaneGroups = (
  placed: Placed[]
): Array<{ members: Placed[]; normal: PlaneNormal }> => {
  const remaining = [...placed];
  const found: Array<{ members: Placed[]; normal: PlaneNormal }> = [];

  for (;;) {
    let best: { members: Placed[]; normal: PlaneNormal } | undefined;

    for (const normal of ['x', 'z'] as PlaneNormal[]) {
      const sorted = [...remaining].sort(
        (a, b) => a.world[normal] - b.world[normal]
      );
      let bucket: Placed[] = [];
      const flush = (): void => {
        if (bucket.length < MIN_PLANE_MEMBERS) {
          return;
        }

        for (const cluster of clusterInPlane(bucket, normal)) {
          if (
            cluster.length >= MIN_PLANE_MEMBERS &&
            cluster.length > (best?.members.length ?? 0)
          ) {
            best = { members: cluster, normal };
          }
        }
      };

      for (const entry of sorted) {
        if (
          bucket.length > 0 &&
          entry.world[normal] - bucket[0]!.world[normal] > PLANE_TOLERANCE_M
        ) {
          flush();
          bucket = [];
        }

        bucket.push(entry);
      }

      flush();
    }

    if (!best) {
      break;
    }

    found.push(best);
    const claimed = new Set(best.members.map((member) => member.index));
    for (let i = remaining.length - 1; i >= 0; i--) {
      if (claimed.has(remaining[i]!.index)) {
        remaining.splice(i, 1);
      }
    }
  }

  return found;
};

type Projection = {
  points: Array<{ index: number; x: number; y: number }>;
  kind: DroneGroupKind;
};

/**
 * Project a group onto the plane it actually occupies.
 *
 * Whichever world axis the group varies in least is the one looked along, so a
 * wall is drawn face-on and a carpet from above, instead of both being
 * squashed into the audience view.
 */
const projectGroup = (members: Placed[]): Projection => {
  const spreadX = spread(members.map((member) => member.world.x));
  const spreadZ = spread(members.map((member) => member.world.z));

  if (spreadX <= PLANE_TOLERANCE_M && spreadX <= spreadZ) {
    // A vertical wall on one YZ plane: the audience view already shows it true.
    return {
      kind: 'plane-yz',
      points: members.map((member) => ({
        index: member.index,
        x: -member.world.y,
        y: -member.world.z,
      })),
    };
  }

  if (spreadZ <= PLANE_TOLERANCE_M) {
    // A flat carpet on one XY plane: seen from above, audience at the bottom.
    return {
      kind: 'plane-xy',
      points: members.map((member) => ({
        index: member.index,
        x: -member.world.y,
        y: -member.world.x,
      })),
    };
  }

  // Genuinely three-dimensional, so no projection is faithful. Keep the
  // audience view and say so in the label rather than inventing a plane.
  return {
    kind: 'loose',
    points: members.map((member) => ({
      index: member.index,
      x: -member.world.y,
      y: -member.world.z,
    })),
  };
};

const LABELS: Record<DroneGroupKind, string> = {
  path: 'path 그룹',
  'plane-yz': 'YZ 평면 (정면)',
  'plane-xy': 'XY 평면 (위에서)',
  loose: '평면 아님 (정면 투영)',
};

/**
 * Lay a synced board's drones out as one panel per sub-formation.
 *
 * Returns undefined when the board carries no world coordinates — boards
 * frozen before grouping existed — so those keep drawing as a single flat
 * panel rather than losing their shape entirely.
 */
export const buildGroupedPanels = (
  layout: Array<DroneLayoutPoint | null> | undefined,
  explicitGroups: number[][] | undefined,
  droneCount: number,
  blockSize: number
): GroupedPanel[] | undefined => {
  if (!layout) {
    return undefined;
  }

  const placedByIndex = new Map<number, Placed>();
  for (let index = 0; index < droneCount; index++) {
    const world = layout[index]?.world;
    if (
      world &&
      Number.isFinite(world.x) &&
      Number.isFinite(world.y) &&
      Number.isFinite(world.z)
    ) {
      placedByIndex.set(index, { index, world });
    }
  }

  if (placedByIndex.size === 0) {
    return undefined;
  }

  const claimed = new Set<number>();
  const groups: Array<{ members: Placed[]; explicit: boolean }> = [];

  // The path's own groups come first: they are what the operator drew, so they
  // outrank anything inferred from the geometry.
  for (const group of explicitGroups ?? []) {
    const members = group
      .filter((index) => !claimed.has(index) && placedByIndex.has(index))
      .map((index) => placedByIndex.get(index)!);
    if (members.length === 0) {
      continue;
    }

    members.forEach((member) => claimed.add(member.index));
    groups.push({ members, explicit: true });
  }

  const rest = [...placedByIndex.values()].filter(
    (placed) => !claimed.has(placed.index)
  );
  for (const plane of detectPlaneGroups(rest)) {
    plane.members.forEach((member) => claimed.add(member.index));
    groups.push({ members: plane.members, explicit: false });
  }

  const leftover = [...placedByIndex.values()].filter(
    (placed) => !claimed.has(placed.index)
  );
  if (leftover.length > 0) {
    groups.push({ members: leftover, explicit: false });
  }

  const projected = groups.map(({ members, explicit }) => {
    const projection = projectGroup(members);
    return {
      points: projection.points,
      kind: explicit ? ('path' as DroneGroupKind) : projection.kind,
    };
  });

  // One scale for every panel, so a large formation still draws larger than a
  // small one.
  //
  // Each group states the scale it needs to keep its own closest pair from
  // touching, and the LARGEST of those wins. Taking the smallest was backwards
  // and is what made the canvas a blob: a widely-spaced group asks for a small
  // scale, and imposing that on a tightly-packed group drove its blocks into
  // each other until the shape disappeared. Scaling up never causes overlap,
  // it only costs room, and the canvas both scrolls and zooms.
  let scale = 1;
  for (const { points } of projected) {
    const spacing = typicalSpacing(points);
    if (spacing !== undefined) {
      scale = Math.max(scale, (blockSize + BLOCK_GAP_PX) / spacing);
    }
  }

  if (!Number.isFinite(scale) || scale <= 0) {
    scale = 1;
  }

  // A formation whose typical spacing is tiny relative to its extent would
  // still draw metres wide. Bound it — the canvas zooms, so nothing is lost.
  const widestSpan = Math.max(
    0,
    ...projected.map(({ points }) =>
      Math.max(
        spread(points.map((point) => point.x)),
        spread(points.map((point) => point.y))
      )
    )
  );
  if (widestSpan > 1e-6) {
    scale = Math.min(scale, MAX_GROUP_SPAN_PX / widestSpan);
  }

  return projected.map(({ points, kind }, order) => {
    const minX = Math.min(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    return {
      key: `${kind}-${order}`,
      label: `${LABELS[kind]} · ${points.length}대`,
      kind,
      width: spread(points.map((point) => point.x)) * scale + blockSize,
      height: spread(points.map((point) => point.y)) * scale + blockSize,
      slots: points.map((point) => ({
        index: point.index,
        left: (point.x - minX) * scale,
        top: (point.y - minY) * scale,
      })),
    };
  });
};
