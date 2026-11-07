# Branch integration

| Source branch | Commit | Included work |
| --- | --- | --- |
| master | 834cbb7 | Current React app, SAM backend and infrastructure |
| arch_readme | 53e3302 | Already included in master |
| codex/phact-frontend | c76b1b8 | Already included in master |
| subject_dropdown_removal | f3dcb6a | Already included in master |
| v1_complete | 0ad8ae3 | Already included in master |
| feat/phact-agents-rag | f9d7874 | Imported agents/ and contracts/ under ASPPH/PHACT |
| phact-frontend-replacement | bbe67d9 | Preserved under prototypes/frontend/ |

The alternate frontend predates the current API and leaves multiple live operations unimplemented. Its source is retained as a prototype; the current frontend remains at ASPPH/PHACT/frontend/.

The RAG branch adds AgentCore, Strands, corpus preparation, citation validation, document checks, and post-processing. It uses a different output contract from the SAM review API. Both implementations are included; switching the application to AgentCore requires an explicit API adapter and cloud deployment configuration.

Branch changes were imported into the independent repository without replacing the current README, branding, or presentation files.

Validation: 87 backend tests and 30 RAG tests passed. README links and analysis schema JSON were checked. Live AWS inference, AgentCore deployment, and the archived frontend were not tested.
