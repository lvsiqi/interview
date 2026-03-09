# IO 模型详解（BIO / NIO / AIO）

> 最后更新：2026年3月9日

---

## 📋 章节大纲

| 章节 | 内容 | 优先级 | 状态 |
|------|------|--------|------|
| 一 | IO 基础概念（用户态/内核态、同步/异步、阻塞/非阻塞）| ⭐⭐⭐ | ✅ |
| 二 | 五种 IO 模型（阻塞/非阻塞/多路复用/信号驱动/异步） | ⭐⭐⭐⭐ | ✅ |
| 三 | BIO 详解（原理/线程模型/代码/瓶颈） | ⭐⭐⭐ | ✅ |
| 四 | NIO 详解（Channel/Buffer/Selector 三大核心） | ⭐⭐⭐⭐⭐ | ✅ |
| 五 | AIO 详解（异步回调/CompletionHandler） | ⭐⭐⭐ | ✅ |
| 六 | 多路复用底层：select / poll / epoll 深度对比 | ⭐⭐⭐⭐⭐ | ✅ |
| 七 | 三种 IO 模型综合对比 & 选型 | ⭐⭐⭐⭐ | ✅ |
| 八 | 高频追问汇总 | ⭐⭐⭐⭐ | ✅ |

---

## 一、IO 基础概念 ⭐⭐⭐

### 1.1 用户态与内核态

```
应用程序运行在用户态，网络/磁盘 IO 操作必须通过系统调用（syscall）切换到内核态：

用户进程                 内核
  │                       │
  │── read(fd) ──────────→│  ① 系统调用，切换到内核态
  │                       │  ② 内核等待数据就绪（网卡 DMA → 内核缓冲区）
  │                       │  ③ 数据从内核缓冲区拷贝到用户缓冲区
  │←── 返回数据 ──────────│  ④ 切换回用户态，read() 返回
  │                       │

一次网络 IO 涉及两个阶段：
  阶段一：等待数据就绪（内核等网卡收到数据）
  阶段二：数据拷贝（内核缓冲区 → 用户缓冲区）

不同 IO 模型的区别，就在于这两个阶段是否阻塞、是否异步。
```

### 1.2 同步 vs 异步、阻塞 vs 非阻塞

```
阻塞（Blocking）：
  调用方发起 IO 后一直等待，直到操作完成才返回
  线程被挂起，无法做其他事

非阻塞（Non-Blocking）：
  调用方发起 IO 后立即返回（可能返回"数据未就绪"）
  需要不断轮询或依赖通知机制

同步（Synchronous）：
  调用方自己负责等待和处理 IO 结果
  数据拷贝阶段（阶段二）仍由调用线程完成

异步（Asynchronous）：
  调用方发起 IO 后立即返回，两个阶段都由内核完成
  内核完成后主动通知调用方（回调）
  调用线程全程无需等待

关键区别：
  BIO  → 同步 + 阻塞（两个阶段都阻塞）
  NIO  → 同步 + 非阻塞（阶段一非阻塞轮询/多路复用，阶段二仍同步拷贝）
  AIO  → 异步 + 非阻塞（两个阶段都由内核完成，回调通知应用）
```

---

## 二、五种 IO 模型（Unix 经典分类）⭐⭐⭐⭐

> 来自 Richard Stevens 《UNIX Network Programming》，面试常考。

```
① 阻塞 IO（Blocking IO）
   read() → 阶段一阻塞等待数据 + 阶段二阻塞拷贝 → 返回

② 非阻塞 IO（Non-Blocking IO）
   read() → 数据未就绪立即返回 EAGAIN → 应用不断轮询 → 数据就绪后阶段二阻塞拷贝

③ IO 多路复用（IO Multiplexing）
   select/poll/epoll → 监听多个 fd → 有就绪事件时通知 → 再调 read() 阶段二拷贝
   本质：用一个线程同时等待多个连接的数据就绪

④ 信号驱动 IO（Signal-Driven IO）
   SIGIO 信号通知数据就绪 → 再调 read() 拷贝
   实际很少使用（信号机制复杂）

⑤ 异步 IO（Asynchronous IO）
   aio_read() → 立即返回 → 内核完成两个阶段 → 回调通知应用
   真正的全异步，Linux 上 io_uring（5.1+）才真正成熟
```

