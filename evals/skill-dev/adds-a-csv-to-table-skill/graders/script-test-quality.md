---
type: llm
weight: 1
focus: { source: file, path: skills/csv-to-table/scripts/convert.test.mjs }
---
This is the test file for a script that converts CSV text into a GitHub-flavored markdown table.
Score 1 only if the file imports the conversion function from its sibling script (a relative
import of ./convert.mjs or similar) and contains at least one real assertion that exercises the
conversion — for example checking that a header row and a separator row appear, or that a comma
in the input becomes a column boundary in the output. Score 0 if the file is empty, contains no
assertions, never imports the script it claims to test, or only asserts something trivial that
would pass for any implementation (like "the function exists").
