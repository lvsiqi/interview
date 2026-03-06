# MySQL 知识点

> 最后更新：2026年3月5日

---

## 一、索引原理（B+树、聚簇索引、覆盖索引）⭐⭐⭐⭐

### 1.1 为什么用 B+ 树
- 非叶子节点只存key，每页能存更多索引，树更矮（一般3~4层），减少磁盘IO
- 叶子节点通过双向链表连接，支持**范围查询**
- 3层B+树可存约 **2000万条数据**
- 哈希索引不支持范围查询/排序/前缀匹配，不适合做主索引

### 1.2 聚簇索引 vs 二级索引
| | 聚簇索引（主键） | 二级索引 |
|--|-------------|----------|
| 叶子节点存储 | **完整行数据** | 索引列値 + 主键値 |
| 查询方式 | 直接获得数据 | 需要**回表**（再查聚簇索引） |
| 数据顺序 | 按主键有序存储 | - |

- InnoDB必顿有聚簇索引：主键→第一个唯一非空索引→自动生成隐藏 rowid
- 主键建议**单调递增**，UUID随机插入导致页分裃

### 1.3 覆盖索引
- 查询所需列全在索引中，无需回表
- EXPLAIN 的 `Extra: Using index` 表示覆盖索引
- 实际开发常用：`SELECT id,name` 配合联合索引，避免回表

### 1.4 联合索引 & 最左前缀原则
```sql
-- 联合索引 idx(a,b,c)
✅ WHERE a=1                   -- 用到a
✅ WHERE a=1 AND b=2           -- 用到a,b
✅ WHERE a=1 AND b=2 AND c=3   -- 用到a,b,c
❌ WHERE b=2                   -- 没有a，失效
✅ WHERE a=1 AND b>2 AND c=3   -- 用到a,b，b范围后c失效
```
- 本质：索引按a→b→c有序排列，a确定名b才有序，必顿从最左列开始匹配

### 1.5 索引下推（ICP）
- MySQL 5.6+，存储引擎在索引层过滤，减少回表次数
- EXPLAIN `Extra: Using index condition`

### 1.6 面试标准答法
> InnoDB用B+树，非叶子节点只存key树更矮，叶子节点链表连接支持范围查询。3层可存约2000万条。
> 聚簇索引叶子节点存完整行数据；二级索引存索引列+主键，查询需要回表。
> 覆盖索引无需回表，性能最优。联合索引遵循最左前缀原则，范围查询后索引列失效。

### 1.7 常见追问
| 追问 | 关键答点 |
|------|----------|
| B树和B+树的区别？ | B树非叶子节点存数据，B+树不存；B+树叶子节点有链表，支持范围查询 |
| 为什么不用哈希索引？ | 不支持范围查询/排序/前缀匹配 |
| 回表代价大吗？ | 每次回表是一次随机IO，要尽量用覆盖索引 |
| 聚簇索引一定是主键吗？ | 不一定，主键>第一个唯一非空索引>自动生成隐藏rowid |

---

## 二、索引失效场景 ⭐⭐⭐

### 2.1 十大失效场景

| 场景 | 示例 | 说明 |
|------|------|------|
| 违反最左前缀 | `WHERE b=2`（联合索引idx(a,b,c)） | 跳过最左列 |
| **函数/运算操作** | `WHERE YEAR(create_time)=2024` | 改变了值，B+树找不到 |
| **隐式类型转换** | varchar字段 `WHERE phone=138...`（数字） | 相当于对字段加了转换函数 |
| **LIKE左模糊** | `WHERE name LIKE '%张'` | 不知道从哪开始找 |
| OR含非索引列 | `WHERE name='x' OR age=18`（age无索引） | 无法用索引过滤全部 |
| NOT IN / != | `WHERE status != 1` | 扫描数据多，优化器放弃 |
| 范围查询后续列 | `WHERE a=1 AND b>2 AND c=3` | b范围内c无序 |
| IS NOT NULL | 数据大部分非NULL时 | 优化器选择全表 |
| 数据量占比大 | status只有0/1，大量数据=1 | 优化器主动选全表 |
| SELECT * | 阻止覆盖索引 | 非直接失效，但多回表 |

### 2.2 失效本质
- 索引 = B+树有序排列，失效 = **无法利用有序性**
- 函数/运算/类型转换 → 值被改变，B+树中找不到
- LIKE左模糊 → 不知道从哪里开始找
- 范围查询后续列 → 该范围内后续列无序

### 2.3 EXPLAIN 关键字段
| 字段 | 关注点 |
|------|--------|
| `type` | const > ref > range > index > **ALL**（ALL最差） |
| `key` | NULL = 未走索引 |
| `rows` | 越小越好 |
| `Extra` | `Using index`好；`Using filesort`/`Using temporary`需优化 |

