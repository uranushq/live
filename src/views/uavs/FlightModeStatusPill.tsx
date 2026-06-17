import React from 'react';
import { Status } from '@skybrush/app-theme-mui';
import { StatusPill } from '@skybrush/mui-components';

import { abbreviateFlightMode, type FlightMode } from '~/model/enums';

export type FlightModeStatusPillProps = Readonly<{
  className?: string;
  label?: string;
  mode?: FlightMode;
}>;

export const FlightModeStatusPill = ({
  label,
  mode,
  ...rest
}: FlightModeStatusPillProps) => (
  <StatusPill inline status={Status.OFF} {...rest}>
    {label ?? (mode ? abbreviateFlightMode(mode) : '----')}
  </StatusPill>
);

export default FlightModeStatusPill;
