# RPC 与 gRPC 详解

> 最后更新：2026年3月9日

---

## 📋 章节大纲

| 章节 | 内容 | 优先级 | 状态 |
|------|------|--------|------|
| 一 | RPC 基础原理（调用流程 / 序列化 / 服务发现） | ⭐⭐⭐⭐ | ✅ |
| 二 | RPC 核心组件详解（动态代理 / 编解码 / 网络传输 / 负载均衡） | ⭐⭐⭐⭐ | ✅ |
| 三 | gRPC 深入解析（架构 / Proto / HTTP/2 / 四种调用模式） | ⭐⭐⭐⭐⭐ | ✅ |
| 四 | gRPC 高级特性（拦截器 / 超时 / 重试 / 负载均衡 / 健康检查） | ⭐⭐⭐⭐ | ✅ |
| 五 | Protobuf 序列化原理 | ⭐⭐⭐⭐ | ✅ |
| 六 | 主流 RPC 框架横向对比（gRPC / Dubbo / Thrift / Feign） | ⭐⭐⭐⭐ | ✅ |
| 七 | 高频追问汇总 | ⭐⭐⭐⭐ | ✅ |

---

## 一、RPC 基础原理 ⭐⭐⭐⭐

### 1.1 什么是 RPC

```
RPC = Remote Procedure Call（远程过程调用）

目标：让调用远程服务像调用本地方法一样简单

本地调用：
  UserService userService = new UserServiceImpl();
  User user = userService.getById(123);   // 方法调用在同一个 JVM 内

远程调用（RPC）：
  UserService userService = rpcProxy.getProxy(UserService.class);
  User user = userService.getById(123);   // 底层其实通过网络调用远程机器
  // 调用方无需关心网络细节，感觉像在调本地方法

RPC 框架屏蔽的复杂性：
  ① 网络通信（TCP/HTTP 建连、收发数据）
  ② 序列化/反序列化（对象 ↔ 字节流）
  ③ 服务发现（找到目标服务的地址）
  ④ 负载均衡（多个实例选哪个）
  ⑤ 超时/重试/容错
```

### 1.2 一次 RPC 调用的完整流程

```
客户端（Consumer）                              服务端（Provider）
  │                                                │
  │ ① 调用本地代理（Stub/Proxy）                    │
  │    ↓                                           │
  │ ② 代理将方法名+参数序列化为二进制               │
  │    ↓                                           │
  │ ③ 通过网络发送请求                              │
  │ ──────── TCP / HTTP/2 ────────────────────────→│
  │                                                │ ④ 收到请求，反序列化
  │                                                │    ↓
  │                                                │ ⑤ 反射调用本地实现方法
  │                                                │    UserServiceImpl.getById(123)
  │                                                │    ↓
  │                                                │ ⑥ 将返回值序列化为二进制
  │ ←─────── TCP / HTTP/2 ────────────────────────│ ⑦ 通过网络发送响应
  │ ⑧ 反序列化响应                                 │
  │    ↓                                           │
  │ ⑨ 代理返回结果给调用方                          │

耗时组成：
  序列化 + 网络传输（RTT）+ 反序列化 + 服务端处理
  优化目标：减少序列化开销（Protobuf）+ 减少网络开销（连接复用/HTTP2多路复用）
```

### 1.3 RPC vs HTTP REST

| 维度 | RPC | HTTP REST |
|------|-----|-----------|
| **调用方式** | 像本地方法调用 | 构造 HTTP 请求（URL + JSON Body）|
| **序列化** | 二进制（Protobuf/Hessian），紧凑高效 | 文本（JSON/XML），可读但体积大 |
| **传输协议** | 自定义 TCP / HTTP/2 | HTTP/1.1 |
| **性能** | 高（二进制+长连接+多路复用）| 较低（文本解析+短连接开销）|
| **跨语言** | 需 IDL 定义（.proto）| 天然跨语言（HTTP + JSON）|
| **接口契约** | 强类型（IDL 编译生成代码）| 弱约束（靠文档/Swagger）|
| **适用场景** | 内部微服务间高性能通信 | 对外 API、前后端交互、与第三方对接 |

