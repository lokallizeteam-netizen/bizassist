// BizAssist_mobile
// path: app/(app)/(tabs)/inventory/units/picker.tsx
//
// Select Unit Type page
//
// REFAC:
// - Show unit precision scale per row so users can see how many decimals the unit supports.
// - Uses existing BAIRadioRow.description line (no new UI patterns).
// - Format: "Precision: 0" | "Precision: 0.00" | ... up to scale 5.
// - Unit list grouping in Select Unit Type:
//   1) Pinned "Per Piece" always shown first when available.
//   2) Next section: 5 most recently created units.
//   3) Last section: remaining older units.

import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useTheme } from "react-native-paper";

import { BAIButton } from "@/components/ui/BAIButton";
import { BAICTAPillButton } from "@/components/ui/BAICTAButton";
import { BAIRadioRow } from "@/components/ui/BAIRadioRow";
import { BAIRetryButton } from "@/components/ui/BAIRetryButton";
import { BAIScreen } from "@/components/ui/BAIScreen";
import { BAISurface } from "@/components/ui/BAISurface";
import { BAIText } from "@/components/ui/BAIText";

import { BAIActivityIndicator } from "@/components/system/BAIActivityIndicator";
import { useAppBusy } from "@/hooks/useAppBusy";
import {
	mapInventoryRouteToScope,
	resolveInventoryRouteScope,
	type InventoryRouteScope,
} from "@/modules/inventory/navigation.scope";
import { useProcessExitGuard } from "@/modules/navigation/useProcessExitGuard";
import { precisionHint } from "@/modules/units/units.format";
import {
	buildUnitSelectionParams,
	DRAFT_ID_KEY,
	parseUnitSelectionParams,
	RETURN_TO_KEY,
	UNIT_ADD_ROUTE,
	UNIT_CONTEXT_PRODUCT_TYPE_KEY,
	UNIT_SELECTED_ABBR_KEY,
	UNIT_SELECTED_CATEGORY_KEY,
	UNIT_SELECTED_ID_KEY,
	UNIT_SELECTED_NAME_KEY,
	UNIT_SELECTED_PRECISION_KEY,
	UNIT_SELECTION_SOURCE_KEY,
	type UnitProductType,
} from "@/modules/units/unitPicker.contract";
import { unitsApi } from "@/modules/units/units.api";
import { syncUnitListCaches } from "@/modules/units/units.cache";
import {
	ADD_ITEM_ROUTE,
	clearUnitSelectionParams,
	CREATE_ITEM_ROUTE,
	replaceToReturnTo,
	SETTINGS_ITEMS_SERVICES_ADD_ITEM_ROUTE,
	SETTINGS_ITEMS_SERVICES_CREATE_ITEM_ROUTE,
} from "@/modules/units/units.navigation";
import { unitKeys, useUnitVisibilityMutation, useUnitVisibilityQuery } from "@/modules/units/units.queries";
import type { PrecisionScale, Unit } from "@/modules/units/units.types";
import { applyVisibilityFilter, getEachUnit } from "@/modules/units/units.visibility";
import { useUnitFlowBackGuard } from "@/modules/units/useUnitFlowBackGuard";
import { useInventoryHeader } from "@/modules/inventory/useInventoryHeader";

const DEFAULT_PRECISION: PrecisionScale = 2;
const COUNT_PRECISION: PrecisionScale = 0;
const COUNT_CATALOG_ID = "ea";
const COUNT_DISPLAY_NAME = "Per Piece";
const COUNT_DISPLAY_ABBR = "pc";
const RECENT_UNITS_LIMIT = 5;

function normalizeUnitKey(value: string | null | undefined): string {
	return (value ?? "").trim().toLowerCase();
}

function isCountUnit(unit: Unit): boolean {
	if (unit.category !== "COUNT") return false;
	const name = normalizeUnitKey(unit.name);
	const abbr = normalizeUnitKey(unit.abbreviation ?? "");
	return name === "each" || name === "per piece" || abbr === COUNT_CATALOG_ID || abbr === COUNT_DISPLAY_ABBR;
}

function isCustomUnit(unit: Unit): boolean {
	return !unit.catalogId;
}

function clampPrecisionScale(value: unknown): PrecisionScale {
	const raw = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(raw)) return 0 as PrecisionScale;
	const n = Math.max(0, Math.min(5, Math.trunc(raw)));
	return n as PrecisionScale;
}

