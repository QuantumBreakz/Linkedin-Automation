/**
 * Adapter registration barrel.
 *
 * Every adapter module calls `registerAdapter()` as an import side effect, so
 * the registry is only populated for modules that have actually been imported.
 * Anything that calls `getAdapter()` must import this barrel first, otherwise
 * the lookup throws for a kind the app genuinely supports.
 *
 * Covers the six `SourceKind` values that have adapters; `RSS` and
 * `MANUAL_URL` are declared in the schema but not yet implemented.
 */

import './openalex'; // OPENALEX_AUTHOR
import './orcid'; // ORCID
import './arxiv'; // ARXIV_AUTHOR
import './pubmed'; // PUBMED_QUERY
import './crossref'; // CROSSREF_QUERY, MANUAL_DOI
