# Tayba POS v3.0.39 — Touch Card / Scroll Fix

This patch is based on the verified main branch commit:
4302513ec20712653c65cb2d5d2405e82cb8ec9e

Replace:
src/app/globals.css

Fixes in this patch:
- Sales product picker is 4 cards per row on phone.
- Cards are square instead of huge rectangular cards.
- Cards are compact enough for product name/SKU/size/color/stock/price.
- Tablet/desktop uses 5 cards per row.
- The POS dialog itself becomes the vertical scroll container on mobile.
- The old fixed 38dvh product pane is released so the whole invoice can be reached by scrolling.
- Global body vertical scrolling is explicitly enabled.
- No sales API/business logic was changed.
