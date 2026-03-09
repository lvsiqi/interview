# Nacos 知识点

> 最后更新：2026年3月9日

---

## 📋 章节大纲

| 章节 | 内容 | 优先级 | 状态 |
|------|------|--------|------|
| 一 | 整体架构与核心功能 | ⭐⭐⭐ | ✅ |
| 二 | 服务注册与发现（AP模式 / Distro协议 / 临时与持久实例） | ⭐⭐⭐⭐⭐ | ✅ |
| 三 | 配置中心（长轮询 / 动态刷新 / Namespace/Group/DataId） | ⭐⭐⭐⭐ | ✅ |
| 四 | 健康检查机制（客户端心跳 vs 服务端主动探测） | ⭐⭐⭐ | ✅ |
| 五 | 集群一致性（Distro AP / Raft CP / 切换原理） | ⭐⭐⭐⭐ | ✅ |
| 六 | 自我保护模式 | ⭐⭐ | ✅ |
| 七 | 与 ZooKeeper / Eureka / Consul / Apollo 对比 | ⭐⭐⭐⭐ | ✅ |
| 八 | 高频追问汇总 | ⭐⭐⭐⭐ | ✅ |

---

## 一、整体架构与核心功能 ⭐⭐⭐

### 1.1 Nacos 是什么

```
Nacos = Dynamic Naming and Configuration Service
阿里巴巴开源，Spring Cloud Alibaba 生态核心组件

三大核心能力：
  ① 服务注册与发现（替代 Eureka / ZooKeeper）
  ② 配置中心（替代 Spring Cloud Config / Apollo）
  ③ 服务健康管理（主动探测 + 心跳 + 自我保护）

典型端口：
  8848 → 客户端访问端口（HTTP API + 控制台）
  9848 → gRPC 长连接端口（Nacos 2.x 新增）
  9849 → gRPC 集群间同步端口
  7848 → Raft 选举端口（集群部署）
```

### 1.2 整体架构示意

```
                      ┌──────────────────────────────┐
                      │        Nacos Console          │
                      │   （服务管理 / 配置管理 UI）     │
                      └──────────────┬───────────────┘
                                     │ HTTP 8848
          ┌──────────────────────────┼──────────────────────────┐
          │                          │                          │
  ┌───────▼──────┐          ┌───────▼──────┐          ┌───────▼──────┐
  │  Nacos Node1 │ ←─Raft─→ │  Nacos Node2 │ ←─Raft─→ │  Nacos Node3 │
  │  (Leader)    │          │  (Follower)  │          │  (Follower)  │
  └──────────────┘          └──────────────┘          └──────────────┘
         ↑ 注册/心跳/发现              ↑ 长轮询配置更新
         │                            │
  ┌──────┴──────┐              ┌──────┴──────┐
  │ 微服务实例A  │              │ 微服务实例B  │
  └─────────────┘              └─────────────┘

存储层：
  服务注册数据 → 内存（Service Registry Map） + 磁盘持久化（嵌入式存储/MySQL）
  配置数据     → MySQL（生产必配） + 本地缓存文件
```

### 1.3 Nacos 1.x vs 2.x 关键差异

| 维度 | Nacos 1.x | Nacos 2.x |
|------|-----------|-----------|
| **客户端通信协议** | HTTP 长轮询 | gRPC 长连接（更低延迟）|
| **服务变更推送** | UDP 推送（可能丢包）| gRPC 双向流（可靠）|
| **连接维护** | 无状态 HTTP | 有状态 gRPC 连接 |
| **性能** | 基准 | 吞吐量提升 10x+，连接数减少 |
| **兼容性** | - | 向下兼容 1.x 客户端（通过 HTTP 适配层）|

---

## 二、服务注册与发现 ⭐⭐⭐⭐⭐

### 2.1 服务注册流程

```
① 微服务启动，nacos-discovery 自动注册：
   HTTP POST /nacos/v1/ns/instance（1.x）
   或 gRPC RegisterInstanceRequest（2.x）
   携带：serviceName、namespace、group、ip、port、weight、healthy、ephemeral

② Nacos Server 收到注册请求：
   写入内存 ServiceMap（key = namespace##group@@serviceName）
   若为持久实例：同步到 Raft 日志，过半节点确认后落盘
   若为临时实例：写入 Distro 内存，异步同步到其他节点

③ Nacos Server 触发 Push 通知：
   1.x：UDP 推送给所有已订阅该服务的客户端（18848端口）
   2.x：gRPC 主动推送，可靠送达

服务注销：
  正常停机：客户端主动发 DELETE /nacos/v1/ns/instance
  异常宕机：心跳超时 → 服务端自动摘除（临时实例）
            或标记不健康（持久实例，需手动注销）
```

