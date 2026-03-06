# Redis 知识点

> 最后更新：2026年3月5日

---

## 一、数据结构 & 底层实现 ⭐⭐⭐⭐⭐

### 1.1 五种基本数据类型

| 类型 | 底层实现 | 常用命令 | 典型场景 |
|------|---------|---------|----------|
| **String** | SDS | GET/SET/INCR | 缓存、计数器、分布式锁 |
| **Hash** | ziplist / hashtable | HGET/HSET | 对象存储（用户信息） |
| **List** | ziplist / quicklist | LPUSH/RPOP/LRANGE | 消息队列、最新列表 |
| **Set** | intset / hashtable | SADD/SMEMBERS/SINTER | 去重、标签、共同好友 |
| **ZSet** | ziplist / skiplist+hashtable | ZADD/ZRANGE/ZRANK | 排行榜、延迟队列 |

---

### 1.2 底层数据结构详解

#### ① SDS（Simple Dynamic String）
```c
struct sdshdr {
    int len;      // 已使用长度
    int free;     // 剩余空间
    char buf[];   // 实际字节数组
};
```
**相比C字符串的优势：**
- O(1) 获取长度（不用遍历）
- 预分配 + 惰性释放，减少内存重分配
- 二进制安全（可存`\0`，C字符串不行）

#### ② ziplist（压缩列表）
- 连续内存块存储，节省指针开销
- **连锁更新问题**：前节点长度变化可能触发后续所有节点重新编码（最坏O(n)）
- 数据量小时使用（元素数 < 128，值 < 64字节）

#### ③ skiplist（跳表）—— ZSet核心
```
层级3: head → 1 --------→ 5 → tail
层级2: head → 1 → 3 → 5 → 7 → tail
层级1: head → 1 → 2 → 3 → 4 → 5 → 6 → 7 → tail
```
- 查找/插入/删除：**平均 O(logN)**
- **为什么ZSet用跳表不用红黑树？**
  1. 范围查询更简单（底层链表天然有序）
  2. 实现更简单，代码可读性高

#### ④ quicklist（List底层，Redis 3.2+）
- `双向链表，每个节点是一个 ziplist`
- 兼顾内存效率（ziplist紧凑）和操作效率（链表O(1)头尾）

#### ⑤ intset（整数集合）
- Set全为整数且数量少时使用，有序数组+二分查找O(logN)
- 支持升级（int16→int32→int64），不支持降级

---

### 1.3 三种特殊数据类型

| 类型 | 底层 | 场景 |
|------|------|------|
| **Bitmap** | String位数组 | 用户签到、在线状态（亿级用户仅12MB） |
| **HyperLogLog** | 特殊字符串 | UV统计，误差0.81%，固定12KB内存 |
| **Geo** | ZSet（score存geohash） | 附近的人、距离计算 |

```bash
# Bitmap：用户签到
SETBIT sign:uid:2024 day 1
BITCOUNT sign:uid:2024

# HyperLogLog：统计UV
PFADD page:uv uid1 uid2 uid3
PFCOUNT page:uv

# Geo：附近的人
GEOADD locations 116.4 39.9 "北京"
GEORADIUS locations 116.4 39.9 10 km
```

---

### 1.4 编码转换触发条件

| 类型 | 小数据编码 | 大数据编码 | 触发条件 |
|------|-----------|-----------|----------|
| Hash | ziplist | hashtable | 元素数 > 128 **或** 值长度 > 64 |
| List | ziplist | quicklist | 元素数 > 512 **或** 值长度 > 64 |
| Set | intset | hashtable | 元素数 > 512 **或** 含非整数 |
| ZSet | ziplist | skiplist+hashtable | 元素数 > 128 **或** 值长度 > 64 |

---

### 1.5 面试标准答法

> Redis有5种基本类型：String底层是SDS，O(1)获取长度、二进制安全；Hash小数据用ziplist，大数据用hashtable；List用quicklist，是ziplist组成的双向链表；Set整数用intset，否则用hashtable；ZSet用跳表+hashtable，跳表支持范围查询O(logN)，hashtable支持O(1)按key查score。
>
> 另有Bitmap做签到统计、HyperLogLog做UV去重（误差0.81%，固定12KB）、Geo（基于ZSet）做地理位置计算。

---

### 1.6 常见追问

