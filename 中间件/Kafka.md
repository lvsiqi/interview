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

#### 一句话讲清 Kafka 事务

> Kafka 事务的本质就是：**消息先正常写进去，但打上"待定"标记；最后由 Coordinator 统一补一个 COMMIT 或 ABORT 标记，Consumer 根据这个标记决定读不读。**
>
> 具体来说：
> 1. Producer 配一个固定的 `transactional.id`，启动时找到 Broker 上的 **TransactionCoordinator**（相当于事务管理器），拿到身份证（PID + Epoch）
> 2. 发消息时消息**直接写入目标分区**，但因为没有 COMMIT 标记，`read_committed` 的 Consumer 看不到
> 3. 所有消息发完后调 `commitTransaction()`，Coordinator 先把"准备提交"写入自己的日志（`__transaction_state`），然后往每个参与分区**追加一条 COMMIT Marker**
> 4. Consumer 看到 COMMIT Marker 后，之前那批消息才变为可见；如果是 ABORT Marker，那批消息就被跳过
>
> **说白了就是一个两阶段提交：先写数据，再补标记。标记没到之前，下游看不见。**

#### 10.3.1 核心组件

| 组件 | 说明 |
|------|------|
| **transactional.id** | 生产者配置的全局唯一标识，跨会话不变，用于恢复/隔离事务 |
| **TransactionCoordinator** | Broker 端事务协调者，每个 transactional.id 通过 hash 映射到 `__transaction_state` 的某个分区，该分区 Leader 所在 Broker 即为其 Coordinator |
| **`__transaction_state`** | 内部 Topic（默认 50 分区），持久化事务状态日志，类似数据库的 redo log |
| **PID + Epoch** | Coordinator 为每个 transactional.id 分配 PID（Producer ID）和单调递增的 Epoch，防止僵尸实例 |
| **Transaction Marker** | COMMIT / ABORT 控制消息，写入目标分区，告知 Consumer 该事务最终状态 |

#### 10.3.2 完整事务流程（两阶段提交）

```
                    Producer                 TransactionCoordinator             目标Partition Broker
                       │                              │                               │
  ① initTransactions() │──FindCoordinator────────────→│                               │
                       │←─分配 PID+Epoch──────────────│                               │
                       │                              │                               │
  ② beginTransaction() │  （仅本地标记，无网络交互）      │                               │
                       │                              │                               │
  ③ send(topicA-p0)   │──AddPartitionsToTxn──────────→│ 记录：Ongoing                  │
                       │                              │ {txnId, topicA-p0}             │
                       │──Produce──────────────────────────────────────────────────────→│ 消息写入(附带PID+Epoch)
                       │                              │                               │
  ④ send(topicB-p1)   │──AddPartitionsToTxn──────────→│ 追加：{txnId, topicB-p1}       │
                       │──Produce──────────────────────────────────────────────────────→│
                       │                              │                               │
  ⑤ commitTransaction │──EndTxn(COMMIT)──────────────→│                               │
                       │                              │                               │
         ┌─────────── 阶段一：Coordinator 写入 PrepareCommit 到 __transaction_state ──────┐
         │             │                              │                               │
         │  阶段二：Coordinator 向所有参与分区发送 Transaction Marker（COMMIT 标记）        │
         │             │                              │──WriteTxnMarker(COMMIT)───────→│
         │             │                              │←─成功─────────────────────────│
         │             │                              │                               │
         │  所有Marker写入成功后，写入 CompleteCommit 到 __transaction_state                │
         └────────────────────────────────────────────────────────────────────────────┘
                       │←─事务完成──────────────────────│                               │
```

**各步骤详解：**

| 步骤 | 动作 | 说明 |
|------|------|------|
| ① `initTransactions()` | FindCoordinator + InitPID | 找到 Coordinator，获取 PID+Epoch；若已有未完成事务则先回滚 |
| ② `beginTransaction()` | 本地标记 | 纯客户端操作，无网络开销 |
| ③④ `send()` | AddPartitionsToTxn + Produce | 首次往新分区写消息时，先向 Coordinator 注册该分区；消息正常写入目标分区（此时 Consumer read_committed 不可见） |
| ⑤ `commitTransaction()` | EndTxn → PrepareCommit → WriteTxnMarker → CompleteCommit | 两阶段提交：先持久化 Prepare 状态，再向所有分区写 COMMIT Marker，最后标记完成 |

#### 10.3.2.1 事务提交 Offset（consume-transform-produce 核心）

在最典型的 **consume → 处理 → produce** 场景中，消费位移（offset）必须和生产消息在**同一个事务**里原子提交，否则会出现：
- offset 提交了但消息没发出去 → 消息丢失
- 消息发出去了但 offset 没提交 → 重复消费

**`sendOffsetsToTransaction` 原理：**

