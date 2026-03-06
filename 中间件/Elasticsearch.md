# Elasticsearch 知识点

> 最后更新：2026年3月6日

---

## 📋 章节大纲

| 章节 | 内容 | 优先级 | 状态 |
|------|------|--------|------|
| 一 | 核心概念 & 与MySQL对比 | ⭐⭐⭐ | ✅ |
| 二 | 倒排索引原理 | ⭐⭐⭐⭐⭐ | ✅ |
| 三 | 写入流程（Buffer→Refresh→Translog→Flush→Merge） | ⭐⭐⭐⭐ | ✅ |
| 四 | 查询流程（Query Phase & Fetch Phase） | ⭐⭐⭐⭐ | ✅ |
| 五 | 相关性评分（TF-IDF → BM25） | ⭐⭐ | ✅ |
| 六 | 集群架构（Master/Data节点 & 分片路由） | ⭐⭐⭐⭐ | ✅ |
| 七 | 脑裂问题 & 解决方案 | ⭐⭐⭐ | ✅ |
| 八 | 深分页问题 & 解决方案 | ⭐⭐⭐ | ✅ |
| 九 | 性能优化（写入优化 & 查询优化） | ⭐⭐⭐ | ✅ |
| 十 | ES与MySQL双写一致性方案 | ⭐⭐⭐ | ✅ |

---

## 一、核心概念 & 与MySQL对比 ⭐⭐⭐

### 1.1 核心概念对照

| ES 概念 | MySQL 类比 | 说明 |
|---------|-----------|------|
| **Index（索引）** | Database（数据库） | 存放同类文档的逻辑容器，如 `order-index` |
| **Mapping** | Schema（表结构） | 定义字段名、数据类型、分词器，类似 DDL |
| **Document** | Row（行） | 最小数据单元，JSON 格式，有唯一 `_id` |
| **Field** | Column（列） | 文档中的每个 JSON 属性 |
| **Shard（分片）** | 无直接对应 | Index 的物理分片，分布在不同节点，实现水平扩展 |
| **Replica（副本）** | 从库（Slave） | Primary Shard 的完整副本，提供高可用 & 读扩展 |
| **Node（节点）** | 数据库实例 | 一个 ES 进程即一个 Node |
| **Cluster（集群）** | 数据库集群 | 多个 Node 组成，统一对外提供服务 |

---

### 1.2 Shard & Replica 核心规则

```
创建 Index 时指定：
  number_of_shards   = 3   # Primary Shard 数量，创建后【不可修改】
  number_of_replicas = 1   # 每个 Primary 的 Replica 数量，可动态调整

实际 Shard 总数 = 3 × (1 + 1) = 6 个 Shard

分布示意（3节点，3P + 3R）：
  Node1: P0  R1
  Node2: P1  R2
  Node3: P2  R0
  → Primary 与其 Replica 一定不在同一节点（防止单点全丢）
```

**Primary Shard vs Replica Shard：**

| 对比项 | Primary Shard | Replica Shard |
|--------|--------------|---------------|
| 读请求 | ✅ 可响应 | ✅ 可响应 |
| 写请求 | ✅ 接收写入 | ❌ 不直接写入（由Primary同步过来）|
| 数量调整 | ❌ 创建后不可改 | ✅ 随时可调整 |
| 故障恢复 | Primary宕机→Replica提升为Primary | |

---

### 1.3 文档路由原理 ⭐⭐

**路由公式：**
```
shard_id = hash(_id) % number_of_primary_shards
```

**执行流程：**
```
① 客户端发请求到任意节点（该节点成为协调节点 Coordinating Node）
② 协调节点根据路由公式计算目标 Primary Shard 所在节点
③ 转发请求到目标节点完成读/写
④ 写入后 Primary 同步数据到所有 Replica
⑤ 协调节点汇总结果返回客户端
```

**⚠️ 为什么 Primary Shard 数量不可修改？**
```
假设初始 3 个分片：shard = hash(id) % 3
若扩为 5 个分片：shard = hash(id) % 5
→ 同一文档路由结果改变，原来在 shard-2 的数据按新公式算在 shard-4
→ 查询时找不到数据，数据逻辑上「消失」！

解决办法：Reindex（重建索引）—— 将旧 Index 数据全量写入新 Index
```

**自定义路由（按业务分区）：**
```json
// 写入时指定 routing，保证同一商户的数据在同一 Shard
PUT /order-index/_doc/1001?routing=merchant_001
{
  "order_id": 1001,
  "merchant_id": "merchant_001"
}
// 查询时同样带 routing，只打到对应 Shard，避免全量广播
GET /order-index/_search?routing=merchant_001
```

---

### 1.4 ES 与 MySQL 的本质区别

| 对比维度 | MySQL | Elasticsearch |
|----------|-------|---------------|
| **索引结构** | B+ 树（正排索引） | 倒排索引 |
| **查询擅长** | 等值查询、范围查询、关联查询 | 全文检索、模糊查询、聚合分析 |
| **事务支持** | ✅ ACID 完整事务 | ❌ 不支持事务 |
| **数据一致性** | 强一致性 | 近实时（默认1s refresh）|
| **Schema** | 强 Schema（DDL 变更成本高）| 动态 Mapping（可自动推断类型）|
| **水平扩展** | 需手动分库分表 | 原生支持分片，天然水平扩展 |
| **更新方式** | 原地更新 | 标记删除 + 写新文档（Immutable Segment）|
| **适用场景** | 业务主数据存储（订单/用户）| 搜索、日志分析、复杂查询 |

> **实际架构**：MySQL 作为主库保证数据一致性，ES 作为搜索引擎，通过 Canal/Binlog 或双写同步数据

---

### 1.5 面试标准答法

> ES 中 Index 对应 MySQL 的 Database，Document 对应 Row，Mapping 对应表结构。ES 通过 Shard 实现水平扩展，每个 Index 拆成多个 Primary Shard 分布在不同节点，每个 Primary 有若干 Replica 副本提供高可用和读扩展。文档按 `hash(_id) % primaryShardNum` 路由到固定分片，所以 **Primary Shard 数量创建后不可修改**，需要扩容只能通过 Reindex 重建索引。ES 与 MySQL 的核心区别是：ES 用倒排索引擅长全文检索，MySQL 用 B+ 树擅长精确查询；ES 是近实时（1s）而非强一致，不支持事务，适合做搜索引擎配合 MySQL 主库使用。

---

### 1.6 常见追问

**Q：ES 的 number_of_replicas 为 0 意味着什么？**
> 没有副本，单点故障会导致该 Shard 不可用，Index 变为 Red 状态。生产环境至少设置为 1。

**Q：一个 Index 应该设置多少个 Primary Shard？**
> 经验值：每个 Shard 大小控制在 **10GB~50GB**，单个 Shard 不超过 50GB。可按预期数据量规划：若预计 150GB 数据 → 设置 3~5 个分片。Shard 太少无法充分利用节点，Shard 太多（超过节点数太多）协调开销大。

**Q：Replica 可以设置为 0 吗？什么场景用？**
> 可以。数据重建/批量写入场景，临时设 `number_of_replicas=0` 关闭副本同步，写入速度可提升数倍，写完再改回 1 触发副本同步。

---

## 二、倒排索引原理 ⭐⭐⭐⭐⭐

### 2.1 正排索引 vs 倒排索引

**正排索引（MySQL B+ 树的思路）：**
```
文档ID → 文档内容
  1   → "Java 并发编程实战"
  2   → "Java 虚拟机深度解析"
  3   → "深入理解 Java 并发"

查询包含"Java"的文档 → 必须逐行扫描所有文档 → O(N)，慢！
```

**倒排索引（ES 的核心）：**
```
词项(Term) → 文档ID列表(Posting List)
"Java"    → [1, 2, 3]
"并发"    → [1, 3]
"虚拟机"  → [2]
"编程"    → [1]

查询"Java 并发" → 取 [1,2,3] ∩ [1,3] = [1,3] → O(1) 级别，快！
```

> 本质：**用空间换时间**，写入时建立 Term→DocID 的映射，查询时直接走索引

---

### 2.2 倒排索引完整结构

```
倒排索引 = Term Dictionary + Posting List + Term Index（FST）

┌─────────────────────────────────────────────────────────┐
│                  Term Index (FST，存内存)                 │
│         快速定位 Term 在 Term Dictionary 中的位置          │
└──────────────────────┬──────────────────────────────────┘
                       │ 指针
┌──────────────────────▼──────────────────────────────────┐
│              Term Dictionary（存磁盘，.tim文件）           │
│  有序的词项列表："Java" "Python" "并发" "虚拟机" ...        │
│  二分查找定位具体词项，找到对应 Posting List 偏移量          │
└──────────────────────┬──────────────────────────────────┘
                       │ 偏移量
┌──────────────────────▼──────────────────────────────────┐
│              Posting List（存磁盘，.doc文件）              │
│  每个 Term 对应的文档列表，包含：                           │
│  - DocID 列表（差值压缩存储）                              │
│  - 词频 TF（Term 在该文档中出现次数）                       │
│  - 位置信息 Position（词在文档中的位置，支持短语查询）         │
│  - 偏移量 Offset（词的起止字符位置，支持高亮）               │
└─────────────────────────────────────────────────────────┘
```

---

### 2.3 分词过程（Analysis）

文档写入时，`text` 类型字段经过 **Analyzer（分析器）** 处理：

```
原文："Java并发编程实战 2024版"

分析器三个步骤：
  ① Character Filter（字符过滤）：去除HTML标签、特殊字符
     → "Java并发编程实战 2024版"
  ② Tokenizer（分词器）：按规则切词
     → ["Java", "并发", "编程", "实战", "2024", "版"]
  ③ Token Filter（词项过滤）：小写化、去停用词、同义词扩展
     → ["java", "并发", "编程", "实战", "2024"]

最终写入倒排索引的 Term：java / 并发 / 编程 / 实战 / 2024
```

**常用分词器对比：**

| 分词器 | 适用语言 | 特点 |
|--------|---------|------|
| `standard` | 英文 | 按空格/标点切词，转小写，ES默认 |
| `ik_max_word` | 中文 | IK分词器，最细粒度，如"中华人民共和国"→7个词 |
| `ik_smart` | 中文 | IK分词器，最粗粒度，如"中华人民共和国"→1个词 |
| `pinyin` | 中文 | 拼音分词，支持拼音搜索 |

> **面试加分点**：`keyword` 类型字段不分词，整体作为一个 Term，适合精确匹配、聚合、排序

---

### 2.4 Term Dictionary 如何存储（为什么快）

**问题：** Term Dictionary 可能有数百万个词，如何快速查找某个词？

```
方案一：直接哈希表
  → 内存占用大，Term 数量多时装不下

方案二：有序数组 + 二分查找（Term Dictionary 的做法）
  → Term Dictionary 在磁盘上有序排列
  → 但磁盘 IO 慢，不能每次都从头二分

方案三：Term Index（FST）放内存 + Term Dictionary 在磁盘
  → FST 极度压缩，只存前缀/后缀公共部分
  → 内存中快速定位到磁盘大致位置 → 少量磁盘 IO → 找到精确位置
```

---

### 2.5 FST（Finite State Transducer）⭐⭐

**FST 是什么：** 一种有向无环图（DAG），对有序字符串集合进行极度压缩，兼顾查找速度和内存占用。

```
普通 Trie 树存 ["java", "javascript", "jar"]：
  j → a → v → a               (java)
            → s → c → r ...   (javascript)
      → r                     (jar)
  公共前缀 "ja" 共享，但后缀没有共享

FST 在 Trie 基础上同时共享后缀：
  → 不仅共享前缀，还共享后缀，压缩率更高
  → 查找复杂度 O(len)，与词典大小无关
  → Lucene 的 Term Index 用 FST 存储，内存占用比 HashMap 小 10x~20x
```

---

### 2.5.1 FST 如何精确定位磁盘位置（核心机制）⭐⭐⭐

**关键：FST 的每条边不只存字符，还存「输出值（Output）」——即磁盘块偏移量的累加值。**

