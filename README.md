# 🎯 java后端工程师面试知识库

> 创建时间：2026年3月5日  
> 持续更新中...

---

## 📁 目录结构

```
interview/
├── README.md                    # 知识库导航（含全景提纲）
├── Java核心/
│   ├── 并发编程.md
│   ├── JVM.md
│   └── 集合框架.md
├── 数据库/
│   ├── MySQL.md
│   └── Redis.md
├── 中间件/
│   ├── Kafka.md
│   ├── RocketMQ.md
│   └── Elasticsearch.md
├── 分布式/
│   ├── 分布式理论.md
│   ├── 分布式锁.md
│   └── 分布式事务.md
├── 架构设计/
│   ├── 微服务架构.md
│   ├── 系统设计题.md
│   └── 高并发方案.md
├── 框架/
│   ├── Spring.md
│   ├── SpringBoot.md
│   └── MyBatis.md
└── 面试题汇总/
    ├── 每日一题.md
    └── 高频题精选.md
```

---

## 🔥 最近更新

| 日期 | 分类 | 内容 |
|------|------|------|
| 2026-03-05 | Java并发 | synchronized 底层原理 & 锁升级 |
| 2026-03-05 | Java并发 | volatile 原理 & 内存屏障 |
| 2026-03-05 | Java并发 | AQS原理 & ReentrantLock |
| 2026-03-05 | Java并发 | ThreadLocal原理 & 内存泄漏 |
| 2026-03-05 | Java并发 | 线程池核心原理 & 参数调优 |
| 2026-03-05 | Java并发 | ConcurrentHashMap 原理 |
| 2026-03-05 | Java并发 | happens-before 规则 |
| 2026-03-05 | JVM | JVM内存模型 |
| 2026-03-05 | JVM | 类加载机制 & 双亲委派 |
| 2026-03-05 | JVM | GC算法 & 垃圾收集器 |
| 2026-03-05 | JVM | JVM调优参数 & OOM排查 |
| 2026-03-05 | 集合框架 | HashMap 源码分析 |
| 2026-03-05 | 集合框架 | ArrayList vs LinkedList & CopyOnWriteArrayList |
| 2026-03-05 | MySQL | 索引原理（B+树、聚簇索引、覆盖索引） |
| 2026-03-05 | MySQL | 索引失效场景 & EXPLAIN解读 |
| 2026-03-05 | MySQL | 事务隔离级别 & MVCC原理 |
| 2026-03-05 | MySQL | Buffer Pool & Change Buffer & redo/undo/binlog |
| 2026-03-05 | MySQL | 锁机制（行锁、间隙锁、意向锁） |
| 2026-03-05 | MySQL | SQL优化 & Explain解读 |
| 2026-03-05 | MySQL | 主从复制原理 |
| 2026-03-05 | MySQL | 分库分表方案 ✅ MySQL模块全部完成 |
| 2026-03-06 | Redis | 数据结构 & 底层实现 |
| 2026-03-06 | Redis | 持久化（RDB / AOF / 混合）|
| 2026-03-06 | Redis | 内存淘汰策略（8种策略 / LRU vs LFU）|
| 2026-03-06 | Redis | 缓存穿透/击穿/雪崩 & 缓存与DB一致性 |
| 2026-03-06 | Redis | 集群方案（主从/哨兵/Cluster） |
| 2026-03-06 | Redis | 分布式锁（Redisson看门狗 / RedLock / vs ZK） |
| 2026-03-06 | Redis | 热Key & 大Key问题 |
| 2026-03-06 | Redis | 事务 & Pipeline & Lua脚本 ✅ Redis模块全部完成 |
| 2026-03-06 | MQ通用 | 为什么用MQ / 消息可靠性 / 幂等 / 顺序消费 / 积压处理 || 2026-03-06 | Kafka | 架构原理（Topic/Partition/ISR/acks）|
| 2026-03-06 | Kafka | 分区机制 & 副本机制（ISR/OSR/HW/LEO）|
| 2026-03-06 | Kafka | 高性能原因（顺序写/PageCache/零拷贝/批量/压缩）|
| 2026-03-06 | Kafka | 消费者组 & Rebalance（触发/流程/策略/优化）|
| 2026-03-06 | Kafka | Exactly Once（幂等/事务/read_committed）✅ Kafka模块全部完成 |
| 2026-03-06 | RocketMQ | 对比Kafka/延迟消息/事务消息/存储原理 ✅ MQ模块全部完成 |
| 2026-03-06 | Elasticsearch | 核心概念 & 与MySQL对比（Index/Shard/Replica/路由公式）|
| 2026-03-06 | Elasticsearch | 倒排索引原理（Term Index/FST/Posting List/FOR压缩/分词）|
| 2026-03-06 | Elasticsearch | 写入流程（Buffer+Translog → Refresh → Flush → Merge）|
| 2026-03-06 | Elasticsearch | 查询流程（Query Phase广播+全局排序 / Fetch Phase拖取文档 / filter缓存）|
| 2026-03-06 | Elasticsearch | 相关性评分（TF-IDF原理及缺陷 / BM25两个改进 / function_score干预）|
| 2026-03-06 | Elasticsearch | 集群架构（节点角色/Master选举Raft/冷热分离/JVM堆32GB/Shard分配策略）|
| 2026-03-06 | Elasticsearch | 脑裂问题（场景还原/Quorum多数派机制/ES7.x自动计算/专用Master节点）|
| 2026-03-06 | Elasticsearch | 深分页问题（from+size缺陷/scroll快照/search_after深分页首选/PIT）|
| 2026-03-06 | Elasticsearch | 性能优化（写入五字诀/查询七字诀/filter缓存/routing/IndexSorting）|
| 2026-03-06 | Elasticsearch | ES与MySQL双写一致性（同步双写/异步MQ/Canal+Binlog/定时兆底/版本控制）✅ ES模块全部完成 |
---

