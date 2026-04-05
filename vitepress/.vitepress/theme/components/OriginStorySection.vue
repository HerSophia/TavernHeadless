<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useLandingEasterEgg } from '../composables/useLandingEasterEgg'

type FocusItem = {
  id: string
  label: string
  eyebrow: string
  title: string
  summary: string
  paragraph: string
}

const { isUnlocked } = useLandingEasterEgg()
const sectionRef = ref<HTMLElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)

const focusItems: FocusItem[] = [
  {
    id: 'start',
    label: '起点',
    eyebrow: '01 / 起点',
    title: '为什么不继续做一个界面',
    summary: '现有 AI RP 工具已经很强，但很难作为一层可复用的引擎被别的前端直接依赖。',
    paragraph:
      '2024 年底，我已经持续使用 SillyTavern 很长时间。它很强：预设、世界书、正则、角色卡，这一套生态已经积累得很完整。但它首先是一个面向终端用户的界面应用。核心逻辑和界面逻辑绑在一起。如果想换一个前端，或者把 AI RP 能力接入别的产品，成本很高。',
  },
  {
    id: 'engine',
    label: '判断',
    eyebrow: '02 / 判断',
    title: '我想做的是引擎层',
    summary: '通过 API 暴露能力，把状态管理和核心逻辑从前端中拆出来，让不同接入方共享同一套后端。',
    paragraph:
      '我想做的不是另一个界面，而是一层可以长期依赖的引擎。所有能力通过 API 暴露，所有状态由数据库管理，核心逻辑与前端解耦。这样，无论下游是 Web、桌面客户端，还是自动化脚本，都可以接到同一套后端上。',
  },
  {
    id: 'compat',
    label: '兼容',
    eyebrow: '03 / 兼容',
    title: '为什么坚持兼容 SillyTavern',
    summary: '用户已经积累下来的预设、世界书、正则和角色卡，不应该因为更换技术方案就失去价值。',
    paragraph:
      '兼容 SillyTavern 生态，是这个项目从一开始就确定的方向。预设、世界书、正则规则和角色卡，是用户多年积累下来的资产。这些内容不应该因为更换技术方案就失去价值。我希望 TavernHeadless 不是替代这些资产，而是接住它们。',
  },
  {
    id: 'goal',
    label: '目标',
    eyebrow: '04 / 目标',
    title: '这个项目想解决什么',
    summary: '与其继续做一个新的聊天界面，不如把精力放在引擎、边界、SDK 和文档上。',
    paragraph:
      '我并不知道这个项目最后会走到哪里。但目标一直很清楚：为下一代 AI RP 平台提供基础设施。与其继续做一个新的聊天界面，我更愿意把时间放在引擎、边界、SDK 和文档上。只要这层基础足够稳定，开发者自然可以在上面做出各自不同的产品。',
  },
]

const activeFocusId = ref(focusItems[0].id)
const pointerX = ref(50)
const pointerY = ref(50)
const rotateX = ref(0)
const rotateY = ref(0)
const panelInteractive = ref(false)
const prefersReducedMotion = ref(false)

let motionQuery: MediaQueryList | null = null
let motionQueryHandler: ((event: MediaQueryListEvent) => void) | null = null

const activeFocusIndex = computed(() => {
  const index = focusItems.findIndex((item) => item.id === activeFocusId.value)
  return index < 0 ? 0 : index
})

const activeFocus = computed(() => focusItems[activeFocusIndex.value] ?? focusItems[0])
const activeFocusIndexText = computed(() => String(activeFocusIndex.value + 1).padStart(2, '0'))
const totalFocusText = computed(() => String(focusItems.length).padStart(2, '0'))
const focusProgress = computed(() => ((activeFocusIndex.value + 1) / focusItems.length) * 100)
const panelStyle = computed(() => ({
  '--origin-pointer-x': `${pointerX.value}%`,
  '--origin-pointer-y': `${pointerY.value}%`,
  '--origin-rotate-x': `${rotateX.value}deg`,
  '--origin-rotate-y': `${rotateY.value}deg`,
}))

function activateFocus(id: string) {
  activeFocusId.value = id
}

