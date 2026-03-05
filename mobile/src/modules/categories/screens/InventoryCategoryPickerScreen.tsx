// BizAssist_mobile
// path: app/(app)/(tabs)/inventory/categories/picker.tsx
//
// This is for the picker in the create item flow.
// Refactor: apply Header Navigation Governance to this picker.
// - Category picker is a screen and uses Back (history).
// - No UI layout changes.

import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Keyboard, StyleSheet, TouchableWithoutFeedback, View } from "react-native";
import { useTheme } from "react-native-paper";

import { BAIButton } from "@/components/ui/BAIButton";
import { BAIEmptyStateButton } from "@/components/ui/BAIEmptyStateButton";
import { BAIRetryButton } from "@/components/ui/BAIRetryButton";
import { BAIScreen } from "@/components/ui/BAIScreen";
import { BAISurface } from "@/components/ui/BAISurface";
import { BAISearchBar } from "@/components/ui/BAISearchBar";
import { BAIText } from "@/components/ui/BAIText";

import { useAppBusy } from "@/hooks/useAppBusy";

import { useInventoryHeader } from "@/modules/inventory/useInventoryHeader";
import { useProcessExitGuard } from "@/modules/navigation/useProcessExitGuard";

import { categoriesApi } from "@/modules/categories/categories.api";
import { categoryKeys } from "@/modules/categories/categories.queryKeys";
import type { Category } from "@/modules/categories/categories.types";
import { CategoryRow } from "@/modules/categories/components/CategoryRow";

import { FIELD_LIMITS } from "@/shared/fieldLimits";
import { sanitizeSearchInput } from "@/shared/validation/sanitize";

import {
	CATEGORY_CREATE_ROUTE,
	DRAFT_ID_KEY,
	RETURN_TO_KEY,
	buildCategorySelectionParams,
	buildOpenCategoryCreateParams,
	normalizeReturnTo,
	parseCategorySelectionParams,
	type CategoryPickerInboundParams,
} from "@/modules/categories/categoryPicker.contract";
import type { InventoryRouteScope } from "@/modules/inventory/navigation.scope";

const INVENTORY_CATEGORY_CREATE_ROUTE = "/(app)/(tabs)/inventory/categories/create" as const;

