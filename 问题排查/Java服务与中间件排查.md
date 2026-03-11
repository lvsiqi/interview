# Java服务/数据库/Redis 性能排查实战

> 聚焦 **Java 应用服务**、**MySQL 数据库**、**Redis 缓存** 三大核心组件的性能问题排查  
> 涵盖：CPU 飙高、内存飙高、接口响应慢的**完整排查流程** + **Arthas 深度实战**  
> 面试考察重点：**排查思路的体系化 + 工具命令的熟练度 + 能说出真实案例**

---

## 一、Java 服务 CPU 飙高排查 ⭐⭐⭐

### 1.1 排查全流程（6 步法）

```
告警：Java 进程 CPU 持续 > 80%
    │
    ▼
Step 1️⃣  定位高 CPU 进程
    top -c                                 # 按 P 排序，找到 java PID
    │
    ▼
Step 2️⃣  定位高 CPU 线程
    top -H -p <PID>                        # 找到最高 CPU 的线程 TID
    │
    ▼
Step 3️⃣  线程 ID 转 16 进制
    printf '%x\n' <TID>                    # 例：31365 → 0x7a85
    │
    ▼
Step 4️⃣  导出线程栈
    jstack <PID> > /tmp/thread_dump.log
    grep -A 30 '0x7a85' /tmp/thread_dump.log
    │
    ▼
Step 5️⃣  分析栈帧，判断根因
    │
    ├─ 栈帧在业务代码反复出现           → 死循环
    ├─ 栈帧在 GC 线程                   → 频繁 GC（jstat -gcutil 验证）
    ├─ 栈帧在 Pattern.matches           → 正则回溯（ReDoS）
    ├─ 栈帧在 Cipher/MessageDigest      → 加解密计算密集
    ├─ 栈帧在 Unsafe.park（大量 BLOCKED）→ 锁竞争
    └─ 栈帧在 CompilerThread            → JIT 编译热点
    │
    ▼
Step 6️⃣  Arthas 实时诊断（线上免重启）
    → thread -n 3         # CPU 最高的 3 个线程
    → profiler start      # 火焰图采样
    → profiler stop --format html
```

### 1.2 七大常见根因详解

#### 根因一：死循环 / 无限递归

```java
// 典型场景：HashMap 多线程 put 导致链表成环（JDK 7）
// 栈帧特征：同一方法反复出现
at com.example.OrderService.process(OrderService.java:86)
at com.example.OrderService.process(OrderService.java:86) // 重复

// 排查：Arthas
thread -n 1          // 看 CPU 最高线程的完整栈
// 修复：改用 ConcurrentHashMap / 检查循环条件
```

#### 根因二：频繁 Full GC

```bash
# 栈帧特征：GC 线程占满 CPU
"GC task thread#0 (ParallelGC)" os_prio=0 tid=0x00007f...

# 验证
jstat -gcutil <PID> 1000
#  S0     S1     E      O      M     YGC   YGCT    FGC   FGCT
#  0.00  45.39  99.10  98.72  97.86  1250  12.8     85   48.62
# ☝️ O（老年代）> 95% + FGC 持续增长 → 内存泄漏或堆配置太小

# Arthas 验证
dashboard               # 实时看 GC 次数和堆使用
heapdump /tmp/heap.hprof   # 导出堆转储
```

#### 根因三：正则表达式回溯（ReDoS）

```java
// 危险正则：嵌套量词 (a+)+, (a|a)*, (.*a){x}
Pattern p = Pattern.compile("(\\d+)+\\.");
p.matcher("123456789012345678901234567890!").matches();
// CPU 100%，指数级回溯

// Arthas 定位
profiler start         // 开始火焰图采样
// 等 30 秒
profiler stop --format html --file /tmp/cpu.html
// 火焰图中 Pattern/Matcher 方法栈特别宽 → 正则问题
```

#### 根因四：锁竞争激烈

```bash
# 栈帧特征：大量线程 BLOCKED
"http-nio-8080-exec-15" BLOCKED (on object monitor)
  at com.example.CacheManager.getData(CacheManager.java:45)
  - waiting to lock <0x00000007b5e12340>
  - locked by "http-nio-8080-exec-3"

# Arthas
thread --state BLOCKED   # 查看所有阻塞线程
thread -b                # 找到持有锁的线程（死锁侦测）
```

#### 根因五：线程池打满 + CallerRunsPolicy

```java
// 当线程池和队列都满时，CallerRunsPolicy 让调用者线程执行
// 如果任务是 CPU 密集型，主线程 CPU 也会飙高
ThreadPoolExecutor executor = new ThreadPoolExecutor(
    10, 20, 60, TimeUnit.SECONDS,
    new LinkedBlockingQueue<>(100),
    new ThreadPoolExecutor.CallerRunsPolicy()  // ← 主线程也干活
);

// Arthas 查看线程池状态
vmtool --action getInstances --className java.util.concurrent.ThreadPoolExecutor \
  --express 'instances.{
    #{"active":activeCount,"poolSize":poolSize,"queue":queue.size(),"completed":completedTaskCount}
  }'
```

#### 根因六：序列化 / JSON 解析

```bash
# 大 JSON 或复杂对象序列化非常消耗 CPU
# 火焰图中 Jackson/Gson/Fastjson 的 serialize/deserialize 占比大

# Arthas 验证
trace com.fasterxml.jackson.databind.ObjectMapper writeValueAsString
# 看每次序列化的耗时，如果单次 > 10ms 且 QPS 高 → 瓶颈
```

#### 根因七：JIT 编译风暴

```bash
# 服务刚启动时 CPU 飙高，几分钟后恢复
# 原因：JIT 编译器将热点字节码编译为机器码

# 栈帧特征
"C2 CompilerThread0" daemon prio=9

# 优化：
# 1. 预热（Warm Up）：发布后逐步导入流量
# 2. 分层编译参数：-XX:+TieredCompilation
# 3. AOT 编译（GraalVM Native Image）
```

