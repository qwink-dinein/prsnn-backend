# prsnn-backend — notes for Claude

Part of prsnn (book verified companions in Hyderabad). Sibling repos:
`qwink-dinein/prsnn-backend` (Express + MongoDB API), `qwink-dinein/prsnn-frontend`
(Next.js web + admin), `qwink-dinein/prsnn-mobile` (Expo app; its PRD.md, design.md,
Architecture.md and API.md describe the whole system).

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected.
