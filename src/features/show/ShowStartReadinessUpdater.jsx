import delay from 'delay';
import PropTypes from 'prop-types';
import { useEffect } from 'react';
import { connect } from 'react-redux';

import handleError from '~/error-handling';
import { isConnected } from '~/features/servers/selectors';
import useMessageHub from '~/hooks/useMessageHub';

import { hasScheduledStartTime } from './selectors';
import { clearShowStartReadiness, setShowStartReadiness } from './slice';

const POLL_INTERVAL_MS = 1000;

/**
 * Polls X-SHOW-READY while a show start time is scheduled, so the UI can show
 * which UAVs have received the start time / authorization.
 */
const ShowStartReadinessUpdater = ({
  connected,
  onClear,
  onStatusChanged,
  period = POLL_INTERVAL_MS,
  shouldPoll,
}) => {
  const messageHub = useMessageHub();

  useEffect(() => {
    if (!connected || !shouldPoll) {
      onClear();
      return undefined;
    }

    const valueHolder = { finished: false };

    const poll = async () => {
      while (!valueHolder.finished) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const status = await messageHub.query.getShowStartReadiness();
          if (!valueHolder.finished) {
            onStatusChanged(status);
          }
        } catch (error) {
          handleError(error, 'Show start readiness query');
        }

        // eslint-disable-next-line no-await-in-loop
        await delay(period);
      }
    };

    poll();

    return () => {
      valueHolder.finished = true;
    };
  }, [connected, messageHub, onClear, onStatusChanged, period, shouldPoll]);

  return null;
};

ShowStartReadinessUpdater.propTypes = {
  connected: PropTypes.bool,
  onClear: PropTypes.func,
  onStatusChanged: PropTypes.func,
  period: PropTypes.number,
  shouldPoll: PropTypes.bool,
};

export default connect(
  (state) => ({
    connected: isConnected(state),
    shouldPoll: hasScheduledStartTime(state),
  }),
  (dispatch) => ({
    onClear: () => dispatch(clearShowStartReadiness()),
    onStatusChanged: (status) => dispatch(setShowStartReadiness(status)),
  })
)(ShowStartReadinessUpdater);
