# DDD 领域驱动设计

## 一、聚合根、实体、值对象

### 1. 核心概念

DDD（Domain-Driven Design）是一种以**业务领域**为核心的软件设计方法，目标是让代码结构与业务逻辑高度吻合，解决复杂业务系统的建模难题。

```
DDD战术建模元素层次：
                                                    
  ┌─────────────────────────────────────────────┐   
  │              聚合（Aggregate）               │   
  │                                             │   
  │    ┌───────────────────┐                   │   
  │    │   聚合根（Root）   │ ← 唯一入口        │   
  │    │   (Entity with ID)│                   │   
  │    └─────────┬─────────┘                   │   
  │              │ 包含/管理                    │   
  │    ┌─────────┴──────────────────┐           │   
  │    │  实体（Entity）            │           │   
  │    │  值对象（Value Object）    │           │   
  │    └────────────────────────────┘           │   
  │                                             │   
  │  边界：事务一致性边界（同一聚合内一个事务）  │   
  └─────────────────────────────────────────────┘   
```

### 2. 实体（Entity）

**特征：有唯一标识，标识不变，属性可变**

```java
/**
 * 实体：有ID，判等用ID，属性可变更
 */
public class Order {
    private OrderId id;         // 唯一标识（永不改变）
    private UserId userId;
    private OrderStatus status; // 状态可变
    private List<OrderItem> items;
    private Money totalAmount;

    // 业务行为内聚在实体内
    public void pay(PaymentInfo payment) {
        if (this.status != OrderStatus.PENDING) {
            throw new DomainException("订单状态不允许支付: " + this.status);
        }
        this.status = OrderStatus.PAID;
        // 发布领域事件
        DomainEventPublisher.publish(new OrderPaidEvent(this.id, payment));
    }

    // 实体判等：只看ID
    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Order)) return false;
        return Objects.equals(id, ((Order) o).id);
    }
}
```

### 3. 值对象（Value Object）

**特征：无唯一标识，用属性值判等，不可变（Immutable）**

```java
/**
 * 值对象：不可变，判等用属性值，没有ID
 * 代表"描述性"概念：金额、地址、坐标等
 */
public final class Money {
    private final BigDecimal amount;
    private final Currency currency;

    public Money(BigDecimal amount, Currency currency) {
        if (amount.compareTo(BigDecimal.ZERO) < 0)
            throw new IllegalArgumentException("金额不能为负");
        this.amount = amount;
        this.currency = currency;
    }

    // 值对象操作返回新对象（不可变性）
    public Money add(Money other) {
        if (!this.currency.equals(other.currency))
            throw new DomainException("货币类型不一致");
        return new Money(this.amount.add(other.amount), this.currency);
    }

    // 值对象判等：比较属性值
    @Override
    public boolean equals(Object o) {
        if (!(o instanceof Money)) return false;
        Money m = (Money) o;
        return amount.compareTo(m.amount) == 0 && currency.equals(m.currency);
    }
}

// 地址（典型值对象）
public final class Address {
    private final String province;
    private final String city;
    private final String street;
    private final String zipCode;
    // 全参构造，无 setter，equals 比较所有字段
}
```

### 4. 聚合根（Aggregate Root）

**聚合**是一组相关对象的集合，有一个**聚合根**作为对外的唯一入口。

**聚合设计原则：**
- 通过聚合根访问聚合内的其他对象（外部不能直接持有 OrderItem 的引用）
- 同一聚合内保证事务一致性（一个事务只改一个聚合）
- 跨聚合通过**领域事件**（异步）或**应用服务编排**（同步）协调

