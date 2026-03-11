# 云原生与 Kubernetes

> 最后更新：2026年3月11日

---

## 一、Docker 核心原理 ⭐⭐⭐

### 1.1 容器 vs 虚拟机

| 维度 | 容器（Docker） | 虚拟机（VM） |
|------|--------------|-------------|
| 隔离方式 | Linux Namespace + Cgroups | Hypervisor 硬件级虚拟化 |
| 启动速度 | 秒级（ms 级） | 分钟级 |
| 资源占用 | 轻量（共享宿主机 OS） | 重（每个 VM 含完整 OS） |
| 隔离性 | 弱（共享内核，逃逸风险） | 强（完全隔离） |
| 镜像大小 | MB 级 | GB 级 |
| 适合场景 | 微服务、CI/CD、大规模部署 | 强隔离、多 OS 环境 |

### 1.2 Linux Namespace（隔离）

| Namespace | 隔离资源 |
|-----------|----------|
| PID | 进程 ID，容器内 PID=1 |
| Network | 网络设备、IP、端口 |
| Mount | 文件系统挂载点 |
| UTS | 主机名和域名 |
| IPC | 进程间通信（共享内存/信号量） |
| User | 用户和用户组 ID |

### 1.3 Cgroups（资源限制）

```
Control Groups：限制、账户统计、隔离进程使用的物理资源

/sys/fs/cgroup/
├── cpu/      → CPU 使用率（cpu.shares、cpu.quota）
├── memory/   → 内存上限（memory.limit_in_bytes）
├── blkio/    → 块设备 I/O 速率
└── cpuset/   → 绑定指定 CPU 核心

# Docker 使用 Cgroups 限制容器资源
docker run -m 512m --cpus="1.5" nginx
```

### 1.4 镜像分层（UnionFS / OverlayFS）

```
镜像分层结构：
  Layer 4: [RW] 容器层（写时复制）← 运行时读写
  Layer 3: [RO] COPY ./app /app
  Layer 2: [RO] RUN pip install ...
  Layer 1: [RO] FROM python:3.11-slim

特性：
  ① 多镜像共享相同基础层，节省存储
  ② 写时复制（CoW）：修改只读层文件时，先复制到读写层
  ③ OverlayFS = lowerdir（只读层） + upperdir（写层） + merged（合并视图）
```

### 1.5 Docker 网络模式

| 模式 | 说明 | 使用场景 |
|------|------|----------|
| bridge | 默认模式，虚拟网桥 docker0，容器 NAT 访问外网 | 单机多容器通信 |
| host | 容器与宿主机共享网络栈，无 NAT 损耗 | 高性能场景（Prometheus） |
| none | 无网络，完全隔离 | 安全隔离场景 |
| overlay | 跨宿主机容器通信（VXLAN 封装） | Docker Swarm / K8s |
| container | 共享另一个容器的 Network Namespace | Sidecar 模式 |

### 1.6 Dockerfile 最佳实践

```dockerfile
# ① 使用精简基础镜像
FROM eclipse-temurin:17-jre-alpine

# ② 多阶段构建减小最终镜像体积
FROM maven:3.9-eclipse-temurin-17 AS builder
COPY . .
RUN mvn package -DskipTests

FROM eclipse-temurin:17-jre-alpine
COPY --from=builder /app/target/app.jar /app.jar

# ③ 非 root 用户运行
RUN adduser -D appuser
USER appuser

# ④ 充分利用层缓存（依赖变化少的层放前面）
COPY pom.xml .
RUN mvn dependency:go-offline

COPY src ./src
RUN mvn package

ENTRYPOINT ["java", "-jar", "/app.jar"]
```

### 1.7 面试标准答法
> Docker 基于 Linux Namespace 实现资源隔离（PID/网络/文件系统等），基于 Cgroups 限制资源使用（CPU/内存）。镜像使用 OverlayFS 分层存储，多镜像共享基础层节省空间。容器本质是宿主机上的一个特殊进程，比虚拟机轻量但隔离性弱。

### 1.8 常见追问
| 追问 | 关键答点 |
|------|----------|
| 容器逃逸是什么？ | 利用内核漏洞或特权容器突破 Namespace 隔离，访问宿主机 |
| Docker 镜像的 Layer 数量有限制吗？ | 最多 127 层（AUFS 限制），合并 RUN 命令减少层数 |
| CMD vs ENTRYPOINT 区别？ | ENTRYPOINT 指定固定命令；CMD 提供默认参数，可被 docker run 覆盖；最佳实践：ENTRYPOINT 固定，CMD 提供参数 |
| 为什么容器内 PID=1 特殊？ | PID=1 是 init 进程，负责收养孤儿进程和信号转发；推荐使用 tini 作为 init |

---

## 二、Kubernetes 整体架构 ⭐⭐⭐⭐

### 2.0 K8s 是什么 & 解决了什么问题

**Kubernetes**（简称 K8s，源自 Google 内部 Borg 系统）是一个开源的**容器编排平台**，用于自动化部署、扩缩容和管理容器化应用。

#### 没有 K8s 之前的痛点

| 痛点 | 传统方式 | K8s 如何解决 |
|------|---------|-------------|
| **手动部署** | SSH 到每台机器逐个部署/升级，容易出错 | `kubectl apply` 声明式部署，滚动更新自动执行 |
| **服务宕机无自愈** | 人工监控 → 手动重启 → 半夜报警 | 控制循环自动检测 + 自动重建 Pod，秒级自愈 |
| **扩缩容慢** | 手动申请机器 → 部署 → 配置 LB | HPA 基于 CPU/QPS 自动扩缩容，秒级弹性 |
| **资源利用率低** | 每台机器跑一个服务，大量闲置 | Bin Packing 调度，多服务混部，利用率可从 10%→60%+ |
| **环境不一致** | "我本地能跑"→ 测试/预发/生产不一致 | 容器镜像 = 全量环境，一次构建到处运行 |
| **服务发现复杂** | 手动维护 IP 列表或配 Nginx 转发 | Service + CoreDNS 自动服务发现和负载均衡 |
| **发布回滚困难** | 回滚需手动替换包、重启 | `kubectl rollout undo` 一键回滚到任意版本 |

#### K8s 核心能力一句话总结

```
声明式 API      → 我说"要 3 个副本"，K8s 自动保证
自动调度        → 找最合适的节点运行 Pod
自愈能力        → 挂了自动重建，不用人干预
弹性伸缩        → 流量高自动扩容，低峰自动缩容
滚动更新/回滚   → 零停机发布，出问题秒级回滚
服务发现/负载均衡 → DNS + ClusterIP 开箱即用
配置/密钥管理    → ConfigMap + Secret 与代码解耦
存储编排        → PV/PVC 自动对接云盘/NFS
```

> **一句话定义**：K8s 是容器时代的"操作系统"——Docker 解决了单个应用的打包运行，K8s 解决了成百上千个容器如何协调部署、自动运维、弹性伸缩的问题。

### 2.1 架构全景

```
┌─────────────────────── Control Plane（Master）───────────────────────┐
│                                                                        │
│  kube-apiserver  ←── 唯一 API 入口，所有组件通信中枢，RESTful           │
│       │                                                                │
│  etcd ←──────── 集群状态存储（强一致性 key-value，基于 Raft）           │
│       │                                                                │
│  kube-scheduler ←── 将 Pod 分配到合适 Node（过滤 + 打分）              │
│       │                                                                │
│  controller-manager ←── 各类控制器（Deployment/ReplicaSet/Node 等）    │
│       │                                                                │
│  cloud-controller-manager ←── 对接云厂商 API（LB/存储/路由）           │
└───────────────────────────────────────────────────────────────────────┘
                         │   Watch/List
┌────────────────── Node（Worker）──────────────────┐
│                                                    │
│  kubelet ←── 与 apiserver 通信，管理 Pod 生命周期   │
│       │                                            │
│  kube-proxy ←── 维护 iptables/ipvs 规则，Service流量│
│       │                                            │
│  Container Runtime ←── containerd/CRI-O 运行容器   │
│       │                                            │
│  Pod → Pod → Pod                                   │
└────────────────────────────────────────────────────┘
```

### 2.2 核心组件详解

| 组件 | 职责 | 关键特性 |
|------|------|----------|
| **kube-apiserver** | 集群 API 网关，唯一操作 etcd 的组件 | 无状态，可水平扩展；所有资源 CRUD 入口 |
| **etcd** | 集群状态（期望状态）持久化存储 | 强一致性（Raft），建议奇数节点（3/5/7） |
| **kube-scheduler** | 将 Pending Pod 分配到 Node | 过滤（Predicate）+ 打分（Priority）+ 绑定 |
| **controller-manager** | 维护集群期望状态 | DeploymentController/HPAController/GCController 等 |
| **kubelet** | Node 上 Pod 生命周期管理 | 定期上报 Node 状态；通过 CRI 与容器运行时通信 |
| **kube-proxy** | Service 网络代理 | 维护 iptables/ipvs 规则；流量转发到健康 Pod |

