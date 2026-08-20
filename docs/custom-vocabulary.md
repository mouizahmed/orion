# Custom vocabulary

Orion stores one provider-neutral vocabulary list per account in `public.account_vocabulary`. The row is owned by `account_id`, cascades with `public.accounts`, and contains only a normalized `text[]` of terms plus timestamps. It does not persist AssemblyAI query syntax, weights, intensifiers, or meeting context.

The authenticated account API is:

- `GET /api/vocabulary` returns the current account vocabulary, or an empty list when no row has been saved.
- `PUT /api/vocabulary` accepts `{ "terms": ["Orion", "SPICED"] }` and returns the saved vocabulary.

The backend trims terms, drops empty values, preserves the first spelling and capitalization supplied, and deduplicates case-insensitively. It returns stable validation codes `vocabulary_too_many_terms` and `vocabulary_term_too_long` for the 100-term and 50-character limits. Account identity always comes from the validated Supabase session; clients cannot submit an account ID.

When a new transcription stream starts, the backend loads the account vocabulary and JSON-encodes the terms as separate entries in AssemblyAI's `keyterms_prompt` connection parameter on both Universal Streaming English channel connections. Retrieval failure is optional and fail-open: transcription continues without keyterms and logs only a context-free warning. Existing streams are never updated in place, so saved changes apply to new recordings.

The desktop Vocabulary settings page supports Enter and pasted newline entry plus removable chips. Valid additions and removals persist immediately; validation or network failures remain visible and failed changes roll back to the last displayed list. Terms are intended for names, brands, products, acronyms, and specialized terminology.

## Security and limits

The table has RLS enabled and forced. `PUBLIC`, `anon`, and `authenticated` have no table access or access to the validation function. `orion_backend` has only `SELECT`, `INSERT`, and `UPDATE`, with matching policies; there is no direct delete permission or endpoint. Database constraints independently enforce normalized non-empty terms, one-dimensional arrays, case-insensitive uniqueness, 100 terms, and 50 characters per term.

AssemblyAI references:

- [Prompting and Keyterms](https://www.assemblyai.com/docs/streaming/prompting-and-keyterms)
- [Streaming Speech-to-Text](https://www.assemblyai.com/docs/speech-to-text/streaming)

Supabase references:

- [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Postgres roles](https://supabase.com/docs/guides/database/postgres/roles)
