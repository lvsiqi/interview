# 消息队列知识点

> 最后更新：2026年3月6日

---

## 一、为什么用MQ（解耦、削峰、异步）⭐⭐⭐

| 作用 | 场景 | 效果 |
|------|------|------|
| **解耦** | 订单服务通过MQ通知库存/积分/通知服务 | 上下游服务变更互不影响 |
| **削峰** | 秒杀流量写入MQ，消费者按DB处理能力匀速消费 | 保护DB不被击垮 |
| **异步** | 非核心逻辑（积分、通知）异步处理 | 降低主链路耗时 |

---

## 二、消息可靠性（生产者确认、消费者ACK）⭐⭐⭐⭐

**消息丢失的三个环节：**
```
生产者 → Broker → 消费者
  丢失①    丢失②    丢失③
```

**① 生产者到Broker：** 同步发送 + ACK确认 + 失败重试
- Kafka: `acks=all`，所有副本写入才确认
- RocketMQ: 同步刷盘（`SYNC_FLUSH`）

**② Broker持久化：** 副本备份 + 刷盘策略

**③ 消费者消费：** 手动提交offset，业务处理成功后才提交
```
❌ 自动ACK：拉到消息自动提交offset → 业务失败 → 消息丢失
✅ 手动ACK：业务处理成功 → 手动提交offset → 失败重新消费
```

---

## 三、消息幂等性处理 ⭐⭐⭐⭐

**重复消费原因：** 消费者处理完提交offset前宕机，重启后重新拉取同一消息

| 方案 | 原理 |
|------|------|
| **Redis SET NX** | `SET msg:id NX EX 86400`，成功才处理 |
| **唯一消息ID + 去重表** | 消费前查DB，消费后插入（唯一索引） |
| **业务唯一键** | 数据库唯一索引兜底 |

```java
// 推荐：Redis去重 + 唯一索引双重保障
public void consume(Message msg) {
    Boolean isFirst = redis.setIfAbsent("msg:" + msg.getMsgId(), "1", 24, TimeUnit.HOURS);
    if (!Boolean.TRUE.equals(isFirst)) return;  // 已消费
    try {
        bizService.process(msg);
    } catch (Exception e) {
        redis.delete("msg:" + msg.getMsgId());  // 失败删除标记，允许重试
        throw e;
    }
}
```

---

## 四、消息顺序消费 ⭐⭐

**局部有序（生产常用）：** 同一业务实体消息有序

```java
// Kafka：相同key路由到同一分区，分区内有序，消费者单线程消费
producer.send(new ProducerRecord<>(topic, orderId, message));

// RocketMQ：MessageQueueSelector路由到同一Queue，MessageListenerOrderly消费
producer.send(msg, (mqs, m, arg) ->
    mqs.get(Math.abs(orderId.hashCode()) % mqs.size()), orderId);
```

> ⚠️ 顺序消费依赖单分区/单线程，并发度低，消费者宕机会导致该分区积压，谨慎使用

---

## 五、消息积压处理 ⭐⭐⭐

| 方案 | 说明 |
|------|------|
| **扩容消费者** | 增加实例数（不超过分区数），最常用 |
| **提高并发度** | 消费者内部线程池并行处理 |
| **紧急转移** | 积压消息转发到临时Topic（10倍分区），扩消费者快速消化 |

```
紧急处理流程：
新建临时Topic（10分区）→ 消费原Topic仅做转发 → 启动10个消费者消费临时Topic → 积压消化后恢复正常
```

---

## 六、Kafka架构原理 ⭐⭐⭐⭐

### 6.1 整体架构

**核心组件：**

| 组件 | 作用 |
|------|------|
| **Producer** | 生产者，向Topic发送消息 |
| **Broker** | Kafka服务节点，负责存储和转发 |
| **Topic** | 消息的逻辑分类 |
| **Partition** | Topic的物理分片，实现并行读写，内部消息有唯一递增offset |
| **Consumer** | 消费者，从Partition拉取消息（Pull模式）|
| **ConsumerGroup** | 组内每个Partition只被一个Consumer消费 |
| **ZK/KRaft** | 集群元数据管理、Controller选举（Kafka 3.x用KRaft替代ZK）|

