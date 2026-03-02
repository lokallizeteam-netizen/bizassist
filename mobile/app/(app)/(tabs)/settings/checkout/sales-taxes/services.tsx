import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useQuery } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { Switch, useTheme } from "react-native-paper";

import { BAIHeader } from "@/components/ui/BAIHeader";
import { BAIButton } from "@/components/ui/BAIButton";
import { BAIScreen } from "@/components/ui/BAIScreen";
import { BAISearchBar } from "@/components/ui/BAISearchBar";
import { BAISurface } from "@/components/ui/BAISurface";
import { BAIText } from "@/components/ui/BAIText";
import { businessApi } from "@/modules/business/business.api";
import { resolveActiveBusinessIdFromContext as resolveActiveBusinessId } from "@/modules/business/business.context";
import { inventoryApi } from "@/modules/inventory/inventory.api";
import type { InventoryProduct } from "@/modules/inventory/inventory.types";

const SALES_TAX_SERVICES_QUERY_KEY = (businessId: string) => ["sales-taxes", "services-catalog", businessId] as const;
const SALES_TAX_CATALOG_LIMIT = 100;

function Row({ item }: { item: InventoryProduct }) {
	const theme = useTheme();
	return (
		<Pressable
			disabled
			style={[styles.itemRow, { borderBottomColor: theme.colors.outlineVariant ?? theme.colors.outline, opacity: 0.8 }]}
		>
			<View style={styles.rowLeft}>
				<BAIText variant='subtitle'>{item.name}</BAIText>
				<BAIText variant='body' style={{ color: theme.colors.onSurfaceVariant }}>
					Nontaxable
				</BAIText>
			</View>
			<Switch value={false} disabled />
		</Pressable>
	);
}

