<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';

const textLines = [
  "const BASE = 'http://localhost:3000';",
  "",
  "// 创建会话，绑定角色与预设",
  "const session = await fetch(`${BASE}/sessions`, {",
  "  method: 'POST',",
  "  headers: { 'Content-Type': 'application/json' },",
  "  body: JSON.stringify({",
  "    title: '初次相遇',",
  "    character_id: 'char_01',",
  "    preset_id: 'preset_default',",
  "    prompt_mode: 'compat_strict'",
  "  })",
  "}).then(r => r.json());",
  "",
  "// 发送消息，获取 AI 回复",
  "const reply = await fetch(",
  "  `${BASE}/sessions/${session.id}/respond`,",
  "  {",
  "    method: 'POST',",
  "    headers: { 'Content-Type': 'application/json' },",
  "    body: JSON.stringify({ message: '你好，旅行者。' })",
  "  }",
  ").then(r => r.json());",
  "",
  "console.log(reply.generatedText);"
];

const displayedLines = ref<string[]>([]);
const currentLineIndex = ref(0);
const currentCharIndex = ref(0);
const isTyping = ref(true);
const terminalContainer = ref<HTMLElement | null>(null);

let typingInterval: number | null = null;

const typeText = () => {
  if (currentLineIndex.value >= textLines.length) {
    isTyping.value = false;
    return;
  }

  const currentLineText = textLines[currentLineIndex.value];

  if (currentCharIndex.value === 0) {
    displayedLines.value.push('');
  }

  if (currentCharIndex.value < currentLineText.length) {
    displayedLines.value[currentLineIndex.value] += currentLineText.charAt(currentCharIndex.value);
    currentCharIndex.value++;
    
    // 自动滚动到底部
    if (terminalContainer.value) {
      terminalContainer.value.scrollTop = terminalContainer.value.scrollHeight;
    }
    
    // 随机打字速度，模拟真实输入
    const speed = Math.random() * 30 + 20;
    typingInterval = window.setTimeout(typeText, speed);
  } else {
    currentLineIndex.value++;
    currentCharIndex.value = 0;
    // 换行时稍微停顿
    typingInterval = window.setTimeout(typeText, 300);
  }
};

