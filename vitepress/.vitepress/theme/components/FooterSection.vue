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
  <footer class="site-footer">
    <div class="footer-glow"></div>

    <div class="footer-inner">
      <!-- 上部：链接区 -->
      <div class="footer-grid">
        <!-- 品牌区 -->
        <div class="footer-brand">
          <span class="brand-name">Tavern<span class="accent">Headless</span></span>
          <p class="brand-desc">为开发者而生的 AI RP 后端引擎</p>
          <div class="brand-links">
            <a
              href="https://github.com/HerSophia/TavernHeadless"
              target="_blank"
              rel="noopener noreferrer"
              class="social-link"
              aria-label="GitHub"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
              </svg>
            </a>
          </div>
        </div>

        <!-- 链接列 -->
        <div v-for="group in links" :key="group.title" class="footer-col">
          <h4 class="col-title">{{ group.title }}</h4>
          <ul class="col-list">
            <li v-for="item in group.items" :key="item.text">
              <a :href="withBase(item.link)" class="col-link">{{ item.text }}</a>
            </li>
          </ul>
        </div>
      </div>

      <!-- 分割线 -->
      <div class="footer-divider"></div>

      <!-- 下部：版权 -->
      <div class="footer-bottom">
        <p class="copyright">© {{ currentYear }} TavernHeadless · MIT License</p>
        <p class="powered">基于 VitePress 构建</p>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.site-footer {
  position: relative;
  width: 100vw;
  margin-left: calc(50% - 50vw);
  overflow: hidden;
  border-top: 1px solid var(--vp-c-divider);
}

/* 顶部渐变光 */
.footer-glow {
  position: absolute;
  top: -1px;
  left: 50%;
  transform: translateX(-50%);
  width: 600px;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    var(--vp-c-brand-1) 50%,
    transparent 100%
  );
}

.footer-glow::after {
  content: '';
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 300px;
  height: 60px;
  background: radial-gradient(
    ellipse at center top,
    rgba(45, 212, 191, 0.08) 0%,
    transparent 80%
  );
}

.footer-inner {
  max-width: 1080px;
  margin: 0 auto;
  padding: 64px 24px 40px;
}

/* ========== 链接网格 ========== */
.footer-grid {
  display: grid;
  grid-template-columns: 2fr repeat(3, 1fr);
  gap: 40px;
}

@media (max-width: 768px) {
  .footer-grid {
    grid-template-columns: 1fr 1fr;
    gap: 32px;
  }

  .footer-brand {
    grid-column: 1 / -1;
  }
}

@media (max-width: 480px) {
  .footer-grid {
    grid-template-columns: 1fr;
  }
}

/* ========== 品牌区 ========== */
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
  font-size: 14px;
  color: var(--vp-c-text-3);
  margin: 0;
  max-width: 240px;
  line-height: 1.5;
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

/* ========== 链接列 ========== */
.footer-col {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.col-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--vp-c-text-2);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin: 0;
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
  font-size: 14px;
  color: var(--vp-c-text-3);
  text-decoration: none;
  transition: color 0.2s ease;
  display: inline-block;
}

.col-link:hover {
  color: var(--vp-c-brand-1);
}

/* ========== 分割线 ========== */
.footer-divider {
  height: 1px;
  background: var(--vp-c-divider);
  margin: 40px 0 24px;
}

/* ========== 底部 ========== */
.footer-bottom {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.copyright,
.powered {
  font-size: 13px;
  color: var(--vp-c-text-3);
  margin: 0;
}

.powered {
  opacity: 0.6;
}
</style>
