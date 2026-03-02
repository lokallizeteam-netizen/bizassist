import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Keyboard, Pressable, StyleSheet, TouchableWithoutFeedback, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useTheme } from "react-native-paper";
import { useQuery } from "@tanstack/react-query";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { BAIScreen } from "@/components/ui/BAIScreen";
import { BAISurface } from "@/components/ui/BAISurface";
import { BAIText } from "@/components/ui/BAIText";
import { SettingsScreenLayout, SettingsSectionTitle } from "@/components/settings/SettingsLayout";
import { BAIRetryButton } from "@/components/ui/BAIRetryButton";
import { BAIHeader } from "@/components/ui/BAIHeader";
import { BAIGroupTabs, type BAIGroupTab } from "@/components/ui/BAIGroupTabs";
import { BAISearchBar } from "@/components/ui/BAISearchBar";
import { formatCompactNumber } from "@/lib/locale/businessLocale";
import { useActiveBusinessMeta } from "@/modules/business/useActiveBusinessMeta";
import { modifiersApi } from "@/modules/modifiers/modifiers.api";
import type { ModifierGroup } from "@/modules/modifiers/modifiers.types";
import { FIELD_LIMITS } from "@/shared/fieldLimits";
import { sanitizeSearchInput } from "@/shared/validation/sanitize";

const modifierGroupsKey = ["modifiers", "groups", "settings"] as const;
type ModifierFilter = "active" | "archived";

function resolveModifierFilter(raw: unknown): ModifierFilter {
	return String(raw ?? "")
		.trim()
		.toLowerCase() === "archived"
		? "archived"
		: "active";
}

function Row({
	item,
	onOpen,
	countryCode,
}: {
	item: ModifierGroup;
	onOpen: (item: ModifierGroup) => void;
	countryCode?: string | null;
}) {
	const theme = useTheme();
	const totalOptionsLabel = `${formatCompactNumber(item.options.length, countryCode)} modifier${item.options.length === 1 ? "" : "s"}`;
	const availableLabel = `${formatCompactNumber(item.availableOptionsCount, countryCode)} available`;
	const soldOutLabel = `${formatCompactNumber(item.soldOutOptionsCount, countryCode)} sold out`;
	const rowNameColor = item.isArchived
		? (theme.colors.onSurfaceVariant ?? theme.colors.onSurface)
		: theme.colors.onSurface;
	return (
		<BAISurface
			style={[
				styles.row,
				{
					borderColor: theme.colors.outlineVariant ?? theme.colors.outline,
					backgroundColor: theme.colors.surfaceVariant ?? theme.colors.surface,
				},
			]}
			padded
		>
			<Pressable onPress={() => onOpen(item)} style={styles.pressArea}>
				<View style={styles.left}>
					<View style={styles.textBlock}>
						<View style={styles.nameRow}>
							<BAIText variant='subtitle' style={[styles.nameText, { color: rowNameColor }]} numberOfLines={1}>
								{item.name}
							</BAIText>
						</View>
						<BAIText variant='caption' muted numberOfLines={1} style={styles.countText}>
							{totalOptionsLabel}
						</BAIText>
					</View>
				</View>
				<View style={styles.rightSide}>
					<View style={styles.rightMeta}>
						{item.isArchived ? (
							<BAIText variant='caption' style={{ color: theme.colors.error }} numberOfLines={1}>
								Archived
							</BAIText>
						) : null}
						<BAIText variant='body' muted numberOfLines={1}>
							{availableLabel}
						</BAIText>
						{item.soldOutOptionsCount > 0 ? (
							<BAIText variant='caption' style={{ color: theme.colors.error }} numberOfLines={1}>
								{soldOutLabel}
							</BAIText>
						) : null}
					</View>
					<MaterialCommunityIcons
						name='chevron-right'
						size={22}
						color={theme.colors.onSurfaceVariant ?? theme.colors.onSurface}
					/>
				</View>
			</Pressable>
		</BAISurface>
	);
}

