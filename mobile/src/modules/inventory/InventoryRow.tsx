// BizAssist_mobile path: src/modules/inventory/components/InventoryRow.tsx
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Image as ExpoImage } from "expo-image";
import { Pressable, StyleSheet, View } from "react-native";
import { useTheme } from "react-native-paper";

import { BAIText } from "@/components/ui/BAIText";
import { useActiveBusinessMeta } from "@/modules/business/useActiveBusinessMeta";
import { baiSemanticColors } from "@/theme/baiColors";
import {
	formatOnHand,
	formatOnHandValue,
	hasReorderPoint,
	isLowStock,
	isOutOfStock,
} from "@/modules/inventory/inventory.selectors";
import { formatDurationLabel, resolveServiceDurationMinutes } from "@/modules/inventory/services/serviceDuration";
import type { InventoryProduct } from "@/modules/inventory/inventory.types";
import { formatMoney } from "@/shared/money/money.format";

const DEFAULT_SERVICE_TILE_COLOR = "#616161";

export type InventoryRowProps = {
	item: InventoryProduct;
	onPress: () => void;
	disabled?: boolean;

	/**
	 * Whether to show the unit token beside on-hand quantity.
	 */
	showOnHandUnit?: boolean;

	/**
	 * Tablet workspace selection highlight.
	 */
	active?: boolean;

	/**
	 * Category appearance from lookup (preferred).
	 */
	categoryColor?: string | null;
	categoryIsActive?: boolean;
};