### 2.2 临时实例 vs 持久实例（⚠️ 高频考点）

```
临时实例（ephemeral=true，默认）：
  存储位置：仅存在于内存（Distro 协议同步）
  健康维持：客户端主动发心跳（5s/次）
             15s 未收到心跳 → 标记 unhealthy
             30s 未收到心跳 → 从注册表删除
  一致性模型：AP（Distro，最终一致）
  适用场景：普通微服务，需要随时弹性扩缩容

持久实例（ephemeral=false）：
  存储位置：持久化到磁盘（Raft 日志 + 本地文件）
  健康维持：服务端主动探测（TCP/HTTP/MYSQL 等 HealthChecker）
             探测失败 → 标记 unhealthy（不自动删除！）
  一致性模型：CP（Raft，强一致）
  适用场景：固定 IP 基础设施（数据库代理、第三方 API 节点）

关键区别：
  临时实例宕机 → 自动从注册表删除（消费者立即感知下线）
  持久实例宕机 → 仅标记不健康（节点记录保留，需人工清理）
```

### 2.3 服务发现流程

```
消费者侧（如 Python/Java 客户端）：

① 启动时：调用 GET /nacos/v1/ns/instance/list?serviceName=xxx
          拉取完整实例列表，缓存到本地内存（NamingService.hostReactor）

② 订阅变更：注册 Listener，被动接收 Nacos 推送（UDP/gRPC）
            收到推送 → 更新本地缓存

③ 容灾：即使 Nacos Server 全部宕机，本地缓存依然可用（高可用关键）
        本地缓存还会持久化到磁盘文件（~/.nacos/naming/...），JVM 重启后恢复

④ 负载均衡：客户端侧（Ribbon/LoadBalancer）从本地缓存随机/轮询选实例
```

### 2.4 Distro 协议（AP 模式核心）

```
Distro 是 Nacos 自研的 AP 协议，类似 consistent hashing + Gossip 的混合：

数据分片：
  每台 Nacos 节点只负责一部分服务的 权威写入（Responsible Node）
  通过一致性哈希确定每个服务数据的权威节点
  写请求若打到非权威节点 → 转发给权威节点处理

数据同步：
  权威节点更新数据 → 异步广播给其他所有节点（增量推送）
  定期全量校验（每隔 5min 全量对比 checksum，修复差异）
  节点启动时：从其他节点全量拉取数据（数据初始化）

一致性保证：
  ✅ 最终一致性（非强一致）
  ✅ 任意节点宕机不影响可用性
  ❌ 短暂窗口内不同节点可能返回略有差异的服务列表

场景适配：
  服务发现允许短暂不一致（客户端重试能解决）→ AP 优先
  权衡：宁愿返回稍旧的服务列表，也不拒绝注册请求
```

---

## 三、配置中心 ⭐⭐⭐⭐

### 3.1 核心概念

```
三级命名空间隔离：
  Namespace（命名空间）→ 环境隔离（dev / test / staging / prod）
    每个 Namespace 有独立 ID（UUID），默认 Namespace = "public"

  Group（分组）→ 同 Namespace 下按业务/应用分组
    默认 Group = "DEFAULT_GROUP"

  DataId（配置ID）→ 具体配置文件标识
    命名惯例：${spring.application.name}-${spring.profiles.active}.${file-extension}
    示例：order-service-prod.yaml

完整数据定位：Namespace + Group + DataId 三元组唯一确定一份配置
```

### 3.2 配置动态刷新原理（长轮询）

```
Nacos 配置更新推送采用"长轮询（Long Polling）"方案（非常驻 TCP）：

① 客户端发起请求：
   POST /nacos/v1/cs/configs/listener
   携带：dataId + group + namespace + contentMD5（本地缓存的 MD5）

② Nacos Server 处理：
   a. 比较客户端 MD5 与服务端最新配置 MD5
   b. 一致（无变更）→ 挂起请求，等待最长 29.5s（Hold 住）
      29.5s 到期 → 返回空响应 → 客户端再次发起长轮询（循环）
   c. 不一致（有变更）→ 立即唤醒挂起请求，返回变更的 DataId 列表

③ 客户端收到变更通知：
   重新调用 GET /nacos/v1/cs/configs 拉取完整新配置
   更新本地内存缓存 & 磁盘文件缓存（failover 用）
   发布 ConfigChangeEvent
   触发 Spring @RefreshScope Bean 重新初始化

时序：
  长轮询 ─────────────────29.5s后超时──────────────→ 重新长轮询
         ←── 有变更立即返回 ──┘
              客户端拉取新配置 → 通知 @RefreshScope
```