---

## 二、RPC 核心组件详解 ⭐⭐⭐⭐

### 2.1 动态代理（客户端 Stub）

```
RPC 框架如何让 userService.getById(123) 透明地变成网络调用？
→ 动态代理

JDK 动态代理（接口代理）：
  Proxy.newProxyInstance(classLoader, interfaces, invocationHandler)
  InvocationHandler.invoke() 拦截方法调用 → 序列化 → 网络发送

CGLIB 代理（类代理）：
  通过字节码生成子类，重写目标方法
  Dubbo 支持 CGLIB 代理

Byte Buddy / Javassist：
  更现代的字节码库，gRPC Java 使用编译生成 Stub 类（非运行时代理）

gRPC 的做法：
  不用运行时动态代理，而是 protoc 编译器在编译期生成 Stub 类
  性能更好（无反射开销），类型更安全（编译期检查）
```

### 2.2 序列化协议

| 协议 | 类型 | 性能 | 体积 | 跨语言 | 典型框架 |
|------|------|------|------|--------|---------|
| **Protobuf** | 二进制 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ✅ | gRPC |
| **Hessian2** | 二进制 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ✅ | Dubbo |
| **Kryo** | 二进制 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ❌（Java only）| Spark |
| **JSON** | 文本 | ⭐⭐ | ⭐⭐ | ✅ | Feign/REST |
| **Thrift Binary** | 二进制 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ✅ | Thrift |
| **Java Serializable** | 二进制 | ⭐ | ⭐ | ❌ | - |

### 2.3 网络传输层

```
TCP 长连接 + 连接池：
  大多数 RPC 框架（Dubbo/Thrift）使用 Netty 建立 TCP 长连接
  连接池管理：避免频繁三次握手，复用连接
  多路复用：一个 TCP 连接上并发多个请求（requestId 标记对应关系）

HTTP/2（gRPC 的选择）：
  天然多路复用（一个 TCP 连接上多个 Stream 并发）
  二进制帧（比 HTTP/1.1 文本头更紧凑）
  头部压缩（HPACK）
  服务端推送
  → gRPC 基于 HTTP/2 传输，不需要自建连接池

自定义协议帧格式（Dubbo 协议为例）：
  ┌──────────────────────────────────────────┐
  │ Magic(2B) │ Flag(1B) │ Status(1B) │ ReqId(8B) │ DataLen(4B) │ Payload │
  └──────────────────────────────────────────┘
  Magic：魔数，标识 Dubbo 协议
  Flag：请求/响应、序列化方式、是否心跳
  ReqId：请求ID，用于请求-响应对应（多路复用关键）
```

### 2.4 服务发现与负载均衡

```
服务发现：
  Provider 启动 → 注册到注册中心（Nacos/ZooKeeper/Consul）
  Consumer 启动 → 从注册中心订阅 Provider 列表 → 缓存到本地
  Provider 上下线 → 注册中心推送变更 → Consumer 更新本地缓存

负载均衡策略（客户端侧）：
  随机（Random）       → 简单均匀
  轮询（RoundRobin）   → 按顺序分配
  加权轮询             → 配合权重，优先调用高权重节点
  最少活跃数           → 调用量最少的节点优先（Dubbo 默认）
  一致性哈希           → 相同参数路由到同一节点（适合有状态场景）

gRPC 负载均衡：
  客户端侧：gRPC 内置 pick_first（默认）/ round_robin
  服务端侧：需结合 Envoy/Nginx 做 L7 代理（gRPC 基于 HTTP/2）
```

---

## 三、gRPC 深入解析 ⭐⭐⭐⭐⭐

### 3.1 gRPC 整体架构

