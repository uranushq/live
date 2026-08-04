import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Typography from '@mui/material/Typography';
import PropTypes from 'prop-types';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { connect } from 'react-redux';

import { makeStyles } from '@skybrush/app-theme-mui';

import { getUAVIdsParticipatingInMission } from '~/features/mission/selectors';
import { isShowAuthorizedToStartLocally } from '~/features/show/selectors';
import {
  openShowStartPermissionDialog,
  setShowAuthorization,
  synchronizeShowSettings,
} from '~/features/show/slice';
import { getUAVById } from '~/features/uavs/selectors';

const isAnyMissionUAVAirborne = (state) =>
  getUAVIdsParticipatingInMission(state).some((uavId) => {
    const ahl = getUAVById(state, uavId)?.position?.ahl;
    return typeof ahl === 'number' && Math.abs(ahl) >= 0.3;
  });

const useStyles = makeStyles((theme) => ({
  root: {
    display: 'flex',
    flex: '0 0 auto',
    flexDirection: 'column',
    gap: theme.spacing(0.625),
    justifyContent: 'center',
    minWidth: 0,
    overflow: 'visible',
    padding: theme.spacing(0.25, 1.5, 1),
  },
  authorizeButton: {
    alignItems: 'center',
    backgroundColor: '#8b0000',
    border: '1px solid #5c0000',
    borderRadius: theme.spacing(1),
    color: '#ffffff',
    display: 'flex',
    justifyContent: 'center',
    minHeight: 'clamp(44px, 5vh, 52px)',
    padding: theme.spacing(0.75, 1),
    textAlign: 'center',
    transition: theme.transitions.create([
      'background-color',
      'border-color',
      'color',
    ]),
    width: '100%',

    '&:hover:not(:disabled)': {
      backgroundColor: '#6e0000',
      borderColor: '#4a0000',
    },

    '&.Mui-disabled': {
      opacity: 0.45,
    },

    '&.Mui-focusVisible': {
      outline: `2px solid ${theme.palette.primary.main}`,
      outlineOffset: 2,
    },
  },
  authorizeButtonActive: {
    backgroundColor: '#006400',
    borderColor: '#004d00',
    color: '#ffffff',

    '&:hover:not(:disabled)': {
      backgroundColor: '#004d00',
      borderColor: '#003300',
    },
  },
  authorizeLabel: {
    fontSize: 'clamp(0.74rem, 0.9vw, 0.84rem)',
    fontWeight: 700,
    letterSpacing: '0.03em',
    lineHeight: 1.25,
    textTransform: 'uppercase',
  },
}));

const PreflightStartStrip = ({
  isAuthorized,
  onAuthorizeClick,
  revocationDisabled,
}) => {
  const classes = useStyles();
  const { t } = useTranslation();

  const authorizeLabel = isAuthorized
    ? t('show.authorized')
    : t('bottomBar.showStartPermissionRequired');

  const handleAuthorizeClick = (event) => {
    onAuthorizeClick();
    event.currentTarget.blur();
  };

  return (
    <Box className={classes.root}>
      <ButtonBase
        className={`${classes.authorizeButton} ${
          isAuthorized ? classes.authorizeButtonActive : ''
        }`}
        disabled={revocationDisabled && isAuthorized}
        focusRipple={false}
        onClick={handleAuthorizeClick}
      >
        <Typography className={classes.authorizeLabel} component='span'>
          {authorizeLabel}
        </Typography>
      </ButtonBase>
    </Box>
  );
};

PreflightStartStrip.propTypes = {
  isAuthorized: PropTypes.bool,
  onAuthorizeClick: PropTypes.func,
  revocationDisabled: PropTypes.bool,
};

export default connect(
  (state) => ({
    isAuthorized: isShowAuthorizedToStartLocally(state),
    revocationDisabled:
      isShowAuthorizedToStartLocally(state) && isAnyMissionUAVAirborne(state),
  }),
  {
    onAuthorizeClick: () => (dispatch, getState) => {
      const state = getState();
      if (isShowAuthorizedToStartLocally(state)) {
        if (isAnyMissionUAVAirborne(state)) {
          return;
        }
        dispatch(setShowAuthorization(false));
        dispatch(synchronizeShowSettings('toServer'));
        return;
      }
      dispatch(openShowStartPermissionDialog());
    },
  }
)(PreflightStartStrip);