### 2.4 面试标准答法
> 常见失效：函数/运算、隐式类型转换、LIKE左模糊、OR有非索引列、违反最左前缀。
> 本质是无法利用B+树的有序性。
> 用EXPLAIN分析，重点看type（ALL=全表）、key（NULL=未走索引）、Extra（filesort需优化）。
> 字符串字段用数字查询失效，因MySQL对字段列做了隐式转换函数；数字字段用字符串查询不失效。

### 2.5 常见追问
| 追问 | 关键答点 |
|------|----------|
| LIKE '%xxx' 怎么优化？ | 全文索引 or Elasticsearch |
| 如何强制走索引？ | `FORCE INDEX(idx_name)` |
| 联合索引哪列放前面？ | 区分度高的放前面；等值查询列放范围查询列前面 |

---

## 三、事务隔离级别 & MVCC原理 ⭐⭐⭐⭐

### 3.1 四大事务特性 ACID
| 特性 | 实现 |
|------|------|
| 原子性 | undo log 回滚 |
| 一致性 | 由其他三个共同保证 |
| **隔离性** | MVCC + 锁 |
| 持久性 | redo log 刷盘 |

### 3.2 并发事务三大问题
- **脏读**：读到另一事务未提交的数据
- **不可重复读**：同一事务内两次读同一数据结果不同（其他事务UPDATE）
- **幻读**：同一事务内两次查询记录数不同（其他事务INSERT/DELETE）

### 3.3 四种隔离级别
| 隔离级别 | 脏读 | 不可重复读 | 幻读 |
|---------|------|-----------|------|
| READ UNCOMMITTED | ❌ | ❌ | ❌ |
| READ COMMITTED | ✅ | ❌ | ❌ |
| **REPEATABLE READ（默认）** | ✅ | ✅ | ⚠️基本无 |
| SERIALIZABLE | ✅ | ✅ | ✅ |

> MySQL InnoDB默认RR，配合间隙锁基本解决幻读

### 3.4 MVCC 三大组件

**① 隐藏字段**：每行记录含 DB_TRX_ID（最近修改事务ID）、DB_ROLL_PTR（回滚指针）、DB_ROW_ID

**② undo log 版本链**
```
当前版本：name='李四', TRX_ID=4 →
  旧版本：name='张三', TRX_ID=2 →
    旧版本：name='王五', TRX_ID=1 → null
```

**③ Read View（读视图）**
```
m_ids：生成时当前活跃（未提交）的事务ID列表
min_trx_id：m_ids中最小的事务ID
max_trx_id：下一个待分配事务ID
creator_trx_id：创建该Read View的事务ID
```

**可见性判断规则（对版本链中某版本的 trx_id）：**
```
trx_id == creator_trx_id → 自己改的 ✅ 可见
trx_id < min_trx_id     → 已提交 ✅ 可见
trx_id >= max_trx_id    → 还没开始 ❌ 不可见
min_trx_id ≤ trx_id < max_trx_id：
  在m_ids中 → 未提交 ❌ 不可见
  不在m_ids中 → 已提交 ✅ 可见
→ 顺着版本链找到第一个可见版本
```

### 3.5 RC vs RR 核心区别
| | RC | RR |
|--|----|----|  
| Read View 生成时机 | 每次 SELECT 重新生成 | 事务内第一次 SELECT 生成，不变 |
| 能否看到其他事务提交 | ✅ 能看到 | ❌ 看不到 |
| 问题 | 不可重复读 | 已解决 |

### 3.6 快照读 vs 当前读
- **快照读**：普通 SELECT，MVCC读历史版本，不加锁
- **当前读**：SELECT FOR UPDATE、INSERT、UPDATE、DELETE，加锁读最新版本
- 幻读：快照读由MVCC解决；当前读由间隙锁解决

### 3.7 面试标准答法
> MySQL InnoDB默认RR，MVCC通过undo log版本链+Read View实现无锁读。
> RC每次SELECT重新生成Read View，能看到其他事务提交，产生不可重复读；
RR整个事务共用同一Read View，解决不可重复读。
> MVCC只对快照读有效，当前读需要间隙锁防幻读。

### 3.8 常见追问
| 追问 | 关键答点 |
|------|----------|
| MVCC能完全解决幻读吗？ | 不能，快照读+当前读混用时仍可能幻读 |
| undo log和redo log区别？ | undo用于回滚（原子性）；redo用于崩溃恢复（持久性） |
| Read View什么时候创建？ | RC：每次SELECT；RR：事务内第一次SELECT |
| InnoDB为什么用RR不用RC？ | 早期MySQL主从复制statement格式，RC下可能主从不一致 |

---

## 四、Buffer Pool & Change Buffer & redo/undo/binlog ⭐⭐⭐⭐

### 4.1 Buffer Pool（缓冲池）

> InnoDB 最核心的内存结构，**所有数据的读写都经过 Buffer Pool**

```
磁盘 ←→ Buffer Pool（内存）←→ SQL执行
```

