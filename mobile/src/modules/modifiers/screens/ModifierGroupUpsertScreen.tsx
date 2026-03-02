import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	Animated,
	Easing,
	InteractionManager,
	Keyboard,
	Modal,
	Pressable,
	ScrollView,
	StyleSheet,
	TouchableWithoutFeedback,
	View,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useTheme } from "react-native-paper";
import { useQueryClient } from "@tanstack/react-query";

import { ConfirmActionModal } from "@/components/settings/ConfirmActionModal";
import { BAIButton } from "@/components/ui/BAIButton";
import { BAIGroupTabs, type BAIGroupTab } from "@/components/ui/BAIGroupTabs";
import { BAIHeader } from "@/components/ui/BAIHeader";
import { BAIScreen } from "@/components/ui/BAIScreen";
import { BAISurface } from "@/components/ui/BAISurface";
import { BAIText } from "@/components/ui/BAIText";
import { BAITextInput } from "@/components/ui/BAITextInput";
import { useAppBusy } from "@/hooks/useAppBusy";
import { formatCompactNumber, getBusinessLocale } from "@/lib/locale/businessLocale";
import { useActiveBusinessMeta } from "@/modules/business/useActiveBusinessMeta";
import { runGovernedProcessExit } from "@/modules/inventory/navigation.governance";
import { useProcessExitGuard } from "@/modules/navigation/useProcessExitGuard";
import {
	buildModifierSelectionParams,
	DRAFT_ID_KEY as PICKER_DRAFT_ID_KEY,
	parseModifierSelectionParams,
	type ModifierPickerInboundParams,
} from "@/modules/modifiers/modifierPicker.contract";
import {
	buildModifierGroupDraftId,
	clearModifierGroupDraft,
	createModifierGroupDraft,
	getModifierGroupDraft,
	subscribeModifierGroupDraft,
	type ModifierOptionDraft,
	upsertModifierGroupDraft,
} from "@/modules/modifiers/drafts/modifierGroupDraft";
import { modifiersApi } from "@/modules/modifiers/modifiers.api";
import type { ModifierSelectionType, SharedModifierAvailabilityPreview } from "@/modules/modifiers/modifiers.types";
import { useAppToast } from "@/providers/AppToastProvider";
import { FIELD_LIMITS } from "@/shared/fieldLimits";
import { MONEY_INPUT_PRECISION } from "@/shared/money/money.constants";
import { digitsToMinorUnits, parseMinorUnits, sanitizeDigits } from "@/shared/money/money.minor";

type Props = { mode: "settings" | "inventory"; intent: "create" | "edit" };
type ModifierOptionsTab = "active" | "archived";
const DELETE_ACTION_WIDTH = 88;
const DELETE_ACTION_GAP = 2;
const DELETE_REVEAL_INSET = DELETE_ACTION_WIDTH + DELETE_ACTION_GAP;
const DELETE_OPEN_DURATION_MS = 300;
const DELETE_CLOSE_DURATION_MS = 180;
const REMOVE_BUTTON_WIDTH = 30;
const REMOVE_BUTTON_HEIGHT = 30;
const REMOVE_BUTTON_LEFT_PADDING = 12;
const PRICE_INPUT_MAX_MINOR_DIGITS = 11;
const PRICE_INPUT_ESTIMATED_CHAR_WIDTH = 10;
const PRICE_INPUT_LEFT_INSET = 0;
const PRICE_INPUT_RIGHT_INSET = 12;
const MODIFIER_SET_NAME_CHAR_LIMIT = FIELD_LIMITS.modifierSetName;
const MODIFIER_NAME_CHAR_LIMIT = FIELD_LIMITS.modifierName;

function clampFieldValue(input: string, maxLength: number): string {
	if (maxLength <= 0) return "";
	return input.slice(0, maxLength);
}

function toSafeMinor(value: unknown): number {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return 0;
	return Math.max(0, Math.trunc(parsed));
}

function resolveNextMinorFromInput(currentMinor: number, nextText: string): number {
	const safeCurrentMinor = toSafeMinor(currentMinor);
	const sanitized = sanitizeDigits(nextText);
	const currentDigits = sanitizeDigits(String(safeCurrentMinor));
	const capReached = currentDigits.length >= PRICE_INPUT_MAX_MINOR_DIGITS;
	const isGrowthAttempt = sanitized.length > currentDigits.length;

	// Backspace-safe cap guard: allow deletes/edits while silently blocking overflow growth.
	if (capReached && isGrowthAttempt) {
		return safeCurrentMinor;
	}

	const isSingleAppend = sanitized.length === currentDigits.length + 1 && sanitized.startsWith(currentDigits);

	// Silent growth lock: append-mode for single-key growth, full reparse for bulk edits/paste.
	return isSingleAppend
		? digitsToMinorUnits(currentDigits + sanitized[sanitized.length - 1], PRICE_INPUT_MAX_MINOR_DIGITS)
		: digitsToMinorUnits(sanitized, PRICE_INPUT_MAX_MINOR_DIGITS);
}

function resolvePriceInputWidth(inputValue: string, placeholder: string, maxLength: number): number {
	const hasValue = String(inputValue ?? "").length > 0;
	const referenceLength = (hasValue ? String(inputValue ?? "") : String(placeholder ?? "")).length;
	const safeMaxLength = Math.max(0, Math.trunc(maxLength));
	const boundedLength = safeMaxLength > 0 ? Math.min(referenceLength, safeMaxLength) : referenceLength;
	return PRICE_INPUT_LEFT_INSET + PRICE_INPUT_RIGHT_INSET + boundedLength * PRICE_INPUT_ESTIMATED_CHAR_WIDTH;
}

