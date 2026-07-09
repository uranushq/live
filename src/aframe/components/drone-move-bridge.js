import AFrame from '@skybrush/aframe-components';

import { showYawToModelRotationZ } from '~/aframe/components/fbx-model';

if (!AFrame.components['drone-move-bridge']) {
  AFrame.registerComponent('drone-move-bridge', {
    init() {
      this._onMove = this._onMove.bind(this);
      this._onPath = this._onPath.bind(this);
      this._onStop = this._onStop.bind(this);
      this._onInitialPosSet = this._onInitialPosSet.bind(this);
      this._onYawSet = this._onYawSet.bind(this);
      // 드론별로 경로 애니메이션 취소 함수를 따로 관리
      this._currentPathCancels = {};
      this._currentYawAnimationFrames = {};
      this._currentPositionAnimationFrames = {};
      window.addEventListener('drone-move-request', this._onMove);
      window.addEventListener('drone-path-request', this._onPath);
      window.addEventListener('drone-path-stop', this._onStop);
      window.addEventListener('drone-initial-pos-set', this._onInitialPosSet);
      window.addEventListener('drone-yaw-set', this._onYawSet);
    },

    remove() {
      window.removeEventListener('drone-move-request', this._onMove);
      window.removeEventListener('drone-path-request', this._onPath);
      window.removeEventListener('drone-path-stop', this._onStop);
      window.removeEventListener('drone-initial-pos-set', this._onInitialPosSet);
      window.removeEventListener('drone-yaw-set', this._onYawSet);

      if (this._currentPathCancels) {
        Object.values(this._currentPathCancels).forEach((cancel) => {
          if (typeof cancel !== 'function') return;
          try {
            cancel();
          } catch {
            // ignore
          }
        });
        this._currentPathCancels = {};
      }

      if (this._currentYawAnimationFrames) {
        Object.values(this._currentYawAnimationFrames).forEach((frameId) => {
          if (frameId) window.cancelAnimationFrame(frameId);
        });
        this._currentYawAnimationFrames = {};
      }

      if (this._currentPositionAnimationFrames) {
        Object.values(this._currentPositionAnimationFrames).forEach((frameId) => {
          if (frameId) window.cancelAnimationFrame(frameId);
        });
        this._currentPositionAnimationFrames = {};
      }
    },

    // Freeze drones where they currently are by cancelling any running path
    // animation (and yaw ramp). Used for pause: the React progress-bar clock
    // stops separately, so without this the A-Frame motion would keep going and
    // the drones would drift on to the next waypoint despite the "paused" bar.
    _onStop(event) {
      const ids = event?.detail?.ids;
      const targetIds =
        Array.isArray(ids) && ids.length
          ? ids.map(String)
          : Object.keys(this._currentPathCancels || {});
      targetIds.forEach((id) => {
        const cancel = this._currentPathCancels && this._currentPathCancels[id];
        if (typeof cancel === 'function') {
          try {
            cancel();
          } catch {
            // ignore
          }
        }
        if (this._currentPathCancels) this._currentPathCancels[id] = undefined;
        this._cancelYawAnimation(id);
        this._cancelPositionAnimation(id);
      });
    },

    _findDrone(id) {
      const sceneEl = this.el.sceneEl || this.el;
      return sceneEl.querySelector(`[data-drone-id="${CSS.escape(id)}"]`);
    },

    _setYaw(target, yaw) {
      const parsed = Number(yaw);
      if (Number.isFinite(parsed)) {
        target.setAttribute('data-heading', String(parsed));
        const modelZ = showYawToModelRotationZ(parsed);
        // Yaw on the root entity only (show Z / vertical axis). Model pitch stays on child.
        target.setAttribute('rotation', `0 0 ${modelZ}`);
        return;
      }

      target.removeAttribute('data-heading');
      target.setAttribute('rotation', '0 0 0');
    },

    _getCurrentYaw(target) {
      const parsed = Number(target?.getAttribute?.('data-heading'));
      return Number.isFinite(parsed) ? parsed : null;
    },

    _getPointYaw(point) {
      const parsed = Number(point?.yaw);
      return Number.isFinite(parsed) ? parsed : null;
    },

    _normalizeYawDelta(delta) {
      let result = delta;
      while (result > 180) result -= 360;
      while (result < -180) result += 360;
      return result;
    },

    _easeInOutQuad(t) {
      return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
    },

    _cancelYawAnimation(id) {
      const frameId = this._currentYawAnimationFrames?.[id];
      if (frameId) {
        window.cancelAnimationFrame(frameId);
        this._currentYawAnimationFrames[id] = undefined;
      }
    },

    _animateYaw(id, target, fromYaw, toYaw, durationMs) {
      if (!Number.isFinite(toYaw)) return;

      this._cancelYawAnimation(id);

      const startYaw = Number.isFinite(fromYaw) ? fromYaw : toYaw;
      const duration = Math.max(0, Number(durationMs) || 0);
      if (duration <= 0 || startYaw === toYaw) {
        this._setYaw(target, toYaw);
        return;
      }

      const startedAt = performance.now();
      const delta = this._normalizeYawDelta(toYaw - startYaw);

      const step = (now) => {
        const ratio = Math.min(1, Math.max(0, (now - startedAt) / duration));
        const eased = this._easeInOutQuad(ratio);
        this._setYaw(target, startYaw + delta * eased);

        if (ratio < 1) {
          this._currentYawAnimationFrames[id] = window.requestAnimationFrame(step);
        } else {
          this._currentYawAnimationFrames[id] = undefined;
          this._setYaw(target, toYaw);
        }
      };

      this._currentYawAnimationFrames[id] = window.requestAnimationFrame(step);
    },

    _cancelPositionAnimation(id) {
      const frameId = this._currentPositionAnimationFrames?.[id];
      if (frameId) {
        window.cancelAnimationFrame(frameId);
        this._currentPositionAnimationFrames[id] = undefined;
      }
    },

    // 경로 재생 중 한 구간(segment)의 위치를 직접 requestAnimationFrame으로 보간한다.
    // 예전에는 A-Frame의 `animation` 컴포넌트(setAttribute('animation__path', ...))를
    // 사용했는데, PLAY 버튼으로 재생을 시작한 첫 구간에서만(진행바를 직접 스크럽할 때는
    // 재현되지 않음) 순간적으로 반대 방향으로 튀었다가 정상 경로로 돌아오는 현상이
    // 있었다. 원인을 A-Frame animation 컴포넌트 내부로 좁히기 어려워, 스크럽 때 이미
    // 정상 동작이 검증된 것과 동일한 수동 선형 보간 방식으로 통일해 제거한다.
    _animatePosition(id, target, fromPos, toPos, durationMs, onDone) {
      this._cancelPositionAnimation(id);

      const duration = Math.max(0, Number(durationMs) || 0);
      const setPos = (x, y, z) => target.setAttribute('position', `${x} ${y} ${z}`);

      if (duration <= 0) {
        setPos(toPos.x, toPos.y, toPos.z);
        if (onDone) onDone();
        return;
      }

      const startedAt = performance.now();

      const step = (now) => {
        const ratio = Math.min(1, Math.max(0, (now - startedAt) / duration));
        setPos(
          fromPos.x + (toPos.x - fromPos.x) * ratio,
          fromPos.y + (toPos.y - fromPos.y) * ratio,
          fromPos.z + (toPos.z - fromPos.z) * ratio
        );

        if (ratio < 1) {
          this._currentPositionAnimationFrames[id] = window.requestAnimationFrame(step);
        } else {
          this._currentPositionAnimationFrames[id] = undefined;
          setPos(toPos.x, toPos.y, toPos.z);
          if (onDone) onDone();
        }
      };

      this._currentPositionAnimationFrames[id] = window.requestAnimationFrame(step);
    },

    _onMove(e) {
      const { id, x, y, z, yaw } = e.detail || {};
      if (!id) return;

      const target = this._findDrone(id);
      if (!target) {
        console.warn('[drone-move-bridge] target not found:', id);
        return;
      }

      if (this._currentPathCancels[id]) {
        this._currentPathCancels[id]();
        this._currentPathCancels[id] = undefined;
      }
      this._cancelYawAnimation(id);
      this._cancelPositionAnimation(id);

      // 단일 이동은 즉시 위치 변경
      target.setAttribute('position', `${x} ${y} ${z}`);
      if (yaw !== undefined) {
        this._setYaw(target, yaw);
      }

      // 선택적으로: 패널 값 갱신용 이벤트
      window.dispatchEvent(
        new CustomEvent('drone-moved', { detail: { id, x, y, z } })
      );
    },

    _onYawSet(e) {
      const { id, yaw } = e.detail || {};
      if (!id) return;

      const target = this._findDrone(id);
      if (!target) {
        console.warn('[drone-move-bridge] yaw target not found:', id);
        return;
      }

      this._setYaw(target, yaw);
      window.dispatchEvent(
        new CustomEvent('drone-status-updated', { detail: { id, heading: yaw } })
      );
    },

    _onInitialPosSet(e) {
      const { id, x, y, z } = e.detail || {};
      if (!id) return;

      const nx = Number(x);
      const ny = Number(y);
      const nz = Number(z);
      if (!Number.isFinite(nx) || !Number.isFinite(ny) || !Number.isFinite(nz)) return;

      const sceneEl = this.el.sceneEl || this.el;
      const target = sceneEl.querySelector(`[data-drone-id="${CSS.escape(id)}"]`);
      if (!target) {
        console.warn('[drone-move-bridge] initial-pos target not found:', id);
        return;
      }

      target.setAttribute('data-initial-pos', `${nx} ${ny} ${nz}`);
      window.dispatchEvent(
        new CustomEvent('drone-initial-pos-updated', {
          detail: { id, x: nx, y: ny, z: nz },
        })
      );
    },

    _onPath(e) {
      const { id, points, durationPerSegment = 1000, startFromInitial = true } = e.detail || {};
      if (!id || !Array.isArray(points) || points.length === 0) return;

      const sceneEl = this.el.sceneEl || this.el;
      const target = sceneEl.querySelector(`[data-drone-id="${CSS.escape(id)}"]`);
      if (!target) {
        console.warn('[drone-move-bridge] path target not found:', id);
        return;
      }

      // 기존 경로 애니메이션 정리 (해당 드론만)
      if (this._currentPathCancels[id]) {
        this._currentPathCancels[id]();
        this._currentPathCancels[id] = undefined;
      }

      const initialPosAttr = target.getAttribute('data-initial-pos');

      const firstPoint = points[0] || {};
      const firstX = Number(firstPoint.x);
      const firstY = Number(firstPoint.y);
      const firstZ = Number(firstPoint.z);
      const hasValidFirstPoint =
        Number.isFinite(firstX) && Number.isFinite(firstY) && Number.isFinite(firstZ);

      let startAnchor = null;
      let index = 0;
      // path[0]을 시작 위치로 사용할 때, 그 점의 durationMs/holdMs는 시작 후 대기 시간으로 사용한다.
      let initialWaitMs = 0;
      let currentYaw = this._getCurrentYaw(target);
      // path[0]에 yaw가 없으면 currentYaw는 실제 값이 아니라 임의의 기본값(0 등)이다.
      // 이 상태로 다음 점의 실제 yaw를 향해 애니메이션하면, 재생 시작과 동시에
      // 의미 없는 큰 회전(스핀)이 발생해 마치 "뒤로 갔다가" 정상화되는 것처럼 보인다.
      // (스크럽 이동은 _onMove가 항상 즉시 스냅하므로 이 문제가 없다.)
      // 첫 번째로 확인되는 실제 yaw까지는 애니메이션 없이 즉시 스냅하고,
      // 그 이후 구간부터만 정상적으로 회전 애니메이션을 적용한다.
      let yawBaselineKnown = true;

      if (startFromInitial) {
        // 경로 재생은 path[0]을 곧 시작 위치로 사용한다.
        // path-planner 출력 컨벤션(첫 점 = 이륙/시작 지점)과 사용자의 직관적 기대에 맞춤.
        if (hasValidFirstPoint) {
          target.setAttribute('position', `${firstX} ${firstY} ${firstZ}`);
          const firstYaw = this._getPointYaw(firstPoint);
          yawBaselineKnown = firstYaw != null;
          if (firstYaw != null) {
            this._setYaw(target, firstYaw);
            currentYaw = firstYaw;
          }
          startAnchor = { x: firstX, y: firstY, z: firstZ };
          index = 1;
          const firstDur = Number(firstPoint.durationMs);
          const firstHoldRaw = Number(firstPoint.holdMs);
          initialWaitMs =
            (Number.isFinite(firstDur) && firstDur > 0 ? firstDur : 0) +
            (Number.isFinite(firstHoldRaw) && firstHoldRaw > 0 ? firstHoldRaw : 0);
        } else if (typeof initialPosAttr === 'string' && initialPosAttr.trim()) {
          // 첫 점이 유효하지 않은 경우 fallback: data-initial-pos.
          const [sx, sy, sz] = initialPosAttr.trim().split(/\s+/);
          const ix = Number(sx);
          const iy = Number(sy);
          const iz = Number(sz);
          if (Number.isFinite(ix) && Number.isFinite(iy) && Number.isFinite(iz)) {
            target.setAttribute('position', `${ix} ${iy} ${iz}`);
            startAnchor = { x: ix, y: iy, z: iz };
          }
        }
      } else {
        // startFromInitial=false: 현재 위치에서 path[0]을 향해 애니메이션 (수동 단일 이동 등)
        const currentPos = target.getAttribute('position');
        if (currentPos && typeof currentPos === 'object') {
          startAnchor = {
            x: Number(currentPos.x) || 0,
            y: Number(currentPos.y) || 0,
            z: Number(currentPos.z) || 0,
          };
        }
        index = 0;
      }

      // 시작 앵커가 여전히 없으면 첫 점으로 최후 폴백
      if (!startAnchor && hasValidFirstPoint) {
        target.setAttribute('position', `${firstX} ${firstY} ${firstZ}`);
        const firstYaw = this._getPointYaw(firstPoint);
        yawBaselineKnown = firstYaw != null;
        if (firstYaw != null) {
          this._setYaw(target, firstYaw);
          currentYaw = firstYaw;
        }
        startAnchor = { x: firstX, y: firstY, z: firstZ };
        index = 1;
      }

      let currentFrom = startAnchor || target.getAttribute('position') || { x: 0, y: 0, z: 0 };
      let currentHoldTimer = null;

      const defaultDur =
        Number.isFinite(Number(durationPerSegment)) && Number(durationPerSegment) > 0
          ? Number(durationPerSegment)
          : 1000;

      const toHoldMs = (value) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
      };

      const continueAfterHold = (point) => {
        const holdMs = toHoldMs(point?.holdMs);
        if (holdMs <= 0) {
          index += 1;
          playNext();
          return;
        }

        currentHoldTimer = window.setTimeout(() => {
          currentHoldTimer = null;
          index += 1;
          playNext();
        }, holdMs);
        this._currentPathCancels[id] = () => {
          if (currentHoldTimer) {
            window.clearTimeout(currentHoldTimer);
            currentHoldTimer = null;
          }
          this._cancelPositionAnimation(id);
          this._cancelYawAnimation(id);
        };
      };

      const playNext = () => {
        if (index >= points.length) {
          if (this._currentPathCancels[id]) {
            this._currentPathCancels[id] = undefined;
          }
          window.dispatchEvent(
            new CustomEvent('drone-path-finished', { detail: { id } })
          );
          return;
        }

        const point = points[index] || {};
        const { x, y, z, durationMs } = point;
        const targetYaw = this._getPointYaw(point);
        const fromPos = { x: currentFrom.x, y: currentFrom.y, z: currentFrom.z };
        const toPos = { x, y, z };

        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
          index += 1;
          playNext();
          return;
        }

        this._cancelPositionAnimation(id);

        const parsedDuration = Number(durationMs);
        const hasDuration = Number.isFinite(parsedDuration) && parsedDuration >= 0;
        const segDur = hasDuration ? parsedDuration : defaultDur;
        const isStationarySegment =
          Math.abs(currentFrom.x - x) < 1e-6 &&
          Math.abs(currentFrom.y - y) < 1e-6 &&
          Math.abs(currentFrom.z - z) < 1e-6;

        // 0ms 구간은 즉시 이동으로 처리해 다음 구간 계산 오차를 줄인다.
        if (segDur === 0) {
          target.setAttribute('position', `${x} ${y} ${z}`);
          currentFrom = { x, y, z };
          if (targetYaw != null) {
            this._setYaw(target, targetYaw);
            currentYaw = targetYaw;
          }
          continueAfterHold(point);
          return;
        }

        // 위치 변화 없이 yaw만 바뀌는 구간: A-Frame position 애니메이션은 즉시 끝나므로 타이머로 재생
        if (isStationarySegment) {
          if (targetYaw != null) {
            if (yawBaselineKnown) {
              this._animateYaw(id, target, currentYaw, targetYaw, segDur);
            } else {
              this._setYaw(target, targetYaw);
              currentYaw = targetYaw;
              yawBaselineKnown = true;
            }
          }

          currentHoldTimer = window.setTimeout(() => {
            currentHoldTimer = null;
            if (targetYaw != null) {
              this._cancelYawAnimation(id);
              this._setYaw(target, targetYaw);
              currentYaw = targetYaw;
            }
            continueAfterHold(point);
          }, segDur);

          this._currentPathCancels[id] = () => {
            if (currentHoldTimer) {
              window.clearTimeout(currentHoldTimer);
              currentHoldTimer = null;
            }
            this._cancelYawAnimation(id);
          };
          currentFrom = { x, y, z };
          return;
        }

        this._currentPathCancels[id] = () => {
          if (currentHoldTimer) {
            window.clearTimeout(currentHoldTimer);
            currentHoldTimer = null;
          }
          this._cancelPositionAnimation(id);
          this._cancelYawAnimation(id);
        };

        if (targetYaw != null) {
          if (yawBaselineKnown) {
            this._animateYaw(id, target, currentYaw, targetYaw, segDur);
          } else {
            this._setYaw(target, targetYaw);
            currentYaw = targetYaw;
            yawBaselineKnown = true;
          }
        }

        // Linear per-segment: the trajectory's own speed profile (Bézier
        // easing, sampled into the path points) already encodes accel/decel.
        // Using an eased interpolation here would re-ease every sub-segment
        // and make the drone briefly stop at each sampled point (visible
        // stutter).
        this._animatePosition(id, target, fromPos, toPos, segDur, () => {
          if (targetYaw != null) {
            this._cancelYawAnimation(id);
            this._setYaw(target, targetYaw);
            currentYaw = targetYaw;
          }
          continueAfterHold(point);
        });
        currentFrom = { x, y, z };
      };

      // path[0]을 시작 위치로 사용한 경우, path[0]의 durationMs/holdMs 합계를 시작 후 대기 시간으로 사용
      if (index > 0 && initialWaitMs > 0) {
        currentHoldTimer = window.setTimeout(() => {
          currentHoldTimer = null;
          playNext();
        }, initialWaitMs);
        this._currentPathCancels[id] = () => {
          if (currentHoldTimer) {
            window.clearTimeout(currentHoldTimer);
            currentHoldTimer = null;
          }
          this._cancelPositionAnimation(id);
          this._cancelYawAnimation(id);
        };
      } else {
        playNext();
      }
    },
  });
}