# ZooKeeper 知识点

> 最后更新：2026年3月6日

---

## 📋 章节大纲

| 章节 | 内容 | 优先级 | 状态 |
|------|------|--------|------|
| 一 | 核心概念（节点类型 & Watcher） | ⭐⭐⭐ | ✅ |
| 二 | ZAB协议（选举 & 数据同步原理） | ⭐⭐⭐⭐ | ✅ |
| 三 | 分布式锁实现原理 | ⭐⭐⭐⭐ | ✅ |
| 四 | 应用场景（注册中心/配置中心/Leader选举） | ⭐⭐⭐ | ✅ |
| 五 | 与Nacos/Eureka对比 | ⭐⭐⭐ | ✅ |

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
```

### 1.2 节点类型（ZNode）

| 类型 | 特点 | 典型用途 |
|------|------|---------|
| **持久节点** | 客户端断开后节点依然存在 | 配置存储、服务目录 |
| **临时节点** | 客户端会话结束即删除 | 服务注册（感知宕机）|
| **持久顺序节点** | 持久 + 自动追加递增序号 | - |
| **临时顺序节点** | 临时 + 自动追加递增序号 | **分布式锁** |

---

### 1.3 Watcher 机制

```
客户端可以对任意节点注册 Watcher（监听器）

触发时机：
  节点创建 / 节点删除 / 节点数据变更 / 子节点变化

特点：
  一次性（One-time）：触发后自动取消，需要重新注册
  异步通知：ZooKeeper Server → 推送事件给客户端
```

**Watcher 实现服务发现流程：**
```
① 服务提供者启动 → 在 /services/order-service 下创建临时节点
② 消费者 → 监听 /services/order-service 子节点变化
③ 提供者宕机 → 临时节点自动删除 → 触发Watcher
④ 消费者收到通知 → 更新本地服务列表 → 重新注册Watcher
```

---

## 二、ZAB 协议（Zookeeper Atomic Broadcast）⭐⭐⭐⭐

ZAB 是 ZooKeeper 专门设计的原子广播协议，保证集群数据一致性。

### 2.1 两种模式

| 模式 | 触发时机 | 作用 |
|------|---------|------|
| **崩溃恢复模式** | 集群启动 / Leader宕机 | 重新选举Leader，同步数据 |
| **消息广播模式** | Leader正常工作时 | 处理客户端写请求，广播给所有Follower |

---

### 2.2 消息广播流程（类似2PC）

```
Client → Leader
  ↓
Leader → 生成事务Proposal（带全局唯一ZXID）
  ↓
Leader → 广播Proposal给所有Follower
  ↓
Follower → 写入本地事务日志 → 返回ACK
  ↓
Leader → 收到过半ACK（Quorum）→ 发送COMMIT
  ↓
Leader + Follower → 提交事务 → 返回客户端成功
```

> **ZXID（事务ID）：** 64位，高32位是epoch（Leader任期），低32位是事务序号，单调递增

---

### 2.3 Leader 选举流程

**触发时机：** 集群启动 / Leader宕机

```
每台Server的投票信息：(myid, ZXID)

选举规则（优先级从高到低）：
  1. ZXID 大的优先（数据最新）
  2. ZXID 相同时，myid 大的优先

流程：
  ① 每台Server先投票给自己 (myid, ZXID)
  ② 广播投票给其他Server
  ③ 收到对方投票后，PK规则比较，更新自己的投票
  ④ 某Server获得超过半数票 → 成为Leader
  ⑤ 其余Server变为Follower / Observer

示例（3节点集群）：
  Server1: (myid=1, ZXID=5)
  Server2: (myid=2, ZXID=8) ← ZXID最大，胜出
  Server3: (myid=3, ZXID=8) ← ZXID相同，myid=3>2
  → Server3 当选Leader
```

---

### 2.4 崩溃恢复保证

ZAB 崩溃恢复要保证两个原则：

```
① 已提交的事务必须被所有机器提交（不能丢）
   → 只选ZXID最大的Server为Leader，其数据最完整

② 只在Leader上Proposal未提交的事务必须丢弃（不能误提交）
   → 新Leader会让所有Follower同步自己的数据，清除多余的Proposal
```

---

## 三、分布式锁实现原理 ⭐⭐⭐⭐

### 3.1 实现方案

**利用临时顺序节点实现公平锁：**

```
争抢锁：
  ① 所有客户端在 /lock 下创建临时顺序节点
     /lock/0000000001 (Client A)
     /lock/0000000002 (Client B)
     /lock/0000000003 (Client C)

  ② 每个客户端获取 /lock 下所有子节点，判断自己的序号是否最小
     → 是最小（Client A）→ 获得锁，执行业务

  ③ 不是最小（Client B）→ 监听比自己小一位的节点（Client A的节点）
     → 等待前驱节点删除通知

