# JVM 知识点

> 最后更新：2026年3月5日

---

## 一、JVM 内存模型 ⭐⭐⭐

### 1.1 内存区域划分

| 区域 | 线程 | 存储内容 | OOM |
|------|------|---------|-----|
| 程序计数器 | 私有 | 当前字节码行号 | ❌ 不会OOM |
| 虚拟机栈 | 私有 | 栈帧（局部变量、操作数栈等） | ✅ SOF/OOM |
| 本地方法栈 | 私有 | native方法栈帧 | ✅ |
| **堆** | 共享 | 对象实例 | ✅ heap space |
| **方法区/元空间** | 共享 | 类信息、常量、静态变量 | ✅ Metaspace |

### 1.2 堆的分代结构
```
堆
├── 新生代（1/3）
│     ├── Eden（8/10）
│     ├── S0（1/10）
│     └── S1（1/10）
└── 老年代（2/3）
```
- Eden:S0:S1 = 8:1:1，大部分对象朝生夕死，S区1/10足够

### 1.3 方法区演变
- **JDK7**：永久代（PermGen），在堆中，`-XX:MaxPermSize` 限制，易OOM
- **JDK8**：元空间（Metaspace），移到**本地内存**，`-XX:MaxMetaspaceSize` 限制
- **JDK7起**：字符串常量池移到**堆**中

> 废弃永久代原因：大小难预估易OOM；本地内存只受物理内存限制；为HotSpot与JRockit合并铺路

### 1.4 对象创建过程
```
① 检查类是否已加载 → ② 分配内存 → ③ 零值初始化 → ④ 设置对象头 → ⑤ 执行构造函数
```
- 内存分配：内存规整用**指针碰撞**；不规整用**空闲列表**（CMS用此方式）

### 1.5 对象内存布局

```
┌───────────────────────────────────────────────────────┐
│                    对象（Object）                       │
├─────────────────────────────────────┬─────────────────┤
│            对象头（Header）          │                 │
│  ┌──────────────┬────────────────┐  │  实例数据       │
│  │  Mark Word   │  类型指针       │  │ (Instance Data) │
│  │  (8 bytes)   │ (4/8 bytes)    │  │                 │
│  └──────────────┴────────────────┘  │                 │
│  数组还有4字节数组长度               │                 │
├─────────────────────────────────────┼─────────────────┤
│                                     │  对齐填充        │
│                                     │ (8字节整数倍)    │
└─────────────────────────────────────┴─────────────────┘
```

#### Mark Word 详解（64位 JVM）⭐⭐⭐

Mark Word 存储对象运行时数据，**随锁状态变化而复用空间**：

```
┌──────────────────────────────────────────────────────────────────┐
│                        Mark Word (64 bits)                       │
├──────────┬───────────────────────────────────────────────────────┤
│ 锁状态    │ 64位内容                                              │
├──────────┼──────────┬──────────┬────────┬──────┬────────────────┤
│ 无锁      │ unused:25│hashcode:31│unused:1│age:4 │ biased:0│ 01  │
├──────────┼──────────┴──────────┼────────┼──────┼────────────────┤
│ 偏向锁    │ threadId:54        │epoch:2 │age:4 │ biased:1│ 01  │
├──────────┼─────────────────────┴────────┴──────┴────────────────┤
│ 轻量级锁  │ 指向栈中锁记录（Lock Record）的指针:62          │ 00  │
├──────────┼──────────────────────────────────────────────────────┤
│ 重量级锁  │ 指向 Monitor 对象的指针:62                      │ 10  │
├──────────┼──────────────────────────────────────────────────────┤
│ GC标记    │ 空（CMS用）                                    │ 11  │
└──────────┴──────────────────────────────────────────────────────┘

关键字段：
- hashcode：调用 hashCode() 后才写入（调用后偏向锁无法使用）
- age：GC 分代年龄（4位最大15，这就是 MaxTenuringThreshold 默认15的原因）
- biased：是否偏向锁
- 末2位：锁标志位（01无锁/偏向，00轻量，10重量，11 GC）
```

> **面试高频**：为什么 `MaxTenuringThreshold` 最大只能是 15？因为 Mark Word 中分代年龄 age 只有 **4 位**，最大值 $2^4 - 1 = 15$。

#### 对象访问定位

```
Java 栈中的 reference 如何定位到堆中的对象？

方式一：句柄访问（间接）
  reference → 句柄池 → [对象实例指针 + 类型数据指针]
  优点：对象移动时只改句柄，reference 不变（GC 友好）

方式二：直接指针（HotSpot 采用）
  reference → 对象实例（对象头中包含类型指针）
  优点：少一次指针定位，访问速度更快
```

### 1.6 TLAB（线程本地分配缓冲区）

```
问题：多线程同时在 Eden 区分配对象，指针碰撞需要 CAS 或加锁，性能低
方案：每个线程在 Eden 预分配一小块私有空间（TLAB），分配对象先在 TLAB 中

           Eden 区
┌────┬────┬────┬────┬───────────┐
│TLAB│TLAB│TLAB│TLAB│  空闲空间  │
│ T1 │ T2 │ T3 │ T4 │           │
└────┴────┴────┴────┴───────────┘

- TLAB 默认开启（-XX:+UseTLAB），大小约 Eden 的 1%
- TLAB 内分配无需同步（线程私有），TLAB 满了才需 CAS 分配新 TLAB
- 大对象超过 TLAB 剩余空间直接在 Eden 区 CAS 分配
```

### 1.7 直接内存（Direct Memory）

```
┌───────────────┐         ┌───────────────┐
│   JVM 堆内存   │         │   直接内存      │
│ (HeapBuffer)  │         │(DirectBuffer) │
│               │   I/O   │               │
│  堆buffer ─────────→ 内核buffer ──→ 磁盘/网络
│  (需要一次拷贝) │         │  (零拷贝)       │
└───────────────┘         └───────────────┘
```

- 通过 `ByteBuffer.allocateDirect()` 分配，不受 GC 管理
- **优势**：减少一次内存拷贝（零拷贝），I/O 性能高（Netty 大量使用）
- **风险**：不受 `-Xmx` 限制，由 `-XX:MaxDirectMemorySize` 控制，忘记释放会 OOM
- **释放**：依赖 `Cleaner`（虚引用机制），Full GC 时触发，也可手动 `((DirectBuffer) buf).cleaner().clean()`

### 1.8 逃逸分析与 JIT 优化 ⭐⭐⭐

```
逃逸分析：JIT 编译器分析对象的动态作用域，判断对象是否"逃逸"出方法或线程

逃逸级别：
  ① 不逃逸：对象只在方法内使用
  ② 方法逃逸：对象通过返回值/参数传递到外部方法
  ③ 线程逃逸：对象被其他线程访问（如赋给共享变量）
```

**三大优化（仅对 不逃逸/方法逃逸 的对象）：**

| 优化 | 说明 | 示例 |
|------|------|------|
| **栈上分配** | 对象在栈帧中分配，方法结束自动回收，不进堆 | 方法内创建的临时对象 |
| **标量替换** | 把对象拆成基本类型变量，直接在栈/寄存器 | `Point p = new Point(x,y)` → 变量 `x`, `y` |
| **锁消除** | JIT 发现锁对象不逃逸，消除同步 | 方法内 `new StringBuffer().append()` 本应有锁 |

```java
// 逃逸分析示例
public void test() {
    // p 不逃逸：只在方法内使用，JIT 可能做标量替换/栈上分配
    Point p = new Point(1, 2);
    System.out.println(p.x + p.y);
}

// 标量替换后等价于：
public void test() {
    int x = 1, y = 2;  // 不创建 Point 对象，直接用基本类型
    System.out.println(x + y);
}
```

```bash
# 相关 JVM 参数
-XX:+DoEscapeAnalysis      # 开启逃逸分析（JDK8 默认开启）
-XX:+EliminateAllocations  # 开启标量替换
-XX:+EliminateLocks        # 开启锁消除
```

> **面试答法**：逃逸分析是 JIT 编译器的优化手段，分析对象是否逃逸出方法/线程，对不逃逸的对象可以做**栈上分配**（减少 GC 压力）、**标量替换**（拆成基本类型）、**锁消除**（去掉无意义的同步），JDK8 默认开启。实际 HotSpot 主要做标量替换而非严格的栈上分配。

### 1.9 面试标准答法
> JVM内存分线程私有（程序计数器、虚拟机栈、本地方法栈）和线程共享（堆、方法区）。
> 堆分新生代（Eden+S0+S1=8:1:1）和老年代；JDK8方法区改为元空间用本地内存，字符串常量池在堆中。
> 程序计数器是唯一不会OOM的区域。对象头 Mark Word 随锁状态复用空间，分代年龄 4 位（最大 15）。
> TLAB 为每个线程在 Eden 预分配私有空间减少 CAS 竞争；逃逸分析可对不逃逸对象做栈上分配/标量替换/锁消除。

