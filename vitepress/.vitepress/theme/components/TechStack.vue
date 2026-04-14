<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

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
  { name: 'apps/', indent: 1, type: 'dir', prefix: '├── ' },
  { name: 'api/', indent: 2, type: 'dir', prefix: '├── ', comment: '后端服务（Fastify）' },
  { name: 'web/', indent: 2, type: 'dir', prefix: '└── ', comment: '管理前端（Vue 3）' },
  { name: 'packages/', indent: 1, type: 'dir', prefix: '├── ' },
  { name: 'core/', indent: 2, type: 'dir', prefix: '├── ', comment: '核心引擎逻辑' },
  { name: 'adapters-sillytavern/', indent: 2, type: 'dir', prefix: '├── ', comment: '酒馆兼容层' },
  { name: 'shared/', indent: 2, type: 'dir', prefix: '├── ', comment: '公共类型和内部共享工具' },
  { name: 'official-integration-kit/', indent: 2, type: 'dir', prefix: '└── ' },
  { name: 'sdk/', indent: 3, type: 'dir', prefix: '├── ', comment: '官方接入基础层' },
  { name: 'client-helpers/', indent: 3, type: 'dir', prefix: '└── ', comment: '官方接入语义层' },
  { name: 'docs/', indent: 1, type: 'dir', prefix: '├── ', comment: '设计文档' },
  { name: 'vitepress/', indent: 1, type: 'dir', prefix: '└── ', comment: '在线文档站' },
]

const gridRef = ref<HTMLElement | null>(null)
const cardRefs = ref<HTMLElement[]>([])
const treeSectionRef = ref<HTMLElement | null>(null)
const treeWindowRef = ref<HTMLElement | null>(null)
const visibleSet = ref(new Set<string>())
const pointerMotionEnabled = ref(false)

let observer: IntersectionObserver | null = null

function syncPointerMotionAvailability() {
  if (typeof window === 'undefined') return

  pointerMotionEnabled.value =
    window.matchMedia('(pointer: fine)').matches &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function resetCardMotion(card?: HTMLElement) {
  if (!card) return

  card.style.setProperty('--card-tilt-x', '0deg')
  card.style.setProperty('--card-tilt-y', '0deg')
}

const handleMouseMove = (event: MouseEvent) => {
  if (!pointerMotionEnabled.value) return

  for (const card of cardRefs.value) {
    const rect = card.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const isInside = x >= 0 && x <= rect.width && y >= 0 && y <= rect.height
    const rotateY = isInside ? ((x / rect.width) - 0.5) * 8 : 0
    const rotateX = isInside ? (0.5 - (y / rect.height)) * 8 : 0

    card.style.setProperty('--card-tilt-x', `${rotateX}deg`)
    card.style.setProperty('--card-tilt-y', `${rotateY}deg`)
  }
}

function handleGridPointerLeave() {
  for (const card of cardRefs.value) {
    resetCardMotion(card)
  }
}

function handleTreePointerMove(event: PointerEvent) {
  if (!pointerMotionEnabled.value || !treeWindowRef.value) return

  const rect = treeWindowRef.value.getBoundingClientRect()
  const x = event.clientX - rect.left
  const y = event.clientY - rect.top
  const rotateY = ((x / rect.width) - 0.5) * 6
  const rotateX = (0.5 - (y / rect.height)) * 5

  treeWindowRef.value.style.setProperty('--tree-tilt-x', `${rotateX}deg`)
  treeWindowRef.value.style.setProperty('--tree-tilt-y', `${rotateY}deg`)
}

function resetTreePointer() {
  if (!treeWindowRef.value) return

  treeWindowRef.value.style.setProperty('--tree-tilt-x', '0deg')
  treeWindowRef.value.style.setProperty('--tree-tilt-y', '0deg')
}

onMounted(() => {
  syncPointerMotionAvailability()
  gridRef.value?.addEventListener('mousemove', handleMouseMove)
  gridRef.value?.addEventListener('mouseleave', handleGridPointerLeave)

  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const id = (entry.target as HTMLElement).dataset.id
          if (id) {
            visibleSet.value.add(id)
          }
          observer?.unobserve(entry.target)
        }
      }
    },
    { threshold: 0.18 }
  )

  for (const card of cardRefs.value) {
    observer.observe(card)
  }

  if (treeSectionRef.value) {
    observer.observe(treeSectionRef.value)
  }

  resetTreePointer()
})

