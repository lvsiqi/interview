<template>
  <div class="mermaid-wrapper">
    <div ref="el" v-html="svg"></div>
  </div>
</template>

<script setup>
import { ref, onMounted, watch, nextTick } from 'vue'

const props = defineProps({
  code: { type: String, required: true }
})

const el = ref(null)
const svg = ref('')

async function render() {
  if (typeof window === 'undefined') return
  const { default: mermaid } = await import('mermaid')
  mermaid.initialize({
    startOnLoad: false,
    theme: document.documentElement.classList.contains('dark') ? 'dark' : 'default',
    securityLevel: 'loose'
  })
  const id = 'mermaid-' + Math.random().toString(36).slice(2, 9)
  const { svg: rendered } = await mermaid.render(id, props.code)
  svg.value = rendered
}

onMounted(() => {
  render()

  // 监听暗色模式切换
  const observer = new MutationObserver(() => render())
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class']
  })
})

watch(() => props.code, () => nextTick(render))
</script>