### 1.3 面试标准答法

> **Q: Java 服务 CPU 飙高怎么排查？**
>
> 1. `top -c` 找到高 CPU 的 Java 进程 PID
> 2. `top -H -p PID` 找到最耗 CPU 的线程 TID
> 3. `printf '%x' TID` 转 16 进制
> 4. `jstack PID` 导出线程栈，grep 对应线程的栈帧
> 5. 分析栈帧判断根因：死循环看业务代码重复、GC 看 "GC task thread"、锁竞争看 BLOCKED 状态
> 6. 线上场景我一般直接用 **Arthas**：`thread -n 3` 找 CPU 最高线程，`profiler` 生成火焰图，火焰图上最宽的栈帧就是热点方法

---

## 二、Java 服务内存飙高排查 ⭐⭐⭐

### 2.1 排查全流程

```
告警：Java 进程 RSS 持续增长 / 频繁 Full GC / OOM
    │
    ▼
Step 1️⃣  确认是堆内还是堆外
    jcmd <PID> GC.heap_info                  # 堆内存使用
    cat /proc/<PID>/status | grep VmRSS      # 实际物理内存
    # 如果 RSS >> 堆内 → 堆外内存问题（Netty DirectBuffer / JNI）
    │
    ▼
Step 2️⃣  堆内内存 → GC 趋势分析
    jstat -gcutil <PID> 3000                 # 每 3 秒看 GC 趋势
    # 重点：每次 Full GC 后 Old 区使用率是否持续上升
    # 70% → 75% → 80% → 85% → 确认泄漏 ✅
    │
    ▼
Step 3️⃣  快速定位可疑对象
    jmap -histo:live <PID> | head -30        # 存活对象排行
    # 看哪个类的实例数 / 占用内存异常大
    │
    ▼
Step 4️⃣  Heap Dump 深度分析
    jmap -dump:live,format=b,file=/tmp/heap.hprof <PID>
    # 或 Arthas: heapdump /tmp/heap.hprof
    # MAT 打开 → Leak Suspects → Dominator Tree
    │
    ▼
Step 5️⃣  找 GC Root 引用链
    MAT → 右键可疑对象 → Path to GC Roots → exclude weak/soft
    # 找到是哪个 static 变量 / ThreadLocal / 缓存持有引用
    │
    ▼
Step 6️⃣  修复 → 灰度验证 → 观察 FGC 后老年代是否回落
```

### 2.2 六大内存泄漏场景 & 代码示例

#### 场景一：静态集合无限增长（最常见）

```java
// ❌ 错误
public class EventBus {
    private static final List<Event> events = new ArrayList<>();
    
    public void publish(Event event) {
        events.add(event);  // 只增不减，永远不会被 GC
    }
}

// ✅ 修复：设置上限 / 定期清理 / 用弱引用
private static final List<Event> events = 
    Collections.synchronizedList(new BoundedList<>(10000));

// ✅ 或使用 Caffeine 缓存（自动淘汰）
private static final Cache<String, Event> cache = Caffeine.newBuilder()
    .maximumSize(10000)
    .expireAfterWrite(10, TimeUnit.MINUTES)
    .build();
```

#### 场景二：ThreadLocal 未 remove

```java
// ❌ 错误：线程池复用线程，ThreadLocal 不会自动清理
private static final ThreadLocal<UserContext> CTX = new ThreadLocal<>();

public void handleRequest() {
    CTX.set(new UserContext(userId, data));  // 设置
    doProcess();
    // ⚠️ 没有 remove！线程归还线程池后 UserContext 永远留在内存
}

// ✅ 修复：用 try-finally 确保 remove
public void handleRequest() {
    CTX.set(new UserContext(userId, data));
    try {
        doProcess();
    } finally {
        CTX.remove();  // 必须 remove ✅
    }
}
```

#### 场景三：连接/流未关闭

```java
// ❌ 错误
public String readFile(String path) {
    BufferedReader reader = new BufferedReader(new FileReader(path));
    return reader.readLine();  // 异常时不会关闭
}

// ✅ 修复：try-with-resources
public String readFile(String path) throws IOException {
    try (BufferedReader reader = new BufferedReader(new FileReader(path))) {
        return reader.readLine();
    }
}

// ❌ HttpClient 连接未释放
CloseableHttpResponse response = httpClient.execute(request);
String body = EntityUtils.toString(response.getEntity());
// 没有 response.close()

// ✅ 修复
try (CloseableHttpResponse response = httpClient.execute(request)) {
    return EntityUtils.toString(response.getEntity());
}
```

#### 场景四：监听器/回调未注销

```java
// ❌ 错误：注册了事件监听但从不注销
applicationContext.addApplicationListener(new MyListener());
// Bean 被 destroy 后，listener 引用仍在 → 无法 GC

// ✅ 修复：实现 DisposableBean 注销
@Component
public class MyListener implements ApplicationListener<MyEvent>, DisposableBean {
    @Override
    public void destroy() {
        // 注销自己
    }
}
```

#### 场景五：大对象进入老年代

```java
// 单次查询返回百万级数据，直接分配在老年代
List<Order> orders = orderMapper.selectAll();  // 100 万条订单
// → 大对象直接分配在 Old Gen → 频繁 Full GC

// ✅ 修复：分页查询 + 流式处理
try (Cursor<Order> cursor = orderMapper.selectAllWithCursor()) {
    cursor.forEach(order -> process(order));
}
```

#### 场景六：堆外内存泄漏（Netty / NIO）

```java
// ❌ Netty ByteBuf 未释放
ByteBuf buf = ctx.alloc().buffer(1024);
// 使用后没有 buf.release()

// ✅ 修复：确保 release 或用 ReferenceCountUtil
try {
    // 使用 buf
} finally {
    ReferenceCountUtil.release(buf);
}

// 排查堆外内存：
// -XX:NativeMemoryTracking=summary
// jcmd <PID> VM.native_memory summary
```