**长轮询优于推送的原因：**
```
推送方案（Server主动推）：
  Server 需要维护所有客户端连接状态，连接断开需要感知重建
  大规模集群下管理复杂

长轮询方案：
  请求由客户端主动发起，Server 无需维护推送列表
  本质上还是 HTTP，穿透各种代理/防火墙无障碍
  "保持29.5s"的挂起在 Server 侧用异步非阻塞实现，不占线程
  
Nacos 2.x 改为 gRPC 双向流，实现了真正的 Server 主动推送，延迟更低
```

### 3.3 @RefreshScope 原理

```
@RefreshScope 是 Spring Cloud 提供的特殊作用域：

Bean 创建：
  第一次访问 → 创建实例，存入 RefreshScope 缓存（与 Singleton 不同，可销毁）

配置变更触发刷新：
  ① RefreshEvent 发布
  ② RefreshScope.refreshAll() 清空作用域缓存（销毁旧 Bean）
  ③ 下次访问该 Bean → 重新从容器创建（使用最新 Environment 中的属性）

注意事项：
  ❌ @Autowired 了 @RefreshScope Bean 的普通 Bean，
     注入的是代理引用，配置刷新后代理自动转发到新实例，一般没问题
  ❌ @ConfigurationProperties + @RefreshScope 组合有坑，
     推荐只用 @ConfigurationProperties（配合 @EnableConfigurationProperties）
     Spring Cloud 2020+ 版本已支持 @ConfigurationProperties 自动刷新，无需 @RefreshScope
  ❌ @Scheduled 定时任务类加 @RefreshScope 会导致任务停止（Bean 被销毁重建）
```

### 3.4 配置优先级

```
优先级（高 → 低，后者被前者覆盖）：

① JVM 参数（-Dkey=value）
② bootstrap.yml / bootstrap.properties（Spring Cloud 专属，启动最早加载）
③ Nacos 远程配置（shared-configs / extension-configs / 服务专属配置）
   共享配置 < 扩展配置 < 服务专属配置（三级中服务专属最高）
④ application.yml / application.properties（本地应用配置）
⑤ @PropertySource 注解加载的配置
⑥ Spring Boot 默认值

Nacos 内部三级优先级（从低到高）：
  shared-configs（多服务共享，如 database.yaml）
  extension-configs（服务组/业务线级别）
  ${spring.application.name}.${file-extension}（服务专属）
```

### 3.5 配置灰度发布与版本管理

```
Nacos 控制台支持：
  ① 灰度发布：指定 IP 或实例比例推送新配置，其余实例保持旧配置
  ② 配置历史版本：每次变更自动存储历史，支持 Diff 对比和一键回滚
  ③ 配置加密：可对接 AES 等加密插件存储敏感配置（需 Nacos 插件支持）
  ④ Beta 发布（1.1.0+）：配置先推送到 Beta IP 列表验证，通过后全量推送

多 DataId 场景（Nacos 2.x spring.config.import）：
  spring:
    config:
      import:
        - nacos:shared-db.yaml?group=SHARED
        - nacos:order-service-prod.yaml
```

---

## 四、健康检查机制 ⭐⭐⭐

### 4.1 客户端心跳（临时实例）

```
客户端侧（BeatReactor）：
  每 5 秒发送一次心跳：PUT /nacos/v1/ns/instance/beat
    携带：serviceName + ip + port + cluster

服务端处理逻辑：
  更新实例的 lastBeat 时间戳
  若实例此前被标记为 unhealthy → 重新标为 healthy，推送变更给订阅者

超时判定（服务端 ClientBeatCheckTask 定时任务，默认 5s 检查一次）：
  当前时间 - lastBeat > 15000ms（15s）→ 标记 unhealthy（推送变更）
  当前时间 - lastBeat > 30000ms（30s）→ 删除临时实例（推送变更）

相关配置：
  nacos.naming.client.beat.interval=5000   # 心跳间隔（ms）
  instance.ip-delete-timeout=30000         # 实例删除超时
```

