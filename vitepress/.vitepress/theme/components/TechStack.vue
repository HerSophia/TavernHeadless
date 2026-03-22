<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

const stacks = [
  { layer: '后端框架', tech: 'Fastify', svg: 'bolt' },
  { layer: '语言', tech: 'TypeScript', svg: 'code' },
  { layer: '数据库', tech: 'SQLite + Drizzle ORM', svg: 'database' },
  { layer: 'LLM 接入', tech: 'Vercel AI SDK', svg: 'cpu' },
  { layer: '事件系统', tech: 'emittery', svg: 'signal' },
  { layer: '前端（管理台）', tech: 'Vue 3 + Pinia + TailwindCSS', svg: 'layout' },
  { layer: '包管理', tech: 'pnpm (monorepo)', svg: 'package' },
]

const tree = [
  { name: 'TavernHeadless/', indent: 0, type: 'root' },
  { name: 'apps/', indent: 1, type: 'dir' },
  { name: 'api/', indent: 2, type: 'dir', comment: '后端服务（Fastify）' },
  { name: 'web/', indent: 2, type: 'dir', comment: '管理前端（Vue 3）' },
  { name: 'packages/', indent: 1, type: 'dir' },
  { name: 'core/', indent: 2, type: 'dir', comment: '核心引擎逻辑' },
  { name: 'adapters-sillytavern/', indent: 2, type: 'dir', comment: '酒馆兼容层' },
  { name: 'shared/', indent: 2, type: 'dir', comment: '公共类型和工具函数' },
  { name: 'vitepress/', indent: 1, type: 'dir', comment: '文档站（本站）' },
  { name: 'docs/', indent: 1, type: 'dir', comment: '原始文档' },
]

// 鼠标追光
const gridRef = ref<HTMLElement | null>(null)
const cardRefs = ref<HTMLElement[]>([])

const handleMouseMove = (e: MouseEvent) => {
  for (const card of cardRefs.value) {
    const rect = card.getBoundingClientRect()
    card.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`)
    card.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`)
  }
}

// 滚动入场
const visibleSet = ref(new Set<string>())
let observer: IntersectionObserver | null = null

onMounted(() => {
  gridRef.value?.addEventListener('mousemove', handleMouseMove)

  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const id = (entry.target as HTMLElement).dataset.id
          if (id) visibleSet.value.add(id)
          observer?.unobserve(entry.target)
        }
      }
    },
    { threshold: 0.1 }
  )

  for (const card of cardRefs.value) {
    observer.observe(card)
  }

  // 观察 tree 容器
  const treeEl = document.querySelector('.tree-window')
  if (treeEl) observer.observe(treeEl)
})

onUnmounted(() => {
  gridRef.value?.removeEventListener('mousemove', handleMouseMove)
  observer?.disconnect()
})
</script>

<template>
  <section class="tech-section">
    <!-- 技术栈 -->
    <div class="section-header">
      <h2 class="section-title">技术栈</h2>
      <p class="section-desc">现代化工具链，为稳定性和开发效率而选</p>
    </div>

    <div ref="gridRef" class="stack-grid">
      <div
        v-for="(item, idx) in stacks"
        :key="item.layer"
        :ref="(el) => { if (el) cardRefs[idx] = el as HTMLElement }"
        :data-id="'stack-' + idx"
        class="stack-card"
        :class="{ visible: visibleSet.has('stack-' + idx) }"
        :style="{ transitionDelay: `${idx * 60}ms` }"
      >
        <div class="stack-glow"></div>
        <div class="stack-inner">
          <span class="stack-icon">
            <!-- bolt -->
            <svg v-if="item.svg === 'bolt'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
            </svg>
            <!-- code -->
            <svg v-else-if="item.svg === 'code'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="16 18 22 12 16 6"/>
              <polyline points="8 6 2 12 8 18"/>
            </svg>
            <!-- database -->
            <svg v-else-if="item.svg === 'database'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <ellipse cx="12" cy="5" rx="9" ry="3"/>
              <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
              <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
            </svg>
            <!-- cpu -->
            <svg v-else-if="item.svg === 'cpu'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="4" y="4" width="16" height="16" rx="2"/>
              <rect x="9" y="9" width="6" height="6"/>
              <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/>
            </svg>
            <!-- signal -->
            <svg v-else-if="item.svg === 'signal'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M2 20h.01M7 20v-4M12 20v-8M17 20V8M22 20V4"/>
            </svg>
            <!-- layout -->
            <svg v-else-if="item.svg === 'layout'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <path d="M3 9h18M9 21V9"/>
            </svg>
            <!-- package -->
            <svg v-else-if="item.svg === 'package'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M16.5 9.4l-9-5.19M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>
              <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
              <line x1="12" y1="22.08" x2="12" y2="12"/>
            </svg>
          </span>
          <div class="stack-text">
            <span class="stack-layer">{{ item.layer }}</span>
            <span class="stack-tech">{{ item.tech }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 项目结构 -->
    <div class="section-header" style="margin-top: 80px">
      <h2 class="section-title">项目结构</h2>
      <p class="section-desc">Monorepo 架构，职责分层清晰</p>
    </div>

    <div
      class="tree-window"
      :class="{ visible: visibleSet.has(undefined as any) || visibleSet.size > 3 }"
      data-id="tree"
    >
      <div class="tree-header">
        <div class="tree-dots">
          <span class="dot dot-r"></span>
          <span class="dot dot-y"></span>
          <span class="dot dot-g"></span>
        </div>
        <span class="tree-title">project structure</span>
      </div>
      <div class="tree-body">
        <div
          v-for="(node, idx) in tree"
          :key="idx"
          class="tree-line"
          :style="{ paddingLeft: `${node.indent * 24 + 16}px`, animationDelay: `${idx * 80}ms` }"
        >
          <span v-if="node.type === 'root'" class="tree-name root">{{ node.name }}</span>
          <span v-else class="tree-name">
            <span class="tree-branch">{{ node.indent === 2 ? '├── ' : '├── ' }}</span>
            <span :class="node.type === 'dir' ? 'dir' : 'file'">{{ node.name }}</span>
          </span>
          <span v-if="node.comment" class="tree-comment"># {{ node.comment }}</span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.tech-section {
  width: 100vw;
  margin-left: calc(50% - 50vw);
  padding: 100px 24px 120px;
}

