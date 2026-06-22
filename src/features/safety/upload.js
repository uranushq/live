import { CANCEL } from 'redux-saga';

import { transformMissionItemBeforeUpload } from '~/features/mission/upload';
import { JobScope } from '~/features/upload/jobs';
import messageHub from '~/message-hub';
import { MissionItemType } from '~/model/missions';

import { JOB_TYPE } from './constants';

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
 * Handles a geofence upload session to a single drone. Returns a promise that
 * resolves when the geofence has been uploaded. The promise is extended with a
 * cancellation callback for Redux-saga.
 *
 * @param uavId    the ID of the UAV to upload the geofence to
 * @param payload  the mission items payload containing the geofence update
 */
async function runSingleGeofenceUpload({ uavId, payload }) {
  const { items } = payload ?? {};

  if (!Array.isArray(items) || items.length === 0) {
    return;
  }

  const cancelToken = messageHub.createCancelToken();
  const promise = messageHub.execute.uploadMission(
    { uavId, data: payload, format: 'skybrush-live/mission-items' },
    { cancelToken }
  );
  promise[CANCEL] = () => cancelToken.cancel({ allowFailure: true });
  return promise;
}

const spec = {
  executor: runSingleGeofenceUpload,
  scope: JobScope.MISSION,
  title: 'Upload geofence',
  type: JOB_TYPE,
};

export default spec;
