---
layout: home

hero:
  name: "Java面试知识库"
  text: "后端工程师面试全景指南"
  tagline: 覆盖 JVM · 并发 · 数据库 · 中间件 · 分布式 · 架构设计，持续更新
  actions:
    - theme: brand
      text: 🗺️ 面试全景提纲
      link: /README
    - theme: alt
      text: 🔥 高频题精选
      link: /面试实战/高频题精选

features:
  - icon: 🗺️
    title: 全景提纲（推荐入口）
    details: 字节跳动面试全景全 10 大章节，按学习路线周历推进，每个知识点直达对应文档，适合初学和冲刺一起用
    link: /README
    linkText: 开始学习 →
  - icon: ☕
    title: Java核心
    details: JVM内存模型、GC调优、类加载、并发编程(AQS/线程池)、集合框架源码解析
    link: /Java核心/JVM
  - icon: 🗄️
    title: 数据库
    details: MySQL索引原理、MVCC、锁机制、分库分表；Redis数据结构、持久化、集群方案
    link: /数据库/MySQL
  - icon: ⚙️
    title: 中间件
    details: Kafka高性能原理、RocketMQ事务消息、Elasticsearch倒排索引、ZooKeeper ZAB协议
    link: /中间件/Kafka
  - icon: 🌐
    title: 分布式
    details: CAP/BASE理论、Paxos/Raft共识算法、分布式事务(TCC/Saga/Seata)、分布式锁方案
    link: /分布式/分布式理论
  - icon: 🏗️
    title: 架构设计
    details: 限流熔断降级、多级缓存、秒杀/短链等系统设计题、微服务(Spring Cloud)、DDD
    link: /架构设计/高并发方案
  - icon: 🔧
    title: 框架
    details: Spring IOC/AOP/三级缓存循环依赖、SpringBoot自动装配原理、MyBatis缓存插件
    link: /框架/Spring
  - icon: 🌍
    title: 网络与操作系统
    details: TCP三次握手/四次挥手、HTTP/HTTPS、零拷贝、IO模型、Reactor/Epoll原理
    link: /计算机基础/网络与操作系统
  - icon: 🧮
    title: 算法与数据结构
    details: 链表、树、动态规划、回溯、排序算法、滑动窗口、图论等7大专题
    link: /计算机基础/算法与数据结构
  - icon: 🔥
    title: 场景题与故障排查
    details: CPU飙高、OOM定位、接口超时、慢查询优化、缓存一致性方案实战
    link: /面试实战/场景题与故障排查
  - icon: 🧩
    title: 设计模式
    details: 创建型/结构型/行为型9大模式，单例/工厂/代理/策略/观察者/责任链，结合Spring/Netty框架应用场景
    link: /架构设计/设计模式
  - icon: ⚡
    title: Netty
    details: Reactor线程模型、Channel/Pipeline/ByteBuf核心组件、粘包拆包、心跳机制、零拷贝原理
    link: /IO与网络框架/Netty
  - icon: 📡
    title: IO模型详解
    details: 五种IO模型、BIO/NIO/AIO详解、select/poll/epoll深度对比、ET/LT触发模式、Reactor模式
    link: /IO与网络框架/IO模型详解
  - icon: 🔗
    title: RPC与gRPC
    details: RPC核心原理、gRPC/Protobuf/HTTP2、四种调用模式、拦截器、负载均衡、Dubbo3/Thrift对比
    link: /IO与网络框架/RPC与gRPC
  - icon: 🆕
    title: Java新特性
    details: Java 8~21全览：Lambda/Stream/Optional、Record/Sealed Class/文本块、虚拟线程、模式匹配
    link: /Java核心/Java新特性
  - icon: �
    title: Java基础
    details: OOP四大特性、String不可变原理、equals/hashCode、异常体系、泛型与类型擦除、反射、注解、序列化、JMM内存模型
    link: /Java核心/Java基础
  - icon: 🔌
    title: 数据库连接池
    details: HikariCP为什么最快（ConcurrentBag/FastList）、Druid监控与防火墙、连接数调优、连接泄漏排查
    link: /数据库/连接池
  - icon: 🔐
    title: Web安全
    details: JWT/OAuth2/Spring Security认证鉴权、SQL注入/XSS/CSRF/SSRF漏洞防御、HTTPS/TLS原理、OWASP Top 10、接口安全设计
    link: /安全/安全
  - icon: ☁️
    title: 云原生与K8s
    details: Docker容器原理(Namespace/Cgroups/OverlayFS)、Kubernetes架构与调度机制、核心资源对象、存储/网络/HPA/Service Mesh(Istio)
    link: /云原生/云原生与K8s
  - icon: 🚀
    title: DevOps与CI/CD
    details: Git工作流（Trunk-Based）、Jenkins/GitHub Actions、蓝绿/金丝雀/滚动发布、Docker镜像优化、制品管理
    link: /云原生/DevOps与CICD
---
