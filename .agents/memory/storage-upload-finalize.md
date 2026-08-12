---
name: User image upload security pattern
description: Why user image uploads go through a bounded server-side endpoint instead of presigned PUT URLs.
---

**Rule:** user image uploads must go through a bounded server-side endpoint: the body parser caps the byte size before anything reaches storage, the real bytes are sniffed for an image magic signature (deriving the authoritative content type), and the stored object is stamped with an owner ACL policy at write time. The object-serving route refuses objects without that policy or with non-image content types, and always sends `X-Content-Type-Options: nosniff`.

**Why:** presigned PUT URLs from the sidecar signer cannot cryptographically bound upload size or content type — a client can declare a tiny JPEG and PUT gigabytes of HTML, enabling storage exhaustion and same-origin stored XSS. Client-declared metadata and object contentType metadata are both attacker-controlled. Post-upload validation alone still lets unbounded bytes reach durable storage.

**How to apply:** any new feature accepting user images (posts, albums, doll media) must reuse the bounded upload + byte-sniff + owner-ACL flow and reject `data:` URLs or arbitrary external URLs at every write path, including registration-time fields.
