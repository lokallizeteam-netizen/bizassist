// BizAssist_mobile
// path: app/(app)/(tabs)/settings/discounts/[id]/index.tsx
//
// Header governance:
// - Discount details is a Settings detail screen -> use BACK.
// - If routed with returnTo, BACK resolves deterministically to settings discounts ledger.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackHandler, StyleSheet, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useTheme } from "react-native-paper";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";

import { BAIActivityIndicator } from "@/components/system/BAIActivityIndicator";
import { BAIButton } from "@/components/ui/BAIButton";
import { BAIRetryButton } from "@/components/ui/BAIRetryButton";
import { BAIScreen } from "@/components/ui/BAIScreen";
import { BAISurface } from "@/components/ui/BAISurface";
import { BAIText } from "@/components/ui/BAIText";
import { SettingsScreenLayout } from "@/components/settings/SettingsLayout";

import { useAppBusy } from "@/hooks/useAppBusy";
import { useActiveBusinessMeta } from "@/modules/business/useActiveBusinessMeta";
import { useDiscountById, useDiscountVisibilityQuery } from "@/modules/discounts/discounts.queries";
import {
	buildSettingsDiscountArchiveRoute,
	buildSettingsDiscountEditRoute,
	buildSettingsDiscountRestoreRoute,
	resolveSettingsDiscountDetailBackFallbackRoute,
	normalizeReturnTo,
	SETTINGS_DISCOUNTS_LEDGER_ROUTE,
} from "@/modules/discounts/discounts.navigation";
import type { Discount } from "@/modules/discounts/discounts.types";
import { useAppHeader } from "@/modules/navigation/useAppHeader";
import { formatMoney } from "@/shared/money/money.format";

function formatDiscountValue(discount: Discount, currencyCode: string): string {
	if (discount.type === "PERCENT") {
		const raw = String(discount.value ?? "").trim();
		return raw ? `${raw}%` : "-";
	}

	const raw = String(discount.value ?? "").trim();
	if (!raw) return "-";
	return `-${formatMoney({ currencyCode, amount: raw })}`;
}