/* ========== 标题 ========== */
.section-header {
  text-align: center;
  margin-bottom: 48px;
}

.section-title {
  font-size: 32px;
  font-weight: 700;
  color: var(--vp-c-text-1);
  margin: 0 0 12px;
  border: none !important;
  padding: 0 !important;
}

.section-desc {
  font-size: 15px;
  color: var(--vp-c-text-3);
  margin: 0;
}

/* ========== 技术栈网格 ========== */
.stack-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 12px;
  max-width: 960px;
  margin: 0 auto;
}

/* 卡片 */
.stack-card {
  position: relative;
  border-radius: 10px;
  padding: 1px;
  background: var(--vp-c-divider);
  opacity: 0;
  transform: translateY(20px);
  transition: opacity 0.5s ease, transform 0.5s ease;
}

.stack-card.visible {
  opacity: 1;
  transform: none;
}

/* 追光 */
.stack-glow {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  opacity: 0;
  transition: opacity 0.3s ease;
  background: radial-gradient(
    300px circle at var(--mouse-x) var(--mouse-y),
    rgba(45, 212, 191, 0.2),
    transparent 40%
  );
}

.stack-card:hover .stack-glow {
  opacity: 1;
}

.stack-inner {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 20px;
  border-radius: 9px;
  background: var(--vp-c-bg);
  transition: background 0.3s ease;
}

.stack-card:hover .stack-inner {
  background: var(--vp-c-bg-soft);
}

.stack-icon {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: rgba(45, 212, 191, 0.08);
  color: var(--vp-c-brand-1);
}

.stack-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stack-layer {
  font-size: 12px;
  color: var(--vp-c-text-3);
  font-weight: 500;
  letter-spacing: 0.02em;
}

.stack-tech {
  font-size: 14px;
  color: var(--vp-c-text-1);
  font-weight: 600;
}

/* ========== 项目结构 ========== */
.tree-window {
  max-width: 760px;
  margin: 0 auto;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  overflow: hidden;
  background: #0d1117;
  box-shadow: 0 20px 40px -12px rgba(0, 0, 0, 0.4);
  opacity: 0;
  transform: translateY(24px);
  transition: opacity 0.7s ease, transform 0.7s ease;
}

.tree-window.visible {
  opacity: 1;
  transform: none;
}

.tree-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  background: #161b22;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.tree-dots {
  display: flex;
  gap: 6px;
}

.dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
}

.dot-r { background: #ff5f56; }
.dot-y { background: #ffbd2e; }
.dot-g { background: #27c93f; }

.tree-title {
  flex: 1;
  text-align: center;
  color: #484f58;
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  margin-left: -40px;
}

.tree-body {
  padding: 24px 0;
  font-family: var(--vp-font-family-mono);
  font-size: 15px;
  line-height: 1.8;
}

.tree-line {
  display: flex;
  gap: 12px;
  padding-right: 16px;
  animation: tree-fade-in 0.4s ease both;
}

@keyframes tree-fade-in {
  from {
    opacity: 0;
    transform: translateX(-8px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.tree-name {
  color: #c9d1d9;
  white-space: nowrap;
}

.tree-name.root {
  color: var(--vp-c-brand-1);
  font-weight: 700;
}

.tree-branch {
  color: #484f58;
}

.tree-name .dir {
  color: #79c0ff;
}

.tree-name .file {
  color: #c9d1d9;
}

.tree-comment {
  color: #484f58;
  font-size: 13px;
  margin-left: auto;
}

/* ========== 深色适配 ========== */
.dark .stack-inner {
  background: rgba(18, 18, 21, 0.85);
}

.dark .stack-card {
  background: rgba(255, 255, 255, 0.08);
}

.dark .stack-card:hover {
  background: rgba(45, 212, 191, 0.15);
}

/* ========== 亮色适配 ========== */
:root:not(.dark) .tree-window {
  background: #fafafa;
  border-color: rgba(0, 0, 0, 0.1);
  box-shadow: 0 20px 40px -12px rgba(0, 0, 0, 0.1);
}

:root:not(.dark) .tree-header {
  background: #f0f0f0;
  border-bottom-color: rgba(0, 0, 0, 0.06);
}

:root:not(.dark) .tree-body {
  color: #1a1a1a;
}

:root:not(.dark) .tree-name {
  color: #1a1a1a;
}

:root:not(.dark) .tree-name .dir {
  color: #0969da;
}

:root:not(.dark) .tree-branch {
  color: #afb8c1;
}

:root:not(.dark) .tree-comment {
  color: #afb8c1;
}

:root:not(.dark) .tree-title {
  color: #afb8c1;
}
</style>
