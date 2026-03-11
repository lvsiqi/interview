# Arthas 深度指南 — 原理·实战·面试 ⭐⭐⭐

> Alibaba 开源的 Java 诊断利器，可在**不重启、不修改代码**的情况下对线上 Java 服务做实时诊断。  
> 本章从底层原理 → 架构设计 → 完整命令详解 → 排查流程 → 高频面试题全面覆盖。

---

## 一、Arthas 核心原理 ⭐⭐⭐

### 1.1 JVM 层基石：Java Agent & Instrument

Arthas 的一切能力都建立在 JVM 提供的两个机制之上：

```
┌─────────────────────────────────────────────────────────────┐
│                     JVM Instrument 机制                      │
│                                                             │
│  ┌───────────────────┐     ┌───────────────────┐           │
│  │  premain Agent     │     │  agentmain Agent   │           │
│  │  (启动时 -javaagent │     │  (运行时 Attach API │           │
│  │   JVM 参数加载)     │     │   动态 attach)      │           │
│  └───────┬───────────┘     └───────┬───────────┘           │
│          │                         │                        │
│          ▼                         ▼                        │
│  ┌────────────────────────────────────────────┐             │
│  │      java.lang.instrument.Instrumentation  │             │
│  │                                            │             │
│  │  • addTransformer()  → 注册类转换器          │             │
│  │  • retransformClasses() → 重新转换已加载的类  │             │
│  │  • redefineClasses()    → 重新定义类         │             │
│  │  • getAllLoadedClasses() → 获取已加载的所有类  │             │
│  └────────────────────────────────────────────┘             │
└─────────────────────────────────────────────────────────────┘
```

**关键知识点：**

| 概念 | 说明 |
|------|------|
| **Java Agent** | JVM 提供的 `-javaagent` 机制，允许在 JVM 启动时（premain）或运行时（agentmain）注入字节码增强逻辑 |
| **Attach API** | `com.sun.tools.attach.VirtualMachine`，允许一个 JVM 进程 attach 到另一个正在运行的 JVM 进程并加载 Agent |
| **Instrumentation** | JVM 提供的字节码修改接口，Agent 拿到 `Instrumentation` 实例后可修改任意已加载类 |
| **ClassFileTransformer** | 类文件转换器，拦截类加载/重加载时的字节码，进行修改后返回 |

### 1.2 Arthas 整体架构

```
┌──────────────────────────────────────────────────────────────────┐
│                          Arthas 架构                              │
│                                                                  │
│  ┌──────────────┐   attach    ┌──────────────────────────────┐  │
│  │   Arthas      │ ─────────→ │    Target JVM (业务进程)      │  │
│  │   Client      │            │                              │  │
│  │ (命令行/Web)   │   JVMTI    │  ┌────────────────────────┐  │  │
│  │               │ ◄─────────→│  │    Arthas Agent         │  │  │
│  └──────┬───────┘            │  │                        │  │  │
│         │                     │  │  ┌──────────────────┐  │  │  │
│         │ WebSocket/          │  │  │ Instrumentation  │  │  │  │
│         │ Telnet              │  │  │ (字节码增强引擎)   │  │  │  │
│         ▼                     │  │  └──────────────────┘  │  │  │
│  ┌──────────────┐            │  │                        │  │  │
│  │  arthas-boot  │            │  │  ┌──────────────────┐  │  │  │
│  │  (启动引导)    │            │  │  │ ASM / ByteKit    │  │  │  │
│  └──────────────┘            │  │  │ (字节码操作框架)   │  │  │  │
│                               │  │  └──────────────────┘  │  │  │
│                               │  │                        │  │  │
│                               │  │  ┌──────────────────┐  │  │  │
│                               │  │  │ SpyAPI           │  │  │  │
│                               │  │  │ (方法拦截桥接)    │  │  │  │
│                               │  │  └──────────────────┘  │  │  │
│                               │  └────────────────────────┘  │  │
│                               └──────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

### 1.3 Arthas 启动流程详解

```
arthas-boot.jar 启动流程：

1️⃣ 列出所有 Java 进程 → 用户选择目标 PID
2️⃣ 通过 Attach API 连接到目标 JVM
   VirtualMachine vm = VirtualMachine.attach(pid);
3️⃣ 加载 arthas-agent.jar 到目标 JVM
   vm.loadAgent(arthasAgentPath, args);
4️⃣ Agent 的 agentmain() 被调用：
   - 获取 Instrumentation 实例
   - 启动 Telnet Server (端口 3658)
   - 启动 HTTP/WebSocket Server (端口 8563)
   - 初始化命令系统
5️⃣ arthas-client 通过 Telnet/WebSocket 连接 Agent
6️⃣ 用户输入命令 → Client 发送到 Agent → Agent 执行并返回结果
```

### 1.4 字节码增强原理（trace/watch/monitor 核心）

当执行 `trace com.example.OrderService createOrder` 时：

```java
// ====== 增强前的原始方法 ======
public Order createOrder(OrderDTO dto) {
    validate(dto);
    Order order = orderMapper.insert(dto);
    cacheService.set(order);
    return order;
}

// ====== Arthas 通过 ASM/ByteKit 增强后的等效逻辑 ======
public Order createOrder(OrderDTO dto) {
    // >>>>>>> Arthas 注入的代码 >>>>>>>
    SpyAPI.atEnter(classLoader, className, methodName, args);
    long _start = System.nanoTime();
    try {
    // <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

        validate(dto);                        // SpyAPI.atInvokeBeforeTracing(...)
        Order order = orderMapper.insert(dto); // SpyAPI.atInvokeAfterTracing(...)  ← 记录每个子调用耗时
        cacheService.set(order);              // SpyAPI.atInvokeAfterTracing(...)
        
        // >>>>>>> Arthas 注入的返回拦截 >>>>>>>
        Object result = order;
        SpyAPI.atExit(classLoader, className, methodName, result, System.nanoTime() - _start);
        return order;
        // <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
    } catch (Throwable t) {
        // >>>>>>> Arthas 注入的异常拦截 >>>>>>>
        SpyAPI.atExceptionExit(classLoader, className, methodName, t, System.nanoTime() - _start);
        throw t;
        // <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
    }
}
```

**关键字节码增强技术栈：**

| 组件 | 职责 |
|------|------|
| **ASM** | Java 字节码操作框架，直接操作 `.class` 字节码 |
| **ByteKit** | Arthas 自研框架，基于 ASM 封装，提供 `@AtEnter`、`@AtExit`、`@AtExceptionExit`、`@AtInvoke` 等注解式字节码插桩 |
| **SpyAPI** | 桥接类，Agent 端和增强代码的通信桥梁，被注入到 Bootstrap ClassLoader |
| **EnhancerAffect** | 记录增强影响了哪些类/方法，用于 `reset` 时还原 |

### 1.5 ClassLoader 隔离机制

```
Arthas 使用自定义 ClassLoader 加载自身类库，与业务代码隔离：

