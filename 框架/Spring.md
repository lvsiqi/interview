# Spring 知识点

> 最后更新：2026年3月6日

---

## 一、IOC 原理 & Bean 生命周期 ⭐⭐⭐⭐⭐

### 1.1 IOC 核心原理

**IOC（Inversion of Control，控制反转）：**
```
传统方式：对象自己 new 依赖对象（主动控制）
IOC方式：对象所需的依赖由 Spring 容器创建并注入（控制权反转给容器）

DI（Dependency Injection）是 IOC 的具体实现方式
```

**容器层次结构：**

```
BeanFactory（顶层接口，最基础的容器）
  └── ApplicationContext（扩展接口，生产环境常用）
        ├── ClassPathXmlApplicationContext
        ├── AnnotationConfigApplicationContext
        └── SpringBoot 中的 AnnotationConfigServletWebServerApplicationContext
```

| 对比 | BeanFactory | ApplicationContext |
|------|------------|-------------------|
| Bean初始化时机 | 懒加载（第一次getBean时）| 启动时全部初始化（单例）|
| 功能 | 基础IOC | IOC + 国际化 + 事件 + AOP |
| 生产使用 | 不推荐 | ✅ 推荐 |

---

### 1.2 Bean 生命周期（8步）⭐⭐⭐⭐⭐

```
① 实例化（Instantiation）
   → 通过反射调用构造方法创建对象（此时属性全为默认值）

② 属性填充（Populate Properties）
   → 依赖注入（@Autowired / @Value / set方法注入）
   → 三级缓存在这一步解决循环依赖

③ Aware 接口回调
   → BeanNameAware.setBeanName()         注入当前Bean的名称
   → BeanFactoryAware.setBeanFactory()    注入BeanFactory引用
   → ApplicationContextAware.setApplicationContext()  注入容器引用

④ BeanPostProcessor#postProcessBeforeInitialization()
   → 所有Bean初始化前统一增强（可在此修改Bean属性）

⑤ 初始化（Initialization）
   → @PostConstruct 标注的方法执行（JSR-250，推荐）
   → InitializingBean.afterPropertiesSet()
   → 自定义 init-method（XML中配置的init-method属性）
   三种方式执行顺序：@PostConstruct → afterPropertiesSet → init-method

⑥ BeanPostProcessor#postProcessAfterInitialization()
   → 初始化后增强（AOP 代理对象在此步生成并返回）
   → 此后容器中持有的是代理对象而非原始对象

⑦ 使用（Bean 就绪，可被注入和调用）

⑧ 销毁（Destruction）—— 容器关闭时触发
   → @PreDestroy 标注的方法执行
   → DisposableBean.destroy()
   → 自定义 destroy-method
```

**记忆口诀：** 实例化 → 注入 → Aware → Before → 初始化 → After → 使用 → 销毁

---

### 1.3 Bean 作用域

| Scope | 说明 | 典型场景 |
|-------|------|---------|
| **singleton**（默认）| 容器内唯一实例，生命周期跟随容器 | 无状态Service/DAO |
| **prototype** | 每次getBean创建新实例，Spring不管销毁 | 有状态对象 |
| **request** | 每个HTTP请求一个实例 | Web层RequestContext |
| **session** | 每个HTTP Session一个实例 | 用户会话数据 |

---

### 1.4 三级缓存解决循环依赖 ⭐⭐⭐⭐

**循环依赖场景：**
```
A 依赖 B，B 依赖 A
A实例化 → 注入B → B实例化 → 注入A → A还没创建完 → 死循环？
```

**三级缓存（DefaultSingletonBeanRegistry 中的三个 Map）：**

| 缓存 | Map名 | 存储内容 | 作用 |
|------|-------|---------|------|
| **一级缓存** | `singletonObjects` | 完整的成品Bean | 正常使用 |
| **二级缓存** | `earlySingletonObjects` | 早期暴露的半成品Bean（已实例化未注入）| 解决循环依赖（无AOP时直接用）|
| **三级缓存** | `singletonFactories` | ObjectFactory（Bean工厂Lambda）| 解决循环依赖 + AOP代理 |

