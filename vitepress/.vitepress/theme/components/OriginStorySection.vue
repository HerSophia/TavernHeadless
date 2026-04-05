<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { useLandingEasterEgg } from '../composables/useLandingEasterEgg'

const { isUnlocked } = useLandingEasterEgg()
const sectionRef = ref<HTMLElement | null>(null)

const storyTags = ['AI RP', 'Headless', 'SillyTavern 兼容', '基础设施', '第一方集成层']

// 把下面这组文案替换成你的正式自述即可。
const storyParagraphs = [
  '这里留给一段第一人称说明，用来写清楚：我为什么要开始做 TavernHeadless。',
  '你可以在这里写项目的起点。比如，为什么现有 AI RP 工具链更像一组界面，而不是一层稳定、可复用、可组合的基础设施。',
  '你也可以在这里写自己的判断。比如，为什么坚持 Headless 架构，为什么要兼容 SillyTavern，为什么要把 SDK、文档和工程边界一起做扎实。',
  '等你准备好正式文案之后，只需要替换这几段文字。这一屏的排版、气氛和动效可以继续保留。',
]

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
  if (isUnlocked.value) {
    void revealSection()
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
          <span class="origin-kicker-badge">EASTER EGG</span>
          <span class="origin-kicker-divider"></span>
          <span class="origin-kicker-text">项目缘起</span>
        </div>

        <div class="origin-layout">
          <div class="origin-intro">
            <p class="origin-caption">这一屏不是功能说明，而是动机说明。</p>
            <h2 class="origin-title">把项目缘起单独留出来，给判断、经历和长期目标一个更完整的位置。</h2>
            <p class="origin-summary">
              当用户在首页一路下滑到这里，看到的不再是功能列表，而是你为什么决定做这件事。
            </p>

            <div class="origin-tags" aria-label="主题标签">
              <span v-for="tag in storyTags" :key="tag" class="origin-tag">{{ tag }}</span>
            </div>
          </div>

          <div class="origin-panel">
            <div class="origin-panel-ring"></div>
            <div class="origin-panel-beam"></div>

            <div class="origin-quote-wrap">
              <span class="origin-quote-mark">“</span>
              <p class="origin-quote">这里将放一段说明：我为什么要做这样一个项目。</p>
            </div>

            <div class="origin-copy">
              <p
                v-for="(paragraph, index) in storyParagraphs"
                :key="paragraph"
                class="origin-paragraph"
                :style="{ '--paragraph-delay': `${index * 110}ms` }"
              >
                {{ paragraph }}
              </p>
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
  background: rgba(45, 212, 191, 0.10);
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
  grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr);
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
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--vp-c-brand-1);
}

.origin-title {
  margin: 0;
  max-width: 12ch;
  font-size: clamp(34px, 5vw, 58px);
  line-height: 1.04;
  letter-spacing: -0.04em;
  font-weight: 800;
  color: var(--vp-c-text-1);
  border: none !important;
  padding: 0 !important;
}

.origin-summary {
  margin: 0;
  max-width: 540px;
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
  padding: 8px 12px;
  border-radius: 999px;
  border: 1px solid var(--landing-card-border);
  background: rgba(255, 255, 255, 0.04);
  color: var(--vp-c-text-2);
  font-size: 12px;
  letter-spacing: 0.04em;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
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
}

.origin-panel::after {
  content: '';
  position: absolute;
  inset: 1px;
  border-radius: 27px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.05), transparent 18%);
  pointer-events: none;
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

.origin-quote-wrap {
  position: relative;
  z-index: 1;
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
  max-width: 18ch;
  font-size: clamp(24px, 3.2vw, 36px);
  line-height: 1.18;
  letter-spacing: -0.03em;
  font-weight: 700;
  color: var(--landing-card-title);
}

.origin-copy {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.origin-paragraph {
  margin: 0;
  font-size: 15px;
  line-height: 1.95;
  color: var(--landing-card-text);
  opacity: 0;
  transform: translateY(16px);
  animation: origin-copy-in 0.7s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
  animation-delay: calc(0.18s + var(--paragraph-delay, 0ms));
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

  .origin-panel {
    border-radius: 22px;
  }

  .origin-panel::after {
    border-radius: 21px;
  }

  .origin-quote {
    max-width: none;
  }
}
</style>
