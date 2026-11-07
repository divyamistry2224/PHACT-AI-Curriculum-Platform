> Earlier design notes. Current branch code is in `ASPPH/PHACT/agents/`; its implementation differs from these notes.

PHACT RAG Pipeline — Architecture Review and Gap Analysis
There are some gaps, but the current design already covers most of the core RAG functionality. The main gaps involve integration with the team's architecture, source version consistency, and failure recovery. Some of these gaps are already explicitly documented, which means they are known incomplete items rather than necessarily design flaws.
The following review is based on the documentation you provided. I have not reviewed the actual source code, so I cannot verify whether the tests, access controls, or citation validation mechanisms work as described.
1. Highest Priority: Two Execution Architectures Are Currently Described
The original technical specification defines the following architecture:
API → Worker Lambda → Strands agents running on AgentCore → RAG / Model
However, the current pipeline describes the worker as:
API → Worker Lambda → Direct Retrieve + Converse execution
The documentation also mentions that Strands can invoke the RAG module. This creates ambiguity and could lead different teammates to implement separate execution paths.
Option
Advantages
Trade-offs
Worker executes RAG directly
Simpler integration and fewer invocation layers
Deviates from the original AgentCore architecture and requires alignment with the team and mentor
Worker invokes AgentCore, and Strands uses the RAG core
Matches the original architecture and preserves the team's agents
Introduces an additional deployment layer, IAM permissions, and error handling

If the team intends to follow the original architecture, I recommend the second option.
The pipeline should explicitly define the responsibilities of each component:
Worker Lambda: Manages job status and result storage.
AgentCore: Executes the analysis workflow.
RAG module: Handles retrieval, generation, and validation.
Both execution layers should not independently generate separate analysis results.
2. Source Versions Are Recorded, but Each Analysis Must Use a Consistent Version
Using approved/v1/ is a good starting point. However, if four retrieval operations run sequentially while an administrator updates the knowledge base, a single analysis could unintentionally combine old and new source material.
The following mechanisms should be added:
Record corpus_version when a job is created.
Restrict all retrieval operations within that job to the same corpus version.
Store source_id, source version, evidence text, and an identifiable chunk hash or ID with the results.
Make a new corpus version available to new jobs only after synchronization and retrieval validation have completed.
Retain older corpus versions until all jobs depending on them have finished.
Recording a version number in job metadata is not sufficient. Retrieval must actually enforce that version constraint.
If an older version has already been removed from the index, an existing job cannot reliably continue retrieving from that version.
Two situations should also be handled differently:
Routine updates: Existing jobs may continue using their original corpus version.
Emergency source withdrawal: If a source is withdrawn because of sensitive information or another critical issue, the system must reassess whether existing jobs are still permitted to use it and terminate them if necessary.
3. The Asynchronous Workflow Still Needs Additional Failure-Recovery Mechanisms
The documentation mentions recovery for jobs stuck in RUNNING, which is necessary. However, several additional failure scenarios remain.
Failure scenario
Potential current behavior
Required improvement
API creates a QUEUED job, but worker invocation fails
Job remains in QUEUED indefinitely
Invocation failure handling, retries, or stale QUEUED job detection
Worker claims a job but terminates unexpectedly
Job remains in RUNNING indefinitely
started_at, execution deadline or lease, and timeout recovery
The same job is retried
Duplicate model charges or an older worker overwriting a newer result
attempt_id and conditional updates when completing jobs
Result is written to S3, but DynamoDB update fails
Result exists, but the job is not marked successful
Deterministic result location and a recoverable completion workflow

