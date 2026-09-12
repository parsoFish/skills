---
type: regex
target: { source: file, path: docs/reference/infra.md }
pattern: "(^\\|\\s*app\\s*\\|[\\s\\S]*^\\|\\s*network\\s*\\|)|(^\\|\\s*network\\s*\\|[\\s\\S]*^\\|\\s*app\\s*\\|)"
flags: "m"
---
The generated module table names both modules as their own table rows ("| app | ... |" and
"| network | ... |"), not merely as two words that happen to appear somewhere in the file. A
loose word-anywhere match would also pass on a file that only discusses networking or
application concerns in prose without ever naming either Terraform module.
