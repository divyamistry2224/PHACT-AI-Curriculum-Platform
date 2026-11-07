# Repository maintenance

This project is published independently at https://github.com/divyamistry2224/PHACT-AI-Curriculum-Platform. It is a team project snapshot, with original sources identified in PROVENANCE.md.

## Update your project

```bash
git clone https://github.com/divyamistry2224/PHACT-AI-Curriculum-Platform.git
cd PHACT-AI-Curriculum-Platform
git switch -c update-project-docs
```

Edit files, review `git diff`, then stage only intended changes, commit, and push the branch. Open a pull request to review changes before merging.

## Where files belong

- Application code, infrastructure, deployment scripts and tests: `ASPPH/PHACT/`.
- Presentation and script: `docs/presentation/`.
- Architecture image and editable draw.io source: `docs/architecture/`.
- Logos: `docs/branding/`.
- API workbook and CSV exports: `docs/api/`.
- Research guide and initial observations: `docs/research/`.
- Requirements and proposals: `docs/planning/`.

Keep working code and future proposals clearly distinguished in IMPLEMENTATION_STATUS.md. Update the root README when capabilities or setup requirements change.

## Keep local

Do not commit live passwords, private keys, AWS credentials, real faculty/student syllabi, `.env.local`, `node_modules`, `.venv`, `.aws-sam`, `dist`, `.phact`, or cloud logs. Rotate the demo credentials previously shared in chat before distributing further access.

No repository-wide license was found upstream. Preserve third-party source attribution and confirm reuse rights before assigning a license to code, reference documents, or branding.

## Missing separate RAG source

The RAG package described in the supplied notes was not attached or present in the inspected source branch. Add the actual code, dependencies, tests, and source inventory to `ASPPH/rag_pipeline/` when available; the current planning documents do not constitute that implementation.

Publishing GitHub files does not deploy AWS infrastructure. Follow ASPPH/PHACT/README.md separately for local setup and any authorized cloud deployment.
