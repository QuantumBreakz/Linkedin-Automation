-- Title normaliser backing dedup passes 2 and 3 (src/services/sources/dedup.ts).
--
-- Must stay behaviourally identical to `normaliseTitleForMatch` in src/lib/ids.ts,
-- which strips diacritics, lowercases, collapses every non-alphanumeric run to a
-- single space, and trims. Diacritics are removed by decomposing to NFD and
-- deleting the combining-mark block (U+0300..U+036F) *before* the alphanumeric
-- pass -- otherwise a mark would become a space and split the word ("naive" would
-- normalise to "nai ve").
--
-- IMMUTABLE so the expression can be indexed and folded into similarity() scans.

CREATE OR REPLACE FUNCTION normalise_title_for_match(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT btrim(
    regexp_replace(
      lower(
        regexp_replace(normalize(coalesce(input, ''), NFD), U&'[\0300-\036F]', '', 'g')
      ),
      '[^a-z0-9]+', ' ', 'g'
    )
  );
$$;
