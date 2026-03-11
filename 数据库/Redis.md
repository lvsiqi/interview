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

#### ③ skiplist（跳表）—— ZSet核心 ⭐⭐⭐⭐⭐

**跳表结构（Redis 实现）：**

```c
// Redis 跳表节点
typedef struct zskiplistNode {
    sds ele;                          // member（如 "player:1001"）
    double score;                     // 分值（排序依据）
    struct zskiplistNode *backward;   // 后退指针（倒序遍历用）
    struct zskiplistLevel {
        struct zskiplistNode *forward; // 前进指针
        unsigned long span;            // 跨度（用于 ZRANK 计算排名）
    } level[];                        // 柔性数组，层级不固定
} zskiplistNode;

// Redis 跳表
typedef struct zskiplist {
    struct zskiplistNode *header, *tail; // 头尾节点
    unsigned long length;                // 节点总数
    int level;                           // 当前最大层级
} zskiplist;
```

**跳表层数随机决定：**

```
层数决定算法（幂次定律）：
  Level 1:  100%   → 所有节点都在第 1 层
  Level 2:  25%    → 约 1/4 的节点会升到第 2 层
  Level 3:  6.25%  → 约 1/16 的节点会升到第 3 层
  ...
  最大层级: ZSKIPLIST_MAXLEVEL = 32

代码逻辑：
  int level = 1;
  while ((random() & 0xFFFF) < (0.25 * 0xFFFF))  // p = 0.25
      level++;
  return min(level, ZSKIPLIST_MAXLEVEL);
```

**跳表查找过程可视化：**

```
查找 score=7 的元素：

Level 4: HEAD ───────────────────────→ 9 → NIL
              ↓
Level 3: HEAD ─────→ 3 ─────────────→ 9 → NIL
                     ↓
Level 2: HEAD → 1 → 3 ─────→ 7 ─────→ 9 → NIL
                              ↓         ✅ 找到！
Level 1: HEAD → 1 → 3 → 5 → 7 → 8 → 9 → NIL

查找路径：HEAD(L4) → HEAD(L3) → 3(L3) → 3(L2) → 7(L2) ✅
比较次数：4 次（vs 链表需 4 次，但数据量大时差距巨大）
```

**跳表核心操作复杂度：**

| 操作 | 复杂度 | 说明 |
|------|--------|------|
| 查找 | O(logN) | 从高层逐层向下 |
| 插入 | O(logN) | 查找位置 + 随机层数 + 插入 |
| 删除 | O(logN) | 查找位置 + 修改指针 |
| 范围查询 | O(logN + M) | 定位起点 + 沿底层链表遍历 M 个元素 |
| 排名查询 | O(logN) | 利用 span 字段累加计算 |

**span 字段的妙用（ZRANK 原理）：**

```
ZRANK key member → 返回 member 的排名

计算方式：从头节点到目标节点，沿查找路径累加 span 值

Level 2: HEAD ──(span=1)──→ A ──(span=2)──→ C ──(span=1)──→ NIL
Level 1: HEAD ──(span=1)──→ A ──(span=1)──→ B ──(span=1)──→ C → NIL

查 C 的排名：HEAD(L2).span=1 + A(L2).span=2 = 3，排名=3-1=2（0-based）
无需遍历所有节点，O(logN) 即可得到排名！
```

**⭐ 为什么ZSet用跳表不用红黑树？（面试必问）**

| 维度 | 跳表 | 红黑树 |
|------|------|--------|
| 范围查询 | O(logN) 定位 + 链表遍历，天然支持 ZRANGEBYSCORE | 需中序遍历，实现复杂 |
| 实现复杂度 | ~300 行 C 代码 | ~1000+ 行，旋转/变色逻辑复杂 |
| 内存局部性 | 链表节点分散，但层数少时接近 | B 树更好，红黑树一般 |
| 并发友好 | 可做无锁跳表（ConcurrentSkipListMap） | 旋转操作需锁整棵树 |
| 调试可读性 | 直观，打印即可理解 | 需要可视化工具 |

> **面试答法**：Redis 作者 Antirez 的原话：跳表实现比红黑树简单易调试，范围操作天然高效，且通过调整概率p可以在时间和空间之间灵活权衡。

### 1.2.1 ZSet 完整命令与应用场景 ⭐⭐⭐⭐

**核心命令详解：**

```bash
# ========== 基础操作 ==========
ZADD key score member [score member ...]   # 添加/更新成员
ZSCORE key member                           # 查分数 O(1)
ZRANK key member                            # 正序排名（0-based） O(logN)
ZREVRANK key member                         # 倒序排名 O(logN)
ZCARD key                                   # 成员总数 O(1)
ZCOUNT key min max                          # 分数区间内的成员数
ZINCRBY key increment member                # 分数递增（原子操作）

# ========== 范围查询 ==========
ZRANGE key start stop [WITHSCORES]          # 按排名正序取 O(logN+M)
ZREVRANGE key start stop [WITHSCORES]       # 按排名倒序取
ZRANGEBYSCORE key min max [LIMIT offset count]  # 按分数区间
ZRANGEBYLEX key min max                     # 按字典序（分数相同时）

# ========== 删除操作 ==========
ZREM key member [member ...]                # 删除成员
ZREMRANGEBYRANK key start stop              # 按排名范围删除
ZREMRANGEBYSCORE key min max                # 按分数范围删除

# ========== 集合操作 ==========
ZUNIONSTORE dest numkeys key1 key2 [WEIGHTS w1 w2] [AGGREGATE SUM|MIN|MAX]
ZINTERSTORE dest numkeys key1 key2          # 交集

# ========== Redis 6.2+ 统一命令 ==========
ZRANGE key min max [BYSCORE|BYLEX] [REV] [LIMIT offset count]
# 统一替代 ZRANGEBYSCORE、ZRANGEBYLEX、ZREVRANGE 等
```

