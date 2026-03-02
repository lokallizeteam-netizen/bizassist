// BizAssist_mobile
// path: src/modules/categories/categoryPicker.contract.ts

export const CATEGORY_PICKER_ROUTE = "/(app)/(tabs)/inventory/categories/picker" as const;
export const CATEGORY_CREATE_ROUTE = "/(app)/(tabs)/inventory/categories/create" as const;

// Canonical selection return keys (MUST match screens reading them)
export const CATEGORY_SELECTED_ID_KEY = "selectedCategoryId" as const;
export const CATEGORY_SELECTED_NAME_KEY = "selectedCategoryName" as const;
export const CATEGORY_SELECTION_SOURCE_KEY = "selectionSource" as const;

// Draft passthrough key
export const DRAFT_ID_KEY = "draftId" as const;

// Canonical navigation keys
export const RETURN_TO_KEY = "returnTo" as const;
export const INITIAL_NAME_KEY = "initialName" as const;

export type CategorySelectionSource = "existing" | "created" | "cleared";

export type CategorySelectionReturnParams = {
	[CATEGORY_SELECTED_ID_KEY]?: string; // empty string means "None"
	[CATEGORY_SELECTED_NAME_KEY]?: string;
	[CATEGORY_SELECTION_SOURCE_KEY]?: CategorySelectionSource;

	// passthrough
	[DRAFT_ID_KEY]?: string;
};

export type CategoryPickerInboundParams = {
	[CATEGORY_SELECTED_ID_KEY]?: string;
	[CATEGORY_SELECTED_NAME_KEY]?: string;
	[CATEGORY_SELECTION_SOURCE_KEY]?: CategorySelectionSource;

	[RETURN_TO_KEY]?: string;

	// passthrough
	[DRAFT_ID_KEY]?: string;
};

export type CategoryCreateInboundParams = {
	[RETURN_TO_KEY]?: string;
	[INITIAL_NAME_KEY]?: string;

	// passthrough
	[DRAFT_ID_KEY]?: string;
};

export function buildCategorySelectionParams(input: {
	selectedCategoryId: string;
	selectedCategoryName: string;
	selectionSource?: CategorySelectionSource;
	draftId?: string;
}) {
	return {
		[CATEGORY_SELECTED_ID_KEY]: input.selectedCategoryId,
		[CATEGORY_SELECTED_NAME_KEY]: input.selectedCategoryName,
		[CATEGORY_SELECTION_SOURCE_KEY]: input.selectionSource,
		[DRAFT_ID_KEY]: input.draftId,
	} satisfies CategorySelectionReturnParams;
}

export function buildOpenCategoryCreateParams(input: { returnTo?: string; initialName?: string; draftId?: string }) {
	return {
		[RETURN_TO_KEY]: input.returnTo,
		[INITIAL_NAME_KEY]: input.initialName,
		[DRAFT_ID_KEY]: input.draftId,
	} satisfies CategoryCreateInboundParams;
}

export function normalizeReturnTo(raw: unknown): string | null {
	const v = String(raw ?? "").trim();
	if (!v) return null;
	if (!v.startsWith("/")) return null;
	if (v === "undefined" || v === "null") return null;
	return v;
}

function normalizeParamString(v: unknown): string {
	return String(v ?? "").trim();
}

export function parseCategorySelectionParams(raw: {
	[CATEGORY_SELECTED_ID_KEY]?: unknown;
	[CATEGORY_SELECTED_NAME_KEY]?: unknown;
	[CATEGORY_SELECTION_SOURCE_KEY]?: unknown;
	[DRAFT_ID_KEY]?: unknown;
}): {
	selectedCategoryId: string;
	selectedCategoryName: string;
	selectionSource?: CategorySelectionSource;
	hasSelectionKey: boolean;

	draftId: string;
	hasDraftIdKey: boolean;
} {
	const id = normalizeParamString(raw?.[CATEGORY_SELECTED_ID_KEY]);
	const name = normalizeParamString(raw?.[CATEGORY_SELECTED_NAME_KEY]);

	const srcRaw = normalizeParamString(raw?.[CATEGORY_SELECTION_SOURCE_KEY]);
	const selectionSource: CategorySelectionSource | undefined =
		srcRaw === "existing" || srcRaw === "created" || srcRaw === "cleared"
			? (srcRaw as CategorySelectionSource)
			: undefined;

	const hasSelectionKey = raw?.[CATEGORY_SELECTED_ID_KEY] !== undefined;

	const draftId = normalizeParamString(raw?.[DRAFT_ID_KEY]);
	const hasDraftIdKey = raw?.[DRAFT_ID_KEY] !== undefined;

	return {
		selectedCategoryId: id,
		selectedCategoryName: name,
		selectionSource,
		hasSelectionKey,
		draftId,
		hasDraftIdKey,
	};
}