### 2.3 核心设计理念：控制循环

```
K8s 编排思想：声明式 API + 控制循环（Reconcile Loop）

for {
    actual  = 获取当前集群状态
    desired = 从 etcd 读取期望状态
    if actual != desired {
        执行调谐操作（增删改 Pod/Service/...）
    }
    sleep(interval)
}

用户只需声明"我要3个 nginx 副本"，K8s 自动保证
```

### 2.4 面试标准答法
> K8s 分 Control Plane 和 Node 两层。控制平面含 apiserver（唯一入口）、etcd（状态存储）、scheduler（调度）、controller-manager（控制循环）。Node 含 kubelet（Pod 生命周期）和 kube-proxy（Service 网络）。
> 核心思想是声明式 API + 控制循环：用户声明期望状态，各控制器持续 Reconcile 使实际状态收敛到期望状态。

### 2.5 常见追问
| 追问 | 关键答点 |
|------|----------|
| apiserver 挂了会怎样？ | 无法操作集群（kubectl 失效），但已运行的 Pod 仍正常，kubelet 独立运行 |
| etcd 为什么需要奇数节点？ | Raft 需要 (n/2)+1 节点写入成功，奇数节点最大化容错（3节点容1个故障，4节点也只容1个） |
| scheduler 如何保证 Pod 不重复调度？ | 只处理 nodeName 为空的 Pod；绑定操作通过 apiserver 乐观锁，失败则重新调度 |

---

## 三、核心资源对象 ⭐⭐⭐⭐

### 3.1 Pod（最小调度单元）

```yaml
# Pod 内多容器共享 Network Namespace（同 IP）和 Volume
apiVersion: v1
kind: Pod
spec:
  containers:
  - name: app
    image: my-app:1.0
    resources:
      requests:        # 调度依据：Node 必须有这么多可用资源
        cpu: "100m"    # 0.1 核
        memory: "128Mi"
      limits:          # 硬上限：超过 CPU 被限流，内存 OOM Kill
        cpu: "500m"
        memory: "512Mi"
  - name: sidecar      # 同 Pod 内辅助容器（日志收集/代理）
    image: log-agent:1.0
```

### 3.2 Deployment（无状态应用管理）

```
Deployment → 管理 ReplicaSet → 管理 Pod

版本控制：每次更新创建新 ReplicaSet，旧 ReplicaSet 保留（支持回滚）

滚动更新策略：
  maxSurge: 25%      → 更新期间最多多出 25% 的 Pod
  maxUnavailable: 25% → 更新期间最多 25% 的 Pod 不可用

常用命令：
  kubectl rollout status deployment/my-app
  kubectl rollout undo deployment/my-app          # 回滚到上一版本
  kubectl rollout undo deployment/my-app --to-revision=2  # 回滚到指定版本
```

### 3.3 Service（服务发现与负载均衡）

| 类型 | 说明 | 使用场景 |
|------|------|----------|
| **ClusterIP** | 集群内 VIP，只能集群内访问 | 服务间调用（默认） |
| **NodePort** | 在每个 Node 上开放固定端口 | 开发测试外部访问 |
| **LoadBalancer** | 对接云厂商 LB，分配公网 IP | 生产级外部访问 |
| **Headless** | ClusterIP=None，直接返回 Pod IP | StatefulSet、有状态服务发现 |
| **ExternalName** | DNS CNAME 指向外部域名 | 集群内访问外部服务 |

```
Service 负载均衡原理：
  kube-proxy 监听 Service/Endpoints 变化
  → 更新 iptables（随机 DNAT）或 ipvs（更高效：支持轮询/最少连接等）规则
  → 请求到达 ClusterIP → 被转发到后端 Pod IP
```

### 3.4 Ingress（7层HTTP路由）

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
spec:
  rules:
  - host: api.example.com
    http:
      paths:
      - path: /user
        pathType: Prefix
        backend:
          service:
            name: user-service
            port:
              number: 80
      - path: /order
        pathType: Prefix
        backend:
          service:
            name: order-service
            port:
              number: 80

# Ingress Controller（Nginx/Traefik/Kong）负责实际流量转发
# 支持：TLS 终止、基于域名路由、URL 重写、限流、灰度
```

### 3.5 ConfigMap & Secret

```yaml
# ConfigMap：存储非敏感配置
apiVersion: v1
kind: ConfigMap
data:
  app.properties: |
    server.port=8080
    log.level=INFO

# Secret：存储敏感信息（base64 编码，不是加密！）
apiVersion: v1
kind: Secret
type: Opaque
data:
  password: cGFzc3dvcmQ=  # base64("password")
  
# 挂载方式：
# 1. 环境变量：envFrom.configMapRef
# 2. Volume 挂载：文件形式
```

> ⚠️ Secret 只是 Base64 编码不是加密！生产环境用 Vault/Sealed Secrets/KMS 加密存储

### 3.6 StatefulSet（有状态应用）

```
StatefulSet vs Deployment：

Deployment（无状态）：
  - Pod 名：random（my-app-6bd8b6bc9d-xkpzm）
  - Pod 可随意重建，无状态
  
StatefulSet（有状态）：
  - Pod 名：有序固定（redis-0, redis-1, redis-2）
  - 启动/终止有序（redis-0 先启动，redis-2 先终止）
  - 每个 Pod 绑定独立 PVC（数据持久化，Pod 重建数据不丢失）
  - 稳定网络标识：redis-0.redis-headless.default.svc.cluster.local
  
适用：MySQL/Redis Cluster/Kafka/ZooKeeper 等
```

### 3.7 DaemonSet（每节点守护进程）

**核心语义**：确保每个 Node（或指定 Node）恰好运行一个 Pod 副本。

| 维度 | DaemonSet | Deployment |
|------|-----------|------------|
| 调度方式 | controller 直接绑定每个 Node | scheduler 打分选 Node |
| 副本数 | = Node 数（自动跟随） | 用户指定 |
| 新增 Node | 自动部署 Pod | 无感知 |
| 典型场景 | 日志采集 Fluentd · 监控 Node Exporter · 网络插件 Calico | 无状态业务服务 |

**更新策略**：`RollingUpdate`（默认，逐节点替换，可配 `maxUnavailable`）/ `OnDelete`（手动删除旧 Pod 后才创建新 Pod，适合线上需手动确认的危险操作）。

### 3.8 Job / CronJob（批处理任务）

**Job**：运行一次性任务（数据迁移、ETL、报表），Pod 成功完成后不重启。

| 参数 | 含义 | 默认值 |
|------|------|--------|
| `completions` | 需要成功完成几次 | 1 |
| `parallelism` | 最多同时运行几个 Pod | 1 |
| `backoffLimit` | 最大失败重试次数（指数退避） | 6 |
| `activeDeadlineSeconds` | 全局超时（秒），超时强制终止 | 无 |

**CronJob**：定时调度 Job，cron 语法（`"0 2 * * *"` = 每天凌晨 2 点）。

关键参数 `concurrencyPolicy`：
- `Forbid`：上次未完成则跳过本次（防止任务堆积）
- `Replace`：终止上次运行，启动本次
- `Allow`：允许并行（默认，需确认业务幂等）

### 3.9 Namespace 与资源隔离

```
多租户隔离三板斧：