function makeOptionKey() {
	return `opt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function makeEmptyOptionDraft(): ModifierOptionDraft {
	return { key: makeOptionKey(), name: "", deltaMinor: 0, isSoldOut: false };
}

function hasModifierOptionInput(option: ModifierOptionDraft): boolean {
	return option.name.trim().length > 0 || toSafeMinor(option.deltaMinor) > 0;
}

function ensureTrailingPlaceholderOption(options: ModifierOptionDraft[]): ModifierOptionDraft[] {
	const activeOptions = options.filter((option) => !option.removed);
	if (activeOptions.length === 0) {
		return [...options, makeEmptyOptionDraft()];
	}
	const hasPlaceholder = activeOptions.some((option) => !hasModifierOptionInput(option));
	if (hasPlaceholder) return options;
	return [...options, makeEmptyOptionDraft()];
}

function buildSnapshot(input: {
	name: string;
	selectionType: ModifierSelectionType;
	isRequired: boolean;
	minSelected: string;
	maxSelected: string;
	options: ModifierOptionDraft[];
	appliedProductIds?: string[];
}) {
	return JSON.stringify({
		name: input.name.trim(),
		selectionType: input.selectionType,
		isRequired: input.isRequired,
		minSelected: input.minSelected,
		maxSelected: input.maxSelected,
		appliedProductIds: Array.from(
			new Set(
				(input.appliedProductIds ?? []).map((value) => String(value ?? "").trim()).filter((value) => value.length > 0),
			),
		).sort(),
		options: input.options
			.filter((option) => !option.removed && hasModifierOptionInput(option))
			.map((option) => ({
				id: option.id ?? "",
				name: option.name.trim(),
				deltaMinor: Math.max(0, Math.trunc(option.deltaMinor || 0)),
				isSoldOut: option.isSoldOut,
			})),
	});
}

type ModifierOptionRowProps = {
	row: ModifierOptionDraft;
	rowIndex: number;
	borderBottomColor: string;
	nameTextColor: string;
	cursorIndicatorColor: string;
	showDeleteControl: boolean;
	actionColor: string;
	onActionColor: string;
	actionLabel: string;
	isReadOnly: boolean;
	isDeleteRevealed: boolean;
	deleteIconRotate: Animated.AnimatedInterpolation<string | number>;
	deleteActionTranslateX: Animated.Value;
	deleteActionOpacity: Animated.Value;
	optionMainInsetRight: Animated.Value;
	maxPriceInputLength: number;
	pricePlaceholder: string;
	formatPriceDisplay: (minorUnits: number) => string;
	onToggleDeleteReveal: (rowKey: string) => void;
	onActionOption: (row: ModifierOptionDraft) => void;
	onChangeOptionName: (rowIndex: number, value: string) => void;
	onChangePriceMinor: (rowIndex: number, nextMinor: number) => void;
};

const ModifierOptionRow = memo(function ModifierOptionRow({
	row,
	rowIndex,
	borderBottomColor,
	nameTextColor,
	cursorIndicatorColor,
	showDeleteControl,
	actionColor,
	onActionColor,
	actionLabel,
	isReadOnly,
	isDeleteRevealed,
	deleteIconRotate,
	deleteActionTranslateX,
	deleteActionOpacity,
	optionMainInsetRight,
	maxPriceInputLength,
	pricePlaceholder,
	formatPriceDisplay,
	onToggleDeleteReveal,
	onActionOption,
	onChangeOptionName,
	onChangePriceMinor,
}: ModifierOptionRowProps) {
	const rowMinor = toSafeMinor(row.deltaMinor);
	const [isPriceFocused, setIsPriceFocused] = useState(false);
	const [isNameFocused, setIsNameFocused] = useState(false);
	const [editingMinor, setEditingMinor] = useState(rowMinor);
	const syncRafIdRef = useRef<number | null>(null);
	const latestEditingMinorRef = useRef(editingMinor);

	useEffect(() => {
		latestEditingMinorRef.current = editingMinor;
	}, [editingMinor]);

	useEffect(() => {
		if (!isPriceFocused) setEditingMinor(rowMinor);
	}, [isPriceFocused, rowMinor]);

	useEffect(() => {
		return () => {
			if (syncRafIdRef.current != null) {
				cancelAnimationFrame(syncRafIdRef.current);
				syncRafIdRef.current = null;
			}
		};
	}, []);

	const displayedMinor = isPriceFocused ? editingMinor : rowMinor;
	const inputValue = displayedMinor > 0 ? formatPriceDisplay(displayedMinor) : "";
	const priceInputWidth = useMemo(
		() => resolvePriceInputWidth(inputValue, pricePlaceholder, maxPriceInputLength),
		[inputValue, maxPriceInputLength, pricePlaceholder],
	);

	const onPriceFocus = useCallback(() => {
		if (syncRafIdRef.current != null) {
			cancelAnimationFrame(syncRafIdRef.current);
			syncRafIdRef.current = null;
		}
		setEditingMinor(rowMinor);
		setIsPriceFocused(true);
	}, [rowMinor]);

	const onPriceBlur = useCallback(() => {
		if (syncRafIdRef.current != null) {
			cancelAnimationFrame(syncRafIdRef.current);
			syncRafIdRef.current = null;
		}
		onChangePriceMinor(rowIndex, latestEditingMinorRef.current);
		setIsPriceFocused(false);
	}, [onChangePriceMinor, rowIndex]);

	const onPriceChange = useCallback(
		(value: string) => {
			const baseMinor = isPriceFocused ? editingMinor : rowMinor;
			const nextMinor = resolveNextMinorFromInput(baseMinor, value);
			if (nextMinor === baseMinor) return;
			setEditingMinor(nextMinor);
			if (syncRafIdRef.current != null) {
				cancelAnimationFrame(syncRafIdRef.current);
				syncRafIdRef.current = null;
			}
			syncRafIdRef.current = requestAnimationFrame(() => {
				syncRafIdRef.current = null;
				onChangePriceMinor(rowIndex, nextMinor);
			});
		},
		[editingMinor, isPriceFocused, onChangePriceMinor, rowIndex, rowMinor],
	);

	return (
		<View style={[styles.optionRow, { borderBottomColor }]}>
			<View style={styles.optionInlineRow}>
				<Animated.View
					style={[
						styles.optionMainContent,
						showDeleteControl && isDeleteRevealed ? { marginRight: optionMainInsetRight } : null,
					]}
				>
					{showDeleteControl ? (
						<Pressable onPress={() => onToggleDeleteReveal(row.key)} style={[styles.removeBtnSlot, styles.removeBtn]}>
							<View style={[styles.removeBtnFill, { backgroundColor: actionColor }]}>
								{isDeleteRevealed ? (
									<Animated.View style={{ transform: [{ rotate: deleteIconRotate }] }}>
										<MaterialCommunityIcons name='minus' size={16} color={onActionColor} />
									</Animated.View>
								) : (
									<MaterialCommunityIcons name='minus' size={16} color={onActionColor} />
								)}
							</View>
						</Pressable>
					) : (
						<View style={styles.removeBtnSlot} />
					)}
					<View style={styles.optionFields}>
						<View style={styles.optionNameInputWrap}>
							<BAITextInput
								label={undefined}
								placeholder='Modifier'
								value={row.name}
								outlineColor='transparent'
								activeOutlineColor='transparent'
								cursorColor={cursorIndicatorColor}
								selectionColor={cursorIndicatorColor}
								maxLength={MODIFIER_NAME_CHAR_LIMIT}
								multiline={false}
								numberOfLines={1}
								scrollEnabled={false}
								blurOnSubmit
								returnKeyType='done'
								lineBreakStrategyIOS='none'
								textBreakStrategy='simple'
								editable={!isReadOnly}
								height={56}
								style={[styles.modifierInput, styles.optionNameInput]}
								contentStyle={[styles.optionInputContent, styles.optionNameInputContent]}
								textColor={isNameFocused ? nameTextColor : "transparent"}
								onFocus={() => !isReadOnly && setIsNameFocused(true)}
								onBlur={() => !isReadOnly && setIsNameFocused(false)}
								onChangeText={(value) => onChangeOptionName(rowIndex, value)}
							/>
							{!isNameFocused && row.name.trim().length > 0 ? (
								<View pointerEvents='none' style={styles.optionNameOverlayWrap}>
									<BAIText
										variant='body'
										numberOfLines={1}
										ellipsizeMode='tail'
										style={[styles.optionNameOverlayText, { color: nameTextColor }]}
									>
										{row.name}
									</BAIText>
								</View>
							) : null}
						</View>
					</View>
					<View style={[styles.priceWrap, { width: priceInputWidth }]}>
						<BAITextInput
							label={undefined}
							placeholder={pricePlaceholder}
							value={inputValue}
							outlineColor='transparent'
							activeOutlineColor='transparent'
							cursorColor={cursorIndicatorColor}
							selectionColor={cursorIndicatorColor}
							keyboardType='number-pad'
							multiline={false}
							numberOfLines={1}
							height={56}
							style={styles.modifierInput}
							contentStyle={styles.priceInputContent}
							maxLength={maxPriceInputLength}
							editable={!isReadOnly}
							onChangeText={onPriceChange}
							onFocus={onPriceFocus}
							onBlur={onPriceBlur}
						/>
					</View>
				</Animated.View>
				{showDeleteControl && isDeleteRevealed ? (
					<Animated.View
						style={[
							styles.deleteActionWrap,
							{
								transform: [{ translateX: deleteActionTranslateX }],
								opacity: deleteActionOpacity,
							},
						]}
					>
						<Pressable
							onPress={() => onActionOption(row)}
							style={[styles.deleteActionBtn, { backgroundColor: actionColor }]}
						>
							<BAIText variant='subtitle' style={{ color: onActionColor }}>
								{actionLabel}
							</BAIText>
						</Pressable>
					</Animated.View>
				) : null}
			</View>
		</View>
	);
});

export function ModifierGroupUpsertScreen({ mode, intent }: Props) {
	const router = useRouter();
	const tabBarHeight = useBottomTabBarHeight();
	const theme = useTheme();
	const { currencyCode, countryCode } = useActiveBusinessMeta();
	const params = useLocalSearchParams<{ id?: string; returnTo?: string } & ModifierPickerInboundParams>();
	const groupId = String(params.id ?? "").trim();
	const exitReturnTo = String(params.returnTo ?? "").trim();
	const returnSelection = useMemo(() => parseModifierSelectionParams(params), [params]);
	const returnDraftId = useMemo(
		() => returnSelection.draftId || String(params[PICKER_DRAFT_ID_KEY] ?? "").trim(),
		[params, returnSelection.draftId],
	);
	const normalizedGroupId = intent === "edit" ? groupId : "";
	const draftId = useMemo(
		() => buildModifierGroupDraftId(mode, intent, normalizedGroupId),
		[intent, mode, normalizedGroupId],
	);
	const { withBusy } = useAppBusy();
	const { showSuccess } = useAppToast();
	const queryClient = useQueryClient();

	const [name, setName] = useState("");
	const [selectionType, setSelectionType] = useState<ModifierSelectionType>("MULTI");
	const [isRequired, setIsRequired] = useState(false);
	const [minSelected, setMinSelected] = useState("0");
	const [maxSelected, setMaxSelected] = useState("1");
	const [showSelectionRules, setShowSelectionRules] = useState(false);
	const [options, setOptions] = useState<ModifierOptionDraft[]>([makeEmptyOptionDraft()]);
	const [appliedProductIds, setAppliedProductIds] = useState<string[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [initialized, setInitialized] = useState(false);
	const [hydratedFromServer, setHydratedFromServer] = useState(intent === "create");
	const [confirmExitOpen, setConfirmExitOpen] = useState(false);
	const [confirmArchiveOpen, setConfirmArchiveOpen] = useState(false);
	const [sharedAvailabilityOpen, setSharedAvailabilityOpen] = useState(false);
	const [sharedAvailability, setSharedAvailability] = useState<SharedModifierAvailabilityPreview | null>(null);
	const [sharedAvailabilitySelectedGroupIds, setSharedAvailabilitySelectedGroupIds] = useState<string[]>([]);
	const [sharedAvailabilityRowKey, setSharedAvailabilityRowKey] = useState<string>("");
	const [sharedAvailabilityOptionId, setSharedAvailabilityOptionId] = useState<string>("");
	const [sharedAvailabilityNextIsSoldOut] = useState<boolean>(false);
	const [deleteRevealKey, setDeleteRevealKey] = useState<string | null>(null);
	const [deleteControlVisibleKeys, setDeleteControlVisibleKeys] = useState<Set<string>>(() => new Set());
	const [modifiersListHeight, setModifiersListHeight] = useState(0);
	const [optionsTab, setOptionsTab] = useState<ModifierOptionsTab>("active");
	const [initialSnapshot, setInitialSnapshot] = useState<string | null>(null);
	const deleteAnimationTokenRef = useRef(0);
	const deleteActionTranslateX = useRef(new Animated.Value(DELETE_ACTION_WIDTH)).current;
	const deleteActionOpacity = useRef(new Animated.Value(0)).current;
	const deleteIconRotation = useRef(new Animated.Value(0)).current;
	const optionMainInsetRight = useRef(new Animated.Value(0)).current;

	const backRoute = "/(app)/(tabs)/inventory/modifiers";
	const outline = theme.colors.outlineVariant ?? theme.colors.outline;
	const surfaceInteractive = useMemo(
		() => ({
			borderColor: outline,
			backgroundColor: theme.colors.surface,
		}),
		[outline, theme.colors.surface],
	);

	useEffect(() => {
		if (initialized) return;
		const existingDraft = getModifierGroupDraft(draftId);
		const seed = existingDraft ?? createModifierGroupDraft(draftId, mode, intent, normalizedGroupId);

		setName(clampFieldValue(seed.name, MODIFIER_SET_NAME_CHAR_LIMIT));
		setSelectionType(seed.selectionType);
		setIsRequired(seed.isRequired);
		setMinSelected(seed.minSelected);
		setMaxSelected(seed.maxSelected);
		const seededOptions =
			seed.options.length > 0
				? seed.options.map((option) => ({
						...option,
						name: clampFieldValue(option.name, MODIFIER_NAME_CHAR_LIMIT),
					}))
				: [makeEmptyOptionDraft()];
		setOptions(ensureTrailingPlaceholderOption(seededOptions));
		setShowSelectionRules(seed.minSelected !== "0" || seed.maxSelected !== "1");
		setAppliedProductIds(Array.isArray(seed.appliedProductIds) ? seed.appliedProductIds : []);
		setHydratedFromServer(seed.hydratedFromServer);

		if (seed.hydratedFromServer) {
			setInitialSnapshot(
				buildSnapshot({
					name: seed.name,
					selectionType: seed.selectionType,
					isRequired: seed.isRequired,
					minSelected: seed.minSelected,
					maxSelected: seed.maxSelected,
					options: seed.options,
					appliedProductIds: seed.appliedProductIds,
				}),
			);
		}

		setInitialized(true);
	}, [draftId, initialized, intent, mode, normalizedGroupId]);

	useEffect(() => {
		if (!initialized) return;
		upsertModifierGroupDraft(draftId, {
			name,
			selectionType,
			isRequired,
			minSelected,
			maxSelected,
			options,
			appliedProductIds,
			hydratedFromServer,
		});
	}, [
		appliedProductIds,
		draftId,
		hydratedFromServer,
		initialized,
		isRequired,
		maxSelected,
		minSelected,
		name,
		options,
		selectionType,
	]);

	useEffect(() => {
		if (!initialized) return;
		return subscribeModifierGroupDraft(draftId, (latestDraft) => {
			if (!latestDraft) return;
			setAppliedProductIds(Array.isArray(latestDraft.appliedProductIds) ? latestDraft.appliedProductIds : []);
		});
	}, [draftId, initialized]);

	useEffect(() => {
		setDeleteControlVisibleKeys((prev) => {
			const activeOptions = options.filter((option) => !option.removed);
			const next = new Set<string>();
			for (const option of activeOptions) {
				if (prev.has(option.key) || hasModifierOptionInput(option)) {
					next.add(option.key);
				}
			}
			const prevSignature = Array.from(prev).sort().join("|");
			const nextSignature = Array.from(next).sort().join("|");
			if (prevSignature === nextSignature) return prev;
			return next;
		});
	}, [options]);

	useEffect(() => {
		if (!initialized || intent !== "edit" || !groupId || hydratedFromServer) return;
		withBusy("Loading modifier set...", async () => {
			try {
				const group = await modifiersApi.getGroup(groupId);
				const hydratedOptions = group.options.map((option) => ({
					key: makeOptionKey(),
					id: option.id,
					name: clampFieldValue(option.name, MODIFIER_NAME_CHAR_LIMIT),
					deltaMinor: parseMinorUnits(option.priceDeltaMinor),
					isSoldOut: option.isSoldOut,
					removed: option.isArchived,
				}));
				setName(clampFieldValue(group.name, MODIFIER_SET_NAME_CHAR_LIMIT));
				setSelectionType(group.selectionType);
				setIsRequired(group.isRequired);
				setMinSelected(String(group.minSelected));
				setMaxSelected(String(group.maxSelected));
				setShowSelectionRules(String(group.minSelected) !== "0" || String(group.maxSelected) !== "1");
				setOptions(ensureTrailingPlaceholderOption(hydratedOptions));
				setAppliedProductIds([]);
				setHydratedFromServer(true);

				const snapshot = buildSnapshot({
					name: clampFieldValue(group.name, MODIFIER_SET_NAME_CHAR_LIMIT),
					selectionType: group.selectionType,
					isRequired: group.isRequired,
					minSelected: String(group.minSelected),
					maxSelected: String(group.maxSelected),
					options: hydratedOptions,
					appliedProductIds: [],
				});
				setInitialSnapshot(snapshot);

				upsertModifierGroupDraft(draftId, {
					name: clampFieldValue(group.name, MODIFIER_SET_NAME_CHAR_LIMIT),
					selectionType: group.selectionType,
					isRequired: group.isRequired,
					minSelected: String(group.minSelected),
					maxSelected: String(group.maxSelected),
					options: hydratedOptions,
					appliedProductIds: [],
					hydratedFromServer: true,
				});
			} catch (e: any) {
				setError(e?.response?.data?.error?.message ?? e?.response?.data?.message ?? "Could not load modifier set.");
			}
		});
	}, [draftId, groupId, hydratedFromServer, initialized, intent, withBusy]);

	const resolveExitRoute = useCallback(() => {
		if (intent === "edit" && groupId) return `${backRoute}/${encodeURIComponent(groupId)}`;
		return backRoute;
	}, [backRoute, groupId, intent]);

	const performExit = useCallback(() => {
		setConfirmExitOpen(false);
		clearModifierGroupDraft(draftId);
		runGovernedProcessExit(exitReturnTo || undefined, resolveExitRoute(), { router: router as any });
	}, [draftId, exitReturnTo, resolveExitRoute, router]);

	const onResumeEditing = useCallback(() => {
		setConfirmExitOpen(false);
	}, []);

	const currentSnapshot = useMemo(
		() =>
			buildSnapshot({
				name,
				selectionType,
				isRequired,
				minSelected,
				maxSelected,
				options,
				appliedProductIds,
			}),
		[appliedProductIds, isRequired, maxSelected, minSelected, name, options, selectionType],
	);

	const hasUnsavedChanges = useMemo(() => {
		if (!initialized) return false;
		const baseline =
			initialSnapshot ??
			buildSnapshot({
				name: "",
				selectionType: "MULTI",
				isRequired: false,
				minSelected: "0",
				maxSelected: "1",
				options: [{ key: "base", name: "", deltaMinor: 0, isSoldOut: false }],
				appliedProductIds: [],
			});
		return baseline !== currentSnapshot;
	}, [currentSnapshot, initialSnapshot, initialized]);

	const onExit = useCallback(() => {
		Keyboard.dismiss();
		if (hasUnsavedChanges) {
			setConfirmExitOpen(true);
			return;
		}
		performExit();
	}, [hasUnsavedChanges, performExit]);

	const guardedExit = useProcessExitGuard(onExit);

	const openArchiveConfirm = useCallback(() => {
		Keyboard.dismiss();
		setConfirmArchiveOpen(true);
	}, []);

	const closeArchiveConfirm = useCallback(() => {
		setConfirmArchiveOpen(false);
	}, []);

	const headerTitle = intent === "create" ? "Create Modifier Set" : "Edit Modifier";

	const applySetCount = appliedProductIds.length;
	const applySetCountLabel = useMemo(
		() => formatCompactNumber(applySetCount, countryCode),
		[applySetCount, countryCode],
	);
	const rulesSummary = `Min ${minSelected || "0"} · Max ${maxSelected || "1"}`;
	const applySetRoute = "/(app)/(tabs)/inventory/modifiers/apply-set";

	const onPressApplySet = useCallback(() => {
		router.push({
			pathname: applySetRoute as any,
			params: { draftId } as any,
		});
	}, [applySetRoute, draftId, router]);

	const onToggleSelectionRules = useCallback(() => {
		setShowSelectionRules((prev) => !prev);
	}, []);

	const formatPriceDisplay = useMemo(() => {
		const code =
			String(currencyCode ?? "PHP")
				.trim()
				.toUpperCase() || "PHP";
		const locale = getBusinessLocale(countryCode);
		let formatter: Intl.NumberFormat | null = null;

		try {
			if (typeof Intl !== "undefined" && typeof Intl.NumberFormat === "function") {
				formatter = new Intl.NumberFormat(locale, {
					style: "currency",
					currency: code,
					currencyDisplay: "symbol",
					minimumFractionDigits: MONEY_INPUT_PRECISION,
					maximumFractionDigits: MONEY_INPUT_PRECISION,
				});
			}
		} catch {
			formatter = null;
		}

		return (minorUnits: number) => {
			const safeMinor = toSafeMinor(minorUnits);
			const major = safeMinor / 10 ** MONEY_INPUT_PRECISION;
			if (formatter) return formatter.format(major);
			return `${code} ${major.toFixed(MONEY_INPUT_PRECISION)}`;
		};
	}, [countryCode, currencyCode]);
	const maxPriceInputLength = useMemo(
		() =>
			formatPriceDisplay(digitsToMinorUnits("9".repeat(PRICE_INPUT_MAX_MINOR_DIGITS), PRICE_INPUT_MAX_MINOR_DIGITS))
				.length,
		[formatPriceDisplay],
	);
	const pricePlaceholder = useMemo(() => formatPriceDisplay(0), [formatPriceDisplay]);

	const activeOptions = useMemo(() => options.filter((opt) => !opt.removed), [options]);
	const archivedOptions = useMemo(() => options.filter((opt) => opt.removed && opt.id), [options]);
	const activeTabCount = useMemo(
		() => activeOptions.filter((row) => hasModifierOptionInput(row)).length,
		[activeOptions],
	);
	const optionTabs = useMemo<readonly BAIGroupTab<ModifierOptionsTab>[]>(
		() => [
			{ label: "Active", value: "active", count: activeTabCount },
			{ label: "Archived", value: "archived", count: archivedOptions.length },
		],
		[activeTabCount, archivedOptions.length],
	);
	const sharedAvailabilityGroupCountLabel = useMemo(
		() => formatCompactNumber(sharedAvailability?.groups.length ?? 0, countryCode),
		[countryCode, sharedAvailability?.groups.length],
	);
	const visibleOptionRows = useMemo(
		() =>
			options
				.map((row, index) => ({ row, index }))
				.filter((entry) =>
					optionsTab === "archived" ? Boolean(entry.row.removed && entry.row.id) : !entry.row.removed,
				),
		[options, optionsTab],
	);
	const filledOptions = useMemo(() => activeOptions.filter((row) => row.name.trim().length > 0), [activeOptions]);
	const isSaveDisabled = useMemo(() => {
		const trimmedName = name.trim();
		if (!trimmedName) return true;
		if (filledOptions.length === 0) return true;

		const parsedMin = Number.parseInt(minSelected || "0", 10);
		const parsedMax = Number.parseInt(maxSelected || "0", 10);
		if (!Number.isFinite(parsedMin) || !Number.isFinite(parsedMax)) return true;
		if (parsedMin < 0 || parsedMax < 0) return true;
		if (parsedMin > parsedMax) return true;
		if (intent === "edit" && !hasUnsavedChanges) return true;

		return false;
	}, [filledOptions.length, hasUnsavedChanges, intent, maxSelected, minSelected, name]);

	const onChangeOptionName = useCallback((rowIndex: number, value: string) => {
		const cappedValue = clampFieldValue(value, MODIFIER_NAME_CHAR_LIMIT);
		setOptions((prev) => {
			const row = prev[rowIndex];
			if (!row || row.name === cappedValue) return prev;
			const next = [...prev];
			next[rowIndex] = { ...row, name: cappedValue };
			return ensureTrailingPlaceholderOption(next);
		});
	}, []);

	const removeDraftOptionLocally = useCallback((rowKey: string) => {
		setOptions((prev) => ensureTrailingPlaceholderOption(prev.filter((opt) => opt.key !== rowKey)));
	}, []);

	const resetDeleteRevealAnimationValues = useCallback(() => {
		deleteActionTranslateX.setValue(DELETE_ACTION_WIDTH);
		deleteActionOpacity.setValue(0);
		deleteIconRotation.setValue(0);
		optionMainInsetRight.setValue(0);
	}, [deleteActionOpacity, deleteActionTranslateX, deleteIconRotation, optionMainInsetRight]);

	const runDeleteActionAnimation = useCallback(
		(open: boolean, onDone?: () => void) => {
			const token = deleteAnimationTokenRef.current + 1;
			deleteAnimationTokenRef.current = token;
			const duration = open ? DELETE_OPEN_DURATION_MS : DELETE_CLOSE_DURATION_MS;
			Animated.parallel([
				Animated.timing(optionMainInsetRight, {
					toValue: open ? DELETE_REVEAL_INSET : 0,
					duration,
					easing: Easing.out(Easing.cubic),
					useNativeDriver: false,
				}),
				Animated.timing(deleteActionTranslateX, {
					toValue: open ? 0 : DELETE_ACTION_WIDTH,
					duration,
					easing: Easing.out(Easing.cubic),
					useNativeDriver: true,
				}),
				Animated.timing(deleteActionOpacity, {
					toValue: open ? 1 : 0,
					duration,
					easing: Easing.out(Easing.cubic),
					useNativeDriver: true,
				}),
				Animated.timing(deleteIconRotation, {
					toValue: open ? 1 : 0,
					duration,
					easing: Easing.out(Easing.cubic),
					useNativeDriver: true,
				}),
			]).start(() => {
				if (deleteAnimationTokenRef.current !== token) return;
				onDone?.();
			});
		},
		[deleteActionOpacity, deleteActionTranslateX, deleteIconRotation, optionMainInsetRight],
	);

	const closeDeleteReveal = useCallback(
		(onClosed?: () => void) => {
			if (!deleteRevealKey) {
				onClosed?.();
				return;
			}
			runDeleteActionAnimation(false, () => {
				resetDeleteRevealAnimationValues();
				setDeleteRevealKey(null);
				onClosed?.();
			});
		},
		[deleteRevealKey, resetDeleteRevealAnimationValues, runDeleteActionAnimation],
	);

	useEffect(() => {
		closeDeleteReveal();
	}, [closeDeleteReveal, optionsTab]);

	const dismissKeyboard = useCallback(() => {
		Keyboard.dismiss();
		closeDeleteReveal();
	}, [closeDeleteReveal]);

	const onChangePriceMinor = useCallback((rowIndex: number, nextMinor: number) => {
		setOptions((prev) => {
			const row = prev[rowIndex];
			if (!row) return prev;

			const currentMinor = toSafeMinor(row.deltaMinor);
			if (nextMinor === currentMinor) {
				return prev;
			}

			const next = [...prev];
			next[rowIndex] = { ...row, deltaMinor: nextMinor };
			return ensureTrailingPlaceholderOption(next);
		});
	}, []);

	const setRowSoldOutByKey = useCallback((rowKey: string, nextIsSoldOut: boolean) => {
		setOptions((prev) => {
			const rowIndex = prev.findIndex((row) => row.key === rowKey);
			if (rowIndex < 0) return prev;
			const row = prev[rowIndex];
			if (row.isSoldOut === nextIsSoldOut) return prev;
			const next = [...prev];
			next[rowIndex] = { ...row, isSoldOut: nextIsSoldOut };
			return next;
		});
	}, []);

	const closeSharedAvailability = useCallback(() => {
		setSharedAvailabilityOpen(false);
		setSharedAvailability(null);
		setSharedAvailabilitySelectedGroupIds([]);
		setSharedAvailabilityRowKey("");
		setSharedAvailabilityOptionId("");
	}, []);

	const onToggleSharedGroupSelection = useCallback((modifierGroupId: string) => {
		setSharedAvailabilitySelectedGroupIds((prev) =>
			prev.includes(modifierGroupId) ? prev.filter((entry) => entry !== modifierGroupId) : [...prev, modifierGroupId],
		);
	}, []);

	const onApplySharedAvailability = useCallback(() => {
		if (!sharedAvailabilityOptionId || sharedAvailabilitySelectedGroupIds.length === 0) return;
		const optionId = sharedAvailabilityOptionId;
		const modifierGroupIds = [...sharedAvailabilitySelectedGroupIds];
		const nextIsSoldOut = sharedAvailabilityNextIsSoldOut;
		const rowKey = sharedAvailabilityRowKey;

		closeSharedAvailability();
		InteractionManager.runAfterInteractions(() => {
			withBusy("Updating modifiers...", async () => {
				await modifiersApi.applySharedAvailability(optionId, {
					isSoldOut: nextIsSoldOut,
					modifierGroupIds,
				});
				if (rowKey) {
					setRowSoldOutByKey(rowKey, nextIsSoldOut);
				}
				showSuccess(`This modifier has been marked as ${nextIsSoldOut ? "sold out" : "available"}`);
			});
		});
	}, [
		closeSharedAvailability,
		setRowSoldOutByKey,
		sharedAvailabilityNextIsSoldOut,
		sharedAvailabilityOptionId,
		sharedAvailabilityRowKey,
		sharedAvailabilitySelectedGroupIds,
		showSuccess,
		withBusy,
	]);

	const onToggleDeleteReveal = useCallback(
		(rowKey: string) => {
			if (deleteRevealKey === rowKey) {
				closeDeleteReveal();
				return;
			}

			if (deleteRevealKey) {
				closeDeleteReveal(() => {
					setDeleteRevealKey(rowKey);
					requestAnimationFrame(() => runDeleteActionAnimation(true));
				});
				return;
			}

			resetDeleteRevealAnimationValues();
			setDeleteRevealKey(rowKey);
			requestAnimationFrame(() => runDeleteActionAnimation(true));
		},
		[closeDeleteReveal, deleteRevealKey, resetDeleteRevealAnimationValues, runDeleteActionAnimation],
	);

	const onArchiveOption = useCallback(
		(row: ModifierOptionDraft) => {
			setError(null);
			resetDeleteRevealAnimationValues();
			setDeleteRevealKey(null);

			if (!row.id) {
				removeDraftOptionLocally(row.key);
				return;
			}

			withBusy("Archiving modifier...", async () => {
				try {
					await modifiersApi.archiveOption(row.id!);
					setOptions((prev) =>
						ensureTrailingPlaceholderOption(prev.map((opt) => (opt.key === row.key ? { ...opt, removed: true } : opt))),
					);
					await queryClient.invalidateQueries({ queryKey: ["modifiers"] });
				} catch (e: any) {
					setError(
						e?.response?.data?.error?.message ?? e?.response?.data?.message ?? "Could not archive modifier option.",
					);
				}
			});
		},
		[queryClient, removeDraftOptionLocally, resetDeleteRevealAnimationValues, withBusy],
	);

	const onRestoreOption = useCallback(
		(row: ModifierOptionDraft) => {
			if (!row.id) return;
			setError(null);
			resetDeleteRevealAnimationValues();
			setDeleteRevealKey(null);

			withBusy("Restoring modifier...", async () => {
				try {
					await modifiersApi.restoreOption(row.id!);
					setOptions((prev) =>
						ensureTrailingPlaceholderOption(
							prev.map((opt) => (opt.key === row.key ? { ...opt, removed: false } : opt)),
						),
					);
					await queryClient.invalidateQueries({ queryKey: ["modifiers"] });
				} catch (e: any) {
					setError(
						e?.response?.data?.error?.message ?? e?.response?.data?.message ?? "Could not restore modifier option.",
					);
				}
			});
		},
		[queryClient, resetDeleteRevealAnimationValues, withBusy],
	);

	const deleteIconRotate = useMemo(
		() =>
			deleteIconRotation.interpolate({
				inputRange: [0, 1],
				outputRange: ["0deg", "90deg"],
			}),
		[deleteIconRotation],
	);

	const shouldShowDeleteControl = useCallback(
		(row: ModifierOptionDraft) => deleteControlVisibleKeys.has(row.key) || hasModifierOptionInput(row),
		[deleteControlVisibleKeys],
	);

	const onSave = useCallback(() => {
		const trimmedName = clampFieldValue(name.trim(), MODIFIER_SET_NAME_CHAR_LIMIT);
		if (!trimmedName) {
			setError("Modifier set name is required.");
			return;
		}
		if (filledOptions.length === 0) {
			setError("Add at least one modifier option.");
			return;
		}
		const parsedMin = Number.parseInt(minSelected || "0", 10);
		const parsedMax = Number.parseInt(maxSelected || "0", 10);
		if (
			!Number.isFinite(parsedMin) ||
			!Number.isFinite(parsedMax) ||
			parsedMin < 0 ||
			parsedMax < 0 ||
			parsedMin > parsedMax
		) {
			setError("Invalid min/max selection rules.");
			return;
		}
		setError(null);

		withBusy("Saving modifier set...", async () => {
			try {
				let targetGroupId = groupId;
				if (intent === "create") {
					const created = await modifiersApi.createGroup({
						name: trimmedName,
						selectionType,
						isRequired,
						minSelected: parsedMin,
						maxSelected: parsedMax,
					});
					targetGroupId = created.id;
				} else {
					await modifiersApi.updateGroup(targetGroupId, {
						name: trimmedName,
						selectionType,
						isRequired,
						minSelected: parsedMin,
						maxSelected: parsedMax,
					});
				}
				let sortOrder = 0;
				for (let idx = 0; idx < options.length; idx += 1) {
					const row = options[idx];
					if (row.removed) {
						if (row.id) await modifiersApi.archiveOption(row.id);
						continue;
					}
					if (!row.name.trim()) {
						continue;
					}
					const priceDeltaMinor = String(Math.max(0, Math.trunc(row.deltaMinor || 0)));
					if (row.id) {
						await modifiersApi.updateOption(row.id, {
							name: row.name.trim(),
							priceDeltaMinor,
							isSoldOut: row.isSoldOut,
							sortOrder,
						});
					} else {
						await modifiersApi.createOption(targetGroupId, {
							name: row.name.trim(),
							priceDeltaMinor,
							sortOrder,
						});
					}
					sortOrder += 1;
				}

				const selectedProductIds = Array.from(
					new Set(appliedProductIds.map((value) => String(value ?? "").trim()).filter((value) => value.length > 0)),
				);

				if (targetGroupId) {
					await modifiersApi.syncModifierGroupProducts({
						modifierGroupId: targetGroupId,
						selectedProductIds,
					});
				}

				await queryClient.invalidateQueries({ queryKey: ["modifiers"] });
				clearModifierGroupDraft(draftId);

				if (intent === "create" && exitReturnTo && targetGroupId) {
					router.replace({
						pathname: exitReturnTo as any,
						params: buildModifierSelectionParams({
							selectedModifierGroupIds: [...returnSelection.selectedModifierGroupIds, targetGroupId],
							selectionSource: "created",
							draftId: returnDraftId || undefined,
						}),
					} as any);
					return;
				}

				router.replace((exitReturnTo || backRoute) as any);
			} catch (e: any) {
				setError(e?.response?.data?.error?.message ?? e?.response?.data?.message ?? "Could not save modifier set.");
			}
		});
	}, [
		appliedProductIds,
		backRoute,
		draftId,
		filledOptions,
		groupId,
		intent,
		isRequired,
		maxSelected,
		minSelected,
		name,
		options,
		queryClient,
		router,
		exitReturnTo,
		returnDraftId,
		returnSelection.selectedModifierGroupIds,
		selectionType,
		withBusy,
	]);

	const onConfirmArchive = useCallback(() => {
		if (intent !== "edit" || !groupId) return;
		setError(null);
		withBusy("Archiving modifier set...", async () => {
			try {
				await modifiersApi.archiveGroup(groupId);
				await queryClient.invalidateQueries({ queryKey: ["modifiers"] });
				showSuccess("Modifier set archived.");
				setConfirmArchiveOpen(false);
				clearModifierGroupDraft(draftId);
				router.replace(backRoute as any);
			} catch (e: any) {
				setError(e?.response?.data?.error?.message ?? e?.response?.data?.message ?? "Could not archive modifier set.");
			}
		});
	}, [backRoute, draftId, groupId, intent, queryClient, router, showSuccess, withBusy]);

	return (
		<>
			<Stack.Screen options={{ headerShown: false }} />
			<BAIScreen tabbed padded={false} safeTop={false} safeBottom={false} style={styles.root}>
				<BAIHeader
					title={headerTitle}
					titleHorizontalPadding={30}
					variant='exit'
					onLeftPress={guardedExit}
					onRightPress={onSave}
					rightDisabled={isSaveDisabled}
					rightSlot={({ disabled }) => (
						<View
							style={[
								styles.headerSavePill,
								{ backgroundColor: disabled ? theme.colors.surfaceDisabled : theme.colors.primary },
							]}
						>
							<BAIText
								variant='body'
								style={{
									color: disabled ? theme.colors.onSurfaceDisabled : theme.colors.onPrimary,
									fontSize: 16,
									fontWeight: "600",
								}}
							>
								Save
							</BAIText>
						</View>
					)}
				/>
				<TouchableWithoutFeedback onPress={dismissKeyboard} accessible={false}>
					<View style={[styles.wrap, { paddingBottom: tabBarHeight + 8 }]}>
						<View style={styles.contentWrap}>
							<BAISurface bordered padded={false} style={[styles.card, surfaceInteractive]}>
								<View style={styles.content}>
									<View style={styles.modifierSetConfigContainer}>
										<View style={styles.setNameInputWrap}>
											<BAITextInput
												label='Modifier Set Name'
												value={name}
												onChangeText={(value) => setName(clampFieldValue(value, MODIFIER_SET_NAME_CHAR_LIMIT))}
												maxLength={MODIFIER_SET_NAME_CHAR_LIMIT}
												placeholder='Modifier Set Name'
												height={56}
												multiline={false}
												numberOfLines={1}
												scrollEnabled={false}
												lineBreakStrategyIOS='none'
												textBreakStrategy='simple'
												contentStyle={styles.setNameInputContent}
												textColor={theme.colors.onSurface}
											/>
										</View>
										<Pressable
											onPress={onPressApplySet}
											style={({ pressed }) => [
												styles.applySetRow,
												{ borderColor: theme.colors.outlineVariant ?? theme.colors.outline },
												pressed ? { opacity: 0.86 } : null,
											]}
										>
											<BAIText variant='subtitle'>Apply Set</BAIText>
											<View style={styles.applySetRight}>
												<BAIText variant='subtitle'>{applySetCountLabel}</BAIText>
												<MaterialCommunityIcons
													name='chevron-right'
													size={24}
													color={theme.colors.onSurfaceVariant ?? theme.colors.onSurface}
												/>
											</View>
										</Pressable>
										<View
											style={[
												styles.advancedRulesContainer,
												{ borderColor: theme.colors.outlineVariant ?? theme.colors.outline },
											]}
										>
											<Pressable
												onPress={onToggleSelectionRules}
												style={({ pressed }) => [styles.advancedRulesRow, pressed ? { opacity: 0.86 } : null]}
											>
												<View style={styles.advancedRulesLabelWrap}>
													<BAIText variant='body'>Advanced rules</BAIText>
													<BAIText variant='caption' muted>
														{rulesSummary}
													</BAIText>
												</View>
												<MaterialCommunityIcons
													name={showSelectionRules ? "chevron-up" : "chevron-down"}
													size={24}
													color={theme.colors.onSurfaceVariant ?? theme.colors.onSurface}
												/>
											</Pressable>
											{showSelectionRules ? (
												<View style={styles.rulesRow}>
													<BAITextInput
														label='Minimum Selections'
														value={minSelected}
														onChangeText={(value) => setMinSelected(value.replace(/[^0-9]/g, ""))}
														keyboardType='number-pad'
														style={styles.ruleInput}
													/>
													<BAITextInput
														label='Maximum Selections'
														value={maxSelected}
														onChangeText={(value) => setMaxSelected(value.replace(/[^0-9]/g, ""))}
														keyboardType='number-pad'
														style={styles.ruleInput}
													/>
												</View>
											) : null}
										</View>
									</View>
									<View style={styles.modifiersSection}>
										<BAIText variant='subtitle' style={styles.modifiersTitle}>
											Modifiers
										</BAIText>
										{intent === "edit" ? (
											<View style={styles.optionTabsWrap}>
												<BAIGroupTabs<ModifierOptionsTab>
													tabs={optionTabs}
													value={optionsTab}
													onChange={setOptionsTab}
													countFormatter={(count) => formatCompactNumber(count, countryCode)}
												/>
											</View>
										) : null}
										<ScrollView
											style={styles.modifiersList}
											contentContainerStyle={[
												styles.modifiersListContent,
												{
													borderTopWidth: StyleSheet.hairlineWidth,
													borderTopColor: theme.colors.outlineVariant ?? theme.colors.outline,
												},
												{ paddingBottom: Math.max(0, modifiersListHeight * 0.75) },
											]}
											onLayout={(event) => setModifiersListHeight(event.nativeEvent.layout.height)}
											nestedScrollEnabled
											showsVerticalScrollIndicator={false}
											keyboardShouldPersistTaps='handled'
											keyboardDismissMode='on-drag'
										>
											{visibleOptionRows.map(({ row, index }) => {
												const showDeleteControl = shouldShowDeleteControl(row);
												const isArchivedTab = optionsTab === "archived";
												return (
													<ModifierOptionRow
														key={row.key}
														row={row}
														rowIndex={index}
														borderBottomColor={theme.colors.outlineVariant ?? theme.colors.outline}
														nameTextColor={theme.colors.onSurface}
														cursorIndicatorColor={theme.colors.primary}
														showDeleteControl={showDeleteControl}
														actionColor={isArchivedTab ? theme.colors.primary : theme.colors.error}
														onActionColor={isArchivedTab ? theme.colors.onPrimary : theme.colors.onError}
														actionLabel={isArchivedTab ? "Restore" : row.id ? "Archive" : "Delete"}
														isReadOnly={isArchivedTab}
														isDeleteRevealed={showDeleteControl && deleteRevealKey === row.key}
														deleteIconRotate={deleteIconRotate}
														deleteActionTranslateX={deleteActionTranslateX}
														deleteActionOpacity={deleteActionOpacity}
														optionMainInsetRight={optionMainInsetRight}
														maxPriceInputLength={maxPriceInputLength}
														pricePlaceholder={pricePlaceholder}
														formatPriceDisplay={formatPriceDisplay}
														onToggleDeleteReveal={onToggleDeleteReveal}
														onActionOption={isArchivedTab ? onRestoreOption : onArchiveOption}
														onChangeOptionName={onChangeOptionName}
														onChangePriceMinor={onChangePriceMinor}
													/>
												);
											})}
											{intent === "edit" && groupId ? (
												<Pressable
													onPress={openArchiveConfirm}
													style={({ pressed }) => [
														styles.archiveButton,
														{
															borderColor: theme.colors.outlineVariant ?? theme.colors.outline,
															backgroundColor: theme.dark
																? (theme.colors.surfaceVariant ?? theme.colors.surfaceDisabled ?? theme.colors.surface)
																: (theme.colors.surfaceDisabled ?? theme.colors.surfaceVariant ?? theme.colors.surface),
														},
														pressed ? { opacity: 0.86 } : null,
													]}
												>
													<BAIText
														variant='subtitle'
														style={[styles.archiveButtonText, { color: theme.colors.onSurface }]}
													>
														Archive Modifier Set
													</BAIText>
												</Pressable>
											) : null}
										</ScrollView>
									</View>
									{error ? (
										<BAIText variant='caption' style={{ color: theme.colors.error }}>
											{error}
										</BAIText>
									) : null}
								</View>
							</BAISurface>
						</View>
					</View>
				</TouchableWithoutFeedback>
			</BAIScreen>
			<Modal visible={sharedAvailabilityOpen} transparent animationType='slide' onRequestClose={() => {}}>
				<View style={styles.sheetBackdrop}>
					<View style={StyleSheet.absoluteFill} />
					<BAISurface style={[styles.sheet, { backgroundColor: theme.colors.surface }]} bordered radius={16}>
						<View style={styles.sheetHeaderRow}>
							<Pressable
								onPress={closeSharedAvailability}
								style={[
									styles.sheetCloseBtn,
									{
										backgroundColor:
											theme.colors.surfaceDisabled ?? theme.colors.surfaceVariant ?? theme.colors.surface,
										borderWidth: StyleSheet.hairlineWidth,
										borderColor: theme.colors.outlineVariant ?? theme.colors.outline,
									},
								]}
							>
								<MaterialCommunityIcons
									name='close'
									size={24}
									color={theme.colors.onSurfaceVariant ?? theme.colors.onSurface}
								/>
							</Pressable>
							<BAIButton
								onPress={onApplySharedAvailability}
								disabled={sharedAvailabilitySelectedGroupIds.length === 0}
								shape='pill'
							>
								Apply to all
							</BAIButton>
						</View>

						<BAIText variant='title'>Apply to all at this location</BAIText>
						<BAIText variant='body' muted>
							{`${sharedAvailability?.optionName ?? "This modifier"} is currently ${sharedAvailabilityNextIsSoldOut ? "available" : "sold out"} in ${sharedAvailabilityGroupCountLabel} modifier sets at this location. Do you want to mark them all as ${sharedAvailabilityNextIsSoldOut ? "sold out" : "available"}?`}
						</BAIText>

						<View style={styles.sheetListWrap}>
							<ScrollView keyboardShouldPersistTaps='handled' showsVerticalScrollIndicator={false}>
								{(sharedAvailability?.groups ?? []).map((entry) => {
									const selected = sharedAvailabilitySelectedGroupIds.includes(entry.modifierGroupId);
									return (
										<Pressable
											key={entry.modifierGroupId}
											onPress={() => onToggleSharedGroupSelection(entry.modifierGroupId)}
											style={[
												styles.sheetRow,
												{ borderBottomColor: theme.colors.outlineVariant ?? theme.colors.outline },
											]}
										>
											<BAIText variant='subtitle'>{entry.modifierGroupName}</BAIText>
											<MaterialCommunityIcons
												name={selected ? "checkbox-marked" : "checkbox-blank-outline"}
												size={28}
												color={selected ? theme.colors.primary : theme.colors.onSurfaceVariant}
											/>
										</Pressable>
									);
								})}
							</ScrollView>
						</View>
					</BAISurface>
				</View>
			</Modal>
			<ConfirmActionModal
				visible={confirmArchiveOpen}
				title='Archive Modifier Set'
				message='Archiving will hide this modifier set from active use. You can restore it later from archived modifiers.'
				confirmLabel='Archive'
				cancelLabel='Cancel'
				confirmIntent='error'
				cancelIntent='neutral'
				onDismiss={closeArchiveConfirm}
				onConfirm={onConfirmArchive}
				onCancel={closeArchiveConfirm}
			/>
			<ConfirmActionModal
				visible={confirmExitOpen}
				title='Unsaved changes'
				message='Do you want to resume editing or discard this modifier set?'
				confirmLabel='Resume'
				cancelLabel='Discard'
				confirmIntent='primary'
				cancelIntent='error'
				onDismiss={onResumeEditing}
				onConfirm={onResumeEditing}
				onCancel={performExit}
			/>
		</>
	);
}

const styles = StyleSheet.create({
	root: { flex: 1 },
	wrap: { flex: 1, paddingHorizontal: 10 },
	contentWrap: { flex: 1, width: "100%", maxWidth: 720, alignSelf: "center" },
	card: { flex: 1, borderRadius: 18, paddingTop: 12, paddingHorizontal: 0 },
	content: { flex: 1, gap: 10, paddingBottom: 10 },
	modifierSetConfigContainer: {
		marginHorizontal: 12,
		gap: 10,
	},
	setNameInputWrap: {
		position: "relative",
		overflow: "hidden",
	},
	setNameInputContent: {
		textAlignVertical: "center",
		paddingTop: 0,
		paddingBottom: 0,
		paddingLeft: 12,
		paddingRight: 12,
	},
	applySetRow: {
		minHeight: 50,
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: 12,
		paddingHorizontal: 12,
		paddingVertical: 10,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
	},
	applySetRight: { flexDirection: "row", alignItems: "center", gap: 6 },
	headerSavePill: {
		minWidth: 90,
		height: 40,
		paddingHorizontal: 16,
		borderRadius: 20,
		alignItems: "center",
		justifyContent: "center",
	},
	rulesRow: { flexDirection: "row", gap: 10, paddingTop: 6, paddingBottom: 2 },
	ruleInput: { flex: 1 },
	advancedRulesContainer: {
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: 12,
		paddingHorizontal: 10,
		paddingTop: 4,
		paddingBottom: 8,
	},
	advancedRulesRow: {
		minHeight: 46,
		paddingHorizontal: 0,
		paddingVertical: 2,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
	},
	advancedRulesLabelWrap: {
		flex: 1,
		minWidth: 0,
		gap: 2,
	},
	optionRow: {
		borderBottomWidth: StyleSheet.hairlineWidth,
		minHeight: 56,
		justifyContent: "center",
		paddingVertical: 0,
	},
	modifiersSection: {
		flex: 1,
		minHeight: 0,
		gap: 10,
	},
	modifiersTitle: {
		marginHorizontal: 12,
	},
	optionTabsWrap: {
		marginHorizontal: 12,
	},
	modifiersList: {
		flex: 1,
		minHeight: 0,
	},
	modifiersListContent: {
		gap: 0,
	},
	archiveButton: {
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: 12,
		minHeight: 50,
		alignItems: "center",
		justifyContent: "center",
		paddingHorizontal: 12,
		marginTop: 50,
		marginHorizontal: 12,
	},
	archiveButtonText: {
		fontWeight: "500",
	},
	optionInlineRow: {
		flexDirection: "row",
		minHeight: 56,
		alignItems: "center",
		justifyContent: "center",
		overflow: "hidden",
		gap: 0,
		position: "relative",
	},
	optionMainContent: {
		flex: 1,
		minWidth: 0,
		minHeight: 56,
		flexDirection: "row",
		alignItems: "center",
		gap: 0,
	},
	removeBtnSlot: {
		width: REMOVE_BUTTON_WIDTH,
		height: REMOVE_BUTTON_HEIGHT,
		marginLeft: 0,
		paddingLeft: REMOVE_BUTTON_LEFT_PADDING,
	},
	removeBtn: {
		alignItems: "center",
		justifyContent: "center",
	},
	removeBtnFill: {
		width: 24,
		height: 24,
		borderRadius: 12,
		alignItems: "center",
		justifyContent: "center",
	},
	optionFields: { flex: 1, minWidth: 0, minHeight: 56, overflow: "hidden", justifyContent: "center" },
	modifierInput: {
		minWidth: 0,
		overflow: "hidden",
		backgroundColor: "transparent",
	},
	optionNameInputWrap: {
		position: "relative",
		minHeight: 56,
		justifyContent: "center",
	},
	optionNameInput: {
		flexShrink: 1,
		overflow: "hidden",
	},
	optionInputContent: {
		textAlign: "left",
		textAlignVertical: "center",
		paddingTop: 0,
		paddingBottom: 0,
		paddingHorizontal: 0,
		flexWrap: "nowrap",
		overflow: "hidden",
	},
	optionNameInputContent: {
		maxWidth: "100%",
		overflow: "hidden",
		paddingLeft: 8,
		paddingRight: 0,
	},
	optionNameOverlayWrap: {
		position: "absolute",
		top: 0,
		right: 0,
		bottom: 0,
		left: 0,
		justifyContent: "center",
		paddingLeft: 8,
		paddingRight: 0,
	},
	optionNameOverlayText: {
		includeFontPadding: false,
	},
	priceInputContent: {
		textAlign: "right",
		textAlignVertical: "center",
		paddingTop: 0,
		paddingBottom: 0,
		paddingLeft: 0,
		paddingRight: 8,
		fontVariant: ["tabular-nums"],
		includeFontPadding: false,
	},
	priceWrap: { minWidth: 0, minHeight: 56, justifyContent: "center" },
	deleteActionBtn: {
		width: DELETE_ACTION_WIDTH,
		height: 56,
		borderRadius: 0,
		alignItems: "center",
		justifyContent: "center",
	},
	deleteActionWrap: {
		position: "absolute",
		right: 0,
		top: 0,
		bottom: 0,
		paddingLeft: DELETE_ACTION_GAP,
		justifyContent: "center",
	},
	sheetBackdrop: {
		flex: 1,
		justifyContent: "flex-end",
		backgroundColor: "rgba(0,0,0,0.4)",
	},
	sheet: {
		maxHeight: "80%",
		padding: 16,
		gap: 14,
		marginBottom: 0,
		borderBottomLeftRadius: 0,
		borderBottomRightRadius: 0,
	},
	sheetHeaderRow: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
	},
	sheetCloseBtn: {
		width: 44,
		height: 44,
		borderRadius: 22,
		alignItems: "center",
		justifyContent: "center",
	},
	sheetListWrap: {
		maxHeight: 300,
		borderTopWidth: StyleSheet.hairlineWidth,
		borderTopColor: "transparent",
	},
	sheetRow: {
		minHeight: 58,
		borderBottomWidth: StyleSheet.hairlineWidth,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
	},
});
