<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

type LandingSectionMeta = {
  id: string
  title: string
  label: string
  element: HTMLElement
}

const sections = ref<LandingSectionMeta[]>([])
const activeId = ref('')
const isReady = ref(false)
const magneticEnabled = ref(false)

let rafId: number | null = null
let snapUnlockTimer: number | null = null
let wheelResetTimer: number | null = null
let wheelAccumulator = 0
let snapLocked = false
let desktopQuery: MediaQueryList | null = null
let motionQuery: MediaQueryList | null = null
let sectionObserver: IntersectionObserver | null = null

const sectionRatios = new Map<string, number>()

const activeIndex = computed(() => sections.value.findIndex((section) => section.id === activeId.value))
const activeSection = computed(() => {
  if (activeIndex.value < 0) {
    return sections.value[0] ?? null
  }
  return sections.value[activeIndex.value] ?? null
})
const nextSection = computed(() => {
  if (activeIndex.value < 0) return sections.value[1] ?? null
  return sections.value[activeIndex.value + 1] ?? null
})
const activeIndexText = computed(() => String(Math.max(activeIndex.value + 1, 1)).padStart(2, '0'))
const totalText = computed(() => String(sections.value.length).padStart(2, '0'))
const progressPercent = computed(() => {
  if (!sections.value.length) return 0
  return ((Math.max(activeIndex.value, 0) + 1) / sections.value.length) * 100
})

function syncFlags() {
  magneticEnabled.value = Boolean(desktopQuery?.matches) && !motionQuery?.matches
}

function createThresholds() {
  return Array.from({ length: 11 }, (_, index) => index / 10)
}

function setupSectionObserver() {
  sectionObserver?.disconnect()
  sectionRatios.clear()

  if (typeof window === 'undefined' || !sections.value.length) {
    return
  }

  sectionObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const target = entry.target as HTMLElement
        sectionRatios.set(target.id, entry.intersectionRatio)
      }
      scheduleActiveUpdate()
    },
    {
      threshold: createThresholds(),
      rootMargin: '-18% 0px -18% 0px',
    }
  )

  for (const section of sections.value) {
    sectionRatios.set(section.id, 0)
    sectionObserver.observe(section.element)
  }
}

function collectSections() {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>('.landing-page .landing-fullscreen'))
  sections.value = nodes.map((element, index) => {
    const id = element.id || `landing-section-${index + 1}`
    if (!element.id) {
      element.id = id
    }

    return {
      id,
      title: element.dataset.sectionTitle || `第 ${index + 1} 屏`,
      label: element.dataset.sectionLabel || element.dataset.sectionTitle || `第 ${index + 1} 屏`,
      element,
    }
  })

  if (!sections.value.length) {
    activeId.value = ''
    isReady.value = false
    return
  }

  if (!sections.value.some((section) => section.id === activeId.value)) {
    activeId.value = sections.value[0].id
  }

  setupSectionObserver()
  updateActiveSection()
  isReady.value = true
}

function fallbackClosestSection() {
  const viewportCenter = window.innerHeight / 2
  let best = sections.value[0]
  let bestDistance = Number.POSITIVE_INFINITY

  for (const section of sections.value) {
    const rect = section.element.getBoundingClientRect()
    const center = rect.top + rect.height / 2
    const distance = Math.abs(center - viewportCenter)

    if (distance < bestDistance) {
      best = section
      bestDistance = distance
    }
  }

  return best
}

function scheduleActiveUpdate() {
  if (rafId !== null) return
  rafId = window.requestAnimationFrame(() => {
    rafId = null
    updateActiveSection()
  })
}

function updateActiveSection() {
  if (!sections.value.length) return

  let best = sections.value[0]
  let bestScore = -1

  for (const section of sections.value) {
    const score = sectionRatios.get(section.id) ?? 0
    if (score > bestScore + 0.001) {
      best = section
      bestScore = score
    }
  }

  const current = sections.value.find((section) => section.id === activeId.value) ?? null

  if (current) {
    const currentScore = sectionRatios.get(current.id) ?? 0
    if (currentScore > 0 && bestScore - currentScore < 0.08) {
      return
    }
  }

  if (bestScore > 0) {
    activeId.value = best.id
    return
  }

  activeId.value = fallbackClosestSection().id
}

function clearWheelResetTimer() {
  if (wheelResetTimer !== null) {
    window.clearTimeout(wheelResetTimer)
    wheelResetTimer = null
  }
}

function lockSnap() {
  snapLocked = true
  if (snapUnlockTimer !== null) {
    window.clearTimeout(snapUnlockTimer)
  }

  snapUnlockTimer = window.setTimeout(() => {
    snapLocked = false
  }, 820)
}

function isEditableTarget(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null
  if (!element) return false

  const tagName = element.tagName
  return element.isContentEditable || tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT'
}

