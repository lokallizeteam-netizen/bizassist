// BizAssist_mobile
// path: app/(app)/(tabs)/settings/discounts/visibility.tsx
//
// Header governance:
// - This is a Settings detail screen → use BACK (not Exit).
// - Back follows navigation history (stack back).

import { useCallback, useMemo, useState } from "react";
import { FlatList, StyleSheet, View, useWindowDimensions } from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Stack, useRouter } from "expo-router";
import { useTheme } from "react-native-paper";

import { BAIActivityIndicator } from "@/components/system/BAIActivityIndicator";
import { BAIButton } from "@/components/ui/BAIButton";
import { BAIRetryButton } from "@/components/ui/BAIRetryButton";
import { BAIScreen } from "@/components/ui/BAIScreen";
import { BAISearchBar } from "@/components/ui/BAISearchBar";
import { BAISurface } from "@/components/ui/BAISurface";
import { BAISwitchRow } from "@/components/ui/BAISwitchRow";
import { BAIText } from "@/components/ui/BAIText";
import { SettingsScreenLayout, SettingsSectionTitle } from "@/components/settings/SettingsLayout";
import { useAppBusy } from "@/hooks/useAppBusy";
import { useActiveBusinessMeta } from "@/modules/business/useActiveBusinessMeta";
import {
	useDiscountsList,
	useDiscountVisibilityMutation,
	useDiscountVisibilityQuery,
} from "@/modules/discounts/discounts.queries";
import { SETTINGS_DISCOUNTS_LEDGER_ROUTE } from "@/modules/discounts/discounts.navigation";
import type { Discount, DiscountType } from "@/modules/discounts/discounts.types";
import { useAppHeader } from "@/modules/navigation/useAppHeader";
import { formatCompactNumber } from "@/lib/locale/businessLocale";
import { FIELD_LIMITS } from "@/shared/fieldLimits";
import { formatMoney } from "@/shared/money/money.format";
import { sanitizeSearchInput } from "@/shared/validation/sanitize";

const CONTENT_MAX_WIDTH_TABLET = 1100;

function formatType(t: DiscountType) {
	return t === "FIXED" ? "Amount" : "Percent";
}

function formatValueLabel(d: Discount, currencyCode: string) {
	if (d.type === "PERCENT") return d.value ? `${d.value}%` : "—";
	const raw = d.value ?? "";
	return raw ? formatMoney({ currencyCode, amount: raw }) : "—";
}

function sortDiscounts(discounts: Discount[]): Discount[] {
	return [...discounts].sort((a, b) => {
		const aName = (a.name ?? "").toLowerCase();
		const bName = (b.name ?? "").toLowerCase();
		return aName.localeCompare(bName);
	});
}

function formatCompactCount(value: number, countryCode?: string | null): string {
	return formatCompactNumber(value, countryCode);
}

