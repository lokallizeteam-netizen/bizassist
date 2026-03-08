// BizAssist_mobile
// path: app/(app)/(tabs)/pos/pos.tablet.tsx
//
// Tablet POS v1 (two-pane shell)
//
// Governance:
// - Tablet is the primary operational POS surface.
// - No double taps: useNavLock gate + disabled states.
// - Checkout is a critical operation: must use global Busy overlay.
// - No cross-workspace stack pushing: when switching to Inventory, use router.replace.
// - No UI/layout changes (keep the current two-pane POS composition).

import { useMutation, useQuery } from "@tanstack/react-query";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	FlatList,
	Keyboard,
	Pressable,
	RefreshControl,
	StyleSheet,
	TouchableWithoutFeedback,
	View,
} from "react-native";
import { useTheme } from "react-native-paper";

import { BAIButton } from "@/components/ui/BAIButton";
import { BAICTAButton } from "@/components/ui/BAICTAButton";
import { BAIGroupTabs } from "@/components/ui/BAIGroupTabs";
import { BAISearchWithScanButton } from "@/components/ui/BAISearchWithScanButton";
import { BAIScreen } from "@/components/ui/BAIScreen";
import { BAISurface } from "@/components/ui/BAISurface";
import { BAIText } from "@/components/ui/BAIText";

import { useAppBusy } from "@/hooks/useAppBusy";
import { useActiveBusinessMeta } from "@/modules/business/useActiveBusinessMeta";
import { formatCompactNumber } from "@/lib/locale/businessLocale";
import type { CatalogProduct } from "@/modules/catalog/catalog.types";
import { inventoryApi } from "@/modules/inventory/inventory.api";
import { InventoryRow } from "@/modules/inventory/InventoryRow";
import type { InventoryProduct } from "@/modules/inventory/inventory.types";
import { resolvePosStatus } from "@/modules/pos/pos.status";
import { clampQtyToStock } from "@/modules/pos/pos.stock";
import { consumePendingQuantityEdit } from "@/modules/pos/pos.quantityEditStore";
import { FIELD_LIMITS } from "@/shared/fieldLimits";
import { sanitizeSearchInput } from "@/shared/validation/sanitize";
import {
	addQuantityMajor,
	addQuantityStep,
	clampPrecisionScale,
	fromScaledInt,
	lineTotalMinor,
	minorToDecimalString,
	normalizeQuantityString,
	toScaledInt,
} from "@/modules/pos/pos.quantity";
import { posApi } from "@/modules/pos/pos.api";
import { PosModifiersPickerSheet } from "@/modules/pos/components/PosModifiersPickerSheet";
import type { ProductModifierGroup } from "@/modules/pos/pos.api";
import { unitDisplayToken } from "@/modules/units/units.format";
import { useNavLock } from "@/shared/hooks/useNavLock";
import { formatMoney } from "@/shared/money/money.format";

type CartLine = {
	productId: string;
	name: string;
	unitPrice: string;
	quantity: string; // decimal string (UDQI)
	precisionScale: number; // 0..5
	selectedModifierOptionIds?: string[];
	totalModifiersDeltaMinor?: string;
	modifierSummary?: string;

	unitId?: string;
	unitName?: string;
	unitAbbreviation?: string;

	maxQty?: string; // decimal string
	trackInventory?: boolean;
};

type CatalogGroupTab = "ITEMS" | "SERVICES";

// POS layout + design lock (do not change without explicit approval).
export const POS_LAYOUT_LOCK = "LOCKED_V1" as const;
const POS_GUTTER = 16;
const POS_HEADER_PAD_Y = 12;
const POS_CARD_RADIUS = 12;
const POS_BORDER_WIDTH = StyleSheet.hairlineWidth;
const POS_SECTION_GAP = 12;

function formatMoneyCompact(currencyCode: string, amountRaw: string): string {
	const raw = String(amountRaw ?? "").trim() || "0";
	const compact = formatQtyDisplay(raw, 2);
	const formatted = formatMoney({ currencyCode, amount: raw });

	if (!formatted) return compact;

	const replaced = formatted.replace(/-?\d[\d,]*([.]\d+)?/, compact);
	return replaced || compact;
}