**Q: ZSet为什么同时用跳表和hashtable？**
> 跳表支持范围查询（ZRANGE），O(logN+M)；hashtable支持O(1)按member查score（ZSCORE）。两者互补，共享数据指针，内存开销可控。

**Q: HyperLogLog为什么只用12KB就能统计亿级UV？**
> 概率算法，通过统计哈希值最高位0的个数估算基数，不存储实际元素。固定12KB，误差约0.81%，适合对精度要求不高的场景。

**Q: Redis String最大能存多大？**
> 最大512MB，但实际不建议超过1MB，否则网络传输和序列化开销很大。

---

## 二、持久化（RDB / AOF）⭐⭐⭐⭐

### 2.1 RDB（快照持久化）

**原理：** 将某一时刻内存数据快照写入磁盘（`.rdb` 二进制文件）

| 触发方式 | 说明 |
|---------|------|
| `SAVE` | 主线程同步执行，**阻塞**所有命令 |
| `BGSAVE` | fork 子进程异步执行，主线程正常服务 |
| 配置自动触发 | `save 900 1`（900秒内有1次写操作触发BGSAVE） |

**BGSAVE + Copy-On-Write（COW）：**
```
主进程 fork() 子进程 → 共享内存页（COW）
主进程有写操作 → OS复制该页给主进程，子进程看到fork时刻快照
子进程将快照写入临时.rdb → 完成后原子替换旧文件
```

- ✅ 文件紧凑，恢复速度**快**
- ❌ 两次快照之间宕机，丢失这段时间数据

---

### 2.2 AOF（追加命令日志）

**原理：** 将每条写命令追加写入 `.aof` 文件，重启时回放命令恢复数据

**三种刷盘策略（`appendfsync`）：**

| 策略 | 说明 | 数据安全性 |
|------|------|----------|
| `always` | 每条命令都 fsync | 最多丢1条 |
| `everysec`（默认）⭐ | 每秒 fsync 一次 | 最多丢1秒 |
| `no` | 由OS决定 | 可能丢较多 |

**AOF Rewrite（重写压缩）：**
```
BGREWRITEAOF → fork子进程 → 内存数据转为最简命令写入新AOF
重写期间新命令 → 写入AOF重写缓冲区
子进程完成 → 追加缓冲区内容 → 原子替换旧AOF
```

- ✅ 数据安全，最多丢1秒
- ❌ 文件大，恢复速度慢（需回放所有命令）

---

### 2.3 RDB vs AOF 对比

| 对比项 | RDB | AOF |
|--------|-----|-----|
| **数据安全性** | 低（快照间隔内丢失） | 高（最多丢1秒） |
| **文件大小** | 小（二进制） | 大（文本命令） |
| **恢复速度** | **快** | 慢（回放命令） |
| **适用场景** | 容忍少量丢失，重视恢复 | 数据不能丢失 |

---

### 2.4 混合持久化（Redis 4.0+）⭐ 生产推荐

```bash
aof-use-rdb-preamble yes   # 开启混合持久化
```

AOF文件结构：`[ RDB二进制数据（存量）| AOF增量命令（重写后新增）]`

- 恢复速度接近 RDB（直接加载二进制部分）
- 数据完整性接近 AOF（增量命令补充）

---

### 2.5 面试标准答法

> Redis有三种持久化：**RDB**是快照，BGSAVE fork子进程利用COW将内存数据写成二进制文件，文件小恢复快，但两次快照之间宕机会丢数据。**AOF**追加写命令，默认每秒fsync最多丢1秒数据，通过AOF Rewrite压缩文件大小。**混合持久化**（4.0+）AOF重写时先写RDB快照再追加增量AOF命令，兼顾速度和安全，是生产推荐方案。

---

### 2.6 常见追问

**Q: BGSAVE期间父进程修改数据，子进程快照还完整吗？**
> COW保证：父进程修改某内存页时OS复制一份新页给父进程，子进程仍持有原页，始终看到fork时刻的数据，快照完整。

**Q: Redis宕机恢复优先用RDB还是AOF？**
> 同时开启时**优先用AOF**（数据更完整），只有AOF未开启才用RDB。

**Q: AOF重写期间宕机怎么办？**
> 旧AOF文件仍完整，新文件未完成会被丢弃，Redis重启直接用旧AOF恢复，数据安全。

---

## 三、内存淘汰策略 ⭐⭐⭐⭐

### 3.1 八种淘汰策略

