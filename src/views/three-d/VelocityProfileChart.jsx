import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js';
import PropTypes from 'prop-types';
import React from 'react';
import { Line } from 'react-chartjs-2';

import {
  DEFAULT_PROFILE_EXP,
  DEFAULT_PROFILE_LOG,
  peakFactor,
  rampFromSmoothing,
  sampleProfile,
} from './utils/velocityProfile';

ChartJS.register(
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Filler,
  Tooltip,
  Legend
);

/**
 * Interactive plot of the inertia model's trapezoid velocity profile:
 * exponential ease-in ramp → CONSTANT plateau → logarithmic ease-out ramp.
 * `smoothing` sets the ramp fraction, `kExp` / `kLog` the curvature of each
 * ramp. The curve updates live as the knobs change; the flat middle shows
 * the profile has no pointy apex.
 */
export default function VelocityProfileChart({
  smoothing,
  kExp = DEFAULT_PROFILE_EXP,
  kLog = DEFAULT_PROFILE_LOG,
  width = 320,
  height = 180,
}) {
  const { eased, cruise } = React.useMemo(() => {
    const samples = sampleProfile(smoothing, kExp, kLog, {
      v0: 0,
      v1: 0,
      nSamples: 140,
    });
    return {
      eased: samples.map((p) => ({ x: p.t, y: p.v })),
      cruise: [
        { x: 0, y: 1 },
        { x: 1, y: 1 },
      ],
    };
  }, [smoothing, kExp, kLog]);

  const factor = peakFactor(smoothing, kExp, kLog);
  const ramp = rampFromSmoothing(smoothing);

  const data = {
    datasets: [
      {
        label: '속도 (평균=1)',
        data: eased,
        borderColor: '#67b4ff',
        backgroundColor: 'rgba(103, 180, 255, 0.15)',
        borderWidth: 2,
        pointRadius: 0,
        fill: true,
        tension: 0.1,
      },
      {
        label: '순항(평균) 속도',
        data: cruise,
        borderColor: 'rgba(255,255,255,0.35)',
        borderDash: [4, 4],
        borderWidth: 1,
        pointRadius: 0,
        fill: false,
      },
    ],
  };

  const options = {
    responsive: false,
    animation: false,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          title: (items) => `τ = ${Number(items[0]?.parsed?.x ?? 0).toFixed(2)}`,
          label: (item) => `속도 ${Number(item.parsed?.y ?? 0).toFixed(2)} × 평균`,
        },
      },
    },
    scales: {
      x: {
        type: 'linear',
        min: 0,
        max: 1,
        title: { display: true, text: '정규화 시간 τ', color: 'rgba(255,255,255,0.5)' },
        ticks: {
          color: 'rgba(255,255,255,0.45)',
          maxTicksLimit: 6,
          callback: (v) => Number(v).toFixed(1),
        },
        grid: { color: 'rgba(255,255,255,0.06)' },
      },
      y: {
        min: 0,
        suggestedMax: 2.1,
        title: { display: true, text: '속도 ÷ 평균', color: 'rgba(255,255,255,0.5)' },
        ticks: { color: 'rgba(255,255,255,0.45)', maxTicksLimit: 5 },
        grid: { color: 'rgba(255,255,255,0.06)' },
      },
    },
  };

  return (
    <div style={{ width, color: 'rgba(255,255,255,0.85)' }}>
      <div style={{ fontSize: 11, marginBottom: 6, lineHeight: 1.5 }}>
        <div style={{ fontWeight: 600, marginBottom: 2 }}>관성 속도 프로파일</div>
        <div style={{ color: 'rgba(255,255,255,0.6)' }}>
          지수(exp) 가속 램프 → 등속 유지 구간 → 로그(log) 감속 램프
        </div>
        <div
          style={{
            fontFamily: 'monospace',
            fontSize: 10,
            color: 'rgba(255,255,255,0.55)',
            marginTop: 2,
          }}
        >
          E(u)=(e^(kₑu)−1)/(e^kₑ−1), L(u)=ln(1+(e^kₗ−1)u)/kₗ
        </div>
      </div>
      <div style={{ width, height }}>
        <Line data={data} options={options} width={width} height={height} />
      </div>
      <div
        style={{
          fontSize: 10,
          color: 'rgba(255,255,255,0.5)',
          marginTop: 4,
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>
          램프 {(ramp * 100).toFixed(0)}%/측 · kₑ {Number(kExp).toFixed(2)} · kₗ{' '}
          {Number(kLog).toFixed(2)}
        </span>
        <span>등속 구간 = {factor.toFixed(2)} × 평균</span>
      </div>
    </div>
  );
}

VelocityProfileChart.propTypes = {
  smoothing: PropTypes.number.isRequired,
  kExp: PropTypes.number,
  kLog: PropTypes.number,
  width: PropTypes.number,
  height: PropTypes.number,
};