```
Topic: order-events（3分区，2副本）
Broker0: Partition0-Leader  Partition1-Follower
Broker1: Partition1-Leader  Partition2-Follower
Broker2: Partition2-Leader  Partition0-Follower
```

---

### 6.2 副本机制 & ISR

**ISR（In-Sync Replicas）：** 与Leader保持同步的副本集合
- Follower落后超过`replica.lag.time.max.ms`则被踢出ISR
- Leader宕机时**只从ISR中选举**新Leader，保证数据不丢失

**acks参数：**

| acks | 含义 | 安全性 |
|------|------|--------|
| `0` | 不等待确认 | 最低 |
| `1` | Leader写入即确认 | 中 |
| `all`/`-1` | ISR全部写入才确认 | **最高** |

> 配合 `min.insync.replicas=2`：要求ISR至少2个副本，否则拒绝写入

---

### 6.3 生产者发送流程 ⭐⭐⭐

**完整链路（7个步骤）：**

```
① 用户调用 send(record) 
   → ② ProducerInterceptor 拦截器链（enrichment/监控）
   → ③ Serializer 序列化 key/value（ByteArray）
   → ④ Partitioner 路由分区
        - 指定 partition → 直接使用
        - 指定 key       → murmur2(key) % numPartitions（同key消息有序）
        - 未指定         → Sticky策略（Kafka 2.4+，优先填满当前Batch减少小包）
   → ⑤ RecordAccumulator 内存缓冲区（默认32MB）
        - 按 TopicPartition 分桶，每桶维护 Deque<ProducerBatch>
        - 消息追加到最新Batch；缓冲区满时 send() 阻塞 max.block.ms 后报错
   → ⑥ Sender线程（独立守护线程）轮询就绪Partition
        - batch.size（默认16KB）触发：Batch写满即触发
        - linger.ms（默认0ms）触发：超时即发（增大有助于提升吞吐）
        - 通过 NetworkClient 向 Leader 发送 ProduceRequest
   → ⑦ Broker Leader 写入 → ISR同步 → ACK返回 → 触发回调
```

**三种发送模式：**

```java
// ① Fire-and-forget：不关心结果，可能丢消息
producer.send(record);

// ② 异步回调（推荐）：不阻塞，失败通过回调处理
producer.send(record, (metadata, exception) -> {
    if (exception != null) log.error("发送失败", exception);
    else log.info("offset={}", metadata.offset());
});

// ③ 同步等待：get()阻塞直到收到ACK，吞吐较低
RecordMetadata meta = producer.send(record).get();
```

**关键参数对照：**

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `buffer.memory` | 32MB | RecordAccumulator 总内存 |
| `batch.size` | 16KB | 单个 Batch 大小，满了立即发 |
| `linger.ms` | 0 | 等待凑批时间，调大可提升吞吐 |
| `max.block.ms` | 60s | 缓冲区满时 send() 阻塞上限 |
| `retries` | MAX_INT | 重试次数（结合幂等使用） |
| `max.in.flight.requests.per.connection` | 5 | 飞行中未ACK请求数 |

> ⚠️ **乱序风险**：`max.in.flight > 1` 时，Batch1失败重试 + Batch2已成功 → 消息乱序。
> 解决：开启 `enable.idempotence=true`，Producer自动设置最优参数并通过SeqNum保证顺序。

---

### 6.4 消费者拉取流程 ⭐⭐

**完整链路：**

```
① Consumer调用 poll(timeout)
   → ② ConsumerCoordinator 维护心跳（独立线程），检测是否需要Rebalance
   → ③ Fetcher 向各 Partition Leader 发送 fetch 请求
        - fetch.min.bytes（默认1B）：响应数据量达到阈值才返回（减少空轮询）
        - fetch.max.wait.ms（默认500ms）：数据不足时最长等待时间（long polling）
        - max.poll.records（默认500）：单次 poll 最多返回条数
   → ④ 返回 ConsumerRecord 批次，业务逻辑处理
   → ⑤ 提交 offset 到 __consumer_offsets（内置Topic，Kafka自管理）
        - 自动提交：enable.auto.commit=true，每 auto.commit.interval.ms 提交一次（可能重复/丢失）
        - 同步手动：consumer.commitSync()，确保提交成功，阻塞
        - 异步手动：consumer.commitAsync()，性能好，失败需回调重试
```