Namespace（逻辑隔离层）
├── ResourceQuota ← 命名空间级资源总量上限
│   · requests.cpu: "20"       （该 NS 下所有 Pod CPU requests 总和 ≤ 20核）
│   · limits.memory: "40Gi"    （memory limits 总和 ≤ 40G）
│   · count/pods: 100          （最多 100 个 Pod）
│
├── LimitRange ← Pod/Container 级默认值与上下限
│   · default requests: cpu=100m, memory=128Mi  （Pod 不写 requests 就用默认值）
│   · max limits: cpu=4, memory=8Gi             （单 Pod 不能超过）
│   · min requests: cpu=50m, memory=64Mi        （单 Pod 不能低于）
│
└── NetworkPolicy ← 网络微隔离（详见第五章）
```

> **实践建议**：生产集群按团队/环境（dev/staging/prod）划分 Namespace；配合 ResourceQuota 避免某个 NS 耗尽集群资源；LimitRange 确保所有 Pod 都设了 requests/limits（否则无法被 QoS 正确分级）。

### 3.10 面试标准答法
> K8s 核心对象：Pod 是最小调度单元；Deployment 管理无状态 Pod（滚动更新/回滚）；StatefulSet 管理有状态应用（有序启停+稳定存储+稳定网络标识）；DaemonSet 保证每节点运行守护进程；Job/CronJob 处理批处理/定时任务；Service 提供稳定 VIP 和负载均衡；Ingress 实现 7 层 HTTP 路由。多租户通过 Namespace + ResourceQuota + LimitRange 实现资源隔离。

### 3.11 常见追问
| 追问 | 关键答点 |
|------|----------|
| Deployment 和 ReplicaSet 关系？ | Deployment 管理 ReplicaSet 版本历史，实现滚动更新和回滚；直接用 RS 则无版本管理 |
| Service 如何找到对应 Pod？ | Label Selector；Endpoints 对象动态记录匹配 Pod 的 IP:Port；kube-proxy 同步到转发规则 |
| Secret 安全吗？ | 仅 base64 编码，不安全！生产应用 HashiCorp Vault / 云厂商 KMS 加密 |
| DaemonSet 和 Deployment 的核心区别？ | DaemonSet 每节点一个（跟随 Node 数），controller 直接绑定；Deployment 比数自定义，scheduler 调度 |
| Job 失败了会怎样？ | 根据 backoffLimit 指数退避重试；超过则 Job 标记失败；activeDeadlineSeconds 可设全局超时 |
| ResourceQuota 超限会怎样？ | 新 Pod 创建被拒绝（Forbidden），已运行 Pod 不受影响 |

---

## 四、Pod 调度机制 ⭐⭐⭐

### 4.1 调度流程

```
Pending Pod → kube-scheduler

① 过滤（Predicates/Filter）：
   - NodeResourcesFit：资源是否够（requests）
   - NodeAffinity：节点亲和性规则
   - TaintToleration：污点和容忍
   - PodAffinity/Anti-Affinity：Pod 亲和性
   → 过滤出候选 Node 列表

② 打分（Priorities/Score）：
   - NodeResourcesBalancedAllocation：资源均衡分配
   - ImageLocality：Node 上是否有镜像缓存
   - InterPodAffinity：Pod 亲和性加分
   → 选出最高分 Node

③ 绑定（Bind）：
   - scheduler 通过 apiserver 更新 Pod.Spec.NodeName
   - kubelet Watch 到绑定事件，启动 Pod
```

### 4.2 节点选择方式

```yaml
# ① nodeSelector（简单标签匹配）
spec:
  nodeSelector:
    disk: ssd
    zone: cn-hangzhou

# ② nodeAffinity（更强大，可软硬约束）
spec:
  affinity:
    nodeAffinity:
      requiredDuringSchedulingIgnoredDuringExecution:  # 硬约束，必须满足
        nodeSelectorTerms:
        - matchExpressions:
          - key: zone
            operator: In
            values: [cn-hangzhou, cn-beijing]
      preferredDuringSchedulingIgnoredDuringExecution:  # 软约束，尽量满足
      - weight: 100
        preference:
          matchExpressions:
          - key: disk
            operator: In
            values: [ssd]
```

### 4.3 Taint & Toleration（污点与容忍）

```yaml
# Node 打污点（不接受普通 Pod）
kubectl taint nodes node1 key=value:NoSchedule
kubectl taint nodes master node-role.kubernetes.io/control-plane:NoSchedule

# Pod 容忍污点（才能调度到该 Node）
spec:
  tolerations:
  - key: "key"
    operator: "Equal"
    value: "value"
    effect: "NoSchedule"

# Effect 类型：
# NoSchedule：不调度（已有 Pod 不驱逐）
# PreferNoSchedule：尽量不调度
# NoExecute：不调度且驱逐已有 Pod（可设 tolerationSeconds 宽限期）
```

### 4.4 Pod 亲和性与反亲和性

```yaml
spec:
  affinity:
    # Pod 亲和性：同一 Node/Zone 上尽量放一起
    podAffinity:
      preferredDuringSchedulingIgnoredDuringExecution:
      - weight: 100
        podAffinityTerm:
          labelSelector:
            matchLabels:
              app: cache
          topologyKey: kubernetes.io/hostname

    # Pod 反亲和性：副本分散到不同 Node（高可用）
    podAntiAffinity:
      requiredDuringSchedulingIgnoredDuringExecution:
      - labelSelector:
          matchLabels:
            app: my-app
        topologyKey: kubernetes.io/hostname  # 每个 Node 最多一个副本
```

### 4.5 面试标准答法
> K8s 调度分两步：过滤（排除不满足条件的 Node）和打分（选最优 Node）。控制 Pod 调度位置的手段：nodeSelector/nodeAffinity 控制 Pod→Node 吸引；Taint/Toleration 控制 Node 排斥/接受；podAntiAffinity 副本分散到不同节点实现高可用。

### 4.6 常见追问
| 追问 | 关键答点 |
|------|----------|
| 如何实现 Pod 分散到不同可用区？ | podAntiAffinity + topologyKey: topology.kubernetes.io/zone |
| DaemonSet 是如何调度的？ | 不经过 scheduler，controller-manager 直接将 Pod 绑定到每个 Node |
| 资源 request 和 limit 区别？ | request 是调度依据（节点可用 ≥ request 才调度）；limit 是运行时上限（超 CPU 被限流，超内存 OOM） |

---

## 五、服务发现与网络 ⭐⭐⭐

### K8s 网络模型三大规则

K8s 要求所有网络实现（CNI 插件）必须满足：

| 规则 | 含义 |
|------|------|
| **Pod ↔ Pod 互通** | 所有 Pod 间不经 NAT 即可直接通信 |
| **Node ↔ Pod 互通** | Node 可直接访问任意 Pod IP |
| **IP 一致性** | Pod 看到的自身 IP = 其他 Pod/Node 看到的 IP |

**同节点通信**：Pod → veth pair → cni0 网桥 → veth pair → 目标 Pod（二层转发）。

**跨节点通信**（两种主流方案）：

| 方案 | 原理 | 代表插件 | 优劣 |
|------|------|---------|------|
| **Overlay 封装** | Pod 报文用 VXLAN/UDP 封装，经物理网络传输后解封装 | Flannel VXLAN | 对底层网络无要求，但有封装开销 |
| **BGP 路由** | 每个 Node 通过 BGP 宣告 Pod CIDR，三层直接路由 | Calico BGP | 性能最优，需网络设备支持 BGP |
| **eBPF** | 内核态直接处理网络包，旁路 iptables | Cilium | 性能极高 + 7 层感知，内核版本要求高 |

### 5.1 DNS 服务发现（CoreDNS）

```
集群内服务访问格式：
  <service-name>.<namespace>.svc.cluster.local

示例：
  同命名空间：直接用 service 名  → curl http://user-service
  跨命名空间：curl http://user-service.prod.svc.cluster.local
  Headless Pod：redis-0.redis-headless.default.svc.cluster.local

CoreDNS（取代 kube-dns）：
  - 基于 Go 的 DNS 服务器
  - 进程级插件链（health/kubernetes/forward 等）
  - 支持自定义 DNS 策略
```

### 5.2 kube-proxy 模式对比

| 模式 | 原理 | 适用版本 |
|------|------|----------|
| iptables（默认） | 随机 DNAT 规则，O(n) 规则匹配 | 通用 |
| **ipvs**（推荐） | 内核级 LB，O(1) hash 查找，支持多种 LB 算法（rr/lc/sh 等） | 大规模集群推荐 |
| userspace（废弃） | 用户态代理，性能差 | 已废弃 |

### 5.3 CNI 网络插件

| 插件 | 特性 | 适用场景 |
|------|------|----------|
| **Flannel** | VXLAN 或 host-gw 模式，简单易用 | 中小集群 |
| **Calico** | BGP 路由或 VXLAN，支持 NetworkPolicy | 生产大规模 |
| **Cilium** | eBPF 内核级实现，高性能 + 7层感知 | 高性能场景 |

### 5.4 NetworkPolicy（网络隔离）

```yaml
# 默认 Pod 互通；NetworkPolicy 实现微隔离
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
spec:
  podSelector:
    matchLabels:
      app: database
  policyTypes: [Ingress]
  ingress:
  - from:
    - podSelector:       # 只允许 app=backend 的 Pod 访问
        matchLabels:
          app: backend
    ports:
    - port: 3306