```
gRPC = Google Remote Procedure Call（Google 开源，2015年）

技术栈：
  IDL：       Protocol Buffers（.proto 文件定义接口和消息）
  传输协议：   HTTP/2（多路复用、二进制帧、头部压缩）
  序列化：     Protobuf（高性能二进制序列化）
  代码生成：   protoc 编译器 + 语言插件 → 自动生成客户端 Stub / 服务端骨架

架构示意：

  ┌────────────────────┐                    ┌────────────────────┐
  │     Client          │                    │      Server        │
  │                    │                    │                    │
  │  Generated Stub    │                    │  Service Impl      │
  │     ↓              │                    │     ↑              │
  │  gRPC Channel      │                    │  gRPC Server       │
  │     ↓              │                    │     ↑              │
  │  HTTP/2 Transport  │ ←── HTTP/2 ───→   │  HTTP/2 Transport  │
  │  (Netty / OkHttp)  │                    │  (Netty)           │
  └────────────────────┘                    └────────────────────┘

支持语言：
  Java / Go / C++ / Python / C# / Node.js / Rust / Ruby / Dart ...
  通过 .proto 定义一次，多语言生成代码 → 天然跨语言
```

### 3.2 Proto 文件定义

```protobuf
// user.proto
syntax = "proto3";

package user;
option java_package = "com.example.grpc.user";
option java_multiple_files = true;

// 消息定义（等价于 Java POJO）
message GetUserRequest {
  int64 user_id = 1;      // 字段编号（不是值），用于二进制编码
}

message User {
  int64 id = 1;
  string name = 2;
  string email = 3;
  int32 age = 4;
  repeated string tags = 5;       // 列表类型
  UserStatus status = 6;
}

enum UserStatus {
  UNKNOWN = 0;
  ACTIVE = 1;
  INACTIVE = 2;
}

message UserListResponse {
  repeated User users = 1;
  int32 total = 2;
}

// 服务定义（等价于 Java Interface）
service UserService {
  // 一元 RPC（最常用）
  rpc GetUser(GetUserRequest) returns (User);

  // 服务端流
  rpc ListUsers(GetUserRequest) returns (stream User);

  // 客户端流
  rpc UploadUsers(stream User) returns (UserListResponse);

  // 双向流
  rpc Chat(stream ChatMessage) returns (stream ChatMessage);
}
```

### 3.3 gRPC 四种调用模式

```
① Unary RPC（一元调用）— 最常用
   客户端发一个请求 → 服务端返回一个响应
   等价于普通的 HTTP 请求-响应模式

   Client ──Request──→ Server
   Client ←──Response── Server

② Server Streaming RPC（服务端流）
   客户端发一个请求 → 服务端返回一个流（多条数据）
   适用：大数据量查询结果分批返回、实时数据推送

   Client ──Request──→ Server
   Client ←──Response 1── Server
   Client ←──Response 2── Server
   Client ←──Response N── Server
   Client ←──完成标记── Server

③ Client Streaming RPC（客户端流）
   客户端发送一个流 → 服务端收完后返回一个响应
   适用：文件上传、批量数据提交

   Client ──Request 1──→ Server
   Client ──Request 2──→ Server
   Client ──Request N──→ Server
   Client ──完成标记──→ Server
   Client ←──Response── Server

④ Bidirectional Streaming RPC（双向流）
   客户端和服务端同时互相发送流
   两个流独立，可同时进行
   适用：IM 聊天、实时协作、传感器数据交换

   Client ←──→ Server（双向独立流）
```

### 3.4 gRPC + HTTP/2 的优势

```
HTTP/2 多路复用（Multiplexing）：
  一个 TCP 连接上可同时传输多个 gRPC 请求/响应（Stream）
  解决 HTTP/1.1 的队头阻塞（Head-of-Line Blocking）
  无需像 Dubbo 一样自建连接池

  TCP Connection
  ┌──────────────────────────────────────┐
  │ Stream 1: GetUser(request)           │
  │ Stream 2: ListUsers(request)         │ ← 同时进行，不互相阻塞
  │ Stream 3: GetUser(response)          │
  └──────────────────────────────────────┘

二进制帧（Binary Framing）：
  HTTP/2 将数据拆分为更小的帧（HEADERS 帧 + DATA 帧）
  二进制编码比 HTTP/1.1 文本头更紧凑

头部压缩（HPACK）：
  HTTP/2 使用 HPACK 压缩请求头
  重复的头部（如 :method POST, content-type application/grpc）只传差量
  减少约 30%~50% 的头部开销

流控（Flow Control）：
  HTTP/2 内置流量控制，防止快速发送方压垮慢速接收方
  与 TCP 流控配合，保护双端

gRPC 独有的优势：
  基于 Protobuf 的 metadata 传递（等价于 HTTP Header，但更高效）
  内置 deadline 传播（超时时间跨服务传递）
  内置错误码体系（Status Code：OK/CANCELLED/DEADLINE_EXCEEDED/...）
```