### 2.3 Arthas 内存排查实战

```bash
# 1. 实时内存概览
dashboard
# 重点看：HEAP used/total、GC 次数/耗时

# 2. 堆内对象统计（不需要 dump）
vmtool --action getInstances --className java.util.HashMap --limit 5
# 看 HashMap 实例数是否异常多

# 3. 查看某个类的所有实例
sc -d com.example.UserContext        # 查看类信息
vmtool --action getInstances --className com.example.UserContext \
  --express 'instances.length'
# 看实例数量

# 4. 查看对象内部状态
vmtool --action getInstances --className java.util.ArrayList \
  --express 'instances.{? #this.size > 10000}.size()'
# 找到 size > 1 万的 ArrayList

# 5. 触发 GC 后对比（验证是否泄漏）
vmtool --action forceGc
# 执行后再看对象数，如果不减少 → 确认泄漏

# 6. 生成 heap dump
heapdump /tmp/heap.hprof
# 下载到本地用 MAT 分析
```

---

## 三、Java 服务接口响应慢排查 ⭐⭐⭐

### 3.1 排查全流程

```
现象：接口 P99 从 50ms 飙升到 2s+
    │
    ▼
Step 1️⃣  确认影响范围
    → 所有接口都慢？还是某几个接口？
    → Grafana 看 QPS / RT / 错误率趋势
    → 全局慢 → OS/JVM 问题 | 局部慢 → 接口 / 依赖问题
    │
    ▼
Step 2️⃣  检查 OS 资源
    top → CPU 高？   vmstat → wa 高？
    free -h → Swap 使用？  iostat → IO 高？
    │
    ▼
Step 3️⃣  检查 JVM
    jstat -gcutil → GC 停顿？
    jstack → 线程阻塞？线程池满？
    │
    ▼
Step 4️⃣  链路追踪定位耗时环节
    SkyWalking / Jaeger → 找到慢 Span
    → 数据库？Redis？RPC？外部 HTTP？
    │
    ▼
Step 5️⃣  Arthas 精准定位方法耗时
    trace <类名> <方法名>
    → 看每个内部方法调用的耗时
    │
    ▼
Step 6️⃣  针对性优化
    → DB 慢查询优化 / 加索引
    → Redis 大 Key / 热 Key 优化
    → 连接池配置优化
    → 异步化 / 缓存 / 批量合并
```

### 3.2 Arthas 方法级耗时追踪（核心技能）

```bash
# ========== trace：方法内部耗时拆解 ==========

# 追踪 OrderService.createOrder 方法内部每一步耗时
trace com.example.OrderService createOrder
# 输出示例：
# +---[128ms] com.example.OrderService.createOrder()
#     +---[2ms]   com.example.OrderService.validateParams()
#     +---[85ms]  com.example.OrderMapper.insert()         ← 🔥 瓶颈在 DB
#     +---[35ms]  com.example.RedisService.setCache()
#     +---[3ms]   com.example.MsgProducer.send()

# 只追踪耗时 > 100ms 的调用
trace com.example.OrderService createOrder '#cost > 100'

# 多层追踪（追踪调用链路深入 2 层）
trace com.example.OrderService createOrder -n 5 --skipJDKMethod false

# ========== watch：观察方法入参、返回值、异常 ==========

# 看方法入参和返回值
watch com.example.OrderService createOrder '{params, returnObj}' -x 3
# -x 3 表示展开 3 层对象结构

# 只看异常调用
watch com.example.OrderService createOrder '{params, throwExp}' -e -x 3

# 看方法执行耗时和入参
watch com.example.OrderService createOrder '{params, #cost}' '#cost > 200'

# ========== monitor：方法调用统计 ==========

# 每 10 秒统计一次方法的调用量、成功率、RT
monitor -c 10 com.example.OrderService createOrder
# 输出：
#  timestamp       class        method       total  success  fail  avg-rt(ms)  fail-rate
#  2026-03-11      OrderService createOrder  156    150      6     85.23       3.85%

# ========== stack：查看方法被谁调用 ==========

# 看某个慢方法是从哪里调过来的（反向链路）
stack com.example.OrderMapper insert
# → 看到完整调用链，从 Controller → Service → Mapper

# ========== tt：时间隧道（录制 & 回放） ==========

# 录制方法的每次调用
tt -t com.example.OrderService createOrder -n 20
# 录制最近 20 次调用，包含入参、返回值、耗时

# 查看录制列表
tt -l

# 回放第 3 条（可以重新查看入参和返回值）
tt -i 1003 -p
# → 无需重新发起请求，就能看到当时的完整上下文
```

### 3.3 常见接口慢根因

| 根因 | 特征 | Arthas 验证 | 解决方案 |
|------|------|------------|---------|
| DB 慢查询 | trace 显示 Mapper 方法 > 100ms | `trace *Mapper *` | 优化 SQL / 加索引 |
| 连接池等待 | trace 显示 getConnection 耗时长 | `watch com.zaxxer.hikari.HikariDataSource getConnection '#cost'` | 调大连接池 / 优化持有时间 |
| Redis 大 Key | trace 显示 Redis 操作 > 50ms | `trace org.springframework.data.redis.core.* *` | 拆分大 Key / 压缩 |
| RPC 下游慢 | trace 显示 Feign/Dubbo 调用慢 | `trace *FeignClient *` | 设超时 / 降级 / 缓存 |
| GC 停顿 | 所有接口同时变慢 | `dashboard` 看 GC | 调优 GC 参数 / 减少对象创建 |
| 锁竞争 | trace 显示 synchronized 方法慢 | `thread --state BLOCKED` | 减小锁粒度 / 改无锁方案 |
| 序列化慢 | trace 显示 JSON 序列化 > 20ms | `trace *ObjectMapper writeValueAsString` | 减少序列化字段 / 用 Protobuf |

