# Fork Feature Architecture and Security Review

Date: 2026-04-09
Scope: fork branch compared to upstream main, grouped by features listed in README.
Audience: implementation developer / maintainer.

---

## Executive summary

The fork is functionally rich and generally follows Docmost layering (client UI + shared editor-ext + server services). The strongest implementation areas are import overwrite/remap and Yjs-backed page properties.

The main risks are:

1. Notification digest data loss on transient failures (high reliability risk).
2. XMind conversion endpoint authorization/resource-hardening gap (security and abuse risk).
3. A few architecture consistency issues (policy checks duplicated, global event bus coupling, local-only persistence for behavior presented as space/folder settings).

---

## Security concerns (initial review findings)

### 1. High: digest notification loss on transient failure

- Location:
  - apps/server/src/core/notification/services/page.notification.ts:301
  - apps/server/src/core/notification/services/page-update-email-rate-limiter.ts:32
- Problem:
  - `popDigest()` does `LRANGE + DEL` before processing email payload. If any processing step fails afterwards (DB read, access filtering, queue failure), notification IDs are already deleted.
- Impact:
  - Silent loss of page-update digest notifications.
- Recommendation:
  - Use reserve/ack semantics (peek first, delete only after successful queueing), or move digest payload handling to retry-safe queue flow.

### 2. Medium: XMind convert endpoint lacks resource-level authorization

- Location:
  - apps/server/src/core/diagrams/diagrams.controller.ts:71
- Problem:
  - Endpoint is guarded by JWT but not bound to page/space edit access (unlike plantuml render).
- Impact:
  - Any authenticated user can trigger expensive conversion requests regardless of page permissions.
- Recommendation:
  - Require pageId and validate edit rights through centralized access checks; add stricter rate limit and input constraints.

### 3. Medium: XMind conversion path is memory-heavy and abuse-prone

- Location:
  - apps/server/src/core/diagrams/diagrams.controller.ts:83
  - apps/server/src/core/diagrams/diagrams.service.ts:99
- Problem:
  - Full upload is buffered, then zip content is parsed fully in memory.
- Impact:
  - Elevated memory/CPU pressure under repeated large uploads.
- Recommendation:
  - Add server-side throttling per user/workspace, tighten file-size/entry-count limits, and validate zip entries defensively.

---

## Feature-by-feature architecture review

## PlantUML diagrams

### What follows architecture well

- Good separation of concerns across layers:
  - Shared node behavior in editor-ext:
    - packages/editor-ext/src/lib/plantuml.ts
  - Client editing UI in feature components:
    - apps/client/src/features/editor/components/plantuml/plantuml-menu.tsx
  - Server render/storage logic in dedicated module:
    - apps/server/src/core/diagrams/diagrams.service.ts

### Concerns

- Authorization style diverges from newer centralized approach:
  - apps/server/src/core/diagrams/diagrams.controller.ts:45
- Recommendation:
  - Migrate to shared page-access validation service to avoid policy drift between modules.

---

## XMind import

### What follows architecture well

- Conversion logic is kept in diagrams service and converter utility, not in controller:
  - apps/server/src/core/diagrams/diagrams.service.ts
  - apps/server/src/core/diagrams/xmind-converter.ts

### Concerns

- Security/authorization gap (see Security concern #2).
- Resource-hardening gap (see Security concern #3).
- Recommendation:
  - Treat this endpoint as privileged content operation, not generic utility endpoint.

---

## Lightbox for diagrams and images

### What follows architecture well

- Standalone reusable modal component:
  - apps/client/src/features/editor/components/common/image-lightbox.tsx

### Concerns

- Uses a global window event bus with string event names:
  - apps/client/src/features/editor/components/common/image-lightbox.tsx:27
  - apps/client/src/features/editor/components/plantuml/plantuml-menu.tsx:134
- Impact:
  - Implicit coupling, weaker type safety, harder integration testing.
- Recommendation:
  - Replace with app-level state channel (atom/context/store) while preserving current UX.

---

## Logo badge overlay

### What follows architecture well

- Badge behavior is integrated at node-view rendering layer where media metadata already lives:
  - packages/editor-ext/src/lib/plantuml.ts

### Concerns

- No major architecture violations found in sampled implementation.

---

## Page properties

### What follows architecture well

- Strong model alignment with collaborative editing:
  - Properties stored in Yjs map and synchronized in panel:
    - apps/client/src/features/editor/components/page-properties/properties-panel.tsx
- Legacy compatibility handled cleanly via migration shim:
  - packages/editor-ext/src/lib/page-properties/page-properties.ts

### Concerns

- Custom minimal YAML parser/stringifier is intentionally limited:
  - packages/editor-ext/src/lib/page-properties/yaml-utils.ts:13
- Impact:
  - Complex YAML can be parsed/serialized lossy.
- Recommendation:
  - Consider hardened YAML library for long-term correctness and round-trip guarantees.

---

## Import improvements
(Overwrite mode, skip unchanged, summary report, Joplin/OneNote parsing)

### What follows architecture well

- Heavy import logic stays server-side in import services.
- Overwrite remap logic for parent IDs is thoughtfully implemented:
  - apps/server/src/integrations/import/services/file-import-task.service.ts:680
- Summary page generation is outside main transaction to avoid import rollback on report failure:
  - apps/server/src/integrations/import/services/file-import-task.service.ts:851

### Concerns

- Skip-unchanged comparison strips all whitespace before compare:
  - apps/server/src/integrations/import/services/file-import-task.service.ts:690
- Impact:
  - Can mark semantically changed content as unchanged in edge cases.
- Recommendation:
  - Compare canonical structured content (or normalized ProseMirror JSON) instead of global whitespace collapse.

---

## Page sorting

### What follows architecture well

- Clear effective sort resolution and recursive re-sort utilities:
  - apps/client/src/features/page/tree/atoms/sort-atom.ts:34
  - apps/client/src/features/page/tree/utils/utils.ts

### Concerns

- Sort preferences persist only in browser local storage:
  - apps/client/src/features/page/tree/atoms/sort-atom.ts:14
- Impact:
  - Settings are device-local, not shared across clients/users despite feature wording that implies wider scope.
- Recommendation:
  - If intended as product-level setting, move to backend persistence keyed by user/space/page.

---

## Persistent aside panel

### What follows architecture well

- Persistence is isolated and simple in atom storage:
  - apps/client/src/components/layouts/global/hooks/atoms/sidebar-atom.ts

### Concerns

- Minor duplication in Aside rendering path:
  - apps/client/src/components/layouts/global/aside.tsx:23
  - apps/client/src/components/layouts/global/aside.tsx:51
- Recommendation:
  - Render selected content once to reduce branching duplication.

---

## Priority actions for developer

1. Fix digest reliability first (high): make digest processing retry-safe without pre-delete data loss.
2. Harden and authorize XMind conversion endpoint: page-bound auth + throttling/limits.
3. Normalize policy checks in diagrams/watcher-like modules to centralized access service.
4. Decide product intent for page sorting persistence (local-only vs server-persisted).
5. Replace minimal YAML parser with hardened parser if broad frontmatter compatibility is required.

---

## Notes

- This review is architecture/best-practice focused for fork-added features from README.
- It complements the earlier bug/regression review and reuses those security findings where relevant.
