<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { withBase } from 'vitepress'

const visible = ref(false)

onMounted(() => {
  requestAnimationFrame(() => {
    visible.value = true
  })
})
</script>

<template>
  <section class="hero-section">
    <!-- 背景层 -->
    <div class="hero-bg">
      <div class="grid-overlay"></div>
      <div class="radial-mask"></div>
      <div class="glow glow-tl"></div>
      <div class="glow glow-br"></div>
    </div>

    <!-- 内容层 -->
    <div class="hero-content" :class="{ visible }">
      <p class="hero-badge">
        <span class="badge-dot"></span>
        Alpha · 持续构建中
      </p>

      <h1 class="hero-title">
        <span class="title-line">Tavern</span>
        <span class="title-line accent">Headless</span>
      </h1>

      <p class="hero-subtitle">为开发者而生的 AI RP 后端引擎</p>

      <p class="hero-tagline">
        Headless 架构 · SillyTavern 兼容 · TypeScript 全栈
      </p>

      <div class="hero-actions">
        <a class="btn btn-primary" :href="withBase('/guide/getting-started')">
          快速开始
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
        </a>
        <a class="btn btn-ghost" :href="withBase('/guide/architecture')">
          架构设计
        </a>
        <a class="btn btn-ghost" href="https://github.com/HerSophia/TavernHeadless" target="_blank">
          GitHub
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M7 17L17 7M7 7h10v10"/>
          </svg>
        </a>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* ========== 整体区域 ========== */
.hero-section {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  overflow: hidden;
  /* 突破 VitePress 容器宽度限制 */
  width: 100vw;
  margin-left: calc(50% - 50vw);
}

/* ========== 背景层 ========== */
.hero-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
}

/* 透视网格 */
.grid-overlay {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(45, 212, 191, 0.06) 1px, transparent 1px),
    linear-gradient(90deg, rgba(45, 212, 191, 0.06) 1px, transparent 1px);
  background-size: 60px 60px;
  mask-image: radial-gradient(ellipse 70% 50% at 50% 50%, black 20%, transparent 100%);
  -webkit-mask-image: radial-gradient(ellipse 70% 50% at 50% 50%, black 20%, transparent 100%);
}

/* 径向遮罩：中心亮四周暗 */
.radial-mask {
  position: absolute;
  inset: 0;
  background: radial-gradient(
    ellipse 60% 60% at 50% 45%,
    rgba(45, 212, 191, 0.04) 0%,
    transparent 70%
  );
}

/* 光晕 */
.glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  opacity: 0;
  animation: glow-fade-in 2s ease forwards;
}

.glow-tl {
  width: 400px;
  height: 400px;
  background: rgba(45, 212, 191, 0.12);
  top: -100px;
  left: 10%;
  animation-delay: 0.5s;
}

.glow-br {
  width: 350px;
  height: 350px;
  background: rgba(129, 140, 248, 0.10);
  bottom: -80px;
  right: 15%;
  animation-delay: 1s;
}

@keyframes glow-fade-in {
  to { opacity: 1; }
}

/* ========== 内容层 ========== */
.hero-content {
  position: relative;
  z-index: 1;
  text-align: center;
  max-width: 720px;
  padding: 0 24px;
}

/* 入场动画 */
.hero-content .hero-badge,
.hero-content .hero-title,
.hero-content .hero-subtitle,
.hero-content .hero-tagline,
.hero-content .hero-actions {
  opacity: 0;
  transform: translateY(24px);
  transition: opacity 0.8s ease, transform 0.8s ease;
}

.hero-content.visible .hero-badge     { opacity: 1; transform: none; transition-delay: 0s; }
.hero-content.visible .hero-title     { opacity: 1; transform: none; transition-delay: 0.1s; }
.hero-content.visible .hero-subtitle  { opacity: 1; transform: none; transition-delay: 0.2s; }
.hero-content.visible .hero-tagline   { opacity: 1; transform: none; transition-delay: 0.3s; }
.hero-content.visible .hero-actions   { opacity: 1; transform: none; transition-delay: 0.4s; }

/* ========== Badge ========== */
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

/* ========== 标题 ========== */
.hero-title {
  font-size: clamp(48px, 8vw, 80px);
  font-weight: 800;
  line-height: 1.05;
  letter-spacing: -0.03em;
  margin: 0 0 20px;
}

.title-line {
  display: block;
  color: var(--vp-c-text-1);
}

.title-line.accent {
  background: linear-gradient(
    135deg,
    #2dd4bf 0%,
    #34d399 25%,
    #818cf8 50%,
    #a78bfa 75%,
    #2dd4bf 100%
  );
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

/* ========== 副标题 / Tagline ========== */
.hero-subtitle {
  font-size: clamp(18px, 3vw, 24px);
  font-weight: 400;
  color: var(--vp-c-text-1);
  margin: 0 0 12px;
}

.hero-tagline {
  font-size: 15px;
  color: var(--vp-c-text-3);
  margin: 0 0 40px;
  letter-spacing: 0.04em;
}

/* ========== 按钮 ========== */
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
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  transition: all 0.25s ease;
  cursor: pointer;
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

/* ========== 亮色模式适配 ========== */
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
</style>