---

## 四、MySQL 性能问题排查 ⭐⭐⭐

### 4.1 MySQL CPU 飙高排查

```sql
-- ========== Step 1: 查看当前连接和活跃查询 ==========

-- 查看所有连接（等价于 SHOW PROCESSLIST，但功能更强）
SELECT id, user, host, db, command, time, state, info 
FROM information_schema.PROCESSLIST 
WHERE command != 'Sleep' 
ORDER BY time DESC;

-- 找到执行时间最长的查询
SELECT * FROM information_schema.PROCESSLIST 
WHERE command = 'Query' AND time > 5 
ORDER BY time DESC;

-- ========== Step 2: 慢查询日志 ==========

-- 查看慢查询是否开启
SHOW VARIABLES LIKE 'slow_query%';
SHOW VARIABLES LIKE 'long_query_time';

-- 临时开启（不需要重启）
SET GLOBAL slow_query_log = ON;
SET GLOBAL long_query_time = 1;  -- 超过 1 秒记录

-- 分析慢查询日志（命令行工具）
-- mysqldumpslow -s t -t 10 /var/log/mysql/slow.log
-- -s t: 按查询时间排序
-- -t 10: 取 Top 10

-- ========== Step 3: EXPLAIN 分析 ==========

EXPLAIN SELECT * FROM orders WHERE user_id = 12345 AND status = 1;
-- 重点看：
-- type: ALL(全表扫描) → 需要优化
-- rows: 扫描行数过多 → 需要索引
-- key: NULL → 没用到索引
-- Extra: Using filesort / Using temporary → 需要优化

-- ========== Step 4: 查看锁等待 ==========

-- InnoDB 锁等待
SELECT * FROM information_schema.INNODB_LOCK_WAITS;
SELECT * FROM information_schema.INNODB_TRX WHERE trx_state = 'LOCK WAIT';

-- MySQL 8.0+
SELECT * FROM performance_schema.data_lock_waits;

-- ========== Step 5: kill 问题查询（紧急止血） ==========
KILL <thread_id>;  -- kill 慢查询
```

### 4.2 MySQL 内存飙高排查

```sql
-- ========== Buffer Pool 状态 ==========

SHOW GLOBAL STATUS LIKE 'Innodb_buffer_pool%';
-- Innodb_buffer_pool_pages_total   总页数
-- Innodb_buffer_pool_pages_data    数据页
-- Innodb_buffer_pool_pages_free    空闲页（= 0 说明 Buffer Pool 满了）
-- Innodb_buffer_pool_read_requests 逻辑读（命中缓存）
-- Innodb_buffer_pool_reads         物理读（未命中）
-- 命中率 = read_requests / (read_requests + reads) → 应 > 99%

-- ========== 连接数占用内存 ==========

SHOW GLOBAL STATUS LIKE 'Threads%';
-- Threads_connected  当前连接数
-- Threads_running    活跃线程数
-- 每个连接占用内存 ≈ sort_buffer_size + join_buffer_size + read_buffer_size + ...
-- 连接数 × 单连接内存 可能超过配置

SHOW VARIABLES LIKE '%buffer_size%';
SHOW VARIABLES LIKE 'max_connections';

-- ========== 临时表 / 排序缓冲区 ==========

SHOW GLOBAL STATUS LIKE 'Created_tmp%';
-- Created_tmp_disk_tables 过多 → 临时表放到磁盘
-- 原因：tmp_table_size / max_heap_table_size 太小，或查询返回 TEXT/BLOB 字段

-- ========== 内存配置检查 ==========

-- 总内存 ≈ innodb_buffer_pool_size 
--         + max_connections × (sort_buffer + join_buffer + read_buffer + ...)
--         + key_buffer_size（MyISAM）
--         + 其他全局缓冲区

-- 推荐 innodb_buffer_pool_size = 物理内存 × 60%~75%
SHOW VARIABLES LIKE 'innodb_buffer_pool_size';
```

### 4.3 MySQL 查询慢排查 SOP

```
完整排查路径：

1. 确认慢查询
   │── 慢查询日志：mysqldumpslow -s t -t 10
   │── SHOW PROCESSLIST 看当前在跑的慢查询
   │── 监控看 QPS 和 RT 趋势
   │
2. EXPLAIN 分析执行计划
   │── type = ALL → 需要加索引
   │── rows 过大 → 扫描行数太多
   │── Extra = Using filesort → ORDER BY 没用到索引
   │── Extra = Using temporary → GROUP BY 创建临时表
   │
3. 索引问题排查
   │── 是否缺少索引？→ 加索引
   │── 索引是否失效？
   │   ├─ 函数处理：WHERE DATE(create_time) = '2026-03-11'
   │   ├─ 隐式类型转换：WHERE phone = 13800138000（phone 是 varchar）
   │   ├─ 左模糊：WHERE name LIKE '%张'
   │   ├─ OR 连接不同字段：WHERE a = 1 OR b = 2
   │   └─ 不等于：WHERE status != 1（优化器可能不用索引）
   │
4. SQL 改写优化
   │── 深分页：LIMIT 100000, 10 → 改为游标分页
   │── 大 IN：IN (1,2,...10000) → 改为 JOIN 临时表
   │── SELECT * → 只查需要的字段（覆盖索引）
   │── 子查询 → 改为 JOIN
   │
5. 锁问题排查
   │── 行锁等待：INNODB_LOCK_WAITS
   │── 长事务：INNODB_TRX
   │── 间隙锁 / 死锁：SHOW ENGINE INNODB STATUS
   │
6. 架构优化
   └── 读写分离 / 缓存 / 分库分表
```

### 4.4 MySQL 性能关键指标监控