**Offset提交策略对比：**

| 策略 | 优点 | 风险 |
|------|------|------|
| 自动提交 | 简单 | 拉到消息即提交，处理失败消息丢失 |
| 同步手动提交 | 可靠 | 阻塞，吞吐低 |
| 异步手动提交 | 性能好 | 失败不自动重试，需回调处理 |
| 同步+异步混用（推荐） | 兼顾性能与可靠性 | 正常用异步，finally用同步兜底 |

```java
// 推荐：正常异步提交，关闭前同步兜底
try {
    while (running) {
        ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));
        process(records);
        consumer.commitAsync();          // 正常路径：异步，性能好
    }
} finally {
    consumer.commitSync();               // 退出前确保最后一批offset已提交
    consumer.close();
}
```

---

### 6.5 面试标准答法

> Kafka由Producer、Broker集群、Consumer三部分组成。消息按Topic分类，每个Topic分多个Partition实现并行读写，每个Partition有一个Leader和若干Follower副本，读写都在Leader。副本通过ISR机制保证安全，Leader宕机时只从ISR选举新Leader。acks=all表示等ISR全部写入才确认，最安全，配合min.insync.replicas=2强制保证。消费者Pull模式，手动提交offset到__consumer_offsets。

---

### 6.6 常见追问

**Q: Kafka为什么用Pull模式？**
> Push模式难控制推送速率，消费者处理不过来会被压垮。Pull模式消费者自主控制节奏，可批量拉取。缺点是空轮询，用long polling（无消息时等500ms）解决。

**Q: ISR只有Leader一个副本时acks=all还安全吗？**
> 不安全，等同于acks=1。配置`min.insync.replicas=2`强制要求ISR至少2个副本，否则Producer报错拒绝写入。

---

### 6.7 Kafka集群 & Controller机制 ⭐⭐⭐

#### Controller是什么？

集群中有且仅有一个Broker担任Controller（控制器），负责：

| 职责 | 说明 |
|------|------|
| Partition Leader选举 | Leader宕机时从ISR选出新Leader并通知集群 |
| 副本增减管理 | Broker上下线时重新分配副本 |
| 集群元数据维护 | Partition/Replica状态机，定期同步给所有Broker |
| Topic管理 | 创建/删除Topic时分配分区 |

#### Controller选举（ZooKeeper模式 vs KRaft模式）

**ZooKeeper模式（传统，Kafka 3.x前主流）：**

```
所有Broker启动时在ZK的 /controller 节点抢注册（临时节点）
→ 抢到的Broker成为Controller（先到先得）
→ 其余Broker Watch /controller，Controller宕机时临时节点消失
→ 剩余Broker重新抢注册
```

**KRaft模式（Kafka 2.8+ 引入，3.0+ 生产可用，去除ZK依赖）：**

```
独立的 Controller Quorum（默认3个节点，基于Raft协议选举）
→ Active Controller 处理元数据请求并通过Raft日志同步给其他Controller
→ 元数据存储在内部Topic __cluster_metadata，不依赖ZK
```

| 对比项 | ZooKeeper模式 | KRaft模式 |
|--------|--------------|-----------|
| 依赖 | 需要独立ZK集群 | 无外部依赖 |
| 元数据同步 | Controller → 逐个Broker推送 | Raft日志复制，更快 |
| 重启恢复 | 重新从ZK加载全量元数据 | 直接读本地日志，秒级恢复 |
| 扩展性 | Controller单点，百万分区受限 | Quorum分担，支持百万级分区 |

#### Broker上下线流程

```
Broker上线：
  注册到ZK(/brokers/ids) → Controller感知 → 将该Broker上的副本加入ISR → 通知所有Broker更新元数据

Broker下线（宕机）：
  ZK临时节点消失 → Controller感知 → 
  ① 遍历该Broker上所有的Partition Leader → 从各自ISR中选新Leader
  ② 更新元数据 → 广播LeaderAndIsr请求给相关Broker
  ③ 通知所有Producer/Consumer刷新元数据（client自动重连新Leader）
```

