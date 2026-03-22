<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

const features = [
  {
    title: '兼容 SillyTavern 生态',
    details: '支持导入 Preset、Regex、Worldbook、Character。酒馆预设直接用，无需重新配置。',
  },
  {
    title: '三层消息结构',
    details: '会话 → 楼层 → 消息页，天然支持分支、重试与回放。每个楼层有完整的状态机。',
  },
  {
    title: '四级变量系统',
    details: '全局 / 会话 / 楼层 / 页级变量，优先级清晰。页级沙箱隔离重生成间的状态冲突。',
  },
  {
    title: '提示词编排体系',
    details: '兼容模式与原生流水线并存。统一中间格式（Prompt IR），调试时可完整查看。',
  },
  {
    title: '记忆系统',
    details: '摘要提取、结构化存储、上下文注入、统计与查询。支持自动冲突消解与衰减排序。',
  },
  {
    title: '开发者体验',
    details: 'TypeScript 全栈、OpenAPI 导出、Typed SDK、Swagger UI、SSE 流式、Prompt dry-run。',
  },
]

// ---------- 鼠标追光 ----------
const gridRef = ref<HTMLElement | null>(null)
const cardRefs = ref<HTMLElement[]>([])

const handleMouseMove = (e: MouseEvent) => {
  for (const card of cardRefs.value) {
    const rect = card.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    card.style.setProperty('--mouse-x', `${x}px`)
    card.style.setProperty('--mouse-y', `${y}px`)
  }
}

// ---------- 滚动入场 ----------
const visibleSet = ref(new Set<number>())
let observer: IntersectionObserver | null = null

onMounted(() => {
  // 绑定鼠标事件
  gridRef.value?.addEventListener('mousemove', handleMouseMove)

  // 交叉观察器
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const idx = Number((entry.target as HTMLElement).dataset.idx)
          visibleSet.value.add(idx)
          observer?.unobserve(entry.target)
        }
      }
    },
    { threshold: 0.15 }
  )

  for (const card of cardRefs.value) {
    observer.observe(card)
  }
})

onUnmounted(() => {
  gridRef.value?.removeEventListener('mousemove', handleMouseMove)
  observer?.disconnect()
})
</script>

<template>
  <section class="features-section">
    <div class="features-header">
      <h2 class="features-title">核心能力</h2>
      <p class="features-desc">围绕 AI 角色扮演场景，提供完整的后端基础设施</p>
    </div>

    <div ref="gridRef" class="features-grid">
      <div
        v-for="(feat, idx) in features"
        :key="idx"
        :ref="(el) => { if (el) cardRefs[idx] = el as HTMLElement }"
        :data-idx="idx"
        class="feature-card"
        :class="{ visible: visibleSet.has(idx) }"
        :style="{ transitionDelay: `${idx * 80}ms` }"
      >
        <div class="card-glow"></div>
        <div class="card-content">
          <h3 class="card-title">{{ feat.title }}</h3>
          <p class="card-details">{{ feat.details }}</p>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* ========== 区域 ========== */
.features-section {
  width: 100vw;
  margin-left: calc(50% - 50vw);
  padding: 80px 24px 96px;
  position: relative;
}

/* ========== 标题 ========== */
.features-header {
  text-align: center;
  margin-bottom: 48px;
}

.features-title {
  font-size: 28px;
  font-weight: 700;
  color: var(--vp-c-text-1);
  margin: 0 0 12px;
  border: none !important; /* 覆盖 vp-doc h2 的 border */
  padding: 0 !important;
}

.features-desc {
  font-size: 15px;
  color: var(--vp-c-text-3);
  margin: 0;
}

/* ========== 网格 ========== */
.features-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  max-width: 1080px;
  margin: 0 auto;
}

@media (max-width: 960px) {
  .features-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 640px) {
  .features-grid {
    grid-template-columns: 1fr;
  }
}

/* ========== 卡片 ========== */
.feature-card {
  position: relative;
  border-radius: 12px;
  padding: 1px; /* 留出边框空间给追光效果 */
  background: var(--vp-c-divider);
  cursor: default;
  /* 入场动画初始状态 */
  opacity: 0;
  transform: translateY(32px);
  transition: opacity 0.6s ease, transform 0.6s ease;
}

.feature-card.visible {
  opacity: 1;
  transform: none;
}

/* 追光边框：鼠标附近的径向高亮 */
.card-glow {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  opacity: 0;
  transition: opacity 0.3s ease;
  background: radial-gradient(
    400px circle at var(--mouse-x) var(--mouse-y),
    rgba(45, 212, 191, 0.25),
    transparent 40%
  );
}

.feature-card:hover .card-glow {
  opacity: 1;
}

/* 卡片内部内容 */
.card-content {
  position: relative;
  z-index: 1;
  border-radius: 11px; /* 比外层少 1px */
  padding: 28px 24px;
  height: 100%;
  background: var(--vp-c-bg);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  transition: background 0.3s ease;
}

.feature-card:hover .card-content {
  background: var(--vp-c-bg-soft);
}

.card-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--vp-c-text-1);
  margin: 0 0 8px;
  border: none !important;
  padding: 0 !important;
}

.card-details {
  font-size: 14px;
  line-height: 1.6;
  color: var(--vp-c-text-2);
  margin: 0;
}

/* ========== 深色模式下卡片背景更通透 ========== */
.dark .card-content {
  background: rgba(18, 18, 21, 0.85);
}

.dark .feature-card {
  background: rgba(255, 255, 255, 0.08);
}

.dark .feature-card:hover {
  background: rgba(45, 212, 191, 0.15);
}
</style>