```
┌───────────────────────┬──────────────────────────────────────────────┐
│ 指标                   │ 含义 & 告警阈值                                │
├───────────────────────┼──────────────────────────────────────────────┤
│ QPS                    │ 每秒查询数（基线对比，突增/突降告警）            │
│ TPS                    │ 每秒事务数                                    │
│ Threads_running        │ 活跃线程数，> 50 需关注                        │
│ Threads_connected      │ 连接数接近 max_connections 告警                │
│ Slow_queries           │ 慢查询计数（增量告警）                         │
│ Innodb_row_lock_waits  │ 行锁等待次数                                  │
│ Innodb_row_lock_time   │ 行锁等待总时间（ms）                           │
│ Buffer Pool 命中率      │ < 99% 需关注                                 │
│ Binlog/Relay Log 延迟   │ Seconds_Behind_Master > 10s 告警             │
│ 磁盘 IOPS             │ 接近磁盘上限告警                               │
└───────────────────────┴──────────────────────────────────────────────┘
```

---

## 五、Redis 性能问题排查 ⭐⭐⭐

### 5.1 Redis CPU 飙高排查

```bash
# ========== Step 1: 确认 Redis 进程 CPU ==========
top -c | grep redis

# ========== Step 2: 慢查询日志 ==========
# Redis 内置慢查询记录（内存队列，非文件）
redis-cli SLOWLOG GET 20
# 输出示例：
# 1) (integer) 15           ← 慢查询 ID
# 2) (integer) 1709888400   ← 时间戳
# 3) (integer) 105234       ← 执行时间（微秒）= 105ms ⚠️
# 4) 1) "KEYS"              ← 命令
#    2) "*order*"            ← 参数 → KEYS 命令导致！

# 配置慢查询阈值
redis-cli CONFIG SET slowlog-log-slower-than 10000   # 10ms
redis-cli CONFIG SET slowlog-max-len 500             # 保留 500 条

# ========== Step 3: 实时监控命令 ==========
# 监控实时执行的命令（⚠️ 线上谨慎使用，有性能开销）
redis-cli MONITOR | head -100

# 查看命令统计
redis-cli INFO commandstats
# cmdstat_get:calls=12345678,usec=45678901,usec_per_call=3.70
# cmdstat_hgetall:calls=1234567,usec=98765432,usec_per_call=80.00 ← 慢命令

# ========== Step 4: 检查危险命令 ==========
# 这些命令 O(N) 复杂度，可能导致 CPU 飙高：
# KEYS *            → 全库扫描（用 SCAN 替代）
# HGETALL           → 大 Hash 全取（用 HSCAN/HMGET 替代）
# SMEMBERS          → 大 Set 全取（用 SSCAN 替代）
# SORT              → 排序操作
# LRANGE 0 -1       → 取全部 List（用分段取）
# ZRANGEBYSCORE     → 大范围 ZSet 查询

# ========== Step 5: 检查 Lua 脚本耗时 ==========
# 复杂 Lua 脚本会阻塞 Redis（单线程！）
redis-cli SCRIPT EXISTS <sha>
redis-cli EVALSHA <sha> 0    # 测试 Lua 执行时间
```

### 5.2 Redis 内存飙高排查

```bash
# ========== Step 1: 内存概览 ==========
redis-cli INFO memory
# used_memory_human: 25.6G      ← Redis 数据占用
# used_memory_rss_human: 28.3G  ← 操作系统分配的物理内存
# mem_fragmentation_ratio: 1.10  ← 碎片率（> 1.5 需要处理）
# maxmemory_human: 32G          ← 最大内存限制
# maxmemory_policy: allkeys-lru ← 淘汰策略

# ========== Step 2: 大 Key 扫描 ==========

# 方法一：redis-cli --bigkeys（线上安全）
redis-cli --bigkeys -i 0.1    # -i 0.1 表示每次 SCAN 间隔 100ms（降低影响）
# 输出示例：
# [00.00%] Biggest string found: "order:detail:12345" (5.2MB)
# [00.00%] Biggest hash found:   "user:session:all" (128,543 fields)
# [00.00%] Biggest list found:   "log:queue" (2,456,789 items)

# 方法二：redis-cli --memkeys（Redis 7.0+，更精确）
redis-cli --memkeys -i 0.1 --samples 100

# 方法三：MEMORY USAGE（查看具体 Key 的内存）
redis-cli MEMORY USAGE "user:session:all" SAMPLES 100
# (integer) 134217728    ← 128MB ⚠️

# ========== Step 3: 各数据类型内存占用分析 ==========
redis-cli INFO keyspace
# db0:keys=15678234,expires=12345678,avg_ttl=3600000

# 查看各类型 Key 数量分布
redis-cli --scan --pattern '*' | while read key; do
  echo "$(redis-cli TYPE "$key") $key"
done | awk '{print $1}' | sort | uniq -c | sort -rn
# 简化版：看 INFO keyspace 即可

# ========== Step 4: 内存碎片 ==========
# mem_fragmentation_ratio > 1.5 → 碎片过多
# Redis 4.0+ 支持在线碎片整理
redis-cli CONFIG SET activedefrag yes
redis-cli MEMORY PURGE    # 手动归还内存给 OS

# ========== Step 5: 过期 Key 清理 ==========
# 大量 Key 同时过期 → 定期删除消耗 CPU
# 检查 TTL 分布
redis-cli --scan | while read key; do
  ttl=$(redis-cli TTL "$key")
  echo "$ttl"
done | sort -n | uniq -c | sort -rn | head
# 如果大量 TTL 集中在某个时间点 → 打散过期时间
```

### 5.3 Redis 响应慢排查

```bash
# ========== 延迟诊断工具 ==========

# 1. 内置延迟监测
redis-cli --latency             # 基本延迟测试
redis-cli --latency-history     # 历史延迟（每 15s 一条）
redis-cli --latency-dist        # 延迟分布图
redis-cli --intrinsic-latency 10  # 测试内核固有延迟（基准值）

# 2. 延迟监控（Redis 2.8.13+）
redis-cli CONFIG SET latency-monitor-threshold 5   # 记录 > 5ms 的事件
redis-cli LATENCY LATEST        # 最近各事件的延迟
redis-cli LATENCY HISTORY event # 某事件历史延迟
redis-cli LATENCY DOCTOR        # 延迟诊断报告（⭐ 自动分析原因）

# ========== 常见慢查询根因对照表 ==========
```

