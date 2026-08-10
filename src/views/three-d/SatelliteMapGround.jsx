import PropTypes from 'prop-types';
import React, { memo, useMemo } from 'react';
import { connect } from 'react-redux';

import { objectToString } from '~/aframe/utils';

import {
  canRenderSatelliteGround,
  createSatelliteTiles,
  getSatelliteGroundParams,
  isCurrentlyDark,
} from './utils/satelliteTiles';

const distance = ([x1, y1], [x2, y2]) => Math.hypot(x2 - x1, y2 - y1);

const angleBetween = ([x1, y1], [x2, y2]) =>
  (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;

/** Corner geometry → the centred, rotated plane a-frame wants. */
const toPlaneProps = (tile) => ({
  key: tile.key,
  url: tile.url,
  center: [
    (tile.nw[0] + tile.ne[0] + tile.sw[0] + tile.se[0]) / 4,
    (tile.nw[1] + tile.ne[1] + tile.sw[1] + tile.se[1]) / 4,
  ],
  width: distance(tile.nw, tile.ne),
  height: distance(tile.nw, tile.sw),
  rotation: angleBetween(tile.nw, tile.ne),
});

const SatelliteMapGround = ({
  currentSource,
  enabled,
  lighting,
  origin,
  transformer,
}) => {
  const shouldRender = Boolean(
    enabled && canRenderSatelliteGround({ currentSource, origin, transformer })
  );

  const dark = useMemo(
    () => isCurrentlyDark(origin, lighting),
    [lighting, origin]
  );

  const tiles = useMemo(
    () =>
      shouldRender
        ? createSatelliteTiles({ origin, transformer }).map(toPlaneProps)
        : [],
    [origin, shouldRender, transformer]
  );

  if (!shouldRender || !tiles.length) {
    return null;
  }

  return (
    <>
      {tiles.map((tile) => (
        <a-plane
          key={tile.key}
          position={`${tile.center[0]} ${tile.center[1]} 0.015`}
          rotation={`0 0 ${tile.rotation}`}
          width={tile.width * 1.01}
          height={tile.height * 1.01}
          material={objectToString({
            shader: 'flat',
            src: tile.url,
            color: dark ? '#536174' : '#fff',
            side: 'double',
          })}
        />
      ))}
      {dark && (
        <a-plane
          position='0 0 0.02'
          width='10000'
          height='10000'
          material={objectToString({
            shader: 'flat',
            color: '#061024',
            opacity: 0.42,
            transparent: true,
            depthWrite: false,
            side: 'double',
          })}
        />
      )}
    </>
  );
};

SatelliteMapGround.propTypes = {
  currentSource: PropTypes.string,
  enabled: PropTypes.bool,
  lighting: PropTypes.oneOf(['dark', 'light']),
  origin: PropTypes.arrayOf(PropTypes.number),
  transformer: PropTypes.object,
};

export default connect((state) => getSatelliteGroundParams(state))(
  memo(SatelliteMapGround)
);
