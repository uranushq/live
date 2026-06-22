import FormHelperText from '@mui/material/FormHelperText';
import InputAdornment from '@mui/material/InputAdornment';
import { Checkboxes, TextField } from 'mui-rff';
import PropTypes from 'prop-types';
import React from 'react';
import { Form, FormSpy } from 'react-final-form';
import { withTranslation } from 'react-i18next';
import { connect } from 'react-redux';

import { BackgroundHint } from '@skybrush/mui-components';

import { updateFeatureAttributes } from '~/features/map-features/slice';
import { getGeofencePolygonId } from '~/features/mission/selectors';
import {
  clearGeofencePolygonId,
  setGeofencePolygonId,
} from '~/features/mission/slice';
import { FeatureType } from '~/model/features';
import { hasFeature } from '~/utils/configuration';
import { createValidator, optional, positive } from '~/utils/validation';

const hasGeofenceFeature = hasFeature('geofence');

// PERF: Optimize this, it has lots of unnecessary recomputes
const FeatureAttributesForm = ({
  clearGeofencePolygonId,
  feature,
  featureId,
  isGeofence,
  onSetFeatureAttributes,
  setGeofencePolygonId,
  t,
}) => {
  switch (feature.type) {
    case FeatureType.POLYGON: {
      return (
        <Form
          key={`${featureId}-${isGeofence}`}
          initialValues={{
            ...feature.attributes,
            isGeofence,
          }}
          validate={createValidator({
            minAltitude: optional(positive),
            maxAltitude: optional(positive),
          })}
          onSubmit={({
            isExclusionZone,
            isGeofence: useAsGeofence,
            minAltitude,
            maxAltitude,
          }) => {
            if (hasGeofenceFeature) {
              if (useAsGeofence && !isGeofence) {
                setGeofencePolygonId(featureId);
              } else if (!useAsGeofence && isGeofence) {
                clearGeofencePolygonId();
              }
            }

            onSetFeatureAttributes({
              isExclusionZone: useAsGeofence ? false : isExclusionZone,
              minAltitude: Number(minAltitude) || undefined,
              maxAltitude: Number(maxAltitude) || undefined,
            });
          }}
        >
          {({ form, values }) => (
            <div>
              {hasGeofenceFeature && (
                <>
                  <Checkboxes
                    name='isGeofence'
                    data={{
                      label: t('featureEditorDialog.attributes.geofence'),
                    }}
                    disabled={values.isExclusionZone}
                  />
                  <FormHelperText style={{ marginTop: -8, marginBottom: 8 }}>
                    {t('featureEditorDialog.attributes.geofenceHelper')}
                  </FormHelperText>
                </>
              )}

              <Checkboxes
                name='isExclusionZone'
                data={{
                  label: t('featureEditorDialog.attributes.exclusionZone'),
                }}
                disabled={values.isGeofence}
              />
              <FormHelperText style={{ marginTop: -8, marginBottom: 8 }}>
                {t('featureEditorDialog.attributes.exclusionZoneHelper')}
              </FormHelperText>

              <TextField
                name='minAltitude'
                label={t('featureEditorDialog.attributes.minAltitude')}
                disabled={!values.isExclusionZone}
                slotProps={{
                  input: {
                    endAdornment: (
                      <InputAdornment position='end'>m</InputAdornment>
                    ),
                    inputProps: {
                      inputMode: 'numeric',
                    },
                  },
                }}
              />
              <FormHelperText style={{ marginBottom: 8 }}>
                {t('featureEditorDialog.attributes.minAltitudeHelper')}
              </FormHelperText>

              <TextField
                name='maxAltitude'
                label={t('featureEditorDialog.attributes.maxAltitude')}
                disabled={!values.isExclusionZone}
                slotProps={{
                  input: {
                    endAdornment: (
                      <InputAdornment position='end'>m</InputAdornment>
                    ),
                    inputProps: {
                      inputMode: 'numeric',
                    },
                  },
                }}
              />
              <FormHelperText style={{ marginBottom: 8 }}>
                {t('featureEditorDialog.attributes.maxAltitudeHelper')}
              </FormHelperText>

              {/* HACK: Forms are not meant to be used like this... */}
              <FormSpy
                subscription={{ values: true }}
                onChange={() => form.submit()}
              />
            </div>
          )}
        </Form>
      );
    }

    default: {
      return (
        <BackgroundHint
          text={t('featureEditorDialog.attributes.unsupportedFeatureType')}
        />
      );
    }
  }
};

FeatureAttributesForm.propTypes = {
  clearGeofencePolygonId: PropTypes.func,
  feature: PropTypes.object.isRequired,
  featureId: PropTypes.string,
  isGeofence: PropTypes.bool,
  onSetFeatureAttributes: PropTypes.func,
  setGeofencePolygonId: PropTypes.func,
  t: PropTypes.func,
};

export default connect(
  // mapStateToProps
  (state, { featureId }) => ({
    isGeofence: getGeofencePolygonId(state) === featureId,
  }),
  // mapDispatchToProps
  (dispatch, { featureId }) => ({
    clearGeofencePolygonId: () => dispatch(clearGeofencePolygonId()),
    onSetFeatureAttributes(attributes) {
      dispatch(updateFeatureAttributes({ id: featureId, attributes }));
    },
    setGeofencePolygonId: () => dispatch(setGeofencePolygonId(featureId)),
  })
)(withTranslation()(FeatureAttributesForm));