function InventoryRowBase({
	item,
	onPress,
	disabled,
	active,
	categoryColor,
	categoryIsActive,
	showOnHandUnit = true,
}: InventoryRowProps) {
	const theme = useTheme();
	const { currencyCode } = useActiveBusinessMeta();
	const borderColor = theme.colors.outlineVariant ?? theme.colors.outline;
	const disabledThumbBorderColor = theme.dark ? "#F5F5F5" : "#111111";
	const surfaceAlt = theme.colors.surfaceVariant ?? theme.colors.surface;
	const pressedBg = theme.dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.05)";

	const tracked = item.trackInventory;
	const isServiceItem =
		String((item as { type?: string }).type ?? "")
			.trim()
			.toUpperCase() === "SERVICE";
	const low = useMemo(() => (tracked ? isLowStock(item) : false), [item, tracked]);
	const outOfStock = useMemo(() => (tracked ? isOutOfStock(item) : false), [item, tracked]);
	const hasThreshold = useMemo(() => (tracked ? hasReorderPoint(item) : false), [item, tracked]);
	const onHandLabel = useMemo(
		() => (showOnHandUnit ? formatOnHand(item) : formatOnHandValue(item)),
		[item, showOnHandUnit],
	);

	const categoryName = useMemo(() => {
		const raw = typeof item.category?.name === "string" ? item.category.name : "";
		return raw.trim();
	}, [item.category?.name]);
	const hasCategory = useMemo(() => {
		if (!categoryName) return false;
		return categoryName.toLowerCase() !== "none";
	}, [categoryName]);
	const categoryLabel = useMemo(() => (hasCategory ? categoryName : "None"), [categoryName, hasCategory]);

	const resolvedCategoryColor = useMemo(() => {
		if (typeof categoryColor === "string" && categoryColor.trim()) return categoryColor.trim();
		if (typeof item.category?.color === "string" && item.category.color.trim()) return item.category.color.trim();
		return null;
	}, [categoryColor, item.category?.color]);

	const activeStyle = useMemo(() => {
		if (!active) return null;

		// subtle, theme-safe highlight (no custom colors)
		return {
			backgroundColor: theme.colors.surfaceVariant,
			borderColor: theme.colors.outline,
		};
	}, [active, theme.colors.outline, theme.colors.surfaceVariant]);

	const categoryDotStyle = useMemo(() => {
		const fill = resolvedCategoryColor ? resolvedCategoryColor : "transparent";
		const stroke = resolvedCategoryColor ? resolvedCategoryColor : borderColor;
		return {
			backgroundColor: fill,
			borderColor: stroke,
		};
	}, [borderColor, resolvedCategoryColor]);

	const servicePriceLabel = useMemo(() => {
		if (!isServiceItem) return "";
		const rawPrice = (item as any)?.price;
		if (rawPrice == null) return "—";
		return formatMoney({ amount: rawPrice, currencyCode });
	}, [currencyCode, isServiceItem, item]);
	const serviceDurationLabel = useMemo(() => {
		if (!isServiceItem) return "";

		const resolvedMinutes = resolveServiceDurationMinutes(item);
		if (resolvedMinutes != null) return formatDurationLabel(resolvedMinutes);

		// Backward-compat fallback for payloads that still expose legacy service duration keys.
		const legacyDuration = (item as { serviceDurationMins?: unknown; serviceDurationMinutes?: unknown })
			.serviceDurationMins;
		const legacyDurationMinutes =
			legacyDuration ??
			(item as { serviceDurationMins?: unknown; serviceDurationMinutes?: unknown }).serviceDurationMinutes;
		const raw = typeof legacyDurationMinutes === "number" ? legacyDurationMinutes : Number(legacyDurationMinutes);
		if (!Number.isFinite(raw) || raw <= 0) return "";
		return formatDurationLabel(raw);
	}, [isServiceItem, item]);
	const statusLabel = outOfStock ? "Out stock" : low ? "Low stock" : hasThreshold ? "On hand" : "On hand";
	const rightPrimaryText = isServiceItem ? servicePriceLabel : onHandLabel;
	const rightSecondaryText = isServiceItem ? serviceDurationLabel : statusLabel;

	const warningColor = theme.dark ? baiSemanticColors.warning.dark : baiSemanticColors.warning.main;
	const statusColor = isServiceItem ? undefined : outOfStock ? theme.colors.error : low ? warningColor : undefined;
	const imageUri = String(item.primaryImageUrl ?? "").trim();
	const posTileColor = typeof item.posTileColor === "string" ? item.posTileColor.trim() : "";
	const normalizedTileColor = posTileColor.toLowerCase();
	const imageKey = useMemo(() => (imageUri ? imageUri.split("?")[0] : ""), [imageUri]);
	const showImageTile = item.posTileMode === "IMAGE" && !!imageUri;
	const isDefaultServiceTile =
		isServiceItem && normalizedTileColor.length > 0 && normalizedTileColor === DEFAULT_SERVICE_TILE_COLOR;
	const showColorTile = item.posTileMode === "COLOR" && !!posTileColor && !isDefaultServiceTile;
	const showPlaceholder = !showImageTile && !showColorTile;
	const placeholderBg = theme.colors.surfaceDisabled ?? theme.colors.surfaceVariant ?? theme.colors.surface;
	const placeholderTextColor = theme.colors.onSurfaceVariant ?? theme.colors.onSurface;
	const [thumbLoaded, setThumbLoaded] = useState(false);
	const lastImageKeyRef = useRef<string | null>(null);
	const thumbnailInitials = String(item.name ?? "")
		.trim()
		.slice(0, 2)
		.toUpperCase();

	// For image Testing

	// useEffect(() => {
	// 	if (imageUri) {
	// 		console.log("PRIMARY_IMAGE_URL_SAMPLE:", imageUri);
	// 	}
	// }, [imageUri]);

	useEffect(() => {
		if (!imageUri) {
			lastImageKeyRef.current = null;
			setThumbLoaded(false);
			return;
		}

		// Avoid resetting on signed URL refreshes; only reset when the base image key changes.
		if (lastImageKeyRef.current !== imageKey) {
			lastImageKeyRef.current = imageKey;
			setThumbLoaded(false);
		}

		void ExpoImage.prefetch(imageUri, "memory-disk");
	}, [imageKey, imageUri]);

	useEffect(() => {
		let isActive = true;

		if (imageUri) {
			void ExpoImage.getCachePathAsync(imageUri).then((path) => {
				if (!isActive) return;
				if (path) setThumbLoaded(true);
			});
		}

		return () => {
			isActive = false;
		};
	}, [imageUri]);

	const showLoadingPlaceholder = showImageTile && !thumbLoaded;
	const showThumbnailInitials = (!showImageTile || showLoadingPlaceholder) && thumbnailInitials.length > 0;

	return (
		<Pressable
			onPress={onPress}
			disabled={disabled}
			style={({ pressed }) => [
				styles.row,
				{ borderColor, backgroundColor: pressed && !disabled ? pressedBg : surfaceAlt },
				activeStyle,
				disabled && { opacity: 0.45 },
			]}
		>
			<View style={styles.rowMain}>
				<View
					style={[
						styles.thumbnail,
						{ borderColor: disabled ? disabledThumbBorderColor : borderColor },
						showColorTile && { backgroundColor: posTileColor },
						(showPlaceholder || showLoadingPlaceholder) && { backgroundColor: placeholderBg },
					]}
				>
					{showImageTile ? (
						<ExpoImage
							source={{ uri: imageUri }}
							style={[styles.thumbnailImage, { opacity: thumbLoaded ? 1 : 0 }]}
							contentFit='cover'
							cachePolicy='memory-disk'
							transition={0}
							priority='high'
							recyclingKey={item.id}
							onLoad={() => setThumbLoaded(true)}
							onError={() => setThumbLoaded(false)}
						/>
					) : null}
					{showThumbnailInitials ? (
						<BAIText variant='body' style={{ color: placeholderTextColor }}>
							{thumbnailInitials}
						</BAIText>
					) : null}
				</View>

				<View style={styles.left}>
					<BAIText variant='subtitle' numberOfLines={1}>
						{item.name}
					</BAIText>

					<View style={styles.metaBlock}>
						<View style={[styles.categoryDot, categoryDotStyle]} />
						<BAIText variant='caption' numberOfLines={1} style={styles.metaValue}>
							{categoryLabel}
						</BAIText>
					</View>
				</View>
			</View>

			<View style={styles.right}>
				<BAIText variant='subtitle' style={statusColor ? { color: statusColor } : undefined}>
					{rightPrimaryText}
				</BAIText>

				<BAIText variant='caption' muted={!statusColor} style={statusColor ? { color: statusColor } : undefined}>
					{rightSecondaryText}
				</BAIText>
			</View>
		</Pressable>
	);
}

