import React, { useCallback, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useNavigation } from "@react-navigation/native";

import { SettingsScreenLayout, SettingsSectionTitle } from "@/components/settings/SettingsLayout";
import { BAIScreen } from "@/components/ui/BAIScreen";
import { BAISurface } from "@/components/ui/BAISurface";
import { BAIText } from "@/components/ui/BAIText";
import { BAIButton } from "@/components/ui/BAIButton";
import { BAICTAPillButton } from "@/components/ui/BAICTAButton";
import { useAppHeader } from "@/modules/navigation/useAppHeader";

import { useAppBusy } from "@/hooks/useAppBusy";
import type { UnitCategory } from "@/modules/units/units.types";
import {
	DRAFT_ID_KEY,
	RETURN_TO_KEY,
	UNIT_CONTEXT_PRODUCT_TYPE_KEY,
	buildOpenUnitCustomCreateParams,
	UNIT_CREATE_CATEGORY_KEY,
	UNIT_SELECTED_ID_KEY,
} from "@/modules/units/unitPicker.contract";
import { SETTINGS_UNITS_ROUTE, clearUnitSelectionParams } from "@/modules/units/units.navigation";
import { useUnitFlowBackGuard } from "@/modules/units/useUnitFlowBackGuard";

import {
	SETTINGS_UNIT_CUSTOM_CREATE_ROUTE,
	SETTINGS_UNIT_SELECT_ROUTE,
	useSettingsUnitFlowContext,
	useUnitNavLock,
} from "@/modules/units/screens/settingsUnitFlow.shared";

const CUSTOM_CATEGORY: UnitCategory = "CUSTOM";

export default function SettingsUnitCreateScreen() {
	const router = useRouter();
	const navigation = useNavigation();
	const { withBusy, busy } = useAppBusy();
	const { inbound, returnTo, draftId, productType } = useSettingsUnitFlowContext();

	const [category] = useState<UnitCategory>(CUSTOM_CATEGORY);
	const exitRef = useRef(false);
	const { isNavLocked, lockNav } = useUnitNavLock();
	const isUiDisabled = busy.isBusy || isNavLocked;

	const onCancel = useCallback(() => {
		if (isUiDisabled) return;
		if (!lockNav()) return;

		exitRef.current = true;
		clearUnitSelectionParams(router as any);

		if (inbound.createUnitCategory) {
			router.replace({
				pathname: SETTINGS_UNIT_SELECT_ROUTE as any,
				params: {
					[RETURN_TO_KEY]: returnTo,
					[DRAFT_ID_KEY]: draftId || undefined,
					[UNIT_CONTEXT_PRODUCT_TYPE_KEY]: productType,
					[UNIT_CREATE_CATEGORY_KEY]: inbound.createUnitCategory,
				} as any,
			});
			return;
		}

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
	}, [
		draftId,
		inbound.createUnitCategory,
		inbound.hasSelectionKey,
		inbound.selectedUnitId,
		isUiDisabled,
		lockNav,
		productType,
		returnTo,
		router,
	]);

	const headerOptions = useAppHeader("process", {
		title: "Create Custom Unit",
		disabled: isUiDisabled,
		onExit: onCancel,
	});

	const onNext = useCallback(async () => {
		if (isUiDisabled || !lockNav()) return;

		await withBusy("Saving unit...", async () => {
			exitRef.current = true;
			router.replace({
				pathname: SETTINGS_UNIT_CUSTOM_CREATE_ROUTE as any,
				params: buildOpenUnitCustomCreateParams({
					returnTo,
					draftId: draftId || undefined,
					productType,
					initialCategory: CUSTOM_CATEGORY,
					selectedUnitId: inbound.selectedUnitId || undefined,
				}),
			});
		});
	}, [draftId, inbound.selectedUnitId, isUiDisabled, lockNav, productType, returnTo, router, withBusy]);

	useUnitFlowBackGuard(navigation, exitRef, onCancel);

	return (
		<>
			<Stack.Screen
				options={{
					...headerOptions,
					headerShadowVisible: false,
				}}
			/>

			<BAIScreen padded={false} safeTop={false} safeBottom={false} style={{ flex: 1 }}>
				<SettingsScreenLayout screenStyle={styles.screen} maxWidth={560}>
					<BAISurface style={styles.card} padded>
						<View style={styles.titleRow}>
							<View style={{ flex: 1 }}>
								<SettingsSectionTitle>Create Custom Unit</SettingsSectionTitle>
								<BAIText variant='caption' muted>
									Custom units are created under the Custom category.
								</BAIText>
							</View>
						</View>

						<View style={{ height: 12 }} />

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
								onPress={onNext}
								disabled={isUiDisabled}
								style={styles.inlineNext}
							>
								Next
							</BAICTAPillButton>
						</View>

						<View style={{ height: 16 }} />

						<BAIText variant='caption' muted>
							Category: {category}
						</BAIText>

						<View style={{ height: 24 }} />
					</BAISurface>
				</SettingsScreenLayout>
			</BAIScreen>
		</>
	);
}

const styles = StyleSheet.create({
	screen: {
		paddingHorizontal: 16,
		paddingTop: 0,
	},
	card: {
		marginHorizontal: 0,
		marginTop: 0,
		borderRadius: 24,
		paddingBottom: 0,
	},
	titleRow: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		gap: 12,
	},
	actionsRow: { flexDirection: "row", alignItems: "center", gap: 12 },
	inlineCancel: { flex: 1 },
	inlineNext: { flex: 1 },
});
