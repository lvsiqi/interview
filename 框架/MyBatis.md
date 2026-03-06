# MyBatis 知识点

> 最后更新：2026年3月6日

---

## 一、一级缓存 & 二级缓存 ⭐⭐⭐⭐

### 1.1 整体缓存架构

```
MyBatis 缓存分两级：
  一级缓存（本地缓存）→ SqlSession 级别，默认开启，无法关闭
  二级缓存（全局缓存）→ Mapper（Namespace）级别，需手动开启
```

**查询优先级：**
```
二级缓存 → 一级缓存 → 数据库
```

---

### 1.2 一级缓存（SqlSession 级别）

**原理：**
```
每个 SqlSession 内部持有一个 PerpetualCache（本质是 HashMap）
同一个 SqlSession 中，相同的 SQL + 参数 → 第二次直接从 HashMap 命中，不走 DB
```

**缓存 Key 的构成：**
```java
// CacheKey 由以下五部分共同确定：
StatementId（Mapper方法全路径）+ RowBounds（分页偏移）+
BoundSql（SQL语句）+ 参数值 + environment（数据库环境ID）
// 五者全部相同才命中
```

**一级缓存失效的场景：**
```
① 不同 SqlSession → 各自独立的缓存，互不共享
② 同一 SqlSession 中执行了 INSERT / UPDATE / DELETE（任何写操作清空一级缓存）
③ 手动调用 session.clearCache()
④ 查询时指定 flushCache=true
```

**一级缓存在 Spring 中的问题：**
```
Spring 整合 MyBatis 时，每次调用 Mapper 方法都会使用新的 SqlSession（由 SqlSessionTemplate 管理）
→ 一级缓存实际上每次都失效，形同虚设
→ 只有在同一个 @Transactional 事务中，Spring 才会复用同一个 SqlSession
→ 一级缓存在 Spring 中只在事务范围内有效
```

---

### 1.3 二级缓存（Namespace 级别）

**开启方式：**
```xml
<!-- 1. mybatis-config.xml 全局开关（默认已是true） -->
<setting name="cacheEnabled" value="true"/>

<!-- 2. Mapper.xml 中开启 -->
<cache/>

<!-- 或带参数 -->
<cache eviction="LRU" flushInterval="60000" size="512" readOnly="true"/>
```

```java
// 或用注解
@CacheNamespace(eviction = LruCache.class, flushInterval = 60000, size = 512, readWrite = false)
public interface UserMapper { ... }
```

**原理：**
```
二级缓存作用域是 Mapper 的 Namespace（一个 Mapper.xml 文件）
不同 SqlSession 只要使用同一个 Namespace，就能共享二级缓存

数据存储流程：
  SqlSession 关闭/提交（session.commit() 或 session.close()）
  → 一级缓存中的数据才会刷入二级缓存
  → 未关闭的 SqlSession 产生的数据不会进入二级缓存
```

**重要：结果对象需实现 Serializable：**
```java
// 二级缓存可能涉及序列化存储（如存入磁盘/Redis）
// 因此 POJO 类必须实现 Serializable
public class User implements Serializable { ... }
```

**二级缓存失效：**
```
① 同一 Namespace 下执行任意写操作（INSERT/UPDATE/DELETE）→ 清空整个 Namespace 缓存
② 多个 Namespace 操作同一张表（多表关联查询）→ 脏读风险！
   例：UserMapper 和 OrderMapper 都涉及 user 表
   → UserMapper 写操作只清 UserMapper 的缓存
   → OrderMapper 的二级缓存不会清，读到旧数据
```

**一级 vs 二级对比：**

| 对比 | 一级缓存 | 二级缓存 |
|------|---------|---------|
| 作用域 | SqlSession（会话级）| Namespace（Mapper级）|
| 默认 | ✅ 开启 | ❌ 需手动开启 |
| 共享范围 | 同一 SqlSession | 同一 Namespace 的所有 Session |
| 存储位置 | 内存（PerpetualCache HashMap）| 内存/自定义（可接 Redis、Ehcache）|
| 脏读风险 | 低（会话内独立）| 高（多表关联时）|
| 生产推荐 | 事务内有效即可 | **不推荐**（宁可用 Redis 做分布式缓存）|

---

### 1.4 为什么生产中不推荐二级缓存