**Buffer Pool 中存什么？**
```
Buffer Pool
├── 数据页（Data Page）        ← 缓存磁盘数据页
├── 索引页（Index Page）       ← 缓存索引数据
├── undo 页                   ← undo log 页
├── 自适应哈希索引（AHI）      ← 热点数据加速
├── Insert Buffer / Change Buffer
└── 锁信息、数据字典等
```

**LRU 淘汰策略（改进版）：**
```
传统 LRU 的问题：全表扫描会把热点数据挤出去

InnoDB 改进：将 LRU 链表分为两部分
┌─────────────────┬──────────────┐
│  young 区（热数据，5/8）│ old 区（冷数据，3/8）│
└─────────────────┴──────────────┘

① 新页加载进来：先放 old 区头部
② 在 old 区停留超过 1 秒后再次访问：移到 young 区头部
③ 全表扫描的页：在 old 区很快被淘汰，不影响 young 区热数据
```

**关键参数：**
```bash
innodb_buffer_pool_size = 物理内存的 60%~80%  # 越大越好
innodb_buffer_pool_instances = 8              # 多实例减少锁竞争
```

---

### 4.2 Change Buffer（写缓冲）⭐⭐

> **只针对非唯一二级索引**的写操作优化

**为什么需要 Change Buffer？**
```
写入数据时，不仅要更新聚簇索引，还要更新所有二级索引
二级索引页可能不在 Buffer Pool 中 → 需要随机磁盘IO，性能差

Change Buffer 解决方案：
① 二级索引页不在 Buffer Pool 中时
② 先把变更记录到 Change Buffer（在内存中）
③ 不立即读入索引页，避免随机IO
④ 后续该索引页被读入 Buffer Pool 时，合并 Change Buffer 中的变更（merge）
⑤ 或后台线程定期 merge 到磁盘
```

**为什么只针对非唯一二级索引？**
```
唯一索引写入时必须判断是否重复 → 必须读取索引页到内存 → 无法延迟
非唯一索引不需要判断重复 → 可以先缓存变更
```

**Change Buffer 适合的场景：**
- 写多读少（数据写入后短期内不会被读取）
- 不适合：写完马上读，会触发立即 merge，反而增加开销

---

### 4.3 redo log（重做日志）⭐⭐⭐

> 保证事务**持久性（D）**，实现 InnoDB 的 **crash-safe** 能力

**为什么需要 redo log？**
```
问题：Buffer Pool 中修改了数据页（脏页），还没刷盘时宕机 → 数据丢失！
解决：Write-Ahead Logging（WAL，预写日志）
     先写 redo log（顺序IO，快）→ 再异步刷脏页到磁盘
     崩溃后：用 redo log 重放，恢复未刷盘的数据
```

**redo log 的特点：**
```
① 物理日志：记录"某数据页某偏移量处改为了什么值"
② 顺序写，速度极快（随机IO → 顺序IO）
③ 固定大小，循环使用（默认两个文件，每个48MB）
④ 是 InnoDB 特有的
```

**redo log 写入流程：**
```
SQL执行修改
    ↓
写入 redo log buffer（内存）
    ↓
事务提交时（innodb_flush_log_at_trx_commit 控制刷盘时机）
  =0：每秒刷一次（可能丢1秒数据）
  =1：每次提交都刷盘（最安全，默认）✅
  =2：每次写OS缓存，每秒刷盘（折中）
    ↓
写入 redo log 文件（磁盘）
```

---

### 4.4 undo log（回滚日志）⭐⭐⭐

> 保证事务**原子性（A）**，同时也是 **MVCC 版本链** 的基础

**undo log 记录什么？**
```
INSERT → 记录这条记录的主键（回滚时DELETE）
UPDATE → 记录修改前的旧值（回滚时还原）
DELETE → 记录整行数据（回滚时INSERT回去）
```

**undo log 的两个作用：**
```
① 事务回滚：执行 ROLLBACK 时，根据 undo log 反向操作
② MVCC：为每行数据的历史版本提供数据来源（版本链）
```

**undo log 何时清理？**
```
不能立即删除！需要等没有任何 Read View 还在引用这个版本时才能删除
由后台 purge 线程负责清理
```

---

### 4.5 binlog（归档日志）⭐⭐⭐

> MySQL **Server 层**的日志，**所有存储引擎共用**

**binlog 的作用：**
```
① 主从复制：主库写 binlog → 从库读 binlog → 从库重放 → 数据同步
② 数据恢复：通过 binlog 将数据库恢复到任意时间点
③ 数据审计：记录所有变更操作
```

**binlog 三种格式：**
| 格式 | 内容 | 优点 | 缺点 |
|------|------|------|------|
| **statement** | 记录 SQL 语句 | 日志量小 | 函数/触发器可能主从不一致 |
| **row** | 记录行数据变更 | 精确，主从一致 | 日志量大 |
| **mixed** | 自动选择 statement/row | 折中 | 复杂 |

