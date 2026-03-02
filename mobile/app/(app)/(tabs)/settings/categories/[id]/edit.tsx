// BizAssist_mobile
// path: app/(app)/(tabs)/settings/categories/[id]/edit.tsx
//
// Governance:
// - Edit is a PROCESS screen.
// - Exit cancels edit and returns to category details.
// - Editable fields: name + color only.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { Keyboard, KeyboardAvoidingView, Platform, StyleSheet, TouchableWithoutFeedback, View } from "react-native";
import { useTheme } from "react-native-paper";

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
import { extractCategoryApiError } from "@/modules/categories/categories.validators";
import CategoryFormComponent from "@/modules/categories/components/CategoryForm";
import { useAppHeader } from "@/modules/navigation/useAppHeader";
import { useProcessExitGuard } from "@/modules/navigation/useProcessExitGuard";
import { useInventoryHeader } from "@/modules/inventory/useInventoryHeader";

type Params = { id?: string };
type CategoryFlowMode = "settings" | "inventory";

const SETTINGS_CATEGORIES_ROUTE = "/(app)/(tabs)/settings/categories" as const;
const INVENTORY_CATEGORIES_ROUTE = "/(app)/(tabs)/inventory/categories/category.ledger" as const;

function extractApiErrorMessage(err: any): string {
	return String(extractCategoryApiError(err).message ?? "Failed to save category. Please try again.");
}

export function CategoryEditScreen({ mode = "settings" }: { mode?: CategoryFlowMode }) {
	const router = useRouter();
	const theme = useTheme();
	const qc = useQueryClient();
	const { withBusy, busy } = useAppBusy();

	const params = useLocalSearchParams<Params>();
	const categoryId = useMemo(() => String(params.id ?? "").trim(), [params.id]);
	const categoryDetailsRoute = useMemo(
		() =>
			categoryId
				? mode === "settings"
					? (`/(app)/(tabs)/settings/categories/${encodeURIComponent(categoryId)}` as const)
					: (`/(app)/(tabs)/inventory/categories/${encodeURIComponent(categoryId)}` as const)
				: mode === "settings"
					? SETTINGS_CATEGORIES_ROUTE
					: INVENTORY_CATEGORIES_ROUTE,
		[categoryId, mode],
	);

	const [error, setError] = useState<string | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);

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

	const isBusy = !!busy?.isBusy;
	const isUiDisabled = isBusy || isNavLocked || isSubmitting;
	const listParams = useMemo(() => ({ limit: 250 }), []);
	const query = useQuery<{ items: Category[] }>({
		queryKey: categoryKeys.list(listParams),
		queryFn: () => categoriesApi.list(listParams),
		staleTime: 300_000,
		enabled: !!categoryId,
	});

	const category = useMemo(
		() => query.data?.items?.find((c) => c.id === categoryId) ?? null,
		[categoryId, query.data?.items],
	);

	const onExit = useCallback(() => {
		if (isUiDisabled) return;
		if (!lockNav()) return;
		router.replace(categoryDetailsRoute as any);
	}, [categoryDetailsRoute, isUiDisabled, lockNav, router]);
	const guardedOnExit = useProcessExitGuard(onExit);

	const submit = useCallback(
		async (value: { name: string; color: string | null }) => {
			if (!categoryId || isUiDisabled) return;
			if (!lockNav()) return;

			setError(null);
			setIsSubmitting(true);

			await withBusy("Saving category...", async () => {
				try {
					const updated = await categoriesApi.update(categoryId, { name: value.name, color: value.color });
					syncCategoryCaches(qc, updated);
					void qc.invalidateQueries({ queryKey: categoryKeys.root() });
					router.replace(categoryDetailsRoute as any);
				} catch (e: any) {
					setError(extractApiErrorMessage(e));
				} finally {
					setIsSubmitting(false);
				}
			});
		},
		[categoryDetailsRoute, categoryId, isUiDisabled, lockNav, qc, router, withBusy],
	);

	const borderColor = theme.colors.outlineVariant ?? theme.colors.outline;
	const settingsHeaderOptions = useAppHeader("process", { title: "Edit Category", disabled: isUiDisabled, onExit: guardedOnExit });
	const inventoryHeaderOptions = useInventoryHeader("process", {
		title: "Edit Category",
		disabled: isUiDisabled,
		onExit: guardedOnExit,
	});
	const headerOptions = mode === "settings" ? settingsHeaderOptions : inventoryHeaderOptions;

	return (
		<>
			<Stack.Screen options={headerOptions} />
			<BAIScreen tabbed padded={false} safeTop={false} style={styles.root}>
				<KeyboardAvoidingView
					style={styles.keyboardAvoider}
					behavior={Platform.OS === "ios" ? "padding" : "height"}
					keyboardVerticalOffset={0}
				>
					<TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
						<View style={styles.keyboardContent}>
							<SettingsScreenLayout
								screenStyle={[styles.screen, { backgroundColor: theme.colors.background }]}
								maxWidth={560}
							>
								<BAISurface style={[styles.card, { borderColor }]} padded bordered>
									<BAIText variant='caption' muted>
										Update category name or color. Archiving is managed in Category Details.
									</BAIText>

									<View style={{ height: 12 }} />

									{query.isLoading ? (
										<BAIText variant='body' muted>
											Loading...
										</BAIText>
									) : query.isError ? (
										<View style={{ gap: 10 }}>
											<BAIText variant='body'>Failed to load category.</BAIText>
											<BAIRetryButton mode='outlined' onPress={() => query.refetch()} disabled={isUiDisabled}>
												Retry
											</BAIRetryButton>
										</View>
									) : !category ? (
										<BAIText variant='body' muted>
											Category not found.
										</BAIText>
									) : (
										<CategoryFormComponent
											mode='edit'
											initial={{ name: category.name ?? "", color: category.color ?? null }}
											onSubmit={submit}
											onCancel={guardedOnExit}
											submitLabel='Save'
											disabled={isUiDisabled}
											error={error}
										/>
									)}
								</BAISurface>
							</SettingsScreenLayout>
						</View>
					</TouchableWithoutFeedback>
				</KeyboardAvoidingView>
			</BAIScreen>
		</>
	);
}

export default function SettingsCategoryEditScreen() {
	return <CategoryEditScreen mode='settings' />;
}

const styles = StyleSheet.create({
	root: { flex: 1 },
	keyboardAvoider: { flex: 1 },
	keyboardContent: { flex: 1 },
	screen: { flex: 1, padding: 12, paddingTop: 0 },
	card: { borderRadius: 24 },
});
