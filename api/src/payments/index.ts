/** Payment providers behind one interface (filled in by step G5). */
export interface Payments { enabled: { razorpay: boolean; stripe: boolean; mock: boolean } }
export const noPayments: Payments = { enabled: { razorpay: false, stripe: false, mock: false } };
