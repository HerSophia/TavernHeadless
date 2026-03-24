import { z } from 'zod';
import type { STChatHeader, STChatMessage } from '../types/chat.js';

// ── Public Types ─────────────────────────────────────

/** parseChatFile 的返回值 */
export interface ParsedChat {
  header: STChatHeader;
  messages: STChatMessage[];
  /** 解析过程中跳过的行数（空行 + 解析失败的行） */
  skippedLines: number;
}

/** 消息分组后的楼层 */
export interface FloorGroup {
  floorNo: number;
  messages: GroupedMessage[];
}

/** 分组后的单条消息，已确定楼层归属和页信息 */
export interface GroupedMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  pageNo: number;
  pageKind: 'input' | 'output';
  isHidden: boolean;
  name: string;
  sendDate: number;
  extra?: Record<string, unknown>;
  /** 拍平后的 swipes 字符串列表（已含 mes 本身） */
  swipes?: string[];
  /** 当前选中的 swipe 索引 */
  swipeId?: number;
}

// ── Zod Schemas ────────────────────────────────────

const chatHeaderSchema = z.object({
  chat_metadata: z.record(z.unknown()).optional(),
  user_name: z.string().optional(),
  character_name: z.string().optional(),
  name: z.string().optional(),
}).passthrough();

const chatMessageSchema = z.object({
  name: z.string(),
  is_user: z.boolean(),
  mes: z.union([z.string(), z.record(z.unknown())]),
  send_date: z.union([z.string(), z.number()]).optional(),
  extra: z.record(z.unknown()).optional(),
  swipes: z.array(z.union([z.string(), z.record(z.unknown())])).optional(),
  swipe_id: z.number().optional(),
  is_system: z.boolean().optional(),
}).passthrough();

// ── send_date 容错解析 ─────────────────────────────

/**
 * 容错解析 send_date。
 *
 * - number → 直接返回（视为 Unix 毫秒）
 * - string → Date.parse()，失败则 Date.now()
 * - undefined/null → Date.now()
 */
export function parseSendDate(value: string | number | undefined | null): number {
  if (value === undefined || value === null) return Date.now();
  if (typeof value === 'number') return value;
  const parsed = Date.parse(value);
  return isNaN(parsed) ? Date.now() : parsed;
}

// ── Chub Chat 兼容处理 ──────────────────────────────

/** 将可能为对象的 mes 拍平为字符串 */
function flattenMes(mes: string | { message?: string; [key: string]: unknown }): string {
  if (typeof mes === 'string') return mes;
  if (typeof mes === 'object' && mes !== null && typeof mes.message === 'string') {
    return mes.message;
  }
  return '';
}

/** 将可能为对象的 swipe 元素拍平为字符串 */
function flattenSwipe(swipe: string | { message?: string; [key: string]: unknown }): string {
  if (typeof swipe === 'string') return swipe;
  if (typeof swipe === 'object' && swipe !== null && typeof swipe.message === 'string') {
    return swipe.message;
  }
  return '';
}

// ── parseChatFile ──────────────────────────────────

/**
 * 解析 SillyTavern .jsonl 聊天文件。
 *
 * - 第 0 行为 header，须包含 `chat_metadata`、`user_name`、`name` 三者之一
 * - 第 1~N 行为消息，自动做 Chub Chat 兼容拍平
 * - 空行和解析失败的行会跳过，不中断整个导入
 */
