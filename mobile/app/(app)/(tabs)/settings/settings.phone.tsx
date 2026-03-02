// BizAssist_mobile
// path: app/(app)/(tabs)/settings/settings.phone.tsx

import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { StyleSheet } from "react-native";
import { useTheme } from "react-native-paper";

import { BAIButton } from "@/components/ui/BAIButton";
import { BAIScreen } from "@/components/ui/BAIScreen";
import { BAISurface } from "@/components/ui/BAISurface";
import { BAIText } from "@/components/ui/BAIText";
import {
	SettingsCircleIcon,
	SettingsListRow,
	SettingsScreenLayout,
	SettingsSectionTitle,
} from "@/components/settings/SettingsLayout";

import { ConfirmActionModal } from "@/components/settings/ConfirmActionModal";
import { useColorSchemeController } from "@/hooks/use-color-scheme";
import { useAppBusy } from "@/hooks/useAppBusy";
import { useAuth } from "@/modules/auth/AuthContext";

type MaterialIconName = keyof typeof MaterialCommunityIcons.glyphMap;

type SettingsRowBase = {
	key: string;
	title: string;
	subtitle?: string;
	icon: MaterialIconName;
	onPress?: () => void;
	disabled?: boolean;
};

type SettingsRow = SettingsRowBase;

function modeLabel(mode: "system" | "light" | "dark") {
	if (mode === "system") return "System";
	if (mode === "light") return "Light";
	return "Dark";
}

export default function SettingsPhoneScreen() {
	const theme = useTheme();
	const router = useRouter();
	const { logout } = useAuth();
	const { withBusy, busy } = useAppBusy();
	const { mode } = useColorSchemeController();

	const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
	const [logoutBusy, setLogoutBusy] = useState(false);

	// Idempotency guard (prevents double confirms / re-entrancy)
	const logoutInFlightRef = useRef(false);

	const isBusy = busy.isBusy || logoutBusy;

	const borderColor = theme.colors.outlineVariant ?? theme.colors.outline;
	const onSurface = theme.colors.onSurface;
	const onSurfaceVariant = theme.colors.onSurfaceVariant ?? theme.colors.onSurface;
	const iconTint = onSurfaceVariant;

	const rows: SettingsRow[] = useMemo(
		() => [
			{
				key: "displayMode",
				title: "Display Mode",
				subtitle: modeLabel(mode),
				icon: "circle-half-full",
				onPress: () => router.push("/(app)/(tabs)/settings/display-mode"),
			},
			{
				key: "units",
				title: "Units",
				subtitle: "Manage units and measurements",
				icon: "ruler-square",
				onPress: () => router.push("/(app)/(tabs)/settings/units"),
			},
			{
				key: "checkout",
				title: "Checkout",
				subtitle: "Tax and checkout behavior",
				icon: "credit-card-outline",
				onPress: () => router.push("/(app)/(tabs)/settings/checkout"),
			},
			{
				key: "devices",
				title: "Devices",
				subtitle: "Connected devices (v1: placeholder)",
				icon: "cellphone",
				onPress: () => {},
				disabled: true,
			},
			{
				key: "about",
				title: "About",
				subtitle: "Version, legal, and support",
				icon: "information-outline",
				onPress: () => {},
				disabled: true,
			},
		],
		[mode, router],
	);

	const handleLogoutPress = useCallback(() => {
		if (isBusy) return;
		setShowLogoutConfirm(true);
	}, [isBusy]);

	const handleDismissLogout = useCallback(() => {
		if (isBusy) return;
		setShowLogoutConfirm(false);
	}, [isBusy]);

	const handleConfirmLogout = useCallback(async () => {
		if (logoutInFlightRef.current) return;

		// Close modal immediately to avoid any tap-through/race
		setShowLogoutConfirm(false);

		logoutInFlightRef.current = true;
		setLogoutBusy(true);

		try {
			/**
			 * Correct logout governance:
			 * - Settings must NOT route to /(system)/bootstrap first (race condition).
			 * - AuthContext.logout() is the single source of truth:
			 *   clears tokens/state, then router.replace("/(auth)/index").
			 */
			await withBusy("Logging out…", async () => {
				await Promise.resolve(logout());
			});
		} finally {
			logoutInFlightRef.current = false;
			setLogoutBusy(false);
		}
	}, [logout, withBusy]);

	return (
		<BAIScreen tabbed>
			<SettingsScreenLayout>
				<SettingsSectionTitle>Settings</SettingsSectionTitle>

				<BAISurface style={styles.card} padded={false}>
					{rows.map((item, index) => (
						<SettingsListRow
							key={item.key}
							title={item.title}
							subtitle={item.subtitle}
							onPress={item.onPress}
							disabled={item.disabled}
							leading={
								<SettingsCircleIcon borderColor={borderColor}>
									<MaterialCommunityIcons name={item.icon} size={20} color={iconTint} />
								</SettingsCircleIcon>
							}
							isLast={index === rows.length - 1}
							borderColor={borderColor}
							onSurface={onSurface}
							onSurfaceVariant={onSurfaceVariant}
						/>
					))}
				</BAISurface>

				<BAISurface style={styles.footer} padded>
					<BAIButton intent='neutral' variant='outline' onPress={handleLogoutPress} disabled={isBusy}>
						Log Out
					</BAIButton>

					<BAIText variant='caption' style={[styles.hint, { color: onSurfaceVariant }]}>
						Settings are intentionally minimal in v1.
					</BAIText>
				</BAISurface>
			</SettingsScreenLayout>

			<ConfirmActionModal
				visible={showLogoutConfirm}
				title='Log out?'
				message='Are you sure you want to log out?'
				confirmLabel='Log Out'
				cancelLabel='Cancel'
				confirmIntent='danger'
				onDismiss={handleDismissLogout}
				onConfirm={handleConfirmLogout}
				disabled={isBusy}
			/>
		</BAIScreen>
	);
}

const styles = StyleSheet.create({
	card: { borderRadius: 18, overflow: "hidden" },
	footer: { borderRadius: 18, gap: 10 },
	hint: { opacity: 0.9 },
});