**解决流程详解：**
```
① A 开始创建，实例化后 → 将 A 的 ObjectFactory 放入三级缓存
② A 开始注入属性，发现需要 B → 去创建 B
③ B 实例化后 → 将 B 的 ObjectFactory 放入三级缓存
④ B 开始注入属性，发现需要 A → 从三级缓存取出 A 的 ObjectFactory
   → 调用 ObjectFactory.getObject() 生成 A 的早期引用（如有AOP则生成代理）
   → 将早期引用放入二级缓存，从三级缓存删除 A 的工厂
⑤ B 完成属性注入（持有A的早期引用/代理）→ B 完成初始化 → B 放入一级缓存
⑥ A 完成注入 B → A 完成初始化 → A 放入一级缓存（同时清除二级缓存中A的早期引用）
```

**为什么需要三级缓存而不是二级？**
```
如果 A 需要被 AOP 代理：
  二级缓存直接存半成品对象 → 注入给B的是原始对象（非代理）
  → B持有的A引用 ≠ 容器中最终的A代理对象 → 逻辑错误

  三级缓存存 ObjectFactory → 调用时才生成代理（懒生成）
  → 保证循环依赖中 B 持有的 A 引用也是 AOP 代理对象
  → 全程只有一个代理对象实例
  三级缓存的核心是通过存储创建 AOP 代理的工厂对象来延迟生成代理
  既解决了带 AOP 代理 Bean 的循环依赖问题，又不破坏 Spring 代理创建的设计原则（初始化后创建代理）
  而二级缓存仅能处理普通 Bean 循环依赖，无法兼顾 AOP 场景且会导致代理创建时机错乱 / 性能浪费。
```

**哪些循环依赖无法解决？**
```
❌ 构造器注入循环依赖
   原因：实例化阶段就需要对方，来不及将自己放入三级缓存

❌ prototype 作用域循环依赖
   原因：prototype不放入任何缓存，每次都新建

✅ setter/字段注入的单例循环依赖 → 三级缓存解决
```

---

### 1.5 面试标准答法

**Q: Spring Bean 的生命周期？**

> Bean生命周期分8步：①反射实例化；②属性填充（依赖注入）；③Aware接口回调（注入容器信息）；④BeanPostProcessor前置处理；⑤初始化（@PostConstruct → afterPropertiesSet → init-method）；⑥BeanPostProcessor后置处理（AOP代理在此生成）；⑦Bean正常使用；⑧销毁（@PreDestroy → destroy方法）。

**Q: Spring如何解决循环依赖？**

> Spring通过三级缓存解决单例setter注入的循环依赖：A实例化后将ObjectFactory放入三级缓存；B注入A时从三级缓存取出A的ObjectFactory生成早期引用（如有AOP则生成代理对象）放入二级缓存；B初始化完成后A继续完成初始化。之所以需要三级而非二级，是为了保证循环依赖中注入的也是AOP代理对象。构造器注入和prototype循环依赖无法解决。

---

### 1.6 常见追问

**Q: @Autowired 和 @Resource 的区别？**
> `@Autowired` 是Spring注解，**先按类型（byType）** 注入，多个实现时配合`@Qualifier`按名称区分；`@Resource` 是JDK（JSR-250）注解，**先按名称（byName）** 注入，找不到再按类型。`@Autowired`可用在构造器/方法/字段，`@Resource`只能用在字段和setter方法。

**Q: BeanFactory 和 FactoryBean 的区别？**
> `BeanFactory` 是Spring IoC容器接口，负责管理和获取所有Bean；`FactoryBean` 是一个特殊的Bean接口，实现它的Bean可以自定义对象的创建逻辑，容器中实际存放的是`getObject()`返回的对象（如MyBatis的`SqlSessionFactoryBean`返回的是`SqlSessionFactory`）。获取FactoryBean本身需要在名称前加`&`。

**Q: @PostConstruct 和 afterPropertiesSet 和 init-method 的执行顺序？**
> @PostConstruct（JSR-250注解）→ afterPropertiesSet（InitializingBean接口）→ init-method（XML/注解配置）。推荐使用@PostConstruct，因为不依赖Spring接口，侵入性最小。

---

## 二、AOP 原理 ⭐⭐⭐⭐