**⭐ ZSet 经典应用场景：**

**场景一：实时排行榜**

```bash
# 游戏积分排行榜
ZADD leaderboard 2500 "player:1001"
ZADD leaderboard 3200 "player:1002"
ZADD leaderboard 2800 "player:1003"
ZINCRBY leaderboard 500 "player:1001"    # 加分（原子操作）

# Top 10 排行
ZREVRANGE leaderboard 0 9 WITHSCORES

# 查某玩家排名
ZREVRANK leaderboard "player:1001"       # 0-based，返回 0 表示第一名

# 查某分数段的玩家数
ZCOUNT leaderboard 2000 3000
```

**场景二：延迟队列**

```bash
# 用 score 存执行时间戳
ZADD delay:queue 1710000060 "order:1001"   # 60 秒后执行
ZADD delay:queue 1710000120 "order:1002"   # 120 秒后执行

# 消费者轮询：取出已到期的任务
ZRANGEBYSCORE delay:queue 0 {当前时间戳} LIMIT 0 10
# 取出后删除（Lua 脚本保证原子性）
```

```java
// Java 延迟队列消费者
public void consumeDelayQueue() {
    while (true) {
        long now = System.currentTimeMillis() / 1000;
        Set<String> tasks = redis.zrangeByScore("delay:queue", 0, now, 0, 10);
        if (tasks.isEmpty()) { Thread.sleep(500); continue; }
        for (String task : tasks) {
            // Lua 原子操作：ZREM 成功才执行（防止并发重复消费）
            if (redis.zrem("delay:queue", task) > 0) {
                processTask(task);
            }
        }
    }
}
```

**场景三：滑动窗口限流**

```bash
# 限制：每个用户 60 秒内最多 100 次请求
# key: rate:limit:{userId}   score: 时间戳   member: 唯一请求ID

MULTI
ZADD rate:limit:uid123 {now_ms} {request_uuid}   # 记录本次请求
ZREMRANGEBYSCORE rate:limit:uid123 0 {now_ms - 60000}  # 移除 60s 前的
ZCARD rate:limit:uid123                            # 当前窗口内请求数
EXPIRE rate:limit:uid123 61                        # 设过期防内存泄漏
EXEC
# 若 ZCARD 结果 > 100 → 拒绝请求
```

**场景四：带权重的 Timeline / Feed 流**

```bash
# 用发布时间戳做 score，实现时间线排序
ZADD feed:user:1001 1710000001 "post:5001"
ZADD feed:user:1001 1710000050 "post:5002"

# 分页获取 feed（倒序 + 分页）
ZREVRANGEBYSCORE feed:user:1001 +inf -inf LIMIT 0 20
```

**ZSet 面试追问补充：**

**Q: ZADD 的时间复杂度是多少？**
> O(logN)。先在跳表中找到插入位置（O(logN)），然后插入节点并更新 hashtable。如果 member 已存在是更新 score，需要先删旧位置再插新位置。

**Q: ZSet 两个 member 的 score 相同怎么排序？**
> score 相同时按 member 的字典序（memcmp）排序。可以利用这一特性配合 `ZRANGEBYLEX` 实现字典范围查询。

**Q: ZPOPMIN/ZPOPMAX 有什么用？**
> Redis 5.0+ 新增，原子弹出最小/最大 score 的元素，适合优先队列场景。`BZPOPMIN` 是阻塞版本，可做阻塞式优先队列。

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
| String | int / embstr | raw | 值为整数用int；≤44字节用embstr；否则raw |
| Hash | ziplist（7.0+: listpack） | hashtable | 元素数 > 128 **或** 值长度 > 64 |
| List | ziplist（7.0+: listpack） | quicklist | 元素数 > 512 **或** 值长度 > 64 |
| Set | intset | hashtable | 元素数 > 512 **或** 含非整数 |
| ZSet | ziplist（7.0+: listpack） | skiplist+hashtable | 元素数 > 128 **或** 值长度 > 64 |

---

### 1.5 redisObject 编码体系 ⭐⭐⭐

Redis 中**所有值**都是一个 `redisObject` 结构：

```c
typedef struct redisObject {
    unsigned type:4;      // 类型：String/Hash/List/Set/ZSet
    unsigned encoding:4;  // 编码方式（同一类型可有不同编码）
    unsigned lru:24;      // LRU时间戳 或 LFU频率+时间
    int refcount;         // 引用计数（共享对象 / 内存回收）
    void *ptr;            // 指向实际数据结构的指针
} robj;
```