### 3.5 Java gRPC 代码示例

```java
// === 服务端实现 ===
public class UserServiceImpl extends UserServiceGrpc.UserServiceImplBase {

    @Override
    public void getUser(GetUserRequest request, StreamObserver<User> responseObserver) {
        long userId = request.getUserId();

        User user = User.newBuilder()
                .setId(userId)
                .setName("张三")
                .setEmail("zhangsan@example.com")
                .setAge(28)
                .build();

        responseObserver.onNext(user);       // 发送响应
        responseObserver.onCompleted();      // 完成
    }

    @Override
    public void listUsers(GetUserRequest request, StreamObserver<User> responseObserver) {
        // 服务端流：分次发送多个 User
        for (int i = 1; i <= 100; i++) {
            User user = User.newBuilder().setId(i).setName("User-" + i).build();
            responseObserver.onNext(user);
        }
        responseObserver.onCompleted();
    }
}

// 启动 gRPC Server
Server server = ServerBuilder.forPort(9090)
        .addService(new UserServiceImpl())
        .build()
        .start();
```

```java
// === 客户端调用 ===
ManagedChannel channel = ManagedChannelBuilder
        .forAddress("localhost", 9090)
        .usePlaintext()     // 开发环境不加密
        .build();

// 同步 Stub（阻塞式）
UserServiceGrpc.UserServiceBlockingStub blockingStub =
        UserServiceGrpc.newBlockingStub(channel);

User user = blockingStub.getUser(
        GetUserRequest.newBuilder().setUserId(123).build()
);
System.out.println("用户名: " + user.getName());

// 异步 Stub（非阻塞/流式）
UserServiceGrpc.UserServiceStub asyncStub =
        UserServiceGrpc.newStub(channel);

asyncStub.listUsers(
        GetUserRequest.newBuilder().build(),
        new StreamObserver<User>() {
            @Override
            public void onNext(User user) {
                System.out.println("收到: " + user.getName());
            }
            @Override
            public void onError(Throwable t) { t.printStackTrace(); }
            @Override
            public void onCompleted() { System.out.println("流结束"); }
        }
);

// 用完关闭
channel.shutdown();
```

---

## 四、gRPC 高级特性 ⭐⭐⭐⭐

### 4.1 拦截器（Interceptor）

```
gRPC 拦截器类似 Spring MVC 的 HandlerInterceptor，用于横切关注点：
  认证鉴权、日志记录、链路追踪、监控指标

客户端拦截器：
  ClientInterceptor → 在请求发出前/响应返回后拦截

服务端拦截器：
  ServerInterceptor → 在请求被处理前/响应发出前拦截
```

```java
// 服务端拦截器示例：鉴权
public class AuthInterceptor implements ServerInterceptor {

    private static final Metadata.Key<String> TOKEN_KEY =
        Metadata.Key.of("authorization", Metadata.ASCII_STRING_MARSHALLER);

    @Override
    public <ReqT, RespT> ServerCall.Listener<ReqT> interceptCall(
            ServerCall<ReqT, RespT> call,
            Metadata headers,
            ServerCallHandler<ReqT, RespT> next) {

        String token = headers.get(TOKEN_KEY);
        if (token == null || !validateToken(token)) {
            call.close(Status.UNAUTHENTICATED.withDescription("Invalid token"), new Metadata());
            return new ServerCall.Listener<>() {};  // 空 listener，不继续处理
        }
        return next.startCall(call, headers);
    }
}

// 注册拦截器
Server server = ServerBuilder.forPort(9090)
        .addService(ServerInterceptors.intercept(new UserServiceImpl(), new AuthInterceptor()))
        .build();
```

