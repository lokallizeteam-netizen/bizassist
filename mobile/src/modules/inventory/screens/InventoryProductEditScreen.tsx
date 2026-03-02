// BizAssist_mobile
// path: src/modules/inventory/screens/InventoryProductEditScreen.tsx
//
// Header governance:
// - Edit Item is a PROCESS screen -> use EXIT.
// - Exit cancels and returns deterministically to item detail.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image, Keyboard, Platform, ScrollView, StyleSheet, TouchableWithoutFeedback, View } from "react-native";
import { useTheme } from "react-native-paper";
import { FontAwesome6 } from "@expo/vector-icons";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";

import { BAIMinorMoneyInput } from "@/components/ui/BAIMinorMoneyInput";
import { BAIButton } from "@/components/ui/BAIButton";
import { BAICTAPillButton } from "@/components/ui/BAICTAButton";
import { BAIIconButton } from "@/components/ui/BAIIconButton";
import { BAIRetryButton } from "@/components/ui/BAIRetryButton";
import { BAIScreen } from "@/components/ui/BAIScreen";
import { BAISurface } from "@/components/ui/BAISurface";
import { BAISwitchRow } from "@/components/ui/BAISwitchRow";
import { BAIText } from "@/components/ui/BAIText";
import { BAITextInput } from "@/components/ui/BAITextInput";
import { BAITextarea } from "@/components/ui/BAITextarea";
import { BAIPressableRow } from "@/components/ui/BAIPressableRow";

import { useAppBusy } from "@/hooks/useAppBusy";
import { useActiveBusinessMeta } from "@/modules/business/useActiveBusinessMeta";
import { catalogKeys } from "@/modules/catalog/catalog.queries";
import { runGovernedProcessExit } from "@/modules/inventory/navigation.governance";
import { useProcessExitGuard } from "@/modules/navigation/useProcessExitGuard";
import {
	inventoryScopeRoot,
	mapInventoryRouteToScope,
	type InventoryRouteScope,
} from "@/modules/inventory/navigation.scope";
import { inventoryApi } from "@/modules/inventory/inventory.api";
import { PosTileTextOverlay } from "@/modules/inventory/components/PosTileTextOverlay";
import { invalidateInventoryAfterMutation } from "@/modules/inventory/inventory.invalidate";
import { inventoryKeys } from "@/modules/inventory/inventory.queries";
import type { InventoryProductDetail, UpdateProductInput } from "@/modules/inventory/inventory.types";
import { useProductCreateDraft } from "@/modules/inventory/drafts/useProductCreateDraft";
import {
	DRAFT_ID_KEY as POS_TILE_DRAFT_ID_KEY,
	POS_TILE_ROUTE,
	ROOT_RETURN_TO_KEY as POS_TILE_ROOT_RETURN_TO_KEY,
	TILE_LABEL_KEY as POS_TILE_TILE_LABEL_KEY,
} from "@/modules/inventory/posTile.contract";
import { useInventoryHeader } from "@/modules/inventory/useInventoryHeader";
import { uploadProductImage } from "@/modules/media/media.upload";
import { toMediaDomainError } from "@/modules/media/media.errors";
import { ModifierGroupSelector } from "@/modules/modifiers/components/ModifierGroupSelector";
import {
	ATTRIBUTE_PICKER_ROUTE,
	ATTRIBUTE_SELECTIONS_KEY,
	buildAttributeSelectionParams,
	decodeAttributeSelections,
	RETURN_TO_KEY as ATTRIBUTE_RETURN_TO_KEY,
} from "@/modules/attributes/attributePicker.contract";
import { attributesApi } from "@/modules/attributes/attributes.api";
import { attributesKeys } from "@/modules/attributes/attributes.queryKeys";
import { FIELD_LIMITS } from "@/shared/fieldLimits";
import { GTIN_MAX_LENGTH, sanitizeGtinInput, validateGtinValue } from "@/shared/validation/gtin";
import {
	sanitizeDescriptionDraftInput,
	sanitizeDescriptionInput,
	sanitizeLabelInput,
	sanitizeMoneyInput,
	sanitizeProductNameDraftInput,
	sanitizeProductNameInput,
	sanitizeSkuInput,
} from "@/shared/validation/sanitize";

type Params = { id?: string; returnTo?: string };

const DETAIL_RETURN_TO_KEY = "returnTo" as const;
const DETAIL_FROM_SAVE_KEY = "fromSave" as const;
const SCANNED_BARCODE_KEY = "scannedBarcode" as const;
const INVENTORY_SCAN_ROUTE = "/(app)/(tabs)/inventory/scan" as const;
const DECIMAL_PATTERN = /^\d+(\.\d+)?$/;
const HARD_QTY_CAP = 18;
const UDQI_INT_MAX_DIGITS = 12;
const COUNT_DISPLAY_ABBR = "pc";
const DEFAULT_ITEM_TILE_COLOR = "#616161";

function clampPrecisionScale(value: unknown): number {
	const raw = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(raw)) return 0;
	return Math.max(0, Math.min(5, Math.trunc(raw)));
}

function toTrimmedString(value: unknown): string {
	if (typeof value !== "string") return "";
	return value.trim();
}

function toMoneyText(value: unknown): string {
	if (typeof value === "number" && Number.isFinite(value)) return value.toFixed(2);
	if (typeof value === "string") return sanitizeMoneyInput(value).trim();
	return "";
}

function capText(raw: string, maxLen: number) {
	if (maxLen <= 0) return "";
	return raw.length > maxLen ? raw.slice(0, maxLen) : raw;
}

