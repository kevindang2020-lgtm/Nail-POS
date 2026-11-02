# Tenant POS Topbar Map

Canonical shell: `apps/pos-web/src/shell/POSLayout.tsx` (single shell — no duplicates).
Topbar order (left→right): LocationSelector · TopSearch · **TopClock** · **NotificationBell** · **MessageControl** · ProfileMenu.

| Control | Component | Data source | Notes |
|---|---|---|---|
| Location/branch | `LocationSelector` | `authApi.branches()` / `selectBranch()` | Permission-aware; switch reloads tenant/branch context |
| Global search | `TopSearch` | `/tenant/search` (tenant-scoped) | Never leaves the authenticated tenant |
| Date / time | `TopClock` | client clock | `MMM dd, yyyy` + local time, refreshes every 30s |
| Notification bell | `NotificationBell` | `GET /tenant/navigation/badges → notifications` | Count = low-stock + pending tech reports (tenant+branch). Panel lists real actionable lines → module routes. Empty state when 0. |
| Messages | `MessageControl` | `GET /tenant/navigation/badges → messages` | Genuine 0 until a staff Communications inbox source exists (never fabricated). Panel → `/messages`. |
| Profile | `ProfileMenu` | session principal | Avatar/name/role + menu |

Icons use the approved `Icon` component (`bell`, `mail` added to `tenant-nav.tsx`), not raw emoji.
