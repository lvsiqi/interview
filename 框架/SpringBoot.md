# SpringBoot 知识点

> 最后更新：2026年3月6日

---

## 一、自动装配原理 ⭐⭐⭐⭐⭐

### 1.1 什么是自动装配

```
Spring Boot 自动装配（Auto-Configuration）：
  根据项目中引入的依赖（jar包），自动向 Spring 容器注册对应配置类和 Bean
  不需要手动写 @Bean 配置，"约定大于配置"的核心体现

例：引入 spring-boot-starter-redis 依赖后
  → Spring Boot 自动注册 RedisTemplate、StringRedisTemplate 等 Bean
  → 无需手动配置连接工厂
```

---

### 1.2 入口：@SpringBootApplication

```java
@SpringBootApplication
= @SpringBootConfiguration    // 标记为配置类（等价于@Configuration）
+ @EnableAutoConfiguration    // ★ 开启自动装配（核心）
+ @ComponentScan              // 扫描当前包及子包下的组件
```

**核心在 `@EnableAutoConfiguration`：**

```java
@EnableAutoConfiguration
  └── @Import(AutoConfigurationImportSelector.class)
        ↓
        AutoConfigurationImportSelector.selectImports()
          ↓
          加载所有自动配置类的全限定名
```

---

### 1.3 自动装配完整流程

```
① 应用启动，@SpringBootApplication 触发 @EnableAutoConfiguration

② AutoConfigurationImportSelector.selectImports() 被调用

③ 调用 SpringFactoriesLoader.loadFactoryNames()
   → 扫描所有 jar 包 classpath 下的 META-INF/spring.factories 文件
   → 读取 key=org.springframework.boot.autoconfigure.EnableAutoConfiguration 下的所有配置类列表
   （Spring Boot 2.7+ 改为 META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports）

④ 得到 100~200+ 个自动配置类全限定名（如 RedisAutoConfiguration、DataSourceAutoConfiguration）

⑤ 通过条件过滤（@Conditional 系列注解），排除不满足条件的配置类
   → 只有真正引入了对应依赖的配置类才会生效

⑥ 剩余满足条件的配置类被注册到 Spring 容器，其中定义的 @Bean 被创建
```

**流程图：**
```
@SpringBootApplication
  → @EnableAutoConfiguration
    → AutoConfigurationImportSelector
      → 读取 META-INF/spring.factories
        → 200+ 候选自动配置类
          → @Conditional 过滤
            → 剩余有效配置类注入容器
              → 对应 Bean 创建完毕
```

---

### 1.4 核心：@Conditional 条件注解

> 自动配置类不是全部生效，而是按条件过滤，这是自动装配"智能"的关键

| 注解 | 生效条件 | 典型用途 |
|------|---------|--------|
| `@ConditionalOnClass` | classpath 中存在指定类 | 引入了 redis.clients.jedis.Jedis 才配置 Redis |
| `@ConditionalOnMissingClass` | classpath 中不存在指定类 | 兜底配置 |
| `@ConditionalOnBean` | 容器中已存在指定 Bean | 依赖其他 Bean 存在时才配置 |
| `@ConditionalOnMissingBean` | 容器中不存在指定 Bean | 用户未自定义则使用默认配置（★最常用）|
| `@ConditionalOnProperty` | 配置文件中指定属性满足条件 | `spring.redis.enabled=true` |
| `@ConditionalOnWebApplication` | 当前是 Web 应用 | Servlet 相关自动配置 |
| `@ConditionalOnExpression` | SpEL 表达式为 true | 复杂条件判断 |

**@ConditionalOnMissingBean 的意义：**
```
自动配置类中的 @Bean 都加了 @ConditionalOnMissingBean
  → 用户如果自己定义了同类型的 Bean，自动配置的 Bean 就不会创建
  → 用户自定义优先，实现"用户配置覆盖默认配置"
```

