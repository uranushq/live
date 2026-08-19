import PropTypes from 'prop-types';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import ReactDOM from 'react-dom';

import {
  extractDots,
  layoutDotsInVolume,
  layoutDotsOnPlane,
  sampleDepths,
  suggestPlaneWidth,
} from './utils/imageToDots';
import {
  assignPlanePointsToDrones,
  orientationOf,
  PLANE_ORIENTATIONS,
  verticalSeparationFor,
} from './utils/imagePlane';
import {
  kmeans3D,
  layoutModelDots,
  loadModelPoints,
  suggestModelWidth,
} from './utils/modelToDots';

// 처리용 다운스케일 상한 (긴 변 기준 px). 클수록 정확·느림.
const PROCESS_MAX_DIM = 128;

/** 그리드(21000)·FormationBuilder(22000) 등 다른 모달보다 위에 뜬다. */
const MODAL_Z_INDEX = 23000;

const MODE_OPTIONS = [
  { value: 'auto', label: '자동 (배경 감지)' },
  { value: 'dark', label: '어두운 부분이 피사체' },
  { value: 'bright', label: '밝은 부분이 피사체' },
];

const PLACEMENT_OPTIONS = [
  { value: 'plane', label: '평면 (정면 2D)' },
  { value: 'relief', label: '3D 릴리프 (깊이 포함)' },
];

const DEPTH_SOURCE_OPTIONS = [
  { value: 'bright', label: '밝을수록 앞으로' },
  { value: 'dark', label: '어두울수록 앞으로' },
  { value: 'bulge', label: '중심 볼록 (반구형)' },
];

const fieldStyle = {
  width: '100%',
  background: '#111216',
  border: '1px solid #2c2e36',
  borderRadius: 7,
  color: '#e8e9ec',
  fontSize: 12.5,
  padding: '7px 9px',
};

/**
 * 이미지 → 점 formation 생성 모달.
 *
 * 이미지를 올리면 드론 수만큼의 대표 점을 추출해 미리보기로 보여주고,
 * 확인 시 정면 수직 평면(y=좌우, z=상하, x=고정) phase를 추가한다.
 */