```java
/**
 * 聚合根：Order 聚合的入口
 * 聚合边界：Order + List<OrderItem>（强一致，同一事务）
 */
public class Order {   // 聚合根
    private OrderId id;
    private List<OrderItem> items = new ArrayList<>();  // 聚合内实体
    private OrderStatus status;

    // 外部只能通过聚合根方法操作 items，不能直接 order.getItems().add(...)
    public void addItem(ProductId productId, int quantity, Money unitPrice) {
        // 业务规则：同一商品不能重复加入
        boolean exists = items.stream()
            .anyMatch(i -> i.getProductId().equals(productId));
        if (exists) throw new DomainException("商品已存在，请修改数量");

        items.add(new OrderItem(productId, quantity, unitPrice));
        recalculateTotal();
    }

    public void removeItem(ProductId productId) {
        boolean removed = items.removeIf(i -> i.getProductId().equals(productId));
        if (!removed) throw new DomainException("商品不存在");
        recalculateTotal();
    }

    private void recalculateTotal() {
        this.totalAmount = items.stream()
            .map(OrderItem::getSubtotal)
            .reduce(Money.ZERO, Money::add);
    }
}

// 聚合内实体（不对外暴露，通过聚合根管理）
public class OrderItem {
    private OrderItemId id;
    private ProductId productId;
    private int quantity;
    private Money unitPrice;

    public Money getSubtotal() {
        return unitPrice.multiply(quantity);
    }
}
```

### 5. 三者对比

| | 实体（Entity）| 值对象（Value Object）| 聚合根（Aggregate Root）|
|---|---|---|---|
| **标识** | 有唯一 ID | 无 ID，属性即身份 | 有唯一 ID（聚合的 ID）|
| **可变性** | 可变（ID 不变）| 不可变（修改即替换）| 可变 |
| **判等方式** | 比较 ID | 比较所有属性值 | 比较 ID |
| **生命周期** | 独立 | 依附于实体 | 控制整个聚合 |
| **典型例子** | 订单、用户、商品 | 金额、地址、坐标、颜色 | Order、User |
| **持久化** | 独立表或关联表 | 内嵌到所属实体表（JSON 或列）| 对应 DB 表 |

### 6. 领域事件（Domain Event）

**解耦聚合间的交互，保证聚合边界内事务，跨聚合最终一致**

```java
// 领域事件：描述领域内已发生的事实
public class OrderPaidEvent {
    private final OrderId orderId;
    private final UserId userId;
    private final Money amount;
    private final LocalDateTime occurredAt;
    // 不可变，只读
}

// 聚合根内收集领域事件（Spring Data 方式）
public class Order extends AbstractAggregateRoot<Order> {
    public void pay(PaymentInfo payment) {
        this.status = OrderStatus.PAID;
        // 注册领域事件，Spring Data 在 save() 后自动发布
        registerEvent(new OrderPaidEvent(this.id, this.userId, this.totalAmount));
    }
}

// 其他聚合监听事件（解耦，无需直接调用）
@Component
public class InventoryDomainEventHandler {
    @EventListener
    @Transactional
    public void on(OrderPaidEvent event) {
        // 扣减库存（另一个聚合的事务）
        inventoryService.deduct(event.getOrderId());
    }
}
```

### 7. 仓储（Repository）

```java
// 仓储接口定义在领域层（依赖倒置）
public interface OrderRepository {
    Order findById(OrderId id);
    void save(Order order);
    List<Order> findByUserId(UserId userId);
}

// 仓储实现在基础设施层（JPA/MyBatis具体实现）
@Repository
public class OrderRepositoryImpl implements OrderRepository {
    @Autowired
    private OrderJpaRepository jpaRepo;

    @Override
    public Order findById(OrderId id) {
        return jpaRepo.findById(id.getValue())
            .map(OrderConverter::toDomain)     // DO → 领域对象
            .orElseThrow(() -> new OrderNotFoundException(id));
    }

    @Override
    public void save(Order order) {
        OrderDO orderDO = OrderConverter.toDO(order);  // 领域对象 → DO
        jpaRepo.save(orderDO);
    }
}
```

### 8. 面试标准答法

> 实体、值对象、聚合根是 DDD 战术设计的三个核心概念。**实体**有唯一 ID，判等看 ID，属性可以变化，代表有独立生命周期的业务概念（订单、用户）。**值对象**没有 ID，判等看所有属性值，设计成不可变（Immutable），代表"描述性"概念（金额、地址），修改时整体替换而不是部分修改，避免共享引用导致的副作用。**聚合根**是聚合的唯一访问入口，聚合是一组强一致的对象集合，同一事务只操作一个聚合。聚合根封装业务规则，外部只能通过它的方法修改聚合内状态，不能直接操作子实体。聚合间通过**领域事件**异步解耦，保证跨聚合的最终一致性。

