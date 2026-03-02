// BizAssist_mobile path: app/(app)/(tabs)/pos/discounts/select.tsx
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { Button, Searchbar, useTheme } from "react-native-paper";

import { BAIActivityIndicator } from "@/components/system/BAIActivityIndicator";
import { BAIScreen } from "@/components/ui/BAIScreen";
import { BAISurface } from "@/components/ui/BAISurface";
import { BAIText } from "@/components/ui/BAIText";

import { formatDiscountSubtitle } from "@/modules/discounts/discounts.constants";
import { INVENTORY_DISCOUNTS_CREATE_ROUTE } from "@/modules/discounts/discounts.navigation";
import { useDiscountsPicker } from "@/modules/discounts/discounts.queries";
import { setDiscountSelection } from "@/modules/discounts/discounts.selectionStore";
import type { Discount, DiscountApplyTarget } from "@/modules/discounts/discounts.types";
import { FIELD_LIMITS } from "@/shared/fieldLimits";
import { sanitizeSearchInput } from "@/shared/validation/sanitize";

export default function PosDiscountSelectScreen() {
	const router = useRouter();
	const theme = useTheme();

	/**
	 * Expected params from POS cart:
	 * - target: "SALE" | "LINE_ITEM"
	 * - lineItemId?: string
	 * - targetSubtotal: string (number)
	 */
	const params = useLocalSearchParams<{
		target?: DiscountApplyTarget;
		lineItemId?: string;
		targetSubtotal?: string;
	}>();

	const target: DiscountApplyTarget = (params.target as DiscountApplyTarget) ?? "SALE";
	const lineItemId = params.lineItemId;
	const targetSubtotal = Number(params.targetSubtotal ?? "0") || 0;

	const [query, setQuery] = useState("");
	const { data, isLoading, isFetching, refetch } = useDiscountsPicker({ q: query });

	// ✅ data is DiscountListResponse | undefined
	const allItems = useMemo(() => data?.items ?? [], [data?.items]);

	const currencySymbol = "₱"; // TODO: replace with business currency symbol via active business meta hook.

	const applicable = useMemo(() => {
		// V1: scope is applied at checkout time (SaleDiscount snapshot), not on definitions.
		return allItems;
	}, [allItems]);

	const onPick = useCallback(
		(d: Discount) => {
			const value = Number(d.value);

			setDiscountSelection({
				target,
				lineItemId: lineItemId || undefined,
				discountId: d.id,
				nameSnapshot: d.name,
				typeSnapshot: d.type,
				valueSnapshot: Number.isFinite(value) ? value : 0,
				targetSubtotal,
			});

			router.back();
		},
		[lineItemId, router, target, targetSubtotal],
	);

	const renderRow = useCallback(
		({ item }: { item: Discount }) => {
			const subtitle = formatDiscountSubtitle(item.type, item.value, currencySymbol);
			const borderColor = theme.colors.outlineVariant ?? theme.colors.outline;

			return (
				<Pressable
					onPress={() => onPick(item)}
					style={({ pressed }) => [styles.row, { borderColor }, pressed && { opacity: 0.85 }]}
				>
					<View style={styles.rowText}>
						<BAIText variant='body' numberOfLines={1}>
							{item.name}
						</BAIText>

						{!!subtitle && (
							<BAIText variant='caption' muted numberOfLines={1}>
								{subtitle}
							</BAIText>
						)}
					</View>
				</Pressable>
			);
		},
		[currencySymbol, onPick, theme.colors.outline, theme.colors.outlineVariant],
	);

	const showEmpty = !isLoading && applicable.length === 0;

	return (
		<BAIScreen>
			<BAISurface style={styles.container} padded>
				<BAIText variant='title'>Select discount</BAIText>

				<Searchbar
					value={query}
					onChangeText={(v) => {
						const cleaned = sanitizeSearchInput(v);
						setQuery(cleaned.length > FIELD_LIMITS.search ? cleaned.slice(0, FIELD_LIMITS.search) : cleaned);
					}}
					placeholder='Search discounts'
					style={styles.search}
					autoCapitalize='none'
					autoCorrect={false}
					maxLength={FIELD_LIMITS.search}
				/>

				{isLoading ? (
					<View style={styles.loading}>
						<BAIActivityIndicator />
						<View style={{ height: 10 }} />
						<BAIText variant='body' muted>
							Loading…
						</BAIText>
					</View>
				) : showEmpty ? (
					<View style={styles.empty}>
						<BAIText variant='title'>No discounts available</BAIText>
						<BAIText variant='caption' muted style={styles.emptySub}>
							Create a discount in Inventory to apply at checkout.
						</BAIText>
						<Button
							mode='contained'
							onPress={() => {
								const returnTo =
									`/(app)/(tabs)/pos/discounts/select?target=${encodeURIComponent(target)}` +
									`&lineItemId=${encodeURIComponent(lineItemId ?? "")}` +
									`&targetSubtotal=${encodeURIComponent(String(targetSubtotal))}`;
								router.push({
									pathname: INVENTORY_DISCOUNTS_CREATE_ROUTE,
									params: { returnTo },
								});
							}}
						>
							Create discount
						</Button>
					</View>
				) : (
					<FlatList
						data={applicable}
						keyExtractor={(d) => d.id}
						renderItem={renderRow}
						contentContainerStyle={styles.listContent}
						refreshing={isFetching}
						onRefresh={refetch}
						keyboardShouldPersistTaps='handled'
					/>
				)}
			</BAISurface>
		</BAIScreen>
	);
}

const styles = StyleSheet.create({
	container: { flex: 1, gap: 12 },
	search: { marginTop: 6 },
	loading: { flex: 1, alignItems: "center", justifyContent: "center" },
	empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 10 },
	emptySub: { textAlign: "center" },
	listContent: { paddingVertical: 6, gap: 10 },
	row: {
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: 14,
		padding: 14,
	},
	rowText: { gap: 4 },
});