Bootstrap ClassLoader
    ├── SpyAPI（桥接类，需要 Bootstrap 可见）
    │
    ├── Arthas ClassLoader（自定义，加载 Arthas 自身代码）
    │       ├── arthas-core.jar
    │       ├── arthas-client.jar
    │       └── 各种命令实现类
    │
    └── App ClassLoader（业务代码）
            ├── com.example.OrderService
            └── ...

为什么要隔离？
• 防止 Arthas 的依赖（如 ASM、Netty）与业务依赖冲突
• SpyAPI 放在 Bootstrap ClassLoader → 任何 ClassLoader 加载的类都能调用它
```

---

## 二、安装与启动 ⭐⭐

### 2.1 安装方式

```bash
# -------- 方式一：在线一键安装（开发环境推荐）--------
curl -O https://arthas.aliyun.com/arthas-boot.jar
java -jar arthas-boot.jar

# -------- 方式二：离线安装（生产环境推荐）--------
# 1. 本地下载 arthas-packaging-xxx-bin.zip
# 2. 上传到服务器并解压
unzip arthas-packaging-3.7.2-bin.zip -d /opt/arthas
java -jar /opt/arthas/arthas-boot.jar

# -------- 方式三：Docker 环境 --------
# Dockerfile 中添加
COPY arthas-packaging-3.7.2-bin.zip /opt/arthas.zip
RUN unzip /opt/arthas.zip -d /opt/arthas && rm /opt/arthas.zip

# 容器内执行
java -jar /opt/arthas/arthas-boot.jar

# -------- 方式四：通过 as.sh（All-in-One 脚本）--------
curl -L https://arthas.aliyun.com/install.sh | sh
./as.sh
```

### 2.2 启动方式

```bash
# 交互式启动（列出进程选择）
java -jar arthas-boot.jar

# 指定 PID
java -jar arthas-boot.jar 12345

# Web Console（浏览器远程访问）
java -jar arthas-boot.jar --target-ip 0.0.0.0
# 访问 http://<IP>:8563

# 指定 Telnet / HTTP 端口（多实例场景）
java -jar arthas-boot.jar --telnet-port 9998 --http-port 9999

# Tunnel Server（集中管理多实例）
java -jar arthas-boot.jar --tunnel-server 'ws://tunnel-server:7777/ws' --agent-id app01
```

### 2.3 退出方式（重要！）

```bash
quit    # 仅退出当前客户端连接，Agent 继续运行（字节码增强仍在）
stop    # 完全关闭 Arthas Agent，还原所有字节码增强，释放端口（推荐）
reset   # 还原指定类的字节码增强（不退出 Arthas）
        # reset com.example.OrderService
        # reset            ← 还原所有类
```

> **⚠️ 面试重点**：`quit` vs `stop` 的区别是高频追问！`quit` 只是断开客户端连接，增强的字节码还在目标 JVM 里；`stop` 才会做完整的清理。

---

## 三、核心命令完整详解 ⭐⭐⭐

### 3.1 系统信息类

#### dashboard — 实时总览面板

```bash
dashboard
# 输出：
# ┌─ Threads ──────────────────────────────────────────────────┐
# │ ID   NAME                STATE        CPU%  DELTA  TIME    │
# │ 23   http-nio-8080-exec  RUNNABLE     65%   0.2s   5:32    │
# │ 24   http-nio-8080-exec  TIMED_WAIT   0%    0.0s   0:01    │
# ├─ Memory ───────────────────────────────────────────────────┤
# │ heap:  512M / 2048M  (25%)                                 │
# │ eden:  120M / 400M   (30%)                                 │
# │ old:   380M / 1536M  (25%)                                 │
# ├─ GC ───────────────────────────────────────────────────────┤
# │ ygc: 450 / 12.5s   fgc: 2 / 1.2s                          │
# ├─ Runtime ──────────────────────────────────────────────────┤
# │ uptime: 48d 6h 32m                                         │
# └────────────────────────────────────────────────────────────┘

dashboard -n 5       # 只刷新 5 次
dashboard -i 2000    # 刷新间隔 2 秒
```

#### thread — 线程诊断（最高频命令之一）

```bash
# 列出所有线程信息
thread

# 看 CPU 占用 Top N 的线程
thread -n 5

# 查看指定线程堆栈
thread 23

# 查找死锁线程 ⭐
thread -b

# 按状态过滤
thread --state BLOCKED
thread --state WAITING
thread --state TIMED_WAITING

# 查看指定时间内的 CPU 增量
thread -i 5000       # 采样间隔 5 秒，算 CPU 增量更准确

# 查看线程统计
thread --all         # 包括 daemon 线程
```

#### jvm / sysprop / sysenv / memory

```bash
jvm         # JVM 详情：版本、GC 收集器、类加载数、启动参数等

sysprop                           # 查看所有系统属性
sysprop java.version              # 查看指定属性
sysprop user.timezone GMT+8       # 修改属性（运行时）

sysenv                            # 查看所有环境变量
sysenv JAVA_HOME                  # 查看指定环境变量

memory                            # 各内存区域详情
# heap: eden / survivor / old
# non_heap: metaspace / code_cache / compressed_class_space
# direct: 堆外直接内存
```

### 3.2 类与方法查找类

#### sc — Search Class

```bash
# 搜索类（支持通配符）
sc com.example.order.*

# 查看类详细信息（⭐ 看类加载路径、ClassLoader、jar 来源）
sc -d com.example.OrderService
# classInfo: 
#   classLoaderHash: 18b4aac2
#   codeSource: /app/lib/order-service-1.2.3.jar
#   isInterface: false
#   isAnnotation: false
#   superClass: java.lang.Object
#   interfaces: [IOrderService]

