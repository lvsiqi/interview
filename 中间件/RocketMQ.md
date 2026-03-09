# RocketMQ 知识点

> 最后更新：2026年3月6日

---

## 一、RocketMQ vs Kafka 对比 ⭐⭐⭐

| 对比维度 | Kafka | RocketMQ |
|---------|-------|----------|
| **定位** | 高吞吐日志/流处理 | 金融级可靠消息 |
| **延迟消息** | ❌不支持 | ✅ 18个固定级别（RocketMQ 5.x支持任意时间）|
| **事务消息** | ✅ 事务API | ✅ 半消息机制，更成熟 |
| **死信队列** | ❌ 需自行实现 | ✅ 原生支持 |
| **消息轨迹** | ❌ | ✅ 原生支持 |
| **单机吞吐** | 百万级TPS | 十万级TPS |
| **存储结构** | 每个Partition独立文件 | 所有消息写同CommitLog |
| **适用场景** | 日志收集、大数据流处理 | 电商订单、支付、通知 |

---

## 二、架构组件

```
Producer → NameServer（路由注册中心）→ Broker集群 → Consumer
                               ↓
                          CommitLog（顺序写）
                          ConsumerQueue（索引）
                          IndexFile
```

| 组件 | 作用 |
|------|------|
| **NameServer** | 轻量级注册中心，无状态，Broker启动向所有NameServer注册 |
| **Broker** | 消息存储和转发，Master-Slave主从架构 |
| **Producer** | 生产者，从NameServer获取路由，向Master发送 |
| **Consumer** | 消费者，可Master或Slave拉取 |

> NameServer各节点独立无通信（简单轻量）vs ZooKeeper有选举协议（复杂但强一致）

---

## 三、延迟消息 ⭐⭐⭐

**18个固定级别：**
```
1s 5s 10s 30s 1m 2m 3m 4m 5m 6m 7m 8m 9m 10m 20m 30m 1h 2h
message.setDelayTimeLevel(3);  // 延迟10s
```

**内部实现：**
```
① Producer发送延迟消息
② Broker将原始Topic替换为 SCHEDULE_TOPIC_XXXX（内部定时Topic）
③ ScheduleMessageService 定时扫描到期消息
④ 到期后投递到原始Topic
⑤ Consumer正常消费原始Topic
```

> RocketMQ 5.x 已支持任意时间延迟，不再限于18个级别

---

## 四、事务消息 ⭐⭐⭐⭐

**解决的问题：** 本地事务与发消息的原子性

**半消息（Half Message）机制：**

```
① Producer → 发送Half消息 → Broker（存入RMQ_SYS_TRANS_HALF_TOPIC，Consumer不可见）
② Broker → 返回ACK
③ Producer → 执行本地事务（如扣库存）
④ Producer →
     成功：发COMMIT → Broker投递到原始Topic（Consumer可见）
     失败：发ROLLBACK → Broker删除Half消息
⑤ Producer宕机：
     Broker定期回查Producer本地事务状态 → COMMIT/ROLLBACK
```

**代码示例：**
```java
producer.setTransactionListener(new TransactionListener() {
    @Override
    public LocalTransactionState executeLocalTransaction(Message msg, Object arg) {
        boolean success = deductStock(msg);  // 本地事务
        return success ? LocalTransactionState.COMMIT_MESSAGE
                       : LocalTransactionState.ROLLBACK_MESSAGE;
    }
    @Override
    public LocalTransactionState checkLocalTransaction(MessageExt msg) {
        boolean exists = checkStockDeducted(msg);  // 回查
        return exists ? LocalTransactionState.COMMIT_MESSAGE
                      : LocalTransactionState.ROLLBACK_MESSAGE;
    }
});
producer.sendMessageInTransaction(msg, null);
```

---

## 五、顺序消息 ⭐⭐⭐

### 5.1 为什么消息会乱序

普通发送模式下乱序的三个来源：

```
① 发送端：默认轮询选 Queue，同一订单的消息分散到不同 Queue
② 存储端：不同 Queue 由不同消费者拉取，天然并行
③ 消费端：MessageListenerConcurrently 多线程消费，线程调度无序
```

> 要实现顺序消息，必须**三端联合保证**：发送路由同 Queue + 存储有序 + 消费串行

### 5.2 全局有序 vs 局部有序

| 类型 | 做法 | 代价 | 适用场景 |
|------|------|------|---------|
| **全局有序** | Topic 只设 1 个 Queue，单线程消费 | 吞吐极低，整个 Topic 串行 | binlog 同步等极少场景 |
| **局部有序（推荐）** | 同一业务键路由到同一 Queue，`MessageListenerOrderly` 消费 | 仅同键有序，不同键并行 | 订单状态流转、支付回调 |

> 生产环境几乎都用**局部有序**，全局有序性能不可接受

### 5.3 实现原理（三端保证）

#### ① 生产者：MessageQueueSelector 路由

同一业务键（如 orderId）通过自定义 `MessageQueueSelector` hash 到固定 Queue：