```
正常流程（无事务）：
  Consumer.commitSync() → offset 写入 __consumer_offsets（由 GroupCoordinator 管理）

事务流程：
  Producer.sendOffsetsToTransaction(offsets, consumerGroupId)
    → Producer 向 TransactionCoordinator 发送 AddOffsetsToTxn 请求
    → Coordinator 根据 consumerGroupId 计算出 __consumer_offsets 的目标分区
    → 将该分区也纳入当前事务的参与者列表
    → Producer 再向 GroupCoordinator 发送 TxnOffsetCommit 请求，写入 offset（带 PID+Epoch 标记）
    → 此时 offset 处于"待定"状态

  Producer.commitTransaction()
    → Coordinator 向 __consumer_offsets 的目标分区也写入 COMMIT Marker
    → offset 正式生效

  Producer.abortTransaction()
    → Coordinator 向 __consumer_offsets 写入 ABORT Marker
    → offset 被丢弃，Consumer 下次重新从旧 offset 消费
```

**关键点：offset 被当作一条特殊的"消息"，和业务消息一样参与两阶段提交，COMMIT 后才生效。**

**完整 consume-transform-produce 代码：**

```java
// 配置
Properties producerProps = new Properties();
producerProps.put("transactional.id", "ctp-processor-1");
KafkaProducer<String, String> producer = new KafkaProducer<>(producerProps);

Properties consumerProps = new Properties();
consumerProps.put("group.id", "ctp-group");
consumerProps.put("enable.auto.commit", "false");           // 必须关闭自动提交
consumerProps.put("isolation.level", "read_committed");     // 只读已提交
KafkaConsumer<String, String> consumer = new KafkaConsumer<>(consumerProps);

producer.initTransactions();
consumer.subscribe(Collections.singletonList("source-topic"));

while (true) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(200));
    if (records.isEmpty()) continue;

    producer.beginTransaction();
    try {
        // ① 处理 + 生产
        for (ConsumerRecord<String, String> record : records) {
            String result = transform(record.value());
            producer.send(new ProducerRecord<>("target-topic", record.key(), result));
        }

        // ② 把消费 offset 纳入事务（关键！）
        Map<TopicPartition, OffsetAndMetadata> offsets = new HashMap<>();
        for (TopicPartition partition : records.partitions()) {
            List<ConsumerRecord<String, String>> partRecords = records.records(partition);
            long lastOffset = partRecords.get(partRecords.size() - 1).offset();
            offsets.put(partition, new OffsetAndMetadata(lastOffset + 1));  // +1 = 下次消费起始位
        }
        producer.sendOffsetsToTransaction(offsets, consumer.groupMetadata());

        // ③ 原子提交：目标消息 + 消费offset 一起生效
        producer.commitTransaction();
    } catch (ProducerFencedException e) {
        producer.close();
        break;
    } catch (KafkaException e) {
        // 原子回滚：目标消息不可见 + offset 不生效 → Consumer 下次重新消费
        producer.abortTransaction();
    }
}
```

**事务 offset 提交 vs 普通 offset 提交对比：**

| 对比项 | `consumer.commitSync()` | `producer.sendOffsetsToTransaction()` |
|--------|------------------------|--------------------------------------|
| 谁提交 | Consumer 自己 | Producer 代为提交 |
| 写入目标 | `__consumer_offsets` | 同样写 `__consumer_offsets`，但带事务标记 |
| 生效时机 | 立即生效 | 等 COMMIT Marker 写入后才生效 |
| 原子性 | 与业务消息**不原子** | 与业务消息**原子**（同一事务） |
| 回滚 | 不支持 | abort 后 offset 不生效，自动重新消费 |

#### 10.3.3 Abort 流程

```
producer.abortTransaction()
  → EndTxn(ABORT) → PrepareAbort → 向所有参与分区写 ABORT Marker → CompleteAbort
```

ABORT Marker 写入后，Consumer 端 `read_committed` 会跳过这批消息。

#### 10.3.4 Consumer 如何过滤未提交消息

```
isolation.level = read_committed 时：

1. Broker 维护每个分区的 LSO（Last Stable Offset）
   LSO = 所有进行中事务的最小 offset
   Consumer 只能消费到 LSO 之前的消息

2. 当 COMMIT Marker 写入后 → LSO 前进 → 消息变为可消费
3. 当 ABORT Marker 写入后 → LSO 前进 → Consumer 通过 Abort 索引（.txnindex 文件）跳过这批消息

图示：
  offset:  0  1  2  3  4  5  6  7  8  9
  消息:    A  B  T1 T1 T1 C  T2 T2 D  E
                 ↑──事务1──↑     ↑事务2↑
  LSO = 2（事务1未提交时，Consumer最多读到offset 1）
  事务1 COMMIT 后 → LSO推进到6 → Consumer可读 0~5
  事务2 ABORT 后  → LSO推进到9 → Consumer读6~8时跳过T2的消息
```

> ⚠️ 长事务会导致 LSO 长时间不推进，阻塞下游 Consumer 消费，生产中应控制事务时长