function elementCanScroll(element: HTMLElement, deltaY: number) {
  const style = window.getComputedStyle(element)
  const overflowY = style.overflowY
  if (!/(auto|scroll|overlay)/.test(overflowY)) return false
  if (element.scrollHeight <= element.clientHeight + 1) return false

  if (deltaY > 0) {
    return element.scrollTop + element.clientHeight < element.scrollHeight - 1
  }

  if (deltaY < 0) {
    return element.scrollTop > 1
  }

  return false
}

function hasScrollableAncestor(target: EventTarget | null, deltaY: number) {
  let element = target instanceof HTMLElement ? target : null

  while (element && element !== document.body) {
    if (elementCanScroll(element, deltaY)) {
      return true
    }
    element = element.parentElement
  }

  return false
}

function scrollToIndex(index: number, behavior: ScrollBehavior = 'smooth') {
  const section = sections.value[index]
  if (!section) return

  lockSnap()
  activeId.value = section.id
  section.element.scrollIntoView({ behavior, block: 'start' })
}

function moveBy(step: number) {
  if (!sections.value.length) return

  const currentIndex = activeIndex.value < 0 ? 0 : activeIndex.value
  const targetIndex = Math.min(Math.max(currentIndex + step, 0), sections.value.length - 1)

  if (targetIndex === currentIndex) {
    lockSnap()
    return
  }

  scrollToIndex(targetIndex)
}

function onWheel(event: WheelEvent) {
  if (!magneticEnabled.value || !sections.value.length) return
  if (isEditableTarget(event.target)) return
  if (hasScrollableAncestor(event.target, event.deltaY)) return
  if (Math.abs(event.deltaY) < 6) return

  event.preventDefault()

  if (snapLocked) return

  wheelAccumulator += event.deltaY
  clearWheelResetTimer()
  wheelResetTimer = window.setTimeout(() => {
    wheelAccumulator = 0
  }, 160)

  if (Math.abs(wheelAccumulator) < 70) return

  const direction = wheelAccumulator > 0 ? 1 : -1
  wheelAccumulator = 0
  moveBy(direction)
}

function onKeydown(event: KeyboardEvent) {
  if (!magneticEnabled.value || !sections.value.length) return
  if (isEditableTarget(event.target)) return

  if (event.key === 'ArrowDown' || event.key === 'PageDown') {
    event.preventDefault()
    moveBy(1)
    return
  }

  if (event.key === 'ArrowUp' || event.key === 'PageUp') {
    event.preventDefault()
    moveBy(-1)
    return
  }

  if (event.key === 'Home') {
    event.preventDefault()
    scrollToIndex(0)
    return
  }

  if (event.key === 'End') {
    event.preventDefault()
    scrollToIndex(sections.value.length - 1)
  }
}

function onResizeOrQueryChange() {
  syncFlags()
  collectSections()
  scheduleActiveUpdate()
}

function onScroll() {
  scheduleActiveUpdate()
}

onMounted(() => {
  desktopQuery = window.matchMedia('(min-width: 901px) and (pointer: fine)')
  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')

  document.documentElement.classList.add('landing-snap-root')
  document.body.classList.add('landing-snap-root')

  syncFlags()
  collectSections()

  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', onResizeOrQueryChange)
  window.addEventListener('wheel', onWheel, { passive: false })
  window.addEventListener('keydown', onKeydown)
  desktopQuery.addEventListener('change', onResizeOrQueryChange)
  motionQuery.addEventListener('change', onResizeOrQueryChange)
})

onUnmounted(() => {
  if (rafId !== null) {
    window.cancelAnimationFrame(rafId)
  }

  if (snapUnlockTimer !== null) {
    window.clearTimeout(snapUnlockTimer)
  }

  clearWheelResetTimer()
  sectionObserver?.disconnect()

  document.documentElement.classList.remove('landing-snap-root')
  document.body.classList.remove('landing-snap-root')

  window.removeEventListener('scroll', onScroll)
  window.removeEventListener('resize', onResizeOrQueryChange)
  window.removeEventListener('wheel', onWheel)
  window.removeEventListener('keydown', onKeydown)
  desktopQuery?.removeEventListener('change', onResizeOrQueryChange)
  motionQuery?.removeEventListener('change', onResizeOrQueryChange)
})
</script>