```

### 5.5 面试标准答法
> K8s 服务发现基于 CoreDNS，Pod 通过 `<service>.<namespace>.svc.cluster.local` 域名访问服务。Service 背后是 kube-proxy 维护的 iptables/ipvs 转发规则（推荐 ipvs，O(1) 查找）。Pod 间网络通过 CNI 插件（Flannel/Calico/Cilium）实现跨节点通信，NetworkPolicy 实现网络微隔离。

---

## 六、存储（PV/PVC）⭐⭐

### 6.1 存储层次

```
StorageClass（存储类，定义存储类型/供应商）
    ↓ 动态供给（Dynamic Provisioning）
PersistentVolume（PV，集群级存储资源，管理员创建或自动创建）
    ↓ 绑定（1:1 对应）
PersistentVolumeClaim（PVC，命名空间级存储请求，开发声明）
    ↓ 挂载
Pod 的 Volume
```

### 6.2 PVC 生命周期

```
① 用户创建 PVC（声明需要 10Gi ReadWriteOnce 存储）
② K8s 寻找满足条件的 PV 进行绑定
   - 静态：管理员预创建 PV
   - 动态：StorageClass provisioner 自动创建 PV（推荐）
③ Pod 挂载 PVC 使用存储
④ Pod 删除：PVC 保留，数据不丢失
⑤ PVC 删除：PV 根据 reclaimPolicy 处理
   - Retain：保留 PV 数据，需手动清理
   - Delete：自动删除底层存储（云盘等）
   - Recycle（废弃）：清空数据后重用
```

### 6.3 访问模式

| 模式 | 说明 | 典型存储 |
|------|------|----------|
| ReadWriteOnce (RWO) | 单 Node 读写 | 云盘（AWS EBS/阿里云盘） |
| ReadOnlyMany (ROX) | 多 Node 只读 | NFS |
| ReadWriteMany (RWX) | 多 Node 读写 | NFS、CephFS、NAS |

### 6.4 CSI（Container Storage Interface）

```
CSI 将存储能力从 K8s 核心解耦为标准化外部插件：

K8s 核心                              CSI 驱动（存储厂商独立维护）
┌─────────────────┐                  ┌──────────────────────────┐
│ PV Controller    │                  │ CSI Controller Plugin     │
│ Attach/Detach   │ ←── gRPC ───→    │  CreateVolume / Attach    │
│ Controller      │                  │                          │
│ kubelet         │ ←── gRPC ───→    │ CSI Node Plugin           │
│                 │                  │  Mount / Format / Unmount │
└─────────────────┘                  └──────────────────────────┘
```

**CSI 核心价值**：
- 存储厂商独立发布驱动，不依赖 K8s 版本发布周期
- 统一接口标准（AWS EBS / 阿里云盘 / Ceph 均实现 CSI）
- 支持高级功能：**VolumeSnapshot**（快照备份恢复）、**在线扩容**（不停服扩大 PVC）、**克隆**

### 6.5 常用存储方案对比

| 存储方案 | 类型 | 访问模式 | 适用场景 | 性能 |
|---------|------|---------|---------|------|
| 云盘（EBS/阿里云盘） | 块存储 | RWO | 数据库（MySQL/MongoDB） | 高 |
| NFS / NAS | 文件存储 | RWX | 共享配置/日志/静态资源 | 中 |
| Ceph RBD | 块存储 | RWO | 自建高可用分布式存储 | 高 |
| CephFS | 文件存储 | RWX | 自建共享存储 | 中高 |
| Local PV | 本地磁盘 | RWO | 极致性能（ES/Kafka/etcd），节点故障数据不可恢复 | 极高 |
| emptyDir | 临时卷 | — | Pod 内容器共享临时数据，Pod 删除即丢失 | 取决配置 |

> **选型原则**：有状态服务优先块存储（性能+独占）；共享场景用文件存储（RWX）；Local PV 性能最高但必须配合应用层副本机制容灾；emptyDir 仅做临时缓存。

### 6.6 常见追问
| 追问 | 关键答点 |
|------|----------|
| PV 和 PVC 是什么关系？ | PV 是集群级存储资源（管理员/动态创建）；PVC 是命名空间级存储请求（开发声明）；1:1 绑定 |
| 动态供给和静态供给区别？ | 静态：管理员预创建 PV；动态：PVC 创建后 StorageClass provisioner 自动创建 PV（推荐） |
| Pod 删除后数据丢吗？ | PVC 还在则数据不丢；PVC 删除后看 reclaimPolicy：Retain 保留，Delete 自动删 |
| StatefulSet 存储有什么特殊？ | 每个 Pod 通过 volumeClaimTemplates 自动创建独立 PVC，Pod 重建后重新绑定同一 PVC |

### 6.7 面试标准答法
> K8s 存储三层抽象：StorageClass → PV → PVC。CSI 标准化了存储接口，驱动独立于 K8s 核心发布。动态供给是生产主流（PVC 创建 → provisioner 自动创建 PV 绑定）。StatefulSet 每个 Pod 绑定独立 PVC 实现数据持久化。回收策略 Retain 安全保留数据，Delete 自动清理。块存储适合数据库（性能+独占），文件存储适合共享场景（RWX）。

---

## 七、健康检查与自动扩缩容 ⭐⭐⭐

### 7.1 三种探针

| 探针 | 失败行为 | 用途 |
|------|----------|------|
| **livenessProbe** | 重启容器 | 检测应用是否存活（如死锁） |
| **readinessProbe** | 从 Service Endpoints 中摘除 | 检测应用是否就绪，防止流量打到未就绪 Pod |
| **startupProbe** | 重启容器 | 慢启动应用保护（先于 liveness 执行） |

```yaml
livenessProbe:
  httpGet:
    path: /actuator/health/liveness
    port: 8080
  initialDelaySeconds: 60   # 启动后 60s 开始探测
  periodSeconds: 10          # 每 10s 探测一次
  failureThreshold: 3        # 失败 3 次重启

readinessProbe:
  httpGet:
    path: /actuator/health/readiness
    port: 8080
  periodSeconds: 5
  failureThreshold: 3
```

### 7.2 HPA 水平自动扩缩容

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: my-app
  minReplicas: 2
  maxReplicas: 20
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70   # CPU 超 70% 扩容
  - type: External              # 自定义指标（如 QPS）
    external:
      metric:
        name: requests-per-second
      target:
        type: AverageValue
        averageValue: "1000"
```

扩缩容策略：
- **扩容**：每 15s 检测一次，QPS 高时快速扩容（默认每次可扩 100%）
- **缩容**：5 分钟内没有稳定降低不缩容，防止抖动

### 7.3 Pod QoS 等级与驱逐顺序

K8s 根据 requests/limits 配置**自动划分** QoS 等级，节点资源不足时按优先级驱逐：

| QoS 等级 | 条件 | 驱逐顺序 | 典型用途 |
|----------|------|---------|----------|
| **Guaranteed** | 所有容器 requests **=** limits | 最后驱逐 | 核心服务（数据库/网关） |
| **Burstable** | 至少一个容器 requests **<** limits | 中间 | 普通业务服务 |
| **BestEffort** | 所有容器都**未设** requests/limits | 最先驱逐 | 开发测试/批处理任务 |

OOM 时 kubelet 驱逐顺序：BestEffort → Burstable（按实际使用超出 requests 的比例排序）→ Guaranteed。

> **生产建议**：核心服务设 Guaranteed（requests=limits）；普通服务 Burstable 但 requests 要合理估算（过低导致调度不均、频繁被驱逐；过高浪费资源）；永远不要裸跑 BestEffort。

### 7.4 PodDisruptionBudget（PDB）

PDB 保证**主动运维操作**（`kubectl drain` / 节点升级 / 集群缩容）时最少可用副本数：

| 参数 | 说明 | 适用场景 |
|------|------|----------|
| `minAvailable` | 驱逐后至少剩几个 Pod 可用 | 关键服务（至少 N 副本在线） |
| `maxUnavailable` | 允许同时不可用几个 Pod | 大规模服务（允许少量不可用，加快滚动） |

> ⚠️ PDB **只约束主动驱逐**（drain/evict），不阻止 Node 宕机等被动故障。生产环境每个 Deployment 都应配 PDB。

### 7.5 VPA（垂直自动扩缩容）

| 维度 | HPA（水平） | VPA（垂直） |
|------|------------|------------|
| 扩缩方式 | 增减 Pod 数量 | 调整单 Pod 的 requests/limits |
| 适用场景 | 无状态服务（流量波动） | 单副本有状态服务 / JVM 应用 |
| 成熟度 | 生产就绪 | 需谨慎使用（修改 requests 会重建 Pod） |
| 组合使用 | 不建议 HPA + VPA 同时基于 CPU；可 HPA 用自定义指标 + VPA 用 CPU/MEM |

