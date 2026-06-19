import CenterFocusStrong from '@mui/icons-material/CenterFocusStrong';
import ZoomOut from '@mui/icons-material/ZoomOut';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import PropTypes from 'prop-types';
import React from 'react';
import { withTranslation } from 'react-i18next';

import { Tooltip } from '@skybrush/mui-components';

import ToggleButton from '~/components/ToggleButton';

const minimalButtonSx = {
  border: 'none !important',
  borderRadius: '6px !important',
  color: 'rgba(255,255,255,0.45) !important',
  fontSize: '0.72rem !important',
  fontWeight: 700,
  letterSpacing: '0.14em',
  minWidth: 56,
  padding: '6px 12px !important',
  textTransform: 'uppercase',

  '&.Mui-selected': {
    backgroundColor: 'transparent !important',
    color: '#ffffff !important',
  },

  '&:hover': {
    backgroundColor: 'rgba(255,255,255,0.06) !important',
  },
};

const minimalIconButtonSx = {
  color: 'rgba(255,255,255,0.45)',
  padding: 6,

  '&:hover': {
    backgroundColor: 'rgba(255,255,255,0.06)',
  },

  '&.Mui-disabled': {
    color: 'rgba(255,255,255,0.2)',
  },
};

/**
 * Button group that allows the user to select the navigation mode currently
 * used in the 3D view.
 */
const NavigationButtonGroupPresentation = ({
  minimal = false,
  mode,
  onChange,
  onResetZoom,
  onRotateCameraTowardsDrones,
  t,
}) => {
  if (minimal) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={mode}
          sx={{ gap: 0.5 }}
        >
          <ToggleButton
            selected={mode === 'walk'}
            value="walk"
            sx={minimalButtonSx}
            onClick={() => onChange('walk')}
          >
            {t('navigationButtonGroup.walk')}
          </ToggleButton>
          <ToggleButton
            selected={mode === 'fly'}
            value="fly"
            sx={minimalButtonSx}
            onClick={() => onChange('fly')}
          >
            {t('navigationButtonGroup.fly')}
          </ToggleButton>
        </ToggleButtonGroup>
        {(onResetZoom || onRotateCameraTowardsDrones) && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, ml: 0.5 }}>
            <Tooltip content={t('navigationButtonGroup.resetZoom')}>
              <span>
                <IconButton
                  disableRipple
                  disabled={!onResetZoom}
                  size="small"
                  sx={minimalIconButtonSx}
                  onClick={onResetZoom}
                >
                  <ZoomOut fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip content={t('navigationButtonGroup.rotateCamera')}>
              <span>
                <IconButton
                  disableRipple
                  disabled={!onRotateCameraTowardsDrones}
                  size="small"
                  sx={minimalIconButtonSx}
                  onClick={onRotateCameraTowardsDrones}
                >
                  <CenterFocusStrong fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </Box>
        )}
      </Box>
    );
  }

  return (
    <>
      <ToggleButtonGroup size='small'>
        <ToggleButton
          selected={mode === 'walk'}
          value='walk'
          onClick={() => onChange('walk')}
        >
          {t('navigationButtonGroup.walk')}
        </ToggleButton>
        <ToggleButton
          selected={mode === 'fly'}
          value='fly'
          onClick={() => onChange('fly')}
        >
          {t('navigationButtonGroup.fly')}
        </ToggleButton>
      </ToggleButtonGroup>
      <Tooltip content={t('navigationButtonGroup.resetZoom')}>
        <IconButton
          disableRipple
          disabled={!onResetZoom}
          size='large'
          onClick={onResetZoom}
        >
          <ZoomOut />
        </IconButton>
      </Tooltip>
      <Tooltip content={t('navigationButtonGroup.rotateCamera')}>
        <IconButton
          disableRipple
          disabled={!onRotateCameraTowardsDrones}
          size='large'
          onClick={onRotateCameraTowardsDrones}
        >
          <CenterFocusStrong />
        </IconButton>
      </Tooltip>
    </>
  );
};

NavigationButtonGroupPresentation.propTypes = {
  minimal: PropTypes.bool,
  mode: PropTypes.oneOf(['walk', 'fly']),
  onChange: PropTypes.func,
  onResetZoom: PropTypes.func,
  onRotateCameraTowardsDrones: PropTypes.func,
  t: PropTypes.func,
};

export default withTranslation()(NavigationButtonGroupPresentation);
