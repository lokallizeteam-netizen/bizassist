// BizAssist_mobile path: src/modules/pos/components/PosCatalogListShell.tsx
import React, { useMemo } from "react";
import { StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import { useTheme } from "react-native-paper";

import { BAIEmptyStateButton } from "@/components/ui/BAIEmptyStateButton";
import { BAIRetryButton } from "@/components/ui/BAIRetryButton";
import { BAIActivityIndicator } from "@/components/system/BAIActivityIndicator";
import { BAISurface } from "@/components/ui/BAISurface";
import { BAIText } from "@/components/ui/BAIText";

type PosCatalogListShellProps = {
	title?: string; // default "Catalog"
	countLabel: string;
	showTitleAndCount?: boolean;
	showSyncBadge?: boolean;
	headerContent?: React.ReactNode;

	isLoading: boolean;
	isFetching: boolean;
	isError: boolean;

	onRetry: () => void;

	emptyTitle: string;
	emptyBody: string;

	primaryCtaLabel?: string;
	onPrimaryCta?: () => void;

	containerStyle?: StyleProp<ViewStyle>;
	children: React.ReactNode; // FlatList or null
};

export function PosCatalogListShell(props: PosCatalogListShellProps) {
	const theme = useTheme();
	const borderColor = theme.colors.outlineVariant ?? theme.colors.outline;

	const syncLabel = useMemo(() => {
		if (props.isFetching) return "Syncing…";
		if (props.isError) return "Sync failed";
		return "Synced";
	}, [props.isError, props.isFetching]);

	const syncColor = props.isError ? theme.colors.error : (theme.colors.onSurfaceVariant ?? theme.colors.onSurface);
	const syncOpacity = 1;
	const syncBg = props.isError
		? (theme.colors.errorContainer ?? theme.colors.error)
		: (theme.colors.surfaceVariant ?? theme.colors.surface);
	const title = props.title ?? "Catalog";
	const showTitleAndCount = props.showTitleAndCount ?? true;
	const showSyncBadge = props.showSyncBadge ?? true;
	const shouldShowHeader = showTitleAndCount || showSyncBadge;

	return (
		<BAISurface style={[styles.shell, props.containerStyle]} padded={false}>
			{shouldShowHeader ? (
				<View style={[styles.header, { borderBottomColor: borderColor }]}>
					{showTitleAndCount ? (
						<View style={{ flex: 1 }}>
							<BAIText variant='subtitle'>{title}</BAIText>
							<BAIText variant='caption' muted>
								{props.countLabel}
							</BAIText>
						</View>
					) : (
						<View style={styles.headerSpacer} />
					)}

					{showSyncBadge ? (
						<View
							style={[
								styles.syncBadge,
								{
									borderColor: syncColor,
									backgroundColor: syncBg,
									opacity: syncOpacity,
								},
							]}
						>
							<BAIText variant='caption' muted={false} style={{ color: syncColor, fontWeight: "600" }}>
								{syncLabel}
							</BAIText>
						</View>
					) : null}
				</View>
			) : null}

			{props.headerContent ? (
				<View style={[styles.headerContent, { borderBottomColor: borderColor }]}>{props.headerContent}</View>
			) : null}

			{props.isLoading ? (
				<View style={styles.center}>
					<BAIActivityIndicator />
				</View>
			) : props.isError ? (
				<View style={styles.emptyState}>
					<BAIText variant='title' style={styles.emptyTitle}>
						Sync failed
					</BAIText>

					<BAIText variant='body' muted style={styles.emptyBody}>
						We couldn’t load the catalog right now. Pull to refresh, or check your connection.
					</BAIText>

					<BAIRetryButton
						mode='contained'
						onPress={props.onRetry}
						disabled={props.isFetching}
						style={{ marginTop: 12 }}
					>
						Retry
					</BAIRetryButton>
				</View>
			) : props.children ? (
				props.children
			) : (
				<View style={styles.emptyState}>
					<BAIText variant='title' style={styles.emptyTitle}>
						{props.emptyTitle}
					</BAIText>

					<BAIText variant='body' muted style={styles.emptyBody}>
						{props.emptyBody}
					</BAIText>

					{props.primaryCtaLabel && props.onPrimaryCta ? (
						<BAIEmptyStateButton
							mode='contained'
							onPress={props.onPrimaryCta}
							style={{ marginTop: 12 }}
							label={props.primaryCtaLabel}
						/>
					) : null}
				</View>
			)}
		</BAISurface>
	);
}

const styles = StyleSheet.create({
	shell: { flex: 1, minHeight: 0, overflow: "hidden" },

	header: {
		paddingHorizontal: 12,
		paddingTop: 12,
		paddingBottom: 10,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		gap: 10,
	},
	headerSpacer: { flex: 1 },
	headerContent: {
		paddingHorizontal: 12,
		paddingTop: 0,
		paddingBottom: 8,
		borderBottomWidth: StyleSheet.hairlineWidth,
	},
	syncBadge: {
		paddingHorizontal: 10,
		paddingVertical: 4,
		borderRadius: 999,
		borderWidth: 0,
	},

	center: { padding: 16, alignItems: "center", justifyContent: "center" },

	emptyState: { padding: 16, alignItems: "center" },
	emptyTitle: { textAlign: "center" },
	emptyBody: { textAlign: "center", marginTop: 8, maxWidth: 420 },
});