**完整编码类型映射：**

```
┌──────────┬────────────────────────────────────────────────────┐
│  type     │  encoding 编码方式                                  │
├──────────┼────────────────────────────────────────────────────┤
│  String   │  OBJ_ENCODING_INT      → 8字节 long 直接存值       │
│           │  OBJ_ENCODING_EMBSTR   → SDS ≤ 44字节，与robj一体  │
│           │  OBJ_ENCODING_RAW      → SDS > 44字节，独立分配    │
├──────────┼────────────────────────────────────────────────────┤
│  Hash     │  OBJ_ENCODING_ZIPLIST  → 压缩列表（≤7.0 listpack）│
│           │  OBJ_ENCODING_HT       → 哈希表                    │
├──────────┼────────────────────────────────────────────────────┤
│  List     │  OBJ_ENCODING_QUICKLIST → quicklist（ziplist双向链表）│
│           │  (7.0+: quicklist 内部节点从 ziplist → listpack)    │
├──────────┼────────────────────────────────────────────────────┤
│  Set      │  OBJ_ENCODING_INTSET   → 整数集合                  │
│           │  OBJ_ENCODING_HT       → 哈希表                    │
│           │  OBJ_ENCODING_LISTPACK → (7.2+: 少量非整数元素)    │
├──────────┼────────────────────────────────────────────────────┤
│  ZSet     │  OBJ_ENCODING_ZIPLIST  → 压缩列表（≤7.0 listpack）│
│           │  OBJ_ENCODING_SKIPLIST → 跳表 + 哈希表             │
└──────────┴────────────────────────────────────────────────────┘
```

**String 三种编码详解：**

```bash
# int编码：值为整数（范围 long）
SET counter 42
OBJECT ENCODING counter    → "int"
# 优势：直接存 long，无 SDS 开销；共享对象池（0~9999 可共享）

# embstr编码：字符串 ≤ 44 字节
SET name "hello"
OBJECT ENCODING name       → "embstr"
# 优势：robj + SDS 一次内存分配，CPU 缓存友好

# raw编码：字符串 > 44 字节
SET bio "this is a very long biography string that exceeds 44 bytes..."
OBJECT ENCODING bio        → "raw"
# robj 和 SDS 分开分配，两次 malloc

# ⚠️ 44 字节的由来：
# robj(16B) + sdshdr8(3B) + 44B + '\0'(1B) = 64B，正好一个 jemalloc 内存块
```

**查看编码命令：**

```bash
OBJECT ENCODING key     # 查看 key 的底层编码
OBJECT REFCOUNT key     # 引用计数
OBJECT IDLETIME key     # 空闲时间（LRU 模式下）
OBJECT FREQ key         # 访问频率（LFU 模式下）
OBJECT HELP             # 帮助信息
DEBUG OBJECT key        # 调试信息（含编码、序列化大小等）
```

---

### 1.6 listpack（Redis 7.0+ 替代 ziplist）⭐⭐

**为什么替换 ziplist？**

ziplist 的**连锁更新**问题：每个节点都存储了前一个节点的长度，当某节点变大导致长度编码从 1 字节变 5 字节时，后续所有节点都可能需要重新编码，最坏 O(N²)。

```
listpack 的改进：
• 每个节点只记录自己的长度（不存前一个节点的长度）
• 从后向前遍历时通过自身 entry-len 反向定位，彻底消除连锁更新
• 内存布局更紧凑

listpack 结构：
[total-bytes] [num-elements] [entry1] [entry2] ... [end-byte(0xFF)]

每个 entry：
[encoding-type] [data] [entry-len(回溯用)]
```

> **面试答法**：Redis 7.0 用 listpack 替代了 ziplist 作为 Hash/ZSet/List 的小数据编码，解决了 ziplist 的连锁更新问题，性能更稳定。

---

### 1.7 面试标准答法

> Redis有5种基本类型。**String** 底层是SDS，有int/embstr/raw三种编码，≤44字节用embstr与robj一体分配更高效。**Hash** 小数据用ziplist（7.0+用listpack），大数据用hashtable。**List** 用quicklist，是ziplist/listpack组成的双向链表。**Set** 整数用intset，否则用hashtable。**ZSet** 用跳表+hashtable双结构，跳表支持O(logN)范围查询和排名计算（span字段），hashtable支持O(1)按member查score。
>
> 所有值都是redisObject封装，含type+encoding+lru+refcount+ptr 五个字段。Redis 7.0 用 listpack 替代 ziplist，解决了连锁更新问题。
>
> 另有Bitmap做签到统计、HyperLogLog做UV去重（误差0.81%，固定12KB）、Geo（基于ZSet）做地理位置计算。

---

### 1.8 常见追问

**Q: ZSet为什么同时用跳表和hashtable？**
> 跳表支持范围查询（ZRANGE），O(logN+M)；hashtable支持O(1)按member查score（ZSCORE）。两者互补，共享数据指针，内存开销可控。

**Q: HyperLogLog为什么只用12KB就能统计亿级UV？**
> 概率算法，通过统计哈希值最高位0的个数估算基数，不存储实际元素。固定12KB，误差约0.81%，适合对精度要求不高的场景。

