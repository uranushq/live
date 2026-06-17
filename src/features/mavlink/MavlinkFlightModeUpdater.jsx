import delay from 'delay';
import PropTypes from 'prop-types';
import { useEffect } from 'react';
import { connect } from 'react-redux';

import handleError from '~/error-handling';
import { isConnected } from '~/features/servers/selectors';
import {
  getFlightModes,
  parseFltModeSlotsByUavId,
} from '~/utils/mavlinkFlightModes';

import { clearFltModeSlots, setFltModeSlotsByUavId } from './slice';

const POLL_INTERVAL_MS = 5000;

/**
 * Polls the MAVLink REST API for FLTMODE5/FLTMODE6 slot assignments and
 * stores them in Redux for the UAV list and related UI.
 */
const MavlinkFlightModeUpdater = ({
  connected,
  onClear,
  onUpdate,
}) => {
  useEffect(() => {
    if (!connected) {
      onClear();
      return undefined;
    }

    const valueHolder = { finished: false };

    const poll = async () => {
      while (!valueHolder.finished) {
        try {
          const body = await getFlightModes();
          onUpdate(parseFltModeSlotsByUavId(body));
        } catch (error) {
          handleError(error, 'MAVLink flight mode query');
        }

        // eslint-disable-next-line no-await-in-loop
        await delay(POLL_INTERVAL_MS);
      }
    };

    poll();

    return () => {
      valueHolder.finished = true;
    };
  }, [connected, onClear, onUpdate]);

  return null;
};

MavlinkFlightModeUpdater.propTypes = {
  connected: PropTypes.bool,
  onClear: PropTypes.func,
  onUpdate: PropTypes.func,
};

export default connect(
  (state) => ({
    connected: isConnected(state),
  }),
  (dispatch) => ({
    onClear: () => dispatch(clearFltModeSlots()),
    onUpdate: (slotsByUavId) => dispatch(setFltModeSlotsByUavId(slotsByUavId)),
  })
)(MavlinkFlightModeUpdater);