VPA 三种模式：
- `Off`：只推荐值，不自动修改（安全审计用，推荐先用此模式观察）
- `Initial`：只对新创建 Pod 设值，不重建已有 Pod
- `Auto`：自动修改 requests 并重建 Pod（生产慎用）

### 7.6 优雅停机全流程

```
Pod 进入 Terminating 后的完整事件序列：

  ① apiserver 标记 Pod terminating
  ② 并行触发两件事：
     ├─ Endpoints Controller 从 Service 摘除 Pod IP
     │   → kube-proxy 更新 iptables/ipvs（有传播延迟 1~3s）
     │
     └─ kubelet 执行 preStop Hook
        （如 exec: sleep 5，等待 LB 规则生效）
        │
        ↓
  ③ preStop 完成后，发送 SIGTERM 给容器主进程（PID=1）
     → 应用应监听 SIGTERM：停止接受新请求 + 等待处理中请求完成
        │
        ↓
  ④ 等待 terminationGracePeriodSeconds（默认 30s）
        │
        ↓
  ⑤ 超时仍未退出 → SIGKILL 强制终止
```

**关键配置**：
- `preStop`：`sleep 3~5s` 或调用下线接口，**等待 LB 摘除传播完成**
- `terminationGracePeriodSeconds`：根据业务最大请求处理时间设置（Java 应用建议 60s）
- 应用层配合：Spring Boot `server.shutdown=graceful` + `spring.lifecycle.timeout-per-shutdown-phase=30s`

### 7.7 面试标准答法
> 三种探针保障 Pod 生命周期：startupProbe 保护慢启动；readinessProbe 控制流量就绪（未就绪不接流量）；livenessProbe 重启异常进程。QoS 三级（Guaranteed > Burstable > BestEffort）决定 OOM 驱逐顺序。HPA 水平扩缩 Pod 数，VPA 垂直调整单 Pod 资源，PDB 保证运维操作时最小可用副本。优雅停机核心链路：preStop 等待 LB 摘除 → SIGTERM 让应用排空请求 → terminationGracePeriodSeconds 超时兜底 → SIGKILL。

---

## 八、K8s 故障排查 ⭐⭐⭐

### 8.1 Pod 常见异常状态

| 状态 | 原因 | 排查 |
|------|------|------|
| Pending | 资源不足/无匹配 Node/PVC 未绑定 | `kubectl describe pod` 看 Events |
| CrashLoopBackOff | 容器启动失败反复重启 | `kubectl logs <pod> --previous` 看前次日志 |
| OOMKilled | 内存超出 limit | `kubectl describe pod` 看 Last State；调大 memory limit |
| ImagePullBackOff | 镜像拉取失败 | 检查镜像名/tag/仓库权限（imagePullSecret） |
| Terminating（卡住） | 有 Finalizer 未处理/节点失联 | 强制删除：`kubectl delete pod xxx --force --grace-period=0` |
| CreateContainerConfigError | ConfigMap/Secret 不存在 | 检查依赖资源是否已创建 |

### 8.2 常用排查命令

```bash
# 查看 Pod 详细信息（Events 中有错误原因）
kubectl describe pod <pod-name> -n <namespace>

# 查看当前日志
kubectl logs <pod-name> -c <container-name> -n <namespace>

# 查看上次崩溃的日志
kubectl logs <pod-name> --previous

# 进入容器执行命令
kubectl exec -it <pod-name> -c <container-name> -- /bin/sh

# 查看资源使用情况
kubectl top pod -n <namespace>
kubectl top node

# 查看 Service Endpoints（确认 Pod 是否在 Endpoint 列表中）
kubectl get endpoints <service-name>

# 查看事件（全局事件流）
kubectl get events --sort-by=.metadata.creationTimestamp -n <namespace>

# 临时调试（注入调试容器）
kubectl debug <pod-name> -it --image=busybox --target=<container>
```

### 8.3 节点故障排查

```bash
# 查看节点状态
kubectl get nodes -o wide
kubectl describe node <node-name>

# 常见 Node 问题：
# NotReady：kubelet 宕机；网络故障；磁盘压力
# MemoryPressure/DiskPressure：资源耗尽，K8s 自动驱逐 Pod（Evict）

# 节点临时不可调度（维护时）
kubectl cordon <node-name>     # 标记不可调度
kubectl drain <node-name>      # 驱逐所有 Pod（保留 DaemonSet）
kubectl uncordon <node-name>   # 恢复调度
```

### 8.4 网络排查

```bash
# 测试 DNS 解析
kubectl run tmp --image=busybox --rm -it -- nslookup user-service.prod

# 测试 Service 连通性
kubectl run tmp --image=curlimages/curl --rm -it -- curl http://user-service:8080/health

# 查看 Service 的 iptables 规则
iptables -t nat -L KUBE-SERVICES | grep <service-cluster-ip>

# 查看 ipvs 规则
ipvsadm -Ln | grep <service-cluster-ip>
```

### 8.5 面试标准答法
> 排查 Pod 问题首先 `kubectl describe pod` 看 Events（调度失败/镜像问题/探针失败都在这里）；再看 `kubectl logs --previous`（CrashLoopBackOff 时查上次日志）；`kubectl top` 看资源使用；`kubectl get endpoints` 确认流量路由是否正确。

### 8.6 常见追问
| 追问 | 关键答点 |
|------|----------|
| Pod 一直 Pending 怎么排查？ | describe 看 Events：① 资源不足（扩容 Node 或降低 requests）；② 调度约束冲突（检查 nodeAffinity/Taint）；③ PVC 未绑定（检查 StorageClass） |
| CrashLoopBackOff 和 OOMKilled 区别？ | CrashLoopBackOff 是进程退出（看 exit code 和日志）；OOMKilled 是内存超 limit（调大 limit 或优化应用内存） |
| K8s 如何实现零停机部署？ | Deployment 滚动更新 + readinessProbe 确保新 Pod 就绪才摘除旧 Pod + preStop hook 优雅停机（等待连接处理完） |

---

## 九、Service Mesh & Istio ⭐⭐⭐

### 9.0 K8s、Service Mesh、Istio 三者关系

理解三者关系是面试高频考点，先看整体定位：

```
┌───────────────────────────────────────────────────────────────────┐
│                       应用层（业务代码）                            │
│   Spring Boot / Go / Node.js …  ← 只关注业务逻辑                 │
├───────────────────────────────────────────────────────────────────┤
│                  Service Mesh 层（服务治理）                       │
│   流量管理 · 熔断重试 · mTLS · 可观测性 · 灰度发布                │
│   ┌────────────────────────────────────────────┐                  │
│   │  Istio（控制平面）  +  Envoy（数据平面）      │ ← 最主流实现    │
│   │  其他实现：Linkerd · Cilium Mesh · Consul    │                 │
│   └────────────────────────────────────────────┘                  │
├───────────────────────────────────────────────────────────────────┤
│                  Kubernetes 层（容器编排）                         │
│   Pod 调度 · Service 发现 · 滚动更新 · 存储 · 扩缩容              │
├───────────────────────────────────────────────────────────────────┤
│                  基础设施层                                        │
│   Node（物理机/云VM）· 网络（CNI）· 存储（CSI）                    │
└───────────────────────────────────────────────────────────────────┘
```

**类比理解**：
- **K8s** = 城市（提供道路、地块、水电 → 容器编排基础设施）
- **Service Mesh** = 交通管理系统的理念（红绿灯、限速、监控摄像头 → 服务治理规范）
- **Istio** = 具体的智慧交通方案（安装了 Envoy 这套硬件 + istiod 调度中心来落地这套理念）

| 层次 | 解决什么问题 | 核心能力 | 是否必须 |
|------|------------|----------|----------|
| **K8s** | 容器怎么部署、调度、扩缩容 | Pod/Service/Deployment/HPA | 是（云原生基座） |
| **Service Mesh** | 服务间通信怎么治理（一种架构模式） | 流量管理/安全/可观测性 | 否（中小规模可不用） |
| **Istio** | Service Mesh 的具体实现方案 | istiod 控制平面 + Envoy 数据平面 | 否（可选 Linkerd/Cilium 等替代） |

> **关键结论**：K8s 是基础，解决"容器如何运行"；Service Mesh 是 K8s 之上的服务治理层，解决"服务间如何安全高效通信"；Istio 是实现 Service Mesh 的一种具体方案。三者是**分层递进**关系，不是替代关系。

### 9.1 为什么需要 Service Mesh

#### 微服务治理的演进

