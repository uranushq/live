/**
 * @file 경로 계획 서버 응답 → 운용자가 읽을 수 있는 진단.
 *
 * 서버는 실패할 때 `{error, code?, details?, validation?}` 형태로 답한다.
 * 예전 프론트 코드는 이 구조를 `JSON.stringify`로 뭉개서 한 덩어리 문자열로
 * 만들어 회색 글씨로 뿌렸다 — 원인도, 무엇을 고쳐야 하는지도 알 수 없었다.
 * 여기서는 `code`를 키로 삼아 **무엇이 왜 막혔고 어떤 값을 손봐야 하는지**로
 * 번역한다. 메시지 문자열 매칭에 기대지 않으므로 서버 문구가 바뀌어도 버티고,
 * 모르는 코드가 와도 원문을 그대로 보여 주며 무너지지 않는다.
 */

/** 심각도 — 화면 색과 아이콘을 고른다. */
export const SEVERITY = {
  ERROR: 'error',
  WARNING: 'warning',
};

const num = (v, digits = 2) =>
  Number.isFinite(Number(v)) ? Number(v).toFixed(digits).replace(/\.?0+$/, '') : null;

const droneList = (ids, limit = 12) => {
  if (!Array.isArray(ids) || !ids.length) return null;
  const shown = ids.slice(0, limit).join(', ');
  return ids.length > limit ? `${shown} 외 ${ids.length - limit}대` : shown;
};

/**
 * 계획 교착(PLANNING_FAILED)의 원인 문자열을 세부 유형으로 나눈다.
 * 서버의 `details.reason`은 솔버가 만든 영어 문장이라, 여기서 운용 언어로
 * 옮기고 "그래서 무엇을 바꿔야 하는가"를 붙인다.
 */
const describePlanningFailure = (details = {}) => {
  const reason = String(details.reason || '');
  const segment = details.segment ? String(details.segment) : null;
  const stuck = Array.isArray(details.stuckDrones)
    ? details.stuckDrones
    : details.stuck_drones;
  const steps = details.steps_completed ?? details.stepsCompleted;
  const stuckCount = Array.isArray(stuck) ? stuck.length : 0;

  const facts = [];
  if (segment) facts.push({ label: '막힌 구간', value: segment });
  if (Number.isFinite(Number(steps))) {
    facts.push({ label: '진행한 스텝', value: `${steps}` });
  }
  if (stuckCount) {
    facts.push({
      label: `못 간 드론 (${stuckCount}대)`,
      value: droneList(stuck),
    });
  }

  const isReturn = segment === 'return-to-start';
  const deadlocked = /deadlock/i.test(reason);

  if (deadlocked) {
    return {
      title: '경로 계획 교착',
      summary:
        stuckCount === 1
          ? `${droneList(stuck)} 한 대가 목표까지 갈 길을 찾지 못했습니다.`
          : `드론 ${stuckCount}대가 목표까지 갈 길을 찾지 못했습니다.`,
      facts,
      why:
        '먼저 도착한 드론들이 자리를 잡으면 그 사이를 지나갈 통로가 사라집니다. ' +
        '두 드론 사이로 지나가려면 그 둘이 최소 간격의 2배만큼 떨어져 있어야 하는데, ' +
        'formation이 그보다 촘촘하면 남은 드론이 갇힙니다.',
      remedies: isReturn
        ? [
            '착륙 그리드를 켜고 간격을 최소 간격의 1.5배 이상으로 두세요 (복귀 지점이 이륙 격자만큼 촘촘하면 내려앉을 자리가 없습니다).',
            '이륙 격자 자체를 넓히세요 — 격자 간격이 최소 간격과 같으면 여유가 0입니다.',
          ]
        : [
            '이미지 → 평면의 “점 간 여유”를 올려 formation을 넓히세요. 통로가 생기려면 점 사이가 최소 간격의 2배를 넉넉히 넘어야 합니다.',
            '드론이 몰리는 phase를 둘로 쪼개 한 번에 움직이는 대수를 줄이세요.',
            '이 phase의 드론 배치를 바꿔 이동 경로가 서로 교차하지 않게 하세요.',
          ],
    };
  }

  return {
    title: '경로 계획 실패',
    summary: reason || '솔버가 이 구간을 풀지 못했습니다.',
    facts,
    why: null,
    remedies: [
      'formation 간격을 넓히거나 phase를 나눠 한 번에 움직이는 드론 수를 줄여 보세요.',
    ],
  };
};

