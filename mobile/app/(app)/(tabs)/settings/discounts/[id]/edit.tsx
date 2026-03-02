// BizAssist_mobile
// path: app/(app)/(tabs)/settings/discounts/[id]/edit.tsx
//
// Header governance:
// - Edit Discount is a PROCESS screen -> use EXIT.
// - Exit cancels and returns deterministically (returnTo or discount detail).

import { useCallback, useEffect, useMemo, useState } from "react";
import {
	Keyboard,
	KeyboardAvoidingView,
	Platform,
	ScrollView,
	StyleSheet,
	TouchableWithoutFeedback,
	View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useTheme } from "react-native-paper";

import { BAIButton } from "@/components/ui/BAIButton";
import { BAICTAButton } from "@/components/ui/BAICTAButton";
import { BAIRetryButton } from "@/components/ui/BAIRetryButton";
import { BAIScreen } from "@/components/ui/BAIScreen";
import { BAISurface } from "@/components/ui/BAISurface";
import { BAIText } from "@/components/ui/BAIText";
import { BAITextInput } from "@/components/ui/BAITextInput";
import { BAIMinorMoneyInput } from "@/components/ui/BAIMinorMoneyInput";
import { BAITextarea } from "@/components/ui/BAITextarea";
import { BAISwitchRow } from "@/components/ui/BAISwitchRow";
import { SettingsScreenLayout } from "@/components/settings/SettingsLayout";

import { useAppBusy } from "@/hooks/useAppBusy";
import { useActiveBusinessMeta } from "@/modules/business/useActiveBusinessMeta";
import { DEFAULT_STACKABLE } from "@/modules/discounts/discounts.constants";
import {
	buildInventoryDiscountDetailsRoute,
	normalizeDiscountReturnTo,
	buildSettingsDiscountDetailsRoute,
} from "@/modules/discounts/discounts.navigation";
import { useDiscountById, useUpdateDiscount } from "@/modules/discounts/discounts.queries";
import type { DiscountType } from "@/modules/discounts/discounts.types";
import { normalizeNote, validateName, validateValueByType } from "@/modules/discounts/discounts.validators";
import { useAppHeader } from "@/modules/navigation/useAppHeader";
import { useInventoryHeader } from "@/modules/inventory/useInventoryHeader";
import { FIELD_LIMITS } from "@/shared/fieldLimits";
import { useNavLock } from "@/shared/hooks/useNavLock";
import { sanitizeMoneyInput } from "@/shared/validation/sanitize";

function extractApiError(err: unknown): { code?: string; message?: string } {
	const data = (err as any)?.response?.data;
	const error = data?.error ?? {};
	const code = typeof error?.code === "string" ? error.code : typeof data?.code === "string" ? data.code : undefined;
	const message =
		typeof error?.message === "string" ? error.message : typeof data?.message === "string" ? data.message : undefined;
	return { code, message };
}

type DiscountFlowMode = "settings" | "inventory";