```
第一代：代码内嵌（每个服务自己实现）
  Spring Cloud Hystrix / Ribbon / Sleuth / Zuul
  问题 → 多语言不统一；治理逻辑和业务耦合；SDK 升级需改代码重新发布

第二代：Service Mesh（基础设施层统一接管）
  Envoy Sidecar 代理全部流量
  解决 → 语言无关；业务零侵入；统一升级控制平面即可
  
第三代（演进中）：Sidecarless / Ambient Mesh
  Cilium eBPF 内核态拦截 / Istio Ambient（ztunnel + waypoint proxy）
  解决 → 去掉 Sidecar 资源开销和延迟
```

#### Service Mesh 核心能力矩阵

| 能力域 | 具体能力 | K8s 原生是否支持 | Istio 如何实现 |
|--------|---------|-----------------|----------------|
| **流量管理** | 金丝雀/蓝绿/A-B 路由 | ❌ 只有滚动更新 | VirtualService 按权重/Header/URL 路由 |
| | 超时/重试/故障注入 | ❌ | VirtualService 配置 timeout/retries/fault |
| | 熔断/连接池限制 | ❌ | DestinationRule outlierDetection/connectionPool |
| **安全** | 服务间 mTLS 加密 | ❌ | PeerAuthentication 自动签发/轮转证书 |
| | 服务级访问控制（RBAC） | ❌（只有 Pod 级 NetworkPolicy） | AuthorizationPolicy 精细到方法级别 |
| **可观测性** | 请求级指标（延迟/QPS/错误率） | ❌ | Envoy 自动采集 → Prometheus |
| | 分布式链路追踪 | ❌ | Envoy 自动注入 Trace Header → Jaeger/Zipkin |
| | 访问日志 | ❌ | Envoy 标准化访问日志 |
| **弹性** | 负载均衡策略（轮询/加权/最少连接） | ✅ 仅 iptables/ipvs 随机/轮询 | DestinationRule 多算法 + 区域感知 |

### 9.2 Istio 架构详解

```
┌─────────────────────────── 控制平面 ──────────────────────────────┐
│                                                                    │
│  istiod（单进程，包含以下逻辑模块）：                               │
│                                                                    │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────────┐  │
│  │ Pilot   │  │ Citadel  │  │ Galley   │  │ Sidecar Injector  │  │
│  │ 流量规则 │  │ 证书管理  │  │ 配置校验  │  │ 自动注入 Envoy    │  │
│  │ xDS分发  │  │ mTLS签发  │  │ Webhook  │  │ MutatingWebhook  │  │
│  └────┬────┘  └────┬─────┘  └──────────┘  └───────────────────┘  │
│       │            │                                               │
│       │  xDS（gRPC 长连接，推送配置）                               │
│       │            │                                               │
└───────┼────────────┼───────────────────────────────────────────────┘
        ↓            ↓
┌─────────────────────────── 数据平面 ──────────────────────────────┐
│                                                                    │
│  Pod A                              Pod B                          │
│  ┌───────────┐  ┌──────────┐       ┌──────────┐  ┌───────────┐   │
│  │ App 容器   │→│ Envoy    │──────→│ Envoy    │→│ App 容器   │   │
│  │           │  │ Sidecar  │ mTLS  │ Sidecar  │  │           │   │
│  └───────────┘  └──────────┘       └──────────┘  └───────────┘   │
│                  ↑ iptables                                        │
│                  劫持所有流量                                       │
└────────────────────────────────────────────────────────────────────┘
```

**数据平面关键机制**：
- **流量劫持**：Pod 启动时 init 容器写入 iptables REDIRECT 规则，将所有 TCP 出入流量转发到 Envoy（15001/15006 端口）
- **xDS 协议**：Envoy 通过 gRPC 长连接从 istiod 获取配置（LDS 监听器/RDS 路由/CDS 集群/EDS 端点），**增量下发**而非全量
- **热更新**：路由规则变更 → istiod 推送新 xDS → Envoy 热加载，**无需重启 Pod**

**Sidecar 注入方式**：
- **自动注入**（推荐）：Namespace 打标签 `istio-injection=enabled`，istiod 的 MutatingWebhook 自动给新 Pod 注入 Envoy 容器
- **手动注入**：`istioctl kube-inject -f deployment.yaml`

### 9.3 Istio 核心 CRD 全景

| CRD | 作用 | 典型场景 |
|-----|------|---------|
| **VirtualService** | 定义流量路由规则（匹配条件 → 目标） | 金丝雀发布、A/B 测试、故障注入 |
| **DestinationRule** | 定义目标服务的策略（子集/负载均衡/连接池/熔断） | 版本分组、熔断配置、区域感知负载均衡 |
| **Gateway** | 管理入口流量（类比 K8s Ingress，但更强大） | HTTPS 终止、多域名路由 |
| **PeerAuthentication** | 控制 mTLS 模式（STRICT/PERMISSIVE/DISABLE） | 渐进式开启 mTLS |
| **AuthorizationPolicy** | 服务级访问控制（允许/拒绝/自定义） | 只允许 frontend 调 user-service 的 GET /api/user |
| **ServiceEntry** | 将外部服务注册到 Mesh 内（纳入治理） | 访问外部数据库/第三方 API 也走 Envoy |
| **Sidecar** | 限制 Envoy 可见的服务范围（降低内存消耗） | 大集群中每个服务只关注自己的依赖 |

#### 关键 CRD 配置示例

```yaml
# VirtualService：金丝雀 + 超时重试 + 故障注入
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
spec:
  hosts: [user-service]
  http:
  - match:
    - headers:
        x-canary: { exact: "true" }
    route:
    - destination: { host: user-service, subset: v2 }
  - route:
    - destination: { host: user-service, subset: v1, weight: 90 }
    - destination: { host: user-service, subset: v2, weight: 10 }
    timeout: 3s                    # 请求超时
    retries:                       # 自动重试
      attempts: 3
      perTryTimeout: 1s
      retryOn: 5xx,connect-failure
    fault:                         # 故障注入（测试用）
      delay:
        percentage: { value: 5 }
        fixedDelay: 2s             # 5% 请求注入 2s 延迟

---
# DestinationRule：版本子集 + 熔断 + 负载均衡
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
spec:
  host: user-service
  trafficPolicy:
    loadBalancer:
      simple: LEAST_REQUEST        # 最少请求优先（比默认 ROUND_ROBIN 更优）
    connectionPool:
      tcp: { maxConnections: 100 }
      http: { h2UpgradePolicy: UPGRADE, http2MaxRequests: 1000 }
    outlierDetection:              # 异常检测（自动熔断）
      consecutive5xxErrors: 5      # 连续 5 次 5xx
      interval: 10s                # 检测间隔
      baseEjectionTime: 30s        # 最短驱逐时间
      maxEjectionPercent: 50       # 最多驱逐 50% 实例
  subsets:
  - name: v1
    labels: { version: v1 }
  - name: v2
    labels: { version: v2 }

---
# AuthorizationPolicy：精细访问控制
apiVersion: security.istio.io/v1beta1
kind: AuthorizationPolicy
spec:
  selector:
    matchLabels: { app: user-service }
  rules:
  - from:
    - source: { principals: ["cluster.local/ns/default/sa/frontend"] }
    to:
    - operation: { methods: ["GET"], paths: ["/api/user/*"] }
  # 效果：只有 frontend 的 ServiceAccount 可以 GET /api/user/*
```

### 9.4 Istio 可观测性三大支柱

| 支柱 | Istio 自动提供 | 对接后端 | 无 Istio 时需要 |
|------|---------------|---------|-----------------|
| **指标（Metrics）** | Envoy 自动采集每个请求的延迟/QPS/错误率/字节数 | Prometheus + Grafana | 代码埋点 Micrometer/自定义指标 |
| **链路追踪（Tracing）** | Envoy 自动注入 `x-request-id`/`x-b3-*` 等 Trace Header | Jaeger / Zipkin / SkyWalking | 手动集成 Sleuth/OpenTelemetry SDK |
| **访问日志（Logging）** | Envoy 标准化访问日志（来源IP/目标/状态码/延迟/UA） | ELK / Loki | 应用自行输出结构化日志 |

> ⚠️ **链路追踪注意**：Envoy 只负责注入/转发 Trace Header，**应用代码必须透传这些 Header**（如 `x-request-id`），否则链路会断。Spring Boot 用 `spring-cloud-sleuth` 或 `micrometer-tracing` 自动透传。

### 9.5 K8s + Istio vs Spring Cloud 全维度对比 ⭐⭐⭐

这是面试最高频的对比题，从架构理念到具体能力逐项展开：

#### 架构本质差异

