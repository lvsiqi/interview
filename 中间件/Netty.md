# Netty 知识点

> 最后更新：2026年3月7日

---

## 一、Netty 是什么 & 为什么用 Netty ⭐⭐⭐

**定位：** Java 高性能异步事件驱动的网络通信框架，对 Java NIO 的封装与增强。

**原生 NIO 的痛点：**
```
① API 复杂：Selector、Channel、Buffer 使用繁琐，书写量大
② 调试难：NIO 本身 Bug 多（如 Selector 的 CPU 100% 空轮询 Bug，JDK 至今未完全修复）
③ 粘包/拆包需要自己处理
④ 心跳、断线重连等需要重复造轮子
```

**Netty 的优势：**

| 特性 | 说明 |
|------|------|
| **高性能** | 零拷贝（CompositeByteBuf、FileRegion）、内存池（PooledByteBufAllocator）、高效序列化 |
| **易用性** | Pipeline 责任链统一处理 I/O 事件，ChannelHandler 隔离业务逻辑 |
| **健壮性** | 修复了 JDK NIO 的空轮询 BUG；内置心跳检测、断线重连 |
| **扩展性** | 支持 TCP/UDP/HTTP/WebSocket/自定义协议 |
| **成熟度** | Dubbo、RocketMQ、gRPC-Java、Spark 等均使用 Netty |

---

## 二、Netty 线程模型 ⭐⭐⭐⭐

### 2.1 Reactor 模型演进

```
单线程 Reactor：Acceptor + Handler 同一线程，无法充分利用多核，适合玩具项目
多线程 Reactor：Acceptor 单线程 + Handler 线程池，仍是Acceptor单点
主从 Reactor（Netty 默认）：
  BossGroup（主 Reactor）：专门处理 accept，将 Channel 注册到 WorkerGroup
  WorkerGroup（从 Reactor）：处理 I/O 读写事件（每个 NioEventLoop 绑定一个线程）
```

### 2.2 Netty 线程模型

```
┌──────────────────────────────────────────┐
│           BossGroup（通常1线程）            │
│  NioEventLoop → Selector → accept → 注册 │
└────────────────┬─────────────────────────┘
                 │ 注册 Channel
┌────────────────▼─────────────────────────┐
│       WorkerGroup（默认 CPU×2 线程）        │
│  NioEventLoop0 → Selector → read/write   │
│  NioEventLoop1 → Selector → read/write   │
│  ...                                     │
└──────────────────────────────────────────┘
          每个 NioEventLoop 绑定固定的 Channel
          Channel 全生命周期在同一 NioEventLoop 线程，无并发问题
```

**NioEventLoop 工作循环：**
```
① select()：监听 I/O 事件（有超时，避免空轮询）
② processSelectedKeys()：处理就绪的 I/O 任务
③ runAllTasks()：执行定时任务和普通任务队列
```

---

## 三、核心组件 ⭐⭐⭐⭐

### 3.1 Channel & ChannelPipeline

```
Channel：网络连接抽象（NioSocketChannel、NioServerSocketChannel）

ChannelPipeline：Channel 绑定的责任链，由多个 ChannelHandler 组成
  入站事件（read）：HeadContext → Handler1 → Handler2 → TailContext（链头→链尾）
  出站事件（write）：TailContext → Handler2 → Handler1 → HeadContext（链尾→链头）
```

### 3.2 ChannelHandler

| Handler 类型 | 方向 | 典型用途 |
|-------------|------|---------|
| `ChannelInboundHandler` | 入站 | 解码、业务逻辑处理 |
| `ChannelOutboundHandler` | 出站 | 编码、限流 |
| `ChannelDuplexHandler` | 双向 | 心跳检测（IdleStateHandler）|

```java
// 典型 Pipeline 配置
ServerBootstrap b = new ServerBootstrap();
b.group(bossGroup, workerGroup)
 .channel(NioServerSocketChannel.class)
 .childHandler(new ChannelInitializer<SocketChannel>() {
     @Override
     protected void initChannel(SocketChannel ch) {
         ch.pipeline()
           .addLast(new LengthFieldBasedFrameDecoder(65536, 0, 4, 0, 4)) // 解决粘包
           .addLast(new LengthFieldPrepender(4))                          // 出站加长度头
           .addLast(new IdleStateHandler(30, 0, 0, TimeUnit.SECONDS))     // 心跳检测
           .addLast(new BusinessHandler());                                // 业务逻辑
     }
 });
```

### 3.3 ByteBuf ⭐⭐

**ByteBuf vs Java NIO ByteBuffer：**

| 对比项 | ByteBuffer | ByteBuf |
|--------|-----------|---------|
| 读写指针 | 一个 position，读写前需 flip() | 独立 readerIndex / writerIndex，无需 flip |
| 扩容 | 固定大小，不支持动态扩容 | 自动扩容 |
| 内存管理 | JVM GC 管理 | 池化（PooledByteBuf）+ 引用计数，减少GC压力 |
| 零拷贝 | 不支持 | CompositeByteBuf 逻辑合并多块 |