```
对比图（阶段一 + 阶段二的阻塞情况）：

模型           │  阶段一（等数据就绪）  │  阶段二（数据拷贝）
─────────────│────────────────────│──────────────────
阻塞 IO       │  阻塞               │  阻塞
非阻塞 IO     │  轮询（非阻塞）      │  阻塞
IO 多路复用   │  select/epoll阻塞   │  阻塞
信号驱动      │  信号通知（非阻塞）   │  阻塞
异步 IO       │  非阻塞             │  非阻塞（内核完成）
```

---

## 三、BIO 详解（阻塞IO）⭐⭐⭐

### 3.1 原理

```
BIO = Blocking IO = java.io + java.net.ServerSocket

模型：
  主线程 accept() 阻塞等待连接
  每来一个客户端连接 → 创建一个新线程处理
  每个线程内 read()/write() 都是阻塞的

  Server
  ┌──────────────┐
  │ accept()     │ ← 阻塞等待新连接
  │   ↓          │
  │ new Thread() │ → Thread-1: read() 阻塞 → 处理 → write() 阻塞
  │ new Thread() │ → Thread-2: read() 阻塞 → 处理 → write() 阻塞
  │ new Thread() │ → Thread-3: read() 阻塞 → 处理 → write() 阻塞
  └──────────────┘

问题：
  C10K 问题：1 万个连接 → 1 万个线程 → 内存爆炸 + 上下文切换开销巨大
  大量线程阻塞在 read() 上什么事也不干，浪费 CPU
```

### 3.2 代码示例

```java
// BIO 服务端（伪代码）
ServerSocket serverSocket = new ServerSocket(8080);

while (true) {
    // 阻塞等待客户端连接
    Socket socket = serverSocket.accept();  // 阻塞点①

    // 每个连接一个线程
    new Thread(() -> {
        try (InputStream in = socket.getInputStream();
             OutputStream out = socket.getOutputStream()) {

            byte[] buf = new byte[1024];
            int len = in.read(buf);  // 阻塞点②：等待客户端发数据

            String request = new String(buf, 0, len);
            String response = handleRequest(request);

            out.write(response.getBytes());  // 阻塞点③：等待写缓冲区可用
            out.flush();
        } catch (IOException e) {
            e.printStackTrace();
        }
    }).start();
}
```

### 3.3 BIO + 线程池改进

```java
// 用线程池限制最大线程数，避免无限创建线程
ExecutorService pool = Executors.newFixedThreadPool(200);

ServerSocket serverSocket = new ServerSocket(8080);
while (true) {
    Socket socket = serverSocket.accept();
    pool.execute(() -> handleConnection(socket));
}

// 优点：线程数可控，不会 OOM
// 缺点：
//   最多同时处理 200 个连接，超出排队或拒绝
//   每个线程仍阻塞在 read()，线程利用率低
//   不适合高并发长连接场景（如 IM、推送）
```

### 3.4 BIO 适用场景

```
✅ 连接数少、短连接（如传统 Web 请求）
✅ 逻辑简单，开发成本低
✅ 低并发内部管理系统

❌ 不适合高并发、长连接（IM、推送、物联网）
❌ 不适合需同时维持大量空闲连接的场景
```

---

## 四、NIO 详解（同步非阻塞IO）⭐⭐⭐⭐⭐

### 4.1 核心概念

