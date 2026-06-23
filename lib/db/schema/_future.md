# Future Tables (v2)

不进 Drizzle 编译，仅记录后续模块的表设计草图。

## research
- id (uuid)
- address (FK → users.address)
- topic (text)
- report_md (text)
- total_spent (numeric)
- created_at (timestamptz)

## tx_log
- id (uuid)
- address (FK → users.address)
- tx_hash (text unique)
- amount (numeric)
- type (text)   # 'research_data' | 'swap' | ...
- created_at (timestamptz)

## agent_config
- address (PK, FK → users.address)
- default_budget (numeric)
- preferred_sources (text[])
- updated_at (timestamptz)
