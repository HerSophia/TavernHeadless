---
outline: [2, 3]
---

# 文档规范

目的很简单：任何一个新来的开发者，靠读文档就能理解系统、找到接口、上手开发。

## 文档体系总览

| 文档 | 位置 | 什么时候更新 |
| ---- | ---- | ---- |
| 项目 README | `README.md` | 功能/技术栈变更时 |
| 包级 README | `packages/*/README.md` | 包的公共 API 变更时 |
| 架构设计 | `docs/architecture.md` | 核心设计变更时 |
| 协作指南 | `docs/contributing.md` | 流程变更时 |
| 测试与 CI | `docs/testing-and-ci.md` | 测试策略变更时 |
| 数据库文档 | `docs/database.md` | schema 变更时 |
| 代码内文档 | 源码中的 JSDoc | 写代码时同步写 |

**硬规则：改了公共 API 但没更新文档的 PR，不予合并。**

## 代码内文档（JSDoc）

### 什么时候必须写

从包中 `export` 出去的所有函数、类、类型、接口、枚举、常量。别人会 `import` 的东西，都要有 JSDoc。

### 函数的 JSDoc 模板

```typescript
/**
 * 按优先级从多个作用域中解析变量值。
 *
 * 查找顺序：page → floor → chat → global。
 *
 * @param key - 变量名
 * @param context - 当前作用域上下文
 * @returns 变量值，如果所有层级都没找到则返回 undefined
 *
 * @example
 * ```typescript
 * const mood = resolver.resolve('mood', {
 *   pageId: 'page_001',
 *   floorId: 'floor_001',
 *   sessionId: 'sess_001',
 * });
 * ```
 *
 * @throws {InvalidScopeError} 如果 context 中缺少必要的 scope ID
 */
resolve(key: string, context: ScopeContext): unknown | undefined;
```

## 格式与风格

- **语言**：项目文档统一使用中文。
- **说人话**：避免没必要的术语。
- **段落短一些**：每段不超过 4-5 行。
- **用示例说话**：抽象描述配一个具体的例子。
- 代码块标注语言。
- 文件内链接用相对路径。
- 图表优先用 Mermaid 或 ASCII art，不贴截图。