### 1.10 常见追问
| 追问 | 关键答点 |
|------|----------|
| 堆和栈的区别？ | 堆共享存对象/GC管理；栈私有存方法调用/自动回收 |
| 字符串常量池在哪？ | JDK6永久代，JDK7+堆中 |
| 元空间会OOM吗？ | 会，类加载过多耗尽本地内存 |
| Eden:S0:S1为什么8:1:1？ | 大部分对象朝生夕死，S区1/10足够存活对象，浪费最小 |
| 为什么MaxTenuringThreshold最大15？ | Mark Word 中 age 字段只有4位，$2^4 - 1 = 15$ |
| TLAB 是什么？作用？ | 线程私有的 Eden 小区域，避免多线程分配对象的 CAS 竞争 |
| 什么是逃逸分析？ | JIT 判断对象是否逃逸出方法，不逃逸可栈上分配/标量替换/锁消除 |
| 直接内存和堆内存区别？ | 直接内存在堆外由 OS 管理，零拷贝 I/O 性能好但需手动管理 |

---

## 二、类加载机制 & 双亲委派 ⭐⭐⭐

### 2.1 类的生命周期
```
加载 → 验证 → 准备 → 解析 → 初始化 → 使用 → 卸载
       ←────── 链接 ──────→
```
| 阶段 | 做什么 |
|------|--------|
| 加载 | 读取.class字节码，生成Class对象 |
| 验证 | 校验字节码合法性 |
| 准备 | 静态变量赋**默认零值**（int=0, 引用=null） |
| 解析 | 符号引用→直接引用 |
| 初始化 | 执行`<clinit>`，赋程序定义值，执行静态代码块 |

> ⚠️ `static int x=10`：准备阶段 x=0，初始化阶段 x=10

### 2.2 类加载器层次
```
Bootstrap ClassLoader   → 加载 rt.jar（C++实现）
    ↑
Extension ClassLoader   → 加载 ext/*.jar
    ↑
Application ClassLoader → 加载 classpath（我们写的代码）
    ↑
Custom ClassLoader      → 用户自定义
```

### 2.3 双亲委派流程
```
loadClass("xxx")
  → 查缓存（已加载直接返回）
  → 委派父加载器（递归向上）
  → 父找不到，自己 findClass()
```
**好处**：防止核心类被篡改（安全）、避免重复加载、保证类唯一性

### 2.4 打破双亲委派的场景
| 场景 | 方式 | 原因 |
|------|------|------|
| JDBC/SPI | 线程上下文类加载器 | Bootstrap无法加载classpath中的实现类 |
| Tomcat | 每个WebApp独立ClassLoader | 多应用类隔离，不同版本共存 |
| 热部署/OSGi | 自定义ClassLoader重新加载 | 动态替换已加载的类 |

### 2.5 面试标准答法
> 类加载分5阶段，准备赋零值，初始化才赋程序值。
> 双亲委派：加载时先委派父加载器，找不到再自己加载，保证核心类安全唯一。
> JDBC用线程上下文类加载器打破双亲委派；Tomcat用独立ClassLoader实现类隔离。
> 判断两个类是否相同：类名+类加载器，同名被不同加载器加载是两个不同的类。

### 2.6 常见追问
| 追问 | 关键答点 |
|------|----------|
| 自定义类加载器怎么实现？ | 继承ClassLoader，重写findClass()，不要重写loadClass() |
| Class.forName vs ClassLoader.loadClass？ | forName执行初始化（静态块）；loadClass只加载不初始化 |
| 如何实现热加载？ | 新ClassLoader加载新版本类，GC掉旧ClassLoader |

---

## 三、GC 算法 ⭐⭐⭐

### 3.1 如何判断对象可被回收

**① 引用计数法（JVM 不用）**
```
每个对象维护一个引用计数器，引用+1 释放-1，为0则可回收
致命缺陷：循环引用无法回收
  A.ref = B;  B.ref = A;  → A、B 计数都是1，永远回收不了
```

**② 可达性分析（JVM 采用）**
```
从 GC Roots 出发，沿引用链向下搜索，不可达的对象即为可回收

           GC Roots
          /    |    \
         A     B     C ← 可达，存活
         |
         D
                     E ← 不可达，可被回收（即使 E→F 相互引用）
                     |
                     F
```

**GC Roots 包括（⭐必背）：**

| GC Root | 说明 |
|---------|------|
| 虚拟机栈局部变量 | 方法正在执行时，栈帧中引用的对象 |
| 方法区静态变量 | `static Object obj` |
| 方法区常量引用 | `static final` 引用的对象 |
| 本地方法栈 JNI 引用 | native 方法引用的对象 |
| 同步锁持有的对象 | `synchronized(obj)` 中的 obj |
| JVM 内部引用 | ClassLoader、基本类型 Class、异常对象等 |

**对象的两次标记过程：**
```
第一次标记：可达性分析后不可达的对象被第一次标记
         ↓
筛选：是否有必要执行 finalize()？
  - 没有重写 finalize() 或已执行过 → 直接回收
  - 有重写且未执行过 → 放入 F-Queue
         ↓
第二次标记：Finalizer 线程执行 finalize()
  - 如果在 finalize() 中重新与 GC Root 建立引用 → 移出回收集
  - 否则 → 正式回收

⚠️ finalize() 只会被执行一次，不推荐使用（不确定性大、性能差）
   推荐用 try-with-resources 或 Cleaner（JDK9+）
```

### 3.2 四种引用类型
| 引用类型 | 回收时机 | 典型场景 |
|---------|---------|----------|
| 强引用 | 永不回收 | Object o = new Object() |
| 软引用 | 内存不足时 | 图片缓存 |
| 弱引用 | 下GC必回收 | ThreadLocalMap的key |
| 虚引用 | 任何时候 | 堆外内存管理 |

### 3.3 三大GC算法

#### ① 标记-清除（Mark-Sweep）

```
标记阶段：从 GC Roots 遍历标记所有存活对象
清除阶段：遍历堆，回收未标记对象

 标记前   │ A │ ▓ │ B │ ▓ │ C │ ▓ │ D │    ▓=垃圾
 清除后   │ A │   │ B │   │ C │   │ D │    ▓清除变成空闲
                ↑       ↑       ↑
              碎片!    碎片!    碎片!     → 内存碎片问题
```
- **优点**：简单，不需要移动对象
- **缺点**：① 产生大量内存碎片，大对象分配失败触发 Full GC ② 效率不稳定

#### ② 复制算法（Copying）

```
将内存分为两半，使用A区 → 存活对象复制到B区 → 清空整个A区

  使用中 A区           空闲 B区
│ A │ ▓ │ B │ ▓ │ C │ │            │
        ↓ 复制存活对象
│            │ │ A │ B │ C │        │
  清空 A区（回收）     紧凑排列无碎片
```
- **优点**：无碎片、分配只需移动指针、效率高
- **缺点**：浪费一半内存空间
- **新生代优化**：Eden:S0:S1=8:1:1，每次只浪费 10% 而非 50%

#### ③ 标记-整理（Mark-Compact）

```
标记阶段：同标记-清除
整理阶段：将存活对象向内存一端移动，清理边界外的内存

 标记前  │ A │ ▓ │ B │ ▓ │ C │ ▓ │ D │
 整理后  │ A │ B │ C │ D │            │
                         ↑
                     边界指针后面全部清理
```
- **优点**：无碎片、不浪费空间
- **缺点**：移动对象需更新引用，STW 时间长
- **适用**：老年代（对象存活率高，复制算法效率低）

### 3.4 GC 的分类 ⭐⭐⭐

> 面试经常问"Minor GC、Major GC、Full GC 有什么区别？分别在什么时候触发？"

#### 五种 GC 类型

| GC 类型 | 回收范围 | 触发条件 | 停顿时间 | 别名 |
|---------|---------|---------|---------|------|
| **Minor GC** | 新生代（Eden + S0/S1） | Eden 区满 | 短（ms~几十ms） | Young GC |
| **Major GC** | 老年代 | 老年代空间不足（部分收集器单独触发） | 较长 | Old GC |
| **Full GC** | **整个堆 + 方法区（元空间）** | 见下方触发条件 | **最长**（秒级） | — |
| **Mixed GC** | 新生代 + 部分老年代 Region | G1 专有，并发标记完成后 | 可控（MaxGCPauseMillis） | — |
| **Concurrent GC** | 与用户线程并发的标记/清除/迁移 | CMS/G1/ZGC 的并发阶段 | 极短 STW + 并发 | — |

