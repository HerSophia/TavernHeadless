export const CoreEvents = {
  FLOOR_STATE_CHANGED: 'floor.stateChanged',
  FLOOR_COMMITTED: 'floor.committed',
  FLOOR_FAILED: 'floor.failed',
  VARIABLE_SET: 'variable.set',
  VARIABLE_PROMOTED: 'variable.promoted',
  VARIABLE_DELETED: 'variable.deleted',
  MEMORY_CREATED: 'memory.created',
  MEMORY_UPDATED: 'memory.updated',
  MEMORY_DEPRECATED: 'memory.deprecated',
  MEMORY_CONSOLIDATED: 'memory.consolidated',
} as const;