| 策略 | 淘汰范围 | 算法 | 说明 |
|------|---------|------|------|
| **noeviction** | - | - | 不淘汰，写操作直接报错（默认）|
| **allkeys-lru** | 全部key | LRU | 淘汰最近最少使用的key ⭐最常用 |
| **allkeys-lfu** | 全部key | LFU | 淘汰访问**频率**最低的key |
| **allkeys-random** | 全部key | 随机 | 随机淘汰 |
| **volatile-lru** | 设了TTL的key | LRU | 只在有过期时间的key中LRU |
| **volatile-lfu** | 设了TTL的key | LFU | 只在有过期时间的key中LFU |
| **volatile-random** | 设了TTL的key | 随机 | - |
| **volatile-ttl** | 设了TTL的key | TTL | 优先淘汰**剩余存活时间最短**的key |

---

### 3.2 LRU vs LFU

- **LRU**：淘汰最久没有被访问的数据。缺陷：一次性批量扫描会把真正热点数据洗掉（缓存污染）
- **LFU**：淘汰访问次数最少的数据，Redis 4.0+。计数器随时间衰减，防止历史热点永不被淘汰

---

### 3.3 Redis 近似 LRU

> Redis不用标准LRU链表，而是近似LRU：

- 每个key维护 24bit lru字段记录最近访问时间戳
- 淘汰时随机采样N个key（默认maxmemory-samples=5），淘汰最久未访问的那个
- Redis 3.0+维护一个16个key的候选池，精确度更高

---

### 3.4 过期键删除策略

**两种策略结合：**

| 策略 | 原理 | 优缺点 |
|------|------|--------|
| **惰性删除** | 访闪key时检查是否过期 | 对CPU友好，但过期key可能长期占内存 |
| **定期删除** | 每100ms随机抽查20个key检查删除 | 主动清理，但有CPU开销 |

> 注意：**内存淘汰**是内存满时触发；**过期删除**是key到TTL时触发，是两个不同的机制

---

### 3.5 生产配置建议

```bash
maxmemory 6gb                    # 设置最大内存
maxmemory-policy allkeys-lru     # 缓存场景推荐
maxmemory-samples 10             # 提高LRU采样精度
```

---

### 3.6 面试标准答法

> Redis有8种淘汰策略，默认noeviction内存满报错。生产最常用allkeys-lru，淘汰全局最近最少使用的key；Redis 4.0+推荐allkeys-lfu，能更好保护真正高频热点数据。Redis的LRU是近似实现，每个key助24bit时间戳，淘汰时随机采样取最久未访问的删除，性能好且效果足够好。
>
> 另外过期键删除是惰性删除+定期删除两种策略结合，这与内存淘汰是两个独立的机制。

---

### 3.7 常见追问

**Q: LRU和LFU怎么选？**
> 访问模式没有明显冷热频率差异用LRU；有稳定高频key用LFU，避免偶发访问把真正热点淘汰。

**Q: 为什么Redis用近似LRU而不用精确 LRU？**
> 精确LRU需维护按访问时间排序的链表，每次访问都要移动节点，对亿级key内存和CPU开销大。近似LRU只用24bit存时间戳，随机采样，开销极小且效果足够好。

**Q: volatile-lru和allkeys-lru怎么选？**
> 所有key都是缓存（可丢）用allkeys-lru，充分利用内存；部分key是持久数据（不能丢）部分是缓存，用volatile-lru只淘汰设了TTL的缓存key。

---

## 四、缓存问题（穿透/击穿/雪崩）⭐⭐⭐⭐⭐

### 4.1 缓存穿透（Cache Penetration）

**现象：** 查询不存在的数据，缓存和DB都没有，每次请求都直穿到DB

| 方案 | 原理 | 优缺点 |
|------|------|--------|
| **缓存空值** | 查DB为null时将null写入Redis并设短TTL | 简单，但会缓存大量无效key |
| **布隆过滤器** ⭐ | 请求先过布隆过滤器，不存在直接拒绝 | 内存极小，有误判率，不支持删除 |
| **接口层校验** | 参数合法性校验（id>0），非法请求直接拦截 | 简单有效，第一道防线 |

**布隆过滤器原理：**
```
K个hash函数将元素映射到K个bit位全部置1
查询时K个位全为1 → 可能存在；任一为0 → 一定不存在
误判：存在但实际不存在（hash碰撞）。不支持删除
```

---

### 4.2 缓存击穿（Cache Breakdown）

