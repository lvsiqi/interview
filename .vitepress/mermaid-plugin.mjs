/**
 * VitePress markdown-it 插件：将 ```mermaid 代码块转换为 <Mermaid> 组件
 */
export function mermaidPlugin(md) {
  const defaultFence = md.renderer.rules.fence.bind(md.renderer.rules)

  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx]
    if (token.info.trim() === 'mermaid') {
      const code = encodeURIComponent(token.content.trim())
      return `<ClientOnly><Mermaid :code="decodeURIComponent('${code}')" /></ClientOnly>\n`
    }
    return defaultFence(tokens, idx, options, env, self)
  }
}