export default function ImageToDotsModal({
  open,
  droneIds = [],
  /**
   * droneIds와 같은 순서의 {x, y, z} 배열 — 각 드론이 이 phase를 시작할 때
   * 있는 위치. 주면 제곱 거리 최소 배정으로 짝지어 경로 교차를 없앤다
   * (경로 계획기 교착의 주원인). 없으면 기존 번호순 배정으로 떨어진다.
   */
  droneOrigins = null,
  minSeparation = 1.45,
  suggestedPlaneX = 0,
  /**
   * 'phase' — 확인하면 새 formation phase를 만든다 (기본).
   * 'place' — 계산한 좌표만 `onPlacePoints`로 넘긴다. 그리드로 Phase 추가
   *           화면에서 같은 기능을 그대로 쓰기 위한 모드로, phase를 새로
   *           만들지 않고 지금 편집 중인 배치에 얹는다.
   */
  mode: usage = 'phase',
  onCreatePhase = () => {},
  onPlacePoints = () => {},
  onClose = () => {},
}) {
  // 입력 소스: 이미지 스티플링 vs 생성형 AI 등으로 만든 3D 모델 파일
  const [source, setSource] = useState('image'); // 'image' | 'model'
  const [modelInfo, setModelInfo] = useState(null); // {points: Float32Array, name}
  const [imageInfo, setImageInfo] = useState(null); // {image, aspect, name}
  const [mode, setMode] = useState('auto');
  const [placement, setPlacement] = useState('plane');
  const [depthSource, setDepthSource] = useState('bright');
  const [depthM, setDepthM] = useState('8');
  const [widthM, setWidthM] = useState('20');
  const [bottomZ, setBottomZ] = useState('5');
  /** 평면 방향 — 어느 축을 법선으로 쓰는 벽/바닥에 그림을 걸지 */
  const [orientationKey, setOrientationKey] = useState('x');
  /** 법선 축 위의 평면 위치 (기존 "평면 x 위치"의 일반화) */
  const [planeOffset, setPlaneOffset] = useState('0');
  /** 평면 안에서 그림을 가로로 밀어 주는 양 */
  const [planeShift, setPlaneShift] = useState('0');
  // 점 간 여유 계수: 최소 간격 × 이 배수만큼 넉넉하게 펼친다. 꽉 붙은
  // (1.0×) 배치는 진입 계획이 매우 어려워 교착되기 쉽다 — 1.3~1.6 권장.
  const [spacingFactor, setSpacingFactor] = useState('1.4');
  const [status, setStatus] = useState('');
  const [layout, setLayout] = useState(null); // {points, widthM, heightM, scaledUp}
  const previewRef = useRef(null);
  const imgElRef = useRef(null);

  const droneCount = droneIds.length;

  // 모달을 열 때마다 평면 x를 "대형 앞쪽" 제안값으로 초기화한다. 그림
  // 평면이 이륙 지역을 관통하면 절반의 드론이 차오르는 벽을 가로질러야
  // 해서 진입 계획이 교착되기 쉽다 — 전원이 정면에서 진입하도록 대형
  // 바깥에 세우는 것이 안전하다.
  useEffect(() => {
    if (open) {
      setPlaneOffset(String(Math.round(suggestedPlaneX * 10) / 10));
      setPlaneShift('0');
    }
  }, [open, suggestedPlaneX]);

  const orientation = orientationOf(orientationKey);
  const verticalSeparation = verticalSeparationFor(orientation);

  // 바닥 평면에는 릴리프(깊이)가 의미 없다 — 벽으로 돌아오기 전까지는 평면 배치.
  useEffect(() => {
    if (!orientation.verticalIsAltitude) setPlacement('plane');
  }, [orientation]);

  // 펼침 크기 자동 제안: 드론 수 × 축별 최소 간격이 이미지/모델의 내용
  // 점유율 안에 여유 있게 들어가는 폭을 역산해 채운다 (수동 수정 가능).
  // 고정 20 m 같은 임의 크기에서 시작해 사후 확대에 기대는 대신, 처음부터
  // 드론 수에 맞는 크기로 펼친다.
  useEffect(() => {
    if (!open || droneCount === 0) return;
    const factor = Math.max(1, Number(spacingFactor) || 1.4);
    let w = null;
    if (source === 'image' && imageInfo) {
      w = suggestPlaneWidth(imageInfo.image, droneCount, {
        imageAspect: imageInfo.aspect,
        minSeparation,
        spacingFactor: factor,
        mode,
      });
    } else if (source === 'model' && modelInfo) {
      w = suggestModelWidth(modelInfo.points, droneCount, {
        minSeparation,
        spacingFactor: factor,
      });
    }
    if (w != null && Number.isFinite(w)) {
      setWidthM(String(Math.round(w * 10) / 10));
    }
  }, [
    open,
    source,
    imageInfo,
    modelInfo,
    droneCount,
    mode,
    minSeparation,
    spacingFactor,
  ]);

  const handleFile = useCallback((event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(
        1,
        PROCESS_MAX_DIM / Math.max(img.width, img.height)
      );
      const w = Math.max(2, Math.round(img.width * scale));
      const h = Math.max(2, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h);
      imgElRef.current = img;
      setImageInfo({
        image: { data: data.data, width: w, height: h },
        aspect: img.width / img.height,
        name: file.name,
      });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setStatus('이미지를 읽을 수 없습니다.');
    };
    img.src = url;
  }, []);

  const handleModelFile = useCallback(async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setStatus('3D 모델 표면 샘플링 중...');
    try {
      const points = await loadModelPoints(file);
      setModelInfo({ points, name: file.name });
    } catch (error) {
      setModelInfo(null);
      setStatus(`모델을 읽을 수 없습니다: ${error?.message || error}`);
    }
  }, []);

  // 추출 + 배치 (소스/옵션이 바뀔 때마다)
  useEffect(() => {
    if (!open || droneCount === 0) {
      setLayout(null);
      return;
    }

    // ── 3D 모델 소스: 점군 → 3D k-means → 쇼 좌표 배치 ────────────────
    if (source === 'model') {
      if (!modelInfo) {
        setLayout(null);
        return;
      }
      setStatus('대표 점 계산 중...');
      const timer = setTimeout(() => {
        try {
          const modelDots = kmeans3D(modelInfo.points, droneCount);
          // planeX는 0으로 둔다 — 평면 위치·방향은 로컬 좌표를 월드로 돌릴
          // 때(localToWorld) 한 번에 적용한다.
          const laidOut = layoutModelDots(modelDots, {
            widthM: Math.max(2, Number(widthM) || 20),
            bottomZ: Math.max(0, Number(bottomZ) || 0),
            planeX: 0,
            minSeparation,
            spacingFactor: Math.max(1, Number(spacingFactor) || 1.4),
            verticalSeparation,
          });
          setLayout(laidOut);
          setStatus(
            `점 ${laidOut.points.length}개 · 실제 크기 약 ` +
              `${laidOut.widthM.toFixed(1)} × ${laidOut.heightM.toFixed(1)} m` +
              ` · 깊이 ${laidOut.depthSpanM.toFixed(1)} m` +
              (laidOut.scaledUp
                ? ' · 최소 간격 확보를 위해 자동 확대됨'
                : '')
          );
        } catch (error) {
          setStatus(`처리 실패: ${error?.message || error}`);
        }
      }, 30);
      return () => clearTimeout(timer);
    }

    // ── 이미지 소스 ────────────────────────────────────────────────────
    if (!imageInfo) {
      setLayout(null);
      return;
    }
    setStatus('점 추출 중...');
    const timer = setTimeout(() => {
      try {
        const extracted = extractDots(imageInfo.image, droneCount, { mode });
        if (!extracted.length) {
          setLayout(null);
          setStatus(
            '이미지에서 피사체를 찾지 못했습니다. 모드를 바꿔보세요.'
          );
          return;
        }
        const parsedWidth = Math.max(2, Number(widthM) || 20);
        const parsedBottom = Math.max(0, Number(bottomZ) || 0);
        let laidOut;
        let dotDepths = null;
        if (placement === 'relief') {
          const parsedDepth = Math.max(0, Number(depthM) || 0);
          dotDepths = sampleDepths(imageInfo.image, extracted, {
            source: depthSource,
          });
          laidOut = layoutDotsInVolume(extracted, dotDepths, {
            imageAspect: imageInfo.aspect,
            widthM: parsedWidth,
            depthM: parsedDepth,
            bottomZ: parsedBottom,
            planeX: 0,
            minSeparation,
            spacingFactor: Math.max(1, Number(spacingFactor) || 1.4),
            verticalSeparation,
          });
        } else {
          laidOut = layoutDotsOnPlane(extracted, {
            imageAspect: imageInfo.aspect,
            widthM: parsedWidth,
            bottomZ: parsedBottom,
            minSeparation,
            spacingFactor: Math.max(1, Number(spacingFactor) || 1.4),
            verticalSeparation,
          });
        }
        setLayout(laidOut);
        const sizeText =
          placement === 'relief'
            ? `${laidOut.widthM.toFixed(1)} × ${laidOut.heightM.toFixed(1)} m` +
              ` · 깊이 ${laidOut.depthSpanM.toFixed(1)} m`
            : `${laidOut.widthM.toFixed(1)} × ${laidOut.heightM.toFixed(1)} m`;
        setStatus(
          `점 ${extracted.length}개 · 실제 크기 약 ${sizeText}` +
            (laidOut.scaledUp
              ? ' · 최소 간격 확보를 위해 자동 확대됨'
              : '')
        );
      } catch (error) {
        setStatus(`처리 실패: ${error?.message || error}`);
      }
    }, 30);
    return () => clearTimeout(timer);
  }, [
    open,
    source,
    modelInfo,
    imageInfo,
    droneCount,
    mode,
    placement,
    depthSource,
    depthM,
    widthM,
    bottomZ,
    verticalSeparation,
    minSeparation,
    spacingFactor,
  ]);

  /**
   * 2D 평면 미리보기 — 그림이 실제로 걸릴 평면을 미터 격자 위에 그린다.
   *
   * 이미지·3D 모델 어느 쪽이든 배치 결과는 같은 로컬 평면 좌표(y = 가로,
   * z = 세로, x = 법선 방향 깊이)로 나오므로 한 경로로 그린다. 화면은
   * 그림이 바로 보이도록 +y를 왼쪽, +z를 위로 둔다.
   */
  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#101116';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const pts = layout?.points;
    if (!pts || !pts.length) return;

    let loY = Infinity;
    let hiY = -Infinity;
    let loZ = Infinity;
    let hiZ = -Infinity;
    let loX = Infinity;
    let hiX = -Infinity;
    for (const p of pts) {
      if (p.y < loY) loY = p.y;
      if (p.y > hiY) hiY = p.y;
      if (p.z < loZ) loZ = p.z;
      if (p.z > hiZ) hiZ = p.z;
      const d = Number.isFinite(p.x) ? p.x : 0;
      if (d < loX) loX = d;
      if (d > hiX) hiX = d;
    }
    const spanY = Math.max(1e-6, hiY - loY);
    const spanZ = Math.max(1e-6, hiZ - loZ);
    const spanX = Math.max(1e-6, hiX - loX);
    const margin = Math.max(spanY, spanZ) * 0.08;
    const padPx = 14;
    const scale = Math.min(
      (canvas.width - padPx * 2) / (spanY + margin * 2),
      (canvas.height - padPx * 2) / (spanZ + margin * 2)
    );
    const drawW = (spanY + margin * 2) * scale;
    const drawH = (spanZ + margin * 2) * scale;
    const ox = (canvas.width - drawW) / 2;
    const oy = (canvas.height - drawH) / 2;
    // +y는 왼쪽, +z는 위 — 그림이 뒤집히지 않게.
    const sxOf = (y) => ox + (hiY + margin - y) * scale;
    const syOf = (z) => oy + (hiZ + margin - z) * scale;

    // 그림이 놓이는 영역(= 점들의 바운딩 박스)에 원본 이미지를 옅게 깐다.
    if (source === 'image' && imgElRef.current) {
      ctx.globalAlpha = 0.22;
      ctx.drawImage(
        imgElRef.current,
        sxOf(hiY),
        syOf(hiZ),
        spanY * scale,
        spanZ * scale
      );
      ctx.globalAlpha = 1;
    }

    // 미터 격자 — 눈금 간격은 1·2·5·10… 중 화면에 6~12줄이 되는 값
    const rawStep = Math.max(spanY, spanZ) / 8;
    const pow = 10 ** Math.floor(Math.log10(Math.max(rawStep, 1e-6)));
    const step = [1, 2, 5, 10].map((m) => m * pow).find((v) => v >= rawStep) ?? pow * 10;
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    for (let g = Math.ceil((loY - margin) / step) * step; g <= hiY + margin; g += step) {
      ctx.beginPath();
      ctx.moveTo(sxOf(g), oy);
      ctx.lineTo(sxOf(g), oy + drawH);
      ctx.stroke();
    }
    for (let g = Math.ceil((loZ - margin) / step) * step; g <= hiZ + margin; g += step) {
      ctx.beginPath();
      ctx.moveTo(ox, syOf(g));
      ctx.lineTo(ox + drawW, syOf(g));
      ctx.stroke();
    }

    // 평면 테두리
    ctx.strokeStyle = 'rgba(126, 200, 255, 0.3)';
    ctx.strokeRect(sxOf(hiY), syOf(hiZ), spanY * scale, spanZ * scale);

    // 점 — 깊이가 있으면 멀다=파랑 → 가깝다=노랑, 없으면 이미지 색
    const hasDepth = spanX > 1e-3;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      let radius = 3;
      if (hasDepth) {
        const t = (hiX - (Number.isFinite(p.x) ? p.x : 0)) / spanX;
        ctx.fillStyle = `rgb(${Math.round(90 + t * 165)},${Math.round(
          180 + t * 35
        )},${Math.round(255 - t * 165)})`;
        radius = 2.2 + t * 2.3;
      } else {
        const c = p.color;
        ctx.fillStyle = Array.isArray(c)
          ? `rgb(${c[0]},${c[1]},${c[2]})`
          : '#5ad1ff';
      }
      ctx.beginPath();
      ctx.arc(sxOf(p.y), syOf(p.z), radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [source, layout]);

  /** 미리보기 가장자리에 붙일 실제 좌표 범위 (m) */
  const planeExtent = useMemo(() => {
    const pts = layout?.points;
    if (!pts || !pts.length) return null;
    const shift = Number(planeShift) || 0;
    let loY = Infinity;
    let hiY = -Infinity;
    let loZ = Infinity;
    let hiZ = -Infinity;
    for (const p of pts) {
      if (p.y < loY) loY = p.y;
      if (p.y > hiY) hiY = p.y;
      if (p.z < loZ) loZ = p.z;
      if (p.z > hiZ) hiZ = p.z;
    }
    return {
      hAxis: orientation.hAxis.toUpperCase(),
      vAxis: orientation.vAxis.toUpperCase(),
      hLeft: hiY + shift,
      hRight: loY + shift,
      vTop: hiZ,
      vBottom: loZ,
    };
  }, [layout, planeShift, orientation]);


  const handleCreate = useCallback(() => {
    if (!layout || !layout.points.length) return;
    const points = assignPlanePointsToDrones(layout.points, droneIds, orientation, {
      offset: Number(planeOffset) || 0,
      shift: Number(planeShift) || 0,
      origins: droneOrigins,
    });
    const sourceName = source === 'model' ? modelInfo?.name : imageInfo?.name;
    const baseName = sourceName
      ? sourceName.replace(/\.[^.]+$/, '')
      : source === 'model'
        ? 'model'
        : 'image';
    // 'place' 모드에서는 phase를 새로 만들지 않고 좌표만 넘긴다 — 그리드로
    // Phase 추가 화면이 지금 편집 중인 배치에 그대로 얹는다.
    if (usage === 'place') onPlacePoints(points, baseName);
    else onCreatePhase(baseName, points);
    onClose();
  }, [
    layout,
    droneIds,
    droneOrigins,
    orientation,
    planeOffset,
    planeShift,
    source,
    modelInfo,
    imageInfo,
    usage,
    onPlacePoints,
    onCreatePhase,
    onClose,
  ]);

  if (!open) return null;

  // 3D 뷰의 씬 호스트는 `position: relative; z-index: 0`으로 자체 쌓임 문맥을
  // 만든다 — 그 안에서 렌더링하면 z-index를 얼마로 올려도 패널 상단 AppBar나
  // body로 포털된 다른 모달(그리드 21000 등) 아래에 깔린다. body로 내보내
  // 앱 최상위에서 겨루게 한다.
  return ReactDOM.createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: MODAL_Z_INDEX,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.55)',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 560,
          maxWidth: '94vw',
          maxHeight: '90vh',
          overflowY: 'auto',
          background: '#17181d',
          border: '1px solid #2c2e36',
          borderRadius: 12,
          padding: 18,
          color: '#e8e9ec',
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
          {usage === 'place' ? '이미지/3D → 평면 배치' : '이미지/3D → 점 Formation'}
        </div>
        <div style={{ fontSize: 11, color: '#8a8d95', marginBottom: 10 }}>
          {source === 'model'
            ? `생성형 AI 등으로 만든 3D 모델(GLB/GLTF/OBJ)의 표면을 점 ${droneCount}개(드론 수)로 압축합니다.`
            : `이미지의 내용·구조를 대표하는 점 ${droneCount}개(드론 수)를 추출합니다.`}
          {` ${orientation.label}(${orientation.hAxis.toUpperCase()}·${orientation.vAxis.toUpperCase()} 평면)에 걸고, `}
          {usage === 'place'
            ? '지금 편집 중인 배치에 그대로 얹습니다.'
            : '새 formation phase로 추가합니다.'}
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          {[
            { value: 'image', label: '이미지' },
            { value: 'model', label: '3D 모델 (GLB/OBJ)' },
          ].map((o) => (
            <button
              key={o.value}
              type='button'
              onClick={() => setSource(o.value)}
              style={{
                flex: 1,
                padding: '7px 0',
                borderRadius: 8,
                border: `1px solid ${source === o.value ? '#4c8dff' : '#2c2e36'}`,
                background: source === o.value ? '#22304a' : '#1c1e24',
                color: source === o.value ? '#9cc0ff' : '#9a9ca3',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {o.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 260px', minWidth: 240 }}>
            <div
              style={{
                fontSize: 10.5,
                color: '#8a8d95',
                marginBottom: 4,
                display: 'flex',
                justifyContent: 'space-between',
              }}
            >
              <span>2D 평면 · {orientation.label}</span>
              <span>
                {orientation.normal.toUpperCase()}{' '}
                {(Number(planeOffset) || 0).toFixed(1)} m
              </span>
            </div>
            <canvas
              ref={previewRef}
              width={420}
              height={300}
              style={{
                width: '100%',
                borderRadius: 8,
                border: '1px solid #2c2e36',
                background: '#101116',
              }}
            />
            {planeExtent ? (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 10,
                  color: '#7d818b',
                  marginTop: 3,
                }}
              >
                <span>
                  {planeExtent.hAxis} {planeExtent.hLeft.toFixed(1)} m
                </span>
                <span>
                  {planeExtent.vAxis} {planeExtent.vBottom.toFixed(1)} ~{' '}
                  {planeExtent.vTop.toFixed(1)} m
                </span>
                <span>
                  {planeExtent.hAxis} {planeExtent.hRight.toFixed(1)} m
                </span>
              </div>
            ) : null}
            <label
              style={{
                display: 'block',
                marginTop: 8,
                padding: '8px 10px',
                textAlign: 'center',
                borderRadius: 8,
                border: '1px solid #2c2e36',
                background: '#22304a',
                color: '#9cc0ff',
                fontSize: 12.5,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {source === 'model'
                ? `3D 모델 선택 ${modelInfo ? `(${modelInfo.name})` : ''}`
                : `이미지 선택 ${imageInfo ? `(${imageInfo.name})` : ''}`}
              {source === 'model' ? (
                <input
                  hidden
                  type='file'
                  accept='.glb,.gltf,.obj'
                  onChange={handleModelFile}
                />
              ) : (
                <input
                  hidden
                  type='file'
                  accept='image/*'
                  onChange={handleFile}
                />
              )}
            </label>
          </div>

          <div
            style={{
              flex: '1 1 160px',
              minWidth: 160,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div>
              <div style={{ fontSize: 10.5, color: '#8a8d95', marginBottom: 3 }}>
                평면 방향
              </div>
              <select
                value={orientationKey}
                onChange={(e) => setOrientationKey(e.target.value)}
                title={orientation.hint}
                style={fieldStyle}
              >
                {PLANE_ORIENTATIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label} · {o.hAxis.toUpperCase()}·{o.vAxis.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>
            {source === 'image' ? (
              <div>
                <div
                  style={{ fontSize: 10.5, color: '#8a8d95', marginBottom: 3 }}
                >
                  피사체 모드
                </div>
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value)}
                  style={fieldStyle}
                >
                  {MODE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {source === 'image' && orientation.verticalIsAltitude ? (
              <div>
                <div
                  style={{ fontSize: 10.5, color: '#8a8d95', marginBottom: 3 }}
                >
                  배치
                </div>
                <select
                  value={placement}
                  onChange={(e) => setPlacement(e.target.value)}
                  style={fieldStyle}
                >
                  {PLACEMENT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {source === 'image' && placement === 'relief' ? (
              <>
                <div>
                  <div
                    style={{ fontSize: 10.5, color: '#8a8d95', marginBottom: 3 }}
                  >
                    깊이 소스
                  </div>
                  <select
                    value={depthSource}
                    onChange={(e) => setDepthSource(e.target.value)}
                    style={fieldStyle}
                  >
                    {DEPTH_SOURCE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div
                    style={{ fontSize: 10.5, color: '#8a8d95', marginBottom: 3 }}
                  >
                    깊이 범위 (m)
                  </div>
                  <input
                    value={depthM}
                    onChange={(e) => setDepthM(e.target.value)}
                    inputMode='decimal'
                    style={fieldStyle}
                  />
                </div>
              </>
            ) : null}
            <div>
              <div style={{ fontSize: 10.5, color: '#8a8d95', marginBottom: 3 }}>
                가로 폭 (m, 자동 제안)
              </div>
              <input
                value={widthM}
                onChange={(e) => setWidthM(e.target.value)}
                inputMode='decimal'
                title='드론 수 × 축별 최소 간격이 이미지 내용 안에 여유 있게 들어가는 폭을 자동으로 채웁니다. 수동으로 수정해도 되고, 너무 좁으면 배치 단계에서 다시 확대됩니다.'
                style={fieldStyle}
              />
            </div>
            <div>
              <div style={{ fontSize: 10.5, color: '#8a8d95', marginBottom: 3 }}>
                {orientation.baseLabel}
              </div>
              <input
                value={bottomZ}
                onChange={(e) => setBottomZ(e.target.value)}
                inputMode='decimal'
                title='그림의 아래쪽 변이 놓일 위치. 벽면에서는 최저 고도, 바닥 평면에서는 남쪽 끝이 됩니다.'
                style={fieldStyle}
              />
            </div>
            <div>
              <div style={{ fontSize: 10.5, color: '#8a8d95', marginBottom: 3 }}>
                {orientation.offsetLabel}
              </div>
              <input
                value={planeOffset}
                onChange={(e) => setPlaneOffset(e.target.value)}
                inputMode='decimal'
                title={
                  '그림/모델이 놓일 평면의 위치. 기본값은 현재 대형의 북쪽(앞) — ' +
                  '평면이 이륙 지역을 관통하면 드론들이 차오르는 벽을 ' +
                  '가로질러야 해서 계획이 교착되기 쉽습니다.'
                }
                style={fieldStyle}
              />
            </div>
            <div>
              <div style={{ fontSize: 10.5, color: '#8a8d95', marginBottom: 3 }}>
                {orientation.shiftLabel}
              </div>
              <input
                value={planeShift}
                onChange={(e) => setPlaneShift(e.target.value)}
                inputMode='decimal'
                title='평면 안에서 그림을 가로로 밀어 줍니다. 0이면 축 원점을 가운데로 놓습니다.'
                style={fieldStyle}
              />
            </div>
            <div>
              <div style={{ fontSize: 10.5, color: '#8a8d95', marginBottom: 3 }}>
                점 간 여유 (배, ≥1.0)
              </div>
              <input
                value={spacingFactor}
                onChange={(e) => setSpacingFactor(e.target.value)}
                inputMode='decimal'
                title='최소 간격에 곱해지는 배수. 1.0이면 꽉 붙어 진입 계획이 교착되기 쉽고, 1.3~1.6이면 여유롭게 펼쳐져 계획이 잘 풀립니다.'
                style={fieldStyle}
              />
            </div>
            <div style={{ fontSize: 10.5, color: '#8a8d95', lineHeight: 1.5 }}>
              최소 간격 {Math.max(1.45, minSeparation).toFixed(2)} m 자동 적용
              — 점이 겹치면 밀어내고, 부족하면 전체를 확대합니다. 상하
              간격은 다운워시 회피를 위해 최소 2.6 m로 자동 확대됩니다.
            </div>
          </div>
        </div>

        <div
          style={{
            marginTop: 10,
            fontSize: 11.5,
            color: '#b9bbc2',
            minHeight: 18,
          }}
        >
          {status}
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            marginTop: 12,
          }}
        >
          <button
            type='button'
            onClick={onClose}
            style={{
              padding: '8px 14px',
              borderRadius: 8,
              border: '1px solid #2c2e36',
              background: '#1c1e24',
              color: '#9a9ca3',
              fontSize: 12.5,
              cursor: 'pointer',
            }}
          >
            취소
          </button>
          <button
            type='button'
            onClick={handleCreate}
            disabled={!layout || !layout.points.length}
            style={{
              padding: '8px 14px',
              borderRadius: 8,
              border: '1px solid #2c2e36',
              background:
                layout && layout.points.length ? '#2c66d9' : '#1c1e24',
              color: layout && layout.points.length ? '#fff' : '#6f727b',
              fontSize: 12.5,
              fontWeight: 700,
              cursor: layout && layout.points.length ? 'pointer' : 'default',
            }}
          >
            {usage === 'place' ? '이 평면에 배치' : 'Phase로 추가'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

ImageToDotsModal.propTypes = {
  open: PropTypes.bool,
  droneIds: PropTypes.arrayOf(PropTypes.string),
  droneOrigins: PropTypes.arrayOf(
    PropTypes.shape({ x: PropTypes.number, y: PropTypes.number, z: PropTypes.number })
  ),
  minSeparation: PropTypes.number,
  suggestedPlaneX: PropTypes.number,
  mode: PropTypes.oneOf(['phase', 'place']),
  onCreatePhase: PropTypes.func,
  onPlacePoints: PropTypes.func,
  onClose: PropTypes.func,
};
