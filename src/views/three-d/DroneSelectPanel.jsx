import ChecklistRtl from '@mui/icons-material/ChecklistRtl';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import PropTypes from 'prop-types';
import React, { useEffect, useRef, useState } from 'react';

/**
 * 3D 뷰(Create 모드) 좌측의 작은 드론 다중 선택 탭.
 *
 * - 이 패널의 선택과 3D 뷰에서 드론을 클릭한 선택은 같은 상태다. 3D 뷰에서
 *   클릭하면 여기 체크가 켜지고, 여기서 고르면 3D 뷰의 드론이 빨갛게 표시되며
 *   마지막으로 고른 드론에 정보 패널·이동 기즈모가 붙는다.
 * - 행 클릭/체크박스로 개별 토글, "전체선택"/"해제"로 일괄 변경.
 * - 행 위에서 마우스를 누른 채 아래로 긁으면(스윕) 지나간 드론이 한 번에
 *   선택/해제된다 (누른 행의 반대 상태를 스윕 전체에 적용).
 * - 2대 이상 선택된 상태에서 선택된 드론의 기즈모를 드래그하면 선택된
 *   드론 전체가 같은 벡터만큼 함께 이동한다 (ThreeDView의 그룹 이동 로직).
 * - formation 그룹(클러스터)에 묶인 드론은 3D 뷰에서 한 대만 눌러도 그룹
 *   전체가 선택된다. 여기서는 그룹 배지(G1, G2…)와 하이라이트로 보여준다.
 */

/** 그룹 하이라이트 색 — 3D 뷰 선택색(빨강)과 구분되는 보라 계열 */
const GROUP_ACCENT = '#c39bff';
const GROUP_ACCENT_DIM = 'rgba(195, 155, 255, 0.16)';

