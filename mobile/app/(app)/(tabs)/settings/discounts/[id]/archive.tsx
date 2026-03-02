// BizAssist_mobile
// path: app/(app)/(tabs)/settings/discounts/[id]/archive.tsx
//
// Header governance:
// - Archive Discount is a PROCESS screen -> use EXIT.
// - Exit cancels and returns to discount detail.

import { useCallback, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useTheme } from "react-native-paper";

import { BAIButton } from "@/components/ui/BAIButton";
import { BAICTAPillButton } from "@/components/ui/BAICTAButton";
import { BAIRetryButton } from "@/components/ui/BAIRetryButton";
import { BAIScreen } from "@/components/ui/BAIScreen";
import { BAISurface } from "@/components/ui/BAISurface";
import { BAIText } from "@/components/ui/BAIText";
import { SettingsScreenLayout } from "@/components/settings/SettingsLayout";
import { useAppBusy } from "@/hooks/useAppBusy";
import {
	buildInventoryDiscountDetailsRoute,
	buildInventoryDiscountLedgerRoute,
	buildSettingsDiscountDetailsRoute,
	buildSettingsDiscountLedgerRoute,
	normalizeDiscountReturnTo,
} from "@/modules/discounts/discounts.navigation";
import { useArchiveDiscount, useDiscountById } from "@/modules/discounts/discounts.queries";
import { useAppHeader } from "@/modules/navigation/useAppHeader";
import { useProcessExitGuard } from "@/modules/navigation/useProcessExitGuard";
import { useInventoryHeader } from "@/modules/inventory/useInventoryHeader";

type DiscountFlowMode = "settings" | "inventory";

function extractApiErrorMessage(err: unknown): string {
	const data = (err as any)?.response?.data;
	const msg = data?.message ?? data?.error?.message ?? (err as any)?.message ?? "Failed to archive discount.";
	return String(msg);
}

export function DiscountArchiveScreen({ mode = "settings" }: { mode?: DiscountFlowMode }) {
	const router = useRouter();
	const theme = useTheme();
	const { withBusy, busy } = useAppBusy();

	const params = useLocalSearchParams<{ id?: string; returnTo?: string }>();
	const discountId = String(params.id ?? "");
	const returnTo = useMemo(() => normalizeDiscountReturnTo(params.returnTo), [params.returnTo]);

	const [error, setError] = useState<string | null>(null);

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
	const query = useDiscountById(discountId);
	const archive = useArchiveDiscount(discountId);
	const discount = query.data ?? null;
	const canArchive = !!discount && discount.isActive;
	const detailRoute = useMemo(() => {
		if (!discountId)
			return mode === "settings"
				? buildSettingsDiscountLedgerRoute(returnTo)
				: buildInventoryDiscountLedgerRoute(returnTo);
		return mode === "settings"
			? buildSettingsDiscountDetailsRoute(discountId, returnTo)
			: buildInventoryDiscountDetailsRoute(discountId, returnTo);
	}, [discountId, mode, returnTo]);

	const onExit = useCallback(() => {
		if (isUiDisabled) return;
		if (!lockNav()) return;
		router.replace(detailRoute as any);
	}, [detailRoute, isUiDisabled, lockNav, router]);
	const guardedOnExit = useProcessExitGuard(onExit);

	const onConfirmArchive = useCallback(async () => {
		if (!discount || !canArchive || isUiDisabled) return;
		if (!lockNav()) return;

		setError(null);
		await withBusy("Archiving discount...", async () => {
			try {
				await archive.mutateAsync();
				router.replace(detailRoute as any);
			} catch (e) {
				setError(extractApiErrorMessage(e));
			}
		});
	}, [archive, canArchive, detailRoute, discount, isUiDisabled, lockNav, router, withBusy]);

	const borderColor = theme.colors.outlineVariant ?? theme.colors.outline;
	const settingsHeaderOptions = useAppHeader("process", {
		title: "Archive Discount",
		disabled: isUiDisabled,
		onExit: guardedOnExit,
	});
	const inventoryHeaderOptions = useInventoryHeader("process", {
		title: "Archive Discount",
		disabled: isUiDisabled,
		onExit: guardedOnExit,
	});
	const headerOptions = mode === "settings" ? settingsHeaderOptions : inventoryHeaderOptions;

	return (
		<>
			<Stack.Screen options={headerOptions} />
			<BAIScreen tabbed padded={false} safeTop={false}>
				<SettingsScreenLayout screenStyle={styles.screen} maxWidth={560}>
					<BAISurface style={[styles.card, { borderColor }]} padded bordered>
						<BAIText variant='caption' muted>
							Archived discounts remain in history and are removed from new picker selections.
						</BAIText>

						<View style={{ height: 12 }} />

						{query.isLoading ? (
							<BAIText variant='caption' muted>
								Loading discount...
							</BAIText>
						) : query.isError ? (
							<View style={styles.stateBlock}>
								<BAIText variant='caption' muted>
									Could not load discount.
								</BAIText>
								<BAIRetryButton variant='outline' onPress={() => query.refetch()} disabled={isUiDisabled}>
									Retry
								</BAIRetryButton>
							</View>
						) : !discount ? (
							<BAIText variant='caption' muted>
								Discount not found.
							</BAIText>
						) : !canArchive ? (
							<BAIText variant='caption' muted>
								This discount cannot be archived.
							</BAIText>
						) : (
							<BAIText variant='body'>This action will archive “{discount.name}”.</BAIText>
						)}

						{error ? (
							<>
								<View style={{ height: 10 }} />
								<BAIText variant='caption' style={{ color: theme.colors.error }}>
									{error}
								</BAIText>
							</>
						) : null}

						<View style={{ height: 14 }} />

						<View style={styles.actionsRow}>
							<BAIButton
								shape='pill'
								widthPreset='standard'
								variant='outline'
								intent='neutral'
								onPress={guardedOnExit}
								disabled={isUiDisabled}
								style={styles.actionBtn}
							>
								Cancel
							</BAIButton>

							<BAICTAPillButton
								variant='solid'
								intent='danger'
								onPress={onConfirmArchive}
								disabled={!canArchive || isUiDisabled}
								style={styles.actionBtn}
							>
								Archive
							</BAICTAPillButton>
						</View>
					</BAISurface>
				</SettingsScreenLayout>
			</BAIScreen>
		</>
	);
}

export default function SettingsDiscountArchiveScreen() {
	return <DiscountArchiveScreen mode='settings' />;
}

const styles = StyleSheet.create({
	screen: {
		padding: 12,
	},
	card: {
		borderRadius: 18,
	},
	stateBlock: {
		gap: 10,
	},
	actionsRow: {
		flexDirection: "row",
		gap: 12,
	},
	actionBtn: {
		flex: 1,
	},
});
