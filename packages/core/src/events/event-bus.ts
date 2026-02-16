import Emittery from 'emittery';
import type { CoreEventMap } from './event-types.js';

/** 强类型事件总线 */
export type CoreEventBus = Emittery<CoreEventMap>;

/** 创建 Core 事件总线实例 */
export function createEventBus(): CoreEventBus {
  return new Emittery<CoreEventMap>();
}