```java
SendResult result = producer.send(msg,
    (queues, m, arg) -> {
        // 用 orderId 的 hashCode 取模，保证同一订单始终路由同一 Queue
        int index = Math.abs(arg.hashCode()) % queues.size();
        return queues.get(index);
    },
    orderId);  // arg 参数传入 orderId
```

**关键细节：**
- `Math.abs()` 防止负数 hashCode 导致数组越界
- Queue 数量变更（扩容）会导致路由漂移，需要在扩容窗口期做好幂等处理
- 如果某个 Queue 对应的 Broker 宕机，**默认会发送失败而非自动切换**（切换会破坏顺序）

#### ② Broker 端：Queue 内天然有序

```
CommitLog 顺序写入 → ConsumeQueue 按 offset 递增排列
同一 Queue 内的消息物理上就是有序的，无需额外处理
```

#### ③ 消费者：MessageListenerOrderly 串行消费

```java
consumer.registerMessageListener((MessageListenerOrderly) (msgs, ctx) -> {
    for (MessageExt msg : msgs) {
        // 同一 Queue 的消息严格串行执行到这里
        processOrder(msg);
    }
    return ConsumeOrderlyStatus.SUCCESS;
});
```

**`MessageListenerOrderly` 底层实现原理：**

```
1. Consumer 启动时向 Broker 发送 LOCK_BATCH_MQ 请求，锁定分配给自己的 Queue
2. 每个 Queue 对应一个 ConsumeRequest，放入线程池执行
3. 执行前先获取该 Queue 的本地 synchronized 锁（processQueue.consumeLock）
4. 同一时刻同一 Queue 只有一个线程在消费 → 保证串行
5. 消费完成后顺序提交 offset（非并发的异步提交）
```

对比两种 Listener：

| 对比项 | MessageListenerConcurrently | MessageListenerOrderly |
|--------|---------------------------|----------------------|
| 消费方式 | 多线程并发消费 | 单 Queue 加锁串行 |
| 锁机制 | 无 | Broker 分布式锁 + 本地 synchronized |
| offset 提交 | 每条独立（可能跳跃） | 顺序提交（不跳跃） |
| 消费失败 | 发回重试队列，继续消费下一条 | **挂起当前 Queue，稍后重试本条**（不跳过） |
| 性能 | 高 | 较低（单 Queue 串行） |

### 5.4 消费失败时的处理差异（重要）

```
并发消费失败：消息发回 %RETRY% 队列 → 继续消费后续消息 → 可能乱序
顺序消费失败：挂起当前 Queue → 本地延迟重试（默认间隔1s）→ 不消费下一条
            → 达到最大重试次数（默认 Integer.MAX_VALUE）后才进死信队列
```

> ⚠️ 这意味着顺序消费如果某条消息一直失败，**会阻塞整个 Queue**。必须设置合理的 `maxReconsumeTimes` 并做好死信监控

```java
// 设置最大重试次数，防止无限阻塞
consumer.setMaxReconsumeTimes(5);
```

### 5.5 Rebalance 导致短暂乱序

```
Consumer 扩缩容 → 触发 Rebalance → Queue 重新分配
  → 新 Consumer 对该 Queue 加锁前，可能与旧 Consumer 存在短暂并行窗口
  → RocketMQ 通过 Broker 端锁 + 20s 超时来尽量缩小该窗口
  → 但无法做到 100% 无乱序，业务侧需要幂等兜底
```

**Broker 端 Queue 锁机制：**
- Consumer 每 20s 续约一次锁（`rebalanceService` 定时任务）
- Broker 锁超时时间默认 60s
- Rebalance 时新 Consumer 需等旧锁过期才能获取 → 保护窗口

### 5.6 生产实践建议

| 场景 | 建议 |
|------|------|
| 选择顺序键 | 用最细粒度的业务 ID（orderId），避免用 userId 导致热点 Queue |
| Queue 数量 | 适当多设（如 8-16 个），平衡顺序性和吞吐量 |
| 消费幂等 | **必须做**，Rebalance 窗口和重试都可能导致重复消费 |
| 失败处理 | 设置合理 `maxReconsumeTimes`（如 3-5 次），配合死信告警 |
| 发送失败 | 顺序场景不要开启 `retryAnotherBrokerWhenNotStoreOK`，否则会路由到其他 Queue 破坏顺序 |
| 监控 | 关注单 Queue 消费延迟，防止某条消息阻塞导致积压 |

### 5.7 面试答法

> **Q：RocketMQ 如何实现顺序消息？**
>
> 分三端保证：
> 1. **生产者**通过 `MessageQueueSelector` 将同一业务键 hash 路由到同一 Queue
> 2. **Broker 端** Queue 内消息天然按 offset 有序
> 3. **消费者**使用 `MessageListenerOrderly`，底层对 Queue 加 Broker 分布式锁 + 本地 synchronized 锁，保证同一 Queue 串行消费；消费失败不跳过而是挂起重试，保持顺序
>
> 生产中用**局部有序**即可（同 orderId 有序），全局有序吞吐太低。需要注意 Rebalance 窗口可能短暂乱序，业务侧必须做幂等兜底。

