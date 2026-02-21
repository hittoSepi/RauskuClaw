---
name: git-auto-add
enabled: true
event: file
action: exec
conditions:
  - field: file_path
    operator: regex_match
    pattern: ^(.+)$
command: git add "{file_path}"
---