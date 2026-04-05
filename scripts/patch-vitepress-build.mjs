/**
 * 修复 Windows 下 VitePress 1.6.4 在构建阶段比较页面路径时
 * 因盘符大小写不同而找不到 page chunk 的问题。
 *
 * 这个补丁只在安装依赖后修改 VitePress 的构建产物，
 * 不改变文档内容和运行时行为。
 */

import fs from 'node:fs'
import path from 'node:path'

const workspaceRoot = process.cwd()
const nodeModulesRoot = path.join(workspaceRoot, 'node_modules')

const replacement = [
  'function resolvePageImports(config, page, result, appChunk) {',
  '  page = config.rewrites.inv[page] || page;',
  '  let srcPath = path$1.resolve(config.srcDir, page);',
  '  try {',
  '    if (!config.vite?.resolve?.preserveSymlinks) {',
  '      srcPath = fs.realpathSync(srcPath);',
  '    }',
  '  } catch (e) {',
  '  }',
  '  srcPath = normalizePath(srcPath);',
  '  const pageChunk = result.output.find(',
  '    (chunk) => chunk.type === "chunk" && chunk.facadeModuleId === srcPath',
  '  ) || result.output.find(',
  '    (chunk) => chunk.type === "chunk" && chunk.facadeModuleId && chunk.facadeModuleId.toLowerCase() === srcPath.toLowerCase()',
  '  );',
  '  if (!pageChunk) {',
  '    throw new Error(',
  '      "[vitepress windows patch] Failed to resolve page chunk for " + page + " (" + srcPath + ")"',
  '    );',
  '  }',
  '  return [',
  '    ...appChunk.imports,',
  '    ...appChunk.dynamicImports,',
  '    ...pageChunk.imports,',
  '    ...pageChunk.dynamicImports',
  '  ];',
  '}',
].join('\n')

const targetPattern = /function resolvePageImports\(config, page, result, appChunk\) \{[\s\S]*?\n\}(?=\nasync function renderHead)/

function collectCandidateFiles(root) {
  const results = []

  function walk(dir) {
    if (!fs.existsSync(dir)) return

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }

      if (
        entry.isFile() &&
        entry.name.startsWith('chunk-') &&
        entry.name.endsWith('.js') &&
        full.includes(`${path.sep}vitepress${path.sep}dist${path.sep}node${path.sep}`)
      ) {
        results.push(full)
      }
    }
  }

  walk(root)
  return results
}

const candidateFiles = collectCandidateFiles(nodeModulesRoot)
let matchedFileCount = 0
let patchedCount = 0
let alreadyPatchedCount = 0

for (const file of candidateFiles) {
  const source = fs.readFileSync(file, 'utf8')
  if (!source.includes('function resolvePageImports(config, page, result, appChunk)')) {
    continue
  }

  matchedFileCount += 1
  const next = source.replace(targetPattern, replacement)

  if (next === source) {
    alreadyPatchedCount += 1
    continue
  }

  fs.writeFileSync(file, next)
  patchedCount += 1
  console.log(`[patch-vitepress-build] patched ${path.relative(workspaceRoot, file)}`)
}

if (matchedFileCount === 0) {
  console.error('[patch-vitepress-build] vitepress build chunk was not found')
  process.exit(1)
}

if (patchedCount === 0 && alreadyPatchedCount === 0) {
  console.error('[patch-vitepress-build] target function was not patchable')
  process.exit(1)
}

if (patchedCount === 0 && alreadyPatchedCount > 0) {
  console.log('[patch-vitepress-build] patch already present')
}