```
NIO = New IO = java.nio（JDK 1.4 引入）

三大核心组件：
  ① Channel（通道）：双向读写，替代 BIO 的 InputStream/OutputStream
  ② Buffer（缓冲区）：数据容器，Channel 读写数据都经过 Buffer
  ③ Selector（多路复用器）：一个线程监控多个 Channel 的 IO 事件

核心思想：
  不再一个连接一个线程
  → 一个 Selector 线程管理成百上千个 Channel
  → 哪个 Channel 数据就绪就处理哪个
  → 线程不阻塞在单个连接上
```

### 4.2 Channel（通道）

```
Channel 是双向的，可读可写（BIO 的 Stream 是单向的）

常用 Channel：
  SocketChannel       → TCP 客户端通道
  ServerSocketChannel  → TCP 服务端监听通道
  DatagramChannel      → UDP 通道
  FileChannel          → 文件读写通道（不支持 Selector，始终阻塞）

关键方法：
  channel.read(buffer)   → 从通道读数据到 Buffer
  channel.write(buffer)  → 从 Buffer 写数据到通道
  channel.configureBlocking(false)  → 设为非阻塞模式（注册 Selector 的前提）
```

### 4.3 Buffer（缓冲区）

```
Buffer 本质是一块内存区域（底层是数组），有四个核心指针：

  0 ≤ mark ≤ position ≤ limit ≤ capacity

  capacity  → 缓冲区总容量（创建时固定）
  position  → 当前读写位置
  limit     → 可读写的边界
  mark      → 标记位置（reset() 可回到此位置）

读写模式切换：
  写模式：position 从 0 递增，limit = capacity
  flip() 切换到读模式：limit = position, position = 0
  读模式：position 从 0 递增，limit 是之前写入的数据量
  clear() 或 compact() 切换回写模式

常用 Buffer 类型：
  ByteBuffer（最常用）/ CharBuffer / IntBuffer / LongBuffer ...

DirectByteBuffer vs HeapByteBuffer：
  HeapByteBuffer：分配在 JVM 堆上，GC 管理，读写需额外拷贝到直接内存
  DirectByteBuffer：分配在堆外直接内存（Native），减少一次拷贝，适合大文件/网络 IO
                    缺点：分配/释放慢，不受 GC 直接管理，需注意内存泄漏
```

### 4.4 Selector（多路复用器）⭐⭐⭐⭐⭐

```
Selector 是 NIO 的核心：一个线程通过 Selector 同时监听多个 Channel 事件

事件类型：
  SelectionKey.OP_ACCEPT  → ServerSocketChannel 有新连接
  SelectionKey.OP_CONNECT → SocketChannel 连接建立完成
  SelectionKey.OP_READ    → SocketChannel 有数据可读
  SelectionKey.OP_WRITE   → SocketChannel 可写（写缓冲区未满）

工作流程：
  ① 创建 Selector
  ② 将 Channel 注册到 Selector，关注指定事件
  ③ 调用 selector.select()（阻塞）→ 等待至少一个 Channel 就绪
  ④ 获取就绪的 SelectionKey 集合
  ⑤ 遍历处理每个就绪事件
  ⑥ 循环回到 ③

底层实现：
  Linux → epoll（JDK 1.5.8+）
  macOS → kqueue
  Windows → select（性能较差）/ IOCP
```

### 4.5 NIO 服务端代码示例

