# Gig-outreach reply recording

The unattended server-side Gmail reply scan (`POST /outreach/check-replies`, `findReplies`, `classifyReply`) has been retired.

Replies to booking pitches are recorded interactively through `/handle-gmails`, which matches incoming emails against outreach records and records the outcome via `POST /outreach/:id/outcome` with status `replied`.
