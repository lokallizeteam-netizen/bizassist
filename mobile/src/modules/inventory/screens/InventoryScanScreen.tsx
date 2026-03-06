// path: app/(app)/(tabs)/inventory/scan.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	View,
	Pressable,
	StyleSheet,
	AppState,
	ScrollView,
	useWindowDimensions,
	type AppStateStatus,
	type LayoutChangeEvent,
} from "react-native";
import * as ReactNative from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useTheme } from "react-native-paper";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BAIHeader } from "@/components/ui/BAIHeader";
import { BAIScreen } from "@/components/ui/BAIScreen";
import { BAISurface } from "@/components/ui/BAISurface";
import { BAIText } from "@/components/ui/BAIText";
import { BAIButton } from "@/components/ui/BAIButton";
import { BAICTAButton } from "@/components/ui/BAICTAButton";
import { BAIIconButton } from "@/components/ui/BAIIconButton";
import { BAITextInput } from "@/components/ui/BAITextInput";
import {
	openAppSettings,
	requestCameraAccessWith,
	type PermissionFlowState,
} from "@/modules/inventory/inventory.permissions";
import { useAppToast } from "@/providers/AppToastProvider";
import { sanitizeGtinInput } from "@/shared/validation/gtin";

/**
 * Canonical: Inventory search consumes query param "q"
 * (works for both phone + tablet screens via useLocalSearchParams)
 */
const RETURN_TO = "/inventory" as const;
const SCANNED_BARCODE_KEY = "scannedBarcode" as const;
const SCAN_FALLBACK_CONFIRM_MS = 900;
const SCAN_FALLBACK_CONFIRM_COUNT = 2;
const PHONE_SCAN_MIN = 220;
const PHONE_SCAN_MAX = 320;
const TABLET_SCAN_MIN = 280;
const TABLET_SCAN_MAX = 420;

type Point = { x: number; y: number };
type Rect = { x: number; y: number; width: number; height: number };
type ScanEvent = {
	data?: string;
	cornerPoints?: Array<{ x?: number | null; y?: number | null }>;
	bounds?: {
		x?: number | null;
		y?: number | null;
		width?: number | null;
		height?: number | null;
		origin?: { x?: number | null; y?: number | null };
		size?: { width?: number | null; height?: number | null };
	} | null;
};

function normalizeScanValue(raw: string): string {
	return raw.trim().replace(/\s+/g, " ");
}

function finite(v: unknown): number | null {
	if (typeof v !== "number") return null;
	return Number.isFinite(v) ? v : null;
}

function centerFromCorners(corners: Array<{ x?: number | null; y?: number | null }> | undefined): Point | null {
	if (!Array.isArray(corners) || corners.length === 0) return null;
	let sumX = 0;
	let sumY = 0;
	let count = 0;
	for (const p of corners) {
		const x = finite(p?.x);
		const y = finite(p?.y);
		if (x === null || y === null) continue;
		sumX += x;
		sumY += y;
		count += 1;
	}
	if (count === 0) return null;
	return { x: sumX / count, y: sumY / count };
}

function centerFromBounds(bounds: ScanEvent["bounds"]): Point | null {
	if (!bounds) return null;

	const ox = finite(bounds.origin?.x) ?? finite(bounds.x);
	const oy = finite(bounds.origin?.y) ?? finite(bounds.y);
	const w = finite(bounds.size?.width) ?? finite(bounds.width);
	const h = finite(bounds.size?.height) ?? finite(bounds.height);

	if (ox === null || oy === null || w === null || h === null) return null;
	if (w <= 0 || h <= 0) return null;

	return { x: ox + w / 2, y: oy + h / 2 };
}

function getEventCenter(event: ScanEvent): Point | null {
	return centerFromCorners(event.cornerPoints) ?? centerFromBounds(event.bounds);
}

function pointInRect(point: Point, rect: Rect): boolean {
	return point.x >= rect.x && point.y >= rect.y && point.x <= rect.x + rect.width && point.y <= rect.y + rect.height;
}