export function DiscountEditScreen({ mode = "settings" }: { mode?: DiscountFlowMode }) {
	const router = useRouter();
	const navigation = useNavigation<any>();
	const theme = useTheme();
	const headerHeight = useHeaderHeight();
	const { withBusy, busy } = useAppBusy();
	const { safeReplace, canNavigate } = useNavLock();
	const { currencyCode } = useActiveBusinessMeta();

	const params = useLocalSearchParams<{ id?: string; returnTo?: string }>();
	const discountId = String(params.id ?? "");
	const returnTo = useMemo(() => normalizeDiscountReturnTo(params.returnTo), [params.returnTo]);

	const query = useDiscountById(discountId);
	const update = useUpdateDiscount(discountId);
	const discount = query.data ?? null;
	const isArchived = !!discount && discount.isActive === false;

	const [name, setName] = useState("");
	const [noteText, setNoteText] = useState("");
	const [type, setType] = useState<DiscountType>("PERCENT");
	const [valueText, setValueText] = useState("");
	const [isStackable, setIsStackable] = useState(DEFAULT_STACKABLE);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!discount) return;
		setName(discount.name ?? "");
		setNoteText(discount.note ?? "");
		setType(discount.type ?? "PERCENT");
		setValueText(sanitizeMoneyInput(String(discount.value ?? "").replace(/%/g, "")));
		setIsStackable(!!discount.isStackable);
		setError(null);
	}, [discount]);

	const isBusy = !!busy?.isBusy || update.isPending;
	const isUiDisabled = isBusy || !canNavigate;

	const percentDisplay = useMemo(() => {
		if (type !== "PERCENT") return valueText;
		const v = valueText.trim();
		return v ? `${v}%` : "";
	}, [type, valueText]);

	const percentSelection = useMemo(() => {
		if (type !== "PERCENT") return undefined;
		const len = valueText.length;
		return { start: len, end: len };
	}, [type, valueText]);

	const nameCheck = useMemo(() => validateName(name), [name]);
	const valueCheck = useMemo(() => validateValueByType(type, valueText), [type, valueText]);
	const showNameError = name.trim().length > 0 && !nameCheck.ok;
	const showValueError = valueText.trim().length > 0 && !valueCheck.ok;
	const baseline = useMemo(() => {
		if (!discount) return null;
		const parsedName = validateName(discount.name ?? "");
		return {
			name: parsedName.ok ? parsedName.value : String(discount.name ?? "").trim(),
			note: normalizeNote(discount.note ?? ""),
			value: sanitizeMoneyInput(String(discount.value ?? "").replace(/%/g, "")),
			isStackable: !!discount.isStackable,
		};
	}, [discount]);
	const hasChanges = useMemo(() => {
		if (!baseline) return false;
		const currentName = nameCheck.ok ? nameCheck.value : name.trim();
		const currentNote = normalizeNote(noteText);
		const currentValue = sanitizeMoneyInput(String(valueText ?? "").replace(/%/g, ""));

		return (
			currentName !== baseline.name ||
			currentNote !== baseline.note ||
			currentValue !== baseline.value ||
			isStackable !== baseline.isStackable
		);
	}, [baseline, isStackable, name, nameCheck, noteText, valueText]);

	const canSave = useMemo(() => {
		if (!discountId) return false;
		if (!nameCheck.ok) return false;
		if (!valueCheck.ok) return false;
		if (isArchived) return false;
		if (!hasChanges) return false;
		return !isUiDisabled;
	}, [discountId, hasChanges, isArchived, isUiDisabled, nameCheck.ok, valueCheck.ok]);

	const detailRoute = useMemo(
		() =>
			mode === "settings"
				? buildSettingsDiscountDetailsRoute(discountId, returnTo)
				: buildInventoryDiscountDetailsRoute(discountId, returnTo),
		[discountId, mode, returnTo],
	);

	const onExitBase = useCallback(() => {
		if (isUiDisabled) return;
		safeReplace(router as any, detailRoute as any);
	}, [detailRoute, isUiDisabled, router, safeReplace]);

	useEffect(() => {
		const unsub = navigation.addListener("beforeRemove", (e: any) => {
			const actionType = String(e?.data?.action?.type ?? "");
			const isBackAction = actionType === "GO_BACK" || actionType === "POP" || actionType === "POP_TO_TOP";
			if (!isBackAction) return;

			e.preventDefault();
			onExitBase();
		});
		return unsub;
	}, [navigation, onExitBase]);

	const settingsHeaderOptions = useAppHeader("process", {
		title: "Edit Discount",
		disabled: isUiDisabled,
		onExit: onExitBase,
	});
	const inventoryHeaderOptions = useInventoryHeader("process", {
		title: "Edit Discount",
		disabled: isUiDisabled,
		onExit: onExitBase,
	});
	const headerOptions = mode === "settings" ? settingsHeaderOptions : inventoryHeaderOptions;

	const onSave = useCallback(async () => {
		if (!canSave || isArchived) return;
		setError(null);

		await withBusy("Saving discount…", async () => {
			try {
				await update.mutateAsync({
					name: nameCheck.ok ? nameCheck.value : name.trim(),
					note: normalizeNote(noteText),
					type,
					value: valueCheck.ok ? valueCheck.value : "",
					isStackable,
				});
				safeReplace(router as any, detailRoute as any);
			} catch (err) {
				const { message } = extractApiError(err);
				setError(message ?? "Failed to update discount.");
			}
		});
	}, [
		canSave,
		isArchived,
		isStackable,
		name,
		nameCheck,
		noteText,
		router,
		safeReplace,
		detailRoute,
		type,
		update,
		valueCheck,
		withBusy,
	]);

	const valuePlaceholder = type === "PERCENT" ? "0%" : undefined;
	const valueLimit = type === "PERCENT" ? FIELD_LIMITS.discountPercent : FIELD_LIMITS.discountAmount;
	const valueMaxLength = type === "PERCENT" ? valueLimit + 1 : valueLimit;
	const keyboardVerticalOffset = Platform.OS === "ios" ? headerHeight + 8 : 0;
	const dismissKeyboard = useCallback(() => {
		Keyboard.dismiss();
	}, []);
	const borderColor = theme.colors.outlineVariant ?? theme.colors.outline;
	const typeSurfaceStyle = useMemo(
		() => ({
			borderColor,
			backgroundColor: theme.colors.surfaceVariant ?? theme.colors.surface,
		}),
		[borderColor, theme.colors.surface, theme.colors.surfaceVariant],
	);

	return (
		<>
			<Stack.Screen options={headerOptions} />

			<BAIScreen padded={false} safeTop={false} style={styles.root}>
				<KeyboardAvoidingView
					style={styles.keyboardAvoider}
					behavior={Platform.OS === "ios" ? "padding" : "height"}
					keyboardVerticalOffset={keyboardVerticalOffset}
				>
					<TouchableWithoutFeedback onPress={dismissKeyboard} accessible={false}>
						<View style={styles.keyboardContent}>
							<ScrollView
								style={styles.scroll}
								contentContainerStyle={styles.scrollContent}
								keyboardShouldPersistTaps='handled'
								keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
								onScrollBeginDrag={dismissKeyboard}
								showsVerticalScrollIndicator={false}
							>
								<SettingsScreenLayout
									screenStyle={[styles.screen, { backgroundColor: theme.colors.background }]}
									maxWidth={860}
								>
									{query.isLoading ? (
										<BAISurface style={[styles.banner, { borderColor }]} padded bordered>
											<BAIText variant='caption' muted>
												Loading discount...
											</BAIText>
										</BAISurface>
									) : null}

									{query.isError ? (
										<BAISurface style={[styles.banner, { borderColor }]} padded bordered>
											<BAIText variant='caption' muted>
												Could not load discount details.
											</BAIText>
											<View style={{ height: 12 }} />
											<BAIRetryButton variant='outline' onPress={() => query.refetch()} disabled={isUiDisabled}>
												Retry
											</BAIRetryButton>
										</BAISurface>
									) : null}

									{!query.isLoading && !query.isError && !discount ? (
										<BAISurface style={[styles.banner, { borderColor }]} padded bordered>
											<BAIText variant='caption' muted>
												Discount not found.
											</BAIText>
											<View style={{ height: 12 }} />
											<BAIButton
												variant='outline'
												onPress={onExitBase}
												disabled={isUiDisabled}
												shape='pill'
												widthPreset='standard'
											>
												Cancel
											</BAIButton>
										</BAISurface>
									) : null}

									{discount ? (
										<BAISurface style={[styles.card, { borderColor }]} padded bordered>
											{isArchived ? (
												<BAISurface style={[styles.notice, { borderColor }]} padded bordered>
													<BAIText variant='caption' muted>
														Archived discounts are read-only. Restore this discount to make changes.
													</BAIText>
												</BAISurface>
											) : null}

											<BAITextInput
												label='Discount name'
												value={name}
												onChangeText={setName}
												maxLength={FIELD_LIMITS.discountName}
												placeholder='e.g. Senior discount'
												disabled={isUiDisabled || isArchived}
											/>
											{showNameError ? (
												<BAIText variant='caption' style={{ color: theme.colors.error }}>
													{nameCheck.message}
												</BAIText>
											) : null}

											<BAITextarea
												label='Note'
												value={noteText}
												onChangeText={setNoteText}
												maxLength={FIELD_LIMITS.discountNote}
												placeholder='Note (optional)'
												visibleLines={2}
												minHeight={56}
												maxHeight={112}
												inputStyle={styles.noteInputPadding}
												scrollEnabled
												hideScrollIndicator
												disabled={isUiDisabled || isArchived}
											/>

											<BAIText variant='caption' muted>
												Amount type
											</BAIText>

											<BAISurface style={[styles.typeSurface, typeSurfaceStyle]} padded bordered>
												<BAIText variant='caption' muted>
													Type
												</BAIText>
												<BAIText variant='body'>{type === "PERCENT" ? "Percent" : "Amount"}</BAIText>
											</BAISurface>
											<BAIText variant='caption' muted>
												Type cannot be changed after creation.
											</BAIText>

											{type === "PERCENT" ? (
												<BAITextInput
													label='Percentage'
													value={percentDisplay}
													onChangeText={(v) => {
														const raw = v.replace(/%/g, "").trim();
														const cleaned = sanitizeMoneyInput(raw);
														const numeric = Number(cleaned);
														if (Number.isFinite(numeric) && numeric > 100) {
															setValueText("100");
															return;
														}
														setValueText(cleaned.length > valueLimit ? cleaned.slice(0, valueLimit) : cleaned);
													}}
													selection={valueText ? percentSelection : undefined}
													maxLength={valueMaxLength}
													keyboardType='decimal-pad'
													placeholder={valuePlaceholder}
													disabled={isUiDisabled || isArchived}
												/>
											) : (
												<BAIMinorMoneyInput
													label='Amount'
													value={valueText}
													onChangeText={setValueText}
													currencyCode={currencyCode}
													maxMinorDigits={11}
													style={styles.moneyHalfInput}
													contentStyle={styles.moneyValueInputContent}
													disabled={isUiDisabled || isArchived}
												/>
											)}
											{showValueError ? (
												<BAIText variant='caption' style={{ color: theme.colors.error }}>
													{valueCheck.message}
												</BAIText>
											) : null}

											<BAISwitchRow
												label='Stackable'
												description='Allow this discount to combine with others.'
												value={isStackable}
												onValueChange={setIsStackable}
												disabled={isUiDisabled || isArchived}
												switchVariant='blue'
											/>

											{error ? (
												<BAIText variant='caption' style={{ color: theme.colors.error }}>
													{error}
												</BAIText>
											) : null}

											<View style={styles.actions}>
												<BAIButton
													variant='outline'
													intent='neutral'
													onPress={onExitBase}
													disabled={isUiDisabled}
													shape='pill'
													widthPreset='standard'
													style={styles.actionButton}
												>
													Cancel
												</BAIButton>
												<BAICTAButton
													mode='contained'
													onPress={onSave}
													disabled={!canSave}
													shape='pill'
													style={styles.actionButton}
												>
													Save
												</BAICTAButton>
											</View>
										</BAISurface>
									) : null}
								</SettingsScreenLayout>
							</ScrollView>
						</View>
					</TouchableWithoutFeedback>
				</KeyboardAvoidingView>
			</BAIScreen>
		</>
	);
}

export default function SettingsDiscountEditScreen() {
	return <DiscountEditScreen mode='settings' />;
}

const styles = StyleSheet.create({
	root: { flex: 1 },
	keyboardAvoider: { flex: 1 },
	keyboardContent: { flex: 1 },
	scroll: { flex: 1 },
	scrollContent: { flexGrow: 1 },
	screen: { padding: 12, paddingTop: 0 },
	banner: { borderRadius: 16 },
	card: { gap: 12 },
	moneyHalfInput: { width: "50%", alignSelf: "flex-start" },
	moneyValueInputContent: { paddingLeft: 16, paddingRight: 20 },
	notice: { borderRadius: 12 },
	typeSurface: { borderRadius: 12, gap: 2, marginBottom: 0 },
	noteInputPadding: { paddingTop: 16, paddingBottom: 16 },
	actions: { flexDirection: "row", gap: 10, flexWrap: "nowrap", marginTop: 20 },
	actionButton: { flex: 1 },
});