export default function SettingsDiscountDetailScreen() {
	const router = useRouter();
	const theme = useTheme();
	const { currencyCode } = useActiveBusinessMeta();
	const { busy } = useAppBusy();
	const tabBarHeight = useBottomTabBarHeight();

	const params = useLocalSearchParams<{ id?: string; returnTo?: string }>();
	const id = String(params.id ?? "");
	const returnTo = useMemo(() => normalizeReturnTo(params.returnTo), [params.returnTo]);
	const ledgerRoute = useMemo(() => resolveSettingsDiscountDetailBackFallbackRoute(returnTo), [returnTo]);

	const navLockRef = useRef(false);
	const [isNavLocked, setIsNavLocked] = useState(false);
	const [pendingAction, setPendingAction] = useState<"edit" | "archive" | "restore" | "cancel" | null>(null);
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

	const query = useDiscountById(id);
	const visibilityQuery = useDiscountVisibilityQuery();
	const hiddenDiscountIds = visibilityQuery.hiddenDiscountIds;
	const discount = query.data ?? null;

	const isArchived = !!discount && discount.isActive === false;
	const isHidden = !!discount && hiddenDiscountIds.has(discount.id);
	const nameIconColor = isArchived ? theme.colors.error : theme.colors.onSurfaceVariant;
	const canEdit = !!discount && !isArchived;
	const canArchive = !!discount && !isArchived;
	const canRestore = !!discount && isArchived;

	const onBack = useCallback(() => {
		if (isUiDisabled) return;
		if (!lockNav()) return;
		if (returnTo) {
			router.replace(SETTINGS_DISCOUNTS_LEDGER_ROUTE as any);
			return;
		}
		if (router.canGoBack?.()) {
			router.back();
			return;
		}
		router.replace(ledgerRoute as any);
	}, [isUiDisabled, ledgerRoute, lockNav, returnTo, router]);

	const onEdit = useCallback(() => {
		if (!discount || !canEdit || isUiDisabled) return;
		if (!lockNav()) return;
		setPendingAction("edit");
		const route = buildSettingsDiscountEditRoute(discount.id, returnTo);
		router.push(route as any);
	}, [canEdit, discount, isUiDisabled, lockNav, returnTo, router]);

	const onArchivePress = useCallback(() => {
		if (!discount || !canArchive || isUiDisabled) return;
		if (!lockNav()) return;
		setPendingAction("archive");
		const route = buildSettingsDiscountArchiveRoute(discount.id, returnTo);
		router.push(route as any);
	}, [canArchive, discount, isUiDisabled, lockNav, returnTo, router]);

	const onRestorePress = useCallback(() => {
		if (!discount || !canRestore || isUiDisabled) return;
		if (!lockNav()) return;
		setPendingAction("restore");
		const route = buildSettingsDiscountRestoreRoute(discount.id, returnTo);
		router.push(route as any);
	}, [canRestore, discount, isUiDisabled, lockNav, returnTo, router]);

	const borderColor = theme.colors.outlineVariant ?? theme.colors.outline;
	const valueLabel = useMemo(() => {
		if (!discount) return "-";
		return formatDiscountValue(discount, currencyCode);
	}, [currencyCode, discount]);
	const typeLabel = discount?.type === "PERCENT" ? "Percent" : discount?.type === "FIXED" ? "Amount" : "-";
	const stackableLabel = discount?.isStackable ? "Yes" : "No";
	const noteLabel = useMemo(() => {
		const value = String(discount?.note ?? "").trim();
		return value || "-";
	}, [discount?.note]);
	const headerOptions = useAppHeader("detail", {
		title: "Discount Details",
		disabled: isUiDisabled,
		onBack,
	});

	useEffect(() => {
		const sub = BackHandler.addEventListener("hardwareBackPress", () => {
			if (isUiDisabled) return true;
			onBack();
			return true;
		});
		return () => sub.remove();
	}, [isUiDisabled, onBack]);

	useEffect(() => {
		if (!isNavLocked) setPendingAction(null);
	}, [isNavLocked]);

	return (
		<>
			<Stack.Screen options={headerOptions} />
			<BAIScreen
				padded={false}
				safeTop={false}
				safeBottom={false}
				scroll
				style={styles.root}
				contentContainerStyle={styles.scrollContent}
				scrollProps={{ showsVerticalScrollIndicator: false }}
			>
				<SettingsScreenLayout
					screenStyle={[styles.screen, { paddingBottom: tabBarHeight + 14 }]}
					maxWidth={860}
					columnStyle={styles.contentColumn}
				>
						{query.isLoading ? (
							<BAISurface style={[styles.stateCard, { borderColor }]} padded bordered>
								<View style={styles.headerBlock}>
									<BAIText variant='caption' muted style={styles.detailSubtitle}>
										Review discount status and configuration.
									</BAIText>
								</View>
								<View style={[styles.summaryDivider, { backgroundColor: borderColor }]} />
								<View style={styles.stateBlock}>
									<BAIActivityIndicator />
									<BAIText variant='caption' muted style={styles.stateMessage}>
										Loading discount details...
									</BAIText>
								</View>
							</BAISurface>
						) : query.isError ? (
							<BAISurface style={[styles.stateCard, { borderColor }]} padded bordered>
								<View style={styles.headerBlock}>
									<BAIText variant='caption' muted style={styles.detailSubtitle}>
										Review discount status and configuration.
									</BAIText>
								</View>
								<View style={[styles.summaryDivider, { backgroundColor: borderColor }]} />
								<View style={styles.stateBlock}>
									<BAIText variant='caption' muted style={styles.stateMessage}>
										Unable to load discount details.
									</BAIText>
									<BAIRetryButton onPress={() => query.refetch()} disabled={isUiDisabled}>
										Retry
									</BAIRetryButton>
								</View>
							</BAISurface>
						) : !discount ? (
							<BAISurface style={[styles.stateCard, { borderColor }]} padded bordered>
								<View style={styles.headerBlock}>
									<BAIText variant='caption' muted style={styles.detailSubtitle}>
										Review discount status and configuration.
									</BAIText>
								</View>
								<View style={[styles.summaryDivider, { backgroundColor: borderColor }]} />
								<View style={styles.stateBlock}>
									<BAIText variant='caption' muted style={styles.stateMessage}>
										Discount not found.
									</BAIText>
									<BAIButton
										mode='outlined'
										onPress={onBack}
										disabled={isUiDisabled}
										shape='pill'
										widthPreset='standard'
									>
										Back
									</BAIButton>
								</View>
							</BAISurface>
						) : (
							<>
								<BAISurface style={[styles.summaryCard, { borderColor }]} padded bordered>
									<View style={styles.headerBlock}>
										<BAIText variant='caption' muted style={styles.detailSubtitle}>
											Review discount status and configuration.
										</BAIText>
									</View>
									<View style={[styles.summaryDivider, { backgroundColor: borderColor }]} />

									<View style={styles.summaryHeader}>
										<View style={styles.summaryTitleBlock}>
											<View style={styles.summaryTitleRow}>
												{isArchived ? (
													<MaterialCommunityIcons name='archive-outline' size={18} color={nameIconColor} />
												) : isHidden ? (
													<MaterialCommunityIcons name='eye-off' size={18} color={nameIconColor} />
												) : (
													<Ionicons name='pricetag-outline' size={18} color={nameIconColor} />
												)}
												<BAIText variant='subtitle' numberOfLines={1} style={styles.summaryTitleText}>
													{discount.name}
												</BAIText>
											</View>
										</View>
										<View
											style={[
												styles.statusPill,
												{
													borderColor,
													backgroundColor: discount.isActive
														? (theme.colors.primaryContainer ?? theme.colors.surface)
														: (theme.colors.errorContainer ?? theme.colors.surface),
												},
											]}
										>
											<BAIText
												variant='caption'
												style={[
													styles.statusPillText,
													{
														color: discount.isActive
															? (theme.colors.onPrimaryContainer ?? theme.colors.onSurface)
															: (theme.colors.onErrorContainer ?? theme.colors.onSurface),
													},
												]}
											>
												{discount.isActive ? "Active" : "Archived"}
											</BAIText>
										</View>
									</View>

									<View style={[styles.summaryDivider, { backgroundColor: borderColor }]} />

									<View style={styles.detailsList}>
										<View style={styles.metaRow}>
											<BAIText variant='caption' muted style={styles.metaLabel}>
												Type
											</BAIText>
											<View style={styles.metaValueRow}>
												<BAIText variant='body' style={styles.metaValueText}>
													{typeLabel}
												</BAIText>
											</View>
										</View>
										<View style={[styles.metaDivider, { backgroundColor: borderColor }]} />

										<View style={styles.metaRow}>
											<BAIText variant='caption' muted style={styles.metaLabel}>
												Value
											</BAIText>
											<View style={styles.metaValueRow}>
												<BAIText variant='body' style={styles.metaValueText}>
													{valueLabel}
												</BAIText>
											</View>
										</View>
										<View style={[styles.metaDivider, { backgroundColor: borderColor }]} />

										<View style={styles.metaRow}>
											<BAIText variant='caption' muted style={styles.metaLabel}>
												Stackable
											</BAIText>
											<View style={styles.metaValueRow}>
												<BAIText variant='body' style={styles.metaValueText}>
													{stackableLabel}
												</BAIText>
											</View>
										</View>
										<View style={[styles.metaDivider, { backgroundColor: borderColor }]} />
										<View style={styles.noteRow}>
											<BAIText variant='caption' muted style={styles.metaLabel}>
												Note
											</BAIText>
											<View style={styles.metaValueRow}>
												<BAIText variant='body' style={styles.noteValue}>
													{noteLabel}
												</BAIText>
											</View>
										</View>
									</View>

									<View style={[styles.summaryDivider, { backgroundColor: borderColor }]} />
									<View style={styles.actionRow}>
										{canArchive ? (
											<BAIButton
												variant='outline'
												intent='danger'
												onPress={onArchivePress}
												disabled={isUiDisabled}
												loading={pendingAction === "archive" && isNavLocked}
												accessibilityLabel='Archive discount'
												accessibilityHint='Opens archive confirmation for this discount'
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
												loading={pendingAction === "edit" && isNavLocked}
												accessibilityLabel='Edit discount'
												accessibilityHint='Opens edit form for this discount'
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
													onPress={() => {
														setPendingAction("cancel");
														onBack();
													}}
													disabled={isUiDisabled}
													loading={pendingAction === "cancel" && isNavLocked}
													accessibilityLabel='Cancel restore'
													accessibilityHint='Returns to the previous screen without restoring'
													shape='pill'
													widthPreset='standard'
													style={styles.actionButton}
												>
													Cancel
												</BAIButton>
												<BAIButton
													onPress={onRestorePress}
													disabled={isUiDisabled}
													loading={pendingAction === "restore" && isNavLocked}
													accessibilityLabel='Restore discount'
													accessibilityHint='Restores this archived discount'
													shape='pill'
													widthPreset='standard'
													style={styles.actionButton}
												>
													Restore
												</BAIButton>
											</>
										) : null}
									</View>
								</BAISurface>
							</>
						)}
				</SettingsScreenLayout>
			</BAIScreen>
		</>
	);
}

