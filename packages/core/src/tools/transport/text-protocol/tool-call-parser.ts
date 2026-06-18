import type {
  ParsedToolCall,
  ToolCallParseDiagnostic,
  ToolCallParseInput,
  ToolCallParseOutput,
} from '../transport-types.js';

import {
  TEXT_PROTOCOL_DIAGNOSTIC_EXCERPT_LIMIT,
  TEXT_PROTOCOL_TOOL_CALL_CLOSE,
} from './constants.js';

interface ScannedToolCallBlock {
  start: number;
  end: number;
  attributeText: string;
  bodyText: string;
  excerpt: string;
  malformed: boolean;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function truncateExcerpt(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= TEXT_PROTOCOL_DIAGNOSTIC_EXCERPT_LIMIT) {
    return trimmed;
  }

  return `${trimmed.slice(0, TEXT_PROTOCOL_DIAGNOSTIC_EXCERPT_LIMIT - 1)}…`;
}

function parseAttributes(attributeText: string): {
  attributes: Record<string, string>;
  malformed: boolean;
} {
  const attributes: Record<string, string> = {};
  const pattern = /([a-z][a-z0-9_-]*)\s*=\s*"([^"]*)"/g;
  let match: RegExpExecArray | null;
  let cursor = 0;
  let malformed = false;

  while ((match = pattern.exec(attributeText)) !== null) {
    const leading = attributeText.slice(cursor, match.index).trim();
    if (leading.length > 0) {
      malformed = true;
    }

    const key = match[1];
    if (!key || Object.prototype.hasOwnProperty.call(attributes, key)) {
      malformed = true;
    } else {
      attributes[key] = match[2] ?? '';
    }
    cursor = pattern.lastIndex;
  }

  if (attributeText.slice(cursor).trim().length > 0) {
    malformed = true;
  }

  return { attributes, malformed };
}

function isValidToolName(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_.:-]{0,127}$/.test(value);
}

function findNextToolCallStart(text: string, startIndex: number): number {
  let cursor = startIndex;
  while (cursor < text.length) {
    const candidate = text.indexOf('<tool_call', cursor);
    if (candidate === -1) {
      return -1;
    }

    const after = text[candidate + '<tool_call'.length];
    if (after === undefined || after === '>' || /\s/.test(after)) {
      return candidate;
    }

    cursor = candidate + '<tool_call'.length;
  }

  return -1;
}

function findMatchingToolCallEnd(text: string, bodyStart: number): {
  end: number;
  malformed: boolean;
} {
  let depth = 1;
  let cursor = bodyStart;
  let sawNested = false;

  while (cursor < text.length) {
    const nextStart = findNextToolCallStart(text, cursor);
    const nextClose = text.indexOf(TEXT_PROTOCOL_TOOL_CALL_CLOSE, cursor);

    if (nextClose === -1) {
      return { end: text.length, malformed: true };
    }

    if (nextStart !== -1 && nextStart < nextClose) {
      sawNested = true;
      depth += 1;
      cursor = nextStart + '<tool_call'.length;
      continue;
    }

    depth -= 1;
    cursor = nextClose + TEXT_PROTOCOL_TOOL_CALL_CLOSE.length;
    if (depth === 0) {
      return {
        end: cursor,
        malformed: sawNested,
      };
    }
  }

  return { end: text.length, malformed: true };
}

function scanToolCallBlocks(text: string): ScannedToolCallBlock[] {
  const blocks: ScannedToolCallBlock[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const start = findNextToolCallStart(text, cursor);
    if (start === -1) {
      break;
    }

    const openEnd = text.indexOf('>', start);
    if (openEnd === -1) {
      blocks.push({
        start,
        end: text.length,
        attributeText: '',
        bodyText: '',
        excerpt: truncateExcerpt(text.slice(start)),
        malformed: true,
      });
      break;
    }

    const matched = findMatchingToolCallEnd(text, openEnd + 1);
    const end = matched.end;
    const closeStart = end - TEXT_PROTOCOL_TOOL_CALL_CLOSE.length;

    blocks.push({
      start,
      end,
      attributeText: text.slice(start + '<tool_call'.length, openEnd),
      bodyText: text.slice(openEnd + 1, Math.max(openEnd + 1, closeStart)),
      excerpt: truncateExcerpt(text.slice(start, end)),
      malformed: matched.malformed,
    });
    cursor = end;
  }

  return blocks;
}

