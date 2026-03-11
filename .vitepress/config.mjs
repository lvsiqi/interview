import { defineConfig } from 'vitepress'
import { mermaidPlugin } from './mermaid-plugin.mjs'

export default defineConfig({
  title: 'Java面试知识库',
  description: '覆盖JVM、并发、数据库、中间件、分布式、架构设计的Java后端面试资料',
  lang: 'zh-CN',
  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }]],

  // 忽略死链（中文路径在某些环境可能检测误报）
  ignoreDeadLinks: true,

  markdown: {
    config: (md) => {
      md.use(mermaidPlugin)
    }
  },

  themeConfig: {
    logo: '/favicon.svg',
    siteTitle: 'Java面试知识库',

    nav: [
      { text: '🗺️ 全景提纲', link: '/README' },
      {
        text: 'Java核心',
        items: [
          { text: 'Java基础', link: '/Java核心/Java基础' },
          { text: 'JVM', link: '/Java核心/JVM' },
          { text: '并发编程', link: '/Java核心/并发编程' },
          { text: '集合框架', link: '/Java核心/集合框架' },
          { text: 'Java新特性', link: '/Java核心/Java新特性' }
        ]
      },
      {
        text: '数据库',
        items: [
          { text: 'MySQL', link: '/数据库/MySQL' },
          { text: 'Redis', link: '/数据库/Redis' },
          { text: '连接池', link: '/数据库/连接池' }
        ]
      },
      {
        text: '中间件',
        items: [
          { text: 'Kafka', link: '/中间件/Kafka' },
          { text: 'RocketMQ', link: '/中间件/RocketMQ' },
          { text: 'Elasticsearch', link: '/中间件/Elasticsearch' },
          { text: 'ZooKeeper', link: '/中间件/ZooKeeper' },
          { text: 'Nacos', link: '/中间件/Nacos' }
        ]
      },
      {
        text: '架构与分布式',
        items: [
          { text: '高并发方案', link: '/架构设计/高并发方案' },
          { text: '微服务架构', link: '/架构设计/微服务架构' },
          { text: '系统设计题', link: '/架构设计/系统设计题' },
          { text: 'DDD领域驱动', link: '/架构设计/DDD领域驱动设计' },
          { text: '设计模式', link: '/架构设计/设计模式' },
          { text: '分布式理论', link: '/分布式/分布式理论' },
          { text: '分布式事务', link: '/分布式/分布式事务' },
          { text: '分布式锁', link: '/分布式/分布式锁' }
        ]
      },
      {
        text: '框架 & IO',
        items: [
          { text: 'Spring', link: '/框架/Spring' },
          { text: 'SpringBoot', link: '/框架/SpringBoot' },
          { text: 'MyBatis', link: '/框架/MyBatis' },
          { text: 'IO模型详解', link: '/IO与网络框架/IO模型详解' },
          { text: 'Netty', link: '/IO与网络框架/Netty' },
          { text: 'RPC与gRPC', link: '/IO与网络框架/RPC与gRPC' }
        ]
      },
      {
        text: '基础 & 安全',
        items: [
          { text: '网络与操作系统', link: '/计算机基础/网络与操作系统' },
          { text: '算法与数据结构', link: '/计算机基础/算法与数据结构' },
          { text: 'Web安全与认证鉴权', link: '/安全/安全' },
          { text: '云原生与K8s', link: '/云原生/云原生与K8s' },
          { text: 'DevOps与CI/CD', link: '/云原生/DevOps与CICD' }
        ]
      },
      {
        text: '面试实战',
        items: [
          { text: '高频题精选', link: '/面试实战/高频题精选' },
          { text: '每日一题', link: '/面试实战/每日一题' },
          { text: 'HR与软技能', link: '/面试实战/HR与软技能' }
        ]
      },
      {
        text: '问题排查',
        items: [
          { text: '场景题与故障排查', link: '/问题排查/场景题与故障排查' },
          { text: '线上问题监控与排查', link: '/问题排查/线上问题监控与排查' },
          { text: 'Java服务与中间件排查', link: '/问题排查/Java服务与中间件排查' },
          { text: 'Arthas 深度指南', link: '/问题排查/Arthas' }
        ]
      }
    ],

    sidebar: [
      {
        text: '🗺️ 全景提纲',
        collapsed: false,
        items: [
          { text: '字节跳动面试全景提纲', link: '/README' }
        ]
      },
      {
        text: '🎯 面试实战',
        collapsed: false,
        items: [
          { text: '高频题精选', link: '/面试实战/高频题精选' },
          { text: '每日一题', link: '/面试实战/每日一题' },
          { text: 'HR与软技能', link: '/面试实战/HR与软技能' }
        ]
      },
      {
        text: '🔍 问题排查',
        collapsed: false,
        items: [
          { text: '场景题与故障排查', link: '/问题排查/场景题与故障排查' },
          { text: '线上问题监控与排查', link: '/问题排查/线上问题监控与排查' },
          { text: 'Java服务与中间件排查', link: '/问题排查/Java服务与中间件排查' },
          { text: 'Arthas 深度指南', link: '/问题排查/Arthas' }
        ]
      },
      {
        text: '☕ Java核心',
        collapsed: true,
        items: [
          { text: 'Java基础', link: '/Java核心/Java基础' },
          { text: 'JVM 虚拟机', link: '/Java核心/JVM' },
          { text: '并发编程', link: '/Java核心/并发编程' },
          { text: '集合框架', link: '/Java核心/集合框架' },
          { text: 'Java新特性', link: '/Java核心/Java新特性' }
        ]
      },
      {
        text: '🗄️ 数据库',
        collapsed: true,
        items: [
          { text: 'MySQL', link: '/数据库/MySQL' },
          { text: 'Redis', link: '/数据库/Redis' },
          { text: '连接池', link: '/数据库/连接池' }
        ]
      },
      {
        text: '⚙️ 中间件',
        collapsed: true,
        items: [
          { text: 'Kafka', link: '/中间件/Kafka' },
          { text: 'RocketMQ', link: '/中间件/RocketMQ' },
          { text: 'Elasticsearch', link: '/中间件/Elasticsearch' },
          { text: 'ZooKeeper', link: '/中间件/ZooKeeper' },
          { text: 'Nacos', link: '/中间件/Nacos' }
        ]
      },
      {
        text: '🔌 IO与网络框架',
        collapsed: true,
        items: [
          { text: 'IO模型详解', link: '/IO与网络框架/IO模型详解' },
          { text: 'Netty', link: '/IO与网络框架/Netty' },
          { text: 'RPC与gRPC', link: '/IO与网络框架/RPC与gRPC' }
        ]
      },
      {
        text: '🌐 分布式',
        collapsed: true,
        items: [
          { text: '分布式理论 (CAP/Raft)', link: '/分布式/分布式理论' },
          { text: '分布式事务', link: '/分布式/分布式事务' },
          { text: '分布式锁', link: '/分布式/分布式锁' }
        ]
      },
      {
        text: '🏗️ 架构设计',
        collapsed: true,
        items: [
          { text: '高并发方案', link: '/架构设计/高并发方案' },
          { text: '微服务架构', link: '/架构设计/微服务架构' },
          { text: '系统设计题', link: '/架构设计/系统设计题' },
          { text: 'DDD领域驱动设计', link: '/架构设计/DDD领域驱动设计' },
          { text: '🧩 设计模式', link: '/架构设计/设计模式' }
        ]
      },
      {
        text: '🔧 框架',
        collapsed: true,
        items: [
          { text: 'Spring', link: '/框架/Spring' },
          { text: 'SpringBoot', link: '/框架/SpringBoot' },
          { text: 'MyBatis', link: '/框架/MyBatis' }
        ]
      },
      {
        text: '💻 计算机基础',
        collapsed: true,
        items: [
          { text: '网络与操作系统', link: '/计算机基础/网络与操作系统' },
          { text: '算法与数据结构', link: '/计算机基础/算法与数据结构' }
        ]
      },
      {
        text: '🔐 安全',
        collapsed: true,
        items: [
          { text: 'Web安全与认证鉴权', link: '/安全/安全' }
        ]
      },
      {
        text: '☁️ 云原生',
        collapsed: true,
        items: [
          { text: '云原生与K8s', link: '/云原生/云原生与K8s' },
          { text: 'DevOps与CI/CD', link: '/云原生/DevOps与CICD' }
        ]
      }
    ],

    // 本地全文搜索（无需 Algolia key）
    search: {
      provider: 'local',
      options: {
        locales: {
          root: {
            translations: {
              button: {
                buttonText: '搜索文档',
                buttonAriaLabel: '搜索文档'
              },
              modal: {
                noResultsText: '无法找到相关结果',
                resetButtonTitle: '清除查询条件',
                footer: {
                  selectText: '选择',
                  navigateText: '切换',
                  closeText: '关闭'
                }
              }
            }
          }
        }
      }
    },

    outline: {
      level: [2, 4],
      label: '本页目录'
    },

    docFooter: {
      prev: '上一页',
      next: '下一页'
    },

    lastUpdated: {
      text: '最后更新'
    },

    footer: {
      message: '持续更新中 · Java后端工程师面试知识库',
      copyright: '© 2026'
    },

    darkModeSwitchLabel: '主题',
    lightModeSwitchTitle: '切换到浅色模式',
    darkModeSwitchTitle: '切换到深色模式',
    sidebarMenuLabel: '菜单',
    returnToTopLabel: '返回顶部'
  }
})
