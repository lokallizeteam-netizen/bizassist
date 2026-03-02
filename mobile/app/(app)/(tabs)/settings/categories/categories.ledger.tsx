// BizAssist_mobile
// path: app/(app)/(tabs)/settings/categories/categories.ledger.tsx
//
// Header governance:
// - This is a Settings detail/workspace screen -> use BACK (not Exit).
// - Back follows navigation history (stack back).

import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import { FlatList, Keyboard, StyleSheet, TouchableWithoutFeedback, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useTheme } from "react-native-paper";

import { BAIActivityIndicator } from "@/components/system/BAIActivityIndicator";
import { BAIButton } from "@/components/ui/BAIButton";
import { BAIGroupTabs, type BAIGroupTab } from "@/components/ui/BAIGroupTabs";
import { BAIPressableRow } from "@/components/ui/BAIPressableRow";
import { BAIRetryButton } from "@/components/ui/BAIRetryButton";
import { BAIScreen } from "@/components/ui/BAIScreen";
import { BAISurface } from "@/components/ui/BAISurface";
import { BAISearchBar } from "@/components/ui/BAISearchBar";
import { BAIText } from "@/components/ui/BAIText";
import { SettingsScreenLayout, SettingsSectionTitle } from "@/components/settings/SettingsLayout";

import { useAppBusy } from "@/hooks/useAppBusy";
import { categoriesApi } from "@/modules/categories/categories.api";
import { useCategoryVisibilityQuery } from "@/modules/categories/categories.queries";
import { categoryKeys } from "@/modules/categories/categories.queryKeys";
import type { Category } from "@/modules/categories/categories.types";
import { CategoryRow } from "@/modules/categories/components/CategoryRow";
import { useActiveBusinessMeta } from "@/modules/business/useActiveBusinessMeta";
import { useAppHeader } from "@/modules/navigation/useAppHeader";
import { useInventoryHeader } from "@/modules/inventory/useInventoryHeader";
import { formatCompactNumber } from "@/lib/locale/businessLocale";
import { FIELD_LIMITS } from "@/shared/fieldLimits";
import { sanitizeSearchInput } from "@/shared/validation/sanitize";

type CategoriesLedgerLayout = "phone" | "tablet";
type CategoriesLedgerMode = "settings" | "inventory";
type CategoryFilter = "all" | "active" | "archived";

const SETTINGS_CATEGORIES_VISIBILITY_ROUTE = "/(app)/(tabs)/settings/categories/visibility" as const;
const SETTINGS_ROUTE = "/(app)/(tabs)/settings" as const;
const SETTINGS_CATEGORY_CREATE_ROUTE = "/(app)/(tabs)/settings/categories/create" as const;
const INVENTORY_ROUTE = "/(app)/(tabs)/inventory" as const;
const INVENTORY_CATEGORY_CREATE_ROUTE = "/(app)/(tabs)/inventory/categories/create" as const;
const ROOT_ROUTE_BY_MODE: Record<CategoriesLedgerMode, string> = {
	settings: SETTINGS_ROUTE,
	inventory: INVENTORY_ROUTE,
};
const CATEGORY_CREATE_ROUTE_BY_MODE: Record<CategoriesLedgerMode, string> = {
	settings: SETTINGS_CATEGORY_CREATE_ROUTE,
	inventory: INVENTORY_CATEGORY_CREATE_ROUTE,
};
const CATEGORY_TAB_BASE: BAIGroupTab<CategoryFilter>[] = [
	{ label: "Active", value: "active" },
	{ label: "Archived", value: "archived" },
	{ label: "All", value: "all" },
];

function formatCompactCount(value: number, countryCode?: string | null): string {
	return formatCompactNumber(value, countryCode);
}