function effectivePrecisionForDisplay(u: Unit): PrecisionScale {
	if (u.category === "COUNT") return clampPrecisionScale(u.precisionScale ?? COUNT_PRECISION);
	return clampPrecisionScale(u.precisionScale ?? DEFAULT_PRECISION);
}

function displayUnitName(unit: Unit): string {
	if (isCountUnit(unit)) return COUNT_DISPLAY_NAME;
	return unit.name;
}

function displayUnitAbbr(unit: Unit): string {
	const abbr = (unit.abbreviation ?? "").trim();
	return isCountUnit(unit) ? COUNT_DISPLAY_ABBR : abbr;
}

function unitSearchText(unit: Unit): string {
	const name = displayUnitName(unit);
	const abbr = unit.abbreviation ?? "";
	const displayAbbr = displayUnitAbbr(unit);
	const category = unit.category;
	const aliases = isCountUnit(unit) ? "per piece pc each count" : "";
	return `${name} ${unit.name} ${abbr} ${displayAbbr} ${category} ${aliases}`.toLowerCase();
}

function categoryLabel(category: Unit["category"]): string {
	if (category === "COUNT") return "Count";
	if (category === "WEIGHT") return "Weight";
	if (category === "VOLUME") return "Volume";
	if (category === "LENGTH") return "Length";
	if (category === "AREA") return "Area";
	if (category === "TIME") return "Time";
	if (category === "CUSTOM") return "Custom";
	return category;
}

function precisionLabel(scale: number): string {
	const safe = Math.max(0, Math.min(5, Math.trunc(scale || 0)));
	if (safe === 0) return "Whole units (1)";
	return `${safe} decimal${safe === 1 ? "" : "s"} (${precisionHint(safe)})`;
}

function unitSubtitle(unit: Unit): string {
	const metaParts = [isCustomUnit(unit) ? "Custom" : "System", categoryLabel(unit.category)];
	const abbr = displayUnitAbbr(unit);
	if (abbr) metaParts.push(abbr);
	metaParts.push(precisionLabel(effectivePrecisionForDisplay(unit)));
	if (!unit.isActive) metaParts.push("Archived");
	return metaParts.join(" • ");
}

function toTimestampMs(value: unknown): number {
	if (typeof value !== "string") return 0;
	const ms = Date.parse(value);
	return Number.isFinite(ms) ? ms : 0;
}

function compareByRecentDesc(a: Unit, b: Unit): number {
	const aTs = toTimestampMs(a.createdAt) || toTimestampMs(a.updatedAt);
	const bTs = toTimestampMs(b.createdAt) || toTimestampMs(b.updatedAt);
	if (aTs !== bTs) return bTs - aTs;
	const byName = displayUnitName(a).localeCompare(displayUnitName(b));
	if (byName !== 0) return byName;
	return a.id.localeCompare(b.id);
}

type Selection = { unitId: string };

