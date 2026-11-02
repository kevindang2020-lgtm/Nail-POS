// inventory.ts — wire contract (Constitution 13 §13, §15). Realm: tenant.

/** One product line of a service's recipe, as GET /tenant/inventory/recipes/:serviceId returns it (snake_case: the rows
 *  come straight from the query). A different concept from the AI inventory module's RecipeLine (expected consumption). */
export interface ServiceRecipeLine { id: string; product_id: string; product_name: string; color_number: string | null; quantity: number; cost_cents: number | null }
export interface ServiceRecipe { service: { id: string; name: string }; lines: ServiceRecipeLine[]; recipeCostCents: number }
