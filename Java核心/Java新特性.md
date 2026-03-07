# Java 新特性

> 最后更新：2026年3月7日  
> 覆盖 Java 8 → Java 21 面试高频新特性

---

## 一、Java 8 核心特性 ⭐⭐⭐⭐⭐

### 1.1 Lambda 表达式

**本质：** 函数式接口（只有一个抽象方法的接口）的匿名实现，简化匿名内部类写法。

```java
// 传统匿名内部类
Runnable r1 = new Runnable() {
    @Override public void run() { System.out.println("hello"); }
};

// Lambda
Runnable r2 = () -> System.out.println("hello");

// 方法引用（Lambda 的简写）
List<String> list = Arrays.asList("c", "a", "b");
list.sort(String::compareTo);   // 等价于 (a, b) -> a.compareTo(b)
```

**四种函数式接口：**

| 接口 | 方法签名 | 说明 |
|------|---------|------|
| `Supplier<T>` | `T get()` | 无参有返回，用于延迟生成 |
| `Consumer<T>` | `void accept(T)` | 有参无返回，用于消费 |
| `Function<T,R>` | `R apply(T)` | 有参有返回，转换 |
| `Predicate<T>` | `boolean test(T)` | 断言/过滤 |

---

### 1.2 Stream API ⭐⭐⭐⭐

**特点：** 惰性求值（中间操作不立即执行，遇到终止操作才触发全链路计算）、不修改原数据。

```java
List<Order> orders = getOrders();

// 统计金额>100的订单，按金额降序，取前5名的用户ID列表
List<Long> topUsers = orders.stream()
    .filter(o -> o.getAmount().compareTo(BigDecimal.valueOf(100)) > 0)  // 中间操作
    .sorted(Comparator.comparing(Order::getAmount).reversed())           // 中间操作
    .limit(5)                                                             // 中间操作
    .map(Order::getUserId)                                                // 中间操作
    .collect(Collectors.toList());                                        // 终止操作，触发执行

// groupingBy 分组统计
Map<String, Long> countByStatus = orders.stream()
    .collect(Collectors.groupingBy(Order::getStatus, Collectors.counting()));

// parallel Stream（数据量大时可择用，注意线程安全）
long count = orders.parallelStream().filter(o -> o.isPaid()).count();
```

**常用操作速查：**

| 操作 | 类型 | 说明 |
|------|------|------|
| `filter` | 中间 | 过滤 |
| `map` | 中间 | 转换元素类型 |
| `flatMap` | 中间 | 展平嵌套 Stream |
| `distinct` | 中间 | 去重 |
| `sorted` | 中间 | 排序 |
| `limit`/`skip` | 中间 | 截取/跳过 |
| `collect` | 终止 | 收集到集合/Map |
| `reduce` | 终止 | 聚合计算 |
| `forEach` | 终止 | 消费 |
| `count`/`min`/`max` | 终止 | 统计 |
| `anyMatch`/`allMatch` | 终止 | 短路匹配 |

---

### 1.3 Optional ⭐⭐⭐

**目的：** 避免 NullPointerException，显式处理空值。

```java
// 创建
Optional<String> opt1 = Optional.of("value");        // 不允许null，null抛NPE
Optional<String> opt2 = Optional.ofNullable(null);   // 允许null
Optional<String> opt3 = Optional.empty();

// 使用链
String result = Optional.ofNullable(user)
    .map(User::getAddress)               // null时跳过，返回empty
    .map(Address::getCity)
    .orElse("unknown");                  // 为空时的默认值

// orElseGet（延迟计算，比orElse性能好）
String result2 = opt.orElseGet(() -> computeDefault());

// orElseThrow
String result3 = opt.orElseThrow(() -> new BusinessException("用户不存在"));

// ifPresent（有值时执行）
opt.ifPresent(v -> log.info("value: {}", v));
```

> ⚠️ 不要把 Optional 用作方法参数或字段，只适合作为返回值

---

### 1.4 接口默认方法 & 静态方法

```java
interface Validator<T> {
    boolean validate(T t);                  // 抽象方法

    default Validator<T> and(Validator<T> other) {  // 默认方法，可被实现类覆盖
        return t -> this.validate(t) && other.validate(t);
    }

    static Validator<String> notEmpty() {   // 静态方法，通过接口名调用
        return s -> s != null && !s.isEmpty();
    }
}
```

