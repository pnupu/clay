def slugify(text, max_length=60):
    """Turn a title into a URL slug.

    - Lowercase ASCII only: accented letters lose their accents ("Café" -> "cafe");
      other non-ASCII characters are dropped.
    - Every run of characters that are not a-z or 0-9 becomes a single "-".
    - No leading or trailing "-".
    - At most max_length characters; if the slug is cut, it must not end with "-".
    - An empty result is returned as "".
    """
    raise NotImplementedError
