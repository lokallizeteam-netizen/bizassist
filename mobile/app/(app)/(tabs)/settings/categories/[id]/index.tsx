// BizAssist_mobile
// path: app/(app)/(tabs)/settings/categories/[id]/index.tsx
//
// Header governance:
// - Category details is a Settings detail screen -> use BACK.

import { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "react-native-paper";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { Image as ExpoImage } from "expo-image";
import { FontAwesome6, MaterialCommunityIcons } from "@expo/vector-icons";

import { BAIActivityIndicator } from "@/components/system/BAIActivityIndicator";
import { BAIButton } from "@/components/ui/BAIButton";
import { BAIRetryButton } from "@/components/ui/BAIRetryButton";
import { BAIScreen } from "@/components/ui/BAIScreen";
import { BAISurface } from "@/components/ui/BAISurface";
import { BAIText } from "@/components/ui/BAIText";
import { SettingsScreenLayout } from "@/components/settings/SettingsLayout";

import { useAppBusy } from "@/hooks/useAppBusy";
import { categoriesApi } from "@/modules/categories/categories.api";
import { categoryKeys } from "@/modules/categories/categories.queryKeys";
import type { Category } from "@/modules/categories/categories.types";
import { inventoryApi } from "@/modules/inventory/inventory.api";
import { useAppHeader } from "@/modules/navigation/useAppHeader";
import type { InventoryProduct } from "@/modules/inventory/inventory.types";
import { useActiveBusinessMeta } from "@/modules/business/useActiveBusinessMeta";
import { formatCompactNumber } from "@/lib/locale/businessLocale";

const SETTINGS_CATEGORIES_ROUTE = "/(app)/(tabs)/settings/categories" as const;

function extractApiErrorMessage(err: unknown): string {
	const data = (err as any)?.response?.data;
	const msg = data?.message ?? data?.error?.message ?? (err as any)?.message ?? "Operation failed.";
	return String(msg);
}

function productSecondaryLabel(p: InventoryProduct): string {
	const typeLabel = p.type === "SERVICE" ? "Service" : "Item";
	return `Type: ${typeLabel}`;
}

function formatCompactCount(value: number, countryCode?: string | null): string {
	return formatCompactNumber(value, countryCode);
}

function CategoryLinkedItemRow({
	item,
	value,
	onPress,
	disabled,
}: {
	item: InventoryProduct;
	value: string;
	onPress: () => void;
	disabled: boolean;
}) {
	const theme = useTheme();
	const borderColor = theme.colors.outlineVariant ?? theme.colors.outline;
	const backgroundColor =
		(theme.colors as any).surfaceVariant ?? (theme.dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.035)");
	const pressedBg = theme.dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.05)";
	const chevronColor = theme.colors.onSurfaceVariant ?? theme.colors.onSurface;
	const placeholderBg = theme.colors.surfaceVariant ?? theme.colors.surface;
	const placeholderIcon = theme.colors.onSurfaceVariant ?? theme.colors.onSurface;

	const imageUri = typeof item.primaryImageUrl === "string" ? item.primaryImageUrl.trim() : "";
	const posTileColor = typeof item.posTileColor === "string" ? item.posTileColor.trim() : "";
	const showImageTile = item.posTileMode === "IMAGE" && !!imageUri;
	const showColorTile = item.posTileMode === "COLOR" && !!posTileColor;
	const showPlaceholder = !showImageTile && !showColorTile;

	return (
		<Pressable
			onPress={onPress}
			disabled={disabled}
			style={({ pressed }) => [
				styles.itemRow,
				{ borderColor, backgroundColor: pressed && !disabled ? pressedBg : backgroundColor },
				disabled && { opacity: 0.45 },
			]}
		>
			<View style={styles.itemRowMain}>
				<View
					style={[
						styles.itemThumb,
						{ borderColor },
						showColorTile && { backgroundColor: posTileColor },
						showPlaceholder && { backgroundColor: placeholderBg },
					]}
				>
					{showImageTile ? (
						<ExpoImage
							source={{ uri: imageUri }}
							style={styles.itemThumbImage}
							contentFit='cover'
							cachePolicy='memory-disk'
						/>
					) : null}
					{showPlaceholder ? <FontAwesome6 name='image' size={26} color={placeholderIcon} /> : null}
				</View>

				<View style={styles.itemTextWrap}>
					<BAIText variant='body' numberOfLines={1}>
						{item.name}
					</BAIText>
					<BAIText variant='caption' muted>
						{value}
					</BAIText>
				</View>
			</View>

			<MaterialCommunityIcons name='chevron-right' size={30} color={chevronColor} />
		</Pressable>
	);
}