#### 10.3.5 Epoch 防僵尸机制

```
场景：Producer-A（transactional.id="tx-1"）宕机，Producer-B 以相同 id 启动

1. Producer-B initTransactions() → Coordinator 分配新 Epoch（oldEpoch + 1）
2. 若 Producer-A 的旧事务未完成 → Coordinator 主动 abort 旧事务
3. Producer-A 恢复后发送请求 → Broker 检测 Epoch 过期 → 拒绝（ProducerFencedException）
4. 保证同一 transactional.id 全局只有一个活跃 Producer
```

#### 10.3.6 代码示例

```java
// === 生产者配置 ===
Properties props = new Properties();
props.put("bootstrap.servers", "broker1:9092,broker2:9092");
props.put("transactional.id", "order-producer-1");   // 全局唯一，跨重启不变
props.put("enable.idempotence", "true");              // 事务依赖幂等（设transactional.id时自动开启）
props.put("acks", "all");                             // 自动强制为all

KafkaProducer<String, String> producer = new KafkaProducer<>(props);
producer.initTransactions();  // 必须调用，向 Coordinator 注册

// === 事务发送（Consume-Transform-Produce 模式）===
try {
    producer.beginTransaction();

    // 跨 Topic 原子写入
    producer.send(new ProducerRecord<>("order-topic", key, orderMsg));
    producer.send(new ProducerRecord<>("inventory-topic", key, inventoryMsg));

    // 消费位移也可纳入事务（consume-transform-produce 场景）
    Map<TopicPartition, OffsetAndMetadata> offsets = new HashMap<>();
    offsets.put(new TopicPartition("source-topic", 0),
               new OffsetAndMetadata(lastOffset + 1));
    producer.sendOffsetsToTransaction(offsets, consumerGroupId);

    producer.commitTransaction();    // 二阶段提交
} catch (ProducerFencedException e) {
    // 被更高 Epoch 的 Producer 隔离，不可恢复，必须关闭
    producer.close();
} catch (KafkaException e) {
    producer.abortTransaction();     // 回滚，所有消息对 read_committed Consumer 不可见
}

// === 消费者配置 ===
Properties consumerProps = new Properties();
consumerProps.put("isolation.level", "read_committed");  // 只读已提交事务消息
consumerProps.put("enable.auto.commit", "false");        // 事务场景必须关闭自动提交
```

#### 10.3.7 事务状态机

```
                   ┌──────────────────────────────────────┐
                   │         __transaction_state           │
                   │       持久化的状态流转日志               │
                   └──────────────────────────────────────┘

  Empty ──beginTxn──→ Ongoing ──endTxn(COMMIT)──→ PrepareCommit ──allMarkerDone──→ CompleteCommit
                         │                                                              │
                         │       endTxn(ABORT)──→ PrepareAbort ──allMarkerDone──→ CompleteAbort
                         │                                                              │
                         └──────────────── 事务超时(默认60s) ──→ 自动 Abort ─────────────┘
```

> 事务超时由 `transaction.timeout.ms`（默认 60000ms）控制，超时后 Coordinator 自动 Abort

#### 10.3.8 性能影响与调优

| 影响点 | 说明 | 调优建议 |
|--------|------|---------|
| Coordinator 交互 | 每次 begin/commit 涉及网络 RPC | 批量聚合消息后一次 commit，不要每条消息一个事务 |
| PrepareCommit 持久化 | 写 `__transaction_state`（acks=all） | 该 Topic 默认 3 副本，确保 Broker 存储性能 |
| Transaction Marker | 向每个参与分区写 Marker | 减少单事务涉及的分区数 |
| LSO 阻塞 | 长事务阻塞下游消费 | 控制事务时长 < 5s，设置合理的 `transaction.timeout.ms` |
| 吞吐下降 | 整体约降 20%~30% | 仅在需要原子性的场景使用事务 |

#### 10.3.9 与 RocketMQ 事务消息对比

| 对比维度 | Kafka 事务 | RocketMQ 事务消息 |
|---------|-----------|-----------------|
| **设计目标** | 跨分区原子写 + 流处理 Exactly Once | 本地事务与消息发送的最终一致性 |
| **机制** | 两阶段提交（Coordinator + Marker） | 半消息 + 本地事务回查 |
| **回查** | 无回查，超时自动 Abort | Broker 主动回查 Producer 本地事务状态 |
| **适用场景** | consume-transform-produce 流处理管道 | 订单创建后发消息通知下游（DB+MQ 一致性） |
| **Consumer 感知** | `read_committed` 过滤未提交消息 | 半消息对 Consumer 完全不可见 |
| **跨系统事务** | 不直接支持（需配合外部 DB 事务） | 天然支持本地 DB 事务 + 消息原子性 |

> **一句话区别**：Kafka 事务保证"Kafka 内部多分区原子写"，RocketMQ 事务消息保证"本地 DB 事务和消息发送的一致性"

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