**现象：** 热点key过期瞬间，大量并发请求同时穿透到DB

| 方案 | 适用场景 |
|------|---------|
| **互斥锁** | 强一致性，允许短暂等待 |
| **逻辑过期** ⭐ | 高可用，允许极短时间读旧数据 |

```java
// 互斥锁方案
if (redis.setnx("lock:" + key, 1, 10)) {
    try {
        value = db.query(key);
        redis.set(key, value, ttl);
    } finally { redis.del("lock:" + key); }
} else {
    Thread.sleep(50); return get(key);  // 重试
}

// 逻辑过期方案：key永不过期，value内嵌过期时间
if (value.expireTime < now()) {
    if (redis.setnx("lock:" + key, 1, 10)) {
        executor.submit(() -> {  // 异步重建
            redis.set(key, {data: db.query(key), expireTime: now()+ttl});
            redis.del("lock:" + key);
        });
    }
    return value.data;  // 直接返回旧数据
}
```

---

### 4.3 缓存雪崩（Cache Avalanche）

**现象：** 大量key同时过期或Redis宕机，请求全量打到DB

| 原因 | 解决方案 |
|------|---------|
| 大量key同时过期 | **TTL加随机偏差** `base + random(0,300s)` |
| Redis服务宕机 | **集群部署**（哨兵/Cluster）/ **服务熔断降级** / **多级缓存** |

**多级缓存层次：** 本地Caffeine → Redis → DB，Redis崩溃时本地缓存兜底

---

### 4.4 三者对比

| | 缓存穿透 | 缓存击穿 | 缓存雪崩 |
|--|---------|---------|---------|
| **本质** | 查不存在的数据 | 热点key突然过期 | 大量key同时过期/Redis宕机 |
| **核心方案** | 布隆过滤器/缓存null | 互斥锁/逻辑过期 | 随机TTL/集群/多级缓存 |

---

### 4.5 缓存与数据库一致性

**生产推荐：Cache-Aside（先更新DB，再删除缓存）**

```java
db.update(data);    // 先更新DB
redis.del(key);     // 再删除缓存（下次请求重建）
```

**延迟双删（解决极端不一致）：**
```java
redis.del(key);      // 第一次删除
db.update(data);     // 更新DB
Thread.sleep(500);   // 等待其他线程完成旧数据回写
redis.del(key);      // 第二次删除
```

**终极方案：Canal监听binlog异步更新缓存**
```
MySQL binlog → Canal → MQ → 消费者更新/删除Redis（业务无侵入）
```

---

### 4.6 面试标准答法

> **缓存穿透**：查询不存在的数据，解决：布隆过滤器过滤不存在的key，或查DB为null时缓存空值。
>
> **缓存击穿**：热点key过期瞬间大量并发打到DB。解决：互斥锁保证只一个线程查DB回写；或逻辑过期，key不设TTL，过期时异步刷新直接返回旧数据。
>
> **缓存雪崩**：大量key同时过期或Redis宕机。解决：TTL加随机值分散过期；Redis集群保证高可用；多级缓存（本地Caffeine+Redis）兜底；服务熔断降级。

---

### 4.7 常见追问

**Q: 布隆过滤器为什么不支持删除？**
> 多个元素可能映射到同一bit位，删除会影响其他元素的判断。可用计数布隆过滤器（bit换计数器）支持删除，但内存更大。

**Q: Cache-Aside为什么是先更新DB再删缓存？**
> 先删缓存，删后到DB更新完成之间，其他线程读DB得到旧数据回写缓存，缓存持久存旧值。先更新DB再删缓存，不一致窗口极短，下次请求触发缓存重建拿到新值。

**Q: 互斥锁和逻辑过期各适合什么场景？**
> 互斥锁：强一致性，用户能接受短暂等待（如商品详情）。逻辑过期：强可用性，允许极短时间读旧数据（如排行榜、首页推荐），性能更好。

---

## 五、集群方案 ⭐⭐⭐⭐

### 5.1 三种模式概览

```
主从复制 → 解决读压力，但无自动故障转移
哨兵模式 → 解决高可用，但单主写入有瓶颈
Cluster   → 解决水平扩展 + 高可用
```

---

### 5.2 主从复制

- Slave 发送 `PSYNC` 连接 Master
- **全量同步**：Master BGSAVE 生成 RDB 发给 Slave，期间新命令写入 replication buffer 一并发送
- **增量同步**：后续 Master 将写命令异步发给 Slave
- **缺点**：主库宕机需手动切换，无自动故障转移