onUnmounted(() => {
  gridRef.value?.removeEventListener('mousemove', handleMouseMove)
  gridRef.value?.removeEventListener('mouseleave', handleGridPointerLeave)
  observer?.disconnect()
})
</script>

<template>
  <div class="tech-sections">
    <section
      id="landing-tech"
      class="tech-section landing-fullscreen"
      data-landing-section="tech"
      data-section-title="技术选型"
      data-section-label="技术"
    >
      <div class="landing-shell tech-shell">
        <div class="section-header">
          <h2 class="section-title">技术选型</h2>
        </div>

        <div ref="gridRef" class="stack-grid">
          <div
            v-for="(item, index) in stacks"
            :key="item.layer"
            :ref="(el) => { if (el) cardRefs[index] = el as HTMLElement }"
            :data-id="'stack-' + index"
            class="stack-card"
            :class="{ visible: visibleSet.has('stack-' + index) }"
            :style="{ transitionDelay: `${index * 60}ms` }"
          >
            <div class="stack-inner">
              <span class="stack-icon">
                <svg v-if="item.svg === 'bolt'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                </svg>
                <svg v-else-if="item.svg === 'code'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="16 18 22 12 16 6" />
                  <polyline points="8 6 2 12 8 18" />
                </svg>
                <svg v-else-if="item.svg === 'database'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <ellipse cx="12" cy="5" rx="9" ry="3" />
                  <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                  <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                </svg>
                <svg v-else-if="item.svg === 'cpu'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="4" y="4" width="16" height="16" rx="2" />
                  <rect x="9" y="9" width="6" height="6" />
                  <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" />
                </svg>
                <svg v-else-if="item.svg === 'signal'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M2 20h.01M7 20v-4M12 20v-8M17 20V8M22 20V4" />
                </svg>
                <svg v-else-if="item.svg === 'layout'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <path d="M3 9h18M9 21V9" />
                </svg>
                <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M16.5 9.4l-9-5.19M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                  <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                  <line x1="12" y1="22.08" x2="12" y2="12" />
                </svg>
              </span>

              <div class="stack-text">
                <span class="stack-layer">{{ item.layer }}</span>
                <span class="stack-tech">{{ item.tech }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section
      id="landing-structure"
      ref="treeSectionRef"
      class="structure-section landing-fullscreen"
      data-id="tree"
      data-landing-section="structure"
      data-section-title="仓库结构"
      data-section-label="结构"
    >
      <div class="landing-shell structure-shell">
        <div class="section-header">
          <h2 class="section-title">仓库结构</h2>
          <p class="section-desc">@tavern/sdk 和 @tavern/client-helpers 对外提供接入，其他包按职责划分。</p>
        </div>

        <div
          ref="treeWindowRef"
          class="tree-window"
          :class="{ visible: visibleSet.has('tree') }"
          @pointermove="handleTreePointerMove"
          @pointerleave="resetTreePointer"
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
              v-for="(node, index) in tree"
              :key="index"
              class="tree-line"
              :style="{ paddingLeft: `${node.indent * 24 + 16}px`, animationDelay: `${index * 70}ms` }"
            >
              <span v-if="node.type === 'root'" class="tree-name root">{{ node.name }}</span>
              <span v-else class="tree-name">
                <span class="tree-branch">{{ node.prefix }}</span>
                <span :class="node.type === 'dir' ? 'dir' : 'file'">{{ node.name }}</span>
              </span>
              <span v-if="node.comment" class="tree-comment"># {{ node.comment }}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.tech-section {
  background: linear-gradient(180deg, rgba(45, 212, 191, 0.03), transparent 24%);
}

.structure-section {
  background: radial-gradient(circle at 50% 10%, rgba(129, 140, 248, 0.08), transparent 34%);
}

.tech-shell,
.structure-shell {
  gap: 30px;
}

.section-header {
  max-width: 760px;
  margin: 0 auto;
  text-align: center;
}

.section-title {
  margin: 0 0 12px;
  font-size: clamp(30px, 4vw, 44px);
  font-weight: 800;
  line-height: 1.1;
  letter-spacing: -0.03em;
  color: var(--vp-c-text-1);
  border: none !important;
  padding: 0 !important;
}

.section-desc {
  margin: 0;
  font-size: 15px;
  line-height: 1.8;
  color: var(--vp-c-text-2);
}