export function CategoriesLedgerScreen({
	layout,
	mode,
}: {
	layout: CategoriesLedgerLayout;
	mode: CategoriesLedgerMode;
}) {
	const router = useRouter();
	const theme = useTheme();
	const { countryCode } = useActiveBusinessMeta();
	const { busy } = useAppBusy();
	const isBusy = !!busy?.isBusy;
	const isTablet = layout === "tablet";

	const tabBarHeight = useBottomTabBarHeight();
	const TAB_KISS_GAP = 12;
	const screenBottomPad = tabBarHeight + TAB_KISS_GAP;

	const [qText, setQText] = useState("");
	const q = qText.trim();
	const hasSearch = q.length > 0;

	const [filter, setFilter] = useState<CategoryFilter>("active");
	const [highlightId, setHighlightId] = useState<string>("");

	const navLockRef = useRef(false);
	const lockNav = useCallback((ms = 650) => {
		if (navLockRef.current) return false;
		navLockRef.current = true;
		setTimeout(() => {
			navLockRef.current = false;
		}, ms);
		return true;
	}, []);

	const isUiDisabled = isBusy;
	const contentMaxWidth = isTablet ? 1100 : undefined;

	const queryParams = useMemo(() => ({ q: q || undefined, limit: 250 }), [q]);
	const query = useQuery<{ items: Category[] }>({
		queryKey: categoryKeys.list(queryParams),
		queryFn: () => categoriesApi.list(queryParams),
		staleTime: 300_000,
	});

	const items = useMemo(() => query.data?.items ?? [], [query.data?.items]);
	const visibilityQuery = useCategoryVisibilityQuery();
	const hiddenCategoryIds = visibilityQuery.hiddenCategoryIds;
	const activeItems = useMemo(() => items.filter((c) => c.isActive !== false), [items]);
	const archivedItems = useMemo(() => items.filter((c) => c.isActive === false), [items]);
	const categoryCounts = useMemo(
		() => ({
			all: items.length,
			active: activeItems.length,
			archived: archivedItems.length,
		}),
		[activeItems.length, archivedItems.length, items.length],
	);
	const categoryTabs = useMemo(
		() =>
			CATEGORY_TAB_BASE.map((tab) => ({
				...tab,
				count: categoryCounts[tab.value],
			})),
		[categoryCounts],
	);
	const mutedIconColor = theme.colors.onSurfaceVariant ?? theme.colors.onSurface;
	const hiddenActiveCount = useMemo(
		() => activeItems.filter((item) => hiddenCategoryIds.has(item.id)).length,
		[activeItems, hiddenCategoryIds],
	);
	const visibilityRowValue = visibilityQuery.isLoading
		? "Loading visibility..."
		: visibilityQuery.isError
			? "Visibility unavailable"
			: hiddenActiveCount > 0
				? `${formatCompactCount(hiddenActiveCount, countryCode)} hidden. Hide or restore categories.`
				: "Hide or restore categories.";

	const filteredItems = useMemo(() => {
		if (filter === "active") return activeItems;
		if (filter === "archived") return archivedItems;
		return items;
	}, [activeItems, archivedItems, filter, items]);
	const hasAnyFiltered = filteredItems.length > 0;

	const onClearSearch = useCallback(() => {
		Keyboard.dismiss();
		setQText("");
	}, []);

	const onOpenDetails = useCallback(
		(cat: Category) => {
			Keyboard.dismiss();
			if (isUiDisabled) return;
			if (!lockNav()) return;

			setHighlightId(cat.id);
			router.push(
				(mode === "settings"
					? `/(app)/(tabs)/settings/categories/${encodeURIComponent(cat.id)}`
					: `/(app)/(tabs)/inventory/categories/${encodeURIComponent(cat.id)}`) as any,
			);
		},
		[isUiDisabled, lockNav, mode, router],
	);

	const onCreate = useCallback(() => {
		Keyboard.dismiss();
		if (isUiDisabled) return;
		if (!lockNav()) return;
		router.push(CATEGORY_CREATE_ROUTE_BY_MODE[mode] as any);
	}, [isUiDisabled, lockNav, mode, router]);

	const onCancel = useCallback(() => {
		Keyboard.dismiss();
		if (isUiDisabled) return;
		if (!lockNav()) return;
		router.replace(ROOT_ROUTE_BY_MODE[mode] as any);
	}, [isUiDisabled, lockNav, mode, router]);

	const onBack = useCallback(() => {
		Keyboard.dismiss();
		if (isUiDisabled) return;
		if (!lockNav()) return;
		if (router.canGoBack?.()) {
			router.back();
			return;
		}
		router.replace(ROOT_ROUTE_BY_MODE[mode] as any);
	}, [isUiDisabled, lockNav, mode, router]);

	const onPressVisibility = useCallback(() => {
		Keyboard.dismiss();
		if (isUiDisabled) return;
		if (!lockNav()) return;
		router.push(SETTINGS_CATEGORIES_VISIBILITY_ROUTE as any);
	}, [isUiDisabled, lockNav, router]);

	const borderColor = theme.colors.outlineVariant ?? theme.colors.outline;
	const settingsHeaderOptions = useAppHeader("detail", { title: "Manage Categories", disabled: isUiDisabled, onBack });
	const inventoryHeaderOptions = useInventoryHeader("detail", {
		title: "Manage Categories",
		disabled: isUiDisabled,
		onBack,
	});
	const headerOptions = mode === "settings" ? settingsHeaderOptions : inventoryHeaderOptions;
	const list =
		filteredItems.length > 0 ? (
			<FlatList
				data={filteredItems}
				keyExtractor={(it) => it.id}
				contentContainerStyle={styles.listContent}
				style={styles.list}
				showsVerticalScrollIndicator={false}
				keyboardShouldPersistTaps='handled'
				keyboardDismissMode='on-drag'
				renderItem={({ item }) => (
					<CategoryRow
						item={item}
						onPress={() => onOpenDetails(item)}
						disabled={isUiDisabled}
						selected={highlightId === item.id}
						compact
						rightIcon={
							item.isActive === false ? "archive-outline" : hiddenCategoryIds.has(item.id) ? "eye-off" : "chevron-right"
						}
						rightIconColor={item.isActive === false ? theme.colors.error : mutedIconColor}
					/>
				)}
				ListFooterComponent={<View style={{ height: 12 }} />}
			/>
		) : null;

	return (
		<>
			<Stack.Screen options={headerOptions} />
			<BAIScreen tabbed padded={false} safeTop={false} safeBottom={false} style={styles.root}>
				<TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
					<SettingsScreenLayout
						screenStyle={{ paddingBottom: screenBottomPad }}
						maxWidth={contentMaxWidth}
					>
						<BAISurface style={[styles.card, { borderColor }]} padded bordered>
							<SettingsSectionTitle>Categories</SettingsSectionTitle>

							<View style={styles.controls}>
									<View style={styles.actionsRow}>
										<BAIButton
											variant='outline'
											intent='neutral'
											shape='pill'
											widthPreset='standard'
											onPress={onCancel}
											disabled={isUiDisabled}
											style={styles.actionButton}
										>
											Cancel
										</BAIButton>
										<BAIButton
											shape='pill'
											onPress={onCreate}
											disabled={isUiDisabled}
											widthPreset='standard'
											style={styles.actionButton}
										>
											Create
										</BAIButton>
									</View>

									{mode === "settings" ? (
										<BAIPressableRow
											label='Category Visibility'
											value={visibilityRowValue}
											onPress={onPressVisibility}
											disabled={isUiDisabled}
											style={styles.visibilityRow}
										/>
									) : null}

									<BAISearchBar
										value={qText}
										onChangeText={(v) => {
											const cleaned = sanitizeSearchInput(v);
											setQText(cleaned.length > FIELD_LIMITS.search ? cleaned.slice(0, FIELD_LIMITS.search) : cleaned);
										}}
										placeholder='Search categories...'
										maxLength={FIELD_LIMITS.search}
										onClear={hasSearch ? onClearSearch : undefined}
										disabled={isUiDisabled}
									/>

									<BAIGroupTabs
										tabs={categoryTabs}
										value={filter}
										onChange={setFilter}
										disabled={isUiDisabled}
										countFormatter={(count) => formatCompactNumber(count, countryCode)}
									/>
							</View>

							<View style={styles.listSection}>
									{query.isLoading ? (
										<View style={styles.loading}>
											<BAIActivityIndicator />
											<View style={{ height: 10 }} />
											<BAIText variant='body' muted>
												Loading...
											</BAIText>
										</View>
									) : null}

									{!query.isLoading && query.isError ? (
										<View style={styles.errorBox}>
											<BAIText variant='caption' muted>
												Failed To Load Categories.
											</BAIText>
											<View style={{ height: 10 }} />
											<BAIRetryButton onPress={() => query.refetch()} disabled={isUiDisabled}>
												Retry
											</BAIRetryButton>
										</View>
									) : null}

									{!query.isLoading && !query.isError && !hasAnyFiltered ? (
										<View style={styles.emptyBox}>
											{hasSearch ? (
												<BAIText variant='caption' muted style={styles.emptyText}>
													No Categories Match {`"${q}"`}.
												</BAIText>
											) : (
												<BAIText variant='caption' muted>
													{filter === "active"
														? "No active categories."
														: filter === "archived"
															? "No archived categories."
															: "No categories available."}
												</BAIText>
											)}
										</View>
									) : null}

									{!query.isLoading ? list : null}
							</View>
						</BAISurface>
					</SettingsScreenLayout>
				</TouchableWithoutFeedback>
			</BAIScreen>
		</>
	);
}

export default function CategoriesLedgerRoute() {
	return <CategoriesLedgerScreen layout='phone' mode='settings' />;
}

const styles = StyleSheet.create({
	root: { flex: 1 },
	card: {
		flex: 1,
		borderRadius: 18,
		gap: 10,
	},
	actionsRow: {
		flexDirection: "row",
		alignItems: "center",
		gap: 10,
	},
	controls: {
		gap: 10,
	},
	actionButton: {
		flex: 1,
	},
	visibilityRow: {
		marginTop: 0,
	},
	listSection: {
		flex: 1,
		minHeight: 0,
	},
	loading: {
		paddingTop: 18,
		alignItems: "center",
	},
	errorBox: {
		paddingTop: 12,
	},
	emptyBox: {
		paddingTop: 14,
		alignItems: "center",
	},
	emptyText: {
		textAlign: "center",
	},
	listContent: {
		paddingTop: 8,
		paddingBottom: 2,
		gap: 0,
	},
	list: {
		flex: 1,
		minHeight: 0,
	},
});
