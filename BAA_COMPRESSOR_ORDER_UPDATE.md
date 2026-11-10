BAA compressor shipping order update (November 10, 2026)

Baseline: PAL_Newstart_State_Reports_Edit_Delete_PIN_2026-11-09(2).zip
Only public/app.js and baa-api.js application source changed. Newstart files, routes, and data unchanged.

- Compressor Shipping now begins with Build Order and automatically creates Box 1.
- After Finish Box, user can continue to the next box or complete the order.
- Saved orders can be reopened in the Compressor Shipping section.
- Download Entire Order Excel is available while an order is in progress and after completion. Each box is a worksheet; existing compressor worksheet layout, calculations and formatting are reused.
- Core Charge defaults to Yes for matched compressor parts, and No remains selectable.
- Existing standalone box export and non-compressor shipping flows remain unchanged.
- Completed orders are not reopened for editing; deleting individual order-linked boxes is blocked.

Validation: node --check passed for baa-api.js, public/app.js, server.js. No live deployment or authenticated integration testing performed. Confirm Supabase storage and workbook downloads after deployment.