export const InventoryRow = memo(InventoryRowBase);

const styles = StyleSheet.create({
	row: {
		paddingHorizontal: 12,
		paddingVertical: 8,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		borderWidth: 1,
		borderRadius: 12,
		gap: 12,
	},
	rowMain: {
		flexDirection: "row",
		alignItems: "center",
		flex: 1,
		minWidth: 0,
		gap: 12,
	},
	left: {
		flex: 1,
		minWidth: 0,
		gap: 3,
	},
	thumbnail: {
		width: 50,
		height: 50,
		borderRadius: 10,
		borderWidth: StyleSheet.hairlineWidth,
		alignItems: "center",
		justifyContent: "center",
		position: "relative",
		overflow: "hidden",
	},
	thumbnailImage: {
		...StyleSheet.absoluteFillObject,
	},
	metaBlock: {
		flexDirection: "row",
		alignItems: "center",
	},
	metaLine: {
		flexDirection: "row",
		alignItems: "center",
		gap: 6,
	},
	metaValue: {
		flexShrink: 1,
	},
	categoryDot: {
		width: 12,
		height: 12,
		borderRadius: 9,
		borderWidth: 1,
		marginRight: 4,
	},
	inactiveBadge: {
		borderWidth: 1,
		borderRadius: 999,
		paddingHorizontal: 8,
		paddingVertical: 2,
	},
	inactiveBadgeText: {
		fontSize: 11,
	},
	right: {
		alignItems: "flex-end",
		gap: 2,
	},
});