const styles = StyleSheet.create({
	root: { flex: 1 },
	scrollContent: { paddingBottom: 8 },
	screen: {
		paddingHorizontal: 12,
	},
	contentColumn: {
		gap: 10,
	},
	headerBlock: { gap: 4 },
	detailSubtitle: {
		lineHeight: 18,
	},
	stateCard: {
		borderRadius: 16,
		marginBottom: 0,
		gap: 10,
	},
	stateBlock: {
		alignItems: "center",
		justifyContent: "center",
		paddingVertical: 24,
		gap: 12,
	},
	stateMessage: {
		textAlign: "center",
	},
	summaryCard: {
		borderRadius: 16,
		marginBottom: 0,
		gap: 10,
	},
	summaryHeader: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		gap: 10,
	},
	summaryTitleBlock: {
		flex: 1,
		gap: 2,
	},
	summaryTitleRow: {
		flexDirection: "row",
		alignItems: "center",
		gap: 8,
		minWidth: 0,
	},
	summaryTitleText: {
		flex: 1,
		minWidth: 0,
	},
	summaryDivider: {
		height: StyleSheet.hairlineWidth,
	},
	detailsList: {
		gap: 0,
	},
	metaRow: {
		flexDirection: "row",
		alignItems: "center",
		paddingVertical: 8,
	},
	noteRow: {
		flexDirection: "row",
		alignItems: "flex-start",
		paddingVertical: 8,
	},
	metaDivider: {
		height: StyleSheet.hairlineWidth,
	},
	metaLabel: {
		width: 88,
	},
	metaValueRow: {
		flex: 1,
		flexDirection: "row",
		alignItems: "center",
		gap: 8,
	},
	metaValueText: {
		fontWeight: "600",
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
	noteValue: {
		lineHeight: 20,
	},
	errorCard: {
		borderRadius: 14,
		marginBottom: 0,
	},
	errorText: {
		fontWeight: "500",
	},
	actionRow: {
		flexDirection: "row",
		paddingVertical: 10,
		gap: 10,
	},
	actionButton: {
		flex: 1,
	},
});
