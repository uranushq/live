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
  RAMP_SHAPE_LABELS,
  profileFromSmoothing,
  profilePeakFactor,
  sampleProfileCurve,
  speedProfile,
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

/** |dv/dτ| at the arrival knot of the normalized (v_avg = 1) profile.
 *
 * This is the number that drives vertical overshoot: the firmware gets no
 * acceleration feed-forward, so whatever deceleration the profile demands at
 * the moment of arrival is exactly what the vehicle's tracking lag turns into
 * residual velocity past the target. Lower is calmer.
 */
const arrivalDeceleration = (profile) => {
  if (profile.isConstant) return 0;
  const { speed } = speedProfile(0, 0, 1, 1, profile);
  const h = 1e-6;
  return Math.abs((speed(1) - speed(1 - h)) / h);
};

/**
 * Interactive plot of the trapezoid velocity profile: accel ramp → CONSTANT
 * plateau → decel ramp. Pass a `profile` object (from `makeProfile` /
 * `getVelocityProfile`); the legacy `smoothing` + `kExp` / `kLog` props still
 * work and rebuild the historical symmetric shape.
 */
export default function VelocityProfileChart({
  profile,
  smoothing,
  kExp = DEFAULT_PROFILE_EXP,
  kLog = DEFAULT_PROFILE_LOG,
  width = 320,
  height = 180,
}) {
  const shape = React.useMemo(
    () =>
      profile ??
      profileFromSmoothing(smoothing, { accelCurve: kExp, decelCurve: kLog }),
    [profile, smoothing, kExp, kLog]
  );

  const { eased, cruise, boundaries } = React.useMemo(() => {
    const samples = sampleProfileCurve(shape, { v0: 0, v1: 0, nSamples: 140 });
    const top = 2.4;
    const marks = [];
    // Region boundaries: where the accel ramp ends and the decel ramp begins.
    if (shape.accelWidth > 0 && shape.accelWidth < 1) {
      marks.push(shape.accelWidth);
    }
    if (shape.decelWidth > 0 && 1 - shape.decelWidth > 0) {
      const t = 1 - shape.decelWidth;
      if (!marks.some((m) => Math.abs(m - t) < 1e-9)) marks.push(t);
    }
    return {
      eased: samples.map((p) => ({ x: p.t, y: p.v })),
      cruise: [
        { x: 0, y: 1 },
        { x: 1, y: 1 },
      ],
      boundaries: marks.map((t) => [
        { x: t, y: 0 },
        { x: t, y: top },
      ]),
    };
  }, [shape]);

  const factor = profilePeakFactor(shape);
  const arrival = arrivalDeceleration(shape);

  const data = {
    datasets: [
      ...boundaries.map((seg) => ({
        label: '구간 경계',
        data: seg,
        borderColor: 'rgba(255,255,255,0.18)',
        borderWidth: 1,
        pointRadius: 0,
        fill: false,
      })),
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
        filter: (item) => item.dataset.label !== '구간 경계',
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
        title: {
          display: true,
          text: '정규화 시간 τ',
          color: 'rgba(255,255,255,0.5)',
        },
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
        title: {
          display: true,
          text: '속도 ÷ 평균',
          color: 'rgba(255,255,255,0.5)',
        },
        ticks: { color: 'rgba(255,255,255,0.45)', maxTicksLimit: 5 },
        grid: { color: 'rgba(255,255,255,0.06)' },
      },
    },
  };

  const pct = (v) => `${(v * 100).toFixed(0)}%`;
  const shapeName = (s) => RAMP_SHAPE_LABELS[s] ?? s;

  return (
    <div style={{ width, color: 'rgba(255,255,255,0.85)' }}>
      <div style={{ fontSize: 11, marginBottom: 6, lineHeight: 1.5 }}>
        <div style={{ fontWeight: 600, marginBottom: 2 }}>관성 속도 프로파일</div>
        <div style={{ color: 'rgba(255,255,255,0.6)' }}>
          {shape.isConstant ? (
            '등속 (램프 없음)'
          ) : (
            <>
              {shapeName(shape.accelShape)} 가속 {pct(shape.accelWidth)} → 등속{' '}
              {pct(shape.plateauWidth)} → {shapeName(shape.decelShape)} 감속{' '}
              {pct(shape.decelWidth)}
            </>
          )}
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
          gap: 8,
        }}
      >
        <span>
          k 가속 {Number(shape.accelCurve).toFixed(2)} · 감속{' '}
          {Number(shape.decelCurve).toFixed(2)}
        </span>
        <span>등속 구간 = {factor.toFixed(2)} × 평균</span>
      </div>
      <div
        style={{
          fontSize: 10,
          marginTop: 2,
          color: arrival > 2 ? '#ffb26b' : 'rgba(255,255,255,0.5)',
        }}
        title={
          '도착 순간에 요구되는 감속의 크기 (평균속도=1, 구간시간=1 기준). ' +
          '펌웨어에 가속도 피드포워드가 없어서 이 값이 클수록 추종 지연이 ' +
          '잔류 속도로 남아 오버슛이 커집니다. 감속 램프를 exp로 두거나 ' +
          '곡률을 낮추면 줄어듭니다.'
        }
      >
        도착 감속 {arrival.toFixed(2)}
        {arrival > 2 ? ' ⚠ 오버슛 주의' : ''}
      </div>
    </div>
  );
}

VelocityProfileChart.propTypes = {
  profile: PropTypes.object,
  smoothing: PropTypes.number,
  kExp: PropTypes.number,
  kLog: PropTypes.number,
  width: PropTypes.number,
  height: PropTypes.number,
};
