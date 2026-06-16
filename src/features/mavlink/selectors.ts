import { formatFltModeSlots } from '~/utils/mavlinkFlightModes';

import type { AppSelector } from '~/store/reducers';
import type { RootState } from '~/store/reducers';

export const getFltModeSlotsByUavId = (state: RootState) =>
  state.mavlink.fltModeSlotsByUavId;

export const getFltModeSlotLabelForUavId: AppSelector<
  string | undefined,
  [string]
> = (state, uavId) => {
  const slots = state.mavlink.fltModeSlotsByUavId[uavId];
  if (!slots) {
    return undefined;
  }

  return formatFltModeSlots(slots.fltMode5, slots.fltMode6);
};