> ⚠️ **Major GC vs Full GC**：很多资料混用，严格来说 Major GC 仅指老年代收集，Full GC 包含整个堆+方法区。实际面试中一般认为 Major GC ≈ Full GC，但最好说清范围。

#### Full GC 触发条件（⭐必背）

```
① 老年代空间不足
   → 大对象直接进老年代 / 晋升对象太多 / 老年代碎片化
   
② 空间分配担保失败
   → Minor GC 前检查：老年代可用空间 < 历次晋升平均大小 → 触发 Full GC
   
③ 方法区（元空间）不足
   → 类加载过多（动态代理 / 热部署）导致 Metaspace 满
   
④ 显式调用 System.gc()
   → 建议而非强制，可用 -XX:+DisableExplicitGC 禁止
   
⑤ CMS Concurrent Mode Failure
   → CMS 并发收集期间老年代空间不足，退化为 Serial Old Full GC
   
⑥ JDK8 之前永久代空间不足
   → JDK8 后改为元空间，此条对应 Metaspace OOM
```

#### 各 GC 类型执行过程对比

```
Minor GC（最频繁，速度快）：
  ① Eden 满 → 触发
  ② 扫描 GC Roots + 卡表（老年代→新生代引用）
  ③ 存活对象从 Eden + S0 复制到 S1（复制算法）
  ④ 年龄+1，超龄对象晋升老年代
  ⑤ 清空 Eden + S0，S0/S1 角色互换

Full GC（最慢，应尽量避免）：
  ① 回收新生代 + 老年代 + 方法区
  ② 通常使用标记-整理算法（整理老年代碎片）
  ③ 全程 STW，大堆时停顿可达数秒甚至数十秒
  ④ 不同收集器表现不同：
     - Serial Old：单线程标记-整理
     - Parallel Old：多线程标记-整理
     - G1 Full GC：JDK10 前单线程，JDK10+ 多线程
```

#### 如何减少 Full GC（⭐面试加分点）

| 策略 | 说明 |
|------|------|
| 合理设置堆大小 | Xms=Xmx 避免动态扩缩；新生代不宜太小（否则频繁晋升） |
| 避免大对象 | 大 byte[]、大 JSON 拆分处理；查询加分页 |
| 及时释放引用 | 避免静态集合无限增长、ThreadLocal 用完 remove |
| 选择合适的收集器 | G1/ZGC 比 CMS 更少触发 Full GC |
| 禁止 System.gc() | `-XX:+DisableExplicitGC`（注意：NIO DirectBuffer 依赖 System.gc 回收堆外内存） |
| 监控 GC 日志 | 关注 FGC 频率和老年代使用率，提前预警 |

---

### 3.5 分代收集

**为什么要分代？**
```
核心假设（弱分代假说）：绝大多数对象朝生夕死

如果不分代 → 每次 GC 都扫描整个堆 → 效率极低
分代后：
  新生代：存活率低 → 复制算法（只复制少量存活对象，速度快）
  老年代：存活率高 → 标记-整理/清除（避免大量复制开销）
```

- **新生代**：对象朝生夕死（存活率低），复制算法效率最高，触发条件：Eden满（Minor GC）
- **老年代**：对象存活率高，标记-整理/清除，触发条件：老年代满（Major GC / Full GC）

**对象晋升老年代条件（⭐面试重点）：**

| 条件 | 说明 |
|------|------|
| 年龄达到阈值 | 经过 Minor GC 后年龄+1，≥ `MaxTenuringThreshold`（默认15）晋升 |
| 大对象直接进老年代 | 超过 `-XX:PretenureSizeThreshold`（仅 Serial/ParNew 有效） |
| 动态年龄判断 | Survivor 中**相同年龄对象总大小 > S区一半**，≥该年龄的全部晋升 |
| 空间分配担保 | Minor GC 前检查老年代可用空间 < 历次晋升平均值 → 触发 Full GC |

```
Minor GC 过程（以 Eden + S0 → S1 为例）：
① Eden 满触发 Minor GC
② 存活对象从 Eden + S0 复制到 S1
③ 年龄+1，超龄的晋升到老年代
④ 清空 Eden + S0
⑤ S0 和 S1 角色互换
```

### 3.6 跨代引用与记忆集（Remembered Set）⭐⭐⭐

```
问题：Minor GC 只回收新生代，但老年代可能引用新生代对象
     如果扫描整个老年代找跨代引用 → 效率太低

解决：记忆集（Remembered Set）+ 卡表（Card Table）

老年代被划分为一个个 Card Page（通常 512 bytes）
Card Table 是一个字节数组，每个元素对应一个 Card Page
  0 = 该 Card 没有跨代引用（Clean）
  1 = 该 Card 存在跨代引用（Dirty）

┌──────┬──────┬──────┬──────┬──────┐
│Card 0│Card 1│Card 2│Card 3│Card 4│  ← 老年代
└──────┴──────┴──────┴──────┴──────┘
   0      1      0      1      0     ← Card Table（字节数组）
          ↑             ↑
        Dirty         Dirty → 只扫描这两个Card找跨代引用

写屏障（Write Barrier）：
  每次引用赋值时，JVM 插入一段代码检查是否产生跨代引用
  如果是 → 标记对应 Card 为 Dirty
```

### 3.7 安全点与安全区域

```
安全点（Safepoint）：
  GC 时需要 STW，但不能在任意位置暂停线程
  只有在安全点才能暂停（此时引用关系不会变化）
  
  安全点位置：方法调用、循环跳转（回边）、异常跳转
  
  让线程到达安全点的方式：
  - 抢先式中断（几乎不用）：先中断所有线程，未到安全点的恢复执行
  - 主动式中断：设置标志位，线程执行到安全点时主动检查标志并挂起

安全区域（Safe Region）：
  问题：Sleep/Blocked 的线程无法主动走到安全点
  方案：线程进入安全区域（引用不变的代码段）时标记自己
       GC 不需要等待安全区域内的线程
       线程离开安全区域时检查 GC 是否完成，未完成则等待
```

### 3.8 面试标准答法

> 判断对象是否可回收用**可达性分析**：从 GC Roots（栈局部变量、静态变量、常量、JNI 引用等）出发不可达即可回收。
> 三大算法：标记-清除有碎片问题；复制算法无碎片但浪费一半空间，新生代用 8:1:1 优化；标记-整理无碎片但要移动对象，适合老年代。
> 跨代引用通过卡表解决：老年代分 Card，写屏障标记 Dirty Card，Minor GC 只扫描 Dirty Card。
> GC 的 STW 依赖安全点机制，线程在安全点主动挂起。

---

## 四、垃圾收集器 ⭐⭐⭐⭐

### 4.1 各收集器对比

#### 新生代收集器

**Serial**

| 维度 | 说明 |
|------|------|
| 算法 | 复制 |
| 线程模型 | 单线程 STW |
| 特点 | 简单高效，无线程切换开销 |
| 搭配老年代 | Serial Old |
| 适用场景 | 客户端模式 / 堆 < 几百MB / 单核环境 |

**ParNew**

| 维度 | 说明 |
|------|------|
| 算法 | 复制 |
| 线程模型 | 多线程 STW |
| 特点 | Serial 的多线程版本 |
| 搭配老年代 | CMS、Serial Old |
| 适用场景 | 多核服务端 + CMS 组合（JDK8 常用） |

**Parallel Scavenge**

| 维度 | 说明 |
|------|------|
| 算法 | 复制 |
| 线程模型 | 多线程 STW |
| 特点 | **吞吐量优先**，自适应调节策略（`-XX:+UseAdaptiveSizePolicy`） |
| 搭配老年代 | Parallel Old |
| 适用场景 | 后台计算型任务（吞吐 > 延迟）/ JDK8 默认 |

#### 老年代收集器

**Serial Old**

| 维度 | 说明 |
|------|------|
| 算法 | 标记-整理 |
| 线程模型 | 单线程 STW |
| 特点 | Serial 的老年代版本；CMS 后备方案 |
| 搭配新生代 | Serial、ParNew |
| 适用场景 | 客户端模式 / CMS 发生 CMF 时退化使用 |

**Parallel Old**

| 维度 | 说明 |
|------|------|
| 算法 | 标记-整理 |
| 线程模型 | 多线程 STW |
| 特点 | Parallel Scavenge 的老年代搭档 |
| 搭配新生代 | Parallel Scavenge |
| 适用场景 | 吞吐量优先场景 / JDK8 默认组合 |

**CMS（Concurrent Mark Sweep）**

