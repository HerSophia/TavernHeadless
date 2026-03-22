import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import HeroSection from './components/HeroSection.vue'
import FeaturesGrid from './components/FeaturesGrid.vue'
import TerminalDemo from './components/TerminalDemo.vue'
import TechStack from './components/TechStack.vue'
import FooterSection from './components/FooterSection.vue'
import './style.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('HeroSection', HeroSection)
    app.component('FeaturesGrid', FeaturesGrid)
    app.component('TerminalDemo', TerminalDemo)
    app.component('TechStack', TechStack)
    app.component('FooterSection', FooterSection)
  }
} satisfies Theme