export default function SettingsCategoryDetailScreen() {
	const router = useRouter();
	const theme = useTheme();
	const { busy } = useAppBusy();
	const { countryCode } = useActiveBusinessMeta();
	const tabBarHeight = useBottomTabBarHeight();

	const params = useLocalSearchParams<{ id?: string }>();
	const id = String(params.id ?? "");

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

	const isUiDisabled = !!busy?.isBusy || isNavLocked;

	const listParams = useMemo(() => ({ limit: 250 }), []);
	const q = useQuery<{ items: Category[] }>({
		queryKey: categoryKeys.list(listParams),
		queryFn: () => categoriesApi.list(listParams),
		staleTime: 300_000,
	});

	const category = useMemo(() => q.data?.items?.find((c) => c.id === id) ?? null, [q.data?.items, id]);

	const productsQuery = useQuery<InventoryProduct[]>({
		queryKey: ["inventory", "products", "byCategoryId", id] as const,
		queryFn: async () => {
			const res = await inventoryApi.listProducts({ limit: 100 });
			return res.items ?? [];
		},
		enabled: !!id,
		staleTime: 300_000,
	});

	const productsErrorMessage = useMemo(
		() => (productsQuery.error ? extractApiErrorMessage(productsQuery.error) : null),
		[productsQuery.error],
	);

	const productsInCategory = useMemo(() => {
		const items = productsQuery.data ?? [];
		return items
			.filter((p) => String(p.categoryId ?? "") === id)
			.slice()
			.sort((a, b) => a.name.localeCompare(b.name));
	}, [id, productsQuery.data]);
	const linkedItemsCount = useMemo(() => {
		const legacyItemCount = (category as (Category & { itemCount?: number }) | null)?.itemCount;
		const rawCount = category?.productCount ?? legacyItemCount ?? productsInCategory.length;
		if (typeof rawCount !== "number" || !Number.isFinite(rawCount)) return 0;
		return Math.max(0, Math.trunc(rawCount));
	}, [category, productsInCategory.length]);
	const linkedItemsLabel = linkedItemsCount === 1 ? "ITEM" : "ITEMS";

	const isArchived = !!category && category.isActive === false;
	const canEdit = !!category && !isArchived;
	const canArchive = !!category && !isArchived;
	const canRestore = !!category && isArchived;

	const onBack = useCallback(() => {
		if (isUiDisabled) return;
		if (!lockNav()) return;
		if (router.canGoBack?.()) {
			router.back();
			return;
		}
		router.replace(SETTINGS_CATEGORIES_ROUTE as any);
	}, [isUiDisabled, lockNav, router]);

	const onEdit = useCallback(() => {
		if (!category || !canEdit || isUiDisabled) return;
		if (!lockNav()) return;
		router.push(`/(app)/(tabs)/settings/categories/${encodeURIComponent(category.id)}/edit` as any);
	}, [canEdit, category, isUiDisabled, lockNav, router]);

	const onArchivePress = useCallback(() => {
		if (!category || !canArchive || isUiDisabled) return;
		if (!lockNav()) return;
		router.push(`/(app)/(tabs)/settings/categories/${encodeURIComponent(category.id)}/archive` as any);
	}, [canArchive, category, isUiDisabled, lockNav, router]);

	const onRestorePress = useCallback(() => {
		if (!category || !canRestore || isUiDisabled) return;
		if (!lockNav()) return;
		router.push(`/(app)/(tabs)/settings/categories/${encodeURIComponent(category.id)}/restore` as any);
	}, [canRestore, category, isUiDisabled, lockNav, router]);

	const onOpenItem = useCallback(
		(productId: string) => {
			if (isUiDisabled) return;
			if (!lockNav()) return;
			router.push(`/(app)/(tabs)/inventory/products/${encodeURIComponent(productId)}` as any);
		},
		[isUiDisabled, lockNav, router],
	);

	const borderColor = theme.colors.outlineVariant ?? theme.colors.outline;
	const colorHex = category?.color?.trim() || "";
	const headerOptions = useAppHeader("detail", { title: "Category Details", disabled: isUiDisabled, onBack });

	return (
		<>
			<Stack.Screen options={headerOptions} />
			<BAIScreen padded={false} safeTop={false} safeBottom={false} style={styles.root}>
				<SettingsScreenLayout
					screenStyle={[
						styles.screen,
						styles.scrollContent,
						{ backgroundColor: theme.colors.background, paddingBottom: tabBarHeight + 14 },
					]}
					maxWidth={860}
				>
					<BAISurface style={[styles.card, { borderColor }]} padded bordered>
						<BAIText variant='caption' muted>
							Review category status and linked items.
						</BAIText>

						{q.isLoading ? (
							<View style={styles.center}>
								<BAIActivityIndicator />
							</View>
						) : null}

						{!q.isLoading && q.isError ? (
							<View style={{ paddingTop: 12 }}>
								<BAIText variant='caption' muted>
									Could not load category details.
								</BAIText>
								<View style={{ height: 10 }} />
								<BAIRetryButton onPress={() => q.refetch()} disabled={isUiDisabled}>
									Retry
								</BAIRetryButton>
							</View>
						) : null}

						{!q.isLoading && !q.isError && !category ? (
							<>
								<BAIText variant='caption' muted style={{ marginTop: 10 }}>
									Category not found.
								</BAIText>
								<View style={{ height: 12 }} />
								<BAIButton mode='outlined' onPress={onBack} disabled={isUiDisabled} shape='pill' widthPreset='standard'>
									Back
								</BAIButton>
							</>
						) : null}

						{category ? (
							<>
								<BAISurface
									style={[
										styles.summaryCard,
										{
											borderColor,
											backgroundColor: theme.colors.surfaceVariant ?? theme.colors.surface,
										},
									]}
									padded
									bordered
								>
									<View style={styles.summaryHeader}>
										<View style={styles.summaryIdentity}>
											<View
												style={[
													styles.summarySwatch,
													{
														backgroundColor: colorHex || (theme.colors.surfaceDisabled ?? theme.colors.surface),
														borderColor,
													},
												]}
											/>
											<View style={styles.summaryText}>
												<BAIText variant='subtitle' numberOfLines={1} ellipsizeMode='tail'>
													{category.name}
												</BAIText>
												<BAIText variant='caption' muted>
													Category overview
												</BAIText>
											</View>
										</View>
									</View>

									<View style={[styles.summaryDivider, { backgroundColor: borderColor }]} />

									<View style={styles.metaRow}>
										<BAIText variant='caption' muted style={styles.metaLabel}>
											Status:
										</BAIText>
										<View style={styles.metaValueRow}>
											<View
												style={[
													styles.statusPill,
													{
														borderColor,
														backgroundColor: category.isActive
															? (theme.colors.primaryContainer ?? theme.colors.surface)
															: (theme.colors.errorContainer ?? theme.colors.surface),
													},
												]}
											>
												<BAIText variant='caption' style={styles.statusPillText}>
													{category.isActive ? "Active" : "Archived"}
												</BAIText>
											</View>
										</View>
									</View>
								</BAISurface>

								<View style={styles.actionRow}>
									{canArchive ? (
										<BAIButton
											variant='outline'
											intent='danger'
											onPress={onArchivePress}
											disabled={isUiDisabled}
											shape='pill'
											widthPreset='standard'
											style={styles.actionButton}
										>
											Archive
										</BAIButton>
									) : null}

									{canEdit ? (
										<BAIButton
											variant='solid'
											onPress={onEdit}
											disabled={isUiDisabled}
											shape='pill'
											widthPreset='standard'
											style={styles.actionButton}
										>
											Edit
										</BAIButton>
									) : null}

									{canRestore ? (
										<>
											<BAIButton
												variant='outline'
												intent='neutral'
												onPress={onBack}
												disabled={isUiDisabled}
												shape='pill'
												widthPreset='standard'
												style={styles.actionButton}
											>
												Cancel
											</BAIButton>
											<BAIButton
												onPress={onRestorePress}
												disabled={isUiDisabled}
												shape='pill'
												widthPreset='standard'
												style={styles.actionButton}
											>
												Restore
											</BAIButton>
										</>
									) : null}
								</View>

								<View style={{ height: 0 }} />
								<View style={styles.itemsHeader}>
									<BAIText variant='subtitle'>Items in this category</BAIText>
									<View
										style={[
											styles.countPill,
											{
												borderColor,
												backgroundColor: theme.colors.surfaceVariant ?? theme.colors.surface,
											},
										]}
									>
										<BAIText variant='caption' muted>
											{formatCompactCount(linkedItemsCount, countryCode)} {linkedItemsLabel}
										</BAIText>
									</View>
								</View>
								<BAIText variant='caption' muted style={styles.itemsSubtitle}>
									Read-only context. Archived categories stay linked.
								</BAIText>

								{productsQuery.isLoading ? (
									<View style={styles.center}>
										<BAIActivityIndicator />
									</View>
								) : productsQuery.isError ? (
									<BAISurface style={styles.inlineCard} padded>
										<BAIText variant='caption' muted>
											{productsErrorMessage ?? "Failed to load items for this category."}
										</BAIText>
										<View style={{ height: 10 }} />
										<BAIRetryButton onPress={() => productsQuery.refetch()} disabled={isUiDisabled}>
											Retry
										</BAIRetryButton>
									</BAISurface>
								) : productsInCategory.length === 0 ? (
									<View style={styles.emptyState}>
										<BAIText variant='caption' muted>
											No items currently use this category.
										</BAIText>
									</View>
								) : (
									<View style={styles.itemsListWrap}>
										<ScrollView
											style={styles.itemsScroll}
											contentContainerStyle={styles.itemsContent}
											nestedScrollEnabled
											showsVerticalScrollIndicator={false}
										>
											{productsInCategory.map((p) => (
												<CategoryLinkedItemRow
													key={p.id}
													item={p}
													value={productSecondaryLabel(p)}
													onPress={() => onOpenItem(p.id)}
													disabled={isUiDisabled}
												/>
											))}
										</ScrollView>
									</View>
								)}
							</>
						) : null}
					</BAISurface>
				</SettingsScreenLayout>
			</BAIScreen>
		</>
	);
}

