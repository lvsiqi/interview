import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Java面试知识库',
  description: '覆盖JVM、并发、数据库、中间件、分布式、架构设计的Java后端面试资料',
  lang: 'zh-CN',
  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }]],

  // 忽略死链（中文路径在某些环境可能检测误报）
  ignoreDeadLinks: true,

  themeConfig: {
    logo: '/favicon.svg',
    siteTitle: 'Java面试知识库',

    nav: [
      { text: '首页', link: '/' },
      { text: '🗺️ 全景提纲', link: '/README' },
      {
        text: 'Java核心',
        items: [
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
          { text: 'Redis', link: '/数据库/Redis' }
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
        text: 'IO与网络框架',
        items: [
          { text: 'IO模型详解', link: '/IO与网络框架/IO模型详解' },
          { text: 'Netty', link: '/IO与网络框架/Netty' },
          { text: 'RPC与gRPC', link: '/IO与网络框架/RPC与gRPC' }
        ]
      },
      {
        text: '分布式',
        items: [
          { text: '分布式理论', link: '/分布式/分布式理论' },
          { text: '分布式事务', link: '/分布式/分布式事务' },
          { text: '分布式锁', link: '/分布式/分布式锁' }
        ]
      },
      {
        text: '架构设计',
        items: [
          { text: '高并发方案', link: '/架构设计/高并发方案' },
          { text: '微服务架构', link: '/架构设计/微服务架构' },
          { text: '系统设计题', link: '/架构设计/系统设计题' },
          { text: 'DDD领域驱动', link: '/架构设计/DDD领域驱动设计' }
        ]
      },
      {
        text: '框架',
        items: [
          { text: 'Spring', link: '/框架/Spring' },
          { text: 'SpringBoot', link: '/框架/SpringBoot' },
          { text: 'MyBatis', link: '/框架/MyBatis' }
        ]
      },
      {
        text: '底层知识',
        items: [
          { text: '网络与操作系统', link: '/底层知识/网络与操作系统' },
          { text: '算法与数据结构', link: '/底层知识/算法与数据结构' }
        ]
      },
      {
        text: '其他专题',
        items: [
          { text: '场景题与故障排查', link: '/其他专题/场景题与故障排查' },
          { text: '设计模式', link: '/其他专题/设计模式' },
          { text: 'HR与软技能', link: '/其他专题/HR与软技能' },
          { text: 'Web安全', link: '/其他专题/安全' },
          { text: '云原生与K8s', link: '/其他专题/云原生与K8s' }
        ]
      },
      { text: '高频题精选', link: '/面试题汇总/高频题精选' }
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
        text: '🎯 面试题汇总',
        collapsed: false,
        items: [
          { text: '高频题精选', link: '/面试题汇总/高频题精选' },
          { text: '每日一题', link: '/面试题汇总/每日一题' }
        ]
      },
      {
        text: '☕ Java核心',
        collapsed: false,
        items: [
          { text: 'JVM 虚拟机', link: '/Java核心/JVM' },
          { text: '并发编程', link: '/Java核心/并发编程' },
          { text: '集合框架', link: '/Java核心/集合框架' },
          { text: 'Java新特性', link: '/Java核心/Java新特性' }
        ]
      },
      {
        text: '🗄️ 数据库',
        collapsed: false,
        items: [
          { text: 'MySQL', link: '/数据库/MySQL' },
          { text: 'Redis', link: '/数据库/Redis' }
        ]
      },
      {
        text: '⚙️ 中间件',
        collapsed: false,
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
        collapsed: false,
        items: [
          { text: 'IO模型详解', link: '/IO与网络框架/IO模型详解' },
          { text: 'Netty', link: '/IO与网络框架/Netty' },
          { text: 'RPC与gRPC', link: '/IO与网络框架/RPC与gRPC' }
        ]
      },
      {
        text: '🌐 分布式',
        collapsed: false,
        items: [
          { text: '分布式理论 (CAP/Raft)', link: '/分布式/分布式理论' },
          { text: '分布式事务', link: '/分布式/分布式事务' },
          { text: '分布式锁', link: '/分布式/分布式锁' }
        ]
      },
      {
        text: '🏗️ 架构设计',
        collapsed: false,
        items: [
          { text: '高并发方案', link: '/架构设计/高并发方案' },
          { text: '微服务架构', link: '/架构设计/微服务架构' },
          { text: '系统设计题', link: '/架构设计/系统设计题' },
          { text: 'DDD领域驱动设计', link: '/架构设计/DDD领域驱动设计' }
        ]
      },
      {
        text: '🔧 框架',
        collapsed: false,
        items: [
          { text: 'Spring', link: '/框架/Spring' },
          { text: 'SpringBoot', link: '/框架/SpringBoot' },
          { text: 'MyBatis', link: '/框架/MyBatis' }
        ]
      },
      {
        text: '🧱 底层知识',
        collapsed: false,
        items: [
          { text: '网络与操作系统', link: '/底层知识/网络与操作系统' },
          { text: '算法与数据结构', link: '/底层知识/算法与数据结构' }
        ]
      },
      {
        text: '📚 其他专题',
        collapsed: false,
        items: [
          { text: '场景题与故障排查', link: '/其他专题/场景题与故障排查' },
          { text: '设计模式', link: '/其他专题/设计模式' },
          { text: 'HR与软技能', link: '/其他专题/HR与软技能' },
          { text: '🔐 Web安全', link: '/其他专题/安全' },
          { text: '☁️ 云原生与K8s', link: '/其他专题/云原生与K8s' }
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
      level: [2, 3],
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
