import PowerSettingsNew from '@mui/icons-material/PowerSettingsNew';
import Refresh from '@mui/icons-material/Refresh';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch } from 'react-redux';

import { showError, showSuccess } from '~/features/snackbar/actions';
import type { AppDispatch } from '~/store/reducers';
import {
  disableVirtualUavs,
  enableVirtualUavs,
  getVirtualUavsStatus,
  setVirtualUavCount,
  type VirtualUavsStatus,
} from '~/utils/virtualUavs';

type VirtualUavsControlProps = Readonly<{
  /** When false, skip status polling. */
  active?: boolean;
  initialStatus?: VirtualUavsStatus | null;
  onStatusChange?: (status: VirtualUavsStatus) => void;
}>;

const emptyStatus: VirtualUavsStatus = {
  enabled: false,
  count: 0,
  uavIds: [],
};

/**
 * Controls the server-side virtual UAV fleet via `/api/v1/virtual-uavs`.
 */
const VirtualUavsControl = ({
  active = true,
  initialStatus = null,
  onStatusChange,
}: VirtualUavsControlProps): JSX.Element => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const [status, setStatus] = useState<VirtualUavsStatus>(
    initialStatus ?? emptyStatus
  );
  const [countInput, setCountInput] = useState(
    String(initialStatus?.count ?? 0)
  );
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const applyStatus = useCallback(
    (next: VirtualUavsStatus) => {
      setStatus(next);
      setCountInput(String(next.count));
      onStatusChange?.(next);
    },
    [onStatusChange]
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      applyStatus(await getVirtualUavsStatus());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      dispatch(showError(t('virtualUavsControl.statusFailed', { message })));
    } finally {
      setLoading(false);
    }
  }, [applyStatus, dispatch, t]);

  useEffect(() => {
    if (!active) {
      return;
    }

    void refresh();
  }, [active, refresh]);

  useEffect(() => {
    if (initialStatus) {
      setStatus(initialStatus);
      setCountInput(String(initialStatus.count));
    }
  }, [initialStatus]);

  const runAction = useCallback(
    async (action: () => Promise<VirtualUavsStatus>, successKey: string) => {
      setBusy(true);
      try {
        applyStatus(await action());
        dispatch(showSuccess(t(successKey)));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        dispatch(showError(t('virtualUavsControl.actionFailed', { message })));
      } finally {
        setBusy(false);
      }
    },
    [applyStatus, dispatch, t]
  );

  const handleApplyCount = () => {
    const count = Number.parseInt(countInput, 10);
    if (!Number.isInteger(count) || count < 0) {
      dispatch(showError(t('virtualUavsControl.invalidCount')));
      return;
    }

    void runAction(
      () => setVirtualUavCount(count),
      'virtualUavsControl.countSuccess'
    );
  };

  const uavIdPreview =
    status.uavIds.length > 0
      ? status.uavIds.slice(0, 8).join(', ') +
        (status.uavIds.length > 8 ? '…' : '')
      : t('virtualUavsControl.noUavs');

  return (
    <Box sx={{ minWidth: 260, p: 1.25 }}>
      <Stack direction='row' alignItems='center' spacing={1} sx={{ mb: 1 }}>
        <Typography variant='subtitle2' sx={{ flex: 1 }}>
          {t('virtualUavsControl.title')}
        </Typography>
        <IconButton
          size='small'
          disabled={loading || busy}
          aria-label={t('virtualUavsControl.refresh')}
          onClick={() => {
            void refresh();
          }}
        >
          {loading ? (
            <CircularProgress size={16} />
          ) : (
            <Refresh fontSize='small' />
          )}
        </IconButton>
      </Stack>

      <Stack direction='row' spacing={1} alignItems='center' sx={{ mb: 1 }}>
        <Chip
          size='small'
          color={status.enabled ? 'success' : 'default'}
          label={
            status.enabled
              ? t('virtualUavsControl.enabled')
              : t('virtualUavsControl.disabled')
          }
        />
        <Typography variant='body2' color='text.secondary'>
          {t('virtualUavsControl.droneCount', { count: status.count })}
        </Typography>
      </Stack>

      <Typography
        variant='caption'
        color='text.secondary'
        sx={{ display: 'block', mb: 1.25, wordBreak: 'break-all' }}
      >
        {uavIdPreview}
      </Typography>

      <Stack direction='row' spacing={1} alignItems='center' sx={{ mb: 1.25 }}>
        <TextField
          size='small'
          type='number'
          label={t('virtualUavsControl.count')}
          value={countInput}
          disabled={busy}
          inputProps={{ min: 0, step: 1 }}
          sx={{ width: 96 }}
          onChange={(event) => setCountInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              handleApplyCount();
            }
          }}
        />
        <Button
          size='small'
          variant='outlined'
          disabled={busy}
          onClick={handleApplyCount}
        >
          {t('virtualUavsControl.applyCount')}
        </Button>
      </Stack>

      <Stack direction='row' spacing={1}>
        <Button
          size='small'
          variant='contained'
          color='success'
          disabled={busy || status.enabled}
          startIcon={<PowerSettingsNew />}
          onClick={() => {
            void runAction(
              enableVirtualUavs,
              'virtualUavsControl.enableSuccess'
            );
          }}
        >
          {t('virtualUavsControl.enable')}
        </Button>
        <Button
          size='small'
          variant='outlined'
          color='inherit'
          disabled={busy || !status.enabled}
          onClick={() => {
            void runAction(
              disableVirtualUavs,
              'virtualUavsControl.disableSuccess'
            );
          }}
        >
          {t('virtualUavsControl.disable')}
        </Button>
      </Stack>
    </Box>
  );
};

export default VirtualUavsControl;