### 2.1 核心概念

```
AOP（Aspect-Oriented Programming，面向切面编程）：
  将横切关注点（日志、事务、权限、监控）从业务逻辑中抽离，集中在"切面"中统一处理
  不修改原始类代码，通过代理对象在方法执行前后织入增强逻辑
```

**五大核心术语：**

| 术语 | 英文 | 说明 | 举例 |
|------|------|------|------|
| **切面** | Aspect | 封装横切逻辑的类（@Aspect标注）| TransactionAspect、LogAspect |
| **切点** | Pointcut | 匹配哪些方法需要被增强（表达式）| `execution(* com.service.*.*(..))` |
| **通知** | Advice | 在切点处执行的增强逻辑（何时执行）| @Before / @After / @Around |
| **连接点** | JoinPoint | 程序执行的某个点（Spring中特指方法调用）| 任意方法调用 |
| **织入** | Weaving | 将切面应用到目标对象的过程 | 编译时/类加载时/运行时（Spring用运行时）|

**五种通知类型：**

```java
@Before          // 方法执行前  → 权限校验、参数校验
@AfterReturning  // 方法正常返回后（可拿到返回值）→ 日志记录结果
@AfterThrowing   // 方法抛出异常后（可拿到异常）→ 异常告警
@After           // 方法执行后（无论是否异常，相当于finally）→ 资源释放
@Around          // 环绕通知（最强，包含以上所有能力）→ 事务、耗时统计
```

**@Around 执行流程：**
```java
@Around("execution(* com.service.*.*(..))")
public Object around(ProceedingJoinPoint pjp) throws Throwable {
    // Before逻辑
    try {
        Object result = pjp.proceed();  // 调用目标方法
        // AfterReturning逻辑
        return result;
    } catch (Exception e) {
        // AfterThrowing逻辑
        throw e;
    } finally {
        // After逻辑
    }
}
```

---

### 2.2 底层实现：动态代理

Spring AOP 在运行时生成目标对象的**代理对象**，代理对象拦截方法调用，织入切面逻辑。

有两种代理方式：**JDK 动态代理** 和 **CGLIB 代理**。

---

#### JDK 动态代理

**核心：** `java.lang.reflect.Proxy` + `InvocationHandler`

**要求：** 目标类必须实现接口（代理的是接口类型）

**原理：**
```
① JVM 在运行时动态生成一个实现了相同接口的代理类（$Proxy0）
② 代理类持有 InvocationHandler 引用
③ 调用代理方法时，转发到 InvocationHandler.invoke()
④ invoke() 中执行增强逻辑，再通过反射调用目标方法
```

**简化代码：**
```java
// 生成代理对象
UserService proxy = (UserService) Proxy.newProxyInstance(
    target.getClass().getClassLoader(),
    target.getClass().getInterfaces(),   // 必须有接口
    (proxyObj, method, args) -> {
        System.out.println("Before...");
        Object result = method.invoke(target, args);  // 反射调用原方法
        System.out.println("After...");
        return result;
    }
);
```

---

#### CGLIB 代理

**核心：** 字节码增强库（Code Generation Library），ASM框架直接操作字节码

**要求：** 不需要接口，直接继承目标类生成子类

**原理：**
```
① CGLIB 在运行时生成目标类的子类（继承）
② 子类重写父类所有非 final 方法
③ 重写的方法中通过 MethodInterceptor 插入增强逻辑
④ 调用 intercept() → 执行增强 → 通过 FastClass 直接调用父类方法（比反射快）
```

**CGLIB 比 JDK 反射调用快的原因：**
```
JDK：method.invoke() 走反射，有装箱/拆箱、安全检查开销
CGLIB：FastClass 机制，为每个方法生成索引，直接通过索引调用方法
      首次生成字节码慢，但之后调用性能更好
```

**两种代理对比：**

| 对比项 | JDK 动态代理 | CGLIB 代理 |
|--------|------------|-----------|
| **要求** | 目标类必须实现接口 | 无要求（final类/方法除外）|
| **生成方式** | 实现接口的代理类 | 继承目标类的子类 |
| **速度** | 生成快，调用慢（反射）| 生成慢，调用快（FastClass）|
| **限制** | 只能代理接口方法 | **不能代理 final 类和 final 方法** |
| **Spring使用** | 有接口时默认（Spring 4.x以前）| Spring Boot 2.x 默认 |
| **依赖** | JDK 内置 | 需要引入 cglib 包（Spring已内置）|