### 9. 常见追问

**Q: 值对象一定要是不可变的吗？为什么？**
> 不可变性是值对象的核心特性，有三个好处：① **线程安全**：无状态，不需要加锁；② **无副作用**：多个实体共享同一值对象引用时，不会因为某处修改影响其他地方（不可变所以不需要保护性拷贝）；③ **防御式编程**：值对象的操作（如 `Money.add()`）返回新对象，调用者明确知道原值不变。如果因框架限制（如 JPA 序列化需要无参构造）无法做到严格不可变，至少要做到"逻辑不可变"（setter 设为 package-private 或不提供 setter）。

**Q: 一个聚合到底应该包含多少个实体？聚合设计得太大或太小有什么问题？**
> 聚合的原则是**事务一致性边界**：必须在同一事务内保证一致的对象放一个聚合，事后后续可以异步同步的放不同聚合。聚合过大：一个大聚合内实体多，事务锁的范围大，并发冲突概率高（多个用户对同一聚合的不同部分同时操作都要加行锁）。聚合过小：本该原子完成的操作被拆到多个聚合，需要分布式事务保证一致性，复杂度大增。设计建议：从小聚合开始，遇到真实的一致性需求再合并，宁可聚合小（最终一致）也不要聚合大（锁争用灾难）。

**Q: 聚合根的 ID 用数据库自增 ID 还是业务 UUID？**
> DDD 推荐用**业务生成的 ID**（UUID、Snowflake）而不是 DB 自增 ID，原因：① 聚合创建时即有 ID，无需先 save 到 DB 才知道 ID（生命周期完整）；② 方便事件溯源：事件中携带 ID 即可，不依赖 DB；③ 自增 ID 会泄露业务量（可被推导）。实践中常用 Snowflake ID（趋势递增，DB 索引友好）包装成值对象 `OrderId(long value)`，兼顾 DDD 语义和 DB 性能。

---

## 二、限界上下文

### 1. 是什么

**限界上下文（Bounded Context）** 是 DDD 战略设计的核心概念，定义了**领域模型有效的边界范围**。

同一个词在不同上下文中含义不同：
```
"商品（Product）"这个词：
┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
│  商品目录上下文   │   │   订单上下文      │   │   库存上下文      │
│  Product:        │   │  Product:         │   │  Product:         │
│  - 名称          │   │  - 快照名称        │   │  - SKU编码        │
│  - 描述          │   │  - 快照价格        │   │  - 库存数量        │
│  - 图片          │   │  - 购买数量        │   │  - 仓库位置        │
│  - 分类标签      │   │  - 优惠券抵扣      │   │  - 入库时间        │
└──────────────────┘   └──────────────────┘   └──────────────────┘
       ↑                       ↑                       ↑
  商品详情页                下单流程               仓储管理系统
```

**同一个"商品"在不同上下文中关注点完全不同，不应该用同一个巨型模型来表达所有场景。**

### 2. 上下文映射（Context Mapping）

限界上下文之间的集成关系：

| 关系模式 | 含义 | 适用场景 |
|---|---|---|
| **防腐层（ACL）** | 上游变化，下游用 ACL 转换，不影响自己领域模型 | 集成遗留系统 |
| **开放主机服务（OHS）** | 上游提供标准协议（REST/gRPC），下游直接消费 | 平台类服务 |
| **发布语言（PL）** | 共同定义数据格式（共享 Schema/事件契约）| 事件驱动集成 |
| **共享内核（SK）** | 两个上下文共享一部分领域模型（代码层面共享）| 慎用，高耦合 |
| **客户-供应商（CS）** | 上游提供需求评估窗口，下游参与排期 | 团队协作 |
| **遵从者（Conformist）** | 下游完全跟随上游模型，不做翻译 | 接入第三方 API |