```
假设 Term Dictionary 按每 25 个词分一个 Block，存在磁盘上：
  Block0（offset=0）   ：["abandon", "able", ..., "age"]
  Block1（offset=1024）：["agent", "ago",  ..., "all"]
  Block2（offset=2048）：["allow", "also", ..., "and"]
  ...

FST 中每条边带有 output（偏移量贡献值）：

  初始 output = 0
   a(+0) → g(+1024) → e(+0) → [终态，累计output=1024]
                              → n → t  [终态，累计output=1024]
   a(+0) → l(+2048) → l(+0) → o → w  [终态，累计output=2048]

查找 "agent" 的过程：
  ① 在 FST 中逐字符走边：a→g→e→n→t
  ② 累加每条边的 output 值：0 + 1024 + 0 + 0 + 0 = 1024
  ③ 得到 Block 在磁盘的起始偏移量 = 1024（一次内存操作，无磁盘IO）
  ④ 用 offset=1024 直接 seek 到磁盘该 Block（1次磁盘IO）
  ⑤ Block 内数据量小（25个词），顺序扫描或二分找到精确的 "agent"
  ⑥ 拿到 "agent" 对应 Posting List 的偏移量 → 读取 DocID 列表
```

**整个查找只需 1~2 次磁盘 IO，对比全量二分的 log₂(N) 次 IO：**

```
Term Dictionary 有 100万个词，每次磁盘IO读4KB（约50个词）：
  纯二分查找：log₂(1,000,000 / 50) ≈ 14 次磁盘IO
  FST + Block：1次内存遍历 + 1~2次磁盘IO  ← 快约10倍
```

**为什么 FST 能存偏移量？（Transducer 的含义）**
```
FST = Finite State Acceptor（FSA）+ 输出函数（Transducer）
  FSA：只判断字符串是否存在（是/否）
  FST：在 FSA 基础上，每个接受路径还能输出一个关联值（如磁盘偏移量）

Lucene 的 FST：
  输入  = Term 字符串（如 "agent"）
  输出  = 该 Term 所在 Block 在 .tim 文件中的偏移量（long 类型）
  压缩  = 共享前缀和后缀的节点，相同后缀的 output 合并
```

**Lucene 实际文件结构（ES 底层是 Lucene）：**
```
.tim  → Term Dictionary（词典，磁盘，按Block分组存储）
.tip  → Term Index（FST，Node启动时全量加载到内存）
.doc  → Posting List（DocID + 词频，磁盘）
.pos  → Position 信息（词位置，磁盘）
.pay  → Offset/Payload（偏移量，磁盘）
.nvd  → Norm 值（文档归一化因子，评分用）
```

---

### 2.6 Posting List 压缩（Frame Of Reference）

```
原始 DocID 列表：[73, 300, 302, 332, 343, 372]

步骤一：转为差值（Delta Encoding）
  → [73, 227, 2, 30, 11, 29]   （每个值存与前一个的差）
  → 数值变小，需要的 bit 数更少

步骤二：Frame Of Reference（分块位压缩）
  → 每 256 个数分为一块，块内找最大值所需 bit 数
  → 块内所有数都用同样 bit 数存储
  → 压缩率极高，解压速度极快（CPU 位运算）
```

**多词查询的 Roaring Bitmap（跳表加速求交集）：**
```
查询 "java AND 并发"：
  java  → [1, 3, 5, 7, 200, 201 ...]
  并发  → [3, 7, 100, 201 ...]

跳表（Skip List）加速：每隔 128 个 DocID 建一个跳跃点
  → 不需要逐个遍历，可跳跃式推进，求交集复杂度大幅降低
```

---

### 2.7 为什么 ES 全文搜索比 MySQL LIKE 快

| 对比维度 | MySQL LIKE '%java%' | ES 全文搜索 |
|---------|--------------------|-----------|
| **索引使用** | ❌ 前缀通配符不走索引，全表扫描 | ✅ 直接查倒排索引 |
| **时间复杂度** | O(N×M)，N行×M字符 | O(1) 级别（Term查询）|
| **分词支持** | ❌ 无分词，只能子串匹配 | ✅ 分词后精准匹配每个词 |
| **相关性排序** | ❌ 无法按相关性排序 | ✅ BM25评分自动相关性排序 |
| **中文支持** | ❌ 无中文分词 | ✅ IK等中文分词器 |
| **内存利用** | Buffer Pool缓存页 | FST常驻内存，PageCache缓存段 |

---

### 2.8 面试标准答法

> 倒排索引是 ES 全文搜索的核心。与正排索引（文档→内容）相反，它建立 **词项→文档ID列表** 的映射。整体分三层：**Term Index（FST，常驻内存）** 用于快速定位词在磁盘的位置；**Term Dictionary（有序词典，磁盘）** 存储所有分词后的词项；**Posting List（磁盘）** 存每个词对应的 DocID、词频、位置等信息，并用 **Frame Of Reference 差值压缩** + **跳表加速求交集**。
>
> 文档写入时经过 **Analyzer 三步分析**（字符过滤→分词→词项过滤）生成 Term 写入索引。ES 全文搜索比 MySQL LIKE 快的根本原因是：MySQL LIKE 前缀通配需全表扫描 O(N)，ES 直接命中倒排索引是 O(1) 级别，且支持分词、相关性评分、中文搜索。

---

### 2.9 常见追问

**Q：`text` 和 `keyword` 类型有什么区别？**
> `text`：写入时分词，建倒排索引，用于全文搜索（match查询），不能直接用于聚合/排序。  
> `keyword`：不分词，整体作为一个 Term，用于精确匹配（term查询）、聚合（agg）、排序（sort）。  
> 实际场景如 `title` 字段通常同时设置两种类型：`title`（text）+ `title.keyword`（keyword）。

**Q：同义词搜索如何实现？**
> 在 Analyzer 的 Token Filter 阶段配置 **Synonym Token Filter**，写入/查询时将同义词扩展为多个 Term，如搜索"手机"同时匹配"电话""mobile"。

**Q：ES 能做精确匹配吗？和 term 查询有什么关系？**
> 可以。`term` 查询不分词，直接在 Term Dictionary 中查找精确词项（完全匹配）。`match` 查询会先对查询词分析再查。所以 `term` 查询 `keyword` 字段，`match` 查询 `text` 字段，混用会导致查不到数据。

**Q：倒排索引建好后能修改吗？**
> **不能**。Lucene 的 Segment（段）是不可变的（Immutable）。更新文档的本质是：标记旧文档为已删除 + 写入新文档到新 Segment。定期 Merge 合并 Segment 时才真正物理删除旧文档。这也是 ES 适合写多改少场景的原因。

---

### 2.10 核心要点速记

**三层架构，一图记忆：**
```
查询词 → FST（内存，极速定位）→ Term Dictionary（磁盘，有序词典）→ Posting List（磁盘，DocID列表）
```

**五个核心考点：**

| 考点 | 一句话记忆 |
|------|-----------|
| **FST** | 有向无环图，前缀+后缀都共享，比HashMap省内存10~20倍，常驻内存 |
| **Term Dictionary** | 有序存磁盘，二分查找，配合FST只需少量磁盘IO |
| **Posting List** | Delta差值编码 + FOR分块位压缩，Skip List加速多词求交集 |
| **Analyzer分词** | 字符过滤→分词器→词项过滤，中文用IK，text分词、keyword不分词 |
| **vs MySQL LIKE** | LIKE前缀通配全表扫描O(N)，ES直接命中倒排O(1)级别 |

**⚠️ 字节追问高频点：**
- `text` vs `keyword`：**text分词全文搜，keyword不分词精确匹配/聚合/排序**
- Segment 为什么不可变：**并发读无锁，写新Segment，定期Merge物理删除**

---

## 三、写入流程 ⭐⭐⭐⭐

### 3.1 整体流程总览

```
客户端写入请求
      ↓
① 写入 In-Memory Buffer（内存缓冲区）
   同时写入 Translog（事务日志，追加写磁盘）
      ↓  每隔 1s（refresh_interval）
② Refresh：Buffer → OS FileSystem Cache（Page Cache）
   生成新的 Segment（倒排索引结构），此时文档【可被搜索】
   Buffer 清空，但 Translog 继续保留
      ↓  每隔 30min 或 Translog 超过 512MB
③ Flush：OS FileSystem Cache → 磁盘
   调用 fsync 强制刷盘，生成 .si 段提交点文件
   清空 Translog（此前数据已安全落盘）
      ↓  后台持续进行
④ Segment Merge：后台将多个小 Segment 合并为大 Segment
   真正物理删除标记为删除的文档
   合并完成后替换旧 Segment，释放磁盘空间
```

---

### 3.2 各阶段详解

#### ① In-Memory Buffer + Translog（写入阶段）

```
写入请求到达 Primary Shard 所在节点：

  文档  →  In-Memory Buffer（JVM堆内存）
        →  Translog（磁盘，顺序追加写，类似 MySQL redo log）

  默认 Translog 每次写入都 fsync（index.translog.durability=request）
  → 保证节点宕机后可从 Translog 恢复未 Flush 的数据
  → 可改为 async（每5s刷一次）换取更高写入性能，但有丢数据风险
```

**此时文档状态：** 已持久化（Translog），但**不可搜索**（还在内存Buffer中）

---

#### ② Refresh（近实时的关键）⭐⭐⭐⭐⭐

```
默认每隔 1 秒执行一次 Refresh：

  In-Memory Buffer
      ↓ 生成倒排索引结构
  新 Segment（写入 OS FileSystem Cache / Page Cache）
      ↓
  该 Segment 对搜索可见（文档可被搜索到！）

  ⚠️ 注意：Refresh 后数据在 Page Cache，尚未 fsync 到磁盘
           此时节点宕机 → Page Cache 丢失 → 靠 Translog 恢复
```

**近实时（NRT）的本质：**
```
不是实时（写入即可搜），而是近实时（最多延迟 refresh_interval = 1s）

可手动触发：POST /index/_refresh
可调整间隔：PUT /index/_settings { "refresh_interval": "30s" }  ← 批量写入时常用优化
可关闭刷新："refresh_interval": "-1"  ← 批量导入数据时彻底关闭，写完再开
```

---

#### ③ Flush（数据安全落盘）

```
触发条件（满足任一）：
  - 默认每 30 分钟执行一次
  - Translog 大小超过 512MB（index.translog.flush_threshold_size）
  - 手动触发：POST /index/_flush

执行过程：
  ① 触发一次 Refresh（确保 Buffer 中数据进入 Segment）
  ② 调用 fsync：将所有 Page Cache 中的 Segment 强制写入磁盘
  ③ 写入一个「提交点」文件（.si），记录当前所有 Segment 信息
  ④ 清空 Translog（已安全落盘，Translog 使命完成）
  ⑤ 开启新的 Translog 文件
```

**Translog 的作用（类比 MySQL redo log）：**

| 对比 | MySQL | Elasticsearch |
|------|-------|---------------|
| 日志名 | redo log | Translog |
| 写入时机 | 事务提交前 | 每次文档写入时 |
| 作用 | 崩溃恢复 | Flush前的崩溃恢复 |
| 清理时机 | checkpoint推进后 | Flush完成后 |
| 刷盘策略 | innodb_flush_log_at_trx_commit | index.translog.durability |

---

#### ④ Segment Merge（后台合并）

```
问题：每次 Refresh 生成一个新 Segment，Segment 越来越多：
  - 搜索时需要遍历所有 Segment，Segment 多则慢
  - 被标记删除的文档占用磁盘空间（.del 文件标记，不立即删除）

解决：后台线程定期 Merge 小 Segment 为大 Segment：

  [seg1][seg2][seg3][seg4]  →  合并  →  [seg_merged]

  合并过程：
  ① 选取若干小 Segment
  ② 将存活文档（未被标记删除）写入新的大 Segment
  ③ 标记删除的文档在此步骤被真正物理删除
  ④ 新 Segment fsync 到磁盘
  ⑤ 删除旧的小 Segment 文件

  ⚠️ Merge 是 CPU + IO 密集操作，大量 Merge 会影响写入和查询性能
     可通过 index.merge.scheduler.max_thread_count 控制并发线程数
```

**强制 Merge（慎用）：**
```
POST /index/_forcemerge?max_num_segments=1
→ 将 Index 所有 Segment 强制合并为 1 个
→ 适合：只读 Index（历史归档数据），彻底优化查询性能
→ 禁止：活跃写入的 Index，会产生巨大 IO 压力
```

---

### 3.3 宕机恢复流程