Conditionally claiming a QUEUED job helps reduce duplicate execution, but it does not fully solve recovery and retry problems.
4. The 90 KB Limit Does Not Replace Token and File Limits
The current implementation limits the size of extracted text. Additional controls are still needed:
Upload file size limits, PDF page-count limits, and OCR execution timeouts.
Protection against malformed or specially constructed DOCX/PDF files that consume excessive memory.
Model input token budget, accounting for the syllabus, four retrieval result sets, and the prompt.
Maximum generation output length and handling of truncated responses.
Amazon Comprehend request size limits and a text segmentation strategy.
This is particularly important because the current approach uses one chunk per page.
Some pages may contain substantial amounts of text. Combining results from four searches could exceed a reasonable model context or token budget.
The system should deduplicate retrieved content, select the most relevant evidence, and only then perform generation.
5. The Four Retrieval Operations Need Explicit Query and Missing-Evidence Rules
The current design defines retrieval categories but does not clearly explain whether queries are generated from the actual syllabus content.
For example, an epidemiology course and a public health leadership course should not rely on the same generic AI-generated search keywords.
Recommended improvements:
Generate retrieval queries based on learning objectives, assignments, and course topics.
Define the number of retrieved results and source-filtering rules for each category.
Deduplicate overlapping evidence chunks.
When evidence is insufficient, report the gap only for the relevant portion rather than forcing a complete answer.
Allow empty results for course examples when no appropriate approved sources exist.
Retrieval relevance scores should not be treated as confidence scores indicating how accurately a competency has been mapped.
6. Citation Validation Is a Good Start, but Source Existence Does Not Guarantee Evidential Support
The current checks for citation IDs, ASPPH document types, and the CEPH competency framework are necessary.
However:
Citing a legitimate CEPH document does not automatically mean that the model selected the correct competency number or interpreted it accurately.
The output should also include:
Field
Purpose
Original syllabus text / location
Identifies the learning objective or assignment being analyzed
Competency ID and description
Allows validation against the official framework
Evidence excerpt
Provides the original text supporting the proposed mapping
Mapping rationale
Explains how the AI connects the syllabus content to the competency
Insufficient evidence / partial support
Prevents the model from forcing mappings for every learning objective

The system also needs prompt injection prevention and testing.
Instructions embedded in syllabi or retrieved source documents must be treated as untrusted data and must not override system-level instructions.
PII removal and topic guardrails do not, by themselves, address prompt injection vulnerabilities.
7. Frontend and Backend Integration Still Needs a Formal Data Contract
The current documentation defines job input fields, but teammates still lack a stable output schema for rendering analysis results.
At minimum, the team should agree on the following fields:
schema_version
job_id, analysis_id
corpus_version
recommendations[]
competency_mappings[]
evidence[]
warnings[]
review_status: DRAFT
Job execution status and human review status must remain separate.
For example:
job.status = SUCCEEDED: The analysis completed successfully from a system-execution perspective.
output.review_status = DRAFT: The generated analysis has not yet been approved by an instructor.
If evidence excerpts are stored in a private S3 bucket, the application also needs an authenticated and authorized API endpoint for retrieving source documents or excerpts.
This will allow the frontend to provide functional "View Evidence" interactions rather than displaying citations that users cannot actually inspect.
8. Validation Still Requires Live AWS Integration and Quality Acceptance Testing
Confirming that text was extracted from all 196 pages demonstrates that extraction produced output. It does not establish that tables were parsed correctly, competency identifiers are complete, or citations are accurate.
Before full integration, the team should complete the following acceptance tests:
Acceptance test
What it should demonstrate
Retrieval tests with known answers
The correct documents and evidence chunks can be retrieved
Queries with no relevant sources
The system acknowledges insufficient evidence
Source update / withdrawal tests
New analyses do not use disallowed sources
Tests across different instructor accounts
Users cannot access other instructors' inputs or results
End-to-end AWS analysis
Real IAM, KMS, model, and Knowledge Base calls work correctly
Stage-level performance measurements
The team can identify time spent on OCR, preprocessing, retrieval, and generation

The approximately 60-second processing time should currently be treated as a performance target, not an achieved result.
If OCR becomes the main performance bottleneck, consider separating the workflow into two stages:
Upload and text extraction confirmation
Full AI analysis
The application can then report the processing time of each stage separately.

Final Recommendation: Four Priorities Before Full Integration
I recommend prioritizing the following four improvements:
1. Finalize the AgentCore integration architecture.
Decide whether Worker Lambda invokes AgentCore and whether Strands agents are responsible for orchestrating RAG execution. Establish a single execution path with clear ownership.
2. Define the output JSON contract.
Agree on a versioned schema shared by the frontend, backend, and RAG components, including competency mappings, evidence, warnings, and review status.
3. Enforce corpus version consistency for each analysis.
Ensure all retrieval operations within a job use the same approved source version, and preserve the evidence required for reproducibility.
4. Implement reliable job failure recovery.
Address failed worker invocations, stuck jobs, retries, duplicate execution, and partial failures between S3 and DynamoDB.
The remaining RAG quality improvements can be refined after the first successful live AWS integration, using actual retrieval results, generated outputs, and performance measurements to guide further development.



