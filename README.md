# 地牢远征 · 多人合作 2D 地牢闯关

一个最多 **4 人组队**的实时合作地牢游戏。清光一层的怪物才能下楼，层数越深怪越凶；
倒下后 6 秒在入口自动复活，但**全员同时倒地**这一趟就结束了。

**在线玩：** https://programape6020.github.io/mini-games/

---

## 玩法

- **目标**：一层一层往下打，撑得越深、得分越高
- **组队**：2～4 人，房主创建房间后把邀请链接发给朋友
- **战斗**：近战挥砍（有攻击弧与击退），冲刺可以拉开距离或穿怪
- **推进**：本层怪物清空后，走到**楼梯**上停留片刻进入下一层（每 3 层有一个 Boss）
- **倒地**：血量归零后倒地 6 秒，然后在入口复活并恢复 60% 血量；全员同时倒地即失败
- **掉落**：爱心回血、金币加分、蓝色药水回满

### 操作

| 动作 | 按键 |
| --- | --- |
| 移动 | `W` `A` `S` `D` 或方向键 |
| 瞄准 | 鼠标 |
| 攻击 | 鼠标左键 或 `J` |
| 冲刺 | `空格` / `K` / 鼠标右键 |

---

## 和朋友一起玩

1. 打开站点 → 填个名字 → **创建房间**
2. 点「复制邀请链接」发给朋友（微信 / QQ 都行），对方打开即进入同一队
3. 房主点「进入地牢」开始；中途加入的人会自动被编入队伍

> 站点右上角会显示当前通道：
> - `🌐 联机模式` —— 走 Supabase Realtime，**不同网络的朋友也能一起玩**
> - `🖥 本地多标签` —— 没配置 Supabase 时的降级模式，用同一浏览器的多个标签页组队

想强制走本地通道（不经过服务器）测试：地址后面加 `?net=local`。

---

## 联机原理（为什么 4 个人能同步）

- **房主权威**：房主跑完整模拟（怪物 AI、伤害、掉落、楼层），客户端只发输入。
- **20Hz 快照**：房主每秒广播 20 次紧凑快照。地图**不传输**——只发 `{种子, 楼层}`，
  每个客户端用同一份确定性生成器各算一份完全相同的地牢。
- **客户端预测**：本机玩家的移动用**和房主同一份代码**（`src/game/motion.ts`）本地先算，
  所以按下去立刻有反应；快照只用来纠偏（偏差 > 96 像素直接吸附，否则每次吃掉 30%）。
- **插值**：队友与怪物向快照位置平滑插值，避免 20Hz 带来的跳动。
- **传输可替换**：`src/lib/net/` 下是传输层抽象，Supabase 与同浏览器 BroadcastChannel
  是同一套接口的两个实现；Supabase 客户端按需动态 import（216 kB 单独分包）。

快照体积实测：4 人 + 42 只怪 + 40 个掉落 + 40 个抛射物的极端情况仍在 6 KB 以内
（`tests/snapshot.test.ts` 里有断言守着）。

---

## 本地开发

```bash
npm install
npm run dev      # 本地开发服务器
npm test         # 单元测试（node:test，42 个用例）
npm run build    # 类型检查 + 生产构建
```

> `npm test` 用的是 Node 内建的测试运行器。注意：它不做路径补全，所以 `src/` 里的
> **相对值导入必须带 `.ts` 后缀**（`tsconfig` 已开 `allowImportingTsExtensions`）。

---

## 配置 Supabase（想和不同网络的朋友玩才需要）

Supabase 侧**不需要建表、不需要写策略、不需要 Edge Function**：游戏只用 Realtime 的
broadcast（广播）和 presence（在线状态），这两项开箱即用。

1. https://supabase.com → 用 GitHub 登录 → **New project**
   （Region 建议选 `Southeast Asia (Singapore)`）
2. 等 1～2 分钟初始化完成
3. 左侧 **Project Settings → API Keys**，复制两项：
   - **Project URL**：`https://xxxxxxxx.supabase.co`
   - **anon / public** key：很长、以 `eyJ` 开头的那串
   > ⚠️ 不要用 `service_role` key（管理员密钥，绝不能进前端）
