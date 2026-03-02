// BizAssist_mobile
// path: app/(app)/(tabs)/settings/discounts/discounts.ledger.tsx
//
// Header governance:
// - Manage discounts is a detail/workspace screen -> use BACK (not Exit).
// - Cancel remains deterministic and exits to the owning ledger/root flow.

import React, { useCallback, useMemo, useState } from "react";
import { FlatList, Keyboard, Pressable, StyleSheet, Text, TouchableWithoutFeedback, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Stack, useLocalSearchParams, usePathname, useRouter } from "expo-router";
import { useTheme } from "react-native-paper";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";

import { BAIActivityIndicator } from "@/components/system/BAIActivityIndicator";
import { BAIButton } from "@/components/ui/BAIButton";
import { BAIGroupTabs, type BAIGroupTab } from "@/components/ui/BAIGroupTabs";
import { BAIPressableRow } from "@/components/ui/BAIPressableRow";
import { BAIRetryButton } from "@/components/ui/BAIRetryButton";
import { BAIScreen } from "@/components/ui/BAIScreen";
import { BAISearchBar } from "@/components/ui/BAISearchBar";
import { BAISurface } from "@/components/ui/BAISurface";
import { BAIText } from "@/components/ui/BAIText";
import { SettingsScreenLayout, SettingsSectionTitle } from "@/components/settings/SettingsLayout";

import { useAppBusy } from "@/hooks/useAppBusy";
import { useActiveBusinessMeta } from "@/modules/business/useActiveBusinessMeta";
import { useDiscountVisibilityQuery, useDiscountsList } from "@/modules/discounts/discounts.queries";
import type { Discount } from "@/modules/discounts/discounts.types";
import { useAppHeader } from "@/modules/navigation/useAppHeader";
import { useInventoryHeader } from "@/modules/inventory/useInventoryHeader";
import { formatCompactNumber } from "@/lib/locale/businessLocale";
import { FIELD_LIMITS } from "@/shared/fieldLimits";
import { useNavLock } from "@/shared/hooks/useNavLock";
import { formatMoney } from "@/shared/money/money.format";
import { sanitizeSearchInput } from "@/shared/validation/sanitize";
import {
	buildInventoryDiscountCreateRoute,
	buildInventoryDiscountDetailsRoute,
	buildSettingsDiscountCreateRoute,
	buildSettingsDiscountDetailsRoute,
	normalizeDiscountReturnTo,
	resolveInventoryDiscountFlowExitRoute,
	resolveSettingsDiscountFlowExitRoute,
} from "@/modules/discounts/discounts.navigation";

type RowProps = {
	item: Discount;
	onPress: () => void;
	disabled?: boolean;
	currencyCode: string;
	isHidden?: boolean;
};

type DiscountFilter = "all" | "active" | "archived";
type DiscountsLedgerLayout = "phone" | "tablet";
type DiscountsLedgerMode = "settings" | "inventory";

const SETTINGS_DISCOUNTS_VISIBILITY_ROUTE = "/(app)/(tabs)/settings/discounts/visibility" as const;
const SETTINGS_ROUTE = "/(app)/(tabs)/settings" as const;
const INVENTORY_ROUTE = "/(app)/(tabs)/inventory" as const;
const ROOT_ROUTE_BY_MODE: Record<DiscountsLedgerMode, string> = {
	settings: SETTINGS_ROUTE,
	inventory: INVENTORY_ROUTE,
};

const DISCOUNT_TAB_BASE: BAIGroupTab<DiscountFilter>[] = [
	{ label: "Active", value: "active" },
	{ label: "Archived", value: "archived" },
	{ label: "All", value: "all" },
];
const DISCOUNT_ROW_STATUS_ICON_SIZE = 16;

function formatCompactCount(value: number, countryCode?: string | null): string {
	return formatCompactNumber(value, countryCode);
}

function normalizeRoutePath(route: string | null | undefined): string {
	return String(route ?? "")
		.split("?")[0]
		.split("#")[0]
		.trim();
}

