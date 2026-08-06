import { type Identifier } from '~/utils/collections';

/**
 * User-defined named group of UAVs for filtering and fleet management.
 */
export type NamedUAVGroup = {
  id: Identifier;
  name: string;
  uavIds: Identifier[];
};
