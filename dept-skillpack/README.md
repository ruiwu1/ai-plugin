# dept-skillpack

**给 Agent 看的安装指南 → [`install.md`](./install.md)**

同事只需要把这一句丢给自己的 Agent：

```
帮我安装「项目开发部技能包」，并完成登录配置：
https://raw.githubusercontent.com/ruiwu1/ai-plugin/main/dept-skillpack/install.md
```

Agent 会照 `install.md` 走完：取包 → 校验 → 取安装器 → 安装 → 授权体检 → 验证。

## 目录里有什么

| 文件 | 作用 |
| --- | --- |
| `install.md` | **给 Agent 的指南**（主入口） |
| `install.mjs` | 安装器。零依赖，只需 Node 20+ |
| `pack-1.2.0.json` | 投递体：6 个技能的全部文件正文 |
| `manifest.json` | 清单（不含正文，给人看/给脚本比对） |

内容指纹 `4c0f76c5ca2bb925`。判断旧没旧看指纹，不看版本号。

---

> 本目录由平台自动生成并推送。**不要手改**——改了下次推送会被覆盖。
> 生成入口：`pack/render-guide.mjs` + `pack/build.mjs`。