**Q: Redis String最大能存多大？**
> 最大512MB，但实际不建议超过1MB，否则网络传输和序列化开销很大。

**Q: embstr 为什么是 44 字节而不是其他值？**
> robj(16B) + sdshdr8(3B) + 数据(44B) + '\0'(1B) = 64字节，恰好在 jemalloc 的一个内存分配块内，一次 malloc 即可，CPU 缓存友好且无内存碎片。

**Q: Redis 的 dict（hashtable）渐进式 rehash 是怎么做的？**
> dict 内部维护两个哈希表 ht[0] 和 ht[1]。扩容/缩容时创建新表 ht[1]，后续每次CRUD操作顺便迁移 ht[0] 的一个桶到 ht[1]（分摊到每次操作），同时定时任务也会批量迁移。查找时先查 ht[0] 再查 ht[1]。全部迁移完成后 ht[0] 指向ht[1]，释放旧表。好处是不会一次性阻塞主线程。

**Q: ZSet 做排行榜，如何实现"积分相同按时间先后排"？**
> score 设计为：`score = 积分 * 1e13 + (MAX_TS - 时间戳)`。积分高的 score 大排前面；积分相同时时间早的 `MAX_TS - ts` 更大排前面。或者用 Lua 脚本组合两个维度。

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

---

## 九、Redis 线程模型 ⭐⭐⭐⭐⭐

### 9.1 单线程模型（Redis 6.0 之前）

```
┌──────────────────────────────────────────────────────┐
│                   Redis 主线程                        │
│                                                      │
│   ┌──────────────────────────────────────────┐       │
│   │         I/O 多路复用 (epoll/kqueue)       │       │
│   │                                          │       │
│   │  Socket1 ─┐                              │       │
│   │  Socket2 ──┤→ 事件循环 → 命令解析         │       │
│   │  Socket3 ──┤         → 命令执行           │       │
│   │  Socket4 ─┘         → 结果回写           │       │
│   └──────────────────────────────────────────┘       │
│                                                      │
│   单线程依次处理：网络IO读 → 命令执行 → 网络IO写       │
│   整个过程在一个线程内完成，没有锁、没有上下文切换       │
└──────────────────────────────────────────────────────┘
```

**Redis 单线程为什么这么快？（⭐必问）**

| 原因 | 说明 |
|------|------|
| **纯内存操作** | 数据在内存中，读写延迟纳秒级 |
| **I/O 多路复用** | 一个线程监听多个连接的事件，避免阻塞等待 |
| **无锁无线程切换** | 省去锁竞争、上下文切换开销 |
| **高效数据结构** | SDS、跳表、ziplist 等针对场景优化 |
| **单线程串行执行** | 命令执行本身是顺序的，避免并发问题 |
| **事件驱动模型** | 基于 Reactor 模式，高效处理连接 |

> **面试答法**：Redis 单线程指的是**命令执行在单线程**中。它快的原因：① 纯内存操作 ② 基于 epoll 的 I/O 多路复用一个线程处理大量连接 ③ 没有锁和线程切换开销 ④ 高效的数据结构。瓶颈不在 CPU 而在网络 IO 和内存。

### 9.2 多线程 I/O（Redis 6.0+）⭐⭐⭐

```
┌──────────────────────────────────────────────────────────┐
│                   Redis 6.0+ 线程模型                      │
│                                                          │
│   ┌─────────┐  ┌─────────┐  ┌─────────┐                 │
│   │ IO线程1  │  │ IO线程2  │  │ IO线程3  │  ← 多线程读写   │
│   │ 读Socket │  │ 读Socket │  │ 读Socket │    网络数据      │
│   └────┬────┘  └────┬────┘  └────┬────┘                 │
│        │            │            │                        │
│        ▼            ▼            ▼                        │
│   ┌──────────────────────────────────────┐               │
│   │          主线程（单线程执行命令）       │               │
│   │    命令解析 → 执行 → 生成响应         │               │
│   └──────────────────────────────────────┘               │
│        │            │            │                        │
│        ▼            ▼            ▼                        │
│   ┌─────────┐  ┌─────────┐  ┌─────────┐                 │
│   │ IO线程1  │  │ IO线程2  │  │ IO线程3  │  ← 多线程回写   │
│   │ 写Socket │  │ 写Socket │  │ 写Socket │    响应数据      │
│   └─────────┘  └─────────┘  └─────────┘                 │
└──────────────────────────────────────────────────────────┘

关键：命令执行仍然是单线程，只是网络 IO 读写并行化
```

**配置开启：**

```bash
# redis.conf
io-threads 4          # IO 线程数（含主线程），建议 CPU 核数的一半，不超过 8
io-threads-do-reads yes  # 读也用多线程（默认只多线程写）
```

**适用场景**：QPS 极高（10w+）、大 value 传输导致网络 IO 成瓶颈时。一般场景默认单线程即可。

### 9.3 后台线程（一直存在）

```
即使在 Redis 6.0 之前，Redis 也不是严格的纯单线程：

BIO 线程 1: close(fd)         → 异步关闭文件描述符
BIO 线程 2: fsync(aof_fd)     → AOF 刷盘
BIO 线程 3: lazyfree           → 异步释放大对象内存（UNLINK、FLUSHDB ASYNC）

这些后台线程处理耗时的 IO 操作，不影响主线程命令处理
```