| 根因 | 现象 | 排查 | 解决 |
|------|------|------|------|
| 大 Key 操作 | 单个命令 > 50ms | `--bigkeys` + `SLOWLOG` | 拆分大 Key / 用 SCAN 替代 |
| KEYS 命令 | CPU 飙高、其他请求阻塞 | SLOWLOG 看到 KEYS | 用 SCAN 替代 |
| 内存淘汰 | 写操作延迟高 | `INFO stats` 看 evicted_keys | 扩容 / 优化数据结构 |
| 持久化阻塞 | 周期性卡顿 | `INFO persistence` 看 fork 耗时 | 优化 RDB 频率 / 用 AOF |
| 网络问题 | 所有命令都慢 | `--latency` 测延迟 | 检查网络 / 是否跨机房 |
| 连接数过多 | 新建连接慢 | `INFO clients` | 使用连接池（JedisPool/Lettuce） |
| Lua 脚本复杂 | 单次执行 > 100ms | SLOWLOG | 优化 Lua / 拆分逻辑到应用层 |
| 集群热点 | 某 Slot 延迟高 | `CLUSTER INFO` | 热点 Key 加本地缓存 / 拆分 |

### 5.4 大 Key 问题详解（高频面试题）

```bash
# 大 Key 的定义（经验值）：
# String: value > 1MB
# Hash/Set/ZSet/List: 元素数 > 5000 或总大小 > 10MB

# ========== 大 Key 的危害 ==========
# 1. 读写大 Key 耗时长 → 阻塞其他请求（Redis 单线程）
# 2. 大 Key 过期时 DEL 会阻塞（惰性删除 → UNLINK 异步删除）
# 3. 大 Key 迁移（集群 Slot 迁移）超时
# 4. 大 Key 序列化/传输消耗网络带宽

# ========== 大 Key 优化方案 ==========

# 方案一：拆分
# 大 Hash → 按 ID 取模拆分
# user:all → user:0, user:1, ..., user:99
# slot = hash(userId) % 100
# HSET user:{slot} {userId} {data}

# 方案二：压缩
# String Value 过大 → Gzip/Snappy 压缩后存储
byte[] compressed = Snappy.compress(jsonBytes);
jedis.set(key, compressed);

# 方案三：异步删除（避免 DEL 阻塞）
redis-cli UNLINK "big:key"    # 异步删除（Redis 4.0+）
# 或渐进式删除
redis-cli HSCAN "big:hash" 0 COUNT 100  # 分批 HDEL
```

---

## 六、Arthas 工具完全指南 ⭐⭐⭐

### 6.1 安装 & 启动

```bash
# ========== 安装 ==========
# 方式一：一键安装
curl -O https://arthas.aliyun.com/arthas-boot.jar

# 方式二：离线安装（生产环境推荐）
# 提前下载 arthas-packaging-xxx-bin.zip，解压到服务器

# ========== 启动 ==========
java -jar arthas-boot.jar
# 自动列出所有 Java 进程，选择序号即可 attach

# 指定 PID 启动
java -jar arthas-boot.jar <PID>

# Web Console（浏览器访问）
java -jar arthas-boot.jar --target-ip 0.0.0.0
# 访问 http://<IP>:3658
```

### 6.2 核心命令速查表

```
┌───────────────────────────────────────────────────────────────────────┐
│                        Arthas 核心命令分类                              │
├──────────────┬────────────────────────────────────────────────────────┤
│  系统信息      │                                                        │
├──────────────┼────────────────────────────────────────────────────────┤
│ dashboard     │ 实时面板：CPU/内存/GC/线程                               │
│ thread        │ 线程信息：thread -n 3 / thread -b / --state BLOCKED    │
│ jvm           │ JVM 详细信息                                           │
│ sysprop       │ 系统属性                                               │
│ sysenv        │ 环境变量                                               │
│ memory        │ 内存区域详情（heap/non-heap/direct）                     │
├──────────────┼────────────────────────────────────────────────────────┤
│  类 & 方法     │                                                        │
├──────────────┼────────────────────────────────────────────────────────┤
│ sc            │ 搜索类：sc -d com.example.OrderService                 │
│ sm            │ 搜索方法：sm com.example.OrderService *                 │
│ jad           │ 反编译：jad com.example.OrderService                   │
│ mc            │ 编译：mc /tmp/OrderService.java -d /tmp                │
│ redefine      │ 热更新类：redefine /tmp/OrderService.class             │
├──────────────┼────────────────────────────────────────────────────────┤
│  方法监控      │                                                        │
├──────────────┼────────────────────────────────────────────────────────┤
│ trace         │ 方法内部耗时拆解（⭐ 最常用）                            │
│ watch         │ 方法执行数据观测（入参/返回/异常）                        │
│ monitor       │ 方法调用统计（QPS/成功率/RT）                            │
│ stack         │ 调用路径（从哪里调过来的）                               │
│ tt            │ 时间隧道（录制 & 回放方法调用）                           │
├──────────────┼────────────────────────────────────────────────────────┤
│  诊断工具      │                                                        │
├──────────────┼────────────────────────────────────────────────────────┤
│ profiler      │ 火焰图：profiler start → profiler stop --format html   │
│ heapdump      │ 堆转储：heapdump /tmp/heap.hprof                      │
│ vmtool        │ 查看/操作对象实例                                       │
│ ognl          │ 执行 OGNL 表达式（查看 Spring Bean 等）                  │
│ logger        │ 动态修改日志级别                                         │
│ classloader   │ 类加载器信息                                            │
│ mbean         │ MBean 信息                                             │
└──────────────┴────────────────────────────────────────────────────────┘
```