---

### 1.5 新日期 API（java.time）

```java
// LocalDate / LocalTime / LocalDateTime（不含时区，不可变线程安全）
LocalDate today = LocalDate.now();
LocalDate birthday = LocalDate.of(1995, Month.MARCH, 15);
long age = ChronoUnit.YEARS.between(birthday, today);

// ZonedDateTime（含时区）
ZonedDateTime shTime = ZonedDateTime.now(ZoneId.of("Asia/Shanghai"));

// Duration / Period
Duration d = Duration.between(startTime, endTime);   // 时间差（时分秒）
Period p = Period.between(startDate, endDate);        // 日期差（年月日）

// 格式化
String formatted = LocalDateTime.now()
    .format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));
```

> **为什么要替换 Date/Calendar？**：Date 可变不线程安全；Calendar API 设计混乱（月份从0开始）；SimpleDateFormat 线程不安全（面试高频陷阱）

---

## 二、Java 9-11 特性 ⭐⭐

### 2.1 Java 9：模块化（JPMS）

```java
// module-info.java
module com.example.app {
    requires java.sql;                // 依赖其他模块
    exports com.example.api;          // 对外暴露包
    opens com.example.internal to com.example.test;  // 仅开放给特定模块反射
}
```

> 面试重点：理解模块化目的（控制访问、减少 classpath 问题），实际使用 Spring Boot 项目较少强制迁移

### 2.2 Java 10：局部变量类型推断 `var`

```java
var list = new ArrayList<String>();   // 编译期推断为 ArrayList<String>
var map = new HashMap<String, Integer>();
for (var entry : map.entrySet()) {    // 循环变量
    System.out.println(entry.getKey());
}
// ⚠️ 限制：只能用于局部变量；不能用于方法参数、字段、返回类型
```

### 2.3 Java 11：HTTP 客户端（正式版）

```java
HttpClient client = HttpClient.newHttpClient();
HttpRequest request = HttpRequest.newBuilder()
    .uri(URI.create("https://api.example.com/data"))
    .header("Content-Type", "application/json")
    .POST(HttpRequest.BodyPublishers.ofString("{\"key\":\"value\"}"))
    .build();

// 同步
HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());

// 异步
client.sendAsync(request, HttpResponse.BodyHandlers.ofString())
      .thenApply(HttpResponse::body)
      .thenAccept(System.out::println);
```

---

## 三、Java 14-17 特性 ⭐⭐⭐

### 3.1 Switch 表达式（Java 14 正式）

```java
// 旧写法：case穿透、忘记break是常见BUG
int num = switch (day) {
    case MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY -> 8;  // 箭头语法，无穿透
    case SATURDAY, SUNDAY -> 0;
    default -> throw new IllegalArgumentException("Unknown day: " + day);
};

// yield 返回复杂结果
int hours = switch (day) {
    case MONDAY -> {
        log.info("weekday");
        yield 8;        // yield 代替 break，返回值
    }
    default -> 0;
};
```

### 3.2 Record（Java 16 正式）⭐⭐⭐

**目的：** 简化不可变数据类，自动生成构造器、getter、equals、hashCode、toString。

```java
// 一行代码替代20行 DTO/VO 样板代码
public record Point(int x, int y) {
    // 紧凑构造器（参数校验）
    public Point {
        if (x < 0 || y < 0) throw new IllegalArgumentException("坐标不能为负");
    }
    // 可以添加额外方法
    public double distance() { return Math.sqrt(x * x + y * y); }
}

Point p = new Point(3, 4);
p.x();           // 自动生成getter（无 get 前缀）
System.out.println(p);  // Point[x=3, y=4]
```

### 3.3 Sealed Class（Java 17 正式）⭐⭐

**目的：** 限制继承层次，与 switch 模式匹配配合，使编译器能穷举所有子类型。

```java
public sealed interface Shape permits Circle, Rectangle, Triangle {}

public record Circle(double radius) implements Shape {}
public record Rectangle(double w, double h) implements Shape {}
public record Triangle(double base, double height) implements Shape {}

// switch 可穷举，编译器检查是否遗漏分支
double area = switch (shape) {
    case Circle c    -> Math.PI * c.radius() * c.radius();
    case Rectangle r -> r.w() * r.h();
    case Triangle t  -> 0.5 * t.base() * t.height();
    // 无需 default：编译器已知所有子类型
};
```

