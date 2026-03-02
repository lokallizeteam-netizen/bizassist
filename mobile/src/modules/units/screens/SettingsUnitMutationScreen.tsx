import { useCallback, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "react-native-paper";

import { SettingsScreenLayout } from "@/components/settings/SettingsLayout";
import { BAIButton } from "@/components/ui/BAIButton";
import { BAICTAPillButton } from "@/components/ui/BAICTAButton";
import { BAIRetryButton } from "@/components/ui/BAIRetryButton";
import { BAIScreen } from "@/components/ui/BAIScreen";
import { BAISurface } from "@/components/ui/BAISurface";
import { BAIText } from "@/components/ui/BAIText";
import { useAppBusy } from "@/hooks/useAppBusy";
import { useAppHeader } from "@/modules/navigation/useAppHeader";
import { useProcessExitGuard } from "@/modules/navigation/useProcessExitGuard";
import { unitsApi } from "@/modules/units/units.api";
import { syncUnitListCaches } from "@/modules/units/units.cache";
import { unitKeys } from "@/modules/units/units.queries";
import type { Unit } from "@/modules/units/units.types";

const SETTINGS_UNITS_ROUTE = "/(app)/(tabs)/settings/units" as const;
const PROTECTED_CATALOG_ID = "ea" as const;

type MutationMode = "archive" | "restore";

function extractApiErrorMessage(err: unknown, fallback: string): string {
	const data = (err as any)?.response?.data;
	const msg = data?.message ?? data?.error?.message ?? (err as any)?.message ?? fallback;
	return String(msg);
}

function getConfig(mode: MutationMode) {
	if (mode === "archive") {
		return {
			title: "Archive Unit",
			intro: "Archived units remain in history but cannot be selected for new items.",
			invalid: "This unit cannot be archived.",
			confirmLabel: "Archive",
			confirmIntent: "danger" as const,
			loadingLabel: "Archiving unit...",
			errorFallback: "Failed to archive unit.",
			canAct: (unit: Unit | null) => !!unit && !unit.catalogId && unit.isActive && unit.catalogId !== PROTECTED_CATALOG_ID,
			run: (unitId: string) => unitsApi.archiveUnit(unitId),
			confirmCopy: (unit: Unit) => `This action will archive “${unit.name}”.`,
		};
	}

	return {
		title: "Restore Unit",
		intro: "Restored units can be selected for new items again.",
		invalid: "This unit cannot be restored.",
		confirmLabel: "Restore",
		confirmIntent: "primary" as const,
		loadingLabel: "Restoring unit...",
		errorFallback: "Failed to restore unit.",
		canAct: (unit: Unit | null) => !!unit && !unit.catalogId && !unit.isActive,
		run: (unitId: string) => unitsApi.restoreUnit(unitId),
		confirmCopy: (unit: Unit) => `This action will restore “${unit.name}”.`,
	};
}

function SettingsUnitMutationScreen({ mode }: { mode: MutationMode }) {
	const router = useRouter();
	const theme = useTheme();
	const { withBusy, busy } = useAppBusy();
	const queryClient = useQueryClient();
	const params = useLocalSearchParams<{ id?: string }>();
	const unitId = String(params.id ?? "");

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

	const isUiDisabled = busy.isBusy || isNavLocked;
	const config = useMemo(() => getConfig(mode), [mode]);

	const unitsQuery = useQuery<Unit[]>({
		queryKey: unitKeys.list({ includeArchived: true }),
		queryFn: () => unitsApi.listUnits({ includeArchived: true }),
		staleTime: 300_000,
	});

	const unit = useMemo(() => {
		const list = unitsQuery.data ?? [];
		return list.find((candidate) => candidate.id === unitId) ?? null;
	}, [unitId, unitsQuery.data]);

	const canAct = config.canAct(unit);
	const detailRoute = useMemo(() => {
		if (!unitId) return SETTINGS_UNITS_ROUTE;
		return `/(app)/(tabs)/settings/units/${encodeURIComponent(unitId)}` as const;
	}, [unitId]);

	const onExit = useCallback(() => {
		if (isUiDisabled) return;
		if (!lockNav()) return;
		router.replace(detailRoute as any);
	}, [detailRoute, isUiDisabled, lockNav, router]);
	const guardedOnExit = useProcessExitGuard(onExit);

	const onConfirm = useCallback(async () => {
		if (!unit || !canAct || isUiDisabled) return;
		if (!lockNav()) return;

		setError(null);
		await withBusy(config.loadingLabel, async () => {
			try {
				const nextUnit = await config.run(unit.id);
				syncUnitListCaches(queryClient, nextUnit);
				void queryClient.invalidateQueries({ queryKey: unitKeys.root });
				router.replace(detailRoute as any);
			} catch (err) {
				setError(extractApiErrorMessage(err, config.errorFallback));
			}
		});
	}, [canAct, config, detailRoute, isUiDisabled, lockNav, queryClient, router, unit, withBusy]);

	const borderColor = theme.colors.outlineVariant ?? theme.colors.outline;
	const headerOptions = useAppHeader("process", {
		title: config.title,
		disabled: isUiDisabled,
		onExit: guardedOnExit,
	});

	return (
		<>
			<Stack.Screen options={headerOptions} />
			<BAIScreen tabbed padded={false} safeTop={false}>
				<SettingsScreenLayout screenStyle={styles.screen} maxWidth={560}>
					<BAISurface style={[styles.card, { borderColor }]} padded bordered>
						<BAIText variant='caption' muted>
							{config.intro}
						</BAIText>

						<View style={styles.bodyBlock}>
							{unitsQuery.isLoading ? (
								<BAIText variant='caption' muted>
									Loading unit...
								</BAIText>
							) : unitsQuery.isError ? (
								<View style={styles.stateBlock}>
									<BAIText variant='caption' muted>
										Could not load unit.
									</BAIText>
									<BAIRetryButton variant='outline' onPress={() => unitsQuery.refetch()} disabled={isUiDisabled}>
										Retry
									</BAIRetryButton>
								</View>
							) : !unit ? (
								<BAIText variant='caption' muted>
									Unit not found.
								</BAIText>
							) : !canAct ? (
								<BAIText variant='caption' muted>
									{config.invalid}
								</BAIText>
							) : (
								<BAIText variant='body'>{config.confirmCopy(unit)}</BAIText>
							)}

							{error ? (
								<BAIText variant='caption' style={{ color: theme.colors.error }}>
									{error}
								</BAIText>
							) : null}
						</View>

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
								intent={config.confirmIntent}
								onPress={onConfirm}
								disabled={!canAct || isUiDisabled}
								style={styles.actionBtn}
							>
								{config.confirmLabel}
							</BAICTAPillButton>
						</View>
					</BAISurface>
				</SettingsScreenLayout>
			</BAIScreen>
		</>
	);
}

export function SettingsUnitArchiveScreen() {
	return <SettingsUnitMutationScreen mode='archive' />;
}

export function SettingsUnitRestoreScreen() {
	return <SettingsUnitMutationScreen mode='restore' />;
}

const styles = StyleSheet.create({
	screen: {
		paddingHorizontal: 12,
		paddingTop: 0,
	},
	card: {
		borderRadius: 18,
	},
	bodyBlock: {
		gap: 10,
		marginTop: 12,
	},
	stateBlock: {
		gap: 10,
	},
	actionsRow: {
		flexDirection: "row",
		gap: 12,
		marginTop: 14,
	},
	actionBtn: {
		flex: 1,
	},
});
