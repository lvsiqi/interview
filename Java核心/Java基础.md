# Java 基础知识

> 最后更新：2026年3月5日

---

## 章节总览

| 章节 | 内容 |
|------|------|
| [一、面向对象四大特性](#一面向对象四大特性) | 封装、继承、多态、抽象 |
| [二、String / StringBuilder / StringBuffer](#二string--stringbuilder--stringbuffer) | 不可变原理、intern、性能对比 |
| [三、equals 与 hashCode](#三equals-与-hashcode) | 契约规则、HashMap关系、重写要点 |
| [四、异常体系](#四异常体系) | Checked/Unchecked、try-with-resources、自定义异常 |
| [五、泛型](#五泛型) | 类型擦除、通配符、PECS原则 |
| [六、反射](#六反射) | Class对象、Method/Field操作、性能与安全 |
| [七、注解](#七注解) | 元注解、自定义注解、运行时处理 |
| [八、序列化](#八序列化) | Java序列化、JSON、Protobuf对比 |
| [九、Java 内存模型 (JMM)](#九java-内存模型-jmm) | 主内存/工作内存、可见性、有序性 |
| [十、面试速查表](#十面试速查表) | 高频考点一表通 |

---

## 一、面向对象四大特性 ⭐⭐

### 1.1 封装（Encapsulation）
- 将数据（属性）和操作（方法）封装在类内部，通过 `private` + getter/setter 控制访问
- 目的：**隐藏实现细节**，降低耦合、提高安全性

### 1.2 继承（Inheritance）
- `extends` 关键字，Java **单继承**（类），多实现（接口）
- 子类继承父类所有非 private 成员；构造方法不能继承，但可通过 `super()` 调用

| 对比 | 继承 | 组合 |
|------|------|------|
| 关系 | is-a | has-a |
| 耦合 | 强耦合 | 松耦合 |
| 推荐 | 真正的"是一种"关系 | **优先使用**（Effective Java Item 18）|

### 1.3 多态（Polymorphism）
- **编译时多态**：方法重载（Overload）— 参数列表不同
- **运行时多态**：方法重写（Override）— 父类引用指向子类对象，运行时根据实际类型调用

```java
Animal a = new Dog();  // 编译看左边（Animal），运行看右边（Dog）
a.eat();               // 调用 Dog.eat()
```

- 多态三个条件：**继承 + 重写 + 父类引用指向子类对象**

### 1.4 抽象（Abstraction）
- `abstract class`：可有构造方法、成员变量、具体方法，不能实例化
- `interface`：JDK 8+ 可有 `default`/`static` 方法；JDK 9+ 可有 `private` 方法

| 对比 | 抽象类 | 接口 |
|------|--------|------|
| 继承 | 单继承 | 多实现 |
| 构造方法 | ✅ 有 | ❌ 无 |
| 成员变量 | 任意 | 默认 `public static final` |
| 设计语义 | "是什么" | "能做什么" |

### 1.5 面试标准答法
> 封装隐藏实现细节、继承实现代码复用（单继承 + 多实现）、多态通过方法重写实现运行时绑定（编译看左边运行看右边）、抽象通过抽象类和接口定义契约。优先组合而非继承，接口用于定义能力。

---

## 二、String / StringBuilder / StringBuffer ⭐⭐⭐

### 2.1 String 不可变原理
```java
public final class String {
    // JDK 8: private final char[] value;
    // JDK 9+: private final byte[] value; + coder (Latin1/UTF16)
}
```
- `final` 类不可继承；`final char[]` / `final byte[]` 引用不可变；无对外修改方法
- **好处**：线程安全、可缓存 hashCode、字符串常量池复用

### 2.2 字符串常量池
```java
String s1 = "abc";           // 常量池
String s2 = new String("abc"); // 堆对象 + 常量池（如果没有的话）
String s3 = s2.intern();     // 返回常量池引用

s1 == s2;       // false（堆 vs 池）
s1 == s3;       // true（都指向常量池）
```
- `new String("abc")` 创建 **1~2 个对象**：堆上新对象 + 常量池（如果还没有）

### 2.3 三者对比

| | String | StringBuilder | StringBuffer |
|--|--------|--------------|-------------|
| 可变 | ❌ 不可变 | ✅ 可变 | ✅ 可变 |
| 线程安全 | ✅（不可变即安全） | ❌ | ✅（synchronized） |
| 性能 | 拼接产生大量中间对象 | **最快** | 较快（锁开销） |
| 场景 | 少量操作 | 单线程拼接 | 多线程拼接 |

- JDK 5+ 编译器优化：`"a"+"b"` 自动用 `StringBuilder`
- JDK 9+ Indify String Concatenation：`invokedynamic` 进一步优化

### 2.4 面试标准答法
> String 不可变（final类 + final字节数组 + 无修改方法），线程安全且可缓存hashCode。StringBuilder 可变非线程安全，性能最优；StringBuffer 加 synchronized 线程安全。字符串拼接单线程用 StringBuilder，JDK9+ 编译器已自动优化。

---

## 三、equals 与 hashCode ⭐⭐⭐

### 3.1 契约规则
1. **重写 `equals` 必须重写 `hashCode`**
2. `equals` 相等 → `hashCode` 必须相等
3. `hashCode` 相等 → `equals` 不一定相等（哈希碰撞）

### 3.2 == vs equals
| | == | equals |
|--|-----|--------|
| 基本类型 | 比较值 | 不适用 |
| 引用类型 | 比较地址 | 默认比较地址，可重写为内容比较 |

### 3.3 与 HashMap 的关系
```
put(key, value)
  → key.hashCode() 确定桶位
  → 遍历链表/红黑树，key.equals() 判断是否同一个key
  → 若只重写 equals 不重写 hashCode：同一逻辑key可能进入不同桶，导致 get 找不到
```

### 3.4 标准重写模板
```java
@Override
public boolean equals(Object o) {
    if (this == o) return true;
    if (o == null || getClass() != o.getClass()) return false;
    User user = (User) o;
    return Objects.equals(id, user.id) && Objects.equals(name, user.name);
}

@Override
public int hashCode() {
    return Objects.hash(id, name);
}
```

### 3.5 面试标准答法
> 重写 equals 必须同时重写 hashCode，保证 equals 相等的对象 hashCode 也相等，否则 HashMap 无法正确工作。== 比较地址，equals 可重写为内容比较。推荐用 Objects.equals() 和 Objects.hash() 简化实现。

---

## 四、异常体系 ⭐⭐

### 4.1 异常层次
```
Throwable
├── Error（不可恢复：OOM、StackOverflowError）
└── Exception
    ├── RuntimeException（Unchecked，运行时异常）
    │   ├── NullPointerException
    │   ├── IndexOutOfBoundsException
    │   ├── ClassCastException
    │   └── IllegalArgumentException
    └── 其他 Exception（Checked，编译时强制处理）
        ├── IOException
        ├── SQLException
        └── ClassNotFoundException
```

### 4.2 Checked vs Unchecked

| | Checked | Unchecked |
|--|---------|-----------|
| 编译检查 | ✅ 必须 try-catch 或 throws | ❌ 不强制 |
| 典型 | IOException, SQLException | NullPointerException |
| 设计理念 | 可恢复的异常 | 编程错误 |

### 4.3 try-with-resources（JDK 7+）
```java
// 自动关闭实现 AutoCloseable 的资源
try (InputStream is = new FileInputStream("file");
     BufferedReader br = new BufferedReader(new InputStreamReader(is))) {
    // 使用资源
} catch (IOException e) {
    // 处理异常，suppressed exceptions 自动收集
}
```
- 替代 try-finally，避免 finally 里再抛异常覆盖原异常
- 多个资源按声明**逆序**关闭

### 4.4 finally 执行问题
```java
// finally 一定执行吗？
// 不一定：System.exit()、线程被kill、死循环、JVM crash
// finally 中 return 会覆盖 try 中的 return（避免这样写！）
```

### 4.5 面试标准答法
> Throwable 分 Error（不可恢复）和 Exception（可处理）。Exception 分 Checked（编译检查，如 IOException）和 Unchecked（运行时，如 NPE）。JDK7+ 用 try-with-resources 自动关闭资源。finally 几乎一定执行，但 System.exit() 等特殊情况除外，避免在 finally 中 return。

---

## 五、泛型 ⭐⭐

### 5.1 类型擦除
- 编译期检查类型安全，**编译后泛型信息被擦除**为 Object（或上界）
- 运行时 `List<String>` 和 `List<Integer>` 是同一个类

```java
List<String> list = new ArrayList<>();
list.getClass() == ArrayList.class; // true，泛型被擦除
```

### 5.2 通配符

| 通配符 | 含义 | 读/写 |
|--------|------|-------|
| `<?>` | 无界通配符 | 只读（取出为 Object） |
| `<? extends T>` | 上界通配符（生产者）| 只读（取出为 T） |
| `<? super T>` | 下界通配符（消费者）| 可写入 T 及其子类 |

### 5.3 PECS 原则
> **Producer Extends, Consumer Super**

```java
// 从集合读取 → extends（生产数据给你）
public void printAll(List<? extends Number> list) { ... }

// 向集合写入 → super（消费你给的数据）
public void addIntegers(List<? super Integer> list) {
    list.add(1);
    list.add(2);
}
```

### 5.4 面试标准答法
> Java 泛型通过类型擦除实现，编译期检查类型安全，运行时泛型信息被擦除。通配符分三种：无界 `<?>`、上界 `<? extends T>` 用于读取、下界 `<? super T>` 用于写入，遵循 PECS 原则。

---

## 六、反射 ⭐⭐⭐

### 6.1 获取 Class 对象
```java
// 三种方式
Class<?> c1 = User.class;                  // 类字面量
Class<?> c2 = user.getClass();             // 实例方法
Class<?> c3 = Class.forName("com.User");   // 全限定名（触发类加载）
```

### 6.2 核心操作
```java
// 创建实例
Object obj = clazz.getDeclaredConstructor().newInstance();

// 获取并调用方法
Method method = clazz.getDeclaredMethod("setName", String.class);
method.setAccessible(true);   // 突破 private
method.invoke(obj, "test");

// 获取并修改字段
Field field = clazz.getDeclaredField("name");
field.setAccessible(true);
field.set(obj, "value");
```

### 6.3 反射的应用场景
- **Spring IOC**：通过反射创建 Bean、注入依赖
- **MyBatis**：`MapperProxy` 动态代理 + 反射调用
- **JDK 动态代理**：`InvocationHandler.invoke()` 内部使用反射
- **Jackson/Gson**：反射读写字段进行 JSON 序列化

### 6.4 性能优化
| 优化手段 | 说明 |
|---------|------|
| 缓存 Method/Field | 避免重复 `getDeclaredMethod` |
| `setAccessible(true)` | 跳过安全检查，提升 ~4x |
| MethodHandle（JDK 7+）| 比反射更快，类似函数指针 |
| 代码生成（CGLib/ASM）| 编译期/运行时生成字节码，接近直接调用 |

### 6.5 面试标准答法
> 反射是 Java 运行时动态获取类信息和操作对象的机制。通过 `Class.forName()` / `.class` / `getClass()` 获取 Class 对象，可动态创建实例、调用方法、修改字段。Spring IOC、MyBatis Mapper、JDK 动态代理都依赖反射。性能优化可缓存 Method/Field、用 MethodHandle 或代码生成替代。

---

## 七、注解 ⭐⭐

### 7.1 元注解

| 元注解 | 作用 |
|--------|------|
| `@Target` | 注解可用于哪些元素（TYPE/METHOD/FIELD 等） |
| `@Retention` | 保留策略：SOURCE / CLASS / **RUNTIME**（反射可读） |
| `@Documented` | 包含在 Javadoc 中 |
| `@Inherited` | 允许子类继承父类注解 |
| `@Repeatable`（JDK 8）| 允许重复标注 |

### 7.2 自定义注解 + 运行时处理
```java
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface RateLimit {
    int qps() default 100;
    String key() default "";
}

// AOP 切面处理
@Around("@annotation(rateLimit)")
public Object around(ProceedingJoinPoint pjp, RateLimit rateLimit) throws Throwable {
    if (!limiter.tryAcquire(rateLimit.qps())) {
        throw new RateLimitException("限流");
    }
    return pjp.proceed();
}
```

### 7.3 Spring 常用注解原理
| 注解 | 原理 |
|------|------|
| `@Component` | `ClassPathBeanDefinitionScanner` 扫描 → 注册 BeanDefinition |
| `@Autowired` | `AutowiredAnnotationBeanPostProcessor` 在 Bean 初始化时注入 |
| `@Transactional` | AOP 代理 + `TransactionInterceptor` 拦截 |
| `@Value` | `PropertySourcesPlaceholderConfigurer` 解析占位符 |

### 7.4 面试标准答法
> 注解本质是接口，通过元注解控制保留策略和使用范围。`@Retention(RUNTIME)` 的注解可被反射读取。Spring 通过注解 + 反射 + AOP 实现 IOC 容器（`@Component` 扫描注册）、依赖注入（`@Autowired`）和声明式事务（`@Transactional`）。

---

## 八、序列化 ⭐⭐

### 8.1 Java 原生序列化
```java
// 实现 Serializable 接口（标记接口，无方法）
public class User implements Serializable {
    private static final long serialVersionUID = 1L; // 版本号
    private String name;
    private transient String password; // transient 不参与序列化
}
```
- `serialVersionUID` 不一致 → `InvalidClassException`
- **安全风险**：反序列化可构造任意对象（反序列化漏洞），生产环境**避免使用**

### 8.2 主流序列化方案对比

| 方案 | 格式 | 大小 | 速度 | 跨语言 | 场景 |
|------|------|------|------|--------|------|
| Java Serializable | 二进制 | 大 | 慢 | ❌ | 不推荐 |
| JSON（Jackson/Gson）| 文本 | 中 | 中 | ✅ | REST API |
| **Protobuf** | 二进制 | **小** | **快** | ✅ | RPC/存储 |
| Hessian | 二进制 | 中 | 快 | ✅ | Dubbo默认 |
| Kryo | 二进制 | 小 | 极快 | ❌ | 本地缓存/Spark |

### 8.3 Protobuf 为什么快
- **Varint 编码**：小数字用更少字节
- **Tag-Length-Value**：无字段名，用数字编号
- **预编译**：`.proto` 文件生成序列化代码，无反射开销

### 8.4 面试标准答法
> Java 原生序列化性能差且有安全风险，生产环境用 JSON（REST API）或 Protobuf（RPC/高性能场景）。Protobuf 用 Varint + TLV 编码、预编译生成代码，体积最小速度最快。transient 字段不参与序列化，serialVersionUID 用于版本兼容校验。

---

## 九、Java 内存模型 (JMM) ⭐⭐⭐

### 9.1 主内存与工作内存
```
线程A工作内存  ←→  主内存（堆中共享变量）  ←→  线程B工作内存
     ↑ read/load                              write/store ↑
```
- 每个线程有自己的**工作内存**（CPU缓存的抽象），从主内存拷贝变量副本
- 操作变量时在工作内存进行，完成后写回主内存

### 9.2 三大特性

| 特性 | 含义 | 保证手段 |
|------|------|---------|
| **原子性** | 操作不可分割 | synchronized / Lock / CAS |
| **可见性** | 一个线程的修改对其他线程立即可见 | volatile / synchronized / final |
| **有序性** | 不被指令重排打乱 | volatile（禁止重排）/ happens-before |

### 9.3 happens-before 核心规则
1. **程序顺序**：同一线程内前面操作 happens-before 后面操作
2. **锁规则**：unlock happens-before 后续对同一锁的 lock
3. **volatile 规则**：volatile 写 happens-before 后续对同一变量的读
4. **线程启动**：`thread.start()` happens-before 线程内任何操作
5. **传递性**：A hb B，B hb C → A hb C

### 9.4 volatile 与 synchronized 区别

| | volatile | synchronized |
|--|----------|-------------|
| 原子性 | ❌（仅单次读/写） | ✅ |
| 可见性 | ✅ | ✅ |
| 有序性 | ✅（禁止重排） | ✅（临界区内可重排但结果等价） |
| 阻塞 | ❌ | ✅ |
| 场景 | 状态标志、DCL | 复合操作 |

> 详细并发知识请参考 → [并发编程.md](并发编程.md)

### 9.5 面试标准答法
> JMM 定义了线程如何与主内存交互。每个线程有工作内存（CPU缓存抽象），操作共享变量需从主内存读取、修改后写回。三大特性：原子性（synchronized/CAS）、可见性（volatile/synchronized）、有序性（volatile禁止重排）。happens-before 是 JMM 的核心，定义了操作间的可见性保证。

---

## 十、面试速查表

| 考点 | 核心答案 | 追问 |
|------|---------|------|
| OOP四大特性 | 封装/继承/多态/抽象；多态三条件 | 组合 vs 继承？接口 vs 抽象类？ |
| String不可变 | final类 + final byte[] + 无修改方法 | 常量池原理？intern()？JDK9变化？ |
| equals & hashCode | 重写equals必须重写hashCode | HashMap为什么依赖这个契约？ |
| 异常体系 | Checked vs Unchecked；try-with-resources | finally一定执行吗？ |
| 泛型 | 类型擦除；PECS原则 | 为什么不能 new T()？桥方法？ |
| 反射 | Class.forName/getClass/.class | Spring哪里用了反射？性能优化？ |
| 注解 | 元注解；@Retention(RUNTIME)反射可读 | Spring注解原理？自定义注解？ |
| 序列化 | Protobuf > JSON > Java原生 | transient？serialVersionUID？ |
| JMM | 主内存+工作内存；三大特性 | volatile vs synchronized？DCL？ |
| 值传递 | Java **只有值传递**；引用类型传的是引用的副本 | 为什么 swap(a,b) 不生效？ |

---

## 常见追问

### Q: Java 是值传递还是引用传递？
> **只有值传递**。基本类型传值的副本；引用类型传引用地址的副本。方法内重新赋值引用不影响调用方。

### Q: final 关键字的三种用法？
> - `final 变量`：常量，只能赋值一次（引用不可变，内容可变）
> - `final 方法`：不能被子类重写
> - `final 类`：不能被继承（如 String、Integer）

### Q: static 关键字作用？
> - `static 变量`：类变量，所有实例共享
> - `static 方法`：类方法，不能访问 this/非静态成员
> - `static 代码块`：类加载时执行一次
> - `static 内部类`：不持有外部类引用，避免内存泄漏

### Q: 接口和抽象类如何选择？
> 定义能力/行为契约用接口（多实现）；有共享状态和默认实现用抽象类（单继承）。JDK 8+ 接口有 default 方法后，优先用接口。
