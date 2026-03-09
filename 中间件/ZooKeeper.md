# ZooKeeper 知识点

> 最后更新：2026年3月6日

---

## 📋 章节大纲

| 章节 | 内容 | 优先级 | 状态 |
|------|------|--------|------|
| 一 | 核心概念（节点类型 / Session / Watcher / 集群节点角色） | ⭐⭐⭐ | ✅ |
| 二 | ZAB协议（ZXID / 选举 / 数据同步 / Raft对比） | ⭐⭐⭐⭐ | ✅ |
| 三 | 分布式锁（原理 + Curator 代码） | ⭐⭐⭐⭐ | ✅ |
| 四 | 应用场景（注册中心/配置中心/Leader选举/屏障） | ⭐⭐⭐ | ✅ |
| 五 | 与 Nacos/Eureka/etcd 对比 | ⭐⭐⭐ | ✅ |
| 六 | 集群配置与运维（zoo.cfg / 四字命令 / 读写路由 / 扩缩容） | ⭐⭐ | ✅ |
| 七 | 高频追问汇总 | ⭐⭐⭐⭐ | ✅ |

---

## 一、核心概念 ⭐⭐⭐

### 1.1 数据模型

```
ZooKeeper 的数据模型是一棵树（ZNode Tree），类似文件系统：

/
├── /services
│   ├── /services/order-service          ← 持久节点
│   │   ├── /services/order-service/0001 ← 临时顺序节点（某台机器注册）
│   │   └── /services/order-service/0002
└── /config
    └── /config/app.properties

特点：
  每个 ZNode 最大存储数据 1MB（不适合存大数据，适合存协调元数据）
  ZNode 同时具有文件（存数据）和目录（有子节点）的特性
```

### 1.2 节点类型（ZNode）

| 类型 | 特点 | 典型用途 |
|------|------|---------|
| **持久节点** | 客户端断开后节点依然存在 | 配置存储、服务目录 |
| **临时节点** | 客户端会话结束即删除 | 服务注册（感知宕机）|
| **持久顺序节点** | 持久 + 自动追加递增序号 | - |
| **临时顺序节点** | 临时 + 自动追加递增序号 | **分布式锁** |
| **容器节点**（3.6+）| 子节点全部删除后自动删除自身 | 分布式锁根节点 |
| **TTL节点**（3.6+）| 超过指定时间无修改则自动删除 | 过期配置 |

### 1.3 Session 机制（重要）

Session 是客户端与 ZooKeeper 的长连接会话，**临时节点的生命周期绑定于 Session**。

```
客户端连接 ZooKeeper 时建立 Session：
  ① 客户端 → ZooKeeper：发起 ConnectRequest，携带 sessionTimeout 期望值
  ② ZooKeeper → 客户端：返回协商后的 sessionTimeout 和 sessionId

心跳维持：
  客户端每隔 sessionTimeout/3 发送一次心跳（PING 请求）
  ZooKeeper 在 sessionTimeout 内没有收到心跳 → 会话过期 → 临时节点全部删除

断线重连：
  客户端断线后进入 CONNECTING 状态，在 sessionTimeout 内重连成功 → 会话继续
  超过 sessionTimeout 仍未重连 → ZooKeeper 宣告会话过期 → 临时节点删除 → 触发 Watcher
```

```
Session 状态机：
  NOT_CONNECTED
       ↓ 连接成功
  CONNECTED  ←──────────────────────────┐
       ↓ 网络断开                       │ 重连成功（sessionTimeout 内）
  CONNECTING ─────────────────────────→ ┘
       ↓ sessionTimeout 超时
  EXPIRED（会话过期，需要重新建立 Session）
```

**为什么服务注册使用临时节点而不是持久节点？**
> 临时节点与 Session 绑定：服务实例宕机 → TCP 断开 → 心跳停止 → sessionTimeout 后节点自动删除 → 订阅方收到 Watcher 通知 → 自动摘除宕机实例，无需人工干预，这是 ZooKeeper 服务发现的核心机制。

### 1.4 Watcher 机制

```
客户端可以对任意节点注册 Watcher（监听器）

Watcher 事件类型：
  NodeCreated        → 节点被创建
  NodeDeleted        → 节点被删除
  NodeDataChanged    → 节点数据被修改
  NodeChildrenChanged → 子节点列表变化（子节点增删）

特点：
  ① 一次性（One-time）：触发后自动取消，需要客户端重新注册
  ② 异步通知：ZooKeeper Server 推送事件类型给客户端（不包含数据！）
  ③ 客户端收到通知后需主动 getData/getChildren 拉取最新数据（推+拉组合）
  ④ 顺序性：同一客户端收到的 Watcher 通知严格有序
```

**Watcher 实现服务发现流程：**
```
① 服务提供者启动 → 在 /services/order-service 下创建临时节点
② 消费者 → getChildren("/services/order-service", watcher) 订阅子节点变化
③ 提供者宕机 → 临时节点自动删除 → 触发 NodeChildrenChanged 事件
④ 消费者收到通知 → 重新 getChildren 拉取最新列表 → 重新注册 Watcher（关键！）
                                                    ↑ 否则只监听这一次
```

**Watcher 的局限性（字节常问）：**
```
问题1：一次性，需要重复注册。Watcher 触发到重新注册之间存在窗口期，可能漏事件。
问题2：只通知事件类型，不携带数据，需要额外 getData 拉取，增加一次网络往返。

Nacos 的长轮询方案没有这个问题（服务端 hold 住请求，有变化直接在响应中携带数据）。
```

### 1.5 集群节点角色与分工 ⭐⭐⭐

ZooKeeper 集群中有三种角色：**Leader**、**Follower**、**Observer**。