---

### 2.3 Spring 选择代理策略

**Spring Boot 2.x 之后默认使用 CGLIB：**
```properties
# application.properties
spring.aop.proxy-target-class=true   # 默认 true → 强制CGLIB
                                     # false → 有接口用JDK，没接口用CGLIB
```

**选择逻辑（spring.aop.proxy-target-class=false 时）：**
```
目标类实现了接口 → JDK 动态代理
目标类没有实现接口 → CGLIB 代理
目标类是 final 类 → 报错（两种方式都不可用）
```

**Spring Boot 2.x 默认改为 CGLIB 的原因：**
```
JDK代理注入时必须用接口类型接收：
  UserService service = context.getBean(UserService.class); ✅
  UserServiceImpl service = context.getBean(UserServiceImpl.class); ❌ 报错

CGLIB代理两种方式都能接收：
  UserService service = context.getBean(UserService.class);     ✅
  UserServiceImpl service = context.getBean(UserServiceImpl.class); ✅

Boot 默认 CGLIB 避免了很多新手踩坑
```

---

### 2.4 AOP 在 Bean 生命周期中的触发时机

```
Bean 生命周期第⑥步：BeanPostProcessor#postProcessAfterInitialization()
  ↓
AnnotationAwareAspectJAutoProxyCreator（本质是一个 BeanPostProcessor）
  ↓
检查当前 Bean 是否匹配任何切点表达式
  ↓
匹配 → 生成代理对象（JDK/CGLIB），返回代理对象替换原始Bean
不匹配 → 返回原始 Bean

结论：容器中存放的是代理对象，而不是原始对象
```

---

### 2.5 AOP 经典应用场景

| 场景 | 实现方式 | 通知类型 |
|------|---------|--------|
| **事务管理** | @Transactional → TransactionInterceptor | @Around |
| **操作日志** | 自定义切面记录入参/出参/耗时 | @Around |
| **权限校验** | 拦截方法，校验权限注解 | @Before |
| **接口限流** | 拦截方法，检查令牌桶 | @Before/@Around |
| **异常统一处理** | 拦截所有Service方法，catch异常 | @AfterThrowing |
| **缓存切面** | @Cacheable → CacheInterceptor | @Around |

---

### 2.6 面试标准答法

**Q: Spring AOP 的原理是什么？**

> Spring AOP 基于动态代理实现，在运行时生成目标对象的代理对象，拦截目标方法的调用并织入切面逻辑。代理生成时机是 Bean 生命周期的 `postProcessAfterInitialization` 阶段，由 `AnnotationAwareAspectJAutoProxyCreator`（本质是 BeanPostProcessor）完成。

**Q: JDK 动态代理和 CGLIB 有什么区别？Spring 如何选择？**

> JDK 动态代理要求目标类实现接口，通过 `Proxy.newProxyInstance` 在运行时生成实现同接口的代理类，方法调用走 `InvocationHandler.invoke()` 反射调用；CGLIB 不需要接口，通过 ASM 字节码技术生成目标类的子类，重写父类方法插入增强逻辑，通过 FastClass 机制直接调用不走反射，性能更好，但不能代理 `final` 类和方法。
> Spring Boot 2.x 起默认使用 CGLIB（`proxy-target-class=true`），主要原因是 JDK 代理注入时只能用接口类型接收，CGLIB 则没有此限制，避免踩坑。

---

### 2.7 常见追问

**Q: AOP 能拦截同一个类内部的方法调用吗？**
> 不能。内部调用（`this.method()`）不经过代理对象，直接调用原始对象的方法，切面不会生效。解决方案：①通过 `AopContext.currentProxy()` 获取代理对象再调用；②将被调用方法抽到另一个Bean中；③使用 AspectJ 编译时织入（不依赖代理）。

**Q: @Transactional 在同类方法内部调用为什么失效？**
> 同一个原因：内部调用不走代理，`@Transactional` 是通过 AOP 代理实现的事务拦截，`this.methodB()` 直接调用原始对象方法，事务切面不会触发，导致事务失效。

