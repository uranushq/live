import Button from '@mui/material/Button';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import PropTypes from 'prop-types';
import React, { useEffect, useState } from 'react';
import { withTranslation } from 'react-i18next';
import { connect } from 'react-redux';

import { DraggableDialog } from '@skybrush/mui-components';

import { getSelectedUAVIds } from '~/features/uavs/selectors';

import ParameterViewerPanel from './ParameterViewerPanel';
import { isParameterViewerDialogOpen } from './selectors';
import { closeParameterViewerDialog } from './slice';

/**
 * Dialog that loads, compares and edits FC/MAVLink parameters across UAVs.
 */
const ParameterViewerDialog = ({
  defaultSelectedUavIds,
  onClose,
  open,
  t,
}) => {
  const [selectedSeed, setSelectedSeed] = useState(defaultSelectedUavIds);

  useEffect(() => {
    if (open) {
      setSelectedSeed(defaultSelectedUavIds);
    }
  }, [open, defaultSelectedUavIds]);

  return (
    <DraggableDialog
      fullWidth
      open={open}
      maxWidth='xl'
      title={t('parameterViewerDialog.title')}
      onClose={onClose}
    >
      <DialogContent sx={{ pb: 1 }}>
        <ParameterViewerPanel defaultSelectedUavIds={selectedSeed} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('general.action.close')}</Button>
      </DialogActions>
    </DraggableDialog>
  );
};

ParameterViewerDialog.propTypes = {
  defaultSelectedUavIds: PropTypes.arrayOf(PropTypes.string),
  onClose: PropTypes.func,
  open: PropTypes.bool,
  t: PropTypes.func,
};

export default connect(
  // mapStateToProps
  (state) => ({
    open: isParameterViewerDialogOpen(state),
    defaultSelectedUavIds: getSelectedUAVIds(state),
  }),

  // mapDispatchToProps
  {
    onClose: closeParameterViewerDialog,
  }
)(withTranslation()(ParameterViewerDialog));
