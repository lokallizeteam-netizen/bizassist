// path: src/modules/pos/pos.types.ts
export type CheckoutCartItemInput = {
	productId: string;
	productName?: string;
	quantity: string; // decimal string (UDQI)
	unitPrice: string; // decimal string
	selectedModifierOptionIds?: string[];
	totalModifiersDeltaMinor?: string;
	selectedAttributes?: {
		attributeId: string;
		optionId: string;
		attributeNameSnapshot?: string;
		optionNameSnapshot?: string;
	}[];
};

export type CheckoutPaymentInput = {
	method: "CASH" | "EWALLET" | "BANK_TRANSFER" | "OTHER";
	amount: string; // decimal string
};

export type CheckoutInput = {
	idempotencyKey: string;
	deviceId?: string;
	cart: CheckoutCartItemInput[];
	payments: CheckoutPaymentInput[];
};

export type CheckoutResult = {
	sale: {
		id: string;
		status: "COMPLETED";
		createdAt: string;
		subtotal: string;
		total: string;
		discountTotal: string;
		taxTotal: string;
		idempotencyKey: string;
		deviceId?: string | null;
		lineItems: {
			id: string;
			productId: string;
			productName: string;
			quantity: string; // decimal string
			unitPrice: string;
			lineTotal: string;
			selectedModifierOptionIds: string[];
			totalModifiersDeltaMinor: string;
			selectedAttributes: {
				attributeId: string;
				optionId: string;
				attributeNameSnapshot: string;
				optionNameSnapshot: string;
			}[];
		}[];
		payments: {
			id: string;
			method: "CASH" | "EWALLET" | "BANK_TRANSFER" | "OTHER";
			amount: string;
		}[];
	};
	receipt: {
		saleId: string;
		subtotal: string;
		taxTotal: string;
		discountTotal: string;
		total: string;
		paidTotal: string;
		changeDue: string;
		itemCount: number; // v1: sum of line item quantities (display only)
	};
};
