// BizAssist_mobile
// path: src/modules/inventory/screens/InventoryProductCreateScreen.tsx
//
// UDQI FINAL (Jan 2026):
// - Hard cap: 18 characters for Initial on hand + Reorder point.
// - Blur now normalizes to full unit precision (e.g., scale 5: "50.00" → "50.00000").
// - Submit-time normalization: right-pad zeros to Unit.precisionScale and submit fixed-scale decimal strings.
// - Reject trailing dot at submit.
// - Clamp fractional digits while typing (<= precisionScale).
// - No “cents shifting”: typing "12" stays "12" even if scale=2/5.
// - No UI/layout changes.
//
// ✅ MIN SAFE FIX (this patch):
// - Enforce UDQI integer-digit cap (12 digits) on Initial on hand + Reorder point, same as adjust.tsx,
//   to prevent DB numeric overflow (Prisma P2020) while preserving natural typing.
//
// ✅ FIX (Jan 2026):
// - Resolve TS error: Cancel button referenced undefined onBackToAddItems.
//   Governance: This is a process screen, so Cancel should share Exit semantics (cancel intent).
//   Solution: wire Cancel to onExitToAddItems.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image, Keyboard, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useTheme } from "react-native-paper";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FontAwesome6 } from "@expo/vector-icons";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";

import { BAIScreen } from "@/components/ui/BAIScreen";
import { BAISurface } from "@/components/ui/BAISurface";
import { BAIText } from "@/components/ui/BAIText";
import { BAIButton } from "@/components/ui/BAIButton";
import { BAIIconButton } from "@/components/ui/BAIIconButton";
import { BAICTAPillButton } from "@/components/ui/BAICTAButton";
import {
	BAINumericBottomSheetKeyboard,
	type BAINumericBottomSheetKey,
} from "@/components/ui/BAINumericBottomSheetKeyboard";
import { BAITextInput } from "@/components/ui/BAITextInput";
import { BAITextarea } from "@/components/ui/BAITextarea";
import { BAIPressableRow } from "@/components/ui/BAIPressableRow";
import { ConfirmActionModal } from "@/components/settings/ConfirmActionModal";

import { useAppBusy } from "@/hooks/useAppBusy";
import { useAppToast } from "@/providers/AppToastProvider";
import { useProcessExitGuard } from "@/modules/navigation/useProcessExitGuard";

import { useActiveBusinessMeta } from "@/modules/business/useActiveBusinessMeta";
import { FIELD_LIMITS } from "@/shared/fieldLimits";
import {
	sanitizeLabelInput,
	sanitizeMoneyInput,
	sanitizeProductNameDraftInput,
	sanitizeProductNameInput,
	sanitizeDescriptionDraftInput,
	sanitizeDescriptionInput,
	sanitizeSkuInput,
} from "@/shared/validation/sanitize";
import { MONEY_INPUT_PRECISION } from "@/shared/money/money.constants";
import { digitsToMinorUnits, formatMoneyFromMinor, parseMinorUnits, sanitizeDigits } from "@/shared/money/money.minor";
import { GTIN_MAX_LENGTH, sanitizeGtinInput, validateGtinValue } from "@/shared/validation/gtin";
import { inventoryApi } from "@/modules/inventory/inventory.api";
import { useInventoryHeader } from "@/modules/inventory/useInventoryHeader";
import {
	inventoryScopeRoot,
	mapInventoryRouteToScope,
	type InventoryRouteScope,
} from "@/modules/inventory/navigation.scope";
import { runGovernedExitReplace } from "@/modules/inventory/navigation.governance";
import { invalidateInventoryAfterMutation } from "@/modules/inventory/inventory.invalidate";
import { PosTileTextOverlay } from "@/modules/inventory/components/PosTileTextOverlay";
import type { CreateProductInput } from "@/modules/inventory/inventory.types";
import { uploadProductImage } from "@/modules/media/media.upload";
import { toMediaDomainError } from "@/modules/media/media.errors";
import { ModifierGroupSelector, modifierGroupSelectorKey } from "@/modules/modifiers/components/ModifierGroupSelector";
import { modifiersApi } from "@/modules/modifiers/modifiers.api";
import {
	buildModifierSelectionParams,
	MODIFIER_SELECTED_IDS_KEY,
	MODIFIER_SELECTION_SOURCE_KEY,
	parseModifierSelectionParams,
	RETURN_TO_KEY as MODIFIER_RETURN_TO_KEY,
} from "@/modules/modifiers/modifierPicker.contract";
import { categoriesApi } from "@/modules/categories/categories.api";
import { categoryKeys } from "@/modules/categories/categories.queryKeys";

import {
	CATEGORY_PICKER_ROUTE,
	DRAFT_ID_KEY as CATEGORY_DRAFT_ID_KEY,
	RETURN_TO_KEY as CATEGORY_RETURN_TO_KEY,
	parseCategorySelectionParams,
	CATEGORY_SELECTED_ID_KEY,
	CATEGORY_SELECTED_NAME_KEY,
	CATEGORY_SELECTION_SOURCE_KEY,
} from "@/modules/categories/categoryPicker.contract";

import { useProductCreateDraft } from "@/modules/inventory/drafts/useProductCreateDraft";
import {
	POS_TILE_ROUTE,
	DRAFT_ID_KEY as POS_TILE_DRAFT_ID_KEY,
	ROOT_RETURN_TO_KEY as POS_TILE_ROOT_RETURN_TO_KEY,
} from "@/modules/inventory/posTile.contract";

// Units
import { unitsApi } from "@/modules/units/units.api";
import { syncUnitListCaches } from "@/modules/units/units.cache";
import { unitKeys } from "@/modules/units/units.queries";
import type { Unit, PrecisionScale } from "@/modules/units/units.types";
import { getEachUnit } from "@/modules/units/units.visibility";
import {
	UNIT_PICKER_ROUTE,
	parseUnitSelectionParams,
	UNIT_SELECTED_ID_KEY,
	UNIT_SELECTED_NAME_KEY,
	UNIT_SELECTED_ABBR_KEY,
	UNIT_SELECTED_CATEGORY_KEY,
	UNIT_SELECTED_PRECISION_KEY,
	UNIT_SELECTION_SOURCE_KEY,
	UNIT_CONTEXT_PRODUCT_TYPE_KEY,
	RETURN_TO_KEY,
	DRAFT_ID_KEY,
} from "@/modules/units/unitPicker.contract";
import {
	DRAFT_ID_KEY as OPTION_DRAFT_ID_KEY,
	PRODUCT_CREATE_VARIATIONS_ROUTE,
	PRODUCT_SELECT_OPTIONS_ROUTE,
	RETURN_TO_KEY as OPTION_RETURN_TO_KEY,
} from "@/modules/options/productOptionPicker.contract";
import { optionsApi } from "@/modules/options/options.api";
import { salesTaxesApi } from "@/modules/taxes/taxes.api";
import { salesTaxKeys } from "@/modules/taxes/taxes.queries";
import {
	TAX_PICKER_ROUTE,
	TAX_SELECTED_IDS_KEY,
	TAX_SELECTED_NAMES_KEY,
	TAX_SELECTION_SOURCE_KEY,
	TAX_EXEMPT_KEY,
	DRAFT_ID_KEY as TAX_DRAFT_ID_KEY,
	RETURN_TO_KEY as TAX_RETURN_TO_KEY,
	buildTaxSelectionParams,
	parseTaxSelectionParams,
} from "@/modules/taxes/taxPicker.contract";

const INVENTORY_THIS_ROUTE = "/(app)/(tabs)/inventory/products/create" as const;
const INVENTORY_ADD_ITEMS_ROUTE = "/(app)/(tabs)/inventory/add-item" as const;
const INVENTORY_MODIFIER_CREATE_ROUTE = "/(app)/(tabs)/inventory/modifiers/create" as const;
const INVENTORY_MANAGE_STOCK_ROUTE = "/(app)/(tabs)/inventory/products/manage-stock" as const;
const SCANNED_BARCODE_KEY = "scannedBarcode" as const;
const INVENTORY_SCAN_ROUTE = "/(app)/(tabs)/inventory/scan" as const;

const DEFAULT_PRECISION: PrecisionScale = 2;
const COUNT_PRECISION: PrecisionScale = 0;
const COUNT_CATALOG_ID = "ea";
const COUNT_DISPLAY_NAME = "Per Piece";
const COUNT_DISPLAY_ABBR = "pc";
const DECIMAL_PATTERN = /^\d+(\.\d+)?$/;
const MONEY_SCALE = MONEY_INPUT_PRECISION;
const MONEY_MAX_MINOR_DIGITS = 11;
const FORM_VERTICAL_GAP = 12;

// UDQI caps
const HARD_QTY_CAP = 18;
const UDQI_INT_MAX_DIGITS = 12;

function safeString(v: unknown): string {
	return typeof v === "string" ? v : String(v ?? "");
}

function buildFallbackPosLabel(name: string): string {
	const compact = sanitizeLabelInput(name).replace(/\s+/g, "");
	return compact.slice(0, 2).toUpperCase();
}

function toMoneyOrNull(raw: string): number | null {
	const sanitized = sanitizeMoneyInput(String(raw ?? ""));
	const v = sanitized.trim();
	if (!v) return null;

	const n = Number(v);
	if (!Number.isFinite(n)) return null;
	if (n < 0) return null;
	return n;
}

