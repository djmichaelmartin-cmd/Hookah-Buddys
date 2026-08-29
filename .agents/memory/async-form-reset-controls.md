---
name: Async form reset controls
description: Reliable visual hydration of controlled choices when React Hook Form resets from asynchronously loaded data.
---

Forms hydrated after an API query must render every Select and RadioGroup from the current field value, not an initial default. Verify non-default choices visibly after a full reload.

**Why:** Radix choice controls using `defaultValue` retained their initial labels after React Hook Form `reset()`. In this project, even a controlled Radix Select could retain its placeholder label after async hydration; native controlled selects restored reliably.

**How to apply:** Use `value` for RadioGroups. For critical async-hydrated Select fields, test the visible trigger text with non-default saved data; use a controlled native select if Radix label state does not follow `reset()`.