```
集群拓扑示意（5 节点，含 1 个 Observer）：

          ┌─────────┐
          │  Leader  │  ←── 节点间选举交互 2888 端口
          └───┬───┘
       ┌───┴─────┬─────┐
  ┌───┴──┐    ┌───┴──┐    ┌───┴──┐
  │Follower│    │Follower│    │Observer│
  └────────┘    └────────┘    └────────┘
          ↑全部参与选举（Quorum）    ↑不参与选举

客户端连接字符串：zk-node1:2181,zk-node2:2181,zk-node3:2181
  → Curator/ZkClient 会自动 Round-Robin 连接一个可用节点
```

#### 各角色职责详解

| 角色 | 参与选举 | 写请求 | 读请求 | 参与 Quorum | 数据同步 | 节点数 |
|------|--------|--------|--------|------------|--------|-------|
| **Leader** | 是（自身）| 直接处理 | 直接处理 | 是 | 权威来源 | 全集群唯一一个 |
| **Follower** | 是 | 转发 Leader | 本地处理 | 是 | 同步自 Leader | 推荐奇数台 |
| **Observer** | 否 | 转发 Leader | 本地处理 | **否** | 同步自 Leader | 按需扩展 |

**Leader**
```
职责：
  ① 处理所有写请求（分配 ZXID，发起 ZAB 广播）
  ② 维护 Follower/Observer 的存活列表，监控心跳
  ③ 广播 Proposal + COMMIT 到所有 Follower、将 INFORM 发给 Observer
  ④ 事务完成后向原请求节点返回应答

为什么只有一个 Leader？
  保证所有写操作全序广播，避免并发写冲突；
  多 Leader 引入脑裂风险，不符合 ZAB 一致性语义。
```

**Follower**
```
职责：
  ① 处理客户端读请求（本地内存树直接返回）
  ② 把客户端写请求转发给 Leader
  ③ 参与 ZAB 广播流程：收到 Proposal 写事务日志 → ACK → 收到 COMMIT → 提交到内存树
  ④ 参与 Leader 选举投票（贡献自己的 Vote，占 Quorum）
  ⑤ Leader 宕机时进入 LOOKING 状态，发起新一轮选举

心跳方向：Follower → Leader，正常运行阶段每 tickTime 发送一次 PING
```

**Observer**
```
职责：
  ① 处理读请求（与 Follower 相同）
  ② 写请求转发给 Leader
  ③ Leader 推送 INFORM 消息（Observer 不参与 ACK）→ 直接提交事务到内存树
  ④ 不参与选举投票，不占 Quorum，对选举结果无影响

节点状态机（所有角色共用）：
  LOOKING   → 选举中，不处理客户端请求
  FOLLOWING → Follower 正常工作中
  LEADING   → Leader 正常工作中
  OBSERVING → Observer 正常工作中
```

#### Observer 适用场景与不适用场景

```
适用场景：
  ① 读内容远多于写的服务（接口配置、服务发现），需要横向扩展读容量
  ② 跨数据中心部署：主机房部署 Follower 保证 Quorum，异地机房全设为 Observer
     → 写性能不受跨机房高延迟影响，异地用户仍可读到本地副本
  ③ 高峰期紧急扩容：需要快速扩大集群读能力但不想触发选举，临时添加 Observer

不适用：
  ❌ 对写性能有极高要求（Observer 不能缩减写广播开销）
  ❌ 希望提高集群容错性（Observer 不贡献 Quorum，容错必须增加 Follower）
```

### 1.6 面试标准答法

> ZooKeeper 的数据模型是树形的 ZNode 结构，每个 ZNode 最大存 1MB 数据。有 4 种节点类型，其中**临时顺序节点**是实现分布式锁的关键。ZooKeeper 与客户端通过 Session 维持长连接，客户端心跳频率是 sessionTimeout/3，超过 sessionTimeout 未心跳则会话过期、临时节点自动删除，这是服务发现感知宕机节点的核心机制。Watcher 是一次性监听，触发后必须重新注册；通知不携带数据，是"推事件+拉数据"的组合模式。
>
> 集群角色上，**Leader** 是唯一写入入口，负责给事务分配 ZXID 并通过 ZAB 广播收取 Follower ACK；**Follower** 处理读请求并参与选举投票，占 Quorum；**Observer** 只分担读压力，不参与选举和 ACK，在不影响写性能的前提下横向扩展读容量。在 `zoo.cfg` 中将节点标记为 `observer` 即可自动进入 OBSERVING 状态。

### 1.7 常见追问

**Q: ZooKeeper 的 Watcher 是推还是拉？**
> 混合模式。ZooKeeper Server 感知到节点变化后**推送**事件通知（含事件类型，不含数据）给客户端；客户端收到通知后需主动**拉取**最新数据（`getData`/`getChildren`）。这样设计减少了数据传输量（多个 Watcher 同时触发时不重复传数据），但引入一次额外读请求，且通知到拉数据之间有短暂窗口可能读到中间状态。

**Q: 临时节点能有子节点吗？**
> 不能。临时节点不允许有子节点，否则父节点（临时）被删后其子节点也应该被删除，但子节点的生命周期是独立的，语义上会产生矛盾。实现层面 ZooKeeper 直接禁止在临时节点下创建子节点。

**Q: Observer 收到 INFORM 消息，而 Follower 收到 PROPOSAL + COMMIT，为什么这样设计？**
> Follower 需要参与 ACK 投票，所以必须先收到 Proposal 认知内容再回复 ACK，再经 COMMIT 才提交。Observer 不参与投票，所以 Leader 可以等过半节点已确认后，将已提交的事务用一个 INFORM 消息直接通知 Observer，无需额外往返。

