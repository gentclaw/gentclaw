# AI Agent Rules

All written output (docs, comments, JSDoc, commit messages) — optimize for LLM consumption. No fluff. Token-dense.

## Review Tracking

AI-KEYWORDS: review, reviewed, unreviewed, tag, status

Commit review state tracked via lightweight git tags (`reviewed/<short-hash>`).

| Action | Command |
|--------|---------|
| Setup aliases | `bin/setup-review-tags` |
| Mark reviewed | `git reviewed [commit]` |
| Show status | `git review-status` |
| List unreviewed | `git unreviewed [base]` |
