# DevOps 与 CI/CD

> 最后更新：2026年3月5日

---

## 章节总览

| 章节 | 内容 |
|------|------|
| [一、Git 工作流](#一git-工作流) | 分支策略、Git Flow/Trunk-Based、常用命令 |
| [二、CI/CD 核心概念](#二cicd-核心概念) | 持续集成/交付/部署、Pipeline设计 |
| [三、Jenkins 实践](#三jenkins-实践) | Pipeline as Code、多阶段构建、常见插件 |
| [四、GitHub Actions](#四github-actions) | Workflow语法、矩阵构建、常用Action |
| [五、发布策略](#五发布策略) | 蓝绿发布、金丝雀发布、滚动更新、灰度方案 |
| [六、制品管理与镜像](#六制品管理与镜像) | Maven仓库、Docker镜像构建优化、Harbor |
| [七、面试速查表](#七面试速查表) | 高频考点一表通 |

---

## 一、Git 工作流 ⭐⭐

### 1.1 分支策略对比

| 策略 | 特点 | 适用场景 |
|------|------|---------|
| **Git Flow** | master + develop + feature/release/hotfix | 版本发布周期长（传统项目） |
| **GitHub Flow** | main + feature branch + PR | 持续部署的 SaaS |
| **Trunk-Based** | 主干开发 + 短生命周期分支 + Feature Flag | **字节/大厂主流**，CI/CD 成熟团队 |
| GitLab Flow | main + environment branch（staging/prod） | 多环境部署 |

### 1.2 Git Flow 详解
```
master ──────────────────────────────── 生产分支（只接受合并）
  │
  └── develop ──────────────────────── 开发主分支
        ├── feature/xxx ────────────── 功能分支（从 develop 创建，完成后合回 develop）
        ├── release/1.0 ────────────── 发布分支（从 develop 创建，测试通过合入 master + develop）
        └── hotfix/xxx ─────────────── 热修复（从 master 创建，修完合入 master + develop）
```

### 1.3 Trunk-Based Development（字节推荐）
```
main ─────────────────────────────── 主干（始终可发布）
  ├── short-lived branch（<2天）──── 短期分支
  │     └── PR + CI通过 → 合入main
  └── Feature Flag 控制未完成功能 ── 代码入库但功能关闭
```
- **核心理念**：频繁小批量合并，减少合并冲突
- **前提**：完善的 CI 自动化测试 + Feature Flag 框架

### 1.4 常用 Git 命令速查

| 场景 | 命令 |
|------|------|
| 交互式变基 | `git rebase -i HEAD~3` |
| 撤销已push提交 | `git revert <commit>` |
| 暂存工作区 | `git stash` / `git stash pop` |
| 查看某行历史 | `git blame file.java` |
| 找回丢失提交 | `git reflog` → `git cherry-pick` |
| 合并特定提交 | `git cherry-pick <commit>` |
| 压缩提交 | rebase -i → squash |

### 1.5 面试标准答法
> 大厂主流 Trunk-Based Development：主干开发 + 短生命周期分支 + Feature Flag，保证主干始终可发布。传统项目用 Git Flow（多长期分支）。关键命令：rebase -i 整理提交、cherry-pick 选择性合并、revert 安全撤销。

---

## 二、CI/CD 核心概念 ⭐⭐⭐

### 2.1 三个阶段

```
CI（持续集成）          CD（持续交付）           CD（持续部署）
  代码提交              自动构建+测试             自动发布到生产
  → 自动编译            → 生成制品               → 零人工干预
  → 自动测试            → 部署到 Staging          → 全自动化
  → 快速反馈            → 手动确认后上线          
```

| 阶段 | 目标 | 自动化程度 |
|------|------|-----------|
| 持续集成（CI） | 每次提交自动构建+测试，快速发现问题 | 编译+单测+代码扫描 |
| 持续交付（CD）| 随时可以发布到生产（但需手动触发） | + 集成测试 + 制品打包 |
| 持续部署（CD）| 每次通过测试自动发布到生产 | + 自动发布 + 自动回滚 |

### 2.2 Pipeline 设计（典型Java项目）

```yaml
stages:
  - 🔍 代码检查:    SonarQube / Checkstyle / SpotBugs
  - 🔨 编译构建:    mvn clean package -DskipTests
  - 🧪 单元测试:    mvn test（覆盖率 > 80%）
  - 🔗 集成测试:    Testcontainers + 真实中间件
  - 📦 制品打包:    Docker build → 推送 Harbor
  - 🚀 部署 Staging: Helm upgrade → K8s Staging
  - ✅ 验收测试:    API自动化测试 / UI E2E
  - 🎯 部署 Prod:   金丝雀发布 → 全量发布
```

### 2.3 面试标准答法
> CI 是每次代码提交触发自动编译+测试，快速发现集成问题。CD（持续交付）是随时可发布但需手动确认，CD（持续部署）是全自动发布到生产。典型 Pipeline 包含代码检查→编译→测试→制品打包→部署Staging→验收→发布生产。

---

## 三、Jenkins 实践 ⭐⭐

### 3.1 Pipeline as Code（Jenkinsfile）
```groovy
pipeline {
    agent any
    
    environment {
        REGISTRY = 'harbor.example.com'
        APP_NAME = 'user-service'
    }
    
    stages {
        stage('Checkout') {
            steps {
                git branch: 'main', url: 'https://github.com/xxx/xxx.git'
            }
        }
        
        stage('Build & Test') {
            steps {
                sh 'mvn clean package'
            }
            post {
                always {
                    junit 'target/surefire-reports/*.xml'
                    jacoco execPattern: 'target/jacoco.exec'
                }
            }
        }
        
        stage('SonarQube') {
            steps {
                withSonarQubeEnv('sonar') {
                    sh 'mvn sonar:sonar'
                }
                waitForQualityGate abortPipeline: true
            }
        }
        
        stage('Docker Build & Push') {
            steps {
                sh """
                    docker build -t ${REGISTRY}/${APP_NAME}:${BUILD_NUMBER} .
                    docker push ${REGISTRY}/${APP_NAME}:${BUILD_NUMBER}
                """
            }
        }
        
        stage('Deploy to K8s') {
            steps {
                sh "helm upgrade ${APP_NAME} ./charts --set image.tag=${BUILD_NUMBER}"
            }
        }
    }
    
    post {
        failure {
            dingtalk accessToken: '...', message: "❌ 构建失败: ${APP_NAME} #${BUILD_NUMBER}"
        }
    }
}
```

### 3.2 常用插件

| 插件 | 用途 |
|------|------|
| Pipeline | 声明式/脚本式流水线 |
| Blue Ocean | 现代化 Pipeline 可视化 |
| SonarQube Scanner | 代码质量扫描 |
| JaCoCo | 代码覆盖率报告 |
| Kubernetes | 动态 Pod 作为构建节点 |
| DingTalk / Feishu | 构建通知 |

### 3.3 面试标准答法
> Jenkins Pipeline as Code（Jenkinsfile）定义构建流水线，包含 Checkout→Build→Test→SonarQube→Docker Build→Deploy 等 stage。支持 post 条件处理（失败通知）、并行stage、动态K8s Agent。大厂趋势是从 Jenkins 迁移到 GitLab CI 或 Argo Workflows（云原生CI/CD）。

---

## 四、GitHub Actions ⭐⭐

### 4.1 Workflow 核心语法
```yaml
# .github/workflows/ci.yml
name: CI Pipeline

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    
    strategy:
      matrix:
        java: [17, 21]    # 矩阵构建：同时测试多个JDK版本
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup JDK ${{ matrix.java }}
        uses: actions/setup-java@v4
        with:
          java-version: ${{ matrix.java }}
          distribution: 'temurin'
          cache: 'maven'
      
      - name: Build & Test
        run: mvn -B clean verify
      
      - name: Upload Coverage
        uses: codecov/codecov-action@v4
        with:
          file: target/site/jacoco/jacoco.xml

  docker:
    needs: build          # 依赖 build job 成功
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Build & Push Docker Image
        uses: docker/build-push-action@v5
        with:
          push: true
          tags: ghcr.io/${{ github.repository }}:${{ github.sha }}
```

### 4.2 GitHub Actions vs Jenkins

| 对比 | GitHub Actions | Jenkins |
|------|---------------|---------|
| 托管 | GitHub 托管（免费额度） | 自建服务器 |
| 配置 | YAML 文件 | Groovy Jenkinsfile |
| 生态 | Marketplace 大量 Action | 海量插件 |
| 适用 | 开源/中小团队 | 大型企业/复杂需求 |
| 维护成本 | 低（SaaS） | 高（需运维 Jenkins） |

### 4.3 面试标准答法
> GitHub Actions 用 YAML 定义 Workflow，支持矩阵构建（多JDK/多OS并行测试）、job 依赖、缓存、Marketplace 复用。适合开源和中小团队。大型企业多用 Jenkins（自托管、插件生态丰富）或 GitLab CI（代码+CI一体化）。

---

## 五、发布策略 ⭐⭐⭐

### 5.1 四种发布策略对比

| 策略 | 原理 | 回滚速度 | 资源开销 | 风险 |
|------|------|---------|---------|------|
| **蓝绿发布** | 两套完整环境切换 | ⚡ 秒级（切流量） | 高（2倍资源） | 低 |
| **金丝雀发布** | 先灰度小比例流量 | 快（缩小金丝雀） | 低 | 低 |
| **滚动更新** | 逐批替换旧 Pod | 中（回滚需反向滚动） | 低 | 中 |
| **A/B 测试** | 按用户特征分流 | 中 | 中 | 低 |

### 5.2 蓝绿发布
```
                    ┌─ 蓝(v1) ← 当前生产
 用户 → LB/Router ─┤
                    └─ 绿(v2) ← 新版本（部署+验证完成后切流量）

切换：LB 将流量从蓝→绿
回滚：LB 将流量从绿→蓝（秒级）
```

### 5.3 金丝雀发布（灰度发布）
```
阶段1: 5% 流量 → v2，95% → v1 （观察指标）
阶段2: 30% 流量 → v2，70% → v1 （扩大验证）
阶段3: 100% 流量 → v2             （全量发布）
异常:  0% 流量 → v2，100% → v1   （立即回滚）
```

**K8s + Istio 实现金丝雀**：
```yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
spec:
  http:
    - route:
        - destination:
            host: user-service
            subset: v1
          weight: 95
        - destination:
            host: user-service
            subset: v2
          weight: 5       # 5%流量到新版本
```

### 5.4 K8s 滚动更新
```yaml
apiVersion: apps/v1
kind: Deployment
spec:
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 25%        # 滚动时最多多出25%的Pod
      maxUnavailable: 25%  # 滚动时最多25%不可用
```
- K8s **默认策略**，逐步替换旧 Pod
- 配合 readinessProbe 确保新 Pod 就绪后才接收流量

### 5.5 面试标准答法
> 蓝绿发布两套环境秒级切换，成本高但最安全。金丝雀发布按比例灰度（5%→30%→100%），用 Istio VirtualService 控制权重。K8s 默认滚动更新（maxSurge/maxUnavailable），配合 readinessProbe。大厂一般用金丝雀+自动化观测指标+自动回滚。

---

## 六、制品管理与镜像 ⭐⭐

### 6.1 制品管理

| 制品类型 | 仓库 | 说明 |
|---------|------|------|
| Java JAR/WAR | Nexus / Artifactory | Maven 仓库 |
| Docker 镜像 | Harbor / Docker Hub / ACR | 企业首选 Harbor（RBAC+镜像扫描） |
| Helm Chart | ChartMuseum / Harbor | K8s 应用包 |
| NPM 包 | Verdaccio / Nexus | 前端依赖 |

### 6.2 Docker 镜像构建优化

```dockerfile
# 多阶段构建（减小镜像体积）
FROM maven:3.9-eclipse-temurin-21 AS builder
WORKDIR /app
COPY pom.xml .
RUN mvn dependency:go-offline          # 单独缓存依赖层
COPY src ./src
RUN mvn package -DskipTests

FROM eclipse-temurin:21-jre-alpine     # 仅JRE，不含JDK
WORKDIR /app
COPY --from=builder /app/target/*.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
```

**优化要点**：

| 优化 | 效果 |
|------|------|
| 多阶段构建 | 最终镜像不含构建工具，体积减少 50%+ |
| 依赖单独缓存层 | 依赖不变时利用 Docker 缓存，加速构建 |
| alpine 基础镜像 | 比 ubuntu 小 ~100MB |
| .dockerignore | 排除 target/.git 等无关文件 |
| JRE 替代 JDK | 运行时不需要编译工具 |

### 6.3 镜像安全
- **Trivy** / **Harbor 内置扫描**：扫描镜像 CVE 漏洞
- 使用官方镜像 + 固定版本 tag（避免 `latest`）
- 非 root 用户运行容器

### 6.4 面试标准答法
> 企业级制品管理用 Harbor（镜像仓库 + RBAC + 漏洞扫描）+ Nexus（Maven仓库）。Docker 镜像优化：多阶段构建减小体积、依赖层单独缓存加速构建、alpine + JRE 基础镜像。安全方面用 Trivy 扫描 CVE、固定版本 tag、非 root 运行。

---

## 七、面试速查表

| 考点 | 核心答案 | 追问 |
|------|---------|------|
| Git 分支策略 | 大厂 Trunk-Based + Feature Flag；传统 Git Flow | rebase vs merge？ |
| CI/CD 区别 | CI自动测试，CD自动交付/部署 | Pipeline包含哪些阶段？ |
| Jenkins Pipeline | Jenkinsfile 声明式流水线 | 如何做动态Agent？ |
| GitHub Actions | YAML Workflow，矩阵构建，GitHub托管 | 自托管Runner？ |
| 蓝绿发布 | 两套环境秒级切换，成本高 | 数据库 schema 怎么兼容？ |
| 金丝雀发布 | 按比例灰度，Istio VirtualService | 灰度指标？自动回滚？ |
| 滚动更新 | K8s默认，maxSurge/maxUnavailable | 如何确保零停机？ |
| Docker 镜像优化 | 多阶段构建 + alpine + 依赖层缓存 | 如何减少镜像层数？ |
| 制品管理 | Harbor + Nexus | 镜像安全扫描？ |

> 更多 K8s 和容器化内容请参考 → [云原生与K8s.md](云原生与K8s.md)
