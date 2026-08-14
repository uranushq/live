import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { createSelector } from '@reduxjs/toolkit';

import { ComplexAvatar } from '~/components/avatar';
import {
  getGeofencePolygonInWorldCoordinates,
  getReverseMissionMapping,
  hasActiveGeofencePolygon,
} from '~/features/mission/selectors';
import { isUavOutsideActiveGeofence } from '~/features/safety/selectors';
import { getBatteryFormatter } from '~/features/settings/selectors';
import {
  createSingleUAVStatusSummarySelector,
  getUAVById,
} from '~/features/uavs/selectors';
import { getUavBorderColor, getUavBorderReason } from '~/features/uavs/uavAlert';
import { formatMissionId } from '~/utils/formatting';

/**
 * Connected component that takes a ComplexAvatar and dresses it up to show the
 * status of a single drone.
 */
const DroneAvatar = connect(
  // mapStateToProps
  () => {
    const statusSummarySelector = createSingleUAVStatusSummarySelector();

    return createSelector(
      getBatteryFormatter,
      getReverseMissionMapping,
      (state, { id }) => statusSummarySelector(state, id),
      (state, { id }) => getUAVById(state, id),
      getGeofencePolygonInWorldCoordinates,
      hasActiveGeofencePolygon,
      (_state, ownProps) => ownProps,
      (
        batteryFormatter,
        reverseMissionMapping,
        statusSummary,
        uav,
        geofencePoints,
        geofenceSet,
        { hint, id, label, selected, variant = 'full' }
      ) => {
        const uavOutsideGeofence = isUavOutsideActiveGeofence(
          uav,
          geofencePoints,
          geofenceSet
        );
        const props = {
          batteryFormatter,
          selected,
          borderColor: getUavBorderColor(
            getUavBorderReason(uav, { uavOutsideGeofence })
          ),
          ...statusSummary,
        };

        if (!hint && (!label || label === id) && id in reverseMissionMapping) {
          props.hint = formatMissionId(reverseMissionMapping[id]);
        }

        if (variant !== 'full') {
          delete props.batteryStatus;
          delete props.text;
          delete props.details;
        }

        return props;
      }
    );
  }
)(ComplexAvatar);

DroneAvatar.propTypes = {
  id: PropTypes.string,
  variant: PropTypes.oneOf(['full', 'minimal']),
};

export default DroneAvatar;
