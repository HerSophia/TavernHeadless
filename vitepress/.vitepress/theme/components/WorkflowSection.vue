<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

const steps = [
  {
    icon: 'session',
    phase: '会话层',
    title: '绑定资产',
    summary: '角色卡、预设、世界书、正则和模型配置在创建会话时绑定。',
    detail: 'Session 层固定本轮的全部基础资产，后续步骤沿用同一份上下文。',
    output: '不需要每次生成都重新传入配置。',
  },
  {
    icon: 'prompt',
    phase: '编排层',
    title: '编译 Prompt',
    summary: '模板、世界书命中、变量展开和工具结果经过编排后落到 Prompt IR。',
    detail: '兼容模式和原生图编译两条路径输出同一种中间格式。',
    output: '可以用 dry-run 查看编译结果，排查拼接问题。',
  },
  {
    icon: 'llm',
    phase: '生成层',
    title: '调用 LLM',
    summary: '按预设参数和实例配置发起模型调用。',
    detail: '支持流式输出。不同职责的 LLM 实例配置隔离。',
    output: 'SSE 事件流开始产生。',
  },
  {
    icon: 'floor',
    phase: '状态层',
    title: '写入楼层',
    summary: '生成结果写入消息页，再决定楼层的生效版本。',
    detail: '楼层状态按 draft → generating → committed / failed 流转。',
    output: '分支、重试和版本都有对应数据结构。',
  },
  {
    icon: 'memory',
    phase: '提交层',
    title: '提交变量与记忆',
    summary: '页级结果确认后做变量提升，记忆链路同步或异步完成。',
    detail: '变量隔离保证重新生成时不互相影响。',
    output: '下一轮上下文读到的是已提交状态。',
  },
  {
    icon: 'delivery',
    phase: '接入层',
    title: 'API / SDK 输出',
    summary: 'REST、SSE、SDK、Client Helpers 对外输出。',
    detail: '围绕资源方法、流式回调和类型化错误对象接入。',
    output: '不同端复用同一套接入面。',
  },
]

const sectionRef = ref<HTMLElement | null>(null)
const activeIndex = ref(0)
const isVisible = ref(false)

const activeStep = computed(() => steps[activeIndex.value])

let observer: IntersectionObserver | null = null
let autoplayTimer: number | null = null

function stopAutoplay() {
  if (autoplayTimer !== null) {
    window.clearInterval(autoplayTimer)
    autoplayTimer = null
  }
}

function startAutoplay() {
  stopAutoplay()
  autoplayTimer = window.setInterval(() => {
    activeIndex.value = (activeIndex.value + 1) % steps.length
  }, 3000)
}

function setActive(index: number) {
  activeIndex.value = index
  startAutoplay()
}

onMounted(() => {
  observer = new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting) {
        isVisible.value = true
        startAutoplay()
      } else {
        stopAutoplay()
      }
    },
    { threshold: 0.45 }
  )
  if (sectionRef.value) observer.observe(sectionRef.value)
})

onUnmounted(() => {
  stopAutoplay()
  observer?.disconnect()
})
</script>

<template>
  <section
    id="landing-workflow"
    ref="sectionRef"
    class="workflow-section landing-fullscreen"
    data-landing-section="workflow"
    data-section-title="内部链路"
    data-section-label="链路"
    :class="{ visible: isVisible }"
  >
    <div class="landing-shell workflow-shell">
      <div class="workflow-header">
        <h2 class="workflow-title">一次回复的内部链路</h2>
        <p class="workflow-desc">
          用户发一条消息到 AI 回一条消息，中间经过六步。
        </p>
      </div>

      <div class="workflow-track">
        <div class="track-line"></div>

        <button
          v-for="(step, index) in steps"
          :key="step.title"
          type="button"
          class="step-node"
          :class="{ active: activeIndex === index }"
          @mouseenter="setActive(index)"
          @focus="setActive(index)"
          @click="setActive(index)"
        >
          <span class="step-index">0{{ index + 1 }}</span>

          <span class="step-icon">
            <svg v-if="step.icon === 'session'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M7 8h10M7 12h10M7 16h6" />
            </svg>
            <svg v-else-if="step.icon === 'prompt'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 5h16v14H4z" />
              <path d="M8 9h8M8 13h5" />
            </svg>
            <svg v-else-if="step.icon === 'llm'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="4" y="4" width="16" height="16" rx="2" />
              <rect x="9" y="9" width="6" height="6" />
              <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" />
            </svg>
            <svg v-else-if="step.icon === 'floor'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="12 2 3 7 12 12 21 7 12 2" />
              <polyline points="3 12 12 17 21 12" />
              <polyline points="3 17 12 22 21 17" />
            </svg>
            <svg v-else-if="step.icon === 'memory'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 2a5 5 0 0 1 5 5c0 .8-.2 1.5-.5 2.2A5 5 0 0 1 20 14a5 5 0 0 1-3 4.6V22h-2v-3h-2v3h-2v-3H9v3H7v-3.4A5 5 0 0 1 4 14a5 5 0 0 1 3.5-4.8A5 5 0 0 1 7 7a5 5 0 0 1 5-5Z" />
            </svg>
            <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M5 12h14" />
              <path d="M13 5l7 7-7 7" />
              <path d="M4 5v14" />
            </svg>
          </span>

          <span class="step-phase">{{ step.phase }}</span>
          <span class="step-title">{{ step.title }}</span>
        </button>
      </div>

      <Transition name="detail-fade" mode="out-in">
        <div :key="activeIndex" class="workflow-detail">
          <div class="detail-main">
            <span class="detail-kicker">{{ activeStep.phase }}</span>
            <h3 class="detail-title">{{ activeStep.title }}</h3>
            <p class="detail-summary">{{ activeStep.summary }}</p>
          </div>

          <div class="detail-grid">
            <div class="detail-card">
              <span class="detail-label">过程</span>
              <p>{{ activeStep.detail }}</p>
            </div>
            <div class="detail-card">
              <span class="detail-label">结果</span>
              <p>{{ activeStep.output }}</p>
            </div>
          </div>
        </div>
      </Transition>
    </div>
  </section>