```
场景：节点在 Refresh 后、Flush 前 宕机

  已有 Segment（在 Page Cache，未 fsync）→ 全部丢失
  Translog（已 fsync 到磁盘）→ 完整保留

恢复步骤：
  ① 读取最后一次 Flush 的提交点（.si 文件），加载已落盘的 Segment
  ② 重放 Translog 中该提交点之后的所有操作
  ③ 重建丢失的 Segment，数据完整恢复

最多丢失数据量 = Translog 中最后一次 fsync 到宕机之间的写入
  → durability=request（默认）：每次写入都 fsync Translog → 数据不丢
  → durability=async（每5s刷）→ 最多丢 5s 数据
```

---

### 3.4 写入流程 vs MySQL 对比

| 阶段 | Elasticsearch | MySQL |
|------|--------------|-------|
| 写入内存 | In-Memory Buffer | Buffer Pool |
| 持久化日志 | Translog（顺序写） | redo log（顺序写）|
| 内存→磁盘 | Flush（fsync Segment）| Checkpoint（刷脏页）|
| 后台整理 | Segment Merge | Purge（清理undo）|
| 可见性 | Refresh后可搜索（近实时）| 提交后立即可见（实时）|

---

### 3.5 面试标准答法

> ES 写入分四个阶段：
> 1. **写 Buffer + Translog**：文档先写 In-Memory Buffer，同时顺序追加写 Translog（类似 MySQL redo log），此时**不可搜索**但已持久化。
> 2. **Refresh（近实时核心）**：默认每 1 秒将 Buffer 中的数据转换为倒排索引结构写入新 Segment（到 OS Page Cache），Segment 一旦生成文档即**可被搜索**，这是 ES「近实时」的本质。
> 3. **Flush（安全落盘）**：每 30 分钟或 Translog 超 512MB 触发，调用 fsync 将 Page Cache 中所有 Segment 强刷到磁盘，写入提交点文件，然后**清空 Translog**。
> 4. **Segment Merge（后台合并）**：后台持续将小 Segment 合并为大 Segment，在合并时真正**物理删除**被标记的文档，释放磁盘空间，提升查询性能。
>
> 节点宕机时，依靠 Translog 重放未 Flush 的操作来恢复数据，`durability=request`（默认）可保证数据不丢。

---

### 3.6 常见追问

**Q：ES 为什么是「近实时」而不是「实时」？**
> 因为 Refresh 默认每 1 秒执行一次，写入后最多 1 秒才能被搜索到。若需要写入后立即可搜索，可在写入请求中加 `?refresh=true`（强制同步 Refresh，性能代价大）或 `?refresh=wait_for`（等待下次 Refresh，不强制触发）。

**Q：Translog 和 Segment 的关系？**
> Translog 是写入缓冲期的持久化保障，Flush 完成后即被清空；Segment 是最终的倒排索引存储形式，一旦 Segment fsync 到磁盘，对应的 Translog 就可以删除。

**Q：批量写入时如何提升性能？**
> ① 将 `refresh_interval` 调大（如 `30s`）或设为 `-1` 关闭自动 Refresh，减少 Segment 生成频率；② 将 `number_of_replicas` 设为 `0`，关闭副本同步；③ 使用 Bulk API 批量写入；④ 调大 `index.translog.flush_threshold_size`。写完后再恢复配置触发一次 Refresh 和 Flush。

**Q：Segment 不可变有什么好处？**
> ① 无需加锁，多线程并发读完全无锁；② OS 可以放心缓存 Segment 到 Page Cache，不会因为写入导致缓存失效；③ Segment 可以做 Bloom Filter 等预计算结构，加速查询。

---

### 3.7 核心要点速记

**写入四阶段口诀：**
```
写Buffer+Translog（持久不可搜）
  → Refresh 1s（生成Segment，可搜索，近实时）
  → Flush 30min（fsync落盘，清空Translog，真正安全）
  → Merge后台（合并Segment，物理删除，释放空间）
```

**三个关键时间参数：**

| 参数 | 默认值 | 含义 |
|------|--------|------|
| `refresh_interval` | `1s` | 写入到可搜索的最大延迟 |
| `index.translog.flush_threshold_size` | `512mb` | Translog超此大小触发Flush |
| `index.translog.sync_interval` | `5s` | async模式下Translog刷盘间隔 |

**⚠️ 字节追问高频点：**
- 近实时原因：**Refresh 1s 生成 Segment，不是写入即可见**
- 宕机恢复：**Translog 重放，durability=request 不丢数据**
- 批量写入优化：**关闭 refresh_interval + 关闭副本 + Bulk API**
- 强制Merge注意事项：**只对只读Index用，活跃写入Index禁止**

---

## 四、查询流程 ⭐⭐⭐⭐

### 4.1 整体流程全景

```
客户端发起搜索请求
        ↓
① 协调节点（Coordinating Node）接收请求
   → 任意节点都可以作为协调节点（每个节点都内置协调能力）
   → 分两种情况：
       普通节点兼任：Data Node 接收请求时顺带承担协调职责，同时也存储数据
       专用协调节点：关闭 master/data/ingest 角色，只做路由和汇总，不存储数据
   → 见 4.1.1 节点角色详解

② Query Phase（第一阶段：查询阶段）
   协调节点 → 广播请求到所有分片（每个 Shard 选 Primary 或 Replica 之一）
   每个 Shard 在本地执行查询，返回 [DocID + 排序分数]（不返回完整文档）
   协调节点汇总所有分片的结果，全局排序，取 Top N 的 DocID 列表

③ Fetch Phase（第二阶段：取回阶段）
   协调节点 → 根据 DocID 列表，发请求到对应 Shard 拖取完整文档内容
   各 Shard 返回完整文档，协调节点合并后返回客户端
```

---

### 4.1.1 ES 节点角色详解 ⭐⭐⭐

**ES 中每个节点可同时承担多个角色，角色通过 `elasticsearch.yml` 配置：**

| 角色 | 配置项 | 职责 | 是否存数据 |
|------|--------|------|-----------|
| **Master** | `node.roles: [master]` | 集群管理（Index创建/删除、Shard分配、节点加入/离开） | ❌ |
| **Data** | `node.roles: [data]` | 存储分片数据，执行CRUD和搜索 | ✅ |
| **Ingest** | `node.roles: [ingest]` | 写入前预处理Pipeline（格式转换、字段提取等） | ❌ |
| **Coordinating Only** | `node.roles: []`（空） | 仅路由请求、汇总结果，不做任何其他工作 | ❌ |
| **ML** | `node.roles: [ml]` | 机器学习任务 | ❌ |

**三种典型节点配置场景：**

```yaml
# 场景一：小集群，一个节点身兼多职（默认配置）
# elasticsearch.yml
node.roles: [master, data, ingest]
# → 该节点既是 Master 候选，又存储数据，又能处理 ingest
# → 收到请求时也会顺带作为协调节点，自己路由自己处理

# 场景二：大集群，角色分离（推荐生产）
# Master 节点（3台）
node.roles: [master]
# Data 节点（N台）
node.roles: [data]
# 专用协调节点（2~3台，挂在 LB 后面）
node.roles: []   # ← 空角色 = 专用协调节点
```

**为什么要专用协调节点（Coordinating Only Node）？**

```
大规模集群（数百个 Shard）的聚合查询场景：

  Query Phase 结果汇总：需要在内存中对所有 Shard 返回的 DocID+分数做全局排序
  Fetch Phase 结果合并：需要将所有分片返回的文档合并成最终响应
  → 内存和CPU开销都很大

  若由 Data Node 兼任协调：
    → 协调工作占用 Data Node 的内存和CPU
    → 影响该节点的数据存储和搜索性能
    → 整体集群性能下降

  专用协调节点的好处：
    → 协调工作独立，不争抢 Data Node 资源
    → 可以部署大内存机器（堆内存大，聚合结果缓冲多）
    → 对外暴露统一入口（挂 LB），Data Node 不对外暴露
```

**节点角色与协调职责的关系（容易混淆的点）：**

```
❌ 错误理解：只有"协调节点"才能协调请求
✅ 正确理解：
   - ES 中每个节点都内置协调能力（无论什么角色）
   - 任意节点收到客户端请求时，都会自动承担协调职责
   - "协调节点（Coordinating Only Node）"是指专门做这件事、不兼任其他角色的节点
   - 普通 Data Node 接收请求时：既协调（广播+汇总），也参与自身 Shard 的本地查询
```

---

### 4.2 Query Phase 详解

```
请求：搜索 "java 并发"，from=0, size=10，3 个 Primary Shard

① 协调节点广播请求到三个 Shard：P0 / P1 / P2（或其 Replica）

② 每个 Shard 在本地执行查询：
   • 在倒排索引中查"java" 和 "并发"，求交集得到匹配 DocID
   • 计算每个文档的 BM25 相关性分数
   • 本地按分数排序，取 Top (from + size) = Top 10 条
   • 返回给协调节点：[DocID_1/分数, DocID_2/分数, ...]（仅 ID 和分数）

③ 协调节点汇总三个 Shard 的结果：
   P0：[doc5/0.98, doc2/0.91, ...]
   P1：[doc8/0.95, doc3/0.87, ...]
   P2：[doc1/0.99, doc6/0.88, ...]

④ 全局排序，取 Top 10：
   [doc1/0.99, doc5/0.98, doc8/0.95, doc2/0.91, doc6/0.88, ...]
   → 只得到 10 个 DocID 列表，暂时不知道文档内容
```

**为什么 Query Phase 不直接返回完整文档？**
```
假设 3 个 Shard，size=10：
  每个 Shard 返回 10 条完整文档 → 网络传输 30 条（每条可能很大）
  全局排序后却只用其中 10 条 → 另外 20 条的数据传输全部浪费
  Shard 多 + size 大 → 浪费极其严重

→ Query Phase 只返回 [DocID + Score]，网络开销极小，是正确的设计
```

---

### 4.3 Fetch Phase 详解

```
① 协调节点拿到全局 Top 10 的 DocID 列表

② 按 DocID 路由到对应 Shard：
   doc1 在 P2 → 发请求到 P2（或其 Replica）
   doc5 在 P0 → 发请求到 P0
   ...
   • 使用 Multi-get 将同一个 Shard 的完成内容批量获取（减少请求数）

③ 各 Shard 返回完整 JSON 文档（_source 字段）
④ 协调节点合并结果，按 Query Phase 确定的顺序排列返回客户端
```

---

### 4.4 不同查询类型的流程差异

| 查询类型 | Query Phase | Fetch Phase | 说明 |
|---------|------------|------------|------|
| `match`、`term` | 所有 Shard | Top N DocID 对应 Shard | 标准全文搜索 |
| `get`（按 ID 查询）| 无 Query Phase | 路由到指定 Shard | 直接按路由公式定位 |
| `agg`（聚合） | 所有 Shard 返回局部聚合结果 | 汇总局部结果 | 不需要返回 _source |
| `filter`上下文（过滤器）| 所有 Shard | Top N | Filter 可被缓存，不计算分数 |

---

### 4.5 分片导致的评分不准问题

**问题缘由：**
```
搜索 "java"，全局共 1000 篇文档包含 "java"
  Shard0：600 篇（IDF 认为这个词很常见，分数低）
  Shard1：200 篇（IDF 认为这个词较少见，分数高）
  → Shard1 的文档会错误地排在前面！因为 IDF 是基于局部 Shard 统计的
```

**解决方案：**
```
方案一：dfs_query_then_fetch（收集全局统计信息）
  GET /index/_search?search_type=dfs_query_then_fetch
  → 在 Query Phase 前先向所有 Shard 收集全局 TF/IDF 统计
  → 基于全局统计计算分数，结果更准确但较慢（多一次展开）

方案二：数据均匀分布（根本解决）
  → 分片足够多 + 文档均匀分布 → 局部 IDF 接近全局 IDF
  → 生产中数据量大时天然趋近准确

方案三：一个 Shard（数据量小时）
  → 单分片时 IDF 就是全局统计，注意不可扩展
```

---

### 4.6 常见查询类型对比

