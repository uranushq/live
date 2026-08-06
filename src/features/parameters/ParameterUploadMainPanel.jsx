import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import PropTypes from 'prop-types';
import React, { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { connect, useDispatch, useSelector } from 'react-redux';

import { shouldOptimizeUIForTouch } from '~/features/settings/selectors';

import { formatParameters, parseParameters } from './formatting';
import { shouldRebootAfterParameterUpload } from './selectors';
import { setRebootAfterUpload, updateParametersInManifest } from './slice';

const ParametersTextFieldPresentation = ({ onChange, optimizeUIForTouch }) => {
  const [parameterString, setParameterString] = useState('');
  const [error, setError] = useState(null);
  const { t } = useTranslation();

  const handleChange = (event) => {
    setParameterString(event.target.value);
  };

  const validate = (event) => {
    validateValue(event.target.value);
  };

  const validateValue = (value, commit = false) => {
    let parsedParameters;

    try {
      parsedParameters = parseParameters(value);
    } catch (error) {
      setError(error.message || String(error));
      if (onChange) {
        onChange({ valid: false });
      }

      return false;
    }

    setError('');
    if (onChange) {
      onChange({ value: parsedParameters, valid: true, commit });
      setParameterString(formatParameters(parsedParameters));
    }

    return true;
  };

  const addToManifest = () => {
    if (validateValue(parameterString, true)) {
      setParameterString('');
    }
  };

  const handleKeyPress = (event) => {
    if (event.shiftKey && event.key === 'Enter') {
      if (validateValue(event.target.value, true)) {
        setParameterString('');
      }

      event.preventDefault();
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      <TextField
        fullWidth
        multiline
        autoFocus={!optimizeUIForTouch}
        error={Boolean(error)}
        label={t('parameterUploadMainPanel.parameterNamesValues')}
        variant='filled'
        minRows={7}
        helperText={error || t('parameterUploadMainPanel.specifyEntries')}
        value={parameterString}
        onBlur={validate}
        onChange={handleChange}
        onKeyPress={handleKeyPress}
      />

      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          gap: 1.5,
          justifyContent: 'space-between',
        }}
      >
        <Typography
          color='text.secondary'
          component='div'
          sx={{ flex: 1, minWidth: 0 }}
          variant='body2'
        >
          <Trans
            i18nKey='parameterUploadMainPanel.parameterUploadHint'
            components={{ kbd: <kbd /> }}
          />
        </Typography>
        <Button
          color='primary'
          disabled={!parameterString.trim()}
          sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}
          variant='contained'
          onClick={addToManifest}
        >
          {t('parameterUploadMainPanel.addToManifest', 'Add to manifest')}
        </Button>
      </Box>

      <Box
        sx={{
          bgcolor: 'action.hover',
          borderRadius: 1,
          px: 1.5,
          py: 1,
        }}
      >
        <Typography color='text.secondary' component='div' variant='caption'>
          {t(
            'parameterUploadMainPanel.expressionHint',
            'Use $id in values for per-drone formulas (numeric part of the drone id). Examples: SYSID_THISMAV=$id, SYSID_THISMAV=$id+1, GRP=($id-1)%4'
          )}
        </Typography>
      </Box>
    </Box>
  );
};

ParametersTextFieldPresentation.propTypes = {
  onChange: PropTypes.func,
  optimizeUIForTouch: PropTypes.bool,
};

const ParametersTextField = connect(
  // mapStateToProps
  (state) => ({
    optimizeUIForTouch: shouldOptimizeUIForTouch(state),
  })
)(ParametersTextFieldPresentation);

const ParameterUploadMainPanel = () => {
  const shouldReboot = useSelector(shouldRebootAfterParameterUpload);
  const dispatch = useDispatch();
  const { t } = useTranslation();

  const handleManifestChange = ({ value, valid, commit }) => {
    if (valid && commit && value.length > 0) {
      dispatch(updateParametersInManifest(value));
    }
  };

  const handleRebootStateChange = (event) => {
    dispatch(setRebootAfterUpload(event.target.checked));
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1 }}>
      <ParametersTextField onChange={handleManifestChange} />
      <FormControlLabel
        style={{ margin: 0 }}
        control={
          <Switch checked={shouldReboot} onChange={handleRebootStateChange} />
        }
        label={t('parameterUploadMainPanel.rebootAfterUpload')}
      />
    </Box>
  );
};

export default ParameterUploadMainPanel;
