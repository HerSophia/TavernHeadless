import { describe, expect, it } from 'vitest';

import * as browser from '../browser.js';

/**
 * B10 阶段 1 守卫：`@tavern/core/node-graph` 浏览器安全子路径。
 *
 * 1. 必须导出前端 v0 需要的纯图逻辑（validator / registry / types / condition / migration）。
 * 2. 必须**不**暴露 package-export 符号（`exportNodeGraphPackage` / `computeNodeGraphPackageContentHash`），
 *    它们经 `package/export.ts` 依赖 `node:crypto`，不可进入浏览器包。
 */
describe('node-graph browser subpath', () => {
  it('exposes the pure graph logic needed by the editor', () => {
    expect(typeof browser.validateNodeGraph).toBe('function');
    expect(typeof browser.createDefaultNodeTypeRegistry).toBe('function');
    expect(typeof browser.compileNodeGraph).toBe('function');
    expect(typeof browser.migrateNodeGraphDocumentToV2).toBe('function');
    expect(typeof browser.evaluateNodeGraphCondition).toBe('function');
    expect(Array.isArray(browser.NODE_GRAPH_BUILTIN_NODE_TYPES)).toBe(true);
    expect(browser.NODE_GRAPH_BUILTIN_NODE_TYPES.length).toBeGreaterThan(0);
    expect(Array.isArray(browser.NODE_GRAPH_SUPPORTED_SCHEMA_VERSIONS)).toBe(true);
  });

  it('does not expose package-export symbols that depend on node:crypto', () => {
    const exported = browser as Record<string, unknown>;
    expect(exported.exportNodeGraphPackage).toBeUndefined();
    expect(exported.computeNodeGraphPackageContentHash).toBeUndefined();
    expect(exported.parseNodeGraphPackage).toBeUndefined();
    expect(exported.preflightNodeGraphPackage).toBeUndefined();
  });

  it('runs validator end to end on a minimal document', () => {
    const registry = browser.createDefaultNodeTypeRegistry();
    const result = browser.validateNodeGraph(
      {
        schemaVersion: 2,
        graphId: 'g_browser_guard',
        name: 'guard',
        mode: 'native_graph',
        nodes: [
          {
            id: 'n_input',
            type: 'source.user_input',
            typeVersion: '1',
            phase: 'pre_response',
          },
        ],
        edges: [],
        policies: {},
      },
      { registry },
    );
    expect(result).toBeTruthy();
    expect(Array.isArray(result.diagnostics)).toBe(true);
  });
});
