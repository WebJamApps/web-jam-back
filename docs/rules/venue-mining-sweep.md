# venue-mining-sweep rules



- **Date-Field Normalization for Unique Calendar-Day Records**: When API endpoints record events or sweeps deduplicated by calendar date (e.g., `{ metroSlug, sweptAt }`), normalize input timestamps to UTC midnight (`new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))`) before query lookup and persistence so varied client timestamp representations on the same calendar day do not bypass duplicate detection or create duplicate records.
