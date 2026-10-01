# 小游戏合集 · Mini Games

一个用 **React + TypeScript + Vite** 写的小游戏网站，包含四个键盘 / 触屏都能玩的小游戏，
构建成纯静态文件后由 **GitHub Pages** 免费托管。

- 🌐 在线访问：<https://programape6020.github.io/mini-games/>
- 📦 仓库地址：<https://github.com/ProgramApe6020/mini-games>

| 游戏 | 说明 | 最佳成绩 |
| --- | --- | --- |
| 🐍 贪吃蛇 | 吃果实变长，速度随分数加快 | 分数越高越好 |
| 🔢 2048 | 合并相同数字，可撤销一步 | 分数越高越好 |
| 🧱 打砖块 | 多关卡，砖块越打越多 | 分数越高越好 |
| 🃏 记忆翻牌 | 三种难度，找到所有配对 | 步数越少越好 |

## 特点

- **零后端**：全部逻辑跑在浏览器里，成绩存在 `localStorage`，不收集任何数据。
- **无需改配置就能部署**：`vite.config.ts` 里使用相对基路径 `base: './'`，
  所以部署到 `https://<用户名>.github.io/<仓库名>/` 这种子路径下也能正常加载资源，
  换仓库名、换自定义域名都不用改代码。
- **hash 路由**：页面地址是 `#/snake` 这样带井号的，刷新不会 404 —— 静态托管不需要服务端配合。
- **游戏逻辑与界面分离**：`src/games/*/logic.ts` 是纯函数，可以直接跑单元测试
  （2048 的合并、贪吃蛇的碰撞、打砖块的物理都有覆盖，共 27 个用例）。
- **自带测试与类型检查**：`npm run check` 一次跑完类型检查、单元测试和构建。

## 本地开发