### 4.2 超时与 Deadline 传播

```
gRPC 内置 Deadline 机制（比 HTTP 超时更强大）：

客户端设置 deadline：
  UserServiceGrpc.UserServiceBlockingStub stub =
      blockingStub.withDeadlineAfter(3, TimeUnit.SECONDS);
  // 如果 3 秒内没有收到响应 → 自动取消请求 → 抛出 DEADLINE_EXCEEDED

Deadline 跨服务传播：
  Service A → Service B → Service C
  A 设置 deadline = 5s → 到达 B 时剩余 4s → B 转发给 C 时自动携带剩余 deadline
  C 必须在剩余时间内完成，否则整个链路超时

  这是 gRPC 特有能力：超时时间自动沿调用链传递，无需每层手动配置
  HTTP REST 做不到（需自行在 Header 中传递并解析剩余时间）
```

### 4.3 重试策略（Retry Policy）

```json
// 通过 Service Config JSON 配置自动重试
{
  "methodConfig": [{
    "name": [{"service": "user.UserService", "method": "GetUser"}],
    "retryPolicy": {
      "maxAttempts": 3,                    // 最多重试 3 次（含首次）
      "initialBackoff": "0.1s",            // 首次重试退避
      "maxBackoff": "1s",                  // 最大退避间隔
      "backoffMultiplier": 2,              // 指数退避因子
      "retryableStatusCodes": ["UNAVAILABLE", "DEADLINE_EXCEEDED"]
    }
  }]
}
```

```
重试安全性：
  gRPC 只对幂等方法自动重试（需保证业务幂等）
  非幂等方法（如创建订单）不应配置自动重试 → 改用 hedging（对冲）策略

Hedging（对冲请求）：
  同时发多个相同请求到不同后端，取最快返回的结果
  适用：读操作、幂等操作，牺牲带宽换取更低尾延迟
```

### 4.4 负载均衡

```
gRPC 客户端侧负载均衡：

内置策略：
  pick_first（默认）：始终使用第一个可用地址
  round_robin：轮询所有地址

NameResolver + LoadBalancer 机制：
  ① NameResolver 解析目标地址（DNS / 注册中心 / 自定义）
     → 返回 IP 列表
  ② LoadBalancer 从 IP 列表中选择一个发起请求
     → 内置 pick_first / round_robin
     → 可扩展自定义策略

结合 Nacos/Consul 等注册中心：
  实现自定义 NameResolver → 从注册中心获取实例列表
  → 配合 round_robin 策略实现客户端负载均衡

代理侧负载均衡（L7 Proxy）：
  Envoy / Nginx（1.13.10+ 支持 gRPC）/ Istio
  → HTTP/2 级别的负载均衡，对客户端透明
  → Service Mesh 场景首选
```

### 4.5 健康检查协议

```
gRPC 定义了标准的健康检查协议（grpc.health.v1.Health）：

service Health {
  rpc Check(HealthCheckRequest) returns (HealthCheckResponse);
  rpc Watch(HealthCheckRequest) returns (stream HealthCheckResponse);
}

HealthCheckResponse.ServingStatus:
  UNKNOWN / SERVING / NOT_SERVING / SERVICE_UNKNOWN

使用场景：
  K8s liveness/readiness 探针（grpc_health_probe 工具）
  负载均衡器主动探测后端是否可用
  Envoy/Istio Sidecar 健康检查

Java 服务端启用：
  Server server = ServerBuilder.forPort(9090)
      .addService(new UserServiceImpl())
      .addService(ProtoReflectionService.newInstance())   // 反射服务（调试用）
      .addService(HealthStatusManager.getDefaultService()) // 健康检查
      .build();
```

---

## 五、Protobuf 序列化原理 ⭐⭐⭐⭐

### 5.1 编码方式