释放锁：
  ④ Client A 业务执行完 → 删除自己的节点 → Client B监听到 → 获得锁
  ⑤ 如果 Client A 宕机 → 临时节点自动删除 → Client B 同样触发
```

**为什么监听前一个节点而不是监听 /lock 根节点？**

```
如果所有Client都监听/lock根节点：
  A释放锁 → 触发B/C/D全部Watcher → 产生"羊群效应"（Herd Effect）
  → 大量无效请求涌向ZooKeeper Server

监听前驱节点：
  A释放锁 → 只唤醒B一个Client → 无羊群效应
```

---

### 3.2 ZooKeeper 分布式锁 vs Redis 分布式锁

| 对比 | ZooKeeper | Redis（Redisson）|
|------|-----------|----------------|
| **实现原理** | 临时顺序节点 + Watcher | SET NX EX + 看门狗续期 |
| **锁释放保障** | 宕机后临时节点自动删除 | 宕机后等待过期时间 |
| **公平性** | 天然公平（顺序节点排队） | 非公平（竞争抢锁） |
| **性能** | 较低（需要ZK写操作） | 高（内存操作） |
| **依赖** | 需要ZooKeeper集群 | 需要Redis集群 |
| **适用场景** | 对公平性/可靠性要求高 | 高并发、性能优先 |

> **生产选择：** 高并发场景优先 Redis Redisson；对公平性要求高或已有ZK基础设施则用ZK

---

## 四、典型应用场景 ⭐⭐⭐

### 4.1 服务注册与发现

```
提供者启动 → 在ZK创建临时节点（/services/order/ip:port）
消费者启动 → 读取/services/order下所有子节点 → 获取服务列表
          → 监听/services/order子节点变化
提供者宕机 → 临时节点自动删除 → 消费者收到Watcher通知 → 更新列表
```

### 4.2 配置中心

```
配置数据存储在持久节点（/config/db.properties）
应用启动时读取配置 + 注册Watcher
管理员修改配置 → 触发Watcher → 应用自动热更新
```

### 4.3 Master选举

```
所有候选Master争抢创建同一个临时节点（/master）
成功创建者为Master，其余节点监听/master
Master宕机 → 临时节点删除 → 其余节点重新争抢 → 新Master诞生
```

---

## 五、与 Nacos / Eureka 对比 ⭐⭐⭐

| 对比 | ZooKeeper | Nacos | Eureka |
|------|-----------|-------|--------|
| **一致性模型** | CP（强一致） | AP（服务发现）/ CP（配置）| AP |
| **健康检查** | 临时节点心跳（会话超时） | 客户端心跳 + 主动探测 | 客户端心跳 |
| **服务下线感知** | 慢（会话超时默认30~40s）| 快（主动探测，秒级）| 慢（需等心跳超时）|
| **配置中心** | 支持（简单） | 支持（功能丰富）| ❌ 不支持 |
| **动态配置推送** | Watcher（一次性，需重注册）| 长轮询（稳定）| ❌ |
| **生态** | 通用协调服务 | Spring Cloud Alibaba | Spring Cloud Netflix |
| **推荐场景** | Hadoop/HBase等大数据生态 | 国内微服务主流选择 | 旧项目维护 |

**为什么 ZooKeeper 不适合做服务注册中心？（经典问题）**

```
ZooKeeper 是 CP 系统：网络分区时，为保证一致性会拒绝写请求
→ 服务注册/注销操作失败 → 微服务场景不可接受

Nacos/Eureka 是 AP 系统：网络分区时，仍然返回旧数据（可能不准确）
→ 保证可用性，服务仍然可以被发现
→ 对服务发现场景更合适（宁可拿到旧地址，也不要注册失败）

CAP取舍：注册中心优先AP，配置中心优先CP
```

---

## 六、面试高频追问

**Q: ZooKeeper是CP还是AP？**
> ZooKeeper是CP系统。读写都路由到Leader，保证强一致性，但网络分区时可能拒绝服务。观察者（Observer）节点可以分担读压力但不参与投票。

**Q: ZooKeeper集群节点数为什么推荐奇数？**
> 容错公式：允许宕机节点数 = (n-1)/2。5节点允许2台宕机，6节点也只允许2台（需要4台存活），多1台节点没有提升容错，反而增加选举通信开销。奇数节点最优。

**Q: ZooKeeper的Watcher是推还是拉？**
> 混合模式：ZooKeeper Server感知到节点变化后**推送**通知（事件类型）给客户端，但通知中不包含数据，客户端收到通知后需要主动**拉取**最新数据。这样设计减少了数据传输量，但引入了一次额外的读请求。

**Q: ZooKeeper如何保证顺序一致性？**
> 通过ZXID（全局单调递增事务ID）保证。所有写操作都由Leader分配ZXID，按ZXID顺序执行和广播，保证所有节点看到相同的事务顺序。Client的读请求可以指定`sync()`强制同步到最新Leader数据。
