// BizAssist_mobile
// path: src/modules/inventory/inventory.api.ts

import apiClient from "@/lib/api/httpClient";
import type {
	AdjustInventoryInput,
	CreateProductInput,
	CreateProductResponse,
	DecimalQuantityString,
	InventoryCategoryRef,
	InventoryMovement,
	InventoryProduct,
	InventoryProductDetail,
	ListMovementsResponse,
	ListProductsResponse,
	ProductType,
	ScaledIntQuantity,
	UpdateProductInput,
} from "@/modules/inventory/inventory.types";

type ApiEnvelope<T> = {
	success: boolean;
	data: T;
	message?: string;
};

type ListProductsParams = {
	q?: string;
	type?: ProductType;
	limit?: number;
	cursor?: string | null;
	includeArchived?: boolean;
	isActive?: boolean;
};

function toTrimmedString(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

function toNumberOrNull(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string") {
		const n = Number(value);
		return Number.isFinite(n) ? n : null;
	}
	return null;
}

function toNumberOrZero(value: unknown): number {
	const n = toNumberOrNull(value);
	return n ?? 0;
}

function toNumberFromCandidates(...values: unknown[]): number | null {
	for (const value of values) {
		const n = toNumberOrNull(value);
		if (n !== null) return n;
	}
	return null;
}

function toTrimmedStringFromCandidates(...values: unknown[]): string | null {
	for (const value of values) {
		const s = toTrimmedString(value);
		if (s) return s;
	}
	return null;
}

function toBooleanFromCandidates(...values: unknown[]): boolean | null {
	for (const value of values) {
		if (typeof value === "boolean") return value;
		if (typeof value === "number" && Number.isFinite(value)) {
			if (value === 1) return true;
			if (value === 0) return false;
		}
		if (typeof value === "string") {
			const normalized = value.trim().toLowerCase();
			if (normalized === "true" || normalized === "1") return true;
			if (normalized === "false" || normalized === "0") return false;
		}
	}
	return null;
}

// Decimal-safe extraction (string-friendly)
function toDecimalStringOrNull(value: unknown): string | null {
	if (typeof value === "string") {
		const s = value.trim();
		return s ? s : null;
	}
	if (typeof value === "number" && Number.isFinite(value)) {
		// best-effort
		return String(value);
	}
	// Prisma Decimal may arrive as object with toString()
	if (value && typeof value === "object" && typeof (value as any).toString === "function") {
		const s = String((value as any).toString()).trim();
		return s ? s : null;
	}
	return null;
}

function isUdqiDecimalString(s: string | null): s is string {
	if (!s) return false;
	// UDQI transport: treat any numeric string as a decimal-string (integer or fractional).
	// If a server still emits legacy scaled-int integers, it must send an explicit
	// scaled-int field or a numeric type, not an ambiguous string.
	return /^-?\d+(?:\.\d+)?$/.test(s);
}

function formatDecimalRawWithScale(raw: string, scale: number): string {
	const s = raw.trim();
	if (!s) return "0";

	const negative = s.startsWith("-");
	const unsigned = negative ? s.slice(1) : s;
	const [wholePart = "0", fracPart = ""] = unsigned.split(".");

	const whole = wholePart.replace(/^0+(?=\d)/, "") || "0";
	const frac = (fracPart ?? "").padEnd(Math.max(0, scale), "0").slice(0, Math.max(0, scale));

	const base = scale > 0 ? `${whole}.${frac}` : whole;
	return negative && base !== "0" && base !== "0.0" ? `-${base}` : base;
}

function toProductType(value: unknown): ProductType {
	const raw = typeof value === "string" ? value.trim().toUpperCase() : "";
	if (raw === "SERVICE" || raw === "SERVICES") return "SERVICE";
	return "PHYSICAL";
}