| Query 类型 | 说明 | 是否分词 | 是否评分 | 典型场景 |
|------------|------|--------|--------|----------|
| `match` | 全文匹配 | ✅ | ✅ | 标题、内容搜索 |
| `match_phrase` | 短语匹配 | ✅ | ✅ | "天气不错"连续出现 |
| `term` | 精确匹配 | ❌ | ✅ | 状态码、类型等keyword字段 |
| `terms` | 多值精确匹配 | ❌ | ✅ | IN (“а”,”b”) |
| `range` | 范围查询 | ❌ | ✅ | 价格、时间范围 |
| `bool` | 组合查询 | 取决于子查询 | 取决于子查询 | 多条件组合 |
| `filter` | 过滤不评分 | ❌ | ❌ | 可缓存，性能最好 |
| `fuzzy` | 模糊匹配 | ✅ | ✅ | 搜索词有拼写错误 |
| `wildcard` | 通配符匹配 | ❌ | ✅ | 类似 LIKE，性能差！|

**bool Query 结构：**
```json
{
  "query": {
    "bool": {
      "must":     [{"match": {"title": "java"}}],     // 必须匹配，计分
      "should":   [{"match": {"tag": "并发"}}],   // 应匹配，计分（提分项）
      "filter":   [{"term": {"status": "online"}}],  // 必须匹配，不计分，可缓存
      "must_not": [{"term": {"deleted": true}}]     // 必须不匹配
    }
  }
}
// filter 不计算相关性分数，结果可被内核缓存（bitset cache），性能最好
// 实际开发：能用 filter 的尽量用 filter，不需要相关性的字段放 must
```

---

### 4.7 面试标准答法

> ES 查询分两个阶段：
>
> **Query Phase：** 协调节点将请求广播到所有分片，每个 Shard 尚本地查询、计算分数、内部排序，只返回 **DocID + Score**（不返回文档内容）。协调节点汇总所有分片结果做全局排序，取 Top N 的 DocID 列表。
>
> **Fetch Phase：** 协调节点根据 Top N 的 DocID 列表，去对应 Shard 拖取完整文档内容，合并后返回客户端。
>
> 两阶段设计的目的是避免传输大量无用的文档内容，承担 `from+size × Shard数` 的数据汇总开销。注意：分片局部 IDF 不同可能导致评分偏差，数据量大时自然收敛，问题不大；若数据量小且要求高精度可用 `dfs_query_then_fetch`。

---

### 4.8 常见追问

**Q：Query Phase 为什么不直接返回文档内容，要分两阶段？**
> 假设 5 个 Shard、size=10：若 Query Phase 直接返回文档，每个 Shard 返回 10 条完整文档，协调节点内存累积 50 条数据后只取 10 条返回，40 条的网络传输全部浪费。Shard 越多浪费越严重。分两阶段后只传输最终 10 条的内容。

**Q：ES 的 filter 和 query 有什么区别？**
> `query` 上下文中的条件会计算相关性分数并参与排序；`filter` 上下文中的条件不计算分数，只做是/否匹配，结果可以被 ES 内核缓存（bitset cache）。能用 filter 的尽量用 filter，性能更好。

**Q：wildcard 和 fuzzy 消耗大的原因？**
> `wildcard`：需要遍历 Term Dictionary 中所有 Term 做通配符匹配，无法使用 FST 快速定位，全量扫描词典。尽量避免前缀通配符如 `*java`。  
> `fuzzy`：需计算编辑距离，对每个候选 Term 进行近似匹配计算，开销较大。

**Q：为什么 get（按 ID 获取）比 search 快？**
> get 请求直接按路由公式计算目标 Shard，只访问单个 Shard，无需全局广播汇总，也没有 Query Phase + Fetch Phase 的两轮网络开销。

---

### 4.9 核心要点速记

**两阶段口诀：**
```
Query Phase：广播到所有Shard → 每个Shard本地查询+排序 → 只返回[DocID+分数]
        ↓ 协调节点全局排序取TopN DocID
Fetch Phase：根据DocID路由到对应Shard → 拖取完整文档 → 返回客户端
```

**四个高频考点：**

| 考点 | 答案核心 |
|------|----------|
| **为什么分两阶段** | Query Phase 只传DocID+分数，避免大量无用文档传输 |
| **filter vs query** | filter不计分，可被内核bitset缓存，能 filter尽量 filter |
| **评分不准问题** | 局部IDF导致，可用dfs_query_then_fetch或保证均匀分布 |
| **get vs search** | get按路由单Shard，无广播汇总，比search快得多 |

---

## 五、相关性评分 ⭐⭐

### 5.1 为什么需要相关性评分？

```
搜索结果不应该只看「是否匹配」，还应该看「匹配得多好」。
示例：搜索 "java 并发"，两篇文档都匹配到了：
  文档A： "java" 出现 50 次（主题就是 java 并发）
  文档B： "java" 出现 1 次（全文 10000 字，顺带提了一次）
  → 文档A 明显更相关，应进行排序。
相关性评分的作用：给每个匹配文档计算一个分数，由高到低排序返回结果。
```

---

### 5.2 TF-IDF 公式（ES 5.x 之前的默认算法）

**TF（Term Frequency，词频）：**

$$TF(t, d) = \sqrt{\text{count}(t, d)}$$

> 词项 t 在文档 d 中出现的次数越多，得分越高。用平方根抑制超高频词的影响（出现 100 次不应该是出现 1 次的 100 倍分）。

**IDF（Inverse Document Frequency，逆文档频率）：**

$$IDF(t) = 1 + \ln\left(\frac{\text{numDocs}}{\text{docFreq}(t) + 1}\right)$$

> 包含词项 t 的文档数越少，该词越独特，得分越高。
> - "的"「是」这类常用词出现在几乎所有文档→ IDF 接近 0，基本不贡献分数。
> - "Elasticsearch" 只出现在少数文档 → IDF 高，贡献分数大。

**Norm（文档归一化）：**

$$\text{Norm}(d) = \frac{1}{\sqrt{\text{numTerms}(d)}}$$

> 文档越长，归一化因子越小，避免长文档仅因内容多就占便宜。

**TF-IDF 总分：**

$$\text{score}(t, d) = TF(t,d) \times IDF(t) \times \text{Norm}(d)$$

```
示例计算 "搜索 java"：
  文档A：长度 200词，java 出现 20 次
    TF   = sqrt(20)     ≈ 4.47
    IDF  = 1+ln(1000/50)≈ 3.99（假设全集1000篇,含 java的7×50个→实际按Shard局部统计）
    Norm = 1/sqrt(200)  ≈ 0.071
    得分 = 4.47 × 3.99 × 0.071 ≈ 1.27

  文档B：长度 10000词，java 出现 1 次
    TF   = sqrt(1)      = 1
    IDF  = 3.99（相同）
    Norm = 1/sqrt(10000)= 0.01
    得分 = 1 × 3.99 × 0.01 = 0.04

  → 文档A 得分 1.27 远高于 文档B 得分 0.04，文档A 排名靠前 ✔️
```

**TF-IDF 的不足：**
```
问题一：TF 无饱和，只要词出现次数越多得分就越高
  → 文档长度 50词，"java" 出现 20 次（度很高）
  → 文档长度 500词，"java" 出现 40 次（度差不多）
  → TF-IDF 认为后者得分更高，但前者其实更相关！

问题二：IDF 局部不准（前面第四章讨论过，分片导致 IDF 偏差）
```

---

### 5.3 BM25（ES 5.x+ 默认算法）⭐⭐

**BM25 是 TF-IDF 的改进版，核心公式：**

$$\text{score}(t, d) = IDF(t) \times \frac{TF(t,d) \cdot (k_1 + 1)}{TF(t,d) + k_1 \cdot \left(1 - b + b \cdot \dfrac{|d|}{\text{avgdl}}\right)}$$

**参数含义：**

| 参数 | 默认值 | 含义 |
|------|--------|------|
| $k_1$ | 1.2 | 控制 TF 饱和速度。当 TF 足够大时，得分趋近一个上限而不是无限增长 |
| $b$ | 0.75 | 控制文档长度归一化的程度，=0 不考虑文档长度，=1 完全归一化 |
| $\|d\|$ | - | 当前文档的词数 |
| $\text{avgdl}$ | - | 所有文档的平均词数 |

**BM25 vs TF-IDF 的核心改进：**

```
改进点一：TF 饱和机制

  TF-IDF：TF = sqrt(N)，无上限，词出现越多得分越高

  BM25：TF 增大时得分增長越来越慢，最终趋近一个上限 (k1+1)

                    得分                    
  (k1+1) ────────────────────── BM25
                                      ╱
                                 ╱
                            ╱╱
  0      ─────────────────── TF-IDF (持续升高)
              TF（词出现次数）

  → 长文档中词频高的3不再被过度奖励，更合理

改进点二：文档长度归一化更细腻

  TF-IDF： Norm = 1/sqrt(numTerms)，单独一个因子相乘

  BM25：把文档长度归一化直接融入 TF 公式中
    分母里的 (1 - b + b × |d|/avgdl)：
    - |d| > avgdl：长文档，分母变大，TF 贡献降低（拦截长文档优势）
    - |d| < avgdl：短文档，分母变小，TF 贡献提升（奖励信息密度高的文档）
```

---

### 5.4 实际应用中的评分干预

**场景：搜索结果需要弹性调整排序逻辑**

```json
// 1. function_score：用函数修改相关性分数
GET /index/_search
{
  "query": {
    "function_score": {
      "query": {"match": {"title": "java"}},
      "functions": [
        // 按字段分数提升：点赞数 越高，排名越靠前
        {"field_value_factor": {"field": "likes", "factor": 0.1, "modifier": "log1p"}},
        // 按时间衰减：文章越老分数越低
        {"gauss": {"publish_date": {"origin": "now", "scale": "7d", "decay": 0.5}}}
      ],
      "boost_mode": "multiply"  // 相乘模式：原始相关性分 × function得分
    }
  }
}

// 2. boost：手动调整字段得分权重
{
  "query": {
    "bool": {
      "should": [
        {"match": {"title":   {"query": "java", "boost": 3}}},  // 标题匹配权重 3倍
        {"match": {"content": {"query": "java", "boost": 1}}}   // 正文匹配权重 1倍
      ]
    }
  }
}

// 3. 完全不要相关性分：用 filter + sort 自定义排序字段
{
  "query": {"bool": {"filter": [{"term": {"status": "online"}}]}},
  "sort":  [{"create_time": "desc"}]  // 按时间排序，相关性分无实际意义
}
```

---

### 5.5 面试标准答法

> ES 默认使用 BM25 算法进行相关性评分（ES 5.x 之前用 TF-IDF）。
>
> **TF-IDF**：得分 = 词频（TF）× 逆文档频率（IDF）× 文档归一化（Norm）。它的问题是 TF 没有饱和上限，词出现次数越多得分无限增长，不夸实。
>
> **BM25** 在 TF-IDF 基础上做了两个核心改进：① **TF 饱和**：词频越高得分剂增越慢，趋近一个上限 (k₁+1)，避免了词出现次数对得分的过度奖励；② **文档长度归一化融入 TF：** 通过 b 参数把文档长度与平均长度的比値融入公式，短文档信息密度高时得分得到奖励，长文档则会被据影响。
>
> 面试时不需死记公式，理解 BM25 对 TF-IDF 的两个改进点即可。实际开发中可用 `function_score` 和 `boost` 对相关性分进行干预。

---

### 5.6 常见追问

**Q：搜索结果要按点赞数排序而非相关性，怎么实现？**
> 使用 `function_score` 中的 `field_value_factor`，将 likes 字段的分数融入得分公式，或者用 `sort` 按点赞字段排序（完全放弃相关性分）。

**Q：IDF 为什么能抑制高频常用词的影响？**
> IDF = 1 + ln(numDocs / docFreq)。词 “的” 出现在将近所有文档中，docFreq ≈ numDocs，则 IDF ≈ 1 + ln(1) = 1，贡献几乎为 0。
> 而独特词汇 "Elasticsearch"，假设只在 50/10000 篇文档中出现，IDF = 1 + ln(200) ≈ 6.3，贡献大。

**Q：`constant_score` 是什么？什么时候用？**
> `constant_score` 包裹一个 `filter` 并将所有匹配文档的得分固定为 `boost` 指定的常量分数。适合场景：对类带由、状态等精确字段进行筛选且不需要相关性分时，用它比 `bool.filter` 语义更清晰。

**Q：能否自定义评分算法？**
> 可以。ES 支持在 Mapping 或搜索请求中配置 `similarity` 字段替换算法，如切换到穿越时代的 LMDirichlet。但实际中 99% 的场景 BM25 + function_score 就足够了。

---

### 5.7 核心要点速记

**TF-IDF vs BM25 对比一张表：**

