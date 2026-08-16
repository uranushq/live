/**
 * @file JR-board control panel (scaffold): board health table, reboot /
 * re-download actions, and the timer ARM UDP broadcast.
 *
 * All transport happens server-side via the `jr_control` extension
 * (`/api/v1/jr`); the browser cannot send UDP broadcasts itself.
 */

import Lightbulb from '@mui/icons-material/Lightbulb';
import Refresh from '@mui/icons-material/Refresh';
import RestartAlt from '@mui/icons-material/RestartAlt';
import CloudDownload from '@mui/icons-material/CloudDownload';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import {
  broadcastArm,
  JR_LED_PRESETS,
  rebootBoard,
  redownloadBoard,
  refreshAllBoards,
  refreshBoardHealth,
  setAllBoardsLed,
  setBoardLed,
} from '~/features/jr-control/actions';
import { JR_HEALTH_POLL_INTERVAL_MS } from '~/features/jr-control/JRHealthPoller';
import {
  getJRBoardRows,
  getJRBoardStatusCounts,
  getJRHealthCheckDisabledReason,
  isJRHealthCheckEnabled,
  JR_IP_PREFIX,
} from '~/features/jr-control/selectors';
import {
  addBoard,
  removeBoard,
  setArmParams,
  setHealthCheckEnabled,
} from '~/features/jr-control/slice';
import {
  JR_BOARD_STATUS_COLOR,
  JR_BOARD_STATUS_LABEL,
  JRBoardStatus,
  type JRBoardStatusId,
} from '~/features/jr-control/status';
import {
  getFps,
  getLedStartDelaySec,
  getTimelineDuration,
} from '~/features/led-editor/selectors';
import { type RootState } from '~/store/reducers';
import { type AppDispatch } from '~/store/reducers';

/** 요약 줄에 보여줄 상태 순서 (사용자가 신경 쓰는 4개 먼저) */
const SUMMARY_STATUS_ORDER: JRBoardStatusId[] = [
  JRBoardStatus.ARM_WAIT,
  JRBoardStatus.GNSS_PPS_WAIT,
  JRBoardStatus.DOWNLOADING,
  JRBoardStatus.ERROR,
  JRBoardStatus.OTHER,
  JRBoardStatus.UNKNOWN,
];

const formatCheckedAt = (timestamp?: number): string => {
  if (!timestamp) {
    return '—';
  }

  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  return seconds < 1 ? '방금' : `${seconds}s 전`;
};

// Only the fields a user must set are shown. FPS and frame count are derived
// from the authored LED show at broadcast time (see broadcastArm), so they are
// not editable here. "Start in" has its own control (auto/manual) below.
const armFields: Array<{
  key: 'showId' | 'fileId';
  label: string;
}> = [
  { key: 'showId', label: 'Show id' },
  { key: 'fileId', label: 'File id' },
];