.stack-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}

.stack-card {
  --card-tilt-x: 0deg;
  --card-tilt-y: 0deg;
  position: relative;
  border-radius: 16px;
  padding: 1px;
  background: var(--landing-card-border);
  opacity: 0;
  transform: translateY(20px);
  transition: opacity 0.5s ease, transform 0.5s ease;
}

.stack-card.visible {
  opacity: 1;
  transform: none;
}

.stack-inner {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px 18px;
  border-radius: 15px;
  background: var(--landing-card-bg);
  transform: perspective(960px) rotateX(var(--card-tilt-x)) rotateY(var(--card-tilt-y));
  transform-style: preserve-3d;
  transition: background 0.3s ease, transform 0.25s ease;
}

.stack-card:hover .stack-inner {
  background: var(--landing-card-bg-hover);
  transform: translate3d(0, -1px, 0) perspective(960px) rotateX(var(--card-tilt-x)) rotateY(var(--card-tilt-y));
}

.stack-icon {
  flex-shrink: 0;
  width: 38px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: var(--landing-icon-bg);
  color: var(--vp-c-brand-1);
  transform: translateZ(14px);
  transition: transform 0.25s ease, background 0.25s ease;
}

.stack-card:hover .stack-icon {
  transform: translateZ(20px) scale(1.04);
  background: var(--landing-icon-bg-hover);
}

.stack-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stack-layer {
  font-size: 12px;
  color: var(--landing-card-muted);
  font-weight: 500;
  letter-spacing: 0.02em;
}

.stack-tech {
  font-size: 14px;
  color: var(--landing-card-title);
  font-weight: 600;
  line-height: 1.6;
}

.tree-window {
  --tree-tilt-x: 0deg;
  --tree-tilt-y: 0deg;
  width: 100%;
  max-width: 920px;
  margin: 0 auto;
  border-radius: 18px;
  border: 1px solid var(--landing-card-border);
  overflow: hidden;
  background: var(--landing-card-bg);
  box-shadow: 0 20px 40px -12px rgba(0, 0, 0, 0.15);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  opacity: 0;
  transform: translateY(24px) perspective(1200px) rotateX(var(--tree-tilt-x)) rotateY(var(--tree-tilt-y));
  transition: opacity 0.7s ease, transform 0.28s ease;
}

.tree-window.visible {
  opacity: 1;
  transform: translateY(0) perspective(1200px) rotateX(var(--tree-tilt-x)) rotateY(var(--tree-tilt-y));
}

.tree-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  background: rgba(127, 127, 127, 0.08);
  border-bottom: 1px solid var(--landing-card-border);
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
  color: var(--landing-card-muted);
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  margin-left: -40px;
}

.tree-body {
  padding: 20px 0;
  font-family: var(--vp-font-family-mono);
  font-size: 14px;
  line-height: 1.72;
}

.tree-line {
  display: flex;
  gap: 12px;
  position: relative;
  border-radius: 10px;
  padding-right: 16px;
  transition: transform 0.22s ease, background 0.22s ease, box-shadow 0.22s ease;
  animation: tree-fade-in 0.4s ease both;
}

.tree-line:hover {
  transform: translateX(4px);
  background: rgba(45, 212, 191, 0.06);
  box-shadow: inset 2px 0 0 rgba(45, 212, 191, 0.4);
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
  color: var(--landing-card-title);
  white-space: nowrap;
}

.tree-name.root {
  color: var(--vp-c-brand-1);
  font-weight: 700;
}

.tree-branch {
  color: var(--landing-card-muted);
}

.tree-name .dir {
  color: #3b82f6;
}

.tree-name .file {
  color: var(--landing-card-title);
}

.tree-comment {
  color: var(--landing-card-muted);
  font-size: 13px;
  margin-left: auto;
}

@media (pointer: coarse), (prefers-reduced-motion: reduce) {
  .stack-inner,
  .stack-card:hover .stack-inner,
  .stack-icon,
  .stack-card:hover .stack-icon,
  .tree-window,
  .tree-window.visible {
    transform: none !important;
  }
}

@media (max-width: 1040px) {
  .stack-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .stack-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .tree-comment {
    display: none;
  }
}

@media (max-width: 520px) {
  .stack-grid {
    grid-template-columns: 1fr;
  }
}
</style>