/**
 * 코드별 번역기. 각 항목은 `(payload) => {title, summary, facts, why, remedies}`.
 * 서버 소스의 실제 응답 모양에 맞춰 details를 읽는다.
 */
const CODE_HANDLERS = {
  FORMATION_SPACING_TOO_CLOSE: ({ details = {} }) => {
    const required = num(details.required_separation);
    const hard = num(details.hard_min_separation);
    const violations = Array.isArray(details.violations) ? details.violations : [];
    return {
      title: 'formation 점 간격이 최소 간격보다 좁음',
      summary: `같은 phase 안에서 너무 가까운 점이 ${violations.length}쌍 있습니다.`,
      facts: [
        required && { label: '요구 최소 간격', value: `${required} m` },
        hard && { label: '하드 하한', value: `${hard} m` },
        violations.length && {
          label: '위반 쌍',
          value: violations
            .slice(0, 6)
            .map((v) =>
              v && typeof v === 'object'
                ? Object.entries(v)
                    .map(([k, val]) => `${k}=${typeof val === 'number' ? num(val) : val}`)
                    .join(' ')
                : String(v)
            )
            .join(' / '),
        },
      ].filter(Boolean),
      why:
        '계획을 시작하기도 전에 걸린 것으로, 목표 formation 자체가 최소 간격을 어깁니다.',
      remedies: [
        '이미지 → 평면의 “점 간 여유” 배수를 올리거나 가로 폭을 키우세요.',
        '설정의 최소 간격을 낮출 수 있는지 확인하세요 (하드 하한 아래로는 불가).',
      ],
    };
  },

  BELOW_ALTITUDE_FLOOR: ({ details = {} }) => {
    const floor = num(details.min_z);
    const violations = Array.isArray(details.violations) ? details.violations : [];
    return {
      title: '고도 하한 미만인 웨이포인트',
      summary: `${violations.length}개 지점이 계획 고도 하한 아래에 있습니다.`,
      facts: [
        floor && { label: '고도 하한', value: `${floor} m` },
        violations.length && {
          label: '해당 지점',
          value: violations
            .slice(0, 8)
            .map((v) => (v?.label ? `${v.label} z=${num(v.z)}` : JSON.stringify(v)))
            .join(', '),
        },
      ].filter(Boolean),
      why: '기체 파라미터에서 온 최소 비행 고도보다 낮은 좌표는 계획할 수 없습니다.',
      remedies: [
        '이미지 → 평면의 “하단 고도”를 고도 하한 이상으로 올리세요.',
        '바닥 평면을 쓴다면 “평면 고도”를 올리세요.',
      ],
    };
  },

  SEPARATION_BELOW_HARD_FLOOR: (payload) => ({
    title: '최소 간격이 하드 하한보다 낮음',
    summary: payload.message,
    facts: [
      payload.raw?.hard_min_separation && {
        label: '하드 하한',
        value: `${num(payload.raw.hard_min_separation)} m`,
      },
    ].filter(Boolean),
    why: '운용 안전상 이 값 아래로는 내릴 수 없습니다.',
    remedies: ['설정의 최소 간격을 하드 하한 이상으로 되돌리세요.'],
  }),

  PLANNING_FAILED: ({ details }) => describePlanningFailure(details || {}),

  CRUISE_SPEED_TOO_SLOW_FOR_DOWNWASH: ({ details = {} }) => {
    const stepSec = Number(details.step_duration_ms) / 1000;
    const budgetSec = Number(details.downwash_exposure_ms) / 1000;
    const needed = details.required_cruise_speed;
    return {
      title: '순항 속도가 느려 다운워시 통과가 막힘',
      summary:
        `스텝 하나가 ${num(stepSec)}초라, 다른 드론 아래를 지나갈 수 있는 ` +
        `${num(budgetSec)}초 예산을 한 걸음도 쓰지 못합니다.`,
      facts: [
        { label: '스텝 하나', value: `${num(stepSec)} 초` },
        { label: '다운워시 예산', value: `${num(budgetSec)} 초` },
        details.step_size != null && {
          label: 'step size',
          value: `${num(details.step_size)} m`,
        },
        needed != null && {
          label: '필요 순항 속도',
          value: `${num(needed)} m/s 이상`,
        },
      ].filter(Boolean),
      why:
        '스텝 하나에 걸리는 시간은 step size ÷ 순항 속도입니다. 천천히 날수록 ' +
        '남의 로터 아래에 오래 머물게 되므로, 느린 쇼에서는 통과가 아예 금지됩니다.',
      remedies: [
        needed != null
          ? `순항 속도를 ${num(needed)} m/s 이상으로 올리세요.`
          : '순항 속도를 올리세요.',
        'step size를 줄여도 스텝 하나의 시간이 짧아집니다.',
        '속도를 유지해야 한다면 formation 간격을 넓혀 통과 자체가 필요 없게 만드세요.',
      ],
    };
  },

  FIXED_PATH_CONFLICT: ({ details = {} }) => {
    const conflicts = Array.isArray(details.fixed_conflicts)
      ? details.fixed_conflicts
      : [];
    return {
      title: '고정 직선 경로 충돌',
      summary: `손으로 고정한 직선 경로 ${conflicts.length}건이 다른 드론과 부딪힙니다.`,
      facts: conflicts.slice(0, 6).map((c) => ({
        label: c.drone,
        value: `막는 드론 ${[...(c.blockedBy || []), ...(c.blockedByFixed || [])].join(', ')}`,
      })),
      why:
        '고정 경로는 회피 없이 그대로 날아가므로, 경로가 겹치면 솔버가 피해 줄 방법이 없습니다.',
      remedies: [
        '충돌하는 드론의 “직선 고정”을 해제해 자동 회피를 맡기세요.',
        '두 드론이 같은 구간을 동시에 지나지 않도록 phase를 나누세요.',
      ],
    };
  },

  VERIFICATION_FAILED: ({ details = {} }) => {
    const violations = Array.isArray(details.violations) ? details.violations : [];
    return {
      title: '생성된 쇼 검증 실패',
      summary: `계획은 끝났지만 최종 궤적에서 충돌 반경 위반이 ${violations.length}건 발견됐습니다.`,
      facts: violations.slice(0, 6).map((v, i) => ({
        label: `위반 ${i + 1}`,
        value:
          v && typeof v === 'object'
            ? Object.entries(v)
                .map(([k, val]) => `${k}=${typeof val === 'number' ? num(val) : val}`)
                .join(' ')
            : String(v),
      })),
      why:
        '속도 스무딩이나 보간 과정에서 계획 격자 사이를 지나며 간격이 좁아졌을 수 있습니다.',
      remedies: [
        '속도 스무딩을 낮추거나 끄고 다시 시도하세요.',
        'formation 간격을 넓혀 여유를 만드세요.',
      ],
    };
  },

  TRAJECTORY_LIMIT_EXCEEDED: (payload) => ({
    title: '궤적 한계 초과',
    summary: payload.message,
    facts: [],
    why: '생성된 궤적이 기체/포맷이 허용하는 세그먼트 한계를 넘었습니다.',
    remedies: [
      'phase 수나 hold 시간을 줄여 전체 길이를 짧게 만드세요.',
      'step size를 키워 웨이포인트 밀도를 낮추세요.',
    ],
  }),

  VALIDATION_FAILED: ({ validation }) => {
    const issues = Array.isArray(validation?.issues) ? validation.issues : [];
    const blocking = issues.filter((i) => (i.severity || 'error') === 'error');
    return {
      title: '사전 검증 실패',
      summary: `기체 파라미터 검증에서 차단 항목 ${blocking.length}건이 나왔습니다.`,
      facts: [],
      why: '실제 기체 설정과 맞지 않는 계획은 업로드해도 그대로 날지 않습니다.',
      remedies: ['아래 검증 항목을 해소한 뒤 다시 시도하세요.'],
    };
  },
};