**内存类型：**
```
HeapByteBuf：JVM 堆内存，有 GC 开销，适合小对象
DirectByteBuf：堆外内存，不受 GC 管理，网络 I/O 零拷贝，使用后必须手动 release()
PooledByteBuf：内存池化（类似 jemalloc），复用内存块，减少分配/释放开销（默认使用）
```

> ⚠️ **内存泄漏**：DirectByteBuf 引用计数不为0时无法释放，需在每个 Handler 末尾调用 `ReferenceCountUtil.release(msg)` 或继承 `SimpleChannelInboundHandler`（自动 release）

---

## 四、粘包 & 拆包 ⭐⭐⭐⭐

**产生原因：** TCP 是字节流协议，无消息边界，发送方多条消息可能合并（粘包），或一条消息被分多次发送（拆包）。

**Netty 内置解决方案：**

| 解码器 | 原理 | 适用场景 |
|--------|------|---------|
| `FixedLengthFrameDecoder` | 固定长度切割 | 定长协议 |
| `LineBasedFrameDecoder` | 按行分隔符（`\n`）切割 | 文本协议 |
| `DelimiterBasedFrameDecoder` | 自定义分隔符 | 自定义文本协议 |
| `LengthFieldBasedFrameDecoder` | 消息头携带长度字段 | **二进制协议，最常用** |

**LengthFieldBasedFrameDecoder 参数：**
```java
// 协议格式：[4字节长度][消息体]
new LengthFieldBasedFrameDecoder(
    65536,   // maxFrameLength：最大帧长度
    0,       // lengthFieldOffset：长度字段偏移
    4,       // lengthFieldLength：长度字段占4字节
    0,       // lengthAdjustment：补偿值
    4        // initialBytesToStrip：解析后跳过前4字节（去掉长度头）
)
```

---

## 五、心跳机制 ⭐⭐⭐

**目的：** 检测连接是否存活（客户端宕机、网络中断），及时释放僵尸连接。

```java
// 服务端：30秒未收到读事件则触发 READER_IDLE
pipeline.addLast(new IdleStateHandler(30, 0, 0, TimeUnit.SECONDS));
pipeline.addLast(new HeartbeatServerHandler());

public class HeartbeatServerHandler extends ChannelInboundHandlerAdapter {
    @Override
    public void userEventTriggered(ChannelHandlerContext ctx, Object evt) {
        if (evt instanceof IdleStateEvent) {
            IdleStateEvent e = (IdleStateEvent) evt;
            if (e.state() == IdleState.READER_IDLE) {
                ctx.close();  // 关闭僵尸连接
            }
        }
    }
}

// 客户端：25秒无写事件则发送心跳包（稍短于服务端超时）
pipeline.addLast(new IdleStateHandler(0, 25, 0, TimeUnit.SECONDS));
pipeline.addLast(new HeartbeatClientHandler());
```

---

## 六、Netty 零拷贝 ⭐⭐

Netty 的零拷贝体现在两层：

| 层次 | 机制 | 说明 |
|------|------|------|
| **OS 层** | `FileRegion.transferTo()` → `sendfile` | 文件传输不经用户态，减少2次拷贝+2次上下文切换 |
| **应用层** | `CompositeByteBuf` | 逻辑合并多个 ByteBuf，不做物理内存拷贝 |
| **应用层** | `slice()`/`duplicate()` | 共享底层内存，创建视图而非拷贝 |

```java
// CompositeByteBuf：合并 header + body 无内存拷贝
CompositeByteBuf composite = Unpooled.compositeBuffer();
composite.addComponents(true, headerBuf, bodyBuf);  // true=自动调整writerIndex
```

---

## 七、常见面试题 & 追问

**Q: Netty 如何解决 JDK NIO 的 epoll 空轮询 BUG？**

> JDK NIO 的 Selector 在某些 Linux 内核版本下，即使无 I/O 事件就绪也会持续返回（CPU 100%）。Netty 解决方案：统计一定时间内 select() 返回 0 的次数，超过阈值（默认512次）则认为触发了空轮询 BUG，自动重建 Selector 并将所有 Channel 迁移到新 Selector 上。

**Q: NioEventLoop 是单线程的，业务逻辑耗时怎么办？**

> 绝不在 NioEventLoop 线程做耗时操作（DB 查询、RPC 调用），否则会阻塞整个线程上所有 Channel 的 I/O。应将耗时任务提交到独立的业务线程池：
```java
public void channelRead(ChannelHandlerContext ctx, Object msg) {
    businessExecutor.submit(() -> {
        Object result = heavyProcess(msg);         // 耗时业务在业务线程池
        ctx.writeAndFlush(result);                 // 写回结果（线程安全）
    });
}
```

**Q: Netty 中 writeAndFlush 是线程安全的吗？**

> 是线程安全的。Netty 保证 Channel 的所有出站操作最终都在绑定的 NioEventLoop 线程执行。如果 `writeAndFlush` 在其他线程调用，会被封装成任务提交到 NioEventLoop 的任务队列，由 NioEventLoop 线程串行执行，无并发问题。
