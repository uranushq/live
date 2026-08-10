/**
 * @file Satellite ground tiles expressed in the show's local (metre) frame.
 *
 * Shared by the 3D view's ground planes (SatelliteMapGround) and the grid
 * formation editor's background (GridSatelliteGround) so both surfaces show the
 * exact same imagery under the exact same coordinates.
 */

import SunCalc from 'suncalc';

import {
  getOutdoorShowOrigin,
  getOutdoorShowToWorldCoordinateSystemTransformationObject,
  hasShowOrigin,
  isShowIndoor,
} from '~/features/show/selectors';
import { LayerType } from '~/model/layers';
import { Source } from '~/model/sources';
import { getFlatEarthCoordinateTransformer } from '~/selectors/map';

export const TILE_ZOOM = 19;
export const TILE_RADIUS = 2;
/** Native pixel size of one ArcGIS World Imagery tile. */
export const TILE_PIXELS = 256;

export const SATELLITE_SOURCES = new Set([
  Source.ESRI_WORLD_IMAGERY,
  Source.MAPBOX.SATELLITE,
  Source.MAPTILER.SATELLITE,
  Source.MAPTILER.HYBRID,
  Source.GOOGLE.SATELLITE,
  Source.BING.AERIAL_WITH_LABELS,
]);

const getBaseLayer = (layers) =>
  layers.order
    .map((layerId) => layers.byId[layerId])
    .find((layer) => layer?.type === LayerType.BASE);

const tileUrl = (x, y, zoom) =>
  `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${y}/${x}`;

const lonLatToTile = ([lon, lat], zoom) => {
  const n = 2 ** zoom;
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const latRad = (clampedLat * Math.PI) / 180;

  return {
    x: Math.floor(((lon + 180) / 360) * n),
    y: Math.floor(
      ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
        n
    ),
  };
};

const tileToLonLat = (x, y, zoom) => {
  const n = 2 ** zoom;
  const lon = (x / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  return [lon, (latRad * 180) / Math.PI];
};

const localPointFromLonLat = (transformer, lonLat) => {
  const [x, y] = transformer.fromLonLat(lonLat);
  return [x, transformer.type === 'nwu' ? y : -y];
};

const getTileCorners = (transformer, x, y, zoom) => ({
  nw: localPointFromLonLat(transformer, tileToLonLat(x, y, zoom)),
  ne: localPointFromLonLat(transformer, tileToLonLat(x + 1, y, zoom)),
  sw: localPointFromLonLat(transformer, tileToLonLat(x, y + 1, zoom)),
  se: localPointFromLonLat(transformer, tileToLonLat(x + 1, y + 1, zoom)),
});

/**
 * Returns whether it is currently dark at the given origin, so that the imagery
 * can be dimmed the same way the 3D scene is.
 */
export const isCurrentlyDark = (origin, fallbackLighting) => {
  if (!Array.isArray(origin)) {
    return fallbackLighting === 'dark';
  }

  const [lon, lat] = origin;
  const sun = SunCalc.getPosition(new Date(), lat, lon);

  return fallbackLighting === 'dark' || sun.altitude < -0.05;
};

/**
 * Satellite tiles around the show origin, each with its four corners in the
 * show's local coordinate frame (metres) — the same frame the drone positions
 * live in.
 */
export const createSatelliteTiles = ({ origin, transformer }) => {
  const centerTile = lonLatToTile(origin, TILE_ZOOM);
  const tiles = [];
  const worldTileCount = 2 ** TILE_ZOOM;

  for (let dy = -TILE_RADIUS; dy <= TILE_RADIUS; dy++) {
    for (let dx = -TILE_RADIUS; dx <= TILE_RADIUS; dx++) {
      const x = (centerTile.x + dx + worldTileCount) % worldTileCount;
      const y = centerTile.y + dy;

      if (y < 0 || y >= worldTileCount) {
        continue;
      }

      tiles.push({
        key: `${TILE_ZOOM}/${x}/${y}`,
        url: tileUrl(x, y, TILE_ZOOM),
        ...getTileCorners(transformer, x, y, TILE_ZOOM),
      });
    }
  }

  return tiles;
};

/**
 * Origin / transformer / base layer source needed to place the imagery. The
 * show's own coordinate frame wins when the show is outdoor and geo-referenced,
 * otherwise the map origin is used.
 */
export const getSatelliteGroundParams = (state) => {
  const baseLayer = getBaseLayer(state.map.layers);
  const showTransformer =
    getOutdoorShowToWorldCoordinateSystemTransformationObject(state);
  const useShowCoordinateFrame =
    !isShowIndoor(state) && hasShowOrigin(state) && showTransformer;

  return {
    currentSource: baseLayer?.parameters?.source,
    origin: useShowCoordinateFrame
      ? getOutdoorShowOrigin(state)
      : state.map.origin.position,
    transformer: useShowCoordinateFrame
      ? showTransformer
      : getFlatEarthCoordinateTransformer(state),
  };
};

/** Whether satellite imagery can be drawn at all with the current settings. */
export const canRenderSatelliteGround = ({
  currentSource,
  origin,
  transformer,
}) =>
  Boolean(
    transformer && Array.isArray(origin) && SATELLITE_SOURCES.has(currentSource)
  );