```
Protobuf 使用 Tag-Length-Value（TLV）编码，极其紧凑：

Tag = (field_number << 3) | wire_type

wire_type 取值：
  0 = Varint（int32, int64, bool, enum）
  1 = 64-bit（fixed64, double）
  2 = Length-delimited（string, bytes, embedded messages, repeated fields）
  5 = 32-bit（fixed32, float）

Varint 编码（变长整数）：
  小数字用更少字节：
    1     → 0x01        （1字节）
    127   → 0x7F        （1字节）
    128   → 0x80 0x01   （2字节）
    300   → 0xAC 0x02   （2字节）
  
  每字节最高位（MSB）= 1 表示后续还有字节，= 0 表示当前是最后一字节

示例（message User { int32 id = 1; string name = 2; }）：
  id=123, name="ABC"

  编码结果：
  08 7B        → 字段1(id), Varint, 值=123
  12 03 41 42 43 → 字段2(name), Length-delimited, 长度=3, "ABC"

  总共 7 字节  vs JSON {"id":123,"name":"ABC"} = 24 字节
  → Protobuf 体积约为 JSON 的 1/3 ~ 1/5
```

### 5.2 为什么 Protobuf 比 JSON 快

```
① 体积小：二进制 + Varint 变长编码 + 无字段名（用编号替代）
   → 网络传输量减少 50%~80%

② 编解码快：
   JSON：字符串解析 → 查找字段名 → 类型转换 → 赋值
   Protobuf：直接读 Tag → 按 wire_type 解码 → 按 field_number 赋值
   无需字符串匹配，O(1) 定位字段

③ 强类型：
   proto 文件定义类型，编译器生成类型安全的 Builder/Getter
   运行时无需类型推断和转换

④ 向前/向后兼容：
   新增字段 → 旧代码忽略未知 field_number（向前兼容）
   删除字段 → 只要不复用 field_number 就不会冲突（向后兼容）
   → 这就是为什么 proto 中字段编号不能修改或复用
```

### 5.3 Proto3 vs Proto2

```
Proto3（推荐使用）：
  ✅ 所有字段都有默认值（int=0, string="", bool=false）
  ✅ 移除了 required 和 optional 关键字
  ✅ 支持 JSON 映射
  ❌ 无法区分"字段未设置"和"字段值为默认值"
     → 需要使用 google.protobuf.Wrapper（Int32Value 等）或 optional 关键字（3.15+恢复）

Proto2：
  支持 required/optional/default
  遗留项目仍在使用
```

---

## 六、主流 RPC 框架横向对比 ⭐⭐⭐⭐

| 维度 | gRPC | Dubbo 3 | Thrift | OpenFeign |
|------|------|---------|--------|-----------|
| **开源方** | Google | Alibaba | Facebook(Meta) | Spring Cloud |
| **IDL** | Protobuf (.proto) | 无（Java接口即契约）/ Triple 支持 proto | Thrift IDL (.thrift) | 无（HTTP 注解）|
| **序列化** | Protobuf | Hessian2 / Protobuf / JSON | Thrift Binary/Compact | JSON |
| **传输协议** | HTTP/2 | Dubbo TCP / Triple(HTTP/2) | Thrift二进制 TCP | HTTP/1.1 |
| **跨语言** | ✅ 强（10+语言）| ⚠️ Triple 协议支持 | ✅ 强 | ❌ Java 为主 |
| **流式调用** | ✅ 四种模式 | ✅ Triple 支持 | ❌ 基础 | ❌ |
| **服务发现** | 需集成（DNS/Consul/自定义）| ✅ 内置（Nacos/ZK）| 需集成 | ✅ 内置（Nacos/Eureka）|
| **治理能力** | 基础（需 Envoy/Istio）| ✅ 丰富（限流/熔断/路由/灰度）| 基础 | ⚠️ 依赖 Sentinel/Hystrix |
| **性能** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐ |
| **Cloud Native** | ✅ K8s/Istio 原生 | ✅ Triple 兼容 gRPC | ⚠️ 一般 | ✅ Spring Cloud |
| **适用场景** | 跨语言高性能/云原生 | Java 微服务全家桶 | 跨语言内部通信 | HTTP API 调用 |

