import Button from '@mui/material/Button';
import ButtonGroup from '@mui/material/ButtonGroup';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DraggableDialog } from '@skybrush/mui-components';

const PRESET_DELAYS_SECONDS = [15, 30, 60] as const;
const DEFAULT_DELAY_SECONDS = 30;

type ShowStartDelayDialogProps = Readonly<{
  /**
   * How many JR LED boards this start will also arm. Shown so the operator
   * knows the one button reaches the LED boards too; zero hides the notice.
   */
  ledBoardCount?: number;
  onCancel: () => void;
  onConfirm: (delaySeconds: number) => void;
  open: boolean;
}>;

const ShowStartDelayDialog = ({
  ledBoardCount = 0,
  onCancel,
  onConfirm,
  open,
}: ShowStartDelayDialogProps): React.JSX.Element => {
  const { t } = useTranslation();
  const [delaySeconds, setDelaySeconds] = useState(String(DEFAULT_DELAY_SECONDS));

  useEffect(() => {
    if (open) {
      setDelaySeconds(String(DEFAULT_DELAY_SECONDS));
    }
  }, [open]);

  const parsedDelay = Number.parseInt(delaySeconds, 10);
  const isValidDelay =
    delaySeconds.trim() !== '' &&
    Number.isFinite(parsedDelay) &&
    parsedDelay >= 0;

  const handleConfirm = (): void => {
    if (!isValidDelay) {
      return;
    }

    onConfirm(parsedDelay);
  };

  return (
    <DraggableDialog
      maxWidth='xs'
      open={open}
      title={t('showStartDelayDialog.title')}
    >
      <DialogContent>
        <Typography color='textSecondary' sx={{ mb: 2 }} variant='body2'>
          {t('showStartDelayDialog.description')}
        </Typography>

        <TextField
          fullWidth
          autoFocus
          inputProps={{ min: 0, step: 1 }}
          label={t('showStartDelayDialog.delayLabel')}
          type='number'
          value={delaySeconds}
          variant='filled'
          onChange={(event) => {
            setDelaySeconds(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && isValidDelay) {
              handleConfirm();
            }
          }}
        />

        <ButtonGroup sx={{ mt: 2 }} variant='outlined'>
          {PRESET_DELAYS_SECONDS.map((seconds) => (
            <Button
              key={seconds}
              onClick={() => {
                setDelaySeconds(String(seconds));
              }}
            >
              {t('showStartDelayDialog.presetSeconds', { seconds })}
            </Button>
          ))}
        </ButtonGroup>

        {ledBoardCount > 0 && (
          <Typography color='textSecondary' sx={{ mt: 2 }} variant='body2'>
            {`LED 보드 ${ledBoardCount}대도 같이 ARM 되어, 위 시각에 맞춰 첫 프레임이 나갑니다.`}
          </Typography>
        )}
      </DialogContent>

      <DialogActions>
        <Button color='primary' disabled={!isValidDelay} variant='contained' onClick={handleConfirm}>
          {t('general.action.start')}
        </Button>
        <Button onClick={onCancel}>{t('general.action.cancel')}</Button>
      </DialogActions>
    </DraggableDialog>
  );
};

export default ShowStartDelayDialog;