function sanitizeQuantityInput(raw: string, scale: number): string {
	let v = String(raw ?? "")
		.replace(/,/g, "")
		.trim();

	if (!v) return "";

	v = v.replace(/[^\d.]/g, "");
	const parts = v.split(".");
	if (parts.length > 2) v = parts[0] + "." + parts.slice(1).join("");

	if (scale <= 0) return v.replace(/\./g, "");

	if (v.includes(".")) {
		const [intPart, fracPart = ""] = v.split(".");
		return `${intPart}.${fracPart.slice(0, Math.max(0, Math.trunc(scale)))}`;
	}

	return v;
}

function enforceUdiqCaps(sanitized: string, scale: number, hardCap: number) {
	let s = String(sanitized ?? "");
	if (!s) return "";

	if (scale <= 0) {
		const intOnly = s.replace(/\./g, "");
		const cappedInt = intOnly.slice(0, UDQI_INT_MAX_DIGITS);
		return capText(cappedInt, hardCap);
	}

	if (s.includes(".")) {
		const [intPartRaw, fracRaw = ""] = s.split(".");
		const intPart = intPartRaw.slice(0, UDQI_INT_MAX_DIGITS);
		const frac = fracRaw.slice(0, Math.max(0, Math.trunc(scale)));
		return capText(intPart + "." + frac, hardCap);
	}

	return capText(s.slice(0, UDQI_INT_MAX_DIGITS), hardCap);
}

function formatZeroPlaceholder(scale: number): string {
	const s = Math.max(0, Math.trunc(Number(scale) || 0));
	if (s <= 0) return "0";
	return "0." + "0".repeat(s);
}

function buildUnitPrecisionHelper(scale: number, unitToken: string) {
	if (scale <= 0) return `Whole numbers only (${unitToken}).`;
	if (scale === 1) return `Up to 1 decimal place (${unitToken}).`;
	return `Up to ${scale} decimal places (${unitToken}).`;
}

function normalizeQuantityForComparison(raw: string, scale: number): string {
	const value = raw.trim();
	if (!value) return "";
	if (!DECIMAL_PATTERN.test(value)) return value;
	const [intPartRaw, fracRaw = ""] = value.split(".");
	const intPart = intPartRaw || "0";
	if (scale <= 0) return intPart;
	const frac = (fracRaw + "0".repeat(scale)).slice(0, scale);
	return `${intPart}.${frac}`;
}

function normalizeQuantityForBlur(raw: string, scale: number, hardCap: number) {
	const sanitized = sanitizeQuantityInput(raw, scale);
	const capped = enforceUdiqCaps(sanitized, scale, hardCap);
	const trimmed = capped.trim();
	if (!trimmed || trimmed === "." || trimmed === "-") return "";
	const normalized = normalizeQuantityForSubmit(capped, scale);
	if (!normalized.ok) return capped;
	return normalized.value ?? "";
}

function normalizeQuantityForSubmit(
	raw: string,
	scale: number,
): { ok: true; value: string | null } | { ok: false; message: string } {
	const s0 = String(raw ?? "").trim();
	if (!s0) return { ok: true, value: null };

	if (/[eE,]/.test(s0)) return { ok: false, message: "Invalid number format." };
	if (!/^\d+(\.\d*)?$/.test(s0)) return { ok: false, message: "Enter a valid quantity." };
	if (s0.endsWith(".")) return { ok: false, message: "Quantity cannot end with a decimal point." };

	const sc = Math.max(0, Math.trunc(Number(scale) || 0));

	if (sc <= 0) {
		return { ok: true, value: s0.replace(/\./g, "") };
	}

	const [intRaw, fracRaw = ""] = s0.split(".");
	if (fracRaw.length > sc) return { ok: false, message: `Max ${sc} decimals for this unit.` };

	const intPart = intRaw.length ? intRaw : "0";
	const frac = (fracRaw + "0".repeat(sc)).slice(0, sc);
	return { ok: true, value: `${intPart}.${frac}` };
}

function extractApiErrorMessage(err: unknown): string {
	const data = (err as any)?.response?.data;
	const code = data?.code ?? data?.errorCode ?? data?.error?.code ?? data?.data?.code;
	if (code === "PRODUCT_CODE_CONFLICT") return "SKU or barcode already exists for this business.";
	if (code === "QUANTITY_PRECISION_INVALID") return "Reorder point has too many decimal places for the selected unit.";
	const msg = data?.message ?? data?.error?.message ?? (err as any)?.message ?? "Failed to save item.";
	return String(msg);
}

function deriveTileSnapshot(product: InventoryProductDetail | null): {
	tileMode: "IMAGE" | "COLOR";
	tileColor: string | null;
	tileLabel: string;
} {
	const p: any = product ?? null;
	const rawMode = String(p?.posTileMode ?? "")
		.trim()
		.toUpperCase();
	const hasRemoteTileImage = typeof p?.primaryImageUrl === "string" && p.primaryImageUrl.trim().length > 0;
	const tileMode =
		rawMode === "IMAGE" ? "IMAGE" : rawMode === "COLOR" ? "COLOR" : hasRemoteTileImage ? "IMAGE" : "COLOR";
	const posTileNode = p?.posTile && typeof p.posTile === "object" ? p.posTile : null;
	const tileLabel = sanitizeLabelInput(
		typeof p?.posTileLabel === "string"
			? p.posTileLabel
			: typeof p?.tileLabel === "string"
				? p.tileLabel
				: typeof p?.posTileTitle === "string"
					? p.posTileTitle
					: typeof p?.tileTitle === "string"
						? p.tileTitle
						: typeof p?.posTileName === "string"
							? p.posTileName
							: typeof posTileNode?.label === "string"
								? posTileNode.label
								: typeof posTileNode?.name === "string"
									? posTileNode.name
									: typeof posTileNode?.title === "string"
										? posTileNode.title
										: "",
	).trim();
	const tileColor =
		typeof p?.posTileColor === "string" && p.posTileColor.trim().length > 0 ? p.posTileColor.trim() : null;

	return { tileMode, tileColor, tileLabel };
}