function DiscountRow({ item, onPress, disabled, currencyCode, isHidden }: RowProps) {
	const theme = useTheme();
	const borderColor = theme.colors.outlineVariant ?? theme.colors.outline;
	const surfaceAlt = theme.colors.surfaceVariant ?? theme.colors.surface;
	const isArchived = item.isActive === false;
	const iconColor = isArchived ? theme.colors.error : theme.colors.onSurfaceVariant;
	const surfaceInteractive = useMemo(
		() => ({
			borderColor,
			backgroundColor: surfaceAlt,
		}),
		[borderColor, surfaceAlt],
	);

	const percentValueLabel = useMemo(() => {
		if (item.type !== "PERCENT") return "-";
		return item.value ? `${item.value}%` : "-";
	}, [item.type, item.value]);

	const fixedValueParts = useMemo(() => {
		if (item.type !== "FIXED") return null;
		const raw = item.value ?? "";
		if (!raw) return null;

		const formatted = formatMoney({ currencyCode, amount: raw });
		const firstDigitIndex = formatted.search(/\d/);
		if (firstDigitIndex <= 0) {
			return { symbol: formatted, amount: "" };
		}

		return {
			symbol: formatted.slice(0, firstDigitIndex),
			amount: formatted.slice(firstDigitIndex),
		};
	}, [currencyCode, item.type, item.value]);

	const valueNode = useMemo(() => {
		if (item.type === "PERCENT") {
			return (
				<BAIText variant='body' numberOfLines={1} style={styles.valueText}>
					{percentValueLabel}
				</BAIText>
			);
		}

		if (fixedValueParts) {
			return (
				<BAIText variant='body' numberOfLines={1} style={styles.valueText}>
					-{fixedValueParts.symbol ? <Text style={styles.currencySign}>{fixedValueParts.symbol}</Text> : null}
					{fixedValueParts.amount}
				</BAIText>
			);
		}

		return (
			<BAIText variant='body' numberOfLines={1} style={styles.valueText}>
				-
			</BAIText>
		);
	}, [fixedValueParts, item.type, percentValueLabel]);

	return (
		<Pressable onPress={onPress} disabled={!!disabled}>
			{({ pressed }) => (
				<BAISurface
					style={[
						styles.row,
						surfaceInteractive,
						pressed && !disabled ? styles.rowPressed : undefined,
						disabled ? styles.rowDisabled : undefined,
					]}
					padded
					bordered
				>
					<View style={styles.rowTop}>
						<View style={styles.rowText}>
							<View style={styles.rowNameWrap}>
								{isArchived ? (
									<MaterialCommunityIcons
										name='archive-outline'
										size={DISCOUNT_ROW_STATUS_ICON_SIZE}
										color={iconColor}
									/>
								) : isHidden ? (
									<MaterialCommunityIcons name='eye-off' size={DISCOUNT_ROW_STATUS_ICON_SIZE} color={iconColor} />
								) : (
									<Ionicons name='pricetag-outline' size={DISCOUNT_ROW_STATUS_ICON_SIZE} color={iconColor} />
								)}
								<BAIText variant='subtitle' numberOfLines={1} style={styles.rowNameText}>
									{item.name}
								</BAIText>
							</View>
						</View>
						<View style={styles.rowMeta}>{valueNode}</View>
					</View>
				</BAISurface>
			)}
		</Pressable>
	);
}

