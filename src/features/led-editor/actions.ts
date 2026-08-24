/**
 * @file Thunk actions for the LED-show editor — compiling and uploading the
 * show to the Skybrush server (which forwards the per-drone `.bin` files to the
 * external download server).
 */

import JSZip from 'jszip';
import ky from 'ky';

import { showError, showSuccess } from '~/features/snackbar/actions';
import { type AppThunk, type RootState } from '~/store/reducers';

import {
  getBoards,
  getDroneCount,
  getDroneMapping,
  getEstimatedTimingBoards,
  getFps,
  getLedMappingConflicts,
  getLedsPerDrone,
  getLedTileIds,
  hasTimelineOverlap,
} from './selectors';
import {
  decodeLedShow,
  encodeLedShow,
  LedShowFileError,
} from './showFile';
import { importShow, setUploadStatus } from './slice';
import { type UploadTileResult } from './types';

const COMPILE_ENDPOINT = '/api/v1/led/compile';

type CompileResponse = {
  success: boolean;
  totalFrames: number;
  fps: number;
  tileWidth: number;
  tileHeight: number;
  droneCount: number;
  uploaded: boolean;
  tiles: UploadTileResult[];
  error?: string;
};

/**
 * Build the JSON model the server's `led_generator` extension expects.
 *
 * Colours are sent **per drone** (each drone's `k*k` set). The per-board
 * formation (rows × cols) is included for reference but does not affect the
 * generated `.bin` files — those only depend on each drone's own LED sequence.
 */
const buildShowModel = (state: RootState) => ({
  ledsPerDrone: getLedsPerDrone(state),
  droneCount: getDroneCount(state),
  fps: getFps(state),
  // Which download slot each drone's file must occupy. Boards fetch by slot
  // (`GET /download/<client_id>`) and never see a filename, so this is what
  // makes an airframe substitution take effect.
  tileIds: getLedTileIds(state),
  boards: getBoards(state).map((board) => ({
    id: board.id,
    name: board.name,
    rows: board.rows,
    cols: board.cols,
    drones: board.drones,
    startSec: board.startSec,
    durationSec: board.durationSec,
  })),
});

/**
 * Compile the current show on the server and upload the per-drone `.bin` files
 * to the download server.
 */
