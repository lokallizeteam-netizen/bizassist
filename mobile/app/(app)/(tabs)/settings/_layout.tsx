// BizAssist_mobile
// path: app/(app)/(tabs)/settings/_layout.tsx
//
// Settings stack layout.
// Governance:
// - Primary screens use flat, full-width stack headers.
// - Workspace root (settings/index) hides stack header; in-content title remains.

import React, { useMemo } from "react";
import { Platform } from "react-native";
import { Stack } from "expo-router";
import { useTheme } from "react-native-paper";

export default function SettingsStackLayout() {
	const theme = useTheme();

	const headerStyle = useMemo(
		() => ({
			backgroundColor: theme.colors.background,
			...(Platform.OS === "android" ? { elevation: 0, borderBottomWidth: 0 } : {}),
		}),
		[theme.colors.background],
	);

	const headerTintColor = useMemo(() => theme.colors.onBackground, [theme.colors.onBackground]);
	const headerTitleStyle = useMemo(
		() => ({
			color: theme.colors.onBackground,
			fontSize: 18,
			fontWeight: "600" as const,
		}),
		[theme.colors.onBackground],
	);

	const headerBackTitleStyle = useMemo(
		() => ({
			fontSize: 14,
			fontWeight: "500" as const,
			color: theme.colors.onSurfaceVariant ?? theme.colors.onBackground,
		}),
		[theme.colors.onSurfaceVariant, theme.colors.onBackground],
	);

	return (
		<Stack
			screenOptions={{
				headerShown: true,
				headerTitleAlign: "center",
				contentStyle: { backgroundColor: theme.colors.background },
				headerBackTitle: "",
				headerStyle,
				headerTintColor,
				headerTitleStyle,
				headerBackTitleStyle,
				headerShadowVisible: false,
			}}
		>
			<Stack.Screen name='index' options={{ headerShown: false, animation: "none" }} />
		</Stack>
	);
}
