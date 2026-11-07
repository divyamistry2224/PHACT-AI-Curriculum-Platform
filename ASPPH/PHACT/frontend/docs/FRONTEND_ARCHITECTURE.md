# PHACT front end architecture

This front end keeps the Figma Make page designs and visual system, with a data layer that matches the
PHACT backend.

## Runtime shape

- `src/routes.ts` is the page registry (paths, labels, roles, navigation groups).
- `src/App.tsx` owns `HashRouter`, the signed-in user, the active syllabus, and the review being watched.
- `src/components/Layout.tsx` owns the shell, navigation, and notifications.
- `src/components/workspace.tsx` holds shared workflow pieces: syllabus and review loading with polling,
  the keep/discard bar, the diff view, the document view, and the approval panel.
- `src/api/index.ts` picks the live adapter (`http.ts` + `cognito.ts`) or the mock adapter (`mock.ts`) at
  startup. Pages import only `src/api`.
- `src/types.ts` mirrors the backend's response shapes field for field.
- `src/lib/` has the line diff, Markdown-to-blocks parsing, and the DOCX and PDF builders.

## Routing

Hash routes (`/#/dashboard`) so static hosting on S3 and CloudFront works without rewrite rules.

## Faculty workflow

Upload, then competency review, then AI recommendations, then review and submit, then export. Each review
creates the next version of the working copy; the faculty member keeps or discards it. One review runs at a
time per syllabus; pages poll every 3 seconds while one is running.
