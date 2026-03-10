# 云原生与 Kubernetes

> 最后更新：2026年3月7日

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

### 3.7 面试标准答法
> K8s 核心对象：Pod 是最小调度单元；Deployment 管理无状态 Pod 的副本数和滚动更新；Service 提供稳定 VIP 和 DNS 访问（ClusterIP/NodePort/LoadBalancer）；Ingress 实现 7 层 HTTP 路由；ConfigMap/Secret 管理配置；StatefulSet 管理有状态应用（有序启停+稳定存储）。

### 3.8 常见追问
| 追问 | 关键答点 |
|------|----------|
| Deployment 和 ReplicaSet 关系？ | Deployment 管理 ReplicaSet 版本历史，实现滚动更新和回滚；直接用 RS 则无版本管理 |
| Service 如何找到对应 Pod？ | Label Selector；Endpoints 对象动态记录匹配 Pod 的 IP:Port；kube-proxy 同步到转发规则 |
| Secret 安全吗？ | 仅 base64 编码，不安全！生产应用 HashiCorp Vault / 云厂商 KMS 加密 |

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

### 6.4 面试标准答法
> K8s 存储三层抽象：StorageClass 定义存储类型（云盘/NFS/Ceph）；PV 是集群级实际存储资源；PVC 是命名空间级存储请求。动态供给：PVC 创建后 StorageClass provisioner 自动创建 PV 并绑定。Pod 删除 PVC 保留，数据不丢失；StatefulSet 每个 Pod 绑定独立 PVC 实现有状态数据持久化。

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

### 7.3 面试标准答法
> 三种探针解决不同问题：startupProbe 保护慢启动；readinessProbe 控制流量（未就绪不接流量）；livenessProbe 重启死锁进程。HPA 基于 CPU/内存或自定义指标自动调整副本数，配合 PodDisruptionBudget 保证缩容时最小可用副本数。

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

## 九、Service Mesh & Istio ⭐⭐

### 9.1 为什么需要 Service Mesh

```
传统微服务：每个服务自己实现熔断/重试/链路追踪/安全
  → 多语言框架不一致；基础能力分散在业务代码中

Service Mesh：将这些能力下沉到基础设施层（Sidecar）
  → 业务代码无侵入；统一治理
```

### 9.2 Istio 架构

```
数据平面（Data Plane）：
  每个 Pod 注入 Envoy Sidecar 代理
  → 拦截所有入站/出站流量（iptables 劫持）
  → 执行路由/熔断/重试/限流/mTLS/遥测

控制平面（Control Plane）：
  istiod（Pilot + Citadel + Galley 合并）
  ├── Pilot：分发路由规则给 Envoy（xDS 协议）
  ├── Citadel：证书管理，mTLS 自动签发
  └── Galley：配置验证和分发
```

### 9.3 核心 CRD

```yaml
# VirtualService：流量路由（金丝雀/权重/Header匹配）
apiVersion: networking.istio.io/v1alpha3
kind: VirtualService
spec:
  http:
  - match:
    - headers:
        x-canary:
          exact: "true"
    route:
    - destination:
        host: user-service
        subset: v2           # 灰度流量到 v2
  - route:
    - destination:
        host: user-service
        subset: v1
      weight: 90             # 90% 流量到 v1
    - destination:
        host: user-service
        subset: v2
      weight: 10             # 10% 流量到 v2（金丝雀）

# DestinationRule：定义 subset 和负载均衡策略
apiVersion: networking.istio.io/v1alpha3
kind: DestinationRule
spec:
  host: user-service
  subsets:
  - name: v1
    labels:
      version: v1
  - name: v2
    labels:
      version: v2
  trafficPolicy:
    connectionPool:
      http:
        http2MaxRequests: 1000
    outlierDetection:        # 自动熔断
      consecutive5xxErrors: 5
      interval: 30s
      baseEjectionTime: 30s
```

### 9.4 Istio vs Spring Cloud 对比

| 维度 | Istio（Service Mesh） | Spring Cloud |
|------|----------------------|-------------|
| 语言 | 语言无关 | Java 侵入 |
| 熔断限流 | Envoy 层实现 | Hystrix/Sentinel 代码集成 |
| 链路追踪 | Sidecar 自动采集 | 手动集成 Sleuth/Skywalking |
| mTLS | 自动 | 需手动配置 |
| 学习成本 | 高（K8s + Istio） | 中（Spring 生态） |
| 性能损耗 | Sidecar 增加延迟 | 无 Sidecar |

### 9.5 面试标准答法
> Service Mesh 通过在每个 Pod 注入 Sidecar（Envoy）代理，将服务治理能力（路由/熔断/重试/可观测性/安全 mTLS）从业务代码中剥离，实现基础设施层统一管理。Istio 是最主流的实现，istiod 作为控制平面下发配置，Envoy 作为数据平面执行策略。

### 9.6 常见追问
| 追问 | 关键答点 |
|------|----------|
| Sidecar 会带来哪些问题？ | 延迟增加（2次网络跳转）；资源消耗（每个 Pod 多一个 Envoy）；复杂度上升 |
| eBPF 和 Service Mesh 有什么关系？ | Cilium/Cilium Mesh 用 eBPF 在内核态实现流量拦截，无需 Sidecar，性能更高（Sidecarless 方向） |

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