**Q: Follower / Observer 处理读请求时会转发给 Leader 吗？**
> 不会。读请求直接在本地内存树应答，不经过 Leader，这是 ZooKeeper 分流读压力的核心设计。只有**写请求**（create/setData/delete）才会被 Follower/Observer 转发到 Leader。

**Q: 集群中 Follower 和 Observer 如何区分？**
> 通过 `zoo.cfg` 的 `server.N` 配置和 `myid` 区分：普通节点写作 `server.3=host:2888:3888`，加 `:observer` 后缀就是 Observer。客户端无需感知对方角色，连接字符串填入所有节点地址即可。

---

## 二、ZAB 协议（Zookeeper Atomic Broadcast）⭐⭐⭐⭐

ZAB 是 ZooKeeper 专门设计的原子广播协议，保证集群数据一致性。

### 2.1 两种模式

| 模式 | 触发时机 | 作用 |
|------|---------|------|
| **崩溃恢复模式** | 集群启动 / Leader宕机 | 重新选举Leader，同步数据 |
| **消息广播模式** | Leader正常工作时 | 处理客户端写请求，广播给所有Follower |

### 2.2 ZXID 结构（字节爱问）

```
ZXID 是 64 位全局单调递增事务ID：

高 32 位：epoch（Leader 任期编号，每次选出新 Leader +1）
低 32 位：事务序号（每次写操作 +1，新 Leader 当选后从 0 重新计数）

意义：
  epoch 变化 → 可以区分不同任期的事务，防止旧 Leader COMMIT 消息被误处理
  单调递增 → 保证事务严格全序

示例：
  ZXID = 0x0000000200000003
  epoch = 2（第2届Leader）
  事务序号 = 3（本届第3条事务）
```

### 2.3 消息广播流程（类似2PC）

```
Client → 任意节点（Follower自动转发给Leader）
  ↓
Leader → 生成 Proposal，分配全局唯一 ZXID
  ↓
Leader → 并行广播 Proposal 给所有 Follower（异步）
  ↓
Follower → 按 ZXID 顺序写入本地事务日志 → 返回 ACK
  ↓
Leader → 收到 **过半** ACK（Quorum = n/2+1）→ 广播 COMMIT
  ↓
Leader + Follower → 提交事务到内存树 → Leader 返回客户端成功

关键：
  ① Follower 用 FIFO 队列处理 Proposal，保证顺序
  ② 只需过半确认（不需要全部），所以允许少数节点宕机
  ③ "2PC-like"但与标准 2PC 不同：ZAB 没有"Abort"流程，
     Leader 过半确认就直接 COMMIT，节点故障通过崩溃恢复修复
```

### 2.4 Leader 选举流程（FastLeaderElection）

**触发时机：** 集群启动 / Leader宕机 / 超过半数节点失去联系

```
每台Server的投票信息：Vote(myid, ZXID, epoch)

选举规则（优先级从高到低）：
  1. epoch 大的优先（任期更新，防止旧 Leader 干扰）
  2. ZXID 大的优先（数据最新）
  3. ZXID 相同时，myid 大的优先（打破平局）

具体流程：
  ① 每台Server进入LOOKING状态，先投票给自己
  ② 广播投票给其他Server
  ③ 收到对方投票后，按上述规则 PK：
     - 对方更优 → 更新自己的票，重新广播
     - 自己更优 → 忽略对方投票
  ④ 某个 Server 的投票获得超过半数 → 成为 PreLeader
  ⑤ PreLeader 执行数据同步，同步完成后正式变为 Leader
  ⑥ 进入消息广播模式接受客户端请求

示例（5节点集群，Server3宕机）：
  Server1: (myid=1, ZXID=100, epoch=3)
  Server2: (myid=2, ZXID=100, epoch=3)
  Server4: (myid=4, ZXID=105, epoch=3) ← ZXID 最大
  Server5: (myid=5, ZXID=105, epoch=3) ← ZXID 相同，myid=5>4
  → Server5 当选 Leader（4票过半）
```

### 2.5 数据同步三种模式（崩溃恢复关键细节）

新 Leader 选出后，需要与 Follower 同步数据，根据差异大小选择不同策略：

```
新 Leader 维护一个本地 commitLog（已提交事务队列，保留最近 500 条）

① DIFF 同步（增量同步）
   条件：Follower 的 ZXID 在 Leader 的 [minCommittedLog, maxCommittedLog] 范围内
   操作：Leader 只发送 Follower 缺失的那部分 Proposal+COMMIT
   场景：Follower 短暂断线后重连，差距不大

② SNAP 同步（全量快照同步）
   条件：Follower 的 ZXID 太旧，Leader 的 commitLog 里已经没有对应的起点
   操作：Leader 序列化完整内存数据树（Snapshot），发给 Follower
   场景：Follower 长时间离线，差距过大

③ TRUNC 同步（回滚）
   条件：Follower 的 ZXID 比 Leader 的 maxCommittedLog 还大
        （说明该 Follower 上有旧 Leader 提交但未过半的脏数据）
   操作：通知 Follower 截断到 Leader 的 maxCommittedLog，删除多余事务
   场景：旧 Leader 宕机，某个 Follower 收到了 Proposal 但未 COMMIT，新选出的 Leader 数据更权威
```

### 2.6 崩溃恢复两大保证

```
① 已提交的事务必须被所有机器提交（不能丢）
   → 选 ZXID 最大的 Server 为 Leader，其数据最完整
   → 用 DIFF/SNAP 同步让所有 Follower 追上 Leader

② 只在 Leader 上提出但未过半确认的 Proposal 必须丢弃（不能误提交）
   → 这些 Proposal 没达到过半确认，不算"已提交"
   → TRUNC 同步让持有这些脏 Proposal 的 Follower 回滚
```

