---
name: Group file upload ownership
description: Security and client-transport rules for generic Group file attachments.
---

Generic Group files must be uploaded through a bounded server endpoint that validates the real bytes and assigns the uploader ACL at write time. Finalization may confirm an existing same-owner ACL, but must never claim an ACL-less object path.

Assets referenced by private Groups must not remain retrievable through a universal public object route. Universal serving must fail closed for every normalized stored-URL form, while a Group-aware route checks both viewer access and that the object is referenced by that exact Group.

**Why:** An ACL-less pending object can be claimed by whichever caller finalizes it first, including a concurrent or malicious caller who learns the path. Separately, public object ACLs let a known URL bypass private-Group access checks. Orval 8.9.1 serializes binary `Blob` request bodies as JSON by default, producing `{}` instead of raw bytes even though TypeScript passes.

**How to apply:** For future generic-file features, owner-bind the object during the authenticated byte upload and reject missing or foreign ACLs during attachment. Keep a fail-closed post-generation check proving every generated `Blob` body is sent raw. Whenever a new private-Group media URL column is added—including event images—include it in both the universal-route denial matcher and same-Group protected reference check, rewrite every private serializer, and test every persisted URL form.