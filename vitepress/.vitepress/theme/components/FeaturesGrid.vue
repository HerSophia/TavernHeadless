<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

const features = [
  {
    icon: 'compat',
    title: '兼容 SillyTavern 生态',
    details: '导入 Preset、Regex、Worldbook、角色卡即可使用。已有的酒馆资产不需要重新配置。',
  },
  {
    icon: 'layers',
    title: '三层消息结构',
    details: '会话 → 楼层 → 消息页。分支、重试、回放和当前生效版本在这个结构里处理。',
  },
  {
    icon: 'sliders',
    title: '五级变量系统',
    details: '全局 / 会话 / 分支 / 楼层 / 页级变量，优先级从低到高。页级沙箱保证重新生成不互相影响。',
  },
  {
    icon: 'workflow',
    title: '提示词编排体系',
    details: '兼容模式复刻酒馆的拼接逻辑，原生模式走图编译。两条路径最终都落到 Prompt IR。',
  },
  {
    icon: 'brain',
    title: '记忆系统',
    details: '摘要提取、结构化存储、上下文注入、后台维护。支持同步写入和异步收敛。',
  },
  {
    icon: 'terminal',
    title: '开发者体验',
    details: 'TypeScript 全栈、OpenAPI、官方 SDK、Client Helpers、SSE、Prompt dry-run。',
  },
]

const gridRef = ref<HTMLElement | null>(null)
const cardRefs = ref<HTMLElement[]>([])
const visibleSet = ref(new Set<number>())
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
    const rotateY = isInside ? ((x / rect.width) - 0.5) * 10 : 0
    const rotateX = isInside ? (0.5 - (y / rect.height)) * 10 : 0
    card.style.setProperty('--card-tilt-x', `${rotateX}deg`)
    card.style.setProperty('--card-tilt-y', `${rotateY}deg`)
  }
}

const handleMouseLeave = () => {
  for (const card of cardRefs.value) {
    resetCardMotion(card)
  }
}

onMounted(() => {
  syncPointerMotionAvailability()
  gridRef.value?.addEventListener('mousemove', handleMouseMove)
  gridRef.value?.addEventListener('mouseleave', handleMouseLeave)

  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const index = Number((entry.target as HTMLElement).dataset.idx)
          visibleSet.value.add(index)
          observer?.unobserve(entry.target)
        }
      }
    },
    { threshold: 0.2 }
  )

  for (const card of cardRefs.value) {
    observer.observe(card)
  }
})

onUnmounted(() => {
  gridRef.value?.removeEventListener('mousemove', handleMouseMove)
  gridRef.value?.removeEventListener('mouseleave', handleMouseLeave)
  observer?.disconnect()
})
</script>