### 6.3 实战场景汇总

#### 场景一：线上动态修改日志级别（不用重启）

```bash
# 查看当前日志级别
logger

# 修改 ROOT 日志级别为 DEBUG
logger --name ROOT --level DEBUG

# 修改某个包的日志级别
logger --name com.example.order --level DEBUG

# 排查完后改回来
logger --name com.example.order --level INFO
```

#### 场景二：查看 Spring Bean 属性 / 调用方法

```bash
# 获取 Spring ApplicationContext
ognl '@com.example.SpringContextUtil@getApplicationContext()'

# 获取某个 Bean
ognl '#context=@com.example.SpringContextUtil@getApplicationContext(), 
      #context.getBean("orderService")'

# 查看 Bean 的属性值（如配置刷新后确认）
ognl '#context=@com.example.SpringContextUtil@getApplicationContext(), 
      #bean=#context.getBean("orderConfig"), 
      #bean.getMaxRetry()'

# 动态调用方法（⚠️ 线上谨慎）
ognl '#context=@com.example.SpringContextUtil@getApplicationContext(), 
      #bean=#context.getBean("cacheManager"), 
      #bean.clearCache("orderCache")'
```

#### 场景三：反编译确认线上代码版本

```bash
# 确认线上运行的代码是否是最新版本
jad com.example.OrderService
# 输出反编译后的 Java 代码，检查是否包含最新修复

# 查看类是从哪个 jar 加载的
sc -d com.example.OrderService
# classLoaderHash: 18b4aac2
# codeSource: /app/lib/order-service-1.2.3.jar   ← 确认 jar 版本
```

#### 场景四：热修复线上 Bug（不用重启）

```bash
# ⚠️ 仅限紧急情况，正常应走发布流程

# Step 1: 反编译当前代码
jad --source-only com.example.OrderService > /tmp/OrderService.java

# Step 2: 修改 Java 文件
vim /tmp/OrderService.java

# Step 3: 编译
mc /tmp/OrderService.java -d /tmp

# Step 4: 热更新
redefine /tmp/com/example/OrderService.class
# 注意：只能修改方法体，不能增减方法/字段
```

#### 场景五：火焰图定位 CPU 热点

```bash
# 开始采样（默认 CPU 采样）
profiler start

# 采样 30 秒后停止并生成 HTML 火焰图
profiler stop --format html --file /tmp/flamegraph.html

# 指定采样事件类型
profiler start --event alloc    # 内存分配火焰图
profiler start --event lock     # 锁竞争火焰图
profiler start --event wall     # 包含阻塞时间

# 查看采样状态
profiler status

# 火焰图解读：
# X 轴：栈帧宽度 = 采样占比（越宽 = 越热）
# Y 轴：调用栈深度
# 顶部最宽的帧 = CPU 时间最多的方法 → 优化目标
```

#### 场景六：排查类冲突 / 类加载问题

```bash
# 查看某个类被哪个 ClassLoader 加载
sc -d com.google.common.collect.ImmutableMap
# 如果有多个结果 → 存在类冲突（不同 jar 包含同名类）

# 查看所有 ClassLoader
classloader -t    # 树形结构显示
classloader -l    # 列表显示（含加载的类数量）

# 查看某 ClassLoader 加载了哪些类
classloader -c <hashcode> --load com.example.OrderService
```

### 6.4 Arthas 使用注意事项

```
⚠️ 生产环境使用 Arthas 的注意事项：

1. trace / watch / tt 会给方法增加字节码增强（AOP）
   → 高 QPS 方法不要长时间 trace，用 -n 限制次数
   → 用完后 reset 还原字节码：reset com.example.OrderService

2. monitor 默认会对匹配的所有重载方法监控
   → 指定精确方法签名减少开销

3. profiler 火焰图会有 1~3% 的 CPU 额外开销
   → 采样 30~60 秒足够，不要长时间运行

4. heapdump 会触发 Full GC
   → 在低峰期执行；先确认堆大小，避免 dump 文件撑爆磁盘

5. redefine 热更新是临时性的
   → 重启后失效；正式修复必须走发布流程

6. ognl 可以执行任意代码
   → 生产环境严格控制权限；不要随意调用写操作

7. 退出时：
   stop    → 完全退出，还原所有增强
   quit    → 退出客户端，后台继续运行
   reset   → 还原指定类的增强
```

---

## 七、综合排查实战案例 ⭐⭐⭐

### 7.1 案例：下单接口 RT 从 50ms 飙到 3s

```
排查过程：

1. Grafana 大盘 → 14:00 开始 RT 飙升，只有下单接口，其他正常
   → QPS 未变化 → 排除流量突增

2. top -c → Java 进程 CPU 40%（正常）
   free -h → 内存正常
   → 排除 OS 资源瓶颈

3. jstat -gcutil → O 区 45%，FGC 0 次
   → 排除 GC 问题

4. Arthas trace：
   trace com.example.OrderService createOrder '#cost > 500'
   
   输出：
   +---[2850ms] com.example.OrderService.createOrder()
       +---[5ms]    validateParams()
       +---[2803ms] orderMapper.insert()          ← 🔥 数据库慢！
       +---[35ms]   redisService.setCache()
       +---[3ms]    mqProducer.send()

5. MySQL SHOW PROCESSLIST → 大量 insert 在等锁
   SHOW ENGINE INNODB STATUS → 发现某个大事务持有行锁 30s 未提交
   → 另一个同事的批量更新脚本在跑，锁住了 orders 表

6. 止血：KILL 批量更新线程
   修复：批量更新改为分批执行 + 错峰调度

根因：批量更新事务持有行锁过久，导致插入 SQL 锁等待
```

### 7.2 案例：Redis 响应从 1ms 飙到 200ms

