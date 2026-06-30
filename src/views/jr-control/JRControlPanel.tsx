/**
 * @file JR-board control panel (scaffold): board health table, reboot /
 * re-download actions, and the timer ARM UDP broadcast.
 *
 * All transport happens server-side via the `jr_control` extension
 * (`/api/v1/jr`); the browser cannot send UDP broadcasts itself.
 */

import Refresh from '@mui/icons-material/Refresh';
import RestartAlt from '@mui/icons-material/RestartAlt';
import CloudDownload from '@mui/icons-material/CloudDownload';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
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
  rebootBoard,
  redownloadBoard,
  refreshAllBoards,
  refreshBoardHealth,
} from '~/features/jr-control/actions';
import {
  addBoard,
  removeBoard,
  setArmParams,
} from '~/features/jr-control/slice';
import {
  getFps,
  getLedStartDelaySec,
  getTimelineDuration,
} from '~/features/led-editor/selectors';
import { type RootState } from '~/store/reducers';
import { type AppDispatch } from '~/store/reducers';

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
  const boards = useSelector((state: RootState) => state.jrControl.boards);
  const arm = useSelector((state: RootState) => state.jrControl.arm);
  const lastArmSummary = useSelector(
    (state: RootState) => state.jrControl.lastArmSummary
  );
  const fps = useSelector(getFps);
  const showDuration = useSelector(getTimelineDuration);
  const ledStartDelaySec = useSelector(getLedStartDelaySec);
  const derivedFrameCount = Math.max(1, Math.round(showDuration * fps));
  const [ipInput, setIpInput] = useState('');

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
          placeholder='192.168.11.3'
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

      <Table size='small'>
        <TableHead>
          <TableRow>
            <TableCell>IP</TableCell>
            <TableCell>State</TableCell>
            <TableCell>PPS</TableCell>
            <TableCell>Show</TableCell>
            <TableCell>Uptime</TableCell>
            <TableCell align='right'>Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {boards.length === 0 && (
            <TableRow>
              <TableCell colSpan={6}>
                <Typography variant='caption' color='text.secondary'>
                  No boards added yet.
                </Typography>
              </TableCell>
            </TableRow>
          )}
          {boards.map((board) => (
            <TableRow key={board.ip}>
              <TableCell>{board.ip}</TableCell>
              <TableCell>
                {board.error ? (
                  <Typography variant='caption' color='error'>
                    unreachable
                  </Typography>
                ) : (
                  board.health?.state ?? '—'
                )}
              </TableCell>
              <TableCell>{board.health?.pps?.state ?? '—'}</TableCell>
              <TableCell>
                {board.health?.show?.loaded ? 'loaded' : '—'}
              </TableCell>
              <TableCell>
                {board.health?.uptime_ms !== undefined
                  ? `${Math.floor(board.health.uptime_ms / 1000)}s`
                  : '—'}
              </TableCell>
              <TableCell align='right'>
                <IconButton
                  size='small'
                  title='Refresh'
                  onClick={() => dispatch(refreshBoardHealth(board.ip))}
                >
                  <Refresh fontSize='small' />
                </IconButton>
                <IconButton
                  size='small'
                  title='Re-download'
                  onClick={() => dispatch(redownloadBoard(board.ip))}
                >
                  <CloudDownload fontSize='small' />
                </IconButton>
                <IconButton
                  size='small'
                  title='Reboot'
                  color='warning'
                  onClick={() => dispatch(rebootBoard(board.ip))}
                >
                  <RestartAlt fontSize='small' />
                </IconButton>
                <IconButton
                  size='small'
                  title='Remove'
                  color='error'
                  onClick={() => dispatch(removeBoard(board.ip))}
                >
                  ✕
                </IconButton>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

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
