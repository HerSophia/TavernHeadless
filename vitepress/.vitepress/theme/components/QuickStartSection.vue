<script setup lang="ts">
import { withBase } from 'vitepress'
import TerminalDemo from './TerminalDemo.vue'

const points = [
  'createTavernClient() 把 baseUrl、headers 和底层请求收拢到一处',
  'respondStream() 封装了 SSE 读取，你只要写回调',
  '入参、返回值和错误对象都有类型',
]
</script>

<template>
  <section
    id="landing-sdk"
    class="quick-start-section landing-fullscreen"
    data-landing-section="sdk"
    data-section-title="SDK 接入"
    data-section-label="SDK"
  >
    <div class="landing-shell quick-start-shell">
      <div class="quick-start-copy">
        <h2 class="quick-start-title">用 SDK 接入</h2>
        <p class="quick-start-desc">
          不用自己拼 HTTP 请求和 SSE 解析。SDK 已经按资源分好了方法，直接调就行。
        </p>

        <div class="quick-start-tags">
          <span class="quick-start-tag">资源方法</span>
          <span class="quick-start-tag">SSE 回调</span>
          <span class="quick-start-tag">统一错误</span>
        </div>

        <ul class="quick-start-points">
          <li v-for="point in points" :key="point">{{ point }}</li>
        </ul>

        <div class="quick-start-actions">
          <a class="quick-btn quick-btn-primary" :href="withBase('/sdk/')">查看 SDK 文档</a>
          <a class="quick-btn quick-btn-ghost" :href="withBase('/guide/integration-kit')">官方集成层</a>
        </div>
      </div>

      <div class="quick-start-demo">
        <TerminalDemo />
      </div>
    </div>
  </section>
</template>

<style scoped>
.quick-start-section {
  background:
    radial-gradient(circle at 20% 20%, rgba(45, 212, 191, 0.08), transparent 38%),
    radial-gradient(circle at 80% 75%, rgba(129, 140, 248, 0.08), transparent 34%);
}

.quick-start-shell {
  display: grid;
  grid-template-columns: minmax(0, 420px) minmax(0, 1fr);
  align-items: center;
  gap: 56px;
}

.quick-start-copy {
  max-width: 420px;
}

.quick-start-title {
  margin: 0 0 14px;
  font-size: clamp(30px, 4vw, 44px);
  line-height: 1.08;
  letter-spacing: -0.03em;
  font-weight: 800;
  color: var(--vp-c-text-1);
  border: none !important;
  padding: 0 !important;
}

.quick-start-desc {
  margin: 0;
  font-size: 15px;
  line-height: 1.8;
  color: var(--vp-c-text-2);
}

.quick-start-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 22px 0 20px;
}

.quick-start-tag {
  display: inline-flex;
  align-items: center;
  padding: 7px 12px;
  border-radius: 999px;
  border: 1px solid rgba(45, 212, 191, 0.18);
  background: rgba(45, 212, 191, 0.06);
  color: var(--vp-c-brand-1);
  font-size: 12px;
  font-weight: 500;
}

.quick-start-points {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 12px;
}

.quick-start-points li {
  position: relative;
  padding-left: 18px;
  font-size: 14px;
  line-height: 1.75;
  color: var(--vp-c-text-2);
}

.quick-start-points li::before {
  content: '';
  position: absolute;
  left: 0;
  top: 10px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--vp-c-brand-1), #818cf8);
}

.quick-start-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 28px;
}

.quick-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 132px;
  padding: 12px 18px;
  border-radius: 10px;
  border: 1px solid transparent;
  text-decoration: none;
  font-size: 14px;
  font-weight: 600;
  transition: transform 0.25s ease, border-color 0.25s ease, background 0.25s ease, box-shadow 0.25s ease;
}

.quick-btn:hover {
  transform: translateY(-2px);
}

.quick-btn-primary {
  background: var(--vp-c-brand-1);
  color: #0a0a0b;
  box-shadow: 0 16px 36px -26px rgba(45, 212, 191, 0.75);
}

.quick-btn-primary:hover {
  background: var(--vp-c-brand-2);
}

.quick-btn-ghost {
  border-color: var(--landing-card-border);
  color: var(--vp-c-text-1);
  background: rgba(255, 255, 255, 0.04);
}

.quick-btn-ghost:hover {
  border-color: rgba(45, 212, 191, 0.28);
  background: rgba(45, 212, 191, 0.06);
}

.quick-start-demo {
  min-width: 0;
}

@media (max-width: 980px) {
  .quick-start-shell {
    grid-template-columns: 1fr;
    gap: 32px;
  }

  .quick-start-copy {
    max-width: none;
  }
}
</style>
