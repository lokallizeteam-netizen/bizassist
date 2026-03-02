import React, { useCallback, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useNavigation } from "@react-navigation/native";

import { SettingsScreenLayout, SettingsSectionTitle } from "@/components/settings/SettingsLayout";
import { BAIScreen } from "@/components/ui/BAIScreen";
import { BAISurface } from "@/components/ui/BAISurface";
import { BAIText } from "@/components/ui/BAIText";
import { BAIButton } from "@/components/ui/BAIButton";
import { BAICTAPillButton } from "@/components/ui/BAICTAButton";
import { BAIRadioRow } from "@/components/ui/BAIRadioRow";
import { useAppHeader } from "@/modules/navigation/useAppHeader";

import { useAppBusy } from "@/hooks/useAppBusy";
import type { PrecisionScale, UnitCategory } from "@/modules/units/units.types";
import {
	DRAFT_ID_KEY,
	RETURN_TO_KEY,
	UNIT_CONTEXT_PRODUCT_TYPE_KEY,
	UNIT_CREATE_CATEGORY_KEY,
	UNIT_SELECTED_ID_KEY,
} from "@/modules/units/unitPicker.contract";
import { clearUnitSelectionParams, SETTINGS_UNITS_ROUTE } from "@/modules/units/units.navigation";
import { useUnitFlowBackGuard } from "@/modules/units/useUnitFlowBackGuard";

import {
	SETTINGS_UNIT_SELECT_ROUTE,
	useSettingsUnitFlowContext,
	useUnitNavLock,
} from "@/modules/units/screens/settingsUnitFlow.shared";

const DEFAULT_CATEGORY: UnitCategory = "WEIGHT";
const DEFAULT_PRECISION: PrecisionScale = 2;
const DEFAULT_COUNT_PRECISION: PrecisionScale = 0;

function allowedCategories(): UnitCategory[] {
	return ["COUNT", "WEIGHT", "VOLUME", "LENGTH", "AREA", "TIME"];
}

function categoryLabel(category: UnitCategory): string {
	if (category === "COUNT") return "Count";
	if (category === "WEIGHT") return "Weight";
	if (category === "VOLUME") return "Volume";
	if (category === "LENGTH") return "Length";
	if (category === "AREA") return "Area";
	if (category === "TIME") return "Time";
	return String(category);
}

export default function SettingsUnitAddScreen() {
	const router = useRouter();
	const navigation = useNavigation();
	const { withBusy, busy } = useAppBusy();
	const { inbound, returnTo, draftId, productType } = useSettingsUnitFlowContext();

	const categories = useMemo(() => allowedCategories(), []);
	const [category, setCategory] = useState<UnitCategory>(() => {
		const fromParam = inbound.createUnitCategory;
		if (categories.includes(fromParam)) return fromParam;
		return categories.includes(DEFAULT_CATEGORY) ? DEFAULT_CATEGORY : categories[0];
	});

	const exitRef = useRef(false);
	const { isNavLocked, lockNav } = useUnitNavLock();
	const isUiDisabled = busy.isBusy || isNavLocked;

	const onExit = useCallback(() => {
		if (isUiDisabled) return;
		if (!lockNav()) return;

		exitRef.current = true;
		clearUnitSelectionParams(router as any);

		if (!inbound.hasSelectionKey) {
			router.replace(returnTo as any);
			return;
		}

		router.replace({
			pathname: SETTINGS_UNITS_ROUTE as any,
			params: {
				[RETURN_TO_KEY]: returnTo,
				[DRAFT_ID_KEY]: draftId || undefined,
				[UNIT_CONTEXT_PRODUCT_TYPE_KEY]: productType,
				...(inbound.selectedUnitId ? { [UNIT_SELECTED_ID_KEY]: inbound.selectedUnitId } : {}),
			} as any,
		});
	}, [draftId, inbound.hasSelectionKey, inbound.selectedUnitId, isUiDisabled, lockNav, productType, returnTo, router]);

	const headerOptions = useAppHeader("process", {
		title: "Unit Category",
		disabled: isUiDisabled,
		onExit,
	});

	const onNext = useCallback(async () => {
		if (isUiDisabled || !lockNav()) return;
		const nextPrecision = category === "COUNT" ? DEFAULT_COUNT_PRECISION : DEFAULT_PRECISION;

		await withBusy("Saving unit...", async () => {
			exitRef.current = true;
			router.replace({
				pathname: SETTINGS_UNIT_SELECT_ROUTE as any,
				params: {
					[RETURN_TO_KEY]: returnTo,
					[DRAFT_ID_KEY]: draftId || undefined,
					[UNIT_CONTEXT_PRODUCT_TYPE_KEY]: productType,
					[UNIT_CREATE_CATEGORY_KEY]: category,
					selectedUnitPrecisionScale: String(nextPrecision),
				} as any,
			});
		});
	}, [category, draftId, isUiDisabled, lockNav, productType, returnTo, router, withBusy]);

	useUnitFlowBackGuard(navigation, exitRef, onExit);

	return (
		<>
			<Stack.Screen
				options={{
					...headerOptions,
					headerShadowVisible: false,
				}}
			/>

			<BAIScreen padded={false} safeTop={false} style={{ flex: 1 }}>
				<SettingsScreenLayout screenStyle={styles.screen} maxWidth={560}>
					<BAISurface style={styles.card} padded>
						<View style={styles.titleRow}>
							<View style={{ flex: 1 }}>
								<SettingsSectionTitle>Select Unit Category</SettingsSectionTitle>
								<BAIText variant='caption' muted>
									Choose a unit category to add from the catalog.
								</BAIText>
							</View>
						</View>

						<View style={{ height: 12 }} />

						<View style={styles.actionsRow}>
							<BAIButton
								variant='outline'
								compact
								onPress={onExit}
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
								onPress={onNext}
								disabled={isUiDisabled}
								style={styles.inlineNext}
							>
								Next
							</BAICTAPillButton>
						</View>

						<View style={{ height: 16 }} />

						<View style={styles.categoryList}>
							<BAIText variant='subtitle' muted>
								Unit categories
							</BAIText>
							{categories.map((item) => (
								<BAIRadioRow
									key={item}
									title={categoryLabel(item)}
									selected={category === item}
									onPress={() => setCategory(item)}
								/>
							))}
						</View>
					</BAISurface>
				</SettingsScreenLayout>
			</BAIScreen>
		</>
	);
}

const styles = StyleSheet.create({
	screen: { paddingHorizontal: 16, paddingTop: 0 },
	card: { marginHorizontal: 0, marginTop: 0, borderRadius: 24, paddingBottom: 14 },
	titleRow: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		gap: 12,
	},
	actionsRow: { flexDirection: "row", alignItems: "center", gap: 12 },
	inlineCancel: { flex: 1 },
	inlineNext: { flex: 1 },
	categoryList: { gap: 10 },
});