/** HTTP 상태만으로 판단해야 할 때의 큰 분류. */
const statusFallback = (status, message) => {
  if (status === 400) {
    return {
      title: '요청 형식 오류',
      summary: message || '서버가 요청을 해석하지 못했습니다.',
      facts: [],
      why:
        '보낸 payload의 구조가 서버 기대와 다릅니다. 대개 드론 수가 phase마다 다르거나, ' +
        '좌표에 숫자가 아닌 값이 들어간 경우입니다.',
      remedies: [
        '모든 phase가 같은 드론 수를 갖는지 확인하세요.',
        '좌표·yaw 입력란에 빈 값이나 문자가 남아 있지 않은지 확인하세요.',
      ],
    };
  }
  if (status === 404) {
    return {
      title: '경로 계획 서버를 찾을 수 없음',
      summary: message || '엔드포인트가 응답하지 않습니다.',
      facts: [],
      why: 'path-planner 확장이 꺼져 있거나 서버가 다른 포트에서 돌고 있습니다.',
      remedies: ['skybrushd가 떠 있는지, 프록시 대상 포트가 맞는지 확인하세요.'],
    };
  }
  if (status >= 500) {
    return {
      title: '서버 내부 오류',
      summary: message || `서버가 ${status}로 응답했습니다.`,
      facts: [],
      why: '서버 쪽에서 처리되지 않은 예외가 발생했습니다.',
      remedies: [
        '서버 로그를 확인하세요.',
        '최근에 git pull을 했다면 서버를 재시작했는지 확인하세요 (구버전 코드가 메모리에 남아 있을 수 있습니다).',
      ],
    };
  }
  return {
    title: '경로 계획 실패',
    summary: message || `서버가 ${status}로 응답했습니다.`,
    facts: [],
    why: null,
    remedies: [],
  };
};

