import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";

import { BAIScreen } from "@/components/ui/BAIScreen";
import { BAISurface } from "@/components/ui/BAISurface";
import { BAIText } from "@/components/ui/BAIText";
import { BAICTAButton, BAICTAPillButton } from "@/components/ui/BAICTAButton";
import { BAIRadioRow } from "@/components/ui/BAIRadioRow";
import { BAIButton } from "@/components/ui/BAIButton";
import { BAIDivider } from "@/components/ui/BAIDivider";
import { useAppHeader } from "@/modules/navigation/useAppHeader";

import { useAppBusy } from "@/hooks/useAppBusy";
import { UNIT_CATALOG, type UnitCategory as CatalogUnitCategory, type UnitItem } from "@/features/units/unitCatalog";
import { unitsApi } from "@/modules/units/units.api";
import { syncUnitListCaches } from "@/modules/units/units.cache";
import { unitKeys } from "@/modules/units/units.queries";
import type { PrecisionScale, Unit } from "@/modules/units/units.types";
import {
	buildUnitSelectionParams,
	DRAFT_ID_KEY,
	RETURN_TO_KEY,
	UNIT_CONTEXT_PRODUCT_TYPE_KEY,
	UNIT_CREATE_CATEGORY_KEY,
} from "@/modules/units/unitPicker.contract";
import { clearUnitSelectionParams, replaceToReturnTo } from "@/modules/units/units.navigation";
import { useUnitFlowBackGuard } from "@/modules/units/useUnitFlowBackGuard";

import {
	SETTINGS_UNIT_ADD_ROUTE,
	SETTINGS_UNIT_CUSTOM_CREATE_ROUTE,
	useSettingsUnitFlowContext,
	useUnitNavLock,
} from "@/modules/units/screens/settingsUnitFlow.shared";

const DEFAULT_PRECISION: PrecisionScale = 2;
const PRECISION_OPTIONS: PrecisionScale[] = [0, 1, 2, 3, 4, 5];
const COUNT_CATALOG_ID = "ea";

function categoryDefaultPrecision(category: CatalogUnitCategory): PrecisionScale {
	if (category === "COUNT") return 0;
	if (category === "WEIGHT") return 3;
	if (category === "VOLUME") return 3;
	if (category === "LENGTH") return 2;
	if (category === "AREA") return 2;
	if (category === "TIME") return 2;
	return DEFAULT_PRECISION;
}

function categoryMaxPrecision(): PrecisionScale {
	return 5;
}

function toNumberOrNull(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string") {
		const number = Number(value);
		return Number.isFinite(number) ? number : null;
	}
	return null;
}

function clampPrecision(raw: unknown, fallback: PrecisionScale = DEFAULT_PRECISION): PrecisionScale {
	const number = toNumberOrNull(raw);
	const value = Number.isFinite(number as number) ? Math.max(0, Math.min(5, Math.trunc(number as number))) : fallback;
	return value as PrecisionScale;
}

function precisionSuffix(scale: PrecisionScale): string {
	if (scale <= 0) return "(1)";
	return `(.${"0".repeat(Math.min(5, Math.max(1, scale)))})`;
}

function categoryLabel(category: CatalogUnitCategory): string {
	if (category === "COUNT") return "Count";
	if (category === "WEIGHT") return "Weight";
	if (category === "VOLUME") return "Volume";
	if (category === "LENGTH") return "Length";
	if (category === "AREA") return "Area";
	if (category === "TIME") return "Time";
	return "Category";
}

function normalizeCatalogCategory(raw: unknown): CatalogUnitCategory | null {
	if (typeof raw !== "string") return null;
	const normalized = raw.trim().toUpperCase();
	if (!normalized) return null;
	const allowed: CatalogUnitCategory[] = ["COUNT", "WEIGHT", "VOLUME", "LENGTH", "AREA", "TIME"];
	return allowed.includes(normalized as CatalogUnitCategory) ? (normalized as CatalogUnitCategory) : null;
}

