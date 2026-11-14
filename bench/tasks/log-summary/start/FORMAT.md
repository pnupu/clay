# Output of summarize.py

Print one JSON object with these keys:

- `total`: number of valid request lines.
- `skipped`: number of non-empty lines that are not valid combined-log-format lines.
- `by_status`: object mapping each HTTP status code (as a string) to its count.
- `bytes`: sum of the response size field over valid lines; a size of `-` counts as 0.
- `top_paths`: the 3 most requested paths as `[path, count]` pairs, most requested first;
  ties are ordered by path, ascending. The path excludes the query string
  (`/search?q=x` counts as `/search`). Fewer than 3 distinct paths gives a shorter list.
- `methods`: object mapping each HTTP method to its count.

Blank lines are ignored (neither counted nor skipped).