需要先安装 [Node.js](https://nodejs.org/) 20 或更高版本（推荐 LTS）。
装好后在项目目录里执行：

```bash
npm install      # 安装依赖（只需执行一次）
npm run dev      # 启动开发服务器，默认 http://localhost:5173
```

常用命令：

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 启动开发服务器，改代码即时刷新 |
| `npm run build` | 类型检查 + 打包到 `dist/`，产物就是最终要部署的静态文件 |
| `npm run preview` | 本地预览 `dist/` 的构建结果 |
| `npm test` | 运行游戏逻辑的单元测试 |
| `npm run typecheck` | 只做 TypeScript 类型检查 |
| `npm run check` | 类型检查 + 测试 + 构建，提交前跑一遍最稳 |

## 部署到 GitHub Pages

### 第一次部署

1. **在 GitHub 上新建仓库**（例如 `mini-games`），**不要**勾选添加 README / .gitignore —— 本地已经有了。
2. **把本地代码推上去**（在项目目录里执行，仓库地址换成你自己的）：

   ```bash
   git init -b main
   git add .
   git commit -m "feat: 小游戏合集初始版本"
   git remote add origin https://github.com/<你的用户名>/mini-games.git
   git push -u origin main
   ```

3. **打开仓库的 Pages 设置**：`Settings` → 左侧 `Pages` → 把 **Source** 改成 **GitHub Actions**
   （不要选 "Deploy from a branch"，本项目由 Actions 工作流构建）。
4. 回到仓库的 **Actions** 标签页，会看到 `Deploy to GitHub Pages` 正在运行。
   第一次通常 1～2 分钟。跑完后访问：

   ```
   https://<你的用户名>.github.io/<仓库名>/
   ```

### 之后更新内容

只要往 `main` 分支推代码就会自动重新构建并发布，不需要做别的：

```bash
git add .
git commit -m "feat: 新增某个游戏"
git push
```

### 如果构建失败

- **`npm ci` 报错找不到 lock 文件**：确认 `package-lock.json` 已经提交进仓库（不要写进 `.gitignore`）。
- **Pages 页面 404**：检查 `Settings → Pages` 的 Source 是否为 `GitHub Actions`；
  另外部署完成后第一次访问有时需要等一两分钟。
- **页面空白、控制台报资源 404**：说明资源的基路径不对。本项目用的是 `base: './'`，
  这种情况下不应该出现；如果你手动改过 `vite.config.ts`，把它改回 `'./'`。

## 双人联机对战（Supabase 配置）

首页「双人联机对战」分区的 6 个游戏需要一条实时通道。项目用 **Supabase Realtime**
（只用广播 + 在线状态，不建表、不存数据）。**没配置也能用**——会自动退化成
「同一浏览器双标签页」模式，打开两个标签页就能自己试玩。

配置步骤：

1. 打开 <https://supabase.com>，用 GitHub 账号登录，新建一个项目
   （Region 选 Southeast Asia (Singapore)，数据库密码随便设，我们用不到数据库）
2. 等 1～2 分钟初始化完成，进入 **Project Settings → API Keys**，复制两样东西：
   **Project URL**（形如 `https://abcdefgh.supabase.co`）和 **anon / public** key
3. 本地开发：把 `.env.example` 复制成 `.env.local`，填上这两个值：

   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
   ```

4. 线上部署：在 GitHub 仓库 **Settings → Secrets and variables → Actions** 里
   新建两个 Repository secret，名字要完全一致：

   | Secret 名称 | 值 |
   | --- | --- |
   | `VITE_SUPABASE_URL` | 你的 Project URL |
   | `VITE_SUPABASE_ANON_KEY` | 你的 anon key |

   然后重新跑一次 Actions（或再 push 一次）即可生效。

> **anon key 放在前端安全吗？** 安全。它本来就是设计成随前端下发给浏览器的，
> 只代表「匿名访客」身份；本项目没有建任何表，所以它只能用来收发房间内的实时消息。
> 想轮换：换掉 Supabase 的 key，再更新 `.env.local` 和仓库 secret 即可。
>
> 需要知道的边界：拿到 anon key 的人如果**猜到房间码**，理论上可以进同一个房间旁观。
> 房间码是 4 位随机字符（约 100 万种组合），对休闲对战够用；如果要做正式比赛，
> 可以在 Supabase 里给 `realtime.messages` 配置授权策略来限制。

### 怎么和朋友对战

1. 打开任意一个联机游戏，点「创建房间」，会得到 4 位房间码和一条邀请链接
2. 把链接发给朋友（对方打开即进入同一房间），或让对方输入房间码加入
3. 两人到齐自动开局；中途刷新页面也能回到房间
4. 房间页右上角会显示当前通道：`🌐 联机模式` 或 `🖥 双标签模式`

想绕开 Supabase 用同一浏览器测试：把地址改成
`#/gomoku?room=TEST&role=host&net=local`，再开另一个标签页用 `role=guest` 打开。

## 目录结构

```
mini-games/
├─ .github/workflows/deploy.yml   # 推送到 main 后自动构建并发布到 Pages
├─ public/                        # 原样拷贝到 dist 的静态文件
│  ├─ favicon.svg
│  └─ .nojekyll
├─ src/
│  ├─ main.tsx                    # 入口：挂载 React 应用
│  ├─ App.tsx                     # 首页 + 按 hash 路由切换到具体游戏
│  ├─ styles.css                  # 全部样式
│  ├─ lib/
│  │  ├─ router.ts                # 极简 hash 路由（支持 ?room= 这类参数）
│  │  ├─ storage.ts               # localStorage 里的最佳成绩
│  │  ├─ canvas.ts / math.ts      # 画布与数值小工具
│  │  ├─ config.ts                # 读取 Supabase 配置
│  │  └─ net/                     # 联机传输层：Supabase / 同浏览器双标签
│  ├─ components/
│  │  ├─ GameFrame.tsx            # 游戏页共用的外框（标题、成绩、提示）
│  │  └─ RoomGate.tsx             # 房间大厅、等待页、对局状态栏
│  └─ games/
│     ├─ registry.ts              # 游戏清单：单人 4 个 + 联机 6 个
│     ├─ Snake.tsx    + snake/logic.ts      # 界面 + 纯逻辑
│     ├─ Game2048.tsx + g2048/logic.ts      # 界面 + 纯逻辑
│     ├─ Breakout.tsx + breakout/logic.ts   # 界面 + 物理逻辑
│     ├─ Memory.tsx               # 逻辑较短，直接写在组件里
│     └─ online/                  # 双人联机对战
│        ├─ TicTacToe.tsx / Gomoku.tsx / ReactionDuel.tsx ...
│        ├─ tictactoe/logic.ts 等 # 各游戏的纯逻辑
│        └─ *.css                 # 各游戏自己的样式
└─ tests/
   ├─ logic.test.ts               # 2048 与贪吃蛇（14 个用例）
   ├─ breakout.test.ts            # 打砖块物理（13 个用例）
   ├─ tictactoe.test.ts           # 井字棋（6 个用例）
   └─ ...                         # 其它联机游戏的逻辑测试
```

> 测试用的是 Node 内置测试运行器，Node 22.6 以上可以直接运行 `.ts` 文件，
> 所以项目没有引入 Jest / Vitest，`npm install` 只装 25 个包。

## 怎么再加一个游戏

1. 在 `src/games/` 下新建组件，例如 `Pong.tsx`。
2. 在 `src/games/registry.ts` 的 `GAMES` 数组里加一条记录
   （`id` 就是访问地址 `#/pong`）。
3. 在 `src/App.tsx` 的 `GAME_COMPONENTS` 里把 `id` 映射到组件。

成绩记录用 `useBestScore('pong', 'max')` 即可，`'min'` 表示数值越小越好。

## 技术栈

React 19 · TypeScript · Vite · 原生 CSS · GitHub Actions