function toCategory(input: any): InventoryCategoryRef | null {
	const direct = input?.category;
	if (direct && typeof direct === "object") {
		const id = toTrimmedString(direct.id);
		const name = toTrimmedString(direct.name);
		if (id && name) {
			const isActive = typeof direct.isActive === "boolean" ? direct.isActive : undefined;
			return { id, name, color: toTrimmedString(direct.color), isActive };
		}
	}

	const id = toTrimmedString(input?.categoryId);
	const name = toTrimmedString(input?.categoryName);
	if (id && name) {
		const isActive = typeof input?.categoryIsActive === "boolean" ? input.categoryIsActive : undefined;
		return { id, name, color: toTrimmedString(input?.categoryColor), isActive };
	}

	return null;
}

function toUnitMeta(input: any): {
	unitId?: string;
	unitName?: string;
	unitAbbreviation?: string;
	unitCategory?: string;
	unitPrecisionScale?: number | null;
} {
	const direct = input?.unit;
	if (direct && typeof direct === "object") {
		return {
			unitId: toTrimmedString(direct.id) ?? toTrimmedString(input?.unitId) ?? undefined,
			unitName: toTrimmedString(direct.name) ?? undefined,
			unitAbbreviation: toTrimmedString(direct.abbreviation) ?? undefined,
			unitCategory: toTrimmedString(direct.category) ?? undefined,
			unitPrecisionScale:
				typeof direct.precisionScale === "number" ? direct.precisionScale : toNumberOrNull(direct.precisionScale),
		};
	}

	return {
		unitId: toTrimmedString(input?.unitId) ?? undefined,
		unitName: toTrimmedString(input?.unitName) ?? undefined,
		unitAbbreviation: toTrimmedString(input?.unitAbbreviation) ?? undefined,
		unitCategory: toTrimmedString(input?.unitCategory) ?? undefined,
		unitPrecisionScale: toNumberOrNull(input?.unitPrecisionScale),
	};
}

/**
 * Branding helpers
 * - We only brand after validating basic invariants.
 * - This keeps UDQI types honest while satisfying TS strictness.
 */
function asScaledIntQuantity(value: unknown): ScaledIntQuantity | undefined {
	if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) return undefined;
	return value as ScaledIntQuantity;
}

function asDecimalQuantityString(value: unknown): DecimalQuantityString | undefined {
	if (typeof value !== "string") return undefined;
	const s = value.trim();
	if (!s) return undefined;
	if (!/^-?\d+(?:\.\d+)?$/.test(s)) return undefined;
	return s as DecimalQuantityString;
}

