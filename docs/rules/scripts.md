# scripts rules



- **Performer vs Writer Separation**: Performers and writers go in separate fields (`artist` / `recordings[].artist` vs `writers`). Website artist credits or release performer credits must NEVER be read or converted into song writers.


- **Rights Provenance & Verified Shares**: Read verified per-work writer and share details from source records; preserve unknown details as unknown rather than manufacturing default writer identities or 100% shares from account headers.


- **Positional Share Association**: When pairing multi-writer share columns with writers, preserve blank positions (e.g. `; 50%`) so later writers' shares are never shifted onto earlier writers.


- **Fail-Closed Source Resolution**: Loader scripts must require all external source files and validate their shape/content before connecting or writing. Missing, empty, or unrecognized sources must produce a clear refusal with zero writes; baseline seeds must not masquerade as captured sources.


- **Multi-Source Recording Enrichment**: Merge verified missing fields on matching recordings across sources (matching by ISRC, audio URL, or release/artist) and fail closed on conflicting identifiers rather than silently dropping later fields.


- **Post-Apply Count & Mutation Verification**: Always check acknowledged insert/update results and verify that the post-apply collection count strictly equals starting count plus planned inserts before declaring completion, refusing mismatches.


- **Sparse Unique URL Constraint**: Songs not yet recorded omit `url` (`delete payload.url` if falsy) rather than storing empty strings or null, preserving MongoDB's sparse unique index constraint.


- **Safe-Run Migration & Loader Guard**: Catalog scripts parse and validate hostnames and deliberate database-name conventions (`dev`, `test`, `copy`), refusing execution against non-local/production databases unless `--force` is passed explicitly.


- **No `process.env.DROPBOX_` in `src/`**: Files in `src/` must never reference `process.env.DROPBOX_*` (enforced by regression tests). Use domain-specific variable names (e.g. `SONG_ARCHIVE_FILE`) for external paths.