export default function SalesTaxServicesScreen() {
	const router = useRouter();
	const theme = useTheme();
	const [search, setSearch] = useState("");
	const borderColor = theme.colors.outlineVariant ?? theme.colors.outline;
	const surfaceAlt = theme.colors.surfaceVariant ?? theme.colors.surface;
	const textMutedColor = theme.colors.onSurfaceVariant;
	const surfaceInteractive = useMemo(
		() => ({
			borderColor,
			backgroundColor: surfaceAlt,
		}),
		[borderColor, surfaceAlt],
	);

	const activeBusinessQuery = useQuery({
		queryKey: ["business", "active"],
		queryFn: () => businessApi.getActiveBusiness(),
		staleTime: 60_000,
	});
	const activeBusinessId = useMemo(() => resolveActiveBusinessId(activeBusinessQuery.data), [activeBusinessQuery.data]);

	const servicesQuery = useQuery({
		queryKey: SALES_TAX_SERVICES_QUERY_KEY(activeBusinessId || "no-business"),
		queryFn: () =>
			inventoryApi.listProducts({ type: "SERVICE", includeArchived: false, limit: SALES_TAX_CATALOG_LIMIT }),
		enabled: !!activeBusinessId,
		staleTime: 60_000,
	});

	const allServices = useMemo(
		() => (servicesQuery.data?.items ?? []).filter((service) => service.isActive),
		[servicesQuery.data?.items],
	);

	const visibleServices = useMemo(() => {
		const q = search.trim().toLowerCase();
		if (!q) return allServices;
		return allServices.filter((service) => service.name.toLowerCase().includes(q));
	}, [allServices, search]);

	const totalVisibleCount = visibleServices.length;
	const countLabel =
		totalVisibleCount > 0 ? `${totalVisibleCount} ${totalVisibleCount === 1 ? "service" : "services"}` : "No services";

	const onBack = useCallback(() => {
		if (router.canGoBack?.()) {
			router.back();
			return;
		}
		router.replace("/(app)/(tabs)/settings/checkout/sales-taxes/create" as any);
	}, [router]);

	const onDone = useCallback(() => {
		onBack();
	}, [onBack]);

	return (
		<>
			<Stack.Screen options={{ headerShown: false }} />
			<BAIScreen tabbed padded={false} safeTop={false}>
				<BAIHeader
					title='Services'
					variant='back'
					onLeftPress={onBack}
					onRightPress={onDone}
					rightSlot={({ disabled }) => (
						<View
							style={[
								styles.headerActionPill,
								{ backgroundColor: disabled ? theme.colors.surfaceDisabled : theme.colors.primary },
							]}
						>
							<BAIText
								variant='body'
								style={[
									styles.headerActionText,
									{ color: disabled ? theme.colors.onSurfaceDisabled : theme.colors.onPrimary },
								]}
							>
								Done
							</BAIText>
						</View>
					)}
				/>

				<View style={styles.screen}>
					<BAISurface bordered padded style={[styles.mainCard, surfaceInteractive]}>
						<View style={styles.searchRow}>
							<View style={styles.searchWrap}>
								<BAISearchBar value={search} onChangeText={setSearch} placeholder='Search' />
							</View>
							<Pressable style={styles.filterIcon}>
								<MaterialCommunityIcons name='tune-variant' size={24} color={theme.colors.onSurfaceVariant} />
							</Pressable>
						</View>

						<BAIText variant='body' style={[styles.countLabel, { color: theme.colors.onSurfaceVariant }]}>
							{countLabel}
						</BAIText>

						<View style={styles.bulkActionsRow}>
							<BAIButton
								variant='solid'
								intent='primary'
								onPress={() => {}}
								shape='pill'
								style={styles.bulkActionButton}
								disabled
							>
								Tax all
							</BAIButton>
							<BAIButton
								variant='solid'
								intent='primary'
								onPress={() => {}}
								shape='pill'
								style={styles.bulkActionButton}
								disabled
							>
								Exempt all
							</BAIButton>
						</View>

						<BAIText variant='body' style={[styles.notice, { color: theme.colors.onSurfaceVariant }]}>
							Some of your services are nontaxable and will not be available for tax assignment
						</BAIText>

						{servicesQuery.isLoading || activeBusinessQuery.isLoading ? (
							<BAIText variant='body' style={{ color: textMutedColor }}>
								Loading services...
							</BAIText>
						) : activeBusinessQuery.isError || !activeBusinessId ? (
							<View style={styles.feedbackWrap}>
								<BAIText variant='body' style={{ color: textMutedColor }}>
									Unable to resolve your active business.
								</BAIText>
								<BAIButton
									variant='soft'
									intent='neutral'
									shape='pill'
									widthPreset='standard'
									style={styles.retryButton}
									onPress={() => {
										activeBusinessQuery.refetch();
									}}
								>
									Retry
								</BAIButton>
							</View>
						) : servicesQuery.isError ? (
							<View style={styles.feedbackWrap}>
								<BAIText variant='body' style={{ color: textMutedColor }}>
									Could not load services right now.
								</BAIText>
								<BAIButton
									variant='soft'
									intent='neutral'
									shape='pill'
									widthPreset='standard'
									style={styles.retryButton}
									onPress={() => {
										servicesQuery.refetch();
									}}
								>
									Retry
								</BAIButton>
							</View>
						) : visibleServices.length === 0 ? (
							<BAIText variant='body' style={{ color: textMutedColor }}>
								No services found.
							</BAIText>
						) : (
							<FlatList
								data={visibleServices}
								keyExtractor={(item) => item.id}
								renderItem={({ item }) => <Row item={item} />}
								style={styles.list}
								contentContainerStyle={styles.listContent}
								keyboardShouldPersistTaps='handled'
								showsVerticalScrollIndicator={false}
							/>
						)}
					</BAISurface>
				</View>
			</BAIScreen>
		</>
	);
}

const styles = StyleSheet.create({
	screen: {
		flex: 1,
		paddingTop: 0,
		padding: 12,
		gap: 10,
	},
	mainCard: {
		flex: 1,
		borderRadius: 16,
		gap: 10,
	},
	headerActionPill: {
		width: 90,
		height: 40,
		paddingHorizontal: 16,
		borderRadius: 20,
		alignItems: "center",
		justifyContent: "center",
	},
	headerActionText: {
		fontSize: 16,
		fontWeight: "600",
	},
	searchRow: {
		flexDirection: "row",
		alignItems: "center",
		gap: 8,
	},
	searchWrap: {
		flex: 1,
	},
	filterIcon: {
		width: 40,
		height: 40,
		alignItems: "center",
		justifyContent: "center",
	},
	countLabel: {
		textAlign: "right",
	},
	bulkActionsRow: {
		flexDirection: "row",
		alignItems: "center",
		gap: 10,
	},
	bulkActionButton: {
		flex: 1,
	},
	notice: {
		textAlign: "center",
		paddingHorizontal: 4,
	},
	list: {
		flex: 1,
		minHeight: 0,
	},
	listContent: {
		paddingBottom: 24,
	},
	feedbackWrap: {
		gap: 8,
	},
	retryButton: {
		alignSelf: "flex-start",
	},
	itemRow: {
		paddingVertical: 14,
		paddingHorizontal: 2,
		borderBottomWidth: 1,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		gap: 8,
	},
	rowLeft: {
		flex: 1,
		gap: 2,
	},
});