```
Spring Cloud 微服务（SDK 模式）：               K8s + Istio（Sidecar 模式）：

┌─────────────────┐                          ┌─────────────────┐
│   业务代码       │                          │   业务代码       │  ← 纯净，无治理代码
│ + Feign 调用    │                          │                 │
│ + Hystrix 熔断  │                          └────────┬────────┘
│ + Ribbon 负载   │                                   │
│ + Sleuth 追踪   │                          ┌────────┴────────┐
│ + Config 配置   │                          │  Envoy Sidecar  │  ← 治理能力在此
└─────────────────┘                          │  流量/安全/可观测 │
  SDK 侵入应用进程                            └─────────────────┘
  治理和业务耦合                                基础设施层治理
                                               业务和治理解耦
```

#### 逐项功能对比

| 能力 | Spring Cloud（Alibaba） | K8s 原生 | K8s + Istio |
|------|-------------------------|----------|-------------|
| **服务注册发现** | Nacos / Eureka（SDK 注册） | Service + CoreDNS（声明式） | 同 K8s + Envoy EDS 动态感知 |
| **负载均衡** | Ribbon / LoadBalancer（客户端 SDK） | kube-proxy iptables/ipvs（四层） | Envoy（七层，支持最少连接/加权/区域感知） |
| **熔断降级** | Sentinel / Hystrix（代码注解/规则配置） | ❌ 无 | DestinationRule outlierDetection |
| **限流** | Sentinel（QPS/线程数/热点参数） | ❌ 无 | Envoy rate limit（需搭配限流服务） |
| **超时重试** | Feign timeout / Ribbon retry（代码配置） | ❌ 无 | VirtualService timeout/retries（YAML 配置） |
| **流量路由** | Gateway 路由谓词（Path/Header/权重） | Ingress（基础 Path/Host 路由） | VirtualService（精细到 Header/Cookie/百分比） |
| **灰度发布** | 需自行实现 Gateway + 版本路由 | Deployment 滚动更新（无法按比例灰度） | VirtualService 权重路由（原生支持金丝雀） |
| **配置中心** | Nacos Config / Apollo（推拉模式） | ConfigMap/Secret（无版本回滚/灰度发布） | 同 K8s（Istio 不管业务配置） |
| **服务间安全** | 手动配 HTTPS/SSL | NetworkPolicy（三/四层隔离） | mTLS 自动加密 + AuthorizationPolicy 七层授权 |
| **链路追踪** | Sleuth + Zipkin / SkyWalking（SDK 集成） | ❌ 无 | Envoy 自动采集（需应用透传 Header） |
| **指标监控** | Micrometer + Prometheus（代码埋点） | cAdvisor/kube-state-metrics（容器/集群级） | Envoy 自动请求级指标（Prometheus） |
| **API 网关** | Spring Cloud Gateway（Java 进程） | Ingress Controller（Nginx/Traefik） | Istio Gateway + Envoy（统一治理） |
| **分布式事务** | Seata（AT/TCC/Saga） | ❌ 无 | ❌ 无（事务是业务层问题） |

#### 核心差异总结

| 维度 | Spring Cloud | K8s + Istio |
|------|-------------|-------------|
| **治理位置** | SDK 嵌入应用进程（第二代） | Sidecar 代理/基础设施层（第三代） |
| **语言耦合** | 仅 Java | 语言无关（Go/Python/Node 通用） |
| **升级方式** | 改 POM → 重新编译 → 重新部署 | 升级 istiod + Envoy Sidecar，业务不动 |
| **业务侵入** | 高（依赖 SDK、注解、配置） | 低（YAML 配置，业务代码几乎无感） |
| **运维复杂度** | 低（Java 开发熟悉） | 高（需掌握 K8s + Istio 两套） |
| **资源开销** | 无额外进程 | 每 Pod 多一个 Envoy（~50MB/~0.01CPU） |
| **性能影响** | 无额外网络跳转 | 增加 ~1ms 延迟（两次 Envoy 代理） |
| **适用团队** | 纯 Java 技术栈中小团队 | 多语言大团队/中台架构 |
| **成熟度** | 非常成熟，社区庞大 | 成熟但学习曲线陡峭 |

#### 如何选型（面试答法）

```
选 Spring Cloud 的场景：
  ✓ 纯 Java 技术栈
  ✓ 团队对 K8s 不熟悉
  ✓ 中小规模（50 微服务以内）
  ✓ 需要丰富的 Java 生态集成（Seata/Sentinel 控制台等）

选 K8s + Istio 的场景：
  ✓ 多语言技术栈（Java + Go + Python）
  ✓ 大规模微服务（100+）
  ✓ 强安全要求（mTLS / 零信任网络）
  ✓ 平台化 / 中台思维（统一治理能力）

混合模式（最常见的实际方案）：
  K8s 做容器编排 + Spring Cloud Alibaba 做 Java 层治理
  → 用 Nacos 注册配置 + Sentinel 限流 + Seata 事务
  → 流量路由用 Gateway，不引入 Istio
  → 等团队 K8s 成熟后逐步引入 Istio 替代 SDK 治理
```

### 9.6 Istio Ambient Mesh（Sidecarless 演进方向）

传统 Sidecar 模式每个 Pod 都多一个 Envoy，资源开销大。**Istio Ambient Mesh**（1.18+ 引入）是业界最新演进方向：

```
传统模式（Sidecar）：                Ambient 模式（Sidecarless）：

Pod 内                              Pod 内
┌─────────┬──────────┐              ┌─────────┐
│   App   │  Envoy   │              │   App   │  ← 无 Sidecar，轻量
│         │ Sidecar  │              └────┬────┘
└─────────┴──────────┘                   │
    每 Pod 一个 Envoy                     │
    ~50MB × N 个 Pod                     ↓
                                    ztunnel（四层安全隧道，每 Node 一个 DaemonSet）
                                      mTLS / L4 负载均衡 / 基础遥测
                                         │
                                    waypoint proxy（七层代理，按 NS/SA 部署）
                                      流量路由 / 熔断重试 / L7 策略
                                      只有需要七层能力的服务才部署
```

| 维度 | Sidecar 模式 | Ambient 模式 |
|------|-------------|-------------|
| 资源开销 | 高（每 Pod ~50MB） | 低（ztunnel 共享 + 按需 waypoint） |
| 延迟 | +~1ms（两跳） | 四层更低，七层与 Sidecar 相当 |
| 升级影响 | 需重建 Pod 更新 Envoy | ztunnel 滚动更新，不影响业务 Pod |
| 成熟度 | 生产就绪 | GA（1.22+），逐步成熟 |

### 9.7 面试标准答法
> **三者关系**：K8s 是容器编排基座，解决部署调度问题；Service Mesh 是 K8s 之上的服务治理层，解决服务间通信治理问题；Istio 是 Service Mesh 的最主流实现。三者分层递进而非替代。
>
> **vs Spring Cloud**：Spring Cloud 是 SDK 侵入式治理（应用内嵌限流/熔断/追踪库），仅支持 Java，升级需改代码重新部署；Istio 是 Sidecar 代理式治理（Envoy 拦截流量），语言无关，业务零侵入，通过 YAML 配置即可变更策略。Spring Cloud 适合纯 Java 中小团队，Istio 适合多语言大规模平台化团队，实际中常见混合模式（K8s + Spring Cloud Alibaba 做 Java 层治理，按需引入 Istio）。

### 9.8 常见追问
| 追问 | 关键答点 |
|------|----------|
| Sidecar 会带来哪些问题？ | ① 延迟增加（~1ms，两次代理跳转）；② 资源消耗（每 Pod ~50MB Envoy）；③ 调试复杂度上升；④ Pod 启动顺序问题（Envoy 未就绪时应用请求失败） |
| eBPF 和 Service Mesh 什么关系？ | Cilium 用 eBPF 在内核态拦截流量，替代 Sidecar 用户态代理，性能更高；Istio Ambient 模式的 ztunnel 也在探索 eBPF 加速 |
| Istio 的 xDS 是什么？ | Envoy 的动态配置发现协议族：LDS（监听器）、RDS（路由）、CDS（集群）、EDS（端点）、SDS（密钥），istiod 通过 gRPC 推送给 Envoy |
| Spring Cloud 能和 Istio 共存吗？ | 可以但**不推荐重叠**。常见策略：保留 Nacos 做配置中心 + Seata 事务（Istio 不管这些）；去掉 Ribbon/Feign LB/Hystrix（Envoy 接管）；去掉 Sleuth（Envoy 自动追踪） |
| Istio 性能怎么优化？ | ① Sidecar CRD 限制 Envoy 可见服务范围（减少 xDS 配置量）；② 减少 VirtualService/DestinationRule 数量（合并相似规则）；③ 使用 Ambient 模式减少资源；④ 关闭不需要的遥测采集 |
| 什么时候不适合用 Istio？ | 纯 Java 小团队（Spring Cloud 够用）；团队 K8s 不熟悉（引入复杂度过高）；对延迟极度敏感的高频交易系统（微秒级要求） |

