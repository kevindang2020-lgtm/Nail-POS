// types.ts — the display's wire types are @aipowersalon/api-contracts/customer's (Constitution 13 §15); only view helpers live here.
export const usd = (cents: number): string =>
  '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
