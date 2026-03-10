import DefaultTheme from 'vitepress/theme'
import './custom.css'
import MermaidBlock from './MermaidBlock.vue'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('Mermaid', MermaidBlock)
  }
}