> MySQL 5.7.7+ 默认 **row** 格式

---

### 4.6 redo log vs binlog 核心区别 ⭐⭐⭐

| | redo log | binlog |
|--|----------|--------|
| 归属 | InnoDB 引擎层 | MySQL Server 层 |
| 日志类型 | 物理日志（数据页变更） | 逻辑日志（SQL/行变更） |
| 写入方式 | 循环写（固定大小） | 追加写（不会覆盖） |
| 作用 | crash-safe（崩溃恢复） | 主从复制、数据归档恢复 |
| 事务提交 | 必须持久化 | 必须持久化 |

---

### 4.7 两阶段提交（2PC）⭐⭐⭐

> 保证 redo log 和 binlog **数据一致性**

**为什么需要两阶段提交？**
```
问题：redo log 和 binlog 是两个独立的日志
      如果先写 redo log 再写 binlog，中间宕机：
      redo log 有记录（数据恢复后存在），binlog 没有（主从复制后不存在）→ 主从不一致！
```

**两阶段提交流程：**
```
① prepare 阶段：
   写 redo log，状态标记为 prepare

② 写 binlog

③ commit 阶段：
   redo log 状态改为 commit
```

**崩溃恢复规则：**
```
重启时扫描 redo log：
  redo log 是 commit 状态 → 直接提交
  redo log 是 prepare 状态：
    binlog 完整 → 提交（补全 commit 状态）
    binlog 不完整 → 回滚
```

---

### 4.8 一条 UPDATE 语句的完整执行流程 ⭐⭐⭐

```sql
UPDATE user SET name='李四' WHERE id=1;
```

```
① 连接器：建立连接，验证权限
② 分析器：词法/语法解析
③ 优化器：选择执行计划（用哪个索引）
④ 执行器：调用 InnoDB 引擎接口

⑤ InnoDB 引擎：
   → 查 Buffer Pool，有则直接用，无则从磁盘读入 Buffer Pool
   → 记录旧值到 undo log（用于回滚和MVCC）
   → 修改 Buffer Pool 中的数据页（脏页）
   → 写 redo log buffer（prepare 状态）

⑥ Server层：写 binlog

⑦ InnoDB：redo log 标记 commit

⑧ 事务提交完成
   → 后台线程异步将脏页刷盘
```

---

### 4.9 面试标准答法 💬

> **第一层**：Buffer Pool 是 InnoDB 核心内存结构，所有读写都经过它，用改进版 LRU 管理，防止全表扫描污染热数据。Change Buffer 缓存非唯一二级索引的写变更，避免随机IO，适合写多读少场景。
>
> **第二层**：redo log 保证持久性，WAL机制先顺序写日志再异步刷脏页，循环使用固定大小；undo log 保证原子性，记录数据旧版本，同时支撑MVCC版本链。
>
> **第三层**：binlog 是 Server 层日志，用于主从复制和数据归档，row 格式最精确。redo log（InnoDB引擎层，物理日志，循环写）vs binlog（Server层，逻辑日志，追加写），两者通过两阶段提交保证一致性。
>
> **加分点**：两阶段提交先写 prepare 的 redo log，再写 binlog，最后 commit redo log，崩溃恢复时通过 binlog 完整性判断提交还是回滚，保证主从一致。

### 4.10 常见追问

| 追问 | 关键答点 |
|------|---------|
| 为什么不直接刷盘，要用 redo log？ | 数据页随机IO慢；redo log 顺序IO快，且小得多 |
| redo log 写满了怎么办？ | 会阻塞写操作，强制 checkpoint 将脏页刷盘推进 write pos |
| Change Buffer 和 redo log 的关系？ | Change Buffer 的变更也会记录到 redo log，保证 crash-safe |
| binlog 可以代替 redo log 吗？ | 不能，binlog 是逻辑日志无法精确恢复数据页；redo log 是物理日志 |
| 什么是 checkpoint？ | 将 Buffer Pool 脏页刷盘，推进 redo log 的可覆盖位置 |

---

## 五、锁机制（行锁、间隙锁、意向锁）⭐⭐⭐⭐⭐

### 5.1 锁的分类体系

```
MySQL锁
├── 按粒度
│   ├── 表锁（MyISAM，开销小，并发差）
│   ├── 行锁（InnoDB，开销大，并发强）
│   └── 页锁（BerkeleyDB，介于两者之间）
│
├── 按模式
│   ├── 共享锁 S Lock（读锁）—— 允许多个事务并发读
│   └── 排他锁 X Lock（写锁）—— 独占，读写均阻塞
│
└── 按意图（意向锁，InnoDB自动加）
    ├── IS（意向共享锁）
    └── IX（意向排他锁）
```

兼容性矩阵：

|  | IS | IX | S | X |
|--|----|----|---|---|
| IS | ✅ | ✅ | ✅ | ❌ |
| IX | ✅ | ✅ | ❌ | ❌ |
| S | ✅ | ❌ | ✅ | ❌ |
| X | ❌ | ❌ | ❌ | ❌ |