function normalizeInventoryProduct(input: any): InventoryProduct {
	// raw values as returned by API
	const onHandAny = input?.onHandCached;
	const reorderAny = input?.reorderPoint;

	const onHandStr = toDecimalStringOrNull(onHandAny);
	const reorderStr = toDecimalStringOrNull(reorderAny);

	// Legacy numeric fallbacks: keep stable for existing UI (scaled-int world)
	const onHandNum = typeof onHandAny === "number" ? toNumberOrZero(onHandAny) : toNumberOrZero(onHandStr);
	const reorderNum = typeof reorderAny === "number" ? toNumberOrNull(reorderAny) : toNumberOrNull(reorderStr);

	// UDQI raw strings must only be populated when API is truly UDQI.
	// In Phase-1 compatibility mode, legacy ints often arrive as "10" which must NOT be treated as UDQI.
	const onHandRaw = isUdqiDecimalString(onHandStr) ? onHandStr : null;
	const reorderRaw = isUdqiDecimalString(reorderStr) ? reorderStr : null;

	const unit = toUnitMeta(input);
	const primaryImageUrl = toTrimmedString(input?.primaryImageUrl);
	const posTileNode = input?.posTile && typeof input.posTile === "object" ? input.posTile : null;
	const posTileColor = toTrimmedStringFromCandidates(
		input?.posTileColor,
		input?.tileColor,
		posTileNode?.color,
		posTileNode?.tileColor,
	);
	const rawPosTileMode =
		toTrimmedStringFromCandidates(input?.posTileMode, input?.tileMode, posTileNode?.mode, posTileNode?.tileMode)?.toUpperCase() ??
		"";
	const posTileMode =
		rawPosTileMode === "IMAGE"
			? "IMAGE"
			: rawPosTileMode === "COLOR"
				? "COLOR"
				: primaryImageUrl
					? "IMAGE"
					: "COLOR";
	const posTileLabel = toTrimmedStringFromCandidates(
		input?.posTileLabel,
		input?.tileLabel,
		input?.posTileTitle,
		input?.tileTitle,
		input?.posTileName,
		posTileNode?.label,
		posTileNode?.name,
		posTileNode?.title,
		posTileNode?.text,
		posTileNode?.tileLabel,
		posTileNode?.tileTitle,
	);
	const modifierGroupIds = Array.isArray(input?.modifierGroupIds)
		? input.modifierGroupIds.map((value: unknown) => String(value ?? "").trim()).filter(Boolean)
		: [];

	const durationInitialMinutes = toNumberFromCandidates(
		input?.durationInitialMinutes,
		input?.initialDurationMinutes,
		input?.durationInitial,
		input?.duration_initial_minutes,
	);
	const durationProcessingMinutes = toNumberFromCandidates(
		input?.durationProcessingMinutes,
		input?.processingDurationMinutes,
		input?.durationProcessing,
		input?.duration_processing_minutes,
	);
	const durationFinalMinutes = toNumberFromCandidates(
		input?.durationFinalMinutes,
		input?.finalDurationMinutes,
		input?.durationFinal,
		input?.duration_final_minutes,
	);
	const durationTotalMinutesRaw = toNumberFromCandidates(
		input?.durationTotalMinutes,
		input?.durationMinutes,
		input?.duration,
		input?.serviceDurationMinutes,
		input?.serviceDurationMins,
		input?.duration_total_minutes,
		input?.service_duration_mins,
	);
	const derivedTotalFromSegments =
		durationInitialMinutes !== null && durationProcessingMinutes !== null && durationFinalMinutes !== null
			? durationInitialMinutes + durationProcessingMinutes + durationFinalMinutes
			: null;
	const durationTotalMinutes = durationTotalMinutesRaw ?? derivedTotalFromSegments;
	const processingEnabled =
		toBooleanFromCandidates(
			input?.processingEnabled,
			input?.hasProcessingTime,
			input?.isProcessingEnabled,
			input?.processing_enabled,
		) ?? false;

	const explicitType = toTrimmedStringFromCandidates(input?.type, input?.productType, input?.kind, input?.itemType);
	const unitCategory = toTrimmedStringFromCandidates(input?.unitCategory, input?.unit?.category)?.toUpperCase() ?? "";
	const hasServiceDurationSignals =
		durationTotalMinutesRaw !== null ||
		durationInitialMinutes !== null ||
		durationProcessingMinutes !== null ||
		durationFinalMinutes !== null ||
		processingEnabled;
	const inferredType = explicitType ?? (hasServiceDurationSignals || unitCategory === "TIME" ? "SERVICE" : "PHYSICAL");

	return {
		id: toTrimmedString(input?.id) ?? "",
		type: toProductType(inferredType),
		name: toTrimmedString(input?.name) ?? "Item",

		sku: toTrimmedString(input?.sku),
		barcode: toTrimmedString(input?.barcode),
		price: toNumberOrNull(input?.price ?? input?.unitPrice ?? input?.sellPrice),
		cost: toNumberOrNull(input?.cost ?? input?.unitCost),

		categoryId: toTrimmedString(input?.categoryId),
		category: toCategory(input),

		trackInventory: typeof input?.trackInventory === "boolean" ? input.trackInventory : false,
		durationTotalMinutes,
		processingEnabled,
		durationInitialMinutes,
		durationProcessingMinutes,
		durationFinalMinutes,

		// legacy numeric fields (keep stable)
		reorderPoint: reorderNum,
		onHandCached: onHandNum,

		// UDQI raw decimals (only if clearly UDQI)
		reorderPointRaw: reorderRaw ?? undefined,
		onHandCachedRaw: onHandRaw ?? undefined,

		// unit meta (optional)
		unitId: unit.unitId,
		unitName: unit.unitName,
		unitAbbreviation: unit.unitAbbreviation,
		modifierGroupIds,
		unitCategory: unit.unitCategory,
		unitPrecisionScale: unit.unitPrecisionScale ?? undefined,

		primaryImageUrl,
		posTileMode,
		posTileColor,
		posTileLabel,
		isActive: typeof input?.isActive === "boolean" ? input.isActive : true,

		createdAt: toTrimmedString(input?.createdAt) ?? undefined,
		updatedAt: toTrimmedString(input?.updatedAt) ?? undefined,
	};
}