function syncMotionPreference() {
  if (typeof window === 'undefined') return

  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  prefersReducedMotion.value = motionQuery.matches

  motionQueryHandler = (event: MediaQueryListEvent) => {
    prefersReducedMotion.value = event.matches
    if (event.matches) {
      resetPanelInteraction()
    }
  }

  motionQuery.addEventListener('change', motionQueryHandler)
}

function resetPanelInteraction() {
  pointerX.value = 50
  pointerY.value = 50
  rotateX.value = 0
  rotateY.value = 0
  panelInteractive.value = false
}

function onPanelPointerMove(event: PointerEvent) {
  if (prefersReducedMotion.value || event.pointerType === 'touch') {
    return
  }

  const panel = panelRef.value
  if (!panel) return

  const rect = panel.getBoundingClientRect()
  const x = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1)
  const y = Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 1)

  pointerX.value = x * 100
  pointerY.value = y * 100
  rotateX.value = (0.5 - y) * 7
  rotateY.value = (x - 0.5) * 9
  panelInteractive.value = true
}

async function revealSection() {
  await nextTick()

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('landing:refresh-sections'))

    window.requestAnimationFrame(() => {
      const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
      sectionRef.value?.scrollIntoView({ behavior, block: 'start' })
    })
  }
}

watch(
  isUnlocked,
  (value) => {
    if (!value) return
    void revealSection()
  },
  { flush: 'post' }
)

onMounted(() => {
  syncMotionPreference()

  if (isUnlocked.value) {
    void revealSection()
  }
})

onUnmounted(() => {
  if (motionQuery && motionQueryHandler) {
    motionQuery.removeEventListener('change', motionQueryHandler)
  }
})
</script>

<template>
  <Transition name="origin-reveal" appear>
    <section
      v-if="isUnlocked"
      id="landing-origin"
      ref="sectionRef"
      class="origin-section landing-fullscreen"
      data-landing-section="origin"
      data-section-title="项目缘起"
      data-section-label="缘起"
    >
      <div class="origin-backdrop origin-backdrop-left"></div>
      <div class="origin-backdrop origin-backdrop-right"></div>
      <div class="origin-gridline"></div>

      <div class="landing-shell origin-shell">
        <div class="origin-kicker">
          <span class="origin-kicker-badge">ORIGIN</span>
          <span class="origin-kicker-divider"></span>
          <span class="origin-kicker-text">项目缘起</span>
        </div>

        <div class="origin-layout">
          <div class="origin-intro">
            <p class="origin-caption">NOT ANOTHER CHAT UI</p>
            <h2 class="origin-title">我想要的是引擎，不是界面</h2>
            <p class="origin-summary">
              AI RP 生态不缺界面。缺的是一层可以独立运行、可以被任意前端依赖的引擎。
            </p>

            <div class="origin-tags" aria-label="项目缘起阅读焦点">
              <button
                v-for="item in focusItems"
                :key="item.id"
                type="button"
                class="origin-tag"
                :class="{ active: activeFocusId === item.id }"
                :aria-pressed="activeFocusId === item.id"
                @click="activateFocus(item.id)"
              >
                <span class="origin-tag-index">{{ item.eyebrow.split(' / ')[0] }}</span>
                <span>{{ item.label }}</span>
              </button>
            </div>

            <Transition name="origin-focus-card" mode="out-in">
              <div :key="activeFocus.id" class="origin-focus-card">
                <span class="origin-focus-card-eyebrow">{{ activeFocus.eyebrow }}</span>
                <strong class="origin-focus-card-title">{{ activeFocus.title }}</strong>
                <p class="origin-focus-card-summary">{{ activeFocus.summary }}</p>
              </div>
            </Transition>
          </div>

          <div
            ref="panelRef"
            class="origin-panel"
            :class="{ 'is-interactive': panelInteractive && !prefersReducedMotion }"
            :style="panelStyle"
            @pointermove="onPanelPointerMove"
            @pointerleave="resetPanelInteraction"
          >
            <div class="origin-panel-ring"></div>
            <div class="origin-panel-beam"></div>

            <div class="origin-panel-status" aria-live="polite">
              <span class="origin-panel-status-label">当前焦点</span>
              <strong class="origin-panel-status-title">{{ activeFocus.title }}</strong>
              <span class="origin-panel-status-index">{{ activeFocusIndexText }}/{{ totalFocusText }}</span>
              <span class="origin-panel-status-progress" aria-hidden="true">
                <span class="origin-panel-status-progress-bar" :style="{ width: `${focusProgress}%` }"></span>
              </span>
            </div>

            <div class="origin-quote-wrap">
              <span class="origin-quote-mark">“</span>
              <p class="origin-quote">AI RP 缺的不是界面，是基础设施。</p>
            </div>

            <div class="origin-copy">
              <button
                v-for="(item, index) in focusItems"
                :key="item.id"
                type="button"
                class="origin-paragraph"
                :class="{ active: activeFocusId === item.id }"
                :style="{ '--paragraph-delay': `${index * 110}ms` }"
                @click="activateFocus(item.id)"
                @focus="activateFocus(item.id)"
              >
                <span class="origin-paragraph-index">{{ String(index + 1).padStart(2, '0') }}</span>
                <span class="origin-paragraph-text">{{ item.paragraph }}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  </Transition>