<template>
  <section
    id="landing-features"
    class="features-section landing-fullscreen"
    data-landing-section="features"
    data-section-title="核心能力"
    data-section-label="能力"
  >
    <div class="landing-shell features-shell">
      <div class="features-header">
        <h2 class="features-title">核心能力</h2>
      </div>

      <div ref="gridRef" class="features-grid">
        <div
          v-for="(feature, index) in features"
          :key="feature.title"
          :ref="(el) => { if (el) cardRefs[index] = el as HTMLElement }"
          :data-idx="index"
          class="feature-card"
          :class="{ visible: visibleSet.has(index) }"
          :style="{ transitionDelay: `${index * 80}ms` }"
        >          <div class="card-content">
            <div class="card-icon">
              <svg v-if="feature.icon === 'compat'" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M8 3L4 7l4 4" />
                <path d="M4 7h16" />
                <path d="M16 21l4-4-4-4" />
                <path d="M20 17H4" />
              </svg>
              <svg v-else-if="feature.icon === 'layers'" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="12 2 2 7 12 12 22 7 12 2" />
                <polyline points="2 17 12 22 22 17" />
                <polyline points="2 12 12 17 22 12" />
              </svg>
              <svg v-else-if="feature.icon === 'sliders'" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="4" y1="21" x2="4" y2="14" />
                <line x1="4" y1="10" x2="4" y2="3" />
                <line x1="12" y1="21" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12" y2="3" />
                <line x1="20" y1="21" x2="20" y2="16" />
                <line x1="20" y1="12" x2="20" y2="3" />
                <line x1="1" y1="14" x2="7" y2="14" />
                <line x1="9" y1="8" x2="15" y2="8" />
                <line x1="17" y1="16" x2="23" y2="16" />
              </svg>
              <svg v-else-if="feature.icon === 'workflow'" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="6" height="6" rx="1" />
                <rect x="15" y="3" width="6" height="6" rx="1" />
                <rect x="9" y="15" width="6" height="6" rx="1" />
                <path d="M6 9v3a1 1 0 0 0 1 1h4M18 9v3a1 1 0 0 1-1 1h-4" />
                <path d="M12 13v2" />
              </svg>
              <svg v-else-if="feature.icon === 'brain'" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 2a5 5 0 0 1 5 5c0 .8-.2 1.5-.5 2.2A5 5 0 0 1 20 14a5 5 0 0 1-3 4.6V22h-2v-3h-2v3h-2v-3H9v3H7v-3.4A5 5 0 0 1 4 14a5 5 0 0 1 3.5-4.8A5 5 0 0 1 7 7a5 5 0 0 1 5-5Z" />
              </svg>
              <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="4 17 10 11 4 5" />
                <line x1="12" y1="19" x2="20" y2="19" />
              </svg>
            </div>

            <h3 class="card-title">{{ feature.title }}</h3>
            <p class="card-details">{{ feature.details }}</p>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.features-section {
  background:
    linear-gradient(180deg, rgba(45, 212, 191, 0.04), transparent 22%),
    radial-gradient(circle at bottom center, rgba(129, 140, 248, 0.08), transparent 30%);
}

.features-shell {
  gap: 30px;
}

.features-header {
  max-width: 760px;
  margin: 0 auto;
  text-align: center;
}

.features-title {
  margin: 0 0 12px;
  font-size: clamp(30px, 4vw, 44px);
  font-weight: 800;
  line-height: 1.1;
  letter-spacing: -0.03em;
  color: var(--vp-c-text-1);
  border: none !important;
  padding: 0 !important;
}

.features-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  align-content: center;
}

.feature-card {
  --card-tilt-x: 0deg;
  --card-tilt-y: 0deg;
  position: relative;
  border-radius: 18px;
  padding: 1px;
  background: var(--landing-card-border);
  cursor: default;
  opacity: 0;
  transform: translateY(24px);
  transition: opacity 0.6s ease, transform 0.6s ease;
}

.feature-card.visible {
  opacity: 1;
  transform: none;
}


.card-content {
  position: relative;
  z-index: 1;
  height: 100%;
  padding: 22px 20px;
  border-radius: 17px;
  background: var(--landing-card-bg);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  transform: perspective(960px) rotateX(var(--card-tilt-x)) rotateY(var(--card-tilt-y));
  transform-style: preserve-3d;
  transition: background 0.3s ease, transform 0.25s ease;
}

.feature-card:hover .card-content {
  background: var(--landing-card-bg-hover);
  transform: translate3d(0, -1px, 0) perspective(960px) rotateX(var(--card-tilt-x)) rotateY(var(--card-tilt-y));
}

.card-icon {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: var(--landing-icon-bg);
  color: var(--vp-c-brand-1);
  margin-bottom: 14px;
  transform: translateZ(14px);
  transition: transform 0.25s ease, background 0.3s ease;
}

.feature-card:hover .card-icon {
  transform: translateZ(22px) scale(1.05);
  background: var(--landing-icon-bg-hover);
}

.card-title {
  margin: 0 0 8px;
  font-size: 16px;
  font-weight: 600;
  color: var(--landing-card-title);
  border: none !important;
  padding: 0 !important;
}

.card-details {
  margin: 0;
  font-size: 14px;
  line-height: 1.7;
  color: var(--landing-card-text);
}

@media (pointer: coarse), (prefers-reduced-motion: reduce) {
  .card-content,
  .feature-card:hover .card-content,
  .card-icon,
  .feature-card:hover .card-icon {
    transform: none !important;
  }
}

@media (max-width: 960px) {
  .features-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .features-grid {
    grid-template-columns: 1fr;
  }
}
</style>
