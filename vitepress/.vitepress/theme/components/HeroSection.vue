<script setup lang="ts">
import { withBase } from 'vitepress'
import { onMounted, ref } from 'vue'

const visible = ref(false)
const sectionRef = ref<HTMLElement | null>(null)
const pointerMotionEnabled = ref(false)

function syncPointerMotionAvailability() {
  if (typeof window === 'undefined') return

  pointerMotionEnabled.value =
    window.matchMedia('(pointer: fine)').matches &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function resetPointerMotion() {
  if (!sectionRef.value) return

  sectionRef.value.style.setProperty('--hero-pointer-x', '50%')
  sectionRef.value.style.setProperty('--hero-pointer-y', '50%')
  sectionRef.value.style.setProperty('--hero-shift-x', '0px')
  sectionRef.value.style.setProperty('--hero-shift-y', '0px')
}

function handlePointerMove(event: PointerEvent) {
  if (!pointerMotionEnabled.value || !sectionRef.value) return

  const rect = sectionRef.value.getBoundingClientRect()
  const x = event.clientX - rect.left
  const y = event.clientY - rect.top
  const ratioX = x / rect.width - 0.5
  const ratioY = y / rect.height - 0.5
  sectionRef.value.style.setProperty('--hero-pointer-x', `${x}px`)
  sectionRef.value.style.setProperty('--hero-pointer-y', `${y}px`)
  sectionRef.value.style.setProperty('--hero-shift-x', `${ratioX * 42}px`)
  sectionRef.value.style.setProperty('--hero-shift-y', `${ratioY * 30}px`)
}

onMounted(() => {
  syncPointerMotionAvailability()
  resetPointerMotion()

  requestAnimationFrame(() => {
    visible.value = true
  })
})

const particles = Array.from({ length: 24 }, (_, i) => ({
  id: i,
  left: ((i * 4.3 + 7) % 96) + 2,
  size: 1 + (i % 3),
  duration: 16 + (i % 7) * 2,
  delay: -(i * 1.7),
  opacity: 0.08 + (i % 5) * 0.05,
}))

function scrollToOverview() {
  const nextSection = document.getElementById('landing-stats')
  if (!nextSection) return

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  nextSection.scrollIntoView({
    behavior: prefersReducedMotion ? 'auto' : 'smooth',
    block: 'start',
  })
}
</script>

<template>
  <section
    id="landing-hero"
    ref="sectionRef"
    class="hero-section landing-fullscreen"
    data-landing-section="hero"
    data-section-title="首页"
    data-section-label="首页"
    @pointermove="handlePointerMove"
    @pointerleave="resetPointerMotion"
  >
    <div class="hero-bg">
      <div class="grid-overlay"></div>
      <div class="radial-mask"></div>
      <div class="glow glow-tl"></div>
      <div class="glow glow-br"></div>
      <div class="glow glow-center"></div>

      <div class="particles">
        <span
          v-for="p in particles"
          :key="p.id"
          class="particle"
          :style="{
            left: `${p.left}%`,
            width: `${p.size}px`,
            height: `${p.size}px`,
            opacity: p.opacity,
            animationDuration: `${p.duration}s`,
            animationDelay: `${p.delay}s`,
          }"
        ></span>
      </div>
    </div>

    <div class="hero-content" :class="{ visible }">
      <p class="hero-badge">
        <span class="badge-dot"></span>
        后端 v0.2 · 项目整体已入轨
      </p>

      <h1 class="hero-title">
        <span class="title-line">Tavern</span>
        <span class="title-line accent">Headless</span>
      </h1>

      <p class="hero-subtitle">为下一代 AI RP 平台构建基础设施</p>

      <p class="hero-tagline">
        面向开发者的 AI RP 后端引擎 · Headless 架构 · SillyTavern 兼容 · TypeScript 全栈
      </p>

      <div class="hero-actions">
        <a class="btn btn-primary" :href="withBase('/guide/getting-started')">
          快速开始
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </a>
        <a class="btn btn-ghost" :href="withBase('/guide/architecture')">架构设计</a>
        <a class="btn btn-ghost" href="https://github.com/HerSophia/TavernHeadless" target="_blank" rel="noreferrer">
          GitHub
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M7 17L17 7M7 7h10v10" />
          </svg>
        </a>
      </div>
    </div>

    <button class="hero-scroll-hint" type="button" @click="scrollToOverview">
      <span class="scroll-text">继续浏览</span>
      <span class="scroll-next">下一屏：引擎一览</span>
      <span class="scroll-line"></span>
    </button>

    <div class="hero-fade-bottom"></div>
  </section>
</template>

<style scoped>
.hero-section {
  --hero-pointer-x: 50%;
  --hero-pointer-y: 50%;
  --hero-shift-x: 0px;
  --hero-shift-y: 0px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  perspective: 1200px;
}

.hero-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  transform-style: preserve-3d;
}