</template>

<style scoped>
.workflow-section {
  background:
    radial-gradient(circle at top center, rgba(45, 212, 191, 0.1), transparent 42%),
    linear-gradient(180deg, rgba(129, 140, 248, 0.06), transparent 32%);
  opacity: 0;
  transform: translateY(24px);
  transition: opacity 0.8s ease, transform 0.8s ease;
}

.workflow-section.visible {
  opacity: 1;
  transform: none;
}

.workflow-shell {
  gap: 28px;
}

.workflow-header {
  max-width: 820px;
  margin: 0 auto;
  text-align: center;
}

.workflow-title {
  margin: 0 0 12px;
  font-size: clamp(30px, 4vw, 44px);
  font-weight: 800;
  line-height: 1.1;
  letter-spacing: -0.03em;
  color: var(--vp-c-text-1);
  border: none !important;
  padding: 0 !important;
}

.workflow-desc {
  margin: 0;
  font-size: 15px;
  line-height: 1.75;
  color: var(--vp-c-text-2);
}

.workflow-track {
  position: relative;
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 14px;
}

.track-line {
  position: absolute;
  left: 70px;
  right: 70px;
  top: 54px;
  height: 1px;
  background: linear-gradient(90deg, rgba(45, 212, 191, 0.06), rgba(45, 212, 191, 0.6), rgba(129, 140, 248, 0.5));
}

.step-node {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  padding: 18px 16px 16px;
  border-radius: 18px;
  border: 1px solid var(--landing-card-border);
  background: var(--landing-card-bg);
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: transform 0.25s ease, border-color 0.25s ease, background 0.25s ease, box-shadow 0.25s ease;
}

.step-node:hover,
.step-node.active {
  transform: translateY(-4px);
  border-color: rgba(45, 212, 191, 0.35);
  background: var(--landing-card-bg-hover);
  box-shadow: 0 18px 36px -24px rgba(45, 212, 191, 0.45);
}

.step-index {
  font-size: 11px;
  color: var(--landing-card-muted);
  letter-spacing: 0.08em;
}

.step-icon {
  width: 40px;
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: var(--landing-icon-bg);
  color: var(--vp-c-brand-1);
}

.step-phase {
  font-size: 12px;
  color: var(--landing-card-muted);
}

.step-title {
  font-size: 14px;
  line-height: 1.5;
  color: var(--landing-card-title);
  font-weight: 600;
}

.detail-fade-enter-active,
.detail-fade-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.detail-fade-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

.detail-fade-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

.workflow-detail {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
  gap: 16px;
}

.detail-main,
.detail-card {
  border-radius: 20px;
  border: 1px solid var(--landing-card-border);
  background: var(--landing-card-bg);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.detail-main {
  padding: 28px;
}

.detail-kicker {
  display: inline-flex;
  align-items: center;
  padding: 5px 10px;
  border-radius: 999px;
  background: var(--landing-icon-bg);
  color: var(--vp-c-brand-1);
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 14px;
}

.detail-title {
  margin: 0 0 12px;
  font-size: 28px;
  font-weight: 700;
  line-height: 1.15;
  color: var(--landing-card-title);
  border: none !important;
  padding: 0 !important;
}

.detail-summary {
  margin: 0;
  font-size: 15px;
  line-height: 1.75;
  color: var(--landing-card-text);
}

.detail-grid {
  display: grid;
  gap: 16px;
}

.detail-card {
  padding: 22px 24px;
}

.detail-label {
  display: block;
  margin-bottom: 10px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--landing-card-muted);
}

.detail-card p {
  margin: 0;
  font-size: 14px;
  line-height: 1.75;
  color: var(--landing-card-text);
}

@media (max-width: 1100px) {
  .workflow-track {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .track-line {
    display: none;
  }
}

@media (max-width: 860px) {
  .workflow-detail {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .workflow-track {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .step-node {
    padding: 16px 14px;
  }

  .detail-main {
    padding: 22px;
  }

  .detail-title {
    font-size: 24px;
  }
}
</style>