```java
// 防腐层示例：订单上下文集成商品目录上下文
// 商品目录上下文的模型（上游）
public class CatalogProduct {
    private Long productId;
    private String productName;
    private BigDecimal salePrice;
    private List<ProductSku> skuList;
    // ...很多字段
}

// 订单上下文只关心自己需要的（防腐层翻译）
public class ProductInfo {  // 订单上下文的值对象
    private final ProductId id;
    private final String name;
    private final Money price;

    // 防腐层：将上游模型转换为本上下文的模型
    public static ProductInfo fromCatalog(CatalogProduct catalog) {
        return new ProductInfo(
            new ProductId(catalog.getProductId()),
            catalog.getProductName(),
            new Money(catalog.getSalePrice(), Currency.CNY)
        );
    }
}
```

### 3. 限界上下文 = 微服务的边界

**限界上下文是拆分微服务的理论依据：**

```
电商系统 DDD 上下文划分示例：

┌────────────────┐  ┌────────────────┐  ┌────────────────┐
│  用户上下文     │  │  商品目录上下文  │  │   订单上下文    │
│  User Service  │  │ Catalog Service │  │  Order Service │
│                │  │                │  │                │
│  - 注册/登录   │  │  - 商品管理     │  │  - 下单        │
│  - 用户画像    │  │  - 分类标签     │  │  - 支付        │
│  - 权限        │  │  - 搜索        │  │  - 订单查询    │
└────────────────┘  └────────────────┘  └────────────────┘
       ↑                    ↑                    ↑
    独立DB               独立DB               独立DB（包含商品快照）

┌────────────────┐  ┌────────────────┐  ┌────────────────┐
│   库存上下文    │  │   促销上下文    │  │   物流上下文    │
│ Inventory Svc  │  │ Promotion Svc  │  │  Logistics Svc │
│                │  │                │  │                │
│  - 库存管理    │  │  - 优惠券      │  │  - 发货        │
│  - 扣减/回滚   │  │  - 活动规则    │  │  - 物流追踪    │
└────────────────┘  └────────────────┘  └────────────────┘
```

**上下文间数据一致性：** 通过领域事件（MQ）异步同步，而不是跨库 JOIN。

### 4. 统一语言（Ubiquitous Language）

限界上下文内，开发和业务用**同一套术语**：

```
❌ 错误：开发用技术词汇，业务用业务词汇
  业务: "客户买了商品放购物车，结账时生成交易"
  代码: UserProductCartRecord, TransactionRecord

✅ 正确：代码类名 = 业务术语
  代码: Customer, Product, Cart, Order（与业务讲的词汇一致）
```

### 5. 面试标准答法

> 限界上下文是 DDD 战略设计的核心，定义了一个领域模型有效的业务边界。同一个业务概念（如"商品"）在不同上下文中含义完全不同：商品目录关注描述和分类，订单关注下单时的价格快照，库存关注 SKU 和数量——强行用一个大模型表达所有上下文，会导致模型腐化和各团队代码耦合。限界上下文直接对应微服务的服务边界：一个限界上下文通常对应一个微服务，拥有自己独立的数据库，跨上下文通过领域事件（MQ）异步通信，避免分布式事务。上下文间集成用防腐层（ACL）隔离上游变化，防止外部模型污染本上下文的领域模型。

### 6. 常见追问

**Q: 限界上下文和微服务是一对一的关系吗？**
> 不一定。理想状态是一对一，但实践中可以：① **一对多**：一个限界上下文因性能/团队规模拆成多个微服务（如订单上下文拆成订单服务 + 支付服务）；② **多对一**：多个小的限界上下文合并成一个服务（早期阶段，团队小，过早拆分成本高）。原则是：**先识别限界上下文边界（战略），再决定服务粒度（战术）**，不要反过来（先拆服务再想领域）。

**Q: 两个上下文的 User 概念是否应该共享一个用户表？**
> 不推荐。每个上下文应有自己的用户视图：订单上下文的"买家"关注收货地址、会员等级；营销上下文的"用户"关注偏好标签、触达方式。共享表意味着两个上下文的代码都依赖同一个 DB 结构，任何 Schema 变更都要两个团队协调——这正是 DDD 要避免的耦合。正确做法：各自维护本上下文的用户信息，通过 userId 关联，必要时通过事件同步需要的字段。

