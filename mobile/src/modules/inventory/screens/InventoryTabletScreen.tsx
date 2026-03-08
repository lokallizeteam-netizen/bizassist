// BizAssist_mobile
// path: src/modules/inventory/screens/InventoryTabletScreen.tsx
//
// Capability Alignment
// Capability:
// - Catalog Management
// - Inventory Management
// Sub Capability:
// - Item Management
// - Service Management
// - Inventory Activity
// Owner Surface:
// - mobile/app/(app)/(tabs)/inventory/inventory.tablet.tsx
// - mobile/src/modules/inventory/screens/InventoryTabletScreen.tsx
// Domain Entities:
// - Product
// - Category
// - Unit
// - InventoryMovement
// System Invariants:
// - archive-only lifecycle (no hard delete)
// - business scoping required for all queries and mutations
// - stock-health filters are applied to active, inventory-tracked items only
// - this list screen is read model + navigation shell; stock mutations occur in dedicated ledger flows

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, StyleSheet, FlatList, RefreshControl } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTheme } from "react-native-paper";
import { useQuery } from "@tanstack/react-query";

import { BAIScreen } from "@/components/ui/BAIScreen";
import { BAIGovernedScrollableLayout } from "@/components/ui/BAIGovernedScrollableLayout";
import { BAIText } from "@/components/ui/BAIText";
import { BAIButton } from "@/components/ui/BAIButton";
import { BAIRetryButton } from "@/components/ui/BAIRetryButton";
import { BAIEmptyStateButton } from "@/components/ui/BAIEmptyStateButton";
import { BAISurface } from "@/components/ui/BAISurface";
import { BAIGroupTabs, type BAIGroupTab } from "@/components/ui/BAIGroupTabs";
import { formatMoney } from "@/shared/money/money.format";

import { InventorySearchBar } from "@/modules/inventory/components/InventorySearchBar";
import { InventoryMovementRow } from "@/modules/inventory/components/InventoryMovementRow";
import { useActiveBusinessMeta } from "@/modules/business/useActiveBusinessMeta";
import { formatCompactNumber } from "@/lib/locale/businessLocale";

import { inventoryApi } from "@/modules/inventory/inventory.api";
import { mapInventoryRouteToScope, type InventoryRouteScope } from "@/modules/inventory/navigation.scope";
import { inventoryKeys } from "@/modules/inventory/inventory.queries";
import { formatOnHand, hasReorderPoint, isOutOfStock, isStockHealthy } from "@/modules/inventory/inventory.selectors";
import { categoriesApi } from "@/modules/categories/categories.api";
import { categoryKeys } from "@/modules/categories/categories.queries";

import { unitsApi } from "@/modules/units/units.api";
import { unitsKeys } from "@/modules/units/units.queries";
import type { Unit } from "@/modules/units/units.types";

import type { InventoryMovement, InventoryProduct, InventoryProductDetail } from "@/modules/inventory/inventory.types";
import { InventoryRow } from "@/modules/inventory/InventoryRow";
import type { Category } from "@/modules/categories/categories.types";
import {
	filterInventoryItems,
	getInventoryHealthCounts,
	inventoryHealthFilterEmptyLabel,
	normalizeInventoryHealthFilter,
} from "@/modules/inventory/inventory.filters";

import { useNavLock } from "@/shared/hooks/useNavLock";

type InventorySellableTabValue = "ITEMS" | "SERVICES";
type InventoryStatusTabValue = "ACTIVE" | "ARCHIVED";
type InventoryHealthTabValue = "ALL" | "healthy" | "low" | "out" | "reorder";

const INVENTORY_STATUS_TAB_BASE = [
	{ label: "Active", value: "ACTIVE" },
	{ label: "Archived", value: "ARCHIVED" },
] as const;

const INVENTORY_SELLABLE_TAB_BASE = [
	{ label: "Items", value: "ITEMS" },
	{ label: "Services", value: "SERVICES" },
] as const satisfies readonly BAIGroupTab<InventorySellableTabValue>[];

const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;
const SEARCH_DEBOUNCE_MS = 300;

function isService(p: InventoryProduct): boolean {
	const raw =
		typeof (p as any)?.type === "string"
			? String((p as any).type)
					.trim()
					.toUpperCase()
			: "";
	return raw === "SERVICE";
}

function filterBySellableTab(items: InventoryProduct[], tab: InventorySellableTabValue): InventoryProduct[] {
	if (tab === "SERVICES") return items.filter((p) => isService(p));
	return items.filter((p) => !isService(p));
}

function normalizeSellableTab(raw: unknown): InventorySellableTabValue {
	const s = String(raw ?? "")
		.trim()
		.toUpperCase();
	if (s === "SERVICES") return "SERVICES";
	return "ITEMS";
}

function clampPrecisionScale(value: unknown): number {
	const raw = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(raw)) return 0;
	return Math.max(0, Math.min(5, Math.trunc(raw)));
}

