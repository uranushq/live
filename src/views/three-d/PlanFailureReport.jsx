/**
 * @file 경로 계획 실패 진단 패널.
 *
 * 실패를 한 덩어리 문자열로 흘리는 대신 네 층으로 나눠 보여 준다:
 *   무엇이 막혔나 (제목·한 줄 요약)
 *   측정값       (구간, 스텝, 못 간 드론 …)
 *   왜 그런가    (원인 설명)
 *   무엇을 바꾸나 (조치 목록)
 *
 * 서버가 준 `code`로 갈라지므로 문구가 바뀌어도 버티고, 모르는 코드가 오면
 * 원문을 접어 둔 채로 보여 준다.
 */

import PropTypes from 'prop-types';
import React, { useState } from 'react';

const RED = '#ff6b6b';
const RED_DIM = 'rgba(255, 107, 107, 0.12)';
const RED_EDGE = 'rgba(255, 107, 107, 0.32)';
const AMBER = '#ffc061';
const MUTED = 'rgba(255,255,255,0.55)';

const sectionLabelStyle = {
  fontSize: 9.5,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: MUTED,
  marginBottom: 4,
};

export default function PlanFailureReport({ failure, onDismiss }) {
  const [rawOpen, setRawOpen] = useState(false);
  if (!failure) return null;

  const {
    title,
    summary,
    facts = [],
    why,
    remedies = [],
    issues = [],
    code,
    status,
    rawText,
    serverMessage,
  } = failure;

  const blocking = issues.filter((i) => (i?.severity || 'error') === 'error');
  const warnings = issues.filter((i) => (i?.severity || 'error') !== 'error');

  return (
    <div
      style={{
        marginTop: 10,
        border: `1px solid ${RED_EDGE}`,
        background: RED_DIM,
        borderRadius: 10,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 8,
          padding: '10px 11px',
          borderBottom: `1px solid ${RED_EDGE}`,
        }}
      >
        <span style={{ color: RED, fontSize: 14, lineHeight: 1.2, flexShrink: 0 }}>
          ▲
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: '#ffd9d9' }}>
            {title}
          </div>
          {summary && (
            <div
              style={{
                fontSize: 11.5,
                color: 'rgba(255,255,255,0.78)',
                marginTop: 3,
                lineHeight: 1.5,
              }}
            >
              {summary}
            </div>
          )}
        </div>
        <span style={{ fontSize: 9.5, color: MUTED, flexShrink: 0 }}>
          {code}
          {status ? ` · ${status}` : ''}
        </span>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="닫기"
            style={{
              flexShrink: 0,
              width: 20,
              height: 20,
              border: 'none',
              background: 'transparent',
              color: MUTED,
              cursor: 'pointer',
              fontSize: 14,
              lineHeight: 1,
              padding: 0,
            }}
          >
            ×
          </button>
        )}
      </div>

      {facts.length > 0 && (
        <div style={{ padding: '9px 11px', borderBottom: `1px solid ${RED_EDGE}` }}>
          <div style={sectionLabelStyle}>측정값</div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'auto 1fr',
              gap: '3px 10px',
              fontSize: 11.5,
            }}
          >
            {facts.map((f) => (
              <React.Fragment key={f.label}>
                <span style={{ color: MUTED, whiteSpace: 'nowrap' }}>{f.label}</span>
                <span
                  style={{
                    color: 'rgba(255,255,255,0.86)',
                    fontVariantNumeric: 'tabular-nums',
                    wordBreak: 'break-word',
                  }}
                >
                  {f.value}
                </span>
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      {why && (
        <div style={{ padding: '9px 11px', borderBottom: `1px solid ${RED_EDGE}` }}>
          <div style={sectionLabelStyle}>왜 막혔나</div>
          <div
            style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.74)', lineHeight: 1.55 }}
          >
            {why}
          </div>
        </div>
      )}

      {remedies.length > 0 && (
        <div style={{ padding: '9px 11px', borderBottom: `1px solid ${RED_EDGE}` }}>
          <div style={sectionLabelStyle}>무엇을 바꾸면 되나</div>
          <ol style={{ margin: 0, paddingLeft: 16 }}>
            {remedies.map((r) => (
              <li
                key={r}
                style={{
                  fontSize: 11.5,
                  color: 'rgba(255,255,255,0.82)',
                  lineHeight: 1.55,
                  marginBottom: 3,
                }}
              >
                {r}
              </li>
            ))}
          </ol>
        </div>
      )}

      {(blocking.length > 0 || warnings.length > 0) && (
        <div style={{ padding: '9px 11px', borderBottom: `1px solid ${RED_EDGE}` }}>
          <div style={sectionLabelStyle}>
            검증 항목 (차단 {blocking.length} · 경고 {warnings.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {[...blocking, ...warnings].slice(0, 10).map((issue, index) => {
              const isError = (issue.severity || 'error') === 'error';
              const violations = Array.isArray(issue.details?.violations)
                ? issue.details.violations
                : [];
              return (
                <div
                  key={`${issue.code}-${index}`}
                  style={{ fontSize: 11, lineHeight: 1.5 }}
                >
                  <span
                    style={{
                      color: isError ? RED : AMBER,
                      fontWeight: 700,
                      marginRight: 5,
                    }}
                  >
                    {isError ? '차단' : '경고'}
                  </span>
                  <span style={{ color: 'rgba(255,255,255,0.84)' }}>
                    {issue.message || issue.code}
                  </span>
                  {issue.validator && (
                    <span style={{ color: MUTED }}> · {issue.validator}</span>
                  )}
                  {(violations.length > 0 || issue.details?.min_alt_m != null) && (
                    <div style={{ color: MUTED, paddingLeft: 10 }}>
                      {issue.details?.min_alt_m != null &&
                        `하한 ${issue.details.min_alt_m} m`}
                      {violations.length > 0 &&
                        ` · ${violations
                          .slice(0, 6)
                          .map((v) => `${v.label}[${v.index}] z=${v.z}`)
                          .join(', ')}`}
                      {violations.length > 6 && ` 외 ${violations.length - 6}건`}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {(rawText || serverMessage) && (
        <div style={{ padding: '7px 11px' }}>
          <button
            type="button"
            onClick={() => setRawOpen((v) => !v)}
            style={{
              border: 'none',
              background: 'transparent',
              color: MUTED,
              fontSize: 10.5,
              cursor: 'pointer',
              padding: 0,
            }}
          >
            {rawOpen ? '▾ 서버 원문 숨기기' : '▸ 서버 원문 보기'}
          </button>
          {rawOpen && (
            <pre
              style={{
                margin: '6px 0 0',
                padding: 8,
                maxHeight: 180,
                overflow: 'auto',
                background: 'rgba(0,0,0,0.35)',
                borderRadius: 6,
                fontSize: 10.5,
                lineHeight: 1.45,
                color: 'rgba(255,255,255,0.66)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {rawText || serverMessage}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

PlanFailureReport.propTypes = {
  failure: PropTypes.shape({
    title: PropTypes.string,
    summary: PropTypes.string,
    facts: PropTypes.array,
    why: PropTypes.string,
    remedies: PropTypes.array,
    issues: PropTypes.array,
    code: PropTypes.string,
    status: PropTypes.number,
    rawText: PropTypes.string,
    serverMessage: PropTypes.string,
  }),
  onDismiss: PropTypes.func,
};
