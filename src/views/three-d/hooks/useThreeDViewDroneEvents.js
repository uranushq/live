import { useEffect } from 'react';

import {
  applyDronePathsToScene,
  DEFAULT_DRONE_GROUND_POSITION,
  isDroneConfigState,
  normalizeDroneForConfigIO,
} from '../utils/threeDViewUtils';

const sameDroneId = (a, b) => String(a) === String(b);

export default function useThreeDViewDroneEvents({
  droneConfigRef,
  pathOverridesByIdRef,
  clearPathOverrides,
  setSelectedDrone,
  setDroneConfig,
  setPathProgress,
  collectConfigFromScene,
  showSpecDroneConfig,
}) {
  useEffect(() => {
    const onSelected = (e) => {
      const base = e.detail ?? null;
      if (!base) {
        setSelectedDrone(null);
        return;
      }

      if (base.id != null && String(base.id).trim() !== '') {
        base.id = String(base.id);
      }

      const currentConfig = droneConfigRef.current;
      if (currentConfig && Array.isArray(currentConfig.drones)) {
        const found = currentConfig.drones.find((d) => sameDroneId(d.id, base.id));
        if (found) {
          base.path = found.path || [];
          if (!base.initialPosition && Array.isArray(found.initialPos) && found.initialPos.length >= 3) {
            base.initialPosition = {
              x: Number(found.initialPos[0]) || 0,
              y: Number(found.initialPos[1]) || 0,
              z: Number(found.initialPos[2]) || 0,
            };
          }
        }
      }

      setSelectedDrone(base);
    };

    const onDeselected = () => {
      setSelectedDrone(null);
    };

    const onPathUpdated = (e) => {
      const { id, path } = e.detail || {};
      if (!id || !Array.isArray(path)) return;

      if (pathOverridesByIdRef?.current) {
        pathOverridesByIdRef.current.set(String(id), path.slice());
      }

      const hasShowSpec =
        showSpecDroneConfig &&
        Array.isArray(showSpecDroneConfig.drones) &&
        showSpecDroneConfig.drones.length > 0;

      setDroneConfig((prev) => {
        if (hasShowSpec) {
          const overrides = Array.isArray(prev?.drones) ? [...prev.drones] : [];
          const idx = overrides.findIndex((d) => sameDroneId(d.id, id));
          const entry = { id, path: path.slice() };
          if (idx >= 0) {
            overrides[idx] = { ...overrides[idx], ...entry };
          } else {
            overrides.push(entry);
          }
          return { ...(prev || {}), drones: overrides };
        }

        const base = isDroneConfigState(prev) ? prev : collectConfigFromScene();

        if (!base || !Array.isArray(base.drones)) return base;

        const drones = base.drones.map((d) =>
          sameDroneId(d.id, id) ? { ...d, path: path.slice() } : d
        );
        return { ...base, drones };
      });

      setSelectedDrone((prev) => {
        if (!prev || !sameDroneId(prev.id, id)) return prev;
        return { ...prev, path: path.slice() };
      });
    };

    const onInitialPosUpdated = (e) => {
      const { id, x, y, z } = e.detail || {};
      if (!id) return;
      const nx = Number(x);
      const ny = Number(y);
      const nz = Number(z);
      if (!Number.isFinite(nx) || !Number.isFinite(ny) || !Number.isFinite(nz)) return;

      setDroneConfig((prev) => {
        const base = isDroneConfigState(prev) ? prev : collectConfigFromScene();

        if (!base || !Array.isArray(base.drones)) return base;
        const drones = base.drones.map((d) => {
          if (!sameDroneId(d.id, id)) return d;
          const next = {
            ...d,
            initialPos: [nx, ny, nz],
            pos: Array.isArray(d.pos) ? d.pos : DEFAULT_DRONE_GROUND_POSITION,
          };
          if (Array.isArray(d.path) && d.path.length > 0) {
            const first = d.path[0];
            next.path = [{ ...first, x: nx, y: ny, z: nz }, ...d.path.slice(1)];
          }
          return next;
        });
        return { ...base, drones };
      });

      setSelectedDrone((prev) => {
        if (!prev || !sameDroneId(prev.id, id)) return prev;
        const next = {
          ...prev,
          initialPosition: { x: nx, y: ny, z: nz },
        };
        if (Array.isArray(prev.path) && prev.path.length > 0) {
          const first = prev.path[0];
          next.path = [{ ...first, x: nx, y: ny, z: nz }, ...prev.path.slice(1)];
        }
        return next;
      });
    };

    const onDroneMoved = (e) => {
      const { id, x, y, z } = e.detail || {};
      if (!id) return;

      const nx = Number(x);
      const ny = Number(y);
      const nz = Number(z);
      if (!Number.isFinite(nx) || !Number.isFinite(ny) || !Number.isFinite(nz)) return;

      setSelectedDrone((prev) => {
        if (!prev || !sameDroneId(prev.id, id)) return prev;
        return {
          ...prev,
          currentPosition: { x: nx, y: ny, z: nz },
        };
      });
    };

    const onDroneStatusUpdated = (e) => {
      const { id, ...updates } = e.detail || {};
      if (!id) return;

      setSelectedDrone((prev) => {
        if (!prev || !sameDroneId(prev.id, id)) return prev;
        return {
          ...prev,
          ...updates,
        };
      });
    };

    const onDroneDeleteRequest = (e) => {
      // 단일 삭제({id})와 다중 삭제({ids: [...]})를 모두 지원한다. 여러
      // 드론은 반드시 한 이벤트로 삭제해야 한다 — 이벤트를 드론별로 나눠
      // 보내면 아래 base 결정이 stale한 droneConfigRef를 다시 읽어 앞서
      // 지운 드론이 되살아난다.
      const detail = e.detail || {};
      const rawList = Array.isArray(detail.ids) ? detail.ids : [detail.id];
      const idList = rawList
        .filter((v) => v !== undefined && v !== null && String(v).trim() !== '')
        .map(String);
      if (!idList.length) return;

      const hasShowSpec =
        showSpecDroneConfig &&
        Array.isArray(showSpecDroneConfig.drones) &&
        showSpecDroneConfig.drones.length > 0;

      setDroneConfig((prev) => {
        if (hasShowSpec) {
          const deletedIds = [
            ...new Set([
              ...(Array.isArray(prev?.deletedIds) ? prev.deletedIds : []),
              ...idList,
            ]),
          ];
          return { ...(prev || {}), deletedIds };
        }

        const displayed = droneConfigRef.current;
        let base = null;

        if (displayed && Array.isArray(displayed.drones) && displayed.drones.length > 0) {
          base = displayed;
        } else if (isDroneConfigState(prev) && prev.drones.length > 0) {
          base = prev;
        } else if (isDroneConfigState(prev)) {
          return prev;
        } else {
          base = collectConfigFromScene();
        }

        if (!base || !Array.isArray(base.drones)) {
          return { drones: [] };
        }

        const drones = base.drones.filter(
          (d) => !idList.some((id) => sameDroneId(d.id, id))
        );
        return { ...base, drones };
      });

      setSelectedDrone((prev) => {
        if (prev && idList.some((id) => sameDroneId(prev.id, id))) {
          queueMicrotask(() => {
            window.dispatchEvent(new CustomEvent('drone-deselected'));
          });
          return null;
        }
        return prev;
      });
    };

    const onPathGeneratorResponse = (e) => {
      const responseConfig = e?.detail;
      if (!responseConfig || !Array.isArray(responseConfig.drones)) return;

      const normalizedDrones = responseConfig.drones.map((d, index) => {
        const normalized = normalizeDroneForConfigIO(d, index);
        return {
          ...normalized,
          initialPos: normalized.initialPos.slice(),
        };
      });

      setPathProgress(0);
      clearPathOverrides?.();
      setDroneConfig({ drones: normalizedDrones });
      setSelectedDrone(null);
      window.dispatchEvent(new CustomEvent('drone-deselected'));
      applyDronePathsToScene(normalizedDrones);
    };

    window.addEventListener('drone-selected', onSelected);
    window.addEventListener('drone-deselected', onDeselected);
    window.addEventListener('drone-path-updated', onPathUpdated);
    window.addEventListener('drone-initial-pos-updated', onInitialPosUpdated);
    window.addEventListener('drone-moved', onDroneMoved);
    window.addEventListener('drone-status-updated', onDroneStatusUpdated);
    window.addEventListener('drone-delete-request', onDroneDeleteRequest);
    window.addEventListener('path-generator-response', onPathGeneratorResponse);

    return () => {
      window.removeEventListener('drone-selected', onSelected);
      window.removeEventListener('drone-deselected', onDeselected);
      window.removeEventListener('drone-path-updated', onPathUpdated);
      window.removeEventListener('drone-initial-pos-updated', onInitialPosUpdated);
      window.removeEventListener('drone-moved', onDroneMoved);
      window.removeEventListener('drone-status-updated', onDroneStatusUpdated);
      window.removeEventListener('drone-delete-request', onDroneDeleteRequest);
      window.removeEventListener('path-generator-response', onPathGeneratorResponse);
    };
  }, [
    clearPathOverrides,
    collectConfigFromScene,
    droneConfigRef,
    pathOverridesByIdRef,
    setDroneConfig,
    setPathProgress,
    setSelectedDrone,
    showSpecDroneConfig,
  ]);
}