function moneyTextToMinorUnits(raw: string, scale: number, maxMinorDigits: number): number {
	const cleaned = String(raw ?? "")
		.replace(/,/g, "")
		.replace(/[^\d.]/g, "");
	if (!cleaned) return 0;

	const [intRaw = "", ...fractionParts] = cleaned.split(".");
	const intDigits = sanitizeDigits(intRaw);
	const fractionDigits = sanitizeDigits(fractionParts.join(""));
	const decimalDigits = scale > 0 ? fractionDigits.slice(0, scale).padEnd(scale, "0") : "";
	const combinedDigits = `${intDigits}${decimalDigits}`;

	if (!combinedDigits) return 0;
	return digitsToMinorUnits(combinedDigits, maxMinorDigits);
}

function minorUnitsToMoneyText(minorUnits: number, scale: number): string {
	const safeMinor = parseMinorUnits(minorUnits);
	if (safeMinor <= 0) return "";
	if (scale <= 0) return String(safeMinor);

	const divisor = 10 ** scale;
	const major = Math.floor(safeMinor / divisor);
	const minor = safeMinor % divisor;
	return `${major}.${String(minor).padStart(scale, "0")}`;
}

function applyMoneyKeypadKey(currentMinor: number, key: BAINumericBottomSheetKey, maxMinorDigits: number): number {
	const currentDigits = sanitizeDigits(String(parseMinorUnits(currentMinor)));

	if (key === "backspace") {
		const nextDigits = currentDigits.slice(0, -1);
		return nextDigits ? digitsToMinorUnits(nextDigits, maxMinorDigits) : 0;
	}

	if (currentDigits.length >= maxMinorDigits) return parseMinorUnits(currentMinor);
	return digitsToMinorUnits(`${currentDigits}${key}`, maxMinorDigits);
}

function capText(raw: string, maxLen: number) {
	if (maxLen <= 0) return "";
	return raw.length > maxLen ? raw.slice(0, maxLen) : raw;
}

function clampPrecisionScale(raw: unknown): PrecisionScale {
	const n = typeof raw === "number" ? raw : Number(raw);
	const clamped = Number.isFinite(n) ? Math.max(0, Math.min(5, Math.trunc(n))) : DEFAULT_PRECISION;
	return clamped as PrecisionScale;
}

function normalizeUnitKey(value: string | null | undefined): string {
	return (value ?? "").trim().toLowerCase();
}

function normalizeQuantityForSubmit(
	raw: string,
	scale: number,
): { ok: true; value: string | null } | { ok: false; message: string } {
	const s0 = String(raw ?? "").trim();
	if (!s0) return { ok: true, value: null };

	if (/[eE,]/.test(s0)) return { ok: false, message: "Invalid number format." };
	if (!DECIMAL_PATTERN.test(s0)) return { ok: false, message: "Enter a valid quantity." };
	if (s0.endsWith(".")) return { ok: false, message: "Quantity cannot end with a decimal point." };

	const sc = Math.max(0, Math.trunc(Number(scale) || 0));
	if (sc <= 0) return { ok: true, value: s0.replace(/\./g, "") };

	const [intRaw, fracRaw = ""] = s0.split(".");
	if (fracRaw.length > sc) return { ok: false, message: `Max ${sc} decimals for this unit.` };

	const intPart = intRaw.length ? intRaw : "0";
	const frac = (fracRaw + "0".repeat(sc)).slice(0, sc);
	return { ok: true, value: `${intPart}.${frac}` };
}

type MoneyFieldKey = "price" | "cost";

function formatStockOnHandDisplay(raw: string): string {
	const trimmed = String(raw ?? "").trim();
	if (!trimmed) return "";
	if (!DECIMAL_PATTERN.test(trimmed)) return trimmed;
	if (!trimmed.includes(".")) return trimmed;
	return trimmed.replace(/\.?0+$/, "");
}

function isEachUnit(name: string | undefined, abbr: string | undefined, category?: string): boolean {
	if (category !== "COUNT") return false;
	const normalizedName = normalizeUnitKey(name);
	const normalizedAbbr = normalizeUnitKey(abbr ?? "");
	return normalizedName === "each" || normalizedName === "per piece" || normalizedAbbr === COUNT_CATALOG_ID;
}

function displayUnitName(name: string | undefined, abbr: string | undefined, category?: string): string {
	if (isEachUnit(name, abbr, category)) return COUNT_DISPLAY_NAME;
	return (name ?? "").trim();
}

function displayUnitValueInline(name: string, abbr: string, category?: string): string {
	const n = (name ?? "").trim();
	const a = (abbr ?? "").trim();

	if (isEachUnit(n, a, category)) return `${COUNT_DISPLAY_NAME} (${COUNT_DISPLAY_ABBR})`;
	if (!n) return COUNT_DISPLAY_NAME;
	if (!a) return n;
	return `${n} (${a})`;
}

/**
 * Re-normalize stored quantity text when Unit/UDQI precision changes.
 * Preserves numeric magnitude (no decimal/cents shifting) and outputs fixed-scale text.
 */
function normalizeQuantityForUnitChange(raw: string, nextScale: number, hardCap: number) {
	let s = String(raw ?? "")
		.replace(/,/g, "")
		.trim();
	if (!s) return "";

	// Keep only numeric decimal content.
	s = s.replace(/[^\d.]/g, "");
	if (!s) return "";

	const firstDot = s.indexOf(".");
	const intRaw = firstDot >= 0 ? s.slice(0, firstDot) : s;
	const fracRaw = firstDot >= 0 ? s.slice(firstDot + 1).replace(/\./g, "") : "";

	const intPart = (intRaw.replace(/^0+(?=\d)/, "") || "0").slice(0, UDQI_INT_MAX_DIGITS);
	const sc = Math.max(0, Math.trunc(Number(nextScale) || 0));

	if (sc <= 0) {
		return capText(intPart, hardCap);
	}

	const frac = fracRaw.slice(0, sc);
	const paddedFrac = (frac + "0".repeat(sc)).slice(0, sc);
	return capText(`${intPart}.${paddedFrac}`, hardCap);
}

