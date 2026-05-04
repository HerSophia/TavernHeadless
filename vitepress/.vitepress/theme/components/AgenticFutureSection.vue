<script setup lang="ts">
const items = [
  {
    icon: 'graph',
    title: 'NodeGraph 编排层',
    summary: '可解释、可调试、可重放的 Prompt / Agent / State 编排层。NodeGraph 是舞台机械，RP Agent 是导演组，两者的职责不混淆。',
  },
  {
    icon: 'roles',
    title: 'RP 分工模型',
    summary: 'Narrator 是唯一写正文的实例。Director 出导演意图，Memory 做场记，Verifier 做连续性检查，Player Agency Guard 守住玩家主导权。',
  },
  {
    icon: 'checkpoint',
    title: 'Floor / Page 重试',
    summary: 'Floor 持有回合上下文，Page 是一次生成尝试。正文前节点可缓存到 Floor，正文后归属 Page。重试不重建 Floor，从指定 checkpoint 继续。',
  },
  {
    icon: 'gate',
    title: '正史闸门',
    summary: 'CommitGate。工具调用结果、记忆提案、状态写入默认落在 Page 暂存区，只有被接受的生效 Page 才能把暂存写入提升为正史。',
  },
  {
    icon: 'tracks',
    title: '状态双轨',
    summary: 'Variables 负责 prompt 近场轻量事实；Session State 负责受治理的会话正史状态。两者定位不同，不互相替代。',
  },
  {
    icon: 'layers',
    title: '三层模式兼容',
    summary: 'compat_strict 保留酒馆行为；compat_plus 允许轻量辅助；naive_graph 启用完整 Agentic + NodeGraph。Agentic 不会侵入严格兼容模式。',
  },
]
</script>

<template>
  <section
    id="landing-agentic"
    class="agentic-section landing-fullscreen"
    data-landing-section="agentic"
    data-section-title="Agentic 展望"
    data-section-label="Agentic"
  >
    <div class="agentic-glow"></div>

    <div class="landing-shell agentic-shell">
      <div class="agentic-header">
        <span class="agentic-kicker">未来展望</span>
        <h2 class="agentic-title">RP Agentic 运行时</h2>
        <p class="agentic-desc">
          TavernHeadless 的 Agentic 不是把 RP 变成自动任务执行。
          它是把 RP 运行时拆成一套可解释、可重放、可治理的舞台系统——
          NodeGraph 管编排，Agent 出决策，Narrator 写正文，CommitGate 守正史。
        </p>
      </div>

      <div class="agentic-grid">
        <div v-for="item in items" :key="item.title" class="agentic-card">
          <div class="agentic-card-icon">
            <!-- graph -->
            <svg v-if="item.icon === 'graph'" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="6" height="6" rx="1" />
              <rect x="15" y="3" width="6" height="6" rx="1" />
              <rect x="9" y="15" width="6" height="6" rx="1" />
              <path d="M6 9v3a1 1 0 0 0 1 1h4M18 9v3a1 1 0 0 1-1 1h-4" />
              <path d="M12 13v2" />
            </svg>
            <!-- roles -->
            <svg v-else-if="item.icon === 'roles'" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <!-- checkpoint -->
            <svg v-else-if="item.icon === 'checkpoint'" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="12 2 3 7 12 12 21 7 12 2" />
              <polyline points="3 12 12 17 21 12" />
              <polyline points="3 17 12 22 21 17" />
            </svg>
            <!-- gate -->
            <svg v-else-if="item.icon === 'gate'" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <path d="M9 12l2 2 4-4" />
            </svg>
            <!-- tracks -->
            <svg v-else-if="item.icon === 'tracks'" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="6" y1="3" x2="6" y2="15" />
              <circle cx="18" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <path d="M18 9a9 9 0 0 1-9 9" />
            </svg>
            <!-- layers -->
            <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 9h18" />
              <path d="M9 21V9" />
            </svg>
          </div>

          <h3 class="agentic-card-title">{{ item.title }}</h3>
          <p class="agentic-card-desc">{{ item.summary }}</p>
        </div>
      </div>

      <p class="agentic-footnote">
        以上六个维度不是路线图承诺，而是架构设计的长远意图。当前阶段已经有 Floor / Page 模型、Variables + Session State 双轨、工具调用权限分层和暂存写入语义，这些都是 Agentic 运行时的地基。
      </p>
    </div>
  </section>
</template>

<style scoped>
.agentic-section {
  position: relative;
  overflow: hidden;
  background:
    radial-gradient(circle at 30% 20%, rgba(129, 140, 248, 0.1), transparent 38%),
    radial-gradient(circle at 70% 70%, rgba(45, 212, 191, 0.08), transparent 36%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.02), transparent 20%);
}

.agentic-glow {
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 500px;
  height: 1px;
  background: linear-gradient(90deg, transparent 0%, rgba(129, 140, 248, 0.3) 50%, transparent 100%);
}

.agentic-shell {
  gap: 32px;
}

.agentic-header {
  max-width: 740px;
  margin: 0 auto;
  text-align: center;
}

.agentic-kicker {
  display: inline-flex;
  align-items: center;
  padding: 5px 12px;
  border-radius: 999px;
  border: 1px solid rgba(129, 140, 248, 0.22);
  background: rgba(129, 140, 248, 0.06);
  color: #818cf8;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  margin-bottom: 18px;
}

.agentic-title {
  margin: 0 0 14px;
  font-size: clamp(30px, 4vw, 44px);
  font-weight: 800;
  line-height: 1.08;
  letter-spacing: -0.03em;
  color: var(--vp-c-text-1);
  border: none !important;
  padding: 0 !important;
}

.agentic-desc {
  margin: 0;
  font-size: 15px;
  line-height: 1.8;
  color: var(--vp-c-text-2);
}

.agentic-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.agentic-card {
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

.agentic-card::after {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(200px circle at 50% 0%, rgba(129, 140, 248, 0.08), transparent 60%);
  opacity: 0;
  transition: opacity 0.25s ease;
  pointer-events: none;
}

.agentic-card:hover {
  transform: translateY(-3px);
  border-color: rgba(129, 140, 248, 0.3);
  box-shadow: 0 18px 36px -24px rgba(129, 140, 248, 0.32);
}

.agentic-card:hover::after {
  opacity: 1;
}

.agentic-card-icon {
  width: 42px;
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: var(--landing-icon-bg);
  color: #818cf8;
  margin-bottom: 16px;
  transition: background 0.25s ease, transform 0.25s ease;
}

.agentic-card:hover .agentic-card-icon {
  background: var(--landing-icon-bg-hover);
  transform: scale(1.05);
}

.agentic-card-title {
  margin: 0 0 8px;
  font-size: 16px;
  font-weight: 600;
  color: var(--landing-card-title);
}

.agentic-card-desc {
  margin: 0;
  font-size: 14px;
  line-height: 1.7;
  color: var(--landing-card-text);
}

.agentic-footnote {
  margin: 0 auto;
  text-align: center;
  font-size: 13px;
  line-height: 1.8;
  color: var(--vp-c-text-3);
  opacity: 0.75;
  max-width: 680px;
}

@media (max-width: 960px) {
  .agentic-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 560px) {
  .agentic-grid {
    grid-template-columns: 1fr;
  }
}
</style>