---

### 5.2 行锁三种形态

InnoDB的行锁实现在**索引**上（锁的是索引记录，不是数据行本身）：

#### ① Record Lock（记录锁）
锁住**单个索引记录**。
```sql
SELECT * FROM t WHERE id = 1 FOR UPDATE;
-- 锁住 id=1 这一条索引记录
```

#### ② Gap Lock（间隙锁）—— 防幻读关键
锁住**索引记录之间的间隙**，不包含记录本身。
```sql
-- 假设 id 有 1, 5, 10 三条记录
SELECT * FROM t WHERE id BETWEEN 3 AND 7 FOR UPDATE;
-- Gap Lock 锁住 (1,5) 和 (5,10) 两个区间，防止其他事务插入
```
> ⚠️ Gap Lock **只在 RR 隔离级别**下存在，RC 下不使用 Gap Lock

#### ③ Next-Key Lock（临键锁）—— InnoDB默认
= **Record Lock + Gap Lock**，锁住记录本身及其**左开右闭**区间。
```
-- id有 1, 5, 10，Next-Key Lock 的区间为：
(-∞, 1] (1, 5] (5, 10] (10, +∞)
-- 当 WHERE id=5 时，锁住 (1,5] 这个 Next-Key Lock
```
**RR 级别下，InnoDB 默认使用 Next-Key Lock，是解决幻读的核心机制。**

---

### 5.3 意向锁（Intention Lock）

**作用：** 协调**表锁**和**行锁**之间的冲突检测，避免逐行扫描。

**规则：**
- 加行共享锁前，先在表上加 IS
- 加行排他锁前，先在表上加 IX
- 意向锁之间**相互兼容**（IS/IX互相不冲突）
- 意向锁与**表级S/X锁**才会冲突

---

### 5.4 加锁规则（两个原则、两个优化）

**两个原则：**
1. 加锁基本单位是 **Next-Key Lock**（左开右闭区间）
2. 查找过程中**访问到的对象**才会加锁

**两个优化：**
1. 唯一索引**等值查询**，命中记录时，退化为 **Record Lock**
2. 索引**等值查询**，向右遍历到**不满足条件的第一个值**时，退化为 **Gap Lock**

```sql
-- 表 t，id 为主键，有 1, 5, 10, 15 四条记录

-- 1. 等值命中唯一索引 → 退化为 Record Lock
SELECT * FROM t WHERE id = 5 FOR UPDATE;
-- 仅锁 id=5 这一条记录

-- 2. 等值未命中唯一索引（id=6不存在）→ Gap Lock
SELECT * FROM t WHERE id = 6 FOR UPDATE;
-- 锁住间隙 (5, 10)

-- 3. 范围查询 → Next-Key Lock
SELECT * FROM t WHERE id >= 5 AND id <= 10 FOR UPDATE;
-- 锁住 (1,5] 和 (5,10]
```

---

### 5.5 死锁

```
事务A                    事务B
LOCK id=1(X)             LOCK id=2(X)
等待 id=2(X) ←→ 等待 id=1(X)
        死锁！
```

**InnoDB 死锁处理：**
- `innodb_deadlock_detect = ON`（默认开启），检测到死锁后自动回滚**代价较小**的事务
- `innodb_lock_wait_timeout`（默认50s），超时自动回滚

**避免死锁原则：**
1. 所有事务**固定顺序**操作多行
2. 缩短事务，减少持锁时间
3. `SELECT ... FOR UPDATE` 一次性获取所有需要的锁

---

### 5.6 乐观锁 vs 悲观锁

| | 悲观锁 | 乐观锁 |
|--|--------|--------|
| 实现 | `SELECT FOR UPDATE` | version字段 + CAS更新 |
| 适合 | 写多读少，冲突概率高 | 读多写少，冲突概率低 |

```sql
-- 乐观锁实现（version方式）
UPDATE t SET stock = stock - 1, version = version + 1
WHERE id = 1 AND version = #{oldVersion};
-- 影响行数为0则说明已被其他事务修改，需重试
```

---

### 5.7 面试标准答法

> InnoDB的行锁分三种：Record Lock锁单行、Gap Lock锁间隙防幻读、Next-Key Lock是两者结合，是RR级别下的默认加锁单位。意向锁是InnoDB自动维护的表级锁，用来快速判断表中是否有行锁，避免加表锁时逐行扫描。
>
> 行锁加在索引上，若查询走不到索引，行锁退化为表锁。加锁规则：唯一索引等值命中退化为Record Lock；等值未命中退化为Gap Lock；范围查询用Next-Key Lock。死锁方面InnoDB有死锁检测，自动回滚代价小的事务。

---

### 5.8 常见追问

**Q: RR级别为什么能防幻读？**
> Next-Key Lock锁住间隙，阻止其他事务在该区间INSERT。