### 2.7 Observer 节点

```
Observer 是 ZooKeeper 3.3+ 引入的第三种角色（非 Leader 非 Follower）

特点：
  ① 不参与投票和选举（不计入 Quorum）
  ② 同步 Leader 的数据，可处理读请求
  ③ 写请求转发给 Leader

作用：在不影响写性能（不增加 ACK 数量）的前提下横向扩展读能力

配置（zoo.cfg）：
  server.4=192.168.1.4:2888:3888:observer
```

### 2.8 ZAB vs Raft 对比（字节爱问）

| 对比维度 | ZAB | Raft |
|---------|-----|------|
| **设计目标** | ZooKeeper 专用 | 通用分布式共识 |
| **Leader 选举** | FastLeaderElection（基于 ZXID+epoch+myid 投票） | 基于随机超时 + term + log index 投票 |
| **日志复制** | Proposal→ACK→COMMIT 三阶段，过半确认 | AppendEntries，过半确认后 commit |
| **任期标识** | epoch（高32位嵌入ZXID） | term（独立字段，单调递增） |
| **成员变更** | 静态配置（需人工修改 zoo.cfg + 重启） | 支持 Joint Consensus 动态成员变更 |
| **读一致性** | 读 Follower 可能读到旧数据；`sync()` 可强制同最新 | 可通过 ReadIndex/LeaseRead 优化线性一致读 |
| **典型实现** | ZooKeeper | etcd、TiKV、CockroachDB |

> **面试一句话：** ZAB 和 Raft 思想高度相近（都是 Quorum + 强 Leader），主要区别在于 ZAB 使用 epoch+ZXID 标识事务顺序，Raft 使用 term+index，Raft 额外支持动态成员变更。

### 2.9 面试标准答法

> ZAB 协议分两个模式：**消息广播**（正常写入）和**崩溃恢复**（Leader 故障重选）。写入流程类似 2PC——Leader 给事务分配全局 ZXID，广播 Proposal，过半 Follower ACK 后发送 COMMIT，保证顺序一致性。ZXID 高 32 位是 epoch（任期），低 32 位是序号，epoch 变化可识别跨任期事务。崩溃恢复选 ZXID 最大节点为新 Leader，通过 DIFF/SNAP/TRUNC 三种方式同步数据，保证"已提交不丢、未过半脏数据回滚"两大原则。

### 2.10 常见追问

**Q: ZooKeeper 集群节点数为什么推荐奇数？**
> 容错公式：允许宕机节点数 = (n-1)/2。5 节点允许 2 台宕机，6 节点也只允许 2 台（需要 4 台存活），多 1 台节点没有提升容错，反而增加选举通信开销。奇数节点最优。

**Q: ZooKeeper 的读请求为什么默认不保证线性一致？**
> 读请求默认由 Follower 本地处理，Follower 可能落后于 Leader 若干事务，所以读到的可能是旧数据。如果需要强一致读，需在读前调用 `sync()` 让 Follower 与 Leader 同步，但会牺牲性能。

**Q: ZAB 和 Paxos 是什么关系？**
> ZAB 作者称其受 Paxos 启发但并非直接实现。Paxos 是通用的分布式共识算法，解决单值共识；ZAB 专注于全序广播（多值、有顺序），在 Paxos 基础上增加了主从结构和崩溃恢复语义，工程实用性更强。

---

## 三、分布式锁实现原理 ⭐⭐⭐⭐

### 3.1 实现方案（原生 API）

**利用临时顺序节点实现公平锁：**

```
争抢锁：
  ① 所有客户端在 /lock 下创建临时顺序节点
     /lock/0000000001 (Client A)
     /lock/0000000002 (Client B)
     /lock/0000000003 (Client C)

  ② 每个客户端获取 /lock 下所有子节点，判断自己的序号是否最小
     → 是最小（Client A）→ 获得锁，执行业务

  ③ 不是最小（Client B）→ 监听比自己小一位的节点（/lock/0000000001）
     → 等待前驱节点删除通知，避免羊群效应

释放锁：
  ④ Client A 业务执行完 → 删除自己的节点 → Client B 监听到 → 获得锁
  ⑤ 如果 Client A 宕机 → 临时节点随 Session 过期自动删除 → Client B 同样触发
```

**为什么监听前一个节点而不是监听 /lock 根节点？**

```
如果所有 Client 都监听 /lock 根节点（NodeChildrenChanged）：
  A 释放锁 → 触发 B/C/D 全部 Watcher → 所有 Client 同时抢锁
  → "羊群效应"（Herd Effect），大量无效请求涌向 ZooKeeper

监听前驱节点：
  A 释放锁 → 只唤醒 B 一个 Client → 无羊群效应，O(1) 唤醒
```

### 3.2 Curator 框架实现（生产推荐）

原生 ZooKeeper API 处理断线重连、Watcher 重注册很繁琐，生产使用 **Apache Curator** 封装好的锁。

```xml
<!-- Maven 依赖 -->
<dependency>
    <groupId>org.apache.curator</groupId>
    <artifactId>curator-recipes</artifactId>
    <version>5.5.0</version>
</dependency>
```