### 9.4 面试标准答法

> Redis 单线程指的是**命令处理在单线程**完成，快的原因是纯内存操作、I/O 多路复用、无锁无上下文切换、高效数据结构。
>
> **Redis 6.0** 引入多线程 IO：多个线程并行读写网络数据，但**命令执行仍然单线程**，既利用了多核做网络 IO 又保证了命令执行的线程安全。此外 Redis 一直有后台线程处理 AOF 刷盘、大对象异步释放等耗时操作。

### 9.5 常见追问

**Q: Redis 单线程能用满 CPU 多核吗？**
> 单实例只能用一个核（命令执行）。生产环境通过部署多个实例（一机多实例 / Cluster 多分片）利用多核。Redis 6.0+ IO 多线程可以利用多核做网络读写。

**Q: Redis 6.0 多线程为什么不把命令执行也并行化？**
> 核心原因是避免引入锁。Redis 数据结构在设计时不考虑并发安全，如果命令并行化需要加锁，复杂度和开销都会大幅增加。实际瓶颈通常在网络 IO 而非 CPU 命令执行。

**Q: Redis 处理一个命令的完整过程？**
> ① 客户端发送命令 → ② epoll 监测到可读事件 → ③ 读取请求到输入缓冲区 → ④ 解析 RESP 协议 → ⑤ 查找命令表 → ⑥ 执行命令（操作内存数据结构）→ ⑦ 写入响应到输出缓冲区 → ⑧ epoll 检测可写事件 → ⑨ 回写给客户端。其中 ③⑧⑨ 在 6.0+ 可多线程，⑥ 始终单线程。

---

## 十、内存管理与优化 ⭐⭐⭐

### 10.1 Redis 内存组成

```
Redis 内存 = 数据内存 + 进程内存 + 缓冲内存 + 内存碎片

数据内存：键值对、过期字典、redisObject、SDS 等
进程内存：代码段、常驻集、子进程（BGSAVE/BGREWRITEAOF 时 COW 额外占用）
缓冲内存：客户端输入/输出缓冲区、AOF 缓冲区、复制缓冲区
内存碎片：频繁 alloc/free 导致的碎片（mem_fragmentation_ratio）
```

### 10.2 内存信息查看

```bash
INFO memory
# used_memory:           Redis 分配器分配的内存总量
# used_memory_rss:       OS 看到的 Redis 进程占用物理内存
# mem_fragmentation_ratio: RSS / used_memory
#   > 1.5 → 碎片严重，需处理
#   < 1   → 有内存被 swap 到磁盘，性能大降！
# used_memory_peak:      内存使用峰值

MEMORY USAGE key         # 查看单个 key 内存占用（含 redisObject 开销）
MEMORY DOCTOR             # 内存诊断建议
MEMORY STATS              # 详细内存统计
```

### 10.3 内存优化手段

| 手段 | 说明 |
|------|------|
| **选择合适的数据结构** | Hash 替代多个 String 存对象字段，内存可省 50%+ |
| **控制 key 命名长度** | `u:1001:n` 比 `user:1001:name` 省内存 |
| **使用小编码** | 控制元素数和值长度让 Hash/ZSet/List 保持 ziplist/listpack 编码 |
| **整数共享对象** | 0~9999 的整数 String 共享同一 robj，refcount > 1 |
| **合理设置 TTL** | 避免大量不过期的无用 key 堆积 |
| **大 Key 拆分** | 拆分为多个小 key |
| **主动碎片整理** | `activedefrag yes`（Redis 4.0+，基于 jemalloc） |
| **使用 OBJECT ENCODING** | 确认编码是否符合预期 |

```bash
# Hash 存对象 vs 多个 String
# ❌ 300 bytes per key
SET user:1001:name "Tom"
SET user:1001:age "25"
SET user:1001:email "tom@example.com"

# ✅ 只有一个 key 的 redisObject 开销，ziplist 编码更紧凑
HSET user:1001 name "Tom" age "25" email "tom@example.com"
# 内存可节省 50% 以上
```

### 10.4 内存碎片整理（Redis 4.0+）

```bash
# 开启主动碎片整理
config set activedefrag yes

# 相关参数
active-defrag-enabled yes
active-defrag-ignore-bytes 100mb       # 碎片超过 100MB 才开始
active-defrag-threshold-lower 10       # 碎片率超过 10% 才开始
active-defrag-threshold-upper 100      # 碎片率超过 100% 全力执行
active-defrag-cycle-min 1              # 最小 CPU 占用百分比
active-defrag-cycle-max 25             # 最大 CPU 占用百分比
```

### 10.5 面试标准答法

> Redis 内存由数据、进程、缓冲区、碎片四部分组成。用 `INFO memory` 查看，重点关注 `mem_fragmentation_ratio`：大于 1.5 碎片严重需开启 `activedefrag`；小于 1 说明有 swap 性能会剧降。优化手段：Hash 替代多 String、控制元素让数据保持紧凑编码、合理 TTL、大 Key 拆分。

---

## 十一、Pub/Sub 与 Stream ⭐⭐⭐

