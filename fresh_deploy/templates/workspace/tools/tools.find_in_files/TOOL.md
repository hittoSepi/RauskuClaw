# tools.find_in_files

Purpose:
- Search text content inside workspace files.

Input:
- `query` (required): text (or regex pattern when `regex=true`) to find.
- `path` (optional): base directory inside workspace (default `.`).
- `files` (optional): explicit relative file paths to search; when provided, search targets this list.
- `regex` (optional): treat `query` as regex pattern (`false` by default).
- `case_sensitive` (optional): case-sensitive matching (`false` by default).
- `include_hidden` (optional): include dotfiles and hidden directories when scanning `path` (`false` by default).
- `max_results` (optional): max line matches to return (1..500, default 100).
- `max_bytes_per_file` (optional): skip files larger than this many bytes (512..2097152, default 262144).
- `max_scanned` (optional): scan budget for file entries/files (100..50000, default 5000).

Output:
- `matches[]`: `{ path, line, column, text }` per hit.
- `result_count`: number of returned matches.
- `has_more`/`truncated`: true when search stopped because limits were reached.

Notes:
- Workspace-scoped: paths cannot escape workspace root.
- Use this when you need content search (`TODO`, function names, config keys), not just filename search.