export const exportAndUpload =
  (): AppThunk<Promise<void>> => async (dispatch, getState) => {
    const state = getState();

    if (getBoards(state).length === 0) {
      dispatch(showError('Add at least one board before exporting.'));
      return;
    }
    if (hasTimelineOverlap(state)) {
      dispatch(
        showError('Boards overlap on the timeline; fix this before exporting.')
      );
      return;
    }

    // Two drones pointed at one airframe would upload to the same download
    // slot and overwrite each other, leaving one drone dark with nothing in
    // any log to explain it. The server refuses this too; catching it here
    // names the offending drone instead of failing the whole compile.
    const conflicts = getLedMappingConflicts(state);
    if (conflicts.length > 0) {
      dispatch(
        showError(
          `기체 매핑 충돌: ${conflicts.join(', ')}번 기체에 두 개 이상의 LED 내용이 배정됐습니다.`
        )
      );
      return;
    }

    // Refuse to publish estimated times to the boards. This is the last point
    // where it can be caught: once the .bin files are on the aircraft the show
    // plays at the wrong instant and nothing on the ground says why. Saving a
    // local copy stays allowed — that harms nothing.
    const estimated = getEstimatedTimingBoards(state);
    if (estimated.length > 0) {
      dispatch(
        showError(
          `보드 ${estimated.length}개가 추정 시각을 쓰고 있어 업로드를 막았습니다 ` +
            `(${estimated.slice(0, 3).join(', ')}${estimated.length > 3 ? ' 외' : ''}). ` +
            '3D 뷰에서 path 를 다시 전송한 뒤 "path와 동기화"를 누르세요.'
        )
      );
      return;
    }

    const model = buildShowModel(state);
    dispatch(setUploadStatus({ state: 'running' }));

    try {
      const response = await ky
        .post(COMPILE_ENDPOINT, { json: model, timeout: 120_000 })
        .json<CompileResponse>();

      const failed = (response.tiles ?? []).filter((t) => t.error);
      if (response.success && failed.length === 0) {
        dispatch(
          setUploadStatus({
            state: 'done',
            totalFrames: response.totalFrames,
            tiles: response.tiles,
            message: `Uploaded ${response.tiles.length} file(s), ${response.totalFrames} frame(s).`,
          })
        );
        dispatch(
          showSuccess(
            `LED show compiled: ${response.droneCount} drone(s), ${response.totalFrames} frame(s).`
          )
        );
      } else {
        dispatch(
          setUploadStatus({
            state: 'error',
            totalFrames: response.totalFrames,
            tiles: response.tiles,
            message: `${failed.length} file(s) failed to upload.`,
          })
        );
        dispatch(showError(`LED show upload failed for ${failed.length} file(s).`));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      dispatch(setUploadStatus({ state: 'error', message }));
      dispatch(showError(`Could not compile LED show: ${message}`));
    }
  };

/**
 * Compile the show and save the per-drone `.bin` files locally instead of
 * publishing them.
 *
 * Compiling normally POSTs the binaries straight to the download server and
 * drops the originals, so there was no way to keep, inspect or hand-flash one.
 * This asks for the bytes back (`includeData`) with `upload: false`, so nothing
 * the boards fetch is touched — it is purely a copy for the operator.
 *
 * Files are named by their download slot, matching what a board asks for, so
 * a hand-placed file lands where the firmware will look for it.
 */
export const downloadCompiledBinaries =
  (): AppThunk<Promise<void>> => async (dispatch, getState) => {
    const state = getState();
    if (getBoards(state).length === 0) {
      dispatch(showError('Add at least one board before exporting.'));
      return;
    }

    if (hasTimelineOverlap(state)) {
      dispatch(
        showError('Boards overlap on the timeline; fix this before exporting.')
      );
      return;
    }

    const conflicts = getLedMappingConflicts(state);
    if (conflicts.length > 0) {
      dispatch(
        showError(
          `기체 매핑 충돌: ${conflicts.join(', ')}번 기체에 두 개 이상의 LED 내용이 배정됐습니다.`
        )
      );
      return;
    }

    dispatch(setUploadStatus({ state: 'running' }));
    try {
      const response = await ky
        .post(COMPILE_ENDPOINT, {
          json: { ...buildShowModel(state), upload: false, includeData: true },
          timeout: 120_000,
        })
        .json<CompileResponse>();

      const tiles = (response.tiles ?? []).filter((tile) => tile.data);
      if (tiles.length === 0) {
        dispatch(
          showError(
            'LED 바이너리를 돌려받지 못했습니다 — 서버가 includeData 를 지원하지 않는 버전입니다.'
          )
        );
        dispatch(setUploadStatus({ state: 'idle' }));
        return;
      }

      const zip = new JSZip();
      for (const tile of tiles) {
        const slot = tile.tileId ?? tile.droneIndex;
        zip.file(`file${slot}.bin`, tile.data!, { base64: true });
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'led-binaries.zip';
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      dispatch(
        setUploadStatus({
          state: 'done',
          totalFrames: response.totalFrames,
          tiles: response.tiles,
          message: `${tiles.length}개 .bin 을 led-binaries.zip 으로 저장했습니다.`,
        })
      );
      dispatch(
        showSuccess(
          `LED 바이너리 ${tiles.length}개 저장 (${response.totalFrames} 프레임).`
        )
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      dispatch(setUploadStatus({ state: 'error', message }));
      dispatch(showError(`LED 바이너리 저장 실패: ${message}`));
    }
  };

/**
 * Save the authored show to a `.ledshow` file.
 *
 * The editor's state is not persisted across reloads, and until now the only
 * copy lived in the 3D view's project export — a different panel, easy to miss
 * while working here. Losing an authored show to a refresh is not an
 * acceptable way to lose work, so the editor writes its own file.
 *
 * This is not the `.bin` the boards fly. That one carries flattened frames
 * with no board boundaries or start times, so a show cannot be reopened from
 * it, and bending it to allow that would break the firmware contract.
 */
export const exportLedShowToFile =
  (): AppThunk<void> => (dispatch, getState) => {
    const state = getState();
    const boards = getBoards(state);
    if (boards.length === 0) {
      dispatch(showError('저장할 보드가 없습니다.'));
      return;
    }

    const bytes = encodeLedShow({
      ledsPerDrone: getLedsPerDrone(state),
      droneCount: getDroneCount(state),
      fps: getFps(state),
      boards,
      droneMapping: getDroneMapping(state),
    });

    // `bytes.buffer` rather than the view: TypeScript's BlobPart does not
    // accept a Uint8Array over a generic ArrayBufferLike, and the encoder
    // always allocates its own exactly-sized buffer.
    const blob = new Blob([bytes.buffer as ArrayBuffer], {
      type: 'application/octet-stream',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'led-show.ledshow';
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    dispatch(
      showSuccess(
        `LED 쇼 저장: 보드 ${boards.length}개 · ${Math.round(bytes.length / 1024)} KB`
      )
    );
  };

/**
 * Load a show the editor saved.
 *
 * A `uranus-show-project.json` written by the 3D view is accepted too — an
 * operator should not have to remember which panel produced which file.
 */
export const importLedShowFromFile =
  (file: File): AppThunk<Promise<void>> =>
  async (dispatch) => {
    try {
      const buffer = await file.arrayBuffer();
      try {
        const show = decodeLedShow(buffer);
        dispatch(importShow(show));
        dispatch(
          showSuccess(`LED 쇼 불러오기: 보드 ${show.boards.length}개`)
        );
        return;
      } catch (error) {
        // Not our binary — fall through and try the project file, but keep the
        // reason in case that fails too, so the operator is not told the wrong
        // thing about a file that really was a broken .ledshow.
        if (!(error instanceof LedShowFileError)) {
          throw error;
        }
      }

      const parsed = JSON.parse(new TextDecoder().decode(buffer)) as Record<
        string,
        unknown
      >;
      const show =
        parsed && typeof parsed['ledShow'] === 'object' && parsed['ledShow']
          ? (parsed['ledShow'] as Record<string, unknown>)
          : parsed;
      if (!Array.isArray(show?.['boards'])) {
        dispatch(
          showError(
            'LED 쇼가 없는 파일입니다 (.ledshow 또는 uranus-show-project.json 이어야 합니다).'
          )
        );
        return;
      }

      dispatch(importShow(show));
      dispatch(
        showSuccess(
          `LED 쇼 불러오기: 보드 ${(show['boards'] as unknown[]).length}개`
        )
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      dispatch(showError(`LED 쇼를 읽지 못했습니다: ${message}`));
    }
  };