.grid-overlay {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(45, 212, 191, 0.06) 1px, transparent 1px),
    linear-gradient(90deg, rgba(45, 212, 191, 0.06) 1px, transparent 1px);
  background-size: 60px 60px;
  mask-image: radial-gradient(ellipse 70% 50% at 50% 50%, black 20%, transparent 100%);
  -webkit-mask-image: radial-gradient(ellipse 70% 50% at 50% 50%, black 20%, transparent 100%);
  transform: translate3d(calc(var(--hero-shift-x) * -0.18), calc(var(--hero-shift-y) * -0.16), 0) scale(1.02);
  transition: transform 0.32s ease;
  animation: grid-breathe 8s ease-in-out infinite;
}

@keyframes grid-breathe {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

.radial-mask {
  position: absolute;
  inset: 0;
  background: radial-gradient(
    ellipse 60% 60% at 50% 45%,
    rgba(45, 212, 191, 0.04) 0%,
    transparent 70%
  );
  transform: translate3d(calc(var(--hero-shift-x) * -0.08), calc(var(--hero-shift-y) * -0.08), 0);
  transition: transform 0.32s ease;
}

.glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  opacity: 0;
  animation: glow-fade-in 2s ease forwards;
  transition: transform 0.45s ease, opacity 0.4s ease;
}

.glow-tl {
  width: 400px;
  height: 400px;
  background: rgba(45, 212, 191, 0.12);
  top: -100px;
  left: 10%;
  transform: translate3d(calc(var(--hero-shift-x) * -0.34), calc(var(--hero-shift-y) * -0.2), 0);
  animation-delay: 0.5s;
}

.glow-br {
  width: 350px;
  height: 350px;
  background: rgba(129, 140, 248, 0.1);
  bottom: -80px;
  right: 15%;
  transform: translate3d(calc(var(--hero-shift-x) * 0.26), calc(var(--hero-shift-y) * 0.18), 0);
  animation-delay: 1s;
}

.glow-center {
  width: 500px;
  height: 500px;
  background: rgba(45, 212, 191, 0.04);
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) translate3d(calc(var(--hero-shift-x) * 0.12), calc(var(--hero-shift-y) * 0.1), 0);
  animation-delay: 0.2s;
  filter: blur(120px);
}

@keyframes glow-fade-in {
  to { opacity: 1; }
}

.particles {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  transform: translate3d(calc(var(--hero-shift-x) * 0.08), calc(var(--hero-shift-y) * 0.08), 0);
  transition: transform 0.35s ease;
}

.particle {
  position: absolute;
  bottom: -10px;
  border-radius: 50%;
  background: var(--vp-c-brand-1);
  animation: float-up linear infinite;
}

@keyframes float-up {
  0% {
    transform: translateY(0) translateX(0);
    opacity: 0;
  }
  5% {
    opacity: var(--particle-peak, 0.2);
  }
  90% {
    opacity: var(--particle-peak, 0.2);
  }
  100% {
    transform: translateY(-110vh) translateX(30px);
    opacity: 0;
  }
}

.hero-fade-bottom {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 120px;
  background: linear-gradient(to bottom, transparent, var(--vp-c-bg));
  z-index: 2;
  pointer-events: none;
}

.hero-content {
  position: relative;
  z-index: 1;
  text-align: center;
  max-width: 760px;
  padding: 0 24px;
  transform: translate3d(calc(var(--hero-shift-x) * 0.08), calc(var(--hero-shift-y) * 0.08), 0);
  transition: transform 0.28s ease;
}

.hero-content .hero-badge,
.hero-content .hero-title,
.hero-content .hero-subtitle,
.hero-content .hero-tagline,
.hero-content .hero-actions {
  opacity: 0;
  transform: translateY(24px);
  transition: opacity 0.8s ease, transform 0.8s ease;
}

.hero-content.visible .hero-badge { opacity: 1; transform: none; transition-delay: 0s; }
.hero-content.visible .hero-title { opacity: 1; transform: none; transition-delay: 0.1s; }
.hero-content.visible .hero-subtitle { opacity: 1; transform: none; transition-delay: 0.2s; }
.hero-content.visible .hero-tagline { opacity: 1; transform: none; transition-delay: 0.3s; }
.hero-content.visible .hero-actions { opacity: 1; transform: none; transition-delay: 0.4s; }

.hero-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 16px;
  border-radius: 999px;
  border: 1px solid rgba(45, 212, 191, 0.25);
  background: rgba(45, 212, 191, 0.06);
  color: var(--vp-c-brand-1);
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.02em;
  margin-bottom: 32px;
}

.badge-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--vp-c-brand-1);
  animation: badge-pulse 2s ease-in-out infinite;
}

@keyframes badge-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.hero-title {
  margin: 0 0 20px;
  font-size: clamp(48px, 8vw, 86px);
  font-weight: 800;
  line-height: 1.02;
  letter-spacing: -0.04em;
}

.title-line {
  display: block;
  color: var(--vp-c-text-1);
}

