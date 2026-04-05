import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import HeroSection from './components/HeroSection.vue'
import StatsBar from './components/StatsBar.vue'
import FeaturesGrid from './components/FeaturesGrid.vue'
import WorkflowSection from './components/WorkflowSection.vue'
import QuickStartSection from './components/QuickStartSection.vue'
import TechStack from './components/TechStack.vue'
import FooterSection from './components/FooterSection.vue'
import LandingNavigator from './components/LandingNavigator.vue'
import ThemeAppearanceLayout from './components/ThemeAppearanceLayout.vue'
import './style.css'

export default {
  extends: DefaultTheme,
  Layout: ThemeAppearanceLayout,
  enhanceApp({ app }) {
    app.component('HeroSection', HeroSection)
    app.component('StatsBar', StatsBar)
    app.component('FeaturesGrid', FeaturesGrid)
    app.component('WorkflowSection', WorkflowSection)
    app.component('QuickStartSection', QuickStartSection)
    app.component('TechStack', TechStack)
    app.component('FooterSection', FooterSection)
    app.component('LandingNavigator', LandingNavigator)
  }
} satisfies Theme