function getPrecisionScale(product: InventoryProduct, unitsById?: Map<string, Unit>): number {
	const unitRelation = (product as { Unit?: { precisionScale?: number | null } }).Unit;
	const rawScale = product.unit?.precisionScale ?? unitRelation?.precisionScale ?? product.unitPrecisionScale ?? 0;
	const clamped = clampPrecisionScale(rawScale);
	if (clamped > 0) return clamped;

	// UDQI fallback: listProducts may not include unit precision; derive from cached Units list.
	const unitId = (product as any)?.unitId as string | undefined;
	if (unitId && unitsById && unitsById.has(unitId)) {
		const fromUnit = unitsById.get(unitId)?.precisionScale;
		return clampPrecisionScale(fromUnit ?? 0);
	}

	return 0;
}

function normalizeDecimalString(raw: string, scale: number): string | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;
	const s = trimmed.endsWith(".") ? trimmed.slice(0, -1) : trimmed;
	if (!DECIMAL_PATTERN.test(s)) return null;

	const neg = s.startsWith("-");
	const body = neg ? s.slice(1) : s;
	const [intPartRaw, fracRaw = ""] = body.split(".");
	const intPart = intPartRaw || "0";
	if (scale <= 0) return (neg ? "-" : "") + intPart;

	const frac = (fracRaw + "0".repeat(scale)).slice(0, scale);
	return (neg ? "-" : "") + intPart + "." + frac;
}

function applyInventoryTrackingClamp(display: string, scale: number, trackInventory: boolean): string {
	if (!trackInventory) return display;

	const trimmed = display.trim();
	if (!trimmed) return display;

	const neg = trimmed.startsWith("-");
	const body = neg ? trimmed.slice(1) : trimmed;
	const [intPartRaw] = body.split(".");
	const intPart = intPartRaw && intPartRaw.length > 0 ? intPartRaw : "0";

	if (scale <= 0) return (neg ? "-" : "") + intPart;
	return (neg ? "-" : "") + intPart + "." + "0".repeat(scale);
}

function formatOnHandDisplay(
	product: InventoryProduct,
	unitsById?: Map<string, Unit>,
): { precisionScale: number; display: string } {
	const precisionScale = getPrecisionScale(product, unitsById);
	const zero = precisionScale > 0 ? `0.${"0".repeat(precisionScale)}` : "0";

	if (typeof product.onHandCachedRaw === "string") {
		const normalized = normalizeDecimalString(product.onHandCachedRaw, precisionScale);
		if (normalized) {
			return {
				precisionScale,
				display: applyInventoryTrackingClamp(normalized, precisionScale, !!product.trackInventory),
			};
		}
	}

	if (typeof product.onHandCached === "number" && Number.isFinite(product.onHandCached)) {
		const base = product.onHandCached.toFixed(precisionScale);
		return {
			precisionScale,
			display: applyInventoryTrackingClamp(base, precisionScale, !!product.trackInventory),
		};
	}

	if (typeof product.onHandCached === "string") {
		const normalized = normalizeDecimalString(product.onHandCached, precisionScale);
		if (normalized) {
			return {
				precisionScale,
				display: applyInventoryTrackingClamp(normalized, precisionScale, !!product.trackInventory),
			};
		}
		const n = Number(product.onHandCached);
		if (Number.isFinite(n)) {
			const base = n.toFixed(precisionScale);
			return {
				precisionScale,
				display: applyInventoryTrackingClamp(base, precisionScale, !!product.trackInventory),
			};
		}
	}

	return {
		precisionScale,
		display: applyInventoryTrackingClamp(zero, precisionScale, !!product.trackInventory),
	};
}

function formatMoneyLike(value: unknown): string | null {
	if (typeof value === "number" && Number.isFinite(value)) return value.toFixed(2);
	if (typeof value === "string") {
		const n = Number(value);
		if (Number.isFinite(n)) return n.toFixed(2);
	}
	return null;
}

function formatMoneyWithCurrency(value: unknown, currencyCode: string): string | null {
	const base = formatMoneyLike(value);
	if (!base) return null;
	return formatMoney({ amount: base, currencyCode });
}

function formatCompactCount(value: number, countryCode?: string | null): string {
	return formatCompactNumber(value, countryCode);
}

function formatProductTypeLabel(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	const normalized = trimmed.toUpperCase();
	if (normalized === "PHYSICAL" || normalized === "ITEM") return "ITEM";
	if (normalized === "SERVICE") return "SERVICE";
	return trimmed.toUpperCase();
}

function normalizeInventoryStatusTab(value: unknown): InventoryStatusTabValue {
	if (typeof value !== "string") return "ACTIVE";
	return value.trim().toUpperCase() === "ARCHIVED" ? "ARCHIVED" : "ACTIVE";
}

function normalizeHealthTabValue(filter: ReturnType<typeof normalizeInventoryHealthFilter>): InventoryHealthTabValue {
	if (!filter) return "ALL";
	return filter;
}

