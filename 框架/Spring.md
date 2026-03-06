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