const JRControlPanel = (): JSX.Element => {
  const dispatch = useDispatch<AppDispatch>();
  const rows = useSelector(getJRBoardRows);
  const statusCounts = useSelector(getJRBoardStatusCounts);
  const healthCheckEnabled = useSelector(isJRHealthCheckEnabled);
  const healthCheckDisabledReason = useSelector(getJRHealthCheckDisabledReason);
  const arm = useSelector((state: RootState) => state.jrControl.arm);
  const lastArmSummary = useSelector(
    (state: RootState) => state.jrControl.lastArmSummary
  );
  const fps = useSelector(getFps);
  const showDuration = useSelector(getTimelineDuration);
  const ledStartDelaySec = useSelector(getLedStartDelaySec);
  const derivedFrameCount = Math.max(1, Math.round(showDuration * fps));
  const [ipInput, setIpInput] = useState('');
  // 결선 확인용 LED 색. 행의 전구 버튼과 '전체 점등'이 같은 색을 쓴다.
  const [ledPresetId, setLedPresetId] = useState(JR_LED_PRESETS[0]!.id);
  const ledColor =
    (JR_LED_PRESETS.find((p) => p.id === ledPresetId) ?? JR_LED_PRESETS[0]!).color;

  // The 3D view reports how long the drones take to reach the first formation
  // (the "path" value). In auto mode this drives the ARM start-in; in manual
  // mode the user types it. We no longer auto-overwrite the manual field.
  const recommendedStartIn =
    ledStartDelaySec != null && Number.isFinite(ledStartDelaySec)
      ? Math.round(ledStartDelaySec * 10) / 10
      : null;
  const startInMode = arm.startInMode ?? 'auto';

  const handleAdd = () => {
    if (ipInput.trim()) {
      dispatch(addBoard(ipInput.trim()));
      setIpInput('');
    }
  };

  return (
    <Box sx={{ height: '100%', overflow: 'auto', p: 1.5 }}>
      <Stack direction='row' spacing={1} alignItems='center' sx={{ mb: 1 }}>
        <Typography variant='subtitle2' sx={{ flex: 1 }}>
          JR boards
        </Typography>
        <TextField
          size='small'
          label='Board IP'
          placeholder={`${JR_IP_PREFIX}3`}
          value={ipInput}
          onChange={(event) => setIpInput(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && handleAdd()}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <Button size='small' variant='outlined' onClick={handleAdd}>
          Add
        </Button>
        <IconButton
          size='small'
          title='Refresh all'
          onClick={() => dispatch(refreshAllBoards())}
        >
          <Refresh fontSize='small' />
        </IconButton>
      </Stack>

      {/* 헬스체크 on/off — ARM 브로드캐스트를 보내면 자동으로 꺼진다 */}
      <Stack
        direction='row'
        spacing={1}
        alignItems='center'
        flexWrap='wrap'
        useFlexGap
        sx={{ mb: 1 }}
      >
        <FormControlLabel
          control={
            <Switch
              size='small'
              checked={healthCheckEnabled}
              onChange={(event) =>
                dispatch(setHealthCheckEnabled(event.target.checked))
              }
            />
          }
          label={`헬스체크 ${JR_HEALTH_POLL_INTERVAL_MS / 1000}초 주기`}
        />
        <Typography variant='caption' color='text.secondary'>
          연결된 드론 번호 → {JR_IP_PREFIX}N · 감시 {rows.length}대
        </Typography>
        {SUMMARY_STATUS_ORDER.filter((status) => statusCounts[status]).map(
          (status) => (
            <Chip
              key={status}
              size='small'
              variant='outlined'
              color={JR_BOARD_STATUS_COLOR[status]}
              label={`${JR_BOARD_STATUS_LABEL[status]} ${statusCounts[status]}`}
            />
          )
        )}
      </Stack>

      {!healthCheckEnabled && (
        <Typography
          variant='caption'
          color='warning.main'
          sx={{ display: 'block', mb: 1 }}
        >
          {healthCheckDisabledReason ?? '헬스체크가 꺼져 있습니다.'} 다시 보려면
          위 토글을 켜세요.
        </Typography>
      )}

      <Table size='small'>
        <TableHead>
          <TableRow>
            <TableCell>Drone</TableCell>
            <TableCell>IP</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>PPS</TableCell>
            <TableCell>Show</TableCell>
            <TableCell>Checked</TableCell>
            <TableCell align='right'>Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={7}>
                <Typography variant='caption' color='text.secondary'>
                  연결된 드론이 없습니다. 드론이 붙으면 자동으로 나타나고, 필요하면
                  IP 를 직접 추가할 수 있습니다.
                </Typography>
              </TableCell>
            </TableRow>
          )}
          {rows.map((row) => (
            <TableRow key={row.ip}>
              <TableCell>
                {row.uavId ? (
                  row.uavId
                ) : (
                  <Typography variant='caption' color='text.secondary'>
                    manual
                  </Typography>
                )}
              </TableCell>
              <TableCell>{row.ip}</TableCell>
              <TableCell>
                <Chip
                  size='small'
                  color={JR_BOARD_STATUS_COLOR[row.status]}
                  variant={
                    row.status === JRBoardStatus.UNKNOWN ? 'outlined' : 'filled'
                  }
                  label={
                    row.statusDetail
                      ? `${JR_BOARD_STATUS_LABEL[row.status]} (${row.statusDetail})`
                      : JR_BOARD_STATUS_LABEL[row.status]
                  }
                  title={row.error ?? row.health?.state ?? ''}
                />
              </TableCell>
              <TableCell>{row.health?.pps?.state ?? '—'}</TableCell>
              <TableCell>
                {row.health?.show?.loaded
                  ? `${row.health.show.frames ?? '?'}f`
                  : '—'}
              </TableCell>
              <TableCell>{formatCheckedAt(row.lastCheckedAt)}</TableCell>
              <TableCell align='right'>
                <IconButton
                  size='small'
                  title='Refresh'
                  onClick={() => dispatch(refreshBoardHealth(row.ip))}
                >
                  <Refresh fontSize='small' />
                </IconButton>
                <IconButton
                  size='small'
                  title={`LED 점등 (${ledPresetId}) — 다시 누르면 같은 색으로 갱신`}
                  onClick={() => dispatch(setBoardLed(row.ip, ledColor))}
                >
                  <Lightbulb fontSize='small' />
                </IconButton>
                <IconButton
                  size='small'
                  title='Re-download'
                  onClick={() => dispatch(redownloadBoard(row.ip))}
                >
                  <CloudDownload fontSize='small' />
                </IconButton>
                <IconButton
                  size='small'
                  title='Reboot'
                  color='warning'
                  onClick={() => dispatch(rebootBoard(row.ip))}
                >
                  <RestartAlt fontSize='small' />
                </IconButton>
                {row.manual && (
                  <IconButton
                    size='small'
                    title='Remove'
                    color='error'
                    onClick={() => dispatch(removeBoard(row.ip))}
                  >
                    ✕
                  </IconButton>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Divider sx={{ my: 2 }} />

      {/* 결선 확인용 LED 점등. 보드는 PLAYING 중엔 명령을 버리므로(프레임
          태스크의 I2C 보호) 쇼 재생 중에는 타임아웃이 정상이다. 점등은 끄거나
          다음 쇼가 덮어쓸 때까지 유지된다. */}
      <Typography variant='subtitle2' sx={{ mb: 1 }}>
        LED 결선 확인 (UDP 16550)
      </Typography>
      <Stack
        direction='row'
        spacing={1}
        flexWrap='wrap'
        useFlexGap
        alignItems='center'
        sx={{ mb: 1 }}
      >
        {JR_LED_PRESETS.map((preset) => (
          <Button
            key={preset.id}
            size='small'
            variant={preset.id === ledPresetId ? 'contained' : 'outlined'}
            onClick={() => setLedPresetId(preset.id)}
          >
            {preset.label}
          </Button>
        ))}
        <Box sx={{ flex: 1 }} />
        <Button
          size='small'
          variant='outlined'
          startIcon={<Lightbulb fontSize='small' />}
          disabled={rows.length === 0}
          onClick={() => dispatch(setAllBoardsLed(ledColor))}
        >
          전체 점등
        </Button>
        <Button
          size='small'
          variant='outlined'
          color='inherit'
          disabled={rows.length === 0}
          onClick={() => dispatch(setAllBoardsLed({ off: true }))}
        >
          전체 소등
        </Button>
      </Stack>
      <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mb: 2 }}>
        선택한 색은 표의 전구 버튼에도 적용됩니다. 쇼 재생(PLAYING) 중에는 보드가
        명령을 무시하므로 타임아웃이 납니다 — 확인 후 전체 소등으로 꺼주세요.
      </Typography>

      <Divider sx={{ my: 2 }} />

      <Typography variant='subtitle2' sx={{ mb: 1 }}>
        Timer ARM broadcast (UDP 255.255.255.255:8765)
      </Typography>
      {recommendedStartIn != null && (
        <Typography
          variant='caption'
          color='primary'
          sx={{ display: 'block', mb: 1 }}
        >
          드론 dance 시작 후 {recommendedStartIn}초 후 LED 가동 추천
        </Typography>
      )}
      <FormControlLabel
        control={
          <Checkbox
            size='small'
            checked={startInMode === 'auto'}
            onChange={(event) =>
              dispatch(
                setArmParams({
                  startInMode: event.target.checked ? 'auto' : 'manual',
                })
              )
            }
          />
        }
        label='Start-in 자동 (쇼 path 값 따라감)'
      />
      <Stack
        direction='row'
        spacing={1}
        flexWrap='wrap'
        useFlexGap
        alignItems='flex-start'
      >
        <TextField
          size='small'
          type='number'
          label='Start in (s)'
          value={startInMode === 'auto' ? recommendedStartIn ?? '' : arm.startIn}
          onChange={(event) =>
            dispatch(setArmParams({ startIn: Number(event.target.value) }))
          }
          disabled={startInMode === 'auto'}
          error={startInMode === 'auto' && recommendedStartIn == null}
          helperText={
            startInMode === 'auto'
              ? recommendedStartIn == null
                ? 'path 없음'
                : `path: ${recommendedStartIn}s`
              : '직접 입력'
          }
          sx={{ width: 130 }}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        {armFields.map((field) => (
          <TextField
            key={field.key}
            size='small'
            type='number'
            label={field.label}
            value={arm[field.key]}
            onChange={(event) =>
              dispatch(
                setArmParams({ [field.key]: Number(event.target.value) })
              )
            }
            sx={{ width: 110 }}
            slotProps={{ inputLabel: { shrink: true } }}
          />
        ))}
      </Stack>
      <Typography
        variant='caption'
        color='text.secondary'
        sx={{ display: 'block', mt: 1 }}
      >
        FPS {fps} · Frames {derivedFrameCount} (LED 쇼에서 자동 계산)
      </Typography>
      <Typography
        variant='caption'
        color='text.secondary'
        sx={{ display: 'block' }}
      >
        ARM 을 보내면 헬스체크가 자동으로 꺼집니다 (재생 타이밍 보호).
      </Typography>
      <Stack direction='row' spacing={1} alignItems='center' sx={{ mt: 1.5 }}>
        <Button
          variant='contained'
          size='small'
          onClick={() => dispatch(broadcastArm())}
        >
          Broadcast ARM
        </Button>
        {lastArmSummary && (
          <Typography variant='caption' color='text.secondary'>
            {lastArmSummary}
          </Typography>
        )}
      </Stack>
    </Box>
  );
};

export default JRControlPanel;