| 维度 | 说明 |
|------|------|
| 算法 | 标记-清除 |
| 线程模型 | 并发（4阶段） |
| 特点 | **最短停顿**，并发标记+并发清除；有碎片/浮动垃圾/CPU敏感三大缺点 |
| 搭配新生代 | ParNew、Serial |
| 适用场景 | 响应时间敏感的 Web 服务（JDK14 已移除） |

#### 全堆收集器（Region化）

**G1（Garbage First）**

| 维度 | 说明 |
|------|------|
| 算法 | 标记-整理 + 复制 |
| 作用范围 | 全堆（Region化） |
| 线程模型 | 并发 + STW |
| 分代策略 | **逻辑分代**：Region 动态扮演 Eden/Survivor/Old/Humongous，不物理连续 |
| 特点 | 可预测停顿（`MaxGCPauseMillis`）；Mixed GC 按回收价值优先 |
| 适用场景 | 堆 4G~几十G 的服务端应用 / JDK9+ 默认 |

**ZGC**

| 维度 | 说明 |
|------|------|
| 算法 | 染色指针 + 读屏障 |
| 作用范围 | 全堆（Region化） |
| 线程模型 | 几乎全并发 |
| 分代策略 | JDK21 前**不分代**；JDK21+ 引入**分代 ZGC**（默认开启） |
| 特点 | 停顿 **< 10ms** 且与堆大小无关；支持 TB 级堆 |
| 适用场景 | 超大堆 + 极低延迟（JDK15+ 生产可用） |

**Shenandoah**

| 维度 | 说明 |
|------|------|
| 算法 | 转发指针 + 读屏障 |
| 作用范围 | 全堆（Region化） |
| 线程模型 | 几乎全并发 |
| 分代策略 | **不分代** |
| 特点 | 与 ZGC 类似的低延迟目标；Red Hat 贡献，非 Oracle 官方 |
| 适用场景 | 低延迟替代方案（OpenJDK） |

#### 经典搭配组合

```
JDK8 默认：  Parallel Scavenge（新生代） + Parallel Old（老年代）  → 吞吐量优先
JDK8 低延迟：ParNew（新生代） + CMS（老年代）                     → 响应时间优先
JDK9+ 默认： G1（全堆）                                          → 兼顾吞吐和延迟
JDK15+ 可选：ZGC（全堆）                                         → 极低延迟（< 10ms）
```

> **面试tip**：被问"你们线上用什么收集器"时，JDK8 项目多数是默认 Parallel 或手动切 CMS/G1；JDK11+ 推荐 G1；对延迟极敏感（如交易系统）可选 ZGC。

### 4.2 三色标记算法 ⭐⭐⭐

> **三色标记**是并发GC（CMS、G1）在并发标记阶段的核心算法，用颜色表示对象的标记状态

#### 三种颜色含义
```
白色：尚未被GC访问到（初始状态），回收后仍为白色 → 可被回收
灰色：已被GC访问，但其引用的对象还未全部扫描完 → 处理中
黑色：已被GC访问，且其所有引用对象都已扫描完 → 存活，不会被回收
```

#### 标记流程
```
初始：所有对象都是白色
         ↓
初始标记（STW）：GC Roots 直接引用的对象标为灰色
         ↓
并发标记：
  取出灰色对象，扫描其引用
  → 引用的白色对象标为灰色
  → 自身标为黑色
         ↓
重复直到没有灰色对象
         ↓
剩余白色对象 → 回收
```

```
GC Roots → A(黑) → B(黑) → D(黑)
                 ↘ C(黑)
           E(白) ← 不可达，回收
```

---

#### ⚠️ 并发标记的两大问题

**问题一：浮动垃圾（Floating Garbage）**
```
并发标记时，用户线程把黑色对象B的引用切断
B → 变成垃圾，但已被标为黑色，本次GC不会回收
→ 只能等下次GC回收，这就是"浮动垃圾"
```
> 影响不大，下次GC会处理，CMS/G1都接受浮动垃圾

---

**问题二：对象消失（漏标）⭐⭐⭐**
> 这是致命问题！存活的对象被错误回收

```
漏标发生的条件（需同时满足）：
① 赋值器插入了一条从黑色对象到白色对象的新引用
② 赋值器删除了全部从灰色对象到该白色对象的直接/间接引用

示例：
初始状态：A(黑) → B(灰) → C(白)

并发标记过程中用户线程执行了：
  A.ref = C  （黑色A新增了对白色C的引用）
  B.ref = null （灰色B删除了对C的引用）

结果：
  B扫描完了，C不会再被扫描
  C是白色 → 被当成垃圾回收！但C其实还被A引用！→ 程序崩溃！
```

---

#### 两种解决方案

**方案一：增量更新（Incremental Update）—— CMS采用**
```
思路：记录黑色对象新增的引用
      重新标记阶段（STW）重新扫描这些黑色对象
      
实现：写屏障（Write Barrier）拦截赋值操作
      黑色对象新增引用时 → 将该黑色对象重新标为灰色
      重新标记阶段再次扫描
```

**方案二：原始快照（SATB，Snapshot At The Beginning）—— G1采用**
```
思路：记录灰色对象删除的引用
      保留删除前的引用关系快照，在重新标记阶段补充扫描

实现：写屏障拦截引用删除操作
      灰色对象删除引用时 → 将被删除的引用对象记录到SATB队列
      最终标记阶段（STW）扫描SATB队列中的对象
```

| | 增量更新（CMS） | SATB（G1） |
|--|---------------|-----------|
| 记录时机 | 黑色对象**新增**引用 | 灰色对象**删除**引用 |
| 重新扫描 | 重新标记阶段扫描黑色对象 | 最终标记阶段扫描SATB队列 |
| 精度 | 较保守（多扫描） | 较精准 |

---

### 4.3 ZGC 收集器详解 ⭐⭐⭐⭐

> ZGC（Z Garbage Collector）：Oracle 开发的**超低延迟**收集器，停顿时间 **< 10ms** 且与堆大小无关，支持 **TB 级堆**

#### ZGC 核心设计目标

```
① 停顿时间不超过 10ms（实际通常 < 1ms）
② 停顿时间不随堆大小增长而增长（8MB ~ 16TB 均可）
③ 对应用吞吐量的影响 < 15%
④ 为未来 GC 功能和优化奠定基础
```

#### ZGC 版本演进

| JDK 版本 | 状态 | 关键变化 |
|---------|------|---------|
| JDK 11 | 实验性 | 首次引入（`-XX:+UnlockExperimentalVMOptions -XX:+UseZGC`） |
| JDK 13 | 实验性 | 支持归还未使用内存给操作系统 |
| JDK 15 | **正式可用** | 转为生产就绪（`-XX:+UseZGC`） |
| JDK 16 | 优化 | 并发线程栈扫描，进一步降低停顿 |
| JDK 21 | **重大升级** | 引入**分代 ZGC**（默认开启），显著降低内存开销和 CPU 消耗 |

#### ZGC 内存布局（ZPage）

```
ZGC 不使用固定大小的 Region，而是使用三种不同大小的 ZPage：

┌──────────────────────────────────────────────────────────┐
│                     ZGC 堆内存                            │
│                                                          │
│  ┌──┐┌──┐┌──┐  Small ZPage（2MB）                       │
│  │S1││S2││S3│  存放 ≤ 256KB 的小对象                     │
│  └──┘└──┘└──┘                                            │
│                                                          │
│  ┌────────┐┌────────┐  Medium ZPage（32MB）              │
│  │   M1   ││   M2   │  存放 256KB ~ 4MB 的中等对象       │
│  └────────┘└────────┘                                    │
│                                                          │
│  ┌──────────────────┐  Large ZPage（N × 2MB，动态大小）  │
│  │       L1         │  存放 > 4MB 的大对象（一个Page一个对象）│
│  └──────────────────┘                                    │
└──────────────────────────────────────────────────────────┘

与 G1 的区别：
  G1：固定大小 Region（1~32MB），大对象占多个连续 Region
  ZGC：三种动态大小 ZPage，大对象用 Large ZPage 精确匹配
```

---

#### 染色指针（Colored Pointer）—— ZGC 核心技术 ⭐⭐⭐

> ZGC 将 GC 信息直接存在**对象引用指针的高位比特**中，无需访问对象本身即可获取 GC 状态

**64 位指针的利用**

```
64位指针（实际只用低42位寻址，高22位空闲）

 63    46 45  44  43  42  41                    0
┌───────┬────┬───┬───┬───┬──────────────────────┐
│ 空闲位 │ 标记位（4位）  │    对象实际地址（42位） │
└───────┴────┴───┴───┴───┴──────────────────────┘
          │    │    │
          │    │    └── Remapped：对象是否已迁移完成
          │    └─────── Marked1：标记位1
          └──────────── Marked0：标记位0
                        Finalizable：是否只有Finalizer引用

寻址限制：42 位地址 → 最大 4TB 堆
JDK 13+：扩展到 44 位 → 最大 16TB
```