# 查看类的字段信息
sc -d -f com.example.OrderService

# 统计类加载数量
sc com.example.* -c    # 返回匹配的类数量
```

#### sm — Search Method

```bash
# 搜索方法
sm com.example.OrderService

# 查看方法详细信息（签名、注解、修饰符）
sm -d com.example.OrderService createOrder

# 通配搜索
sm com.example.OrderService get*
```

#### jad — 反编译（⭐ 确认线上代码版本）

```bash
# 反编译整个类
jad com.example.OrderService

# 只反编译指定方法
jad com.example.OrderService createOrder

# 只输出源代码（不含 ClassLoader 信息）
jad --source-only com.example.OrderService

# 指定 ClassLoader（类冲突时指定用哪个版本）
jad -c 18b4aac2 com.example.OrderService
```

#### mc + redefine — 编译 & 热更新

```bash
# Step 1: 反编译到文件
jad --source-only com.example.OrderService > /tmp/OrderService.java

# Step 2: 编辑修复
# vim /tmp/OrderService.java

# Step 3: 编译
mc /tmp/OrderService.java -d /tmp
# 指定 ClassLoader
mc -c 18b4aac2 /tmp/OrderService.java -d /tmp

# Step 4: 热更新
redefine /tmp/com/example/OrderService.class
```

> **限制**：`redefine` 只能修改方法体内容，不能增删方法、字段、改方法签名。

### 3.3 方法监控类（⭐⭐⭐ 面试重点）

#### trace — 方法内部耗时拆解

```bash
# 基本用法：追踪方法内部每个子调用的耗时
trace com.example.OrderService createOrder

# 输出示例：
# `---ts=2026-03-11 14:30:00;thread_name=http-nio-exec-1;
#     +---[2850.34ms] com.example.OrderService:createOrder()
#         +---[5.21ms]    com.example.OrderValidator:validate()
#         +---[2803.12ms] com.example.OrderMapper:insert() ← 🔥 瓶颈！
#         +---[35.44ms]   com.example.CacheService:set()
#         +---[3.11ms]    com.example.MQProducer:send()

# 过滤耗时 > 500ms 的调用
trace com.example.OrderService createOrder '#cost > 500'

# 限制只抓 5 次
trace com.example.OrderService createOrder -n 5

# 多层追踪（自动展开子方法耗时）⭐
trace com.example.OrderService createOrder --skipJDKMethod false

# 追踪多个类方法（正则匹配）
trace -E com.example.service.* createOrder|updateOrder

# 排除某些方法
trace com.example.OrderService * --exclude-class-pattern com.example.log.*

# 包含 JDK 方法
trace --skipJDKMethod false com.example.OrderService createOrder
```

#### watch — 方法数据观测

```bash
# 观测方法入参
watch com.example.OrderService createOrder '{params}'

# 观测返回值
watch com.example.OrderService createOrder '{returnObj}'

# 观测入参 + 返回值 + 异常
watch com.example.OrderService createOrder '{params, returnObj, throwExp}' -x 3
# -x 3 表示展开对象深度为 3 层

# 只在方法异常时观测
watch com.example.OrderService createOrder '{params, throwExp}' -e

# 条件过滤（只看 userId=123 的调用）
watch com.example.OrderService createOrder '{params, returnObj}' 'params[0].getUserId()==123'

# 方法执行前观测（看入参）
watch com.example.OrderService createOrder '{params}' -b

# 方法执行后（默认）+ 异常时都观测
watch com.example.OrderService createOrder '{params, returnObj, throwExp}' -b -s -e

# 查看调用耗时
watch com.example.OrderService createOrder '{params, returnObj, #cost}' '#cost > 200'
```

**watch 表达式语法（OGNL）：**

| 表达式 | 含义 |
|--------|------|
| `params` | 入参数组 |
| `params[0]` | 第一个参数 |
| `returnObj` | 返回值 |
| `throwExp` | 异常对象 |
| `target` | 当前对象（this） |
| `target.field` | 当前对象的字段 |
| `#cost` | 方法执行耗时（ms） |
| `clazz` | 当前类 |
| `method` | 当前方法 |

#### monitor — 方法调用统计

```bash
# 每 10 秒统计一次方法调用指标
monitor com.example.OrderService createOrder -c 10

# 输出：
# timestamp        class              method       total  success  fail  avg-rt  fail-rate
# 2026-03-11 14:30 OrderService       createOrder  1200   1195     5     23ms    0.42%
# 2026-03-11 14:40 OrderService       createOrder  1350   1340     10    156ms   0.74%  ← 异常升高

# 限制统计轮数
monitor com.example.OrderService createOrder -c 10 --cycle 5
```

#### stack — 方法被谁调用（调用路径追溯）

```bash
# 查看某方法被哪个调用链触发
stack com.example.OrderMapper insert

# 输出：
# ts=2026-03-11 14:30:00;thread_name=http-nio-exec-1;
# @com.example.OrderMapper.insert()
#     at com.example.OrderService.createOrder(OrderService.java:45)
#     at com.example.OrderController.create(OrderController.java:28)
#     at sun.reflect.NativeMethodAccessorImpl.invoke0(...)
#     ...

# 条件过滤
stack com.example.OrderMapper insert 'params[0].getAmount() > 10000'

# 限制次数
stack com.example.OrderMapper insert -n 3
```

> **使用场景**：你知道某个 DAO/底层方法被调用了，但不确定是哪个入口触发的 → 用 `stack` 反向追溯。

#### tt — Time Tunnel 时间隧道（录制 & 回放）

```bash
# 录制方法调用（入参、返回值、异常全部记录）
tt -t com.example.OrderService createOrder

# 输出表格：
# INDEX  TIMESTAMP            COST(ms)  IS-RET  IS-EXP  OBJECT   CLASS        METHOD
# 1000   2026-03-11 14:30:01  23        true    false   0x4a56   OrderService createOrder
# 1001   2026-03-11 14:30:02  2850      true    false   0x4a56   OrderService createOrder ← 慢
# 1002   2026-03-11 14:30:03  18        false   true    0x4a56   OrderService createOrder ← 异常

# 查看某次调用的详情
tt -i 1001
# 显示入参、返回值、异常、耗时、调用线程等

# 回放某次调用（⭐ 用录制到的入参重新执行一次方法）
tt -i 1001 -p
# 注意：会真实执行！有副作用的方法不要随便回放

# 条件筛选
tt -t com.example.OrderService createOrder 'params[0].getUserId()==123'

# 按耗时过滤
tt -t com.example.OrderService createOrder '#cost > 1000'

# 搜索已录制的数据
tt -s 'method.name=="createOrder"'
tt -s 'isThrow==true'    # 只看异常的

# 清除录制数据（释放内存）
tt --delete-all
```

