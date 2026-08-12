/**
 * @file Polls every watched JR board's `/health` every 5 seconds.
 *
 * Mounted once at app level so the JR status stays fresh whether or not the JR
 * control panel is visible. The poll is a self-scheduling loop rather than a
 * `setInterval` so rounds can never overlap: a slow round simply delays the
 * next one instead of piling requests onto unreachable boards.
 *
 * Sending an ARM broadcast switches the poll off (see `broadcastArm`); the
 * panel's toggle switches it back on.
 */

import delay from 'delay';
import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { hasFeature } from '~/utils/configuration';
import { type AppDispatch } from '~/store/reducers';

import { refreshBoardHealthForIps } from './actions';
import {
  getJRMonitorTargetIps,
  isJRHealthCheckEnabled,
} from './selectors';

export const JR_HEALTH_POLL_INTERVAL_MS = 5000;

const JRHealthPoller = (): null => {
  const dispatch = useDispatch<AppDispatch>();
  const enabled = useSelector(isJRHealthCheckEnabled);
  const targetIps = useSelector(getJRMonitorTargetIps);
  // Depend on the joined list so the loop only restarts when the set of boards
  // actually changes, not on every unrelated store update.
  const targetKey = targetIps.join(',');

  useEffect(() => {
    if (!hasFeature('ledShow') || !enabled || !targetKey) {
      return undefined;
    }

    const ips = targetKey.split(',');
    const holder = { finished: false };

    const poll = async () => {
      while (!holder.finished) {
        // eslint-disable-next-line no-await-in-loop
        await dispatch(refreshBoardHealthForIps(ips));
        if (holder.finished) {
          break;
        }

        // eslint-disable-next-line no-await-in-loop
        await delay(JR_HEALTH_POLL_INTERVAL_MS);
      }
    };

    void poll();

    return () => {
      holder.finished = true;
    };
  }, [dispatch, enabled, targetKey]);

  return null;
};

export default JRHealthPoller;