export default function UnitPickerScreen({ routeScope }: { routeScope?: InventoryRouteScope } = {}) {
	const router = useRouter();
	const navigation = useNavigation();
	const theme = useTheme();
	const tabBarHeight = useBottomTabBarHeight();
	const params = useLocalSearchParams();
	const { withBusy, busy } = useAppBusy();
	const queryClient = useQueryClient();

	const inbound = useMemo(() => parseUnitSelectionParams(params as any), [params]);

	const hasInboundSelection = useMemo(
		() => inbound.hasSelectionKey && !!inbound.selectedUnitId,
		[inbound.hasSelectionKey, inbound.selectedUnitId],
	);

	// ✅ FIX: harden to a definite UnitProductType (no undefined)
	const productType: UnitProductType = inbound.productType ?? "PHYSICAL";
	const draftId = inbound.draftId || "";
	const fallbackReturnTo = useMemo(() => {
		if (routeScope === "settings-items-services") {
			return draftId ? SETTINGS_ITEMS_SERVICES_CREATE_ITEM_ROUTE : SETTINGS_ITEMS_SERVICES_ADD_ITEM_ROUTE;
		}
		return draftId ? CREATE_ITEM_ROUTE : ADD_ITEM_ROUTE;
	}, [draftId, routeScope]);

	const returnTo = inbound.returnTo || "";
	const target = returnTo || fallbackReturnTo;
	const effectiveRouteScope = useMemo(() => routeScope ?? resolveInventoryRouteScope(target), [routeScope, target]);
	const toScopedRoute = useCallback(
		(route: string) => mapInventoryRouteToScope(route, effectiveRouteScope),
		[effectiveRouteScope],
	);

	// Search
	const [q] = useState("");
	const [isPullRefreshing, setIsPullRefreshing] = useState(false);

	// nav lock
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

	const computeInitialSelection = useCallback((): Selection => {
		const inboundId = (inbound.selectedUnitId ?? "").trim();
		return { unitId: inboundId };
	}, [inbound.selectedUnitId]);

	const [selection, setSelection] = useState<Selection>(() => computeInitialSelection());
	const selectedUnitId = selection.unitId;
	const initialSelectedIdRef = useRef<string>(computeInitialSelection().unitId);

	const unitsQuery = useQuery<Unit[]>({
		queryKey: unitKeys.list({ includeArchived: false }),
		queryFn: () => unitsApi.listUnits({ includeArchived: false }),
		staleTime: 30_000,
	});

	useEffect(() => {
		initialSelectedIdRef.current = (inbound.selectedUnitId ?? "").trim();
	}, [inbound.selectedUnitId]);

	const onRefresh = useCallback(async () => {
		if (busy.isBusy || isNavLocked) return;
		if (unitsQuery.isFetching) return;
		setIsPullRefreshing(true);
		try {
			await unitsQuery.refetch({ cancelRefetch: true });
		} finally {
			setIsPullRefreshing(false);
		}
	}, [busy.isBusy, isNavLocked, unitsQuery]);

	const visibilityQuery = useUnitVisibilityQuery();
	const restoreVisibilityMutation = useUnitVisibilityMutation();
	const restoreInFlightRef = useRef<Set<string>>(new Set());

	const hiddenUnitIds = visibilityQuery.hiddenUnitIds;

	const governed = useMemo(() => {
		const all = unitsQuery.data ?? [];
		const visible = applyVisibilityFilter(all, {
			hiddenUnitIds,
			selectedUnitId: selection.unitId,
		});
		return visible;
	}, [hiddenUnitIds, selection.unitId, unitsQuery.data]);

	const filtered = useMemo(() => {
		const needle = q.trim().toLowerCase();
		if (!needle) return governed;

		const matches = governed.filter((u) => unitSearchText(u).includes(needle));
		if (!hiddenUnitIds.has(selection.unitId)) return matches;
		const selected = governed.find((u) => u.id === selection.unitId);
		if (!selected || matches.some((u) => u.id === selected.id)) return matches;
		return [selected, ...matches];
	}, [governed, hiddenUnitIds, q, selection.unitId]);

	const isSearching = q.trim().length > 0;

	const countUnit = useMemo(() => getEachUnit(governed) ?? null, [governed]);

	const countSeededRef = useRef(false);

	useEffect(() => {
		if (countUnit) return;
		if (!unitsQuery.isFetched || countSeededRef.current) return;
		countSeededRef.current = true;

		unitsApi
			.enableCatalogUnit({
				intent: "ENABLE_CATALOG",
				catalogId: COUNT_CATALOG_ID,
				precisionScale: COUNT_PRECISION,
			})
			.then((unit) => {
				syncUnitListCaches(queryClient, unit);
			})
			.catch(() => {
				// noop: user can still create/select units manually
			});
	}, [countUnit, queryClient, unitsQuery.isFetched]);

	const listScopeUnits = useMemo(() => (isSearching ? filtered : governed), [filtered, governed, isSearching]);

	const nonPinnedByRecent = useMemo(() => {
		const pinnedId = countUnit?.id ?? "";
		return governed.filter((u) => u.id !== pinnedId).sort(compareByRecentDesc);
	}, [countUnit?.id, governed]);

	const rankMap = useMemo(() => {
		const map = new Map<string, number>();
		nonPinnedByRecent.forEach((u, index) => {
			map.set(u.id, index);
		});
		return map;
	}, [nonPinnedByRecent]);

	const recentUnitIds = useMemo(
		() => new Set(nonPinnedByRecent.slice(0, RECENT_UNITS_LIMIT).map((u) => u.id)),
		[nonPinnedByRecent],
	);

	const visibleNonPinnedSorted = useMemo(() => {
		const pinnedId = countUnit?.id ?? "";
		const list = listScopeUnits.filter((u) => u.id !== pinnedId);
		return [...list].sort(
			(a, b) => (rankMap.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rankMap.get(b.id) ?? Number.MAX_SAFE_INTEGER),
		);
	}, [countUnit?.id, listScopeUnits, rankMap]);

	const recentUnits = useMemo(
		() => visibleNonPinnedSorted.filter((u) => recentUnitIds.has(u.id)),
		[recentUnitIds, visibleNonPinnedSorted],
	);
	const olderUnits = useMemo(
		() => visibleNonPinnedSorted.filter((u) => !recentUnitIds.has(u.id)),
		[recentUnitIds, visibleNonPinnedSorted],
	);
	const hasSectionRows = !!countUnit || recentUnits.length > 0 || olderUnits.length > 0;

	const maybeRestoreHidden = useCallback(
		(unitId: string) => {
			if (!unitId) return;
			if (!hiddenUnitIds.has(unitId)) return;
			if (restoreInFlightRef.current.has(unitId)) return;

			restoreInFlightRef.current.add(unitId);
			restoreVisibilityMutation.mutate(
				{ action: "RESTORE", unitId },
				{
					onSettled: () => {
						restoreInFlightRef.current.delete(unitId);
					},
				},
			);
		},
		[hiddenUnitIds, restoreVisibilityMutation],
	);

	useEffect(() => {
		if (productType !== "PHYSICAL") return;
		if (selectedUnitId) return;
		if (!countUnit) return;
		setSelection({ unitId: countUnit.id });
	}, [countUnit, productType, selectedUnitId]);

	// Sync selection if inbound selected id changes (common after nav back/replace)
	useEffect(() => {
		const inboundId = (inbound.selectedUnitId ?? "").trim();
		if (!inboundId) return;

		const available = applyVisibilityFilter(unitsQuery.data ?? [], {
			hiddenUnitIds,
			selectedUnitId: inboundId,
		});

		if (!available.some((u) => u.id === inboundId)) return;

		setSelection((prev) => (prev.unitId === inboundId ? prev : { unitId: inboundId }));
	}, [hiddenUnitIds, inbound.selectedUnitId, unitsQuery.data]);

	const exitRef = useRef(false);

	const openManageUnits = useCallback(() => {
		if (isUiDisabled || !lockNav()) return;
		router.push({
			pathname: "/(app)/(tabs)/settings/units" as any,
			params: {
				[UNIT_CONTEXT_PRODUCT_TYPE_KEY]: productType,
			} as any,
		});
	}, [isUiDisabled, lockNav, productType, router]);

	const openAddUnit = useCallback(() => {
		if (isUiDisabled || !lockNav()) return;

		router.push({
			pathname: toScopedRoute(UNIT_ADD_ROUTE) as any,
			params: {
				[RETURN_TO_KEY]: target,
				[DRAFT_ID_KEY]: draftId || undefined,
				[UNIT_CONTEXT_PRODUCT_TYPE_KEY]: productType,
				...(selectedUnitId ? { [UNIT_SELECTED_ID_KEY]: selectedUnitId } : {}),
			} as any,
		});
	}, [draftId, isUiDisabled, lockNav, productType, router, selectedUnitId, target, toScopedRoute]);

	const onCancel = useCallback(() => {
		if (isUiDisabled) return;
		if (!lockNav()) return;

		exitRef.current = true;
		clearUnitSelectionParams(router as any);
		router.replace({
			pathname: target as any,
			params: {
				[DRAFT_ID_KEY]: draftId || undefined,
			} as any,
		});
	}, [draftId, isUiDisabled, lockNav, router, target]);
	const guardedOnCancel = useProcessExitGuard(onCancel, false);

	// Selection active: must exist and be in governed
	const selectionIsActive = useMemo(() => {
		if (!selectedUnitId) return false;
		return governed.some((u) => u.id === selectedUnitId);
	}, [governed, selectedUnitId]);

	const hasSelectionChanged = useMemo(() => {
		if (!hasInboundSelection) return false;
		return !!selectedUnitId && selectedUnitId !== initialSelectedIdRef.current;
	}, [hasInboundSelection, selectedUnitId]);

	const onSave = useCallback(async () => {
		// Governance: if we weren't invoked with selection-key semantics, do not "save".
		if (!hasInboundSelection || isUiDisabled || !lockNav()) return;
		if (!hasSelectionChanged) {
			exitRef.current = true;
			clearUnitSelectionParams(router as any);
			router.replace({
				pathname: target as any,
				params: {
					[DRAFT_ID_KEY]: draftId || undefined,
				} as any,
			});
			return;
		}

		const selected = governed.find((u) => u.id === selectedUnitId) ?? null;
		if (!selected) return;

		maybeRestoreHidden(selected.id);

		await withBusy("Saving unit…", async () => {
			exitRef.current = true;

			const selectionParams = buildUnitSelectionParams({
				selectedUnitId: selected.id,
				selectedUnitName: displayUnitName(selected),
				selectedUnitAbbreviation: displayUnitAbbr(selected),
				selectedUnitCategory: selected.category,
				selectedUnitPrecisionScale: effectivePrecisionForDisplay(selected),
				selectionSource: "existing",
				draftId: draftId || undefined,
				returnTo: target,
				productType,
			});

			clearUnitSelectionParams(router as any);
			replaceToReturnTo(router as any, target, selectionParams);
		});
	}, [
		draftId,
		governed,
		hasInboundSelection,
		hasSelectionChanged,
		isUiDisabled,
		lockNav,
		maybeRestoreHidden,
		productType,
		router,
		selectedUnitId,
		target,
		withBusy,
	]);

	const saveEnabled = useMemo(
		() => hasInboundSelection && hasSelectionChanged && selectionIsActive && !isUiDisabled,
		[hasInboundSelection, hasSelectionChanged, isUiDisabled, selectionIsActive],
	);
	const borderColor = theme.colors.outlineVariant ?? theme.colors.outline;
	const utilitySurfaceColor =
		(theme.colors as any).surfaceVariant ?? (theme.dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.035)");
	const utilityPressedBg = theme.dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.05)";
	const utilityIconColor = theme.colors.onSurfaceVariant ?? theme.colors.onSurface;

	// Header Navigation Governance:
	// - Deterministic cancel is required here, so treat as "process" and bind Exit -> onCancel.
	const headerOptions = useInventoryHeader("process", {
		title: "Select Unit Type",
		disabled: isUiDisabled,
		onExit: guardedOnCancel,
		exitFallbackRoute: "/(app)/(tabs)/inventory",
	});

	useUnitFlowBackGuard(navigation, exitRef, guardedOnCancel);

	const renderUnitRow = useCallback(
		(u: Unit) => {
			const title = displayUnitName(u);
			const isSelected = selectedUnitId === u.id;

			return (
				<View key={u.id} style={styles.innerRowWrap}>
					<BAIRadioRow
						title={title}
						description={unitSubtitle(u)}
						selected={isSelected}
						onPress={() => {
							maybeRestoreHidden(u.id);
							setSelection({ unitId: u.id });

							const precisionScale = effectivePrecisionForDisplay(u);
							(router as any).setParams?.({
								[UNIT_SELECTED_ID_KEY]: u.id,
								[UNIT_SELECTED_NAME_KEY]: title,
								[UNIT_SELECTED_ABBR_KEY]: displayUnitAbbr(u),
								[UNIT_SELECTED_CATEGORY_KEY]: u.category,
								[UNIT_SELECTED_PRECISION_KEY]: String(precisionScale),
								[UNIT_SELECTION_SOURCE_KEY]: "existing",
							});
						}}
					/>
				</View>
			);
		},
		[maybeRestoreHidden, router, selectedUnitId],
	);

	const renderUnitSection = useCallback(
		(sectionTitle: string, units: Unit[]) => {
			if (units.length === 0) return null;
			return (
				<View key={sectionTitle} style={styles.sectionBlock}>
					<BAIText variant='caption' muted>
						{sectionTitle}
					</BAIText>
					<View style={styles.sectionRows}>{units.map(renderUnitRow)}</View>
				</View>
			);
		},
		[renderUnitRow],
	);

	return (
		<>
			<Stack.Screen
				options={{
					...headerOptions,
					headerShadowVisible: false,
				}}
			/>

			<BAIScreen padded={false} safeTop={false} safeBottom={true} style={{ flex: 1 }}>
				{unitsQuery.isLoading ? (
					<BAISurface style={[styles.state, { marginTop: 0 }]} padded>
						<View style={styles.loadingState}>
							<BAIActivityIndicator size='large' tone='primary' />
							<View style={{ height: 12 }} />
							<BAIText variant='subtitle'>Loading units…</BAIText>
							<BAIText variant='caption' muted>
								Fetching your created units.
							</BAIText>
						</View>
					</BAISurface>
				) : unitsQuery.isError ? (
					<BAISurface style={[styles.state, { marginTop: 16 }]} padded>
						<BAIText variant='subtitle'>Could not load units.</BAIText>
						<View style={{ height: 12 }} />
						<BAIRetryButton variant='outline' onPress={() => unitsQuery.refetch()}>
							Retry
						</BAIRetryButton>
					</BAISurface>
					) : (
						<View style={{ flex: 1 }}>
							<BAISurface style={[styles.card, { flex: 1 }]} padded>
								<View style={styles.actionsRow}>
									<BAIButton
										variant='outline'
										compact
										disabled={isNavLocked || busy.isBusy}
										onPress={openAddUnit}
										style={styles.actionButton}
										widthPreset='standard'
										shape='pill'
										intent='primary'
									>
										Add Unit
									</BAIButton>

									<BAICTAPillButton
										intent='primary'
										variant='solid'
										compact
										disabled={!saveEnabled || isNavLocked || busy.isBusy}
										onPress={onSave}
										style={styles.actionButton}
									>
										Save Unit
									</BAICTAPillButton>
								</View>

								<Pressable
									onPress={openManageUnits}
									disabled={isUiDisabled}
									style={({ pressed }) => [
										styles.utilityRow,
										{ borderColor, backgroundColor: utilitySurfaceColor },
										isUiDisabled && { opacity: 0.45 },
										pressed && !isUiDisabled && { backgroundColor: utilityPressedBg },
									]}
								>
									<View style={styles.utilityRowLeft}>
										<View style={[styles.utilityIconWrap, { borderColor }]}>
											<MaterialCommunityIcons name='cog-outline' size={18} color={utilityIconColor} />
										</View>
										<View style={styles.utilityCopy}>
											<BAIText variant='caption' muted>
												Manage Units
											</BAIText>
											<BAIText variant='subtitle'>Open unit management</BAIText>
										</View>
									</View>
									<MaterialCommunityIcons name='chevron-right' size={22} color={utilityIconColor} />
								</Pressable>

								<ScrollView
									style={styles.unitsScroll}
									contentContainerStyle={{ paddingBottom: tabBarHeight + 24 }}
									showsVerticalScrollIndicator={false}
									refreshControl={
										<RefreshControl
											refreshing={isPullRefreshing}
											onRefresh={onRefresh}
											tintColor={theme.colors.onSurface}
											colors={[theme.colors.onSurface]}
											progressBackgroundColor={theme.colors.surface}
										/>
									}
									keyboardShouldPersistTaps='handled'
									onTouchStart={Keyboard.dismiss}
								>
									<View style={styles.unitsListWrap}>
										{governed.length === 0 ? (
											<BAISurface style={styles.emptyCard} padded>
												<BAIText variant='subtitle'>No units created yet.</BAIText>
												<BAIText variant='caption' muted>
													Create a unit to see it listed here.
												</BAIText>
											</BAISurface>
										) : !hasSectionRows ? (
											<BAISurface style={styles.emptyCard} padded>
												<BAIText variant='subtitle'>No units found.</BAIText>
												<BAIText variant='caption' muted>
													Try another term or create a custom unit.
												</BAIText>
											</BAISurface>
										) : (
											<>
												{countUnit ? renderUnitSection("Pinned Unit", [countUnit]) : null}
												{renderUnitSection("Recent Units", recentUnits)}
												{renderUnitSection("All Other Units", olderUnits)}
											</>
										)}

									</View>
								</ScrollView>
							</BAISurface>
						</View>
					)}
			</BAIScreen>
		</>
	);
}