```java
// 1. 创建 CuratorFramework 客户端
CuratorFramework client = CuratorFrameworkFactory.builder()
        .connectString("zk-host1:2181,zk-host2:2181,zk-host3:2181")
        .sessionTimeoutMs(30000)       // 会话超时
        .connectionTimeoutMs(5000)     // 连接超时
        .retryPolicy(new ExponentialBackoffRetry(1000, 3))  // 断线重试策略
        .namespace("my-app")           // 隔离命名空间（自动加前缀 /my-app）
        .build();
client.start();

// 2. 可重入互斥锁（对应 java.util.concurrent.ReentrantLock）
InterProcessMutex lock = new InterProcessMutex(client, "/order-lock");

try {
    // 阻塞获取锁（支持超时）
    if (lock.acquire(10, TimeUnit.SECONDS)) {
        try {
            // ===== 临界区 =====
            doBusinessLogic();
            // ==================
        } finally {
            lock.release();  // 必须在 finally 中释放
        }
    } else {
        throw new RuntimeException("获取分布式锁超时");
    }
} catch (Exception e) {
    log.error("分布式锁异常", e);
}

// 3. 读写锁（读共享/写互斥，适合读多写少）
InterProcessReadWriteLock rwLock = new InterProcessReadWriteLock(client, "/config-lock");
InterProcessMutex readLock  = rwLock.readLock();
InterProcessMutex writeLock = rwLock.writeLock();

// 读操作
readLock.acquire();
try { /* 读取配置 */ } finally { readLock.release(); }

// 写操作
writeLock.acquire();
try { /* 修改配置 */ } finally { writeLock.release(); }
```

**Curator 常用锁类型：**

| 锁类型 | 类名 | 说明 |
|--------|------|------|
| 可重入互斥锁 | `InterProcessMutex` | 最常用，同一线程可重入 |
| 不可重入互斥锁 | `InterProcessSemaphoreMutex` | 轻量，不支持重入 |
| 读写锁 | `InterProcessReadWriteLock` | 读共享、写互斥 |
| 联合锁（多锁） | `InterProcessMultiLock` | 原子获取多个资源的锁 |
| 信号量 | `InterProcessSemaphoreV2` | 控制并发数（如限流） |

### 3.3 ZooKeeper 分布式锁 vs Redis 分布式锁

| 对比 | ZooKeeper（Curator）| Redis（Redisson）|
|------|---------------------|----------------|
| **实现原理** | 临时顺序节点 + Watcher | SET NX EX + 看门狗续期 |
| **锁释放保障** | 宕机后临时节点随 Session 过期自动删除 | 宕机后等待 TTL 过期 |
| **公平性** | 天然公平（顺序节点排队） | 默认非公平（竞争抢锁） |
| **死锁风险** | 几乎没有（临时节点自动清理） | TTL 设置不当可能死锁或误删 |
| **性能** | 较低（ZK 写操作 + 选举路径） | 高（内存操作，单机 10w+ QPS） |
| **可重入** | 支持（Curator InterProcessMutex） | 支持（Redisson RLock） |
| **读写锁** | 支持 | 支持 |
| **适用场景** | 对公平性/可靠性要求高，并发量不极端 | 高并发、性能优先 |

> **生产选择：** 订单系统等高并发优先 Redis Redisson；对公平排队有要求、并发量中等则用 ZooKeeper Curator。

### 3.4 面试标准答法

> ZooKeeper 分布式锁基于**临时顺序节点**实现。所有竞争者在锁根节点下创建临时顺序子节点，序号最小的获得锁；其余节点各自监听**前一个顺序节点**（而非根节点），避免锁释放时触发全部节点争抢的羊群效应。持锁方宕机后，临时节点随 Session 过期自动删除，不会出现死锁。生产中推荐用 Apache Curator 的 `InterProcessMutex`，它封装了断线重连、Watcher 重注册等细节。与 Redis 锁相比，ZooKeeper 锁天然公平、不存在 TTL 误删问题，但写操作性能较低。

### 3.5 常见追问

**Q: Curator 的 InterProcessMutex 是可重入的，它如何实现可重入？**
> Curator 在客户端维护一个 `ConcurrentMap<Thread, LockData>` 记录当前线程持锁信息，重入时计数器 +1，`release()` 计数器 -1，计数为 0 时才真正删除 ZNode 节点。

**Q: ZooKeeper 分布式锁宕机后多久才自动释放？**
> 取决于 Session 的 `sessionTimeout` 配置（默认 `tickTime * 2 = 4~6s`，生产通常配 30s）。在这个时间窗口内，锁不会立即释放，是 ZooKeeper 锁的主要缺点之一。Redis Redisson 看门狗续期机制也有类似问题，宕机后要等 TTL（默认 30s）过期。

---

## 四、典型应用场景 ⭐⭐⭐

### 4.1 服务注册与发现

```
提供者启动 → 在ZK创建临时节点（/services/order/ip:port）
消费者启动 → getChildren("/services/order") 读取服务列表 + 注册Watcher
提供者宕机 → 临时节点随Session过期自动删除 → 消费者Watcher触发 → 重新拉取列表
提供者扩容 → 新节点创建 → 消费者Watcher触发 → 发现新实例
```

> **Dubbo 使用 ZooKeeper 作注册中心时**，节点路径设计：
> `/dubbo/{serviceInterface}/providers/{ip:port?params}` —— 持久根节点 + 临时叶子节点

### 4.2 配置中心

```
管理员 → 将配置存入持久节点（/config/app.properties）
应用启动 → getData + 注册 NodeDataChanged Watcher
管理员修改配置 → 触发 NodeDataChanged 事件
应用收到通知 → 重新 getData 拉取新配置 + 重新注册 Watcher → 热更新
```

> **与 Nacos 配置中心的区别：** ZooKeeper 的 Watcher 一次性，客户端需手动重注册；Nacos 使用长轮询（服务端 hold 住请求），推送更稳定，且配置管理 UI 功能更丰富。

### 4.3 Master 选举