export default function InventoryProductEditScreen({ routeScope = "inventory" }: { routeScope?: InventoryRouteScope }) {
	const router = useRouter();
	const theme = useTheme();
	const qc = useQueryClient();
	const { currencyCode } = useActiveBusinessMeta();
	const { withBusy, busy } = useAppBusy();
	const toScopedRoute = useCallback((route: string) => mapInventoryRouteToScope(route, routeScope), [routeScope]);
	const rootRoute = useMemo(() => inventoryScopeRoot(routeScope), [routeScope]);

	const params = useLocalSearchParams<Params>();
	const productId = useMemo(() => String(params.id ?? "").trim(), [params.id]);
	const [draftId] = useState(() => {
		const fromTile = String((params as any)?.[POS_TILE_DRAFT_ID_KEY] ?? "").trim();
		if (fromTile) return fromTile;
		if (productId) return `item_edit_${productId}`;
		return `item_edit_${Date.now()}`;
	});
	const routeDraftIdParam = useMemo(() => String((params as any)?.[POS_TILE_DRAFT_ID_KEY] ?? "").trim(), [params]);
	const hasRouteDraftIdParam = routeDraftIdParam.length > 0;
	const { draft: mediaDraft, patch: patchMediaDraft } = useProductCreateDraft(draftId);
	const rawReturnTo = params[DETAIL_RETURN_TO_KEY];
	const detailRoute = useMemo(
		() =>
			productId
				? toScopedRoute(`/(app)/(tabs)/inventory/products/${encodeURIComponent(productId)}` as const)
				: rootRoute,
		[productId, rootRoute, toScopedRoute],
	);
	const thisRoute = useMemo(() => `${detailRoute}/edit`, [detailRoute]);
	const scanRoute = useMemo(() => toScopedRoute(INVENTORY_SCAN_ROUTE), [toScopedRoute]);

	const [name, setName] = useState("");
	const [sku, setSku] = useState("");
	const [barcode, setBarcode] = useState("");
	const [description, setDescription] = useState("");
	const [priceText, setPriceText] = useState("");
	const [costText, setCostText] = useState("");
	const [trackInventory, setTrackInventory] = useState(true);
	const [reorderPointText, setReorderPointText] = useState("");
	const [selectedModifierGroupIds, setSelectedModifierGroupIds] = useState<string[]>([]);
	const [selectedAttributeSelections, setSelectedAttributeSelections] = useState<
		{ attributeId: string; isRequired?: boolean }[]
	>([]);
	const [baselineAttributeSelections, setBaselineAttributeSelections] = useState<
		{ attributeId: string; isRequired?: boolean }[]
	>([]);

	const [error, setError] = useState<string | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [keyboardInset, setKeyboardInset] = useState(0);

	const navLockRef = useRef(false);
	const [isNavLocked, setIsNavLocked] = useState(false);
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

	useEffect(() => {
		const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
		const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

		const showSub = Keyboard.addListener(showEvent, (event) => {
			const height = event?.endCoordinates?.height ?? 0;
			setKeyboardInset(height > 0 ? height : 0);
		});

		const hideSub = Keyboard.addListener(hideEvent, () => {
			setKeyboardInset(0);
		});

		return () => {
			showSub.remove();
			hideSub.remove();
		};
	}, []);

	const query = useQuery<InventoryProductDetail>({
		queryKey: inventoryKeys.productDetail(productId),
		queryFn: () => inventoryApi.getProductDetail(productId),
		enabled: !!productId,
		staleTime: 30_000,
	});

	const product = query.data ?? null;
	const baselineTileSnapshot = useMemo(() => deriveTileSnapshot(product), [product]);
	const qtyMaxLen = HARD_QTY_CAP;
	const mediaDraftTileLabelTouched = Boolean(mediaDraft.posTileLabelTouched);
	const unitPrecisionScaleRaw = product?.unitPrecisionScale;
	const unitPrecisionScaleFromUnit = (product as any)?.unit?.precisionScale;
	const precisionScale = useMemo(
		() => clampPrecisionScale(unitPrecisionScaleRaw ?? unitPrecisionScaleFromUnit ?? 0),
		[unitPrecisionScaleRaw, unitPrecisionScaleFromUnit],
	);
	const quantityKeyboardType = useMemo(() => {
		return precisionScale > 0 ? ("decimal-pad" as const) : ("number-pad" as const);
	}, [precisionScale]);
	const unitTokenForHelper = useMemo(() => {
		const category = String(product?.unitCategory ?? (product as any)?.unit?.category ?? "COUNT");
		const abbr = toTrimmedString(product?.unitAbbreviation ?? (product as any)?.unit?.abbreviation);
		const name = toTrimmedString(product?.unitName ?? (product as any)?.unit?.name);
		if (category === "COUNT") return COUNT_DISPLAY_ABBR;
		if (abbr) return abbr;
		return name || "unit";
	}, [product]);
	const precisionHelperText = useMemo(
		() => buildUnitPrecisionHelper(precisionScale, unitTokenForHelper),
		[precisionScale, unitTokenForHelper],
	);
	const quantityPlaceholder = useMemo(() => formatZeroPlaceholder(precisionScale), [precisionScale]);

	const baseline = useMemo(() => {
		if (!product) return null;
		const reorderRaw = toTrimmedString(product.reorderPointRaw ?? product.reorderPoint);
		const baselineModifierGroupIds = Array.isArray(product.modifierGroupIds)
			? product.modifierGroupIds.map((id) => String(id ?? "").trim()).filter(Boolean)
			: [];
		return {
			name: sanitizeProductNameInput(toTrimmedString(product.name)),
			sku: sanitizeSkuInput(toTrimmedString(product.sku)),
			barcode: sanitizeGtinInput(toTrimmedString(product.barcode)),
			description: sanitizeDescriptionInput(toTrimmedString(product.description)),
			price: sanitizeMoneyInput(toMoneyText(product.price)),
			cost: sanitizeMoneyInput(toMoneyText(product.cost)),
			trackInventory: Boolean(product.trackInventory),
			reorderPoint: normalizeQuantityForComparison(reorderRaw, precisionScale),
			tileMode: baselineTileSnapshot.tileMode,
			tileColor: baselineTileSnapshot.tileColor,
			tileLabel: baselineTileSnapshot.tileLabel,
			modifierGroupIds: baselineModifierGroupIds,
			attributeSelections: baselineAttributeSelections,
		};
	}, [
		baselineTileSnapshot.tileColor,
		baselineTileSnapshot.tileLabel,
		baselineTileSnapshot.tileMode,
		precisionScale,
		product,
		baselineAttributeSelections,
	]);
	const isMediaDraftPristine = useMemo(() => {
		const draftImage = String(mediaDraft.imageLocalUri ?? "").trim();
		const draftLabel = String(mediaDraft.posTileLabel ?? "").trim();
		const draftMode = mediaDraft.posTileMode === "IMAGE" ? "IMAGE" : "COLOR";
		const draftColor = typeof mediaDraft.posTileColor === "string" ? mediaDraft.posTileColor.trim() : "";
		return !draftImage && !draftLabel && !mediaDraftTileLabelTouched && draftMode === "COLOR" && !draftColor;
	}, [
		mediaDraft.imageLocalUri,
		mediaDraft.posTileColor,
		mediaDraft.posTileLabel,
		mediaDraft.posTileMode,
		mediaDraftTileLabelTouched,
	]);

	useEffect(() => {
		if (!product || !baseline) return;
		setName(baseline.name);
		setSku(baseline.sku);
		setBarcode(baseline.barcode);
		setDescription(baseline.description);
		setPriceText(baseline.price);
		setCostText(baseline.cost);
		setTrackInventory(baseline.trackInventory);
		setReorderPointText(baseline.reorderPoint);
		setSelectedModifierGroupIds(baseline.modifierGroupIds);
		setSelectedAttributeSelections(baseline.attributeSelections);
		setError(null);
		const shouldSeedMediaFromBaseline = !hasRouteDraftIdParam || isMediaDraftPristine;
		if (!shouldSeedMediaFromBaseline) return;
		patchMediaDraft({
			posTileMode: baselineTileSnapshot.tileMode,
			posTileColor: baselineTileSnapshot.tileColor,
			posTileLabel: baselineTileSnapshot.tileLabel,
			posTileLabelTouched: false,
			imageLocalUri: "",
		});
	}, [
		baseline,
		baselineTileSnapshot.tileColor,
		baselineTileSnapshot.tileLabel,
		baselineTileSnapshot.tileMode,
		hasRouteDraftIdParam,
		isMediaDraftPristine,
		patchMediaDraft,
		product,
	]);

	useEffect(() => {
		if (!productId) return;
		attributesApi
			.getProductAttributes(productId)
			.then((items) => {
				const next = (items ?? []).map((entry) => ({ attributeId: entry.attributeId, isRequired: entry.isRequired }));
				setBaselineAttributeSelections(next);
				setSelectedAttributeSelections(next);
			})
			.catch(() => undefined);
	}, [productId]);

	const attributeSelectionFromParams = useMemo(
		() => decodeAttributeSelections((params as any)?.[ATTRIBUTE_SELECTIONS_KEY]),
		[params],
	);

	useEffect(() => {
		if ((params as any)?.[ATTRIBUTE_SELECTIONS_KEY] === undefined) return;
		setSelectedAttributeSelections(attributeSelectionFromParams);
		(router as any).setParams?.({ [ATTRIBUTE_SELECTIONS_KEY]: undefined });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [attributeSelectionFromParams.map((entry) => `${entry.attributeId}:${entry.isRequired ? 1 : 0}`).join("|")]);

	useEffect(() => {
		if (!product) return;
		if (mediaDraftTileLabelTouched) return;
		const existingDraftLabel = sanitizeLabelInput(mediaDraft.posTileLabel ?? "").trim();
		const baselineLabel = baselineTileSnapshot.tileLabel;
		if (existingDraftLabel.length > 0 || baselineLabel.length === 0) return;
		patchMediaDraft({ posTileLabel: baselineLabel });
	}, [baselineTileSnapshot.tileLabel, mediaDraft.posTileLabel, mediaDraftTileLabelTouched, patchMediaDraft, product]);

	useEffect(() => {
		const raw =
			typeof (params as any)?.[SCANNED_BARCODE_KEY] === "string" ? String((params as any)[SCANNED_BARCODE_KEY]) : "";
		const value = sanitizeGtinInput(raw).trim();
		if (!value) return;
		setBarcode(value);
		setError(null);
		(router as any).setParams?.({
			[SCANNED_BARCODE_KEY]: undefined,
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [(params as any)?.[SCANNED_BARCODE_KEY]]);

	const remoteImageUri = useMemo(() => {
		const raw = typeof (product as any)?.primaryImageUrl === "string" ? (product as any).primaryImageUrl.trim() : "";
		return raw;
	}, [product]);
	const localImageUri = useMemo(() => String(mediaDraft.imageLocalUri ?? "").trim(), [mediaDraft.imageLocalUri]);
	const tileMode = mediaDraft.posTileMode === "IMAGE" ? "IMAGE" : "COLOR";
	const selectedTileColor =
		typeof mediaDraft.posTileColor === "string" && mediaDraft.posTileColor.trim().length > 0
			? mediaDraft.posTileColor.trim()
			: null;
	const tileColor = selectedTileColor ?? DEFAULT_ITEM_TILE_COLOR;
	const previewImageUri = localImageUri || (tileMode === "IMAGE" ? remoteImageUri : "");
	const previewHasImage = tileMode === "IMAGE" && !!previewImageUri;
	const draftTileLabel = useMemo(
		() => sanitizeLabelInput(mediaDraft.posTileLabel ?? "").trim(),
		[mediaDraft.posTileLabel],
	);
	const linkedTileLabelForEditor = useMemo(() => {
		return draftTileLabel || baselineTileSnapshot.tileLabel;
	}, [baselineTileSnapshot.tileLabel, draftTileLabel]);
	const tileLabel = useMemo(() => {
		if (draftTileLabel.length > 0) return draftTileLabel;
		if (baselineTileSnapshot.tileLabel.length > 0) return baselineTileSnapshot.tileLabel;
		return "";
	}, [baselineTileSnapshot.tileLabel, draftTileLabel]);
	const itemName = useMemo(() => sanitizeProductNameInput(name).trim(), [name]);
	const hasLabel = tileLabel.length > 0;
	const hasItemName = itemName.length > 0;
	const hasColor = tileMode === "COLOR" && !!selectedTileColor;
	const hasVisualTile = previewHasImage || hasColor;
	const shouldShowEmpty = !hasVisualTile;
	const shouldShowTileTextOverlay = hasVisualTile && (hasLabel || hasItemName);
	const tileLabelColor = "#FFFFFF";

	const isArchived = !!product && product.isActive === false;
	const isBusy = !!busy?.isBusy || isSubmitting;
	const isUiDisabled = isBusy || isNavLocked;

	const nameCheck = useMemo(() => {
		const value = sanitizeProductNameInput(name).trim();
		if (!value) return { ok: false, message: "Item name is required." };
		if (value.length < FIELD_LIMITS.productNameMin) {
			return { ok: false, message: `Item name must be at least ${FIELD_LIMITS.productNameMin} characters.` };
		}
		if (value.length > FIELD_LIMITS.productName) {
			return { ok: false, message: `Item name must be ${FIELD_LIMITS.productName} characters or less.` };
		}
		return { ok: true, value };
	}, [name]);

	const reorderCheck = useMemo(() => {
		if (!trackInventory) return { ok: true as const, value: null as string | null };
		return normalizeQuantityForSubmit(reorderPointText, precisionScale);
	}, [precisionScale, reorderPointText, trackInventory]);

	const currentSnapshot = useMemo(() => {
		return {
			name: sanitizeProductNameInput(name).trim(),
			sku: sanitizeSkuInput(sku).trim(),
			barcode: sanitizeGtinInput(barcode).trim(),
			description: sanitizeDescriptionInput(description).trim(),
			price: sanitizeMoneyInput(priceText).trim(),
			cost: sanitizeMoneyInput(costText).trim(),
			trackInventory,
			reorderPoint: trackInventory
				? normalizeQuantityForComparison(
						enforceUdiqCaps(sanitizeQuantityInput(reorderPointText, precisionScale), precisionScale, qtyMaxLen),
						precisionScale,
					)
				: "",
			tileMode,
			tileColor: selectedTileColor,
			tileLabel,
			modifierGroupIds: selectedModifierGroupIds,
			attributeSelections: selectedAttributeSelections,
		};
	}, [
		selectedAttributeSelections,
		selectedModifierGroupIds,
		tileLabel,
		tileMode,
		costText,
		description,
		name,
		precisionScale,
		priceText,
		reorderPointText,
		selectedTileColor,
		sku,
		trackInventory,
		barcode,
		qtyMaxLen,
	]);

	const hasChanges = useMemo(() => {
		if (!baseline) return false;
		return (
			currentSnapshot.name !== baseline.name ||
			currentSnapshot.sku !== baseline.sku ||
			currentSnapshot.barcode !== baseline.barcode ||
			currentSnapshot.description !== baseline.description ||
			currentSnapshot.price !== baseline.price ||
			currentSnapshot.cost !== baseline.cost ||
			currentSnapshot.trackInventory !== baseline.trackInventory ||
			currentSnapshot.reorderPoint !== baseline.reorderPoint ||
			currentSnapshot.modifierGroupIds.join("|") !== baseline.modifierGroupIds.join("|") ||
			currentSnapshot.attributeSelections
				.map((entry) => `${entry.attributeId}:${entry.isRequired ? 1 : 0}`)
				.join("|") !==
				baseline.attributeSelections.map((entry) => `${entry.attributeId}:${entry.isRequired ? 1 : 0}`).join("|") ||
			currentSnapshot.tileMode !== baseline.tileMode ||
			currentSnapshot.tileColor !== baseline.tileColor ||
			currentSnapshot.tileLabel !== baseline.tileLabel ||
			localImageUri.length > 0
		);
	}, [baseline, currentSnapshot, localImageUri.length]);

	const canSave = useMemo(() => {
		if (!productId || !product || isArchived) return false;
		if (!nameCheck.ok) return false;
		if (!reorderCheck.ok) return false;
		if (!hasChanges) return false;
		return !isUiDisabled;
	}, [hasChanges, isArchived, isUiDisabled, nameCheck.ok, product, productId, reorderCheck.ok]);

	const onExit = useCallback(() => {
		runGovernedProcessExit(rawReturnTo, detailRoute, {
			router: router as any,
			lockNav,
			disabled: isUiDisabled,
		});
	}, [detailRoute, isUiDisabled, lockNav, rawReturnTo, router]);
	const guardedOnExit = useProcessExitGuard(onExit);

	const openTileEditor = useCallback(() => {
		if (isUiDisabled) return;
		if (!lockNav()) return;
		patchMediaDraft({
			posTileMode: tileMode,
			posTileColor: selectedTileColor,
			posTileLabel: linkedTileLabelForEditor,
			posTileLabelTouched: mediaDraftTileLabelTouched,
			imageLocalUri: localImageUri,
		});
		router.push({
			pathname: toScopedRoute(POS_TILE_ROUTE) as any,
			params: {
				[POS_TILE_DRAFT_ID_KEY]: draftId,
				[POS_TILE_ROOT_RETURN_TO_KEY]: thisRoute,
				...(linkedTileLabelForEditor ? { [POS_TILE_TILE_LABEL_KEY]: linkedTileLabelForEditor } : {}),
				id: productId,
			} as any,
		});
	}, [
		draftId,
		isUiDisabled,
		lockNav,
		localImageUri,
		mediaDraftTileLabelTouched,
		patchMediaDraft,
		productId,
		router,
		selectedTileColor,
		thisRoute,
		linkedTileLabelForEditor,
		tileMode,
		toScopedRoute,
	]);

	const onOpenBarcodeScanner = useCallback(() => {
		if (isUiDisabled || isArchived) return;
		if (!lockNav()) return;
		setError(null);
		router.push({
			pathname: scanRoute as any,
			params: {
				returnTo: thisRoute,
				draftId,
			},
		});
	}, [draftId, isArchived, isUiDisabled, lockNav, router, scanRoute, thisRoute]);

	const openAttributePicker = useCallback(() => {
		if (isUiDisabled || isArchived) return;
		if (!lockNav()) return;
		router.replace({
			pathname: toScopedRoute(ATTRIBUTE_PICKER_ROUTE) as any,
			params: {
				[ATTRIBUTE_RETURN_TO_KEY]: thisRoute,
				...buildAttributeSelectionParams({
					selectedAttributes: selectedAttributeSelections,
					draftId,
				}),
			} as any,
		});
	}, [draftId, isArchived, isUiDisabled, lockNav, router, selectedAttributeSelections, thisRoute, toScopedRoute]);

	const onSave = useCallback(async () => {
		if (!canSave || !productId || !product) return;
		if (!lockNav()) return;

		if (!nameCheck.ok) {
			setError(nameCheck.message ?? "Item name is invalid.");
			return;
		}

		const priceNum = currentSnapshot.price ? Number(currentSnapshot.price) : null;
		const costNum = currentSnapshot.cost ? Number(currentSnapshot.cost) : null;
		if (priceNum != null && costNum != null && costNum > priceNum) {
			setError("Cost cannot exceed price.");
			return;
		}
		const gtinValidation = validateGtinValue(currentSnapshot.barcode);
		if (!gtinValidation.ok) {
			setError(gtinValidation.message);
			return;
		}

		if (!reorderCheck.ok) {
			setError(reorderCheck.message ?? "Reorder point is invalid.");
			return;
		}

		const payload: UpdateProductInput = {
			name: nameCheck.value,
			sku: currentSnapshot.sku || null,
			barcode: currentSnapshot.barcode || null,
			description: currentSnapshot.description || null,
			price: priceNum,
			cost: costNum,
			trackInventory: currentSnapshot.trackInventory,
			reorderPoint: currentSnapshot.trackInventory ? reorderCheck.value : null,
			modifierGroupIds: currentSnapshot.modifierGroupIds,
		};
		const imageUriForUpload = tileMode === "IMAGE" ? localImageUri : "";

		setError(null);
		setIsSubmitting(true);

		await withBusy("Saving item...", async () => {
			try {
				await inventoryApi.updateProduct(productId, {
					...(payload as any),
					posTileMode: tileMode,
					posTileColor: selectedTileColor,
					posTileLabel: tileLabel.length > 0 ? tileLabel : null,
				} as any);

				await attributesApi.replaceProductAttributes(productId, {
					attributes: currentSnapshot.attributeSelections.map((entry) => ({
						attributeId: entry.attributeId,
						isRequired: entry.isRequired,
					})),
				});
				await qc.invalidateQueries({ queryKey: attributesKeys.all });
				await qc.invalidateQueries({ queryKey: attributesKeys.product(productId) });

				if (imageUriForUpload) {
					try {
						await uploadProductImage({
							imageKind: "PRIMARY_POS_TILE",
							localUri: imageUriForUpload,
							productId,
							isPrimary: true,
							sortOrder: 0,
						});
					} catch (uploadErr) {
						const domainErr = toMediaDomainError(uploadErr);
						setError(domainErr.message || "Item saved, but the tile image failed to upload.");
						return;
					}
				}

				invalidateInventoryAfterMutation(qc, { productId });
				await Promise.all([
					qc.invalidateQueries({ queryKey: inventoryKeys.all }),
					qc.invalidateQueries({ queryKey: catalogKeys.all }),
					qc.invalidateQueries({ queryKey: ["pos", "catalog", "products"] }),
				]);
				router.replace({
					pathname: toScopedRoute("/(app)/(tabs)/inventory/products/[id]") as any,
					params: {
						id: productId,
						[DETAIL_RETURN_TO_KEY]: rootRoute,
						[DETAIL_FROM_SAVE_KEY]: "1",
					},
				} as any);
			} catch (e) {
				setError(extractApiErrorMessage(e));
			} finally {
				setIsSubmitting(false);
			}
		});
	}, [
		canSave,
		currentSnapshot.barcode,
		currentSnapshot.cost,
		currentSnapshot.description,
		currentSnapshot.modifierGroupIds,
		currentSnapshot.attributeSelections,
		currentSnapshot.price,
		currentSnapshot.sku,
		currentSnapshot.trackInventory,
		lockNav,
		nameCheck,
		product,
		productId,
		qc,
		selectedTileColor,
		localImageUri,
		reorderCheck,
		router,
		rootRoute,
		tileLabel,
		tileMode,
		toScopedRoute,
		withBusy,
	]);

	const borderColor = theme.colors.outlineVariant ?? theme.colors.outline;
	const headerOptions = useInventoryHeader("process", {
		title: "Edit Item",
		disabled: isUiDisabled,
		onExit: guardedOnExit,
		exitFallbackRoute: detailRoute,
	});
	const cardBottomPadding = useMemo(() => {
		if (keyboardInset <= 0) return styles.formContainer.paddingBottom;
		const keyboardLiftPad = Math.max(260, Math.min(520, Math.round(keyboardInset + 220)));
		return styles.formContainer.paddingBottom + keyboardLiftPad;
	}, [keyboardInset]);
	const dismissKeyboard = useCallback(() => {
		Keyboard.dismiss();
	}, []);
	const tabBarHeight = useBottomTabBarHeight();
	const screenBottomPad = tabBarHeight + 12;

	return (
		<>
			<Stack.Screen
				options={{
					...headerOptions,
					headerShadowVisible: false,
				}}
			/>
			<BAIScreen padded={false} safeTop={false} safeBottom={false} style={styles.root}>
				<TouchableWithoutFeedback onPress={dismissKeyboard} accessible={false}>
					<View style={styles.keyboardContent}>
						<View
							style={[
								styles.screen,
								styles.scroll,
								{ backgroundColor: theme.colors.background, paddingBottom: screenBottomPad },
							]}
						>
							{query.isLoading ? (
								<BAISurface style={[styles.banner, { borderColor }]} padded bordered>
									<BAIText variant='caption' muted>
										Loading item...
									</BAIText>
								</BAISurface>
							) : null}

							{query.isError ? (
								<BAISurface style={[styles.banner, { borderColor }]} padded bordered>
									<BAIText variant='caption' muted>
										Could not load item details.
									</BAIText>
									<View style={{ height: 12 }} />
									<BAIRetryButton variant='outline' onPress={() => query.refetch()} disabled={isUiDisabled}>
										Retry
									</BAIRetryButton>
								</BAISurface>
							) : null}

							{!query.isLoading && !query.isError && !product ? (
								<BAISurface style={[styles.banner, { borderColor }]} padded bordered>
									<BAIText variant='caption' muted>
										Item not found.
									</BAIText>
									<View style={{ height: 12 }} />
									<BAIButton
										variant='outline'
										intent='neutral'
										shape='pill'
										widthPreset='standard'
										onPress={guardedOnExit}
										disabled={isUiDisabled}
									>
										Cancel
									</BAIButton>
								</BAISurface>
							) : null}

							{product ? (
								<BAISurface style={[styles.card, { borderColor }]} padded={false}>
									<View style={[styles.cardHeader, { borderBottomColor: borderColor }]}>
										<BAIText variant='title'>Edit Item</BAIText>
									</View>

									<ScrollView
										style={styles.formScroll}
										contentContainerStyle={[styles.formContainer, { paddingBottom: cardBottomPadding }]}
										showsHorizontalScrollIndicator={false}
										showsVerticalScrollIndicator={false}
										keyboardShouldPersistTaps='handled'
										keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
										onScrollBeginDrag={dismissKeyboard}
									>
										{isArchived ? (
											<BAISurface style={[styles.notice, { borderColor }]} padded bordered>
												<BAIText variant='caption' muted>
													Archived items are read-only. Restore this item in item details to make changes.
												</BAIText>
											</BAISurface>
										) : null}

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
													{previewHasImage ? (
														<Image
															source={{ uri: previewImageUri }}
															style={styles.imagePreviewImage}
															resizeMode='cover'
														/>
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
														<PosTileTextOverlay label={tileLabel} name={itemName} textColor={tileLabelColor} />
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
														disabled={isUiDisabled || isArchived}
														style={styles.barcodeIconButtonLarge}
													/>
													<BAIIconButton
														variant='outlined'
														size='md'
														icon='camera'
														iconSize={34}
														accessibilityLabel='Edit image'
														onPress={openTileEditor}
														disabled={isUiDisabled || isArchived}
														style={styles.imageEditButtonOutside}
													/>
												</View>
											</View>
										</View>

										<BAITextInput
											label='Name'
											value={name}
											onChangeText={(t) => setName(sanitizeProductNameDraftInput(t))}
											onBlur={() => {
												if (isUiDisabled || isArchived) return;
												setName((prev) => sanitizeProductNameInput(prev));
											}}
											maxLength={FIELD_LIMITS.productName}
											placeholder='e.g. Iced Latte'
											disabled={isUiDisabled || isArchived}
										/>
										{name.trim().length > 0 && !nameCheck.ok ? (
											<BAIText variant='caption' style={{ color: theme.colors.error }}>
												{nameCheck.message}
											</BAIText>
										) : null}

										<BAITextarea
											label='Description (optional)'
											value={description}
											onChangeText={(t) => setDescription(sanitizeDescriptionDraftInput(t))}
											onBlur={() => {
												if (isUiDisabled) return;
												setDescription((prev) => sanitizeDescriptionInput(prev));
											}}
											maxLength={FIELD_LIMITS.productDescription}
											visibleLines={3}
											minHeight={88}
											maxHeight={180}
											placeholder='Optional description…'
											disabled={isUiDisabled || isArchived}
										/>

										<BAITextInput
											label='GTIN (Barcode)'
											value={barcode}
											onChangeText={(t) => setBarcode(sanitizeGtinInput(t))}
											maxLength={GTIN_MAX_LENGTH}
											placeholder='Scan or enter UPC / EAN / ISBN'
											keyboardType='number-pad'
											disabled={isUiDisabled || isArchived}
										/>

										<BAITextInput
											label='SKU is auto-generated if left blank'
											value={sku}
											onChangeText={(t) => setSku(sanitizeSkuInput(t))}
											maxLength={FIELD_LIMITS.sku}
											placeholder='Optional'
											disabled={isUiDisabled || isArchived}
										/>

										{routeScope === "inventory" ? (
											<ModifierGroupSelector
												selectedIds={selectedModifierGroupIds}
												onChange={setSelectedModifierGroupIds}
												disabled={isUiDisabled || isArchived}
											/>
										) : null}

										<BAIPressableRow
											label='Attributes'
											value={
												selectedAttributeSelections.length > 0
													? `${selectedAttributeSelections.length} selected`
													: "None"
											}
											onPress={openAttributePicker}
											disabled={isUiDisabled || isArchived}
										/>

										<View style={{ height: 12 }} />

										<BAIText variant='subtitle'>Pricing</BAIText>

										<BAIMinorMoneyInput
											label='Price'
											value={priceText}
											onChangeText={setPriceText}
											currencyCode={currencyCode}
											maxMinorDigits={11}
											style={styles.moneyHalfInput}
											contentStyle={styles.moneyValueInputContent}
											disabled={isUiDisabled || isArchived}
										/>

										<BAIMinorMoneyInput
											label='Cost (optional)'
											value={costText}
											onChangeText={setCostText}
											currencyCode={currencyCode}
											maxMinorDigits={11}
											style={styles.moneyHalfInput}
											contentStyle={styles.moneyValueInputContent}
											disabled={isUiDisabled || isArchived}
										/>

										<View style={{ height: 6 }} />

										<BAIText variant='subtitle' style={{ marginBottom: 6 }}>
											Inventory
										</BAIText>

										<BAISwitchRow
											style={{ marginBottom: 6 }}
											switchVariant='blue'
											label='Track inventory'
											description='If off, this item will not affect stock counts.'
											value={trackInventory}
											onValueChange={(next) => setTrackInventory(next)}
											disabled={isUiDisabled || isArchived}
										/>

										{trackInventory ? (
											<>
												<BAITextInput
													label='Reorder point (optional)'
													value={reorderPointText}
													onChangeText={(t) => {
														const s0 = sanitizeQuantityInput(t, precisionScale);
														const s1 = enforceUdiqCaps(s0, precisionScale, qtyMaxLen);
														setReorderPointText(s1);
													}}
													onBlur={() => {
														if (isUiDisabled) return;
														setReorderPointText((prev) => normalizeQuantityForBlur(prev, precisionScale, qtyMaxLen));
													}}
													maxLength={qtyMaxLen}
													keyboardType={quantityKeyboardType}
													placeholder={quantityPlaceholder}
													disabled={isUiDisabled || isArchived}
													{...({ helperText: precisionHelperText } as any)}
												/>
												{!reorderCheck.ok ? (
													<BAIText variant='caption' style={{ color: theme.colors.error }}>
														{reorderCheck.message}
													</BAIText>
												) : null}
											</>
										) : null}

										{error ? (
											<BAIText variant='caption' style={{ color: theme.colors.error }}>
												{error}
											</BAIText>
										) : null}

										<View style={styles.actions}>
											<BAICTAPillButton
												variant='outline'
												intent='neutral'
												onPress={guardedOnExit}
												disabled={isUiDisabled}
												style={{ flex: 1 }}
											>
												Cancel
											</BAICTAPillButton>
											<BAICTAPillButton
												variant='solid'
												onPress={onSave}
												disabled={!canSave || isArchived}
												style={{ flex: 1 }}
											>
												Save
											</BAICTAPillButton>
										</View>
									</ScrollView>
								</BAISurface>
							) : null}
						</View>
					</View>
				</TouchableWithoutFeedback>
			</BAIScreen>
		</>
	);
}

const styles = StyleSheet.create({
	root: { flex: 1 },
	keyboardContent: { flex: 1 },
	screen: { paddingHorizontal: 12, paddingBottom: 0 },
	scroll: { flex: 1 },
	card: {
		flex: 1,
		minHeight: 0,
		borderWidth: 1,
		borderRadius: 24,
		gap: 6,
		paddingHorizontal: 0,
		paddingTop: 12,
		paddingBottom: 0,
	},
	cardHeader: {
		paddingHorizontal: 14,
		paddingBottom: 10,
		marginBottom: 0,
		borderBottomWidth: StyleSheet.hairlineWidth,
	},
	formScroll: {
		flex: 1,
	},
	formContainer: {
		paddingHorizontal: 14,
		paddingBottom: 220,
	},
	moneyHalfInput: {
		width: "50%",
		alignSelf: "flex-start",
	},
	moneyValueInputContent: {
		paddingLeft: 16,
		paddingRight: 20,
	},
	banner: { borderRadius: 16, gap: 10 },
	notice: { borderRadius: 12 },
	imageSection: {
		alignItems: "center",
		gap: 10,
		marginBottom: 16,
		marginTop: 6,
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
		gap: 10,
		marginTop: 10,
	},
});