</template>

<style scoped>
.origin-section {
  overflow: hidden;
  background:
    radial-gradient(circle at 16% 20%, rgba(45, 212, 191, 0.18), transparent 24%),
    radial-gradient(circle at 84% 16%, rgba(129, 140, 248, 0.16), transparent 22%),
    radial-gradient(circle at 50% 100%, rgba(56, 189, 248, 0.14), transparent 28%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.02), transparent 26%);
}

.origin-section::after {
  content: '';
  position: absolute;
  inset: 0;
  background:
    linear-gradient(90deg, transparent 0%, rgba(45, 212, 191, 0.03) 50%, transparent 100%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.02), transparent 35%);
  pointer-events: none;
}

.origin-backdrop {
  position: absolute;
  border-radius: 999px;
  filter: blur(14px);
  opacity: 0.9;
  pointer-events: none;
  animation: origin-float 9s ease-in-out infinite;
}

.origin-backdrop-left {
  top: 16%;
  left: -8%;
  width: 34vw;
  height: 34vw;
  background: radial-gradient(circle, rgba(45, 212, 191, 0.16) 0%, transparent 70%);
}

.origin-backdrop-right {
  right: -10%;
  bottom: -6%;
  width: 36vw;
  height: 36vw;
  background: radial-gradient(circle, rgba(129, 140, 248, 0.16) 0%, transparent 70%);
  animation-delay: -3.2s;
}

.origin-gridline {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(127, 127, 127, 0.08) 1px, transparent 1px),
    linear-gradient(90deg, rgba(127, 127, 127, 0.08) 1px, transparent 1px);
  background-size: 36px 36px;
  mask-image: linear-gradient(180deg, transparent 0%, rgba(0, 0, 0, 0.55) 18%, rgba(0, 0, 0, 0.7) 82%, transparent 100%);
  opacity: 0.2;
  pointer-events: none;
}

.origin-shell {
  position: relative;
  z-index: 2;
  gap: 28px;
}

.origin-kicker {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  color: var(--vp-c-text-2);
}

.origin-kicker-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid rgba(45, 212, 191, 0.25);
  background: rgba(45, 212, 191, 0.1);
  color: var(--vp-c-brand-1);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
}

.origin-kicker-divider {
  width: 72px;
  height: 1px;
  background: linear-gradient(90deg, rgba(45, 212, 191, 0.55), transparent);
}

.origin-kicker-text {
  font-size: 13px;
  color: var(--vp-c-text-3);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.origin-layout {
  display: grid;
  grid-template-columns: minmax(0, 0.92fr) minmax(0, 1.08fr);
  gap: clamp(28px, 4vw, 52px);
  align-items: center;
}

.origin-intro {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.origin-caption {
  margin: 0;
  font-size: 13px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--vp-c-brand-1);
  font-weight: 600;
}

.origin-title {
  margin: 0;
  max-width: 10ch;
  font-size: clamp(38px, 5.5vw, 64px);
  line-height: 1.02;
  letter-spacing: -0.04em;
  font-weight: 800;
  color: var(--vp-c-text-1);
  border: none !important;
  padding: 0 !important;
}

.origin-summary {
  margin: 0;
  max-width: 440px;
  font-size: 16px;
  line-height: 1.9;
  color: var(--vp-c-text-2);
}

.origin-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 8px;
}

