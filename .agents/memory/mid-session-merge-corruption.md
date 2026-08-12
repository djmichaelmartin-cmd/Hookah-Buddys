---
name: Mid-session merge corruption
description: Parallel task merges can land mid-session and mangle files you already fixed
---
When parallel tasks merge into your branch mid-session, hot files (e.g. shared route files) can end up with interleaved/duplicated blocks that still look plausible.

**Why:** Task #43/#44 merges twice left events routes with handler bodies missing their route declarations and variables used before definition; the working tree was "clean" so the corruption lived in commits.

**How to apply:** After any automatic merge notification, re-read and re-typecheck files you touched before calling markTaskComplete — don't trust an earlier green typecheck.
