import ChecklistRtl from '@mui/icons-material/ChecklistRtl';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import PropTypes from 'prop-types';
import React, { useEffect, useRef, useState } from 'react';

/**
 * 3D 뷰(Create 모드) 좌측의 작은 드론 다중 선택 탭.
 *
 * - 행 클릭/체크박스로 개별 토글, "전체선택"/"해제"로 일괄 변경.
 * - 행 위에서 마우스를 누른 채 아래로 긁으면(스윕) 지나간 드론이 한 번에
 *   선택/해제된다 (누른 행의 반대 상태를 스윕 전체에 적용).
 * - 2대 이상 선택된 상태에서 선택된 드론의 기즈모를 드래그하면 선택된
 *   드론 전체가 같은 벡터만큼 함께 이동한다 (ThreeDView의 그룹 이동 로직).
 */
export default function DroneSelectPanel({
  drones = [],
  selectedIds = [],
  onChangeSelection = () => {},
}) {
  const [collapsed, setCollapsed] = useState(false);
  // 스윕 선택 상태: {mode: 'add' | 'remove'} — mouseup까지 유지
  const sweepRef = useRef(null);
  const selectedSet = new Set(selectedIds.map(String));
  // 스윕 중 mouseenter가 리렌더보다 빠르게 연달아 오면 props가 낡아
  // 앞선 선택이 유실되므로, 최신 선택은 ref에 동기적으로 유지한다.
  const latestSelectionRef = useRef(selectedIds.map(String));

  useEffect(() => {
    latestSelectionRef.current = selectedIds.map(String);
  }, [selectedIds]);

  useEffect(() => {
    const stopSweep = () => {
      sweepRef.current = null;
    };
    window.addEventListener('mouseup', stopSweep);
    return () => window.removeEventListener('mouseup', stopSweep);
  }, []);

  const applyToDrone = (droneId, mode) => {
    const id = String(droneId);
    const current = new Set(latestSelectionRef.current);
    const has = current.has(id);
    if (mode === 'add' ? has : !has) return;
    if (mode === 'add') {
      current.add(id);
    } else {
      current.delete(id);
    }
    const next = drones.map((d) => String(d.id)).filter((i) => current.has(i));
    latestSelectionRef.current = next;
    onChangeSelection(next);
  };

  const handleRowMouseDown = (droneId) => {
    const mode = selectedSet.has(String(droneId)) ? 'remove' : 'add';
    sweepRef.current = { mode };
    applyToDrone(droneId, mode);
  };

  const handleRowMouseEnter = (droneId) => {
    if (!sweepRef.current) return;
    applyToDrone(droneId, sweepRef.current.mode);
  };

  const selectAll = () => {
    onChangeSelection(drones.map((d) => String(d.id)));
  };

  const clearAll = () => {
    onChangeSelection([]);
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        left: 12,
        zIndex: 11000,
        width: 190,
        borderRadius: 10,
        background: 'rgba(16, 18, 22, 0.82)',
        border: '1px solid #2c2e36',
        backdropFilter: 'blur(6px)',
        color: '#d7d9de',
        fontSize: 12,
        userSelect: 'none',
        overflow: 'hidden',
      }}
    >
      <div
        onClick={() => setCollapsed((prev) => !prev)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 10px',
          cursor: 'pointer',
          fontWeight: 600,
          borderBottom: collapsed ? 'none' : '1px solid #2c2e36',
        }}
        title="드론 다중 선택 패널 접기/펼치기"
      >
        <ChecklistRtl sx={{ fontSize: 15, color: '#4c8dff' }} />
        <span style={{ flex: 1 }}>
          드론 선택 {selectedIds.length}/{drones.length}
        </span>
        {collapsed ? (
          <ExpandMore sx={{ fontSize: 16, color: '#8a8d95' }} />
        ) : (
          <ExpandLess sx={{ fontSize: 16, color: '#8a8d95' }} />
        )}
      </div>

      {!collapsed && (
        <>
          <div style={{ display: 'flex', gap: 6, padding: '8px 10px 4px' }}>
            <button
              type='button'
              onClick={selectAll}
              disabled={drones.length === 0}
              style={{
                flex: 1,
                padding: '5px 0',
                borderRadius: 6,
                border: '1px solid #2c2e36',
                background: '#22304a',
                color: '#9cc0ff',
                fontSize: 11.5,
                fontWeight: 600,
                cursor: drones.length ? 'pointer' : 'default',
              }}
            >
              전체선택
            </button>
            <button
              type='button'
              onClick={clearAll}
              disabled={selectedIds.length === 0}
              style={{
                flex: 1,
                padding: '5px 0',
                borderRadius: 6,
                border: '1px solid #2c2e36',
                background: '#1c1e24',
                color: '#9a9ca3',
                fontSize: 11.5,
                fontWeight: 600,
                cursor: selectedIds.length ? 'pointer' : 'default',
              }}
            >
              해제
            </button>
          </div>

          <div style={{ maxHeight: 220, overflowY: 'auto', padding: '2px 4px 6px' }}>
            {drones.length === 0 ? (
              <div style={{ padding: '8px 8px', color: '#6f727b' }}>
                드론이 없습니다
              </div>
            ) : (
              drones.map((d) => {
                const id = String(d.id);
                const checked = selectedSet.has(id);
                return (
                  <div
                    key={id}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleRowMouseDown(id);
                    }}
                    onMouseEnter={() => handleRowMouseEnter(id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 7,
                      padding: '4px 8px',
                      borderRadius: 6,
                      cursor: 'pointer',
                      background: checked ? 'rgba(76, 141, 255, 0.16)' : 'transparent',
                      color: checked ? '#cfe1ff' : '#b9bbc2',
                    }}
                  >
                    <input
                      type='checkbox'
                      checked={checked}
                      readOnly
                      style={{ pointerEvents: 'none', accentColor: '#4c8dff' }}
                    />
                    <span
                      style={{
                        flex: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {d.name || id}
                    </span>
                  </div>
                );
              })
            )}
          </div>

          <div
            style={{
              padding: '6px 10px 8px',
              fontSize: 10.5,
              color: '#6f727b',
              borderTop: '1px solid #2c2e36',
              lineHeight: 1.5,
            }}
          >
            행을 누른 채 긁으면 한 번에 선택됩니다.
            <br />
            2대 이상 선택 후 기즈모 드래그 = 함께 이동
          </div>
        </>
      )}
    </div>
  );
}

DroneSelectPanel.propTypes = {
  drones: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      name: PropTypes.string,
    })
  ),
  selectedIds: PropTypes.arrayOf(PropTypes.string),
  onChangeSelection: PropTypes.func,
};