> **面试答法**：Controller是Kafka集群的大脑，负责Leader选举和元数据管理。传统ZK模式下通过ZK临时节点抢占成为Controller；KRaft模式基于Raft协议，去除ZK依赖，元数据同步更快、支持更大规模集群。Broker宕机时Controller从ISR中选出新Leader并广播元数据更新，整个过程通常在秒级完成。

---

## 七、Kafka分区机制 & 副本机制 ⭐⭐⭐

### 7.1 分区机制

**Producer分区策略：**

```
1. 指定key   → hash(key) % partitionNum  → 同key消息有序
2. 未指定key → Sticky分区（同batch发同一分区，Kafka2.4+）
3. 自定义     → 实现Partitioner接口
```

> Consumer有效扩容上限 = Partition数量（同一ConsumerGroup内一个Partition只被一个Consumer消费）

---

### 7.2 副本机制 & ISR/HW/LEO

```
AR = ISR + OSR
ISR = 与Leader同步的副本集合（落后超过replica.lag.time.max.ms → 移到OSR）

LEO = 副本下一条写入消息的offset
HW  = ISR中所有副本LEO的最小值（Consumer只能消费HW以下的消息）
```

**HW作用：** 防止Consumer读到未完全同步的数据，保证消费一致性

---

### 7.3 Leader选举

```
Controller 从 ISR 列表选第一个副本为新Leader → 更新元数据 → 通知集群
```

**Preferred Leader：** AR中第一个副本，`auto.leader.rebalance.enable=true` 定期迁回，避免热点

---

### 7.4 面试标准答法

> Kafka每个Topic分多个Partition，相同key的消息hash到同一分区保证顺序。每个Partition有一个Leader负责读写，Follower只同步数据。ISR是与Leader保持同步的副本集合，落后超时移入OSR。Consumer只能消费到HW（ISR中所有副本LEO的最小值）以下的消息，防止读到未完全同步的数据。

---

## 八、Kafka高性能原因 ⭐⭐⭐⭐

### 8.1 顺序写磁盘

```
每个Partition对应一组.log文件，消息只追加写（Append-Only）
→ 完全顺序写，避免随机IO
顺序写速度 ≈ 600MB/s（接近内存），随机写仅 ≈ 100~200次/s IOPS
```

---

### 8.2 PageCache（OS页缓存）

```
写入：Producer → Kafka → PageCache（内存）→ OS异步刷盘
读取：Consumer → 先读PageCache → 命中直接返回（不走磁盘）

优点：写入延迟低、热数据走内存、Kafka重启不影响PageCache
风险：未刷盘时宕机丢数据 → 通过多副本ISR弥补
```

**⚠️ 丢数据原理及副本如何弥补：**

```
单机断电场景（acks=all）：
  Broker0(Leader) 断电 → 其PageCache丢失
  但 Broker1/Broker2(Follower ISR) 各自PageCache仍在且独立刷盘
  → Controller 从ISR选Broker1为新Leader → 数据完整，无感知

全机房断电场景：
  所有Broker同时宕机 → 所有PageCache全部丢失 → 可能丢数据
  最多丢 OS 刷盘间隔内的消息（默认约5秒）
```

**关键配置：**

| 配置 | 说明 |
|------|------|
| `acks=all` | 等ISR全部写入才确认，保证消息已在多个Broker的PageCache中 |
| `min.insync.replicas=2` | 强制ISR至少2个副本，防止只剩Leader一个人 |
| 跨机房部署 | 彻底规避全机房断电风险 |

---

### 8.3 零拷贝（Zero Copy）⭐⭐⭐

```
传统IO（4次拷贝）：磁盘→内核缓冲区→用户空间→Socket缓冲区→网卡
zero copy（2次拷贝）：磁盘→内核缓冲区→网卡（sendfile系统调用）

CPU全程不参与数据搬运，减少2次拷贝 + 2次上下文切换
Java实现：FileChannel.transferTo() → 底层调用sendfile
```

---

### 8.4 批量处理 & 消息压缩

```
Producer攒批：batch.size=16KB 或 linger.ms=5ms 触发批量发送
Consumer批量拉取：一次fetch多条（max.poll.records）
压缩：对整个Batch压缩（lz4/zstd速度快，gzip压缩率高）
→ 减少网络请求次数 + 降低带宽占用
```