```
所有候选 Master 争抢创建同一个临时节点（/master）
  ├── 成功创建者 → 当选 Master，持有锁
  └── 失败者 → 监听 /master 节点删除事件（NodeDeleted）

Master 宕机 → 临时节点删除 → 其余节点争抢 → 新 Master 诞生
```

**Hadoop NameNode HA、HBase HMaster 都用这个模式实现主备切换。**

### 4.4 分布式屏障（Barrier）

```
场景：批处理任务，需要所有 Worker 都就绪后才开始
      所有 Worker 完成各自部分后，主节点才汇总结果

实现：
  ① 每个 Worker 就绪后在 /barrier/workers 下创建临时节点
  ② 协调者监听 /barrier/workers 子节点数量
  ③ 子节点数量 == 预期 Worker 数 → 协调者发信号（删除 /barrier/ready 节点）→ 全部开始
  ④ Curator DistributedBarrier 封装了以上逻辑
```

### 4.5 面试标准答法

> ZooKeeper 的应用场景核心都围绕"**临时节点 + Watcher 通知**"这两个机制。服务注册发现利用临时节点感知实例宕机；配置中心利用 Watcher 监听数据变化实现热更新；Master 选举利用创建临时节点的互斥性保证只有一个 Master；分布式锁利用临时顺序节点+监听前驱节点实现公平排队。

### 4.6 常见追问

**Q: Dubbo 为什么从 ZooKeeper 迁向 Nacos？**
> 主要原因：① 注册中心场景优先可用性（AP），ZooKeeper 是 CP，网络分区时拒绝写入影响服务注册；② ZooKeeper 服务下线感知依赖 sessionTimeout，最慢需要 30s+，Nacos 主动探活秒级感知；③ Nacos 提供了配置中心、健康监控等一体化功能，ZooKeeper 偏底层需要自行封装。

---

## 五、与 Nacos / Eureka / etcd 对比 ⭐⭐⭐

### 5.1 注册中心横向对比

| 对比 | ZooKeeper | Nacos | Eureka |
|------|-----------|-------|--------|
| **一致性模型** | CP（强一致，写操作需 Leader 确认过半） | AP（服务发现）/ CP（配置）| AP |
| **健康检查** | 临时节点心跳（会话超时）| 客户端心跳 + 服务端主动探测 | 客户端心跳 |
| **服务下线感知速度** | 慢（sessionTimeout 默认 30~40s）| 快（主动探测，通常 5s 内）| 慢（需等心跳超时 90s）|
| **配置中心** | 支持（功能简单，无 UI）| 支持（功能丰富，有 Web UI）| ❌ 不支持 |
| **动态配置推送** | Watcher（一次性，需重注册）| 长轮询（稳定，数据随通知推送）| ❌ |
| **自我保护机制** | ❌（CP 系统，直接拒绝）| ✅（临时实例模式）| ✅（15分钟心跳低于85%触发）|
| **生态** | Hadoop/HBase/Kafka 等大数据 | Spring Cloud Alibaba 主流 | Spring Cloud Netflix（维护期）|
| **推荐场景** | 大数据基础设施协调服务 | **国内微服务首选** | 旧项目迁移维护 |

### 5.2 ZooKeeper vs etcd 对比

| 对比 | ZooKeeper | etcd |
|------|-----------|------|
| **共识算法** | ZAB | Raft |
| **数据模型** | 树形 ZNode | 扁平 KV（支持范围查询） |
| **Watch 机制** | 一次性 Watcher | 持久 Watch，自动续订，可按前缀订阅 |
| **成员变更** | 静态配置，需重启 | 支持动态成员变更 |
| **存储引擎** | 内存 + 事务日志 + 快照 | boltdb（B+树，持久化优化）|
| **API 协议** | 自定义 Jute 序列化+TCP | gRPC（HTTP/2，跨语言友好）|
| **Kubernetes 使用** | ❌ 早期尝试后放弃 | ✅ K8s 官方状态存储 |
| **适用场景** | Java 生态/Hadoop 系列 | 云原生/K8s/Go 生态 |

### 5.3 为什么 ZooKeeper 不适合做服务注册中心？（高频题）

```
ZooKeeper 是 CP 系统：
  网络分区发生时，为了保证一致性，节点少于半数的分区会拒绝写入
  → 服务注册/注销操作失败
  → 已有的 Watcher 可能无法触发
  → 微服务场景不可接受：服务注册本身就是高频操作

Nacos/Eureka 是 AP 系统：
  网络分区时，仍然返回旧数据（可能不准确但服务可用）
  → 保证可用性：服务仍然可以被发现

CAP 取舍原则：
  ✅ 注册中心 → 优先 AP（宁可拿到旧地址，也不要注册失败）
  ✅ 配置中心 → 优先 CP（配置错了比暂时访问不到更危险）
```

### 5.4 面试标准答法

> ZooKeeper 是 CP 系统，在注册中心场景中存在先天缺陷：网络分区时拒绝写操作导致服务无法注册；依赖 sessionTimeout 感知宕机节点，最慢需要 30s+；Watcher 是一次性的，需要客户端重复注册。Nacos 是目前国内主流选择，服务发现走 AP、配置中心走 CP，主动探活秒级感知，长轮询推送更稳定。etcd 则是云原生领域的首选，K8s 使用 etcd 存储全部集群状态。

### 5.5 常见追问

**Q: ZooKeeper 是 CP 还是 AP？**
> ZooKeeper 是 CP 系统。读写都路由到 Leader，保证强一致性，但写操作需要过半节点确认，网络分区时少数派会拒绝写入。Observer 节点可以分担读压力，但不参与投票，不影响 CP 定性。Follower 读可能读到旧数据，严格来说是**顺序一致性**，不是线性一致性。

