/**
 * Reusable yes/cancel confirmation dialog (MUI + DraggableDialog).
 */

import Button from '@mui/material/Button';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import PropTypes from 'prop-types';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { DraggableDialog } from '@skybrush/mui-components';

const ConfirmationDialog = ({
  anchor = 'center',
  cancelLabel,
  children,
  confirmLabel,
  message,
  onCancel,
  onConfirm,
  open,
  title,
}) => {
  const { t } = useTranslation();
  const isBottomLeft = anchor === 'bottom-left';

  return (
    <DraggableDialog
      maxWidth='xs'
      open={open}
      title={title ?? t('general.confirmDialog.title')}
      sx={
        isBottomLeft
          ? {
              '& .MuiDialog-container': {
                alignItems: 'flex-end',
                justifyContent: 'flex-start',
              },
              '& .MuiPaper-root': {
                margin: 0,
                marginLeft: '28px',
                marginBottom: '28px',
                minWidth: 360,
              },
            }
          : undefined
      }
    >
      <DialogContent>
        {message ? (
          <DialogContentText
            component='div'
            sx={isBottomLeft ? { fontSize: '1.05rem' } : undefined}
          >
            {message}
          </DialogContentText>
        ) : (
          children
        )}
      </DialogContent>
      <DialogActions
        sx={isBottomLeft ? { padding: '8px 20px 20px', gap: 1 } : undefined}
      >
        <Button
          color='primary'
          variant='contained'
          size={isBottomLeft ? 'large' : 'medium'}
          onClick={onConfirm}
          sx={isBottomLeft ? { fontSize: '1.1rem', px: 3, py: 1.25 } : undefined}
        >
          {confirmLabel ?? t('general.action.yes')}
        </Button>
        <Button
          size={isBottomLeft ? 'large' : 'medium'}
          onClick={onCancel}
          sx={isBottomLeft ? { fontSize: '1.1rem', px: 3, py: 1.25 } : undefined}
        >
          {cancelLabel ?? t('general.action.cancel')}
        </Button>
      </DialogActions>
    </DraggableDialog>
  );
};

ConfirmationDialog.propTypes = {
  anchor: PropTypes.oneOf(['center', 'bottom-left']),
  cancelLabel: PropTypes.string,
  children: PropTypes.node,
  confirmLabel: PropTypes.string,
  message: PropTypes.node,
  onCancel: PropTypes.func.isRequired,
  onConfirm: PropTypes.func.isRequired,
  open: PropTypes.bool.isRequired,
  title: PropTypes.string,
};

export default ConfirmationDialog;