export function ModifiersLedgerScreen({
	layout,
	mode = "settings",
}: {
	layout: "phone" | "tablet";
	mode?: "settings" | "inventory";
}) {
	const router = useRouter();
	const theme = useTheme();
	const params = useLocalSearchParams<{ filter?: string }>();
	const { countryCode } = useActiveBusinessMeta();
	const [search, setSearch] = useState("");
	const [filter, setFilter] = useState<ModifierFilter>(() => resolveModifierFilter(params.filter));
	const baseRoute = mode === "settings" ? "/(app)/(tabs)/settings/modifiers" : "/(app)/(tabs)/inventory/modifiers";
	const backRoute = mode === "settings" ? "/(app)/(tabs)/settings" : "/(app)/(tabs)/inventory";

	useEffect(() => {
		setFilter(resolveModifierFilter(params.filter));
	}, [params.filter]);

	const groupsQuery = useQuery({
		queryKey: modifierGroupsKey,
		queryFn: () => modifiersApi.listGroups(true),
		staleTime: 30_000,
	});

	const onOpen = useCallback(
		(item: ModifierGroup) => {
			const detailRoute = `${baseRoute}/${encodeURIComponent(item.id)}`;
			const returnTo = `${baseRoute}?filter=${filter}`;
			router.push(`${detailRoute}?returnTo=${encodeURIComponent(returnTo)}` as any);
		},
		[baseRoute, filter, router],
	);

	const searchedItems = useMemo(() => {
		const all = groupsQuery.data ?? [];
		const q = search.trim().toLowerCase();
		if (!q) return all;
		return all.filter((group) => group.name.toLowerCase().includes(q));
	}, [groupsQuery.data, search]);

	const activeItems = useMemo(() => searchedItems.filter((group) => !group.isArchived), [searchedItems]);
	const archivedItems = useMemo(() => searchedItems.filter((group) => group.isArchived), [searchedItems]);
	const items = filter === "archived" ? archivedItems : activeItems;

	const modifierTabs = useMemo<readonly BAIGroupTab<ModifierFilter>[]>(
		() => [
			{ label: "Active", value: "active", count: activeItems.length },
			{ label: "Archived", value: "archived", count: archivedItems.length },
		],
		[activeItems.length, archivedItems.length],
	);

	const dismissKeyboard = useCallback(() => {
		Keyboard.dismiss();
	}, []);

	const onCancel = useCallback(() => {
		router.replace(backRoute as any);
	}, [backRoute, router]);

	const onCreate = useCallback(() => {
		router.push(`${baseRoute}/create` as any);
	}, [baseRoute, router]);

	const hasSearch = search.trim().length > 0;
	const borderColor = theme.colors.outlineVariant ?? theme.colors.outline;

	return (
		<>
			<Stack.Screen options={{ headerShown: false }} />
			<BAIScreen tabbed padded={false} safeTop={false} safeBottom style={styles.root}>
				<BAIHeader
					title='Modifiers'
					variant='back'
					onLeftPress={onCancel}
					onRightPress={onCreate}
					rightSlot={({ disabled }) => (
						<View style={[styles.addCircle, { backgroundColor: theme.colors.primary, opacity: disabled ? 0.5 : 1 }]}>
							<MaterialCommunityIcons name='plus' size={30} color={theme.colors.onPrimary} />
						</View>
					)}
				/>
				<TouchableWithoutFeedback onPress={dismissKeyboard} accessible={false}>
					<SettingsScreenLayout
						screenStyle={styles.layoutScreen}
						maxWidth={layout === "tablet" ? 720 : undefined}
					>
						<BAISurface style={[styles.card, { borderColor }]} padded bordered>
							<SettingsSectionTitle>Modifiers</SettingsSectionTitle>
							<View style={styles.controls}>
									<BAISearchBar
										value={search}
										onChangeText={(value) => {
											const cleaned = sanitizeSearchInput(value);
											setSearch(cleaned.length > FIELD_LIMITS.search ? cleaned.slice(0, FIELD_LIMITS.search) : cleaned);
										}}
										placeholder='Search modifiers...'
										maxLength={FIELD_LIMITS.search}
										onClear={hasSearch ? () => setSearch("") : undefined}
									/>
									<View style={styles.groupTabsWrap}>
										<BAIGroupTabs
											tabs={modifierTabs}
											value={filter}
											onChange={setFilter}
											countFormatter={(count) => formatCompactNumber(count, countryCode)}
										/>
									</View>
							</View>

							<View style={styles.listSection}>
									{groupsQuery.isLoading ? (
										<View style={styles.stateWrap}>
											<BAIText variant='body'>Loading modifier sets...</BAIText>
										</View>
									) : groupsQuery.isError ? (
										<View style={styles.stateWrap}>
											<BAIRetryButton compact onPress={() => groupsQuery.refetch()}>
												Retry
											</BAIRetryButton>
										</View>
									) : items.length === 0 ? (
										<BAISurface bordered style={styles.emptyWrap}>
											<BAIText variant='body'>
												{hasSearch
													? `No matching ${filter === "active" ? "active" : "archived"} modifiers.`
													: filter === "active"
														? "No active modifiers."
														: "No archived modifiers."}
											</BAIText>
											<BAIText variant='caption' muted>
												{hasSearch
													? "Try a different search term."
													: filter === "active"
														? "Create your first modifier."
														: "Archived modifiers will appear here."}
											</BAIText>
										</BAISurface>
									) : (
										<FlatList
											data={items}
											keyExtractor={(item) => item.id}
											renderItem={({ item }) => <Row item={item} onOpen={onOpen} countryCode={countryCode} />}
											style={styles.list}
											contentContainerStyle={styles.listContent}
											keyboardShouldPersistTaps='handled'
											showsVerticalScrollIndicator={false}
										/>
									)}
							</View>
						</BAISurface>
					</SettingsScreenLayout>
				</TouchableWithoutFeedback>
			</BAIScreen>
		</>
	);
}

