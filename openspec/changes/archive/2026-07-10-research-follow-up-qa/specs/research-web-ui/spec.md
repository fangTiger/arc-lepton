## ADDED Requirements

### Requirement: Research Follow-up Q&A
系统 SHALL 在受保护的 research 报告详情页支持基于已有报告追加问答。

#### Scenario: Submit a follow-up question
- **GIVEN** an authenticated user owns a research report
- **WHEN** the user submits a non-empty follow-up question from `/research/[id]`
- **THEN** the system creates a follow-up record, runs the agent with the original topic and report context, and appends the answer to the thread

#### Scenario: Reject unauthorized follow-up access
- **GIVEN** an authenticated user does not own the research report
- **WHEN** the user lists or creates follow-up questions for that research id
- **THEN** the API returns `FORBIDDEN` and does not expose report, tx, or follow-up content

#### Scenario: Preserve English user-facing copy
- **GIVEN** the follow-up UI is visible to the user
- **WHEN** the user views labels, buttons, placeholders, errors, and generated fallback messages
- **THEN** all user-facing copy is English