**示例（RedisAutoConfiguration 简化版）：**
```java
@Configuration
@ConditionalOnClass(RedisOperations.class)          // classpath有Redis相关类才生效
@EnableConfigurationProperties(RedisProperties.class) // 绑定 application.yml 中 spring.redis.*
public class RedisAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean(name = "redisTemplate") // 用户没自定义才创建
    public RedisTemplate<Object, Object> redisTemplate(
            RedisConnectionFactory redisConnectionFactory) {
        RedisTemplate<Object, Object> template = new RedisTemplate<>();
        template.setConnectionFactory(redisConnectionFactory);
        return template;
    }
}
```

---

### 1.5 spring.factories 文件

```properties
# META-INF/spring.factories（节选）
org.springframework.boot.autoconfigure.EnableAutoConfiguration=\
  org.springframework.boot.autoconfigure.data.redis.RedisAutoConfiguration,\
  org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration,\
  org.springframework.boot.autoconfigure.web.servlet.WebMvcAutoConfiguration,\
  ...（100多个）
```

**Spring Boot 2.7+ 的变化：**
```
旧：META-INF/spring.factories（一个文件注册所有）
新：META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports
   （每个自动配置模块单独维护，解耦更好）
   2.7 版本两种格式兼容，3.x 只支持新格式
```

---

### 1.6 自定义 Starter

> 理解自动装配后，自定义 Starter 就很简单了

**规范命名：**
```
官方 Starter：spring-boot-starter-xxx
自定义 Starter：xxx-spring-boot-starter（如 mybatis-spring-boot-starter）
```

**目录结构（最小化）：**
```
my-spring-boot-starter/
  src/main/java/
    com/example/MyService.java             ← 核心功能类
    com/example/MyAutoConfiguration.java  ← 自动配置类
    com/example/MyProperties.java         ← 配置属性绑定
  src/main/resources/
    META-INF/spring.factories             ← 注册自动配置类（Boot 2.x）
    META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports（Boot 3.x）
```

```java
// 1. 属性类
@ConfigurationProperties(prefix = "my.service")
public class MyProperties {
    private String url = "http://default";
    // getter/setter...
}

// 2. 自动配置类
@Configuration
@ConditionalOnClass(MyService.class)
@EnableConfigurationProperties(MyProperties.class)
public class MyAutoConfiguration {
    @Bean
    @ConditionalOnMissingBean
    public MyService myService(MyProperties props) {
        return new MyService(props.getUrl());
    }
}
```

---

## 二、配置体系 ⭐⭐⭐

### 2.1 配置文件优先级（从高到低）

```
① 命令行参数：--server.port=8081（最高优先级）
② Java系统属性：-Dserver.port=8081
③ 操作系统环境变量：SERVER_PORT=8081
④ jar 包外 application-{profile}.yml（同目录 config/ 子目录）
⑤ jar 包内 application-{profile}.yml（resources/）
⑥ jar 包外 application.yml
⑦ jar 包内 application.yml（最低，默认配置）
```

> **规律**：外部 > 内部，命令行 > 环境变量 > 配置文件；Profile 配置覆盖默认配置

### 2.2 多环境配置（Profile）

```yaml
# application.yml（主配置，激活Profile）
spring:
  profiles:
    active: dev   # 或通过命令行 --spring.profiles.active=prod

---
# application-dev.yml
server:
  port: 8080
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/dev_db

---
# application-prod.yml
server:
  port: 80
spring:
  datasource:
    url: jdbc:mysql://prod-db:3306/prod_db
```

### 2.3 配置绑定方式

```java
// 推荐：@ConfigurationProperties（类型安全，支持复杂对象、集合、校验）
@ConfigurationProperties(prefix = "app.datasource")
@Validated
public class DataSourceProperties {
    @NotBlank
    private String url;
    private int maxPoolSize = 10;
    // getter/setter...
}

// @Value：适合单个简单值
@Value("${app.name:defaultName}")   // 支持默认值
private String appName;
```

