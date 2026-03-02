import { Stack, useRouter } from "expo-router";
import { useCallback } from "react";
import { StyleSheet } from "react-native";
import { useTheme } from "react-native-paper";

import { SettingsListRow, SettingsScreenLayout, SettingsSectionTitle } from "@/components/settings/SettingsLayout";
import { BAIScreen } from "@/components/ui/BAIScreen";
import { BAISurface } from "@/components/ui/BAISurface";
import { useAppHeader } from "@/modules/navigation/useAppHeader";

type CheckoutRow = {
	key: string;
	title: string;
	value?: string;
	onPress?: () => void;
};

export default function CheckoutSettingsScreen() {
	const router = useRouter();
	const theme = useTheme();

	const onBack = useCallback(() => {
		if (router.canGoBack?.()) {
			router.back();
			return;
		}
		router.replace("/(app)/(tabs)/settings" as any);
	}, [router]);

	const headerOptions = useAppHeader("detail", { title: "Checkout", onBack });

	const borderColor = theme.colors.outlineVariant ?? theme.colors.outline;
	const onSurface = theme.colors.onSurface;
	const onSurfaceVariant = theme.colors.onSurfaceVariant ?? theme.colors.onSurface;

	const rows: CheckoutRow[] = [
		{ key: "quick", title: "Quick amounts", value: "Off" },
		{
			key: "taxes",
			title: "Sales taxes",
			onPress: () => router.push("/(app)/(tabs)/settings/checkout/sales-taxes" as any),
		},
		{ key: "tickets", title: "Order tickets", value: "Manual" },
		{ key: "payment", title: "Payment" },
		{ key: "crm", title: "Customer management", value: "On" },
	];

	return (
		<>
			<Stack.Screen options={headerOptions} />
			<BAIScreen tabbed padded={false} safeTop={false}>
				<SettingsScreenLayout>
					<SettingsSectionTitle>Checkout</SettingsSectionTitle>
					<BAISurface bordered padded={false} style={styles.card}>
						{rows.map((item, index) => (
							<SettingsListRow
								key={item.key}
								title={item.title}
								value={item.value}
								onPress={item.onPress}
								isLast={index === rows.length - 1}
								borderColor={borderColor}
								onSurface={onSurface}
								onSurfaceVariant={onSurfaceVariant}
							/>
						))}
					</BAISurface>
				</SettingsScreenLayout>
			</BAIScreen>
		</>
	);
}

const styles = StyleSheet.create({
	card: {
		borderRadius: 18,
		overflow: "hidden",
	},
});