**Q: CGLIB 为什么不能代理 final 方法？**
> CGLIB 通过生成子类并重写父类方法来实现代理，而 `final` 方法不允许被重写，所以 CGLIB 无法对其拦截增强，调用 `final` 方法会直接执行父类（原始类）的方法，增强逻辑不会触发。

---

## 三、事务原理 & 事务传播行为 ⭐⭐⭐⭐⭐

### 3.1 Spring 事务底层原理

**Spring 事务本质：AOP + ThreadLocal + JDBC 事务**

```
@Transactional 标注方法被调用时：
  ↓
AOP 代理拦截（TransactionInterceptor）
  ↓
① 获取 DataSource，从连接池取连接 connection
② 设置 connection.setAutoCommit(false)（关闭自动提交）
③ 将 connection 绑定到当前线程（ThreadLocal<Map<DataSource, Connection>>）
④ 调用目标业务方法
   → 业务中的所有数据库操作，从 ThreadLocal 取同一个 connection 执行
⑤ 无异常 → connection.commit()
⑥ 有异常（RuntimeException / Error）→ connection.rollback()
⑦ 最终释放连接，清除 ThreadLocal
```

**关键类：**
```
PlatformTransactionManager    → 事务管理器接口（DataSourceTransactionManager 实现）
TransactionStatus             → 当前事务状态（是否新事务、是否回滚等）
TransactionSynchronizationManager → ThreadLocal 绑定连接和事务的工具类
TransactionInterceptor        → AOP 拦截器，事务逻辑的入口
```

---

### 3.2 @Transactional 注解属性

```java
@Transactional(
    propagation    = Propagation.REQUIRED,    // 传播行为（★最重要）
    isolation      = Isolation.DEFAULT,        // 隔离级别（默认跟随DB）
    timeout        = -1,                       // 超时时间（秒），-1不限制
    readOnly       = false,                    // 只读事务（SELECT优化，禁止写）
    rollbackFor    = Exception.class,          // 指定哪些异常触发回滚
    noRollbackFor  = {}                        // 指定哪些异常不回滚
)
```

**rollbackFor 说明：**
```
默认只回滚：RuntimeException 和 Error（非受检异常）
受检异常（IOException、SQLException）默认不回滚！
生产环境建议：rollbackFor = Exception.class  ← 所有异常都回滚
```

---

### 3.3 七种事务传播行为 ⭐⭐⭐⭐⭐

> 传播行为：当一个有事务的方法调用另一个有 @Transactional 的方法时，如何处理事务的关系

| 传播行为 | 说明 | 场景 |
|---------|------|------|
| **REQUIRED**（默认）| 有事务就加入，没有就新建 | 99% 场景，通用 |
| **REQUIRES_NEW** | 无论如何，挂起外部事务，新建独立事务 | 操作日志（不受主事务影响）|
| **NESTED** | 有事务则嵌套（保存点），没有就新建 | 批量处理中单条失败可回滚到保存点 |
| **SUPPORTS** | 有事务就加入，没有就以非事务运行 | 只读查询，兼容有无事务场景 |
| **NOT_SUPPORTED** | 挂起当前事务，以非事务方式运行 | 不需要事务的统计查询 |
| **MANDATORY** | 必须在已有事务中运行，否则抛异常 | 强制要求调用方提供事务 |
| **NEVER** | 必须以非事务方式运行，有事务则抛异常 | 强制禁止事务 |

**最重要的三个（面试必考）：**

```
REQUIRED（加入/新建）：
  外部有事务 → 加入，外部回滚内部也回滚（同一个事务）
  外部无事务 → 新建

REQUIRES_NEW（独立事务）：
  无论外部是否有事务，挂起外部，自己开新事务
  内部提交/回滚 与 外部事务完全独立
  ⚠️ 内部异常不影响外部 / 外部异常不影响内部（但外部catch后可继续）

NESTED（嵌套/保存点）：
  外部有事务 → 创建保存点，内部失败只回滚到保存点，不影响外部
  外部无事务 → 同 REQUIRED 新建
  ⚠️ 与 REQUIRES_NEW 的区别：NESTED 仍是同一个事务，依赖外部事务提交
```

