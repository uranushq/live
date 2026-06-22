import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import Tab from '@mui/material/Tab';
import Tooltip from '@mui/material/Tooltip';
import PropTypes from 'prop-types';
import React from 'react';
import { withTranslation } from 'react-i18next';
import { connect } from 'react-redux';

import { DialogTabs } from '@skybrush/mui-components';

import {
  closeFeatureEditorDialog,
  setFeatureEditorDialogTab,
} from '~/features/map-features/actions';
import {
  getEditedFeatureId,
  getEditorDialogVisibility,
  getFeatureById,
  getSelectedTab,
} from '~/features/map-features/selectors';
import { removeFeaturesByIds } from '~/features/map-features/slice';
import { hasActiveGeofencePolygon } from '~/features/mission/selectors';
import { uploadGeofenceToMissionUAVs } from '~/features/safety/actions';
import { FeatureType } from '~/model/features';
import { hasFeature } from '~/utils/configuration';

import {
  FeatureEditorDialogTab,
  featureEditorDialogTabs,
  labelForFeatureEditorDialogTab,
} from '~/features/map-features/types';

import FeatureAttributesForm from './FeatureAttributesForm';
import FeaturePointsForm from './FeaturePointsForm';
import GeneralPropertiesForm from './GeneralPropertiesForm';

const hasGeofenceFeature = hasFeature('geofence');

const FeatureEditorDialogPresentation = (props) => {
  const {
    canUploadGeofence,
    feature,
    featureId,
    onClose,
    onRemoveFeature,
    onTabSelected,
    onUploadGeofence,
    open,
    selectedTab = FeatureEditorDialogTab.GENERAL,
    t,
  } = props;

  const SelectedTab = {
    [FeatureEditorDialogTab.GENERAL]: GeneralPropertiesForm,
    [FeatureEditorDialogTab.ATTRIBUTES]: FeatureAttributesForm,
    [FeatureEditorDialogTab.POINTS]: FeaturePointsForm,
  }[selectedTab];

  const content = feature ? (
    SelectedTab && <SelectedTab feature={feature} featureId={featureId} />
  ) : (
    <p>{t('featureEditorDialog.featureMissing')}</p>
  );

  const showUploadButton =
    hasGeofenceFeature && feature?.type === FeatureType.POLYGON;

  const actions = [
    <Button
      key='remove'
      color='secondary'
      disabled={!feature}
      onClick={onRemoveFeature}
    >
      {t('featureEditorDialog.remove')}
    </Button>,
    showUploadButton && (
      <Tooltip
        key='upload-tooltip'
        title={
          canUploadGeofence
            ? ''
            : t('featureEditorDialog.uploadGeofenceDisabled')
        }
      >
        <span>
          <Button
            key='upload'
            color='primary'
            disabled={!canUploadGeofence}
            onClick={onUploadGeofence}
          >
            {t('featureEditorDialog.uploadGeofence')}
          </Button>
        </span>
      </Tooltip>
    ),
    <Button key='close' onClick={onClose}>
      {t('featureEditorDialog.close')}
    </Button>,
  ].filter(Boolean);

  return (
    <Dialog fullWidth open={open} maxWidth='sm' onClose={onClose}>
      <DialogTabs value={selectedTab} onChange={onTabSelected}>
        {featureEditorDialogTabs.map((tab) => (
          <Tab
            key={tab}
            value={tab}
            label={labelForFeatureEditorDialogTab[tab]}
          />
        ))}
      </DialogTabs>
      <DialogContent
        style={{
          // Prevent the dialog height from jumping when switching between tabs
          height: 325,
        }}
      >
        {content}
      </DialogContent>
      <DialogActions>{actions}</DialogActions>
    </Dialog>
  );
};

FeatureEditorDialogPresentation.propTypes = {
  canUploadGeofence: PropTypes.bool,
  feature: PropTypes.object,
  featureId: PropTypes.string,
  onClose: PropTypes.func,
  onRemoveFeature: PropTypes.func,
  onTabSelected: PropTypes.func,
  onUploadGeofence: PropTypes.func,
  open: PropTypes.bool.isRequired,
  selectedTab: PropTypes.oneOf(Object.values(FeatureEditorDialogTab)),
  t: PropTypes.func,
};

/**
 * Container of the dialog that shows the form where a given feature can
 * be edited.
 */
const FeatureEditorDialog = connect(
  // mapStateToProps
  (state) => {
    const featureId = getEditedFeatureId(state);
    return {
      canUploadGeofence: hasActiveGeofencePolygon(state),
      featureId,
      selectedTab: getSelectedTab(state),
      feature: getFeatureById(state, featureId),
      open: getEditorDialogVisibility(state),
    };
  },
  // mapDispatchToProps
  (dispatch) => ({
    onClose() {
      dispatch(closeFeatureEditorDialog());
    },
    onRemoveFeature(featureId) {
      dispatch(removeFeaturesByIds([featureId]));
      dispatch(closeFeatureEditorDialog());
    },
    onTabSelected(_event, value) {
      dispatch(setFeatureEditorDialogTab(value));
    },
    onUploadGeofence() {
      dispatch(uploadGeofenceToMissionUAVs());
    },
  }),
  // mergeProps
  (stateProps, dispatchProps) => ({
    ...stateProps,
    ...dispatchProps,
    onRemoveFeature: () => dispatchProps.onRemoveFeature(stateProps.featureId),
  })
)(withTranslation()(FeatureEditorDialogPresentation));

export default FeatureEditorDialog;