**染色指针的三大优势**

| 优势 | 传统 GC（CMS/G1） | ZGC（染色指针） |
|------|-------------------|----------------|
| 获取 GC 状态 | 需访问对象头 Mark Word | 直接读指针高位比特，**零额外内存访问** |
| 对象迁移 | STW 阶段统一修复引用 | 读屏障 + 转发表，**并发迁移不 STW** |
| 引用修复 | 迁移完成后批量更新 | 指针自愈（Self-Healing），访问时自动修复 |

---

#### 读屏障（Load Barrier）—— 并发迁移的关键 ⭐⭐⭐

> CMS/G1 用**写屏障**拦截引用赋值；ZGC 用**读屏障**拦截引用读取

```
读屏障伪代码（每次从堆中加载对象引用时触发）：

Object load_barrier(Object* ref) {
    Object obj = *ref;
    if (obj 的颜色位不是当前 "good color") {
        // 指针需要修复（对象可能已迁移）
        obj = slow_path(ref, obj);  // 查转发表、修复指针
    }
    return obj;
}
```

```
并发迁移完整流程：

① ZGC 将对象从旧 ZPage 复制到新 ZPage
② 在转发表中记录：旧地址 → 新地址
③ 旧指针的 Remapped 位清零（标记为"待修复"）

④ 用户线程读取对象引用时触发读屏障：
   → 检测到颜色位不对（Remapped=0）
   → 查转发表获取新地址
   → 更新引用指针（指针自愈）
   → 后续访问不再触发 slow path

这就是"指针自愈（Self-Healing）"机制：
  第一次访问触发修复（略慢），后续访问直接命中（无开销）
  所有引用都由用户线程访问时"懒修复"，无需 STW 遍历修复
```

> **读屏障 vs 写屏障**：读屏障的频率远高于写屏障（读操作远多于写），所以 ZGC 的读屏障必须极其高效。JDK 使用条件判断 + 分支预测优化，热路径开销约 **4%** 吞吐损失。

---

#### ZGC 完整 GC 流程（10 个子阶段）

```
  用户线程  ── ⏸ ─────────────────────────── ⏸ ──────────────────────→
  GC线程                                                              
             ①    ②       ③      ④   ⑤    ⑥     ⑦     ⑧   ⑨   ⑩
            STW  并发    并发    STW  并发   并发   并发  STW  并发  并发
           极短                 极短                    极短
```

| 阶段 | 并发/STW | 说明 |
|------|---------|------|
| ① 初始标记 | **STW（极短）** | 标记 GC Roots 直接引用的对象，设置 Marked 位 |
| ② 并发标记 | 并发 | 遍历对象图，标记所有存活对象（读屏障辅助） |
| ③ 并发标记结束 | 并发 | 处理引用（软引用/弱引用/虚引用），计算最终存活对象 |
| ④ 再标记 | **STW（极短）** | 处理并发标记期间遗留的少量引用变更 |
| ⑤ 并发引用处理 | 并发 | 清理弱引用/虚引用, Finalizer 处理 |
| ⑥ 并发重置 Relocation Set | 并发 | 选择本次要回收的 ZPage 集合（垃圾最多的优先） |
| ⑦ 并发迁移准备 | 并发 | 初始化转发表（Forwarding Table） |
| ⑧ 初始迁移 | **STW（极短）** | 迁移 GC Roots 直接引用的对象（数量很少） |
| ⑨ 并发迁移 | 并发 | 将存活对象从回收集 ZPage 复制到新 ZPage |
| ⑩ 并发重映射 | 并发 | 修复堆中残留的旧引用（可与下轮标记合并） |

```
三次 STW 的耗时分析：
  ① 初始标记：只处理 GC Roots → 通常 < 1ms
  ④ 再标记：处理少量遗留引用 → 通常 < 1ms
  ⑧ 初始迁移：只迁移 Roots 直引用 → 通常 < 1ms
  
  总 STW：三次加起来通常 < 3ms，最坏情况 < 10ms
  与堆大小完全无关（100GB 堆和 1GB 堆停顿一样短）
```

> **ZGC 为什么停顿这么短？**
> 所有耗时操作（对象图遍历、对象迁移、引用修复）都在**并发阶段**完成，STW 只做极少量的根集处理。染色指针 + 读屏障使得对象迁移和引用修复无需 STW。

---

#### 分代 ZGC（JDK 21+）⭐⭐⭐

> JDK 21 引入分代 ZGC，是 ZGC 的重大升级，**默认开启**

```
为什么 ZGC 也要引入分代？

非分代 ZGC 的问题：
  ① 每次 GC 都扫描整个堆 → 大堆时并发标记阶段长，CPU 消耗大
  ② 短命对象和长命对象混在一起 → 回收效率不如分代高
  ③ 浮动垃圾更多 → 需要更大的堆预留空间

分代 ZGC 的改进：
  ① 分为年轻代和老年代（逻辑分代）
  ② 年轻代 GC 频率高、范围小 → 快速回收短命对象
  ③ 老年代 GC 频率低 → 减少不必要的全堆扫描
  ④ 整体 CPU 消耗降低 ~50%，内存开销降低 ~30%
```

```
分代 ZGC 的两代 GC 流程：

年轻代 GC：  
  只扫描年轻代 ZPage → 频繁触发 → 快速回收
  存活对象晋升到老年代

老年代 GC：  
  扫描老年代 ZPage → 低频触发 → 回收长命但已死亡的对象
  两代 GC 可以并行运行，互不阻塞
```

```bash
# JDK 21+ 分代 ZGC 配置
-XX:+UseZGC                     # 启用 ZGC（JDK 21 默认即分代模式）
-XX:+ZGenerational               # 显式开启分代（JDK 21 默认 true）
-XX:-ZGenerational                # 如需关闭分代，回退到非分代模式
```

---

#### ZGC 关键参数

```bash
# ===== 基础配置 =====
-XX:+UseZGC                         # 启用 ZGC
-Xms16g -Xmx16g                     # 堆大小（ZGC 建议 Xms=Xmx）
-XX:SoftMaxHeapSize=14g              # 软上限：尽量在此范围内 GC，减少内存占用

# ===== 并发线程 =====
-XX:ConcGCThreads=4                  # 并发 GC 线程数（默认 CPU/8，通常不需要调）
-XX:ParallelGCThreads=8              # STW 阶段 GC 线程数

# ===== 触发策略 =====
-XX:ZAllocationSpikeTolerance=2      # 分配速率容忍度（越高越早触发 GC）
-XX:ZCollectionInterval=0            # 定时 GC 间隔（0=禁用，秒为单位）

# ===== 内存归还 =====
-XX:ZUncommitDelay=300               # 内存归还给 OS 的延迟（秒）
-XX:+ZUncommit                       # 允许 ZGC 归还未使用内存（默认开启）

# ===== 大页支持（性能优化） =====
-XX:+UseLargePages                   # 使用大页内存（需 OS 配置）
-XX:+UseTransparentHugePages         # 使用透明大页（Linux 推荐）
```

#### ZGC 适用场景与局限

| 场景 | 是否适合 | 说明 |
|------|---------|------|
| 超大堆（16G+）+ 低延迟 | ✅ 非常适合 | ZGC 的主场，停顿 < 10ms |
| 交易系统 / 实时计算 | ✅ 适合 | 对延迟极度敏感的场景 |
| 中小堆（< 4G） | ⚠️ 不推荐 | G1 已足够好，ZGC 的读屏障开销反而不合算 |
| 极限吞吐量场景 | ⚠️ 不推荐 | 读屏障约 4% 吞吐损失，Parallel 更合适 |
| JDK 8 / JDK 11 项目 | ❌ 不可用 | JDK 15+ 才正式可用 |

---

#### 三色标记 vs 染色指针 对比

| 维度 | 三色标记 | 染色指针 |
|------|---------|---------|
| 标记存储位置 | 对象头 Mark Word | 引用指针高位比特 |
| 代表收集器 | CMS、G1 | ZGC |
| 屏障类型 | **写屏障**（拦截引用赋值） | **读屏障**（拦截引用加载） |
| 并发问题 | 漏标（增量更新 / SATB 解决） | 读屏障 + 转发表 + 指针自愈 |
| 对象迁移 | G1 需 STW 复制；CMS 不整理 | **并发迁移**，用户线程不暂停 |
| 停顿时间 | 数十ms ~ 数百ms | **< 10ms**（与堆大小无关） |
| 吞吐影响 | 写屏障开销 ~1% | 读屏障开销 ~4% |

#### ZGC vs G1 对比

