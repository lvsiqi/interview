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

### 6.3 生产者发送流程

```
消息 → 序列化 → 分区器 → RecordAccumulator（内存缓冲）
    → Sender线程批量发送（batch.size=16KB, linger.ms=5ms）
    → Broker Leader写入 → ISR同步 → ACK返回
```

---

### 6.4 消费者拉取流程

```
Consumer Poll → fetch请求到Leader → 返回消息批次
→ 业务处理 → 手动提交offset到 __consumer_offsets（内置Topic）
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

### 9.1 消费者组核心规则

```
同一ConsumerGroup内：每个Partition只能被一个Consumer消费
不同ConsumerGroup之间：互相独立，同一消息可被多个Group各消费一次
Consumer数 > Partition数 → 多余Consumer空闲
```

---

### 9.2 Rebalance触发时机

```
1. Consumer加入/离开Group（扩缩容、正常下线）
2. Consumer崩溃（心跳超时 session.timeout.ms，默认45s）
3. Consumer两次poll间隔超过 max.poll.interval.ms（默认300s）
4. Topic分区数变化
```

---

### 9.3 Rebalance流程

```
① 所有Consumer → JoinGroup请求 → GroupCoordinator
② Coordinator选出Leader Consumer
③ Leader Consumer执行分区分配策略
④ Leader → SyncGroup → Coordinator → 下发方案给所有Consumer
⑤ 所有Consumer按新方案消费

⚠️ Rebalance期间全组停止消费（Stop The World）
```

---

### 9.4 分区分配策略

| 策略 | 规则 | 推荐度 |
|------|------|------|
| RangeAssignor | 按Topic分区范围连续分配 | 一般 |
| RoundRobinAssignor | 所有Partition轮询分配 | 一般 |
| StickyAssignor | 尽量保留上次分配，最小化迁移 | ✅推荐 |
| **CooperativeStickyAssignor** | 增量式Rebalance，只迁移必要Partition，其余继续消费 | ✅✅最优 |

---

### 9.5 Rebalance优化

```
1. 调参避免误判超时：
   max.poll.interval.ms 调大 或 减少 max.poll.records
   heartbeat.interval.ms < session.timeout.ms / 3

2. CooperativeStickyAssignor：增量式，未迁移Partition继续消费，避免STW

3. 静态成员（Static Membership）：
   group.instance.id 指定固定ID
   Consumer重启后以相同ID重新加入 → 不触发Rebalance
```

---

### 9.6 面试标准答法

> ConsumerGroup内每个Partition只被一个Consumer消费，不同Group独立消费。Consumer数量/分区数变化时触发Rebalance，由GroupCoordinator协调完成分区重分配，期间全组STW。优化：调大`max.poll.interval.ms`避免误判；用`CooperativeStickyAssignor`做增量式Rebalance；配置`group.instance.id`静态成员避免重启触发Rebalance。

---

## 十、Exactly Once 语义 ⭐⭐⭐⭐

### 10.1 三种消息语义

| 语义 | 含义 | 场景 |
|------|------|------|
| At Most Once | 最多一次，可能丢消息 | 日志、监控 |
| At Least Once | 至少一次，可能重复 | 大多数业务默认 |
| **Exactly Once** | 恰好一次，不丢不重 | 金融、订单、扣款 |

---

### 10.2 幂等性 Producer（单分区去重）

```
enable.idempotence=true（自动设置 acks=all、retries=MAX）

每条消息携带 <PID, 分区, SequenceNumber>
Broker缓存最大SeqNum，重复消息直接丢弃

局限：Producer重启后PID变化 → 只解决单会话单分区重复
```

---

### 10.3 事务（跨分区 + 跨会话）

```java
props.put("transactional.id", "order-producer-1"); // 固定ID，重启不变
producer.initTransactions();
try {
    producer.beginTransaction();
    producer.send(new ProducerRecord<>("topic-a", key, value));
    producer.send(new ProducerRecord<>("topic-b", key, value));
    producer.commitTransaction();  // 原子提交
} catch (Exception e) {
    producer.abortTransaction();   // 原子回滚
}
```

**Consumer端：**
```
isolation.level=read_committed → 只读已提交事务的消息，不读脏数据
```

---

### 10.4 完整 Exactly Once 方案

```
Producer：enable.idempotence=true + transactional.id固定 + acks=all
Consumer：isolation.level=read_committed + 手动提交offset

实际生产选择：
  Kafka内部流处理（Kafka Streams/Flink）→ 用原生事务
  跨系统场景（Kafka→DB）→ 业务层幂等（消息唯一ID + DB唯一索引）
  原因：事务吞吐量下降约20%~40%，业务幂等更通用且性能更好
```

---

### 10.5 面试标准答法

> Kafka通过幂等性Producer（`enable.idempotence=true`，PID+SeqNum去重）+ 事务（`transactional.id`固定，跨会话跨分区原子写入）+ Consumer `read_committed`隔离级别，实现端到端Exactly Once。实际生产中跨系统场景更多用业务层幂等（消息唯一ID + DB唯一索引），因为原生事务有约20%~40%的吞吐损耗。