---

### 5.3 哨兵模式（Sentinel）

**故障转移流程：**
```
1. 哨兵发现 Master 无响应 → “主观下线”（SDOWN）
2. 达到 quorum 个哨兵同意 → “客观下线”（ODOWN）
3. 哨兵间选举 Leader（Raft算法）
4. Leader 选举新 Master： slave-priority最小 → 复制偏移量最大 → runID最小
5. 其他 Slave 指向新 Master，原 Master 恢复后变为 Slave
```

- 适合场景：数据量不大、需要高可用
- 缺点：仅单主写入，无法水平扩展写吐吐

---

### 5.4 Cluster 集群

**核心：16384个slot分片**
```
CRC16(key) % 16384 定位 slot
每个 Master 负责一段 slot 范围，每个 Master 有对应 Slave
客户端请求任意节点 → slot 不在本节点则返回 MOVED 重定向
```

**局限性：**
- 不支持跨slot的多键operation（MGET、事务、Lua脚本）
- 解决：Hash Tag `{order}.id` 和 `{order}.name` 强制路由到同一slot

**三种模式对比：**

| | 主从复制 | 哨兵模式 | Cluster |
|--|---------|---------|----------|
| 高可用 | 手动 | ✅ 自动 | ✅ 自动 |
| 写扩展 | ✖️ | ✖️ | ✅ |
| 存储扩展 | ✖️ | ✖️ | ✅ |
| 跨key操作 | ✅ | ✅ | ✖️（需Hash Tag）|
| 适用场景 | 读多写少 | 数据量不大高可用 | 数据量大需水平扩展 |

---

### 5.5 面试标准答法

> Redis有3种集群方案：**主从复制**解决读压力，但宕机需手动切换；**哨兵模式**在主从基础上增加自动故障转移，通过主观下线→客观下线→选举Leader→故障转移实现，适合数据量不大的高可用场景；**Cluster**将数据分散到16384个slot，多主分片写入，支持水平扩展，适合数据量大的场景，缺点是不支持跨slot的多键操作。

---

### 5.6 常见追问

**Q: 为什么Cluster用16384个slot？**
> 16384 = 2^14，slot映射用bitmap表示只键2KB，节点心跳包足够小。若用65536个slot需8KB，心跳包过大。Redis集群节点一般不超过1000个，16384个slot已足够。

**Q: Cluster宕机一个Master怎么办？**
> 该Master的Slave会被选举为新Master，接管其slot范围。若主从全部宕机，默认整个集群不可用（可配置`cluster-require-full-coverage no`让其他slot继续服务）。

**Q: Redis主从喐制是同步还是异步？**
> 异步喐制，Master写完立即返回客户端，不等Slave确认。可配置`min-slaves-to-write`和`min-slaves-max-lag`强制要求最少N个Slave在线且延迟小M秒，否则Master拒绝写入（类似半同步）。

---

## 六、分布式锁 ⭐⭐⭐⭐⭐

### 6.1 基础实现

```bash
# 加锁：SET NX EX 原子操作
SET lock:key {UUID} NX EX 30
# NX=不存在才设置  EX=自动过期防死锁  UUID=防误删

# 释放锁：Lua脚本保证判断+删除的原子性
if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
else
    return 0
end
```

- **value用UUID**：防止业务超时后锁过期，误删了其他线程的锁
- **Lua脚本**：GET和DEL之间不是原子的，用Lua在Redis单线程中原子执行

---

### 6.2 Redisson 分布式锁（生产推荐）

**看门狗续期机制：**
```
加锁（默认TTL 30s）
    ↓
后台线程每隔 TTL/3（10s）自动续期（重置为30s）
    ↓
业务结束主动释放 → 看门狗停止续期
```

**Hash结构支持可重入：**
```
Key:   lock:order:1
Field: {UUID}:{ThreadId}
Value: 重入次数

加锁Lua：锁不存在→ hset+expire；锁存在且是自己→ hincrby+1
释放锁Lua： hincrby-1，为0则del
```

```java
RLock lock = redissonClient.getLock("lock:key");
try {
    boolean ok = lock.tryLock(3, -1, TimeUnit.SECONDS);  // -1=看门狗自动续期
    if (ok) { /* 业务逻辑 */ }
} finally {
    lock.unlock();
}
```