function filterByStatusTab(items: InventoryProduct[], status: InventoryStatusTabValue): InventoryProduct[] {
	if (status === "ARCHIVED") return items.filter((item) => item.isActive === false);
	return items.filter((item) => item.isActive !== false);
}

function DetailMetaRow({
	label,
	children,
	borderColor,
	isLast = false,
}: {
	label: string;
	children: React.ReactNode;
	borderColor: string;
	isLast?: boolean;
}) {
	return (
		<View style={[!isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: borderColor }]}>
			<BAIText variant='caption' muted style={styles.metaLabel}>
				{label}
			</BAIText>
			{children}
		</View>
	);
}

export default function InventoryTabletScreen({ routeScope = "inventory" }: { routeScope?: InventoryRouteScope }) {
	const router = useRouter();
	const theme = useTheme();
	const borderColor = theme.colors.outlineVariant ?? theme.colors.outline;
	const surfaceAlt = (theme.colors.surfaceVariant ?? theme.colors.surface) as string;
	const { currencyCode, countryCode } = useActiveBusinessMeta();
	const toScopedRoute = useCallback((route: string) => mapInventoryRouteToScope(route, routeScope), [routeScope]);

	const params = useLocalSearchParams<{ q?: string; filter?: string; status?: string; type?: string }>();
	const paramQ = useMemo(() => String(params.q ?? "").trim(), [params.q]);
	const activeFilter = useMemo(() => normalizeInventoryHealthFilter(params.filter), [params.filter]);
	const statusTabValue = useMemo(() => normalizeInventoryStatusTab(params.status), [params.status]);
	const sellableTabValue: InventorySellableTabValue = useMemo(() => normalizeSellableTab(params.type), [params.type]);

	const [q, setQ] = useState(paramQ);
	const [selectedId, setSelectedId] = useState<string>("");
	const [isRefreshing, setIsRefreshing] = useState(false);

	useEffect(() => setQ(paramQ), [paramQ]);

	const { canNavigate, safePush } = useNavLock({ lockMs: 650 });

	const trimmedQ = useMemo(() => q.trim(), [q]);
	const [debouncedQ, setDebouncedQ] = useState(trimmedQ);

	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedQ(trimmedQ);
		}, SEARCH_DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [trimmedQ]);

	const showHealthTabs = sellableTabValue === "ITEMS";
	const healthTabValue = normalizeHealthTabValue(activeFilter);
	const hasHealthFilter = showHealthTabs && healthTabValue !== "ALL";

	const productsQuery = useQuery({
		queryKey: inventoryKeys.products(debouncedQ, { includeArchived: true }),
		queryFn: () => inventoryApi.listProducts({ q: debouncedQ || undefined, includeArchived: true, limit: 100 }),
		staleTime: 30_000,
	});

	const unitsQuery = useQuery<Unit[]>({
		queryKey: unitsKeys.list({ includeArchived: false }),
		queryFn: () => unitsApi.listUnits({ includeArchived: false }),
		staleTime: 30_000,
	});

	const unitsById = useMemo(() => {
		const map = new Map<string, Unit>();
		(unitsQuery.data ?? []).forEach((u) => map.set(u.id, u));
		return map;
	}, [unitsQuery.data]);

	const categoriesQuery = useQuery<{ items: Category[] }>({
		queryKey: categoryKeys.list({ limit: 250 }),
		queryFn: () => categoriesApi.list({ limit: 250 }),
		staleTime: 30_000,
	});

	const categoryMetaById = useMemo(() => {
		const map = new Map<string, { isActive: boolean; color?: string | null }>();
		(categoriesQuery.data?.items ?? []).forEach((category) => {
			map.set(category.id, { isActive: category.isActive, color: category.color ?? null });
		});
		return map;
	}, [categoriesQuery.data?.items]);

	const allItems = useMemo<InventoryProduct[]>(() => productsQuery.data?.items ?? [], [productsQuery.data?.items]);
	const allItemItems = useMemo(() => filterBySellableTab(allItems, "ITEMS"), [allItems]);
	const allServiceItems = useMemo(() => filterBySellableTab(allItems, "SERVICES"), [allItems]);

	const sellableItems = useMemo(() => filterBySellableTab(allItems, sellableTabValue), [allItems, sellableTabValue]);
	const activeSellableItems = useMemo(() => filterByStatusTab(sellableItems, "ACTIVE"), [sellableItems]);
	const archivedSellableItems = useMemo(() => filterByStatusTab(sellableItems, "ARCHIVED"), [sellableItems]);
	const sellableTabs = useMemo(
		() =>
			INVENTORY_SELLABLE_TAB_BASE.map((tab) => ({
				...tab,
				count: tab.value === "ITEMS" ? allItemItems.length : allServiceItems.length,
			})),
		[allItemItems.length, allServiceItems.length],
	);
	const statusTabs = useMemo(
		() =>
			INVENTORY_STATUS_TAB_BASE.map((tab) => ({
				...tab,
				count: tab.value === "ACTIVE" ? activeSellableItems.length : archivedSellableItems.length,
			})),
		[activeSellableItems.length, archivedSellableItems.length],
	);
	const statusFilteredItems = useMemo(
		() => filterByStatusTab(sellableItems, statusTabValue),
		[sellableItems, statusTabValue],
	);

	const itemsForHealth = useMemo(
		() => (showHealthTabs ? statusFilteredItems : []),
		[showHealthTabs, statusFilteredItems],
	);
	const healthCounts = useMemo(() => getInventoryHealthCounts(itemsForHealth), [itemsForHealth]);
	const inStockCount = useMemo(
		() =>
			itemsForHealth.filter(
				(item) => item.trackInventory && !isOutOfStock(item) && (!hasReorderPoint(item) || isStockHealthy(item)),
			).length,
		[itemsForHealth],
	);
	const healthTabs: readonly BAIGroupTab<InventoryHealthTabValue>[] = useMemo(
		() => [
			{ label: "All", value: "ALL", count: itemsForHealth.length },
			{ label: "In", value: "healthy", count: inStockCount },
			{ label: "Low", value: "low", count: healthCounts.low },
			{ label: "Out", value: "out", count: healthCounts.out },
		],
		[itemsForHealth.length, healthCounts.low, healthCounts.out, inStockCount],
	);

	const filteredItems = useMemo(() => {
		if (sellableTabValue === "SERVICES") return statusFilteredItems;
		return filterInventoryItems(statusFilteredItems, activeFilter);
	}, [activeFilter, sellableTabValue, statusFilteredItems]);

	const createRoute = useMemo(() => {
		if (routeScope === "settings-items-services") {
			return sellableTabValue === "SERVICES"
				? toScopedRoute("/(app)/(tabs)/inventory/services/create")
				: toScopedRoute("/(app)/(tabs)/inventory/products/create");
		}
		return toScopedRoute("/(app)/(tabs)/inventory/add-item");
	}, [routeScope, sellableTabValue, toScopedRoute]);
	const onPressCreate = useCallback(() => {
		if (!canNavigate) return;
		safePush(router, createRoute);
	}, [canNavigate, createRoute, router, safePush]);

	useEffect(() => {
		if (sellableTabValue === "SERVICES") {
			if (selectedId) setSelectedId("");
			return;
		}
		if (filteredItems.length === 0) {
			if (selectedId) setSelectedId("");
			return;
		}
		if (!selectedId) setSelectedId(filteredItems[0].id);
		else if (!filteredItems.some((p) => p.id === selectedId)) setSelectedId(filteredItems[0].id);
	}, [filteredItems, selectedId, sellableTabValue]);

	const onRefresh = useCallback(() => {
		if (isRefreshing) return;
		setIsRefreshing(true);
		productsQuery.refetch().finally(() => setIsRefreshing(false));
	}, [isRefreshing, productsQuery]);

	const onSetSellable = useCallback(
		(v: InventorySellableTabValue) => {
			if (!canNavigate) return;
			if (v === "SERVICES") {
				router.setParams({ type: "SERVICES", filter: undefined });
				return;
			}
			router.setParams({ type: undefined });
		},
		[canNavigate, router],
	);

	const onSetStatus = useCallback(
		(v: InventoryStatusTabValue) => {
			if (!canNavigate) return;
			if (v === "ACTIVE") {
				router.setParams({ status: undefined });
				return;
			}
			router.setParams({ status: "ARCHIVED" });
		},
		[canNavigate, router],
	);

	const onSetHealthTab = useCallback(
		(v: InventoryHealthTabValue) => {
			if (!canNavigate) return;
			if (v === "ALL") {
				router.setParams({ filter: undefined });
				return;
			}
			router.setParams({ filter: v });
		},
		[canNavigate, router],
	);

	const detailQuery = useQuery<InventoryProductDetail>({
		queryKey: inventoryKeys.productDetail(selectedId),
		queryFn: () => inventoryApi.getProductDetail(selectedId),
		enabled: !!selectedId,
		staleTime: 30_000,
	});

	const movementsQuery = useQuery<{ items: InventoryMovement[] }>({
		queryKey: inventoryKeys.movements(selectedId, 10),
		queryFn: async () => {
			const data = await inventoryApi.listMovements(selectedId, { limit: 10 });
			return { items: data.items };
		},
		enabled: !!selectedId,
		staleTime: 30_000,
	});

	const typeLabel = useMemo(() => formatProductTypeLabel(detailQuery.data?.type), [detailQuery.data?.type]);

	const detailCategoryId = detailQuery.data?.category?.id ?? detailQuery.data?.categoryId ?? "";
	const detailCategoryIsActive = useMemo(() => {
		if (detailCategoryId && categoryMetaById.has(detailCategoryId)) {
			return categoryMetaById.get(detailCategoryId)?.isActive;
		}
		return detailQuery.data?.category?.isActive;
	}, [categoryMetaById, detailCategoryId, detailQuery.data?.category?.isActive]);

	const detailCategoryColor = useMemo(() => {
		if (detailCategoryId && categoryMetaById.has(detailCategoryId)) {
			return categoryMetaById.get(detailCategoryId)?.color ?? null;
		}
		return detailQuery.data?.category?.color ?? null;
	}, [categoryMetaById, detailCategoryId, detailQuery.data?.category?.color]);

	const detailMeta = useMemo(() => {
		const data = detailQuery.data;
		const rawCategoryName = data?.category?.name;
		const trimmedCategoryName = typeof rawCategoryName === "string" ? rawCategoryName.trim() : "";
		const normalizedCategoryName = trimmedCategoryName.toLowerCase();
		const hasCategory = trimmedCategoryName.length > 0 && normalizedCategoryName !== "none";
		const categoryName = hasCategory ? trimmedCategoryName : "None";
		const sku = data?.sku?.trim() || "";
		const barcode = data?.barcode?.trim() || "";
		const priceLabel = formatMoneyWithCurrency(data?.price, currencyCode);
		const costLabel = formatMoneyWithCurrency(data?.cost, currencyCode);

		return {
			categoryName,
			hasCategory,
			sku: sku || "-",
			barcode: barcode || "-",
			priceLabel: priceLabel || "-",
			costLabel: costLabel || "-",
		};
	}, [currencyCode, detailQuery.data]);

	const detailOnHandLabel = useMemo(() => {
		if (!detailQuery.data) return "—";
		return formatOnHand(detailQuery.data as any);
	}, [detailQuery.data]);
	const detailIsArchived = detailQuery.data?.isActive === false;

	const categoryDotStyle = useMemo(() => {
		const fill = detailCategoryColor ? detailCategoryColor : "transparent";
		const stroke = detailCategoryColor ? detailCategoryColor : borderColor;
		return {
			backgroundColor: fill,
			borderColor: stroke,
		};
	}, [borderColor, detailCategoryColor]);

	const inactiveBadgeStyle = useMemo(
		() => ({
			backgroundColor: theme.colors.surfaceVariant ?? theme.colors.surface,
			borderColor: theme.colors.outlineVariant ?? theme.colors.outline,
		}),
		[theme.colors.outlineVariant, theme.colors.outline, theme.colors.surface, theme.colors.surfaceVariant],
	);

	const entityLabel = sellableTabValue === "SERVICES" ? "Services" : "Items";
	const emptyTitle =
		statusTabValue === "ARCHIVED"
			? `No Archived ${entityLabel}`
			: activeFilter && sellableTabValue === "ITEMS"
				? inventoryHealthFilterEmptyLabel(activeFilter)
				: trimmedQ
					? `No Matching ${entityLabel}`
					: `No ${entityLabel} Yet`;
	const emptyBody =
		statusTabValue === "ARCHIVED"
			? `Archived ${entityLabel.toLowerCase()} will appear here.`
			: activeFilter && sellableTabValue === "ITEMS"
				? "Adjust Item Settings Or Clear The Filter To See All Active Inventory."
				: trimmedQ
					? "Try Adjusting Your Search Or Scan A Different Barcode."
					: sellableTabValue === "SERVICES"
						? "Add Your First Service To Start Selling Services."
						: "Add Your First Item To Start Tracking Inventory.";

	const syncLabel = productsQuery.isFetching ? "Syncing…" : "Synced";
	const isInitialLoading = productsQuery.isLoading && allItems.length === 0;
	const isInitialError = !!productsQuery.isError && allItems.length === 0;
	const showPrimaryEmptyCta =
		statusTabValue === "ACTIVE" &&
		!trimmedQ &&
		!hasHealthFilter &&
		filteredItems.length === 0 &&
		!productsQuery.isError;

	const renderInventoryRow = useCallback(
		({ item }: { item: InventoryProduct }) => {
			const categoryId = item.category?.id ?? item.categoryId ?? "";
			const categoryMeta = categoryId && categoryMetaById.has(categoryId) ? categoryMetaById.get(categoryId) : null;
			const categoryIsActive = categoryMeta?.isActive ?? item.category?.isActive ?? undefined;
			const categoryColor = categoryMeta?.color ?? item.category?.color ?? null;
			const { precisionScale, display } = formatOnHandDisplay(item, unitsById);
			const rowItem: InventoryProduct = {
				...item,
				unitPrecisionScale: precisionScale,
				onHandCachedRaw: display,
			};
			const isRowService = isService(item);
			const onPressRow = () => {
				if (!canNavigate) return;
				if (sellableTabValue === "SERVICES" || isRowService) {
					safePush(router, toScopedRoute(`/(app)/(tabs)/inventory/services/${encodeURIComponent(item.id)}`));
					return;
				}
				setSelectedId(item.id);
			};

			return (
				<InventoryRow
					item={rowItem}
					active={item.id === selectedId}
					categoryIsActive={categoryIsActive}
					categoryColor={categoryColor}
					showOnHandUnit={false}
					onPress={onPressRow}
					disabled={!canNavigate}
				/>
			);
		},
		[canNavigate, categoryMetaById, router, safePush, selectedId, sellableTabValue, toScopedRoute, unitsById],
	);

	const movementCountLabel = useMemo(() => {
		if (movementsQuery.isLoading) return "Loading";
		const count = movementsQuery.data?.items?.length ?? 0;
		if (count === 1) return "1 Movement";
		return `${formatCompactCount(count, countryCode)} Movements`;
	}, [countryCode, movementsQuery.data?.items?.length, movementsQuery.isLoading]);

	return (
		<BAIScreen
			tabbed
			padded={false}
			safeTop={routeScope !== "settings-items-services"}
			safeBottom={false}
			safeAreaGradientBottom
			style={styles.root}
		>
			<View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
				<BAIGovernedScrollableLayout
					top={
						<View style={styles.fixedTopZone}>
							<View style={styles.heroRow}>
								<View style={styles.heroLeft}>
									<View style={styles.titleRow}>
										<BAIText variant='title' muted>
											Inventory
										</BAIText>
										<View style={[styles.syncBadge, { borderColor, backgroundColor: surfaceAlt }]}>
											<BAIText variant='caption' style={styles.syncBadgeText}>
												{syncLabel}
											</BAIText>
										</View>
									</View>
									<BAIText variant='body' muted>
										Items and services
									</BAIText>
								</View>

								<View style={styles.heroRight}>
									<BAIButton
										widthPreset='standard'
										mode='contained'
										onPress={onPressCreate}
										disabled={!canNavigate}
										style={styles.addButton}
									>
										{sellableTabValue === "SERVICES" ? "Create service" : "Create item"}
									</BAIButton>
								</View>
							</View>

							<InventorySearchBar
								value={q}
								onChangeText={setQ}
								onSubmit={() => setQ((v) => v.trim())}
								onPressScan={() => safePush(router, toScopedRoute("/(app)/(tabs)/inventory/scan"))}
								scanEnabled={canNavigate && sellableTabValue === "ITEMS"}
								disabled={false}
							/>

							<View style={styles.filterPanel}>
								<View style={styles.tabsInlineRow}>
									<View style={styles.tabsInlineItem}>
										<BAIGroupTabs<InventorySellableTabValue>
											tabs={sellableTabs}
											value={sellableTabValue}
											onChange={onSetSellable}
											disabled={!canNavigate}
											countFormatter={(count) => formatCompactCount(count, countryCode)}
										/>
									</View>

									<View style={styles.tabsInlineItem}>
										<BAIGroupTabs<InventoryStatusTabValue>
											tabs={statusTabs}
											value={statusTabValue}
											onChange={onSetStatus}
											disabled={!canNavigate}
											countFormatter={(count) => formatCompactCount(count, countryCode)}
										/>
									</View>
								</View>

								{showHealthTabs ? (
									<View style={styles.tabsRowTight}>
										<BAIGroupTabs<InventoryHealthTabValue>
											tabs={healthTabs}
											value={healthTabValue}
											onChange={onSetHealthTab}
											disabled={!canNavigate}
											countFormatter={(count) => formatCompactCount(count, countryCode)}
										/>
									</View>
								) : null}
							</View>
						</View>
					}
					scrollArea={
						<View style={styles.content}>
							<View style={styles.workspace}>
								<BAISurface style={styles.leftPane} padded={false} radius={20}>
									{isInitialLoading ? (
										<View style={styles.center}>
											<BAIText variant='body' muted>
												Loading inventory...
											</BAIText>
										</View>
									) : isInitialError ? (
										<View style={styles.center}>
											<BAIText variant='subtitle'>Could not load inventory.</BAIText>
											<BAIText variant='body' muted style={styles.centerText}>
												Check your connection and retry.
											</BAIText>
											<View style={styles.retryWrap}>
												<BAIRetryButton mode='contained' variant='outline' onPress={onRefresh}>
													Retry
												</BAIRetryButton>
											</View>
										</View>
									) : (
										<FlatList
											data={filteredItems}
											keyExtractor={(p) => p.id}
											contentContainerStyle={[
												styles.listContent,
												filteredItems.length === 0 ? styles.listContentEmpty : null,
											]}
											style={styles.list}
											showsVerticalScrollIndicator={false}
											showsHorizontalScrollIndicator={false}
											refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
											renderItem={renderInventoryRow}
											ItemSeparatorComponent={() => <View style={styles.itemGap} />}
											ListEmptyComponent={
												<View style={styles.emptyState}>
													<BAIText variant='subtitle' style={styles.emptyStateTitle}>
														{emptyTitle}
													</BAIText>
													<BAIText variant='body' muted style={styles.emptyStateBody}>
														{emptyBody}
													</BAIText>
													{showPrimaryEmptyCta ? (
														<View style={styles.emptyCtaWrap}>
															<BAIEmptyStateButton
																mode='contained'
																shape='pill'
																label={sellableTabValue === "SERVICES" ? "Create service" : "Create item"}
																onPress={onPressCreate}
															/>
														</View>
													) : null}
												</View>
											}
											keyboardShouldPersistTaps='handled'
										/>
									)}
								</BAISurface>

								<BAISurface style={styles.rightPane} padded>
									<View style={styles.rightPaneContent}>
										{!selectedId ? (
											<View style={styles.center}>
												<BAIText variant='body' muted>
													{sellableTabValue === "SERVICES" ? "Select A Service To Open." : "Select An Item To Preview."}
												</BAIText>
											</View>
										) : detailQuery.isLoading ? (
											<View style={styles.center}>
												<BAIText variant='body' muted>
													Loading Item…
												</BAIText>
											</View>
										) : detailQuery.isError ? (
											<View style={styles.center}>
												<BAIText variant='body'>Failed To Load Item.</BAIText>
											</View>
										) : (
											<>
												<View style={styles.detailHeroRow}>
													<View style={styles.detailHeroLeft}>
														<BAIText variant='caption' muted>
															Item
														</BAIText>
														<BAIText variant='title' numberOfLines={1}>
															{detailQuery.data?.name ?? "Item"}
														</BAIText>

														{typeLabel ? (
															<BAIText variant='caption' muted>
																Type: {typeLabel}
															</BAIText>
														) : null}
													</View>

													<View style={styles.detailHeroRight}>
														<BAIText variant='caption' muted>
															On Hand
														</BAIText>
														<BAIText variant='subtitle' style={styles.onHandValue}>
															{detailOnHandLabel}
														</BAIText>
													</View>
												</View>

												<View style={[styles.metaPanel, { borderColor }]}>
													<DetailMetaRow label='Category' borderColor={borderColor}>
														<View style={styles.metaInline}>
															{detailMeta.hasCategory ? <View style={[styles.categoryDot, categoryDotStyle]} /> : null}
															<BAIText variant='body'>{detailMeta.categoryName}</BAIText>
															{detailMeta.hasCategory && detailCategoryIsActive === false ? (
																<View style={[styles.inactiveBadge, inactiveBadgeStyle]}>
																	<BAIText
																		variant='caption'
																		style={[
																			styles.inactiveBadgeText,
																			{ color: theme.colors.onSurfaceVariant ?? theme.colors.onSurface },
																		]}
																	>
																		Inactive
																	</BAIText>
																</View>
															) : null}
														</View>
													</DetailMetaRow>

													<DetailMetaRow label='SKU' borderColor={borderColor}>
														<BAIText variant='body'>{detailMeta.sku}</BAIText>
													</DetailMetaRow>

													<DetailMetaRow label='Barcode' borderColor={borderColor}>
														<BAIText variant='body'>{detailMeta.barcode}</BAIText>
													</DetailMetaRow>

													<DetailMetaRow label='Price' borderColor={borderColor}>
														<BAIText variant='body'>{detailMeta.priceLabel}</BAIText>
													</DetailMetaRow>

													<DetailMetaRow label='Cost' borderColor={borderColor} isLast>
														<BAIText variant='body'>{detailMeta.costLabel}</BAIText>
													</DetailMetaRow>
												</View>

												<View style={styles.actions}>
													<BAIButton
														intent='neutral'
														variant='outline'
														onPress={() =>
															safePush(
																router,
																toScopedRoute(
																	`/(app)/(tabs)/inventory/products/${encodeURIComponent(selectedId)}/adjust`,
																),
															)
														}
														disabled={!canNavigate || detailIsArchived}
														style={styles.actionBtn}
														widthPreset='standard'
													>
														Adjust
													</BAIButton>

													<BAIButton
														intent='primary'
														variant='solid'
														onPress={() =>
															safePush(
																router,
																toScopedRoute(`/(app)/(tabs)/inventory/products/${encodeURIComponent(selectedId)}`),
															)
														}
														disabled={!canNavigate}
														widthPreset='standard'
														style={styles.actionBtn}
													>
														Open
													</BAIButton>
												</View>

												<View style={[styles.sectionHeader, { borderBottomColor: borderColor }]}>
													<View style={styles.sectionHeaderText}>
														<BAIText variant='subtitle'>Recent Movements</BAIText>
														<BAIText variant='caption' muted>
															Latest Activity For This Item.
														</BAIText>
													</View>
													<View style={[styles.countPill, { borderColor, backgroundColor: surfaceAlt }]}>
														<BAIText variant='caption' muted>
															{movementCountLabel}
														</BAIText>
													</View>
												</View>

												<View style={styles.sectionBody}>
													{movementsQuery.isLoading ? (
														<View style={styles.centerSmall}>
															<BAIText variant='body' muted>
																Loading Movements…
															</BAIText>
														</View>
													) : movementsQuery.isError ? (
														<View style={styles.centerSmall}>
															<BAIText variant='body'>Failed To Load Movements.</BAIText>
														</View>
													) : (movementsQuery.data?.items?.length ?? 0) === 0 ? (
														<BAIText variant='body' muted>
															No Recent Movements.
														</BAIText>
													) : (
														<View style={{ gap: 10 }}>
															{movementsQuery.data!.items.map((m) => (
																<InventoryMovementRow
																	key={m.id}
																	movement={m}
																	compact
																	precisionScale={
																		(detailQuery.data as any)?.unitPrecisionScale ??
																		(detailQuery.data as any)?.unit?.precisionScale
																	}
																	unit={detailQuery.data as any}
																/>
															))}
														</View>
													)}
												</View>
											</>
										)}
									</View>
								</BAISurface>
							</View>
						</View>
					}
				/>
			</View>
		</BAIScreen>
	);
}