function normalizeProductOptionSelections(input: any): InventoryProductDetail["optionSelections"] {
	if (!Array.isArray(input?.optionSelections)) return undefined;
	const items = input.optionSelections
		.map((selection: any, index: number) => {
			const optionSetId = toTrimmedString(selection?.optionSetId);
			if (!optionSetId) return null;
			const selectedValueIds = Array.isArray(selection?.selectedValueIds)
				? selection.selectedValueIds.map((value: unknown) => String(value ?? "").trim()).filter(Boolean)
				: [];
			const selectedValueNames = Array.isArray(selection?.selectedValueNames)
				? selection.selectedValueNames.map((value: unknown) => String(value ?? "").trim()).filter(Boolean)
				: [];
			return {
				optionSetId,
				optionSetName: toTrimmedString(selection?.optionSetName) ?? "",
				selectedValueIds,
				selectedValueNames,
				sortOrder:
					typeof selection?.sortOrder === "number" && Number.isFinite(selection.sortOrder)
						? selection.sortOrder
						: index,
			};
		})
		.filter(Boolean) as NonNullable<NonNullable<InventoryProductDetail["optionSelections"]>[number]>[];
	items.sort((a, b) => a.sortOrder - b.sortOrder);
	return items;
}

function normalizeProductVariations(input: any): InventoryProductDetail["variations"] {
	if (!Array.isArray(input?.variations)) return undefined;
	const items = input.variations
		.map((variation: any, index: number) => {
			const variationKey = toTrimmedString(variation?.variationKey);
			if (!variationKey) return null;
			const rawValueMap = variation?.valueMap && typeof variation.valueMap === "object" ? variation.valueMap : {};
			const valueMap = Object.entries(rawValueMap).reduce<Record<string, string>>((acc, [key, value]) => {
				const optionSetId = String(key ?? "").trim();
				const optionValueId = String(value ?? "").trim();
				if (optionSetId && optionValueId) acc[optionSetId] = optionValueId;
				return acc;
			}, {});
			return {
				variationKey,
				label: toTrimmedString(variation?.label) ?? "",
				valueMap,
				sortOrder:
					typeof variation?.sortOrder === "number" && Number.isFinite(variation.sortOrder) ? variation.sortOrder : index,
			};
		})
		.filter(Boolean) as NonNullable<NonNullable<InventoryProductDetail["variations"]>[number]>[];
	items.sort((a, b) => a.sortOrder - b.sortOrder);
	return items;
}

function normalizeInventoryProductDetail(input: any): InventoryProductDetail {
	return {
		...normalizeInventoryProduct(input),
		description: toTrimmedString(input?.description),
		price: toNumberOrNull(input?.price ?? input?.unitPrice ?? input?.sellPrice),
		cost: toNumberOrNull(input?.cost ?? input?.unitCost),
		optionSelections: normalizeProductOptionSelections(input),
		variations: normalizeProductVariations(input),
	};
}

