// BizAssist_mobile
// path: app/(app)/(tabs)/settings/categories/[id]/restore.tsx
//
// Governance:
// - Restore is a PROCESS screen.
// - Exit cancels and returns to category details.

import { useCallback, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "react-native-paper";

import { BAIButton } from "@/components/ui/BAIButton";
import { BAICTAPillButton } from "@/components/ui/BAICTAButton";
import { BAIRetryButton } from "@/components/ui/BAIRetryButton";
import { BAIScreen } from "@/components/ui/BAIScreen";
import { BAISurface } from "@/components/ui/BAISurface";
import { BAIText } from "@/components/ui/BAIText";
import { SettingsScreenLayout } from "@/components/settings/SettingsLayout";
import { useAppBusy } from "@/hooks/useAppBusy";
import { categoriesApi } from "@/modules/categories/categories.api";
import { syncCategoryCaches } from "@/modules/categories/categories.cache";
import { categoryKeys } from "@/modules/categories/categories.queryKeys";
import type { Category } from "@/modules/categories/categories.types";
import { useAppHeader } from "@/modules/navigation/useAppHeader";
import { useProcessExitGuard } from "@/modules/navigation/useProcessExitGuard";
import { useInventoryHeader } from "@/modules/inventory/useInventoryHeader";

const SETTINGS_CATEGORIES_ROUTE = "/(app)/(tabs)/settings/categories" as const;
const INVENTORY_CATEGORIES_ROUTE = "/(app)/(tabs)/inventory/categories/category.ledger" as const;
type CategoryFlowMode = "settings" | "inventory";

function extractApiErrorMessage(err: unknown): string {
	const data = (err as any)?.response?.data;
	const msg = data?.message ?? data?.error?.message ?? (err as any)?.message ?? "Failed to restore category.";
	return String(msg);
}

export function CategoryRestoreScreen({ mode = "settings" }: { mode?: CategoryFlowMode }) {
	const router = useRouter();
	const theme = useTheme();
	const qc = useQueryClient();
	const { withBusy, busy } = useAppBusy();

	const params = useLocalSearchParams<{ id?: string }>();
	const categoryId = String(params.id ?? "").trim();

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
	const listParams = useMemo(() => ({ limit: 250 }), []);
	const query = useQuery<{ items: Category[] }>({
		queryKey: categoryKeys.list(listParams),
		queryFn: () => categoriesApi.list(listParams),
		staleTime: 300_000,
		enabled: !!categoryId,
	});
	const category = useMemo(
		() => query.data?.items?.find((item) => item.id === categoryId) ?? null,
		[categoryId, query.data?.items],
	);
	const canRestore = !!category && !category.isActive;
	const categoriesRoute = mode === "settings" ? SETTINGS_CATEGORIES_ROUTE : INVENTORY_CATEGORIES_ROUTE;
	const detailRoute = useMemo(() => {
		if (!categoryId) return categoriesRoute;
		return mode === "settings"
			? `/(app)/(tabs)/settings/categories/${encodeURIComponent(categoryId)}`
			: `/(app)/(tabs)/inventory/categories/${encodeURIComponent(categoryId)}`;
	}, [categoriesRoute, categoryId, mode]);

	const onExit = useCallback(() => {
		if (isUiDisabled) return;
		if (!lockNav()) return;
		router.replace(detailRoute as any);
	}, [detailRoute, isUiDisabled, lockNav, router]);
	const guardedOnExit = useProcessExitGuard(onExit);

	const onConfirmRestore = useCallback(async () => {
		if (!category || !canRestore || isUiDisabled) return;
		if (!lockNav()) return;

		setError(null);
		await withBusy("Restoring category...", async () => {
			try {
				await categoriesApi.restore(category.id);
				syncCategoryCaches(qc, { ...category, isActive: true });
				void qc.invalidateQueries({ queryKey: categoryKeys.root() });
				router.replace(detailRoute as any);
			} catch (e) {
				setError(extractApiErrorMessage(e));
			}
		});
	}, [canRestore, category, detailRoute, isUiDisabled, lockNav, qc, router, withBusy]);

	const borderColor = theme.colors.outlineVariant ?? theme.colors.outline;
	const settingsHeaderOptions = useAppHeader("process", {
		title: "Restore Category",
		disabled: isUiDisabled,
		onExit: guardedOnExit,
	});
	const inventoryHeaderOptions = useInventoryHeader("process", {
		title: "Restore Category",
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
							Restored categories become active and selectable in pickers again.
						</BAIText>

						<View style={{ height: 12 }} />

						{query.isLoading ? (
							<BAIText variant='caption' muted>
								Loading category...
							</BAIText>
						) : query.isError ? (
							<View style={styles.stateBlock}>
								<BAIText variant='caption' muted>
									Could not load category.
								</BAIText>
								<BAIRetryButton variant='outline' onPress={() => query.refetch()} disabled={isUiDisabled}>
									Retry
								</BAIRetryButton>
							</View>
						) : !category ? (
							<BAIText variant='caption' muted>
								Category not found.
							</BAIText>
						) : !canRestore ? (
							<BAIText variant='caption' muted>
								This category cannot be restored.
							</BAIText>
						) : (
							<BAIText variant='body'>This action will restore “{category.name}”.</BAIText>
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
								intent='primary'
								onPress={onConfirmRestore}
								disabled={!canRestore || isUiDisabled}
								style={styles.actionBtn}
							>
								Restore
							</BAICTAPillButton>
						</View>
					</BAISurface>
				</SettingsScreenLayout>
			</BAIScreen>
		</>
	);
}

export default function SettingsCategoryRestoreScreen() {
	return <CategoryRestoreScreen mode='settings' />;
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