.title-line.accent {
  background: linear-gradient(135deg, #2dd4bf 0%, #34d399 25%, #818cf8 50%, #a78bfa 75%, #2dd4bf 100%);
  background-size: 300% 300%;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: gradient-shift 8s ease infinite;
}

@keyframes gradient-shift {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}

.hero-subtitle {
  margin: 0 0 12px;
  font-size: clamp(20px, 3.2vw, 28px);
  font-weight: 600;
  line-height: 1.45;
  color: var(--vp-c-text-1);
}

.hero-tagline {
  margin: 0 0 40px;
  font-size: 15px;
  line-height: 1.8;
  color: var(--vp-c-text-3);
  letter-spacing: 0.02em;
}

.hero-actions {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 12px;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 12px 24px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  transition: all 0.25s ease;
}

.btn-primary {
  background: var(--vp-c-brand-1);
  color: #0a0a0b;
  box-shadow: 0 0 0 0 rgba(45, 212, 191, 0);
}

.btn-primary:hover {
  background: var(--vp-c-brand-2);
  box-shadow: 0 0 24px 4px rgba(45, 212, 191, 0.25);
  transform: translateY(-1px);
}

.btn-ghost {
  background: transparent;
  color: var(--vp-c-text-2);
  border: 1px solid var(--vp-c-divider);
}

.btn-ghost:hover {
  color: var(--vp-c-text-1);
  border-color: var(--vp-c-brand-1);
  background: rgba(45, 212, 191, 0.05);
}

.hero-scroll-hint {
  position: absolute;
  left: 50%;
  bottom: 28px;
  z-index: 3;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  transform: translateX(-50%) translate3d(calc(var(--hero-shift-x) * 0.06), 0, 0);
  color: var(--vp-c-text-3);
  background: transparent;
  border: 0;
  padding: 0;
  cursor: pointer;
  transition: color 0.2s ease, transform 0.28s ease;
}

.hero-scroll-hint:hover .scroll-text,
.hero-scroll-hint:hover .scroll-next {
  color: var(--vp-c-text-2);
}

.scroll-text {
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  transition: color 0.2s ease;
}

.scroll-next {
  font-size: 12px;
  color: var(--vp-c-text-3);
  transition: color 0.2s ease;
}

.scroll-line {
  position: relative;
  width: 1px;
  height: 40px;
  background: linear-gradient(180deg, rgba(45, 212, 191, 0), rgba(45, 212, 191, 0.45));
  overflow: hidden;
}

.scroll-line::after {
  content: '';
  position: absolute;
  left: 0;
  top: -14px;
  width: 100%;
  height: 14px;
  background: var(--vp-c-brand-1);
  animation: scroll-drop 1.8s ease-in-out infinite;
}

@keyframes scroll-drop {
  0% { transform: translateY(0); opacity: 0; }
  20% { opacity: 1; }
  100% { transform: translateY(54px); opacity: 0; }
}

:root:not(.dark) .grid-overlay {
  background-image:
    linear-gradient(rgba(45, 212, 191, 0.08) 1px, transparent 1px),
    linear-gradient(90deg, rgba(45, 212, 191, 0.08) 1px, transparent 1px);
}

:root:not(.dark) .glow-tl {
  background: rgba(45, 212, 191, 0.08);
}

:root:not(.dark) .glow-br {
  background: rgba(129, 140, 248, 0.06);
}

:root:not(.dark) .glow-center {
  background: rgba(45, 212, 191, 0.03);
}

:root:not(.dark) .particle {
  background: var(--vp-c-brand-3);
}

:root:not(.dark) .hero-badge {
  background: rgba(255, 255, 255, 0.76);
  border-color: rgba(45, 212, 191, 0.20);
  box-shadow: 0 18px 32px -28px rgba(15, 23, 42, 0.22);
}

:root:not(.dark) .btn-primary {
  box-shadow: 0 18px 36px -24px rgba(45, 212, 191, 0.32);
}

:root:not(.dark) .btn-ghost {
  color: #334155;
  background: rgba(255, 255, 255, 0.78);
  border-color: rgba(15, 23, 42, 0.10);
  box-shadow: 0 14px 28px -24px rgba(15, 23, 42, 0.20);
}

:root:not(.dark) .btn-ghost:hover {
  color: #0f172a;
  background: rgba(255, 255, 255, 0.96);
  border-color: rgba(45, 212, 191, 0.26);
}

:root:not(.dark) .hero-scroll-hint {
  color: #475569;
}

:root:not(.dark) .scroll-next {
  color: #64748b;
}

@media (pointer: coarse), (prefers-reduced-motion: reduce) {

  .hero-content,
  .hero-scroll-hint,
  .particles,
  .grid-overlay,
  .radial-mask,
  .glow-tl,
  .glow-br,
  .glow-center {
    transform: none !important;
  }
}

@media (max-width: 640px) {
  .hero-scroll-hint {
    bottom: 22px;
  }

  .scroll-line {
    height: 28px;
  }

  .scroll-next {
    display: none;
  }
}
</style>