---

### 6.3 RedLock（红锁）

**问题：** 单Redis主从切换时，Slave可能没有最新锁数据，导致同一锁被两个客户端持有

```
向N个独立节点加锁，超过半数（N/2+1）成功且耗时 < 锁有效期 → 加锁成功
```

- 有Martin Kleppmann vs Antirez之争（时钟漂移、GC暂停会导致失效）
- 生产大多数用 **Redisson+主从集群** 即可，极高可靠性场景用ZooKeeper

---

### 6.4 Redis vs ZooKeeper 对比

| 对比项 | Redis（Redisson） | ZooKeeper |
|--------|-----------------|----------|
| **性能** | 高 | 较低 |
| **可靠性** | 主从切换有极小概率丢锁 | 强一致性，更可靠 |
| **锁释放** | 依赖TTL过期 | 临时节点，客户端宕机立即释放 |
| **公平锁** | 需额外实现 | 天然支持（临时顺序节点） |
| **适用** | 高并发对性能要求高 | 对一致性要求极高 |

---

### 6.5 面试标准答法

> 用`SET key value NX EX ttl`原子命令加锁，value用UUID防误删，释放锁用Lua脚本保证判断和删除的原子性。
>
> 锁续期问题用Redisson看门狗解决，后台线程每隔TTL/3自动续期。Redisson用Hash结构支持可重入。
>
> 主从切换少量丢锁的问题，RedLock通过向多个独立节点加锁提高可靠性，但有争议。生产中大多数用Redisson+主从即可，极高可靠性场景用ZooKeeper更安全。

---

### 6.6 常见追问

**Q: SET NX和SETNX有什么区别？**
> `SETNX`是老命令，不支持同时设置过期时间，需额外`EXPIRE`，两步非原子。`SET key val NX EX ttl`是原子操作，**生产必用后者**。

**Q: Redisson看门狗什么情况不会续期？**
> `tryLock(waitTime, leaseTime, unit)`手动指定leaseTime（非-1）时，看门狗不启动，锁到期自动释放。只有leaseTime=-1才启用看门狗自动续期。

**Q: 分布式锁和数据库乐观锁怎么选？**
> 分布式锁（悟观）：写多冲突概率高、需要控制并发执行顺序。乐观锁（version字段）：读多写少冲突概率低，无额外中间件依赖，简单。

---

## 七、热Key & 大Key问题 ⭐⭐⭐⭐

### 7.1 热Key问题

**定义：** 某个key被极高频率访问，导致该节点CPU/带宽成为瓶颈

**发现方法：**
```bash
redis-cli --hotkeys          # Redis 4.0+，需开LFU淘汰策略
# 客户端统计每个key访问次数上报监控（推荐）
# MONITOR命令：实时抓包，生产慎用（性能损耗50%+）
```

**解决方案：**

**① 本地缓存（最有效）⭐**
```java
// Caffeine本地二级缓存，热key大部分请求本地命中不走Redis
Cache<String, Object> localCache = Caffeine.newBuilder()
    .maximumSize(1000)
    .expireAfterWrite(5, TimeUnit.SECONDS)
    .build();
Object value = localCache.get(key, k -> redis.get(k));
```

**② 热Key复制分片**
```
hot:key → hot:key:0 ~ hot:key:N
读取时随机选一个：hot:key:{random(0,N)}，将流量分散到多个节点
```

---

### 7.2 大Key问题

**判断标准：** String > 1MB； Hash/Set/ZSet/List 元素数 > 10000

**危害：** 内存倾斜、删除时阻塞Redis主线程、网络拥塞

**发现方法：**
```bash
redis-cli --bigkeys           # 扫描大Key（不阻塞）
MEMORY USAGE key              # 查看单个key内存占用
```

**解决方案：**

**① 拆分大Key⭐**
```
user:info:1（含1000个字段）
→ user:info:1:0 ~ user:info:1:9（每个Hash孙10个字段）
```

**② 异步删除（绝对不用DEL）⭐**
```bash
# ✖️ DEL：同步删除，阻塞Redis主线程（百万元素可能秒级）
DEL big:key
# ✅ UNLINK：异步删除，后台线程释放内存，Redis 4.0+
UNLINK big:key
# ✅ 渐进式删除：HSCAN分批获取字段再批量删除
HSCAN big:hash 0 COUNT 100 → HDEL big:hash field1 field2...
```