```
① 多表关联时极易脏读（Namespace 隔离粒度太粗）
② 集群部署时，每个节点的二级缓存独立，节点间数据不一致
③ 并发写多的场景，频繁失效导致缓存命中率很低
④ 专业缓存（Redis）远比二级缓存可控、可管理

生产实践：
  MyBatis 缓存全部禁用（cacheEnabled=false）
  + Redis 作为应用级缓存
  + @Cacheable 注解控制缓存策略
```

---

### 1.5 面试标准答法（字节风格，重原理）

**Q: MyBatis 一级缓存和二级缓存的原理？**

> 一级缓存是 SqlSession 级别，底层是 `PerpetualCache`（HashMap），同一会话中相同 SQL 直接命中缓存；但 Spring 整合后每次调用 Mapper 都新建 SqlSession，一级缓存只在 `@Transactional` 事务范围内有效。二级缓存是 Namespace 级别，需要手动开启，它在 SqlSession 关闭/提交时才将数据刷入，不同 Session 的同一 Namespace 可以共享；但多表关联场景极易产生脏读，且集群下各节点缓存不一致，**生产中不推荐使用二级缓存，应用 Redis 替代**。

---

## 二、动态 SQL 原理 ⭐⭐⭐

### 2.1 动态 SQL 标签

```xml
<!-- 常用标签 -->
<if test="name != null">AND name = #{name}</if>

<choose>           <!-- 相当于 switch-case -->
  <when test="type == 1">AND type = 1</when>
  <when test="type == 2">AND type = 2</when>
  <otherwise>AND type = 0</otherwise>
</choose>

<where>            <!-- 自动处理 WHERE 关键字和开头的 AND/OR -->
  <if test="name != null">AND name = #{name}</if>
  <if test="age != null">AND age = #{age}</if>
</where>

<set>              <!-- UPDATE 时自动处理末尾逗号 -->
  <if test="name != null">name = #{name},</if>
  <if test="age != null">age = #{age},</if>
</set>

<trim prefix="WHERE" prefixOverrides="AND|OR">  <!-- 通用版，<where>和<set>底层都是它 -->
  ...
</trim>

<foreach collection="ids" item="id" separator="," open="(" close=")">
  #{id}
</foreach>

<sql id="baseColumns">id, name, age</sql>  <!-- SQL片段复用 -->
<include refid="baseColumns"/>
```

---

### 2.2 底层原理：OGNL + SqlSource

**完整流程：**
```
Mapper.xml 解析阶段（启动时）：
  XMLStatementBuilder 解析 <select>/<update> 等标签
  → 将 SQL 标签节点构建成 SqlNode 组成的树形结构（组合模式）
  → 封装为 DynamicSqlSource（含动态标签）或 RawSqlSource（纯静态SQL）

执行阶段（运行时）：
  调用 Mapper 方法
  → SqlSource.getBoundSql(parameterObject) 被调用
  → DynamicContext 创建（内含参数 Map + 最终 SQL StringBuilder）
  → 递归遍历 SqlNode 树，每个节点的 apply(context) 方法被调用
  → IfSqlNode：用 OGNL 引擎求值 test 表达式，决定是否追加 SQL 片段
  → ForeachSqlNode：循环展开列表，生成 IN 子句
  → 最终拼接出完整 SQL 字符串
  → #{} 占位符替换为 ?，生成 PreparedStatement
```

**核心组件：**

| 组件 | 作用 |
|------|------|
| `SqlNode` | 动态SQL节点接口，`apply(DynamicContext)` 方法 |
| `IfSqlNode` | `<if>` 标签对应节点 |
| `ForEachSqlNode` | `<foreach>` 标签对应节点 |
| `MixedSqlNode` | 组合多个 SqlNode（组合模式）|
| `DynamicContext` | 运行时上下文，持有参数和最终 SQL 的 StringBuilder |
| `OgnlCache` | 缓存 OGNL 表达式解析结果，避免重复解析 |
| `DynamicSqlSource` | 含动态标签时使用，每次执行都重新拼接 SQL |
| `RawSqlSource` | 纯静态 SQL，启动时一次性解析，执行时直接用 |

---

### 2.3 `#{}` vs `${}` ⭐⭐⭐⭐

| 对比 | `#{}` | `${}` |
|------|-------|-------|
| **本质** | 预编译占位符（`?`）| 字符串直接拼接替换 |
| **SQL注入** | ✅ 安全，参数经过转义 | ❌ 有注入风险 |
| **使用场景** | 参数值传递（99% 场景）| 表名/列名/ORDER BY 动态传入 |
| **性能** | 预编译，可复用执行计划 | 每次重新编译 |