| 对比项 | TF-IDF | BM25 |
|---------|--------|------|
| **TF 处理** | sqrt(N)，无上限升高 | 饱和机制，趋近上限 (k₁+1) |
| **文档长度** | 单独 Norm 相乘 | 融入 TF 公式内部，更细腻 |
| **适用版本** | ES 5.x 之前 | ES 5.x 之后（默认）|
| **效果** | 长文档容易被高分 | 短文档语义高密度者得分更高 |

**三个干预手段：**
- `boost`：手动提升/降低字段权重
- `function_score`：将业务因子（点赞数/时间衰减）融入评分
- `constant_score`：固定分数，完全不需要相关性时使用

---

## 六、集群架构 ⭐⭐⭐⭐

### 6.1 集群健康状态

| 状态 | 颜色 | 含义 |
|------|------|------|
| **Green** | 🟢 | 所有 Primary Shard 和 Replica Shard 都已分配，完全正常 |
| **Yellow** | 🟡 | 所有 Primary Shard 已分配，但部分 Replica 未分配（数据完整，高可用降级）|
| **Red** | 🔴 | 部分 Primary Shard 未分配（有数据缺失，影响搜索结果完整性）|

```
常见场景：
  Yellow：单节点部署，Replica 无法分配到不同节点 → 开发环境正常
  Red：节点宕机且该节点的 Primary Shard 没有 Replica → 数据丢失

查看集群状态：
  GET /_cluster/health
  GET /_cat/indices?v    # 查看每个 Index 状态
  GET /_cat/shards?v     # 查看每个 Shard 分配情况
```

---

### 6.2 节点角色（完整版）

| 角色 | 配置 | 职责 | 存数据 | 建议数量 |
|------|------|------|--------|----------|
| **Master-eligible** | `node.roles: [master]` | 集群管理：创建/删除Index、分配Shard、监控节点健康 | ❌ | 3台（奇数，防脑裂）|
| **Data** | `node.roles: [data]` | 存储分片数据，执行CRUD、搜索、聚合 | ✅ | N台，按数据量水平扩展 |
| **Ingest** | `node.roles: [ingest]` | 写入前Pipeline预处理（字段提取、格式转换等）| ❌ | 1~2台（负载不大时可复用）|
| **Coordinating Only** | `node.roles: []` | 仅路由请求 + 汇总结果，不做其他任何工作 | ❌ | 2~3台，挂LB对外 |
| **ML** | `node.roles: [ml]` | 机器学习任务 | ❌ | 按需 |
| **Remote Cluster Client** | `node.roles: [remote_cluster_client]` | 跨集群搜索/复制 | ❌ | 按需 |

**默认配置：** 未指定 `node.roles` 时，节点身兼 master + data + ingest + coordinating 所有角色。

---

### 6.3 Master 节点详解

**Master 做什么（集群级别元数据管理）：**
```
① 管理集群状态（Cluster State）：
   - 所有节点信息
   - 所有 Index 的 Mapping / Settings
   - 所有 Shard 在哪个节点上（Shard Routing Table）

② Shard 分配决策：
   - 新建 Index 时决定 Shard 分配到哪些节点
   - 节点宕机时将 Shard 重新分配到其他节点
   - 触发 Replica 提升为 Primary

③ 集群状态变更广播：
   - Master 修改 Cluster State 后广播给所有节点
   - 每个节点本地缓存一份 Cluster State
```

**Master 不做什么：**
```
❌ 不参与文档的索引和搜索（除非同时配了 data 角色）
❌ 不处理客户端的读写请求
→ Master 压力主要来自集群状态管理，不是数据读写
→ 所以 Master 节点不需要大内存/大磁盘，但需要稳定低延迟
```

**Master 选举机制：**
```
ES 7.x+：基于 Raft 协议的改进版选举
  ① 集群启动时，所有 master-eligible 节点互相通信
  ② 通过投票选出一个节点作为 Active Master
  ③ 要求获得多数票（quorum = master_eligible_nodes / 2 + 1）
  ④ Master 宕机后，其余 master-eligible 节点重新选举

ES 6.x 及更早：基于 Bully 算法 + discovery.zen.minimum_master_nodes
  → 已弃用，7.x 自动计算 quorum

⚠️ master-eligible 节点数量必须为奇数（3/5/7）
   原因：偶数个节点网络分区时可能双方都恰好半数，无法多数票选举
```

---

### 6.4 Data 节点详解

```
Data 节点承担所有数据密集型操作：
  ✅ 存储 Shard（Primary + Replica）
  ✅ 执行 Index / Get / Search / Aggregation
  ✅ 是集群中资源消耗最大的节点（CPU/内存/磁盘/网络IO）

生产建议：
  - 堆内存：建议 31GB 左右（不超过 32GB，触发指针压缩优化边界）
  - 磁盘：SSD 优先，ES 性能对 IO 极度敏感
  - JVM 堆 ≤ 物理内存的 50%（另外 50% 留给 OS Page Cache 缓存 Segment）
```

**Data 节点冷热分离架构（字节常用）：**

```
Hot Node（热节点）：
  node.roles: [data_hot]
  SSD 高性能磁盘，处理最近 7 天的数据
  写入和查询都打到 Hot Node

Warm Node（温节点）：
  node.roles: [data_warm]
  HDD 大容量磁盘，存储 7~30 天的数据
  只读查询，不再接收写入

Cold Node（冷节点）：
  node.roles: [data_cold]
  最低配置，存储 30 天以上的归档数据
  极少查询

结合 ILM（Index Lifecycle Management）自动迁移：
  Hot（写入+查询）→ 7天后 → Warm（只读）→ 30天后 → Cold（归档）→ 60天后 → Delete
```

---

### 6.5 写入完整流程（集群视角）

```
① 客户端发送写入请求到任意节点（该节点成为 Coordinating Node）

② Coordinating Node 根据路由公式计算目标 Primary Shard：
   shard_id = hash(_id 或 routing) % number_of_primary_shards

③ 转发请求到 Primary Shard 所在的 Data Node

④ Primary Shard 执行写入：
   → 写 In-Memory Buffer + Translog（参见第三章）
   → 成功后，Primary 将请求并行转发到所有 Replica Shard

⑤ 所有 Replica 写入完成后，汇报给 Primary

⑥ Primary 确认写入成功，响应 Coordinating Node → 响应客户端

写入一致性控制（wait_for_active_shards）：
  默认 = 1（只等 Primary 写成功）
  设为 all = 等 Primary + 所有 Replica 全部写成功
  设为 quorum = 等大多数 Shard 写成功
  → 类似 Kafka 的 acks 参数
```

---

### 6.6 搜索完整流程（集群视角）

```
① 客户端发送搜索请求到任意节点（Coordinating Node）

② Query Phase：
   Coordinating Node → 广播到所有 Shard（每个 Shard 选 Primary 或 Replica 之一）
   → 选择策略：默认轮询（Adaptive Replica Selection 自适应选更快的副本）
   → 每个 Shard 本地执行查询 → 返回 [DocID + Score]
   → Coordinating Node 全局排序，取 Top N DocID

③ Fetch Phase：
   Coordinating Node → 根据 DocID 路由到对应 Shard → 拖取完整文档
   → 合并返回客户端

⚠️ Adaptive Replica Selection（ARS）：
   ES 7.x+ 默认开启，不再简单轮询，而是根据副本响应时间、
   队列长度等动态选择最快的副本来处理请求，提升查询性能
```

---

### 6.7 Shard 分配策略

```
Master 在分配 Shard 时遵循的规则：

① Primary 和其 Replica 不在同一节点（核心规则，防止单点全丢）
② 尽量均匀分配到各 Data 节点（节点间 Shard 数量差不超过 1）
③ 感知机架/可用区（可配 cluster.routing.allocation.awareness.attributes）
④ 磁盘水位线控制：
   low  = 85%：停止向该节点分配新 Shard
   high = 90%：开始迁移 Shard 到其他节点
   flood_stage = 95%：该节点上所有 Index 变为只读（保护磁盘）

手动控制 Shard 分配：
  # 排除某节点（下线前迁移 Shard）
  PUT /_cluster/settings
  {"transient": {"cluster.routing.allocation.exclude._name": "node-3"}}

  # 手动移动某个 Shard
  POST /_cluster/reroute
  {"commands": [{"move": {"index": "order", "shard": 0,
    "from_node": "node-1", "to_node": "node-2"}}]}
```

---

### 6.8 面试标准答法

> ES 集群由多个节点组成，每个节点可配置不同角色：**Master** 节点负责集群元数据管理和 Shard 分配决策（不参与数据读写），生产环境部署 3 台（奇数防脑裂），基于 Raft 改进版协议选举 Active Master；**Data** 节点存储分片数据并执行所有 CRUD 和搜索操作，是资源消耗最大的节点，JVM 堆建议 ≤ 31GB 且不超过物理内存 50%（另一半给 Page Cache）；**Coordinating Only** 节点（`node.roles: []`）只做请求路由和结果汇总，适合大规模聚合场景。
>
> 写入时 Coordinating Node 按路由公式定位 Primary Shard，Primary 写入成功后并行同步到所有 Replica。搜索时广播到所有 Shard（通过 ARS 自适应选最快副本），两阶段完成查询和拖取。大集群建议冷热分离架构（Hot/Warm/Cold），配合 ILM 自动管理 Index 生命周期。

---

### 6.9 常见追问

**Q：Master 节点宕机对读写有影响吗？**
> **短暂影响**。Master 宕机后其余 master-eligible 节点几秒内重新选举出新 Master。选举期间不影响已有数据的读写（路由信息在每个节点本地缓存），但**不能**创建/删除 Index、不能重新分配 Shard。选举完成后一切恢复。

**Q：Data 节点宕机怎么处理？**
> Master 感知到节点失联后：① 将该节点上的 Primary Shard 对应的 Replica 提升为新 Primary；② 在其他节点创建新的 Replica 补齐副本数；③ 集群状态从 Yellow 逐渐恢复到 Green。如果该节点上的 Shard 没有 Replica → 数据丢失，集群变 Red。

**Q：为什么 JVM 堆不超过 32GB？**
> JVM 在堆内存 ≤ 32GB 时会启用 **Compressed Oops（压缩对象指针）**，用 4 字节而非 8 字节存储指针，实际可用内存相当于约 40~48GB。超过 32GB 后指针膨胀为 8 字节，内存效率反而下降。所以建议设为 **31GB**（留安全边距）。

**Q：为什么要留一半内存给 OS？**
> ES 底层的 Lucene 大量依赖 OS 的 **Page Cache** 来缓存 Segment 文件（.tim/.doc/.pos 等）。Page Cache 命中时查询走内存，不命中才走磁盘 IO。如果 JVM 堆占满物理内存，OS 没有 Page Cache 空间，查询性能会严重下降。

**Q：冷热分离的 Index 迁移怎么实现？**
> 通过 **ILM（Index Lifecycle Management）** 策略自动完成。设置策略如：Index 创建 7 天后自动迁移到 Warm 节点（修改 `index.routing.allocation.require.data` 属性），30 天后迁移到 Cold 节点，60 天后自动删除。全程无需人工干预。

---

### 6.10 核心要点速记

**节点角色口诀：**
```
Master：管集群状态、分Shard、不碰数据，3台奇数
Data：存数据、干活，堆 ≤ 31GB，留半内存给PageCache
Coordinating：空角色，只路由汇总，挂LB对外
```

**写入流程（集群视角）：**
```
客户端 → 协调节点 → 路由到Primary Shard → Primary写入 → 并行同步Replica → 确认
```

**搜索流程（集群视角）：**
```
客户端 → 协调节点 → 广播所有Shard（ARS选最快副本）→ 汇总排序 → 拖取文档 → 返回
```

**⚠️ 字节追问高频点：**
- JVM堆为什么不超32GB：**Compressed Oops 指针压缩边界**
- 留一半内存给OS：**Lucene依赖Page Cache缓存Segment文件**
- Master宕机影响：**短暂影响，几秒选举完恢复，读写短暂可继续**
- 冷热分离：**Hot/Warm/Cold + ILM自动迁移**

---

## 七、脑裂问题 & 解决方案 ⭐⭐⭐

### 7.1 什么是脑裂（Split Brain）