export default function CategoryPickerScreen({ routeScope = "inventory" }: { routeScope?: InventoryRouteScope }) {
	const router = useRouter();
	const theme = useTheme();
	const { busy } = useAppBusy();
	const createCategoryRoute =
		routeScope === "settings-items-services" ? CATEGORY_CREATE_ROUTE : INVENTORY_CATEGORY_CREATE_ROUTE;

	const tabBarHeight = useBottomTabBarHeight();
	const TAB_KISS_GAP = 12;
	const screenBottomPad = tabBarHeight + TAB_KISS_GAP;

	const params = useLocalSearchParams<CategoryPickerInboundParams>();
	const returnTo = useMemo(() => normalizeReturnTo(params[RETURN_TO_KEY]), [params]);
	const isServiceFlow = useMemo(() => (returnTo ?? "").includes("/services/"), [returnTo]);
	const pickerTitle = isServiceFlow ? "Service Categories" : "Item Categories";
	const headerBackTitle = isServiceFlow ? "Create Service" : "Create Item";

	const parsedSelection = useMemo(() => parseCategorySelectionParams(params), [params]);
	const draftId = useMemo(
		() => parsedSelection.draftId || String(params[DRAFT_ID_KEY] ?? "").trim(),
		[parsedSelection.draftId, params],
	);

	const [highlightId, setHighlightId] = useState<string>(() => parsedSelection.selectedCategoryId || "");

	useEffect(() => {
		if (!parsedSelection.hasSelectionKey) return;
		setHighlightId(parsedSelection.selectedCategoryId || "");
	}, [parsedSelection.hasSelectionKey, parsedSelection.selectedCategoryId]);

	const [qText, setQText] = useState("");
	const q = qText.trim();
	const hasSearch = q.length > 0;

	const dismissKeyboard = useCallback(() => Keyboard.dismiss(), []);

	// --- nav lock (mandatory)
	const navLockRef = useRef(false);
	const lockNav = useCallback((ms = 650) => {
		if (navLockRef.current) return false;
		navLockRef.current = true;
		setTimeout(() => (navLockRef.current = false), ms);
		return true;
	}, []);

	const query = useQuery<{ items: Category[] }>({
		queryKey: categoryKeys.picker({ q: q || undefined, includeSelectedCategoryId: highlightId || undefined }),
		queryFn: () =>
			categoriesApi.listForPicker({ q: q || undefined, includeSelectedCategoryId: highlightId || undefined }),
		staleTime: 30_000,
	});

	const isBusy = !!busy?.isBusy;

	const items = useMemo(() => query.data?.items ?? [], [query.data?.items]);
	const filteredItems = useMemo(() => {
		const includeId = highlightId || parsedSelection.selectedCategoryId || "";
		return items.filter((item) => item.isActive !== false || (!!includeId && item.id === includeId));
	}, [highlightId, items, parsedSelection.selectedCategoryId]);
	const hasAny = filteredItems.length > 0;

	const createdId = parsedSelection.selectionSource === "created" ? parsedSelection.selectedCategoryId : "";
	const createdName = parsedSelection.selectionSource === "created" ? parsedSelection.selectedCategoryName : "";

	const hasAutoCommittedRef = useRef(false);

	useEffect(() => {
		if (!returnTo) return;
		if (!createdId) return;

		setHighlightId(createdId);
		query.refetch();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [returnTo, createdId]);

	useEffect(() => {
		if (hasAutoCommittedRef.current) return;
		if (!returnTo) return;
		if (!createdId) return;

		const existsInList = items.some((c) => c.id === createdId);
		if (!existsInList) return;

		if (!lockNav()) return;
		hasAutoCommittedRef.current = true;

		router.replace({
			pathname: returnTo as any,
			params: buildCategorySelectionParams({
				selectedCategoryId: createdId,
				selectedCategoryName: createdName || "",
				selectionSource: "created",
				draftId: draftId || undefined,
			}),
		});
	}, [createdId, createdName, items, lockNav, returnTo, router, draftId]);

	const onClearSearch = useCallback(() => {
		dismissKeyboard();
		setQText("");
	}, [dismissKeyboard]);

	const onPickNone = useCallback(() => {
		dismissKeyboard();
		if (!lockNav()) return;

		if (returnTo) {
			router.replace({
				pathname: returnTo as any,
				params: buildCategorySelectionParams({
					selectedCategoryId: "",
					selectedCategoryName: "",
					selectionSource: "cleared",
					draftId: draftId || undefined,
				}),
			});
			return;
		}

		router.back();
	}, [dismissKeyboard, lockNav, returnTo, router, draftId]);

	const onBack = useCallback(() => {
		dismissKeyboard();
		if (!lockNav()) return;
		if (returnTo) {
			router.replace(returnTo as any);
			return;
		}
		router.back();
	}, [dismissKeyboard, lockNav, returnTo, router]);
	const guardedOnBack = useProcessExitGuard(onBack);

	const onPick = useCallback(
		(cat: Category) => {
			dismissKeyboard();
			if (!lockNav()) return;
			if (cat.isActive === false) return;

			setHighlightId(cat.id);

			if (returnTo) {
				router.replace({
					pathname: returnTo as any,
					params: buildCategorySelectionParams({
						selectedCategoryId: cat.id,
						selectedCategoryName: cat.name,
						selectionSource: "existing",
						draftId: draftId || undefined,
					}),
				});
				return;
			}

			router.back();
		},
		[dismissKeyboard, draftId, lockNav, returnTo, router],
	);

	const openCreate = useCallback(
		(seedName?: string) => {
			dismissKeyboard();
			if (!lockNav()) return;

			router.push({
				pathname: createCategoryRoute as any,
				params: buildOpenCategoryCreateParams({
					returnTo: returnTo ?? undefined,
					initialName: seedName?.trim() ? seedName.trim() : undefined,
					draftId: draftId || undefined,
				}),
			});
		},
		[createCategoryRoute, dismissKeyboard, lockNav, returnTo, router, draftId],
	);

	const onAdd = useCallback(() => openCreate(q || undefined), [openCreate, q]);
	const onCreateCategoryEmptyState = useCallback(() => openCreate(q || undefined), [openCreate, q]);

	// Header Navigation Governance:
	// - Category picker is a screen => Back.
	const headerOptions = useInventoryHeader("picker", {
		title: pickerTitle,
		headerBackTitle,
		disabled: isBusy,
		onBack: guardedOnBack,
	});

	return (
		<>
			<Stack.Screen
				options={{
					...headerOptions,
					headerBackTitleStyle: styles.headerBackTitle,
				}}
			/>

			<BAIScreen padded={false} safeTop={false} safeBottom={false} style={styles.root}>
				<TouchableWithoutFeedback onPress={dismissKeyboard} accessible={false}>
					<View style={[styles.screen, { backgroundColor: theme.colors.background, paddingBottom: screenBottomPad }]}>
						<BAISurface style={styles.card} padded>
							<View style={styles.actionRow}>
								<BAIButton
									variant='outline'
									mode='outlined'
									intent='neutral'
									onPress={returnTo ? onPickNone : guardedOnBack}
									disabled={isBusy}
									style={styles.actionBtn}
									widthPreset='standard'
									shape='pill'
								>
									{returnTo ? "None" : "Cancel"}
								</BAIButton>

								<BAIButton
									mode='contained'
									onPress={onAdd}
									disabled={isBusy}
									style={styles.actionBtn}
									widthPreset='standard'
									shape='pill'
								>
									Create
								</BAIButton>
							</View>

							<BAISearchBar
								value={qText}
								onChangeText={(v) => {
									const cleaned = sanitizeSearchInput(v);
									setQText(cleaned.length > FIELD_LIMITS.search ? cleaned.slice(0, FIELD_LIMITS.search) : cleaned);
								}}
								placeholder='Search categories…'
								disabled={isBusy}
								maxLength={FIELD_LIMITS.search}
								onSubmit={() => setQText((v) => v.trim())}
							/>

							<View style={styles.listContainer}>
								{query.isLoading ? (
									<BAIText variant='body' muted>
										Loading…
									</BAIText>
								) : query.isError ? (
									<View style={styles.errorBox}>
										<BAIText variant='body' style={styles.errorText}>
											Failed to load categories.
										</BAIText>
										<BAIRetryButton
											variant='outline'
											mode='outlined'
											onPress={() => query.refetch()}
											disabled={isBusy}
											style={styles.retrybtn}
											shape='pill'
										>
											Retry
										</BAIRetryButton>
									</View>
								) : !hasAny ? (
									<View style={styles.emptyBox}>
										{hasSearch ? (
											<>
												<BAIText variant='body' muted style={styles.emptyText}>
													No categories match: {q}.
												</BAIText>
												<BAIText variant='caption' muted style={styles.emptyText}>
													Try a different search or create a new category.
												</BAIText>
												<View style={{ height: 6 }} />
												<View style={styles.emptyActions}>
													<BAIButton
														variant='outline'
														mode='outlined'
														onPress={onClearSearch}
														disabled={isBusy}
														widthPreset='standard'
														shape='pill'
													>
														Clear Search
													</BAIButton>
													<BAIEmptyStateButton
														variant='outline'
														mode='contained'
														onPress={onCreateCategoryEmptyState}
														disabled={isBusy}
														shape='pill'
													>
														Add Category
													</BAIEmptyStateButton>
												</View>
											</>
										) : (
											<>
												<BAIText variant='body' muted style={styles.emptyText}>
													No categories yet.
												</BAIText>
												<BAIText variant='caption' muted style={styles.emptyText}>
													Create one now so you can organize Items and Services.
												</BAIText>
												<BAIEmptyStateButton
													variant='outline'
													mode='contained'
													onPress={onCreateCategoryEmptyState}
													disabled={isBusy}
													style={styles.emptyButton}
													shape='pill'
												>
													Add Category
												</BAIEmptyStateButton>
											</>
										)}
									</View>
								) : (
									<FlatList
										data={filteredItems}
										keyExtractor={(it) => it.id}
										style={styles.list}
										renderItem={({ item }) => (
											<CategoryRow
												item={item}
												onPress={() => onPick(item)}
												disabled={isBusy || item.isActive === false}
												selected={!!highlightId && item.id === highlightId}
											/>
										)}
										contentContainerStyle={styles.listContent}
										keyboardShouldPersistTaps='handled'
										showsVerticalScrollIndicator={false}
										showsHorizontalScrollIndicator={false}
									/>
								)}
							</View>
						</BAISurface>
					</View>
				</TouchableWithoutFeedback>
			</BAIScreen>
		</>
	);
}

const styles = StyleSheet.create({
	root: { flex: 1 },

	screen: {
		flex: 1,
		minHeight: 0,
		padding: 12,
		paddingTop: 0,
	},

	card: { flex: 1, minHeight: 0, gap: 10 },

	actionRow: {
		flexDirection: "row",
		alignItems: "center",
		gap: 8,
	},

	actionBtn: {
		flex: 1,
	},

	listContainer: { flex: 1, minHeight: 0 },

	list: { flex: 1, minHeight: 0 },

	listContent: {
		paddingTop: 0,
		paddingBottom: 0,
	},

	emptyBox: {
		paddingTop: 10,
		gap: 8,
		alignItems: "center",
	},
	emptyActions: {
		flexDirection: "row",
		gap: 10,
		justifyContent: "center",
	},

	headerBackTitle: {
		fontSize: 14,
	},
	emptyText: { textAlign: "center" },
	emptyButton: { alignSelf: "center" },
	retrybtn: { marginTop: 20 },
	errorBox: { minWidth: 240, alignSelf: "center", marginTop: 20 },
	errorText: { textAlign: "center" },
});
