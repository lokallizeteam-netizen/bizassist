// BizAssist_mobile
// path: app/(app)/(tabs)/settings/categories/visibility.tsx
//
// Header governance:
// - This is a Settings detail screen -> use BACK (not Exit).
// - Hidden categories are user-scoped visibility preferences.

import { useCallback, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "react-native-paper";

import { BAIActivityIndicator } from "@/components/system/BAIActivityIndicator";
import { BAIRetryButton } from "@/components/ui/BAIRetryButton";
import { BAIScreen } from "@/components/ui/BAIScreen";
import { BAISearchBar } from "@/components/ui/BAISearchBar";
import { BAISurface } from "@/components/ui/BAISurface";
import { BAISwitchRow } from "@/components/ui/BAISwitchRow";
import { BAIText } from "@/components/ui/BAIText";
import { SettingsScreenLayout, SettingsSectionTitle } from "@/components/settings/SettingsLayout";

import { useAppBusy } from "@/hooks/useAppBusy";
import { categoriesApi } from "@/modules/categories/categories.api";
import { CategoryRow } from "@/modules/categories/components/CategoryRow";
import { categoryKeys } from "@/modules/categories/categories.queryKeys";
import { useCategoryVisibilityMutation, useCategoryVisibilityQuery } from "@/modules/categories/categories.queries";
import type { Category } from "@/modules/categories/categories.types";
import { useActiveBusinessMeta } from "@/modules/business/useActiveBusinessMeta";
import { useAppHeader } from "@/modules/navigation/useAppHeader";
import { formatCompactNumber } from "@/lib/locale/businessLocale";
import { FIELD_LIMITS } from "@/shared/fieldLimits";
import { sanitizeSearchInput } from "@/shared/validation/sanitize";

const CONTENT_MAX_WIDTH_TABLET = 1100;
const SETTINGS_CATEGORIES_LEDGER_ROUTE = "/(app)/(tabs)/settings/categories" as const;

function extractApiErrorMessage(err: any): string {
	const data = err?.response?.data;
	const msg = data?.message ?? data?.error?.message ?? err?.message ?? "Operation failed. Please try again.";
	return String(msg);
}

function sortCategories(list: Category[]): Category[] {
	return [...list].sort((a, b) => a.name.localeCompare(b.name));
}

function formatCompactCount(value: number, countryCode?: string | null): string {
	return formatCompactNumber(value, countryCode);
}

function resolveCategoryItemCount(category: Category): number {
	const fallback = (category as Category & { itemCount?: number }).itemCount;
	const rawCount = category.productCount ?? fallback;
	if (!Number.isFinite(rawCount)) return 0;
	return Math.max(0, Math.trunc(rawCount as number));
}

function formatItemCountLabel(count: number, countryCode?: string | null): string {
	const noun = count === 1 ? "item" : "items";
	return `${formatCompactCount(count, countryCode)} ${noun}`;
}

export default function SettingsCategoryVisibilityScreen() {
	const theme = useTheme();
	const router = useRouter();
	const { width } = useWindowDimensions();
	const { withBusy, busy } = useAppBusy();
	const { countryCode } = useActiveBusinessMeta();

	const isTablet = width >= 768;
	const contentMaxWidth = isTablet ? CONTENT_MAX_WIDTH_TABLET : undefined;
	const borderColor = theme.colors.outlineVariant ?? theme.colors.outline;

	const visibilityQuery = useCategoryVisibilityQuery();
	const visibilityMutation = useCategoryVisibilityMutation();

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

	const [showHidden, setShowHidden] = useState(false);
	const [qText, setQText] = useState("");
	const [error, setError] = useState<string | null>(null);
	const q = qText.trim().toLowerCase();
	const hasSearch = q.length > 0;

	const isUiDisabled = isNavLocked || !!busy?.isBusy || visibilityMutation.isPending;
	const onBack = useCallback(() => {
		if (isUiDisabled) return;
		if (!lockNav()) return;
		if (router.canGoBack?.()) {
			router.back();
			return;
		}
		router.replace(SETTINGS_CATEGORIES_LEDGER_ROUTE as any);
	}, [isUiDisabled, lockNav, router]);
	const headerOptions = useAppHeader("detail", { title: "Category Visibility", disabled: isUiDisabled, onBack });

	const categoriesQuery = useQuery({
		queryKey: categoryKeys.list({ isActive: true, limit: 250 }),
		queryFn: () => categoriesApi.list({ isActive: true, limit: 250 }),
		staleTime: 300_000,
	});

	const hiddenIds = visibilityQuery.hiddenCategoryIds;
	const activeCategories = useMemo(() => categoriesQuery.data?.items ?? [], [categoriesQuery.data?.items]);

	const visibleCategories = useMemo(() => {
		const base = sortCategories(activeCategories.filter((c) => !hiddenIds.has(c.id)));
		if (!q) return base;
		return base.filter((c) => c.name.toLowerCase().includes(q));
	}, [activeCategories, hiddenIds, q]);

	const hiddenCategories = useMemo(() => {
		const base = sortCategories(activeCategories.filter((c) => hiddenIds.has(c.id)));
		if (!q) return base;
		return base.filter((c) => c.name.toLowerCase().includes(q));
	}, [activeCategories, hiddenIds, q]);
	const hiddenCount = hiddenIds.size;
	const compactHidden = formatCompactCount(hiddenCount, countryCode);
	const hiddenSubtitle =
		hiddenCount > 0 ? `${compactHidden} hidden. View and restore categories.` : "View and restore categories.";

	const displayCategories = useMemo(
		() => (showHidden ? [...hiddenCategories, ...visibleCategories] : visibleCategories),
		[hiddenCategories, showHidden, visibleCategories],
	);

	const isLoading = categoriesQuery.isLoading || visibilityQuery.isLoading;
	const isError = categoriesQuery.isError || visibilityQuery.isError;

	const onHide = useCallback(
		async (category: Category) => {
			if (isUiDisabled) return;
			if (!lockNav()) return;
			setError(null);

			await withBusy("Hiding category...", async () => {
				try {
					await visibilityMutation.mutateAsync({ action: "HIDE", categoryId: category.id });
				} catch (e) {
					setError(extractApiErrorMessage(e));
				}
			});
		},
		[isUiDisabled, lockNav, visibilityMutation, withBusy],
	);

	const onRestore = useCallback(
		async (category: Category) => {
			if (isUiDisabled) return;
			if (!lockNav()) return;
			setError(null);

			await withBusy("Restoring category...", async () => {
				try {
					await visibilityMutation.mutateAsync({ action: "RESTORE", categoryId: category.id });
				} catch (e) {
					setError(extractApiErrorMessage(e));
				}
			});
		},
		[isUiDisabled, lockNav, visibilityMutation, withBusy],
	);

	const handleRetry = useCallback(() => {
		categoriesQuery.refetch();
		visibilityQuery.refetch();
	}, [categoriesQuery, visibilityQuery]);

	const onClearSearch = useCallback(() => {
		setQText("");
	}, []);

	const renderRow = useCallback(
		(item: Category) => {
			const isHidden = hiddenIds.has(item.id);
			const actionLabel = isHidden ? "Restore" : "Hide";
			const onPress = isHidden ? () => onRestore(item) : () => onHide(item);
			const itemCountLabel = formatItemCountLabel(resolveCategoryItemCount(item), countryCode);
			const metaLabel = isHidden ? `${itemCountLabel} • hidden` : itemCountLabel;
			const actionAccessibilityLabel = isHidden ? `Restore ${item.name} category` : `Hide ${item.name} category`;
			const actionAccessibilityHint = isHidden
				? "Makes this category visible in pickers."
				: "Removes this category from pickers without archiving.";
			const actionVariant = isHidden ? "solid" : "outline";
			const actionIntent = isHidden ? "success" : "neutral";
			const actionLabelStyle = isHidden ? { color: theme.colors.onPrimary } : undefined;

			return (
				<View key={item.id} style={styles.rowWrap}>
					<CategoryRow
						item={item}
						onPress={() => {}}
						disablePrimaryPress
						compact
						metaLabel={metaLabel}
						disabled={isUiDisabled}
						showChevron={false}
						action={{
							label: actionLabel,
							onPress,
							accessibilityLabel: actionAccessibilityLabel,
							accessibilityHint: actionAccessibilityHint,
							intent: actionIntent,
							variant: actionVariant,
							labelStyle: actionLabelStyle,
						}}
					/>
				</View>
			);
		},
		[countryCode, hiddenIds, isUiDisabled, onHide, onRestore, theme.colors.onPrimary],
	);

	return (
		<>
			<Stack.Screen options={headerOptions} />
			<BAIScreen tabbed padded={false} safeTop={false}>
				<SettingsScreenLayout screenStyle={styles.screen} maxWidth={contentMaxWidth}>
					<BAISurface style={[styles.card, { borderColor }]} padded bordered>
						<SettingsSectionTitle>Manage Category Visibility</SettingsSectionTitle>

							{error ? (
								<BAIText variant='caption' style={{ color: theme.colors.error }}>
									{error}
								</BAIText>
							) : null}

							<BAISwitchRow
								label={showHidden ? "Hidden categories visible" : "Show hidden categories"}
								description={hiddenSubtitle}
								value={showHidden}
								onValueChange={setShowHidden}
								accessibilityLabel='Show hidden categories'
								accessibilityHint='Toggles whether hidden categories are included in this list.'
								disabled={isUiDisabled}
							/>

							<BAISearchBar
								value={qText}
								onChangeText={(v) => {
									const cleaned = sanitizeSearchInput(v);
									setQText(cleaned.length > FIELD_LIMITS.search ? cleaned.slice(0, FIELD_LIMITS.search) : cleaned);
								}}
								placeholder='Search categories...'
								maxLength={FIELD_LIMITS.search}
								onClear={hasSearch ? onClearSearch : undefined}
								accessibilityLabel='Search categories'
								disabled={isUiDisabled}
							/>

							<View style={styles.sectionHeader}>
								<BAIText variant='caption' muted>
									{showHidden ? "All categories" : "Visible categories"}
								</BAIText>
							</View>

							<View style={styles.listRegion}>
								{isLoading ? (
									<BAISurface style={[styles.stateCard, { borderColor }]} padded bordered>
										<View style={styles.loadingState}>
											<BAIActivityIndicator size='large' tone='primary' />
											<View style={{ height: 10 }} />
											<BAIText variant='subtitle'>Loading visibility...</BAIText>
										</View>
									</BAISurface>
								) : isError ? (
									<BAISurface style={[styles.stateCard, { borderColor }]} padded bordered>
										<BAIText variant='subtitle'>Could not load category visibility.</BAIText>
										<View style={{ height: 12 }} />
										<BAIRetryButton variant='outline' onPress={handleRetry} disabled={isUiDisabled}>
											Retry
										</BAIRetryButton>
									</BAISurface>
								) : displayCategories.length === 0 ? (
									<BAISurface style={[styles.stateCard, { borderColor }]} padded bordered>
										{hasSearch ? (
											<>
												<BAIText variant='subtitle'>No categories match: {qText.trim()}.</BAIText>
												<BAIText variant='caption' muted>
													Try a different keyword or clear search.
												</BAIText>
											</>
										) : showHidden ? (
											<>
												<BAIText variant='subtitle'>No categories found.</BAIText>
												<BAIText variant='caption' muted>
													Create a category to see it listed here.
												</BAIText>
											</>
										) : (
											<>
												<BAIText variant='subtitle'>No visible categories.</BAIText>
												<BAIText variant='caption' muted>
													Turn on Show Hidden Categories to restore hidden categories.
												</BAIText>
											</>
										)}
									</BAISurface>
								) : (
									<ScrollView
										style={styles.listScroll}
										contentContainerStyle={styles.listContent}
										showsVerticalScrollIndicator={false}
										alwaysBounceVertical={false}
										keyboardShouldPersistTaps='handled'
										keyboardDismissMode='on-drag'
									>
										{displayCategories.map(renderRow)}
										<View style={{ height: 10 }} />
									</ScrollView>
								)}
							</View>
					</BAISurface>
				</SettingsScreenLayout>
			</BAIScreen>
		</>
	);
}

const styles = StyleSheet.create({
	screen: {
		paddingBottom: 0,
		paddingHorizontal: 14,
	},
	card: {
		flex: 1,
		width: "100%",
		borderRadius: 18,
		gap: 12,
	},
	sectionHeader: {
		paddingTop: 0,
	},
	listRegion: {
		flex: 1,
		minHeight: 220,
	},
	listScroll: {
		flex: 1,
	},
	listContent: {
		gap: 0,
		paddingBottom: 10,
	},
	rowWrap: {
		marginBottom: 0,
	},
	stateCard: {
		borderRadius: 18,
	},
	loadingState: {
		alignItems: "center",
		justifyContent: "center",
		paddingVertical: 10,
	},
});