.origin-tag {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 999px;
  border: 1px solid var(--landing-card-border);
  background: rgba(255, 255, 255, 0.04);
  color: var(--vp-c-text-2);
  font-size: 12px;
  letter-spacing: 0.04em;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
  cursor: pointer;
  transition:
    color 0.22s ease,
    border-color 0.22s ease,
    background 0.22s ease,
    transform 0.22s ease,
    box-shadow 0.22s ease;
}

.origin-tag:hover,
.origin-tag:focus-visible,
.origin-tag.active {
  color: var(--vp-c-text-1);
  border-color: rgba(45, 212, 191, 0.32);
  background: rgba(45, 212, 191, 0.1);
  transform: translateY(-1px);
  box-shadow: 0 18px 30px -24px rgba(45, 212, 191, 0.35);
}

.origin-tag-index {
  color: var(--vp-c-brand-1);
  font-weight: 700;
}

.origin-focus-card {
  position: relative;
  max-width: 480px;
  padding: 18px 18px 20px;
  border-radius: 20px;
  border: 1px solid var(--landing-card-border);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.04), transparent 85%), var(--landing-card-bg);
  box-shadow: 0 26px 48px -40px rgba(15, 23, 42, 0.4);
  overflow: hidden;
}

.origin-focus-card::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: linear-gradient(180deg, var(--vp-c-brand-1), #818cf8);
}

.origin-focus-card-eyebrow {
  display: block;
  margin-bottom: 8px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--vp-c-brand-1);
}

.origin-focus-card-title {
  display: block;
  margin-bottom: 8px;
  font-size: 18px;
  line-height: 1.35;
  color: var(--vp-c-text-1);
}

.origin-focus-card-summary {
  margin: 0;
  font-size: 14px;
  line-height: 1.75;
  color: var(--vp-c-text-2);
}

.origin-focus-card-enter-active,
.origin-focus-card-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.origin-focus-card-enter-from,
.origin-focus-card-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

.origin-panel {
  position: relative;
  padding: clamp(24px, 4vw, 40px);
  border-radius: 28px;
  border: 1px solid var(--landing-card-border);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.06), transparent 34%),
    var(--landing-card-bg);
  box-shadow:
    0 32px 80px -42px rgba(15, 23, 42, 0.42),
    0 0 0 1px rgba(255, 255, 255, 0.02);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  overflow: hidden;
  transform: perspective(1400px) rotateX(var(--origin-rotate-x, 0deg)) rotateY(var(--origin-rotate-y, 0deg));
  transform-style: preserve-3d;
  will-change: transform;
  transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
}

.origin-panel.is-interactive {
  border-color: rgba(45, 212, 191, 0.2);
  box-shadow:
    0 42px 90px -48px rgba(15, 23, 42, 0.5),
    0 0 0 1px rgba(45, 212, 191, 0.08);
}

.origin-panel::before {
  content: '';
  position: absolute;
  inset: 1px;
  border-radius: 27px;
  background: radial-gradient(circle at var(--origin-pointer-x, 50%) var(--origin-pointer-y, 50%), rgba(45, 212, 191, 0.14), transparent 30%);
  pointer-events: none;
}

.origin-panel::after {
  content: '';
  position: absolute;
  inset: 1px;
  border-radius: 27px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.05), transparent 18%);
  pointer-events: none;
}

.origin-panel-ring,
.origin-panel-beam,
.origin-panel-status,
.origin-quote-wrap,
.origin-copy {
  position: relative;
  z-index: 1;
}

.origin-panel-ring {
  position: absolute;
  top: -120px;
  right: -120px;
  width: 280px;
  height: 280px;
  border-radius: 999px;
  border: 1px solid rgba(45, 212, 191, 0.18);
  box-shadow:
    0 0 0 30px rgba(45, 212, 191, 0.05),
    0 0 0 72px rgba(129, 140, 248, 0.04);
  opacity: 0.9;
  pointer-events: none;
}

.origin-panel-beam {
  position: absolute;
  top: -40%;
  left: -18%;
  width: 42%;
  height: 180%;
  background: linear-gradient(180deg, transparent 0%, rgba(45, 212, 191, 0.12) 46%, transparent 100%);
  transform: rotate(12deg);
  filter: blur(6px);
  pointer-events: none;
  animation: origin-beam-scan 5.4s ease-in-out infinite;
}

