# 🎯 java后端工程师面试知识库

> 创建时间：2026年3月5日  
> 持续更新中...

---

## 📁 目录结构

| 文件 | 说明 |
|------|------|
| [README.md](README.md) | 知识库导航（含全景提纲） |
| **Java核心/** | |
| [Java核心/JVM.md](Java核心/JVM.md) | 内存模型、类加载、GC算法、垃圾收集器、调优 |
| [Java核心/并发编程.md](Java核心/并发编程.md) | synchronized、volatile、AQS、线程池、ConcurrentHashMap |
| [Java核心/集合框架.md](Java核心/集合框架.md) | HashMap、ArrayList、CopyOnWriteArrayList、LinkedHashMap/TreeMap、ArrayDeque/PriorityQueue、HashSet/TreeSet |
| **数据库/** | |
| [数据库/MySQL.md](数据库/MySQL.md) | 索引、MVCC、锁机制、SQL优化、主从、分库分表 |
| [数据库/Redis.md](数据库/Redis.md) | 数据结构、持久化、淘汰策略、集群、分布式锁 |
| **中间件/** | |
| [中间件/Kafka.md](中间件/Kafka.md) | 架构原理、分区副本、高性能、消费者组、Exactly Once |
| [中间件/RocketMQ.md](中间件/RocketMQ.md) | 对比Kafka、延迟消息、事务消息、顺序消息、死信队列、存储原理 |
| [中间件/Netty.md](中间件/Netty.md) | 线程模型、ChannelPipeline、ByteBuf、粘包拆包、心跳、零拷贝 |
| [中间件/Elasticsearch.md](中间件/Elasticsearch.md) | 倒排索引、写入/查询流程、集群、脑裂、深分页 |
| [中间件/ZooKeeper.md](中间件/ZooKeeper.md) | ZAB协议、Session、分布式锁Curator、Nacos/etcd对比 |
| [中间件/Nacos.md](中间件/Nacos.md) | 服务注册发现、Distro协议、配置中心长轮询、健康检查、AP/CP双模、与ZK/Eureka对比 |
| **分布式/** | |
| [分布式/分布式理论.md](分布式/分布式理论.md) | CAP/BASE、Paxos、Raft、分布式ID |
| [分布式/分布式事务.md](分布式/分布式事务.md) | 2PC/3PC、TCC、Saga、消息最终一致性、Seata |
| [分布式/分布式锁.md](分布式/分布式锁.md) | Redis锁、ZK锁、Redisson、RedLock对比 |
| **架构设计/** | |
| [架构设计/高并发方案.md](架构设计/高并发方案.md) | 限流算法、Sentinel熔断降级、多级缓存、读写分离、异步削峰、幂等性、缓存三大问题 |
| [架构设计/微服务架构.md](架构设计/微服务架构.md) | Spring Cloud、Nacos、Sentinel、Gateway、OpenFeign、服务拆分、链路追踪 |
| [架构设计/系统设计题.md](架构设计/系统设计题.md) | 秒杀/短链/推送/Feed流/延迟任务/唯一ID（7题）|
| [架构设计/DDD领域驱动设计.md](架构设计/DDD领域驱动设计.md) | 聚合根/限界上下文/CQRS/事件溯源 |
| **框架/** | |
| [框架/Spring.md](框架/Spring.md) | IOC、AOP、事务原理、三级缓存循环依赖 |
| [框架/SpringBoot.md](框架/SpringBoot.md) | 自动装配原理、@Conditional、自定义Starter、配置体系、启动流程、Actuator |
| [框架/MyBatis.md](框架/MyBatis.md) | 缓存机制、动态SQL、插件原理、PageHelper |
| **Java核心/** | |
| [Java核心/Java新特性.md](Java核心/Java新特性.md) | Lambda、Stream、Optional、Java 9-17新特性、虚拟线程（Java 21） |
| **其他专题/** | |
| [其他专题/设计模式.md](其他专题/设计模式.md) | 单例/工厂/建造者/代理/装饰器/策略/观察者/模板方法/责任链 |
| [底层知识/网络与操作系统.md](底层知识/网络与操作系统.md) | TCP、HTTP/HTTPS、零拷贝、IO模型、Reactor、Epoll |
| [底层知识/算法与数据结构.md](底层知识/算法与数据结构.md) | 链表/树/DP/回溯/排序/滑动窗口/图论（7专题）|
| [其他专题/场景题与故障排查.md](其他专题/场景题与故障排查.md) | CPU飙高/OOM/超时/慢查询/缓存一致性（5专题）|
| [其他专题/HR与软技能.md](其他专题/HR与软技能.md) | STAR法则、冲突处理、职业规划、反问环节 |
| [其他专题/安全.md](其他专题/安全.md) | JWT/OAuth2/Spring Security/SQL注入/XSS/CSRF/SSRF/HTTPS/OWASP Top 10 |
| [其他专题/云原生与K8s.md](其他专题/云原生与K8s.md) | Docker原理/K8s架构/Pod调度/Service网络/存储/HPA/Service Mesh/故障排查 |
| **面试题汇总/** | |
| [面试题汇总/高频题精选.md](面试题汇总/高频题精选.md) | 32道跨章节高频题（JVM/并发/MySQL/Redis/分布式/系统设计/算法/场景题/HR）含核心答案+追问方向 |
| [面试题汇总/每日一题.md](面试题汇总/每日一题.md) | 按日期刷题记录 |

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

#### 1.0 Java 新特性
- [x] Lambda & 函数式接口 → [Java新特性.md](Java核心/Java新特性.md#11-lambda-表达式)
- [x] Stream API（filter/map/collect/parallel）→ [Java新特性.md](Java核心/Java新特性.md#12-stream-api-)
- [x] Optional 用法 → [Java新特性.md](Java核心/Java新特性.md#13-optional-)
- [x] 新日期 API（LocalDate/ZonedDateTime）→ [Java新特性.md](Java核心/Java新特性.md#15-新日期-apijavatime)
- [x] Record & Sealed Class（Java 16/17）→ [Java新特性.md](Java核心/Java新特性.md#32-recordjava-16-正式-)
- [x] 虚拟线程（Java 21）→ [Java新特性.md](Java核心/Java新特性.md#41-虚拟线程virtual-threads-)

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
- [x] HashMap 源码（扩容、红黑树转换、死循环问题）→ [集合框架.md](Java核心/集合框架.md#一hashmap-源码-)
- [x] ArrayList vs LinkedList → [集合框架.md](Java核心/集合框架.md#二arraylist-vs-linkedlist-)
- [x] CopyOnWriteArrayList 原理 → [集合框架.md](Java核心/集合框架.md#三copyonwritearraylist-原理-)
- [x] LinkedHashMap（有序、LRU实现）& TreeMap（红黑树、区间查询）→ [集合框架.md](Java核心/集合框架.md#四linkedhashmap-与-treemap-)
- [x] ArrayDeque（替代Stack/Queue）& PriorityQueue（堆、Top K）→ [集合框架.md](Java核心/集合框架.md#五arraydeque-与-priorityqueue-)
- [x] HashSet/TreeSet 去重原理 & Collections/Arrays 工具类 → [集合框架.md](Java核心/集合框架.md#六hashset-与-treeset-)

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
- [x] 生产者发送流程（拦截器→分区器→RecordAccumulator→Sender）→ [Kafka.md](中间件/Kafka.md#63-生产者发送流程-)
- [x] 消费者拉取流程（fetch参数、offset提交策略）→ [Kafka.md](中间件/Kafka.md#64-消费者拉取流程-)
- [x] 集群 & Controller机制（ZooKeeper vs KRaft、Broker上下线）→ [Kafka.md](中间件/Kafka.md#67-kafka集群--controller机制-)
- [x] 分区机制 & 副本机制（ISR/HW/LEO）→ [Kafka.md](中间件/Kafka.md#七kafka分区机制--副本机制-)
- [x] 高性能原因（零拷贝、顺序写）→ [Kafka.md](中间件/Kafka.md#八kafka高性能原因-)
- [x] 消费者组 & Rebalance（分配策略、CooperativeSticky、静态成员）→ [Kafka.md](中间件/Kafka.md#九消费者组--rebalance-)
- [x] Exactly Once 语义（幂等Producer、事务Producer）→ [Kafka.md](中间件/Kafka.md#十exactly-once-语义-)

#### 3.3 RocketMQ
- [x] 与Kafka对比 → [RocketMQ.md](中间件/RocketMQ.md#一rocketmq-vs-kafka-对比-)
- [x] 延迟消息 → [RocketMQ.md](中间件/RocketMQ.md#三延迟消息-)
- [x] 事务消息（半消息机制）→ [RocketMQ.md](中间件/RocketMQ.md#四事务消息-)
- [x] 顺序消息（局部有序）→ [RocketMQ.md](中间件/RocketMQ.md#五顺序消息-)
- [x] 死信队列 & 重试机制 → [RocketMQ.md](中间件/RocketMQ.md#六死信队列--重试机制-)
- [x] 消息过滤（Tag & SQL92）→ [RocketMQ.md](中间件/RocketMQ.md#七消息过滤-)
- [x] 消息存储原理（CommitLog & ConsumerQueue）→ [RocketMQ.md](中间件/RocketMQ.md#八消息存储原理-)
- [x] 高可用架构（DLedger/Raft）→ [RocketMQ.md](中间件/RocketMQ.md#九高可用架构-)

#### 3.6 Netty ⭐⭐⭐
- [x] 线程模型（主从 Reactor、NioEventLoop）→ [Netty.md](中间件/Netty.md#二netty-线程模型-)
- [x] 核心组件（ChannelPipeline、ByteBuf）→ [Netty.md](中间件/Netty.md#三核心组件-)
- [x] 粘包 & 拆包解决方案 → [Netty.md](中间件/Netty.md#四粘包--拆包-)
- [x] 心跳机制（IdleStateHandler）→ [Netty.md](中间件/Netty.md#五心跳机制-)
- [x] 零拷贝（OS层+应用层）→ [Netty.md](中间件/Netty.md#六netty-零拷贝-)

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

#### 3.5 ZooKeeper ⭐⭐⭐
- [x] 核心概念（节点类型 / Session心跳机制 / Watcher推拉模型）→ [ZooKeeper.md](中间件/ZooKeeper.md#一核心概念-)
- [x] 集群节点角色与分工（Leader/Follower/Observer 职责对比、Observer 适用场景、状态机）→ [ZooKeeper.md](中间件/ZooKeeper.md#17-集群节点角色与分工-)
- [x] ZAB协议（ZXID结构 / 消息广播 / Leader选举 / DIFF•SNAP•TRUNC三种同步模式）→ [ZooKeeper.md](中间件/ZooKeeper.md#二zab-协议zookeeper-atomic-broadcast-)
- [x] ZAB vs Raft 对比 → [ZooKeeper.md](中间件/ZooKeeper.md#28-zab-vs-raft-对比字节爱问)
- [x] 分布式锁（临时顺序节点原理 + Curator代码 / ZK vs Redis锁对比）→ [ZooKeeper.md](中间件/ZooKeeper.md#三分布式锁实现原理-)
- [x] 应用场景（服务注册/配置中心/Master选举/分布式屏障Barrier）→ [ZooKeeper.md](中间件/ZooKeeper.md#四典型应用场景-)
- [x] 与Nacos/Eureka/etcd对比（CP vs AP / 为何不适合做注册中心）→ [ZooKeeper.md](中间件/ZooKeeper.md#五与-nacos--eureka--etcd-对比-)
- [x] 集群配置与运维（zoo.cfg参数 / myid / 读写路由强一致 / 四字命令mntr / 动态扩缩容）→ [ZooKeeper.md](中间件/ZooKeeper.md#六集群配置与运维-)

#### 3.7 Nacos ⭐⭐⭐⭐⭐
- [x] 整体架构（注册中心 + 配置中心 + 健康管理 / 1.x vs 2.x gRPC）→ [Nacos.md](中间件/Nacos.md#一整体架构与核心功能-)
- [x] 临时实例 vs 持久实例（AP/CP参数 / ephemeral）→ [Nacos.md](中间件/Nacos.md#22-临时实例-vs-持久实例-高频考点)
- [x] Distro 协议（AP模式 / 数据分片 / 最终一致性）→ [Nacos.md](中间件/Nacos.md#24-distro-协议ap-模式核心)
- [x] 配置中心长轮询原理（MD5比对 / 29.5s Hold / 变更推送）→ [Nacos.md](中间件/Nacos.md#32-配置动态刷新原理长轮询)
- [x] @RefreshScope 原理与注意事项 → [Nacos.md](中间件/Nacos.md#33-refreshscope-原理)
- [x] 配置优先级（Namespace/Group/DataId 三元组）→ [Nacos.md](中间件/Nacos.md#34-配置优先级)
- [x] 健康检查（客户端心跳 vs 服务端主动探测）→ [Nacos.md](中间件/Nacos.md#四健康检查机制-)
- [x] 集群一致性（Raft CP / Distro AP 双模式共存原理）→ [Nacos.md](中间件/Nacos.md#五集群一致性distro-ap--raft-cp)
- [x] 自我保护模式 → [Nacos.md](中间件/Nacos.md#六自我保护模式-)
- [x] 与 ZooKeeper / Eureka / Apollo 横向对比 → [Nacos.md](中间件/Nacos.md#七与其他注册配置中心横向对比-)

---

### 四、🔧 框架原理

#### 4.1 Spring ⭐⭐⭐
- [x] IOC原理 & Bean生命周期 → [Spring.md](框架/Spring.md#一ioc-原理--bean-生命周期-)
- [x] AOP原理（动态代理、CGLIB）→ [Spring.md](框架/Spring.md#二aop-原理-)
- [x] 事务原理 & 事务传播行为 → [Spring.md](框架/Spring.md#三事务原理--事务传播行为-)
- [x] 循环依赖如何解决（三级缓存）→ [Spring.md](框架/Spring.md#一ioc-原理--bean-生命周期-)
- [x] Spring Boot自动装配原理 → [SpringBoot.md](框架/SpringBoot.md#一自动装配原理-)
- [x] SpringBoot 配置体系 & 多环境 → [SpringBoot.md](框架/SpringBoot.md#二配置体系-)
- [x] SpringBoot 启动流程 → [SpringBoot.md](框架/SpringBoot.md#三springboot-启动流程-)
- [x] 内嵌容器原理 & 切换 → [SpringBoot.md](框架/SpringBoot.md#四内嵌容器原理-)
- [x] Actuator & 健康检查 → [SpringBoot.md](框架/SpringBoot.md#五actuator--健康检查-)

#### 4.2 MyBatis
- [x] 一级缓存 & 二级缓存 → [MyBatis.md](框架/MyBatis.md#一一级缓存--二级缓存-)
- [x] 动态SQL原理（SqlNode树 / OGNL / #{} vs ${}）→ [MyBatis.md](框架/MyBatis.md#二动态-sql-原理-)
- [x] 插件机制（JDK代理+责任链 / PageHelper原理）→ [MyBatis.md](框架/MyBatis.md#三插件机制interceptor-)

---

### 五、⚡ 分布式 & 微服务

#### 5.1 分布式理论
- [x] CAP & BASE 理论 → [分布式理论.md](分布式/分布式理论.md#一cap-理论--base-理论-)
- [x] 一致性协议（Paxos、Raft）→ [分布式理论.md](分布式/分布式理论.md#二一致性协议应用场景-)
- [x] 分布式ID方案（雪花算法、Leaf）→ [分布式理论.md](分布式/分布式理论.md#三分布式-id-方案-)

#### 5.2 分布式事务 ⭐⭐
- [x] 2PC / 3PC → [分布式事务.md](分布式/分布式事务.md#二2pc两阶段提交-)
- [x] TCC 模式 → [分布式事务.md](分布式/分布式事务.md#三tcc试-confirm-cancel-)
- [x] Saga 模式 → [分布式事务.md](分布式/分布式事务.md#四saga-模式-)
- [x] 消息最终一致性 → [分布式事务.md](分布式/分布式事务.md#五消息最终一致性-)

#### 5.3 分布式锁
- [x] Redis分布式锁实现（SET NX PX + Lua脚本）→ [分布式锁.md](分布式/分布式锁.md#二redis-分布式锁-)
- [x] Redisson看门狗 & 可重入锁 → [分布式锁.md](分布式/分布式锁.md#二redis-分布式锁-)
- [x] ZooKeeper分布式锁（临时顺序节点）→ [分布式锁.md](分布式/分布式锁.md#三zookeeper-分布式锁-)
- [x] 两种方案对比 → [分布式锁.md](分布式/分布式锁.md#四redis-vs-zookeeper-分布式锁对比-)

#### 5.4 微服务
- [x] Spring Cloud 核心组件 → [微服务架构.md](架构设计/微服务架构.md#一spring-cloud-核心组件全景-)
- [x] Nacos（注册中心 & 配置中心）→ [微服务架构.md](架构设计/微服务架构.md#二nacos-注册中心原理-)
- [x] 服务熔断（Sentinel vs Hystrix）→ [微服务架构.md](架构设计/微服务架构.md#四sentinel-熔断降级-)
- [x] 网关（Gateway原理）→ [微服务架构.md](架构设计/微服务架构.md#五spring-cloud-gateway-原理-)
- [x] OpenFeign 动态代理原理、拦截器、常见坑 → [微服务架构.md](架构设计/微服务架构.md#六openfeign-原理-)
- [x] 服务拆分原则（DDD限界上下文）→ [微服务架构.md](架构设计/微服务架构.md#七服务拆分原则-)
- [x] 可观测性：SkyWalking 链路追踪 & Prometheus 监控 → [微服务架构.md](架构设计/微服务架构.md#十可观测性与链路追踪-)

---

### 六、🏗️ 架构设计 & 系统设计

#### 6.1 高并发方案 ⭐⭐⭐
- [x] 限流（令牌桶、漏桶、滑动窗口）→ [高并发方案.md](架构设计/高并发方案.md#一限流算法-)
- [x] 熔断 & 降级（Sentinel 流控规则/降级规则 Java API）→ [高并发方案.md](架构设计/高并发方案.md#二熔断--降级-)
- [x] 缓存架构设计（多级缓存/Cache-Aside/更新策略）→ [高并发方案.md](架构设计/高并发方案.md#三缓存架构设计-)
- [x] 读写分离 & 分库分表 → [高并发方案.md](架构设计/高并发方案.md#四读写分离--分库分表-)
- [x] 异步化与削峰（秒杀完整异步流程/MQ缓冲）→ [高并发方案.md](架构设计/高并发方案.md#五异步化与削峰-)
- [x] 幂等性设计（唯一索引/Token防重/状态机/Redis SETNX）→ [高并发方案.md](架构设计/高并发方案.md#六幂等性设计-)
- [x] 缓存三大问题（穿透/击穿/雪崩）→ [高并发方案.md](架构设计/高并发方案.md#八缓存三大问题-)

#### 6.2 系统设计题（字节高频）⭐⭐⭐
- [x] 设计秒杀系统 → [系统设计题.md](架构设计/系统设计题.md#一设计秒杀系统-)
- [x] 设计短链接系统 → [系统设计题.md](架构设计/系统设计题.md#二设计短链接系统)
- [x] 设计消息推送系统 → [系统设计题.md](架构设计/系统设计题.md#三设计消息推送系统)
- [x] 设计评论系统 → [系统设计题.md](架构设计/系统设计题.md#四设计评论系统)
- [x] 设计朋友圈/Feed流系统 → [系统设计题.md](架构设计/系统设计题.md#五设计朋友圈--feed-流系统)
- [x] 设计分布式延迟任务系统 → [系统设计题.md](架构设计/系统设计题.md#六设计分布式延迟任务系统)
- [x] 设计唯一ID生成器 → [系统设计题.md](架构设计/系统设计题.md#七设计唯一-id-生成器)

#### 6.3 DDD领域驱动设计
- [x] 聚合根、实体、值对象 → [DDD领域驱动设计.md](架构设计/DDD领域驱动设计.md#一聚合根实体值对象)
- [x] 限界上下文 → [DDD领域驱动设计.md](架构设计/DDD领域驱动设计.md#二限界上下文)
- [x] CQRS模式 → [DDD领域驱动设计.md](架构设计/DDD领域驱动设计.md#三cqrs-模式)

---

### 七、🌐 网络 & 操作系统

- [x] TCP三次握手、四次挥手 → [网络与操作系统.md](底层知识/网络与操作系统.md#一tcp-三次握手--四次挥手)
- [x] TCP可靠性保证 → [网络与操作系统.md](底层知识/网络与操作系统.md#二tcp-可靠性保证)
- [x] HTTP vs HTTPS → [网络与操作系统.md](底层知识/网络与操作系统.md#三http-vs-https)
- [x] 零拷贝原理 → [网络与操作系统.md](底层知识/网络与操作系统.md#四零拷贝原理)
- [x] IO模型（BIO/NIO/AIO）→ [网络与操作系统.md](底层知识/网络与操作系统.md#五io-模型bio--nio--aio)
- [x] Epoll原理 → [网络与操作系统.md](底层知识/网络与操作系统.md#六epoll-原理)
- [x] Linux常用排查命令 → [网络与操作系统.md](底层知识/网络与操作系统.md#七linux-常用排查命令)

---

### 八、💻 算法 & 数据结构（字节重点）⭐⭐⭐

- [x] 数组、链表、栈、队列 → [算法与数据结构.md](底层知识/算法与数据结构.md#一数组链表栈队列)
- [x] 二叉树（遍历、BST、红黑树）→ [算法与数据结构.md](底层知识/算法与数据结构.md#二二叉树)
- [x] 动态规划 → [算法与数据结构.md](底层知识/算法与数据结构.md#三动态规划)
- [x] 回溯算法 → [算法与数据结构.md](底层知识/算法与数据结构.md#四回溯算法)
- [x] 排序算法（手写快排、归并）→ [算法与数据结构.md](底层知识/算法与数据结构.md#五排序算法)
- [x] 滑动窗口、双指针 → [算法与数据结构.md](底层知识/算法与数据结构.md#六滑动窗口--双指针)
- [x] 图论基础（BFS/DFS）→ [算法与数据结构.md](底层知识/算法与数据结构.md#七图论基础bfs--dfs)

---

### 九、🔍 场景题 & 故障排查

- [x] 线上CPU飙高如何排查 → [场景题与故障排查.md](其他专题/场景题与故障排查.md#一线上-cpu-飙高如何排查)
- [x] 内存溢出如何排查 → [场景题与故障排查.md](其他专题/场景题与故障排查.md#二内存溢出如何排查)
- [x] 接口超时如何排查 → [场景题与故障排查.md](其他专题/场景题与故障排查.md#三接口超时如何排查)
- [x] 数据库慢查询优化 → [场景题与故障排查.md](其他专题/场景题与故障排查.md#四数据库慢查询优化)
- [x] 缓存与数据库数据一致性 → [场景题与故障排查.md](其他专题/场景题与故障排查.md#五缓存与数据库数据一致性)

---

### 十、🎤 HR & 软技能

- [x] 项目难点 & 亮点提炼 → [HR与软技能.md](其他专题/HR与软技能.md#一项目难点--亮点提炼)
- [x] 团队协作冲突处理 → [HR与软技能.md](其他专题/HR与软技能.md#二团队协作--冲突处理)
- [x] 职业规划 → [HR与软技能.md](其他专题/HR与软技能.md#三职业规划)
- [x] 反问环节 → [HR与软技能.md](其他专题/HR与软技能.md#四反问环节)

---

### 十一、🔐 Web 安全与认证鉴权 ⭐⭐⭐

- [x] JWT 认证机制（结构/签名/Refresh Token）→ [安全.md](其他专题/安全.md#一jwt-认证机制-)
- [x] OAuth2.0 四种授权模式（授权码/客户端凭证）→ [安全.md](其他专题/安全.md#二oauth20-协议-)
- [x] Spring Security 过滤器链与认证授权流程 → [安全.md](其他专题/安全.md#三spring-security-原理-)
- [x] SQL 注入原理与防御（PreparedStatement/#{}/${} ）→ [安全.md](其他专题/安全.md#四sql-注入-)
- [x] XSS（存储型/反射型/DOM型）与防御 → [安全.md](其他专题/安全.md#五xss-跨站脚本攻击-)
- [x] CSRF 原理与防御（Token/SameSite Cookie）→ [安全.md](其他专题/安全.md#六csrf-跨站请求伪造-)
- [x] SSRF 服务端请求伪造（内网穿透/云元数据泄露）→ [安全.md](其他专题/安全.md#七ssrf-服务端请求伪造-)
- [x] 接口安全设计（防重放/签名/越权）→ [安全.md](其他专题/安全.md#八接口安全设计-)
- [x] HTTPS/TLS 握手流程（1.2 vs 1.3/证书链验证）→ [安全.md](其他专题/安全.md#十https--tls-原理-)
- [x] OWASP Top 10 速记 → [安全.md](其他专题/安全.md#九owasp-top-10-速记-)

---

### 十二、☁️ 云原生与 Kubernetes ⭐⭐⭐

- [x] Docker 原理（Namespace/Cgroups/镜像分层/网络模式）→ [云原生与K8s.md](其他专题/云原生与K8s.md#一docker-核心原理-)
- [x] K8s 架构（Control Plane/Node组件详解/控制循环）→ [云原生与K8s.md](其他专题/云原生与K8s.md#二kubernetes-整体架构-)
- [x] 核心资源对象（Pod/Deployment/Service/Ingress/ConfigMap/StatefulSet）→ [云原生与K8s.md](其他专题/云原生与K8s.md#三核心资源对象-)
- [x] Pod 调度机制（过滤/打分/Taint/亲和性）→ [云原生与K8s.md](其他专题/云原生与K8s.md#四pod-调度机制-)
- [x] 服务发现与网络（CoreDNS/iptables vs ipvs/CNI）→ [云原生与K8s.md](其他专题/云原生与K8s.md#五服务发现与网络-)
- [x] 存储（PV/PVC/StorageClass 动态供给）→ [云原生与K8s.md](其他专题/云原生与K8s.md#六存储pvpvc-)
- [x] 健康检查（liveness/readiness/startup 探针）与 HPA 自动扩缩容 → [云原生与K8s.md](其他专题/云原生与K8s.md#七健康检查与自动扩缩容-)
- [x] K8s 故障排查（kubectl 命令体系）→ [云原生与K8s.md](其他专题/云原生与K8s.md#八k8s-故障排查-)
- [x] Service Mesh & Istio（Sidecar/流量治理/金丝雀布局）→ [云原生与K8s.md](其他专题/云原生与K8s.md#九service-mesh--istio-)

---

### 十三、🧩 设计模式

- [x] 单例模式（双重检查锁/静态内部类/枚举）→ [设计模式.md](其他专题/设计模式.md#11-单例模式-)
- [x] 工厂模式（简单工厂/抽象工厂）→ [设计模式.md](其他专题/设计模式.md#12-工厂模式-)
- [x] 建造者模式 → [设计模式.md](其他专题/设计模式.md#13-建造者模式-)
- [x] 代理模式（JDK动态代理 / CGLIB）→ [设计模式.md](其他专题/设计模式.md#21-代理模式-)
- [x] 装饰器模式 → [设计模式.md](其他专题/设计模式.md#22-装饰器模式-)
- [x] 策略模式（消除if-else / Spring Map注入）→ [设计模式.md](其他专题/设计模式.md#31-策略模式-)
- [x] 观察者模式（Spring ApplicationEvent）→ [设计模式.md](其他专题/设计模式.md#32-观察者模式-)
- [x] 模板方法模式（AQS / JdbcTemplate）→ [设计模式.md](其他专题/设计模式.md#33-模板方法模式-)
- [x] 责任链模式（Netty Pipeline / Spring Security）→ [设计模式.md](其他专题/设计模式.md#34-责任链模式-)

---

### 🔥 面试题汇总（冲刺速查）

- [x] 高频题精选（34题，含核心答案+追问） → [高频题精选.md](面试题汇总/高频题精选.md)
  - Java核心：JVM内存/类加载/GC/锁升级/volatile/AQS/线程池/ConcurrentHashMap/HashMap（Q1-Q10）
  - 数据库：B+树/MVCC/索引失效/redo-undo-binlog/Redis为什么快/持久化/缓存三大问题（Q11-Q17）
  - 消息队列：Kafka高吞吐/顺序消费（Q18-Q19）
  - 分布式：CAP/分布式事务选型/Raft选举（Q20-Q22）
  - 架构设计：秒杀系统/@Transactional失效（Q23-Q24）
  - 网络：TCP三次握手/TIME_WAIT（Q25-Q26）
  - 算法：快排/DP框架（Q27-Q28）
  - 场景题：CPU飙高/接口超时（Q29-Q30）
  - 新增：Spring AOP代理/SpringBoot启动优化/Stream选型/虚拟线程（Q31-Q34）
  - 快速记忆口诀
- [ ] 每日一题 → [每日一题.md](面试题汇总/每日一题.md)

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