> **⚠️ 注意**：`tt` 录制会保存方法的参数/返回值对象引用，**会阻止 GC 回收**。高并发场景长时间录制可能导致 OOM，务必用 `-n` 限制次数或及时清理。

### 3.4 诊断工具类

#### profiler — 火焰图

```bash
# CPU 火焰图
profiler start                  # 开始 CPU 采样
profiler stop --format html --file /tmp/cpu.html    # 停止并生成

# 内存分配火焰图
profiler start --event alloc
profiler stop --format html --file /tmp/alloc.html

# 锁竞争火焰图
profiler start --event lock
profiler stop --format html --file /tmp/lock.html

# Wall-clock 火焰图（包含线程等待/阻塞时间）⭐
profiler start --event wall
profiler stop --format html --file /tmp/wall.html

# 采样状态 & 结果列表
profiler status
profiler list                   # 支持的事件类型

# 指定采样频率和时长
profiler start --interval 10ms  # 每 10ms 采样一次
profiler stop --format html --file /tmp/flamegraph.html
```

**火焰图解读方法：**

```
┌─────────────────────── 火焰图 ────────────────────────┐
│                                                        │
│  X 轴 = 采样占比（越宽 = 越热）                         │
│  Y 轴 = 调用栈深度（底部 = 入口，顶部 = 叶子方法）       │
│                                                        │
│  ┌─────────────────────────────────────────────────┐   │
│  │              main()                             │   │
│  │   ┌────────────────────────┬──────────────┐     │   │
│  │   │  handleRequest()       │  scheduler() │     │   │
│  │   │  ┌──────────┬────────┐ │              │     │   │
│  │   │  │ doQuery() │ sort() │ │              │     │   │
│  │   │  │██████████│████████│ │              │     │   │
│  │   └──┴──────────┴────────┴─┴──────────────┘     │   │
│  └─────────────────────────────────────────────────┘   │
│                                                        │
│  看顶部最宽的"平顶" → 这就是真正消耗 CPU 的方法          │
│  如果顶部窄但底部宽 → 该方法自己不耗CPU，是子方法耗的     │
└────────────────────────────────────────────────────────┘
```

#### heapdump — 堆转储

```bash
# dump 完整堆（包含不可达对象）
heapdump /tmp/heap.hprof

# 只 dump 存活对象（会先触发 Full GC）
heapdump --live /tmp/heap-live.hprof
```

#### ognl — 执行表达式（⭐ 万能工具）

```bash
# 查看静态变量
ognl '@com.example.AppConfig@MAX_RETRY'

# 调用静态方法
ognl '@java.lang.System@getProperty("java.version")'

# 获取 Spring Bean ⭐
ognl '#ctx=@com.example.SpringContextUtil@getApplicationContext(),
      #ctx.getBean("orderService")'

# 查看 Bean 属性
ognl '#ctx=@com.example.SpringContextUtil@getApplicationContext(),
      #ctx.getBean("orderConfig").getMaxRetry()'

# 查看线程池状态
ognl '#ctx=@com.example.SpringContextUtil@getApplicationContext(),
      #pool=#ctx.getBean("asyncExecutor"),
      new java.util.HashMap(#{
        "coreSize": #pool.getCorePoolSize(),
        "maxSize": #pool.getMaximumPoolSize(),
        "activeCount": #pool.getActiveCount(),
        "queueSize": #pool.getQueue().size(),
        "completedTask": #pool.getCompletedTaskCount()
      })'

# 创建对象
ognl 'new java.util.ArrayList(java.util.Arrays.asList(1,2,3))'

# 遍历 Map
ognl '#map=@com.example.CacheHolder@CACHE, #map.entrySet().size()'

# 指定 ClassLoader 执行
ognl -c 18b4aac2 '@com.example.OrderService@class'
```

#### logger — 动态修改日志级别

```bash
# 查看所有 logger
logger

# 查看指定 logger 详情
logger -n com.example.order

# 动态修改日志级别（不用重启！）⭐
logger --name ROOT --level DEBUG
logger --name com.example.order --level DEBUG

# 修改指定 appender 的 logger
logger --name com.example.order --level DEBUG -c 18b4aac2

# 排查完恢复
logger --name com.example.order --level INFO
```

#### classloader — 类加载器诊断

```bash
# 树形展示ClassLoader层级
classloader -t

# 列表展示（含加载类数量）
classloader -l

# 查看某个ClassLoader加载的所有urls（jar列表）
classloader -c 18b4aac2 -r java/lang/String.class

# 查看ClassLoader对应的详细信息
classloader -c 18b4aac2
```

#### vmtool — 对象实例操作

```bash
# 获取某个类的所有实例
vmtool --action getInstances --className com.example.OrderService

# 获取实例并查看属性
vmtool --action getInstances \
       --className com.example.OrderService \
       --express 'instances[0].orderCount'

# 限制返回数量
vmtool --action getInstances --className com.example.OrderService --limit 5

# 强制 GC
vmtool --action forceGc
```

### 3.5 其他实用命令

```bash
# -------- options：全局开关 --------
options                        # 查看所有选项
options unsafe true            # 允许增强 JDK 核心类（默认 false）
options json-format true       # 输出 JSON 格式

# -------- history：命令历史 --------
history                        # 查看历史命令

# -------- reset：还原字节码增强 --------
reset                          # 还原所有增强过的类
reset com.example.OrderService # 还原指定类

# -------- version：版本信息 --------
version

# -------- cat / pwd / grep：文件操作 --------
cat /app/logs/app.log | grep ERROR
pwd

# -------- keymap：快捷键 --------
keymap                         # 查看所有快捷键绑定

# -------- tee / pipe：管道输出 --------
trace com.example.OrderService createOrder | tee /tmp/trace.log
```

