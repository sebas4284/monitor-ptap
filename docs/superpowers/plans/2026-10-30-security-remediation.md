# Security remediation implementation plan

> **For agentic workers:** Use Superpowers executing-plans for the coordinated work and dispatching-parallel-agents for independent domains. Track each verification below.

**Goal:** Correct SEC-01 through SEC-06, close the application insecure-write bypass, mitigate DEP-01, and verify the actual safe behavior without claiming unobserved production changes.

**Architecture:** Authenticate and authorize sockets from current account state, isolate client state between identities, make authentication responses and logging private, and verify the command ledger against a checkpoint outside MySQL. Preserve telemetry demo isolation and normal authorized operations.

**Tech Stack:** NestJS 12.3.2, Socket.IO 4.8.4, Expo SDK 58, TypeScript, Node 26.12.1.

**Spec:** docs/security-audit/2026-10-30/INFORME.md.

## Global constraints

- Read exact Expo v58 documentation before code changes (done).
- Preserve prior user edits and the original audit evidence.
- No live PLC writes, deployment, unknown package execution or corporate uploads.
- Cloudflare connector lookup returned no matching plugin; external account changes remain unverified.
- Existing reviewed local project dependencies/tests may be used with synthetic configuration; no installation scripts or entrypoints that load production settings.

## Review focus

- Demoted/deactivated users and JWT expiry while a socket is already open.
- Delayed storage hydration or push responses after logout and account switch.
- Ledger deletion, unsigned records and missing/tampered checkpoints must not report intact.
- Duplicate registrations and broken SMTP must not disclose secrets or membership.
- Production insecure-write flags and malicious merge keys must fail closed.

## Tasks

- [x] Client session isolation: 19 new regressions, identity-scoped/cleared caches, hydration and late-response races verified.
- [x] Registration and secrets: generic registration/re-send independent of SMTP latency; sanitized logs; targeted red-green tests.
- [x] Socket authorization: Civil/inactive/demoted/expiry regressions and real local Nest/Socket.IO revocation test; demo remains DB-free.
- [x] Ledger integrity: external checkpoint, fail-closed missing baseline, unsigned/truncated history and pending/concurrent signing cases; explicit baseline tool and operations procedure.
- [x] OPC and dependency mitigation: insecure override removed; actual encrypted local OPC read/write tested; local licensed deepmerge patch verified with clean offline install and Expo resolution.
- [x] Integration: 875/875 full tests; official workspace typecheck, lint (warnings), backend/shared build and Expo web export pass. Additional optional test-fixture type diagnostic still has existing errors, explicitly recorded.

Evidence: docs/security-audit/2026-10-30/CORRECCIONES-Y-VERIFICACION.md and verification-final.json. Cloudflare was explicitly deferred by the user; no certificate changes. Production deployment, PLC hardening/flags and host checkpoint baseline are operational prerequisites, not claimed as performed.

No commits, publishing or infrastructure mutation are required for this local correction task. Production and Cloudflare claims require corresponding access and runtime evidence.