.origin-panel-status {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 8px 14px;
  margin-bottom: 20px;
}

.origin-panel-status-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--vp-c-brand-1);
}

.origin-panel-status-title {
  min-width: 0;
  font-size: 14px;
  color: var(--landing-card-title);
}

.origin-panel-status-index {
  font-size: 12px;
  color: var(--landing-card-muted);
}

.origin-panel-status-progress {
  grid-column: 1 / -1;
  display: block;
  height: 2px;
  border-radius: 999px;
  background: rgba(127, 127, 127, 0.14);
}

.origin-panel-status-progress-bar {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--vp-c-brand-1), #818cf8);
  transition: width 0.22s ease;
}

.origin-quote-wrap {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  margin-bottom: 24px;
}

.origin-quote-mark {
  font-size: 64px;
  line-height: 0.9;
  color: rgba(45, 212, 191, 0.35);
}

.origin-quote {
  margin: 8px 0 0;
  max-width: 16ch;
  font-size: clamp(22px, 2.8vw, 32px);
  line-height: 1.22;
  letter-spacing: -0.03em;
  font-weight: 700;
  color: var(--landing-card-title);
}

.origin-copy {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.origin-paragraph {
  display: grid;
  grid-template-columns: 44px 1fr;
  gap: 14px;
  width: 100%;
  padding: 14px 14px 14px 0;
  border: 1px solid transparent;
  border-radius: 18px;
  background: transparent;
  text-align: left;
  color: inherit;
  cursor: pointer;
  opacity: 0;
  transform: translateY(16px);
  animation: origin-copy-in 0.7s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
  animation-delay: calc(0.18s + var(--paragraph-delay, 0ms));
  transition:
    border-color 0.22s ease,
    background 0.22s ease,
    box-shadow 0.22s ease,
    transform 0.22s ease;
}

.origin-paragraph:hover,
.origin-paragraph:focus-visible,
.origin-paragraph.active {
  border-color: rgba(45, 212, 191, 0.2);
  background: rgba(45, 212, 191, 0.06);
  box-shadow: 0 22px 30px -28px rgba(45, 212, 191, 0.2);
  transform: translateX(4px);
}

.origin-paragraph-index {
  display: inline-flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 4px;
  color: var(--vp-c-brand-1);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.1em;
}

.origin-paragraph-text {
  font-size: 14.5px;
  line-height: 1.95;
  color: var(--landing-card-text);
}

.origin-reveal-enter-active,
.origin-reveal-appear-active {
  transition: opacity 0.55s ease, transform 0.55s ease;
}

.origin-reveal-enter-from,
.origin-reveal-appear-from {
  opacity: 0;
  transform: translateY(28px);
}

@keyframes origin-copy-in {
  to {
    opacity: 1;
    transform: none;
  }
}

@keyframes origin-float {
  0%,
  100% {
    transform: translate3d(0, 0, 0) scale(1);
  }
  50% {
    transform: translate3d(0, -16px, 0) scale(1.04);
  }
}

@keyframes origin-beam-scan {
  0%,
  100% {
    opacity: 0.3;
    transform: translate3d(0, 0, 0) rotate(12deg);
  }
  50% {
    opacity: 0.85;
    transform: translate3d(22%, 0, 0) rotate(12deg);
  }
}

@media (max-width: 980px) {
  .origin-layout {
    grid-template-columns: 1fr;
  }

  .origin-title {
    max-width: none;
  }
}

@media (max-width: 640px) {
  .origin-kicker {
    flex-wrap: wrap;
    gap: 10px;
  }

  .origin-kicker-divider {
    display: none;
  }

  .origin-summary {
    font-size: 15px;
  }

  .origin-focus-card {
    padding: 16px;
  }

  .origin-panel {
    border-radius: 22px;
  }

  .origin-panel::before,
  .origin-panel::after {
    border-radius: 21px;
  }

  .origin-quote {
    max-width: none;
  }

  .origin-paragraph {
    grid-template-columns: 36px 1fr;
    gap: 10px;
    padding-right: 10px;
  }
}
</style>