## 📖 使用说明

- 每次聊天涉及的技术点会**自动归类**到对应文档
- 每个知识点包含：**原理 + 场景 + 面试答法**
- 标注 ⭐ 的为**高频考点**

---

## 🗺️ 字节跳动后端面试全景提纲

> 字节偏好：**追问原理 → 手写代码 → 系统设计 → 场景延伸**，不满足于背答案

---

### 一、☕ Java 核心基础

#### 1.1 JVM
- [x] 内存模型（堆、栈、方法区、元空间）→ [JVM.md](Java核心/JVM.md#一jvm-内存模型-)
- [x] 类加载机制 & 双亲委派 → [JVM.md](Java核心/JVM.md#二类加载机制--双亲委派-)
- [x] GC算法（标记清除、标记整理、复制算法）→ [JVM.md](Java核心/JVM.md#三gc-算法-)
- [x] 垃圾收集器（CMS、G1、ZGC对比）→ [JVM.md](Java核心/JVM.md#四垃圾收集器-)
- [x] JVM调优参数 & OOM排查 → [JVM.md](Java核心/JVM.md#五jvm调优参数--oom排查-)

#### 1.2 并发编程 ⭐⭐⭐
- [x] synchronized 底层原理（对象头、锁升级）→ [并发编程.md](Java核心/并发编程.md#一synchronized-底层原理--锁升级-)
- [x] volatile 原理（内存屏障、可见性）→ [并发编程.md](Java核心/并发编程.md#二volatile-原理--内存屏障-)
- [x] AQS 原理 & ReentrantLock → [并发编程.md](Java核心/并发编程.md#三aqs原理--reentrantlock-)
- [x] ThreadLocal 原理 & 内存泄漏 → [并发编程.md](Java核心/并发编程.md#四threadlocal原理--内存泄漏-)
- [x] 线程池（核心参数、拒绝策略、工作原理）→ [并发编程.md](Java核心/并发编程.md#五线程池核心原理--参数调优-)
- [x] ConcurrentHashMap 原理 → [并发编程.md](Java核心/并发编程.md#六concurrenthashmap-原理-)
- [x] happens-before 规则 → [并发编程.md](Java核心/并发编程.md#七happens-before-规则-)

#### 1.3 集合框架
- [x] HashMap 源码（扩容、红黑树转换、死循环问题）→ [集合框架.md](集合框架.md#一hashmap-源码-)
- [x] ArrayList vs LinkedList → [集合框架.md](Java核心/集合框架.md#二arraylist-vs-linkedlist-)
- [x] CopyOnWriteArrayList 原理 → [集合框架.md](Java核心/集合框架.md#三copyonwritearraylist-原理-)

---

### 二、🗄️ 数据库

#### 2.1 MySQL ⭐⭐⭐
- [x] 索引原理（B+树、聚簇索引、覆盖索引）→ [MySQL.md](数据库/MySQL.md#一索引原理b树聚簇索引覆盖索引-)
- [x] 索引失效场景 → [MySQL.md](数据库/MySQL.md#二索引失效场景-)
- [x] 事务隔离级别 & MVCC原理 → [MySQL.md](数据库/MySQL.md#三事务隔离级别--mvcc原理-)
- [x] Buffer Pool & Change Buffer & redo/undo/binlog → [MySQL.md](数据库/MySQL.md#四buffer-pool--change-buffer--redoundobinlog-)
- [x] 锁机制（行锁、间隙锁、意向锁） → [MySQL.md](数据库/MySQL.md#五锁机制行锁间隙锁意向锁-)
- [x] SQL优化 & Explain解读 → [MySQL.md](数据库/MySQL.md#六sql优化--explain解读-)
- [x] 主从复制原理 → [MySQL.md](数据库/MySQL.md#七主从复制原理-)
- [x] 分库分表方案 → [MySQL.md](数据库/MySQL.md#八分库分表方案-)

#### 2.2 Redis ⭐⭐⭐
- [x] 数据结构及底层实现（SDS、跳表、压缩列表）→ [Redis.md](数据库/Redis.md#一数据结构--底层实现-)
- [x] 持久化（RDB vs AOF）→ [Redis.md](数据库/Redis.md#二持久化rdb--aof-)
- [x] 内存淘汰策略（8种策略 / LRU vs LFU）→ [Redis.md](数据库/Redis.md#三内存淘汰策略-)
- [x] 缓存穿透、击穿、雪崩 & 解决方案 → [Redis.md](数据库/Redis.md#四缓存问题穿透击穿雪崩-)
- [x] 分布式锁（Redisson、RedLock）→ [Redis.md](数据库/Redis.md#六分布式锁-)
- [x] 集群方案（主从、哨兵、Cluster）→ [Redis.md](数据库/Redis.md#五集群方案-)
- [x] 热key & 大key问题 → [Redis.md](数据库/Redis.md#七热key--大key问题-)
- [x] Redis事务 & Lua脚本 → [Redis.md](数据库/Redis.md#八redis事务--pipeline--lua脚本-)

---

### 三、📨 消息队列和中间件

#### 3.1 通用问题 ⭐⭐
- [x] 为什么用MQ（解耦、削峰、异步）→ [Kafka.md](中间件/Kafka.md#一为什么用mq解耦削峰异步-)
- [x] 消息可靠性（生产者确认、消费者ACK）→ [Kafka.md](中间件/Kafka.md#二消息可靠性生产者确认消费者ack-)
- [x] 消息幂等性处理 → [Kafka.md](中间件/Kafka.md#三消息幂等性处理-)
- [x] 消息顺序消费 → [Kafka.md](中间件/Kafka.md#四消息顺序消费-)
- [x] 消息积压处理 → [Kafka.md](中间件/Kafka.md#五消息积压处理-)

#### 3.2 Kafka ⭐⭐
- [x] 架构原理（Producer、Broker、Consumer）→ [Kafka.md](中间件/Kafka.md#六kafka架构原理-)
- [x] 分区机制 & 副本机制 → [Kafka.md](中间件/Kafka.md#七kafka分区机制--副本机制-)
- [x] 高性能原因（零拷贝、顺序写）→ [Kafka.md](中间件/Kafka.md#八kafka高性能原因-)
- [x] 消费者组机制 → [Kafka.md](中间件/Kafka.md#九消费者组--rebalance-)
- [x] Exactly Once 语义 → [Kafka.md](中间件/Kafka.md#十exactly-once-语义-)

#### 3.3 RocketMQ
- [x] 与Kafka对比 → [RocketMQ.md](中间件/RocketMQ.md#一rocketmq-vs-kafka-对比-)
- [x] 延迟消息、事务消息 → [RocketMQ.md](中间件/RocketMQ.md#三延迟消息-)
- [x] 消息存储原理 → [RocketMQ.md](中间件/RocketMQ.md#五消息存储原理-)

#### 3.4 Elasticsearch ⭐⭐⭐
- [x] 核心概念 & 与MySQL对比 → [Elasticsearch.md](中间件/Elasticsearch.md#一核心概念--与mysql对比-)
- [x] 倒排索引原理（Term Dictionary / Posting List / FST）→ [Elasticsearch.md](中间件/Elasticsearch.md#二倒排索引原理-)
- [x] 写入流程（Buffer→Refresh→Translog→Flush→Merge）→ [Elasticsearch.md](中间件/Elasticsearch.md#三写入流程-)
- [x] 查询流程（Query Phase & Fetch Phase）→ [Elasticsearch.md](中间件/Elasticsearch.md#四查询流程-)
- [x] 相关性评分（TF-IDF → BM25）→ [Elasticsearch.md](中间件/Elasticsearch.md#五相关性评分-)
- [x] 集群架构（Master/Data节点 & 分片路由）→ [Elasticsearch.md](中间件/Elasticsearch.md#六集群架构-)
- [x] 脑裂问题 & 解决方案 → [Elasticsearch.md](中间件/Elasticsearch.md#七脑裂问题--解决方案-)
- [x] 深分页问题（from+size / scroll / search_after）→ [Elasticsearch.md](中间件/Elasticsearch.md#八深分页问题--解决方案-)
- [x] 性能优化（写入优化 & 查询优化）→ [Elasticsearch.md](中间件/Elasticsearch.md#九性能优化-)
- [x] ES与MySQL双写数据一致性方案 → [Elasticsearch.md](中间件/Elasticsearch.md#十es与mysql双写一致性方案-)

---

### 四、🔧 框架原理

#### 4.1 Spring ⭐⭐⭐
- [ ] IOC原理 & Bean生命周期
- [ ] AOP原理（动态代理、CGLIB）
- [ ] 事务原理 & 事务传播行为
- [ ] 循环依赖如何解决（三级缓存）
- [ ] Spring Boot自动装配原理

#### 4.2 MyBatis
- [ ] 一级缓存 & 二级缓存
- [ ] 动态SQL原理
- [ ] 插件机制

---

### 五、⚡ 分布式 & 微服务

#### 5.1 分布式理论
- [ ] CAP & BASE 理论
- [ ] 一致性协议（Paxos、Raft）
- [ ] 分布式ID方案（雪花算法、Leaf）

#### 5.2 分布式事务 ⭐⭐
- [ ] 2PC / 3PC
- [ ] TCC 模式
- [ ] Saga 模式
- [ ] 消息最终一致性

#### 5.3 分布式锁
- [ ] Redis分布式锁实现
- [ ] Zookeeper分布式锁
- [ ] 两种方案对比

#### 5.4 微服务
- [ ] Spring Cloud 核心组件
- [ ] Nacos（注册中心 & 配置中心）
- [ ] 服务熔断（Sentinel vs Hystrix）
- [ ] 网关（Gateway原理）
- [ ] 服务拆分原则

---

### 六、🏗️ 架构设计 & 系统设计

#### 6.1 高并发方案 ⭐⭐⭐
- [ ] 限流（令牌桶、漏桶、滑动窗口）
- [ ] 熔断 & 降级
- [ ] 缓存架构设计
- [ ] 读写分离 & 分库分表

#### 6.2 系统设计题（字节高频）⭐⭐⭐
- [ ] 设计秒杀系统
- [ ] 设计短链接系统
- [ ] 设计消息推送系统
- [ ] 设计评论系统
- [ ] 设计朋友圈/Feed流系统
- [ ] 设计分布式延迟任务系统
- [ ] 设计唯一ID生成器

#### 6.3 DDD领域驱动设计
- [ ] 聚合根、实体、值对象
- [ ] 限界上下文
- [ ] CQRS模式

---

### 七、🌐 网络 & 操作系统

- [ ] TCP三次握手、四次挥手
- [ ] TCP可靠性保证
- [ ] HTTP vs HTTPS
- [ ] 零拷贝原理
- [ ] IO模型（BIO/NIO/AIO）
- [ ] Epoll原理
- [ ] Linux常用排查命令

---

### 八、💻 算法 & 数据结构（字节重点）⭐⭐⭐

- [ ] 数组、链表、栈、队列
- [ ] 二叉树（遍历、BST、红黑树）
- [ ] 动态规划
- [ ] 回溯算法
- [ ] 排序算法（手写快排、归并）
- [ ] 滑动窗口、双指针
- [ ] 图论基础（BFS/DFS）

---

### 九、🔍 场景题 & 故障排查

- [ ] 线上CPU飙高如何排查
- [ ] 内存溢出如何排查
- [ ] 接口超时如何排查
- [ ] 数据库慢查询优化
- [ ] 缓存与数据库数据一致性

---

### 十、🎤 HR & 软技能

- [ ] 项目难点 & 亮点提炼
- [ ] 团队协作冲突处理
- [ ] 职业规划
- [ ] 反问环节

---

## 🗺️ 建议学习路线

```
第一阶段（基础巩固）
Java并发 → JVM → MySQL → Redis

第二阶段（进阶提升）
分布式理论 → 消息队列 → 微服务

第三阶段（综合输出）
系统设计题 → 场景题 → 算法强化

第四阶段（面试冲刺）
高频题复盘 → 项目亮点打磨 → 模拟面试
```