---

## 四、线上排查标准流程 ⭐⭐⭐

### 4.1 CPU 飙高排查流程

```
┌──────────────────────────────────────────────────┐
│         Arthas 排查 CPU 飙高 SOP                   │
│                                                  │
│  Step 1: dashboard 总览                           │
│     → 确认 CPU%、GC 频率、线程分布                  │
│                                                  │
│  Step 2: thread -n 5                              │
│     → 找 CPU 占用最高的 5 个线程                    │
│     → 记录线程名和堆栈                              │
│                                                  │
│  Step 3: thread <ID>                              │
│     → 看具体线程在执行什么方法                       │
│                                                  │
│  Step 4: profiler start → profiler stop           │
│     → 生成火焰图定位热点函数                         │
│                                                  │
│  Step 5: trace <热点类> <热点方法>                   │
│     → 拆解方法内部耗时                              │
│                                                  │
│  Step 6: watch / jad 进一步确认                     │
│     → 查看入参数据、反编译确认代码逻辑                │
│                                                  │
│  Step 7: 定位根因 → 止血 / 修复                     │
│     → reset 还原增强 → stop 退出 Arthas             │
└──────────────────────────────────────────────────┘
```

### 4.2 接口响应慢排查流程

```
┌──────────────────────────────────────────────────┐
│         Arthas 排查接口慢 SOP                      │
│                                                  │
│  Step 1: trace 入口方法                            │
│     trace com.example.Controller handle '#cost>500'│
│     → 定位哪个子方法耗时最长                        │
│                                                  │
│  Step 2: 逐层深入 trace 慢方法                      │
│     trace com.example.Service doLogic '#cost>200' │
│     → 像剥洋葱一样逐层 trace                        │
│                                                  │
│  Step 3: watch 查看入参和返回值                     │
│     watch com.example.Mapper query '{params}'     │
│     → 确认参数是否异常（如缺少 where 条件）         │
│                                                  │
│  Step 4: monitor 持续观察                          │
│     monitor com.example.Service doLogic -c 10     │
│     → 看成功率、平均 RT 趋势                       │
│                                                  │
│  Step 5: 结合外部                                  │
│     → MySQL slow-log / Redis slowlog             │
│     → 网络抓包 / 连接池状态                        │
│                                                  │
│  Step 6: jad 确认代码 → 定根因 → 修复              │
│     → reset → stop                               │
└──────────────────────────────────────────────────┘
```

### 4.3 内存泄漏排查流程

```
┌──────────────────────────────────────────────────┐
│         Arthas 排查内存泄漏 SOP                    │
│                                                  │
│  Step 1: dashboard                                │
│     → 观察 heap 使用率、Old 区占比、FGC 频率        │
│                                                  │
│  Step 2: memory                                   │
│     → 查看各区域内存使用详情                        │
│                                                  │
│  Step 3: profiler start --event alloc             │
│     profiler stop --format html                   │
│     → 生成内存分配火焰图，看哪里分配最多             │
│                                                  │
│  Step 4: vmtool --action getInstances             │
│     → 查看可疑类的实例数量                          │
│                                                  │
│  Step 5: heapdump /tmp/heap.hprof                 │
│     → 导出堆快照，用 MAT/VisualVM 分析             │
│     → 找 Retained Heap 最大的对象                  │
│     → 查看 GC Root 引用链                          │
│                                                  │
│  Step 6: ognl + watch 定位泄漏根因                  │
│     → 找到持有引用的集合/缓存                       │
│     → 确认是否忘记 remove / close                   │
│                                                  │
│  Step 7: 修复 → 验证 → reset → stop               │
└──────────────────────────────────────────────────┘
```

### 4.4 死锁排查流程

```
┌──────────────────────────────────────────────────┐
│         Arthas 排查死锁 SOP                       │
│                                                  │
│  Step 1: thread -b                               │
│     → 一键检测阻塞线程（死锁检测）                 │
│     → 输出持有锁和等待锁的线程对                    │
│                                                  │
│  Step 2: thread --state BLOCKED                   │
│     → 列出所有 BLOCKED 线程                        │
│                                                  │
│  Step 3: thread <ID>                              │
│     → 查看具体线程堆栈                             │
│     → 找到 "waiting to lock" 和 "locked" 信息      │
│                                                  │
│  Step 4: jad 查看加锁代码逻辑                      │
│     → 确认锁的获取顺序                             │
│                                                  │
│  Step 5: 修复 → 统一锁顺序 / 减小锁粒度            │
└──────────────────────────────────────────────────┘
```

### 4.5 类冲突 / ClassNotFoundException 排查

```
┌──────────────────────────────────────────────────┐
│         Arthas 排查类冲突 SOP                     │
│                                                  │
│  Step 1: sc -d <全类名>                           │
│     → 查看类从哪个 jar 加载                       │
│     → 如果搜出多条 → 存在类冲突                    │
│                                                  │
│  Step 2: classloader -t                           │
│     → 查看 ClassLoader 层级                       │
│                                                  │
│  Step 3: jad -c <classLoaderHash> <全类名>         │
│     → 反编译指定 ClassLoader 版本的类              │
│     → 对比不同版本差异                             │
│                                                  │
│  Step 4: classloader -c <hash> --load <类名>      │
│     → 测试指定 ClassLoader 能否加载某类             │
│                                                  │
│  Step 5: 修复 → Maven exclude / shade / relocate  │
└──────────────────────────────────────────────────┘
```

---

## 五、实战排查案例 ⭐⭐⭐

### 案例一：Spring 事务失效，数据不一致

```
现象：
  下单后偶发出现「订单已创建但库存未扣减」的数据不一致情况

排查过程：
  1. watch 观测 OrderService.createOrder 的异常
     watch com.example.OrderService createOrder '{throwExp}' -e
     → 偶尔出现 RuntimeException，但业务没感知（被吞掉了）

  2. jad 反编译 OrderService
     jad com.example.OrderService createOrder
     → 发现方法内部 try-catch 了所有异常并只打了 WARN 日志
     → @Transactional 的方法把异常吞掉了，事务没回滚！

  3. stack 追溯调用链
     stack com.example.OrderService createOrder
     → 发现是内部方法调用（this.createOrder）
     → Spring AOP 代理不生效！事务注解失效

根因：
  • 同类内部方法调用（self-invocation），绕过了 Spring 代理
  • try-catch 吞异常导致事务不回滚

修复：
  • 注入自身代理：@Lazy @Autowired private OrderService self;
  • 或提取到另一个 Service 类
  • 移除 catch-all 或手动 TransactionAspectSupport.setRollbackOnly()
```