```
定义：集群中同时出现两个（或以上）Master，各自管理一部分节点，
     集群被拆分为多个独立子集群。

场景还原（5 个节点，3 个 master-eligible）：

  正常状态：
  [Node1(Master)] [Node2] [Node3] [Node4] [Node5]
       │            │       │       │       │
       └───────────┴───────┴───────┴───────┘
                    统一集群

  网络分区后：
  [Node1(Master)] [Node2]    ││    [Node3] [Node4] [Node5]
       │            │       ││       │       │       │
       └───────────┘       ││       └───────┴───────┘
     子集群A（2节点）    网络     子集群B（3节点）
     Master=Node1         断开     Node3/4/5 重新选举
                                  Master=Node3

  结果：两个 Master 同时存在！
  子集群A 和 子集群B 各自独立接受写入 → 数据不一致
  网络恢复后合并 → 数据冲突，可能丢数据
```

---

### 7.2 脑裂的原因

```
根本原因：少数派能够拼凑出多数票，自行选举新 Master

触发条件：
  ① 网络分区（最常见）：机房之间网络中断，两边都认为对方宕机
  ② Master 加载过重：GC 时间过长或 CPU 飙高，导致心跳超时，其他节点认为 Master 已死
  ③ GC STW（Stop The World）：长时间 Full GC 导致心跳无响应
```

---

### 7.3 解决方案

#### 方案一：Quorum 多数派机制（核心解决方案）⭐⭐⭐

```
原理：选举新 Master 必须获得「多数派」票数，少数派无法选举

quorum = master_eligible_nodes / 2 + 1

示例（3 个 master-eligible 节点）：
  quorum = 3/2 + 1 = 2（至少 2 票才能选举）

  网络分区后：
  子集群A（1 个 master-eligible）→ 拿不到 2 票 → 无法选举 → 该侧无 Master，停止服务
  子集群B（2 个 master-eligible）→ 拿到 2 票 → 成功选举 → 该侧正常服务
  → 始终只有一个 Master，不会脑裂！

为什么 master-eligible 节点必须奇数：
  偶数示例（4 个 master-eligible）：
  quorum = 4/2 + 1 = 3
  网络分区 2:2 时：两边都只有 2 个，都不达 3 → 双方都无法选举 → 集群完全不可用！
  奇数示例（3 个）：
  网络分区 1:2 时：多数派有 2 个节点 ≥ quorum(2) → 可选举，少数派无法选举
  → 奇数既能防脑裂，又不会出现两边都不可用的情况
```

---

#### 方案二：ES 各版本的具体实现

```
ES 6.x 及更早（需手动配置）：
  discovery.zen.minimum_master_nodes: 2
  → 手动配置最小主节点数 = quorum
  → 徊端：如果新增/删除 master-eligible 节点忘记调整该值，仍可能脑裂

ES 7.x+（自动计算，推荐）⭐：
  取消 minimum_master_nodes 配置
  新增 cluster.initial_master_nodes（仅首次启动时配置）
  ES 自动跟踪集群中的 master-eligible 节点数量，自动计算 quorum
  → 彻底避免人为配置错误导致脑裂

  # elasticsearch.yml（仅首次启动集群时配置，后续自动管理）
  cluster.initial_master_nodes: ["node-1", "node-2", "node-3"]
```

---

#### 方案三：辅助措施

| 措施 | 配置 | 作用 |
|------|------|------|
| **专用 Master 节点** | `node.roles: [master]`，不兼 data | Master 不会因搜索/聚合负载高导致心跳超时 |
| **调整心跳超时** | `discovery.zen.fd.ping_timeout: 10s`（默认 30s）| 避免 GC 导致的假死误判 |
| **调整 GC** | 使用 G1GC，避免长时间 Full GC | 减少 STW 时间 |
| **跨机房部署** | 3 个机房各放 1 个 master-eligible | 单机房故障仍有 quorum |

---

### 7.4 脑裂后的数据修复

```
万一发生脑裂（比如老版本未正确配置），网络恢复后怎么办？

  ES 7.x 的处理逻辑：
  ① 网络恢复后，两个子集群发现对方
  ② 比较两个 Master 的 Cluster State 版本号（term）
  ③ 版本号低的一方自动放弃 Master 身份，加入对方集群
  ④ 放弃方的节点会重新同步数据（Shard Recovery）
  ⑤ 放弃方在脑裂期间接受的写入 → 可能丢失！

  → 所以脑裂的后果是严重的，必须从架构层面预防
```

---

### 7.5 面试标准答法

> 脑裂是指集群因网络分区产生了**两个独立 Master**，各自接受写入导致数据不一致。
>
> 解决方案核心是 **Quorum（多数派）机制**：选举 Master 必须获得多数票（quorum = N/2+1），少数派无法选举，只能变为不可用状态。因此 master-eligible 节点必须是**奇数**（常用 3 台），偶数会出现分区后两边都不可用的情况。
>
> ES 6.x 需要手动配置 `minimum_master_nodes`，容易错配；ES 7.x 取消了该配置，自动跟踪 master-eligible 数量并计算 quorum，彻底避免人为失误。
>
> 辅助措施：① 专用 Master 节点（不兼 data，避免负载引起心跳超时）；② 调优 GC（用 G1GC 减少 STW）；③ 跨机房部署 master-eligible 节点。

---

### 7.6 常见追问

**Q：2 个 master-eligible 节点能防脑裂吗？**
> 不能。quorum = 2/2+1 = 2，网络分区后每边只有 1 个，都无法拿到 2 票，集群完全不可用。所以至少需要 **3 个** master-eligible 节点。

**Q：全部节点都是 master-eligible 有什么问题？**
> ① Data 节点可能因搜索/聚合负载导致 GC 超时，被误判为宕机，触发不必要的 Master 重新选举；② master-eligible 节点太多会增加选举复杂度和 Cluster State 广播开销。生产建议：**固定 3 台专用 Master 节点，其余全部为纯 Data 节点。**

**Q：脑裂后数据一定会丢失吗？**
> 不一定。如果少数派节点因无法选举而停止服务，就不会接受写入，网络恢复后只需同步即可。只有当**两边都成功选举出 Master 并都接受写入**时，合并时才会丢数据（版本号低的一方被丢弃）。

**Q：脑裂和 Redis Cluster 的类比？**
> 原理类似，Redis Cluster 也需要超过半数 Master 投票才能故障转移（心跳检测 + 超过半数 PFAIL 转 FAIL）。两者都是 Quorum 思想，但 ES 用于 Master 选举，Redis 用于故障判定和主从切换。

---

### 7.7 核心要点速记

**脑裂防治一句话：**
```
3 台专用Master + Quorum多数派选举 + ES 7.x 自动计算 = 不会脑裂
```

**关键数字：**

| 项目 | 值 | 原因 |
|------|-----|------|
| master-eligible 数量 | **3**（奇数）| 偶数分区后双方都不可用 |
| quorum | **N/2 + 1** | 少数派无法形成多数派，阻止重复选举 |
| ES 7.x 改进 | 取消手动配置 | 自动维护 quorum，避免人为失误 |

**⚠️ 字节追问高频点：**
- 为什么奇数：**偶数分区后双方都不够 quorum，集群完全不可用**
- 2个够不够：**不够，quorum=2 但分区后每边只有1个**
- ES 7.x 的改进：**取消 minimum_master_nodes，自动计算 quorum**
- 脑裂后果：**少数派写入可能丢失（版本号低的被放弃）**

---

## 八、深分页问题 & 解决方案 ⭐⭐⭐

### 8.1 问题描述

```
搜索请求：from=10000, size=10（取第 10001~10010 条结果）
假设 5 个 Primary Shard

Query Phase：
  每个 Shard 必须返回前 (from + size) = 10010 条结果
  协调节点收到 5 × 10010 = 50050 条，全局排序后取第 10001~10010 条

问题：
  ① 每个 Shard 要在本地排序和缓存 10010 条 → Shard 内存/CPU 开销大
  ② 协调节点要汇总 50050 条进行全局排序 → 协调节点内存/CPU 开销巨大
  ③ from 越大，浪费越严重（前 10000 条全部丢弃）
  ④ ES 默认限制 from + size ≤ 10000（index.max_result_window）

类比 MySQL：
  SELECT * FROM table ORDER BY id LIMIT 10000, 10;
  → MySQL 也有深分页问题，但只有 1 个节点，不用全局汇总
  → ES 的代价是 Shard数 × (from+size)，因为是分布式查询，比 MySQL 更严重
```

---

### 8.2 三种分页方案对比

| 方案 | 原理 | 实时性 | 能否跳页 | 适用场景 |
|------|------|--------|----------|----------|
| **from + size** | 每个 Shard 返回 from+size 条，全局排序 | ✅ 实时 | ✅ 可跳页 | 前几页浅分页（前台用户列表）|
| **scroll** | 生成快照，维持搜索上下文，逞归翻页 | ❌ 快照时点数据 | ❌ 只能向后翻 | 数据导出、全量迁移 |
| **search_after** | 基于上一页最后一条的排序值继续查 | ✅ 实时 | ❌ 只能向后翻 | **深分页首选方案** |

---

### 8.3 from + size（默认方案）

```json
GET /order-index/_search
{
  "from": 0,
  "size": 10,
  "query": {"match": {"title": "java"}},
  "sort":  [{"create_time": "desc"}]
}
```

**优缺点：**
```
✅ 优点：简单直观，支持跳页（直接跳到第 N 页）
❌ 缺点：
  - from + size > 10000 超过默认限制，报错
  - 可修改 index.max_result_window 放大限制，但不建议（OOM 风险）
  - from 越大性能越差，每个 Shard 都要排序 (from+size) 条数据

实际限制：前台列表通常只展示前 100 页（from ≤ 1000），超过此范围应引导用户缩小搜索范围
```

---

### 8.4 scroll（滚动查询）

```json
// 第一次请求：创建 scroll 上下文，返回 scroll_id
POST /order-index/_search?scroll=5m
{
  "size": 1000,
  "query": {"match_all": {}},
  "sort":  ["_doc"]  // _doc 排序最高效，用于全量导出
}
// 返回：{"_scroll_id": "DXF1ZX....", "hits": {...}}

// 后续请求：用 scroll_id 继续翻页
POST /_search/scroll
{
  "scroll": "5m",
  "scroll_id": "DXF1ZX...."
}

// 用完后清理（释放快照资源）
DELETE /_search/scroll
{"scroll_id": "DXF1ZX...."}
```

**原理 & 特点：**
```
① 首次请求时，每个 Shard 生成当前状态的「快照」（记录当前可见的所有 Segment）
② 后续翻页基于快照，不受新写入影响（查到的是快照时刻的数据）
③ scroll_id 保持每个 Shard 的搜索上下文（位置指针），占用服务端资源
④ 必须在 scroll 超时时间内完成所有翻页，否则上下文失效

✅ 优点：适合全量遍历，不受 max_result_window 限制
❌ 缺点：
  - 非实时（快照数据可能过期）
  - 不能跳页，只能向后翻
  - 占用服务端资源（快照 + 上下文），大量 scroll 会占用大量内存
  - ES 7.x 已不推荐用于实时搜索，推荐 search_after
```

---

### 8.5 search_after（深分页首选方案）⭐⭐⭐

```json
// 第一页：正常查询
GET /order-index/_search
{
  "size": 10,
  "query": {"match": {"title": "java"}},
  "sort":  [
    {"create_time": "desc"},
    {"_id": "asc"}              // 必须加唯一字段作为 tiebreaker，避免排序值相同时丢数据
  ]
}
// 返回最后一条的 sort 值：[1709222400000, "doc_abc123"]

// 第二页：用上一页最后一条的 sort 值作为起点
GET /order-index/_search
{
  "size": 10,
  "query": {"match": {"title": "java"}},
  "search_after": [1709222400000, "doc_abc123"],  // 上一页最后一条的 sort 值
  "sort":  [
    {"create_time": "desc"},
    {"_id": "asc"}
  ]
}
```

**原理 & 特点：**
```
① 不用维护全局 from 偏移量
  而是告诉每个 Shard：“排序值在这个点之后的给我 size 条”
  → 每个 Shard 只需返回 size 条（而非 from+size 条）
  → 无论第多少页，性能恒定！

② 实时数据（不是快照，能看到新写入的数据）

③ 不能跳页，只能「下一页」（因为依赖上一页的最后一条）

✅ 优点：性能恒定、实时数据、不占服务端资源
❌ 缺点：不支持跳页，必须有唯一排序字段作为 tiebreaker
```

