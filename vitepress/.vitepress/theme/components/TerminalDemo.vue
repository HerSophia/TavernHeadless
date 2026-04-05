<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

const textLines = [
  "import { createTavernClient } from '@tavern/sdk'",
  '',
  "const client = createTavernClient({",
  "  baseUrl: 'http://localhost:3000',",
  '})',
  '',
  '// 创建会话',
  'const session = await client.sessions.create({',
  "  title: '黎明前的酒馆',",
  '})',
  '',
  "if (!session) throw new Error('create failed')",
  '',
  '// 流式回复',
  'await client.sessions.respondStream({',
  '  sessionId: session.id,',
  "  message: '推开酒馆的门，向吧台走去。',",
  '  onStart({ floorId, floorNo }) {',
  '    console.log(floorId, floorNo)',
  '  },',
  '  onChunk({ chunk }) {',
  '    process.stdout.write(chunk)',
  '  },',
  '})',
]

const displayedLines = ref<string[]>([])
const currentLineIndex = ref(0)
const currentCharIndex = ref(0)
const isTyping = ref(true)
const terminalContainer = ref<HTMLElement | null>(null)

let typingTimer: number | null = null

const typeText = () => {
  if (currentLineIndex.value >= textLines.length) {
    isTyping.value = false
    return
  }

  const currentLineText = textLines[currentLineIndex.value]

  if (currentCharIndex.value === 0) {
    displayedLines.value.push('')
  }

  if (currentCharIndex.value < currentLineText.length) {
    displayedLines.value[currentLineIndex.value] += currentLineText.charAt(currentCharIndex.value)
    currentCharIndex.value++

    if (terminalContainer.value) {
      terminalContainer.value.scrollTop = terminalContainer.value.scrollHeight
    }

    const speed = Math.random() * 28 + 18
    typingTimer = window.setTimeout(typeText, speed)
  } else {
    currentLineIndex.value++
    currentCharIndex.value = 0
    typingTimer = window.setTimeout(typeText, 240)
  }
}

const highlight = (line: string) => {
  if (line.trimStart().startsWith('//')) {
    return `<span class="hl-comment">${line}</span>`
  }

  return line
    .replace(/\b(import|from|const|await|if|throw|new)\b/g, '<span class="hl-keyword">$&</span>')
    .replace(/'[^']*'/g, '<span class="hl-string">$&</span>')
    .replace(/([{}])/g, '<span class="hl-brace">$&</span>')
    .replace(/\b(createTavernClient|console\.log|process\.stdout\.write|Error)\b/g, '<span class="hl-func">$&</span>')
    .replace(/\.(sessions|create|respondStream|id|sessionId|promptIntent|floorId|floorNo|chunk)\b/g, '.<span class="hl-prop">$1</span>')
}

onMounted(() => {
  typingTimer = window.setTimeout(typeText, 420)
})

onUnmounted(() => {
  if (typingTimer !== null) {
    clearTimeout(typingTimer)
  }
})
</script>

<template>
  <div class="interactive-terminal-wrapper">
    <div class="terminal-window">
      <div class="terminal-header">
        <div class="terminal-buttons">
          <span class="dot close"></span>
          <span class="dot minimize"></span>
          <span class="dot maximize"></span>
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

    <div class="ambient-glow glow-1"></div>
    <div class="ambient-glow glow-2"></div>
  </div>
</template>

<style scoped>
.interactive-terminal-wrapper {
  position: relative;
  width: 100%;
  max-width: 780px;
  margin: 0 auto;
  perspective: 1000px;
}

.terminal-window {
  position: relative;
  z-index: 10;
  background: #0d1117;
  border-radius: 18px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05);
  overflow: hidden;
  transform: translateZ(0);
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

.dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
}

.dot.close { background: #ff5f56; }
.dot.minimize { background: #ffbd2e; }
.dot.maximize { background: #27c93f; }

.terminal-title {
  flex: 1;
  text-align: center;
  color: #8b949e;
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  margin-left: -44px;
}

.terminal-body {
  padding: 18px 16px;
  height: clamp(300px, 40vh, 390px);
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

.terminal-line,
.cursor-line {
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

.ambient-glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(60px);
  z-index: 1;
  opacity: 0.4;
  animation: pulse 8s ease-in-out infinite alternate;
}

.glow-1 {
  width: 280px;
  height: 280px;
  background: var(--vp-c-brand-1);
  top: -42px;
  left: -42px;
}

.glow-2 {
  width: 220px;
  height: 220px;
  background: #818cf8;
  bottom: -42px;
  right: -42px;
  animation-delay: -4s;
}

@keyframes pulse {
  0% { transform: scale(0.8); opacity: 0.3; }
  100% { transform: scale(1.1); opacity: 0.5; }
}

:deep(.hl-comment) { color: #5c6370; font-style: italic; }
:deep(.hl-keyword) { color: #c678dd; }
:deep(.hl-string) { color: #98c379; }
:deep(.hl-brace) { color: #e5c07b; }
:deep(.hl-func) { color: #61afef; }
:deep(.hl-prop) { color: #56b6c2; }

@media (max-width: 640px) {
  .terminal-body {
    height: 320px;
  }
}
</style>
