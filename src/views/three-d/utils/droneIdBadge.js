/**
 * @file Canvas-drawn "orange circle + drone number" sprite texture.
 *
 * Shared by the live-telemetry flock (`~/aframe/components/drone-flock`,
 * Navigate mode) and the InstancedMesh sphere markers
 * (`~/views/three-d/DroneSphereMarkers`, Edit mode's efficiency toggle) so
 * both "represent the drone as a numbered sphere" paths draw the same badge.
 */

export const DRONE_BADGE_COLOR = '#ff8c00';
export const DRONE_BADGE_TEXT_COLOR = '#ffffff';
export const DRONE_BADGE_CANVAS_SIZE = 128;

/** Trailing digits of the id (e.g. "drone-7" -> "7"), else the raw id. */
export const shortDroneLabel = (id) => {
  const raw = String(id ?? '');
  const match = raw.match(/(\d+)\s*$/);
  return match ? match[1] : raw;
};

/** Draws an orange circle with a centred label onto a canvas for a sprite texture. */
export const paintDroneBadgeCanvas = (canvas, label) => {
  const size = canvas.width;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 6, 0, Math.PI * 2);
  ctx.fillStyle = DRONE_BADGE_COLOR;
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = DRONE_BADGE_TEXT_COLOR;
  ctx.stroke();
  ctx.fillStyle = DRONE_BADGE_TEXT_COLOR;
  ctx.font = `bold ${Math.round(size * 0.42)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, size / 2, size / 2 + size * 0.02);
};