**REQUIRES_NEW vs NESTED 对比：**

| 对比 | REQUIRES_NEW | NESTED |
|------|-------------|--------|
| 是否同一事务 | ❌ 独立事务 | ✅ 同一事务（保存点）|
| 内部回滚影响外部 | ❌ 不影响 | ❌ 不影响（回滚到保存点）|
| 外部回滚影响内部 | ❌ 不影响（内部已提交）| ✅ 影响（外部回滚连保存点一起滚）|
| 数据库支持 | 通用 | 需要数据库支持 Savepoint（MySQL InnoDB 支持）|

---

### 3.4 事务失效的 8 大场景 ⭐⭐⭐⭐⭐

```
① 方法非 public（Spring AOP 只代理 public 方法，private/protected 不生效）

② 同类内部调用（this.method()，不走代理，AOP 失效）
   解决：注入本身 Bean 或 AopContext.currentProxy()

③ 异常被吞（catch 后没有 rethrow，Spring 感知不到异常，不触发回滚）
   解决：catch 后手动 TransactionAspectSupport.currentTransactionStatus().setRollbackOnly()

④ 异常类型不对（默认只回滚 RuntimeException/Error，受检异常不回滚）
   解决：rollbackFor = Exception.class

⑤ 数据库不支持事务（MyISAM 存储引擎不支持事务，InnoDB 才支持）

⑥ Bean 未被 Spring 管理（没有 @Service/@Component 等，Spring 无法生成代理）

⑦ 多线程（子线程中的操作与主线程用不同连接，主线程事务不覆盖子线程）
   原因：ThreadLocal 绑定的连接不跨线程

⑧ 传播行为配置错误（如 REQUIRES_NEW 独立事务，主事务抓住内部异常后误以为事务统一了）
```

---

### 3.5 面试标准答法

**Q: Spring 事务的底层原理？**

> Spring 事务本质是 AOP + ThreadLocal + JDBC 事务。`@Transactional` 方法调用时，AOP 代理（TransactionInterceptor）介入，从连接池获取连接并设置 `autoCommit=false`，将连接绑定到 ThreadLocal，业务方法中所有 SQL 操作共用同一个连接；方法正常返回则 `commit()`，抛出 RuntimeException/Error 则 `rollback()`，最后清理 ThreadLocal 释放连接。

**Q: 说说事务传播行为，REQUIRES_NEW 和 NESTED 的区别？**

> 传播行为定义了有事务的方法调用另一个 @Transactional 方法时事务如何传递。最常用的三个：`REQUIRED`（默认，有就加入没就新建）；`REQUIRES_NEW`（无论如何挂起外部事务，新开独立事务，内外完全隔离）；`NESTED`（嵌套，在外部事务中创建保存点，内部失败只回滚到保存点，但外部回滚会连内部一起回滚）。核心区别：REQUIRES_NEW 是真正独立的事务，外部提交不提交与内部无关；NESTED 仍属同一事务，依赖外部提交，只是借保存点实现了局部回滚。

---

### 3.6 常见追问

**Q: @Transactional 加在接口上还是实现类上？**
> 推荐加在**实现类**上。如果用 CGLIB 代理（Spring Boot 默认），代理的是类而非接口，加在接口上的注解不会被 CGLIB 子类继承，事务会失效。加在实现类上无论哪种代理方式都能生效。

**Q: 事务中调用远程接口，远程操作能回滚吗？**
> 不能。`@Transactional` 只能控制本地数据库事务（JDBC 事务），远程服务（HTTP/RPC）的操作不在同一个事务上下文中，无法回滚。要实现跨服务事务一致性，需要使用分布式事务方案（TCC、Saga、消息最终一致性）。

**Q: readOnly=true 有什么用？**
> 给数据库一个优化提示：① MySQL 会跳过意向锁申请，减少锁开销；② Spring 会对只读事务做略微优化（如不记录事务状态到 undo log）；③ 在主从架构中，数据源路由可以利用 `readOnly` 标识自动将查询路由到从库。不是真正"禁写"，只是一个 hint。

---
