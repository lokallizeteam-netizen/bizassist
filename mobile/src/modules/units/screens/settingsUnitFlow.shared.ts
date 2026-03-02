import { useCallback, useMemo, useRef, useState } from "react";
import { useLocalSearchParams } from "expo-router";

import {
	DRAFT_ID_KEY,
	UNIT_CONTEXT_PRODUCT_TYPE_KEY,
	type UnitProductType,
	parseUnitSelectionParams,
} from "@/modules/units/unitPicker.contract";
import { resolveReturnTo, SETTINGS_UNITS_ROUTE } from "@/modules/units/units.navigation";

export const SETTINGS_UNIT_ADD_ROUTE = "/(app)/(tabs)/settings/units/add" as const;
export const SETTINGS_UNIT_SELECT_ROUTE = "/(app)/(tabs)/settings/units/select" as const;
export const SETTINGS_UNIT_CUSTOM_CREATE_ROUTE = "/(app)/(tabs)/settings/units/custom-create" as const;

export function normalizeSettingsUnitValue(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

export function toSettingsUnitProductType(raw: unknown): UnitProductType {
	return normalizeSettingsUnitValue(raw) === "SERVICE" ? "SERVICE" : "PHYSICAL";
}

export function useSettingsUnitFlowContext() {
	const params = useLocalSearchParams();
	const inbound = useMemo(() => parseUnitSelectionParams(params as any), [params]);
	const resolvedReturnTo = resolveReturnTo(params as Record<string, unknown>);
	const returnTo = resolvedReturnTo === SETTINGS_UNITS_ROUTE ? resolvedReturnTo : SETTINGS_UNITS_ROUTE;
	const draftId = inbound.draftId || normalizeSettingsUnitValue((params as any)[DRAFT_ID_KEY]) || "";
	const productType = useMemo(() => toSettingsUnitProductType((params as any)[UNIT_CONTEXT_PRODUCT_TYPE_KEY]), [params]);

	return {
		params,
		inbound,
		returnTo,
		draftId,
		productType,
	};
}

export function useUnitNavLock() {
	const navLockRef = useRef(false);
	const [isNavLocked, setIsNavLocked] = useState(false);

	const lockNav = useCallback((ms = 650) => {
		if (navLockRef.current) return false;
		navLockRef.current = true;
		setIsNavLocked(true);
		setTimeout(() => {
			navLockRef.current = false;
			setIsNavLocked(false);
		}, ms);
		return true;
	}, []);

	return {
		isNavLocked,
		lockNav,
	};
}
