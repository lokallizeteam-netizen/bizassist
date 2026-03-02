import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { ReactNode } from "react";
import { Pressable, StyleProp, StyleSheet, View, ViewStyle } from "react-native";

import { BAIText } from "@/components/ui/BAIText";

type SettingsScreenLayoutProps = {
	children: ReactNode;
	maxWidth?: number;
	screenStyle?: StyleProp<ViewStyle>;
	centerWrapStyle?: StyleProp<ViewStyle>;
	columnStyle?: StyleProp<ViewStyle>;
};

type SettingsListRowProps = {
	title: string;
	subtitle?: string;
	value?: string;
	onPress?: () => void;
	disabled?: boolean;
	leading?: ReactNode;
	showChevron?: boolean;
	isLast?: boolean;
	borderColor: string;
	onSurface: string;
	onSurfaceVariant: string;
};

export function SettingsScreenLayout({
	children,
	maxWidth = 560,
	screenStyle,
	centerWrapStyle,
	columnStyle,
}: SettingsScreenLayoutProps) {
	return (
		<View style={[styles.screen, screenStyle]}>
			<View style={[styles.centerWrap, centerWrapStyle]}>
				<View style={[styles.column, maxWidth ? { maxWidth } : null, columnStyle]}>{children}</View>
			</View>
		</View>
	);
}

export function SettingsSectionTitle({ children }: { children: ReactNode }) {
	return <BAIText variant='title'>{children}</BAIText>;
}

export function SettingsListRow({
	title,
	subtitle,
	value,
	onPress,
	disabled,
	leading,
	showChevron,
	isLast,
	borderColor,
	onSurface,
	onSurfaceVariant,
}: SettingsListRowProps) {
	const chevronVisible = showChevron ?? !!onPress;

	return (
		<Pressable
			onPress={onPress}
			disabled={!onPress || disabled}
			style={({ pressed }) => [
				styles.row,
				{ borderBottomColor: borderColor, borderBottomWidth: isLast ? 0 : 1, opacity: disabled ? 0.55 : 1 },
				pressed && onPress ? styles.rowPressed : null,
			]}
		>
			<View style={styles.rowLeft}>
				{leading ? <View style={styles.leadingWrap}>{leading}</View> : null}
				<View style={styles.rowTextWrap}>
					<BAIText variant='body' style={{ color: onSurface }}>
						{title}
					</BAIText>
					{subtitle ? (
						<BAIText variant='caption' style={{ color: onSurfaceVariant }}>
							{subtitle}
						</BAIText>
					) : null}
				</View>
			</View>

			<View style={styles.rowRight}>
				{value ? (
					<BAIText variant='body' style={{ color: onSurfaceVariant }}>
						{value}
					</BAIText>
				) : null}
				{chevronVisible && onPress && !disabled ? (
					<MaterialCommunityIcons name='chevron-right' size={24} color={onSurfaceVariant} />
				) : null}
			</View>
		</Pressable>
	);
}

export function SettingsCircleIcon({
	children,
	borderColor,
}: {
	children: ReactNode;
	borderColor: string;
}) {
	return <View style={[styles.iconCircle, { borderColor }]}>{children}</View>;
}

const styles = StyleSheet.create({
	screen: {
		flex: 1,
		padding: 12,
	},
	centerWrap: {
		flex: 1,
		alignItems: "center",
		justifyContent: "flex-start",
	},
	column: {
		width: "100%",
		gap: 12,
	},
	row: {
		paddingHorizontal: 12,
		paddingVertical: 12,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		gap: 12,
	},
	rowPressed: { opacity: 0.85 },
	rowLeft: {
		flexDirection: "row",
		alignItems: "center",
		gap: 12,
		flex: 1,
		paddingRight: 10,
	},
	leadingWrap: {
		alignItems: "center",
		justifyContent: "center",
	},
	iconCircle: {
		width: 38,
		height: 38,
		borderRadius: 19,
		alignItems: "center",
		justifyContent: "center",
		borderWidth: 1,
	},
	rowTextWrap: { flex: 1, minWidth: 0, gap: 2 },
	rowRight: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		gap: 8,
	},
});