### 4.2 服务端主动探测（持久实例）

```
Nacos Server 主动对持久实例执行健康检查（类似 Consul Health Check）：

支持的探测类型：
  TCP 端口检查：   尝试 TCP connect，超时则不健康
  HTTP 端口检查：  发送 HTTP GET，返回 2xx 则健康
  MySQL 数据库检查：执行 select 1 校验 MySQL 连通性

配置（在实例注册时携带或控制台配置）：
  healthCheckType: TCP / HTTP / MYSQL
  healthCheckPath: /actuator/health   （HTTP 检查时的路径）
  healthCheckPort: 8080

探测频率：默认 20s 一次，可配
探测失败：实例标记为 unhealthy，触发推送，但不删除节点记录
          需要手动通过 API 或控制台删除，或修复后自动恢复
```

### 4.3 两种健康检查的比较

| 维度 | 客户端心跳（临时实例）| 服务端探测（持久实例）|
|------|---------------------|---------------------|
| 主动方 | 客户端 | Nacos Server |
| 宕机感知速度 | 30s 内删除 | 探测间隔内感知（默认 20s）|
| 宕机处理 | 自动删除实例 | 标记 unhealthy，保留节点 |
| 网络断开影响 | 心跳发不出去，超时删除 | Server 探测失败，标记不健康 |
| 适用场景 | 弹性微服务（K8s Pod）| 固定基础设施（DB 节点）|

---

## 五、集群一致性（Distro AP / Raft CP）⭐⭐⭐⭐

### 5.1 Nacos 的双模式设计

```
Nacos 同时支持两种一致性模型，用于不同数据类型：

AP 模式（Distro）：
  用于：服务注册数据（临时实例）
  特点：不需要过半确认，每节点直接响应写请求（非权威节点转发）
  容忍：短暂数据不一致（ms~s 级别的窗口）
  适合：服务发现（高频注册，高可用>强一致）

CP 模式（JRaft/Raft）：
  用于：服务注册数据（持久实例）+ 配置数据
  协议：基于 JRaft（Alibaba 实现的 Raft）
  特点：写操作需 Leader 过半节点确认，强一致
  容忍：少数节点可宕机（Quorum = n/2+1 台存活）
  适合：配置数据（不一致可能导致线上故障）
```

### 5.2 Raft 在 Nacos 中的运用

```
Nacos 集群（以3节点为例）：

┌────────────┐       ┌────────────┐       ┌────────────┐
│  Node1     │       │  Node2     │       │  Node3     │
│ (Leader)   │──────▶│ (Follower) │──────▶│ (Follower) │
│ JRaft  7848│       │ JRaft  7848│       │ JRaft  7848│
└────────────┘       └────────────┘       └────────────┘

配置写入流程（CP 路径）：
  客户端 → 任意节点（非 Leader 自动转发）
  → Leader 追加 RaftLog
  → 广播给 Followers（AppendEntries RPC）
  → 过半 Followers 确认 → Leader commit
  → Leader 应用到状态机（配置存储）→ 返回客户端成功

Raft 选举：
  Leader 宕机 → Followers 选举超时（150~300ms 随机）→ Candidate 发起投票
  获得过半票数 → 新 Leader 当选
  Leader 选举期间配置写请求失败（CP 代价）
```

### 5.3 Distro 数据同步细节

```
节点启动时（数据初始化）：
  新加入节点 → 从集群中已有节点全量拉取其负责分片的数据

运行时增量同步：
  权威节点（Responsible Node）写入成功后：
    → 通过 HTTP 推送增量变更到所有其他节点
    → 其他节点直接覆盖更新（Last Write Wins）

定期全量校验（5 分钟一次）：
  计算整个数据集的 checksum（按服务名排序后 MD5）
  与其他节点对比 checksum，不一致则触发全量同步修复

脑裂恢复：
  网络分区恢复后，各节点权威数据归并
  以权威节点（一致性哈希确定的）的数据为准覆盖
```

### 5.4 集群部署推荐配置

