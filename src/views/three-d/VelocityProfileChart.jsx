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
  MAX_THICKNESS,
  sampleProfile,
  thicknessFromSmoothing,
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
 * Interactive plot of the inertia model's velocity profile for the current
 * smoothing value. Shows the exponential ease-in / logarithmic ease-out speed
 * curve of a rest-to-rest move (normalized so the average speed = 1), the
 * cruise-speed reference line, and the underlying formula + thickness k.
 *
 * The curve updates live as `smoothing` changes.
 */
export default function VelocityProfileChart({ smoothing, width = 320, height = 180 }) {
  const k = thicknessFromSmoothing(smoothing);

  const { eased, cruise } = React.useMemo(() => {
    const samples = sampleProfile(k, { v0: 0, v1: 0, nSamples: 120 });
    return {
      eased: samples.map((p) => ({ x: p.t, y: p.v })),
      cruise: [
        { x: 0, y: 1 },
        { x: 1, y: 1 },
      ],
    };
  }, [k]);

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
          시작 = 지수(exp) ease-in · 도달 = 로그(log) ease-out
        </div>
        <div
          style={{
            fontFamily: 'monospace',
            fontSize: 10,
            color: 'rgba(255,255,255,0.55)',
            marginTop: 2,
          }}
        >
          v(τ)=v₀(1−τ)+v₁τ+C·B(τ;k)
          <br />
          E(u)=(e^(k·u)−1)/(e^k−1), L(u)=ln(1+(e^k−1)u)/k
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
          두께 k = {k.toFixed(3)} / {MAX_THICKNESS.toFixed(1)}
        </span>
        <span>피크 = 2.0 × 평균</span>
      </div>
    </div>
  );
}

VelocityProfileChart.propTypes = {
  smoothing: PropTypes.number.isRequired,
  width: PropTypes.number,
  height: PropTypes.number,
};