const styles = StyleSheet.create({
	root: { flex: 1 },
	screen: { flex: 1, minHeight: 0, paddingHorizontal: 12, paddingBottom: 12, paddingTop: 0, gap: 0 },
	fixedTopZone: { paddingTop: 10, paddingBottom: 8, gap: 8 },

	heroRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 16 },
	heroLeft: { flex: 1, minWidth: 0, gap: 4 },
	heroRight: { alignItems: "flex-end", gap: 6 },
	titleRow: {
		flexDirection: "row",
		alignItems: "center",
		gap: 8,
		flexWrap: "wrap",
	},
	addButton: { minWidth: 150 },
	syncBadge: {
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: 999,
		paddingHorizontal: 8,
		paddingVertical: 3,
	},
	syncBadgeText: {
		fontWeight: "600",
	},

	content: { flex: 1, minHeight: 0 },
	workspace: { flex: 1, minHeight: 0, flexDirection: "row", gap: 12 },

	leftPane: { flex: 1.05, marginBottom: 0, overflow: "hidden" },
	rightPane: { flex: 1 },
	rightPaneContent: { flex: 1, overflow: "hidden" },

	center: { flex: 1, padding: 16, alignItems: "center", justifyContent: "center" },
	centerText: { marginTop: 8, textAlign: "center" },
	retryWrap: { marginTop: 12 },
	centerSmall: { padding: 12, alignItems: "center", justifyContent: "center" },

	list: { flex: 1, minHeight: 0 },
	filterPanel: { paddingHorizontal: 12, paddingVertical: 12, gap: 8 },
	tabsInlineRow: {
		flexDirection: "row",
		alignItems: "center",
		gap: 8,
	},
	tabsInlineItem: {
		flex: 1,
		minWidth: 0,
	},
	tabsRowTight: { marginTop: 2 },
	listContent: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 12 },
	listContentEmpty: { flexGrow: 1 },
	itemGap: { height: 12 },
	emptyState: {
		flex: 1,
		minHeight: 320,
		alignItems: "center",
		justifyContent: "center",
		paddingHorizontal: 20,
		paddingBottom: 28,
	},
	emptyStateTitle: { textAlign: "center" },
	emptyStateBody: { textAlign: "center", marginTop: 8, maxWidth: 360 },
	emptyCtaWrap: { marginTop: 14 },

	detailHeroRow: {
		flexDirection: "row",
		alignItems: "flex-start",
		justifyContent: "space-between",
		gap: 16,
	},
	detailHeroLeft: {
		flex: 1,
		minWidth: 0,
		gap: 4,
	},
	detailHeroRight: {
		alignItems: "flex-end",
		gap: 4,
	},
	onHandValue: {
		fontWeight: "700",
	},
	metaPanel: {
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: 16,
		overflow: "hidden",
		marginTop: 12,
	},
	metaRow: {
		flexDirection: "row",
		alignItems: "center",
		paddingHorizontal: 12,
		paddingVertical: 10,
		gap: 8,
	},
	metaLabel: {
		width: 86,
	},
	metaValueRow: {
		flex: 1,
		minWidth: 0,
	},
	metaInline: {
		flexDirection: "row",
		alignItems: "center",
		gap: 8,
		flex: 1,
		minWidth: 0,
	},
	categoryDot: {
		width: 12,
		height: 12,
		borderRadius: 9,
		borderWidth: 1,
	},
	inactiveBadge: {
		borderWidth: 1,
		borderRadius: 999,
		paddingHorizontal: 8,
		paddingVertical: 2,
	},
	inactiveBadgeText: {
		fontSize: 11,
	},
	actions: { marginTop: 12, flexDirection: "row", gap: 10, justifyContent: "flex-end" },

	sectionHeader: {
		marginTop: 14,
		paddingTop: 10,
		paddingBottom: 10,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		borderBottomWidth: StyleSheet.hairlineWidth,
	},
	sectionHeaderText: {
		flex: 1,
		minWidth: 0,
		gap: 2,
	},
	countPill: {
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: 999,
		paddingHorizontal: 10,
		paddingVertical: 6,
	},
	sectionBody: { paddingTop: 12 },
	actionBtn: { minWidth: 180 },
});