```bash
# cluster.conf（集群成员列表）
192.168.1.1:8848
192.168.1.2:8848
192.168.1.3:8848

# application.properties（生产必配 MySQL 存储）
spring.datasource.platform=mysql
db.num=1
db.url.0=jdbc:mysql://mysql-host:3306/nacos_config?characterEncoding=utf8&connectTimeout=1000&socketTimeout=3000&autoReconnect=true
db.user.0=nacos
db.password.0=nacos_password

# 推荐节点数：3 或 5（奇数，满足 Quorum）
# 单节点（standalone 模式）：不依赖 MySQL，内置 Derby 数据库（仅开发用）
```

---

## 六、自我保护模式 ⭐⭐

### 6.1 什么是自我保护

```
问题背景：
  大规模网络抖动时，大量服务实例心跳同时失败
  → 若 Nacos 直接删除这些实例 → 实际在线的服务也被下线
  → 所有消费者找不到服务 → 雪崩

自我保护机制：
  监控窗口内（默认15s）心跳健康的实例比例 < 阈值（默认85%）
  → 触发自我保护模式
  → Nacos 暂停删除任何临时实例（即使持续未收到心跳）
  → 等待网络恢复，实例重新发送心跳 → 退出保护模式

与 Eureka 保护模式对比：
  Eureka：15min 内心跳失败比例 > 15% 触发，停止剔除所有到期实例
  Nacos：15s 窗口 + 85% 阈值触发，机制类似但响应更快

配置：
  nacos.naming.protect-threshold=0.85   # 0 = 禁用保护模式
```

### 6.2 自我保护的利弊

```
优点：
  ✅ 防止大规模网络抖动引发误删，避免集群雪崩
  ✅ "宁愿返回不健康实例，也不删除"→消费者有机会自行重试

缺点：
  ❌ 保护期间真正宕机的实例也不会被删除
  ❌ 消费者可能调用到已宕机的实例（需配合客户端重试、熔断降级）

生产建议：
  保持启用（避免雪崩风险 > 偶发无效实例的代价）
  配合 Sentinel 熔断，调用失败时快速失败并降级
```

---

## 七、与其他注册/配置中心横向对比 ⭐⭐⭐⭐

### 7.1 注册中心对比

| 维度 | Nacos | ZooKeeper | Eureka | Consul |
|------|-------|-----------|--------|--------|
| **CAP** | AP(临时)/CP(持久) | CP | AP | CP |
| **协议** | Distro(AP) / Raft(CP) | ZAB | 自研 AP | Raft |
| **健康检查** | 客户端心跳 + 服务端探测 | 临时节点 Session | 客户端心跳 | 多种（TCP/HTTP/Script）|
| **宕机感知** | 30s（临时实例）| sessionTimeout（30~90s）| 90s（心跳超时）| 较快（探测间隔）|
| **服务变更推送** | UDP(1.x)/gRPC(2.x)主动推 | Watcher（一次性）| 客户端轮询 | 长轮询 |
| **配置中心** | ✅ 内置 | ⚠️ 简单支持 | ❌ | ✅（KV 存储）|
| **控制台** | ✅ 功能丰富 | ❌ 无（第三方）| ✅ 简单 | ✅ |
| **维护状态** | ✅ 活跃 | ✅ 活跃 | ❌ 停维 | ✅ 活跃 |
| **适用生态** | Spring Cloud Alibaba | Java 大数据 | Spring Cloud Netflix | 多语言/跨平台 |

### 7.2 配置中心对比

| 维度 | Nacos Config | Apollo | Spring Cloud Config |
|------|-------------|--------|---------------------|
| **推送方式** | 长轮询(1.x) / gRPC(2.x) | 长轮询 | Git Webhook → Bus 广播 |
| **实时性** | 秒级 | 秒级 | 秒~分钟级（依赖 Bus）|
| **灰度发布** | ✅ | ✅ | ❌ |
| **版本管理** | ✅ 历史 + 回滚 | ✅ 历史 + 回滚 | ✅（依赖 Git）|
| **权限控制** | ✅（企业版更完善）| ✅（精细化）| ❌ |
| **多环境** | Namespace 隔离 | Environment 隔离 | Profile + Git 分支 |
| **部署复杂度** | 低（单服务）| 高（多组件：Config/Admin/Portal）| 低（依赖 Git）|
| **Spring 集成** | 原生支持 | 官方 Starter | 原生支持 |
| **适用场景** | Spring Cloud Alibaba 首选 | 大型企业，精细化权限 | 小型项目，已有 Git |

### 7.3 为什么推荐 Nacos 而非 ZooKeeper 做注册中心？

