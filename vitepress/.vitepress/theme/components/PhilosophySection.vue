<script setup lang="ts">
const items = [
  {
    icon: 'audit',
    title: '可审计',
    en: 'Auditable',
    summary: '每一次写入、调用、允许与拒绝都留痕。operation log、工具执行记录与权限审计，让“谁在何时、依据什么改了什么”始终可回查。',
  },
  {
    icon: 'govern',
    title: '可治理',
    en: 'Governable',
    summary: '能力不默认全开。权限分层、预算与配额、作用域收窄、敏感字段脱敏——每一项 LLM、工具与数据能力都运行在可控边界内。',
  },
  {
    icon: 'revert',
    title: '可回退',
    en: 'Reversible',
    summary: '错误的生成不该污染正史。暂存写入配合 CommitGate、Floor / Page 重试、版本与备份恢复，让任何一步都能回到已知良好的状态。',
  },
  {
    icon: 'compare',
    title: '可比较',
    en: 'Comparable',
    summary: '同一处境可以有多种走向。分支、楼层重试、提示词与配置 diff，让不同生成、不同版本并排对照，而不是只能覆盖式地二选一。',
  },
  {
    icon: 'explain',
    title: '可解释',
    en: 'Explainable',
    summary: '黑箱不是默认。Prompt Runtime trace、记忆注入追踪与作用域解析，让“这一轮为什么这样生成、这条内容从哪来”都能被说清楚。',
  },
]
</script>

<template>
  <section
    id="landing-philosophy"
    class="philosophy-section landing-fullscreen"
    data-landing-section="philosophy"
    data-section-title="设计理念"
    data-section-label="理念"
  >
    <div class="philosophy-glow"></div>

    <div class="landing-shell philosophy-shell">
      <div class="philosophy-header">
        <span class="philosophy-kicker">设计理念</span>
        <h2 class="philosophy-title">对抗不确定性的五个维度</h2>
        <p class="philosophy-desc">
          LLM 会胡说、会忘事、会自相矛盾。在不断打磨这套引擎的过程中，
          我们把“如何与这种不确定性共处”收敛成五个维度——可审计、可治理、可回退、可比较、可解释。
          它们不只是 TavernHeadless 的取舍，也是几乎每个严肃 LLM RP 项目迟早要回答的问题。
        </p>
      </div>

      <div class="philosophy-grid">
        <div v-for="item in items" :key="item.title" class="philosophy-card">
          <div class="philosophy-card-icon">
            <!-- audit -->
            <svg v-if="item.icon === 'audit'" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
              <rect x="8" y="2" width="8" height="4" rx="1" />
              <path d="m9 14 2 2 4-4" />
            </svg>
            <!-- govern -->
            <svg v-else-if="item.icon === 'govern'" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            <!-- revert -->
            <svg v-else-if="item.icon === 'revert'" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
            <!-- compare -->
            <svg v-else-if="item.icon === 'compare'" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="7" height="18" rx="1" />
              <rect x="14" y="3" width="7" height="18" rx="1" />
            </svg>
            <!-- explain -->
            <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </div>

          <h3 class="philosophy-card-title">{{ item.title }}</h3>
          <p class="philosophy-card-meta">{{ item.en }}</p>
          <p class="philosophy-card-desc">{{ item.summary }}</p>
        </div>
      </div>

      <p class="philosophy-footnote">
        这五个维度不是口号。它们对应着 operation log 与权限审计、作用域与预算治理、CommitGate 与备份恢复、分支与 diff、Prompt Runtime trace 等贯穿全栈的具体机制。
      </p>
    </div>
  </section>
</template>

<style scoped>
.philosophy-section {
  position: relative;
  overflow: hidden;
  background:
    radial-gradient(circle at 25% 25%, rgba(45, 212, 191, 0.1), transparent 38%),
    radial-gradient(circle at 75% 70%, rgba(129, 140, 248, 0.07), transparent 36%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.02), transparent 20%);
}

.philosophy-glow {
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 500px;
  height: 1px;
  background: linear-gradient(90deg, transparent 0%, rgba(45, 212, 191, 0.32) 50%, transparent 100%);
}

.philosophy-shell {
  gap: 32px;
}

.philosophy-header {
  max-width: 760px;
  margin: 0 auto;
  text-align: center;
}

.philosophy-kicker {
  display: inline-flex;
  align-items: center;
  padding: 5px 12px;
  border-radius: 999px;
  border: 1px solid rgba(45, 212, 191, 0.24);
  background: rgba(45, 212, 191, 0.07);
  color: var(--vp-c-brand-1);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  margin-bottom: 18px;
}

.philosophy-title {
  margin: 0 0 14px;
  font-size: clamp(30px, 4vw, 44px);
  font-weight: 800;
  line-height: 1.08;
  letter-spacing: -0.03em;
  color: var(--vp-c-text-1);
  border: none !important;
  padding: 0 !important;
}

.philosophy-desc {
  margin: 0;
  font-size: 15px;
  line-height: 1.8;
  color: var(--vp-c-text-2);
}

.philosophy-grid {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 14px;
}

.philosophy-card {
  flex: 0 1 calc((100% - 28px) / 3);
  position: relative;
  overflow: hidden;
  border-radius: 18px;
  border: 1px solid var(--landing-card-border);
  background: var(--landing-card-bg);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  padding: 24px 20px;
  transition: transform 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease;
}

.philosophy-card::after {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(200px circle at 50% 0%, rgba(45, 212, 191, 0.08), transparent 60%);
  opacity: 0;
  transition: opacity 0.25s ease;
  pointer-events: none;
}

.philosophy-card:hover {
  transform: translateY(-3px);
  border-color: rgba(45, 212, 191, 0.3);
  box-shadow: 0 18px 36px -24px rgba(45, 212, 191, 0.32);
}

.philosophy-card:hover::after {
  opacity: 1;
}

.philosophy-card-icon {
  width: 42px;
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: var(--landing-icon-bg);
  color: var(--vp-c-brand-1);
  margin-bottom: 16px;
  transition: background 0.25s ease, transform 0.25s ease;
}

.philosophy-card:hover .philosophy-card-icon {
  background: var(--landing-icon-bg-hover);
  transform: scale(1.05);
}

.philosophy-card-title {
  margin: 0 0 2px;
  font-size: 16px;
  font-weight: 600;
  color: var(--landing-card-title);
  border: none !important;
  padding: 0 !important;
}

.philosophy-card-meta {
  margin: 0 0 10px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--vp-c-brand-1);
  opacity: 0.7;
}

.philosophy-card-desc {
  margin: 0;
  font-size: 14px;
  line-height: 1.7;
  color: var(--landing-card-text);
}

.philosophy-footnote {
  margin: 0 auto;
  text-align: center;
  font-size: 13px;
  line-height: 1.8;
  color: var(--vp-c-text-3);
  opacity: 0.75;
  max-width: 720px;
}

@media (max-width: 960px) {
  .philosophy-card {
    flex-basis: calc((100% - 14px) / 2);
  }
}

@media (max-width: 560px) {
  .philosophy-card {
    flex-basis: 100%;
  }
}
</style>