**Q: 如何识别限界上下文边界？**
> 两种方法：① **事件风暴（Event Storming）**：把所有领域事件（橙色便利贴）贴到时间轴上，找到事件的"语义转换点"——当相同的词在不同团队有不同理解时，就是上下文边界；② **词汇歧义法**：在白板上列出业务核心词汇，让不同业务部门解释，解释不同的地方就是边界。识别边界后，用上下文映射图（Context Map）标注上下文间的关系（ACL/OHS/事件集成）。

---

## 三、CQRS 模式

### 1. 什么是 CQRS

**CQRS（Command Query Responsibility Segregation，命令查询职责分离）**：将系统的**写操作（Command）**和**读操作（Query）**分离到不同的模型、甚至不同的存储上。

```
传统 CRUD 模式：
  ┌──────────────────────────────────────┐
  │  一个 Service + 一个 Model + 一个 DB  │
  │  CREATE / READ / UPDATE / DELETE     │
  │  所有操作共用同一数据模型             │
  └──────────────────────────────────────┘
          ↓ 问题：写模型和读视图差异大时，模型越来越臃肿

CQRS 模式：
  写侧（Command Side）          读侧（Query Side）
  ┌──────────────────┐          ┌──────────────────────┐
  │  Command Handler  │          │   Query Handler       │
  │  (业务规则验证)    │          │   (直接返回视图DTO)    │
  │       ↓          │          │         ↓             │
  │  Domain Model     │          │   Read Model(多表join) │
  │  (聚合根/实体)    │ ─事件─→  │   (冗余、反范式)       │
  │       ↓          │          │         ↓             │
  │  Write DB（规范化）│          │   Read DB（反范式）    │
  └──────────────────┘          └──────────────────────┘
```

### 2. 代码实现示例

**写侧：Command + Handler**

```java
// Command：封装意图（不可变）
public class PlaceOrderCommand {
    private final UserId userId;
    private final List<OrderItemRequest> items;
    private final AddressId deliveryAddressId;
    // 只读，final字段
}

// Command Handler：处理命令，调用领域模型
@Service
@Transactional
public class PlaceOrderCommandHandler {

    private final OrderRepository orderRepo;
    private final ProductQueryService productQuery;  // 查询商品信息
    private final EventPublisher eventPublisher;

    public OrderId handle(PlaceOrderCommand cmd) {
        // 1. 加载必要数据
        List<ProductInfo> products = productQuery.findByIds(
            cmd.getItems().stream().map(OrderItemRequest::getProductId).collect(toList())
        );

        // 2. 创建聚合根（领域逻辑在聚合内）
        Order order = Order.create(cmd.getUserId(), cmd.getDeliveryAddressId());
        for (OrderItemRequest item : cmd.getItems()) {
            ProductInfo product = findProduct(products, item.getProductId());
            order.addItem(product, item.getQuantity());
        }

        // 3. 持久化
        orderRepo.save(order);

        // 4. 发布领域事件（触发读模型更新）
        order.getDomainEvents().forEach(eventPublisher::publish);

        return order.getId();
    }
}
```

**读侧：Query + 直接查视图**

```java
// 读侧 Query：描述查询需求
public class GetOrderDetailQuery {
    private final OrderId orderId;
    private final UserId requestUserId;  // 用于权限校验
}

// 读侧 Handler：直接查视图/DTO，不经过领域模型
@Service
public class GetOrderDetailQueryHandler {

    private final OrderReadRepository readRepo;  // 读专用Repository

    public OrderDetailDTO handle(GetOrderDetailQuery query) {
        // 直接返回扁平化的 DTO，不经过聚合根重建
        return readRepo.findOrderDetailById(query.getOrderId())
            .orElseThrow(() -> new OrderNotFoundException(query.getOrderId()));
    }
}

// 读专用 Repository（可以是 MyBatis，直接写复杂 SQL）
@Repository
public class OrderReadRepositoryImpl implements OrderReadRepository {

    @Autowired
    private SqlSessionTemplate sqlSession;

    public Optional<OrderDetailDTO> findOrderDetailById(OrderId orderId) {
        // 直接写 JOIN 查询，返回 DTO（反范式，一次查出所有展示需要的字段）
        return Optional.ofNullable(sqlSession.selectOne(
            "OrderReadMapper.findOrderDetail", orderId.getValue()
        ));
    }
}
```

**DTO 定义（读模型）：**