/**
 * 서버 응답 본문(+상태)을 화면에 그릴 수 있는 진단 객체로 바꾼다.
 *
 * @param status  HTTP 상태 코드 (네트워크 자체가 실패했으면 0)
 * @param body    파싱된 JSON 본문, 또는 파싱 실패 시 원문 문자열
 * @returns {{severity, code, title, summary, facts, why, remedies, issues, rawText}}
 */
export function describePlanFailure(status, body) {
  const isObject = body && typeof body === 'object';
  const raw = isObject ? body : null;
  const rawText = isObject ? null : (body ? String(body) : null);
  const message = raw ? String(raw.error || raw.message || '') : rawText || '';
  // `details.code` refines the top-level one — the server sets PLANNING_FAILED
  // on the envelope and the specific cause (FIXED_PATH_CONFLICT,
  // CRUISE_SPEED_TOO_SLOW_FOR_DOWNWASH, ...) inside `details`. Prefer the
  // specific one whenever we can actually say something better about it.
  const nested = raw?.details?.code;
  const code =
    (nested && CODE_HANDLERS[nested] ? nested : null) || raw?.code || nested || null;
  const validation = raw?.validation || null;
  const issues = Array.isArray(validation?.issues) ? validation.issues : [];

  const payload = { status, code, message, details: raw?.details, validation, raw };
  const handler = code ? CODE_HANDLERS[code] : null;
  const described = handler ? handler(payload) : statusFallback(status, message);

  return {
    severity: SEVERITY.ERROR,
    code: code || (status ? `HTTP_${status}` : 'NETWORK'),
    status,
    title: described.title,
    summary: described.summary,
    facts: (described.facts || []).filter((f) => f && f.value),
    why: described.why,
    remedies: described.remedies || [],
    issues,
    // 코드를 못 알아본 경우에만 원문을 남겨 둔다 — 아는 코드는 이미 번역했으므로
    // 원문을 겹쳐 보여 줄 이유가 없다.
    rawText: handler ? null : rawText || (raw ? JSON.stringify(raw, null, 2) : null),
    serverMessage: message || null,
  };
}

/** 네트워크 자체가 실패했을 때 (fetch가 throw). */
export function describeNetworkFailure(error) {
  return {
    severity: SEVERITY.ERROR,
    code: 'NETWORK',
    status: 0,
    title: '서버에 연결하지 못함',
    summary: String(error?.message || error || '연결 실패'),
    facts: [],
    why: '요청이 서버에 닿지 못했습니다.',
    remedies: [
      'skybrushd가 실행 중인지 확인하세요.',
      '개발 서버 프록시 대상(localhost:5001)이 맞는지 확인하세요.',
    ],
    issues: [],
    rawText: null,
    serverMessage: null,
  };
}

/**
 * 성공했지만 경고가 붙은 경우 (검증 warning 등). 실패가 아니므로 별도로 뽑는다.
 */
export function collectPlanWarnings(body) {
  const issues = Array.isArray(body?.validation?.issues) ? body.validation.issues : [];
  return issues.filter((i) => (i?.severity || 'error') !== 'error');
}

/** content-type을 보고 JSON일 때만 파싱. 아니면 원문 텍스트를 돌려준다. */
export async function readPlanResponseBody(response) {
  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
