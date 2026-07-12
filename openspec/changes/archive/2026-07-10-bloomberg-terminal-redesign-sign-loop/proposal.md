# Change: Bloomberg Terminal redesign and manual SIWE sign flow

## Why
当前界面使用圆角卡片、蓝色强调和渐变网格，和产品需要的高密度交易终端气质不一致。钱包连接后的 SIWE 登录由组件 effect 自动触发，用户取消或确认签名后可能被 `isLoading` 状态变化重新拉起，造成签名弹窗死循环。

## What Changes
- 将全局视觉重做为 Bloomberg Terminal 风格：纯黑背景、amber 主色、mono 字体、硬边框、高密度数据面板。
- 在根布局加入顶部状态栏和底部快捷键栏，并重做首页、登录页、钱包按钮、网络错误横幅。
- 钱包按钮新增“已连接但未签名”状态，取消自动登录 effect，用户点击后才触发 SIWE 登录。
- 签名失败或取消后保持在可点击的签名状态，并用顶部固定 mono toast 显示错误。

## Impact
- Affected specs: web-terminal-auth
- Affected code: app/layout.tsx, app/page.tsx, app/(auth)/login/page.tsx, app/globals.css, tailwind.config.ts, components/auth/ConnectWalletButton.tsx, components/auth/NetworkGuard.tsx, components/TopBar.tsx, components/BottomBar.tsx
