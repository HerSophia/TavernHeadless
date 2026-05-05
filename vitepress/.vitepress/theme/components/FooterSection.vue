<script setup lang="ts">
import { withBase } from 'vitepress'

const currentYear = new Date().getFullYear()

const links = [
  {
    title: '指南',
    items: [
      { text: '简介', link: '/guide/introduction' },
      { text: '快速开始', link: '/guide/getting-started' },
      { text: '架构设计', link: '/guide/architecture' },
    ],
  },
  {
    title: '参考',
    items: [
      { text: 'API 参考', link: '/reference/api' },
      { text: '数据库字典', link: '/reference/database' },
      { text: '开发进度', link: '/progress/' },
      { text: '思路', link: '/ideas/' },
    ],
  },
  {
    title: '开发',
    items: [
      { text: '协作指南', link: '/development/contributing' },
      { text: '测试与 CI', link: '/development/testing' },
      { text: '文档规范', link: '/development/doc-standards' },
    ],
  },
]
</script>

<template>
  <footer
    id="landing-start"
    class="site-footer landing-fullscreen"
    data-landing-section="start"
    data-section-title="开始接入"
    data-section-label="开始"
  >
    <div class="footer-glow"></div>

    <div class="landing-shell footer-shell">
      <div class="footer-cta">
        <h2 class="footer-title">开始接入</h2>
        <p class="footer-summary">
          从快速开始上手，用 SDK 文档完成接入。系统全貌看架构设计。
        </p>

        <div class="footer-actions">
          <a class="footer-btn footer-btn-primary" :href="withBase('/guide/getting-started')">快速开始</a>
          <a class="footer-btn footer-btn-ghost" href="https://github.com/HerSophia/TavernHeadless" target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
        </div>
      </div>

      <div class="footer-grid">
        <div class="footer-brand">
          <span class="brand-name">Tavern<span class="accent">Headless</span></span>
          <p class="brand-desc">面向开发者的 AI RP 后端引擎</p>
          <div class="brand-links">
            <a
              href="https://github.com/HerSophia/TavernHeadless"
              target="_blank"
              rel="noopener noreferrer"
              class="social-link"
              aria-label="GitHub"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
              </svg>
            </a>
          </div>
        </div>

        <div v-for="group in links" :key="group.title" class="footer-col">
          <h4 class="col-title">{{ group.title }}</h4>
          <ul class="col-list">
            <li v-for="item in group.items" :key="item.text">
              <a :href="withBase(item.link)" class="col-link">{{ item.text }}</a>
            </li>
          </ul>
        </div>
      </div>

      <div class="footer-divider"></div>

      <div class="footer-bottom">
        <p class="copyright">© {{ currentYear }} TavernHeadless · MIT License</p>
        <p class="powered">基于 VitePress 构建</p>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.site-footer {
  overflow: hidden;
  border-top: 1px solid var(--vp-c-divider);
  background:
    radial-gradient(circle at top center, rgba(45, 212, 191, 0.08), transparent 30%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.02), transparent 26%);
}

.footer-glow {
  position: absolute;
  top: -1px;
  left: 50%;
  transform: translateX(-50%);
  width: 600px;
  height: 1px;
  background: linear-gradient(90deg, transparent 0%, var(--vp-c-brand-1) 50%, transparent 100%);
}

.footer-glow::after {
  content: '';
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 300px;
  height: 60px;
  background: radial-gradient(ellipse at center top, rgba(45, 212, 191, 0.08) 0%, transparent 80%);
}

.footer-shell {
  gap: 28px;
}

.footer-cta {
  max-width: 760px;
  margin: 0 auto;
  text-align: center;
}

.footer-title {
  margin: 0 0 14px;
  font-size: clamp(30px, 4vw, 44px);
  line-height: 1.08;
  letter-spacing: -0.03em;
  font-weight: 800;
  color: var(--vp-c-text-1);
  border: none !important;
  padding: 0 !important;
}

.footer-summary {
  margin: 0;
  font-size: 15px;
  line-height: 1.8;
  color: var(--vp-c-text-2);
}

.footer-actions {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 26px;
}

.footer-btn {
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

.footer-btn:hover {
  transform: translateY(-2px);
}

.footer-btn-primary {
  background: var(--vp-c-brand-1);
  color: #0a0a0b;
  box-shadow: 0 16px 36px -26px rgba(45, 212, 191, 0.75);
}

.footer-btn-primary:hover {
  background: var(--vp-c-brand-2);
}

.footer-btn-ghost {
  border-color: var(--landing-card-border);
  color: var(--vp-c-text-1);
  background: rgba(255, 255, 255, 0.04);
}

.footer-btn-ghost:hover {
  border-color: rgba(45, 212, 191, 0.28);
  background: rgba(45, 212, 191, 0.06);
}

.footer-grid {
  display: grid;
  grid-template-columns: 2fr repeat(3, 1fr);
  gap: 36px;
}

.footer-brand {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.brand-name {
  font-size: 18px;
  font-weight: 700;
  color: var(--vp-c-text-1);
}

.brand-name .accent {
  background: linear-gradient(135deg, #2dd4bf, #818cf8);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.brand-desc {
  margin: 0;
  max-width: 260px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--vp-c-text-3);
}

.brand-links {
  display: flex;
  gap: 12px;
  margin-top: 4px;
}

.social-link {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  color: var(--vp-c-text-3);
  background: transparent;
  border: 1px solid var(--vp-c-divider);
  transition: all 0.25s ease;
}

.social-link:hover {
  color: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
  background: rgba(45, 212, 191, 0.06);
}

.footer-col {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.col-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--vp-c-text-2);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  border: none !important;
  padding: 0 !important;
}

.col-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.col-link {
  display: inline-block;
  font-size: 14px;
  color: var(--vp-c-text-3);
  text-decoration: none;
  transition: color 0.2s ease;
}

.col-link:hover {
  color: var(--vp-c-brand-1);
}

.footer-divider {
  height: 1px;
  background: var(--vp-c-divider);
}

.footer-bottom {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.copyright,
.powered {
  margin: 0;
  font-size: 13px;
  color: var(--vp-c-text-3);
}

.powered {
  opacity: 0.6;
}

@media (max-width: 900px) {
  .footer-grid {
    grid-template-columns: 1fr 1fr;
    gap: 28px;
  }

  .footer-brand {
    grid-column: 1 / -1;
  }
}

@media (max-width: 520px) {
  .footer-grid {
    grid-template-columns: 1fr;
  }
}
</style>