### 选型建议

```
① 跨语言 + 高性能 + 云原生（K8s/Istio）→ gRPC
   适合：多语言微服务、对延迟敏感的内部通信

② Java 微服务全家桶 + 丰富治理能力 → Dubbo 3（Triple 协议）
   适合：已有 Spring Cloud Alibaba 生态，需要完善的路由/灰度/限流

③ Java 微服务简单 HTTP 调用 → OpenFeign + Spring Cloud
   适合：业务逻辑为主，对性能要求不极端，团队熟悉 Spring

④ 跨语言 + 旧项目 → Thrift
   适合：已有 Thrift 生态的遗留系统

趋势：Dubbo 3 的 Triple 协议已兼容 gRPC，未来 gRPC + Dubbo 可以互通
```

---

## 七、高频追问汇总 ⭐⭐⭐⭐

**Q: gRPC 和 REST 相比有什么优势和劣势？**
> 优势：基于 HTTP/2 多路复用性能高，Protobuf 二进制序列化体积小速度快，.proto IDL 强类型跨语言，内置流式调用和超时传播。劣势：浏览器支持有限（需 gRPC-Web 代理），调试不如 JSON 直观（二进制不可读），需要额外学习 Protobuf，对外 API 不如 REST 通用。一般内部微服务用 gRPC，对外 API 用 REST。

**Q: gRPC 为什么选择 HTTP/2 而不用自定义 TCP？**
> ① 多路复用是现成的，不需要自建请求-响应对应机制；② 头部压缩（HPACK）减少元数据开销；③ 兼容现有 HTTP 基础设施（负载均衡器、防火墙、代理）；④ 浏览器可通过 gRPC-Web 桥接访问；⑤ 利用成熟的 TLS on HTTP/2 实现传输安全。代价是比裸 TCP 多一层协议开销，但多路复用带来的收益远大于开销。

**Q: Protobuf 字段编号为什么不能修改？**
> Protobuf 二进制编码中不存储字段名，只存储字段编号（field_number）。修改编号后，旧版本客户端用旧编号解析新数据会错位。删除的字段编号应用 `reserved` 标记防止复用，确保向前/向后兼容。

**Q: gRPC 的 Deadline 和 HTTP 超时有什么区别？**
> HTTP 超时是客户端单方面设置，只对直接调用有效，不会传递给下游。gRPC 的 Deadline 是绝对时间点，自动通过 metadata 沿调用链传播：A→B→C，A 设的 Deadline 到达 C 时自动扣减已消耗时间，C 知道自己还剩多少时间。这避免了每层独立设超时导致的累积效应。

**Q: gRPC 怎么处理服务端推送（Server Push）场景？**
> 使用 Server Streaming RPC：客户端发一个请求，服务端多次调用 `responseObserver.onNext()` 持续推送数据。更复杂的交互（如 IM）使用 Bidirectional Streaming，双方同时读写独立的流。这是 gRPC 相比 REST 的核心优势之一。

**Q: gRPC 在 Spring Boot 中怎么用？**
> 使用 `grpc-spring-boot-starter`（如 `net.devh:grpc-server-spring-boot-starter`）。服务端实现类加 `@GrpcService` 注解自动注册到 gRPC Server；客户端使用 `@GrpcClient("serviceName")` 注入 Stub。配置文件中指定端口、TLS、注册中心等。可以与 Spring Cloud Alibaba（Nacos 服务发现 + Sentinel 限流）无缝集成。

**Q: Dubbo 3 的 Triple 协议和 gRPC 是什么关系？**
> Triple 是 Dubbo 3 基于 HTTP/2 设计的新协议，**兼容 gRPC 协议**。Triple 服务可以被 gRPC 客户端直接调用，反之亦然。区别是 Triple 额外支持 Dubbo 的服务治理能力（路由规则、灰度、权重），保留了 Dubbo 生态的 Java 友好性（支持 Java 接口定义服务，无需 proto 文件）。
