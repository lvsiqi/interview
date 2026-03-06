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