export function DiscountsLedgerScreen({
	layout,
	mode = "settings",
}: {
	layout: DiscountsLedgerLayout;
	mode?: DiscountsLedgerMode;
}) {
	const router = useRouter();
	const pathname = usePathname();
	const params = useLocalSearchParams<{ returnTo?: string }>();
	const theme = useTheme();
	const { busy } = useAppBusy();
	const { safePush, safeReplace, canNavigate } = useNavLock();
	const { currencyCode, countryCode } = useActiveBusinessMeta();
	const returnTo = useMemo(() => normalizeDiscountReturnTo(params.returnTo), [params.returnTo]);
	const currentPath = useMemo(() => normalizeRoutePath(pathname), [pathname]);
	const isTablet = layout === "tablet";
	const tabBarHeight = useBottomTabBarHeight();
	const TAB_KISS_GAP = 12;

	const borderColor = theme.colors.outlineVariant ?? theme.colors.outline;
	const screenBottomPad = tabBarHeight + TAB_KISS_GAP;
	const contentMaxWidth = isTablet ? 1100 : undefined;

	const isBusy = !!busy?.isBusy;
	const isUiDisabled = isBusy || !canNavigate;

	const onCancel = useCallback(() => {
		if (isUiDisabled) return;
		const resolvedRoute =
			mode === "settings"
				? resolveSettingsDiscountFlowExitRoute(returnTo)
				: resolveInventoryDiscountFlowExitRoute(returnTo);
		const targetPath = normalizeRoutePath(resolvedRoute);
		const route = targetPath === currentPath ? ROOT_ROUTE_BY_MODE[mode] : resolvedRoute;
		safeReplace(router as any, route as any);
	}, [currentPath, isUiDisabled, mode, returnTo, router, safeReplace]);

	const onBack = useCallback(() => {
		if (isUiDisabled) return;
		if (router.canGoBack?.()) {
			router.back();
			return;
		}
		onCancel();
	}, [isUiDisabled, onCancel, router]);

	const settingsHeaderOptions = useAppHeader("detail", {
		title: "Manage Discounts",
		disabled: isUiDisabled,
		onBack,
	});
	const inventoryHeaderOptions = useInventoryHeader("detail", {
		title: "Manage Discounts",
		disabled: isUiDisabled,
		onBack,
	});
	const headerOptions = mode === "settings" ? settingsHeaderOptions : inventoryHeaderOptions;

	const [qText, setQText] = useState("");
	const q = qText.trim();
	const hasSearch = q.length > 0;

	const [filter, setFilter] = useState<DiscountFilter>("active");

	const query = useDiscountsList({ q: q || undefined, includeArchived: true, limit: 250 });
	const visibilityCountQuery = useDiscountsList({ q: undefined, isActive: true, includeArchived: false, limit: 250 });
	const visibilityQuery = useDiscountVisibilityQuery();
	const hiddenDiscountIds = visibilityQuery.hiddenDiscountIds;
	const items = useMemo(() => query.data?.items ?? [], [query.data?.items]);
	const activeItems = useMemo(() => items.filter((d) => d.isActive !== false), [items]);
	const archivedItems = useMemo(() => items.filter((d) => d.isActive === false), [items]);
	const discountCounts = useMemo(
		() => ({
			all: items.length,
			active: activeItems.length,
			archived: archivedItems.length,
		}),
		[activeItems.length, archivedItems.length, items.length],
	);
	const discountTabs = useMemo(
		() =>
			DISCOUNT_TAB_BASE.map((tab) => ({
				...tab,
				count: discountCounts[tab.value],
			})),
		[discountCounts],
	);
	const visibilityCountItems = useMemo(
		() => visibilityCountQuery.data?.items ?? [],
		[visibilityCountQuery.data?.items],
	);
	const hiddenActiveCount = useMemo(
		() => visibilityCountItems.filter((d) => hiddenDiscountIds.has(d.id)).length,
		[visibilityCountItems, hiddenDiscountIds],
	);
	const isVisibilityLoading = visibilityQuery.isLoading || visibilityCountQuery.isLoading;
	const isVisibilityError = visibilityQuery.isError || visibilityCountQuery.isError;
	const filteredItems = useMemo(() => {
		if (filter === "active") return activeItems;
		if (filter === "archived") return archivedItems;
		return items;
	}, [activeItems, archivedItems, filter, items]);
	const hasAnyFiltered = filteredItems.length > 0;
	const visibilityRowValue = isVisibilityLoading
		? "Loading visibility..."
		: isVisibilityError
			? "Visibility unavailable"
			: hiddenActiveCount > 0
				? `${formatCompactCount(hiddenActiveCount, countryCode)} hidden. Hide or restore discounts.`
				: "Hide or restore discounts.";

	const openCreate = useCallback(() => {
		Keyboard.dismiss();
		const route =
			mode === "settings" ? buildSettingsDiscountCreateRoute(returnTo) : buildInventoryDiscountCreateRoute(returnTo);
		safePush(router as any, route as any);
	}, [mode, returnTo, router, safePush]);

	const openVisibility = useCallback(() => {
		Keyboard.dismiss();
		safePush(router as any, SETTINGS_DISCOUNTS_VISIBILITY_ROUTE as any);
	}, [router, safePush]);

	const openDetails = useCallback(
		(id: string) => {
			Keyboard.dismiss();
			const route =
				mode === "settings"
					? buildSettingsDiscountDetailsRoute(id, returnTo)
					: buildInventoryDiscountDetailsRoute(id, returnTo);
			safePush(router as any, route as any);
		},
		[mode, returnTo, router, safePush],
	);

	const list =
		filteredItems.length > 0 ? (
			<FlatList
				data={filteredItems}
				keyExtractor={(it) => it.id}
				contentContainerStyle={styles.listContent}
				style={styles.list}
				keyboardShouldPersistTaps='handled'
				renderItem={({ item }) => (
					<DiscountRow
						item={item}
						onPress={() => openDetails(item.id)}
						disabled={isUiDisabled}
						currencyCode={currencyCode}
						isHidden={hiddenDiscountIds.has(item.id)}
					/>
				)}
				ItemSeparatorComponent={() => <View style={styles.itemGap} />}
				showsVerticalScrollIndicator={false}
			/>
		) : null;

	const onClearSearch = useCallback(() => {
		Keyboard.dismiss();
		setQText("");
	}, []);

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
							<SettingsSectionTitle>Discounts</SettingsSectionTitle>

							<View style={styles.controls}>
								<View style={styles.actionsRow}>
									<BAIButton
										variant='outline'
										intent='neutral'
										onPress={onCancel}
										disabled={isUiDisabled}
										shape='pill'
										widthPreset='standard'
										style={styles.actionButton}
									>
										Cancel
									</BAIButton>
									<BAIButton
										shape='pill'
										onPress={openCreate}
										disabled={isUiDisabled}
										widthPreset='standard'
										style={styles.actionButton}
									>
										Create
									</BAIButton>
								</View>

								{mode === "settings" ? (
									<BAIPressableRow
										label='Discount Visibility'
										value={visibilityRowValue}
										onPress={openVisibility}
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
									placeholder='Search discounts...'
									maxLength={FIELD_LIMITS.search}
									onClear={hasSearch ? onClearSearch : undefined}
									disabled={isUiDisabled}
								/>

								<BAIGroupTabs
									tabs={discountTabs}
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
												Failed to load discounts.
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
													No discounts match {`"${q}"`}.
												</BAIText>
											) : (
												<BAIText variant='caption' muted>
													{filter === "active"
														? "No active discounts."
														: filter === "archived"
															? "No archived discounts."
															: "No discounts available."}
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

export default DiscountsLedgerScreen;

const styles = StyleSheet.create({
	root: { flex: 1 },
	card: {
		flex: 1,
		position: "relative",
		borderRadius: 18,
		gap: 10,
	},
	controls: {
		gap: 10,
	},
	actionsRow: {
		flexDirection: "row",
		alignItems: "center",
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
	listContent: { paddingVertical: 8 },
	itemGap: { height: 0 },
	list: {
		flex: 1,
		minHeight: 0,
	},
	row: {
		borderWidth: 1,
		borderRadius: 12,
		paddingVertical: 14,
	},
	rowPressed: {
		opacity: 0.9,
	},
	rowDisabled: {
		opacity: 0.55,
	},
	rowTop: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		gap: 10,
	},
	rowText: {
		flex: 1,
		minWidth: 0,
		gap: 2,
	},
	rowNameWrap: {
		flexDirection: "row",
		alignItems: "center",
		gap: 6,
	},
	rowNameText: {
		flex: 1,
		minWidth: 0,
		fontWeight: "500",
	},
	rowMeta: {
		alignItems: "flex-end",
		minWidth: 92,
		justifyContent: "center",
	},
	valueText: {
		fontSize: 15,
	},
	currencySign: {
		fontSize: 16,
	},
});
