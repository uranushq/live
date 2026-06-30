import { CANCEL } from 'redux-saga';

import { transformMissionItemBeforeUpload } from '~/features/mission/upload';
import { JobScope } from '~/features/upload/jobs';
import messageHub from '~/message-hub';
import { MissionItemType } from '~/model/missions';

import { JOB_TYPE } from './constants';
import { getGeofenceUploadSpecification } from './geofenceUploadPayload';

/**
 * Selector that returns the payload of the geofence upload job.
 */
export const getGeofenceUploadJobPayload = (state) => ({
  version: 1,
  name: 'geofence-upload',
  items: [
    transformMissionItemBeforeUpload(
      { type: MissionItemType.UPDATE_GEOFENCE, parameters: {} },
      state
    ),
  ],
  startPositions: [],
});

/**
 * Selector that returns the geofence specification to upload for a UAV.
 */
export const getGeofenceUploadDataForUav = (state) =>
  getGeofenceUploadSpecification(state);

/**
 * Handles a geofence upload session to a single drone. Returns a promise that
 * resolves when the geofence has been uploaded. The promise is extended with a
 * cancellation callback for Redux-saga.
 *
 * @param uavId  the ID of the UAV to upload the geofence to
 * @param data   the geofence upload specification
 */
async function runSingleGeofenceUpload({ uavId, data }) {
  const cancelToken = messageHub.createCancelToken();
  const promise = messageHub.execute.uploadGeofence(
    { uavId, data },
    { cancelToken }
  );
  promise[CANCEL] = () => cancelToken.cancel({ allowFailure: true });
  return promise;
}

const spec = {
  executor: runSingleGeofenceUpload,
  selector: getGeofenceUploadDataForUav,
  scope: JobScope.MISSION,
  title: 'Upload geofence',
  type: JOB_TYPE,
};

export default spec;
