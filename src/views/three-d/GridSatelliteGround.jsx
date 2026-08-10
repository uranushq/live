/**
 * @file Satellite imagery under the grid formation editor's ground plane.
 *
 * The editor projects the world with a fixed isometric camera, so the ground
 * (z = 0) maps to the screen through a plain affine transform. That lets each
 * satellite tile be drawn as a single <img> carrying the CSS matrix built from
 * its own projected NW/NE/SW corners — pixel-exact alignment with the grid,
 * the axes and the drone dots, with no canvas or WebGL involved.
 */

import PropTypes from 'prop-types';
import React, { memo, useMemo } from 'react';
import { connect } from 'react-redux';

import {
  getLightingConditionsForThreeDView,
  getSceneryForThreeDView,
} from '~/features/settings/selectors';
import { isShowIndoor } from '~/features/show/selectors';

import {
  canRenderSatelliteGround,
  createSatelliteTiles,
  getSatelliteGroundParams,
  isCurrentlyDark,
  TILE_PIXELS,
} from './utils/satelliteTiles';
import { getEffectiveScenery } from './utils/threeDViewUtils';

/** 이웃 타일 사이에 반올림 틈이 보이지 않도록 남동쪽으로 살짝 키운다. */
const TILE_OVERLAP = 1.004;

const GridSatelliteGround = ({
  currentSource,
  dark,
  enabled,
  origin,
  project,
  transformer,
}) => {
  const shouldRender = Boolean(
    enabled &&
      typeof project === 'function' &&
      canRenderSatelliteGround({ currentSource, origin, transformer })
  );

  const tiles = useMemo(
    () => (shouldRender ? createSatelliteTiles({ origin, transformer }) : []),
    [origin, shouldRender, transformer]
  );

  const placedTiles = useMemo(() => {
    if (!shouldRender) {
      return [];
    }

    const scale = TILE_OVERLAP / TILE_PIXELS;

    return tiles
      .map((tile) => {
        const nw = project(tile.nw[0], tile.nw[1], 0);
        const ne = project(tile.ne[0], tile.ne[1], 0);
        const sw = project(tile.sw[0], tile.sw[1], 0);

        return {
          key: tile.key,
          url: tile.url,
          matrix: [
            (ne.px - nw.px) * scale,
            (ne.py - nw.py) * scale,
            (sw.px - nw.px) * scale,
            (sw.py - nw.py) * scale,
            nw.px,
            nw.py,
          ],
        };
      })
      .filter((tile) => tile.matrix.every((value) => Number.isFinite(value)));
  }, [project, shouldRender, tiles]);

  if (!placedTiles.length) {
    return null;
  }

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
        zIndex: 0,
      }}
    >
      {placedTiles.map((tile) => (
        <img
          key={tile.key}
          alt=''
          draggable={false}
          src={tile.url}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: TILE_PIXELS,
            height: TILE_PIXELS,
            transform: `matrix(${tile.matrix.join(', ')})`,
            transformOrigin: '0 0',
            userSelect: 'none',
          }}
        />
      ))}
      {/* 위성 사진 위에서도 격자선·드론 점이 읽히도록 살짝 덮는다. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: dark ? 'rgba(6, 10, 16, 0.62)' : 'rgba(8, 12, 20, 0.35)',
        }}
      />
    </div>
  );
};

GridSatelliteGround.propTypes = {
  currentSource: PropTypes.string,
  dark: PropTypes.bool,
  enabled: PropTypes.bool,
  origin: PropTypes.arrayOf(PropTypes.number),
  /** (x, y, z) → { px, py } 화면 투영 — 그리드 편집기의 proj와 동일해야 한다. */
  project: PropTypes.func,
  transformer: PropTypes.object,
};

export default connect((state) => {
  const params = getSatelliteGroundParams(state);

  return {
    ...params,
    dark: isCurrentlyDark(
      params.origin,
      getLightingConditionsForThreeDView(state)
    ),
    enabled:
      getEffectiveScenery(state, getSceneryForThreeDView, isShowIndoor) ===
      'outdoor',
  };
})(memo(GridSatelliteGround));