function buildParsingDiagnostics(
  blocks: ScannedToolCallBlock[],
  allowedToolNames: ReadonlySet<string>,
): Pick<ToolCallParseOutput, 'calls' | 'diagnostics'> {
  const calls: ParsedToolCall[] = [];
  const diagnostics: ToolCallParseDiagnostic[] = [];
  const seenCallIds = new Set<string>();

  for (const block of blocks) {
    const parsedAttributes = parseAttributes(block.attributeText);
    const attributes = parsedAttributes.attributes;
    const rawCallId = attributes.id?.trim();
    const toolName = attributes.name?.trim() || null;

    if (block.malformed) {
      diagnostics.push({
        callId: rawCallId && rawCallId.length > 0 ? rawCallId : null,
        toolName,
        reason: 'malformed_block',
        excerpt: block.excerpt,
      });
      continue;
    }

    if (parsedAttributes.malformed) {
      diagnostics.push({
        callId: rawCallId && rawCallId.length > 0 ? rawCallId : null,
        toolName,
        reason: 'malformed_attributes',
        excerpt: block.excerpt,
      });
      continue;
    }

    if (!toolName) {
      diagnostics.push({
        callId: rawCallId && rawCallId.length > 0 ? rawCallId : null,
        toolName: null,
        reason: 'missing_tool_name',
        excerpt: block.excerpt,
      });
      continue;
    }

    if (!isValidToolName(toolName)) {
      diagnostics.push({
        callId: rawCallId && rawCallId.length > 0 ? rawCallId : null,
        toolName,
        reason: 'invalid_tool_name',
        excerpt: block.excerpt,
      });
      continue;
    }

    if (!rawCallId || rawCallId.length === 0) {
      diagnostics.push({
        callId: null,
        toolName,
        reason: 'missing_call_id',
        excerpt: block.excerpt,
      });
      continue;
    }

    const callId = rawCallId;

    if (seenCallIds.has(callId)) {
      diagnostics.push({
        callId,
        toolName,
        reason: 'duplicate_call_id',
        excerpt: block.excerpt,
      });
      continue;
    }

    if (!allowedToolNames.has(toolName)) {
      diagnostics.push({
        callId,
        toolName,
        reason: 'tool_not_registered',
        excerpt: block.excerpt,
      });
      continue;
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(block.bodyText.trim());
    } catch {
      diagnostics.push({
        callId,
        toolName,
        reason: 'json_parse_failed',
        excerpt: block.excerpt,
      });
      continue;
    }

    if (!isPlainRecord(parsedBody) || !isPlainRecord(parsedBody.args)) {
      diagnostics.push({
        callId,
        toolName,
        reason: 'missing_args_field',
        excerpt: block.excerpt,
      });
      continue;
    }

    seenCallIds.add(callId);

    calls.push({
      callId,
      toolName,
      args: parsedBody.args,
    });
  }

  return { calls, diagnostics };
}

/**
 * 从文本协议输出中解析 `<tool_call>` 块。
 */
export class TextProtocolToolCallParser {
  parse(input: ToolCallParseInput): ToolCallParseOutput {
    const blocks = scanToolCallBlocks(input.modelOutputText);
    const { calls, diagnostics } = buildParsingDiagnostics(blocks, input.allowedToolNames);

    return {
      calls,
      diagnostics,
      stats: {
        blockCount: blocks.length,
        acceptedCount: calls.length,
        rejectedCount: blocks.length - calls.length,
      },
    };
  }

  stripToolCallBlocks(modelOutputText: string): string {
    const blocks = scanToolCallBlocks(modelOutputText);
    if (blocks.length === 0) {
      return modelOutputText.trim();
    }

    let cursor = 0;
    let output = '';
    for (const block of blocks) {
      output += modelOutputText.slice(cursor, block.start);
      cursor = block.end;
    }
    output += modelOutputText.slice(cursor);

    return output.trim();
  }
}