### 案例二：线程池耗尽导致接口超时

```
现象：
  某接口间歇性超时 30s，监控显示 QPS 正常但 RT 突然飙到 30000ms

排查过程：
  1. dashboard → CPU 正常，GC 正常
  
  2. thread --state TIMED_WAITING
     → 发现 50+ 个线程在 java.util.concurrent.ThreadPoolExecutor$Worker.run
     → 线程池满了！
  
  3. ognl 查看线程池状态
     ognl '#ctx=@com.example.SpringContextUtil@getApplicationContext(),
           #pool=#ctx.getBean("taskExecutor"),
           new java.util.HashMap(#{
             "core": #pool.getCorePoolSize(),
             "max": #pool.getMaximumPoolSize(),
             "active": #pool.getActiveCount(),
             "queueSize": #pool.getQueue().size(),
             "queueRemaining": #pool.getQueue().remainingCapacity()
           })'
     → core=10, max=10, active=10, queueSize=500, queueRemaining=0
     → 队列满了！

  4. thread -n 10 → 所有工作线程都在等 Redis 响应
  
  5. watch com.example.RedisService get '{params, #cost}' '#cost > 1000'
     → Redis 某些 Key 响应 5~10 秒
  
  6. 登录 Redis → INFO commandstats → KEYS 命令被频繁调用
     → 有个定时任务在执行 KEYS * 扫全库

根因：Redis KEYS 命令阻塞了 Redis 主线程 → 连接超时 → 线程池全部阻塞

修复：
  • 禁止线上使用 KEYS，改用 SCAN
  • Redis 配置 rename-command KEYS ""
  • 线程池设合理超时 + 合理队列大小
```

### 案例三：热更新救急 — 修复线上空指针

```
现象：
  14:00 发版后，某接口持续报 NullPointerException，回滚需要 20 分钟

紧急止血过程：
  1. watch 确认异常
     watch com.example.OrderService process '{params, throwExp}' -e -x 3
     → params[0].getAddress() 返回 null → 后续 address.getCity() 空指针

  2. jad 反编译确认代码
     jad com.example.OrderService process
     → 发布版本漏了 null 检查

  3. 热修复
     jad --source-only com.example.OrderService > /tmp/OrderService.java
     # 编辑添加 null 检查
     mc /tmp/OrderService.java -d /tmp
     redefine /tmp/com/example/OrderService.class
     → 立即生效，异常消失

  4. 后续正式走发布流程修复并部署
```

### 案例四：定位 Full GC 频繁的真凶

```
现象：
  dashboard 显示每分钟 3~4 次 FGC，每次 STW 约 800ms

排查过程：
  1. memory → Old 区使用率在 FGC 后仍有 70%（正常应降到 30% 以下）
     → 有大量对象无法被 GC 回收 = 内存泄漏

  2. profiler start --event alloc → 内存分配火焰图
     → com.example.EventBuffer.addEvent() 占比 40%

  3. vmtool --action getInstances --className com.example.EventBuffer
     → 发现只有 1 个实例，但内部 List 有 200 万元素

  4. sc -d com.example.EventBuffer → 是单例 Bean
     jad com.example.EventBuffer
     → 是一个事件缓冲区，addEvent() 只有 add 没有 remove
     → 消费线程异常退出后不再消费，事件一直堆积

  5. stack com.example.EventBuffer addEvent
     → 每秒约 200 次调用

  6. watch com.example.EventConsumer consume '{throwExp}' -e
     → Consumer 线程抛了 StackOverflowError 后退出

根因：事件消费线程异常退出 → 事件 Buffer 无限增长 → Old 区填满 → 频繁 FGC

修复：
  • Consumer 添加异常兜底 + 线程自动重启
  • Buffer 设置容量上限 + 淘汰策略
  • EventBuffer.addEvent() 添加 size 告警
```

---

## 六、Arthas 与同类工具对比 ⭐⭐

| 特性 | **Arthas** | **jstack/jmap** | **VisualVM** | **JProfiler** | **async-profiler** |
|------|-----------|----------------|-------------|--------------|-------------------|
| 运行时 attach | ✅ | ✅ | ✅ | ✅ | ✅ |
| 免安装Agent | ✅ | ✅ | ❌ | ❌ | ❌ |
| 方法级 trace | ✅ | ❌ | ❌ | ✅ | ❌ |
| watch 参数/返回值 | ✅ | ❌ | ❌ | ✅（GUI） | ❌ |
| 火焰图 | ✅ | ❌ | ❌ | ✅ | ✅ |
| 热更新class | ✅ | ❌ | ❌ | ❌ | ❌ |
| 动态改日志级别 | ✅ | ❌ | ❌ | ❌ | ❌ |
| 反编译 | ✅ | ❌ | ❌ | ❌ | ❌ |
| 命令行操作 | ✅ | ✅ | ❌ | ❌ | ✅ |
| 生产环境适用 | ⭐⭐⭐ | ⭐⭐ | ⭐ | ⭐ | ⭐⭐⭐ |
| 性能开销 | 低~中 | 低 | 中 | 高 | 极低 |
| 适用场景 | 线上诊断 | 快速堆栈 | 开发调试 | 开发性能分析 | 性能采样 |

### Arthas profiler vs async-profiler

```
Arthas 的 profiler 命令底层就是集成了 async-profiler：
• Arthas profiler = async-profiler + 交互式命令行封装
• 直接用 async-profiler 更轻量（单 so 文件），但没有 Arthas 的其他诊断功能
• 推荐：简单性能采样用 async-profiler，综合排查用 Arthas
```

---

## 七、生产环境最佳实践 ⭐⭐⭐

### 7.1 安全与权限控制