| 维度 | G1 | ZGC |
|------|-----|-----|
| 停顿时间 | 目标可调（默认 200ms），实际数十~数百ms | **< 10ms**，与堆大小无关 |
| 最大堆 | 理论无限，实际 4G~几十G | **16TB**（JDK 13+） |
| 分代策略 | 逻辑分代（Region 扮演 E/S/O） | JDK21+ 分代；之前不分代 |
| 并发迁移 | STW 阶段复制存活对象 | **并发迁移**（读屏障 + 转发表） |
| 内存开销 | RSet 约占堆 10%~20% | 染色指针 + 转发表，开销较小 |
| 吞吐量 | 较好 | 略低（读屏障 ~4% 损失） |
| 碎片问题 | 无（Region 间复制） | 无（ZPage 间复制） |
| 成熟度 | 非常成熟（JDK9+ 默认） | 持续优化中（JDK15+ 可用） |
| JDK 要求 | JDK 8+（手动启用）/ JDK9+ 默认 | JDK 15+ 生产可用 |

### 4.4 CMS 收集器详解 ⭐⭐⭐

> CMS（Concurrent Mark Sweep）：以**最短停顿时间**为目标的老年代收集器

#### 四个阶段

```
  用户线程  ────────── ⏸ ─────────────────── ⏸ ────────────────────→
  GC线程                                                          
  ① 初始标记(STW)  ② 并发标记     ③ 重新标记(STW)   ④ 并发清除
     极短            最长 并发         较短              并发
     
  ① 初始标记：只标记 GC Roots 直接关联的对象（速度很快）
  ② 并发标记：从 GC Roots 遍历整个对象图（与用户线程并发，最耗时）
  ③ 重新标记：修正并发标记期间用户线程导致的引用变动（增量更新）
  ④ 并发清除：清除死亡对象，采用标记-清除算法（与用户线程并发）
```

#### CMS 三大缺点（⭐面试必问）

| 缺点 | 原因 | 后果 |
|------|------|------|
| **内存碎片** | 标记-清除算法不整理 | 大对象分配失败触发 Full GC（退化为 Serial Old STW 很久） |
| **浮动垃圾** | 并发清除阶段用户线程产生新垃圾 | 必须预留空间（默认 92% 触发），预留不足触发 Concurrent Mode Failure |
| **CPU 敏感** | 并发阶段占用 CPU 核心 | 线程数默认 (CPU+3)/4，CPU 少时影响吞吐 |

```
Concurrent Mode Failure 处理：
  CMS 并发回收来不及（老年代剩余空间不足）
  → 退化为 Serial Old（单线程标记-整理），STW 非常久
  → 生产中应避免：提前触发CMS（降低 CMSInitiatingOccupancyFraction）
```

```bash
# CMS 关键参数
-XX:+UseConcMarkSweepGC                    # 启用 CMS
-XX:CMSInitiatingOccupancyFraction=75       # 老年代 75% 时触发（默认92太高）
-XX:+UseCMSCompactAtFullCollection          # Full GC 后整理碎片
-XX:CMSFullGCsBeforeCompaction=0            # 每次 Full GC 后都整理
-XX:+CMSParallelRemarkEnabled               # 重新标记阶段并行
-XX:ConcGCThreads=4                         # 并发 GC 线程数
```

### 4.5 G1 收集器详解 ⭐⭐⭐⭐⭐

> G1（Garbage First）：面向**服务端**的收集器，JDK9+ 默认，兼顾吞吐和低停顿

#### Region 化堆结构

```
┌─────┬─────┬─────┬─────┬─────┬─────┬─────┬─────┐
│  E  │  S  │  O  │  H  │  H  │  E  │  O  │  E  │
├─────┼─────┼─────┼─────┼─────┼─────┼─────┼─────┤
│  O  │  E  │ 空闲 │  O  │  E  │  S  │ 空闲 │  O  │
├─────┼─────┼─────┼─────┼─────┼─────┼─────┼─────┤
│  E  │  O  │  O  │ 空闲 │  H  │  H  │  H  │  E  │
└─────┴─────┴─────┴─────┴─────┴─────┴─────┴─────┘

E = Eden    S = Survivor    O = Old    H = Humongous(大对象)

- 堆被划分为 ~2048 个等大的 Region（1~32MB，2 的幂次）
- 每个 Region 动态扮演角色（E/S/O/H），不需要连续
- 大对象（> Region 50%）放入 Humongous Region（可能占多个连续 Region）
```

#### G1 的三种 GC 模式

```
┌──────────────┬──────────────────────────────────────────────────┐
│  Young GC     │ 只回收所有 Eden + Survivor Region               │
│              │ 触发：Eden Region 数达上限                        │
│              │ 过程：存活对象复制到新 Survivor 或晋升 Old         │
├──────────────┼──────────────────────────────────────────────────┤
│  Mixed GC     │ 回收所有 Young Region + 部分 Old Region          │
│  (⭐核心)    │ 触发：并发标记完成后，老年代占比超过 IHOP 阈值     │
│              │ 选择回收价值最高（垃圾最多）的 Old Region           │
│              │ 这就是 "Garbage First" 名字的由来                  │
├──────────────┼──────────────────────────────────────────────────┤
│  Full GC      │ 单线程回收整个堆（要避免！）                      │
│  (⚠️ 避免)   │ 触发：Mixed GC 速度跟不上分配速度                  │
│              │ JDK10+ Full GC 改为多线程                         │
└──────────────┴──────────────────────────────────────────────────┘
```

#### G1 并发标记周期（6 个阶段）

```
① 初始标记（STW，极短）：标记 GC Roots 直接引用（借助 Young GC 完成）
② 根区域扫描：扫描 Survivor 到老年代的引用（并发，不能被 Young GC 打断）
③ 并发标记（并发，最耗时）：遍历对象图，用 SATB 处理并发变更
④ 最终标记（STW，较短）：处理 SATB 缓冲区中的残留引用
⑤ 清理（STW，较短）：统计各 Region 存活对象比例，排序回收价值
⑥ 复制/清除：将存活对象复制到空 Region（Mixed GC 阶段执行）
```

#### G1 核心机制

```
Remembered Set (RSet)：
  每个 Region 维护一个 RSet，记录"谁引用了我"
  作用：回收某个 Region 时不需要扫描整个堆
  代价：RSet 占用额外内存（约堆的 10%~20%）

Collection Set (CSet)：
  每次 GC 要回收的 Region 集合
  Young GC：CSet = 所有 Eden + Survivor
  Mixed GC：CSet = 所有 Young + 部分价值最高的 Old

IHOP (Initiating Heap Occupancy Percent)：
  老年代占整个堆比例的阈值（默认 45%），超过触发并发标记
  -XX:InitiatingHeapOccupancyPercent=45
  JDK9+ 支持自适应 IHOP

停顿预测模型：
  G1 记录每个 Region 的回收耗时统计数据
  根据 -XX:MaxGCPauseMillis 目标选择回收哪些 Region
  在停顿目标内尽量多回收垃圾
```

```bash
# G1 关键参数
-XX:+UseG1GC                          # 启用 G1（JDK9+ 默认）
-XX:MaxGCPauseMillis=200              # 目标停顿时间（默认 200ms）
-XX:G1HeapRegionSize=4m               # Region 大小（1~32MB，2的幂）
-XX:InitiatingHeapOccupancyPercent=45 # 触发并发标记的堆占用阈值
-XX:G1MixedGCCountTarget=8           # 并发标记后最多几次 Mixed GC
-XX:G1HeapWastePercent=5              # 可回收垃圾占堆 <5% 时不 Mixed GC
-XX:G1OldCSetRegionThresholdPercent=10 # Mixed GC 中 Old Region 占 CSet 上限
```

#### G1 vs CMS 对比

| 维度 | CMS | G1 |
|------|-----|-----|
| 算法 | 标记-清除 | 标记-整理 + 复制 |
| 碎片 | 有碎片，需 Full GC 整理 | **无碎片**（Region 间复制） |
| 停顿 | 不可预测 | **可预测**（MaxGCPauseMillis） |
| 适用堆大小 | < 4G | **4G ~ 数十G** |
| 浮动垃圾 | 有（可能 CMF） | 也有（但可通过调参缓解） |
| JDK 支持 | JDK14 移除 | JDK9+ 默认 |
| 并发标记 | 增量更新 | SATB（更高效） |
| 内存开销 | 较小 | RSet 额外 10%~20% |

### 4.6 收集器选型指南

```
                    堆 < 几百MB        → Serial
                    堆 < 4G + 低延迟   → CMS（JDK8），G1（JDK9+）
 你的场景是什么？ → 堆 4G~几十G       → G1（首选）
                    堆大 + 极低延迟    → ZGC（JDK15+）/ Shenandoah
                    吞吐量优先         → Parallel Scavenge + Parallel Old
```