**Q: 行锁什么情况退化为表锁？**
> WHERE条件没走索引，InnoDB扫描全表所有记录并加锁，等同于表锁。所以SQL必须走索引。

**Q: RC和RR的锁区别？**
> RC不使用Gap Lock，只锁命中的行；RR使用Next-Key Lock锁住记录和间隙，并发度更低但一致性更强。

---

## 六、SQL优化 & Explain解读 ⭐⭐⭐⭐

### 6.1 EXPLAIN 核心字段解读

| 字段 | 含义 | 重点关注值 |
|------|------|-----------|
| **id** | 查询序号，越大越先执行 | 子查询/联合查询时看执行顺序 |
| **select_type** | 查询类型 | SIMPLE/PRIMARY/SUBQUERY/DERIVED |
| **type** | **访问类型（最重要）** | 见下表 |
| **key** | 实际使用的索引 | NULL表示没走索引 |
| **key_len** | 索引使用字节数 | 越大用的索引列越多 |
| **rows** | 预估扫描行数 | 越小越好 |
| **Extra** | 额外信息 | 重点看 |

#### type 访问类型（从优到劣）

```
system > const > eq_ref > ref > range > index > ALL
```

| type | 说明 |
|------|------|
| **const** | 主键/唯一索引等值查询，最多1行 |
| **eq_ref** | JOIN时主键/唯一索引关联 |
| **ref** | 非唯一索引等值查询 |
| **range** | 索引范围扫描（`>` `<` `BETWEEN` `IN`） |
| **index** | 扫描整个索引树 |
| **ALL** | 全表扫描 ⚠️ 必须优化 |

> **生产要求：至少 range，核心表要 ref 以上**

#### Extra 关键值

| Extra | 含义 |
|-------|------|
| `Using index` | ✅ 覆盖索引，无需回表 |
| `Using index condition` | ✅ 索引下推（ICP） |
| `Using where` | Server层过滤，索引没完全覆盖条件 |
| `Using filesort` | ⚠️ ORDER BY没走索引，需优化 |
| `Using temporary` | ⚠️ 用了临时表，GROUP BY/DISTINCT性能差 |
| `Using join buffer` | ⚠️ JOIN没走索引 |

---

### 6.2 慢查询分析流程

```
慢SQL → 慢查询日志(slow_query_log=ON, long_query_time=1)
     → mysqldumpslow / pt-query-digest 分析
     → EXPLAIN 查执行计划
     → 针对性优化
     → 验证对比 rows / key / type
```

---

### 6.3 索引优化技巧

#### 避免索引失效的写法
```sql
-- ❌ 函数操作
WHERE DATE(create_time) = '2024-01-01'
-- ✅ 改为范围
WHERE create_time >= '2024-01-01' AND create_time < '2024-01-02'

-- ❌ 隐式类型转换（phone是varchar，传了int）
WHERE phone = 13812345678
-- ✅ 加引号
WHERE phone = '13812345678'

-- ❌ 前导模糊
WHERE name LIKE '%Tom'
-- ✅ 后缀模糊
WHERE name LIKE 'Tom%'
```

#### 覆盖索引（避免回表）
```sql
-- 建联合索引 (name, age)，SELECT只取索引列，无需回表
SELECT name, age FROM user WHERE name = 'Tom';
-- Extra: Using index ✅
```

---

### 6.4 JOIN 优化

- **小表驱动大表**：减少外层循环次数
- **被驱动表 JOIN 列必须有索引**，否则退化为 Block NLJ（用 join_buffer 全表扫描）
- JOIN 建议不超过3张表，复杂逻辑改用多次单表查询 + 应用层聚合

---

### 6.5 深分页优化

```sql
-- ❌ 深分页：扫描 1000000+10 行再丢弃
SELECT * FROM t ORDER BY id LIMIT 1000000, 10;

-- ✅ 游标分页（记住上次最大id）
SELECT * FROM t WHERE id > #{lastId} ORDER BY id LIMIT 10;

-- ✅ 子查询先定位id再回表
SELECT * FROM t
WHERE id >= (SELECT id FROM t ORDER BY id LIMIT 1000000, 1)
ORDER BY id LIMIT 10;
```

---

### 6.6 COUNT 优化

```sql
-- 效率：COUNT(*) ≈ COUNT(1) > COUNT(主键) > COUNT(字段)
-- InnoDB对COUNT(*)优化，选最小索引树扫描

-- ❌ 大表实时COUNT性能差
-- ✅ 方案：计数器表 / Redis缓存计数 / 近似值(SHOW TABLE STATUS)
```

---

### 6.7 面试标准答法

> 首先开慢查询日志定位慢SQL，然后EXPLAIN分析执行计划。重点看type字段，要求至少range，核心表ref以上；key字段确认是否走了索引；Extra出现Using filesort或Using temporary要重点优化。
>
> 常见优化手段：①加合适索引，利用覆盖索引避免回表；②避免索引失效：不对索引列加函数、避免隐式类型转换、避免前导模糊；③JOIN小表驱动大表，被驱动表加索引；④深分页改游标分页；⑤大表COUNT用Redis缓存。