> **追问：顺序消费失败会怎样？和并发消费有什么区别？**
>
> 并发消费失败会把消息发回重试队列、继续消费后续消息；顺序消费失败会**挂起整个 Queue 本地重试**，不跳过、不消费下一条，直到成功或达到最大重试次数进死信。所以顺序消费必须设置合理的 `maxReconsumeTimes`，否则一条毒消息会阻塞整个 Queue。

---

## 六、死信队列 & 重试机制 ⭐⭐⭐

**消费失败重试流程：**

```
Consumer 返回 RECONSUME_LATER / 抛异常
  → Broker 将消息放入 %RETRY%ConsumerGroupName（重试 Topic）
  → 按延迟级别梯度重试：10s → 30s → 1m → 2m → 3m → ... → 2h
  → 默认最多重试 16 次
  → 超过最大次数 → 投递到 %DLQ%ConsumerGroupName（死信 Topic）
```

**死信处理策略：**

| 方案 | 说明 |
|------|------|
| 人工介入 | 订阅死信 Topic，告警 + 人工查表修复 |
| 自动重入 | 死信消费者读取后校正消息重新投递（需幂等） |
| 监控告警 | 死信消息数 > 阈值时触发钉钉/邮件告警 |

---

## 七、消息过滤 ⭐⭐

RocketMQ 支持两种过滤方式，在 **Broker 端过滤**，减少无效消息传输：

| 方式 | 原理 | 适用场景 |
|------|------|---------|
| **Tag 过滤** | Consumer 订阅时指定 Tag，Broker ConsumeQueue 中存有 Tag hashCode，匹配才下发 | 简单分类，性能最佳 |
| **SQL92 过滤** | Broker 端执行 SQL 表达式，基于消息属性过滤 | 复杂条件，需开启 `enablePropertyFilter=true` |

```java
// Tag 过滤：订阅支付相关消息
consumer.subscribe("order-topic", "PAY || REFUND");

// SQL92 过滤：订阅金额大于100的支付消息
consumer.subscribe("order-topic",
    MessageSelector.bySql("tag = 'PAY' AND amount > 100"));
```

---

## 八、消息存储原理 ⭐⭐⭐

**存储文件结构：**
```
store/
  commitlog/       ← 所有Topic消息统一顺序写入（1GB一个文件）
  consumequeue/    ← 每个Topic-Queue的索引（offset → CommitLog位置）
  index/           ← 按MessageKey/时间范围查询的索引
```

**CommitLog vs Kafka Partition文件：**
```
Kafka：每个Partition独立.log文件 → Topic/Partition多时磁盘随机IO增大
RocketMQ：所有Topic统一写CommitLog → 始终顺序 IO，多Topics场景性能更稳定
```

**刷盘策略：**

| 策略 | 返回时机 | 安全性 | 性能 |
|------|--------|--------|------|
| 同步刷盘 | 写磁盘同步返回 | 高 | 低 |
| **异步刷盘**（默认） | 写PageCache即返回 | 中 | 高 |

---

## 九、高可用架构 ⭐⭐

**Broker 主从架构（4.x DLedger模式）：**

```
Master Broker：负责读写
Slave Broker：同步/异步复制Master数据，Master宕机后消费者可从Slave读取

RocketMQ 4.5+ DLedger 模式（基于Raft）：
  Master宕机自动从Slave中选举新Master
  解决了旧架构需要人工切换Master的问题
```

| 模式 | 一致性 | 可用性 | 说明 |
|------|--------|--------|------|
| 同步复制 | 高 | 低（Slave故障影响写入） | 金融场景 |
| 异步复制（默认） | 中 | 高 | 业务通用场景 |
| DLedger（Raft） | 高 | 高（自动选主） | 推荐新版使用 |

---

## 十、面试标准答法

**Q: RocketMQ事务消息是怎么实现的？**

> RocketMQ事务消息用半消息机制：先发Half消息到Broker（Consumer不可见），成功后执行本地事务，根据结果发COMMIT（投递消息）或ROLLBACK（删除消息）。如果Producer宕机，Broker会定期回查本地事务状态，保证最终一致性。

**Q: RocketMQ 和 Kafka 如何选型？**

> 日志采集、大数据流处理、超高吞吐（百万TPS）→ **选Kafka**，零拷贝+顺序写极致性能。电商订单、支付、通知等业务消息 → **选RocketMQ**，原生支持延迟消息、事务消息、死信队列、消息轨迹，运维友好。

**Q: RocketMQ和Kafka存储架构区别？**

> Kafka每个Partition对应独立.log文件，Topic/Partition数量多时磁盘随机IO增大。RocketMQ所有消息统一顺序写入CommitLog单文件，再由ConsumerQueue索引定位，无论多少Topic始终顺序 IO，多Topics场景性能更稳定。