---

## 三、SpringBoot 启动流程 ⭐⭐⭐⭐

```
① new SpringApplication(primarySource)
   - 推断应用类型（Servlet / Reactive / None）
   - 加载 META-INF/spring.factories 中的
     ApplicationContextInitializer、ApplicationListener

② SpringApplication.run()
   ③ 创建并启动 StopWatch（计时）
   ④ 获取并启动 SpringApplicationRunListeners（发布 starting 事件）
   ⑤ 准备 Environment（加载配置文件、处理命令行参数）
   ⑥ 打印 Banner
   ⑦ 创建 ApplicationContext（Servlet → AnnotationConfigServletWebServerApplicationContext）
   ⑧ 准备 ApplicationContext：
      - applyInitializers（调用所有 ApplicationContextInitializer）
      - load（将主类注册为 BeanDefinition）
   ⑨ refreshContext（核心！）：
      - invokeBeanFactoryPostProcessors → 扫描包 + 读取自动配置类
      - onRefresh → 启动内嵌 Tomcat/Jetty/Undertow 
      - finishBeanFactoryInitialization → 实例化所有单例 Bean
   ⑩ callRunners（执行 ApplicationRunner / CommandLineRunner）
   ⑪ 发布 ApplicationReadyEvent → 应用启动完成
```

```java
// 模拟 SpringApplication.run() 核心逻辑
public class SimplifiedSpringBoot {
    public static ConfigurableApplicationContext run(Class<?> primarySource, String... args) {
        // 1. 初始化 SpringApplication
        SpringApplication app = new SpringApplication(primarySource);
        // 2. 执行 run 方法，触发全流程
        return app.run(args);
    }

    public ConfigurableApplicationContext run(String... args) {
        // 初始化监听器
        SpringApplicationRunListeners listeners = getRunListeners(args);
        // 3. 发布启动事件
        listeners.starting();
        try {
            // 4. 加载环境配置
            ApplicationArguments applicationArguments = new DefaultApplicationArguments(args);
            ConfigurableEnvironment environment = prepareEnvironment(listeners, applicationArguments);
            // 5. 创建上下文
            ConfigurableApplicationContext context = createApplicationContext();
            // 6. 上下文前置处理
            prepareContext(context, environment, listeners, applicationArguments);
            // 7. 刷新上下文（核心）
            refreshContext(context);
            // 8. 启动完成处理
            afterRefresh(context, applicationArguments);
            // 发布启动完成事件
            listeners.started(context);
            // 启动内嵌容器，等待请求
            callRunners(context, applicationArguments);
            return context;
        } catch (Throwable ex) {
            // 处理启动失败
            handleRunFailure(context, ex, listeners);
            throw new IllegalStateException(ex);
        }
    }
}
```
> **刷新上下文（核心中的核心）**：

这一步是 SpringBoot 启动的**核心核心**，等价于「正式启动 Spring 容器」，所有 Bean 的创建、依赖注入、初始化都在这一步完成，具体包含以下关键操作（按执行顺序）：