---

## 十、云原生面试高频题速查 ⭐⭐⭐

### 10.1 K8s vs Docker Compose

| | K8s | Docker Compose |
|-|-----|----------------|
| 适用规模 | 大规模生产 | 本地开发/单机 |
| 高可用 | 内置（多副本/自愈） | 无 |
| 服务发现 | DNS/Service | 容器名 |
| 滚动更新 | 内置 | 手动 |
| 自动扩缩容 | HPA | 无 |

### 10.2 K8s 滚动更新过程

```
① 创建新 ReplicaSet（version=v2）
② 逐步扩容 v2 Pod，同时缩容 v1 Pod
③ readinessProbe 就绪后才接入流量
④ 全部 v2 就绪后 v1 ReplicaSet 缩到 0（保留历史供回滚）
⑤ 任何步骤失败自动暂停，不影响现有流量
```

### 10.3 如何保证 K8s 高可用

```
Control Plane 高可用：
  - apiserver：多副本 + 前端 LB（HAProxy/keepalived）
  - etcd：奇数节点（3或5），异地多活
  - scheduler/controller-manager：leader election（同时只有一个工作）

应用高可用：
  - Deployment minReplicas ≥ 2
  - podAntiAffinity 分散到不同 Node
  - readinessProbe 保证就绪才接流量
  - PodDisruptionBudget 限制同时不可用副本数
  - 资源 request/limit 合理配置，防止 OOM Evict
```

### 10.4 常见追问速查
| 追问 | 关键答点 |
|------|----------|
| K8s 如何实现灰度发布？ | ① Deployment 调权重（需多个 Deployment）；② Istio VirtualService 按比例/Header 路由；③ Argo Rollouts 支持 Canary/BlueGreen |
| 如何优雅停机？ | preStop hook（sleep 5s 等待 LB 摘除）+ terminationGracePeriodSeconds + 应用内 SIGTERM 监听，等待请求处理完再退出 |
| Pod 的 QoS 级别是什么？ | Guaranteed（request=limit）> Burstable（request<limit）> BestEffort（无 request/limit）；OOM 时优先 Evict BestEffort |
| etcd 为什么是 K8s 的"大脑"？ | 所有集群状态（期望状态）都存在 etcd，apiserver 是唯一操作 etcd 的组件；etcd 宕机则无法创建/修改资源，但已有 Pod 继续运行 |
| K8s 中如何做资源隔离？ | Namespace（逻辑隔离）+ ResourceQuota（命名空间资源配额）+ LimitRange（Pod 默认资源限制）+ NetworkPolicy（网络隔离） |

---

## 十一、RBAC 与安全 ⭐⭐⭐

### 11.1 RBAC 权限模型

```
RBAC（Role-Based Access Control）四要素：

  Who（主体）            What（权限定义）           Where（作用域）
  ┌──────────┐          ┌──────────────┐          ┌────────────┐
  │ User      │          │ Role         │ ──→      │ Namespace  │
  │ Group     │ ← Bind → │（命名空间级）  │          │（单 NS 内） │
  │ Service   │          │              │          │            │
  │  Account  │          │ ClusterRole  │ ──→      │ 全集群      │
  └──────────┘          │（集群级）     │          │            │
                        └──────────────┘          └────────────┘
                             ↑
                    RoleBinding / ClusterRoleBinding
```

| 资源 | 作用域 | 说明 |
|------|--------|------|
| **Role** | 命名空间 | 定义对某个 NS 内资源（Pod/Service/ConfigMap 等）的操作权限 |
| **ClusterRole** | 集群 | 定义集群级资源（Node/PV/Namespace）或跨 NS 通用权限 |
| **RoleBinding** | 命名空间 | 将 Role 或 ClusterRole 绑定到主体，**仅在该 NS 生效** |
| **ClusterRoleBinding** | 集群 | 将 ClusterRole 绑定到主体，**全集群生效** |

**最小权限原则示例**：
- 开发团队：只分配 dev NS 的 Pod/Deployment/Service 读写权限，禁止访问 Secret 和生产 NS
- CI/CD ServiceAccount：只给 Deployment 的 patch 权限（用于滚动更新），无 delete 权限
- 运维团队：ClusterRole 绑定，可操作所有 NS 但限定资源类型

### 11.2 ServiceAccount（Pod 身份）

```
每个 Pod 自动关联一个 ServiceAccount（默认 default）
  → 挂载 Token 到 /var/run/secrets/kubernetes.io/serviceaccount/
  → Pod 内进程通过 Token 调用 apiserver API

最佳实践：
  ① 不使用默认 SA（权限可能过大）
  ② 为每个业务创建专用 SA + 最小权限 Role
  ③ 不需要 API 访问时设置 automountServiceAccountToken: false
  ④ K8s 1.24+ 默认不再自动创建永久 Token（使用 TokenRequest API 短期令牌）
```

### 11.3 SecurityContext（容器安全上下文）

| 配置 | 作用 | 生产推荐 |
|------|------|----------|
| `runAsNonRoot: true` | 禁止以 root 身份运行容器 | **必须** |
| `readOnlyRootFilesystem: true` | 只读根文件系统（写操作用 emptyDir 挂载 /tmp） | 推荐 |
| `allowPrivilegeEscalation: false` | 禁止容器内进程获取比父进程更多权限 | **必须** |
| `capabilities.drop: [ALL]` | 丢弃所有 Linux Capabilities | **必须**（按需 add NET_BIND_SERVICE 等） |
| `seccompProfile.type: RuntimeDefault` | 启用 seccomp 系统调用过滤 | 推荐 |

### 11.4 Pod Security Standards（PSS）

K8s 1.25+ 内置 Pod 安全准入控制（取代已废弃的 PodSecurityPolicy）：

| 级别 | 限制程度 | 适用场景 |
|------|---------|----------|
| **Privileged** | 无限制 | 系统组件（kube-system / 监控 Agent） |
| **Baseline** | 禁止特权容器/hostNetwork/hostPID 等已知危险配置 | 一般业务应用 |
| **Restricted** | 最严格：必须非 root + 只读 FS + drop ALL capabilities | 安全敏感环境 |

通过 Namespace label 启用：`pod-security.kubernetes.io/enforce: baseline`

三种执行模式：
- `enforce`：违规 Pod 直接拒绝创建
- `warn`：允许创建但打印警告
- `audit`：记录到审计日志

> 生产建议：全集群默认 Baseline enforce + Restricted warn，逐步收紧到 Restricted enforce。

### 11.5 网络安全补充

| 安全层 | 机制 | 说明 |
|--------|------|------|
| Pod 间通信加密 | mTLS（Istio 自动 / cert-manager 手动） | 防止集群内明文流量被嗅探 |
| API 访问控制 | RBAC + Admission Webhook | 精细化资源操作权限 |
| 镜像安全 | 镜像签名（Cosign）+ 漏洞扫描（Trivy） | 防止恶意/漏洞镜像部署 |
| Secret 加密 | etcd 静态加密 + 外部 KMS（Vault/云 KMS） | 防止 etcd 数据泄露 |
| 网络隔离 | NetworkPolicy（默认拒绝 + 白名单放行） | 零信任网络 |

### 11.6 面试标准答法
> K8s 安全分两层：**访问控制**用 RBAC（Role/ClusterRole + Binding 绑定到 User/Group/ServiceAccount），遵循最小权限原则；**运行时安全**用 SecurityContext（非 root、只读 FS、drop ALL capabilities）和 Pod Security Standards（Privileged/Baseline/Restricted 三级准入）。Secret 仅 base64 不是加密，生产必须用 Vault 或 KMS。默认 NetworkPolicy 拒绝 + 白名单放行实现零信任网络。

### 11.7 常见追问
| 追问 | 关键答点 |
|------|----------|
| RBAC 中 Role 和 ClusterRole 的区别？ | Role 限定单个 Namespace；ClusterRole 集群级，可被 RoleBinding 引用（在该 NS 内生效）或 ClusterRoleBinding 引用（全集群） |
| 如何限制某个团队只能访问自己的 Namespace？ | 创建该 NS 的 Role + RoleBinding 绑定到团队 Group；不给 ClusterRoleBinding |
| ServiceAccount Token 安全风险？ | 默认挂载到 Pod 内，被入侵后可调用 apiserver；关闭 automount + 限制 SA 权限 + 使用短期 Token |
| PodSecurityPolicy 为什么被废弃？ | 配置复杂、难以调试、无法按 NS 灵活分级；PSS/PSA 更简洁，通过 Namespace label 即可控制 |