### 3.4 文本块（Java 15 正式）

```java
// 旧写法
String json = "{\n  \"name\": \"Alice\",\n  \"age\": 30\n}";

// 文本块
String json = """
        {
          "name": "Alice",
          "age": 30
        }
        """;
```

---

## 四、Java 21 特性（LTS）⭐⭐⭐

### 4.1 虚拟线程（Virtual Threads）⭐⭐⭐⭐

**核心价值：** 以接近线程数量级的成本创建百万级线程，彻底解决传统 I/O 密集型应用的线程瓶颈。

| 对比项 | 平台线程（OS线程） | 虚拟线程 |
|--------|----------------|--------|
| 创建成本 | 约 1MB 栈内存 | 几KB，受 JVM 管理 |
| 数量上限 | 约数千（OS 限制）| 百万级 |
| 阻塞行为 | 阻塞 OS 线程，CPU 空转 | 阻塞时挂起（卸载载体线程），不占 OS 资源 |
| 适用场景 | CPU 密集型 | **I/O 密集型（数据库查询、RPC、HTTP）** |

```java
// 创建虚拟线程
Thread vt = Thread.ofVirtual().start(() -> {
    // 阻塞 I/O 操作会自动挂起虚拟线程，不阻塞载体线程
    String result = httpClient.send(request, bodyHandler).body();
});

// 虚拟线程池（Spring Boot 3.2+ 已内置支持）
ExecutorService vtPool = Executors.newVirtualThreadPerTaskExecutor();
vtPool.submit(() -> service.queryDb());  // 每个任务一个虚拟线程，I/O阻塞不浪费资源

// Spring Boot 开启虚拟线程
// application.yml
// spring.threads.virtual.enabled: true
```

> ⚠️ **注意事项**：synchronized 块会阻塞载体线程（Pinning），建议改用 ReentrantLock；不适合 CPU 密集型计算（反而增加调度开销）

### 4.2 模式匹配增强（Pattern Matching）

```java
// instanceof 模式匹配（Java 16 正式，21进一步增强）
if (obj instanceof String s && s.length() > 5) {
    System.out.println(s.toUpperCase());  // s已自动转型
}

// switch 模式匹配（Java 21 正式）
String result = switch (obj) {
    case Integer i -> "整数: " + i;
    case String s when s.isEmpty() -> "空字符串";
    case String s  -> "字符串: " + s;
    case null      -> "null";
    default        -> "其他类型";
};
```

### 4.3 Sequenced Collections

```java
// 新接口：统一获取首尾元素，避免各集合用法不一致
List<String> list = new ArrayList<>(List.of("a", "b", "c"));
list.getFirst();   // "a"（等价于 list.get(0)）
list.getLast();    // "c"（等价于 list.get(list.size()-1)）
list.reversed();   // 逆序视图

LinkedHashSet<String> set = new LinkedHashSet<>(Set.of("x", "y", "z"));
set.getFirst();    // 此前 LinkedHashSet 无法直接获取第一个元素
```

---

## 五、面试标准答法

**Q: Java 8 Stream 的 parallel() 有什么注意事项？**

> parallel() 使用 ForkJoinPool.commonPool()（默认 CPU-1 线程）并行执行，适合计算密集型无状态操作（如大量数值计算）。但需注意：① 数据量小时并行反而慢（线程切换开销 > 计算收益）；② 操作有副作用（修改共享变量）时线程不安全；③ 与数据库连接池等资源绑定的操作不适合 parallel（连接数有限）。通常数据量 > 10万且操作无状态时才考虑使用。

**Q: Java 21 虚拟线程和协程有什么区别？**

> 虚拟线程是 JVM 原生支持的用户态线程，使用传统线程 API（Thread/ExecutorService），代码无需改造，I/O 阻塞时由 JVM 自动挂起/恢复，对业务代码透明。协程（如 Kotlin coroutines）需要使用特定语法（suspend/async/await），需要显式标注挂起点，代码侵入更强但更灵活可控。虚拟线程是"以同步代码写异步效果"，协程是显式异步编程模型。