```java
// 读模型 DTO：针对展示层优化，反范式，不需要遵循领域规则
public class OrderDetailDTO {
    private String orderId;
    private String userName;         // 冗余用户名（写模型只存 userId）
    private String userPhone;
    private String status;
    private String statusDesc;       // 状态中文描述（写模型存枚举）
    private String deliveryAddress;  // 完整地址拼接好
    private List<OrderItemDTO> items;
    private String totalAmount;      // 格式化好的金额字符串
    private String createTime;       // 格式化好的时间
}
```

### 3. 读写分离存储（CQRS 进阶形态）

```
                 Command Side              Query Side
                     │                        │
         ┌───────────▼───────────┐   ┌────────▼────────────┐
         │   MySQL（规范化写库）   │   │  Elasticsearch（搜索）│
         │   订单表（第三范式）    │──→│  或 MongoDB（文档）  │
         └───────────────────────┘   │  或 Redis（热点读）  │
                     │               └─────────────────────┘
                     │ 领域事件（MQ）          ↑
                     └────────────────────────┘
                           事件处理器同步读模型
```

**读模型同步策略：**

```java
// 事件处理器：将写侧事件同步到读模型存储
@Component
public class OrderReadModelProjector {

    @KafkaListener(topics = "domain.order")
    public void on(OrderCreatedEvent event) {
        // 构建读模型，写入 Elasticsearch 或 Redis
        OrderDocument doc = OrderDocument.builder()
            .orderId(event.getOrderId())
            .userId(event.getUserId())
            .totalAmount(event.getTotalAmount().toString())
            // ... 其他字段
            .build();
        orderEsRepository.save(doc);
    }

    @KafkaListener(topics = "domain.order")
    public void on(OrderPaidEvent event) {
        // 增量更新读模型（不需要重建整个文档）
        orderEsRepository.updateStatus(event.getOrderId(), "PAID", "已支付");
    }
}
```

### 4. CQRS vs 传统 CRUD 对比

| 维度 | 传统 CRUD | CQRS |
|---|---|---|
| **模型** | 一套 Model 兼顾读写 | 写模型（聚合）+ 读模型（DTO/文档）|
| **复杂度** | 低 | 高（两套模型，事件同步）|
| **读性能** | 受限于写模型结构 | 读模型专门优化，查询极快 |
| **写性能** | 普通 | 写侧聚焦业务规则，简洁 |
| **一致性** | 强一致 | 读写最终一致（异步同步有延迟）|
| **适用场景** | 简单增删改查 | 读写比例悬殊、读视图复杂、事件溯源 |

### 5. 事件溯源（Event Sourcing，与 CQRS 配合使用）

**不存储实体最终状态，而是存储产生该状态的所有事件序列**

```
传统存储：Order 表存最终状态
  order_id | status | total_amount | update_time
  1001     | PAID   | 299.00       | 2024-01-01 10:00

事件溯源存储：event_store 表存所有事件
  event_id | aggregate_id | event_type          | event_data          | occurred_at
  E001     | 1001         | OrderCreated        | {userId:1, items:[]}| 2024-01-01 09:50
  E002     | 1001         | OrderItemAdded      | {productId:5, qty:2}| 2024-01-01 09:50
  E003     | 1001         | OrderPaid           | {amount:299.00}     | 2024-01-01 10:00

重建聚合：replay events → 得到当前状态
  Order order = new Order();
  events.forEach(event -> order.apply(event));
```

**优势：** 完整审计日志、时间旅行（回溯任意时间点状态）、事件天然驱动 CQRS 读模型更新  
**劣势：** 查询当前状态需要 replay（需快照 Snapshot 优化）、实现复杂度高

### 6. CQRS 分层架构（结合 DDD 四层）

