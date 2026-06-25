# Change: Research Follow-up Q&A
## Why
Full report 只能查看一次性研究结果，用户无法基于报告继续追问。追加问答可以把报告详情页变成连续分析入口，同时保留每次追问的预算与调用记录。

## What Changes
- 在 `/research/[id]` 报告详情页增加 follow-up Q&A thread。
- 增加受保护的 follow-up API，基于原始 topic、report、历史 Q&A 和剩余 budget 生成追加回答。
- 持久化每次 follow-up 的 question、answer、状态、花费和时间。
- 保持所有用户可见文案为英文，并延续 Bloomberg terminal 风格。
- 为 API、repo 和 UI 增加 RED-GREEN 测试。

## Impact
- Affected specs: `research-web-ui`
- Affected code: `app/research/[id]/*`, `app/api/research/[id]/*`, `lib/db/*`, `lib/agent/*`, `components/research/*`