4. 填进去：
   - **本地**：把 `.env.example` 复制成 `.env.local`，填入这两个值
   - **线上**：仓库 `Settings → Secrets and variables → Actions` 添加两个
     Repository secret，名字必须是 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY`，
     然后重新跑一次 `Deploy to GitHub Pages`（值是**构建时**打进产物的，改完必须重新构建）
5. 验证：进入任意房间，右上角应显示 `🌐 联机模式`

### 安全边界（如实说明）

- `anon` key 会出现在公开的 JS 产物里，这是 Supabase 前端的标准做法：它只代表「匿名访客」，
  而本项目没有建任何表，所以它只能用来收发房间内的实时消息。
- 拿到 anon key 的人如果**猜到房间码**，理论上可以进同一个房间旁观。房间码是 4 位随机字符
  （约 100 万种组合），对休闲联机够用；要做正式比赛可以给 `realtime.messages` 配置授权策略。
- 想轮换密钥：Supabase 控制台轮换 → 更新 `.env.local` 与仓库 Secret → 重新部署。

---

## 目录结构

```
mini-games/
├─ .github/workflows/deploy.yml   # 推送到 main 后自动构建并发布到 Pages
├─ tests/                         # node:test 单元测试
│  ├─ dungeon.test.ts             # 地牢生成：确定性、连通性、碰撞
│  ├─ sim.test.ts                 # 战斗与推进规则
│  ├─ snapshot.test.ts            # 快照打包 / 解包 / 体积 / 容错
│  ├─ netcode.test.ts             # 客户端预测、纠偏、插值、换层
│  ├─ bot.test.ts                 # 机器人跑全程（打怪→清层→下楼）
│  └─ net.test.ts                 # 房间码、座位、排序
├─ src/
│  ├─ main.tsx                    # 入口
│  ├─ App.tsx                     # 整站就是一个游戏
│  ├─ styles.css                  # 全部样式
│  ├─ components/
│  │  ├─ GameView.tsx             # 游戏主界面：网络同步 / 输入 / 主循环 / HUD
│  │  └─ Lobby.tsx                # 大厅、等待房间、通道徽章
│  ├─ game/
│  │  ├─ constants.ts             # 手感数值集中在这里
│  │  ├─ rng.ts                   # 确定性随机（同种子同结果）
│  │  ├─ types.ts                 # 世界与实体类型
│  │  ├─ dungeon.ts               # 地牢生成 + 碰撞 + 视线
│  │  ├─ world.ts                 # 楼层构建、怪物数值、掉落
│  │  ├─ motion.ts                # 玩家运动（房主与客户端共用）
│  │  ├─ sim.ts                   # 房主权威模拟：AI / 伤害 / 倒地 / 下楼
│  │  ├─ snapshot.ts              # 快照打包解包（含不可信输入校验）
│  │  ├─ netcode.ts               # 客户端预测与插值
│  │  ├─ view.ts                  # 视图数据结构（渲染层契约）
│  │  └─ render.ts                # canvas 渲染：瓦片 / 实体 / 火把 / 小地图
│  └─ lib/
│     ├─ config.ts                # 读 Supabase 配置
│     ├─ router.ts                # 极简 hash 路由
│     ├─ nickname.ts              # 昵称（本地保存）
│     └─ net/                     # 传输层：Supabase / 同浏览器多标签
└─ vite.config.ts
```

---

## 已知限制

- **操作以键鼠为主**：触屏虚拟摇杆还没做，手机上暂时只能看不能好好打。
- **怪物没有寻路**：被墙挡住时会贴着墙走，不会绕路（小地图与走廊宽度已尽量弥补）。
- **中途加入**：房主会把新队友加进当前楼层，但不会补发这一层已经发生的事件。
- **真实网络延迟下的手感**只能在真实跨网络环境里感受；20Hz 广播 + 插值在几十毫秒延迟下
  表现正常，但更高延迟没有实测过。
- 房间码是 4 位、无鉴权，见上面的「安全边界」。
