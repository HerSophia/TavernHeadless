<script setup lang="ts">
import DefaultTheme from 'vitepress/theme'
import { useData } from 'vitepress'
import { nextTick, provide } from 'vue'

type ViewTransitionController = {
  ready: Promise<void>
  finished: Promise<void>
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void | Promise<void>) => ViewTransitionController
}

const { isDark } = useData()
const Layout = DefaultTheme.Layout

let transitionBusy = false

function supportsAnimatedAppearance() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return false
  }

  return 'startViewTransition' in document && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function resolveTransitionOrigin(event?: MouseEvent) {
  const trigger = event?.currentTarget instanceof HTMLElement
    ? event.currentTarget
    : event?.target instanceof HTMLElement
      ? event.target.closest('.VPSwitchAppearance')
      : null

  if (event && (event.clientX !== 0 || event.clientY !== 0)) {
    return { x: event.clientX, y: event.clientY }
  }

  if (trigger) {
    const rect = trigger.getBoundingClientRect()
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    }
  }

  return {
    x: window.innerWidth - 48,
    y: 40,
  }
}

function playAppearanceTransition(nextValue: boolean, x: number, y: number, endRadius: number) {
  const root = document.documentElement

  if (nextValue) {
    root.animate(
      {
        clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${endRadius}px at ${x}px ${y}px)`],
        filter: ['brightness(1.08)', 'brightness(1)'],
      },
      {
        duration: 560,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        pseudoElement: '::view-transition-new(root)',
      }
    )

    root.animate(
      {
        opacity: [1, 0.94],
      },
      {
        duration: 560,
        easing: 'ease-out',
        pseudoElement: '::view-transition-old(root)',
      }
    )

    return
  }

  root.animate(
    {
      clipPath: [`circle(${endRadius}px at ${x}px ${y}px)`, `circle(0px at ${x}px ${y}px)`],
      opacity: [1, 0.12],
      filter: ['brightness(1)', 'brightness(1.06)'],
    },
    {
      duration: 560,
      easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
      pseudoElement: '::view-transition-old(root)',
    }
  )

  root.animate(
    {
      opacity: [0.82, 1],
      filter: ['brightness(1.04)', 'brightness(1)'],
    },
    {
      duration: 560,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      pseudoElement: '::view-transition-new(root)',
    }
  )
}

async function toggleAppearance(event?: MouseEvent) {
  if (transitionBusy) {
    return
  }

  const nextValue = !isDark.value

  if (!supportsAnimatedAppearance()) {
    isDark.value = nextValue
    return
  }

  transitionBusy = true

  try {
    const { x, y } = resolveTransitionOrigin(event)
    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    )

    const transitionDocument = document as ViewTransitionDocument
    const transition = transitionDocument.startViewTransition!(async () => {
      isDark.value = nextValue
      await nextTick()
    })

    await transition.ready
    playAppearanceTransition(nextValue, x, y, endRadius)
    await transition.finished.catch(() => {})
  } finally {
    transitionBusy = false
  }
}

provide('toggle-appearance', toggleAppearance)
</script>

<template>
  <Layout />
</template>
