export const FLOOR_STATES = ['draft', 'generating', 'committed', 'failed'] as const;
export type FloorState = (typeof FLOOR_STATES)[number];