---

### 8.5 面试标准答法

> Kafka高性能来自：①顺序写磁盘（Append-Only，避免随机IO）；②PageCache（写内存异步刷盘，读优先命中缓存）；③零拷贝（sendfile，数据不经用户空间，减少2次拷贝和上下文切换）；④批量处理（Producer攒批发送，Consumer批量拉取）；⑤消息压缩（批次级别，降低带宽）。

---

## 九、消费者组 & Rebalance ⭐⭐⭐⭐

### 9.1 ConsumerGroup核心机制

```
同一ConsumerGroup内：
  - 每个 Partition 只被一个 Consumer 消费（独占）
  - Consumer数 > Partition数 → 多余Consumer空闲

不同ConsumerGroup之间：
  - 独立消费同一Topic，互不影响（广播效果）
```

> **Consumer有效扩容上限 = Partition数量**，提前规划Partition数是关键（建议Topic创建时多设，后续只能增不能减）

---

### 9.2 Rebalance触发条件

| 触发原因 | 说明 |
|----------|------|
| Consumer加入 | 新实例启动，加入ConsumerGroup |
| Consumer离开 | 宕机/主动关闭/长时间未poll |
| Partition数变化 | Topic增加Partition |
| Consumer订阅变化 | 动态修改订阅的Topic |

---

### 9.3 Rebalance流程（JoinGroup + SyncGroup）

**两个关键角色：**
- **GroupCoordinator**：Broker端，管理CG成员变化（`__consumer_offsets` 分区所在Broker）
- **ConsumerCoordinator**：Consumer端，处理Rebalance协议

```
① JoinGroup阶段：
   所有Consumer向GroupCoordinator发送JoinGroup请求
   → Coordinator选出一个Consumer作为 CG Leader（通常是第一个）
   → 返回成员列表给 CG Leader，其余Consumer等待

② SyncGroup阶段：
   CG Leader 根据分配策略计算每个Consumer应分配哪些Partition
   → 将分配方案通过SyncGroup请求发给Coordinator
   → Coordinator将各自的分配下发给所有Consumer

③ 稳定消费阶段：
   每个Consumer按分配方案消费，定时发心跳维持会话
```

---

### 9.4 分配策略（partition.assignment.strategy）

| 策略 | 规则 | 特点 |
|------|------|------|
| **Range（默认）** | 按分区范围顺序分，排头的Consumer多分一个 | 多Topic时头部Consumer压力大 |
| **RoundRobin** | 所有Partition轮询分配 | 分配均匀，但Rebalance后迁移量大 |
| **Sticky（推荐）** | 先尽量保留现有分配，再均衡剩余 | 迁移量最小，减少Rebalance影响 |
| **CooperativeSticky** | Sticky + 增量Rebalance（Kafka 2.4+） | 只迁移变化的Partition，消费不中断 |

---

### 9.5 Rebalance的危害 & 优化

**危害：**
```
Rebalance期间所有Consumer停止消费（Stop The World）
大规模CG（百个Consumer）Rebalance耗时数十秒，造成严重积压
```

**减少不必要Rebalance的方法：**

| 配置 | 推荐值 | 说明 |
|------|--------|------|
| `session.timeout.ms` | 45000ms | Consumer会话超时，调大避免GC/网络抖动误判宕机 |
| `heartbeat.interval.ms` | 15000ms | 心跳间隔，设为session.timeout的1/3 |
| `max.poll.interval.ms` | 按业务调整 | 两次poll最大间隔，处理慢会被踢出 |
| `group.instance.id` | 唯一静态ID | **静态成员**（Kafka 2.4+），Consumer重启不触发Rebalance直接继承分配 |

```java
// 静态成员配置（Consumer重启后保留分配，group.instance.id唯一即可）
props.put("group.instance.id", "consumer-host-1");
// 重启后在 session.timeout.ms 内重连，Coordinator认为是同一成员，不触发Rebalance
```

---

### 9.6 面试标准答法