<template>
  <div v-if="isReady" class="landing-navigator">
    <div class="landing-current" aria-live="polite">
      <span class="landing-current-index">{{ activeIndexText }}/{{ totalText }}</span>

      <Transition name="current-swap" mode="out-in">
        <div :key="activeId" class="landing-current-copy">
          <span class="landing-current-label">当前区块</span>
          <strong class="landing-current-title">{{ activeSection?.title }}</strong>
          <span class="landing-current-next">
            {{ nextSection ? `下一屏：${nextSection.title}` : '最后一屏' }}
          </span>
          <span v-if="magneticEnabled" class="landing-current-hint">滚轮、方向键可切换分区</span>
        </div>
      </Transition>

      <span class="landing-current-progress" aria-hidden="true">
        <span class="landing-current-progress-bar" :style="{ width: `${progressPercent}%` }"></span>
      </span>
    </div>

    <nav class="landing-dock" aria-label="首页区块导航">
      <button
        v-for="(section, index) in sections"
        :key="section.id"
        type="button"
        class="landing-dock-item"
        :class="{ active: activeId === section.id }"
        :style="{ '--item-delay': `${index * 55}ms` }"
        :aria-current="activeId === section.id ? 'true' : undefined"
        @click="scrollToIndex(index)"
      >
        <span class="landing-dock-dot"></span>
        <span class="landing-dock-text">{{ section.label }}</span>
      </button>
    </nav>
  </div>
</template>

<style scoped>
.landing-navigator {
  position: fixed;
  inset: 0;
  z-index: 40;
  pointer-events: none;
}

.landing-current {
  position: fixed;
  top: var(--landing-nav-top);
  right: var(--landing-nav-right);
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px 14px;
  border-radius: 16px;
  border: 1px solid var(--landing-overlay-border);
  background: var(--landing-overlay-bg);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  box-shadow: 0 20px 40px -28px rgba(0, 0, 0, 0.25);
  pointer-events: none;
  overflow: hidden;
  animation: current-panel-enter 0.45s ease both;
  transition: background-color 0.24s ease, border-color 0.24s ease, box-shadow 0.24s ease;
}

@keyframes current-panel-enter {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.landing-current-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 52px;
  padding: 8px 10px;
  border-radius: 12px;
  background: rgba(45, 212, 191, 0.10);
  color: var(--vp-c-brand-1);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.landing-current-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.current-swap-enter-active,
.current-swap-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.current-swap-enter-from {
  opacity: 0;
  transform: translateY(4px);
}

.current-swap-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.landing-current-label {
  font-size: 11px;
  color: var(--landing-overlay-muted);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.landing-current-title {
  font-size: 14px;
  color: var(--landing-overlay-text);
  font-weight: 600;
}

.landing-current-next,
.landing-current-hint {
  font-size: 12px;
  color: var(--landing-overlay-muted);
}

.landing-current-progress {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
  background: rgba(127, 127, 127, 0.12);
}

.landing-current-progress-bar {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--vp-c-brand-1), #818cf8);
  transition: width 0.24s ease;
}

.landing-dock {
  position: fixed;
  top: 50%;
  right: var(--landing-nav-right);
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: flex-end;
  pointer-events: auto;
}

.landing-dock-item {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px 6px 10px;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  opacity: 0;
  transform: translateX(10px);
  animation: dock-item-enter 0.35s ease both;
  animation-delay: var(--item-delay, 0ms);
}

@keyframes dock-item-enter {
  to {
    opacity: 1;
    transform: none;
  }
}

.landing-dock-dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  border: 1px solid var(--landing-overlay-border);
  background: var(--landing-overlay-bg);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  transition: width 0.2s ease, height 0.2s ease, background 0.2s ease, border-color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
}

.landing-dock-text {
  display: inline-flex;
  align-items: center;
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--landing-overlay-muted);
  font-size: 12px;
  font-weight: 500;
  opacity: 0;
  transform: translateX(6px);
  transition: opacity 0.2s ease, transform 0.2s ease, color 0.2s ease, background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
}

.landing-dock-item:hover .landing-dock-dot,
.landing-dock-item.active .landing-dock-dot {
  width: 12px;
  height: 28px;
  border-color: rgba(45, 212, 191, 0.35);
  background: linear-gradient(180deg, var(--vp-c-brand-1), #818cf8);
  transform: translateX(-2px);
  box-shadow: 0 0 0 1px rgba(45, 212, 191, 0.12), 0 0 18px rgba(45, 212, 191, 0.18);
}

.landing-dock-item:hover .landing-dock-text,
.landing-dock-item.active .landing-dock-text {
  opacity: 1;
  transform: translateX(0);
  color: var(--landing-overlay-text);
  background: var(--landing-overlay-bg);
  border-color: var(--landing-overlay-border);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  box-shadow: 0 14px 30px -26px rgba(15, 23, 42, 0.28);
}

@media (max-width: 1100px) {
  .landing-current {
    right: 16px;
  }

  .landing-dock {
    right: 16px;
  }
}

@media (max-width: 900px) {
  .landing-dock {
    display: none;
  }

  .landing-current {
    left: 16px;
    right: 16px;
    justify-content: space-between;
  }
}

@media (max-width: 640px) {
  .landing-current-hint,
  .landing-current-next {
    display: none;
  }
}
</style>
