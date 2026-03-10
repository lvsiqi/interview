<template>
  <div class="mermaid-wrapper" :class="{ 'mermaid-dragging': dragging }">
    <div class="mermaid-toolbar">
      <button @click="zoomIn" title="放大">＋</button>
      <span class="mermaid-zoom-label">{{ Math.round(scale * 100) }}%</span>
      <button @click="zoomOut" title="缩小">－</button>
      <button @click="fitView" title="适应窗口">⊡</button>
      <button @click="resetView" title="原始大小">1:1</button>
    </div>
    <div
      ref="viewport"
      class="mermaid-viewport"
      @wheel.prevent="onWheel"
      @mousedown="onMouseDown"
      @touchstart.passive="onTouchStart"
    >
      <div
        ref="el"
        class="mermaid-content"
        :style="contentStyle"
        v-html="svg"
      ></div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'

const props = defineProps({
  code: { type: String, required: true }
})

const el = ref(null)
const viewport = ref(null)
const svg = ref('')

const scale = ref(1)
const translateX = ref(0)
const translateY = ref(0)
const dragging = ref(false)

let dragStartX = 0
let dragStartY = 0
let startTranslateX = 0
let startTranslateY = 0
let lastTouchDist = 0

const SCALE_MIN = 0.2
const SCALE_MAX = 8

const contentStyle = computed(() => ({
  transform: `translate(${translateX.value}px, ${translateY.value}px) scale(${scale.value})`,
  transformOrigin: '0 0',
  cursor: dragging.value ? 'grabbing' : 'grab'
}))

function zoomIn() {
  scale.value = Math.min(SCALE_MAX, scale.value * 1.25)
}
function zoomOut() {
  scale.value = Math.max(SCALE_MIN, scale.value / 1.25)
}

// 适应视口：缩放到刚好看全整张图，并居中
function fitView() {
  if (!viewport.value || !el.value) return
  const svgEl = el.value.querySelector('svg')
  if (!svgEl) return
  const vw = viewport.value.clientWidth
  const vh = viewport.value.clientHeight
  const sw = svgEl.scrollWidth || svgEl.getBoundingClientRect().width
  const sh = svgEl.scrollHeight || svgEl.getBoundingClientRect().height
  if (sw === 0 || sh === 0) return
  const padding = 40
  const fitScale = Math.min((vw - padding) / sw, (vh - padding) / sh, 2)
  scale.value = fitScale
  translateX.value = (vw - sw * fitScale) / 2
  translateY.value = (vh - sh * fitScale) / 2
}

// 原始大小 1:1 居中
function resetView() {
  if (!viewport.value || !el.value) return
  const svgEl = el.value.querySelector('svg')
  scale.value = 1
  if (!svgEl) { translateX.value = 0; translateY.value = 0; return }
  const vw = viewport.value.clientWidth
  const vh = viewport.value.clientHeight
  const sw = svgEl.scrollWidth || svgEl.getBoundingClientRect().width
  const sh = svgEl.scrollHeight || svgEl.getBoundingClientRect().height
  translateX.value = Math.max(0, (vw - sw) / 2)
  translateY.value = Math.max(0, (vh - sh) / 2)
}

function onWheel(e) {
  const factor = e.deltaY > 0 ? 1 / 1.12 : 1.12
  const newScale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, scale.value * factor))
  const rect = viewport.value.getBoundingClientRect()
  const ox = e.clientX - rect.left
  const oy = e.clientY - rect.top
  const ratio = newScale / scale.value
  translateX.value = ox - ratio * (ox - translateX.value)
  translateY.value = oy - ratio * (oy - translateY.value)
  scale.value = newScale
}

function onMouseDown(e) {
  if (e.button !== 0) return
  dragging.value = true
  dragStartX = e.clientX
  dragStartY = e.clientY
  startTranslateX = translateX.value
  startTranslateY = translateY.value
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
}
function onMouseMove(e) {
  translateX.value = startTranslateX + (e.clientX - dragStartX)
  translateY.value = startTranslateY + (e.clientY - dragStartY)
}
function onMouseUp() {
  dragging.value = false
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
}

function getTouchDist(e) {
  const [a, b] = e.touches
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
}
function onTouchStart(e) {
  if (e.touches.length === 1) {
    dragging.value = true
    dragStartX = e.touches[0].clientX
    dragStartY = e.touches[0].clientY
    startTranslateX = translateX.value
    startTranslateY = translateY.value
  } else if (e.touches.length === 2) {
    lastTouchDist = getTouchDist(e)
  }
  window.addEventListener('touchmove', onTouchMove, { passive: false })
  window.addEventListener('touchend', onTouchEnd)
}
function onTouchMove(e) {
  e.preventDefault()
  if (e.touches.length === 1 && dragging.value) {
    translateX.value = startTranslateX + (e.touches[0].clientX - dragStartX)
    translateY.value = startTranslateY + (e.touches[0].clientY - dragStartY)
  } else if (e.touches.length === 2) {
    const dist = getTouchDist(e)
    const factor = dist / lastTouchDist
    scale.value = Math.min(SCALE_MAX, Math.max(SCALE_MIN, scale.value * factor))
    lastTouchDist = dist
  }
}
function onTouchEnd() {
  dragging.value = false
  window.removeEventListener('touchmove', onTouchMove)
  window.removeEventListener('touchend', onTouchEnd)
}

async function render() {
  if (typeof window === 'undefined') return
  const { default: mermaid } = await import('mermaid')
  mermaid.initialize({
    startOnLoad: false,
    theme: document.documentElement.classList.contains('dark') ? 'dark' : 'default',
    securityLevel: 'loose',
    flowchart: { useMaxWidth: false, htmlLabels: true },
    sequence: { useMaxWidth: false },
    gantt: { useMaxWidth: false },
    fontSize: 16
  })
  const id = 'mermaid-' + Math.random().toString(36).slice(2, 9)
  const { svg: rendered } = await mermaid.render(id, props.code)
  svg.value = rendered

  // 渲染完成后，移除 SVG 上的宽高限制，让它以自然大小展示
  await nextTick()
  if (el.value) {
    const svgEl = el.value.querySelector('svg')
    if (svgEl) {
      svgEl.removeAttribute('height')
      const vb = svgEl.getAttribute('viewBox')
      if (vb) {
        const parts = vb.split(/[\s,]+/)
        const vbW = parseFloat(parts[2])
        const vbH = parseFloat(parts[3])
        if (vbW && vbH) {
          svgEl.style.width = vbW + 'px'
          svgEl.style.height = vbH + 'px'
        }
      }
    }
    // 初始自动适应视口
    requestAnimationFrame(() => fitView())
  }
}

onMounted(() => {
  render()
  const observer = new MutationObserver(() => render())
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class']
  })
})

onUnmounted(() => {
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
  window.removeEventListener('touchmove', onTouchMove)
  window.removeEventListener('touchend', onTouchEnd)
})

watch(() => props.code, () => nextTick(render))
</script>