export default function DroneSelectPanel({
  drones = [],
  selectedIds = [],
  onChangeSelection = () => {},
  onDeleteSelected = () => {},
  selectedPhase = null,
  groups = [],
  onCreateCluster = () => {},
  onRemoveCluster = () => {},
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

  // 그룹 표: 드론 행에 붙일 배지와, 그룹 전체가 선택됐는지(하이라이트) 여부
  const groupByDroneId = new Map();
  groups.forEach((group, index) => {
    const members = (group.members || []).map(String);
    const active = members.length > 0 && members.every((id) => selectedSet.has(id));
    const info = {
      ...group,
      members,
      active,
      badge: `G${index + 1}`,
    };
    members.forEach((id) => {
      if (!groupByDroneId.has(id)) groupByDroneId.set(id, info);
    });
  });
  const clusterActive = (cluster) => {
    const members = (Array.isArray(cluster) ? cluster : []).map(String);
    return members.length > 0 && members.every((id) => selectedSet.has(id));
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
          <div style={{ display: 'flex', gap: 8, padding: '10px 10px 6px' }}>
            <button
              type='button'
              onClick={selectAll}
              disabled={drones.length === 0}
              style={{
                flex: 1,
                minHeight: 40,
                padding: '10px 0',
                borderRadius: 8,
                border: '1px solid #2c2e36',
                background: '#2f80ed',
                color: '#ffffff',
                fontSize: 14,
                fontWeight: 700,
                cursor: drones.length ? 'pointer' : 'default',
              }}
            >
              Select All
            </button>
            <button
              type='button'
              onClick={clearAll}
              disabled={selectedIds.length === 0}
              style={{
                flex: 1,
                minHeight: 40,
                padding: '10px 0',
                borderRadius: 8,
                border: '1px solid #2c2e36',
                background: '#1c1e24',
                color: '#d7d9de',
                fontSize: 14,
                fontWeight: 700,
                cursor: selectedIds.length ? 'pointer' : 'default',
              }}
            >
              Deselect
            </button>
          </div>

          <div style={{ padding: '0 10px 4px' }}>
            <button
              type='button'
              onClick={onDeleteSelected}
              disabled={selectedIds.length === 0}
              title='선택한 드론을 모두 삭제합니다 (확인 팝업 표시)'
              style={{
                width: '100%',
                padding: '5px 0',
                borderRadius: 6,
                border: '1px solid #45272c',
                background: selectedIds.length ? '#331d22' : '#1c1e24',
                color: selectedIds.length ? '#ff8a8a' : '#6f727b',
                fontSize: 11.5,
                fontWeight: 600,
                cursor: selectedIds.length ? 'pointer' : 'default',
              }}
            >
              선택 삭제{selectedIds.length ? ` (${selectedIds.length})` : ''}
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
                const group = groupByDroneId.get(id);
                const highlighted = !!group?.active;
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
                      background: highlighted
                        ? GROUP_ACCENT_DIM
                        : checked
                          ? 'rgba(76, 141, 255, 0.16)'
                          : 'transparent',
                      boxShadow: highlighted ? `inset 2px 0 0 ${GROUP_ACCENT}` : 'none',
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
                    {group ? (
                      <span
                        title={`${group.phaseName ? `${group.phaseName} · ` : ''}${
                          group.label
                        } · ${group.members.length}대 — 한 대만 눌러도 함께 선택`}
                        style={{
                          flexShrink: 0,
                          fontSize: 9.5,
                          fontWeight: 700,
                          lineHeight: 1.4,
                          padding: '1px 5px',
                          borderRadius: 4,
                          border: `1px solid ${
                            highlighted ? GROUP_ACCENT : 'rgba(195, 155, 255, 0.35)'
                          }`,
                          background: highlighted ? GROUP_ACCENT : 'transparent',
                          color: highlighted ? '#1b1224' : GROUP_ACCENT,
                        }}
                      >
                        {group.badge}
                      </span>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>

          {selectedPhase ? (
            <div
              style={{
                borderTop: '1px solid #2c2e36',
                padding: '8px 10px',
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: '#9cc0ff',
                  marginBottom: 2,
                }}
              >
                {selectedPhase.name} 클러스터
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: '#6f727b',
                  lineHeight: 1.5,
                  marginBottom: 6,
                }}
              >
                이전 phase → {selectedPhase.name}으로 들어오는 전환에
                적용됩니다 (그룹이 대형 유지·직선·동시 이동)
              </div>
              <button
                type='button'
                onClick={onCreateCluster}
                disabled={selectedIds.length < 2}
                title='선택한 드론들을 이 phase 전환에서 통째로(직선·동시) 움직이는 그룹으로 지정'
                style={{
                  width: '100%',
                  padding: '5px 0',
                  borderRadius: 6,
                  border: '1px solid #2c2e36',
                  background: selectedIds.length >= 2 ? '#22304a' : '#1c1e24',
                  color: selectedIds.length >= 2 ? '#9cc0ff' : '#6f727b',
                  fontSize: 11.5,
                  fontWeight: 600,
                  cursor: selectedIds.length >= 2 ? 'pointer' : 'default',
                }}
              >
                선택 드론으로 그룹 추가 ({selectedIds.length})
              </button>
              {selectedPhase.clusters.length === 0 ? (
                <div style={{ fontSize: 10.5, color: '#6f727b', marginTop: 6 }}>
                  그룹 없음 — 통째로 움직인 블록은 자동 감지됩니다
                </div>
              ) : (
                selectedPhase.clusters.map((cluster, index) => {
                  const active = clusterActive(cluster);
                  return (
                  <div
                    // eslint-disable-next-line react/no-array-index-key
                    key={index}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      marginTop: 6,
                      padding: active ? '3px 5px' : 0,
                      borderRadius: 5,
                      background: active ? GROUP_ACCENT_DIM : 'transparent',
                      boxShadow: active ? `inset 2px 0 0 ${GROUP_ACCENT}` : 'none',
                      fontSize: 10.5,
                      color: active ? '#e6dbff' : '#b9bbc2',
                    }}
                  >
                    <span
                      style={{
                        flex: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontWeight: active ? 700 : 400,
                      }}
                      title={cluster.join(', ')}
                    >
                      그룹 {index + 1} · {cluster.length}대{active ? ' · 선택됨' : ''}
                    </span>
                    <button
                      type='button'
                      onClick={() => onChangeSelection(cluster)}
                      title='이 그룹의 드론들을 선택'
                      style={{
                        border: '1px solid #2c2e36',
                        background: '#1c1e24',
                        color: '#9a9ca3',
                        borderRadius: 5,
                        fontSize: 10,
                        padding: '2px 6px',
                        cursor: 'pointer',
                      }}
                    >
                      선택
                    </button>
                    <button
                      type='button'
                      onClick={() => onRemoveCluster(index)}
                      title='그룹 해제'
                      style={{
                        border: '1px solid #45272c',
                        background: '#331d22',
                        color: '#ff8a8a',
                        borderRadius: 5,
                        fontSize: 10,
                        padding: '2px 6px',
                        cursor: 'pointer',
                      }}
                    >
                      해제
                    </button>
                  </div>
                  );
                })
              )}
            </div>
          ) : null}

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
            3D 뷰 클릭과 같은 선택 (Ctrl·Shift+클릭 = 추가/해제)
            <br />
            2대 이상 선택 후 기즈모 드래그 = 함께 이동
            {groups.length ? (
              <>
                <br />
                <span style={{ color: GROUP_ACCENT }}>
                  G 배지 = {groups[0].phaseName || 'formation'} 그룹
                </span>
                {' '}— 3D 뷰에서 한 대만 눌러도 그룹 전체 선택 (Alt+클릭 = 한 대만)
              </>
            ) : null}
            {selectedPhase ? null : (
              <>
                <br />
                phase 카드를 클릭하면 여기서 그룹을 만들 수 있습니다
              </>
            )}
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
  onDeleteSelected: PropTypes.func,
  selectedPhase: PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string,
    clusters: PropTypes.arrayOf(PropTypes.arrayOf(PropTypes.string)),
  }),
  groups: PropTypes.arrayOf(
    PropTypes.shape({
      key: PropTypes.string.isRequired,
      label: PropTypes.string,
      phaseName: PropTypes.string,
      members: PropTypes.arrayOf(PropTypes.string).isRequired,
    })
  ),
  onCreateCluster: PropTypes.func,
  onRemoveCluster: PropTypes.func,
};
