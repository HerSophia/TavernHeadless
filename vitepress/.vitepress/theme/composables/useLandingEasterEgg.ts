import { computed, readonly, ref } from 'vue'

export const LANDING_EASTER_EGG_REQUIRED_ATTEMPTS = 3

const revealAttempts = ref(0)
const unlocked = ref(false)

function dispatchBrowserEvent(name: string, detail?: Record<string, unknown>) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(name, { detail }))
}

export function registerLandingEasterEggAttempt() {
  if (unlocked.value) {
    return {
      attempts: LANDING_EASTER_EGG_REQUIRED_ATTEMPTS,
      unlocked: true,
      unlockedNow: false,
    }
  }

  revealAttempts.value = Math.min(revealAttempts.value + 1, LANDING_EASTER_EGG_REQUIRED_ATTEMPTS)

  dispatchBrowserEvent('landing:easter-egg-progress', {
    attempts: revealAttempts.value,
    required: LANDING_EASTER_EGG_REQUIRED_ATTEMPTS,
  })

  const unlockedNow = revealAttempts.value >= LANDING_EASTER_EGG_REQUIRED_ATTEMPTS

  if (unlockedNow) {
    unlocked.value = true
    dispatchBrowserEvent('landing:easter-egg-unlocked', {
      attempts: revealAttempts.value,
      required: LANDING_EASTER_EGG_REQUIRED_ATTEMPTS,
    })
  }

  return {
    attempts: revealAttempts.value,
    unlocked: unlocked.value,
    unlockedNow,
  }
}

export function resetLandingEasterEggAttempts() {
  if (unlocked.value || revealAttempts.value === 0) return

  revealAttempts.value = 0

  dispatchBrowserEvent('landing:easter-egg-progress', {
    attempts: 0,
    required: LANDING_EASTER_EGG_REQUIRED_ATTEMPTS,
  })
}

export function useLandingEasterEgg() {
  const remainingAttempts = computed(() => Math.max(LANDING_EASTER_EGG_REQUIRED_ATTEMPTS - revealAttempts.value, 0))
  const progressPercent = computed(() => (revealAttempts.value / LANDING_EASTER_EGG_REQUIRED_ATTEMPTS) * 100)

  return {
    isUnlocked: readonly(unlocked),
    revealAttempts: readonly(revealAttempts),
    remainingAttempts,
    progressPercent,
    requiredAttempts: LANDING_EASTER_EGG_REQUIRED_ATTEMPTS,
  }
}