export default function ModifiersLedgerRoute() {
	return <ModifiersLedgerScreen layout='phone' mode='settings' />;
}

const styles = StyleSheet.create({
	root: { flex: 1 },
	layoutScreen: { paddingHorizontal: 8, paddingTop: 0 },
	card: { flex: 1, borderRadius: 18, gap: 6 },
	controls: { gap: 4, paddingBottom: 2 },
	groupTabsWrap: {
		paddingTop: 6,
	},
	listSection: { flex: 1, minHeight: 0 },
	list: { flex: 1, minHeight: 0 },
	stateWrap: { paddingTop: 8, alignItems: "flex-start" },
	listContent: { gap: 0, paddingBottom: 4 },
	row: {
		borderWidth: 1,
		borderRadius: 12,
		flexDirection: "row",
		alignItems: "center",
		paddingVertical: 6,
	},
	pressArea: {
		flex: 1,
		minWidth: 0,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		paddingVertical: 2,
	},
	left: {
		flex: 1,
		minWidth: 0,
	},
	textBlock: {
		flex: 1,
		minWidth: 0,
		gap: 2,
	},
	nameRow: {
		flexDirection: "row",
		alignItems: "center",
		gap: 6,
		minWidth: 0,
	},
	nameText: {
		flex: 1,
		minWidth: 0,
		fontWeight: "500",
	},
	countText: {
		marginLeft: 0,
	},
	rightSide: {
		flexDirection: "row",
		alignItems: "center",
		gap: 6,
		marginLeft: 6,
	},
	rightMeta: {
		alignItems: "flex-end",
		minWidth: 102,
	},
	addCircle: {
		width: 44,
		height: 44,
		borderRadius: 22,
		alignItems: "center",
		justifyContent: "center",
	},
	emptyWrap: { padding: 12, borderRadius: 12, gap: 4 },
});