---

### 6.8 常见追问

**Q: type=index和ALL有什么区别？**
> index是扫描整个索引树（索引文件），ALL是扫描整个数据文件。索引文件通常更小，但都是全扫描，都需要优化。

**Q: Using filesort一定很慢吗？**
> 不一定。小数据量在内存中排序（sort_buffer）很快；超过sort_buffer_size才用磁盘临时文件，性能下降。优化方向：给ORDER BY的列加索引。

**Q: 为什么深分页慢？**
> `LIMIT m, n` 需先扫描前m+n行再丢弃前m行，m越大越慢。游标分页（WHERE id > lastId）直接定位，复杂度从O(m+n)降为O(n)。

---

## 七、主从复制原理 ⭐⭐⭐

### 7.1 整体架构

```
主库 (Master)                    从库 (Slave)
┌─────────────────┐              ┌─────────────────┐
│  用户写操作      │   binlog     │  用户读操作      │
│   binlog文件    │─────────────→│  relay log文件  │
└─────────────────┘  IO Thread   └─────────────────┘
  Binlog Dump Thread               SQL Thread回放
```

**三个核心线程：**
| 线程 | 位置 | 作用 |
|------|------|------|
| **Binlog Dump Thread** | 主库 | 监听binlog变化，推送给从库 |
| **IO Thread** | 从库 | 连接主库，拉取binlog写入relay log |
| **SQL Thread** | 从库 | 读取relay log，回放SQL |

---

### 7.2 复制流程（6步）

```
1. 主库执行事务，写入 binlog
2. 主库 Binlog Dump Thread 通知从库
3. 从库 IO Thread 连接主库，请求 binlog
4. 主库将 binlog 发送给从库
5. 从库将收到的 binlog 写入 relay log
6. 从库 SQL Thread 读取 relay log，本地回放执行
```

---

### 7.3 三种复制模式

| 模式 | 说明 | 特点 |
|------|------|------|
| **异步复制**（默认） | 主库写完binlog直接返回，不管从库是否收到 | 性能最好，主库宕机可能丢数据 |
| **半同步复制** | 主库等至少1个从库确认收到relay log才返回 | 平衡性能与安全，生产常用 |
| **全同步复制** | 主库等所有从库回放完成才返回 | 数据最安全，性能最差 |

---

### 7.4 主从延迟

**原因：**
- 从库 SQL Thread **单线程**串行回放（MySQL 5.6前主要瓶颈）
- 主库并发写入量大，从库回放跟不上
- 大事务阻塞 SQL Thread

**解决方案：**
- **并行复制**（MySQL 5.7+）：按库/按事务组并行回放
- 大事务拆小事务
- 写后立即读强制走主库（业务层兜底）

```sql
SHOW SLAVE STATUS\G
-- Seconds_Behind_Master: 10  ← 延迟秒数，0=无延迟，NULL=未连接
```

---

### 7.5 GTID 复制（MySQL 5.6+）

**GTID = server_uuid + 事务序号**，全局唯一标识每个事务。

```sql
-- 传统：需手动指定binlog文件名+位置，故障切换容易出错
CHANGE MASTER TO MASTER_LOG_FILE='mysql-bin.000003', MASTER_LOG_POS=1234;

-- GTID：自动识别已执行事务，一行搞定
CHANGE MASTER TO MASTER_AUTO_POSITION=1;
```

---

### 7.6 读写分离

- **应用层路由**：写操作指定主库，读操作指定从库
- **中间件代理**：MyCat / ShardingSphere-Proxy / ProxySQL 自动路由
- **延迟一致性问题**：写完立即读可能读到旧数据 → 写后强制读主库

---

### 7.7 面试标准答法

> MySQL主从复制基于binlog，三个线程：主库Binlog Dump Thread推送binlog；从库IO Thread拉取写入relay log；从库SQL Thread读取relay log本地回放。
>
> 复制模式：异步（默认，性能好但可能丢数据）、半同步（等至少一个从库确认，生产常用）、全同步（性能差）。主从延迟的主要原因是SQL Thread单线程回放，MySQL 5.7+并行复制解决。binlog推荐ROW格式，精确记录行变化不会主从不一致。

---

### 7.8 常见追问

**Q: GTID相比传统复制优势？**
> 传统复制故障切换需手动指定binlog文件名+位置易出错；GTID全局唯一，从库自动识别已执行事务，`MASTER_AUTO_POSITION=1`一行搞定，运维成本大幅降低。

**Q: binlog和redo log在复制中的区别？**
> binlog是Server层的，所有引擎共用，用于主从复制和数据恢复；redo log是InnoDB特有，用于crash recovery。主从复制只用binlog。

---