```
1. 网络隔离
   • 生产环境禁止 --target-ip 0.0.0.0
   • 只允许通过跳板机/堡垒机访问
   • Telnet/HTTP 端口不暴露外网

2. 认证（Arthas 3.5+）
   • 启动时设置密码：--password <pwd>
   • 或通过 auth-file 配置

3. 操作审计
   • Arthas 会记录命令历史
   • 建议接入统一审计平台

4. 安全选项
   • options strict true  → 严格模式
   • options unsafe false → 禁止增强 JDK 核心类（默认）
```

### 7.2 性能影响控制

```
1. 限制采集次数：所有增强命令必须加 -n
   trace com.example.OrderService createOrder -n 10

2. 限制监控范围：精确指定类名和方法名，避免通配符匹配太多
   ✅ trace com.example.OrderService createOrder
   ❌ trace com.example.* *   ← 增强太多类！

3. 及时清理：
   • 排查完立即 reset 或 stop
   • tt 录制完及时 --delete-all 释放引用

4. 低峰操作：
   • heapdump、profiler 在低峰期执行
   • 高 QPS 方法慎用 watch -x 3（展开深度太大影响性能）

5. profiler 注意事项：
   • 采样 30~60 秒足够，不要长时间运行
   • 生成的火焰图下载到本地分析，不要在服务器上打开浏览器
```

### 7.3 Docker / K8s 环境使用

```bash
# -------- Docker --------
# 方式一：进入容器
docker exec -it <容器ID> bash
java -jar /opt/arthas/arthas-boot.jar

# 方式二：K8s exec
kubectl exec -it <pod-name> -c <container-name> -- bash
java -jar /opt/arthas/arthas-boot.jar

# 注意事项：
# 1. 容器内可能没有 curl/wget → 需要预置 arthas 到镜像
# 2. Alpine 镜像缺少 glibc → profiler 可能不可用
#    解决：使用 musl 版本或切换到非 Alpine 基础镜像
# 3. 容器资源限制 → heapdump 注意磁盘空间

# -------- Tunnel Server（集群管理）--------
# 部署 Tunnel Server（Arthas 3.5+）
java -jar arthas-tunnel-server.jar

# 各 Pod 连接 Tunnel
java -jar arthas-boot.jar \
  --tunnel-server 'ws://tunnel:7777/ws' \
  --agent-id ${HOSTNAME}

# 通过 Tunnel Web Console 选择具体 Pod 进行诊断
# 访问 http://tunnel:8080
```

---

## 八、面试高频题 ⭐⭐⭐

### Q1：Arthas 的实现原理是什么？

> **标准答案**：
> 
> Arthas 基于 **JVM 的 Attach API + Java Agent + Instrument 机制**实现：
> 
> 1. `arthas-boot.jar` 通过 **Attach API** 连接到目标 JVM 进程
> 2. 动态加载 `arthas-agent.jar`，触发 **agentmain()** 方法
> 3. Agent 获取 **Instrumentation** 实例
> 4. 当执行 trace/watch 等命令时，通过 **ASM/ByteKit** 框架修改目标类的字节码
> 5. 在方法入口、出口、异常处注入 **SpyAPI** 回调，收集运行时数据
> 6. Agent 内启动 Telnet/WebSocket Server，与 Client 通信
> 
> 核心关键词：**Attach API → agentmain → Instrumentation → ASM 字节码增强 → SpyAPI 回调**

### Q2：trace 和 watch 的区别？分别什么场景用？

> **标准答案**：
> 
> | 维度 | trace | watch |
> |------|-------|-------|
> | **功能** | 追踪方法内部**每个子调用的耗时** | 观测方法的**入参、返回值、异常** |
> | **关注点** | **时间维度** — 哪一步慢 | **数据维度** — 传了什么、返回了什么 |
> | **输出** | 方法调用树 + 每层耗时 | 参数/返回值/异常的具体值 |
> | **典型场景** | 接口慢，定位瓶颈在哪个子方法 | 排查参数错误、返回值异常、异常堆栈 |
> 
> **实战组合**：先用 `trace` 找到耗时最长的方法，再用 `watch` 查看该方法的入参是否有问题。

### Q3：Arthas 对线上服务有性能影响吗？如何控制？

> **标准答案**：
> 
> **有一定影响**，因为 trace/watch 等命令会通过字节码增强在目标方法中注入额外代码：
> 
> - `dashboard`、`thread`、`jvm`：**几乎无影响**，只是读取 JMX 信息
> - `trace`、`watch`、`monitor`：**有影响**，会增加方法执行时间（微秒级），高 QPS 场景可能有可感知影响
> - `profiler`：**1~3% CPU 开销**，采样式，影响较小
> - `heapdump`：**影响最大**，会触发 Full GC，建议低峰执行
> 
> **控制手段**：
> 1. 所有增强命令加 `-n` 限制次数
> 2. 精确匹配类名方法名，避免通配符匹配太多类
> 3. 排查完立即 `reset` 还原字节码
> 4. 高 QPS 方法用条件过滤 `'#cost > 500'` 减少输出

### Q4：quit 和 stop 有什么区别？

> **标准答案**：
> 
> | 命令 | 行为 |
> |------|------|
> | `quit` | 只断开当前客户端连接。Agent **继续运行**在目标 JVM 中，字节码增强**仍然生效**，端口继续监听 |
> | `stop` | **完全关闭** Arthas Agent，**还原所有字节码增强**，释放端口，完全退出 |
> | `reset` | 只还原指定类（或所有类）的增强，但 Arthas Agent 继续运行 |
> 
> **最佳实践**：排查完先 `reset` 还原增强，确认没问题后 `stop` 完全退出。

### Q5：Arthas 的 redefine 有什么限制？

> **标准答案**：
> 
> `redefine` 基于 JVM 的 `Instrumentation.redefineClasses()`，有以下限制：
> 
> 1. **只能修改方法体**：不能新增/删除方法、不能新增/删除字段
> 2. **不能改变类的继承关系**、接口实现
> 3. **不能修改方法签名**（参数类型、返回类型）
> 4. **重启后失效**：redefine 是内存级别的，类文件没变
> 5. 与其他 Agent（如 SkyWalking）的增强可能冲突
> 
> 适用场景：紧急修复线上 Bug（如加 null 检查、改日志级别），正式修复要走发布流程。

### Q6：如何用 Arthas 排查线上 CPU 飙高？完整思路？