```xml
<!-- 正确示例 -->
SELECT * FROM user WHERE name = #{name}        <!-- 编译后：WHERE name = ? -->
SELECT * FROM ${tableName} WHERE id = #{id}    <!-- 动态表名必须用${} -->
SELECT * FROM user ORDER BY ${column} ${order} <!-- 动态排序列必须用${} -->

<!-- ⚠️ ${} 动态表名/列名必须做白名单校验，防止SQL注入 -->
```

**字节追问：为什么 `#{}` 能防 SQL 注入？**
```
#{} 最终转换成 JDBC PreparedStatement 的 ? 占位符
参数值通过 setString()/setInt() 等方法设置，JDBC 驱动会对特殊字符转义
即使传入 ' OR '1'='1，也只会被当作普通字符串值处理，不会破坏 SQL 结构

${} 是字符串拼接，传入 ' OR '1'='1 会直接嵌入 SQL，破坏语义
```

---

### 2.4 面试标准答法

**Q: MyBatis 动态 SQL 的实现原理？**

> MyBatis 启动时，`XMLStatementBuilder` 将 Mapper.xml 中的动态 SQL 标签解析成由 `SqlNode` 组成的树形结构（组合模式），封装进 `DynamicSqlSource`。执行时调用 `getBoundSql()`，通过 `DynamicContext` 递归遍历 `SqlNode` 树，`IfSqlNode` 用 OGNL 引擎对 `test` 表达式求值决定是否追加片段，`ForEachSqlNode` 展开循环，最终拼接出完整 SQL，再将 `#{}` 替换成 `?` 生成 `PreparedStatement`。`${}` 则是字符串直接替换，存在 SQL 注入风险，只用于动态表名/列名场景且必须做白名单校验。

---

## 三、插件机制（Interceptor）⭐⭐⭐

### 3.1 插件能做什么

```
MyBatis 插件本质是对核心组件的拦截增强（责任链模式 + JDK 动态代理）
可以拦截四大核心对象的方法：

① Executor         → 执行器（query/update/commit/rollback）
② StatementHandler → 语句处理器（prepare/parameterize/query）
③ ParameterHandler → 参数处理器（setParameters）
④ ResultSetHandler → 结果集处理器（handleResultSets）

典型应用：
  分页插件（PageHelper）：拦截 Executor.query()，自动追加 LIMIT
  数据权限插件：拦截 Executor，自动追加 WHERE tenant_id = ?
  性能监控：拦截 Executor，记录 SQL 执行耗时
  数据脱敏：拦截 ResultSetHandler，对返回结果做脱敏处理
  乐观锁插件：拦截 Executor.update()，自动追加 version 字段
```

---

### 3.2 插件实现原理

**JDK 动态代理 + 责任链（拦截器链）：**

```
MyBatis 初始化时，Configuration 解析所有 @Intercepts 注解的插件
→ 在 newExecutor() / newStatementHandler() 等工厂方法中
→ 调用 InterceptorChain.pluginAll(target)
→ 逐一调用每个 Interceptor.plugin(target)
→ 若目标方法匹配签名 → Plugin.wrap(target, interceptor)
  → 生成目标对象的 JDK 动态代理（代理类实现同接口）
→ 多个插件 → 形成代理嵌套链（洋葱模型）

执行时：
  调用 Executor.query()
  → 最外层插件代理.invoke() → intercept()
  → invocation.proceed() → 下一层插件代理.invoke() → intercept()
  → ... → 最终调用真实 Executor.query()
```

**插件执行顺序（洋葱模型）：**
```
配置顺序：Plugin1 → Plugin2 → Plugin3
包装顺序：原对象 被 Plugin1 包 → 被 Plugin2 包 → 被 Plugin3 包
执行顺序：Plugin3.intercept → Plugin2.intercept → Plugin1.intercept → 真实方法
          （后配置的先执行，类似 Spring Filter 链）
```

---

### 3.3 如何自定义插件

