/**
 * @file 채우기 방향(1번 → 2번) 선택 버튼 4개.
 *
 * "그리드로 Phase 추가"와 "드론 추가"가 같은 컴포넌트를 쓴다 — 두 화면의
 * 조작·표시가 어긋나지 않게.
 */

import PropTypes from 'prop-types';
import React from 'react';

import {
  axisDirections,
  dirAxis,
  dirLabel,
  toggleFillDirection,
} from './utils/fillDirections';

const ACCENT = '#f0b429';

const labelStyle = {
  fontSize: 11,
  letterSpacing: 0.4,
  opacity: 0.62,
  textTransform: 'uppercase',
};

export default function FillDirectionPicker({ axes, value, onChange, label }) {
  const dirs = Array.isArray(value) ? value : [];
  const options = axisDirections(axes);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={labelStyle}>{label}</span>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        {options.map((dir) => {
          const rank = dirs.indexOf(dir);
          const selected = rank >= 0;
          const blocked =
            !selected &&
            (dirs.length >= 2 || dirs.some((d) => dirAxis(d) === dirAxis(dir)));

          return (
            <button
              key={dir}
              type='button'
              disabled={blocked}
              title={
                blocked
                  ? '같은 축의 다른 방향이 이미 선택됨'
                  : selected
                    ? '다시 누르면 선택 해제'
                    : `${dirLabel(dir)} 방향으로 먼저 채우기`
              }
              onClick={() => onChange(toggleFillDirection(dirs, dir))}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 6,
                padding: '7px 9px',
                borderRadius: 8,
                border: `1px solid ${
                  selected ? 'rgba(240, 180, 41, 0.7)' : 'rgba(255,255,255,0.12)'
                }`,
                background: selected
                  ? 'rgba(240, 180, 41, 0.14)'
                  : 'rgba(255,255,255,0.02)',
                color: blocked ? 'rgba(255,255,255,0.28)' : 'inherit',
                cursor: blocked ? 'not-allowed' : 'pointer',
                fontSize: 12,
                fontWeight: 700,
                fontFamily: 'inherit',
              }}
            >
              <span>{dirLabel(dir)}</span>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  fontSize: 10,
                  fontWeight: 800,
                  background: selected ? ACCENT : 'transparent',
                  color: selected ? '#1a1205' : 'transparent',
                }}
              >
                {selected ? rank + 1 : ''}
              </span>
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: 11, opacity: 0.45, lineHeight: 1.4 }}>
        {dirs.length === 0
          ? `자동 (${dirLabel(`${axes[0]}+`)} → ${dirLabel(`${axes[1]}+`)} 순)`
          : dirs.length === 1
            ? `${dirLabel(dirs[0])} 먼저 · 2번은 자동`
            : `${dirLabel(dirs[0])} 먼저 → ${dirLabel(dirs[1])}`}
      </div>
    </div>
  );
}

FillDirectionPicker.propTypes = {
  /** 방향을 만들 두 축 (예: ['x', 'y']) */
  axes: PropTypes.arrayOf(PropTypes.oneOf(['x', 'y', 'z'])).isRequired,
  /** 고른 방향 토큰 배열 (최대 2개) */
  value: PropTypes.arrayOf(PropTypes.string),
  onChange: PropTypes.func.isRequired,
  label: PropTypes.string,
};

FillDirectionPicker.defaultProps = {
  label: '채우기 방향 (1번 → 2번)',
};