```
┌─────────────────────────────────────────────────────────────┐
│  接口层（Controller）                                        │
│  POST /orders   → PlaceOrderCommand                         │
│  GET  /orders/1 → GetOrderDetailQuery                       │
└────────────────────┬────────────────────┬───────────────────┘
                     │ Command            │ Query
                     ▼                    ▼
┌──────────────────────┐    ┌──────────────────────────────┐
│  应用层 Command Side  │    │  应用层 Query Side            │
│  PlaceOrderCommandHandler │    │  GetOrderDetailQueryHandler  │
│  （编排领域对象）    │    │  （直接查读模型，不过领域层）  │
└──────────┬───────────┘    └────────────┬─────────────────┘
           │                             │
           ▼                             ▼
┌──────────────────────┐    ┌──────────────────────────────┐
│  领域层（写侧）       │    │  读模型（无领域逻辑）         │
│  Order 聚合根        │    │  OrderDetailDTO               │
│  OrderDomainService  │    │  OrderReadRepository          │
└──────────┬───────────┘    └────────────┬─────────────────┘
           │                             │
           ▼                             ▼
┌──────────────────────┐    ┌──────────────────────────────┐
│  基础设施层（写）     │    │  基础设施层（读）              │
│  MySQL OrderTable    │─→  │  Elasticsearch / Redis        │
│  （规范化，第三范式）│Event│  （反范式，专为查询优化）     │
└──────────────────────┘    └──────────────────────────────┘
```

### 7. 面试标准答法

> CQRS 的核心思想是：写操作（Command）和读操作（Query）的数据需求差异很大，用同一个模型既处理写又处理读，会让模型越来越膨胀。CQRS 将两者分开：写侧用领域模型（聚合根）保证业务规则和数据一致性；读侧用扁平化的 DTO 或文档模型（Elasticsearch/Redis）直接支撑复杂查询，性能极高。两侧通过领域事件（MQ）异步同步，是最终一致而非强一致。CQRS 适用场景：读写比例悬殊（如 100:1）、读视图非常复杂（多表 JOIN + 计算字段）、需要多种读模型（App端/PC端/报表各不同）时。不是所有系统都需要 CQRS，简单 CRUD 用 CQRS 是过度设计。

### 8. 常见追问

**Q: CQRS 的读写最终一致，用户写完立刻读可能读不到，怎么处理？**
> 这是 CQRS 最典型的问题。常见解法：① **乐观更新（Optimistic Update）**：前端写成功后不等事件同步，直接在本地更新 UI 展示（用户看到的是预期状态），后台异步同步；② **版本号等待**：Command 返回事件版本号，Query 时传入版本号，读模型同步到该版本后才返回（有一定延迟，适合强一致业务）；③ **降级读写库**：写完成后如果需要立刻展示，降级直接查写库一次（绕过读模型），后续刷新走读模型；④ **产品设计规避**：写操作后跳转到加载页，给事件同步留 200ms 缓冲。

**Q: CQRS 中写侧 Command 失败了，读模型会不会出现脏数据？**
> 不会。Command Handler 失败时（抛异常或 rollback），领域事件不会发布（Spring 的 `AbstractAggregateRoot` 是在事务 commit 后才发布事件）。因此读模型只会收到成功的事件，不会有脏数据。但要注意幂等性：MQ 重复投递时，事件处理器要做幂等处理（判断事件 ID 是否已处理，防止重复更新读模型）。

**Q: CQRS 和读写分离（MySQL 主从）的区别是什么？**
> 本质不同：① **读写分离**是基础设施层的优化，读库是写库的数据副本（同一 schema，同一 ORM 模型），解决的是 DB 负载问题；② **CQRS** 是架构模式，读侧和写侧是**完全不同的模型和存储**（读侧可以是 Elasticsearch、Redis、宽表），解决的是模型臃肿和读视图复杂的问题。读写分离在在 CQRS 架构中通常作为写侧 DB 的高可用方案同时存在，两者不冲突，层次不同。

**Q: 事件溯源（Event Sourcing）和 CQRS 必须一起使用吗？**
> 不必须，但高度互补。单独使用：① 只用 CQRS 不用 ES —— 很常见，写侧存最终状态，读侧独立存储，用事件同步即可；② 只用 ES 不用 CQRS —— 事件 replay 出当前状态，但查询还是同一个模型，不分离（少见）。两者合用：ES 天然产生了所有事件，正好驱动 CQRS 读模型更新，组合后审计、时间旅行、多读模型三个能力同时具备，是事件驱动微服务的最佳实践，但复杂度也最高，适合核心交易类系统（如支付、订单）而非所有业务。
