import Visibility from '@mui/icons-material/Visibility';
import Box from '@mui/material/Box';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import PropTypes from 'prop-types';
import React from 'react';
import { withTranslation } from 'react-i18next';

import { Tooltip } from '@skybrush/mui-components';

import ToggleButton from '~/components/ToggleButton';
import Route from '~/icons/Route';

const minimalButtonSx = {
  border: 'none !important',
  borderRadius: '6px !important',
  color: 'rgba(255,255,255,0.45) !important',
  fontSize: '0.72rem !important',
  fontWeight: 700,
  letterSpacing: '0.14em',
  minWidth: 72,
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

const ThreeDInteractionModeTogglePresentation = ({ minimal = false, mode, onChange, t }) => {
  if (minimal) {
    return (
      <ToggleButtonGroup
        exclusive
        size="small"
        value={mode}
        aria-label={t('threeDInteractionMode.label')}
        sx={{ gap: 0.5 }}
      >
        <ToggleButton
          selected={mode === 'view'}
          value="view"
          sx={minimalButtonSx}
          aria-label={t('threeDInteractionMode.view')}
          onClick={() => onChange('view')}
        >
          {t('threeDInteractionMode.view')}
        </ToggleButton>
        <ToggleButton
          selected={mode === 'create'}
          value="create"
          sx={minimalButtonSx}
          aria-label={t('threeDInteractionMode.create')}
          onClick={() => onChange('create')}
        >
          {t('threeDInteractionMode.create')}
        </ToggleButton>
      </ToggleButtonGroup>
    );
  }

  return (
    <ToggleButtonGroup
      exclusive
      size="small"
      value={mode}
      aria-label={t('threeDInteractionMode.label')}
    >
      <Tooltip content={t('threeDInteractionMode.viewTooltip')}>
        <ToggleButton
          selected={mode === 'view'}
          value="view"
          aria-label={t('threeDInteractionMode.view')}
          onClick={() => onChange('view')}
        >
          <Box
            component="span"
            sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
          >
            <Visibility fontSize="small" />
            {t('threeDInteractionMode.view')}
          </Box>
        </ToggleButton>
      </Tooltip>
      <Tooltip content={t('threeDInteractionMode.createTooltip')}>
        <ToggleButton
          selected={mode === 'create'}
          value="create"
          aria-label={t('threeDInteractionMode.create')}
          onClick={() => onChange('create')}
        >
          <Box
            component="span"
            sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
          >
            <Route fontSize="small" />
            {t('threeDInteractionMode.create')}
          </Box>
        </ToggleButton>
      </Tooltip>
    </ToggleButtonGroup>
  );
};

ThreeDInteractionModeTogglePresentation.propTypes = {
  minimal: PropTypes.bool,
  mode: PropTypes.oneOf(['view', 'create']).isRequired,
  onChange: PropTypes.func.isRequired,
  t: PropTypes.func.isRequired,
};

export default withTranslation()(ThreeDInteractionModeTogglePresentation);