| 操作步骤 | 具体行为 | 通俗解释 |
|----------|----------|----------|
| 1. 初始化 Bean 工厂 | 刷新内部的 `BeanFactory`，初始化 Bean 定义注册表 | 为 Bean 创建准备 “工厂环境”，清空旧数据，重置状态 |
| 2. 执行 BeanFactory 后置处理器 | 调用 `BeanFactoryPostProcessor` 接口实现类 | 处理配置类（如 `@Configuration`）、解析 `@Bean` 注解，注册 Bean 定义 |
| 3. 注册 Bean 后置处理器 | 将 `BeanPostProcessor` 接口实现类注册到容器 | 为后续 Bean 的初始化、AOP 代理、注解解析（如 `@Autowired`）做准备 |
| 4. 初始化 MessageSource | 初始化国际化消息源（处理多语言配置） | 支持 `messages.properties` 等国际化配置的加载 |
| 5. 初始化事件广播器 | 初始化应用事件广播器（`ApplicationEventMulticaster`） | 为容器内事件发布 / 监听机制提供支持 |
| 6. 初始化特殊 Bean | 初始化 `ApplicationContextAware` 等特殊 Bean | 让 Bean 能感知 Spring 容器（如获取上下文、Bean 名称） |
| 7. 实例化所有非懒加载单例 Bean | 核心步骤：<br>① 扫描 `@Component`/`@Service`/`@Controller` 等注解类<br>② 通过反射实例化 Bean（调用构造方法）<br>③ 依赖注入（`@Autowired`/`@Resource` 赋值）<br>④ 执行初始化逻辑（`@PostConstruct`、`InitializingBean.afterPropertiesSet()`、`init-method`） | 从 “Bean 定义” 转为 “可使用的 Bean 对象”，完成 Bean 全生命周期 |
| 8. 启动内嵌 Web 容器（仅 Web 应用） | 若为 Web 应用，触发 `ServletWebServerApplicationContext` 创建并启动 Tomcat/Jetty/Undertow | 绑定端口（如 8080），监听 HTTP 请求，替代外部容器部署 |
| 9. 完成刷新，发布事件 | 发布 `ContextRefreshedEvent` 事件，标记上下文刷新完成 | 告知容器：所有 Bean 已初始化完成，可正常提供服务 |

> **简要记**：

- 扫描指定包下的 `@Component`/`@Service`/`@Controller` 等注解类；
- 实例化 Bean（调用构造方法）、属性注入（`@Autowired`）；
- 执行 Bean 的初始化逻辑（`@PostConstruct`、`InitializingBean` 等）；
- 注册 Bean 后置处理器（处理 AOP、注解解析等）。

> **面试关键点**：
SpringBoot 启动核心是 SpringApplication.run() 触发的「初始化 → 加载配置 → 创建上下文 → 刷新上下文 → 启动容器」全流程。自动配置发生在 `invokeBeanFactoryPostProcessors` 阶段，内嵌容器在 `onRefresh` 阶段启动，Runner 在最后执行适合做初始化任务

---

## 四、内嵌容器原理 ⭐⭐

Spring Boot 通过 `ServletWebServerFactory`（SPI）创建内嵌容器：

```
TomcatServletWebServerFactory → EmbeddedTomcat
JettyServletWebServerFactory  → EmbeddedJetty
UndertowServletWebServerFactory → EmbeddedUndertow

选择规则：@ConditionalOnClass + @ConditionalOnMissingBean
依赖中有 tomcat-embed-core → 默认启动 Tomcat
排除 Tomcat 引入 Jetty 依赖 → 自动切换 Jetty
```

```xml
<!-- 切换内嵌容器 -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-web</artifactId>
    <exclusions>
        <exclusion>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-tomcat</artifactId>
        </exclusion>
    </exclusions>
</dependency>
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-undertow</artifactId>
</dependency>
```

---

## 五、Actuator & 健康检查 ⭐⭐

```yaml
# 引入依赖后配置暴露端点
management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics,env,loggers
  endpoint:
    health:
      show-details: always   # 显示详细健康信息
```

**常用端点：**

| 端点 | 说明 | 典型用途 |
|------|------|---------|
| `/actuator/health` | 应用及依赖健康状态（DB/Redis/MQ） | K8s 存活/就绪探针 |
| `/actuator/metrics` | JVM内存、GC、线程、HTTP请求统计 | 接入 Prometheus |
| `/actuator/env` | 全部配置属性及来源 | 排查配置问题 |
| `/actuator/loggers` | 运行时动态调整日志级别 | 线上临时开 DEBUG |
| `/actuator/threaddump` | 线程堆栈快照 | 定位死锁/线程阻塞 |

**自定义健康检查：**

