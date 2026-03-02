// BizAssist_mobile
// path: app/(app)/(tabs)/pos/pos.phone.tsx
//
// Phone POS v1 (deterministic + minimal)
//
// Governance:
// - Bottom tabs are WORKSPACE SELECTORS, not screen navigators.
// - From POS workspace, navigation to Inventory must switch workspace deterministically (replace),
//   not push into Inventory stack.
// - No double taps: useNavLock gate + local lock (belt + suspenders).
// - Checkout is a critical operation: must use global Busy overlay.
// - Use existing patterns and components only (no new abstractions).
//
// Feature change (phone only):
// - Add group tabs: Catalog | Cart
//   - Catalog tab: Catalog list + Cart SUMMARY (item count + total)
//   - Cart tab: Full cart list + totals + quantity controls + Charge CTA

import { useMutation, useQuery } from "@tanstack/react-query";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { FlatList, Image, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { useTheme } from "react-native-paper";

import { BAIButton } from "@/components/ui/BAIButton";
import { BAICTAButton } from "@/components/ui/BAICTAButton";
import { BAIGroupTabs } from "@/components/ui/BAIGroupTabs";
import { BAISearchBar } from "@/components/ui/BAISearchBar";
import { BAIScreen } from "@/components/ui/BAIScreen";
import { BAISurface } from "@/components/ui/BAISurface";
import { BAIText } from "@/components/ui/BAIText";

import { useAppBusy } from "@/hooks/useAppBusy";
import { useActiveBusinessMeta } from "@/modules/business/useActiveBusinessMeta";
import { formatCompactNumber } from "@/lib/locale/businessLocale";
import type { CatalogProduct } from "@/modules/catalog/catalog.types";
import { inventoryApi } from "@/modules/inventory/inventory.api";
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
import { PosCatalogListShell } from "@/modules/pos/components/PosCatalogListShell";
import { posApi } from "@/modules/pos/pos.api";
import { PosModifiersPickerSheet } from "@/modules/pos/components/PosModifiersPickerSheet";
import type { ProductModifierGroup } from "@/modules/pos/pos.api";
import type { SelectedAttributeSnapshot } from "@/modules/attributes/attributes.types";
import { unitDisplayToken } from "@/modules/units/units.format";
import { useNavLock } from "@/shared/hooks/useNavLock";
import { formatMoney } from "@/shared/money/money.format";
import { consumePendingAttributeSelection } from "@/modules/pos/pos.attributeSelectionStore";

type CartLine = {
	productId: string;
	name: string;
	unitPrice: string;
	quantity: string; // decimal string (UDQI)
	precisionScale: number; // 0..5
	selectedModifierOptionIds?: string[];
	totalModifiersDeltaMinor?: string;
	modifierSummary?: string;
	selectedAttributes?: SelectedAttributeSnapshot[];
	attributeSummary?: string;

	unitId?: string;
	unitName?: string;
	unitAbbreviation?: string;

	maxQty?: string; // decimal string
	trackInventory?: boolean;
};

type PosTab = "CATALOG" | "CART";

// POS layout + design lock (do not change without explicit approval).
export const POS_LAYOUT_LOCK = "LOCKED_V1" as const;
const POS_GUTTER = 14;
const POS_HEADER_CARD_PAD_TOP = 12;
const POS_HEADER_CARD_PAD_BOTTOM = 12;
const POS_HEADER_PAD_Y = 10;
const POS_CARD_RADIUS = 16;
const POS_CART_RADIUS = 18;
const POS_BORDER_WIDTH = StyleSheet.hairlineWidth;
const POS_SECTION_GAP = 10;
const POS_SECTION_GAP_SM = 6;

function makeIdempotencyKey(): string {
	return `pos-phone-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

function formatMoneyCompact(currencyCode: string, amountRaw: string): string {
	const raw = String(amountRaw ?? "").trim() || "0";
	const compact = formatQtyDisplay(raw, 2);
	const formatted = formatMoney({ currencyCode, amount: raw });

	if (!formatted) return compact;

	const replaced = formatted.replace(/-?\d[\d,]*([.]\d+)?/, compact);
	return replaced || compact;
}

function unitTokenFromProduct(product: CatalogProduct): string {
	return (
		String((product as any)?.unitAbbreviation ?? (product as any)?.unit?.abbreviation ?? "").trim() ||
		String((product as any)?.unitName ?? (product as any)?.unit?.name ?? "").trim()
	);
}

function resolveCatalogStatus(product: CatalogProduct, inCartLine?: CartLine) {
	if (!product?.trackInventory) return resolvePosStatus(product);

	const onHandRaw =
		(product as any)?.onHand ??
		(product as any)?.onHandCached ??
		(product as any)?.inventoryOnHand ??
		(product as any)?.stockOnHand ??
		"0";

	const adjustedOnHand = subtractQuantity(onHandRaw, inCartLine?.quantity ?? "0");
	const status = resolvePosStatus({ ...product, onHand: adjustedOnHand });

	const formattedLeft = formatQtyDisplay(adjustedOnHand);
	const unitToken = unitTokenFromProduct(product);
	const leftLabel = unitToken ? `${formattedLeft} ${unitToken} left` : `${formattedLeft} left`;

	if (status.kind === "OUT_OF_STOCK") return { ...status, label: "Out of stock" };
	if (status.kind === "LOW_STOCK") return { ...status, label: `Low: ${leftLabel}` };
	if (status.kind === "IN_STOCK") return { ...status, label: leftLabel };

	return status;
}

export default function PosPhone() {
	const router = useRouter();
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

	const [tab, setTab] = useState<PosTab>("CATALOG");
	const [q, setQ] = useState("");
	const trimmedQ = q.trim();

	const [cart, setCart] = useState<Record<string, CartLine>>({});
	const [modifierPickerVisible, setModifierPickerVisible] = useState(false);
	const [modifierPickerProduct, setModifierPickerProduct] = useState<CatalogProduct | null>(null);
	const [modifierPickerGroups, setModifierPickerGroups] = useState<ProductModifierGroup[]>([]);
	const [loadingModifierProductId, setLoadingModifierProductId] = useState<string | null>(null);
	const [pendingAttributeSnapshots, setPendingAttributeSnapshots] = useState<SelectedAttributeSnapshot[]>([]);
	const pendingAttributeFlowRef = useRef<
		{ product: CatalogProduct; groups: ProductModifierGroup[]; selectedAttributes: SelectedAttributeSnapshot[] } | null
	>(null);

	const productsQuery = useQuery({
		queryKey: ["pos", "catalog", "products", trimmedQ],
		queryFn: () => inventoryApi.listProducts({ q: trimmedQ || undefined, limit: 100 }),
		staleTime: 30_000,
	});

	const items = useMemo(
		() => (productsQuery.data?.items ?? []) as unknown as CatalogProduct[],
		[productsQuery.data?.items],
	);
	const productsById = useMemo(() => Object.fromEntries(items.map((p) => [p.id, p])), [items]);

	const cartLines = useMemo(() => Object.values(cart), [cart]);
	const itemCount = useMemo(() => cartLines.length, [cartLines]);
	const posTabs = useMemo(
		() =>
			[
				{ label: "Catalog", value: "CATALOG", count: items.length },
				{ label: "Cart", value: "CART", count: itemCount },
			] as const,
		[itemCount, items.length],
	);

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
					selectedAttributes: l.selectedAttributes ?? [],
				})),
				payments: [{ method: "CASH" as const, amount: total }],
			};

			return withBusy("Processing Checkout...", async () => {
				return posApi.checkout(payload);
			});
		},
		onSuccess: () => {
			setCart({});
			setTab("CATALOG");
		},
	});

	const canCheckout = canNavigate && cartLines.length > 0 && !checkoutMutation.isPending;

	const onRefresh = useCallback(() => {
		productsQuery.refetch();
	}, [productsQuery]);

	const switchWorkspaceReplace = useCallback(
		(path: string) => {
			if (disabled) return;
			if (!lockNav()) return;
			safeReplace(router as any, path);
		},
		[disabled, lockNav, router, safeReplace],
	);

	const addToCartResolved = useCallback(
		(
			p: CatalogProduct,
			selectedModifierOptionIds: string[] = [],
			totalModifiersDeltaMinor: bigint = 0n,
			modifierSummary = "",
			selectedAttributes: SelectedAttributeSnapshot[] = [],
		) => {
			if (disabled) return;

			const unitPrice = p.price ?? "0.00";
			const unitId = String((p as any)?.unitId ?? (p as any)?.unit?.id ?? "").trim();
			const unitName = String((p as any)?.unitName ?? (p as any)?.unit?.name ?? "").trim();
			const unitAbbreviation = String((p as any)?.unitAbbreviation ?? (p as any)?.unit?.abbreviation ?? "").trim();

			const precisionScale = resolveCartLinePrecisionScale(p);

			setCart((prev) => {
				const existing = prev[p.id];
				if (resolvePosStatus(p).disabled && !existing) return prev;

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
						selectedAttributes: existing?.selectedAttributes ?? selectedAttributes,
						attributeSummary:
							existing?.attributeSummary ??
							(selectedAttributes.length > 0
								? selectedAttributes
										.map((entry) => `${entry.attributeNameSnapshot}: ${entry.optionNameSnapshot}`)
										.join(" | ")
								: ""),
						unitId,
						unitName,
						unitAbbreviation,
						maxQty,
						trackInventory,
					},
				};
			});
		},
		[disabled],
	);

	async function addToCart(p: CatalogProduct) {
		if (disabled) return;
		const existing = cart[p.id];
		if (existing) {
			addToCartResolved(p);
			return;
		}

		setLoadingModifierProductId(p.id);
		try {
			const productAttributes = await posApi.getProductAttributes(p.id);
			const requiredAttributes = (productAttributes ?? []).filter(
				(entry) => entry.isRequired && (entry.attribute?.options ?? []).some((option) => !option.isArchived),
			);
			const groups = await posApi.getProductModifiers(p.id);
			const available = (groups ?? []).filter((group) => (group.options ?? []).length > 0);
			if (requiredAttributes.length > 0) {
				pendingAttributeFlowRef.current = {
					product: p,
					groups: available,
					selectedAttributes: [],
				};
				router.push({
					pathname: "/(app)/(tabs)/pos/attributes/select" as any,
					params: { productId: p.id, productName: p.name } as any,
				} as any);
				return;
			}
			if (available.length === 0) {
				addToCartResolved(p);
				return;
			}

			setPendingAttributeSnapshots([]);
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
			if (pending) setQty(pending.productId, pending.quantity);

			const pendingAttributes = consumePendingAttributeSelection();
			if (!pendingAttributes) return;
			const pendingFlow = pendingAttributeFlowRef.current;
			if (!pendingFlow || pendingFlow.product.id !== pendingAttributes.productId) return;
			pendingAttributeFlowRef.current = null;

			if (pendingFlow.groups.length === 0) {
				addToCartResolved(
					pendingFlow.product,
					[],
					0n,
					"",
					pendingAttributes.selectedAttributes,
				);
				return;
			}

			setPendingAttributeSnapshots(pendingAttributes.selectedAttributes);
			setModifierPickerProduct(pendingFlow.product);
			setModifierPickerGroups(pendingFlow.groups);
			setModifierPickerVisible(true);
		}, [addToCartResolved, setQty]),
	);

	const showCatalogEmptyCta = !trimmedQ && items.length === 0 && !productsQuery.isError;
	const isTrulyError = !!productsQuery.isError && items.length === 0;

	const openQuantityEdit = useCallback(
		(l: CartLine) => {
			if (disabled) return;
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
		[currencyCode, disabled, lockNav, productsById, router],
	);

	const renderCartRow = useCallback(
		(l: CartLine) => {
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
			const lineTotalLabel = formatMoney({ currencyCode, amount: minorToDecimalString(lineMinor, 2) });
			const stockLeftRaw = l.trackInventory && l.maxQty !== undefined ? subtractQuantity(l.maxQty, l.quantity) : "";
			const stockLeft = stockLeftRaw ? formatQtyDisplay(stockLeftRaw, 2, false) : "";
			const stockLabel = stockLeft ? `${stockLeft}${qtyToken ? ` ${qtyToken}` : ""} left` : "";

			const product = productsById[l.productId];
			const reorderPointRaw =
				(product as any)?.reorderPoint ??
				(product as any)?.reorderPointQty ??
				(product as any)?.reorderPointCached ??
				null;
			const isZeroLeft = l.trackInventory && stockLeftRaw !== "" && compareQuantity(stockLeftRaw, "0") <= 0;
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

			// Requested cart row fields:
			// - Item price | Quantity | total item price
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
						{l.attributeSummary ? (
							<BAIText variant='caption' muted numberOfLines={2}>
								{l.attributeSummary}
							</BAIText>
						) : null}
					</View>

					<View style={styles.cartRowRight}>
						<Pressable
							disabled={disabled}
							onPress={() => setQty(l.productId, addQuantityStep(l.quantity, l.precisionScale, -1))}
							style={({ pressed }) => [
								styles.qtyBtn,
								{ borderColor },
								pressed && !disabled && { opacity: 0.75 },
								disabled && { opacity: 0.55 },
							]}
						>
							<BAIText variant='body'>−</BAIText>
						</Pressable>

						<Pressable
							disabled={disabled}
							onPress={() => openQuantityEdit(l)}
							accessibilityRole='button'
							accessibilityLabel={`Edit quantity for ${l.name}`}
							accessibilityHint='Edit quantity'
							style={({ pressed }) => [
								styles.qtyEditPill,
								{ borderColor },
								pressed && !disabled && { backgroundColor: theme.colors.surfaceVariant ?? theme.colors.surface },
								disabled && { opacity: 0.55 },
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
							disabled={disabled || atMax}
							onPress={() => setQty(l.productId, addQuantityStep(l.quantity, l.precisionScale, 1))}
							style={({ pressed }) => [
								styles.qtyBtn,
								{ borderColor },
								pressed && !disabled && !atMax && { opacity: 0.75 },
								(disabled || atMax) && { opacity: 0.55 },
							]}
						>
							<BAIText variant='body'>+</BAIText>
						</Pressable>
					</View>
				</View>
			);
		},
		[
			borderColor,
			currencyCode,
			disabled,
			openQuantityEdit,
			productsById,
			setQty,
			theme.colors.error,
			theme.colors.onSurface,
			theme.colors.onSurfaceVariant,
			theme.colors.surface,
			theme.colors.surfaceVariant,
		],
	);

	return (
		<BAIScreen tabbed>
			<BAISurface style={[styles.container, styles.screenSurface]} padded={false} bordered={false} radius={0}>
				<View style={[styles.posHeaderCard, { borderColor, backgroundColor: theme.colors.surface }]}>
					<View style={styles.header}>
						<View style={styles.headerLeft}>
							<BAIText variant='title'>POS</BAIText>
							{businessName ? (
								<BAIText variant='subtitle' muted numberOfLines={1}>
									{businessName}
								</BAIText>
							) : null}
						</View>
						<View style={styles.headerRight}>
							<BAIButton shape='pill' onPress={() => setCart({})} disabled={disabled || cartLines.length === 0}>
								Clear
							</BAIButton>
						</View>
					</View>

					<View style={styles.tabsWrap}>
						<BAIGroupTabs<PosTab>
							value={tab}
							onChange={setTab}
							disabled={disabled}
							tabs={posTabs}
							countFormatter={(count) => formatCompactNumber(count, countryCode)}
						/>
					</View>
				</View>

				{tab === "CATALOG" ? (
					<>
						<PosCatalogListShell
							countLabel={`${items.length} items`}
							isLoading={productsQuery.isLoading}
							isFetching={productsQuery.isFetching}
							isError={isTrulyError}
							onRetry={() => productsQuery.refetch()}
							emptyTitle='No items yet'
							emptyBody='Create items in Inventory to start selling.'
							primaryCtaLabel={showCatalogEmptyCta ? "Go To Inventory" : undefined}
							onPrimaryCta={showCatalogEmptyCta ? () => switchWorkspaceReplace("/(app)/(tabs)/inventory") : undefined}
							headerContent={
								<BAISearchBar
									value={q}
									onChangeText={(v) => {
										const cleaned = sanitizeSearchInput(v);
										setQ(cleaned.length > FIELD_LIMITS.search ? cleaned.slice(0, FIELD_LIMITS.search) : cleaned);
									}}
									placeholder='Search items'
									maxLength={FIELD_LIMITS.search}
								/>
							}
						>
							{items.length === 0 ? null : (
								<FlatList
									data={items}
									keyExtractor={(p) => p.id}
									contentContainerStyle={styles.listContent}
									showsVerticalScrollIndicator={false}
									refreshControl={
										<RefreshControl
											refreshing={productsQuery.isFetching && !productsQuery.isLoading}
											onRefresh={onRefresh}
										/>
									}
									ItemSeparatorComponent={() => <View style={[styles.sep, { backgroundColor: borderColor }]} />}
									renderItem={({ item }) => {
										const inCartLine = cart[item.id];
										const inCartQty = inCartLine?.quantity ?? "0";
										const inCart = !!inCartLine;
										const priceLabel = formatMoney({ currencyCode, amount: item.price ?? "0.00" });
										const status = resolveCatalogStatus(item, inCartLine);
										const rowDisabled = disabled || (status.disabled && !inCartLine);
										const isLowStock = status.kind === "LOW_STOCK";
										const isOutOfStock = status.kind === "OUT_OF_STOCK";
										const warningColor = "#F59E0B";
										const outColor = theme.colors.error;
										const statusTextColor = isOutOfStock ? outColor : isLowStock ? warningColor : undefined;
										const isOutOfStockRow = isOutOfStock && !inCartLine;

										const tileColor = item.posTileColor ?? item.categoryColor ?? theme.colors.primary;

										return (
											<Pressable
												onPress={() => addToCart(item)}
												disabled={rowDisabled || loadingModifierProductId === item.id}
												style={({ pressed }) => [
													styles.row,
													isOutOfStockRow && { backgroundColor: theme.colors.surfaceVariant ?? theme.colors.surface },
													pressed && !rowDisabled && loadingModifierProductId !== item.id && { opacity: 0.78 },
													(rowDisabled || loadingModifierProductId === item.id) && { opacity: 0.55 },
												]}
											>
												<View style={styles.rowLeft}>
													<View style={styles.tileShell}>
														<View style={styles.tileInner}>
															{item.posTileMode === "IMAGE" && item.primaryImageUrl ? (
																<Image source={{ uri: item.primaryImageUrl }} style={styles.tileImage} />
															) : (
																<View style={[styles.tileColor, { backgroundColor: tileColor }]} />
															)}
														</View>

														{inCart ? (
															<View
																style={[
																	styles.cartBadge,
																	{
																		backgroundColor: theme.colors.primary,
																		borderColor: theme.colors.onSurface,
																	},
																]}
															>
																<BAIText
																	variant='caption'
																	style={[styles.cartBadgeText, { color: theme.colors.onPrimary }]}
																>
																	{formatQtyDisplay(String(inCartQty), 2, false)}
																</BAIText>
															</View>
														) : null}
													</View>

													<View style={styles.rowText}>
														<BAIText variant='body' numberOfLines={1} style={styles.rowTitle}>
															{item.name}
														</BAIText>
														{item.sku ? (
															<BAIText variant='caption' muted>
																SKU: {item.sku}
															</BAIText>
														) : null}
													</View>
												</View>

												<View style={styles.rowRight}>
													<BAIText variant='body' style={styles.rowPrice}>
														{priceLabel}
													</BAIText>

													<BAIText
														variant='caption'
														muted={!isLowStock && !isOutOfStock}
														style={statusTextColor ? { color: statusTextColor } : undefined}
														numberOfLines={1}
													>
														{status.label}
													</BAIText>
												</View>
											</Pressable>
										);
									}}
								/>
							)}
						</PosCatalogListShell>

						{/* Cart summary footer on Catalog tab */}
						{cartLines.length > 0 ? (
							<View style={[styles.cartSummary, { borderColor, backgroundColor: theme.colors.surface }]}>
								<View style={styles.cartSummaryLeft}>
									<BAIText variant='subtitle' numberOfLines={1}>
										Cart Total
									</BAIText>
									<BAIText variant='body' muted>
										{itemCount} items • Total {formatMoney({ currencyCode, amount: subtotal })}
									</BAIText>
								</View>

								<BAIButton shape='pill' onPress={() => setTab("CART")} disabled={disabled}>
									View Cart
								</BAIButton>
							</View>
						) : null}
					</>
				) : (
					<>
						<View style={[styles.cartSection, { borderColor, backgroundColor: theme.colors.surface }]}>
							<View style={[styles.cartHeader, { borderBottomColor: borderColor }]}>
								<View>
									<BAIText variant='title'>Cart</BAIText>
									<BAIText variant='caption' muted>
										{itemCount} items
									</BAIText>
								</View>
							</View>

							<View style={styles.cartBody}>
								{cartLines.length === 0 ? (
									<View style={styles.emptyCart}>
										<BAIText variant='body' muted>
											Your cart is empty.
										</BAIText>
										<BAIButton
											widthPreset='standard'
											onPress={() => setTab("CATALOG")}
											disabled={disabled}
											style={{ minWidth: 180 }}
										>
											Browse Catalog
										</BAIButton>
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
										renderItem={({ item }) => renderCartRow(item)}
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
					</>
				)}
				<PosModifiersPickerSheet
					visible={modifierPickerVisible}
					groups={modifierPickerGroups}
					currencyCode={currencyCode}
					onClose={() => {
						setModifierPickerVisible(false);
						setModifierPickerProduct(null);
						setModifierPickerGroups([]);
						setPendingAttributeSnapshots([]);
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
						addToCartResolved(
							product,
							selectedModifierOptionIds,
							totalDeltaMinor,
							parts.join(" | "),
							pendingAttributeSnapshots,
						);
						setModifierPickerVisible(false);
						setModifierPickerProduct(null);
						setModifierPickerGroups([]);
						setPendingAttributeSnapshots([]);
					}}
				/>
			</BAISurface>
		</BAIScreen>
	);
}

const styles = StyleSheet.create({
	container: { flex: 1 },
	screenSurface: {
		backgroundColor: "transparent",
		marginBottom: 0,
	},
	posHeaderCard: {
		paddingHorizontal: POS_GUTTER,
		paddingTop: POS_HEADER_CARD_PAD_TOP,
		paddingBottom: POS_HEADER_CARD_PAD_BOTTOM,
		borderWidth: POS_BORDER_WIDTH,
		borderRadius: POS_CARD_RADIUS,
		marginBottom: POS_SECTION_GAP,
	},
	header: {
		paddingTop: 0,
		paddingBottom: POS_HEADER_PAD_Y,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
	},
	headerLeft: { flex: 1 },
	headerRight: { flexDirection: "row", gap: 10 },

	tabsWrap: { paddingHorizontal: 0 },
	listContent: { paddingBottom: 16 },
	sep: { height: POS_BORDER_WIDTH },

	row: {
		paddingVertical: 12,
		paddingHorizontal: POS_GUTTER,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
	},
	rowLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
	rowText: { flex: 1, paddingRight: 12 },
	rowTitle: { marginBottom: 2 },

	rowRight: { alignItems: "flex-end", minWidth: 110 },
	rowPrice: { fontWeight: "600" },

	tileShell: { width: 44, height: 44 },
	tileInner: {
		width: 44,
		height: 44,
		borderRadius: 10,
		overflow: "hidden",
	},
	tileImage: { width: 44, height: 44, borderRadius: 10 },
	tileColor: { width: 44, height: 44, borderRadius: 10 },

	cartBadge: {
		position: "absolute",
		right: -6,
		top: -6,
		minWidth: 18,
		height: 18,
		borderRadius: 9,
		alignItems: "center",
		justifyContent: "center",
		paddingHorizontal: 5,
		borderWidth: 1,
	},
	cartBadgeText: { fontSize: 11, fontWeight: "700" },

	cartSummary: {
		paddingHorizontal: POS_GUTTER,
		paddingTop: POS_HEADER_PAD_Y,
		paddingBottom: POS_HEADER_PAD_Y,
		borderWidth: POS_BORDER_WIDTH,
		borderRadius: POS_CARD_RADIUS,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		marginBottom: POS_SECTION_GAP_SM,
	},
	cartSummaryLeft: { flex: 1, paddingRight: 10 },

	cartHeader: {
		paddingHorizontal: POS_GUTTER,
		paddingVertical: POS_HEADER_PAD_Y,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		borderBottomWidth: POS_BORDER_WIDTH,
	},
	cartSection: {
		flex: 1,
		borderWidth: POS_BORDER_WIDTH,
		borderRadius: POS_CART_RADIUS,
		overflow: "hidden",
	},
	checkoutSection: {
		borderWidth: POS_BORDER_WIDTH,
		borderRadius: POS_CART_RADIUS,
		overflow: "hidden",
		marginTop: POS_SECTION_GAP,
		marginBottom: POS_SECTION_GAP_SM,
	},
	cartBody: { flex: 1 },
	emptyCart: {
		flex: 1,
		paddingHorizontal: POS_GUTTER,
		alignItems: "center",
		justifyContent: "flex-start",
		paddingTop: 24,
		gap: 12,
	},
	cartList: { paddingHorizontal: POS_GUTTER, paddingBottom: POS_HEADER_PAD_Y },

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
		paddingBottom: POS_HEADER_PAD_Y,
	},
	checkoutRow: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		marginBottom: 10,
	},
});
