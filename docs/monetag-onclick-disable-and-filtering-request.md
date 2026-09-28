# Monetag — OnClick disable + Ad-content filtering request

**Prepared:** 2026-09-28 14:54 UTC
**Prepared for:** publisher action in the Monetag dashboard and/or a ticket to Monetag support (support@monetag.com)

## Account / site identifiers

| Field | Value |
|---|---|
| Site ID | `3500466` |
| Domain | `omnistoreerp.com` |
| Multitag Zone | `288239` — `https://quge5.com/88/tag.min.js` with `data-zone="288239"` |

---

## Request 1 — Disable the OnClick / Popunder format for zone 288239

### Problem (measured on production, 2026-09-28)

The Multitag's **OnClick / Popunder** format — runtime sub-zone **`11912374`** (`js_build=iclick-v1.1915.0`) —
consumes the visitor's **first click** after every fresh load of the Platform Home and **replaces the
current tab's navigation** with the ad chain:

```text
click on https://omnistoreerp.com/ (or /platform.html)
  → https://6opo.com/wrr?z=11912374&...&js_build=iclick-v1.1915.0        (format arm/registration)
  → https://o-set.com/?wm=11912374&t=onclick                            (redirect step)
  → https://ay267.com/afu.php?zoneid=11912374&...&sf=1                  (ad landing)
  → final destinations observed: https://nennne.cc/ , https://en.a8king.com/...
```

Reproduced 6× on 2026-09-28 in a normal (non-automated) browser session, including clicks on
non-link controls (language switcher) — i.e. the interception is document-wide, not limited to our links.

Every Platform → Marketplace entry point is a plain same-tab `<a href="/marketplace/">`
(top nav, hero CTA ×2, footer, bottom nav), so the visitor's route to the Marketplace is replaced by the ad.
The Marketplace page itself (`/marketplace/`) carries no ad tag and is fully functional on direct URL entry.

### Evidence captured (no interaction with the ad)

- Network chain above with exact zone IDs and `js_build` versions.
- Landing destination content classification: gambling/betting-related intermediary pages.
- Full technical log: see `PR #14` description and the `verify-platform-nav.js` harness output.

### What we are asking for

Either:

1. **Disable the OnClick / Popunder format for Multitag zone `288239`** while keeping the other formats
   (Push Notifications, In-Page Push, Vignette Banner) active; **or**
2. Issue a **replacement Multitag zone without the OnClick format** for `omnistoreerp.com` (Site `3500466`)
   and we will swap the tag locally (same tag semantics, no other code change).

Note: Monetag documentation states the Popunder is the primary Multitag format and that disabling it
switches off the remaining Multitag formats. If so, option 2 (a non-OnClick zone) is our preferred outcome.
Please confirm what is possible for this site.

### Why (policy)

`11912374` is already listed in this repository's own `PROHIBITED_ZONES`
(`platform/tests/section-lockdown.test.cjs`) — the OnClick behaviour was never an accepted integration state.

---

## Request 2 — Ad-content filtering (adult / porn / gambling / betting / casino)

Per Monetag's official guidance ("I want to filter ads appearing on my website"), campaign-level filtering
is done by Monetag support upon request, by zone IDs + campaign identifiers/links/screenshots.

### Requested exclusions

- Pornographic / adult / erotic content
- Gambling / betting / casino / sports betting

### Identifiers to scope the request

- `SITE_ID=3500466`
- `ZONE_ID=288239` (and its runtime sub-zones `11912374`, `11912375`, `11912376`, `11912377`)
- `DOMAIN=omnistoreerp.com`

### Campaign evidence captured for the filtering request

| Item | Value |
|---|---|
| Date/time (UTC) | 2026-09-28T14:44–14:55Z |
| Entry chain | `6opo.com/wrr?z=11912374` → `o-set.com/?wm=11912374&t=onclick` → `ay267.com/?z=11912374` / `ay267.com/afu.php?zoneid=11912374` |
| Destination URL (1) | `https://nennne.cc/` |
| Destination URL (2) | `https://en.a8king.com/posts/28b10005.htm` — page self-describes as a disguised "Video Zone" with a click-to-continue gate |
| Campaign ID | **Not identifiable without ad interaction** — not captured, by design (no clicks on ads, no synthetic traffic) |
| Screenshots | Captured locally by the publisher during the reproduction session |

If Monetag can map the `o-set.com` / `ay267.com` / `zoneid=11912374` chain to concrete campaign IDs on
their side, we ask that those campaigns be excluded from all zones of Site `3500466`.

We understand CPM rates may decrease as a result of filtering; please confirm the expected impact.

---

## What the publisher (us) will do after Monetag's change

- Re-run the navigation contract harness: `npm run test:e2e:nav -- --base https://omnistoreerp.com`
  (expected: all checks PASS / resolved).
- Re-verify in a normal browser session that the first click on the Platform Home reaches
  `/marketplace/` instead of the ad chain.
- Confirm Monetag's meta/tag/zone presence is unchanged in the process (it is not touched by us).

## Explicitly out of scope for the codebase

No click-shields, no JavaScript click interception, no CSS forced resizing of ad containers, no fake ads
or placeholders, no removal of Monetag, no changes to the visitor counter, heartbeat, or Marketplace.
The in-DOM audit on 2026-09-28 found **zero** ad containers in the Marketplace DOM
(0 iframes, 0 ad containers, 0 large overlays) — the hijack originates entirely outside our DOM,
which is why the fix must be applied in the Monetag configuration.
