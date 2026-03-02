// BizAssist_mobile
// path: src/modules/inventory/drafts/productCreateDraft.ts

export type ProductCreateDraft = {
	draftId: string;

	// core
	name: string;
	description: string;

	// category
	categoryId: string;
	categoryName: string;
	modifierGroupIds: string[];
	attributeSelections: { attributeId: string; isRequired?: boolean }[];

	// ✅ unit (UoM)
	unitId: string;
	unitName: string;
	unitAbbreviation: string;
	unitCategory: string; // keep string to avoid cross-module enum coupling
	unitPrecisionScale: number; // 0–5

	// pricing (string inputs)
	priceText: string;
	costText: string;

	// inventory
	trackInventory: boolean;
	sku: string;
	barcode: string;
	initialOnHandText: string; // decimal string
	reorderPointText: string; // decimal string

	// media
	imageLocalUri: string;

	// POS tile
	posTileMode: "COLOR" | "IMAGE";
	posTileColor: string | null;
	posTileLabel: string;
	posTileLabelTouched: boolean;
};

const drafts = new Map<string, ProductCreateDraft>();

function makeId() {
	return `draft_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createProductDraft(forcedDraftId?: string): ProductCreateDraft {
	const draftId = (forcedDraftId ?? "").trim() || makeId();

	const draft: ProductCreateDraft = {
		draftId,

		name: "",
		description: "",

		categoryId: "",
		categoryName: "",
		modifierGroupIds: [],
		attributeSelections: [],

		// ✅ unit defaults (Each is resolved at screen level via unitsApi list)
		unitId: "",
		unitName: "",
		unitAbbreviation: "",
		unitCategory: "COUNT",
		unitPrecisionScale: 0,

		priceText: "",
		costText: "",

		trackInventory: true,
		sku: "",
		barcode: "",
		initialOnHandText: "",
		reorderPointText: "",

		imageLocalUri: "",

		posTileMode: "COLOR",
		posTileColor: null,
		posTileLabel: "",
		posTileLabelTouched: false,
	};

	drafts.set(draftId, draft);
	return draft;
}

export function getProductDraft(draftId: string): ProductCreateDraft | null {
	const id = (draftId ?? "").trim();
	if (!id) return null;
	return drafts.get(id) ?? null;
}

export function upsertProductDraft(draftId: string, next: Partial<ProductCreateDraft>): ProductCreateDraft {
	const id = (draftId ?? "").trim();
	const base = getProductDraft(id) ?? createProductDraft(id);

	const merged: ProductCreateDraft = {
		...base,
		...next,
		draftId: base.draftId, // enforce stable key
	};

	drafts.set(merged.draftId, merged);
	return merged;
}

export function clearProductDraft(draftId: string) {
	const id = (draftId ?? "").trim();
	if (!id) return;
	drafts.delete(id);
}