export default function InventoryScanScreen() {
	const router = useRouter();
	const theme = useTheme();
	const insets = useSafeAreaInsets();
	const { width, height } = useWindowDimensions();
	const isTablet = Math.min(width, height) >= 600;
	const { showError, showSuccess } = useAppToast();
	const params = useLocalSearchParams<{
		returnTo?: string;
		draftId?: string;
		scanIntent?: string;
		scanOriginWorkspace?: string;
	}>();
	const scanIntent = useMemo(() => {
		const raw = typeof params.scanIntent === "string" ? params.scanIntent.trim().toLowerCase() : "";
		if (raw === "universal") return "universal" as const;
		return "contextual" as const;
	}, [params.scanIntent]);
	const isUniversalMode = scanIntent === "universal";
	const returnTo = useMemo(() => {
		const raw = typeof params.returnTo === "string" ? params.returnTo.trim() : "";
		return raw.startsWith("/") ? raw : null;
	}, [params.returnTo]);
	const returnDraftId = useMemo(() => {
		const raw = typeof params.draftId === "string" ? params.draftId.trim() : "";
		return raw || null;
	}, [params.draftId]);

	const [permission, requestPermission] = useCameraPermissions();
	const [permissionHint, setPermissionHint] = useState<string>("");
	const [torchEnabled, setTorchEnabled] = useState(false);

	const lockRef = useRef(false);
	const [lockedUI, setLockedUI] = useState(false);
	const [universalScannedValue, setUniversalScannedValue] = useState("");
	const [universalOpen, setUniversalOpen] = useState(false);
	const [universalCardHeight, setUniversalCardHeight] = useState(0);
	const [previewFrame, setPreviewFrame] = useState<{ width: number; height: number } | null>(null);
	const [scanStageOrigin, setScanStageOrigin] = useState<{ x: number; y: number } | null>(null);
	const [scanWindowLayout, setScanWindowLayout] = useState<{
		x: number;
		y: number;
		width: number;
		height: number;
	} | null>(null);

	const unlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const fallbackConfirmRef = useRef<{ value: string; ts: number; count: number }>({ value: "", ts: 0, count: 0 });

	const frameGateRect = useMemo<Rect | null>(() => {
		if (!scanStageOrigin || !scanWindowLayout) return null;
		if (scanWindowLayout.width <= 0 || scanWindowLayout.height <= 0) return null;
		return {
			x: scanStageOrigin.x + scanWindowLayout.x,
			y: scanStageOrigin.y + scanWindowLayout.y,
			width: scanWindowLayout.width,
			height: scanWindowLayout.height,
		};
	}, [scanStageOrigin, scanWindowLayout]);

	const bottomReserve = useMemo(() => Math.max(insets.bottom, 12) + (isTablet ? 88 : 84), [insets.bottom, isTablet]);
	const universalMaxHeight = useMemo(() => Math.round(height * (isTablet ? 0.34 : 0.42)), [height, isTablet]);
	const estimatedUniversalHeight = useMemo(() => {
		if (!universalOpen) return 0;
		if (universalCardHeight > 0) return Math.min(universalCardHeight, universalMaxHeight);
		return universalMaxHeight;
	}, [universalCardHeight, universalMaxHeight, universalOpen]);

	const scanWindowSize = useMemo(() => {
		const min = isTablet ? TABLET_SCAN_MIN : PHONE_SCAN_MIN;
		const max = isTablet ? TABLET_SCAN_MAX : PHONE_SCAN_MAX;
		if (!previewFrame) return isTablet ? 320 : 280;

		const topZoneReserve = isTablet ? 168 : 156;
		const available =
			previewFrame.height - topZoneReserve - bottomReserve - (universalOpen ? estimatedUniversalHeight : 0);
		const target = Math.round(available * (isTablet ? 0.75 : 0.92));
		return Math.max(min, Math.min(max, target));
	}, [bottomReserve, estimatedUniversalHeight, isTablet, previewFrame, universalOpen]);

	const scanStagePaddingTop = useMemo(() => (isTablet ? 78 : 66), [isTablet]);

	const setLocked = useCallback((v: boolean) => {
		lockRef.current = v;
		setLockedUI(v);
	}, []);

	const unlockSafetyTimer = useCallback(() => {
		if (unlockTimerRef.current) clearTimeout(unlockTimerRef.current);
		unlockTimerRef.current = setTimeout(() => {
			setLocked(false);
		}, 1500);
	}, [setLocked]);

	useEffect(() => {
		if (!permission) return;
		if (!permission.granted && permission.canAskAgain !== false) requestPermission().catch(() => {});
	}, [permission, requestPermission]);

	const onRequestCameraPermission = useCallback(async () => {
		const state: PermissionFlowState = await requestCameraAccessWith(requestPermission);
		if (state === "granted") {
			setPermissionHint("");
			return;
		}

		if (state === "blocked") {
			setPermissionHint("Camera access is blocked. Open Settings to allow camera access for BizAssist.");
			return;
		}

		setPermissionHint("Camera permission is required to scan barcodes.");
	}, [requestPermission]);

	const onOpenSettings = useCallback(async () => {
		const opened = await openAppSettings();
		if (opened) return;
		setPermissionHint("Unable to open Settings right now. Please open Settings and allow camera access for BizAssist.");
	}, []);

	useEffect(() => {
		const onAppStateChange = (state: AppStateStatus) => {
			if (state === "active") setLocked(false);
		};
		const sub = AppState.addEventListener("change", onAppStateChange);
		return () => sub.remove();
	}, [setLocked]);

	useEffect(() => {
		return () => {
			if (unlockTimerRef.current) clearTimeout(unlockTimerRef.current);
		};
	}, []);

	const onCancel = useCallback(() => {
		setLocked(false);
		setUniversalOpen(false);
		setUniversalScannedValue("");
		setTorchEnabled(false);
		if (returnTo) {
			router.replace({
				pathname: returnTo as any,
				params: returnDraftId ? { draftId: returnDraftId } : undefined,
			} as any);
			return;
		}
		router.replace(RETURN_TO as any);
	}, [returnDraftId, returnTo, router, setLocked]);

	const closeUniversalSheet = useCallback(() => {
		setUniversalOpen(false);
		setUniversalScannedValue("");
		setLocked(false);
	}, [setLocked]);

	const openUniversalSheet = useCallback(
		(value: string) => {
			setUniversalScannedValue(sanitizeGtinInput(value));
			setUniversalOpen(true);
			setLocked(true);
		},
		[setLocked],
	);

	const onUniversalBarcodeChange = useCallback((next: string) => {
		setUniversalScannedValue(sanitizeGtinInput(next));
	}, []);

	const normalizedUniversalValue = useMemo(
		() => sanitizeGtinInput(universalScannedValue).trim(),
		[universalScannedValue],
	);
	const canRunUniversalAction = normalizedUniversalValue.length > 0;

	const onUniversalSearchInventory = useCallback(() => {
		if (!canRunUniversalAction) return;
		closeUniversalSheet();
		router.replace({
			pathname: "/(app)/(tabs)/inventory" as any,
			params: { q: normalizedUniversalValue },
		} as any);
	}, [canRunUniversalAction, closeUniversalSheet, normalizedUniversalValue, router]);

	const onUniversalCreateItem = useCallback(() => {
		if (!canRunUniversalAction) return;
		closeUniversalSheet();
		router.replace({
			pathname: "/(app)/(tabs)/inventory/products/create" as any,
			params: { [SCANNED_BARCODE_KEY]: normalizedUniversalValue },
		} as any);
	}, [canRunUniversalAction, closeUniversalSheet, normalizedUniversalValue, router]);

	const onUniversalFindInPos = useCallback(() => {
		if (!canRunUniversalAction) return;
		closeUniversalSheet();
		router.replace({
			pathname: "/(app)/(tabs)/pos" as any,
			params: { [SCANNED_BARCODE_KEY]: normalizedUniversalValue },
		} as any);
	}, [canRunUniversalAction, closeUniversalSheet, normalizedUniversalValue, router]);

	const onUniversalCopyBarcode = useCallback(() => {
		if (!canRunUniversalAction) return;
		const clipboard = (ReactNative as any).Clipboard;
		if (clipboard && typeof clipboard.setString === "function") {
			clipboard.setString(normalizedUniversalValue);
			showSuccess("Barcode copied.");
			return;
		}
		showError("Copy is not available in this build.");
	}, [canRunUniversalAction, normalizedUniversalValue, showError, showSuccess]);

	const dismissKeyboard = useCallback(() => {
		ReactNative.Keyboard.dismiss();
	}, []);

	const onToggleTorch = useCallback(() => {
		setTorchEnabled((v) => !v);
	}, []);

	const onUniversalScanAgain = useCallback(() => {
		closeUniversalSheet();
	}, [closeUniversalSheet]);

	const onPreviewLayout = useCallback((e: LayoutChangeEvent) => {
		const { width, height } = e.nativeEvent.layout;
		setPreviewFrame({ width, height });
	}, []);

	const onScanStageLayout = useCallback((e: LayoutChangeEvent) => {
		const { x, y } = e.nativeEvent.layout;
		setScanStageOrigin({ x, y });
	}, []);

	const onScanWindowLayout = useCallback((e: LayoutChangeEvent) => {
		const { x, y, width, height } = e.nativeEvent.layout;
		setScanWindowLayout({ x, y, width, height });
	}, []);

	const onUniversalCardLayout = useCallback((e: LayoutChangeEvent) => {
		const { height: cardHeight } = e.nativeEvent.layout;
		setUniversalCardHeight(cardHeight);
	}, []);

	const allowByFallback = useCallback((value: string): boolean => {
		const now = Date.now();
		const current = fallbackConfirmRef.current;

		if (current.value === value && now - current.ts <= SCAN_FALLBACK_CONFIRM_MS) {
			const next = current.count + 1;
			fallbackConfirmRef.current = { value, ts: now, count: next };
			return next >= SCAN_FALLBACK_CONFIRM_COUNT;
		}

		fallbackConfirmRef.current = { value, ts: now, count: 1 };
		return false;
	}, []);

	const onScanned = useCallback(
		(event: ScanEvent) => {
			const raw = typeof event?.data === "string" ? event.data : "";
			if (!raw) return;

			const value = normalizeScanValue(raw);
			if (!value) return;

			const center = getEventCenter(event);
			const hasPreview = !!previewFrame && previewFrame.width > 0 && previewFrame.height > 0;
			const centerInPreview =
				!!center &&
				hasPreview &&
				center.x >= 0 &&
				center.y >= 0 &&
				center.x <= (previewFrame?.width ?? 0) &&
				center.y <= (previewFrame?.height ?? 0);

			const hasGate = !!frameGateRect;
			const shouldUseGate = !!center && hasGate && centerInPreview;

			if (shouldUseGate && !pointInRect(center, frameGateRect as Rect)) {
				return;
			}

			if (!shouldUseGate && !allowByFallback(value)) {
				return;
			}

			if (lockRef.current) return;

			setTorchEnabled(false);

			if (isUniversalMode) {
				openUniversalSheet(value);
				return;
			}

			setLocked(true);
			unlockSafetyTimer();

			if (returnTo) {
				router.replace({
					pathname: returnTo as any,
					params: {
						...(returnDraftId ? { draftId: returnDraftId } : {}),
						[SCANNED_BARCODE_KEY]: value,
						q: value,
					},
				} as any);
				return;
			}

			router.replace({
				pathname: RETURN_TO,
				params: { q: value },
			});
		},
		[
			allowByFallback,
			frameGateRect,
			isUniversalMode,
			openUniversalSheet,
			previewFrame,
			returnDraftId,
			returnTo,
			router,
			setLocked,
			unlockSafetyTimer,
		],
	);

	if (!permission) {
		return (
			<>
				<Stack.Screen options={{ headerShown: false }} />
				<BAIScreen padded={false} safeTop={false} contentContainerStyle={styles.center}>
					<BAIHeader title='Scan' variant='back' onLeftPress={onCancel} />
					<BAISurface style={styles.card}>
						<BAIText variant='subtitle'>Preparing camera...</BAIText>
						<BAIText variant='body' muted>
							One moment.
						</BAIText>

						<View style={styles.actions}>
							<BAIButton mode='outlined' onPress={onCancel} shape='pill' widthPreset='standard' intent='neutral'>
								Cancel
							</BAIButton>
						</View>
					</BAISurface>
				</BAIScreen>
			</>
		);
	}

	if (!permission.granted) {
		const isPermissionBlocked = permission.canAskAgain === false;
		const permissionMessage =
			permissionHint ||
			(isPermissionBlocked
				? "Camera access is blocked. Open Settings to allow camera access for scanning."
				: "Enable camera access to scan barcodes.");

		return (
			<>
				<Stack.Screen options={{ headerShown: false }} />
				<BAIScreen padded={false} safeTop={false} safeBottom={false} contentContainerStyle={styles.center}>
					<BAIHeader title='Scan' variant='back' onLeftPress={onCancel} />
					<BAISurface style={styles.card}>
						<BAIText variant='subtitle'>Camera permission required</BAIText>
						<BAIText variant='body' muted>
							{permissionMessage}
						</BAIText>

						<View style={styles.actions}>
							<BAICTAButton onPress={onRequestCameraPermission}>Allow Camera</BAICTAButton>
							{isPermissionBlocked ? (
								<BAIButton
									mode='outlined'
									onPress={onOpenSettings}
									shape='pill'
									widthPreset='standard'
									intent='primary'
								>
									Open Settings
								</BAIButton>
							) : null}
							<BAIButton mode='outlined' onPress={onCancel} shape='pill' widthPreset='standard' intent='neutral'>
								Cancel
							</BAIButton>
						</View>
					</BAISurface>
				</BAIScreen>
			</>
		);
	}

	return (
		<>
			<Stack.Screen options={{ headerShown: false }} />
			<BAIScreen padded={false} safeTop={false} safeBottom={false} style={styles.root}>
				<BAIHeader title='Scan' variant='back' onLeftPress={onCancel} />
				<View style={[styles.full, { backgroundColor: theme.colors.background }]}>
					<View style={styles.preview} onLayout={onPreviewLayout}>
						<CameraView
							style={StyleSheet.absoluteFill}
							facing='back'
							enableTorch={torchEnabled}
							barcodeScannerSettings={{
								barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e", "code128", "code39", "qr"],
							}}
							onBarcodeScanned={lockedUI ? undefined : onScanned}
						/>

						<View style={styles.overlayContainer} pointerEvents='box-none'>
							<Pressable style={StyleSheet.absoluteFill} onPress={dismissKeyboard} accessibilityRole='none' />
							<View style={styles.topBar} pointerEvents='box-none'>
								<BAISurface style={styles.topBarCard}>
									<BAIText variant='subtitle'>{lockedUI ? "Captured" : "Scan barcode"}</BAIText>
									<BAIText variant='caption' muted>
										{lockedUI && !universalOpen ? "Returning to Inventory..." : "Scan inside the frame."}
									</BAIText>
								</BAISurface>
								<View style={styles.topBarActions}>
									<BAIIconButton
										icon='flashlight'
										variant='outlined'
										size='xxl'
										iconColor={torchEnabled ? theme.colors.primary : undefined}
										accessibilityLabel={torchEnabled ? "Turn flashlight off" : "Turn flashlight on"}
										onPress={onToggleTorch}
										style={[styles.topBarCloseButton, torchEnabled ? { borderColor: theme.colors.primary } : null]}
									/>
									<BAIIconButton
										icon='close'
										variant='outlined'
										size='xxl'
										accessibilityLabel='Close scan'
										onPress={onCancel}
										style={styles.topBarCloseButton}
									/>
								</View>
							</View>

							{/* Centered scan window (no dim overlay) */}
							<View
								style={[styles.scanStage, { paddingTop: scanStagePaddingTop }]}
								pointerEvents='none'
								onLayout={onScanStageLayout}
							>
								<View
									style={[styles.scanWindow, { width: scanWindowSize, height: scanWindowSize }]}
									onLayout={onScanWindowLayout}
								>
									<View style={styles.cornerTL} />
									<View style={styles.cornerTR} />
									<View style={styles.cornerBL} />
									<View style={styles.cornerBR} />
								</View>
							</View>

							{isUniversalMode && universalOpen ? (
								<View style={[styles.bottomSheet, { marginBottom: bottomReserve }]}>
									<BAISurface
										style={[
											styles.bottomCard,
											{
												maxHeight: universalMaxHeight,
												backgroundColor: theme.dark ? "rgba(28,30,36,0.82)" : "rgba(255,255,255,0.88)",
											},
										]}
										onLayout={onUniversalCardLayout}
									>
										<ScrollView
											showsVerticalScrollIndicator={false}
											keyboardShouldPersistTaps='handled'
											keyboardDismissMode='on-drag'
											contentContainerStyle={styles.bottomCardScrollContent}
										>
											<View style={styles.dynamicHeading}>
												<BAIText variant='subtitle'>Use scanned barcode</BAIText>
												<BAIText variant='caption' muted>
													Edit the barcode if needed, then choose where to apply it.
												</BAIText>
											</View>

											<BAITextInput
												label='Scanned barcode'
												value={universalScannedValue}
												onChangeText={onUniversalBarcodeChange}
												keyboardType='number-pad'
												maxLength={14}
												shape='pill'
												autoCorrect={false}
												autoCapitalize='none'
											/>

											<View style={styles.actions}>
												<BAICTAButton
													onPress={onUniversalSearchInventory}
													disabled={!canRunUniversalAction}
													shape='pill'
												>
													Search Inventory
												</BAICTAButton>
												<BAIButton
													mode='outlined'
													onPress={onUniversalCreateItem}
													disabled={!canRunUniversalAction}
													shape='pill'
													widthPreset='full'
													intent='neutral'
												>
													Create Item with Barcode
												</BAIButton>
												<BAIButton
													mode='outlined'
													onPress={onUniversalFindInPos}
													disabled={!canRunUniversalAction}
													shape='pill'
													widthPreset='full'
													intent='neutral'
												>
													Find in POS Catalog
												</BAIButton>
												<View style={styles.inlineActionsRow}>
													<BAIButton
														mode='outlined'
														onPress={onUniversalScanAgain}
														shape='pill'
														widthPreset='full'
														intent='neutral'
														style={styles.inlineActionButton}
													>
														Scan Again
													</BAIButton>
													<BAIButton
														mode='outlined'
														onPress={onUniversalCopyBarcode}
														disabled={!canRunUniversalAction}
														shape='pill'
														widthPreset='full'
														intent='neutral'
														style={styles.inlineActionButton}
													>
														Copy Barcode
													</BAIButton>
												</View>
											</View>
										</ScrollView>
									</BAISurface>
								</View>
							) : null}
						</View>
					</View>
				</View>
			</BAIScreen>
		</>
	);
}