export function parseChatFile(jsonlContent: string): ParsedChat {
  const rawLines = jsonlContent.split('\n');
  let skippedLines = 0;

  // 过滤空行，收集可解析的 JSON 对象
  const parsed: unknown[] = [];
  for (const line of rawLines) {
    const trimmed = line.trim();
    if (trimmed === '') {
      skippedLines++;
      continue;
    }
    try {
      parsed.push(JSON.parse(trimmed));
    } catch {
      skippedLines++;
    }
  }

  if (parsed.length === 0) {
    throw new Error('Chat file is empty: no valid JSON lines found');
  }

  // ── 解析 header（第 0 行）──
  const headerResult = chatHeaderSchema.safeParse(parsed[0]);
  if (!headerResult.success) {
    throw new Error(`Invalid chat header: ${headerResult.error.message}`);
  }
  const header = headerResult.data as STChatHeader;

  // 校验：至少包含三个标志字段之一
  if (
    header.chat_metadata === undefined &&
    header.user_name === undefined &&
    header.name === undefined
  ) {
    throw new Error(
      'Invalid chat header: must contain at least one of chat_metadata, user_name, or name'
    );
  }

  // ── 解析消息（第 1~N 行）──
  const messages: STChatMessage[] = [];
  for (let i = 1; i < parsed.length; i++) {
    const msgResult = chatMessageSchema.safeParse(parsed[i]);
    if (!msgResult.success) {
      skippedLines++;
      continue;
    }
    const raw = msgResult.data;

    // Chub Chat 兼容：拍平 mes
    const mes = flattenMes(raw.mes);

    // Chub Chat 兼容：拍平 swipes
    let swipes: string[] | undefined;
    if (raw.swipes && raw.swipes.length > 0) {
      swipes = raw.swipes.map(flattenSwipe);
    }

    messages.push({
      name: raw.name,
      is_user: raw.is_user,
      mes,
      send_date: raw.send_date,
      extra: raw.extra,
      swipes,
      swipe_id: raw.swipe_id,
      is_system: raw.is_system,
    });
  }

  return { header, messages, skippedLines };
}

// ── groupMessagesIntoFloors ──────────────────────

/**
 * 将扁平消息列表分组为楼层结构。
 *
 * 分组规则：
 * 1. 遇到 user 消息 → 开新楼层，pageNo=0, pageKind='input'
 * 2. 遇到 assistant 消息且当前楼层有 user → 同楼层，pageNo 递增, pageKind='output'
 * 3. 遇到 assistant 消息且当前楼层无 user（如 greeting）→ 同楼层，pageNo 递增, pageKind='output'
 * 4. is_system 消息 → 归入当前楼层，标记 isHidden=true
 */
export function groupMessagesIntoFloors(messages: STChatMessage[]): FloorGroup[] {
  if (messages.length === 0) return [];

  const floors: FloorGroup[] = [];
  let currentFloor: FloorGroup | null = null;
  let floorNo = 0;
  let currentFloorHasUser = false;

  for (const msg of messages) {
    const role = msg.is_system ? 'system' as const
      : msg.is_user ? 'user' as const
      : 'assistant' as const;

    const isHidden = msg.is_system === true;
    const content = typeof msg.mes === 'string' ? msg.mes : flattenMes(msg.mes);
    const sendDate = parseSendDate(msg.send_date);

    // 拍平 swipes——已经在 parseChatFile 中处理过，但安全起见再做一次
    let swipes: string[] | undefined;
    if (msg.swipes && Array.isArray(msg.swipes) && msg.swipes.length > 0) {
      swipes = msg.swipes.map((s) => (typeof s === 'string' ? s : flattenSwipe(s)));
    }

    if (role === 'user') {
      // user 消息总是开新楼层
      currentFloor = { floorNo, messages: [] };
      floors.push(currentFloor);
      currentFloorHasUser = true;

      currentFloor.messages.push({
        role,
        content,
        pageNo: 0,
        pageKind: 'input',
        isHidden,
        name: msg.name,
        sendDate,
        extra: msg.extra,
        swipes,
        swipeId: msg.swipe_id,
      });

      floorNo++;
    } else if (role === 'system') {
      // system 消息归入当前楼层，若无当前楼层则创建一个
      if (!currentFloor) {
        currentFloor = { floorNo, messages: [] };
        floors.push(currentFloor);
        currentFloorHasUser = false;
        floorNo++;
      }

      const pageNo = currentFloor.messages.length;
      currentFloor.messages.push({
        role,
        content,
        pageNo,
        pageKind: 'output',
        isHidden: true,
        name: msg.name,
        sendDate,
        extra: msg.extra,
      });
    } else {
      // assistant 消息
      if (!currentFloor) {
        // 没有前置楼层（如 greeting），创建新楼层
        currentFloor = { floorNo, messages: [] };
        floors.push(currentFloor);
        currentFloorHasUser = false;
        floorNo++;
      }

      const pageNo = currentFloor.messages.length;
      currentFloor.messages.push({
        role,
        content,
        pageNo,
        pageKind: 'output',
        isHidden,
        name: msg.name,
        sendDate,
        extra: msg.extra,
        swipes,
        swipeId: msg.swipe_id,
      });
    }
  }

  return floors;
}