```java
// NIO 服务端核心流程
Selector selector = Selector.open();

ServerSocketChannel serverChannel = ServerSocketChannel.open();
serverChannel.bind(new InetSocketAddress(8080));
serverChannel.configureBlocking(false);  // 非阻塞
serverChannel.register(selector, SelectionKey.OP_ACCEPT);  // 注册 ACCEPT 事件

ByteBuffer buffer = ByteBuffer.allocate(1024);

while (true) {
    selector.select();  // 阻塞直到有事件就绪

    Iterator<SelectionKey> keys = selector.selectedKeys().iterator();
    while (keys.hasNext()) {
        SelectionKey key = keys.next();
        keys.remove();  // 必须手动移除，否则下次循环重复处理

        if (key.isAcceptable()) {
            // 新连接
            SocketChannel clientChannel = serverChannel.accept();
            clientChannel.configureBlocking(false);
            clientChannel.register(selector, SelectionKey.OP_READ);

        } else if (key.isReadable()) {
            // 数据可读
            SocketChannel clientChannel = (SocketChannel) key.channel();
            buffer.clear();
            int bytesRead = clientChannel.read(buffer);

            if (bytesRead == -1) {
                key.cancel();
                clientChannel.close();
            } else {
                buffer.flip();
                // 处理数据...
                String request = StandardCharsets.UTF_8.decode(buffer).toString();
                // 响应写回
                clientChannel.write(ByteBuffer.wrap(("Echo: " + request).getBytes()));
            }
        }
    }
}
```

### 4.6 NIO 的问题（为什么需要 Netty）

```
原生 NIO 的痛点：
  ① API 复杂：Buffer flip/clear/compact 容易搞混，Selector 注册/取消繁琐
  ② 臭名昭著的 epoll bug（JDK bug 6670302）：
     空轮询导致 CPU 100%，select() 在无事件时意外返回 0
     Netty 通过重建 Selector 规避
  ③ 半包/粘包问题需自己处理（TCP 是字节流，无消息边界）
  ④ 断线重连、心跳、异常处理都需自行编码
  ⑤ 缺少编解码框架、协议抽象

→ 生产中几乎没人直接用 JDK NIO，而是用 Netty 封装
  Netty 在 NIO 之上提供了：Reactor线程模型 / ChannelPipeline / ByteBuf / 编解码器
```

---

## 五、AIO 详解（异步非阻塞IO）⭐⭐⭐

### 5.1 原理

```
AIO = Asynchronous IO = java.nio.channels.AsynchronousXxxChannel（JDK 7 引入）

与 NIO 的本质区别：
  NIO：应用调用 select() 等待就绪事件 → 自己调 read() 拷贝数据（阶段二同步）
  AIO：应用发起 read() 后直接返回 → 内核完成数据等待+拷贝，通过回调通知（全异步）

                NIO                              AIO
  应用 ─→ select(等就绪) ─→ read(拷贝)    应用 ─→ aio_read(注册回调) ─→ 干别的事
                                           内核 ─→ 等数据+拷贝 ─→ 回调通知应用
```

### 5.2 两种回调方式

```java
// 方式一：CompletionHandler 回调（推荐）
AsynchronousSocketChannel channel = AsynchronousSocketChannel.open();

ByteBuffer buffer = ByteBuffer.allocate(1024);
channel.read(buffer, buffer, new CompletionHandler<Integer, ByteBuffer>() {
    @Override
    public void completed(Integer bytesRead, ByteBuffer attachment) {
        // IO 完成，内核已将数据拷贝到 buffer
        attachment.flip();
        String data = StandardCharsets.UTF_8.decode(attachment).toString();
        System.out.println("收到数据: " + data);
    }

    @Override
    public void failed(Throwable exc, ByteBuffer attachment) {
        exc.printStackTrace();
    }
});

// 方式二：Future 方式（本质退化为同步等待）
Future<Integer> future = channel.read(buffer);
int bytesRead = future.get();  // 阻塞等待完成，失去了异步的意义
```

### 5.3 AIO 服务端代码示例