const styles = StyleSheet.create({
	overlayContainer: {
		position: "absolute",
		left: 0,
		right: 0,
		top: 0,
		bottom: 0,
		paddingHorizontal: 12,
		paddingTop: 12,
		paddingBottom: 12,
		flexDirection: "column",
	},
	// Top bar
	topBar: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
	},
	topBarCard: {
		paddingHorizontal: 14,
		paddingVertical: 8,
		minHeight: 52,
		justifyContent: "center",
		flexShrink: 1,
		maxWidth: "80%",
		backgroundColor: "rgba(0,0,0,0.45)",
		borderRadius: 16,
		borderWidth: 1,
		borderColor: "rgba(255,255,255,0.15)",
	},
	topBarCloseButton: {
		backgroundColor: "rgba(0,0,0,0.45)",
		borderColor: "rgba(255,255,255,0.2)",
	},
	topBarActions: {
		flexDirection: "row",
		alignItems: "center",
		gap: 8,
	},
	// Scan stage
	scanStage: {
		flex: 1,
		justifyContent: "flex-start",
		alignItems: "center",
		paddingTop: 84,
	},
	scanWindow: {
		width: 280,
		height: 280,
		borderRadius: 22,
		borderWidth: 1,
		borderColor: "rgba(255,255,255,0.25)",
		backgroundColor: "rgba(255,255,255,0.06)",
		overflow: "hidden",
	},
	// Corners (professional frame)
	cornerTL: {
		position: "absolute",
		left: 14,
		top: 14,
		width: 28,
		height: 28,
		borderLeftWidth: 3,
		borderTopWidth: 3,
		borderColor: "rgba(255,255,255,0.9)",
		borderTopLeftRadius: 8,
	},
	cornerTR: {
		position: "absolute",
		right: 14,
		top: 14,
		width: 28,
		height: 28,
		borderRightWidth: 3,
		borderTopWidth: 3,
		borderColor: "rgba(255,255,255,0.9)",
		borderTopRightRadius: 8,
	},
	cornerBL: {
		position: "absolute",
		left: 14,
		bottom: 14,
		width: 28,
		height: 28,
		borderLeftWidth: 3,
		borderBottomWidth: 3,
		borderColor: "rgba(255,255,255,0.9)",
		borderBottomLeftRadius: 8,
	},
	cornerBR: {
		position: "absolute",
		right: 14,
		bottom: 14,
		width: 28,
		height: 28,
		borderRightWidth: 3,
		borderBottomWidth: 3,
		borderColor: "rgba(255,255,255,0.9)",
		borderBottomRightRadius: 8,
	},
	// Bottom sheet
	bottomSheet: {
		marginTop: "auto",
	},
	bottomCard: {
		padding: 16,
		gap: 10,
		overflow: "hidden",
	},
	bottomCardScrollContent: {
		gap: 10,
	},
	dynamicHeading: {
		gap: 2,
	},
	inlineActionsRow: {
		flexDirection: "row",
		gap: 10,
	},
	inlineActionButton: {
		flex: 1,
	},
	bottomActions: {
		flexDirection: "row",
		justifyContent: "flex-end",
	},
	root: { flex: 1 },
	full: { flex: 1 },
	preview: { flex: 1 },
	center: { flexGrow: 1, padding: 16, alignItems: "center", justifyContent: "center" },
	card: { width: "100%", maxWidth: 520, padding: 14, gap: 10 },
	actions: { gap: 10, marginTop: 6 },
});
