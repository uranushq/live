/**
 * @file The LED editor's own save format — a `.ledshow` file.
 *
 * Deliberately **not** the `.bin` the boards fly. That format is a firmware
 * contract: a header, flattened RGB frames and a trailer, with no board
 * boundaries, names or start times in it at all. A show cannot be reopened
 * from one, and changing it to make that possible would break the aircraft.
 * So this is a separate file that exists only to save and restore the editor.
 *
 * The layout is a JSON header followed by raw pixels:
 *
 *     0..7    magic   "ULEDSHOW"
 *     8..11   version u32 LE
 *     12..15  metaLen u32 LE
 *     16..    meta    JSON (UTF-8) — everything except pixel data
 *     then    pixels  board-major, then drone, then cell, 3 bytes each
 *
 * The split is the point. Pixels are almost all of the bytes and compress to
 * nothing useful as JSON numbers, while the structure around them is small,
 * changes shape as features land, and is far easier to get right — and to read
 * when something goes wrong — as JSON than as hand-packed fields.
 */

import {
  type Board,
  type DroneLayoutPoint,
  type LedsPerDrone,
  type RGB,
} from './types';

const MAGIC = 'ULEDSHOW';
const VERSION = 1;
const HEADER_BYTES = 16;

export type LedShowFile = {
  ledsPerDrone: LedsPerDrone;
  droneCount: number;
  fps: number;
  boards: Board[];
  droneMapping: Record<number, number>;
};

/** Board fields that travel in the JSON header, i.e. everything but pixels. */
type BoardMeta = Omit<Board, 'drones'>;

const clampChannel = (value: number): number =>
  Math.max(0, Math.min(255, Math.round(value) || 0));

export const encodeLedShow = (show: LedShowFile): Uint8Array => {
  const pixelsPerDrone = show.ledsPerDrone * show.ledsPerDrone;
  const meta = {
    ledsPerDrone: show.ledsPerDrone,
    droneCount: show.droneCount,
    fps: show.fps,
    droneMapping: show.droneMapping,
    boards: show.boards.map(({ drones: _drones, ...rest }) => rest),
  };

  const metaBytes = new TextEncoder().encode(JSON.stringify(meta));
  const pixelBytes =
    show.boards.length * show.droneCount * pixelsPerDrone * 3;
  const out = new Uint8Array(HEADER_BYTES + metaBytes.length + pixelBytes);
  const view = new DataView(out.buffer);

  for (let i = 0; i < MAGIC.length; i++) {
    out[i] = MAGIC.charCodeAt(i);
  }

  view.setUint32(8, VERSION, true);
  view.setUint32(12, metaBytes.length, true);
  out.set(metaBytes, HEADER_BYTES);

  // Fixed stride, so a board or drone missing pixels still lands every later
  // one at the right offset instead of shifting the whole rest of the file.
  let offset = HEADER_BYTES + metaBytes.length;
  for (const board of show.boards) {
    for (let drone = 0; drone < show.droneCount; drone++) {
      const pixels = board.drones[drone];
      for (let cell = 0; cell < pixelsPerDrone; cell++) {
        const rgb = pixels?.[cell];
        out[offset] = clampChannel(Number(rgb?.[0]));
        out[offset + 1] = clampChannel(Number(rgb?.[1]));
        out[offset + 2] = clampChannel(Number(rgb?.[2]));
        offset += 3;
      }
    }
  }

  return out;
};

export class LedShowFileError extends Error {}

export const decodeLedShow = (buffer: ArrayBuffer): LedShowFile => {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < HEADER_BYTES) {
    throw new LedShowFileError('파일이 너무 짧습니다.');
  }

  const magic = String.fromCharCode(...bytes.subarray(0, 8));
  if (magic !== MAGIC) {
    throw new LedShowFileError('LED 쇼 파일이 아닙니다.');
  }

  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength
  );
  const version = view.getUint32(8, true);
  if (version !== VERSION) {
    throw new LedShowFileError(
      `지원하지 않는 버전입니다 (파일 v${version}, 이 빌드 v${VERSION}).`
    );
  }

  const metaLength = view.getUint32(12, true);
  const metaEnd = HEADER_BYTES + metaLength;
  if (metaEnd > bytes.length) {
    throw new LedShowFileError('헤더가 잘렸습니다.');
  }

  const meta = JSON.parse(
    new TextDecoder().decode(bytes.subarray(HEADER_BYTES, metaEnd))
  ) as {
    ledsPerDrone?: unknown;
    droneCount?: unknown;
    fps?: unknown;
    droneMapping?: unknown;
    boards?: unknown;
  };

  const ledsPerDrone: LedsPerDrone = Number(meta.ledsPerDrone) === 4 ? 4 : 3;
  const droneCount = Math.max(1, Math.round(Number(meta.droneCount) || 1));
  const fps = Math.min(120, Math.max(1, Math.round(Number(meta.fps) || 30)));
  const boardMeta = Array.isArray(meta.boards)
    ? (meta.boards as BoardMeta[])
    : [];
  const pixelsPerDrone = ledsPerDrone * ledsPerDrone;

  const expected =
    metaEnd + boardMeta.length * droneCount * pixelsPerDrone * 3;
  if (bytes.length < expected) {
    throw new LedShowFileError(
      `픽셀 데이터가 모자랍니다 (필요 ${expected} 바이트, 파일 ${bytes.length} 바이트).`
    );
  }

  let offset = metaEnd;
  const boards: Board[] = boardMeta.map((board) => {
    const drones: RGB[][] = [];
    for (let drone = 0; drone < droneCount; drone++) {
      const pixels: RGB[] = [];
      for (let cell = 0; cell < pixelsPerDrone; cell++) {
        pixels.push([bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!]);
        offset += 3;
      }

      drones.push(pixels);
    }

    return { ...board, drones } as Board;
  });

  const droneMapping: Record<number, number> = {};
  if (meta.droneMapping && typeof meta.droneMapping === 'object') {
    for (const [key, value] of Object.entries(
      meta.droneMapping as Record<string, unknown>
    )) {
      const index = Number(key);
      const target = Math.round(Number(value));
      if (
        Number.isInteger(index) &&
        index >= 0 &&
        Number.isFinite(target) &&
        target >= 1
      ) {
        droneMapping[index] = target;
      }
    }
  }

  return { ledsPerDrone, droneCount, fps, boards, droneMapping };
};

export type { DroneLayoutPoint };