> **标准答案**：
> 
> 1. `dashboard` → 总览 CPU、GC、线程状态
> 2. `thread -n 5` → 找 CPU 最高的线程，看堆栈
> 3. 如果是 GC 线程占 CPU → `jvm` 看 GC 类型 → `heapdump` 分析
> 4. 如果是业务线程 → `thread <ID>` 看在执行什么方法
> 5. `profiler start` → 采样 30 秒 → `profiler stop --format html` 生成火焰图
> 6. 火焰图找顶部最宽的平顶 → 就是 CPU 热点方法
> 7. `trace <类> <热点方法> -n 10` → 拆解内部耗时
> 8. `watch` 检查入参是否有异常数据（如超大集合排序）
> 9. `jad` 反编译确认代码逻辑
> 10. 定位根因 → `reset` → `stop` → 修复

### Q7：tt 命令有什么用？使用时要注意什么？

> **标准答案**：
> 
> `tt`（Time Tunnel 时间隧道）可以**录制方法的每次调用**（入参、返回值、异常、耗时），并且支持**回放**。
> 
> **使用场景**：
> - 问题偶发，难以复现时，用 tt 录制等待问题出现
> - 需要对比正常调用和异常调用的入参差异
> - 需要用相同参数重新执行一次方法（回放调试）
> 
> **注意事项**（⚠️ 重要）：
> 1. **内存风险**：tt 会持有方法参数/返回值的**强引用**，阻止 GC 回收
>    - 高并发场景不要长时间录制
>    - 必须加 `-n` 限制录制次数
>    - 用完 `tt --delete-all` 释放引用
> 2. **回放风险**：`tt -i <index> -p` 会**真实执行方法**
>    - 有副作用的方法（写数据库、发消息）不要回放
> 3. 录制大对象会占用大量内存

### Q8：线上环境使用 Arthas 需要注意哪些安全问题？

> **标准答案**：
> 
> 1. **网络隔离**：不暴露 Arthas 端口（3658/8563）到外网，通过跳板机/堡垒机访问
> 2. **权限控制**：设置认证密码（`--password`），只允许授权人员使用
> 3. **ognl 风险**：`ognl` 可以执行任意代码（调用方法、修改状态），需严格管控
> 4. **redefine 风险**：热更新可能引入新 Bug，只做紧急止血
> 5. **资源影响**：heapdump 触发 FGC、profiler 占 CPU、tt 占内存
> 6. **增强残留**：排查完务必 `reset` + `stop`，避免字节码增强常驻影响性能
> 7. **审计记录**：所有 Arthas 操作应有审计日志

### Q9：Arthas 能做热更新，为什么不能替代正式发布？

> **标准答案**：
> 
> 1. **redefine 限制多**：只能改方法体，不能改结构
> 2. **重启即失效**：修改只在内存中，重启/重新部署会恢复原版
> 3. **没有版本管理**：无法追踪谁改了什么、什么时候改的
> 4. **无法灰度/回滚**：直接在所有实例上生效，没有灰度过程
> 5. **与其他 Agent 冲突风险**：如 SkyWalking、APM 等字节码增强可能冲突
> 6. **绕过代码审查和测试**：线上直接改代码无法保证质量
> 
> **定位**：Arthas 热更新 = **紧急止血手段**，正式修复必须走 CI/CD 发布流程。

### Q10：Arthas 和 JDK 自带工具（jstack/jmap/jstat）相比有什么优势？

> **标准答案**：
> 
> | 维度 | JDK 工具 | Arthas |
> |------|---------|--------|
> | 线程分析 | `jstack` 只能打快照 | `thread` 实时 + CPU 排序 + 死锁检测 |
> | 堆分析 | `jmap` dump + 离线分析 | `heapdump` + `vmtool` 在线查看实例 |
> | GC 监控 | `jstat` 只有统计数据 | `dashboard` 实时面板 + `memory` 详细区域 |
> | 方法分析 | ❌ 无 | `trace`/`watch`/`monitor`/`stack`/`tt` |
> | 火焰图 | ❌ 无 | `profiler` 一键生成 |
> | 反编译 | ❌ 无 | `jad` 在线反编译 |
> | 热更新 | ❌ 无 | `redefine` |
> | 日志级别 | ❌ 无 | `logger` 动态修改 |
> | Spring 集成 | ❌ 无 | `ognl` 操作 Spring Bean |
> 
> **结论**：JDK 工具适合快速采集一次性快照，Arthas 适合深入的实时交互式诊断。实际排查中通常先用 JDK 工具快速定位方向，再用 Arthas 深入分析。

---

## 九、面试速查口诀

```
┌───────────────── Arthas 面试速记 ─────────────────┐
│                                                    │
│ 原理四字诀：Attach → Agent → Instrument → ASM      │
│                                                    │
│ 核心命令六兄弟：                                    │
│   trace  → 追踪耗时（哪步慢）                       │
│   watch  → 观测数据（传啥返啥）                     │
│   monitor → 统计指标（QPS/RT/失败率）               │
│   stack  → 反向追溯（谁调的我）                     │
│   tt     → 时间隧道（录制回放）                     │
│   profiler → 火焰图（CPU/内存/锁）                  │
│                                                    │
│ 排查三板斧：                                        │
│   CPU 高  → dashboard + thread -n 5 + profiler     │
│   接口慢  → trace + watch + monitor                │
│   内存漏  → memory + heapdump + profiler alloc     │
│   死锁    → thread -b                              │
│                                                    │
│ 退出三兄弟：                                        │
│   quit  → 客户端走了，增强还在                      │
│   reset → 增强没了，Arthas还在                      │
│   stop  → 全部清理，完全退出                        │
│                                                    │
│ 生产安全三原则：                                    │
│   1. 加 -n（限次数）                                │
│   2. 精确匹配（不通配）                             │
│   3. 用完 reset + stop                             │
│                                                    │
└────────────────────────────────────────────────────┘
```

---

> 📌 **推荐阅读**：
> - [Java服务与中间件排查](Java服务与中间件排查.md) — Java/MySQL/Redis 线上排查流程，含 Arthas 实战
> - [线上问题监控与排查](线上问题监控与排查.md) — 全维度系统监控排查（CPU/内存/磁盘/网络/FD/JVM）
> - [场景题与故障排查](场景题与故障排查.md) — 面试场景题汇总
