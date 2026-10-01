这次事故不是一个单点 bug，而是“部署流程错误 + 新 runtime 的 context admission 行为变化”叠加造成的。

直接触发链条是：

```text
两个 dev-codex Pi session
长期上下文约 275K–360K
        ↓
原 2.46 runtime
这些 356K/358K/360K 请求仍能 200
        ↓
09:46 直接把正式 3456
从 2.46 换成 dirty-worktree 2.59
        ↓
新 runtime 对大输入执行了不同的 admission/context 检查
        ↓
同类大请求在真正发送 upstream 之前被 413 拒绝
sendCount = 0
        ↓
Pi turn 无法完成
```

所以最直接的技术事故是：

> **在没有先验证长上下文兼容性的情况下，把正在承载长 session 的正式 3456 热切到了一个 context admission 语义已经变化的新 runtime。**

而且这个变化不是小影响。事故报告已经给出很强的前后对照：

```text
旧 2.46:
356K / 358K / 359K / 360K → 200

新 2.59:
较大 context → 400
underlying 413
sendCount=0
```

这说明请求很可能根本没到 OpenAI，而是在 OpenCodex 本地准入阶段被挡住。准确是哪一个检查——`checkComboTargetInputAdmission`、`providerContextCaps`，还是另一层 context ceiling——目前还没有最终钉死，所以这一点不能过度断言。

第二个根因是部署方式本身不受控。

他不是：

```text
clean commit
→ build artifact
→ shadow验证
→ 一次切换
```

而是：

```text
当前 dirty worktree
→ 直接复制 src + node_modules 到 /opt
→ systemd ExecStart 指过去
→ 正式重启
```

甚至目录叫：

```text
opencodex-v11-91e3fa56f
```

但实际内容是：

```text
91e3fa56f + 未提交 presets.ts
```

所以部署版本本身就不可重建、不可准确回滚。这是事故能够发生的根本流程原因。

第三个放大因素是**边运行边改配置**。

期间发生过：

```text
routes 写入失败
→ rollback
→ 错误地改成 combo
→ 又撤 combo
→ 再装 routes
```

同时还做了三次正式服务重启。于是用户除了 413，又额外遭遇：

```text
503 Service shutting down
2 次 in-flight turn 被 abort
```

所以即使没有 context bug，这套部署方式本身也足以打断正在工作的 agent session。

第四个问题是**在 session 运行过程中改变了模型 ID 的语义**。

原来：

```text
worker = combo/local Qwen
expert = combo/OpenAI
```

部署中途变成：

```text
worker = routingProfile
expert = routingProfile
```

也就是说同一个 Pi session 历史里的 `"worker"`，前后突然不再代表同一种资源。这种变化不应该在活跃 session 运行过程中发生。

第五个危险动作是：

```text
providerContextCaps.openai = 373000
```

它看起来是在试图解决 context 问题，但没有先搞清楚 context budget 语义。

现在 catalog 又声明：

```text
context_window = 400000
max_output_tokens = 128000
```

如果这两个共享一个总 context budget，那么正常推导很可能接近：

```text
400K - 128K ≈ 272K input
```

这恰好又与事故边界附近非常接近。

所以 `373K` 很可能只是把 admission ceiling 强行抬高，并不意味着：

```text
373K input + 128K output
```

真的是合法的。

这个值现在必须审查，不能当成修复完成。

因此，如果压缩成一句 RCA：

> **事故的根因是未经 production-shaped shadow 验证，就把一个 dirty、不可重建的 2.59 V1.1 runtime 直接替换到承载两个超长上下文 Pi session 的正式 3456；新 runtime 的 context/input admission 与 2.46 不兼容，导致原本可运行的 275K–360K session 在发送 upstream 前被 413 拒绝。期间又发生多次 config mutation、模型 ID 语义替换和三次服务重启，进一步造成 503 与 in-flight abort。**

不是这些导致的：

```text
Pi session 文件损坏      ❌
Pi 本身坏了             ❌
OpenAI credential问题    ❌
V1.1 ordered routing概念本身 ❌
```

真正的问题是：

```text
不安全的正式部署流程
+
未验证的 context admission regression
```

其中 context regression 是技术触发器，部署流程失控是根本原因。