const styles = StyleSheet.create({
	card: { marginHorizontal: 16, marginTop: 0, borderRadius: 24, gap: 12 },
	actionsRow: {
		flexDirection: "row",
		alignItems: "center",
		gap: 12,
	},
	actionButton: { flex: 1 },
	utilityRow: {
		borderWidth: 1,
		borderRadius: 16,
		paddingVertical: 10,
		paddingHorizontal: 12,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		gap: 12,
	},
	utilityRowLeft: {
		flexDirection: "row",
		alignItems: "center",
		gap: 10,
		flex: 1,
		minWidth: 0,
	},
	utilityIconWrap: {
		width: 34,
		height: 34,
		borderRadius: 17,
		borderWidth: 1,
		alignItems: "center",
		justifyContent: "center",
	},
	utilityCopy: {
		flex: 1,
		minWidth: 0,
		gap: 1,
	},
	unitsScroll: { flex: 1 },
	unitsListWrap: { paddingBottom: 6, gap: 8 },
	innerRowWrap: { paddingTop: 6 },
	sectionBlock: { paddingTop: 4, gap: 6 },
	sectionRows: { paddingTop: 0 },
	emptyCard: { borderRadius: 18, marginTop: 4 },
	state: { marginHorizontal: 18, borderRadius: 18 },
	loadingState: { alignItems: "center", paddingVertical: 12 },
});