// 简单的语法高亮逻辑（仅用于演示，实际项目中建议用 Prism/Shiki 等）
const highlight = (line: string) => {
  if (line.startsWith('//')) {
    return `<span class="text-gray-500 italic">${line}</span>`;
  }
  
  let highlighted = line
    .replace(/\b(import|from|const|await|new|method|headers|body)\b/g, '<span class="text-purple-400">$&</span>')
    .replace(/'[^']*'/g, '<span class="text-green-400">$&</span>')
    .replace(/`[^`]*`/g, '<span class="text-green-400">$&</span>')
    .replace(/({|})/g, '<span class="text-yellow-300">$&</span>')
    .replace(/\b(console\.log|fetch|JSON\.stringify)\b/g, '<span class="text-blue-400">$&</span>')
    .replace(/\b(POST|Content-Type|application\/json)\b/g, '<span class="text-cyan-400">$&</span>');
    
  return highlighted;
};

onMounted(() => {
  typingInterval = window.setTimeout(typeText, 500);
});

onUnmounted(() => {
  if (typingInterval !== null) {
    clearTimeout(typingInterval);
  }
});
</script>

<template>
  <div class="interactive-terminal-wrapper">
    <div class="terminal-window">
      <div class="terminal-header">
        <div class="terminal-buttons">
          <span class="btn close"></span>
          <span class="btn minimize"></span>
          <span class="btn maximize"></span>
        </div>
        <div class="terminal-title">quick-start.ts</div>
      </div>
      <div ref="terminalContainer" class="terminal-body">
        <div class="terminal-content">
          <div v-for="(line, index) in displayedLines" :key="index" class="terminal-line">
            <span class="line-number">{{ index + 1 }}</span>
            <!-- eslint-disable-next-line vue/no-v-html -->
            <span class="line-text" v-html="highlight(line)"></span>
          </div>
          <div v-if="isTyping" class="cursor-line">
            <span class="line-number">{{ currentLineIndex + 1 }}</span>
            <span class="cursor"></span>
          </div>
        </div>
      </div>
    </div>
    
    <!-- 装饰性光晕 -->
    <div class="ambient-glow glow-1"></div>
    <div class="ambient-glow glow-2"></div>
  </div>
</template>

<style scoped>
.interactive-terminal-wrapper {
  position: relative;
  width: 100%;
  max-width: 860px;
  margin: 56px auto;
  perspective: 1000px;
}

.terminal-window {
  position: relative;
  z-index: 10;
  background: #0d1117;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05);
  overflow: hidden;
  transform: translateZ(0); /* 开启硬件加速 */
  transition: transform 0.3s ease, box-shadow 0.3s ease;
}

.terminal-window:hover {
  transform: translateY(-5px);
  box-shadow: 0 30px 60px -12px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(45, 212, 191, 0.2);
}

.terminal-header {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  background: #161b22;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.terminal-buttons {
  display: flex;
  gap: 8px;
}

.btn {
  width: 12px;
  height: 12px;
  border-radius: 50%;
}

.btn.close { background: #ff5f56; }
.btn.minimize { background: #ffbd2e; }
.btn.maximize { background: #27c93f; }

.terminal-title {
  flex: 1;
  text-align: center;
  color: #8b949e;
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  margin-left: -44px; /* 补偿按钮宽度，使标题真正居中 */
}

.terminal-body {
  padding: 20px 16px;
  height: 420px;
  overflow-y: auto;
  background: #0d1117;
  scrollbar-width: thin;
  scrollbar-color: #30363d transparent;
}

.terminal-body::-webkit-scrollbar {
  width: 8px;
}

.terminal-body::-webkit-scrollbar-track {
  background: transparent;
}

.terminal-body::-webkit-scrollbar-thumb {
  background-color: #30363d;
  border-radius: 4px;
}

.terminal-content {
  font-family: var(--vp-font-family-mono);
  font-size: 14px;
  line-height: 1.6;
  color: #c9d1d9;
}

.terminal-line, .cursor-line {
  display: flex;
}

.line-number {
  min-width: 32px;
  color: #484f58;
  text-align: right;
  margin-right: 16px;
  user-select: none;
}

.line-text {
  white-space: pre-wrap;
  word-break: break-all;
}

.cursor {
  display: inline-block;
  width: 8px;
  height: 16px;
  background-color: var(--vp-c-brand-1);
  margin-left: 2px;
  animation: blink 1s step-end infinite;
  vertical-align: middle;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

/* 装饰性光晕样式 */
.ambient-glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(60px);
  z-index: 1;
  opacity: 0.4;
  animation: pulse 8s ease-in-out infinite alternate;
}

.glow-1 {
  width: 300px;
  height: 300px;
  background: var(--vp-c-brand-1);
  top: -50px;
  left: -50px;
}

.glow-2 {
  width: 250px;
  height: 250px;
  background: #818cf8; /* 紫蓝色，与配置的渐变色呼应 */
  bottom: -50px;
  right: -50px;
  animation-delay: -4s;
}

@keyframes pulse {
  0% { transform: scale(0.8); opacity: 0.3; }
  100% { transform: scale(1.1); opacity: 0.5; }
}

/* 提供给高亮的工具类 */
:deep(.text-purple-400) { color: #c678dd; }
:deep(.text-green-400) { color: #98c379; }
:deep(.text-yellow-300) { color: #e5c07b; }
:deep(.text-blue-400) { color: #61afef; }
:deep(.text-gray-500) { color: #5c6370; }
:deep(.text-cyan-400) { color: #56b6c2; }
:deep(.italic) { font-style: italic; }
</style>