**Q: Nacos 的 AP 和 CP 是怎么切换的？**
> Nacos 服务发现支持两种实例类型：**临时实例**（默认）走 AP 模式，用 Distro 协议（类 Gossip），宕机自动摘除；**持久实例**走 CP 模式，基于 Raft 协议，宕机标记为不健康但不删除节点。配置中心始终走 Raft CP 模式。可以在注册实例时通过 `ephemeral=true/false` 指定。

---

## 六、集群配置与运维 ⭐⭐

### 6.1 zoo.cfg 核心参数

```properties
# ===== 基本时间单位 =====
tickTime=2000          # 心跳基本单位（毫秒），Follower 与 Leader 心跳间隔 = tickTime

# ===== 集群初始化与同步超时 =====
initLimit=10           # Follower 初次连接 Leader 最大等待 = 10 × tickTime = 20s
                       # 数据差距大时 SNAP 全量同步耗时，建议配 10~20
syncLimit=5            # 正常运行中 Follower 与 Leader 心跳同步超时 = 5 × tickTime = 10s
                       # 超时未响应的 Follower 被 Leader 移除活跃列表，建议配 5

# ===== 存储目录（建议分开，避免 IO 竞争）=====
dataDir=/opt/zookeeper/data         # 内存树快照（Snapshot）存储目录
dataLogDir=/opt/zookeeper/txlog     # 事务日志存储目录（建议放独立磁盘）

clientPort=2181

# ===== 集群节点配置 =====
# 格式：server.N=hostname:数据同步端口:选举投票端口[:observer]
server.1=zk-node1:2888:3888
server.2=zk-node2:2888:3888
server.3=zk-node3:2888:3888
# 2888：Follower ↔ Leader 数据同步端口
# 3888：选举投票端口（节点间互联，须保证防火墙放通）

# ===== 日志与快照自动清理 =====
autopurge.snapRetainCount=3         # 保留最近 3 个快照，其余删除
autopurge.purgeInterval=24          # 每 24 小时自动清理（0 = 禁用）

# ===== 防滥连接 =====
maxClientCnxns=60                   # 同一 IP 最大连接数

# ===== 四字命令白名单（3.4 起需显式配置）=====
4lw.commands.whitelist=stat,ruok,conf,isro,mntr,srvr,dump,cons
```

**myid 文件：** 每台 Server 的 `dataDir` 下必须有 `myid` 文件，内容为该节点编号：

```bash
echo 1 > /opt/zookeeper/data/myid   # zk-node1
echo 2 > /opt/zookeeper/data/myid   # zk-node2
echo 3 > /opt/zookeeper/data/myid   # zk-node3
```

> `myid` 的值必须与 `zoo.cfg` 中 `server.N` 的 N 严格对应，ZooKeeper 启动时读取它确认自己的身份参与选举。

### 6.2 集群读写路由与强一致读

```
写请求路由：
  Client → 任意节点（Follower / Observer）
  Follower 收到写请求 → 自动转发给 Leader
  Leader → ZAB 消息广播 → 过半确认 → COMMIT → 返回客户端成功

默认读请求路由：
  由接收请求的节点（Follower / Observer）本地处理
  优点：无需经过 Leader，分散读压力，高吞吐
  缺点：Follower 可能落后若干事务 → 读到旧数据（顺序一致性，非线性一致性）

强一致读（sync + getData）：
  zk.sync("/path");                              // 通知 Follower 先与 Leader 同步到当前 ZXID
  byte[] data = zk.getData("/path", false, stat); // 再读，保证读到最新数据
  代价：一次额外 Follower→Leader RPC 往返，增加延迟
  适用：秒级强一致读场景，如配置热更新、Master 选举结果确认
```

| 请求类型 | 处理节点 | 一致性级别 |
|----------|----------|-----------|
| 写请求 | Leader（Follower 自动转发）| 线性一致 |
| 读请求（默认）| 接收节点本地 | 顺序一致（可能读旧）|
| 读请求（sync() 后）| 接收节点（同步后）| 线性一致 |
| Observer 读 | Observer 本地 | 顺序一致（同 Follower）|

### 6.3 四字命令（4lw）监控

通过 `echo cmd | nc <host> 2181` 获取节点状态（生产必备）：

```bash
echo ruok | nc zk-host 2181   # 健康检查，返回 imok 表示服务存活
echo stat | nc zk-host 2181   # 节点状态：Mode(leader/follower/observer)、连接数、延迟统计
echo srvr | nc zk-host 2181   # 服务端简要信息（比 stat 轻量，无连接列表）
echo mntr | nc zk-host 2181   # 详细监控指标（核心运维命令，见下）
echo conf | nc zk-host 2181   # 当前生效的配置参数
echo cons | nc zk-host 2181   # 当前所有客户端连接会话信息
echo dump | nc zk-host 2181   # 未过期 Session + 临时节点列表（仅 Leader 有效）
echo wchs | nc zk-host 2181   # Watcher 统计汇总（总数 + 路径分布）
echo envi | nc zk-host 2181   # JVM 和操作系统环境变量
```

**`mntr` 关键指标说明：**

```
zk_avg_latency               → 平均处理延迟（ms），正常应 < 10ms
zk_max_latency               → 最大延迟峰值
zk_outstanding_requests      → 排队等待处理的请求数，持续 > 10 说明节点过载
zk_znode_count               → ZNode 总数，不建议超过 100 万
zk_watch_count               → 当前 Watcher 总数
zk_open_file_descriptor_count → 已打开文件描述符，接近 ulimit 上限需告警
zk_followers                 → Follower 节点数（仅 Leader 节点上有值）
zk_synced_followers          → 已完成数据同步的 Follower 数，应等于 zk_followers
```