**search_after 为什么性能恒定（vs from+size）：**
```
from+size：每个 Shard 返回 from+size 条
  from=10000, size=10 → 每个 Shard 返回 10010 条 → 5个Shard 共 50050 条

search_after：每个 Shard 只返回 size 条
  → 无论第几页，每个 Shard 都只返回 10 条 → 5个Shard 共 50 条
  → 性能差异：50050 vs 50，相差 1000 倍！
```

---

### 8.6 实际生产方案选型

| 场景 | 方案 | 说明 |
|------|------|------|
| 前台搜索结果列表 | from+size（前100页）+ search_after（深分页）| 前几页支持跳页，深层用下一页 |
| 无限下拉列表（像微博、抱抱Feed流）| search_after | 只有“加载更多”，天然不需跳页 |
| 全量数据导出 / 数据迁移 | scroll | 需要遍历所有数据，不关心实时性 |
| 管理后台列表 | from+size（限制最大页数）| 数据量可控，用户少 |
| 报表聚合 | Composite Aggregation | 聚合专用的分页机制 |

**字节典型场景：抱抱Feed流、头条搜索结果、飞书消息列表**
```
都是“下拉加载更多”的交互方式 → 天然适合 search_after
不需要跳页，只需要“比这条早的再给我 10 条”
```

---

### 8.7 面试标准答法

> ES 深分页问题的根源是：from+size 时每个 Shard 都要返回 from+size 条结果，协调节点要汇总 `Shard数 × (from+size)` 条数据做全局排序，当 from 越大浪费越严重。
>
> 解决方案三种：
> - **from+size**：适合前几页浅分页，默认限制 from+size ≤ 10000。
> - **scroll**：生成快照维持上下文，适合数据导出/全量迁移，但非实时且占用服务端资源。
> - **search_after（推荐）**：基于上一页最后一条的排序值继续查询，每个 Shard 只返回 size 条，**无论多深性能恒定**，实时数据，但不支持跳页。
>
> 字节的 Feed 流、搜索结果“加载更多”场景天然适合 search_after。

---

### 8.8 常见追问

**Q：search_after 为什么必须加唯一字段作为 tiebreaker？**
> 如果排序字段的值相同（如两篇文档的 create_time 完全一样），search_after 无法确定「从哪一条开始」，可能丢数据或重复返回。加了 `_id` 作为最后一个排序字段后，每条结果的排序值都是唯一的，不会歧义。

**Q：能否把 max_result_window 调大解决深分页？**
> 技术上可以，但不应该。调大后，每个 Shard 仍需在本地排序和返回 from+size 条数据，协调节点内存消耗巨大，极易导致 OOM。正确做法是改用 search_after。

**Q：scroll 和 search_after 怎么选？**
> 需要**实时数据 + 深分页** → search_after；需要**全量遍历导出** → scroll。实际开发中 scroll 已被官方标记为不推荐用于实时搜索，新项目应优先用 search_after，数据导出场景可用 PIT（Point In Time）+ search_after 替代 scroll。

**Q：什么是 PIT（Point In Time）？**
> ES 7.10+ 引入的新机制，创建一个轻量级时间点快照，配合 search_after 使用，可以在一致性快照上做深分页，替代 scroll 的最佳方案。相比 scroll 更轻量、不绱定搜索上下文。

---

### 8.9 核心要点速记

**三种方案口诀：**
```
from+size：简单能跳页，但不过万。前100页用它。
scroll：快照全量遍历，导出专用。不实时不跳页。
search_after：深分页首选。性能恒定，实时。不能跳页。
```

**性能对比（5 Shard，取第 10001~10010 条）：**

| 方案 | 协调节点汇总数据量 | 性能 |
|------|---------------------|------|
| from+size | 5 × 10010 = **50050 条** | ⓧ 极差 |
| search_after | 5 × 10 = **50 条** | Ⓐ 恒定快 |

**⚠️ 字节追问高频点：**
- 深分页根因：**每个Shard返回from+size条，协调节点汇总Shard数×(from+size)条**
- search_after 为什么快：**每个Shard只返回size条，无论many页性能恒定**
- 必须tiebreaker：**排序值相同时丢数据，加_id保证唯一**
- PIT：**ES 7.10+ 轻量快照，配合search_after替代scroll**

---

## 九、性能优化 ⭐⭐⭐

### 9.1 写入优化

#### ① Bulk 批量写入（最基础）

```json
// 单条写入：每次一次网络往返→ 性能极差
PUT /index/_doc/1 {"title": "java"}

// Bulk 批量写入：一次网络往返提交多条 → 性能提升数十倍
POST /_bulk
{"index": {"_index": "order-index", "_id": "1"}}
{"title": "java 并发"}
{"index": {"_index": "order-index", "_id": "2"}}
{"title": "java JVM"}
...
```

**Bulk 最佳实践：**
```
• 每批次 5~15MB（或 1000~5000 条），太大占用内存，太小网络开销大
• 并发发送：多线程同时发 Bulk，充分利用集群吞吐能力
• 服务端 routing：相同 routing 的文档尽量放同一个 Bulk 请求，减少转发
```

---

#### ② 调整 Refresh 间隔

```json
// 默认每 1s Refresh 一次，生成新 Segment，开销大
// 批量写入时调大或关闭
PUT /order-index/_settings
{
  "index.refresh_interval": "30s"    // 批量写入时调大
  // "index.refresh_interval": "-1"  // 彻底关闭，写完再开
}

效果：减少 Segment 生成频率 → 减少 IO + 减少后续 Merge 开销
写完后恢复：PUT /order-index/_settings {"index.refresh_interval": "1s"}
```

---

#### ③ 关闭副本

```json
// 批量写入前关闭副本
PUT /order-index/_settings {"index.number_of_replicas": 0}

// 写入完成后恢复副本
PUT /order-index/_settings {"index.number_of_replicas": 1}

原理：
  写入时 Primary 要同步到所有 Replica，副本越多写入越慢
  关闭副本后写入速度提升 2~3 倍
  恢复时 ES 自动将 Primary 数据复制到新 Replica
```

---

#### ④ Translog 异步刷盘

```json
PUT /order-index/_settings
{
  "index.translog.durability": "async",     // 异步刷盘（默认 request：每次都刷）
  "index.translog.sync_interval": "5s",     // 每 5s 刷一次
  "index.translog.flush_threshold_size": "1gb"  // Translog 超 1GB 才 Flush
}

风险：节点宕机时最多丢 5s 数据
适用：日志型数据（丢少量可接受），不适合业务主数据
```

---

#### ⑤ Mapping 优化

```
• 不需要搜索的字段设 "index": false     → 不建倒排索引，节省磁盘/内存
• 不需要原文的字段在 _source.excludes 排除  → 减少存储量
• keyword 字段加 ignore_above: 256            → 超长字符串不索引
• 日期字段用 date 类型而不是 text              → 避免分词开销
• 数字字段仅用于过滤/范围查询时用 keyword 而不是 integer  → keyword 的 term 查询更快
• 关闭动态 Mapping："dynamic": "strict"          → 防止意外字段膨胀索引
```

---

#### ⑥ 写入优化汇总表

| 优化项 | 方法 | 效果 | 风险 |
|--------|------|------|------|
| **Bulk 批量** | 每批 5~15MB | 减少网络往返，提升数十倍 | 无 |
| **加大 refresh_interval** | 30s 或 -1 | 减少 Segment 生成 | 搜索延迟增大 |
| **关闭副本** | replicas=0 | 写入提升 2~3 倍 | 无高可用，宕机丢数据 |
| **Translog 异步** | durability=async | 减少 fsync 开销 | 宕机丢 5s 数据 |
| **Mapping 优化** | 关闭不需要的索引 | 减少磁盘/内存开销 | 无 |

---

### 9.2 查询优化

#### ① 用 filter 代替 query（最重要）

```json
// ❌ 不推荐：不需要相关性分的字段放在 must 中
{"query": {"bool": {"must": [{"term": {"status": "online"}}]}}}

// ✅ 推荐：放在 filter 中，不计算分数 + 可被缓存
{"query": {"bool": {"filter": [{"term": {"status": "online"}}]}}}

原理：
  filter 不计算相关性分数 → 节省 CPU
  filter 结果可被内核缓存（Bitset Cache）→ 重复查询直接命中缓存
  性能差异：高频查询场景下 filter 比 must 快 5~10 倍
```

---

#### ② 避免深分页

```
前面第八章已详细讲过：
  前几页 → from+size
  深分页 → search_after（性能恒定）
  数据导出 → PIT + search_after
```

---

#### ③ 合理设计 Shard 数量

```
Shard 太少：
  → 单个 Shard 太大（超过 50GB），查询变慢，恢复时间长

Shard 太多：
  → 每个查询需要打所有 Shard，协调开销线性增长
  → 每个 Shard 占用约 50MB JVM 内存，Shard 数超多占用大量堆内存

最佳实践：
  • 每个 Shard 10GB~50GB
  • 每个 Data 节点的 Shard 数不超过 堆内存GB × 20
    如 31GB 堆 → 最多约 620 个 Shard
  • 小 Index（1GB 以下）用 1 个 Shard 即可，避免无谓扩散
```

---

#### ④ 使用 routing 缩小搜索范围

```json
// 不用 routing：查询广播到所有 Shard
GET /order-index/_search
{"query": {"term": {"merchant_id": "m001"}}}

// 用 routing：只查询 routing 对应的单个 Shard，性能提升 N 倍（N=Shard数）
GET /order-index/_search?routing=m001
{"query": {"term": {"merchant_id": "m001"}}}

前提：写入时也要指定 routing，保证同一商户的数据在同一 Shard
注意：可能导致数据倾斜（某些商户数据量远大于其他）
```

---

#### ⑤ 预计算 & 异步搜索

```
对于复杂聚合查询：
  • 用定时任务预计算结果写入缓存（Redis/另一个Index）
  • 用户查询时直接读缓存，不走 ES 实时聚合

对于耗时查询：
  • 异步搜索（Async Search，ES 7.7+）
  • 客户端发起异步搜索请求 → 返回任务ID → 定期轮询结果
  → 适合搜索耗时超过几秒的场景
```

---

#### ⑥ 其他查询优化技巧

```
• 只返回需要的字段："_source": ["title", "create_time"]
  → 减少网络传输量，尤其是 _source 很大时

• 避免 wildcard 前缀通配符："*java" → 全量扫描词典，性能极差
  → 改用 N-gram 分词器或业务层限制

• 合理使用 index.sort（Index Sorting）：
  PUT /index/_settings {"index.sort.field": ["create_time"], "index.sort.order": ["desc"]}
  → 写入时就按该字段排序存储，查询时提前终止（Early Termination）
  → 适合固定排序场景（如“按时间倒序”）

• 分 Index 而不是全赞一个大 Index：
  按日期：logs-2026-03-06、logs-2026-03-05
  查询时只查近几天的 Index → 减少参与 Shard 数量
  配合 Alias 统一对外名称：
  POST /_aliases {"actions": [{"add": {"index": "logs-2026-03-*", "alias": "logs-latest"}}]}
```

---

### 9.3 查询优化汇总表

| 优化项 | 方法 | 效果 | 适用场景 |
|--------|------|------|----------|
| **filter 代替 query** | 不需要评分的条件放 filter | 节省CPU + Bitset缓存 | 所有场景 |
| **search_after** | 深分页用它替代 from+size | 性能恒定 | 深分页 |
| **合理 Shard 数** | 10~50GB/Shard | 减少协调开销 | 所有场景 |
| **routing** | 缩小搜索范围到单个 Shard | 提升 N 倍 | 多租户/商户查询 |
| **只取需要的字段** | _source filtering | 减少网络传输 | 所有场景 |
| **避免通配符前缀** | 改用 N-gram | 避免全量扫描词典 | 模糊搜索 |
| **Index Sorting** | 写入时预排序 | 查询提前终止 | 固定排序场景 |
| **分时间 Index** | logs-2026-03-06 | 减少参与 Shard 数 | 日志/时序数据 |

---

### 9.4 面试标准答法