### 11.1 Pub/Sub 发布订阅

```bash
# 订阅频道
SUBSCRIBE channel1 channel2

# 发布消息
PUBLISH channel1 "hello"

# 模式订阅（通配符）
PSUBSCRIBE order.*      # 匹配 order.create、order.pay 等
```

**局限性（⚠️ 面试重点）：**

| 问题 | 说明 |
|------|------|
| **消息不持久化** | 不存储消息，订阅者离线期间的消息丢失 |
| **没有 ACK 机制** | 无法确认消息是否被消费 |
| **没有消费者组** | 所有订阅者收到相同消息（广播模式），不支持负载均衡 |
| **无回溯能力** | 无法重新消费历史消息 |

> **适用场景**：实时通知、配置变更广播、聊天室等**允许丢消息**的场景。严肃的消息队列应用推荐 Stream 或外部 MQ。

---

### 11.2 Stream（Redis 5.0+）⭐⭐⭐

Stream 是 Redis 内建的**持久化消息队列**，类似 Kafka 的设计理念。

```
┌──────────────────────────────────────────────────┐
│                    Stream                        │
│                                                  │
│  ID(时间戳-序号)    field1  value1  field2 value2 │
│  1710000001-0      user    "tom"   action "buy"  │
│  1710000002-0      user    "bob"   action "view" │
│  1710000003-0      user    "tom"   action "pay"  │
│                                                  │
│  消费者组 A:                                      │
│    consumer-1: 已消费到 1710000002-0              │
│    consumer-2: 已消费到 1710000001-0              │
│  消费者组 B:                                      │
│    consumer-3: 已消费到 1710000003-0              │
└──────────────────────────────────────────────────┘
```

**核心命令：**

```bash
# ====== 生产者 ======
XADD mystream * field1 value1 field2 value2   # * 自动生成ID
XADD mystream MAXLEN ~ 10000 * msg "hello"    # 限制最大长度（~近似裁剪）

# ====== 独立消费（类似 List）======
XREAD COUNT 10 BLOCK 5000 STREAMS mystream 0  # 从头开始读
XREAD COUNT 10 BLOCK 5000 STREAMS mystream $  # 只读新消息（阻塞等待）

# ====== 消费者组（⭐ 核心能力）======
XGROUP CREATE mystream mygroup 0              # 创建消费者组（从头消费）
XGROUP CREATE mystream mygroup $ MKSTREAM     # 只消费新消息

XREADGROUP GROUP mygroup consumer-1 COUNT 10 BLOCK 5000 STREAMS mystream >
#  >  表示读未分配的新消息

# ====== ACK 确认 ======
XACK mystream mygroup 1710000001-0            # 确认已消费

# ====== 查看待确认消息（PEL）======
XPENDING mystream mygroup                     # 查看 pending 概况
XPENDING mystream mygroup - + 10              # 查看具体 pending 消息

# ====== 消息转移（消费者宕机，转给其他消费者）======
XCLAIM mystream mygroup consumer-2 3600000 1710000001-0  # idle > 1小时的转移

# ====== 管理 ======
XLEN mystream                                 # 消息数量
XINFO STREAM mystream                         # Stream 信息
XINFO GROUPS mystream                         # 消费者组信息
XINFO CONSUMERS mystream mygroup              # 消费者信息
XTRIM mystream MAXLEN ~ 10000                 # 裁剪
XDEL mystream 1710000001-0                    # 删除消息
```

**Stream vs Pub/Sub vs List vs Kafka 对比：**

| 特性 | Pub/Sub | List | Stream | Kafka |
|------|---------|------|--------|-------|
| 持久化 | ❌ | ✅ | ✅ | ✅ |
| 消费者组 | ❌ | ❌ | ✅ | ✅ |
| ACK 机制 | ❌ | ❌ | ✅ | ✅ |
| 消息回溯 | ❌ | ❌ | ✅ | ✅ |
| 阻塞读取 | ✅ | ✅(BRPOP) | ✅ | ✅ |
| 吞吐量 | 中 | 中 | 中 | **极高** |
| 适用场景 | 广播通知 | 简单队列 | 轻量级MQ | 大规模MQ |

> **面试答法**：Redis Stream 是 5.0+ 内建的消息队列，支持消费者组、ACK 确认、pending 列表、消息回溯，适合轻量级消息队列场景。比 Pub/Sub 更可靠（持久化+ACK），比外部 MQ 更轻量。但吞吐量和功能不如 Kafka/RocketMQ，大规模场景仍需专业 MQ。

---

## 十二、Redis 高级应用场景 ⭐⭐⭐⭐

### 12.1 分布式限流

**方案一：固定窗口（INCR + EXPIRE）**

```bash
# 每分钟限流 100 次
key = "rate:{ip}:{分钟时间戳}"
current = INCR key
if current == 1: EXPIRE key 60
if current > 100: 拒绝请求
```

**方案二：滑动窗口（ZSet）**