### 4.7 面试标准答法
> CMS 以最短停顿为目标，四阶段中**并发标记和并发清除**不 STW，但有**碎片**（标记-清除）、**浮动垃圾**（CMF 退化 Serial Old）、**CPU 敏感**三大缺点。
> G1 堆划分为 ~2048 个 Region，按回收价值优先回收（Garbage First），支持 `MaxGCPauseMillis` 停顿预测。三种 GC 模式：Young GC、Mixed GC（核心）、Full GC（要避免）。用 SATB 解决并发标记漏标，RSet 维护跨 Region 引用。
> ZGC 停顿 <10ms 且与堆大小无关，核心是**染色指针**（GC 信息存指针高位）+ **读屏障**（引用加载时拦截修复）+ **指针自愈**（懒修复旧引用）。内存用三种 ZPage（Small/Medium/Large）。JDK21+ 引入分代 ZGC，年轻代高频回收短命对象，CPU 消耗降低约 50%。
> 选型：4G 以下 CMS/G1，4G~几十G G1，超大堆极低延迟 ZGC。

### 4.8 常见追问
| 追问 | 关键答点 |
|------|----------|
| Minor GC和Full GC触发条件？ | Minor：Eden满；Full：老年代满/System.gc()/担保失败/元空间满 |
| STW是什么？ | Stop The World，GC时暂停所有用户线程 |
| 为什么GC要STW？ | 防止标记过程中引用关系变化导致漏标/错标 |
| G1的Remembered Set是什么？ | 每个Region维护RSet，记录"谁引用了我"，回收时不扫描全堆 |
| 什么是安全点（Safepoint）？ | 用户线程在此暂停，选在方法调用、循环跳转等位置 |
| CMS CMF是什么？怎么避免？ | 并发收集来不及，退化Serial Old。降低触发阈值提前GC |
| G1什么时候触发Mixed GC？ | 并发标记完成后 + 老年代占比超 IHOP（默认45%） |
| G1 Humongous对象的影响？ | 大对象直接进老年代Humongous Region，可能导致过早GC |
| 为什么G1不用增量更新而用SATB？ | SATB 不需要重新扫描黑色对象，重新标记阶段更快 |
| ZGC 读屏障和 G1 写屏障区别？ | G1 用写屏障拦截引用赋值（解决漏标）；ZGC 用读屏障拦截引用加载（实现并发迁移+指针自愈） |
| ZGC 为什么能做到 <10ms？ | 三次 STW 只处理 GC Roots（数量极少），所有耗时操作（标记/迁移/修复）都并发 |
| 分代 ZGC 改进了什么？ | 年轻代高频回收短命对象，避免全堆扫描，CPU 降低 ~50%，内存降低 ~30% |
| ZGC 有什么缺点？ | 读屏障约 4% 吞吐损失；JDK15+ 才可用；中小堆不如 G1 |

---

## 五、JVM调优参数 & OOM排查 ⭐⭐⭐⭐

### 5.1 核心JVM参数
```bash
# 堆内存（Xms=Xmx避免动态扩容）
-Xms2g -Xmx2g
-Xmn512m                      # 新生代大小
-XX:SurvivorRatio=8           # Eden:S0:S1=8:1:1
-XX:MetaspaceSize=256m        # 元空间初始大小
-XX:MaxMetaspaceSize=512m     # 元空间最大大小
-Xss512k                      # 线程栈大小

# GC收集器
-XX:+UseG1GC                  # G1（JDK9+默认）
-XX:MaxGCPauseMillis=200      # G1目标停顿时间
-XX:+UseZGC                   # ZGC（JDK15+）

# OOM时自动dump
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/logs/oom.hprof
-XX:+ExitOnOutOfMemoryError   # OOM后退出，配合K8s自动重启

# GC日志
-XX:+PrintGCDetails -XX:+PrintGCDateStamps -Xloggc:/logs/gc.log
```

### 5.2 OOM类型 & 排查

| OOM类型 | 原因 | 排查方式 |
|--------|------|--------|
| Java heap space | 内存泄漏/对象太多 | dump → MAT分析引用链 |
| Metaspace | 类加载过多（动态代理/热部署）| jstat -gcmetacapacity |
| Direct buffer memory | NIO直接内存未释放 | 检查DirectByteBuffer |
| GC overhead limit | GC耗时98%但回收不足2% | 增大堆/排查泄漏 |
| StackOverflowError | 递归太深 | 检查递归/增大-Xss |
| Unable to create native thread | 线程太多/进程内存不足 | 减少线程数/减小Xss/调大ulimit |

**堆OOM排查完整流程（⭐面试重点）：**

```
① 获取 dump 文件
   方式一：提前配置 -XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/logs/
   方式二：jmap -dump:format=b,file=heap.hprof <pid>（线上慎用，会STW）
   方式三：Arthas heapdump /tmp/heap.hprof

② MAT 分析（最常用工具）
   - Leak Suspects Report：自动推测泄漏嫌疑
   - Dominator Tree：按 Retained Size 排序找大对象
   - Histogram：按类统计对象数量和大小
   - GC Roots Path：选中可疑对象 → 右键 "Path to GC Roots" → 找到引用链

③ 定位泄漏点（常见场景）
   ┌──────────────────┬──────────────────────────────────────┐
   │  泄漏场景         │  特征与解法                           │
   ├──────────────────┼──────────────────────────────────────┤
   │ 静态集合无限增长   │ static List/Map 只加不删 → 加上限/LRU │
   │ 缓存无淘汰        │ HashMap 当缓存无限增长 → 用 Guava Cache │
   │ ThreadLocal 未清理│ 线程池中 ThreadLocal → 用完必须 remove │
   │ 连接/流未关闭     │ DB连接/HTTP连接/IO流 → try-with-resources│
   │ 监听器未注销      │ EventListener 注册不取消 → 配对注销     │
   │ 大查询无分页      │ SELECT * 不分页加载百万行 → 加 LIMIT     │
   │ 类加载器泄漏      │ 热部署后旧 ClassLoader 不释放 → 检查引用 │
   └──────────────────┴──────────────────────────────────────┘

④ 确认是泄漏还是溢出
   泄漏：GC 后内存不释放，锯齿图底部持续上升 → 修复代码
   溢出：数据量确实大 → 增大堆 / 改为分批处理
```

### 5.3 CPU飙高排查（五步走）⭐

```bash
① top                          # 找CPU最高的进程PID
② top -Hp <pid>                # 找进程内CPU最高的线程TID
③ printf "%x\n" <tid>          # TID转16进制
④ jstack <pid> | grep -A 20 "0x<hex>"  # 找线程堆栈
⑤ 分析代码：死循环 / 频繁GC / 死锁
```

```
常见 CPU 飙高原因与判断：

线程堆栈看到大量：
  "GC task thread"            → 频繁 GC（jstat -gcutil 确认 FGC 次数）
  同一行代码循环              → 死循环 / 热循环
  BLOCKED / WAITING（monitor） → 锁竞争激烈
  RUNNABLE + 正则表达式        → 正则回溯（贪婪匹配 + 恶意输入）

排查工具升级路径：jstack → async-profiler → Arthas profiler
  async-profiler 生成火焰图，直观看 CPU 耗时分布
```

### 5.4 常用诊断命令

```bash
# ===== jstack：线程分析 =====
jstack <pid>                   # 线程堆栈（排查死锁/死循环）
jstack -l <pid>                # 包含锁信息

# ===== jmap：内存分析 =====
jmap -heap <pid>               # 堆内存使用概览（各区域大小和使用率）
jmap -histo <pid> | head -30   # 对象统计Top30（类名/数量/大小）
jmap -dump:format=b,file=x.hprof <pid>  # dump堆（⚠️ 会STW，线上慎用）

# ===== jstat：GC 监控 =====
jstat -gcutil <pid> 1000       # 每秒打印GC使用率
jstat -gc <pid> 1000           # 每秒打印GC详情（含大小）
# 关注指标：
#   S0/S1/E/O/M：各区域使用百分比
#   YGC/YGCT：Young GC 次数和总耗时
#   FGC/FGCT：Full GC 次数和总耗时
#   GCT：GC 总耗时

# ===== jinfo：运行时参数 =====
jinfo -flags <pid>             # 查看JVM运行参数
jinfo -flag MaxHeapSize <pid>  # 查看单个参数值
jinfo -flag +PrintGCDetails <pid>  # 运行时开启GC日志
```

### 5.5 GC 日志分析 ⭐⭐⭐