```java
// ① 实现 Interceptor 接口，标注 @Intercepts + @Signature
@Intercepts({
    @Signature(
        type  = Executor.class,          // 拦截哪个对象
        method = "query",                // 拦截哪个方法
        args  = {MappedStatement.class, Object.class,
                 RowBounds.class, ResultHandler.class}  // 方法参数类型（区分重载）
    )
})
public class SlowSqlInterceptor implements Interceptor {

    private static final long THRESHOLD = 500L; // 慢查询阈值 500ms

    @Override
    public Object intercept(Invocation invocation) throws Throwable {
        long start = System.currentTimeMillis();
        try {
            return invocation.proceed();   // 执行被拦截的方法
        } finally {
            long cost = System.currentTimeMillis() - start;
            if (cost > THRESHOLD) {
                MappedStatement ms = (MappedStatement) invocation.getArgs()[0];
                log.warn("慢SQL [{}] 耗时 {}ms", ms.getId(), cost);
            }
        }
    }

    @Override
    public Object plugin(Object target) {
        return Plugin.wrap(target, this);  // 生成代理，不匹配则返回原对象
    }
}
```

```xml
<!-- ② 注册插件 -->
<plugins>
    <plugin interceptor="com.example.SlowSqlInterceptor"/>
</plugins>
```

---

### 3.4 PageHelper 分页插件原理

```
PageHelper 是最流行的 MyBatis 分页插件，原理：

① 调用 PageHelper.startPage(pageNum, pageSize) 时
   → 将分页参数存入 ThreadLocal

② 拦截 Executor.query() 方法
   → 从 ThreadLocal 取出分页参数
   → 拦截原始 SQL，通过 JSqlParser 解析，自动加上 LIMIT ?, ?
   → 执行 COUNT(*) 查询获取总数
   → 执行带 LIMIT 的查询获取当前页数据

③ 将结果封装为 Page 对象返回（extends ArrayList，含 total、pages 等）

④ 清除 ThreadLocal，防止 SQL 污染下一次查询
```

**注意事项：**
```
⚠️ PageHelper.startPage() 必须紧跟 Mapper 查询方法（中间不能有其他操作）
   否则 ThreadLocal 中的分页参数被错误的查询消费

⚠️ 不要在 foreach 循环中使用，可能分页参数被内层查询消费
```

---

### 3.5 面试标准答法

**Q: MyBatis 插件的实现原理？**

> MyBatis 插件基于 **JDK 动态代理 + 责任链模式**。初始化时，`InterceptorChain` 对四大核心对象（`Executor`、`StatementHandler`、`ParameterHandler`、`ResultSetHandler`）依次调用 `plugin()` 方法，若目标方法签名匹配，则通过 `Plugin.wrap()` 为目标对象生成 JDK 动态代理；多个插件形成代理嵌套链（洋葱模型），执行时按照"后注册先执行"的顺序依次触发 `intercept()` 方法，最后通过 `invocation.proceed()` 调用链式传递到真实方法。典型应用是 PageHelper 分页插件—拦截 `Executor.query()`，将分页参数（存于 ThreadLocal）注入到 SQL 的 `LIMIT` 子句，并自动执行 COUNT 查询。

---

### 3.6 常见追问（字节风格）

**Q: MyBatis 和 Hibernate 的区别？字节为什么偏好 MyBatis？**
> Hibernate 是全自动 ORM，自动生成 SQL，开发效率高但难以精细优化；MyBatis 是半自动 ORM，SQL 手写，完全可控，适合复杂查询和 DBA 协作调优。字节等大厂偏好 MyBatis 是因为：业务复杂，SQL 需要精细优化（HINT、索引强制、分库路由等），Hibernate 自动 SQL 中间层太厚，出了问题难以排查；另外分库分表场景下 SQL 需要精确控制，MyBatis 更灵活。

**Q: MyBatis 的 Mapper 接口没有实现类，为什么能工作？**
> MyBatis 启动时，`MapperRegistry` 为每个 Mapper 接口使用 JDK 动态代理生成代理对象（`MapperProxy`）。调用接口方法时，`MapperProxy.invoke()` 根据方法名和参数找到对应的 `MappedStatement`，然后委托 `SqlSession`（`DefaultSqlSession`）执行对应的 SQL，底层走 `Executor` → `StatementHandler` → JDBC。整个过程中没有真实实现类，完全由代理对象完成方法调用到 SQL 执行的映射。

**Q: resultType 和 resultMap 的区别？**
> `resultType` 直接指定返回的 Java 类型，列名与字段名**自动映射**（需完全一致或开启驼峰映射）；`resultMap` 手动定义列名到字段名的映射关系，支持**嵌套查询**（association 一对一、collection 一对多）、**类型转换**（TypeHandler）等复杂场景。生产中复杂查询返回 DTO 时，优先用 `resultMap` 明确映射，避免隐式映射引发的字段遗漏。

---