```java
AsynchronousServerSocketChannel serverChannel =
    AsynchronousServerSocketChannel.open().bind(new InetSocketAddress(8080));

// 异步 accept
serverChannel.accept(null, new CompletionHandler<AsynchronousSocketChannel, Void>() {
    @Override
    public void completed(AsynchronousSocketChannel clientChannel, Void attachment) {
        // 继续接受下一个连接
        serverChannel.accept(null, this);

        // 异步读取该连接的数据
        ByteBuffer buffer = ByteBuffer.allocate(1024);
        clientChannel.read(buffer, buffer, new CompletionHandler<Integer, ByteBuffer>() {
            @Override
            public void completed(Integer bytesRead, ByteBuffer buf) {
                buf.flip();
                String request = StandardCharsets.UTF_8.decode(buf).toString();
                // 异步写响应
                clientChannel.write(ByteBuffer.wrap(("Echo: " + request).getBytes()));
            }

            @Override
            public void failed(Throwable exc, ByteBuffer buf) {
                try { clientChannel.close(); } catch (IOException ignored) {}
            }
        });
    }

    @Override
    public void failed(Throwable exc, Void attachment) {
        exc.printStackTrace();
    }
});

// 主线程保持存活
Thread.currentThread().join();
```

### 5.4 AIO 在 Linux 上的现状

```
理想很美好，现实很骨感：

Linux 的 AIO 实现（POSIX aio / io_submit）：
  ❌ 早期 Linux 内核 AIO 支持不成熟，仅对直接 IO 有效
  ❌ 普通文件的 buffered IO 实际仍通过线程池模拟异步（伪异步）
  ❌ 网络 IO 的 AIO 在 Linux 上基本是用 epoll + 线程池模拟

io_uring（Linux 5.1+, 2019年）：
  ✅ 真正的内核级异步 IO，性能优于 epoll
  ✅ 共享内存环形缓冲区，减少系统调用开销
  ⚠️ JDK 尚未官方支持（Netty 有实验性 io_uring transport）

Windows IOCP：
  ✅ Windows 上真正的异步 IO，性能优异
  ✅ JDK AIO 在 Windows 上基于 IOCP 实现，效果好

结论：
  Linux 服务器（主流生产环境）→ NIO + epoll（Netty）是最佳选择
  Windows → AIO/IOCP 有优势，但 Java 服务端很少部署在 Windows
  → 这就是为什么 Netty 没有采用 AIO，而是坚持 NIO + epoll
```

---

## 六、多路复用底层：select / poll / epoll 深度对比 ⭐⭐⭐⭐⭐

### 6.1 select

```
int select(int nfds, fd_set *readfds, fd_set *writefds, fd_set *exceptfds, struct timeval *timeout);

原理：
  ① 用户将关注的 fd 集合（位图）拷贝到内核
  ② 内核线性遍历所有 fd，检查是否有就绪事件
  ③ 有就绪 → 标记 fd_set → 拷贝回用户空间
  ④ 用户遍历 fd_set 找到就绪的 fd

缺点：
  ❌ fd_set 大小固定（FD_SETSIZE = 1024），最多监听 1024 个 fd
  ❌ 每次调用需要将 fd_set 从用户态拷贝到内核态（O(n)）
  ❌ 内核线性扫描所有 fd（O(n)），大量空闲连接浪费扫描时间
  ❌ 返回后需要再次遍历 fd_set 找出就绪的 fd（又一次 O(n)）
```

### 6.2 poll

```
int poll(struct pollfd *fds, nfds_t nfds, int timeout);

struct pollfd {
    int   fd;       // 文件描述符
    short events;   // 关注的事件
    short revents;  // 实际发生的事件
};

改进：
  ✅ 用链表存储 fd，没有 1024 上限
  ✅ 分离了 events 和 revents，不需要重置

未解决的问题：
  ❌ 仍然每次要将 fd 集合从用户态拷贝到内核态
  ❌ 内核仍然线性遍历所有 fd（O(n)）
  ❌ 返回后仍需遍历找出就绪 fd
```

### 6.3 epoll ⭐⭐⭐⭐⭐