### 6.4 动态扩缩容（3.5.0+）

ZooKeeper 3.5 之前，增减节点需修改所有节点 `zoo.cfg` 并滚动重启（有短暂选举窗口）。3.5+ 支持**动态配置（Reconfiguration）**：

```bash
# 查看当前集群成员
echo config | nc zk-host 2181

# 在线添加节点（通过 zkCli.sh 执行）
reconfig -add "server.4=zk-node4:2888:3888;2181"

# 在线删除节点
reconfig -remove 4

# zoo.cfg 需启用动态配置：
# reconfigEnabled=true
# dynamicConfigFile=/opt/zookeeper/conf/zoo.cfg.dynamic
```

```
扩容注意事项：
  ① 新节点先以 Observer 身份加入，完成数据同步后自动转为 Voting Member
  ② 变更生效时会发起一轮新的 Leader 选举（通常 < 1s，短暂不可用）
  ③ 缩容需保证剩余节点仍满足 Quorum（至少 n/2+1 台存活）
  ④ 建议一次只增/减一个节点，在业务低峰期操作，应用层做好重试
```

### 6.5 集群常见故障排查

| 故障现象 | 排查步骤 |
|----------|----------|
| 客户端连接超时 | `echo ruok \| nc host 2181` 验证存活；检查防火墙 2181/2888/3888 端口 |
| 长期无 Leader，集群不可用 | 检查各节点 `myid` 是否唯一；排查 3888 端口互通；查 `zookeeper.log` 中 epoch/ZXID |
| Follower 长时间 SYNC 不上 | 差距过大触发 SNAP 全量同步，`mntr` 确认 `zk_synced_followers` 是否追上 |
| 磁盘写满 | 配置 `autopurge`；手动执行 `zkCleanup.sh` 或 `PurgeTxnLog` 工具清理快照+事务日志 |
| 写请求延迟飙高 | `mntr` 查 `zk_outstanding_requests`；检查网络抖动；集群超 7 节点广播开销大 |
| 客户端频繁 Session 超时 | 检查 `sessionTimeout`（建议 ≥ 10s）；排查应用侧 Full GC 停顿导致心跳无法发送 |

### 6.6 面试标准答法

> ZooKeeper 集群通过 `zoo.cfg` 的 `server.N` 定义成员，每台机器靠 `dataDir/myid` 确认身份。写请求统一经 Leader 走 ZAB 广播（线性一致），读请求默认由本地节点处理（顺序一致，可能读旧），需要强一致读时调用 `sync()` 再 `getData`。运维上用四字命令 `mntr` 监控延迟和 `synced_followers` 状态；3.5 起支持 `reconfig` 动态成员变更，变更触发一轮选举，一次操作一个节点最安全。

### 6.7 常见追问

**Q: `zoo.cfg` 中 `syncLimit` 和 `initLimit` 有什么区别？**
> `initLimit` 是 Follower **初次连接 Leader** 时（含全量 SNAP 同步阶段）的最大等待时间（单位 tick），数据差距大时同步慢，需设大些（建议 10~20）。`syncLimit` 是**正常运行中** Follower 发送心跳和追赶增量事务的超时，超过则被 Leader 移除活跃列表（建议 5）。

**Q: 如何快速判断集群中哪个节点是 Leader？**
> 最快方式：`echo stat | nc <host> 2181`，输出中 `Mode: leader` 即为 Leader。遍历所有节点逐一查询即可定位。四字命令 `dump` 也只有 Leader 才能返回完整的 Session + 临时节点列表。

**Q: ZooKeeper 集群能否跨数据中心部署？**
> 可以但需谨慎。ZAB 写操作需过半节点 ACK，跨机房高延迟（50ms+）直接拖慢写性能。常见方案是同机房部署 Follower 保证多数派，跨机房节点配成 **Observer**（不参与投票，仅分担本机房读请求），这样写性能不受跨机房延迟影响。

---

## 七、面试高频追问汇总

**Q: ZooKeeper 集群节点数为什么推荐奇数？**
> 容错公式：允许宕机节点数 = (n-1)/2。5节点允许2台宕机，6节点也只允许2台（需要4台存活），多1台节点没有提升容错，反而增加消息广播开销。奇数节点最优。

**Q: ZooKeeper 如何保证顺序一致性？**
> 通过 ZXID（全局单调递增事务 ID）保证。所有写操作由 Leader 分配 ZXID，按 ZXID 顺序执行和广播，Follower 用 FIFO 队列处理，保证所有节点看到相同的事务顺序。客户端读请求也保证单调读（不会读到比上次更旧的数据），可调用 `sync()` 强制同步到 Leader 最新状态。

**Q: ZooKeeper 集群脑裂了怎么办？**
> ZAB 的 Quorum 机制天然防止脑裂：每个分区独自无法获得超过半数投票，所以同一时刻只会有一个分区能当选 Leader。小的分区（节点数 ≤ n/2）会进入 LOOKING 状态，无法对外服务，这正是 CP 系统的取舍。

**Q: ZooKeeper 的 Leader 收到写请求但宕机了会怎样？**
> 分情况：① 宕机时 Proposal 已发出但未收到过半 ACK → 未达到提交条件，新 Leader 选出后通过 TRUNC 让持有该 Proposal 的 Follower 回滚，该事务丢弃；② 宕机时已收到过半 ACK，COMMIT 消息尚未发出 → 新 Leader 的数据中包含该事务（因为过半节点有这条记录），DIFF 同步时会把它作为已提交事务同步给所有 Follower。