const styles = StyleSheet.create({
	root: { flex: 1 },
	screen: {
		paddingHorizontal: 8,
	},
	scrollContent: {
		paddingTop: 0,
	},
	card: {
		flex: 1,
		borderWidth: 1,
		borderRadius: 18,
		gap: 10,
	},
	summaryCard: {
		borderRadius: 16,
	},
	summaryHeader: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		gap: 10,
	},
	summaryIdentity: {
		flexDirection: "row",
		alignItems: "center",
		gap: 10,
		flex: 1,
		minWidth: 0,
	},
	summarySwatch: {
		width: 28,
		height: 28,
		borderRadius: 14,
		borderWidth: 1,
	},
	summaryText: {
		flex: 1,
		minWidth: 0,
	},
	statusPill: {
		borderWidth: 1,
		borderRadius: 999,
		paddingHorizontal: 10,
		paddingVertical: 4,
	},
	statusPillText: {
		fontWeight: "600",
	},
	summaryDivider: {
		height: StyleSheet.hairlineWidth,
		marginVertical: 10,
	},
	metaRow: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "flex-start",
		gap: 6,
	},
	metaLabel: {
		width: 44,
	},
	metaValueRow: {
		flexDirection: "row",
		alignItems: "center",
		gap: 6,
	},
	center: {
		alignItems: "center",
		justifyContent: "center",
		paddingVertical: 12,
	},
	detailRow: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		paddingVertical: 10,
		gap: 12,
	},
	detailLabel: {
		width: 70,
	},
	detailValue: {
		flex: 1,
		textAlign: "right",
	},
	detailDivider: {
		height: StyleSheet.hairlineWidth,
		width: "100%",
	},
	colorValueRow: {
		flex: 1,
		flexDirection: "row",
		justifyContent: "flex-end",
		alignItems: "center",
		gap: 8,
	},
	colorSwatch: {
		width: 20,
		height: 20,
		borderRadius: 10,
		borderWidth: 1,
		borderColor: "rgba(0,0,0,0.18)",
	},
	actionRow: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		gap: 10,
		marginTop: -10,
	},
	actionButton: {
		flex: 1,
	},
	itemsHeader: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		gap: 8,
	},
	itemsSubtitle: {
		marginTop: -10,
	},
	countPill: {
		borderWidth: 1,
		borderRadius: 999,
		paddingHorizontal: 10,
		paddingVertical: 2,
	},
	inlineCard: {
		borderRadius: 0,
	},
	emptyState: {
		paddingVertical: 12,
	},
	itemsListWrap: {
		flex: 1,
		minHeight: 220,
		borderRadius: 0,
		overflow: "hidden",
	},
	itemsScroll: {
		flex: 1,
	},
	itemsContent: {
		gap: 8,
		paddingBottom: 4,
	},
	itemRow: {
		borderWidth: 1,
		borderRadius: 12,
		paddingVertical: 10,
		paddingLeft: 12,
		paddingRight: 10,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		gap: 12,
	},
	itemRowMain: {
		flexDirection: "row",
		alignItems: "center",
		flex: 1,
		minWidth: 0,
		gap: 10,
	},
	itemThumb: {
		width: 44,
		height: 44,
		borderRadius: 10,
		borderWidth: StyleSheet.hairlineWidth,
		alignItems: "center",
		justifyContent: "center",
		overflow: "hidden",
	},
	itemThumbImage: {
		...StyleSheet.absoluteFillObject,
	},
	itemTextWrap: {
		flex: 1,
		minWidth: 0,
		gap: 2,
	},
});