```
① 一致性模型不匹配：
   注册中心优先可用性（AP）：服务频繁注册/注销，宁愿读到旧列表也不拒绝写
   ZooKeeper 是 CP：写操作需要过半确认，选举期间拒绝写 → 服务无法注册

② 连接感知延迟：
   ZooKeeper 靠 Session 心跳感知宕机（默认 30~90s）
   Nacos 心跳 5s，15s 标记不健康，30s 删除（更快）

③ 推送方式：
   ZooKeeper 的 Watcher 是一次性，触发后需要重新注册，存在漏事件风险
   Nacos 主动推送（gRPC），稳定可靠

④ 功能丰富度：
   Nacos 集成了配置中心、健康管理、控制台
   ZooKeeper 是底层协调工具，需要大量封装才能用于服务发现（如 Curator）
```

---

## 八、高频追问汇总 ⭐⭐⭐⭐

**Q: Nacos 的 AP 和 CP 是怎么切换的？**
> Nacos 不需要"切换"，两种模式**共存**：通过注册实例时的 `ephemeral` 参数决定走哪条路径。`ephemeral=true`（默认）→ 走 Distro AP；`ephemeral=false` → 持久实例，走 Raft CP。配置中心数据始终走 Raft CP。同一个 Nacos 集群同时运行两套一致性协议，各司其职。

**Q: Nacos 服务列表推送是 Push 还是 Pull？**
> 两者结合。服务发现客户端会定期轮询（Pull，默认 10s）作为兜底；同时 Nacos Server 在服务注册表变更时主动推送（Push）给所有订阅者（1.x UDP，2.x gRPC）。这样即使推送丢了，轮询也能在 10s 内补偿。

**Q: Nacos 长轮询为什么是 29.5s 而不是 30s？**
> 防止服务端和客户端超时时间恰好对齐导致大量连接同时超时重建。Nacos 服务端 Hold 请求 29.5s，客户端 HTTP 超时通常设 30s，留 0.5s 的余量让服务端先超时返回，避免客户端认为是网络错误。

**Q: Nacos 集群宕机了，微服务还能正常运行吗？**
> **能！** 服务发现使用本地缓存（内存 + 磁盘文件），Nacos 宕机后消费者仍能从本地缓存拿到服务列表继续调用。配置中心同样有本地磁盘缓存（`~/.nacos/config/...`），JVM 重启 + Nacos 宕机的场景需要磁盘缓存来恢复。但新实例无法注册、配置无法更新，直到 Nacos 恢复。

**Q: Nacos 2.x 为什么引入 gRPC？**
> Nacos 1.x 使用 HTTP：服务发现推送走 UDP，可能丢包；配置拉取用长轮询，每个长轮询占用一个 HTTP 连接，大规模下连接数爆炸。Nacos 2.x 改用 gRPC 长连接（HTTP/2 多路复用）：单连接承载心跳/推送/RPC 等多路复用，减少连接数约 60%；gRPC 双向流实现可靠 Push，消除 UDP 丢包问题；性能提升 10x+。

**Q: 生产中 Nacos 配置如何防止误操作导致故障？**
> ① **命名空间隔离**：不同环境（dev/prod）用不同 Namespace，物理隔离，防止误改 prod 配置；② **配置历史 + 一键回滚**：Nacos 自动保存每次变更历史，故障时可秒级回滚；③ **灰度发布**：先推送到部分实例验证，确认无误后全量推；④ **配置加密**：敏感配置（密码/密钥）接入加密插件，不明文存储；⑤ **权限控制**：生产 Namespace 仅运维人员有写权限。

**Q: Distro 和 Gossip 的区别？**
> 理念相似但实现不同。Gossip 是去中心化的：每个节点随机找几个邻居传播，传播路径不确定，最终收敛。Distro 是"分片权威" 模式：通过一致性哈希明确每条数据的权威写入节点，非权威节点直接转发写请求，写路径明确可控。与纯 Gossip 相比，Distro 的写延迟更低，数据冲突概率更小，但需要节点发现机制（cluster.conf）。

**Q: Nacos 和 Apollo 如何选择？**
> 中小型项目首选 Nacos：部署简单（单服务），注册中心+配置中心一体化，Spring Cloud Alibaba 生态无缝集成。大型企业项目考虑 Apollo：更精细的权限管理（灰度发布+多维度权限），更完善的审计追踪，多团队协作场景优势明显。如果已使用 Spring Cloud Alibaba 全家桶，用 Nacos 一套即可，减少依赖。
