export type FltModeSlots = {
  fltMode5?: number;
  fltMode6?: number;
};

export type MavlinkSliceState = {
  fltModeSlotsByUavId: Record<string, FltModeSlots>;
  lastUpdatedAt?: number;
};
