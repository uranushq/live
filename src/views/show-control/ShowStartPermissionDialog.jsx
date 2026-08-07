import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import PropTypes from 'prop-types';
import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { connect } from 'react-redux';

import { hasManualPreflightChecks } from '~/features/preflight/selectors';
import { getUAVIdsParticipatingInMission } from '~/features/mission/selectors';
import { setCommandsAreBroadcast } from '~/features/mission/slice';
import {
  signOffOnManualPreflightChecks,
  signOffOnOnboardPreflightChecks,
} from '~/features/show/actions';
import {
  areManualPreflightChecksSignedOff,
  areOnboardPreflightChecksSignedOff,
  isShowAuthorizedToStartLocally,
} from '~/features/show/selectors';
import {
  clearManualPreflightChecks,
  clearOnboardPreflightChecks,
  closeShowStartPermissionDialog,
  setShowAuthorization,
  synchronizeShowSettings,
} from '~/features/show/slice';
import { getUAVById } from '~/features/uavs/selectors';

import { PreflightCheckList as ManualPreflightCheckList } from './ManualPreflightChecksDialog';
import { PreflightCheckList as OnboardPreflightCheckList } from './OnboardPreflightChecksDialog';

const isAnyMissionUAVAirborne = (state) =>
  getUAVIdsParticipatingInMission(state).some((uavId) => {
    const ahl = getUAVById(state, uavId)?.position?.ahl;
    return typeof ahl === 'number' && Math.abs(ahl) >= 0.3;
  });

const ShowStartPermissionDialog = ({
  hasManualChecks,
  isAuthorized,
  manualSignedOff,
  onboardSignedOff,
  onAuthorize,
  onClearManual,
  onClearOnboard,
  onClose,
  onRevoke,
  onSignOffManual,
  onSignOffOnboard,
  open = false,
  revocationDisabled,
}) => {
  const { t } = useTranslation();

  const preflightComplete = useMemo(
    () => onboardSignedOff && (!hasManualChecks || manualSignedOff),
    [hasManualChecks, manualSignedOff, onboardSignedOff]
  );

  const handleAuthorize = useCallback(() => {
    if (!preflightComplete) {
      return;
    }
    onAuthorize();
    onClose();
  }, [onAuthorize, onClose, preflightComplete]);

  const handleRevoke = useCallback(() => {
    if (revocationDisabled) {
      return;
    }
    onRevoke();
    onClose();
  }, [onClose, onRevoke, revocationDisabled]);

  return (
    <Dialog fullWidth maxWidth='sm' open={open} onClose={onClose}>
      <DialogTitle>{t('bottomBar.showStartPermissionRequired')}</DialogTitle>
      <DialogContent
        dividers
        sx={{ display: 'flex', flexDirection: 'column', gap: 2, px: 2 }}
      >
        <Typography color='text.secondary' variant='body2'>
          {t('show.authorizationReq')}
        </Typography>

        <Box>
          <Typography sx={{ fontWeight: 700, mb: 1 }} variant='subtitle2'>
            {t('bottomBar.aircraftPreflightCheck')}
          </Typography>
          <Box sx={{ maxHeight: 220, overflow: 'auto' }}>
            <OnboardPreflightCheckList />
          </Box>
          <FormControlLabel
            control={
              <Switch
                checked={onboardSignedOff}
                onChange={onboardSignedOff ? onClearOnboard : onSignOffOnboard}
              />
            }
            label={t('OnboardPreflightChecksDialog.signOffOn')}
            sx={{ mt: 1 }}
          />
        </Box>

        {hasManualChecks ? (
          <>
            <Divider />
            <Box>
              <Typography sx={{ fontWeight: 700, mb: 1 }} variant='subtitle2'>
                {t('bottomBar.manualPreflightCheck')}
              </Typography>
              <Box sx={{ maxHeight: 220, overflow: 'auto' }}>
                <ManualPreflightCheckList />
              </Box>
              <FormControlLabel
                control={
                  <Switch
                    checked={manualSignedOff}
                    onChange={
                      manualSignedOff ? onClearManual : onSignOffManual
                    }
                  />
                }
                label='Sign off on manual preflight checks'
                sx={{ mt: 1 }}
              />
            </Box>
          </>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ px: 2, py: 1.5 }}>
        <Button onClick={onClose}>Cancel</Button>
        {isAuthorized ? (
          <Button
            color='warning'
            disabled={revocationDisabled}
            variant='contained'
            onClick={handleRevoke}
          >
            {t('show.authorized')}
          </Button>
        ) : (
          <Button
            color='success'
            disabled={!preflightComplete}
            variant='contained'
            onClick={handleAuthorize}
          >
            {t('show.authorizeTheStart')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

ShowStartPermissionDialog.propTypes = {
  hasManualChecks: PropTypes.bool,
  isAuthorized: PropTypes.bool,
  manualSignedOff: PropTypes.bool,
  onboardSignedOff: PropTypes.bool,
  onAuthorize: PropTypes.func,
  onClearManual: PropTypes.func,
  onClearOnboard: PropTypes.func,
  onClose: PropTypes.func,
  onRevoke: PropTypes.func,
  onSignOffManual: PropTypes.func,
  onSignOffOnboard: PropTypes.func,
  open: PropTypes.bool,
  revocationDisabled: PropTypes.bool,
};

export default connect(
  (state) => ({
    hasManualChecks: hasManualPreflightChecks(state),
    isAuthorized: isShowAuthorizedToStartLocally(state),
    manualSignedOff: areManualPreflightChecksSignedOff(state),
    onboardSignedOff: areOnboardPreflightChecksSignedOff(state),
    open: Boolean(state.show.showStartPermissionDialog?.open),
    revocationDisabled:
      isShowAuthorizedToStartLocally(state) && isAnyMissionUAVAirborne(state),
  }),
  (dispatch) => ({
    onAuthorize: () => {
      dispatch(setShowAuthorization(true));
      dispatch(synchronizeShowSettings('toServer'));
      dispatch(setCommandsAreBroadcast(true));
    },
    onClearManual: () => dispatch(clearManualPreflightChecks()),
    onClearOnboard: () => dispatch(clearOnboardPreflightChecks()),
    onClose: () => dispatch(closeShowStartPermissionDialog()),
    onRevoke: () => {
      dispatch(setShowAuthorization(false));
      dispatch(synchronizeShowSettings('toServer'));
    },
    onSignOffManual: () => dispatch(signOffOnManualPreflightChecks()),
    onSignOffOnboard: () => dispatch(signOffOnOnboardPreflightChecks()),
  })
)(ShowStartPermissionDialog);
