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

## 五、消息存储原理 ⭐⭐⭐

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

## 六、面试标准答法

**Q: RocketMQ事务消息是怎么实现的？**

> RocketMQ事务消息用半消息机制：先发Half消息到Broker（Consumer不可见），成功后执行本地事务，根据结果发COMMIT（投递消息）或ROLLBACK（删除消息）。如果Producer宕机，Broker会定期回查本地事务状态，保证最终一致性。

**Q: RocketMQ和Kafka存储架构区别？**

> Kafka每个Partition对应独立.log文件，Topic/Partition数量多时磁盘随机IO增大。RocketMQ所有消息统一顺序写入CommitLog单文件，再由ConsumerQueue索引定位，无论多少Topic始终顺序 IO，多Topics场景性能更稳定。