function normalizeMovement(input: any): InventoryMovement {
	const rawAny =
		input?.quantityDeltaRaw ?? input?.quantityDelta ?? input?.delta ?? input?.quantity ?? input?.amount ?? null;

	const rawStr = toDecimalStringOrNull(rawAny);
	const meta = toUnitMeta(input);
	const scale = meta.unitPrecisionScale ?? 0;
	const isUdqi = isUdqiDecimalString(rawStr);

	// UDQI branded strings (only when clearly UDQI)
	const quantityDeltaRaw = isUdqi ? asDecimalQuantityString(rawStr) : undefined;

	const decimalFormatted = isUdqi ? formatDecimalRawWithScale(rawStr!, scale) : undefined;
	const quantityDeltaDecimal = isUdqi ? asDecimalQuantityString(decimalFormatted) : undefined;

	// Legacy scaled-int fallback (brand only if integer)
	const scaledIntFallback = (() => {
		if (typeof rawAny === "number" && Number.isFinite(rawAny)) return rawAny;
		if (rawStr && /^-?\d+$/.test(rawStr)) return Number(rawStr);
		return undefined;
	})();
	const quantityDeltaScaledInt = asScaledIntQuantity(scaledIntFallback);

	const quantityDelta = (() => {
		if (typeof rawAny === "number" && Number.isFinite(rawAny)) return rawAny;
		if (isUdqi) return toNumberOrNull(quantityDeltaDecimal ?? quantityDeltaRaw) ?? 0;
		return toNumberOrNull(rawStr) ?? 0;
	})();

	return {
		id: String(input?.id ?? ""),
		productId: String(input?.productId ?? ""),
		storeId: typeof input?.storeId === "string" ? input.storeId : null,

		quantityDelta,
		quantityDeltaScaledInt,
		quantityDeltaRaw,
		quantityDeltaDecimal,

		...meta,

		reason: String(input?.reason ?? "ADJUSTMENT") as any,
		relatedSaleId: typeof input?.relatedSaleId === "string" ? input.relatedSaleId : null,
		createdAt: String(input?.createdAt ?? ""),
	};
}

export const inventoryApi = {
	async listProducts(params?: ListProductsParams): Promise<ListProductsResponse> {
		const res = await apiClient.get<ApiEnvelope<ListProductsResponse>>("/catalog/products", { params });
		const data = res.data.data as any;
		const items = Array.isArray(data?.items) ? data.items.map(normalizeInventoryProduct) : [];
		const nextCursor = typeof data?.nextCursor === "string" ? data.nextCursor : null;
		return { ...(data && typeof data === "object" ? data : {}), items, nextCursor };
	},

	async createProduct(input: CreateProductInput): Promise<CreateProductResponse> {
		const res = await apiClient.post<ApiEnvelope<CreateProductResponse>>("/catalog/products", input as any);
		return res.data.data;
	},

	async updateProduct(id: string, input: UpdateProductInput): Promise<InventoryProductDetail> {
		const res = await apiClient.patch<ApiEnvelope<InventoryProductDetail>>(
			`/catalog/products/${encodeURIComponent(id)}`,
			input as any,
		);
		const data = res.data.data as any;
		return normalizeInventoryProductDetail(data);
	},

	async archiveProduct(id: string): Promise<InventoryProductDetail> {
		return this.updateProduct(id, { isActive: false });
	},

	async restoreProduct(id: string): Promise<InventoryProductDetail> {
		return this.updateProduct(id, { isActive: true });
	},

	async getProductDetail(id: string): Promise<InventoryProductDetail> {
		const res = await apiClient.get<ApiEnvelope<InventoryProductDetail>>(
			`/inventory/products/${encodeURIComponent(id)}`,
		);
		const data = res.data.data as any;
		const rawProduct = data?.product ?? data;
		return normalizeInventoryProductDetail(rawProduct);
	},

	async listMovements(productId: string, opts?: { limit?: number }): Promise<ListMovementsResponse> {
		const res = await apiClient.get<ApiEnvelope<ListMovementsResponse>>(
			`/inventory/products/${encodeURIComponent(productId)}/movements`,
			{ params: opts },
		);
		const data = res.data.data as any;
		const items = Array.isArray(data?.items) ? data.items.map(normalizeMovement) : [];
		return { ...(data && typeof data === "object" ? data : {}), items };
	},

	async removeProductImage(productId: string): Promise<{ ok: true }> {
		const res = await apiClient.post<ApiEnvelope<{ ok: true }>>(
			`/inventory/products/${encodeURIComponent(productId)}/image/remove`,
		);
		return res.data.data;
	},

	async adjustInventory(productId: string, input: AdjustInventoryInput): Promise<{ ok: true }> {
		const res = await apiClient.post<ApiEnvelope<{ ok: true }>>("/inventory/adjustments", {
			productId,
			...input,
		} as any);
		return res.data.data;
	},
};