function normalizedKey(value: string): string {
	return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function resolveCatalogToExisting(governedUnits: Unit[], item: UnitItem): Unit | null {
	const symbol = normalizedKey(item.symbol);
	const name = normalizedKey(item.name);
	const eligible = governedUnits.filter((unit) => unit.category === item.category);

	const byAbbreviation = eligible.find((unit) => normalizedKey(unit.abbreviation ?? "") === symbol) ?? null;
	if (byAbbreviation) return byAbbreviation;

	return eligible.find((unit) => normalizedKey(unit.name) === name) ?? null;
}

export default function SettingsUnitSelectScreen() {
	const router = useRouter();
	const navigation = useNavigation();
	const queryClient = useQueryClient();
	const { withBusy, busy } = useAppBusy();
	const { params, inbound, returnTo, draftId, productType } = useSettingsUnitFlowContext();

	const category = useMemo<CatalogUnitCategory>(() => {
		const fromParams = normalizeCatalogCategory((params as any)[UNIT_CREATE_CATEGORY_KEY]);
		if (fromParams) return fromParams;

		const fromInbound = normalizeCatalogCategory(inbound.createUnitCategory);
		if (fromInbound) return fromInbound;

		return "COUNT";
	}, [inbound.createUnitCategory, params]);
	const unitGroupLabel = categoryLabel(category);
	const defaultPrecision = categoryDefaultPrecision(category);
	const maxAllowedPrecision = categoryMaxPrecision();
	const [selectedPrecision, setSelectedPrecision] = useState<PrecisionScale>(() =>
		clampPrecision(
			(params as any).selectedUnitPrecisionScale ?? inbound.selectedUnitPrecisionScale ?? defaultPrecision,
			defaultPrecision,
		),
	);
	const precisionOptions = PRECISION_OPTIONS.filter((precision) => precision <= maxAllowedPrecision);

	useEffect(() => {
		if (selectedPrecision > maxAllowedPrecision) {
			setSelectedPrecision(defaultPrecision);
		}
	}, [defaultPrecision, maxAllowedPrecision, selectedPrecision]);

	const unitsQuery = useQuery<Unit[]>({
		queryKey: unitKeys.list({ includeArchived: false }),
		queryFn: () => unitsApi.listUnits({ includeArchived: false }),
		staleTime: 300_000,
	});

	const governed = useMemo(() => (unitsQuery.data ?? []).filter((unit) => unit.isActive), [unitsQuery.data]);

	const catalogUnits = useMemo(() => {
		const list = UNIT_CATALOG.filter((unit) => unit.category === category);
		if (category !== "COUNT") return list;

		return [...list].sort((a, b) => {
			const byName = a.name.localeCompare(b.name);
			if (byName !== 0) return byName;
			return a.symbol.localeCompare(b.symbol);
		});
	}, [category]);

	const availableCatalogUnits = useMemo(
		() => catalogUnits.filter((item) => !resolveCatalogToExisting(governed, item)),
		[catalogUnits, governed],
	);

	const defaultCatalogId = useMemo(() => {
		if (category === "COUNT") {
			const eachUnit = availableCatalogUnits.find((item) => item.id === COUNT_CATALOG_ID);
			if (eachUnit) return eachUnit.id;
		}
		return availableCatalogUnits[0]?.id ?? "";
	}, [availableCatalogUnits, category]);

	const [selectedCatalogId, setSelectedCatalogId] = useState<string>(() => defaultCatalogId);

	useEffect(() => {
		if (!availableCatalogUnits.length) {
			setSelectedCatalogId("");
			return;
		}

		if (!availableCatalogUnits.some((item) => item.id === selectedCatalogId)) {
			setSelectedCatalogId(defaultCatalogId);
		}
	}, [availableCatalogUnits, defaultCatalogId, selectedCatalogId]);

	const exitRef = useRef(false);
	const { isNavLocked, lockNav } = useUnitNavLock();
	const isUiDisabled = busy.isBusy || isNavLocked;

	const selectedCatalogItem = useMemo(
		() => availableCatalogUnits.find((item) => item.id === selectedCatalogId) ?? null,
		[availableCatalogUnits, selectedCatalogId],
	);

	const onCancel = useCallback(() => {
		if (isUiDisabled) return;
		if (!lockNav()) return;

		exitRef.current = true;
		clearUnitSelectionParams(router as any);
		router.replace({
			pathname: SETTINGS_UNIT_ADD_ROUTE as any,
			params: {
				[RETURN_TO_KEY]: returnTo,
				[DRAFT_ID_KEY]: draftId || undefined,
				[UNIT_CONTEXT_PRODUCT_TYPE_KEY]: productType,
				[UNIT_CREATE_CATEGORY_KEY]: category,
				selectedUnitPrecisionScale: String(selectedPrecision),
			} as any,
		});
	}, [category, draftId, isUiDisabled, lockNav, productType, returnTo, router, selectedPrecision]);

	const openCustomCreate = useCallback(() => {
		if (isUiDisabled) return;
		if (!lockNav()) return;

		exitRef.current = true;
		router.replace({
			pathname: SETTINGS_UNIT_CUSTOM_CREATE_ROUTE as any,
			params: {
				[RETURN_TO_KEY]: returnTo,
				[DRAFT_ID_KEY]: draftId || undefined,
				[UNIT_CONTEXT_PRODUCT_TYPE_KEY]: productType,
				[UNIT_CREATE_CATEGORY_KEY]: "CUSTOM",
			} as any,
		});
	}, [draftId, isUiDisabled, lockNav, productType, returnTo, router]);

	const updateUnitCache = useCallback(
		(unit: Unit) => {
			syncUnitListCaches(queryClient, unit);
		},
		[queryClient],
	);

	const onSave = useCallback(async () => {
		if (isUiDisabled || !lockNav()) return;
		if (!selectedCatalogItem) return;

		await withBusy("Saving unit...", async () => {
			const existing = resolveCatalogToExisting(governed, selectedCatalogItem);
			const unit =
				existing ??
				(await unitsApi.enableCatalogUnit({
					intent: "ENABLE_CATALOG",
					catalogId: selectedCatalogItem.id,
					precisionScale: selectedPrecision,
				}));

			updateUnitCache(unit);

			const selectionParams = buildUnitSelectionParams({
				selectedUnitId: unit.id,
				selectedUnitName: unit.name,
				selectedUnitAbbreviation: unit.abbreviation ?? "",
				selectedUnitCategory: unit.category,
				selectedUnitPrecisionScale: unit.precisionScale ?? selectedPrecision,
				selectionSource: "created",
				draftId: draftId || undefined,
				returnTo,
				productType,
			});

			exitRef.current = true;
			clearUnitSelectionParams(router as any);
			replaceToReturnTo(router as any, returnTo, selectionParams);
		});
	}, [
		draftId,
		governed,
		isUiDisabled,
		lockNav,
		productType,
		returnTo,
		router,
		selectedCatalogItem,
		selectedPrecision,
		updateUnitCache,
		withBusy,
	]);

	const headerOptions = useAppHeader("process", {
		title: "Add Unit",
		disabled: isUiDisabled,
		onExit: onCancel,
	});

	useUnitFlowBackGuard(navigation, exitRef, onCancel);

	return (
		<>
			<Stack.Screen
				options={{
					...headerOptions,
					headerShadowVisible: false,
				}}
			/>

			<BAIScreen tabbed padded={false} safeTop={false} style={{ flex: 1 }}>
				<BAISurface style={styles.card} padded>
					<View style={{ height: 2 }} />
					<BAIText variant='caption' muted>
						{`Unit group: ${unitGroupLabel}`}
					</BAIText>

					<View style={{ height: 10 }} />

					<View style={styles.actionsRow}>
						<BAIButton
							variant='outline'
							compact
							onPress={onCancel}
							disabled={isUiDisabled}
							style={styles.inlineCancel}
							shape='pill'
							widthPreset='standard'
							intent='neutral'
						>
							Cancel
						</BAIButton>
						<BAICTAPillButton
							intent='primary'
							variant='solid'
							compact
							onPress={onSave}
							disabled={!selectedCatalogItem || isUiDisabled}
							style={styles.inlineSave}
						>
							Save
						</BAICTAPillButton>
					</View>

					<View style={{ height: 12 }} />

					<ScrollView
						style={styles.listScroll}
						contentContainerStyle={styles.listContent}
						showsVerticalScrollIndicator={false}
						keyboardShouldPersistTaps='handled'
					>
						{availableCatalogUnits.length === 0 ? (
							<BAIText variant='body' muted>
								All units in this category are already enabled.
							</BAIText>
						) : (
							availableCatalogUnits.map((item) => (
								<View key={item.id} style={styles.rowWrap}>
									<BAIRadioRow
										title={`${item.name}   (${item.symbol})`}
										selected={selectedCatalogId === item.id}
										onPress={() => setSelectedCatalogId(item.id)}
									/>
								</View>
							))
						)}

						<>
							<View style={{ height: 30 }} />
							<BAIDivider thickness={0.75} inset={14} />
							<View style={{ height: 18 }} />

							<BAIText variant='subtitle' muted>
								Precision
							</BAIText>

							<View style={{ height: 8 }} />

							{precisionOptions.map((precision) => {
								const suffix = precisionSuffix(precision);
								const label =
									precision === 0
										? "Whole units (1)"
										: `${precision} decimal${precision === 1 ? "" : "s"} ${suffix}`;
								return (
									<View key={String(precision)} style={styles.rowWrap}>
										<BAIRadioRow
											title={label}
											selected={selectedPrecision === precision}
											onPress={() => setSelectedPrecision(precision)}
										/>
									</View>
								);
							})}
						</>

						<View style={{ height: 24 }} />
						<BAIDivider thickness={0.75} inset={14} />
						<View style={{ height: 20 }} />

						<BAICTAButton variant='solid' onPress={openCustomCreate} disabled={isUiDisabled}>
							Create Custom Unit
						</BAICTAButton>
					</ScrollView>
				</BAISurface>
			</BAIScreen>
		</>
	);
}

const styles = StyleSheet.create({
	card: { marginHorizontal: 16, marginTop: 0, borderRadius: 24, flex: 1, paddingBottom: 0 },
	actionsRow: { flexDirection: "row", alignItems: "center", gap: 10 },
	inlineSave: { flex: 1 },
	inlineCancel: { flex: 1 },
	rowWrap: { paddingTop: 10 },
	listScroll: { flex: 1 },
	listContent: { paddingBottom: 24 },
});
