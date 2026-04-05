<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

const stats = [
  { value: 3, suffix: '', label: '层消息架构', desc: 'Session → Floor → Page' },
  { value: 5, suffix: '', label: '级变量体系', desc: '全局 / 会话 / 分支 / 楼层 / 页' },
  { value: 20, suffix: '+', label: 'REST 资源', desc: '会话、内容、变量、记忆、Tools、MCP 等' },
  { value: 2, suffix: '', label: '官方接入包', desc: '@tavern/sdk + @tavern/client-helpers' },
]

const containerRef = ref<HTMLElement | null>(null)
const animatedValues = ref(stats.map(() => 0))
const hasAnimated = ref(false)
const isVisible = ref(false)

let observer: IntersectionObserver | null = null
const delayTimers: number[] = []

function animateNumbers() {
  if (hasAnimated.value) return
  hasAnimated.value = true
  isVisible.value = true

  stats.forEach((stat, index) => {
    const duration = 1200
    const start = performance.now()

    function step(now: number) {
      const elapsed = now - start
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      animatedValues.value[index] = Math.round(stat.value * eased)
      if (progress < 1) requestAnimationFrame(step)
    }

    const timer = window.setTimeout(() => requestAnimationFrame(step), index * 120)
    delayTimers.push(timer)
  })
}

onMounted(() => {
  observer = new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting) {
        animateNumbers()
        observer?.disconnect()
      }
    },
    { threshold: 0.35 }
  )
  if (containerRef.value) observer.observe(containerRef.value)
})

onUnmounted(() => {
  observer?.disconnect()
  delayTimers.forEach((t) => window.clearTimeout(t))
})
</script>

<template>
  <section
    id="landing-stats"
    ref="containerRef"
    class="stats-section landing-fullscreen"
    data-landing-section="stats"
    data-section-title="引擎一览"
    data-section-label="概览"
    :class="{ visible: isVisible }"
  >
    <div class="landing-shell stats-shell">
      <h2 class="stats-title">引擎一览</h2>

      <div class="stats-panel">
        <div class="stats-inner">
          <div v-for="(stat, index) in stats" :key="stat.label" class="stat-item">
            <span class="stat-value">
              {{ animatedValues[index] }}<span class="stat-suffix">{{ stat.suffix }}</span>
            </span>
            <span class="stat-label">{{ stat.label }}</span>
            <span class="stat-desc">{{ stat.desc }}</span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.stats-section {
  background:
    radial-gradient(circle at center top, rgba(45, 212, 191, 0.08), transparent 36%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.02), transparent 28%);
  opacity: 0;
  transform: translateY(24px);
  transition: opacity 0.8s ease, transform 0.8s ease;
}

.stats-section.visible {
  opacity: 1;
  transform: none;
}

.stats-shell {
  gap: 36px;
}

.stats-title {
  margin: 0;
  font-size: clamp(30px, 4vw, 44px);
  font-weight: 800;
  line-height: 1.08;
  letter-spacing: -0.03em;
  color: var(--vp-c-text-1);
  text-align: center;
  border: none !important;
  padding: 0 !important;
}

.stats-panel {
  border-radius: 28px;
  border: 1px solid var(--landing-card-border);
  background:
    radial-gradient(circle at 12% 18%, rgba(45, 212, 191, 0.18), transparent 28%),
    radial-gradient(circle at 86% 20%, rgba(129, 140, 248, 0.16), transparent 26%),
    linear-gradient(135deg, rgba(45, 212, 191, 0.08), rgba(129, 140, 248, 0.06)),
    var(--landing-card-bg);
  box-shadow: 0 24px 56px -36px rgba(15, 23, 42, 0.28);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
}

.stats-inner {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0;
}

.stat-item {
  padding: 30px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  text-align: center;
}

.stat-item + .stat-item {
  border-left: 1px solid var(--landing-card-border);
}

.stat-value {
  font-size: clamp(36px, 4vw, 54px);
  font-weight: 800;
  letter-spacing: -0.03em;
  line-height: 1;
  background: linear-gradient(135deg, var(--vp-c-brand-1), #818cf8);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.stat-suffix {
  font-size: 0.74em;
  font-weight: 700;
}

.stat-label {
  font-size: 15px;
  font-weight: 600;
  color: var(--landing-card-title);
}

.stat-desc {
  font-size: 12px;
  line-height: 1.7;
  color: var(--landing-card-muted);
}

@media (max-width: 860px) {
  .stats-inner {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .stat-item:nth-child(3),
  .stat-item:nth-child(4) {
    border-top: 1px solid var(--landing-card-border);
  }

  .stat-item:nth-child(3) {
    border-left: none;
  }
}

@media (max-width: 520px) {
  .stats-inner {
    grid-template-columns: 1fr;
  }

  .stat-item + .stat-item {
    border-left: none;
    border-top: 1px solid var(--landing-card-border);
  }
}
</style>