```java
@Component
public class RedisHealthIndicator extends AbstractHealthIndicator {
    @Override
    protected void doHealthCheck(Health.Builder builder) {
        try {
            redisTemplate.opsForValue().get("ping");
            builder.up().withDetail("redis", "reachable");
        } catch (Exception e) {
            builder.down().withException(e);
        }
    }
}
```

---

## 六、面试标准答法

**Q: SpringBoot 自动装配原理一句话总结？**

> `@EnableAutoConfiguration` 通过 `AutoConfigurationImportSelector` 读取 `META-INF/spring.factories`（Boot 3.x 改为 `.imports` 文件）中注册的所有自动配置类，再经过 `@ConditionalOnClass`/`@ConditionalOnMissingBean` 等条件过滤，只将满足条件的配置类注入容器，实现"按需装配"。

**Q: SpringBoot 和 Spring 的区别？**

> Spring Boot = Spring + 自动装配 + 内嵌容器 + Starter依赖管理 + Actuator。Spring Boot 的核心价值是"约定大于配置"，消除了繁琐的 XML 配置和外部容器部署，让开发者聚焦业务逻辑。
```

**步骤：**
```
① 创建 autoconfigure 模块，写自动配置类（@Configuration + @Conditional）
② 在 META-INF/spring.factories 中注册自动配置类
③ 创建 starter 模块（只包含 pom.xml），依赖 autoconfigure 模块
④ 其他项目引入 starter 依赖即可自动装配
```

```java
// 自定义自动配置类示例
@Configuration
@ConditionalOnProperty(prefix = "mycompany.sms", name = "enabled", havingValue = "true")
@EnableConfigurationProperties(SmsProperties.class)
public class SmsAutoConfiguration {
    
    @Bean
    @ConditionalOnMissingBean
    public SmsClient smsClient(SmsProperties properties) {
        return new SmsClient(properties.getAccessKey(), properties.getSecretKey());
    }
}
```

---

### 1.7 面试标准答法

**Q: Spring Boot 自动装配的原理是什么？**

> Spring Boot 自动装配的入口是 `@SpringBootApplication` 中的 `@EnableAutoConfiguration`，它通过 `@Import(AutoConfigurationImportSelector.class)` 注入选择器。选择器的 `selectImports()` 方法调用 `SpringFactoriesLoader` 读取所有 jar 包中 `META-INF/spring.factories` 文件里注册的自动配置类（百余个）；然后通过 `@ConditionalOnClass`、`@ConditionalOnMissingBean` 等条件注解过滤，只有引入了对应依赖且用户没有自定义 Bean 的情况下，自动配置类才会生效，对应的 Bean 才会在 Spring 容器中创建。这就实现了"引入依赖即可用"的效果。

---

### 1.8 常见追问

**Q: @SpringBootApplication 能放在非启动类上吗？**
> 可以，但不推荐。`@ComponentScan` 默认扫描当前类所在包及其子包，如果放在错误的位置，可能导致扫描不到部分 Bean 或扫描范围过大。实践上总是放在项目根包下的启动类上。

**Q: 如何禁用某个自动配置？**
> 两种方式：① `@SpringBootApplication(exclude = {DataSourceAutoConfiguration.class})`；② 配置文件 `spring.autoconfigure.exclude=org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration`。

**Q: Spring Boot 启动流程？**
> ① 创建 `SpringApplication` 对象，推断应用类型（Servlet/Reactive/None），加载 `META-INF/spring.factories` 中的 `ApplicationContextInitializer` 和 `ApplicationListener`；② 调用 `run()` 方法，发布 `ApplicationStartingEvent`；③ 根据应用类型创建对应 `ApplicationContext`；④ 执行 `ApplicationContextInitializer.initialize()`；⑤ 加载 `@SpringBootApplication` 启动类，触发 `@ComponentScan` + 自动装配；⑥ `refresh()` 容器，实例化所有单例 Bean；⑦ 发布 `ApplicationReadyEvent`，应用启动完成，执行 `CommandLineRunner`/`ApplicationRunner`。

---