```bash
# JDK8 GC日志配置
-XX:+PrintGCDetails -XX:+PrintGCDateStamps -XX:+PrintGCTimeStamps
-XX:+PrintGCCause -Xloggc:/logs/gc.log

# JDK9+ 统一日志框架
-Xlog:gc*:file=/logs/gc.log:time,uptime,level,tags:filecount=10,filesize=100m
```

**G1 GC 日志示例解读：**

```
2026-03-11T10:30:15.123+0800: [GC pause (G1 Evacuation Pause) (young)
  [Eden: 256M(256M)->0B(224M) Survivors: 32M->64M Heap: 512M(2048M)->288M(2048M)]
  [Times: user=0.12 sys=0.01, real=0.05 secs]

解读：
  GC 类型：Young GC（Evacuation Pause）
  Eden：256M 全部回收，下次缩小到 224M
  Survivors：32M → 64M，存活对象增加
  Heap：堆从 512M 降到 288M（总堆 2048M）
  耗时：real=0.05s = 50ms 停顿时间

关注指标：
  ① real 停顿时间是否超过 MaxGCPauseMillis
  ② Full GC 是否出现（搜索 "Full GC" 或 "Pause Full"）
  ③ Mixed GC 触发频率是否正常
  ④ To-space exhausted / Evacuation Failure 是否出现（内存不足）
```

**可视化分析工具**：GCViewer、GCEasy（在线上传分析）、JDK Mission Control

### 5.6 实战调优案例 ⭐⭐⭐

**案例一：频繁 Full GC**
```
现象：jstat 发现 FGC 每分钟数次，服务 RT 飙升
排查：
  ① jstat -gcutil → 老年代使用率持续 > 90%
  ② jmap -histo → 发现某个 DTO 对象数量异常大
  ③ 代码审查 → 查询接口没分页，一次从 DB 加载 100 万条记录
解决：加分页查询 + 流式处理，FGC 从每分钟数次降到每天 0-1 次
```

**案例二：Young GC 耗时过长**
```
现象：Young GC 单次 >200ms
排查：
  ① 检查 Survivor 区：大量对象年龄未达阈值但动态年龄判断提前晋升
  ② 大量短命大对象（如临时 byte[] 缓冲区）在 Survivor 间反复复制
解决：
  - 增大 -Xmn（新生代），减少晋升频率
  - 调整 SurvivorRatio，让 Survivor 更大
  - 对大对象用对象池复用
```

**案例三：Metaspace OOM**
```
现象：java.lang.OutOfMemoryError: Metaspace
排查：
  ① jstat -gcmetacapacity → Metaspace 持续增长到上限
  ② 常见原因：
     - 反射/动态代理（CGLIB）生成大量动态类
     - Spring 热部署重复加载类
     - Groovy/脚本引擎动态编译
  ③ 用 Arthas classloader 查看类加载器数量
解决：加大 MaxMetaspaceSize + 排查动态类生成源头
```

**案例四：堆外内存泄漏**
```
现象：top 看 RES 持续增长，但堆内存正常
排查：
  ① 不是堆内存问题（jmap -heap 正常）
  ② 检查 NIO DirectByteBuffer（jcmd <pid> VM.native_memory summary）
  ③ 或者 Netty 的池化 ByteBuf 未释放
解决：开启 NMT（-XX:NativeMemoryTracking=summary），定位泄漏模块
```

### 5.7 生产环境 JVM 配置模板

```bash
# ===== 4G 堆 + G1（推荐通用配置） =====
-Xms4g -Xmx4g
-XX:+UseG1GC
-XX:MaxGCPauseMillis=200
-XX:InitiatingHeapOccupancyPercent=45
-XX:MetaspaceSize=256m
-XX:MaxMetaspaceSize=512m
-Xss512k

# 日志与诊断
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/logs/oom.hprof
-XX:+ExitOnOutOfMemoryError
-Xlog:gc*:file=/logs/gc.log:time,uptime,level,tags:filecount=10,filesize=50m

# ===== 8G 堆 + G1（大堆服务） =====
-Xms8g -Xmx8g
-XX:+UseG1GC
-XX:MaxGCPauseMillis=100
-XX:G1HeapRegionSize=8m
-XX:InitiatingHeapOccupancyPercent=40
-XX:MetaspaceSize=512m
-XX:MaxMetaspaceSize=1g

# ===== 16G+ 堆 + ZGC（超低延迟） =====
-Xms16g -Xmx16g
-XX:+UseZGC
-XX:SoftMaxHeapSize=14g               # 软上限，尽量在此范围内GC
-XX:MetaspaceSize=512m
-XX:MaxMetaspaceSize=1g
```

### 5.8 面试标准答法
> 调优先设内存：Xms=Xmx避免动态扩容，生产必加HeapDumpOnOutOfMemoryError。
> OOM按类型排查：heap space 用 MAT 分析 dump，找 Dominator Tree 大对象 → Path to GC Roots 追引用链；Metaspace 查类加载器和动态代理；Direct 查 NIO。
> CPU飙高五步走：top→top -Hp→转16进制→jstack 定位→分析死循环/GC/死锁。火焰图用 async-profiler。
> GC 日志关注：停顿时间、Full GC 频率、Evacuation Failure。
> 不重启诊断用Arthas：dashboard/thread/watch/trace/heapdump。

### 5.9 常见追问
| 追问 | 关键答点 |
|------|----------|
| 不重启排查线上问题？ | Arthas：dashboard 看板/thread 线程/watch 观察/trace 耗时/heapdump 堆 |
| 内存泄漏和内存溢出区别？ | 泄漏：对象无法回收积累导致溢出；溢出：内存确实不够 |
| Xms和Xmx为什么要一样？ | 避免堆动态扩容STW，性能更稳定 |
| jstat看哪些指标？ | S0/S1/E/O/M 使用率，YGC/FGC 次数和耗时，关注FGC频率 |
| 怎么判断是内存泄漏？ | GC 日志/监控看：每次 Full GC 后老年代回收不了，底部持续上升 |
| 线上能直接 jmap dump 吗？ | 慎用！会 STW。大堆可能停顿数十秒。推荐 HeapDumpOnOOM 提前配置 |
| 什么时候需要调优？ | Full GC 频繁 / GC停顿超标 / OOM / CPU异常。不要过度调优 |
| NMT 是什么？ | Native Memory Tracking，追踪 JVM 本地内存分配，排查堆外泄漏 |

---

## 六、JIT 编译与运行时优化 ⭐⭐⭐

### 6.1 解释执行 vs 编译执行

```
Java 代码的执行路径：

  .java → javac → .class 字节码
                       ↓
              JVM 载入字节码
              ↙           ↘
    解释执行（逐条翻译）    JIT 编译（热点代码编译为机器码）
    启动快，执行慢          启动慢（编译耗时），执行快
              ↘           ↙
          混合模式（默认 -Xmixed）
          先解释执行，热点代码触发 JIT 编译
```

### 6.2 热点探测与编译层级

```
热点代码判断（基于计数器）：
  ① 方法调用计数器：方法被调用次数
  ② 回边计数器：循环体执行次数（热循环）
  超过阈值 → 触发 JIT 编译

HotSpot 分层编译（Tiered Compilation，JDK8+ 默认）：

  Level 0: 解释执行
     ↓ 方法被频繁调用
  Level 1-3: C1 编译（Client Compiler）
     → 简单优化，编译速度快
     ↓ 调用次数继续增加
  Level 4: C2 编译（Server Compiler）
     → 深度优化（逃逸分析、循环展开、内联等），执行最快
     → 编译耗时但生成的机器码质量最高
```

### 6.3 JIT 关键优化手段

| 优化 | 说明 |
|------|------|
| **方法内联** | 把短小方法的代码直接嵌入调用处，省去方法调用开销（最重要的优化） |
| **逃逸分析** | 分析对象作用域 → 栈上分配/标量替换/锁消除（见 1.8 节） |
| **循环优化** | 循环展开、循环不变代码外提 |
| **空值检查消除** | 证明指针非空后消除后续 null 检查 |
| **公共子表达式消除** | `a*b + a*b` → 计算一次复用 |
| **死代码消除** | 删除不可达的代码路径 |

```bash
# 查看 JIT 编译信息
-XX:+PrintCompilation              # 打印 JIT 编译的方法
-XX:+UnlockDiagnosticVMOptions -XX:+PrintInlining  # 打印内联决策
-XX:CompileThreshold=10000         # C2 编译阈值（默认 10000 次调用）
```

### 6.4 面试标准答法
> Java 采用**混合模式**：字节码先解释执行，热点代码（方法调用/循环超过阈值）触发 JIT 编译为本地机器码。JDK8+ 默认分层编译：C1 快速编译 + C2 深度优化。JIT 核心优化包括方法内联、逃逸分析、循环优化等，这也是 Java 能接近 C++ 性能的原因。
