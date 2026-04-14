<script setup lang="ts">
import { withBase } from 'vitepress'

const tags = ['变更摘要', 'Skill 引导', '验证清单']

const steps = [
  {
    index: '01',
    title: '看一眼最新变更',
    summary: '打开 /agent/latest.json，几秒就能知道这次主干更新动了哪些接口、改了哪些包导出。',
    actionLabel: '查看 Agent 总入口',
    actionHref: '/agent/',
  },
  {
    index: '02',
    title: '挑一个 Skill 跟着走',
    summary: '做客户端接入就看「客户端接入与升级」，参与仓库开发就看「参与开发与协作」。不用自己拼流程。',
    actionLabel: '查看 Skill 索引',
    actionHref: '/agent/skills/',
  },
  {
    index: '03',
    title: '跑一遍验证收工',
    summary: 'Skill 里列好了验证步骤：typecheck、测试、文档构建，照着顺序来就行。',
    actionLabel: '查看参与开发 Skill',
    actionHref: '/agent/skills/tavern-project-contributing',
  },
]

const scenarios = [
  '第一次接入 TavernHeadless',
  '升级已有的接入代码',
  '参与开发、提交 PR',
]
</script>

<template>
  <section
    id="landing-agent-assist"
    class="agent-assist-section landing-fullscreen"
    data-landing-section="agent-assist"
    data-section-title="Agent 辅助开发"
    data-section-label="Agent"
  >
    <div class="landing-shell agent-assist-shell">
      <div class="agent-assist-copy">
        <h2 class="agent-assist-title">让 Agent 帮你更快上手</h2>
        <p class="agent-assist-desc">
          已经知道要做什么了？不用翻一堆文档。
          看一眼 /agent 里最新的变更摘要，再跟着对应的 Skill 走就行。
        </p>

        <div class="agent-assist-tags">
          <span v-for="tag in tags" :key="tag" class="agent-assist-tag">{{ tag }}</span>
        </div>

        <ul class="agent-assist-scenarios">
          <li v-for="scenario in scenarios" :key="scenario">{{ scenario }}</li>
        </ul>

        <div class="agent-assist-actions">
          <a class="agent-btn agent-btn-primary" :href="withBase('/agent/')">查看 Agent 总入口</a>
          <a class="agent-btn agent-btn-ghost" :href="withBase('/agent/skills/')">查看 Skill 索引</a>
        </div>
      </div>

      <div class="agent-assist-panel">
        <article v-for="step in steps" :key="step.index" class="agent-step-card">
          <span class="agent-step-index">{{ step.index }}</span>
          <h3 class="agent-step-title">{{ step.title }}</h3>
          <p class="agent-step-summary">{{ step.summary }}</p>
          <a class="agent-step-link" :href="withBase(step.actionHref)">{{ step.actionLabel }}</a>
        </article>

        <div class="agent-note-card">
          <span class="agent-note-kicker">一句话说</span>
          <p class="agent-note-text">
            /agent 告诉你「改了什么」，Skill 告诉你「怎么做」。
            对着看，省掉自己整理的时间。
          </p>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.agent-assist-section {
  background:
    radial-gradient(circle at 18% 20%, rgba(45, 212, 191, 0.1), transparent 36%),
    radial-gradient(circle at 80% 78%, rgba(129, 140, 248, 0.08), transparent 32%);
}

.agent-assist-shell {
  display: grid;
  grid-template-columns: minmax(0, 420px) minmax(0, 1fr);
  align-items: center;
  gap: 56px;
}

.agent-assist-copy {
  max-width: 430px;
}

.agent-assist-title {
  margin: 0 0 14px;
  font-size: clamp(30px, 4vw, 44px);
  line-height: 1.08;
  letter-spacing: -0.03em;
  font-weight: 800;
  color: var(--vp-c-text-1);
  border: none !important;
  padding: 0 !important;
}

.agent-assist-desc {
  margin: 0;
  font-size: 15px;
  line-height: 1.8;
  color: var(--vp-c-text-2);
}

.agent-assist-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 22px 0 20px;
}

.agent-assist-tag {
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

.agent-assist-scenarios {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 12px;
}

.agent-assist-scenarios li {
  position: relative;
  padding-left: 18px;
  font-size: 14px;
  line-height: 1.75;
  color: var(--vp-c-text-2);
}

.agent-assist-scenarios li::before {
  content: '';
  position: absolute;
  left: 0;
  top: 10px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--vp-c-brand-1), #818cf8);
}

.agent-assist-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 28px;
}

.agent-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 144px;
  padding: 12px 18px;
  border-radius: 10px;
  border: 1px solid transparent;
  text-decoration: none;
  font-size: 14px;
  font-weight: 600;
  transition: transform 0.25s ease, border-color 0.25s ease, background 0.25s ease, box-shadow 0.25s ease;
}

.agent-btn:hover {
  transform: translateY(-2px);
}

.agent-btn-primary {
  background: var(--vp-c-brand-1);
  color: #0a0a0b;
  box-shadow: 0 16px 36px -26px rgba(45, 212, 191, 0.75);
}

.agent-btn-primary:hover {
  background: var(--vp-c-brand-2);
}

.agent-btn-ghost {
  border-color: var(--landing-card-border);
  color: var(--vp-c-text-1);
  background: rgba(255, 255, 255, 0.04);
}

.agent-btn-ghost:hover {
  border-color: rgba(45, 212, 191, 0.28);
  background: rgba(45, 212, 191, 0.06);
}

.agent-assist-panel {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}

.agent-step-card,
.agent-note-card {
  border: 1px solid var(--landing-card-border);
  border-radius: 22px;
  background: var(--landing-card-bg);
  padding: 24px;
  backdrop-filter: blur(16px);
}

.agent-note-card {
  grid-column: span 2;
}

.agent-step-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 42px;
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(45, 212, 191, 0.08);
  color: var(--vp-c-brand-1);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.agent-step-title {
  margin: 18px 0 10px;
  font-size: 20px;
  line-height: 1.2;
  font-weight: 700;
  color: var(--vp-c-text-1);
}

.agent-step-summary,
.agent-note-text {
  margin: 0;
  font-size: 14px;
  line-height: 1.8;
  color: var(--vp-c-text-2);
}

.agent-step-link {
  display: inline-flex;
  align-items: center;
  margin-top: 18px;
  color: var(--vp-c-brand-1);
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
}

.agent-step-link:hover {
  text-decoration: underline;
}

.agent-note-kicker {
  display: inline-flex;
  align-items: center;
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(129, 140, 248, 0.12);
  color: #818cf8;
  font-size: 12px;
  font-weight: 700;
}

@media (max-width: 980px) {
  .agent-assist-shell {
    grid-template-columns: 1fr;
    gap: 32px;
  }

  .agent-assist-copy {
    max-width: none;
  }

  .agent-assist-panel {
    grid-template-columns: 1fr;
  }

  .agent-note-card {
    grid-column: span 1;
  }
}
</style>
