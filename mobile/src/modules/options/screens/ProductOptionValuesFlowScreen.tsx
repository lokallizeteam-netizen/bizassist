import { useCallback, useMemo, useState } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useTheme } from "react-native-paper";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { BAIButton } from "@/components/ui/BAIButton";
import { BAIHeader } from "@/components/ui/BAIHeader";
import { BAIHeaderActionButton } from "@/components/ui/BAIHeaderActionButton";
import { BAIRetryButton } from "@/components/ui/BAIRetryButton";
import { BAIScreen } from "@/components/ui/BAIScreen";
import { BAISearchBar } from "@/components/ui/BAISearchBar";
import { BAISurface } from "@/components/ui/BAISurface";
import { BAIText } from "@/components/ui/BAIText";
import { BAITextInput } from "@/components/ui/BAITextInput";
import { useAppBusy } from "@/hooks/useAppBusy";
import { useAppToast } from "@/providers/AppToastProvider";
import { useProductCreateDraft } from "@/modules/inventory/drafts/useProductCreateDraft";
import { mapInventoryRouteToScope, type InventoryRouteScope } from "@/modules/inventory/navigation.scope";
import { optionsApi } from "@/modules/options/options.api";
import { useOptionSetsList } from "@/modules/options/options.queries";
import {
	DRAFT_ID_KEY,
	OPTION_SET_ID_KEY,
	PRODUCT_CREATE_VARIATIONS_ROUTE,
	PRODUCT_ID_KEY,
	PRODUCT_OPTION_VALUES_ROUTE,
	PRODUCT_SELECT_OPTIONS_ROUTE,
	ROOT_RETURN_TO_KEY,
	RETURN_TO_KEY,
	normalizeReturnTo,
} from "@/modules/options/productOptionPicker.contract";
import { FIELD_LIMITS } from "@/shared/fieldLimits";
import { toTitleCase } from "@/shared/text/titleCase";
import { sanitizeLabelInput } from "@/shared/validation/sanitize";

function clampText(value: string, maxLength: number): string {
	if (maxLength <= 0) return "";
	return String(value ?? "").slice(0, maxLength);
}

