// BizAssist_mobile
// path: src/modules/units/units.navigation.ts

import {
	DRAFT_ID_KEY,
	RETURN_TO_KEY,
	UNIT_CONTEXT_PRODUCT_TYPE_KEY,
	UNIT_SELECTED_ABBR_KEY,
	UNIT_SELECTED_CATEGORY_KEY,
	UNIT_SELECTED_ID_KEY,
	UNIT_SELECTED_NAME_KEY,
	UNIT_SELECTED_PRECISION_KEY,
	UNIT_SELECTION_SOURCE_KEY,
	normalizeReturnTo,
} from "@/modules/units/unitPicker.contract";

export const CREATE_ITEM_ROUTE = "/(app)/(tabs)/inventory/products/create" as const;
export const ADD_ITEM_ROUTE = "/(app)/(tabs)/inventory/add-item" as const;
export const UNITS_INDEX_ROUTE = "/(app)/(tabs)/inventory/units" as const;
export const SETTINGS_UNITS_ROUTE = "/(app)/(tabs)/settings/units" as const;
export const SETTINGS_ITEMS_SERVICES_CREATE_ITEM_ROUTE = SETTINGS_UNITS_ROUTE;
export const SETTINGS_ITEMS_SERVICES_ADD_ITEM_ROUTE = SETTINGS_UNITS_ROUTE;

type RouterLike = {
	back: () => void;
	replace: (input: any) => void;
	canGoBack?: () => boolean;
	setParams?: (params: Record<string, unknown>) => void;
};

type FallbackRoute =
	| string
	| {
			pathname: string;
			params?: Record<string, unknown>;
	  };

const ALLOWED_RETURN_TO = new Set<string>([
	CREATE_ITEM_ROUTE,
	ADD_ITEM_ROUTE,
	SETTINGS_ITEMS_SERVICES_CREATE_ITEM_ROUTE,
	SETTINGS_ITEMS_SERVICES_ADD_ITEM_ROUTE,
	UNITS_INDEX_ROUTE,
	SETTINGS_UNITS_ROUTE,
]);
const ALLOWED_RETURN_TO_PATTERNS: RegExp[] = [
	/^\/\(app\)\/\(tabs\)\/inventory\/products\/[^/]+$/,
	/^\/\(app\)\/\(tabs\)\/inventory\/products\/[^/]+\/edit$/,
];

function isAllowedReturnTo(route: string): boolean {
	if (ALLOWED_RETURN_TO.has(route)) return true;
	return ALLOWED_RETURN_TO_PATTERNS.some((pattern) => pattern.test(route));
}

function resolveFallbackReturnTo(params: Record<string, unknown>, explicitFallback?: string): string {
	if (explicitFallback && isAllowedReturnTo(explicitFallback)) {
		return explicitFallback;
	}

	const draftId = String(params?.[DRAFT_ID_KEY] ?? "").trim();
	return draftId ? CREATE_ITEM_ROUTE : ADD_ITEM_ROUTE;
}

export function resolveReturnTo(params: Record<string, unknown>, explicitFallback?: string): string {
	const raw = normalizeReturnTo(params?.[RETURN_TO_KEY]);
	if (raw && isAllowedReturnTo(raw)) return raw;

	if (__DEV__ && raw) {
		console.warn(`[units.navigation] Invalid returnTo "${raw}", falling back to a safe default.`);
	}

	return resolveFallbackReturnTo(params, explicitFallback);
}

export function goBackSafe(router: RouterLike, fallbackRoute: FallbackRoute) {
	if (router.canGoBack?.()) {
		router.back();
		return;
	}

	if (typeof fallbackRoute === "string") {
		router.replace(fallbackRoute as any);
		return;
	}

	router.replace({
		pathname: fallbackRoute.pathname as any,
		params: fallbackRoute.params as any,
	} as any);
}

export function replaceToReturnTo(router: RouterLike, returnTo: string, params?: Record<string, unknown>) {
	if (!returnTo) return;
	router.replace({
		pathname: returnTo as any,
		params: params as any,
	} as any);
}

export function clearUnitSelectionParams(router: RouterLike) {
	router.setParams?.({
		[UNIT_SELECTED_ID_KEY]: undefined,
		[UNIT_SELECTED_NAME_KEY]: undefined,
		[UNIT_SELECTED_ABBR_KEY]: undefined,
		[UNIT_SELECTED_CATEGORY_KEY]: undefined,
		[UNIT_SELECTED_PRECISION_KEY]: undefined,
		[UNIT_SELECTION_SOURCE_KEY]: undefined,
		[UNIT_CONTEXT_PRODUCT_TYPE_KEY]: undefined,
	});
}