> ConsumerGroup内每个Partition只被一个Consumer消费，有效扩容上限等于Partition数量。Rebalance由JoinGroup和SyncGroup两阶段完成：CG Leader负责制定分配方案，Coordinator下发，期间所有Consumer停止消费（STW）。推荐Sticky或CooperativeSticky策略减少迁移；生产环境还应合理设置心跳超时、使用静态成员（group.instance.id）避免重启触发Rebalance。

---

## 十、Exactly Once 语义 ⭐⭐⭐⭐

### 10.1 三种消息语义

| 语义 | 配置 | 特点 |
|------|------|------|
| **At Most Once** | acks=0，先提交offset再处理 | 可能丢消息，不重复 |
| **At Least Once** | acks=all，先处理再提交offset | 不丢消息，可能重复 |
| **Exactly Once** | 幂等Producer + 事务 | 不丢不重 |

---

### 10.2 幂等Producer（Idempotent Producer）

**原理：** 为每个Producer分配全局唯一PID，每条消息携带 `<PID, Partition, SeqNum>` 三元组，Broker检测到SeqNum重复时直接丢弃。

```
开启方式：enable.idempotence=true
自动联动：acks=all, retries=MAX_INT, max.in.flight=5（保证顺序+幂等）
```

**局限性：**
- 仅保证**单分区、单会话（单次进程生命周期）**内的幂等
- Producer重启后PID变化，换分区后SeqNum重新计数 → 跨会话不保证

---

### 10.3 事务Producer（Transactional Producer）

**解决的问题：** 跨分区原子写 + 跨会话幂等（Producer重启恢复后继续已有事务）

**关键机制：**
```
transactional.id → 全局唯一，标识Producer身份
TransactionCoordinator → Broker端，管理事务状态机（持久化到内部Topic）
Epoch机制 → 防止僵尸Producer（旧实例重启后epoch低于新实例，写入被拒绝）
```

```java
// 事务Producer完整用法
props.put("transactional.id", "order-producer-1");   // 唯一ID
props.put("enable.idempotence", "true");              // 事务依赖幂等
producer.initTransactions();                          // 向TransactionCoordinator注册

try {
    producer.beginTransaction();
    producer.send(new ProducerRecord<>("order-topic", key, orderMsg));
    producer.send(new ProducerRecord<>("inventory-topic", key, inventoryMsg));
    producer.commitTransaction();    // 两条消息原子提交
} catch (Exception e) {
    producer.abortTransaction();     // 原子回滚，Consumer侧不可见
}
```

**Consumer端配合：**

```java
// isolation.level=read_committed：只消费已提交的事务消息（默认read_uncommitted）
props.put("isolation.level", "read_committed");
```

---

### 10.4 端到端 Exactly Once（流处理场景）

**普通Consumer场景（最常用）：**

```
消费 + 业务写DB + 提交offset 放入同一本地事务
→ 要么全成功，要么全回滚
→ 依赖DB事务，offset写入DB而非__consumer_offsets

适合：消费Kafka写MySQL等场景
不适合：消费后再生产到另一Kafka Topic（需要事务Producer）
```

**Kafka Streams（天然支持）：**

```
consume → process → produce 三步原子提交（内置事务Producer + read_committed）
只需配置 processing.guarantee=exactly_once_v2
```

---

### 10.5 面试标准答法

> Kafka Exactly Once分两层：①**幂等Producer**（enable.idempotence=true），通过`<PID,Partition,SeqNum>`去重，解决单分区单会话内的重复写入，但跨会话失效；②**事务Producer**（transactional.id），通过TransactionCoordinator管理事务状态机，支持跨分区原子写和跨会话幂等，配合Consumer端`isolation.level=read_committed`读到已提交消息，实现真正的Exactly Once。端到端场景推荐Kafka Streams，或在消费侧将offset与业务写入放同一DB事务。

---

### 10.6 常见追问

**Q: 事务Producer性能如何？**
> 每次begin/commit都涉及与TransactionCoordinator的网络交互，吞吐约降低20%~30%。大批量聚合后一次commit可以摊薄开销，不建议每条消息一个事务。

**Q: 幂等和事务区别一句话总结？**
> 幂等解决单分区内重试重复，事务解决跨分区原子性和跨会话幂等，两者都依赖SeqNum机制，事务是幂等的超集。