export function ProductOptionValuesFlowScreen({ routeScope = "inventory" }: { routeScope?: InventoryRouteScope }) {
	const router = useRouter();
	const params = useLocalSearchParams();
	const theme = useTheme();
	const { withBusy, busy } = useAppBusy();
	const { showError, showSuccess } = useAppToast();

	const draftId = String(params[DRAFT_ID_KEY] ?? "").trim();
	const optionSetId = String(params[OPTION_SET_ID_KEY] ?? "").trim();
	const productId = String(params[PRODUCT_ID_KEY] ?? "").trim();
	const { draft, patch } = useProductCreateDraft(draftId || undefined);

	const toScopedRoute = useCallback((route: string) => mapInventoryRouteToScope(route, routeScope), [routeScope]);
	const fallbackReturnTo = useMemo(() => {
		if (productId) {
			return toScopedRoute(`/(app)/(tabs)/inventory/products/${encodeURIComponent(productId)}/edit`);
		}
		return toScopedRoute("/(app)/(tabs)/inventory/products/create");
	}, [productId, toScopedRoute]);
	const returnTo = useMemo(
		() => normalizeReturnTo(params[RETURN_TO_KEY]) ?? toScopedRoute(PRODUCT_SELECT_OPTIONS_ROUTE),
		[params, toScopedRoute],
	);
	const rootReturnTo = useMemo(
		() => normalizeReturnTo(params[ROOT_RETURN_TO_KEY]) ?? fallbackReturnTo,
		[fallbackReturnTo, params],
	);

	const query = useOptionSetsList(false);
	const optionSet = useMemo(
		() => (query.data ?? []).find((item) => item.id === optionSetId) ?? null,
		[optionSetId, query.data],
	);
	const draftSelection = useMemo(
		() => draft.optionSelections.find((item) => item.optionSetId === optionSetId) ?? null,
		[draft.optionSelections, optionSetId],
	);
	const isUiDisabled = busy.isBusy;
	const [searchText, setSearchText] = useState("");
	const [newOptionValueName, setNewOptionValueName] = useState("");

	const [selectedValueIds, setSelectedValueIds] = useState<string[]>(() => draftSelection?.selectedValueIds ?? []);
	const filteredValues = useMemo(() => {
		if (!optionSet) return [];
		const q = searchText.trim().toLowerCase();
		if (!q) return optionSet.values;
		return optionSet.values.filter((value) => value.name.toLowerCase().includes(q));
	}, [optionSet, searchText]);
	const allSelected = useMemo(() => {
		if (!optionSet || optionSet.values.length === 0) return false;
		return optionSet.values.every((value) => selectedValueIds.includes(value.id));
	}, [optionSet, selectedValueIds]);

	const onBack = useCallback(() => {
		router.replace({
			pathname: returnTo as any,
			params: {
				[DRAFT_ID_KEY]: draft.draftId,
				[RETURN_TO_KEY]: rootReturnTo,
				[ROOT_RETURN_TO_KEY]: rootReturnTo,
				...(productId ? { [PRODUCT_ID_KEY]: productId } : {}),
			} as any,
		});
	}, [draft.draftId, productId, returnTo, rootReturnTo, router]);

	const onSave = useCallback(() => {
		if (!optionSet) return;
		const selectedValues = optionSet.values.filter((value) => selectedValueIds.includes(value.id));
		if (selectedValues.length === 0) return;

		const existingWithoutCurrent = draft.optionSelections.filter((item) => item.optionSetId !== optionSet.id);
		const existingIndex = draft.optionSelections.findIndex((item) => item.optionSetId === optionSet.id);
		const existing = draft.optionSelections.find((item) => item.optionSetId === optionSet.id);
		existingWithoutCurrent.push({
			optionSetId: optionSet.id,
			optionSetName: existing?.optionSetName || optionSet.name,
			selectedValueIds: selectedValues.map((value) => value.id),
			selectedValueNames: selectedValues.map((value) => value.name),
			sortOrder: existingIndex >= 0 ? existingIndex : existingWithoutCurrent.length,
		});

		const normalized = existingWithoutCurrent
			.sort((a, b) => a.sortOrder - b.sortOrder)
			.map((item, index) => ({ ...item, sortOrder: index }));

		const nextSelectedOptionSetIds = draft.selectedOptionSetIds.includes(optionSet.id)
			? draft.selectedOptionSetIds
			: [...draft.selectedOptionSetIds, optionSet.id];

		patch({
			selectedOptionSetIds: nextSelectedOptionSetIds,
			selectedVariationKeys: [],
			variationSelectionInitialized: false,
			optionSelections: normalized,
		});

		const firstIncompleteSelection = normalized.find((selection) => selection.selectedValueIds.length === 0);
		if (firstIncompleteSelection) {
			router.replace({
				pathname: toScopedRoute(PRODUCT_OPTION_VALUES_ROUTE) as any,
				params: {
					[DRAFT_ID_KEY]: draft.draftId,
					[OPTION_SET_ID_KEY]: firstIncompleteSelection.optionSetId,
					[RETURN_TO_KEY]: toScopedRoute(PRODUCT_SELECT_OPTIONS_ROUTE),
					[ROOT_RETURN_TO_KEY]: rootReturnTo,
					...(productId ? { [PRODUCT_ID_KEY]: productId } : {}),
				} as any,
			});
			return;
		}

		router.replace({
			pathname: toScopedRoute(PRODUCT_CREATE_VARIATIONS_ROUTE) as any,
			params: {
				[DRAFT_ID_KEY]: draft.draftId,
				[RETURN_TO_KEY]: rootReturnTo,
				[ROOT_RETURN_TO_KEY]: rootReturnTo,
				...(productId ? { [PRODUCT_ID_KEY]: productId } : {}),
			} as any,
		});
	}, [
		draft.draftId,
		draft.optionSelections,
		draft.selectedOptionSetIds,
		optionSet,
		patch,
		productId,
		rootReturnTo,
		router,
		selectedValueIds,
		toScopedRoute,
	]);

	const onRemoveOptionSet = useCallback(() => {
		if (!optionSet) return;
		const nextSelections = draft.optionSelections
			.filter((item) => item.optionSetId !== optionSet.id)
			.map((item, index) => ({ ...item, sortOrder: index }));
		patch({
			selectedOptionSetIds: draft.selectedOptionSetIds.filter((item) => item !== optionSet.id),
			selectedVariationKeys: [],
			variationSelectionInitialized: false,
			optionSelections: nextSelections,
		});
		router.replace({
			pathname: toScopedRoute(PRODUCT_SELECT_OPTIONS_ROUTE) as any,
			params: {
				[DRAFT_ID_KEY]: draft.draftId,
				[RETURN_TO_KEY]: rootReturnTo,
				[ROOT_RETURN_TO_KEY]: rootReturnTo,
				...(productId ? { [PRODUCT_ID_KEY]: productId } : {}),
			} as any,
		});
	}, [
		draft.draftId,
		draft.optionSelections,
		draft.selectedOptionSetIds,
		optionSet,
		patch,
		productId,
		rootReturnTo,
		router,
		toScopedRoute,
	]);

	const onCreateOptionValue = useCallback(async () => {
		if (!optionSet || isUiDisabled) return;
		const normalizedName = toTitleCase(sanitizeLabelInput(newOptionValueName)).trim();
		if (!normalizedName) {
			showError("Option value name is required.");
			return;
		}

		await withBusy("Creating value...", async () => {
			try {
				const updated = await optionsApi.addOptionValue(optionSet.id, { name: normalizedName });
				const createdValue = [...updated.values]
					.reverse()
					.find((value) => value.name.toLowerCase() === normalizedName.toLowerCase());
				if (createdValue) {
					setSelectedValueIds((prev) => (prev.includes(createdValue.id) ? prev : [...prev, createdValue.id]));
				}
				setNewOptionValueName("");
				await query.refetch();
				showSuccess("Option value created.");
			} catch (e: any) {
				const payload = e?.response?.data;
				const message =
					payload?.message ??
					payload?.error ??
					payload?.errorMessage ??
					payload?.error?.message ??
					"Failed to create option value.";
				showError(String(message));
			}
		});
	}, [isUiDisabled, newOptionValueName, optionSet, query, showError, showSuccess, withBusy]);

	const topSection = (
		<View
			style={[
				styles.topSection,
				{
					borderBottomColor: theme.colors.outlineVariant ?? theme.colors.outline,
					backgroundColor: theme.colors.surface,
				},
			]}
		>
			<BAISearchBar
				value={searchText}
				onChangeText={(value) => setSearchText(clampText(value, FIELD_LIMITS.search))}
				maxLength={FIELD_LIMITS.search}
				placeholder={`Search ${toTitleCase(optionSet?.name ?? "option")} values`}
				disabled={isUiDisabled}
			/>
		</View>
	);

	return (
		<>
			<Stack.Screen options={{ headerShown: false }} />
			<BAIScreen tabbed padded={false} safeTop={false} safeBottom style={styles.root}>
				<BAIHeader
					title={optionSet?.name ?? "Option values"}
					variant='exit'
					onLeftPress={onBack}
					onRightPress={onSave}
					rightDisabled={selectedValueIds.length === 0}
					rightSlot={({ disabled }) => <BAIHeaderActionButton label='Done' disabled={disabled} />}
				/>
				<BAISurface
					bordered
					style={[styles.panel, { borderColor: theme.colors.outlineVariant ?? theme.colors.outline }]}
				>
					{query.isLoading ? (
						<View style={styles.stateScreenWrap}>
							{topSection}
							<View style={styles.stateWrap}>
								<BAIText variant='body' muted>
									Loading option values...
								</BAIText>
							</View>
						</View>
					) : query.isError ? (
						<View style={styles.stateScreenWrap}>
							{topSection}
							<View style={styles.stateWrap}>
								<BAIRetryButton compact onPress={() => query.refetch()}>
									Retry
								</BAIRetryButton>
							</View>
						</View>
					) : !optionSet ? (
						<View style={styles.stateScreenWrap}>
							{topSection}
							<View style={styles.stateWrap}>
								<BAIText variant='body' muted>
									Option set not found.
								</BAIText>
							</View>
						</View>
					) : (
						<FlatList
							data={filteredValues}
							keyExtractor={(item) => item.id}
							style={styles.list}
							contentContainerStyle={styles.listContent}
							keyboardShouldPersistTaps='handled'
							stickyHeaderIndices={[0]}
							ListHeaderComponent={
								<View>
									{topSection}
									<View style={styles.titleWrap}>
										<BAIText variant='subtitle'>{toTitleCase(optionSet.name)} options</BAIText>
									</View>
									<View style={[styles.row, { borderColor: theme.colors.outlineVariant ?? theme.colors.outline }]}>
										<BAIText variant='subtitle' style={styles.flex}>
											All options
										</BAIText>
										<MaterialCommunityIcons
											name={allSelected ? "check-circle" : "checkbox-blank-circle-outline"}
											size={34}
											color={allSelected ? theme.colors.primary : theme.colors.onSurfaceVariant}
											onPress={() => {
												if (isUiDisabled) return;
												if (allSelected) {
													setSelectedValueIds([]);
													return;
												}
												setSelectedValueIds(optionSet.values.map((value) => value.id));
											}}
										/>
									</View>
								</View>
							}
							ListEmptyComponent={
								<View style={styles.stateWrap}>
									<BAIText variant='body' muted>
										No option values match your search.
									</BAIText>
								</View>
							}
							renderItem={({ item }) => {
								const checked = selectedValueIds.includes(item.id);
								return (
									<View style={[styles.row, { borderColor: theme.colors.outlineVariant ?? theme.colors.outline }]}>
										<BAIText variant='subtitle' style={styles.flex}>
											{toTitleCase(item.name)}
										</BAIText>
										<MaterialCommunityIcons
											name={checked ? "check-circle" : "checkbox-blank-circle-outline"}
											size={34}
											color={checked ? theme.colors.primary : theme.colors.onSurfaceVariant}
											onPress={() => {
												if (isUiDisabled) return;
												setSelectedValueIds((prev) =>
													prev.includes(item.id) ? prev.filter((id) => id !== item.id) : [...prev, item.id],
												);
											}}
										/>
									</View>
								);
							}}
							ListFooterComponent={
								<View style={styles.footerWrap}>
									<BAITextInput
										style={styles.valueInput}
										label='Add option'
										value={newOptionValueName}
										onChangeText={(value) =>
											setNewOptionValueName(clampText(toTitleCase(value), FIELD_LIMITS.modifierName))
										}
										onBlur={() =>
											setNewOptionValueName((prev) =>
												clampText(toTitleCase(sanitizeLabelInput(prev)), FIELD_LIMITS.modifierName),
											)
										}
										placeholder='e.g. Medium'
										maxLength={FIELD_LIMITS.modifierName}
										disabled={isUiDisabled}
									/>
									<BAIButton
										mode='contained'
										shape='pill'
										onPress={onCreateOptionValue}
										disabled={isUiDisabled || !sanitizeLabelInput(newOptionValueName).trim()}
									>
										Add option
									</BAIButton>
									<BAIButton
										mode='contained'
										variant='subtle'
										shape='pill'
										onPress={onRemoveOptionSet}
										disabled={isUiDisabled}
									>
										Remove option set
									</BAIButton>
								</View>
							}
						/>
					)}
				</BAISurface>
			</BAIScreen>
		</>
	);
}

const styles = StyleSheet.create({
	root: { flex: 1 },
	panel: { flex: 1, minHeight: 0, marginHorizontal: 16, marginTop: 12, borderRadius: 24, overflow: "hidden" },
	topSection: {
		paddingHorizontal: 12,
		paddingTop: 10,
		paddingBottom: 10,
		gap: 8,
		borderBottomWidth: StyleSheet.hairlineWidth,
	},
	valueInput: {
		marginBottom: 0,
	},
	titleWrap: {
		paddingHorizontal: 14,
		paddingVertical: 10,
	},
	stateScreenWrap: { flex: 1, minHeight: 0 },
	stateWrap: { flex: 1, minHeight: 180, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
	list: { flex: 1, minHeight: 0 },
	listContent: { paddingBottom: 12 },
	row: {
		paddingHorizontal: 14,
		paddingVertical: 8,
		borderBottomWidth: StyleSheet.hairlineWidth,
		flexDirection: "row",
		alignItems: "center",
	},
	footerWrap: {
		paddingHorizontal: 14,
		paddingTop: 12,
		paddingBottom: 12,
		gap: 10,
	},
	flex: { flex: 1 },
});
