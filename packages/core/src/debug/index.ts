export type {
  DebugDomain,
  DebugLevel,
  DebugRecord,
  DebugSink,
} from './debug-sink.js';
export {
  configureDebugSink,
  getDebugSink,
  isDebugEnabled,
  emitDebug,
} from './debug-registry.js';