```
// 三个系统调用
int epoll_create(int size);                    // 创建 epoll 实例（红黑树 + 就绪链表）
int epoll_ctl(int epfd, int op, int fd, ...);  // 增删改 fd 的监听事件
int epoll_wait(int epfd, struct epoll_event *events, int maxevents, int timeout);

原理：
  ① epoll_create()：
     内核创建一个 eventpoll 对象，包含：
     - 红黑树（存储所有注册的 fd + 事件）
     - 就绪链表（rdllist，存储已就绪的 fd）

  ② epoll_ctl()：
     增/删/改 fd 到红黑树（O(log n)）
     注册回调函数到每个 fd → 当设备驱动（如网卡）数据到达时，
     回调自动把该 fd 加入就绪链表

  ③ epoll_wait()：
     检查就绪链表是否有数据：
       有 → 直接返回就绪的 fd 列表（O(1)检查，O(k)返回，k=就绪数）
       无 → 阻塞等待（或超时返回）

关键优势：
  ✅ fd 注册一次，不需要每次拷贝（通过 mmap 共享内存）
  ✅ 事件驱动：只在数据就绪时触发回调，不需要遍历所有 fd
  ✅ 只返回就绪的 fd，无需用户侧全量遍历
  ✅ 没有 fd 数量上限（受系统文件描述符限制）
```

### 6.4 epoll 的两种触发模式

```
水平触发（LT, Level Triggered）— 默认模式：
  只要 fd 的读缓冲区有数据，每次 epoll_wait() 都会返回该 fd
  应用可以不一次性读完，下次会再次通知
  编程简单，不容易漏数据
  类比：水位高于阈值就一直报警

边缘触发（ET, Edge Triggered）：
  只在 fd 的状态变化时（新数据到达）通知一次
  必须一次性把缓冲区数据全部读完（循环 read 直到 EAGAIN）
  否则不会再次触发，数据残留在缓冲区
  性能更高（减少 epoll_wait 返回次数），但编程复杂
  类比：水位上升瞬间报警一次，之后不管

Netty 使用 ET 模式：
  配合非阻塞 read 循环读取，性能最优
  JDK NIO 默认使用 LT 模式（更安全）
```

### 6.5 综合对比

| 维度 | select | poll | epoll |
|------|--------|------|-------|
| **fd上限** | 1024（FD_SETSIZE）| 无上限（链表）| 无上限（红黑树）|
| **fd传递** | 每次拷贝全量 fd_set | 每次拷贝全量 pollfd | 只在注册时拷贝一次 |
| **就绪检测** | 内核遍历所有 fd O(n) | 内核遍历所有 fd O(n) | 回调加入就绪链表 O(1) |
| **返回方式** | 标记 fd_set，用户遍历 | 标记 revents，用户遍历 | 只返回就绪 fd 列表 |
| **时间复杂度** | O(n) | O(n) | O(k)，k=就绪数 |
| **活跃连接少** | 浪费扫描 | 浪费扫描 | 只处理活跃的 |
| **触发模式** | LT | LT | LT + ET |
| **适用场景** | 跨平台兼容 | fd > 1024 时 | **Linux 高并发首选** |

---

## 七、三种 IO 模型综合对比 & 选型 ⭐⭐⭐⭐

| 维度 | BIO | NIO | AIO |
|------|-----|-----|-----|
| **Java 包** | java.io / java.net | java.nio | java.nio.channels.Asynchronous* |
| **JDK 版本** | JDK 1.0 | JDK 1.4 | JDK 7 |
| **模型** | 同步阻塞 | 同步非阻塞（多路复用）| 异步非阻塞 |
| **线程模型** | 一个连接一个线程 | 一个线程管理多个 Channel | 回调/Future，无需单独线程等待 |
| **内核机制** | - | select/poll/epoll | Linux线程池模拟/Windows IOCP |
| **编程复杂度** | 简单 | 较复杂 | 复杂（回调嵌套）|
| **吞吐量** | 低 | 高 | 高（理论最优）|
| **Linux实际效果** | 差 | 优（epoll 成熟）| 差（模拟异步）|
| **典型框架** | Tomcat BIO模式 | **Netty**、Tomcat NIO | - |
| **适用场景** | 低并发、短连接 | **高并发、长连接**（主流）| Windows 服务端（少见）|