export default function DiscountVisibilityScreen() {
	const theme = useTheme();
	const router = useRouter();
	const { width } = useWindowDimensions();
	const { withBusy, busy } = useAppBusy();
	const { currencyCode, countryCode } = useActiveBusinessMeta();

	const isTablet = width >= 768;
	const contentMaxWidth = isTablet ? CONTENT_MAX_WIDTH_TABLET : undefined;

	const borderColor = theme.colors.outlineVariant ?? theme.colors.outline;
	const surfaceAlt = theme.colors.surfaceVariant ?? theme.colors.surface;

	const [showHidden, setShowHidden] = useState(false);
	const [qText, setQText] = useState("");
	const q = qText.trim();
	const hasSearch = q.length > 0;

	const discountsQuery = useDiscountsList({ q: q || undefined, isActive: true, includeArchived: false });

	const visibilityQuery = useDiscountVisibilityQuery();
	const visibilityMutation = useDiscountVisibilityMutation();

	const hiddenDiscountIds = visibilityQuery.hiddenDiscountIds;

	const activeDiscounts = useMemo(
		() => (discountsQuery.data?.items ?? []).filter((d) => d.isActive),
		[discountsQuery.data],
	);

	const visibleDiscounts = useMemo(
		() => sortDiscounts(activeDiscounts.filter((d) => !hiddenDiscountIds.has(d.id))),
		[activeDiscounts, hiddenDiscountIds],
	);

	const hiddenDiscounts = useMemo(
		() => sortDiscounts(activeDiscounts.filter((d) => hiddenDiscountIds.has(d.id))),
		[activeDiscounts, hiddenDiscountIds],
	);
	const hiddenCount = hiddenDiscounts.length;
	const compactHidden = formatCompactCount(hiddenCount, countryCode);
	const hiddenSubtitle =
		hiddenCount > 0 ? `${compactHidden} hidden. View and restore discounts.` : "View and restore discounts.";

	const displayDiscounts = useMemo(
		() => (showHidden ? [...hiddenDiscounts, ...visibleDiscounts] : visibleDiscounts),
		[hiddenDiscounts, showHidden, visibleDiscounts],
	);

	const isUiDisabled = busy.isBusy || visibilityMutation.isPending;
	const isLoading = discountsQuery.isLoading || visibilityQuery.isLoading;
	const isError = discountsQuery.isError || visibilityQuery.isError;
	const onBack = useCallback(() => {
		if (isUiDisabled) return;
		if (router.canGoBack?.()) {
			router.back();
			return;
		}
		router.replace(SETTINGS_DISCOUNTS_LEDGER_ROUTE as any);
	}, [isUiDisabled, router]);
	const headerOptions = useAppHeader("detail", { title: "Discount Visibility", disabled: isUiDisabled, onBack });
	const surfaceInteractive = useMemo(
		() => ({
			borderColor,
			backgroundColor: surfaceAlt,
		}),
		[borderColor, surfaceAlt],
	);

	const onHideDiscount = useCallback(
		async (discount: Discount) => {
			if (isUiDisabled) return;

			await withBusy("Hiding discount…", async () => {
				await visibilityMutation.mutateAsync({ action: "HIDE", discountId: discount.id });
			});
		},
		[isUiDisabled, visibilityMutation, withBusy],
	);

	const onRestoreDiscount = useCallback(
		async (discount: Discount) => {
			if (isUiDisabled) return;

			await withBusy("Restoring discount…", async () => {
				await visibilityMutation.mutateAsync({ action: "RESTORE", discountId: discount.id });
			});
		},
		[isUiDisabled, visibilityMutation, withBusy],
	);

	const handleRetry = useCallback(() => {
		discountsQuery.refetch();
		visibilityQuery.refetch();
	}, [discountsQuery, visibilityQuery]);
	const onClearSearch = useCallback(() => {
		setQText("");
	}, []);

	const renderRow = useCallback(
		(discount: Discount) => {
			const metaParts = [formatType(discount.type), formatValueLabel(discount, currencyCode)];
			if (discount.isStackable) metaParts.push("Stackable");

			const isArchived = discount.isActive === false;
			const isHidden = hiddenDiscountIds.has(discount.id);
			const iconColor = isArchived ? theme.colors.error : theme.colors.onSurfaceVariant;
			const actionLabel = isHidden ? "Restore" : "Hide";
			const actionIntent = isHidden ? "success" : "neutral";
			const actionVariant = isHidden ? "solid" : "outline";
			const actionStyle = styles.actionButton;
			const actionLabelStyle = isHidden ? { color: theme.colors.onPrimary } : undefined;

			const onPress = isHidden ? () => onRestoreDiscount(discount) : () => onHideDiscount(discount);

			return (
				<BAISurface style={[styles.row, surfaceInteractive]} padded bordered>
					<View style={styles.rowContent}>
						<View style={styles.rowLeft}>
							<View style={styles.rowNameWrap}>
								{isArchived ? (
									<MaterialCommunityIcons name='archive-outline' size={18} color={iconColor} />
								) : isHidden ? (
									<MaterialCommunityIcons name='eye-off' size={18} color={iconColor} />
								) : (
									<MaterialCommunityIcons name='tag-outline' size={18} color={iconColor} />
								)}
								<BAIText variant='body' numberOfLines={1} style={styles.rowNameText}>
									{discount.name}
								</BAIText>
							</View>
							<BAIText variant='caption' muted numberOfLines={1}>
								{metaParts.join(" • ")}
							</BAIText>
						</View>

						<BAIButton
							size='sm'
							variant={actionVariant}
							intent={actionIntent}
							onPress={onPress}
							disabled={isUiDisabled}
							style={actionStyle}
							labelStyle={actionLabelStyle}
							widthPreset='standard'
						>
							{actionLabel}
						</BAIButton>
					</View>
				</BAISurface>
			);
		},
		[
			currencyCode,
			hiddenDiscountIds,
			isUiDisabled,
			onHideDiscount,
			onRestoreDiscount,
			surfaceInteractive,
			theme.colors.error,
			theme.colors.onPrimary,
			theme.colors.onSurfaceVariant,
		],
	);

	return (
		<>
			<Stack.Screen options={headerOptions} />
			<BAIScreen tabbed padded={false} safeTop={false}>
				<SettingsScreenLayout screenStyle={styles.screen} maxWidth={contentMaxWidth}>
					<BAISurface style={[styles.card, { borderColor }]} padded bordered>
						<SettingsSectionTitle>Manage Discount Visibility</SettingsSectionTitle>

							<BAISwitchRow
								label={showHidden ? "Hidden discounts visible" : "Show hidden discounts"}
								description={hiddenSubtitle}
								value={showHidden}
								onValueChange={setShowHidden}
								disabled={isUiDisabled}
							/>
							<BAISearchBar
								value={qText}
								onChangeText={(v) => {
									const cleaned = sanitizeSearchInput(v);
									setQText(cleaned.length > FIELD_LIMITS.search ? cleaned.slice(0, FIELD_LIMITS.search) : cleaned);
								}}
								placeholder='Search Discounts...'
								maxLength={FIELD_LIMITS.search}
								onClear={hasSearch ? onClearSearch : undefined}
								disabled={isUiDisabled}
							/>

							<View style={styles.sectionHeader}>
								<BAIText variant='caption' muted>
									{showHidden ? "All Discounts" : "Visible Discounts"}
								</BAIText>
							</View>

							<View style={styles.listRegion}>
								{isLoading ? (
									<BAISurface style={[styles.stateCard, { borderColor }]} padded bordered>
										<View style={styles.loadingState}>
											<BAIActivityIndicator size='large' tone='primary' />
											<View style={{ height: 10 }} />
											<BAIText variant='subtitle'>Loading visibility…</BAIText>
										</View>
									</BAISurface>
								) : isError ? (
									<BAISurface style={[styles.stateCard, { borderColor }]} padded bordered>
										<BAIText variant='subtitle'>Could not load discount visibility.</BAIText>
										<View style={{ height: 12 }} />
										<BAIRetryButton variant='outline' onPress={handleRetry} disabled={isUiDisabled}>
											Retry
										</BAIRetryButton>
									</BAISurface>
								) : displayDiscounts.length === 0 ? (
									<BAISurface style={[styles.stateCard, { borderColor }]} padded bordered>
										<BAIText variant='subtitle'>No discounts found.</BAIText>
										<BAIText variant='caption' muted>
											Create a discount to see it listed here.
										</BAIText>
									</BAISurface>
								) : (
									<FlatList
										data={displayDiscounts}
										keyExtractor={(item) => item.id}
										renderItem={({ item }) => renderRow(item)}
										contentContainerStyle={styles.listContent}
										showsVerticalScrollIndicator={false}
										alwaysBounceVertical={false}
										keyboardShouldPersistTaps='handled'
										keyboardDismissMode='on-drag'
										ItemSeparatorComponent={() => <View style={styles.itemGap} />}
										ListFooterComponent={<View style={styles.listFooterGap} />}
									/>
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
		paddingTop: 2,
	},

	listRegion: {
		flex: 1,
		minHeight: 220,
	},

	listContent: {
		gap: 0,
		paddingBottom: 10,
	},

	itemGap: {
		height: 0,
	},

	listFooterGap: {
		height: 10,
	},

	row: {
		borderRadius: 18,
	},

	rowContent: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		gap: 12,
	},

	rowLeft: {
		flex: 1,
		gap: 4,
		minWidth: 0,
	},
	rowNameWrap: {
		flexDirection: "row",
		alignItems: "center",
		gap: 8,
		minWidth: 0,
	},
	rowNameText: {
		flex: 1,
		minWidth: 0,
	},

	actionButton: {
		minWidth: 96,
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