export default function InventoryProductCreateScreen({
	routeScope = "inventory",
}: {
	routeScope?: InventoryRouteScope;
}) {
	const router = useRouter();
	const theme = useTheme();
	const queryClient = useQueryClient();
	const { withBusy, busy } = useAppBusy();
	const { showSuccess } = useAppToast();
	const { currencyCode } = useActiveBusinessMeta();
	const toScopedRoute = useCallback((route: string) => mapInventoryRouteToScope(route, routeScope), [routeScope]);
	const thisRoute = useMemo(() => toScopedRoute(INVENTORY_THIS_ROUTE), [toScopedRoute]);
	const addItemsRoute = useMemo(() => {
		if (routeScope === "settings-items-services") {
			return `${inventoryScopeRoot(routeScope)}?type=ITEMS`;
		}
		return toScopedRoute(INVENTORY_ADD_ITEMS_ROUTE);
	}, [routeScope, toScopedRoute]);
	const scanRoute = useMemo(() => toScopedRoute(INVENTORY_SCAN_ROUTE), [toScopedRoute]);
	const isBusy = !!busy?.isBusy;

	// --- nav lock (mandatory)
	const navLockRef = useRef(false);
	const priceInputRef = useRef<any>(null);
	const costInputRef = useRef<any>(null);
	const [isNavLocked, setIsNavLocked] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [imageError, setImageError] = useState<string | null>(null);
	const [confirmExitOpen, setConfirmExitOpen] = useState(false);
	const [activeMoneyField, setActiveMoneyField] = useState<MoneyFieldKey | null>(null);

	const lockNav = useCallback((ms = 650) => {
		if (navLockRef.current) return false;
		navLockRef.current = true;
		setIsNavLocked(true);
		setTimeout(() => {
			navLockRef.current = false;
			setIsNavLocked(false);
		}, ms);
		return true;
	}, []);

	const params = useLocalSearchParams();

	// Draft id: prefer Unit contract key (same literal "draftId"), fallback to Category contract key (also "draftId")
	const paramDraftId = useMemo(() => {
		const a = safeString((params as any)?.[DRAFT_ID_KEY]).trim();
		if (a) return a;
		return safeString((params as any)?.[CATEGORY_DRAFT_ID_KEY]).trim();
	}, [params]);

	const { draftId, draft, patch, reset } = useProductCreateDraft(paramDraftId);
	const createdProductIdRef = useRef<string | null>(null);

	useEffect(() => {
		const currentDraftId = safeString((params as any)?.[DRAFT_ID_KEY]).trim();
		if (currentDraftId) return;
		(router as any).setParams?.({
			[DRAFT_ID_KEY]: draftId,
		});
	}, [draftId, params, router]);

	// This screen is Create Item → PHYSICAL
	const unitProductType = "PHYSICAL" as const;

	const isUiDisabled = isBusy || isNavLocked;

	const hasLocalImage = Boolean(draft.imageLocalUri && draft.imageLocalUri.trim().length > 0);
	const localImageUri = hasLocalImage ? draft.imageLocalUri.trim() : "";
	const tileMode = draft.posTileMode === "IMAGE" ? "IMAGE" : "COLOR";
	const tileColor = typeof draft.posTileColor === "string" ? draft.posTileColor : null;
	const tileLabel = useMemo(() => sanitizeLabelInput(draft.posTileLabel ?? "").trim(), [draft.posTileLabel]);
	const itemName = useMemo(() => (draft.name ?? "").trim(), [draft.name]);
	const displayTileLabel = useMemo(() => tileLabel || buildFallbackPosLabel(itemName), [itemName, tileLabel]);
	const hasLabel = displayTileLabel.length > 0;
	const hasItemName = itemName.length > 0;
	const hasColor = !!tileColor;
	const hasVisualTile = hasLocalImage || hasColor;
	const shouldShowEmpty = !hasVisualTile;
	const shouldShowTileTextOverlay = hasLabel || hasItemName;
	const tileLabelColor = "#FFFFFF";

	const onEditPosTile = useCallback(() => {
		if (isUiDisabled) return;
		if (!lockNav()) return;

		setImageError(null);

		router.push({
			pathname: toScopedRoute(POS_TILE_ROUTE) as any,
			params: {
				[POS_TILE_DRAFT_ID_KEY]: draftId,
				[POS_TILE_ROOT_RETURN_TO_KEY]: thisRoute,
			},
		});
	}, [draftId, isUiDisabled, lockNav, router, thisRoute, toScopedRoute]);

	const onOpenBarcodeScanner = useCallback(() => {
		if (isUiDisabled) return;
		if (!lockNav()) return;
		setError(null);
		router.push({
			pathname: scanRoute as any,
			params: {
				returnTo: thisRoute,
				draftId,
			},
		});
	}, [draftId, isUiDisabled, lockNav, router, scanRoute, thisRoute]);

	// --- apply scanned barcode return param ---
	useEffect(() => {
		const raw =
			typeof (params as any)?.[SCANNED_BARCODE_KEY] === "string" ? String((params as any)[SCANNED_BARCODE_KEY]) : "";
		const value = sanitizeGtinInput(raw).trim();
		if (!value) return;

		patch({ barcode: value });

		(router as any).setParams?.({
			[SCANNED_BARCODE_KEY]: undefined,
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [(params as any)?.[SCANNED_BARCODE_KEY]]);

	/* ---------------- units list (default selection) ---------------- */

	const unitsQuery = useQuery<Unit[]>({
		queryKey: unitKeys.list({ includeArchived: false }),
		queryFn: () => unitsApi.listUnits({ includeArchived: false }),
		staleTime: 30_000,
	});

	const categoriesQuery = useQuery<{ items: { id: string; color?: string | null }[] }>({
		queryKey: categoryKeys.list({ limit: 250 }),
		queryFn: () => categoriesApi.list({ limit: 250 }),
		staleTime: 30_000,
	});
	const modifierGroupsQuery = useQuery({
		queryKey: modifierGroupSelectorKey,
		queryFn: () => modifiersApi.listGroups(false),
		staleTime: 30_000,
	});

	const countUnit = useMemo(() => {
		const activeUnits = (unitsQuery.data ?? []).filter((u) => u.isActive);
		return getEachUnit(activeUnits);
	}, [unitsQuery.data]);

	/* ---------------- return params: category ---------------- */

	const categorySelection = useMemo(() => parseCategorySelectionParams(params as any), [params]);
	const modifierSelection = useMemo(() => parseModifierSelectionParams(params as any), [params]);
	const taxSelection = useMemo(() => parseTaxSelectionParams(params as any), [params]);

	useEffect(() => {
		if (!categorySelection.hasSelectionKey) return;

		patch({
			categoryId: categorySelection.selectedCategoryId,
			categoryName: categorySelection.selectedCategoryName,
		});

		(router as any).setParams?.({
			[CATEGORY_SELECTED_ID_KEY]: undefined,
			[CATEGORY_SELECTED_NAME_KEY]: undefined,
			[CATEGORY_SELECTION_SOURCE_KEY]: undefined,
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [categorySelection.hasSelectionKey, categorySelection.selectedCategoryId, categorySelection.selectedCategoryName]);

	useEffect(() => {
		if (!modifierSelection.hasSelectionKey) return;

		patch({ modifierGroupIds: modifierSelection.selectedModifierGroupIds });

		(router as any).setParams?.({
			[MODIFIER_SELECTED_IDS_KEY]: undefined,
			[MODIFIER_SELECTION_SOURCE_KEY]: undefined,
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [modifierSelection.hasSelectionKey, modifierSelection.selectedModifierGroupIds.join("|")]);

	useEffect(() => {
		if (!taxSelection.hasSelectionKey) return;

		patch({
			selectedTaxIds: taxSelection.selectedTaxIds,
			selectedTaxNames: taxSelection.selectedTaxNames,
			taxExempt: taxSelection.taxExempt || taxSelection.selectedTaxIds.length === 0,
		});

		(router as any).setParams?.({
			[TAX_SELECTED_IDS_KEY]: undefined,
			[TAX_SELECTED_NAMES_KEY]: undefined,
			[TAX_SELECTION_SOURCE_KEY]: undefined,
			[TAX_EXEMPT_KEY]: undefined,
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [taxSelection.hasSelectionKey, taxSelection.selectedTaxIds.join("|"), taxSelection.selectedTaxNames.join("|")]);

	/* ---------------- return params: unit (hardened) ---------------- */

	const unitSelection = useMemo(() => parseUnitSelectionParams(params as any), [params]);

	useEffect(() => {
		const rawSelectedId =
			typeof (params as any)?.[UNIT_SELECTED_ID_KEY] === "string"
				? String((params as any)[UNIT_SELECTED_ID_KEY]).trim()
				: "";

		const selectedUnitId = (unitSelection.selectedUnitId || rawSelectedId).trim();

		// Nothing to apply.
		if (!selectedUnitId) {
			if (unitSelection.hasSelectionKey || (params as any)?.[UNIT_SELECTED_ID_KEY] !== undefined) {
				(router as any).setParams?.({
					[UNIT_SELECTED_ID_KEY]: undefined,
					[UNIT_SELECTED_NAME_KEY]: undefined,
					[UNIT_SELECTED_ABBR_KEY]: undefined,
					[UNIT_SELECTED_CATEGORY_KEY]: undefined,
					[UNIT_SELECTED_PRECISION_KEY]: undefined,
					[UNIT_SELECTION_SOURCE_KEY]: undefined,
					[UNIT_CONTEXT_PRODUCT_TYPE_KEY]: undefined,
				});
			}
			return;
		}

		const selectedUnitName =
			(unitSelection.selectedUnitName || String((params as any)?.[UNIT_SELECTED_NAME_KEY] ?? "")).trim() ||
			COUNT_DISPLAY_NAME;

		const selectedUnitAbbreviation = (
			unitSelection.selectedUnitAbbreviation || String((params as any)?.[UNIT_SELECTED_ABBR_KEY] ?? "")
		).trim();

		const selectedUnitCategory = String(
			unitSelection.selectedUnitCategory ?? (params as any)?.[UNIT_SELECTED_CATEGORY_KEY] ?? "COUNT",
		);

		const resolvedUnitName =
			displayUnitName(selectedUnitName, selectedUnitAbbreviation, selectedUnitCategory) || COUNT_DISPLAY_NAME;

		const incomingPrecisionRaw =
			unitSelection.selectedUnitPrecisionScale ?? (params as any)?.[UNIT_SELECTED_PRECISION_KEY] ?? DEFAULT_PRECISION;

		const incomingPrecision = clampPrecisionScale(incomingPrecisionRaw ?? DEFAULT_PRECISION);
		const normalizedPrecision =
			selectedUnitCategory === "COUNT"
				? clampPrecisionScale(incomingPrecisionRaw ?? COUNT_PRECISION)
				: incomingPrecision;

		patch({
			unitId: selectedUnitId,
			unitName: resolvedUnitName,
			unitAbbreviation: selectedUnitAbbreviation,
			unitCategory: selectedUnitCategory,
			unitPrecisionScale: normalizedPrecision,
		});

		(router as any).setParams?.({
			[UNIT_SELECTED_ID_KEY]: undefined,
			[UNIT_SELECTED_NAME_KEY]: undefined,
			[UNIT_SELECTED_ABBR_KEY]: undefined,
			[UNIT_SELECTED_CATEGORY_KEY]: undefined,
			[UNIT_SELECTED_PRECISION_KEY]: undefined,
			[UNIT_SELECTION_SOURCE_KEY]: undefined,
			[UNIT_CONTEXT_PRODUCT_TYPE_KEY]: undefined,
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [
		unitSelection.selectedUnitId,
		unitSelection.selectedUnitName,
		unitSelection.selectedUnitAbbreviation,
		unitSelection.selectedUnitCategory,
		unitSelection.selectedUnitPrecisionScale,
		unitSelection.hasSelectionKey,
		params,
	]);

	const countAutoRef = useRef(false);

	const upsertUnitCache = useCallback(
		(unit: Unit) => {
			syncUnitListCaches(queryClient, unit);
		},
		[queryClient],
	);

	const applyUnitSelection = useCallback(
		(unit: Unit) => {
			const normalizedPrecision =
				unit.category === "COUNT"
					? clampPrecisionScale(unit.precisionScale ?? COUNT_PRECISION)
					: clampPrecisionScale(unit.precisionScale ?? DEFAULT_PRECISION);

			const resolvedName = displayUnitName(unit.name, unit.abbreviation, unit.category) || COUNT_DISPLAY_NAME;

			patch({
				unitId: unit.id,
				unitName: resolvedName,
				unitAbbreviation: unit.abbreviation ?? "",
				unitCategory: unit.category,
				unitPrecisionScale: normalizedPrecision,
			});
		},
		[patch],
	);

	useEffect(() => {
		if (draft.unitId?.trim()) return;
		if (unitSelection.hasSelectionKey) return;

		if (countUnit) {
			applyUnitSelection(countUnit);
			return;
		}

		if (countAutoRef.current || !unitsQuery.isFetched) return;
		countAutoRef.current = true;

		unitsApi
			.enableCatalogUnit({
				intent: "ENABLE_CATALOG",
				catalogId: COUNT_CATALOG_ID,
				precisionScale: COUNT_PRECISION,
			})
			.then((unit) => {
				upsertUnitCache(unit);
				applyUnitSelection(unit);
			})
			.catch(() => {
				// noop: user can still choose from Unit Type if enable fails
			});
	}, [
		applyUnitSelection,
		draft.unitId,
		countUnit,
		unitSelection.hasSelectionKey,
		unitsQuery.isFetched,
		upsertUnitCache,
	]);

	/* ---------------- Units: resolve selection (default count unit) ---------------- */

	const effectiveUnit = useMemo(() => {
		if (!draft.unitId?.trim()) {
			if (!countUnit) return null;

			return {
				id: countUnit.id,
				name: displayUnitName(countUnit.name, countUnit.abbreviation, "COUNT") || COUNT_DISPLAY_NAME,
				abbreviation: (countUnit.abbreviation ?? "").trim(),
				category: "COUNT",
				precisionScale: clampPrecisionScale(countUnit.precisionScale ?? COUNT_PRECISION),
			};
		}

		const category = String(draft.unitCategory || "COUNT");
		const precision =
			category === "COUNT"
				? clampPrecisionScale(draft.unitPrecisionScale ?? COUNT_PRECISION)
				: clampPrecisionScale(draft.unitPrecisionScale ?? DEFAULT_PRECISION);

		return {
			id: draft.unitId.trim(),
			name: displayUnitName(draft.unitName, draft.unitAbbreviation, category) || COUNT_DISPLAY_NAME,
			abbreviation: (draft.unitAbbreviation ?? "").trim(),
			category,
			precisionScale: precision,
		};
	}, [draft.unitAbbreviation, draft.unitCategory, draft.unitId, draft.unitName, draft.unitPrecisionScale, countUnit]);

	const effectiveUnitId = (effectiveUnit?.id ?? "").trim();

	// Derive scale once for the UI layer
	const effectiveScale = useMemo(() => {
		const s = Number(effectiveUnit?.precisionScale ?? 0);
		return Number.isFinite(s) ? Math.max(0, Math.trunc(s)) : 0;
	}, [effectiveUnit?.precisionScale]);

	// Hard cap for quantity-like inputs
	const qtyMaxLen = HARD_QTY_CAP;

	// Keep quantity fields aligned with the selected Unit + UDQI precision.
	const unitUdiqKey = `${effectiveUnitId}:${effectiveScale}`;
	const previousUnitUdiqKeyRef = useRef(unitUdiqKey);

	useEffect(() => {
		if (previousUnitUdiqKeyRef.current === unitUdiqKey) return;
		previousUnitUdiqKeyRef.current = unitUdiqKey;

		const nextInitial = normalizeQuantityForUnitChange(draft.initialOnHandText, effectiveScale, qtyMaxLen);
		const nextReorder = normalizeQuantityForUnitChange(draft.reorderPointText, effectiveScale, qtyMaxLen);

		if (nextInitial === draft.initialOnHandText && nextReorder === draft.reorderPointText) return;

		patch({
			initialOnHandText: nextInitial,
			reorderPointText: nextReorder,
		});
	}, [draft.initialOnHandText, draft.reorderPointText, effectiveScale, patch, qtyMaxLen, unitUdiqKey]);

	const hasDirtyInput = useMemo(() => {
		const hasValue = (v: string) => v.trim().length > 0;

		if (hasValue(draft.name)) return true;
		if (hasValue(draft.description)) return true;
		if (hasValue(draft.sku)) return true;
		if (hasValue(draft.barcode)) return true;
		if (hasValue(draft.priceText)) return true;
		if (hasValue(draft.costText)) return true;
		if (hasValue(draft.initialOnHandText)) return true;
		if ((draft.selectedOptionSetIds?.length ?? 0) > 0) return true;
		if ((draft.variations?.length ?? 0) > 0) return true;
		if (hasValue(draft.categoryId) || hasValue(draft.categoryName)) return true;
		if ((draft.modifierGroupIds?.length ?? 0) > 0) return true;
		if ((draft.selectedTaxIds?.length ?? 0) > 0) return true;
		if (draft.taxExempt) return true;
		if (hasValue(draft.imageLocalUri)) return true;

		if (effectiveUnitId && countUnit?.id && effectiveUnitId !== countUnit.id) return true;

		return false;
	}, [
		countUnit?.id,
		draft.barcode,
		draft.categoryId,
		draft.categoryName,
		draft.costText,
		draft.description,
		draft.imageLocalUri,
		draft.initialOnHandText,
		draft.modifierGroupIds,
		draft.name,
		draft.priceText,
		draft.selectedTaxIds,
		draft.selectedOptionSetIds,
		draft.sku,
		draft.taxExempt,
		draft.variations,
		effectiveUnitId,
	]);

	const selectedCategoryColor = useMemo(() => {
		const selectedId = (draft.categoryId ?? "").trim();
		if (!selectedId) return null;
		const category = (categoriesQuery.data?.items ?? []).find((item) => item.id === selectedId);
		const color = typeof category?.color === "string" ? category.color.trim() : "";
		return color || null;
	}, [categoriesQuery.data?.items, draft.categoryId]);
	const hasAvailableModifierGroups = (modifierGroupsQuery.data?.length ?? 0) > 0;
	const selectedTaxCount = draft.selectedTaxIds.length;
	const taxesHelperText = useMemo(() => {
		if (draft.taxExempt || selectedTaxCount === 0) return "No tax applied";
		if (selectedTaxCount === 1) return "1 tax applied";
		return `${selectedTaxCount} taxes applied`;
	}, [draft.taxExempt, selectedTaxCount]);

	/* ---------------- navigation ---------------- */

	const openCategoryPicker = useCallback(() => {
		if (isUiDisabled) return;
		if (!lockNav()) return;

		router.replace({
			pathname: toScopedRoute(CATEGORY_PICKER_ROUTE) as any,
			params: {
				[CATEGORY_RETURN_TO_KEY]: thisRoute,
				[CATEGORY_DRAFT_ID_KEY]: draftId,

				selectedCategoryId: draft.categoryId || "",
				selectedCategoryName: draft.categoryName || "",
				selectionSource: "existing",
			} as any,
		});
	}, [draft.categoryId, draft.categoryName, draftId, isUiDisabled, lockNav, router, thisRoute, toScopedRoute]);

	const openUnitPicker = useCallback(() => {
		if (isUiDisabled) return;
		if (!lockNav()) return;

		const current = effectiveUnit ?? {
			id: "",
			name: COUNT_DISPLAY_NAME,
			abbreviation: "",
			category: "COUNT",
			precisionScale: COUNT_PRECISION,
		};

		const currentName = (current.name || COUNT_DISPLAY_NAME).trim();
		const currentAbbr = (current.abbreviation ?? "").trim();
		const currentCategory = String(current.category || "COUNT");
		const currentPrecision =
			currentCategory === "COUNT"
				? String(clampPrecisionScale(current.precisionScale ?? COUNT_PRECISION))
				: String(clampPrecisionScale(current.precisionScale ?? DEFAULT_PRECISION));

		router.replace({
			pathname: toScopedRoute(UNIT_PICKER_ROUTE) as any,
			params: {
				[RETURN_TO_KEY]: thisRoute,
				[DRAFT_ID_KEY]: draftId,

				...(effectiveUnitId ? { [UNIT_SELECTED_ID_KEY]: effectiveUnitId } : {}),
				[UNIT_SELECTED_NAME_KEY]: currentName,
				[UNIT_SELECTED_ABBR_KEY]: currentAbbr,
				[UNIT_SELECTED_CATEGORY_KEY]: currentCategory,
				[UNIT_SELECTED_PRECISION_KEY]: currentPrecision,

				[UNIT_CONTEXT_PRODUCT_TYPE_KEY]: unitProductType,
				[UNIT_SELECTION_SOURCE_KEY]: "existing",
			} as any,
		});
	}, [
		draftId,
		effectiveUnit,
		effectiveUnitId,
		isUiDisabled,
		lockNav,
		router,
		thisRoute,
		toScopedRoute,
		unitProductType,
	]);

	const openTaxEditor = useCallback(() => {
		if (isUiDisabled) return;
		if (!lockNav()) return;

		router.replace({
			pathname: toScopedRoute(TAX_PICKER_ROUTE) as any,
			params: {
				[TAX_RETURN_TO_KEY]: thisRoute,
				[TAX_DRAFT_ID_KEY]: draftId,
				...buildTaxSelectionParams({
					selectedTaxIds: draft.selectedTaxIds,
					selectedTaxNames: draft.selectedTaxNames,
					selectionSource: draft.selectedTaxIds.length > 0 ? "existing" : "cleared",
					taxExempt: draft.taxExempt,
					draftId,
				}),
			} as any,
		});
	}, [
		draft.selectedTaxIds,
		draft.selectedTaxNames,
		draft.taxExempt,
		draftId,
		isUiDisabled,
		lockNav,
		router,
		thisRoute,
		toScopedRoute,
	]);

	const openOptionsVariations = useCallback(() => {
		if (isUiDisabled) return;
		if (!lockNav()) return;

		router.replace({
			pathname: toScopedRoute(PRODUCT_SELECT_OPTIONS_ROUTE) as any,
			params: {
				[OPTION_DRAFT_ID_KEY]: draftId,
				[OPTION_RETURN_TO_KEY]: thisRoute,
			} as any,
		});
	}, [draftId, isUiDisabled, lockNav, router, thisRoute, toScopedRoute]);

	const openAddVariation = useCallback(() => {
		if (isUiDisabled) return;
		if (!lockNav()) return;

		router.replace({
			pathname: toScopedRoute(PRODUCT_CREATE_VARIATIONS_ROUTE) as any,
			params: {
				[OPTION_DRAFT_ID_KEY]: draftId,
				[OPTION_RETURN_TO_KEY]: thisRoute,
			} as any,
		});
	}, [draftId, isUiDisabled, lockNav, router, thisRoute, toScopedRoute]);

	const openCreateVariations = useCallback(() => {
		if (isUiDisabled) return;
		if (!lockNav()) return;

		router.replace({
			pathname: toScopedRoute(PRODUCT_CREATE_VARIATIONS_ROUTE) as any,
			params: {
				[OPTION_DRAFT_ID_KEY]: draftId,
				[OPTION_RETURN_TO_KEY]: thisRoute,
			} as any,
		});
	}, [draftId, isUiDisabled, lockNav, router, thisRoute, toScopedRoute]);

	const openCreateModifierSet = useCallback(() => {
		if (isUiDisabled) return;
		if (!lockNav()) return;

		router.push({
			pathname: INVENTORY_MODIFIER_CREATE_ROUTE as any,
			params: {
				[MODIFIER_RETURN_TO_KEY]: thisRoute,
				...buildModifierSelectionParams({
					selectedModifierGroupIds: draft.modifierGroupIds,
					selectionSource: draft.modifierGroupIds.length > 0 ? "existing" : "cleared",
					draftId,
				}),
			} as any,
		});
	}, [draft.modifierGroupIds, draftId, isUiDisabled, lockNav, router, thisRoute]);

	const openManageStock = useCallback(() => {
		if (isUiDisabled) return;
		if (!lockNav()) return;

		router.replace({
			pathname: toScopedRoute(INVENTORY_MANAGE_STOCK_ROUTE) as any,
			params: {
				draftId,
				returnTo: thisRoute,
			} as any,
		});
	}, [draftId, isUiDisabled, lockNav, router, thisRoute, toScopedRoute]);

	const openMoneyKeyboard = useCallback(
		(field: MoneyFieldKey) => {
			if (isUiDisabled) return;
			setActiveMoneyField(field);
		},
		[isUiDisabled],
	);

	const closeMoneyKeyboard = useCallback(() => {
		if (activeMoneyField === "price") {
			priceInputRef.current?.blur?.();
		}
		if (activeMoneyField === "cost") {
			costInputRef.current?.blur?.();
		}
		setActiveMoneyField(null);
	}, [activeMoneyField]);

	const dismissMoneyKeyboardIfOpen = useCallback(() => {
		if (activeMoneyField === null) return;
		closeMoneyKeyboard();
	}, [activeMoneyField, closeMoneyKeyboard]);

	const priceMinor = useMemo(
		() => moneyTextToMinorUnits(draft.priceText, MONEY_SCALE, MONEY_MAX_MINOR_DIGITS),
		[draft.priceText],
	);
	const costMinor = useMemo(
		() => moneyTextToMinorUnits(draft.costText, MONEY_SCALE, MONEY_MAX_MINOR_DIGITS),
		[draft.costText],
	);

	const onMoneyKeyPress = useCallback(
		(key: BAINumericBottomSheetKey) => {
			if (!activeMoneyField) return;

			const currentMinor = activeMoneyField === "price" ? priceMinor : costMinor;
			const nextMinor = applyMoneyKeypadKey(currentMinor, key, MONEY_MAX_MINOR_DIGITS);
			if (nextMinor === currentMinor) return;

			const nextValue = minorUnitsToMoneyText(nextMinor, MONEY_SCALE);
			if (activeMoneyField === "price") {
				patch({ priceText: nextValue });
				return;
			}
			patch({ costText: nextValue });
		},
		[activeMoneyField, costMinor, patch, priceMinor],
	);

	/* ---------------- save ---------------- */

	const onSave = useCallback(
		async (afterSave: "detail" | "addAnother" = "detail") => {
			if (isUiDisabled) return;

			const nameTrimmed = sanitizeProductNameInput(draft.name).trim();
			if (!nameTrimmed) return;

			const finalUnitId = effectiveUnitId;
			if (!finalUnitId) {
				setError("Please select a unit.");
				return;
			}

			setError(null);

			const imageUriForUpload = tileMode === "IMAGE" ? localImageUri : "";

			await withBusy("Saving item…", async () => {
				const priceN = toMoneyOrNull(draft.priceText);
				const costN = toMoneyOrNull(draft.costText);

				if (costN !== null && priceN !== null && costN > priceN) {
					setError("Cost cannot exceed price.");
					return;
				}

				const normalizedGtin = sanitizeGtinInput(draft.barcode).trim();
				const gtinValidation = validateGtinValue(normalizedGtin);
				if (!gtinValidation.ok) {
					setError(gtinValidation.message);
					return;
				}

				const initialOnHandCheck = normalizeQuantityForSubmit(draft.initialOnHandText, effectiveScale);
				if (!initialOnHandCheck.ok) {
					setError(initialOnHandCheck.message);
					return;
				}

				const selectedOptionSetIdSet = new Set(draft.selectedOptionSetIds);
				const variationSelectionsForSave = draft.optionSelections
					.filter((selection) => selectedOptionSetIdSet.has(selection.optionSetId))
					.filter((selection) => selection.selectedValueIds.length > 0)
					.map((selection) => ({
						optionSetId: selection.optionSetId,
						optionValueIds: selection.selectedValueIds,
					}));
				const hasSelectedOptionSetsForSave = draft.selectedOptionSetIds.length > 0;
				const hasCompleteOptionSelectionsForSave =
					hasSelectedOptionSetsForSave && variationSelectionsForSave.length === draft.selectedOptionSetIds.length;
				const selectedTaxIdsForSave = Array.from(
					new Set(
						(draft.taxExempt ? [] : draft.selectedTaxIds).map((taxId) => String(taxId ?? "").trim()).filter(Boolean),
					),
				);

				if (hasSelectedOptionSetsForSave && !hasCompleteOptionSelectionsForSave) {
					setError("Complete option values before saving.");
					return;
				}

				const input: CreateProductInput = {
					type: "PHYSICAL",
					name: nameTrimmed,
					trackInventory: true,
					sku: draft.sku.trim() || undefined,
					barcode: normalizedGtin || undefined,
					categoryId: draft.categoryId.trim() || undefined,
					description: sanitizeDescriptionInput(draft.description).trim() || undefined,

					price: priceN ?? undefined,
					cost: costN ?? undefined,
					initialOnHand: initialOnHandCheck.value ?? undefined,
				};

				const apiPayload = {
					...input,
					unitId: finalUnitId,
					modifierGroupIds: draft.modifierGroupIds,
					posTileMode: tileMode,
					posTileColor: tileColor ?? null,
					posTileLabel: tileLabel || undefined,
				};

				try {
					let createdId = createdProductIdRef.current;
					if (!createdId) {
						const created = await inventoryApi.createProduct(apiPayload as any);
						createdId = created.id;
						createdProductIdRef.current = createdId;
						invalidateInventoryAfterMutation(queryClient, { productId: createdId });
					}

					if (hasSelectedOptionSetsForSave && variationSelectionsForSave.length > 0) {
						try {
							await optionsApi.generateProductVariations(createdId, {
								selections: variationSelectionsForSave,
								selectedVariationKeys:
									draft.variations.length > 0 ? draft.variations.map((variation) => variation.variationKey) : undefined,
							});
						} catch (e: any) {
							const payload = e?.response?.data;
							const message =
								payload?.message ??
								payload?.error ??
								payload?.errorMessage ??
								payload?.error?.message ??
								"Item saved, but options and variations failed to sync. Tap save to retry.";
							setError(String(message));
							return;
						}
					} else if (!hasSelectedOptionSetsForSave && draft.variations.length > 0) {
						try {
							await optionsApi.syncManualProductVariations(createdId, {
								variations: draft.variations.map((variation, idx) => ({
									variationKey: variation.variationKey,
									label: variation.label,
									sortOrder:
										typeof variation.sortOrder === "number" && Number.isFinite(variation.sortOrder)
											? variation.sortOrder
											: idx,
								})),
							});
						} catch (e: any) {
							const payload = e?.response?.data;
							const message =
								payload?.message ??
								payload?.error ??
								payload?.errorMessage ??
								payload?.error?.message ??
								"Item saved, but variations failed to sync. Tap save to retry.";
							setError(String(message));
							return;
						}
					}

					if (selectedTaxIdsForSave.length > 0) {
						try {
							for (const taxId of selectedTaxIdsForSave) {
								const tax = await salesTaxesApi.getById(taxId);
								if (tax.archivedAt) continue;
								const nextItemIds = Array.from(new Set([...(tax.itemIds ?? []), createdId]));
								await salesTaxesApi.update(taxId, {
									name: tax.name,
									percentageText: String(tax.percentage),
									enabled: tax.enabled,
									applicationMode: "SELECT_ITEMS",
									customAmounts: tax.customAmounts,
									itemPricingMode: tax.itemPricingMode,
									itemIds: nextItemIds,
									serviceIds: tax.serviceIds ?? [],
								});
							}
							await queryClient.invalidateQueries({ queryKey: salesTaxKeys.root });
						} catch (e: any) {
							const payload = e?.response?.data;
							const message =
								payload?.message ??
								payload?.error ??
								payload?.errorMessage ??
								payload?.error?.message ??
								"Item saved, but taxes failed to link. Tap save to retry.";
							setError(String(message));
							return;
						}
					}

					const detailRoute = toScopedRoute(`/(app)/(tabs)/inventory/products/${encodeURIComponent(createdId)}`);

					if (imageUriForUpload) {
						try {
							await uploadProductImage({
								imageKind: "PRIMARY_POS_TILE",
								localUri: imageUriForUpload,
								productId: createdId,
								isPrimary: true,
								sortOrder: 0,
							});
						} catch (e) {
							const domain = toMediaDomainError(e);
							setError(domain.message || "Item saved, but the photo failed to upload. Tap save to retry.");
							return;
						}
					}

					createdProductIdRef.current = null;
					reset();
					if (afterSave === "addAnother") {
						showSuccess("Item saved. Add another item.");
						return;
					}
					router.replace(detailRoute as any);
				} catch (e: any) {
					const payload = e?.response?.data;
					const backendCode = payload?.code ?? payload?.errorCode ?? payload?.error?.code ?? payload?.data?.code;
					if (backendCode === "CATALOG_LIMIT_REACHED") {
						setError("Limit Reached\nThis business has reached the supported catalog limit. Contact support.");
						return;
					}
					if (backendCode === "BARCODE_ALREADY_EXISTS") {
						setError("GTIN (Barcode) already exists for this business.");
						return;
					}
					if (backendCode === "SKU_ALREADY_EXISTS") {
						setError("SKU already exists for this business.");
						return;
					}
					const backendMessage =
						payload?.message ??
						payload?.error ??
						payload?.errorMessage ??
						payload?.error?.message ??
						payload?.data?.message;
					const msg = String(backendMessage ?? e?.message ?? "Failed to create item.");
					setError(msg);
				}
			});
		},
		[
			draft,
			effectiveScale,
			effectiveUnitId,
			isUiDisabled,
			localImageUri,
			queryClient,
			reset,
			router,
			showSuccess,
			tileColor,
			tileLabel,
			tileMode,
			toScopedRoute,
			withBusy,
		],
	);

	const onSaveAndAddAnother = useCallback(() => onSave("addAnother"), [onSave]);

	const borderColor = theme.colors.outlineVariant ?? theme.colors.outline;
	const unitValueText = useMemo(() => {
		if (!effectiveUnit) return "None";
		const name = (effectiveUnit.name || COUNT_DISPLAY_NAME).trim() || COUNT_DISPLAY_NAME;
		const abbr = (effectiveUnit.abbreviation ?? "").trim();
		return displayUnitValueInline(name, abbr, String(effectiveUnit.category));
	}, [effectiveUnit]);

	const variationCount = draft.variations.length;
	const selectedOptionRows = useMemo(() => {
		return draft.selectedOptionSetIds
			.map((optionSetId) => {
				const selection = draft.optionSelections.find((row) => row.optionSetId === optionSetId);
				if (!selection) return null;
				return {
					optionSetId,
					name: selection.optionSetName,
					selectedNames: selection.selectedValueNames,
				};
			})
			.filter((row): row is NonNullable<typeof row> => !!row);
	}, [draft.optionSelections, draft.selectedOptionSetIds]);
	const hasSelectedOptionSets = draft.selectedOptionSetIds.length > 0;
	const hasCompleteOptionSelections =
		hasSelectedOptionSets &&
		selectedOptionRows.length === draft.selectedOptionSetIds.length &&
		selectedOptionRows.every((row) => row.selectedNames.length > 0);
	const hasIncompleteOptionSelection = hasSelectedOptionSets && !hasCompleteOptionSelections;
	const hasManualOnlyVariations = variationCount > 0 && !hasSelectedOptionSets;
	const optionsVariationCta = hasSelectedOptionSets ? "Edit Options" : "Add Options";
	const canCreateVariations = hasCompleteOptionSelections || !hasSelectedOptionSets;
	const createVariationCta = variationCount > 0 ? "Add Variation" : "Create Variations";
	const sortedVariations = useMemo(
		() => draft.variations.slice().sort((a, b) => a.sortOrder - b.sortOrder),
		[draft.variations],
	);
	const priceDisplay = useMemo(
		() => formatMoneyFromMinor({ minorUnits: priceMinor, currencyCode, scale: MONEY_SCALE }),
		[currencyCode, priceMinor],
	);
	const costDisplay = useMemo(
		() => formatMoneyFromMinor({ minorUnits: costMinor, currencyCode, scale: MONEY_SCALE }),
		[currencyCode, costMinor],
	);
	const priceInputDisplay = draft.priceText.trim() ? priceDisplay : "";
	const costInputDisplay = draft.costText.trim() ? costDisplay : "";
	const stockOnHandValue = useMemo(() => formatStockOnHandDisplay(draft.initialOnHandText), [draft.initialOnHandText]);
	const reorderPointValue = useMemo(() => formatStockOnHandDisplay(draft.reorderPointText), [draft.reorderPointText]);
	const isMoneyKeyboardOpen = activeMoneyField !== null;
	const [isSystemKeyboardOpen, setIsSystemKeyboardOpen] = useState(false);
	const isAnyKeyboardOpen = isMoneyKeyboardOpen || isSystemKeyboardOpen;
	const moneyKeyboardKey = useMemo(
		() => `${draftId}:${currencyCode}:${activeMoneyField ?? "closed"}`,
		[activeMoneyField, currencyCode, draftId],
	);

	useEffect(() => {
		const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
		const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
		const showSub = Keyboard.addListener(showEvent, () => setIsSystemKeyboardOpen(true));
		const hideSub = Keyboard.addListener(hideEvent, () => setIsSystemKeyboardOpen(false));
		return () => {
			showSub.remove();
			hideSub.remove();
		};
	}, []);

	const saveDisabled = isUiDisabled || !draft.name.trim() || !effectiveUnitId || hasIncompleteOptionSelection;

	// Process cancel intent → go back to Add Item selector
	const onExitToAddItems = useCallback(() => {
		if (isUiDisabled) return;
		if (hasDirtyInput) {
			setConfirmExitOpen(true);
			return;
		}
		runGovernedExitReplace(addItemsRoute, {
			router: router as any,
			lockNav,
			disabled: isUiDisabled,
		});
	}, [addItemsRoute, hasDirtyInput, isUiDisabled, lockNav, router]);
	const guardedOnExitToAddItems = useProcessExitGuard(onExitToAddItems);

	const onDiscardExit = useCallback(() => {
		if (isUiDisabled) return;
		setConfirmExitOpen(false);
		const exited = runGovernedExitReplace(addItemsRoute, {
			router: router as any,
			lockNav,
			disabled: isUiDisabled,
		});
		if (!exited) return;
		createdProductIdRef.current = null;
		reset();
	}, [addItemsRoute, isUiDisabled, lockNav, reset, router]);

	const onResumeEditing = useCallback(() => {
		if (isUiDisabled) return;
		setConfirmExitOpen(false);
	}, [isUiDisabled]);

	const headerOptions = useInventoryHeader("process", {
		title: "Create Item",
		disabled: isUiDisabled,
		onExit: guardedOnExitToAddItems,
		exitFallbackRoute: addItemsRoute,
	});

	return (
		<>
			<Stack.Screen
				options={{
					...headerOptions,
					headerShadowVisible: false,
				}}
			/>

			<BAIScreen tabbed padded={false} safeTop={false} safeBottom={false} safeAreaGradientBottom style={styles.root}>
				<View style={[styles.screen, styles.scroll, { backgroundColor: theme.colors.background }]}>
					<ScrollView
						style={styles.formScroll}
						contentContainerStyle={styles.formContainer}
						showsVerticalScrollIndicator={false}
						showsHorizontalScrollIndicator={false}
						keyboardShouldPersistTaps='handled'
					>
						<BAISurface style={[styles.sectionSurface, { borderColor }]} padded={false}>
							<View style={styles.sectionContent}>
								<View style={styles.imageSection}>
									<View style={styles.imageInlineRow}>
										<View
											style={[
												styles.imagePreview,
												{
													borderColor,
													backgroundColor: theme.colors.surfaceVariant ?? theme.colors.surface,
												},
											]}
										>
											{hasLocalImage && tileMode === "IMAGE" ? (
												<Image source={{ uri: localImageUri }} style={styles.imagePreviewImage} resizeMode='cover' />
											) : hasColor ? (
												<View style={[styles.imagePreviewImage, { backgroundColor: tileColor }]} />
											) : shouldShowEmpty ? (
												<View style={styles.imagePreviewEmpty}>
													<FontAwesome6
														name='image'
														size={64}
														color={theme.colors.onSurfaceVariant ?? theme.colors.onSurface}
													/>
													<BAIText variant='caption' muted>
														No Photo
													</BAIText>
												</View>
											) : null}
											{shouldShowTileTextOverlay ? (
												<PosTileTextOverlay label={displayTileLabel} name={itemName} textColor={tileLabelColor} />
											) : null}
										</View>

										<View style={styles.imageActionColumn}>
											<BAIIconButton
												variant='outlined'
												size='lg'
												icon='barcode-scan'
												iconSize={44}
												accessibilityLabel='Scan barcode'
												onPress={onOpenBarcodeScanner}
												disabled={isUiDisabled}
												style={styles.barcodeIconButtonLarge}
											/>
											<BAIIconButton
												variant='outlined'
												size='md'
												icon='camera'
												iconSize={34}
												accessibilityLabel='Edit image'
												onPress={onEditPosTile}
												disabled={isUiDisabled}
												style={styles.imageEditButtonOutside}
											/>
										</View>
									</View>

									{imageError ? (
										<BAIText variant='caption' style={{ color: theme.colors.error }}>
											{imageError}
										</BAIText>
									) : null}
								</View>

								<View style={styles.primaryDetailsStack}>
									<BAITextInput
										label='Name'
										value={draft.name}
										onChangeText={(t) => patch({ name: sanitizeProductNameDraftInput(t) })}
										onFocus={dismissMoneyKeyboardIfOpen}
										onBlur={() => {
											if (isUiDisabled) return;
											patch({ name: sanitizeProductNameInput(draft.name) });
										}}
										maxLength={FIELD_LIMITS.productName}
										placeholder='e.g. Iced Latte'
										disabled={isUiDisabled}
										style={styles.noInputMargin}
									/>

									<BAITextInput
										label='GTIN (Barcode)'
										value={draft.barcode}
										onChangeText={(t) => patch({ barcode: sanitizeGtinInput(t) })}
										onFocus={dismissMoneyKeyboardIfOpen}
										maxLength={GTIN_MAX_LENGTH}
										placeholder='Scan or enter UPC / EAN / ISBN'
										keyboardType='number-pad'
										disabled={isUiDisabled}
										style={styles.noInputMargin}
									/>

									<BAIPressableRow
										label='Category'
										value={draft.categoryName ? draft.categoryName : "None"}
										showValueDot={Boolean(draft.categoryName?.trim())}
										valueDotColor={selectedCategoryColor}
										onPress={() => {
											dismissMoneyKeyboardIfOpen();
											openCategoryPicker();
										}}
										disabled={isUiDisabled}
									/>

									<Pressable
										onPress={() => {
											dismissMoneyKeyboardIfOpen();
											openTaxEditor();
										}}
										disabled={isUiDisabled}
										style={({ pressed }) => [
											styles.taxInlineRow,
											{ borderColor, backgroundColor: theme.colors.surfaceVariant ?? theme.colors.surface },
											pressed && !isUiDisabled ? styles.stockCardPressed : null,
											isUiDisabled ? styles.stockCardDisabled : null,
										]}
									>
										<View style={styles.taxInlineRowLeft}>
											<BAIText variant='subtitle'>Taxes</BAIText>
											<BAIText variant='caption' muted>
												{taxesHelperText}
											</BAIText>
										</View>
										<View style={styles.taxEditWrap}>
											<BAIText variant='subtitle' style={styles.taxEditText}>
												Edit
											</BAIText>
											<MaterialCommunityIcons
												name='chevron-right'
												size={24}
												color={theme.colors.onSurfaceVariant ?? theme.colors.onSurface}
											/>
										</View>
									</Pressable>

									<BAITextarea
										label='Description (optional)'
										value={draft.description}
										onChangeText={(t) => patch({ description: sanitizeDescriptionDraftInput(t) })}
										onFocus={dismissMoneyKeyboardIfOpen}
										onBlur={() => {
											if (isUiDisabled) return;
											patch({ description: sanitizeDescriptionInput(draft.description) });
										}}
										maxLength={FIELD_LIMITS.productDescription}
										placeholder='Optional description…'
										disabled={isUiDisabled}
									/>
								</View>
							</View>
						</BAISurface>

						<BAISurface style={[styles.sectionSurface, { borderColor }]} padded={false}>
							<View style={styles.sectionContent}>
								<BAIText variant='subtitle'>{hasManualOnlyVariations ? "Variations" : "Options setup"}</BAIText>

								{!hasManualOnlyVariations ? (
									<>
										<BAIText variant='body' style={styles.sectionHelperText}>
											Add a custom set of options to an item to create variations. For example, a size option set
											creates variations small, medium, and large.
										</BAIText>

										<BAIButton
											variant='solid'
											shape='default'
											onPress={() => {
												dismissMoneyKeyboardIfOpen();
												openOptionsVariations();
											}}
											disabled={isUiDisabled || !effectiveUnitId}
										>
											{optionsVariationCta}
										</BAIButton>
										{selectedOptionRows.length > 0 ? (
											<View style={styles.optionSummaryWrap}>
												{selectedOptionRows.map((row) => (
													<View
														key={row.optionSetId}
														style={[
															styles.optionSummaryRow,
															{
																borderColor,
																backgroundColor: theme.colors.surfaceVariant ?? theme.colors.surface,
															},
														]}
													>
														<BAIText variant='subtitle'>{row.name}</BAIText>
														<BAIText variant='caption' muted numberOfLines={1}>
															{row.selectedNames.length > 0 ? row.selectedNames.join(", ") : "No options selected"}
														</BAIText>
													</View>
												))}
											</View>
										) : null}
									</>
								) : (
									<BAIText variant='caption' muted>
										Options are hidden while manual variations are active.
									</BAIText>
								)}

								{sortedVariations.length > 0 ? (
									<>
										<BAIText variant='subtitle'>Variations</BAIText>
										<View style={styles.variationRowsWrap}>
											{sortedVariations.map((variation) => (
												<Pressable
													key={variation.variationKey}
													onPress={() => {
														dismissMoneyKeyboardIfOpen();
														openManageStock();
													}}
													disabled={isUiDisabled}
													style={({ pressed }) => [
														styles.variationRow,
														{
															borderColor,
															backgroundColor: theme.colors.surfaceVariant ?? theme.colors.surface,
														},
														pressed && !isUiDisabled ? styles.stockCardPressed : null,
														isUiDisabled ? styles.stockCardDisabled : null,
													]}
												>
													<View style={styles.variationRowText}>
														<BAIText variant='subtitle'>{variation.label}</BAIText>
														<BAIText variant='caption' muted>
															Variable
														</BAIText>
													</View>
													<View style={styles.stockCardActionWrap}>
														<BAIText variant='subtitle' style={styles.stockCardAction}>
															Manage Stock
														</BAIText>
													</View>
												</Pressable>
											))}
										</View>
									</>
								) : null}
							</View>
						</BAISurface>

						<BAISurface style={[styles.sectionSurface, { borderColor }]} padded={false}>
							<View style={styles.sectionContent}>
								<BAIText variant='subtitle'>Price and Inventory</BAIText>

								<View style={styles.priceInventoryStack}>
									<View style={styles.priceInventoryFieldsStack}>
										<BAITextInput
											label='SKU is auto-generated if left blank'
											value={draft.sku}
											onChangeText={(t) => patch({ sku: sanitizeSkuInput(t) })}
											onFocus={dismissMoneyKeyboardIfOpen}
											maxLength={FIELD_LIMITS.sku}
											placeholder='Optional'
											disabled={isUiDisabled}
											style={styles.noInputMargin}
										/>

										<BAIPressableRow
											label='Unit'
											value={unitValueText}
											onPress={() => {
												dismissMoneyKeyboardIfOpen();
												openUnitPicker();
											}}
											disabled={isUiDisabled}
										/>

										{!effectiveUnitId ? (
											<BAIText variant='caption' muted style={styles.priceInventoryHintText}>
												Select a unit to continue.
											</BAIText>
										) : null}

										<BAITextInput
											ref={priceInputRef}
											label='Price'
											value={priceInputDisplay}
											placeholder={formatMoneyFromMinor({ minorUnits: 0, currencyCode, scale: MONEY_SCALE })}
											showSoftInputOnFocus={false}
											contextMenuHidden
											caretHidden={false}
											onFocus={() => openMoneyKeyboard("price")}
											selection={{ start: priceInputDisplay.length, end: priceInputDisplay.length }}
											disabled={isUiDisabled}
											style={styles.noInputMargin}
										/>

										<BAITextInput
											ref={costInputRef}
											label='Cost (optional)'
											value={costInputDisplay}
											placeholder={formatMoneyFromMinor({ minorUnits: 0, currencyCode, scale: MONEY_SCALE })}
											showSoftInputOnFocus={false}
											contextMenuHidden
											caretHidden={false}
											onFocus={() => openMoneyKeyboard("cost")}
											selection={{ start: costInputDisplay.length, end: costInputDisplay.length }}
											disabled={isUiDisabled}
											style={styles.noInputMargin}
										/>
									</View>

									<View style={styles.priceInventoryActionsStack}>
										<Pressable
											onPress={() => {
												dismissMoneyKeyboardIfOpen();
												openManageStock();
											}}
											disabled={isUiDisabled}
											style={({ pressed }) => [
												styles.stockCard,
												{
													borderColor,
													backgroundColor: theme.colors.surfaceVariant ?? theme.colors.surface,
												},
												pressed && !isUiDisabled ? styles.stockCardPressed : null,
												isUiDisabled ? styles.stockCardDisabled : null,
											]}
										>
											<View style={styles.stockCardText}>
												<BAIText variant='caption' muted>
													Stock on hand
												</BAIText>
												<BAIText variant='subtitle'>{stockOnHandValue || "None"}</BAIText>
												<BAIText variant='caption' muted style={styles.stockCardMeta}>
													Reorder point: {reorderPointValue || "None"}
												</BAIText>
											</View>
											<View style={styles.stockCardActionWrap}>
												<BAIText variant='subtitle' style={styles.stockCardAction}>
													Manage Stock
												</BAIText>
												<MaterialCommunityIcons
													name='chevron-right'
													size={24}
													color={theme.colors.onSurfaceVariant ?? theme.colors.onSurface}
												/>
											</View>
										</Pressable>

										{hasIncompleteOptionSelection ? (
											<BAIText variant='caption' muted style={styles.priceInventoryHintText}>
												Select at least one value in each option set to create variations.
											</BAIText>
										) : null}

										<BAIButton
											variant='solid'
											shape='default'
											onPress={() => {
												dismissMoneyKeyboardIfOpen();
												if (!canCreateVariations) {
													return;
												}
												if (variationCount > 0) {
													openAddVariation();
													return;
												}
												openCreateVariations();
											}}
											disabled={isUiDisabled || !effectiveUnitId || !canCreateVariations}
										>
											{createVariationCta}
										</BAIButton>
									</View>
								</View>
							</View>
						</BAISurface>

						{routeScope === "inventory" ? (
							<BAISurface style={[styles.sectionSurface, { borderColor }]} padded={false}>
								<View style={styles.sectionContent}>
									<BAIText variant='subtitle'>Modifiers</BAIText>

									<ModifierGroupSelector
										selectedIds={draft.modifierGroupIds}
										onChange={(modifierGroupIds) => patch({ modifierGroupIds })}
										disabled={isUiDisabled}
										showHeader={false}
										useContainer={false}
										showRowDividers
										emptyMode='hidden'
										groups={modifierGroupsQuery.data}
										isLoading={modifierGroupsQuery.isLoading}
										isError={modifierGroupsQuery.isError}
									/>

									{!hasAvailableModifierGroups && !modifierGroupsQuery.isLoading && !modifierGroupsQuery.isError ? (
										<>
											<BAIText variant='body' style={styles.modifiersHelperText}>
												Add a custom set of modifiers to customize this item at checkout, such as toppings, add-ons, or
												special requests.
											</BAIText>
											<BAIButton
												variant='subtle'
												intent='neutral'
												shape='default'
												onPress={() => {
													dismissMoneyKeyboardIfOpen();
													openCreateModifierSet();
												}}
												disabled={isUiDisabled}
											>
												Create Modifier Set
											</BAIButton>
										</>
									) : null}
								</View>
							</BAISurface>
						) : null}

						{error ? (
							<BAIText variant='caption' style={{ color: theme.colors.error }}>
								{error}
							</BAIText>
						) : null}

						<BAISurface style={[styles.sectionSurface, styles.actionsSection, { borderColor }]} padded={false}>
							<View style={styles.actionsContainer}>
								<BAIText variant='caption' muted style={styles.actionsHelperText}>
									Use Save to keep this item, or Save & Another to save and continue adding the next item.
								</BAIText>
								<View style={[styles.actions, isAnyKeyboardOpen ? styles.actionsKeyboardOpen : null]}>
									<BAICTAPillButton
										intent='primary'
										variant='solid'
										onPress={() => onSave("detail")}
										disabled={saveDisabled}
										style={{ flex: 1 }}
									>
										Save
									</BAICTAPillButton>

									<BAICTAPillButton
										variant='solid'
										onPress={onSaveAndAddAnother}
										disabled={saveDisabled}
										style={{ flex: 1 }}
										intent='primary'
									>
										Save & Another
									</BAICTAPillButton>
								</View>
							</View>
						</BAISurface>
					</ScrollView>
				</View>
			</BAIScreen>

			<BAINumericBottomSheetKeyboard
				visible={isMoneyKeyboardOpen}
				onDismiss={closeMoneyKeyboard}
				onKeyPress={onMoneyKeyPress}
				sheetKey={moneyKeyboardKey}
			/>

			<ConfirmActionModal
				visible={confirmExitOpen}
				title='Unsaved changes'
				message='Do you want to resume editing or discard this item?'
				confirmLabel='Resume'
				cancelLabel='Discard'
				confirmIntent='primary'
				cancelIntent='error'
				onDismiss={onResumeEditing}
				onConfirm={onResumeEditing}
				onCancel={onDiscardExit}
				disabled={isUiDisabled}
			/>
		</>
	);
}

const styles = StyleSheet.create({
	root: { flex: 1 },
	screen: { flex: 1, paddingHorizontal: 12, paddingBottom: 0 },
	scroll: { flex: 1 },
	formScroll: {
		flex: 1,
	},
	noInputMargin: {
		marginBottom: 0,
	},
	formContainer: {
		flexGrow: 1,
		paddingTop: 8,
		paddingBottom: 8,
		gap: FORM_VERTICAL_GAP,
	},
	sectionSurface: {
		borderWidth: 1,
		borderRadius: 18,
	},
	sectionContent: {
		paddingHorizontal: 12,
		paddingVertical: 12,
		gap: FORM_VERTICAL_GAP,
	},
	sectionHelperText: {
		lineHeight: 24,
	},
	taxInlineRow: {
		marginTop: 0,
		borderWidth: 1,
		borderRadius: 12,
		paddingHorizontal: 12,
		paddingVertical: 12,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		gap: FORM_VERTICAL_GAP,
	},
	taxInlineRowLeft: {
		flex: 1,
		minWidth: 0,
		gap: 2,
	},
	taxEditWrap: {
		flexDirection: "row",
		alignItems: "center",
		gap: 4,
	},
	taxEditText: {
		textDecorationLine: "none",
	},
	actionsSection: {
		marginBottom: 200,
	},
	actionsContainer: {
		paddingHorizontal: 12,
		paddingTop: 12,
		paddingBottom: 12,
		gap: FORM_VERTICAL_GAP,
	},
	actionsHelperText: {
		lineHeight: 20,
	},
	imageSection: {
		alignItems: "center",
		gap: 12,
		marginBottom: 0,
		marginTop: 0,
	},
	imagePreview: {
		width: 180,
		aspectRatio: 1,
		borderRadius: 18,
		borderWidth: 1,
		overflow: "hidden",
	},
	imagePreviewImage: {
		width: "100%",
		height: "100%",
	},
	imagePreviewEmpty: {
		flex: 1,
		alignItems: "center",
		justifyContent: "center",
	},
	tileLabelWrap: {
		position: "absolute",
		left: 2,
		right: 2,
		bottom: 2,
		borderRadius: 16,
		overflow: "hidden",
		minHeight: 80,
	},
	tileLabelOverlay: {
		...StyleSheet.absoluteFillObject,
	},
	tileLabelContent: {
		paddingHorizontal: 10,
		paddingTop: 6,
		paddingBottom: 6,
		justifyContent: "flex-start",
		gap: 2,
	},
	tileNameOnlyContent: {
		position: "absolute",
		left: 0,
		right: 0,
		bottom: 0,
		minHeight: 32,
		paddingHorizontal: 10,
		paddingVertical: 6,
		justifyContent: "center",
	},
	tileLabelRow: {
		minHeight: 36,
		justifyContent: "flex-end",
	},
	tileNameRow: {
		minHeight: 20,
		justifyContent: "flex-start",
	},
	tileNamePill: {
		alignSelf: "stretch",
		width: "100%",
		borderRadius: 999,
		paddingHorizontal: 10,
		paddingVertical: 4,
	},
	tileLabelText: {
		fontWeight: "700",
		fontSize: 30,
	},
	tileItemName: {
		marginTop: 0,
		fontSize: 18,
	},
	imageInlineRow: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		gap: 16,
	},
	imageActionColumn: {
		alignItems: "center",
		gap: 20,
	},
	primaryDetailsStack: {
		gap: FORM_VERTICAL_GAP,
	},
	barcodeIconButtonLarge: {
		width: 84,
		height: 84,
		borderRadius: 42,
	},
	imageEditButtonOutside: {
		width: 60,
		height: 60,
		borderRadius: 30,
	},
	actions: {
		flexDirection: "row",
		gap: FORM_VERTICAL_GAP,
		marginTop: 0,
		marginBottom: 0,
	},
	actionsKeyboardOpen: {
		marginBottom: 200,
	},
	optionSummaryWrap: {
		gap: FORM_VERTICAL_GAP,
	},
	optionSummaryRow: {
		paddingHorizontal: 12,
		paddingVertical: 12,
		borderWidth: 1,
		borderRadius: 12,
		gap: 2,
	},
	variationRowsWrap: {
		gap: FORM_VERTICAL_GAP,
	},
	variationRow: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		paddingHorizontal: 12,
		paddingVertical: 12,
		borderWidth: 1,
		borderRadius: 12,
		gap: FORM_VERTICAL_GAP,
	},
	variationRowText: {
		flex: 1,
		minWidth: 0,
		gap: 2,
	},
	priceInventoryStack: {
		gap: FORM_VERTICAL_GAP,
	},
	priceInventoryFieldsStack: {
		gap: FORM_VERTICAL_GAP,
	},
	priceInventoryActionsStack: {
		gap: FORM_VERTICAL_GAP,
	},
	priceInventoryHintText: {
		lineHeight: 20,
	},
	stockCard: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		paddingHorizontal: 14,
		paddingVertical: 12,
		gap: 12,
		borderWidth: 1,
		borderRadius: 12,
	},
	stockCardText: {
		flex: 1,
		minWidth: 0,
		gap: 2,
	},
	stockCardMeta: {
		marginTop: 2,
	},
	stockCardActionWrap: {
		flexDirection: "row",
		alignItems: "center",
		gap: 4,
	},
	stockCardPressed: {
		opacity: 0.85,
	},
	stockCardDisabled: {
		opacity: 0.55,
	},
	stockCardAction: {
		fontWeight: "400",
	},
	modifiersHelperText: {
		lineHeight: 24,
	},
});