```lua
-- Lua 脚本实现滑动窗口限流
local key = KEYS[1]
local limit = tonumber(ARGV[1])    -- 限流阈值
local window = tonumber(ARGV[2])   -- 窗口大小(ms)
local now = tonumber(ARGV[3])      -- 当前时间(ms)

redis.call('ZREMRANGEBYSCORE', key, 0, now - window)  -- 移除窗口外的
local count = redis.call('ZCARD', key)
if count < limit then
    redis.call('ZADD', key, now, ARGV[4])   -- ARGV[4]=唯一ID
    redis.call('PEXPIRE', key, window)
    return 1   -- 允许
else
    return 0   -- 拒绝
end
```

**方案三：令牌桶（Redis + Lua）**

```lua
-- 令牌桶算法
local key = KEYS[1]
local rate = tonumber(ARGV[1])       -- 每秒放入令牌数
local capacity = tonumber(ARGV[2])   -- 桶容量
local now = tonumber(ARGV[3])        -- 当前时间(秒)
local requested = tonumber(ARGV[4])  -- 请求令牌数

local data = redis.call('HMGET', key, 'tokens', 'timestamp')
local tokens = tonumber(data[1]) or capacity
local last_time = tonumber(data[2]) or now

-- 计算新增令牌
local elapsed = math.max(0, now - last_time)
tokens = math.min(capacity, tokens + elapsed * rate)

if tokens >= requested then
    tokens = tokens - requested
    redis.call('HMSET', key, 'tokens', tokens, 'timestamp', now)
    redis.call('EXPIRE', key, math.ceil(capacity / rate) + 1)
    return 1    -- 允许
else
    redis.call('HMSET', key, 'tokens', tokens, 'timestamp', now)
    redis.call('EXPIRE', key, math.ceil(capacity / rate) + 1)
    return 0    -- 拒绝
end
```

### 12.2 分布式 Session

```java
// Spring Session + Redis 实现分布式 Session
// 原理：Session 存储在 Redis 而非单机内存，所有节点共享

@Configuration
@EnableRedisHttpSession(maxInactiveIntervalInSeconds = 1800)
public class SessionConfig {
    // Spring 自动将 HttpSession 序列化存到 Redis
    // Key: spring:session:sessions:{sessionId}
    // 类型: Hash（存 attributes、creationTime、lastAccessedTime）
}

// 无需改动业务代码
request.getSession().setAttribute("user", userObj);
```

### 12.3 全局唯一 ID 生成

```bash
# 利用 INCR 原子递增
INCR order:id:2024:03:11           # 每天一个 key，天然递增
# 实际 ID = 时间戳(32bit) + 序号(32bit)
```

```java
// Java 实现
public long generateId(String keyPrefix) {
    long timestamp = LocalDate.now().toEpochDay();  // 天级别
    long count = stringRedisTemplate.opsForValue()
        .increment("icr:" + keyPrefix + ":" + timestamp);
    return timestamp << 32 | count;  // 高32位时间戳 + 低32位序号
}
```

### 12.4 分布式 BitMap 统计

```bash
# 用户连续签到统计（每用户每月一个 Bitmap）
SETBIT sign:uid:1001:2024:03 0 1    # 3月1日签到
SETBIT sign:uid:1001:2024:03 1 1    # 3月2日签到
SETBIT sign:uid:1001:2024:03 3 1    # 3月4日签到

BITCOUNT sign:uid:1001:2024:03      # 本月签到天数 → 3

# 连续签到天数（从今天往前数）
BITFIELD sign:uid:1001:2024:03 GET u11 0
# 获取前 11 天的位图，然后应用层右移 & 1 计算连续 1 的个数

# 统计月活用户（所有用户共用一个 Bitmap）
SETBIT active:2024:03 1001 1         # uid=1001 活跃
SETBIT active:2024:03 1002 1
BITCOUNT active:2024:03              # 本月活跃用户数
# 亿级用户只需约 12MB 内存
```

---

## 十三、运维与性能优化 ⭐⭐⭐

### 13.1 危险命令与规避

| 命令 | 危险原因 | 替代方案 |
|------|---------|---------|
| `KEYS *` | O(N) 全量扫描，阻塞主线程 | `SCAN 0 MATCH pattern COUNT 100`（游标分批）|
| `FLUSHDB` / `FLUSHALL` | 清空所有数据 | `FLUSHDB ASYNC`（4.0+ 异步）|
| `DEL bigkey` | 大 Key 同步删除阻塞 | `UNLINK bigkey`（4.0+ 异步）|
| `MONITOR` | 全量打印命令，性能损耗 50%+ | 只调试用，生产禁止长期开启 |
| `SAVE` | 同步 RDB 阻塞所有命令 | `BGSAVE` |

```bash
# 生产环境禁用危险命令
rename-command KEYS ""
rename-command FLUSHDB ""
rename-command FLUSHALL ""
rename-command DEBUG ""
```

### 13.2 SCAN 命令详解

```bash
# SCAN 游标迭代（不阻塞主线程）
SCAN 0 MATCH "user:*" COUNT 100
# 返回 [next_cursor, [key1, key2, ...]]
# cursor=0 表示迭代完成

# 各类型专用 SCAN
HSCAN key cursor MATCH pattern COUNT count
SSCAN key cursor MATCH pattern COUNT count
ZSCAN key cursor MATCH pattern COUNT count

# ⚠️ 注意：
# 1. 可能返回重复 key（应用层去重）
# 2. COUNT 是建议值，实际返回数可能不同
# 3. 迭代过程中新增/删除的 key 可能会或不会被遍历到
```