```
排查过程：

1. Grafana → Redis RT 14:30 开始飙升，所有命令都慢
   → 不是单个 Key 问题，是 Redis 整体慢

2. redis-cli INFO memory
   → used_memory: 30.5G / maxmemory: 32G（接近上限）
   → evicted_keys: 12345（大量淘汰！）

3. redis-cli INFO stats
   → evicted_keys 每秒增长 500+
   → 淘汰策略 allkeys-lru → 每次写入都触发淘汰扫描

4. redis-cli --bigkeys
   → Biggest hash: "report:daily:2026-03-11" (2,456,789 fields, 约 8G)
   → 数据分析团队写了个巨大的 Hash，吃掉了大量内存

5. 止血：UNLINK "report:daily:2026-03-11"（异步删除大 Key）
   恢复：内存释放后 evicted_keys 降为 0，RT 恢复正常

6. 复盘：
   → 大 Key 写入要有限制（Proxy 层拦截 / 业务 Code Review）
   → 数据分析用独立 Redis 实例，不和业务混用
   → 添加大 Key 监控告警

根因：超大 Hash Key 占满内存，触发频繁淘汰，每次写入都要扫描
```

### 7.3 案例：Java 服务频繁 Full GC，每分钟 3 次

```
排查过程：

1. 告警：Full GC 频率 > 1次/分钟
   jstat -gcutil <PID> 3000
   → O 区：85% → FGC → 80% → 1 分钟后又 85% → FGC → 82%
   → ☝️ 每次 FGC 后老年代使用率在升高 → 内存泄漏

2. jmap -histo:live <PID> | head -20
   #instances   #bytes     class
   3,234,567    258,765,360  [B (byte数组)
   2,123,456    84,938,240   java.lang.String
   1,567,890    62,715,600   com.example.dto.UserSession
   ← ☝️ UserSession 实例 156 万个？不正常

3. heapdump /tmp/heap.hprof
   MAT → Leak Suspects:
   "1,567,890 instances of com.example.dto.UserSession 
    retained by java.lang.ThreadLocal$ThreadLocalMap"

4. 找到代码：
   private static final ThreadLocal<UserSession> SESSION = new ThreadLocal<>();
   
   // 在 Filter 中 set
   SESSION.set(userSession);
   
   // ⚠️ 请求结束后没打 remove！
   // 线程池复用线程 → UserSession 永远留在 ThreadLocal → 泄漏

5. 修复：
   try { 
       filterChain.doFilter(request, response);
   } finally { 
       SESSION.remove();  // ✅ 必须 remove 
   }

6. 验证：灰度后 FGC 后 O 区从 80% 降到 30% → 确认修复

根因：ThreadLocal<UserSession> 在 Filter 中 set 但未 remove，线程池复用导致泄漏
```

### 7.4 案例：MySQL CPU 100% 数据库几乎不可用

```
排查过程：

1. 告警：MySQL CPU 100%，大量接口超时

2. SHOW PROCESSLIST → 看到 50+ 个查询在执行：
   SELECT * FROM orders WHERE DATE(create_time) = '2026-03-11'
   → State: Sending data, Time: 30+s

3. EXPLAIN 分析：
   → type: ALL（全表扫描！orders 表 5000 万行）
   → 索引 idx_create_time 存在，但 DATE() 函数导致索引失效

4. 止血：KILL 这些慢查询

5. 修复 SQL：
   -- ❌ 索引失效
   WHERE DATE(create_time) = '2026-03-11'
   
   -- ✅ 修改为范围查询
   WHERE create_time >= '2026-03-11' AND create_time < '2026-03-12'
   → type: range，使用 idx_create_time，扫描行数从 5000 万降到 2 万

6. 复盘：
   → Code Review 加 SQL 规范检查
   → 配置慢查询告警（> 1s 的 SQL 自动通知）

根因：DATE() 函数导致索引失效 → 5000 万行全表扫描
```

---

## 📝 面试速查

```
Q: Java 服务 CPU 飙高怎么排查？
A: top -c 找进程 → top -H -p 找线程 → printf '%x' 转16进制 → jstack 看栈
   或直接 Arthas: thread -n 3 看 CPU 最高线程 + profiler 火焰图
   常见根因：死循环/频繁GC/正则回溯/锁竞争/JIT编译

Q: Java 服务内存飙高怎么排查？  
A: jstat -gcutil 看 GC 趋势（FGC 后 Old 不降 → 泄漏）
   → jmap -histo:live 看对象排行 → dump + MAT 分析 → Path to GC Roots 找引用链
   常见泄漏：static 集合/ThreadLocal 未 remove/连接未关闭/大对象

Q: MySQL CPU 100% 怎么排查？
A: SHOW PROCESSLIST 找慢查询 → EXPLAIN 分析执行计划 → 看索引是否失效
   → 检查锁等待 → kill 慢查询止血 → 优化 SQL/加索引
   常见坑：函数处理字段/隐式类型转换/深分页/全表扫描

Q: Redis 响应变慢怎么排查？
A: SLOWLOG GET 看慢命令 → --bigkeys 扫大 Key → INFO memory 看内存
   → LATENCY DOCTOR 自动诊断
   常见坑：KEYS命令/大Key操作/内存淘汰频繁/持久化fork耗时/Lua脚本复杂

Q: Arthas 常用的排查命令？
A: thread -n 3 (CPU最高线程) / trace (方法耗时拆解) / watch (观察入参返回值)
   / monitor (接口QPS统计) / profiler (火焰图) / heapdump (堆转储)
   / jad (反编译确认代码版本) / logger (动态改日志级别) / tt (时间隧道录制回放)

Q: 怎么判断是内存泄漏还是内存不足？
A: jstat 观察每次 Full GC 后老年代使用率：
   如果每次 FGC 后 Old 区持续上升 → 泄漏（有对象无法回收）
   如果 FGC 后 Old 区回落正常但很快又满 → 内存不足（对象创建太快 / 堆太小）
```