### 选型建议

```
Java 服务端开发（Linux 部署）：
  ✅ 首选 NIO + Netty
     理由：epoll 成熟稳定，Netty 屏蔽底层复杂性，生态丰富

  ⚠️ 不推荐直接用 JDK NIO
     理由：API 复杂，epoll 空轮询 bug，需自行处理半包粘包

  ❌ 不推荐 AIO
     理由：Linux 上是伪异步（线程池模拟），性能不如 NIO + epoll
     Netty 作者 Trustin Lee 明确表示：
     "Not faster than NIO (epoll) on Unix systems"

  ❌ 不推荐 BIO（除非连接数极少且逻辑极简单）
```

---

## 八、高频追问汇总 ⭐⭐⭐⭐

**Q: BIO、NIO、AIO 的核心区别是什么？**
> BIO 是同步阻塞，一个连接需要一个线程，线程在 read() 时阻塞；NIO 是同步非阻塞，用 Selector 多路复用一个线程监听多个 Channel，数据就绪后同步拷贝；AIO 是异步非阻塞，发起 read 后直接返回，内核完成全部工作后回调通知。Java 服务端在 Linux 上首选 NIO + epoll（Netty），因为 Linux AIO 不成熟，实际是线程池模拟。

**Q: select、poll、epoll 的区别？**
> select 有 1024 fd 上限，每次需拷贝全量 fd 到内核并线性扫描；poll 去掉了上限但仍有拷贝和扫描问题；epoll 用红黑树存 fd（注册一次不重复拷贝），事件驱动回调加入就绪链表（O(1)），只返回就绪 fd。在大量连接且活跃连接少的场景下 epoll 优势最大。

**Q: epoll 的 LT 和 ET 有什么区别？**
> LT（水平触发）只要缓冲区有数据就持续通知，安全但可能频繁唤醒；ET（边缘触发）仅在状态变化时通知一次，须一次读完数据否则丢失通知，性能更高。Netty 使用 ET + 非阻塞循环读，JDK NIO 默认 LT。

**Q: 为什么 Netty 不用 AIO 而用 NIO？**
> Linux 上 Java AIO 的实现是用线程池模拟的（不是真正的内核异步），性能并不优于 NIO + epoll。Netty 作者实测后选择了 NIO。Windows 上 AIO 基于 IOCP 是真异步，但 Java 服务端几乎都部署在 Linux 上。Linux 5.1+ 的 io_uring 是真正的内核异步 IO，Netty 已有实验性支持但尚未成为默认。

**Q: 什么是 epoll 空轮询 bug？**
> JDK NIO 在 Linux 上有个已知 bug（JDK-6670302）：本应阻塞的 `selector.select()` 在没有任何就绪事件时意外返回 0，导致 while 循环空转 CPU 100%。Netty 通过检测连续空轮询次数（默认 512 次），超过阈值后重建 Selector 来规避。

**Q: NIO 中 Buffer 的 flip() 做了什么？**
> `flip()` 将 Buffer 从写模式切换到读模式：`limit = position; position = 0;`。此后读操作从 0 读到 limit（即之前写入的数据量）。忘记调 flip() 是 NIO 编程最常见的 bug。

**Q: DirectByteBuffer 和 HeapByteBuffer 的区别？**
> HeapByteBuffer 分配在 JVM 堆上，受 GC 管理，但 IO 操作时需先拷贝到堆外直接内存再传给操作系统（多一次拷贝）。DirectByteBuffer 直接分配在堆外内存，IO 时无需额外拷贝，性能更优；缺点是分配/释放代价高，不受 GC 直接管理需谨防内存泄漏。Netty 的 ByteBuf 默认使用堆外内存+池化（PooledDirectByteBuf）。