function makeIdempotencyKey(): string {
	return `pos-tablet-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function decimalToMinorUnits(raw: string): bigint {
	const value = String(raw ?? "0").trim();
	if (!value) return 0n;
	const neg = value.startsWith("-");
	const clean = neg ? value.slice(1) : value;
	const [wholeRaw, fracRaw = ""] = clean.split(".");
	const whole = wholeRaw.replace(/^0+(?=\d)/, "") || "0";
	const frac = fracRaw.replace(/\D/g, "").padEnd(2, "0").slice(0, 2);
	const minor = BigInt(`${whole}${frac}`);
	return neg ? -minor : minor;
}

function resolveCartLinePrecisionScale(product: CatalogProduct): number {
	if (product.trackInventory) return 0;

	const rawScale =
		(product as any)?.unitPrecisionScale ??
		(product as any)?.precisionScale ??
		(product as any)?.unit?.precisionScale ??
		0;

	return clampPrecisionScale(rawScale);
}

function deriveScaleFromValues(...values: (string | number | null | undefined)[]): number {
	let max = 0;
	values.forEach((v) => {
		const s = String(v ?? "");
		const idx = s.indexOf(".");
		if (idx >= 0) max = Math.max(max, s.length - idx - 1);
	});
	return clampPrecisionScale(max);
}

function subtractQuantity(
	maxRaw: string | number | null | undefined,
	qtyRaw: string | number | null | undefined,
): string {
	const scale = deriveScaleFromValues(maxRaw, qtyRaw);
	const maxNorm = normalizeQuantityString(maxRaw ?? "0", scale);
	const qtyNorm = normalizeQuantityString(qtyRaw ?? "0", scale);
	const maxScaled = toScaledInt(maxNorm, scale);
	const qtyScaled = toScaledInt(qtyNorm, scale);
	const remaining = maxScaled > qtyScaled ? maxScaled - qtyScaled : 0n;
	return fromScaledInt(remaining, scale);
}

function compareQuantity(
	aRaw: string | number | null | undefined,
	bRaw: string | number | null | undefined,
): -1 | 0 | 1 {
	const scale = deriveScaleFromValues(aRaw, bRaw);
	const aNorm = normalizeQuantityString(aRaw ?? "0", scale);
	const bNorm = normalizeQuantityString(bRaw ?? "0", scale);
	const a = toScaledInt(aNorm, scale);
	const b = toScaledInt(bNorm, scale);
	if (a === b) return 0;
	return a > b ? 1 : -1;
}

function formatQtyDisplay(raw: string, maxFrac = 2, allowCompact = true): string {
	const s = String(raw ?? "").trim();
	if (!s) return "0";
	const neg = s.startsWith("-");
	const t = neg ? s.slice(1) : s;
	const [iRaw, fRaw = ""] = t.split(".");
	let i = iRaw.replace(/^0+(?=\d)/, "") || "0";
	let f = fRaw;

	const incInt = (value: string) => {
		let carry = 1;
		const digits = value.split("").map((d) => Number(d));
		for (let idx = digits.length - 1; idx >= 0 && carry; idx--) {
			const next = digits[idx] + carry;
			if (next === 10) {
				digits[idx] = 0;
				carry = 1;
			} else {
				digits[idx] = next;
				carry = 0;
			}
		}
		if (carry) digits.unshift(1);
		return digits.join("");
	};

	const shouldCompact = i.length >= 5; // >= 10,000
	if (allowCompact && shouldCompact) {
		let unitGroups = Math.floor((i.length - 1) / 3);
		if (unitGroups > 4) unitGroups = 4;
		const suffixes = ["", "k", "M", "B", "T"] as const;
		let suffix = suffixes[unitGroups] ?? "";
		const prefixLen = i.length - unitGroups * 3;
		const digits = `${i}${f}`.padEnd(prefixLen + 2, "0");
		let whole = digits.slice(0, prefixLen) || "0";
		let dec1 = digits.slice(prefixLen, prefixLen + 1) || "0";
		const dec2 = digits.slice(prefixLen + 1, prefixLen + 2) || "0";

		if (dec2 >= "5") {
			if (dec1 === "9") {
				dec1 = "0";
				whole = incInt(whole);
			} else {
				dec1 = String(Number(dec1) + 1);
			}
		}

		if (whole.length > prefixLen) {
			const nextGroup = Math.min(unitGroups + 1, suffixes.length - 1);
			suffix = suffixes[nextGroup] ?? suffix;
			whole = "1";
			dec1 = "0";
		}

		const compact = `${neg ? "-" : ""}${whole}${dec1 !== "0" ? `.${dec1}` : ""}${suffix}`;
		return compact;
	}

	if (maxFrac <= 0) {
		if (f.length > 0 && f[0] >= "5") i = incInt(i);
		f = "";
	} else if (f.length > maxFrac) {
		const cut = f.slice(0, maxFrac);
		const nextDigit = f[maxFrac];
		let carry = nextDigit >= "5";
		const digits = cut.split("").map((d) => Number(d));
		for (let idx = digits.length - 1; idx >= 0 && carry; idx--) {
			const next = digits[idx] + 1;
			if (next === 10) {
				digits[idx] = 0;
				carry = true;
			} else {
				digits[idx] = next;
				carry = false;
			}
		}
		if (carry) i = incInt(i);
		f = digits.join("");
	}

	const fTrim = f.replace(/0+$/, "");
	const iGrouped = i.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
	return `${neg ? "-" : ""}${iGrouped}${fTrim ? `.${fTrim}` : ""}`;
}

function resolveCatalogOnHandRaw(product: CatalogProduct, inCartLine?: CartLine): string {
	const onHandRaw =
		(product as any)?.onHand ??
		(product as any)?.onHandCached ??
		(product as any)?.inventoryOnHand ??
		(product as any)?.stockOnHand ??
		"0";
	return subtractQuantity(onHandRaw, inCartLine?.quantity ?? "0");
}

function resolveCatalogStatus(product: CatalogProduct, inCartLine?: CartLine) {
	const adjustedOnHand = resolveCatalogOnHandRaw(product, inCartLine);
	const status = resolvePosStatus({ ...product, onHand: adjustedOnHand });
	return status;
}

function toPosCatalogInventoryRowItem(product: CatalogProduct, onHandRaw: string): InventoryProduct {
	const categoryName = String(product.categoryName ?? "").trim() || "None";
	const categoryId = String(product.categoryId ?? "").trim();
	const unitPrecisionScaleRaw =
		(product as any)?.unitPrecisionScale ?? (product as any)?.precisionScale ?? (product as any)?.unit?.precisionScale;
	const parsedPrice = product.price == null ? null : Number(product.price);
	const parsedCost = product.cost == null ? null : Number(product.cost);
	const durationTotalMinutes = (product as any)?.durationTotalMinutes ?? (product as any)?.serviceDurationMins ?? null;
	const durationInitialMinutes = (product as any)?.durationInitialMinutes ?? null;
	const durationProcessingMinutes = (product as any)?.durationProcessingMinutes ?? null;
	const durationFinalMinutes = (product as any)?.durationFinalMinutes ?? null;
	const processingEnabled = Boolean((product as any)?.processingEnabled);

	return {
		id: product.id,
		type: String(product.type ?? "PHYSICAL").toUpperCase() === "SERVICE" ? "SERVICE" : "PHYSICAL",
		name: product.name,
		sku: product.sku,
		barcode: product.barcode,
		price: Number.isFinite(parsedPrice) ? parsedPrice : null,
		cost: Number.isFinite(parsedCost) ? parsedCost : null,
		categoryId: product.categoryId,
		category: {
			id: categoryId || "none",
			name: categoryName,
			color: product.categoryColor,
			isActive: true,
		},
		trackInventory: !!product.trackInventory,
		durationTotalMinutes:
			durationTotalMinutes == null || !Number.isFinite(Number(durationTotalMinutes)) ? null : Number(durationTotalMinutes),
		processingEnabled,
		durationInitialMinutes:
			durationInitialMinutes == null || !Number.isFinite(Number(durationInitialMinutes))
				? null
				: Number(durationInitialMinutes),
		durationProcessingMinutes:
			durationProcessingMinutes == null || !Number.isFinite(Number(durationProcessingMinutes))
				? null
				: Number(durationProcessingMinutes),
		durationFinalMinutes:
			durationFinalMinutes == null || !Number.isFinite(Number(durationFinalMinutes)) ? null : Number(durationFinalMinutes),
		reorderPoint: product.reorderPoint == null ? null : Number(product.reorderPoint),
		reorderPointRaw: product.reorderPoint ?? undefined,
		onHandCached: Number(onHandRaw) || 0,
		onHandCachedRaw: onHandRaw,
		unitId: product.unitId ?? undefined,
		unitName: String((product as any)?.unitName ?? (product as any)?.unit?.name ?? "").trim() || undefined,
		unitAbbreviation:
			String((product as any)?.unitAbbreviation ?? (product as any)?.unit?.abbreviation ?? "").trim() || undefined,
		unitPrecisionScale: Number.isFinite(Number(unitPrecisionScaleRaw)) ? Number(unitPrecisionScaleRaw) : 0,
		primaryImageUrl: product.primaryImageUrl,
		posTileMode: product.posTileMode,
		posTileColor: product.posTileColor,
		isActive: product.isActive,
	};
}

export default function PosTablet() {
	const router = useRouter();
	const params = useLocalSearchParams<{ scannedBarcode?: string }>();
	const theme = useTheme();
	const borderColor = theme.colors.outlineVariant ?? theme.colors.outline;

	const { currencyCode, businessName, countryCode } = useActiveBusinessMeta();
	const { withBusy } = useAppBusy();

	// Primary nav safety gate (canonical hook)
	const { canNavigate, safeReplace } = useNavLock({ lockMs: 650 });

	// Local lock (belt + suspenders)
	const localNavLockRef = useRef(false);
	const lockNav = useCallback(() => {
		if (localNavLockRef.current) return false;
		localNavLockRef.current = true;
		setTimeout(() => (localNavLockRef.current = false), 650);
		return true;
	}, []);

	const disabled = !canNavigate;
	const dismissKeyboard = useCallback(() => Keyboard.dismiss(), []);

	const [q, setQ] = useState("");
	const [catalogGroup, setCatalogGroup] = useState<CatalogGroupTab>("ITEMS");
	const trimmedQ = q.trim();

	const [cart, setCart] = useState<Record<string, CartLine>>({});
	const [modifierPickerVisible, setModifierPickerVisible] = useState(false);
	const [modifierPickerProduct, setModifierPickerProduct] = useState<CatalogProduct | null>(null);
	const [modifierPickerGroups, setModifierPickerGroups] = useState<ProductModifierGroup[]>([]);
	const [loadingModifierProductId, setLoadingModifierProductId] = useState<string | null>(null);

	const productsQuery = useQuery({
		queryKey: ["pos", "catalog", "products", trimmedQ],
		queryFn: () => inventoryApi.listProducts({ q: trimmedQ || undefined, limit: 250 }),
		staleTime: 30_000,
	});

	const items = useMemo(
		() => (productsQuery.data?.items ?? []) as unknown as CatalogProduct[],
		[productsQuery.data?.items],
	);
	const productsById = useMemo(() => Object.fromEntries(items.map((p) => [p.id, p])), [items]);

	const cartLines = useMemo(() => Object.values(cart), [cart]);
	const itemCount = useMemo(() => cartLines.length, [cartLines]);
	const itemCatalogCount = useMemo(
		() => items.filter((product) => String(product.type ?? "PHYSICAL").toUpperCase() !== "SERVICE").length,
		[items],
	);
	const serviceCatalogCount = useMemo(
		() => items.filter((product) => String(product.type ?? "PHYSICAL").toUpperCase() === "SERVICE").length,
		[items],
	);
	const defaultCatalogGroup = useMemo<CatalogGroupTab>(() => {
		if (itemCatalogCount === 0 && serviceCatalogCount > 0) return "SERVICES";
		return "ITEMS";
	}, [itemCatalogCount, serviceCatalogCount]);
	const catalogGroupTabs = useMemo(
		() =>
			[
				{ label: "Items", value: "ITEMS", count: itemCatalogCount },
				{ label: "Services", value: "SERVICES", count: serviceCatalogCount },
			] as const,
		[itemCatalogCount, serviceCatalogCount],
	);
	useEffect(() => {
		setCatalogGroup(defaultCatalogGroup);
	}, [defaultCatalogGroup]);
	const visibleCatalogItems = useMemo(() => {
		const showServices = catalogGroup === "SERVICES";
		return items.filter((product) => {
			const isService = String(product.type ?? "PHYSICAL").toUpperCase() === "SERVICE";
			return showServices ? isService : !isService;
		});
	}, [catalogGroup, items]);

	const subtotalMinor = useMemo(() => {
		return cartLines.reduce((sum, l) => {
			const baseMinor = decimalToMinorUnits(l.unitPrice ?? "0.00");
			const deltaMinor = BigInt(l.totalModifiersDeltaMinor ?? "0");
			const effectiveUnitPrice = minorToDecimalString(baseMinor + deltaMinor, 2);
			return (
				sum + lineTotalMinor({ unitPrice: effectiveUnitPrice, quantity: l.quantity, precisionScale: l.precisionScale })
			);
		}, 0n as bigint);
	}, [cartLines]);

	const subtotal = useMemo(() => minorToDecimalString(subtotalMinor, 2), [subtotalMinor]);
	const subtotalCompact = useMemo(() => formatMoneyCompact(currencyCode, subtotal), [currencyCode, subtotal]);

	const checkoutMutation = useMutation({
		mutationFn: async () => {
			const total = subtotal;
			const payload = {
				idempotencyKey: makeIdempotencyKey(),
				cart: cartLines.map((l) => ({
					productId: l.productId,
					quantity: l.quantity,
					unitPrice: l.unitPrice,
					selectedModifierOptionIds: l.selectedModifierOptionIds ?? [],
					totalModifiersDeltaMinor: l.totalModifiersDeltaMinor ?? "0",
				})),
				payments: [{ method: "CASH" as const, amount: total }],
			};

			return withBusy("Processing Checkout...", async () => {
				return posApi.checkout(payload);
			});
		},
		onSuccess: () => {
			setCart({});
		},
	});

	const canCheckout = canNavigate && cartLines.length > 0 && !checkoutMutation.isPending;

	const onRefresh = useCallback(() => {
		productsQuery.refetch();
	}, [productsQuery]);

	const onOpenScanner = useCallback(() => {
		if (disabled) return;
		if (!lockNav()) return;
		router.push({
			pathname: "/(app)/(tabs)/pos/scan" as any,
			params: { returnTo: "/(app)/(tabs)/pos" },
		} as any);
	}, [disabled, lockNav, router]);

	const switchWorkspaceReplace = useCallback(
		(path: string) => {
			if (disabled) return;
			if (!lockNav()) return;
			safeReplace(router as any, path);
		},
		[disabled, lockNav, router, safeReplace],
	);

	function addToCartResolved(
		p: CatalogProduct,
		selectedModifierOptionIds: string[] = [],
		totalModifiersDeltaMinor: bigint = 0n,
		modifierSummary = "",
	) {
		if (disabled) return;
		const existing = cart[p.id];
		if (resolvePosStatus(p).disabled && !existing) return;

		const unitPrice = p.price ?? "0.00";
		const unitId = String((p as any)?.unitId ?? (p as any)?.unit?.id ?? "").trim();
		const unitName = String((p as any)?.unitName ?? (p as any)?.unit?.name ?? "").trim();
		const unitAbbreviation = String((p as any)?.unitAbbreviation ?? (p as any)?.unit?.abbreviation ?? "").trim();

		const precisionScale = resolveCartLinePrecisionScale(p);

		setCart((prev) => {
			const existing = prev[p.id];
			const existingQty = existing?.quantity ?? "0";

			const requested = addQuantityMajor(existingQty, precisionScale);
			const { qty, maxQty, trackInventory } = clampQtyToStock({
				product: p,
				requestedQty: requested,
				precisionScale,
			});

			if (qty === existingQty) return prev;

			return {
				...prev,
				[p.id]: {
					productId: p.id,
					name: p.name,
					unitPrice,
					quantity: qty,
					precisionScale,
					selectedModifierOptionIds: existing?.selectedModifierOptionIds ?? selectedModifierOptionIds,
					totalModifiersDeltaMinor: existing?.totalModifiersDeltaMinor ?? totalModifiersDeltaMinor.toString(),
					modifierSummary: existing?.modifierSummary ?? modifierSummary,
					unitId,
					unitName,
					unitAbbreviation,
					maxQty,
					trackInventory,
				},
			};
		});
	}

	async function addToCart(p: CatalogProduct) {
		if (disabled) return;
		const existing = cart[p.id];
		if (existing) {
			addToCartResolved(p);
			return;
		}

		setLoadingModifierProductId(p.id);
		try {
			const groups = await posApi.getProductModifiers(p.id);
			const available = (groups ?? []).filter((group) => (group.options ?? []).length > 0);
			if (available.length === 0) {
				addToCartResolved(p);
				return;
			}

			setModifierPickerProduct(p);
			setModifierPickerGroups(available);
			setModifierPickerVisible(true);
		} finally {
			setLoadingModifierProductId(null);
		}
	}

	const setQty = useCallback(
		(productId: string, requestedQty: string) => {
			setCart((prev) => {
				const existing = prev[productId];
				if (!existing) return prev;

				const { qty, maxQty, trackInventory } = clampQtyToStock({
					product: productsById[productId],
					requestedQty,
					precisionScale: existing.precisionScale,
					fallback: { trackInventory: existing.trackInventory, onHand: existing.maxQty },
				});

				if (toScaledInt(qty, existing.precisionScale) <= 0n) {
					const { [productId]: _, ...rest } = prev;
					return rest;
				}

				if (qty === existing.quantity && maxQty === (existing.maxQty ?? "")) return prev;

				return {
					...prev,
					[productId]: { ...existing, quantity: qty, maxQty, trackInventory },
				};
			});
		},
		[productsById],
	);

	useFocusEffect(
		useCallback(() => {
			const pending = consumePendingQuantityEdit();
			if (!pending) return;
			setQty(pending.productId, pending.quantity);
		}, [setQty]),
	);

	useEffect(() => {
		const scanned = typeof params.scannedBarcode === "string" ? params.scannedBarcode.trim() : "";
		if (!scanned) return;
		const cleaned = sanitizeSearchInput(scanned);
		setQ(cleaned.length > FIELD_LIMITS.search ? cleaned.slice(0, FIELD_LIMITS.search) : cleaned);
		router.setParams({ scannedBarcode: undefined } as any);
	}, [params.scannedBarcode, router]);

	const showCatalogEmptyCta = !trimmedQ && visibleCatalogItems.length === 0 && !productsQuery.isError;
	const isSearchEmptyState = !!trimmedQ && visibleCatalogItems.length === 0 && !productsQuery.isError;
	const isTrulyError = !!productsQuery.isError && visibleCatalogItems.length === 0;
	const syncLabel = productsQuery.isFetching ? "Syncing..." : isTrulyError ? "Sync failed" : "Synced";
	const syncColor = isTrulyError ? theme.colors.error : (theme.colors.onSurfaceVariant ?? theme.colors.onSurface);
	const syncBg = isTrulyError
		? (theme.colors.errorContainer ?? theme.colors.error)
		: (theme.colors.surfaceVariant ?? theme.colors.surface);

	const openQuantityEdit = useCallback(
		(l: CartLine) => {
			if (!canNavigate) return;
			if (!lockNav()) return;

			const unitToken = unitDisplayToken(l as any, "pricing") ?? "";
			const product = productsById[l.productId];
			const reorderPointRaw =
				(product as any)?.reorderPoint ??
				(product as any)?.reorderPointQty ??
				(product as any)?.reorderPointCached ??
				null;

			router.push({
				pathname: "/(app)/(tabs)/pos/cart/edit-quantity" as any,
				params: {
					productId: l.productId,
					name: l.name,
					quantity: l.quantity,
					precisionScale: String(l.precisionScale),
					unitToken,
					maxQty: l.maxQty ?? "",
					trackInventory: l.trackInventory ? "true" : "false",
					unitPrice: l.unitPrice ?? "0.00",
					currencyCode,
					reorderPoint: reorderPointRaw != null ? String(reorderPointRaw) : "",
				},
			} as any);
		},
		[canNavigate, currencyCode, lockNav, productsById, router],
	);

	return (
		<BAIScreen tabbed safeAreaGradientBottom>
			<TouchableWithoutFeedback onPress={dismissKeyboard} accessible={false}>
				<BAISurface style={[styles.container, styles.screenSurface]} padded={false} bordered={false} radius={0}>
					<View style={styles.header}>
						<View style={styles.headerLeft}>
							<View style={styles.titleBlock}>
								<View style={styles.titleRow}>
									<BAIText variant='title'>POS</BAIText>
									<View style={[styles.headerSyncBadge, { backgroundColor: syncBg }]}>
										<BAIText variant='caption' muted={false} style={{ color: syncColor, fontWeight: "600" }}>
											{syncLabel}
										</BAIText>
									</View>
								</View>
								{businessName ? (
									<BAIText variant='subtitle' muted numberOfLines={1}>
										{businessName}
									</BAIText>
								) : null}
							</View>
							<View style={styles.searchWrap}>
								<BAISearchWithScanButton
									value={q}
									onChangeText={(v) => {
										const cleaned = sanitizeSearchInput(v);
										setQ(cleaned.length > FIELD_LIMITS.search ? cleaned.slice(0, FIELD_LIMITS.search) : cleaned);
									}}
									onPressScan={onOpenScanner}
									scanEnabled={!disabled}
									placeholder='Search items'
									maxLength={FIELD_LIMITS.search}
									searchAccessibilityLabel='Search items'
								/>
							</View>
						</View>

						<View style={styles.headerRight}>
							<BAIButton shape='pill' onPress={() => setCart({})} disabled={disabled || cartLines.length === 0}>
								Clear
							</BAIButton>
						</View>
					</View>

					<View style={styles.body}>
						{/* Left: Catalog */}
						<View style={[styles.pane, styles.catalogPane]}>
							<View style={styles.paneHeader}>
								<BAIText variant='title'>Catalog</BAIText>
								<BAIText variant='caption' muted>
									{visibleCatalogItems.length} items
								</BAIText>
							</View>

							<View style={styles.catalogFilterTabsWrap}>
								<BAIGroupTabs<CatalogGroupTab>
									value={catalogGroup}
									onChange={setCatalogGroup}
									disabled={disabled}
									tabs={catalogGroupTabs}
									countFormatter={(count) => formatCompactNumber(count, countryCode)}
								/>
							</View>

							{visibleCatalogItems.length === 0 ? (
								<View style={styles.emptyPane}>
									<BAIText variant='body' muted>
										{isTrulyError
											? "Unable to load catalog."
											: isSearchEmptyState
												? "No results found."
												: "No items yet."}
									</BAIText>
									{isSearchEmptyState ? (
										<BAIText variant='caption' muted>
											Try a different search term or scan a different barcode.
										</BAIText>
									) : null}
									{showCatalogEmptyCta ? (
										<BAIButton onPress={() => switchWorkspaceReplace("/(app)/(tabs)/inventory")}>
											Go To Inventory
										</BAIButton>
									) : isTrulyError ? (
										<BAIButton onPress={() => productsQuery.refetch()} disabled={disabled}>
											Retry
										</BAIButton>
									) : null}
								</View>
							) : (
								<FlatList
									data={visibleCatalogItems}
									keyExtractor={(p) => p.id}
									contentContainerStyle={styles.listContent}
									showsVerticalScrollIndicator={false}
									refreshControl={
										<RefreshControl
											refreshing={productsQuery.isFetching && !productsQuery.isLoading}
											onRefresh={onRefresh}
										/>
									}
									ItemSeparatorComponent={() => <View style={styles.listItemGap} />}
									renderItem={({ item }) => {
										const inCartLine = cart[item.id];
										const onHandRaw = resolveCatalogOnHandRaw(item, inCartLine);
										const status = resolveCatalogStatus(item, inCartLine);
										const rowItem = toPosCatalogInventoryRowItem(item, onHandRaw);

										return (
											<InventoryRow
												item={rowItem}
												showOnHandUnit={false}
												categoryColor={item.categoryColor}
												onPress={() => addToCart(item)}
												disabled={disabled || (status.disabled && !inCartLine) || loadingModifierProductId === item.id}
											/>
										);
									}}
								/>
							)}
						</View>

						{/* Right: Cart */}
						<View style={[styles.pane, styles.cartPane, { borderLeftColor: borderColor }]}>
							<View style={[styles.cartSection, { borderColor, backgroundColor: theme.colors.surface }]}>
								<View style={[styles.paneHeader, { borderBottomColor: borderColor }]}>
									<View>
										<BAIText variant='title'>Cart</BAIText>
										<BAIText variant='caption' muted>
											{itemCount} items
										</BAIText>
									</View>
								</View>

								<View style={styles.cartBody}>
									{cartLines.length === 0 ? (
										<View style={styles.emptyPane}>
											<BAIText variant='body' muted>
												Your cart is empty.
											</BAIText>
										</View>
									) : (
										<FlatList
											data={cartLines}
											keyExtractor={(l) =>
												`${l.productId}:${(l.selectedModifierOptionIds ?? []).slice().sort().join(",")}`
											}
											contentContainerStyle={styles.cartList}
											showsVerticalScrollIndicator={false}
											ItemSeparatorComponent={() => <View style={[styles.sep, { backgroundColor: borderColor }]} />}
											renderItem={({ item: l }) => {
												const qtyToken = unitDisplayToken(l as any, "quantity", l.quantity);
												const qtyCompact = formatQtyDisplay(l.quantity, 2, false);
												const qtyLabel = qtyToken ? `${qtyCompact} ${qtyToken}` : qtyCompact;

												const baseMinor = decimalToMinorUnits(l.unitPrice ?? "0.00");
												const deltaMinor = BigInt(l.totalModifiersDeltaMinor ?? "0");
												const effectiveUnitPrice = minorToDecimalString(baseMinor + deltaMinor, 2);
												const unitPriceLabel = formatMoney({ currencyCode, amount: effectiveUnitPrice });
												const lineMinor = lineTotalMinor({
													unitPrice: effectiveUnitPrice,
													quantity: l.quantity,
													precisionScale: l.precisionScale,
												});
												const lineTotalLabel = formatMoney({
													currencyCode,
													amount: minorToDecimalString(lineMinor, 2),
												});
												const stockLeftRaw =
													l.trackInventory && l.maxQty !== undefined ? subtractQuantity(l.maxQty, l.quantity) : "";
												const stockLeft = stockLeftRaw ? formatQtyDisplay(stockLeftRaw, 2, false) : "";
												const stockLabel = stockLeft ? `${stockLeft}${qtyToken ? ` ${qtyToken}` : ""} left` : "";

												const product = productsById[l.productId];
												const reorderPointRaw =
													(product as any)?.reorderPoint ??
													(product as any)?.reorderPointQty ??
													(product as any)?.reorderPointCached ??
													null;
												const isZeroLeft =
													l.trackInventory && stockLeftRaw !== "" && compareQuantity(stockLeftRaw, "0") <= 0;
												const isLowLeft =
													l.trackInventory &&
													!isZeroLeft &&
													reorderPointRaw != null &&
													compareQuantity(stockLeftRaw, reorderPointRaw) <= 0;
												const stockColor = isZeroLeft ? theme.colors.error : isLowLeft ? "#F59E0B" : undefined;

												const atMax =
													l.trackInventory &&
													l.maxQty !== undefined &&
													toScaledInt(l.quantity, l.precisionScale) >= toScaledInt(l.maxQty, l.precisionScale);

												return (
													<View style={styles.cartRow}>
														<View style={styles.cartRowLeft}>
															<BAIText variant='body' numberOfLines={1}>
																{l.name}
															</BAIText>

															<BAIText variant='caption' muted>
																{unitPriceLabel} • Qty {qtyLabel} • {lineTotalLabel}
																{l.modifierSummary ? ` • ${l.modifierSummary}` : ""}
																{stockLabel ? (
																	<BAIText
																		variant='caption'
																		muted={!isZeroLeft && !isLowLeft}
																		style={stockColor ? { color: stockColor } : undefined}
																	>
																		{` • ${stockLabel}`}
																	</BAIText>
																) : null}
															</BAIText>
														</View>

														<View style={styles.cartRowRight}>
															<Pressable
																disabled={!canNavigate}
																onPress={() => setQty(l.productId, addQuantityStep(l.quantity, l.precisionScale, -1))}
																style={({ pressed }) => [
																	styles.qtyBtn,
																	{ borderColor },
																	pressed && canNavigate && { opacity: 0.75 },
																	!canNavigate && { opacity: 0.55 },
																]}
															>
																<BAIText variant='body'>−</BAIText>
															</Pressable>

															<Pressable
																disabled={!canNavigate}
																onPress={() => openQuantityEdit(l)}
																accessibilityRole='button'
																accessibilityLabel={`Edit quantity for ${l.name}`}
																accessibilityHint='Edit quantity'
																style={({ pressed }) => [
																	styles.qtyEditPill,
																	{ borderColor },
																	pressed &&
																		canNavigate && {
																			backgroundColor: theme.colors.surfaceVariant ?? theme.colors.surface,
																		},
																	!canNavigate && { opacity: 0.55 },
																]}
															>
																<MaterialCommunityIcons
																	name='pencil-outline'
																	size={14}
																	color={theme.colors.onSurfaceVariant ?? theme.colors.onSurface}
																/>
																<BAIText variant='caption' numberOfLines={1} style={styles.qtyEditText}>
																	{qtyLabel}
																</BAIText>
															</Pressable>

															<Pressable
																disabled={!canNavigate || atMax}
																onPress={() => setQty(l.productId, addQuantityStep(l.quantity, l.precisionScale, 1))}
																style={({ pressed }) => [
																	styles.qtyBtn,
																	{ borderColor },
																	pressed && canNavigate && !atMax && { opacity: 0.75 },
																	(!canNavigate || atMax) && { opacity: 0.55 },
																]}
															>
																<BAIText variant='body'>+</BAIText>
															</Pressable>
														</View>
													</View>
												);
											}}
										/>
									)}
								</View>
							</View>
							<View style={[styles.checkoutSection, { borderColor, backgroundColor: theme.colors.surface }]}>
								<View style={styles.checkoutArea}>
									<View style={styles.checkoutRow}>
										<BAIText variant='body'>Total</BAIText>
										<BAIText variant='title'>{subtotalCompact}</BAIText>
									</View>

									<BAICTAButton disabled={!canCheckout} onPress={() => checkoutMutation.mutate()}>
										{canCheckout
											? `Charge ${subtotalCompact}`
											: cartLines.length === 0
												? "Add Items To Cart"
												: "Charging..."}
									</BAICTAButton>
								</View>
							</View>
						</View>
					</View>
					<PosModifiersPickerSheet
						visible={modifierPickerVisible}
						groups={modifierPickerGroups}
						currencyCode={currencyCode}
						onClose={() => {
							setModifierPickerVisible(false);
							setModifierPickerProduct(null);
							setModifierPickerGroups([]);
						}}
						onConfirm={(selectionMap, selectedModifierOptionIds, totalDeltaMinor) => {
							const product = modifierPickerProduct;
							if (!product) return;
							const parts: string[] = [];
							for (const group of modifierPickerGroups) {
								const selected = new Set(selectionMap[group.id] ?? []);
								const names = group.options.filter((o) => selected.has(o.id)).map((o) => o.name);
								if (names.length > 0) parts.push(`${group.name}: ${names.join(", ")}`);
							}
							addToCartResolved(product, selectedModifierOptionIds, totalDeltaMinor, parts.join(" | "));
							setModifierPickerVisible(false);
							setModifierPickerProduct(null);
							setModifierPickerGroups([]);
						}}
					/>
				</BAISurface>
			</TouchableWithoutFeedback>
		</BAIScreen>
	);
}

const styles = StyleSheet.create({
	container: { flex: 1 },
	screenSurface: {
		backgroundColor: "transparent",
		marginBottom: 0,
	},
	header: {
		paddingHorizontal: POS_GUTTER,
		paddingTop: 12,
		paddingBottom: 10,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
	},
	headerLeft: { flexDirection: "row", alignItems: "center", gap: 14, flex: 1 },
	titleBlock: { minWidth: 120 },
	titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
	headerSyncBadge: {
		paddingHorizontal: 10,
		paddingVertical: 4,
		borderRadius: 999,
	},
	searchWrap: { flex: 1, maxWidth: 420 },
	headerRight: { flexDirection: "row", gap: 10 },
	catalogFilterTabsWrap: {
		paddingBottom: POS_SECTION_GAP,
	},

	body: { flex: 1, flexDirection: "row" },

	pane: { flex: 1 },
	catalogPane: { flex: 1.25 },
	cartPane: { flex: 1, borderLeftWidth: POS_BORDER_WIDTH },

	paneHeader: {
		paddingHorizontal: 0,
		paddingVertical: POS_HEADER_PAD_Y,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		borderBottomWidth: POS_BORDER_WIDTH,
	},
	cartSection: {
		flex: 1,
		borderWidth: POS_BORDER_WIDTH,
		borderRadius: POS_CARD_RADIUS,
		overflow: "hidden",
	},
	checkoutSection: {
		borderWidth: POS_BORDER_WIDTH,
		borderRadius: POS_CARD_RADIUS,
		overflow: "hidden",
		marginTop: POS_SECTION_GAP,
		marginBottom: POS_SECTION_GAP,
	},
	cartBody: { flex: 1 },
	emptyPane: { flex: 1, alignItems: "center", justifyContent: "flex-start", paddingTop: 24, gap: 12 },

	listContent: { paddingBottom: 16 },
	listItemGap: { height: 8 },
	sep: { height: POS_BORDER_WIDTH },

	cartList: { paddingHorizontal: 14, paddingBottom: 10 },

	cartRow: {
		paddingVertical: 12,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
	},
	cartRowLeft: { flex: 1, paddingRight: 12 },
	cartRowRight: { flexDirection: "row", alignItems: "center", gap: 8 },

	qtyBtn: {
		width: 36,
		height: 36,
		borderRadius: 18,
		borderWidth: 1,
		alignItems: "center",
		justifyContent: "center",
	},
	qtyEditPill: {
		height: 36,
		paddingHorizontal: 10,
		borderRadius: 18,
		borderWidth: 1,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		gap: 6,
	},
	qtyEditText: { fontWeight: "600" },

	checkoutArea: {
		paddingHorizontal: POS_GUTTER,
		paddingTop: 12,
		paddingBottom: 14,
	},
	checkoutRow: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		marginBottom: 10,
	},
});