## 八、分库分表方案 ⭐⭐⭐⭐

### 8.1 为什么需要分库分表

| 问题 | 单库瓶颈 | 解决方案 |
|------|---------|---------|
| 数据量过大 | 单表超过2000万行，B+树层级增加，查询变慢 | **分表** |
| 并发量过高 | 单库连接数/QPS/TPS有上限 | **分库** |
| 存储容量不足 | 单机磁盘有限 | **分库** |

---

### 8.2 垂直拆分 vs 水平拆分

#### 垂直分库（按业务模块拆）
- 微服务架构标配，每个服务独占一个库
- **不解决单表数据量大的问题**

#### 垂直分表（按列拆，大字段分离）
- 热数据和冷数据分离，减少单行数据大小
- 例：用户基础表（id, name）+ 用户详情表（id, avatar, bio）

#### 水平分库/分表
- 将同一张表数据按分片键散到多个库/表
- 解决单表数据量瓶颈

---

### 8.3 分片策略

| 策略 | 算法 | 优点 | 缺点 |
|------|------|------|------|
| **Hash取模** | `user_id % N` | 分布均匀 | 扩容需迁移大量数据 |
| **Range范围** | 按时间/ID范围 | 扩容方便 | 可能热点（新数据集中在最后分片） |
| **一致性Hash** | 虚拟节点环 | 扩容只迁移部分数据 | 实现复杂 |

**分片键选择原则：**
1. 查询频率最高的字段（避免跨库查询）
2. 数据分布均匀（避免数据倾斜）
3. 不可变更（一旦确定不能修改）

---

### 8.4 分库分表带来的问题

#### ① 分布式ID（高频考点）

| 方案 | 优缺点 |
|------|--------|
| **UUID** | 无序，索引性能差，占36字节 |
| **Snowflake雪花算法** | 趋势递增，高性能，需解决时钟回拨 |
| **数据库号段** | 简单，DB有单点风险 |
| **Redis INCR** | 高性能，需持久化防丢失 |

**雪花算法结构：**
```
| 1bit符号位 | 41bit时间戳(约69年) | 10bit机器ID(1024节点) | 12bit序列号(每毫秒4096个) |
```

#### ② 跨库JOIN
```
-- ✅ 解决方案：
-- 1. 应用层分两次查询，内存中关联
-- 2. 数据冗余（将常用字段冗余到关联表）
-- 3. 全局表（字典小表每个库都存一份）
```

#### ③ 分布式事务
- 跨库操作无法用本地事务保证
- 方案：Seata AT模式 / TCC / 消息最终一致性

#### ④ 跨分片分页 & 排序
```
-- 每个分片都取前N条，应用层合并后取TOP10
-- 或用ES做二级索引，存储层只存数据
```

#### ⑤ 扩容难题（Hash取模）
- 4分片扩8分片，几乎所有数据需重新路由迁移
- 解决：提前规划足够多逻辑分片（如1024个）/ 一致性Hash / 双写迁移

---

### 8.5 什么时候分库分表

**先做这些，再考虑分库分表：**
加索引优化 → 读写分离 → 冷热归档 → 硬件升级

**分库分表时机：**
- 单表数据量 > **1000万~2000万**
- 单库 QPS > **2000~3000**
- 数据库响应时间持续 > 100ms

**推荐中间件：** ShardingSphere-JDBC（客户端模式，无代理，低延迟，对Java友好）

---

### 8.6 面试标准答法

> 分库分表分两个维度：垂直拆分是按业务/列拆，水平拆分是把同一张表数据散到多个库或表。水平拆分需要选分片键，选查询最频繁且分布均匀的字段，Hash取模分布均匀但扩容难，Range扩容方便但有热点，一致性Hash是折中。
>
> 分库分表带来几个挑战：①分布式ID，推荐雪花算法，趋势递增且高性能；②跨库JOIN改为应用层两次查询或字段冗余；③分布式事务用Seata或消息最终一致性；④跨分片分页排序改用ES做二级索引；⑤扩容问题提前规划足够多逻辑分片或用一致性Hash。
>
> 中间件推荐ShardingSphere-JDBC，客户端模式无额外网络跳转，Java应用友好。

---

### 8.7 常见追问

**Q: 雪花算法如何解决时钟回拨？**
> 小幅回拨（毫秒级）等待时钟追上；大幅回拨直接抛异常让上游重试；或用备用位记录回拨次数（百度UidGenerator方案）。

**Q: 为什么Hash取模扩容难？**
> 4个分片`id%4`扩为8个分片后变`id%8`，原来分片0的数据（id=4,8,12...）有一半要迁移到分片4，几乎所有数据都需重新路由，迁移代价极大。

**Q: 分库分表后如何保证全局唯一ID？**
> 推荐雪花算法，41bit时间戳+10bit机器ID+12bit序列号，每毫秒每节点4096个ID，趋势递增对B+树友好，无中心化依赖。