> ES 性能优化分写入和查询两方面：
>
> **写入优化：** ① 使用 Bulk API 批量写入（每批 5~15MB）；② 加大 `refresh_interval`（如 30s 或 -1）减少 Segment 生成；③ 临时关闭副本（`replicas=0`）写完再开；④ Translog 异步刷盘（日志场景）；⑤ Mapping 中关闭不需要的字段索引。
>
> **查询优化：** ① 不需要评分的条件用 filter（可被 bitset缓存）；② 深分页用 search_after；③ 合理设计 Shard 数量（10~50GB/Shard）；④ 用 routing 缩小搜索范围；⑤ 只返回需要的字段；⑥ 日志类场景按日期分 Index，减少参与 Shard 数；⑦ 固定排序场景用 Index Sorting 实现提前终止。

---

### 9.5 常见追问

**Q：ES 慢查询如何排查？**
> ① 开启慢查询日志：`PUT /index/_settings {"index.search.slowlog.threshold.query.warn": "10s"}`；② 用 Profile API 分析查询各阶段耗时：`GET /index/_search {"profile": true, ...}`；③ 检查是否用了 wildcard 前缀、是否深分页、是否 Shard 过多。

**Q：为什么只用于 range 查询的数字字段用 keyword 而非 integer？**
> ES 的数字类型（integer/long）底层用 BKD-tree 存储，优化的是多维范围查询。但如果你只做 **等值筛选**（如状态码 0/1/2），term 查询在倒排索引（keyword）上比 BKD-tree 更快。所以：用于 range → integer；用于等值筛选/聚合 → keyword。

**Q：Index Sorting 为什么能提前终止？**
> Segment 内文档已按指定字段排好序，查询时收集到足够的 Top N 结果后可直接停止遍历剩余文档（因为后面的一定比已收集的差）。注意：只对与 Index Sort 相同的排序查询生效，不同排序字段的查询无效。

---

### 9.6 核心要点速记

**写入优化五字诀：** 批、刷、副、异、Mapping
```
批 = Bulk 批量写入
刷 = 加大 refresh_interval
副 = 关闭副本写完再开
异 = Translog 异步刷盘
 Mapping = 关闭不需要的索引
```

**查询优化七字诀：** 滤、深、片、路、少、分、序
```
滤 = filter 代替 query
深 = search_after 解决深分页
片 = 合理 Shard 数量
路 = routing 缩小搜索范围
少 = 只取需要的 _source 字段
分 = 按日期分 Index
序 = Index Sorting 提前终止
```

---

## 十、ES与MySQL双写一致性方案 ⭐⭐⭐

### 10.1 问题背景

```
典型架构：MySQL 为主库（事务性数据），ES 为搜索引擎（全文检索）

核心问题：如何保证两个存储的数据一致性？
  • 业务写 MySQL 成功，写 ES 失败 → 数据不一致
  • 业务写 MySQL 成功，写 ES 成功，但 MySQL 回滚 → 数据不一致
  • 并发更新时顺序不一致 → 数据不一致

关键认知：
  ES 不支持事务，不可能做到与 MySQL 的强一致性
  只能做到「最终一致性」：允许短暂不一致，但最终会趋于一致
```

---

### 10.2 方案一：同步双写（最简单，不推荐）

```java
@Transactional
public void createOrder(Order order) {
    // ① 写 MySQL
    orderMapper.insert(order);
    // ② 写 ES
    esClient.index(order);
}
```

**问题：**
```
① 写 MySQL 成功，写 ES 失败 → MySQL 有数据，ES 没数据
  若写 ES 抛异常导致 MySQL 事务回滚 → 都没数据（业务失败）
  若 catch 异常不回滚 MySQL → 不一致

② ES 写入慢（网络延迟）→ 延长主链路响应时间

③ 不同服务并发更新同一条数据，到达 ES 的顺序不确定 → 最终值可能被旧值覆盖
```

**结论：只适合极简单场景，生产不推荐。**

---

### 10.3 方案二：异步消息队列（常用方案）⭐⭐

```
写入流程：
  ① 业务服务写 MySQL（事务提交）
  ② 事务提交后发送消息到 MQ（Kafka/RocketMQ）
  ③ ES 同步服务消费 MQ 消息，写入 ES

                   MySQL
  业务服务 ──────→  ①写入
     │                ↓ 提交成功
     ├──────→ MQ ─────→ ②发消息
     │                ↓
     │        ES同步服务 ─→ ③消费消息写ES
```

```java
// 业务服务
@Transactional
public void createOrder(Order order) {
    orderMapper.insert(order);
    // 事务提交后发消息（用 @TransactionalEventListener 或编程式）
}

@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
public void onOrderCreated(OrderCreatedEvent event) {
    kafkaTemplate.send("es-sync-topic", event.getOrder());
}

// ES 同步服务
@KafkaListener(topics = "es-sync-topic")
public void syncToES(Order order) {
    esClient.index(order);
}
```

**优缺点：**
```
✅ 解耦：业务服务不直接依赖 ES，主链路不受 ES 性能影响
✅ 重试：MQ 天然支持重试，ES 写入失败可重新消费
✅ 削峰：ES 写入拖不动时消息堆积，不影响主服务

❌ 消息丢失：MQ 发送失败导致 ES 不同步
   → 解决：发送失败重试 + 本地消息表保障
❌ 顺序问题：并发更新同一条数据，消息顺序可能乱
   → 解决：消息带版本号（如 update_time），ES 写入时只接受更新的版本
❌ 延迟：消息堆积时 ES 读到旧数据
   → 可接受，这就是「最终一致性」
```

**顺序问题的版本号解决方案：**
```java
// ES 同步服务写入时带版本号判断
// 方式一：用 ES 的外部版本控制（version_type=external）
PUT /order-index/_doc/1001?version=1709222400&version_type=external
{"order_id": 1001, "status": "paid", "update_time": 1709222400}
// ES 只接受 version 大于当前值的写入，小于等于的被拒绝
// → 天然防止旧消息覆盖新数据

// 方式二：用 Painless 脚本条件更新
POST /order-index/_update/1001
{
  "script": {
    "source": "if (ctx._source.update_time < params.update_time) { ctx._source = params.doc } else { ctx.op = 'noop' }",
    "params": {"update_time": 1709222400, "doc": {"order_id": 1001, "status": "paid"}}
  },
  "upsert": {"order_id": 1001, "status": "paid", "update_time": 1709222400}
}
```

---

### 10.4 方案三：Canal 监听 Binlog（最推荐）⭐⭐⭐

```
原理：
  Canal 伪装为 MySQL 的从库，实时监听 Binlog 变更
  → 将变更事件发送到 MQ
  → ES 同步服务消费 MQ 写入 ES

  MySQL ─── Binlog ───→ Canal ───→ MQ ───→ ES同步服务 ───→ ES
   主库          伪装从库       削峰解耦      消费写入
```

**与方案二的区别：**

| 对比项 | 方案二（业务代码发MQ）| 方案三（Canal监听Binlog）|
|--------|---------------------|---------------------|
| **侵入性** | 需修改业务代码加发消息 | ❌ 零侵入，业务代码无感知 |
| **可靠性** | 事务提交后发消息可能失败 | Binlog 是 MySQL 已提交数据，不会丢 |
| **完整性** | 可能漏发（开发人员忘加）| 所有表变更自动捕获 |
| **顺序性** | 业务代码发送顺序不确定 | Binlog 严格按事务提交顺序 | 
| **复杂度** | 低，代码层完成 | 中，需要部署 Canal 服务 |
| **延迟** | 业务级（毫秒~秒级）| 毫秒级（Canal 实时解析）|

**Canal 架构详解：**
```
Canal Server：
  ① 伪装为 MySQL Slave，发送 dump 协议请求 Binlog
  ② 解析 Binlog 事件（INSERT/UPDATE/DELETE）
  ③ 转发到下游（MQ / ES / Redis / 数据库）

Canal 部署模式：
  • Canal + MQ → ES（推荐，解耦 + 削峰）
  • Canal + Canal Adapter → ES（官方适配器，配置化同步）
  • Canal + Client 自定义处理（最灵活）

注意事项：
  • MySQL 必须开启 Binlog 且格式为 ROW（binlog_format=ROW）
  • Canal 本身需做高可用（Canal HA + ZooKeeper）
  • 大表 DDL 变更时可能导致同步中断，需监控
```

---

### 10.5 方案四：定时任务全量/增量同步（兆底方案）

```
作用：兼底（兆底），确保即使实时同步遗漏，也能定期修复

增量同步：
  每 5 分钟扫描 MySQL 中 update_time > 上次同步时间 的数据
  → 批量更新到 ES

全量同步：
  每天凌晨全量 Reindex 一次，彻底修复数据偏差

缺点：延迟大（5分钟级），仅作为兆底保障，不能作为主方案
```

---

### 10.6 生产推荐架构（组合方案）

```
███ 推荐架构：Canal + MQ + 定时任务兆底 ███

  主链路（实时同步）：
    MySQL ── Binlog ──→ Canal ──→ Kafka ──→ ES同步服务 ──→ ES
    • 零侵入，不改业务代码
    • Binlog 保证顺序 + 不丢数据
    • Kafka 削峰解耦

  兆底（定时修复）：
    定时任务 ──→ 扫描 MySQL 增量数据 ──→ 批量更新 ES
    • 识别 Canal 同步遗漏的数据
    • 修复因异常导致的不一致

  监控告警：
    • 对比 MySQL 和 ES 的数据量，偏差超过阈值告警
    • 监控 Canal 延迟、MQ 积压、ES 写入失败率
```

---

### 10.7 面试标准答法

> ES 与 MySQL 双写一致性本质上只能做到**最终一致性**，因为 ES 不支持事务。
>
> 生产推荐方案是 **Canal 监听 Binlog + MQ + 定时任务兆底**：Canal 伪装 MySQL 从库实时监听 Binlog，事件发送到 Kafka，ES 同步服务消费消息写入 ES。优势是**零侵入**（不改业务代码）、**不丢数据**（Binlog 是已提交数据）、**保证顺序**（Binlog 按事务提交顺序）。配合定时增量同步作为兆底，以及监控告警发现偏差。
>
> 并发更新顺序问题通过 ES 的 **外部版本控制**（`version_type=external`，只接受版本号更大的写入）或 Painless 脚本条件更新解决。

---

### 10.8 常见追问

**Q：为什么不能做强一致？**
> ES 不支持事务，无法参与 MySQL 的分布式事务（2PC/TCC）。强行做强一致会极大降低写入性能，且 ES 写入本身是近实时（1s refresh），追求强一致意义不大。搜索场景对一致性的容忍度本就较高。

**Q：Canal 宕机了怎么办？**
> ① Canal 支持 HA（主备 + ZooKeeper），主宕机后备自动接管；② Canal 会记录消费到的 Binlog 位置（position），恢复后从上次位置继续解析，不会丢数据；③ 兆底的定时任务会修复宕机期间的遗漏。

**Q：如何保证消息不丢？**
> ① Kafka: `acks=all` + `min.insync.replicas=2`；② 消费者手动提交 offset，ES 写入成功后才提交；③ 写入失败重试 + 死信队列 + 告警。

**Q：如果数据量很小，最简单的方案是什么？**
> 异步 MQ（方案二）就够了。业务代码事务提交后发 MQ，消费者写 ES。不需要部署 Canal，开发成本最低。但要注意漏发问题，配合定时任务兆底。

---

### 10.9 核心要点速记

**四种方案一览：**

| 方案 | 侵入性 | 可靠性 | 延迟 | 推荐度 |
|------|--------|--------|------|--------|
| 同步双写 | 高 | 低 | 无 | ❌ |
| 异步MQ | 中 | 中 | 秒级 | ✅ 小规模 |
| **Canal+MQ** | **无** | **高** | **毫秒** | **✅✅ 生产首选** |
| 定时任务 | 无 | 高 | 分钟级 | ✅ 兆底补充 |

**生产推荐组合：**
```
Canal + Kafka + ES同步服务（实时主链路）
    +
定时增量同步（兆底保障）
    +
监控告警（发现偏差）
```

**⚠️ 字节追问高频点：**
- 为什么不能强一致：**ES不支持事务，且搜索场景容忍短暂不一致**
- Canal vs MQ双写：**Canal零侵入+Binlog不丢+保证顺序，MQ双写可能漏发**
- 顺序问题：**ES外部版本控制version_type=external，只接受更大版本**
- 兆底方案：**定时增量同步 + 数据量监控告警**

---

## 🎉 Elasticsearch 模块全部完成 ✅

---