### 13.3 慢查询日志

```bash
# 配置
slowlog-log-slower-than 10000   # 超过 10ms 记录慢查询（微秒）
slowlog-max-len 128             # 最多保存 128 条

# 查看
SLOWLOG GET 10                  # 最近 10 条慢查询
SLOWLOG LEN                     # 当前慢查询数量
SLOWLOG RESET                   # 清空

# 每条记录包含：
# [唯一ID, 时间戳, 耗时(微秒), 命令及参数, 客户端IP, 客户端名]
```

### 13.4 Redis 性能优化 Checklist

```
┌─────────────────────────────────────────────────────────────────┐
│                    Redis 性能优化检查清单                          │
├────────────────┬────────────────────────────────────────────────┤
│  🔑 Key 设计    │ • key 尽量短（但要有业务含义）                   │
│                │ • 避免大 Key（String < 1MB，集合 < 1 万元素）    │
│                │ • 所有 key 设置合理 TTL                          │
│                │ • 使用 SCAN 替代 KEYS                           │
├────────────────┼────────────────────────────────────────────────┤
│  📦 数据结构     │ • Hash 替代多 String 存对象                     │
│                │ • 控制元素数保持紧凑编码(ziplist/listpack)        │
│                │ • OBJECT ENCODING 确认编码符合预期               │
│                │ • 整数值充分利用共享对象（0~9999）                │
├────────────────┼────────────────────────────────────────────────┤
│  🚀 命令使用     │ • 批量操作用 MGET/MSET/Pipeline                 │
│                │ • 删大 Key 用 UNLINK 不用 DEL                   │
│                │ • 禁止 KEYS/MONITOR/SAVE 等阻塞命令             │
│                │ • Lua 脚本注意不要太长阻塞主线程                  │
├────────────────┼────────────────────────────────────────────────┤
│  💾 持久化       │ • 开启混合持久化 aof-use-rdb-preamble yes      │
│                │ • AOF 用 everysec 策略                          │
│                │ • 避免频繁 BGSAVE（控制 save 配置）              │
│                │ • 预留足够内存给 fork COW（≥ 物理内存的 50%）     │
├────────────────┼────────────────────────────────────────────────┤
│  🌐 网络与连接   │ • 使用连接池（maxTotal/maxIdle 合理设置）        │
│                │ • timeout 设置合理（避免长期空闲连接占资源）       │
│                │ • tcp-backlog 调大（高并发场景）                  │
│                │ • 6.0+ 考虑开启 IO 多线程                        │
├────────────────┼────────────────────────────────────────────────┤
│  📊 监控告警     │ • INFO 指标监控：内存/连接数/QPS/命中率           │
│                │ • 慢查询日志定期分析                              │
│                │ • mem_fragmentation_ratio 碎片率                 │
│                │ • 大 Key / 热 Key 定期扫描                       │
└────────────────┴────────────────────────────────────────────────┘
```

### 13.5 关键监控指标

```bash
INFO stats
# instantaneous_ops_per_sec   → QPS
# keyspace_hits / keyspace_misses → 缓存命中率（hits/(hits+misses)）
# rejected_connections → 拒绝连接数（maxclients 不够）

INFO clients
# connected_clients → 当前连接数
# blocked_clients   → 阻塞的连接数

INFO memory
# used_memory / used_memory_rss / mem_fragmentation_ratio

INFO replication
# master_link_status → 主从连接状态
# master_last_io_seconds_ago → 主从最后一次同步时间差

# 告警阈值建议
# 内存使用率 > 80%
# 碎片率 > 1.5
# 连接数 > maxclients * 80%
# 缓存命中率 < 90%
# 主从延迟 > 10 秒
```

### 13.6 面试标准答法

> Redis 性能优化从几个维度：**Key 设计**上避免大 Key、所有 Key 设 TTL、用 SCAN 替代 KEYS；**数据结构**上 Hash 替代多 String、控制元素数保持紧凑编码；**命令层面**用 Pipeline 批量化、UNLINK 异步删除、禁止 KEYS 等阻塞命令；**持久化**开混合持久化、预留 COW 内存；**运维层面**监控 QPS/命中率/内存碎片率/慢查询，定期扫描大 Key 和热 Key。

### 13.7 常见追问

**Q: Redis 缓存命中率低怎么办？**
> 1. 检查是否有大量缓存穿透（查不存在的 Key）→ 加布隆过滤器
> 2. 检查 TTL 是否过短导致频繁过期 → 适当延长
> 3. 检查 maxmemory 是否过小导致频繁淘汰 → 扩容或优化淘汰策略
> 4. 检查是否有大量冷数据占用内存 → 改用 LFU 淘汰策略

**Q: Redis 连接数暴涨怎么排查？**
> `CLIENT LIST` 查看所有连接来源 IP 和空闲时间  
> `INFO clients` 看 connected_clients  
> 常见原因：① 连接池配置不当（maxTotal 过大）② 连接泄漏（未 close/归还）③ 慢查询阻塞导致连接等待堆积