**③ 压缩Value：** gzip压缩后存储，读取时解压缩

---

### 7.3 面试标准答法

> **热Key**：某个key被极高频访问导致单节点瓶颈。用`--hotkeys`或客户端监控发现。最有效的方案是**本地Caffeine缓存**，大部分请求本地命中不走Redis；也可打散复制为N份，读取时随机选一个。
>
> **大Key**：单个key体积过大。危害是内存倾斜和删除时阻塞Redis主线程。用`--bigkeys`发现。解决：**拆分**大Key为多个小Key；删除时用**UNLINK**异步删除，绝不用DEL直接删除。

---

### 7.4 常见追问

**Q: 为什么DEL大Key会阻塞Redis？**
> Redis单线程处理命令，DEL一个百万元素的集合需逐一释放内存，耗时可能秒级，期间所有其他命令被阻塞。UNLINK将内存释放交给后台线程异步执行，主线程几乎不阻塞。

**Q: 本地缓存和Redis缓存一致性怎么保证？**
> 本地缓存设置较短的TTL（5~30秒），允许短暂数据不一致。更新时通过MQ广播通知所有实例清除本地缓存。极热场景接受最终一致性。

---

## 八、Redis事务 & Pipeline & Lua脚本 ⭐⭐⭐

### 8.1 Redis 事务

```bash
MULTI    # 开启事务
SET k1 v1 → QUEUED
INCR k2   → QUEUED
EXEC     # 提交执行，返回结果数组
DISCARD  # 放弃事务
```

**关键：Redis事务不支持回滚**
```bash
MULTI
SET k1 v1      # 正确
INCR k1        # 运行时错误（k1是字符串）
SET k2 v2      # 正确
EXEC
# k1=v1 ✅，INCR报错 ❌，k2=v2 ✅  ← k2照样执行，不会因中间出错回滚！
```

**WATCH（乐观锁）：**
```bash
WATCH balance          # 监视key
MULTI
DECRBY balance 100
EXEC
# 若EXEC前 balance被其他客户端修改 → EXEC返回nil，事务放弃，业务层重试
```

---

### 8.2 Pipeline（管道）

**目的：减少网络RTT，批量命令一次发送**

```java
// Jedis Pipeline
Pipeline pipeline = jedis.pipelined();
for (int i = 0; i < 1000; i++) {
    pipeline.set("key:" + i, "value:" + i);
}
List<Object> results = pipeline.syncAndReturnAll();
// 1000条命令仁需一次RTT，而非1000次
```

| | Pipeline | 事务(MULTI/EXEC) | Lua脚本 |
|--|---------|----------------|--------|
| **目的** | 减少RTT | 原子批量执行 | 复杂原子操作 |
| **原子性** | ❌ | ⚠️部分 | ✅强原子 |
| **条件判断** | ❌ | ❌ | ✅ |
| **错误回滚** | ❌ | ❌ | ✅ |

---

### 8.3 Lua 脚本

**优势：** 原子性最强，支持条件判断，减少RTT

```bash
EVAL script numkeys key1 ... arg1 ...
```

**经典案例：分布式锁释放**
```lua
-- 判断value是自己的锁才删除，原子操作
if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
else
    return 0
end
```

---

### 8.4 面试标准答法

> Redis事务通过MULTI/EXEC实现，EXEC期间不被打断保证隔离性。但**不支持回滚**：运行时错误只跳过出错命令，其他命令继续执行。WATCH实现乘观锁，监视key在EXEC前被其他客户端修改则放弃事务。
>
> **Pipeline**是纲络RTT优化，批量命令一次发送，不保证原子性。
>
> **Lua脚本**原子性最强，支持条件判断和错误处理，适合需要复杂逻辑的原子操作（如分布式锁的判断+删除）。

---

### 8.5 常见追问

**Q: Redis事务为什么不支持回滚？**
> Redis官方认为运行时错误通常是编程错误，不是需要回滚的业务场景。不支持回滚使实现更简单、性能更好。

**Q: Pipeline在Redis Cluster下有什么限制？**
> Pipeline中的所有key必须在同一个slot（同一节点），否则报错。解决：用Hash Tag`{tag}`强制路由到同一slot，或应用层按节点分组Pipeline请求。

**Q: Lua脚本和Pipeline怎么选？**
> 需要原子性或条件判断用Lua脚本；纯批量操作、对原子性无要求用Pipeline，性能更高。

